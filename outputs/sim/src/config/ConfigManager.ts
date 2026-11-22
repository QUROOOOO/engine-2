import defaultConfig from './config.json';

export interface SimulationConfig {
  safeMissKm: number;
  pcCritical: number;
  pcWarn: number;
  defaultFuelMs: number;
  windowMinutes: number;
  maxDebris: number;
  exaggerationFactor: number;
}

export interface CameraConfig {
  planetMinDist?: number;
  planetMaxDist?: number;
  objectMinDist?: number;
  objectMaxDist?: number;
  objectReleaseBoundary?: number;
  defaultFocusDist?: number;
  dampingFactor?: number;
  rotateSpeed?: number;
  zoomSpeed?: number;
  minRadius: number;
  maxRadius: number;
  focusDist: number;
  fov: number;
}

export interface VisualConfig {
  kmPerUnit: number;
  starCount: number;
  atmosphereGlow: boolean;
}

export interface UIConfig {
  theme: string;
  reducedMotion: string;
  refreshRateHz: number;
}

export interface AppConfig {
  simulation: SimulationConfig;
  camera: CameraConfig;
  visual: VisualConfig;
  ui: UIConfig;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export class ConfigManager {
  private static instance: ConfigManager;
  private config: AppConfig;
  private listeners: Map<string, Set<(val: any) => void>> = new Map();

  private constructor() {
    this.config = JSON.parse(JSON.stringify(defaultConfig));
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public get(): AppConfig {
    return this.config;
  }

  public update(partial: DeepPartial<AppConfig>): void {
    const deepMerge = (target: any, source: any) => {
      for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!target[key]) target[key] = {};
          deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
          this.notify(key, source[key]);
        }
      }
    };
    deepMerge(this.config, partial);
    this.notify('*', this.config);
  }

  public subscribe(key: string, callback: (val: any) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);
    return () => {
      this.listeners.get(key)?.delete(callback);
    };
  }

  private notify(key: string, value: any): void {
    this.listeners.get(key)?.forEach(cb => {
      try {
        cb(value);
      } catch (err) {
        console.error(`Error in config listener for key "${key}":`, err);
      }
    });
  }
}
