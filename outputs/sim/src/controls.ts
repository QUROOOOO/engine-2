import * as THREE from 'three';

export type ControlsModeChangeHandler = (mode: string) => void;
export type CameraFrameMode = 'PLANET_CENTRIC' | 'OBJECT_CENTRIC';

export interface CameraStateTelemetry {
  frameMode: CameraFrameMode;
  targetName: string;
  distance: number;
  isTransitioning: boolean;
}

export class OrbitRig {
  public cam: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  public dom: HTMLElement;
  public onChange: ControlsModeChangeHandler;
  public onModeChange?: (telemetry: CameraStateTelemetry) => void;
  public target: THREE.Vector3;
  public goalTarget: THREE.Vector3;
  public radius: number;
  public goalRadius: number;
  public theta: number;
  public goalTheta: number;
  public phi: number;
  public goalPhi: number;
  public minR: number;
  public maxR: number;
  public mode: string;
  public ortho: boolean;
  public manualPan: boolean = false;
  public isMoving: boolean = false;

  // Dual Reference Frame State Machine
  private _frameMode: CameraFrameMode = 'PLANET_CENTRIC';
  private _trackedName: string = 'Earth Center';
  private _trackedKind: 'sat' | 'deb' | null = null;
  private _trackedIndex: number | null = null;

  // Transit Animation State
  private _isTransitioning: boolean = false;
  private _transitElapsed: number = 0;
  private _transitDuration: number = 1.1; // seconds
  private _transitStartTarget: THREE.Vector3 = new THREE.Vector3();
  private _transitEndTarget: THREE.Vector3 = new THREE.Vector3();
  private _transitStartRadius: number = 165;
  private _transitEndRadius: number = 4.2;
  private _transitStartTheta: number = 0.72;
  private _transitEndTheta: number = 0.72;
  private _transitStartPhi: number = 1.12;
  private _transitEndPhi: number = 1.12;

  // Geometric Constants (1 scene unit = 100 km)
  public static readonly R_EARTH = 63.71;
  public static readonly PLANET_MIN_DIST = 76.0;
  public static readonly PLANET_MAX_DIST = 420.0;
  public static readonly OBJECT_MIN_DIST = 0.18;
  public static readonly OBJECT_MAX_DIST = 45.0;
  public static readonly OBJECT_RELEASE_BOUNDARY = 42.0;
  public static readonly PLANET_HANDOFF_BOUNDARY = 82.0;

  // Callbacks for main loop integration
  public onPan?: () => void;
  public onFocus?: () => void;
  public onDblClick?: (ndcX: number, ndcY: number) => void;
  public onSelectIndex?: (kind: 'sat' | 'deb', index: number) => void;
  public onTogglePause?: () => void;
  public onToggleCinema?: () => void;
  public onFocusConjunction?: () => void;

  private _persp: THREE.PerspectiveCamera;
  private _abortController: AbortController = new AbortController();
  private _dragState: {
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    mode: 'orbit' | 'pan' | 'zoom';
    pointerId: number;
    hasMoved: boolean;
  } | null = null;

  constructor(
    camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    onChange?: ControlsModeChangeHandler
  ) {
    this.cam = camera;
    this.dom = dom;
    this.onChange = onChange || (() => {});
    this.target = new THREE.Vector3(0, 0, 0);
    this.goalTarget = this.target.clone();
    this.radius = 185;
    this.goalRadius = 185;
    this.theta = 0.72;
    this.goalTheta = 0.72;
    this.phi = 1.12;
    this.goalPhi = 1.12;
    this.minR = OrbitRig.PLANET_MIN_DIST;
    this.maxR = OrbitRig.PLANET_MAX_DIST;
    this.mode = 'FREE ORBIT';
    this.ortho = false;
    this._persp = camera;
    this._bind();
  }

  public get frameMode(): CameraFrameMode {
    return this._frameMode;
  }

  public get currentDistance(): number {
    return this.radius;
  }

  public get targetName(): string {
    return this._trackedName;
  }

  public get trackedKind(): 'sat' | 'deb' | null {
    return this._trackedKind;
  }

  public get trackedIndex(): number | null {
    return this._trackedIndex;
  }

  public get isTransitioning(): boolean {
    return this._isTransitioning;
  }

  public isInspectingObject(kind: 'sat' | 'deb', index: number): boolean {
    return this._frameMode === 'OBJECT_CENTRIC' && this._trackedKind === kind && this._trackedIndex === index;
  }

  private _notifyMode(): void {
    if (this.onModeChange) {
      this.onModeChange({
        frameMode: this._frameMode,
        targetName: this._trackedName,
        distance: this.radius,
        isTransitioning: this._isTransitioning,
      });
    }
  }

  private _bind(): void {
    const d = this.dom;
    const signal = this._abortController.signal;

    d.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

    // Pointer events: Trackpad + Mouse + Touch
    d.addEventListener('pointerdown', (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.closest('button, .nav-gizmo, input')) return;

      // Interruption handling: grab mid-transit immediately yields to user
      if (this._isTransitioning) {
        this._isTransitioning = false;
        this.goalTarget.copy(this.target);
        this.goalRadius = this.radius;
        this.goalTheta = this.theta;
        this.goalPhi = this.phi;
      }

      let mode: 'orbit' | 'pan' | 'zoom' = 'orbit';

      if (e.shiftKey || e.button === 2) {
        mode = 'pan';
      } else if (e.ctrlKey) {
        mode = 'zoom';
      } else if (e.button === 0 || e.button === 1) {
        mode = 'orbit';
      } else {
        return;
      }

      this._dragState = {
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        mode,
        pointerId: e.pointerId,
        hasMoved: false,
      };

      try {
        d.setPointerCapture(e.pointerId);
      } catch {
        // Safe fallback
      }
      d.classList.add('dragging');
    }, { signal });

    d.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this._dragState || this._dragState.pointerId !== e.pointerId) return;

      const dx = e.clientX - this._dragState.lastX;
      const dy = e.clientY - this._dragState.lastY;
      const totalDist = Math.hypot(
        e.clientX - this._dragState.startX,
        e.clientY - this._dragState.startY
      );

      if (totalDist > 3) {
        this._dragState.hasMoved = true;
      }

      this._dragState.lastX = e.clientX;
      this._dragState.lastY = e.clientY;

      if (this._dragState.mode === 'pan') {
        this.pan(dx, dy);
      } else if (this._dragState.mode === 'zoom') {
        this.zoom(dy * 1.5);
      } else {
        this.orbit(dx, dy);
      }
    }, { signal });

    const finishPointer = (e: PointerEvent) => {
      if (this._dragState && this._dragState.pointerId === e.pointerId) {
        try {
          d.releasePointerCapture?.(e.pointerId);
        } catch {
          // Safe fallback
        }
        this._dragState = null;
        d.classList.remove('dragging');
      }
    };

    d.addEventListener('pointerup', finishPointer, { signal });
    d.addEventListener('pointercancel', finishPointer, { signal });

    // Trackpad scroll & mouse wheel with exponential distance scaling
    d.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();

        if (this._isTransitioning) {
          this._isTransitioning = false;
          this.goalTarget.copy(this.target);
          this.goalRadius = this.radius;
        }

        if (e.ctrlKey) {
          // Pinch-to-zoom on trackpad
          this.zoom(e.deltaY * 0.9);
        } else if (e.shiftKey) {
          // Pan with trackpad
          this.pan(-e.deltaX * 0.5, -e.deltaY * 0.5);
        } else {
          const scale = e.deltaMode === 1 ? 16 : 1;
          this.zoom(e.deltaY * scale);
        }
      },
      { signal, passive: false }
    );

    // Double click to focus or reset
    d.addEventListener('dblclick', (e: MouseEvent) => {
      const rect = d.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      if (this.onDblClick) {
        this.onDblClick(ndcX, ndcY);
      }
    }, { signal });

    // Touch events
    let touchDist0 = 0;
    let touchMid0 = { x: 0, y: 0 };

    d.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (this._isTransitioning) {
          this._isTransitioning = false;
          this.goalTarget.copy(this.target);
          this.goalRadius = this.radius;
        }
        if (e.touches.length === 2) {
          touchDist0 = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
          touchMid0 = {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
          };
        }
      },
      { signal, passive: true }
    );

    d.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (e.touches.length === 2) {
          const dist1 = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
          const mid1 = {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
          };

          const zoomDelta = (touchDist0 - dist1) * 2.5;
          this.zoom(zoomDelta);

          const panX = mid1.x - touchMid0.x;
          const panY = mid1.y - touchMid0.y;
          this.pan(panX, panY);

          touchDist0 = dist1;
          touchMid0 = mid1;
        }
      },
      { signal, passive: true }
    );

    // Keyboard navigation
    addEventListener('keydown', (e: KeyboardEvent) => this._keys(e), { signal });
  }

  private _keys(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.matches('input,textarea')) return;
    const code = e.code;
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    // 1–9: Direct access to protected satellites #1–#9
    if (code.startsWith('Digit') || code.startsWith('Numpad')) {
      const char = code.slice(-1);
      const digit = parseInt(char, 10);
      if (!isNaN(digit) && digit >= 1 && digit <= 9 && !shift && !ctrl) {
        if (this.onSelectIndex) {
          e.preventDefault();
          this.onSelectIndex('sat', digit - 1);
          return;
        }
      }
    }

    // Space is handled centrally by UI keyboard listener

    // Z: Cinema Mode toggle
    if (code === 'KeyZ') {
      e.preventDefault();
      this.onToggleCinema?.();
      return;
    }

    // C: Conjunction threat focus
    if (code === 'KeyC' && !shift && !ctrl) {
      e.preventDefault();
      this.onFocusConjunction?.();
      return;
    }

    // R or Escape: Smoothly return to PLANET_CENTRIC view
    if (code === 'KeyR' || code === 'Escape') {
      e.preventDefault();
      this.resetToPlanetView();
      return;
    }

    // Blender View Presets (Supports Numpad AND Ctrl combinations)
    const isNum1 = code === 'Numpad1';
    const isNum3 = code === 'Numpad3';
    const isNum7 = code === 'Numpad7';
    const isNum9 = code === 'Numpad9';
    const isNum5 = code === 'Numpad5';
    const isDec = code === 'NumpadDecimal' || code === 'Period' || code === 'Home';

    if (isNum1) {
      e.preventDefault();
      this.setViewPreset(ctrl ? 'BACK' : 'FRONT');
      return;
    }
    if (isNum3) {
      e.preventDefault();
      this.setViewPreset(ctrl ? 'LEFT' : 'RIGHT');
      return;
    }
    if (isNum7) {
      e.preventDefault();
      this.setViewPreset(ctrl ? 'BOTTOM' : 'TOP');
      return;
    }
    if (isNum9) {
      e.preventDefault();
      this.flipView();
      return;
    }
    if (isNum5) {
      e.preventDefault();
      this.toggleOrtho();
      return;
    }
    if (isDec) {
      e.preventDefault();
      this.frameAll();
      return;
    }
    if (code === 'KeyF') {
      e.preventDefault();
      this.onFocus?.();
      return;
    }

    // Arrow keys: Orbit or Pan
    if (code === 'ArrowLeft') {
      e.preventDefault();
      shift ? this.pan(20, 0) : this.orbit(15, 0);
    } else if (code === 'ArrowRight') {
      e.preventDefault();
      shift ? this.pan(-20, 0) : this.orbit(-15, 0);
    } else if (code === 'ArrowUp') {
      e.preventDefault();
      shift ? this.pan(0, 20) : this.orbit(0, 15);
    } else if (code === 'ArrowDown') {
      e.preventDefault();
      shift ? this.pan(0, -20) : this.orbit(0, -15);
    } else if (code === 'Equal' || code === 'NumpadAdd') {
      e.preventDefault();
      this.zoom(-25);
    } else if (code === 'Minus' || code === 'NumpadSubtract') {
      e.preventDefault();
      this.zoom(25);
    }
  }

  public setViewPreset(preset: 'FRONT' | 'BACK' | 'RIGHT' | 'LEFT' | 'TOP' | 'BOTTOM'): void {
    const r = Math.max(this.radius, this.minR);
    switch (preset) {
      case 'FRONT':
        this.goalTheta = 0;
        this.goalPhi = Math.PI / 2;
        break;
      case 'BACK':
        this.goalTheta = Math.PI;
        this.goalPhi = Math.PI / 2;
        break;
      case 'RIGHT':
        this.goalTheta = Math.PI / 2;
        this.goalPhi = Math.PI / 2;
        break;
      case 'LEFT':
        this.goalTheta = -Math.PI / 2;
        this.goalPhi = Math.PI / 2;
        break;
      case 'TOP':
        this.goalTheta = 0;
        this.goalPhi = 0.001;
        break;
      case 'BOTTOM':
        this.goalTheta = 0;
        this.goalPhi = Math.PI - 0.001;
        break;
    }
    this.goalRadius = r;
    this.mode = `VIEW ${preset}`;
    this.onChange(this.mode);
  }

  public flipView(): void {
    this.goalTheta += Math.PI;
    this.goalPhi = Math.PI - this.goalPhi;
    if (this.goalPhi < 0.05) this.goalPhi = 0.05;
    if (this.goalPhi > Math.PI - 0.05) this.goalPhi = Math.PI - 0.05;
    this.mode = 'VIEW FLIP';
    this.onChange(this.mode);
  }

  public orbit(dx: number, dy: number): void {
    this.goalTheta -= dx * 0.0055;
    this.goalPhi = Math.min(Math.PI - 0.06, Math.max(0.06, this.goalPhi - dy * 0.0055));
    this.mode = 'ORBIT';
    this.onChange(this.mode);
  }

  public pan(dx: number, dy: number): void {
    const k = this.radius * 0.0019;
    const right = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 1);
    this.goalTarget.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    this.manualPan = true;
    if (this.onPan) this.onPan();
    this.mode = 'PAN';
    this.onChange(this.mode);
  }

  /**
   * Exponential zoom scaling proportionally to current distance.
   * Handles hysteresis boundary transitions between PLANET and OBJECT modes.
   */
  public zoom(delta: number): void {
    // Zoom step proportional to current distance so micro-inspection (0.2) feels
    // as responsive and controllable as planetary scale (200)
    const factor = Math.exp(delta * 0.0015);
    let nextRadius = this.goalRadius * factor;

    // Hysteresis Rule 1: Exiting OBJECT_CENTRIC -> PLANET_CENTRIC
    if (
      this._frameMode === 'OBJECT_CENTRIC' &&
      nextRadius > OrbitRig.OBJECT_RELEASE_BOUNDARY
    ) {
      this.resetToPlanetView();
      return;
    }

    // Clamp within active mode boundaries
    nextRadius = Math.min(this.maxR, Math.max(this.minR, nextRadius));
    this.goalRadius = nextRadius;
    this.mode = 'DOLLY';
    this.onChange(this.mode);
  }

  public toggleOrtho(): void {
    const cam = this.cam as THREE.PerspectiveCamera;
    if (!this.ortho) {
      const h = 2 * this.radius * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
      const aspect = (this.dom.clientWidth || 1) / (this.dom.clientHeight || 1);
      const o = new THREE.OrthographicCamera(
        (-h * aspect) / 2,
        (h * aspect) / 2,
        h / 2,
        -h / 2,
        0.05,
        6000
      );
      o.position.copy(cam.position);
      o.quaternion.copy(cam.quaternion);
      this.cam = o;
      this.ortho = true;
    } else {
      const pCam = this._persp;
      pCam.aspect = (this.dom.clientWidth || 1) / (this.dom.clientHeight || 1);
      pCam.updateProjectionMatrix();
      this.cam = pCam;
      this.ortho = false;
    }
    this.mode = this.ortho ? 'ORTHOGRAPHIC' : 'PERSPECTIVE';
    this.onChange(this.mode);
  }

  /**
   * Smoothly transitions back to Global Planet-Centric view.
   */
  public resetToPlanetView(): void {
    this._frameMode = 'PLANET_CENTRIC';
    this._trackedName = 'Earth Center';
    this._trackedKind = null;
    this._trackedIndex = null;
    this.manualPan = false;

    this.minR = OrbitRig.PLANET_MIN_DIST;
    this.maxR = OrbitRig.PLANET_MAX_DIST;

    // Initiate 0.8s smooth transit back to Earth Core (0, 0, 0)
    this._isTransitioning = true;
    this._transitElapsed = 0;
    this._transitDuration = 0.85;

    this._transitStartTarget.copy(this.target);
    this._transitEndTarget.set(0, 0, 0);

    this._transitStartRadius = this.radius;
    this._transitEndRadius = 165.0;

    this._transitStartTheta = this.theta;
    this._transitEndTheta = this.theta;

    this._transitStartPhi = this.phi;
    this._transitEndPhi = 1.12;

    this.mode = 'PLANET VIEW';
    this.onChange(this.mode);
    this._notifyMode();
  }

  public frameAll(): void {
    this.resetToPlanetView();
  }

  public reset(): void {
    this.resetToPlanetView();
  }

  /**
   * Backward-compatible legacy focusOn method.
   */
  public focusOn(point: THREE.Vector3, dist = 4.2, dir: THREE.Vector3 | null = null): void {
    this.focusOnObject(point, 'Tracked Object', 'sat', 0, dist, dir);
  }

  /**
   * Phase 1 Architectural Implementation:
   * Smooth 1.1s cubic-bezier spherical fly-to transitioning into OBJECT_CENTRIC inspection mode.
   * Computes a safe outward-and-ahead inspection offset so Earth never blocks view on arrival.
   */
  public focusOnObject(
    point: THREE.Vector3,
    name: string,
    kind: 'sat' | 'deb' = 'sat',
    index: number = 0,
    customDist: number = 4.2,
    dir: THREE.Vector3 | null = null
  ): void {
    this._frameMode = 'OBJECT_CENTRIC';
    this._trackedName = name;
    this._trackedKind = kind;
    this._trackedIndex = index;
    this.manualPan = false;

    // Set inspection zoom boundaries: micro close-up 0.18 units up to 45.0 corridor
    this.minR = OrbitRig.OBJECT_MIN_DIST;
    this.maxR = OrbitRig.OBJECT_MAX_DIST;

    const targetDist = Math.min(this.maxR, Math.max(this.minR, customDist));

    // Calculate safe outward inspection angles relative to object
    const rUp = point.clone().normalize();
    let goalDir = dir ? dir.clone().normalize() : rUp;

    // If no custom direction, look slightly outward and ahead
    if (!dir) {
      goalDir = rUp.clone().add(new THREE.Vector3(0.3, 0.4, 0.3)).normalize();
    }

    const goalPhi = Math.acos(THREE.MathUtils.clamp(goalDir.y, -1, 1));
    const goalTheta = Math.atan2(goalDir.z, goalDir.x);

    // Setup 1.1s transit
    this._isTransitioning = true;
    this._transitElapsed = 0;
    this._transitDuration = 1.1;

    this._transitStartTarget.copy(this.target);
    this._transitEndTarget.copy(point);

    this._transitStartRadius = this.radius;
    this._transitEndRadius = targetDist;

    this._transitStartTheta = this.theta;
    this._transitEndTheta = goalTheta;

    this._transitStartPhi = this.phi;
    this._transitEndPhi = goalPhi;

    this.goalTarget.copy(point);
    this.goalRadius = targetDist;
    this.goalTheta = goalTheta;
    this.goalPhi = goalPhi;

    this.mode = `INSPECT ${name.toUpperCase()}`;
    this.onChange(this.mode);
    this._notifyMode();
  }

  /**
   * Called every frame by main.ts with live position of tracked satellite/debris.
   * Preserves user's local spherical offset vector around the moving object without jitter.
   */
  public updateTrackedPosition(pos: THREE.Vector3): void {
    if (this._frameMode !== 'OBJECT_CENTRIC' || this.manualPan) return;

    if (!this._isTransitioning) {
      // Direct lock to moving object world position
      this.target.copy(pos);
      this.goalTarget.copy(pos);
    } else {
      // Update transit destination with live moving coordinate
      this._transitEndTarget.copy(pos);
    }
  }

  /**
   * Cubic Bezier Easing: Smooth deceleration into close-up inspection
   */
  private _easeCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * Main camera transform solver executed once per render frame.
   */
  public update(dt: number): boolean {
    const clampedDt = Math.min(Math.max(dt, 0.001), 0.1);

    if (this._isTransitioning) {
      this._transitElapsed += clampedDt;
      const progress = Math.min(1.0, this._transitElapsed / this._transitDuration);
      const ease = this._easeCubic(progress);

      this.target.lerpVectors(this._transitStartTarget, this._transitEndTarget, ease);
      this.radius = THREE.MathUtils.lerp(this._transitStartRadius, this._transitEndRadius, ease);
      this.theta = THREE.MathUtils.lerp(this._transitStartTheta, this._transitEndTheta, ease);
      this.phi = THREE.MathUtils.lerp(this._transitStartPhi, this._transitEndPhi, ease);

      this.goalTarget.copy(this.target);
      this.goalRadius = this.radius;
      this.goalTheta = this.theta;
      this.goalPhi = this.phi;

      if (progress >= 1.0) {
        this._isTransitioning = false;
        this._notifyMode();
      }
      this.isMoving = true;
    } else {
      // User damping & spring dynamics
      const k = 1 - Math.exp(-clampedDt * 10);
      const dR = Math.abs(this.goalRadius - this.radius);
      const dTh = Math.abs(this.goalTheta - this.theta);
      const dPh = Math.abs(this.goalPhi - this.phi);
      const dTg = this.target.distanceTo(this.goalTarget);

      this.isMoving = dR > 0.01 || dTh > 0.001 || dPh > 0.001 || dTg > 0.02;

      this.radius += (this.goalRadius - this.radius) * k;
      this.theta += (this.goalTheta - this.theta) * k;
      this.phi += (this.goalPhi - this.phi) * k;
      this.target.lerp(this.goalTarget, k);
    }

    // Compute spherical position relative to target
    const sp = new THREE.Vector3(
      Math.sin(this.phi) * Math.cos(this.theta),
      Math.cos(this.phi),
      Math.sin(this.phi) * Math.sin(this.theta)
    ).multiplyScalar(this.radius);

    this.cam.position.copy(this.target).add(sp);

    // Collision / Ground Guard Logic
    if (this._frameMode === 'PLANET_CENTRIC') {
      // Global View: Prevent camera from diving inside Earth + atmospheric shell
      const minAltitude = OrbitRig.R_EARTH + 1.8; // 65.51 units
      if (this.cam.position.length() < minAltitude) {
        this.cam.position.setLength(minAltitude);
      }
    } else {
      // Object Inspection View (LEO Orbit ~68.5 - 72.0 units):
      // Surface-Normal Guard allows micro close-up (0.18 units) around satellite
      // from any angle without camera ever clipping inside the Earth sphere!
      const minSurfaceAltitude = OrbitRig.R_EARTH + 0.8; // 64.51 units
      if (this.cam.position.length() < minSurfaceAltitude) {
        this.cam.position.setLength(minSurfaceAltitude);
      }
    }

    this.cam.lookAt(this.target);

    // Orthographic projection updates
    if ((this.cam as THREE.OrthographicCamera).isOrthographicCamera) {
      const oCam = this.cam as THREE.OrthographicCamera;
      const h = this.radius * Math.tan(THREE.MathUtils.degToRad(this._persp.fov) / 2);
      const aspect = (this.dom.clientWidth || 1) / (this.dom.clientHeight || 1);
      oCam.left = (-h * aspect) / 2;
      oCam.right = (h * aspect) / 2;
      oCam.top = h / 2;
      oCam.bottom = -h / 2;
      oCam.updateProjectionMatrix();
    }

    return this.isMoving;
  }

  public dispose(): void {
    this._abortController.abort();
  }
}

export { OrbitRig as CameraController };
