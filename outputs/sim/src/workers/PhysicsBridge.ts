import { findApproach } from '../physics/findApproach';
import { planManeuver } from '../physics/maneuver';
import { deriveEncounter } from '../physics/deriveEncounter';
import type { SpaceBody } from '../types/orbital';

export class PhysicsBridge {
  private worker: Worker | null = null;
  private reqId: number = 0;
  private pending: Map<number, { resolve: (val: any) => void; reject: (err: any) => void }> = new Map();

  constructor() {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./physics.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent) => {
          const { id, result, error } = e.data;
          const p = this.pending.get(id);
          if (p) {
            this.pending.delete(id);
            if (error) p.reject(new Error(error));
            else p.resolve(result);
          }
        };
        this.worker.onerror = err => {
          console.warn('Physics worker error, falling back to main thread:', err);
          this.worker = null;
        };
      } catch (e) {
        console.warn('Worker creation failed, using main thread fallback:', e);
        this.worker = null;
      }
    }
  }

  public async findApproach(
    satB: SpaceBody,
    debB: SpaceBody,
    t0: number,
    horizonHours = 12
  ): Promise<any> {
    if (this.worker) {
      return this._send('FIND_APPROACH', {
        satTle: { name: satB.name, norad: satB.norad, l1: satB.l1, l2: satB.l2 },
        satKind: satB.kind,
        debTle: { name: debB.name, norad: debB.norad, l1: debB.l1, l2: debB.l2 },
        debKind: debB.kind,
        t0,
        horizonHours,
      });
    }
    return findApproach(satB, debB, t0, horizonHours);
  }

  public async planManeuver(
    satB: SpaceBody,
    debB: SpaceBody,
    ev: any,
    nowMs: number,
    fuelMps: number
  ): Promise<any> {
    if (this.worker) {
      return this._send('PLAN_MANEUVER', {
        satTle: { name: satB.name, norad: satB.norad, l1: satB.l1, l2: satB.l2 },
        satKind: satB.kind,
        debTle: { name: debB.name, norad: debB.norad, l1: debB.l1, l2: debB.l2 },
        debKind: debB.kind,
        ev,
        nowMs,
        fuelMps,
      });
    }
    return planManeuver(satB, debB, ev, nowMs, fuelMps);
  }

  public async deriveEncounter(
    satB: SpaceBody,
    debB: SpaceBody,
    t0: number,
    targetHours = 0.22,
    missKm = 0.08
  ): Promise<any> {
    if (this.worker) {
      return this._send('DERIVE_ENCOUNTER', {
        satTle: { name: satB.name, norad: satB.norad, l1: satB.l1, l2: satB.l2 },
        satKind: satB.kind,
        debTle: { name: debB.name, norad: debB.norad, l1: debB.l1, l2: debB.l2 },
        debKind: debB.kind,
        t0,
        targetHours,
        missKm,
      });
    }
    return deriveEncounter(satB, debB, t0, targetHours, missKm);
  }

  private _send(type: string, payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.reqId;
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, type, payload });
    });
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pending.clear();
  }
}
