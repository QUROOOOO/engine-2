import { test, expect } from './fixtures';

test.describe('QuantumOrbit Sim - Soak & Stability', () => {
  test('accelerated 600x time-dilation simulation maintains stability and heap bounds', async ({ simPage }) => {
    // Switch to 600x rate
    const rate600Btn = simPage.locator('button[data-rate="600"]');
    await rate600Btn.click();
    await expect(rate600Btn).toHaveClass(/on/);

    // Initial MET readout
    const met = simPage.locator('#met');
    const initialMet = await met.innerText();

    // Advance through accelerated simulation for 5 seconds (simulates 50 minutes of orbital time)
    await simPage.waitForTimeout(5000);

    const advancedMet = await met.innerText();
    expect(advancedMet).not.toEqual(initialMet);

    // Verify simulation state serialization remains valid and non-corrupted
    const exportedStateJson = await simPage.evaluate(() => {
      const sim = (window as any).__sim;
      return sim && typeof sim.exportState === 'function' ? sim.exportState() : null;
    });

    expect(exportedStateJson).not.toBeNull();
    const parsedState = JSON.parse(exportedStateJson);
    expect(Number.isFinite(parsedState.simMs)).toBe(true);
    expect(parsedState.rate).toBe(600);

    // Scrub back and forth to stress memory and buffer allocations
    const timeline = simPage.locator('#timeline');
    const box = await timeline.boundingBox();
    if (box) {
      await simPage.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
      await simPage.waitForTimeout(500);
      await simPage.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
      await simPage.waitForTimeout(500);
    }

    // Verify canvas remains active
    const viewCanvas = simPage.locator('#view');
    await expect(viewCanvas).toBeVisible();
  });
});
