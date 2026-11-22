/**
 * Branded nominal unit types for compile-time physics safety.
 * Prevents accidental addition or mixing of km, meters, scene units, and time units.
 */

declare const BrandSymbol: unique symbol;
export type Brand<T, B extends string> = T & { readonly [BrandSymbol]: B };

// Distance
export type Km = Brand<number, 'Km'>;
export type Meters = Brand<number, 'Meters'>;
export type SceneUnits = Brand<number, 'SceneUnits'>;

// Velocity
export type KmPerSecond = Brand<number, 'KmPerSecond'>;
export type MetersPerSecond = Brand<number, 'MetersPerSecond'>;

// Time
export type EpochMs = Brand<number, 'EpochMs'>;
export type Seconds = Brand<number, 'Seconds'>;
export type Minutes = Brand<number, 'Minutes'>;
export type Hours = Brand<number, 'Hours'>;

// Dimensionless / Statistical
export type Probability = Brand<number, 'Probability'>;
export type Radians = Brand<number, 'Radians'>;
export type Degrees = Brand<number, 'Degrees'>;

// Vector Types
export type Vec3KM = [Km, Km, Km];
export type Vec3M = [Meters, Meters, Meters];
export type Vec3Scene = [SceneUnits, SceneUnits, SceneUnits];
export type Vec3KmPerSec = [KmPerSecond, KmPerSecond, KmPerSecond];
export type Vec3Mps = [MetersPerSecond, MetersPerSecond, MetersPerSecond];

// Helpers / Cast constructors
export const asKm = (n: number): Km => n as Km;
export const asMeters = (n: number): Meters => n as Meters;
export const asSceneUnits = (n: number): SceneUnits => n as SceneUnits;
export const asKmPerSec = (n: number): KmPerSecond => n as KmPerSecond;
export const asMps = (n: number): MetersPerSecond => n as MetersPerSecond;
export const asEpochMs = (n: number): EpochMs => n as EpochMs;
export const asSeconds = (n: number): Seconds => n as Seconds;
export const asProbability = (n: number): Probability => n as Probability;
export const asRadians = (n: number): Radians => n as Radians;
export const asDegrees = (n: number): Degrees => n as Degrees;
