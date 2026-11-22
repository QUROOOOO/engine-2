import { EpochMs } from '../types/units';
import { ConjunctionApproach, ManeuverPlan } from '../types/orbital';

export interface SerializedSimState {
  version: string;
  simMs: EpochMs;
  rate: number;
  isPaused: boolean;
  selectedNorad: number | null;
  activeThreat: ConjunctionApproach | null;
  activePlan: ManeuverPlan | null;
  fuelBudgetMs: number;
  timestamp: string;
}

export class SimulationState {
  private static instance: SimulationState;

  public version = '1.0.0';
  public simMs: EpochMs = 0 as EpochMs;
  public rate = 60;
  public isPaused = false;
  public selectedNorad: number | null = null;
  public activeThreat: ConjunctionApproach | null = null;
  public activePlan: ManeuverPlan | null = null;
  public fuelBudgetMs = 15.0;

  private constructor() {}

  public static getInstance(): SimulationState {
    if (!SimulationState.instance) {
      SimulationState.instance = new SimulationState();
    }
    return SimulationState.instance;
  }

  public toJSON(): string {
    const data: SerializedSimState = {
      version: this.version,
      simMs: this.simMs,
      rate: this.rate,
      isPaused: this.isPaused,
      selectedNorad: this.selectedNorad,
      activeThreat: this.activeThreat,
      activePlan: this.activePlan,
      fuelBudgetMs: this.fuelBudgetMs,
      timestamp: new Date().toISOString(),
    };
    return JSON.stringify(data, null, 2);
  }

  public fromJSON(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString) as SerializedSimState;
      if (typeof data.simMs === 'number') this.simMs = data.simMs;
      if (typeof data.rate === 'number') this.rate = data.rate;
      if (typeof data.isPaused === 'boolean') this.isPaused = data.isPaused;
      if (data.selectedNorad !== undefined) this.selectedNorad = data.selectedNorad;
      if (data.activeThreat !== undefined) this.activeThreat = data.activeThreat;
      if (data.activePlan !== undefined) this.activePlan = data.activePlan;
      if (typeof data.fuelBudgetMs === 'number') this.fuelBudgetMs = data.fuelBudgetMs;
      return true;
    } catch (err) {
      console.error('[SimulationState] Failed to deserialize state:', err);
      return false;
    }
  }

  public reset(): void {
    this.simMs = 0 as EpochMs;
    this.rate = 60;
    this.isPaused = false;
    this.selectedNorad = null;
    this.activeThreat = null;
    this.activePlan = null;
    this.fuelBudgetMs = 15.0;
  }
}
