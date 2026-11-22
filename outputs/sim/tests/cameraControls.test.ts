/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { OrbitRig } from '../src/controls';

describe('Dual-Reference-Frame Camera Controller (OrbitRig)', () => {
  let cam: THREE.PerspectiveCamera;
  let dom: HTMLElement;
  let rig: OrbitRig;

  beforeEach(() => {
    cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 6000);
    dom = document.createElement('div');
    document.body.appendChild(dom);
    rig = new OrbitRig(cam, dom);
  });

  it('initializes in PLANET_CENTRIC mode centered at world origin (0,0,0)', () => {
    expect(rig.frameMode).toBe('PLANET_CENTRIC');
    expect(rig.targetName).toBe('Earth Center');
    expect(rig.target.x).toBe(0);
    expect(rig.target.y).toBe(0);
    expect(rig.target.z).toBe(0);
    expect(rig.minR).toBe(OrbitRig.PLANET_MIN_DIST); // 76.0
    expect(rig.maxR).toBe(OrbitRig.PLANET_MAX_DIST); // 420.0
  });

  it('enforces planetary ground guard (altitude >= R_EARTH + 1.8 = 65.51 units) in PLANET_CENTRIC', () => {
    rig.goalRadius = 50; // Attempt to force camera deep into Earth
    rig.update(0.1);

    // Camera position must not penetrate the planetary safety boundary
    expect(cam.position.length()).toBeGreaterThanOrEqual(OrbitRig.R_EARTH + 1.8 - 1e-4);
  });

  it('transitions to OBJECT_CENTRIC mode with micro-inspection boundaries (min: 0.18 units) upon focus', () => {
    const satPos = new THREE.Vector3(70, 0, 0); // LEO altitude
    rig.focusOnObject(satPos, 'Cartosat-3', 'sat', 0, 4.2);

    expect(rig.frameMode).toBe('OBJECT_CENTRIC');
    expect(rig.targetName).toBe('Cartosat-3');
    expect(rig.trackedKind).toBe('sat');
    expect(rig.minR).toBe(OrbitRig.OBJECT_MIN_DIST); // 0.18 units
    expect(rig.maxR).toBe(OrbitRig.OBJECT_MAX_DIST); // 45.0 units
    expect(rig.isTransitioning).toBe(true);

    // Advance transit animation to completion
    for (let i = 0; i < 30; i++) {
      rig.update(0.05);
    }

    expect(rig.isTransitioning).toBe(false);
    expect(rig.target.distanceTo(satPos)).toBeLessThan(0.01);
  });

  it('enforces surface-normal guard (altitude >= R_EARTH + 0.8 = 64.51 units) in OBJECT_CENTRIC mode', () => {
    const satPos = new THREE.Vector3(69, 0, 0);
    rig.focusOnObject(satPos, 'Cartosat-3', 'sat', 0, 0.18);

    // Fast-forward transit
    for (let i = 0; i < 30; i++) {
      rig.update(0.05);
    }

    // Camera should be very close to satellite (~0.18 units)
    expect(cam.position.distanceTo(satPos)).toBeLessThan(1.0);
    // But never below the Earth surface-normal threshold
    expect(cam.position.length()).toBeGreaterThanOrEqual(OrbitRig.R_EARTH + 0.8 - 1e-4);
  });

  it('releases OBJECT_CENTRIC and returns to PLANET_CENTRIC when zooming out past 42.0 units (hysteresis)', () => {
    const satPos = new THREE.Vector3(70, 0, 0);
    rig.focusOnObject(satPos, 'Cartosat-3', 'sat', 0, 4.2);

    // Fast forward transition
    for (let i = 0; i < 30; i++) {
      rig.update(0.05);
    }

    expect(rig.frameMode).toBe('OBJECT_CENTRIC');

    // Zoom out past release boundary (42.0)
    rig.zoom(2000); // Positive delta expands distance

    // Should automatically reset to PLANET_CENTRIC
    expect(rig.frameMode).toBe('PLANET_CENTRIC');
    expect(rig.targetName).toBe('Earth Center');
    expect(rig.minR).toBe(OrbitRig.PLANET_MIN_DIST);
    expect(rig.maxR).toBe(OrbitRig.PLANET_MAX_DIST);
  });

  it('tracks a moving satellite without losing user local orbital coordinates', () => {
    const pos1 = new THREE.Vector3(70, 0, 0);
    const pos2 = new THREE.Vector3(69.8, 0, 5.2);
    rig.focusOnObject(pos1, 'Cartosat-1', 'sat', 0, 2.5);

    // Fast forward transit
    for (let i = 0; i < 30; i++) {
      rig.update(0.05);
    }

    // Now object moves along its orbit
    rig.updateTrackedPosition(pos2);
    rig.update(0.016);

    expect(rig.target.distanceTo(pos2)).toBeLessThan(0.05);
    // Camera should maintain local offset distance
    expect(cam.position.distanceTo(pos2)).toBeCloseTo(2.5, 0.1);
  });

  it('interrupts ongoing fly-to transit immediately when user grabs the pointer', () => {
    const satPos = new THREE.Vector3(70, 0, 0);
    rig.focusOnObject(satPos, 'Cartosat-1', 'sat', 0, 4.2);
    expect(rig.isTransitioning).toBe(true);

    // 0.2s into 1.1s transit
    rig.update(0.2);
    expect(rig.isTransitioning).toBe(true);

    // User presses pointer
    const event = new MouseEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    dom.dispatchEvent(event);

    // Transition should immediately terminate and hand control to user
    expect(rig.isTransitioning).toBe(false);
  });

  it('resetToPlanetView cleanly resets to Earth core (0,0,0)', () => {
    const satPos = new THREE.Vector3(70, 0, 0);
    rig.focusOnObject(satPos, 'Cartosat-1', 'sat', 0, 4.2);
    for (let i = 0; i < 30; i++) {
      rig.update(0.05);
    }
    expect(rig.frameMode).toBe('OBJECT_CENTRIC');

    rig.resetToPlanetView();
    expect(rig.frameMode).toBe('PLANET_CENTRIC');
    expect(rig.targetName).toBe('Earth Center');

    for (let i = 0; i < 30; i++) {
      rig.update(0.05);
    }
    expect(rig.target.distanceTo(new THREE.Vector3(0, 0, 0))).toBeLessThan(0.05);
  });
});
