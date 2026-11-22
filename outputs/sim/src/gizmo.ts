import * as THREE from 'three';
import type { OrbitRig } from './controls';

export interface GizmoOptions {
  container: HTMLElement;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  rig: OrbitRig;
}

interface AxisDef {
  id: string;
  label: string;
  color: string;
  invColor: string;
  vec: THREE.Vector3;
  preset: 'FRONT' | 'BACK' | 'RIGHT' | 'LEFT' | 'TOP' | 'BOTTOM';
  pole?: boolean;
}

export class NavGizmo {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private rig: OrbitRig;
  private size: number = 84;
  private radius: number = 28;

  private axes: AxisDef[] = [
    { id: '+X', label: 'X', color: '#ff4f4d', invColor: '#fff', vec: new THREE.Vector3(1, 0, 0), preset: 'RIGHT' },
    { id: '-X', label: '−X', color: '#7a2e2e', invColor: '#ff9999', vec: new THREE.Vector3(-1, 0, 0), preset: 'LEFT', pole: true },
    { id: '+Y', label: 'Y', color: '#63e6a8', invColor: '#0a0c0f', vec: new THREE.Vector3(0, 1, 0), preset: 'TOP' },
    { id: '-Y', label: '−Y', color: '#2d6a50', invColor: '#a0f0cb', vec: new THREE.Vector3(0, -1, 0), preset: 'BOTTOM', pole: true },
    { id: '+Z', label: 'Z', color: '#6fa8ff', invColor: '#fff', vec: new THREE.Vector3(0, 0, 1), preset: 'BACK' },
    { id: '-Z', label: '−Z', color: '#385582', invColor: '#a8ccff', vec: new THREE.Vector3(0, 0, -1), preset: 'FRONT', pole: true },
  ];

  private projected: Array<AxisDef & { px: number; py: number; depth: number }> = [];
  private hoveredAxis: string | null = null;
  private isDragging: boolean = false;
  private lastX: number = 0;
  private lastY: number = 0;
  private dpr: number = 1;

  constructor(options: GizmoOptions) {
    this.container = options.container;
    this.camera = options.camera;
    this.rig = options.rig;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gizmo-canvas';
    this.canvas.width = this.size * this.dpr;
    this.canvas.height = this.size * this.dpr;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'toolbar');
    this.canvas.setAttribute('aria-label', '3D Orientation Gizmo. Click axes or drag to orbit.');

    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(this.dpr, this.dpr);

    this.container.appendChild(this.canvas);

    this._bindEvents();
    this.update();
  }

  public setCamera(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    this.camera = cam;
  }

  private _bindEvents(): void {
    const c = this.canvas;

    c.addEventListener('contextmenu', e => e.preventDefault());

    c.addEventListener('pointerdown', (e: PointerEvent) => {
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      this.lastX = e.clientX;
      this.lastY = e.clientY;

      const hit = this._hitTest(e.clientX, e.clientY);
      if (hit) {
        this.rig.setViewPreset(hit.preset);
        this.update();
        return;
      }

      this.isDragging = true;
    });

    c.addEventListener('pointermove', (e: PointerEvent) => {
      const hit = this._hitTest(e.clientX, e.clientY);
      const newHover = hit ? hit.id : null;
      if (newHover !== this.hoveredAxis) {
        this.hoveredAxis = newHover;
        c.style.cursor = hit ? 'pointer' : 'grab';
        this.update();
      }

      if (this.isDragging) {
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.rig.orbit(dx, dy);
        this.update();
      }
    });

    const endDrag = (e: PointerEvent) => {
      if (this.isDragging) {
        this.isDragging = false;
        try {
          c.releasePointerCapture(e.pointerId);
        } catch (_err) {
          void _err;
        }
      }
    };

    c.addEventListener('pointerup', endDrag);
    c.addEventListener('pointercancel', endDrag);

    c.addEventListener('mouseleave', () => {
      if (this.hoveredAxis) {
        this.hoveredAxis = null;
        this.update();
      }
    });

    c.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.rig.frameAll();
        this.update();
      }
    });
  }

  private _hitTest(clientX: number, clientY: number): AxisDef | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Check in reverse order (top-most rendered first)
    for (let i = this.projected.length - 1; i >= 0; i--) {
      const item = this.projected[i];
      const d = Math.hypot(item.px - x, item.py - y);
      const hitR = item.pole ? 9 : 12;
      if (d <= hitR) return item;
    }
    return null;
  }

  public update(): void {
    const cx = this.size / 2;
    const cy = this.size / 2;
    const invQ = this.camera.quaternion.clone().invert();

    this.projected = this.axes.map(ax => {
      const d = ax.vec.clone().applyQuaternion(invQ);
      return {
        ...ax,
        px: cx + d.x * this.radius,
        py: cy - d.y * this.radius,
        depth: d.z,
      };
    });

    // Sort by depth ascending so farthest is drawn first
    this.projected.sort((a, b) => a.depth - b.depth);

    this.render();
  }

  public render(): void {
    const ctx = this.ctx;
    const cx = this.size / 2;
    const cy = this.size / 2;

    ctx.clearRect(0, 0, this.size, this.size);

    // Subtle background circle ring
    ctx.beginPath();
    ctx.arc(cx, cy, this.radius + 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 12, 15, 0.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(237, 234, 228, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    for (const item of this.projected) {
      const isHover = this.hoveredAxis === item.id;

      if (!item.pole) {
        // Line from center to axis bubble
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(item.px, item.py);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = isHover ? 2.5 : 1.75;
        ctx.stroke();

        // Node bubble
        const bubbleR = isHover ? 11 : 9.5;
        ctx.beginPath();
        ctx.arc(item.px, item.py, bubbleR, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Axis label letter
        ctx.font = '600 9px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = item.invColor;
        ctx.fillText(item.label, item.px, item.py + 0.5);
      } else {
        // Negative pole: subtle dot/ring
        const poleR = isHover ? 6.5 : 4.5;
        ctx.beginPath();
        ctx.arc(item.px, item.py, poleR, 0, Math.PI * 2);
        ctx.fillStyle = isHover ? item.color : 'rgba(20, 24, 30, 0.7)';
        ctx.fill();
        ctx.strokeStyle = item.color;
        ctx.lineWidth = isHover ? 1.5 : 1;
        ctx.stroke();
      }
    }
  }
}
