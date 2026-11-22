/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CELESTRAK_API_URL: string;
  readonly VITE_LIVE_TLE_ENDPOINT: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_SIM_MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'satellite.js' {
  export interface SatRec {
    inclo: number;
    ecco: number;
    no?: number;
    no_kozai?: number;
    [key: string]: any;
  }
  export function twoline2satrec(longstr1: string, longstr2: string): SatRec;
  export function propagate(satrec: SatRec, date: Date): {
    position: { x: number; y: number; z: number } | boolean;
    velocity: { x: number; y: number; z: number } | boolean;
  };
  export function gstime(date: Date): number;
}
