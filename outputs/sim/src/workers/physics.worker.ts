import { findApproach } from '../physics/findApproach';
import { planManeuver } from '../physics/maneuver';
import { deriveEncounter } from '../physics/deriveEncounter';
import { makeBody } from '../physics/sgp4';

export interface WorkerRequest {
  id: number;
  type: 'FIND_APPROACH' | 'PLAN_MANEUVER' | 'DERIVE_ENCOUNTER';
  payload: any;
}

export interface WorkerResponse {
  id: number;
  type: string;
  result?: any;
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = e.data;
  try {
    let result: any = null;

    if (type === 'FIND_APPROACH') {
      const satBody = makeBody(payload.satTle, payload.satKind);
      const debBody = makeBody(payload.debTle, payload.debKind);
      result = findApproach(satBody, debBody, payload.t0, payload.horizonHours);
    } else if (type === 'PLAN_MANEUVER') {
      const satBody = makeBody(payload.satTle, payload.satKind);
      const debBody = makeBody(payload.debTle, payload.debKind);
      result = planManeuver(satBody, debBody, payload.ev, payload.nowMs, payload.fuelMps);
    } else if (type === 'DERIVE_ENCOUNTER') {
      const satBody = makeBody(payload.satTle, payload.satKind);
      const debBody = makeBody(payload.debTle, payload.debKind);
      result = deriveEncounter(satBody, debBody, payload.t0, payload.targetHours, payload.missKm);
    }

    self.postMessage({ id, type, result } as WorkerResponse);
  } catch (err: any) {
    self.postMessage({ id, type, error: err?.message || String(err) } as WorkerResponse);
  }
};
