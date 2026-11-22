import type { SpaceBody, RTNCoords } from './types/orbital';
import { fmt, fmtMiss, fmtRelSpeed, escapeHtml } from './ui/formatters';
import type { RiskLevel } from './ui/riskClassifier';
import { filterObjects, type CatalogRowItem } from './ui/filters';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
export { fmt };

export interface UIHandlers {
  select?: (kind: 'sat' | 'deb', index: number) => void;
  step?: (what: string, dir: number) => void;
  rate?: (rate: number) => void;
  pause?: () => void;
  execute?: () => void;
  scrub?: (fraction: number) => void;
  theme?: () => void;
  toggleAutoFollow?: (enabled: boolean) => void;
  toggleAutoDodge?: (enabled: boolean) => void;
  testCrash?: () => void;
  cinema?: () => void;
  returnToEarth?: () => void;
}

export class UI {
  private h: UIHandlers;
  private objList: HTMLElement;
  private search: HTMLInputElement;
  private filter: string = '';
  private items: CatalogRowItem[] = [];
  private sel: { kind: 'sat' | 'deb'; index: number } | null = null;
  private sats: SpaceBody[] = [];
  private debris: SpaceBody[] = [];
  private satN: number = 5;
  private debN: number = 200;
  private threatIndex?: number;
  private bp!: HTMLCanvasElement;
  private bctx!: CanvasRenderingContext2D;
  private bpSize: number = 220;
  private _tt?: ReturnType<typeof setTimeout>;

  constructor(h: UIHandlers) {
    this.h = h;
    this.objList = $('objList');
    this.search = $('search') as HTMLInputElement;
    this._bplane();

    this.search.addEventListener('input', () => {
      this.filter = this.search.value;
      this.renderList();
    });

    this.objList.addEventListener('click', e => {
      const row = (e.target as HTMLElement).closest('.obj') as HTMLElement | null;
      if (row) {
        this.h.select?.(row.dataset.kind as 'sat' | 'deb', +(row.dataset.index || 0));
      }
    });

    document.querySelectorAll('[data-step]').forEach(b =>
      b.addEventListener('click', () => {
        const el = b as HTMLElement;
        this.h.step?.(el.dataset.step!, +(el.dataset.dir || 0));
      })
    );

    document.querySelectorAll('#rates button').forEach(b =>
      b.addEventListener('click', () => {
        document.querySelectorAll('#rates button').forEach(x => x.classList.toggle('on', x === b));
        const el = b as HTMLElement;
        this.h.rate?.(+(el.dataset.rate || 1));
      })
    );

    $('pauseBtn')?.addEventListener('click', () => this.h.pause?.());
    $('executeBtn')?.addEventListener('click', () => this.h.execute?.());
    $('helpBtn')?.addEventListener('click', () => this.toggleHelp(true));
    $('helpClose')?.addEventListener('click', () => this.toggleHelp(false));
    $('help')?.addEventListener('click', e => {
      if ((e.target as HTMLElement).id === 'help') this.toggleHelp(false);
    });
    $('themeBtn')?.addEventListener('click', () => this.h.theme?.());

    $('timeline')?.addEventListener('click', (e: MouseEvent) => {
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const fill = $('timelineFill');
      if (fill) fill.style.width = (frac * 100).toFixed(2) + '%';
      this.h.scrub?.(frac);
    });

    const autoFollowEl = $('autoFollowToggle') as HTMLInputElement | null;
    autoFollowEl?.addEventListener('change', () => {
      this.h.toggleAutoFollow?.(autoFollowEl.checked);
    });

    const autoDodgeEl = $('autoDodgeToggle') as HTMLInputElement | null;
    autoDodgeEl?.addEventListener('change', () => {
      const enabled = autoDodgeEl.checked;
      this.setAutoDodgeState(enabled);
      this.h.toggleAutoDodge?.(enabled);
    });

    $('testCrashBtn')?.addEventListener('click', () => {
      this.h.testCrash?.();
    });

    $('cinemaBtn')?.addEventListener('click', () => {
      this.toggleCinema();
      this.h.cinema?.();
    });

    $('exitCinemaBtn')?.addEventListener('click', () => {
      this.toggleCinema(false);
      this.h.cinema?.();
    });

    $('returnEarthBtn')?.addEventListener('click', () => {
      this.h.returnToEarth?.();
    });

    addEventListener('keydown', e => {
      const target = e.target as HTMLElement;
      if (e.key === '?' && !target.matches('input,textarea')) this.toggleHelp();
      if ((e.key === 'z' || e.key === 'Z') && !target.matches('input,textarea')) {
        this.toggleCinema();
        this.h.cinema?.();
      }
      if (e.code === 'Space' && !target.matches('input,textarea')) {
        e.preventDefault();
        this.h.pause?.();
      }
    });
  }

  public setAutoDodgeState(enabled: boolean): void {
    const autoDodgeEl = $('autoDodgeToggle') as HTMLInputElement | null;
    const autoDodgeLabel = $('autoDodgeLabel');
    const planState = $('planState');
    const planExplanation = $('planExplanation');
    if (autoDodgeEl) autoDodgeEl.checked = enabled;
    if (autoDodgeLabel) {
      autoDodgeLabel.textContent = enabled ? 'ON' : 'OFF';
      autoDodgeLabel.classList.toggle('off', !enabled);
    }
    if (planState) {
      planState.textContent = enabled ? 'STANDBY' : 'OFFLINE';
      planState.style.borderColor = enabled ? 'var(--line-2)' : '#ef4444';
    }
    if (planExplanation) {
      planExplanation.textContent = enabled
        ? 'Continuous autonomous monitoring active. When debris crosses the 5.0 km keep-out threshold, Engine 2 calculates an optimal avoidance trajectory.'
        : 'Autonomous collision avoidance is OFFLINE. Thruster burns are withheld for kinetic impact simulation.';
    }
  }

  public setCatalog(
    sats: SpaceBody[],
    debris: SpaceBody[],
    riskOfDebris: RiskLevel[]
  ): void {
    this.sats = sats;
    this.debris = debris;
    this.items = [
      ...sats.map((b, i) => ({
        kind: 'sat' as const,
        index: i,
        name: b.name,
        norad: b.norad,
        risk: 'safe' as const,
        lifecycle: b.lifecycle,
      })),
      ...debris.map((b, i) => ({
        kind: 'deb' as const,
        index: i,
        name: b.name,
        norad: b.norad,
        risk: riskOfDebris[i] || 'safe',
        lifecycle: b.lifecycle,
      })),
    ];
    this.renderList();
  }

  public renderList(): void {
    const rows = filterObjects(
      this.items,
      this.filter,
      this.satN,
      this.debN,
      this.threatIndex,
      180
    );

    this.objList.innerHTML =
      rows
        .map(
          o => {
            const isDestroyed = o.lifecycle === 'REMOVED' || o.lifecycle === 'DISSOLVING';
            const pillText = isDestroyed ? 'DESTROYED' : o.kind === 'sat' ? 'PROTECTED' : o.risk === 'crit' ? 'DANGER' : 'SAFE';
            const pillClass = isDestroyed ? 'danger' : o.kind === 'sat' ? 'protected' : o.risk === 'crit' ? 'danger' : 'safe';
            return `
      <div class="obj${this.sel && this.sel.kind === o.kind && this.sel.index === o.index ? ' sel' : ''}${isDestroyed ? ' destroyed' : ''}"
           role="option" data-kind="${o.kind}" data-index="${o.index}" data-risk="${o.risk}">
        <i class="dot"></i>
        <div class="nm">${escapeHtml(o.name)}</div>
        <span class="pill ${pillClass}">
          ${pillText}
        </span>
      </div>`;
          }
        )
        .join('') || `<p class="fine" style="padding:10px;">No objects match.</p>`;

    const countEl = $('activeObjCount');
    if (countEl) {
      countEl.textContent = String(Math.min(this.satN, this.sats.length) + Math.min(this.debN, this.debris.length));
    }
  }

  public setCounts(satN: number, debN: number): void {
    this.satN = satN;
    this.debN = debN;
    const satEl = $('satCount');
    if (satEl) {
      const activeSats = this.sats.slice(0, satN).filter(s => s.lifecycle !== 'REMOVED').length;
      satEl.textContent = String(activeSats);
    }
    const debEl = $('debrisCount');
    if (debEl) debEl.textContent = String(debN);
    this.renderList();
  }

  public setSelection(o: { kind: 'sat' | 'deb'; index: number } | null): void {
    this.sel = o;
    if (o) {
      const b = o.kind === 'sat' ? this.sats[o.index] : this.debris[o.index];
      const selNameEl = $('selName');
      if (selNameEl) selNameEl.textContent = b ? b.name : '—';
    }
    this.renderList();
  }

  public setLivePill(text: string, state: 'nominal' | 'alert' | 'safe'): void {
    const pill = $('livePill');
    const pillText = $('livePillText');
    if (!pill || !pillText) return;

    pillText.textContent = text;
    pill.classList.remove('alert', 'safe-achieved');
    if (state === 'alert') {
      pill.classList.add('alert');
    } else if (state === 'safe') {
      pill.classList.add('safe-achieved');
    }
  }

  public setClock({
    met,
    tcaMin = 15,
    windowMin = 15,
  }: {
    utc?: string;
    met: string;
    tcaMin?: number;
    burnMin?: number;
    windowMin?: number;
  }): void {
    const metEl = $('met');
    if (metEl) metEl.textContent = met;

    const fill = $('timelineFill');
    if (fill) {
      const frac = windowMin > 0 ? Math.min(1, Math.max(0, (windowMin - tcaMin) / windowMin)) : 0;
      fill.style.width = (frac * 100).toFixed(2) + '%';
    }
  }

  public setThreat(t: {
    debIndex?: number;
    risk: RiskLevel;
    sat: string;
    deb: string;
    miss: number;
    relSpeed: number;
    pcText?: string;
    tcaMin?: number;
    rt?: RTNCoords;
  }): void {
    if (t.debIndex != null) {
      const changed = this.threatIndex !== t.debIndex;
      this.threatIndex = t.debIndex;
      const it = this.items.find(o => o.kind === 'deb' && o.index === t.debIndex);
      if (it) it.risk = t.risk;
      if (changed) this.renderList();
    }

    const badge = $('riskChip');
    const summary = $('encounterSummary');
    const threatSatEl = $('threatSat');
    const threatDebEl = $('threatDeb');
    const threatMissEl = $('threatMiss');
    const threatVelEl = $('threatVel');

    const isDanger = t.risk === 'crit' || t.miss < 5.0;

    if (badge) {
      badge.textContent = isDanger ? '⚠️ COLLISION RISK DETECTED' : 'ALL SATELLITES SAFE';
      badge.className = isDanger ? 'status-badge danger' : 'status-badge safe';
    }

    if (threatSatEl) threatSatEl.textContent = t.sat;
    if (threatDebEl) threatDebEl.textContent = t.deb;
    if (threatMissEl) threatMissEl.textContent = fmtMiss(t.miss);
    if (threatVelEl) threatVelEl.textContent = fmtRelSpeed(t.relSpeed);

    if (summary) {
      if (isDanger) {
        summary.innerHTML = `<b>${t.sat}</b> is on a close pass with <b>${t.deb}</b>. Without a maneuver, they will pass within <b>${fmtMiss(t.miss)}</b> (unsafe — minimum safe buffer is <b>5.0 km</b>).`;
      } else {
        summary.textContent = `All protected satellites are currently operating outside keep-out corridors. Monitoring ${this.debN} debris fragments in Low Earth Orbit.`;
      }
    }

    this.drawRadar(t.rt, isDanger ? t.miss : null);
  }

  private _bplane(): void {
    this.bp = $('bplane') as HTMLCanvasElement;
    if (!this.bp) return;
    this.bctx = this.bp.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.bp.width = 220 * dpr;
    this.bp.height = 220 * dpr;
    this.bctx.scale(dpr, dpr);
    this.bpSize = 220;
    this.drawRadar();
  }

  /**
   * Clean, simplified Visual Target Radar showing 5 km safe zone ring and relative threat position.
   */
  public drawRadar(rt?: RTNCoords, missKm?: number | null, postMissKm?: number | null): void {
    if (!this.bctx) return;
    const c = this.bctx;
    const S = this.bpSize;
    const cx = S / 2;
    const cy = S / 2;
    const kmScale = 14; // pixels per km

    c.clearRect(0, 0, S, S);

    // Subtle background circular rings (2.5 km, 5 km, 7.5 km)
    c.strokeStyle = 'rgba(140, 145, 152, 0.12)';
    c.lineWidth = 1;

    // 2.5 km inner ring
    c.beginPath();
    c.arc(cx, cy, 2.5 * kmScale, 0, Math.PI * 2);
    c.stroke();

    // Crosshairs
    c.beginPath();
    c.moveTo(cx, 10);
    c.lineTo(cx, S - 10);
    c.moveTo(10, cy);
    c.lineTo(S - 10, cy);
    c.stroke();

    // 5.0 km Keep-Out Zone Ring (Highlighted Safe Buffer)
    c.beginPath();
    c.arc(cx, cy, 5.0 * kmScale, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(239, 68, 68, 0.45)';
    c.lineWidth = 1.5;
    c.setLineDash([4, 4]);
    c.stroke();
    c.setLineDash([]);

    // 5km label inside circle
    c.font = '500 8.5px "IBM Plex Mono", monospace';
    c.fillStyle = 'rgba(239, 68, 68, 0.7)';
    c.textAlign = 'center';
    c.fillText('5 km buffer', cx, cy - 5.0 * kmScale - 4);

    // Satellite center marker (protected asset at origin)
    c.fillStyle = '#ff4f00';
    c.beginPath();
    c.arc(cx, cy, 4, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1;
    c.stroke();

    if (rt && missKm != null) {
      // Relative threat position
      const tx = Math.max(-cx + 12, Math.min(cx - 12, (rt.t || 0.4) * kmScale));
      const ty = Math.max(-cy + 12, Math.min(cy - 12, -(rt.n || 0.2) * kmScale));

      // Draw un-maneuvered threat point (Red dot inside danger zone)
      c.fillStyle = '#ef4444';
      c.beginPath();
      c.arc(cx + tx, cy + ty, 5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      c.lineWidth = 1.2;
      c.stroke();

      // Avoidance vector and target point (Green dot shifted outside 5 km)
      const safeTargetMiss = postMissKm || 7.8;
      const angle = Math.atan2(ty, tx) + (Math.abs(ty) < 2 ? Math.PI / 2 : 0);
      const safeX = Math.cos(angle) * (safeTargetMiss * kmScale);
      const safeY = Math.sin(angle) * (safeTargetMiss * kmScale);

      // Avoidance displacement arrow
      c.strokeStyle = '#22c55e';
      c.lineWidth = 1.5;
      c.setLineDash([3, 2]);
      c.beginPath();
      c.moveTo(cx + tx, cy + ty);
      c.lineTo(cx + safeX, cy + safeY);
      c.stroke();
      c.setLineDash([]);

      // Green safe clearance point
      c.fillStyle = '#22c55e';
      c.beginPath();
      c.arc(cx + safeX, cy + safeY, 5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.2;
      c.stroke();
    }
  }

  public setPlan(plan: any, _fuelLeft?: number, _state?: string): void {
    const btn = $('executeBtn') as HTMLButtonElement;
    if (btn) btn.disabled = !plan;

    const titleEl = $('planActionTitle');
    const explEl = $('planExplanation');
    const shiftEl = $('dodgeShift');
    const burnEl = $('dodgeBurn');
    const planStateEl = $('planState');
    const planFuelEl = $('planFuel');

    if (planFuelEl && _fuelLeft != null) {
      planFuelEl.textContent = `${_fuelLeft.toFixed(1)} m/s`;
    }

    if (!plan) {
      if (planStateEl) planStateEl.textContent = 'STANDBY';
      if (titleEl) titleEl.textContent = 'STANDBY';
      if (explEl) {
        explEl.textContent = 'Continuous autonomous monitoring active. When debris crosses the 5.0 km keep-out threshold, Engine 2 calculates an optimal avoidance trajectory.';
      }
      if (shiftEl) shiftEl.textContent = 'Safe Clearance ✓';
      if (burnEl) burnEl.textContent = '0.00 m/s';
      return;
    }

    if (planStateEl) planStateEl.textContent = plan.safe ? 'FEASIBLE' : 'EVALUATING';

    // Determine plain-English action title and explanation
    let actionTitle = 'Step Sideways (+N)';
    let explanation = 'Fires a small perpendicular thruster so the satellite shifts lanes and safely bypasses the debris.';

    if (plan.axisKey === 'ALONG-TRACK' || plan.axis.includes('+T')) {
      actionTitle = 'Speed Up (+T)';
      explanation = 'Fires an in-track forward pulse so the satellite arrives slightly ahead, creating wide clearance.';
    } else if (plan.axisKey === 'RADIAL' || plan.axis.includes('+R')) {
      actionTitle = 'Slight Rise (+R)';
      explanation = 'Fires a brief radial thruster to adjust orbital altitude away from the debris plane.';
    }

    if (titleEl) titleEl.textContent = actionTitle;
    if (explEl) explanation += ` Calibrated burn consumes ${(plan.dv).toFixed(2)} m/s of available budget.`;
    if (explEl) explEl.textContent = explanation;

    // Realistic fuel burn: plan.dv is already in m/s!
    const dvMps = Math.min(4.5, Math.max(0.2, plan.dv || 1.85));
    if (burnEl) burnEl.textContent = `${dvMps.toFixed(2)} m/s`;

    const postDist = plan.postMiss ? Number(plan.postMiss).toFixed(2) : '7.80';
    if (shiftEl) shiftEl.textContent = `Shift to ${postDist} km Safe ✓`;
  }

  public setRate(r: number): void {
    document.querySelectorAll('#rates button').forEach(b => {
      const el = b as HTMLElement;
      b.classList.toggle('on', +el.dataset.rate! === r);
    });
  }

  public setPaused(p: boolean): void {
    const btn = $('pauseBtn');
    if (btn) btn.textContent = p ? 'RESUME' : 'PAUSE';
  }

  public setSource(ageDays: number, live: boolean): void {
    const tag = $('sourceTag');
    if (tag) tag.textContent = live ? 'CelesTrak · LIVE' : `CelesTrak · +${fmt(ageDays, 0)}d`;
  }

  public toast(msg: string): void {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('on'), 2600);
  }

  public setLoading(v: boolean): void {
    $('loading')?.classList.toggle('hide', !v);
  }

  public toggleHelp(force?: boolean): void {
    const el = $('help');
    if (!el) return;
    const show = force === undefined ? el.hidden : force;
    el.hidden = !show;
  }

  public setTheme(light: boolean): void {
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    const btn = $('themeBtn');
    if (btn) btn.textContent = light ? 'DARK' : 'LIGHT';
  }

  public toggleCinema(force?: boolean): boolean {
    const isCinema = document.body.getAttribute('data-cinema') === 'true';
    const next = force !== undefined ? force : !isCinema;
    if (next) {
      document.body.setAttribute('data-cinema', 'true');
    } else {
      document.body.removeAttribute('data-cinema');
    }
    const btn = $('cinemaBtn');
    if (btn) btn.textContent = next ? 'EXIT ZEN' : 'CINEMA';
    return next;
  }

  public setCameraTelemetry(telemetry: {
    frameMode: 'PLANET_CENTRIC' | 'OBJECT_CENTRIC';
    targetName: string;
    distance: number;
    isTransitioning: boolean;
  }): void {
    const tag = $('camModeTag');
    const target = $('camModeTarget');
    const returnBtn = $('returnEarthBtn');

    if (telemetry.frameMode === 'OBJECT_CENTRIC') {
      if (tag) tag.textContent = 'INSPECT VIEW';
      if (target) {
        const dStr = telemetry.distance < 1.0
          ? `${(telemetry.distance * 100).toFixed(1)} km`
          : `${(telemetry.distance * 100).toFixed(0)} km`;
        target.textContent = `${telemetry.targetName} (${dStr})`;
      }
      if (returnBtn) returnBtn.style.display = 'inline-block';
    } else {
      if (tag) tag.textContent = 'PLANET VIEW';
      if (target) target.textContent = 'Earth Center';
      if (returnBtn) returnBtn.style.display = 'none';
    }
  }
}
