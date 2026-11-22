import { test, expect } from './fixtures';

test.describe('Flow 3: Conjunction Analysis', () => {
  test('conjunction telemetry and B-plane canvas render properly', async ({ simPage }) => {
    // Risk chip is rendered with an active risk status
    const riskChip = simPage.locator('#riskChip');
    await expect(riskChip).toBeVisible();

    // Protected asset name is rendered
    const threatSat = simPage.locator('#threatSat');
    await expect(threatSat).toBeVisible();
    await expect(threatSat).not.toHaveText('—');

    // Miss distance readout is populated
    const threatMiss = simPage.locator('#threatMiss');
    await expect(threatMiss).toBeVisible();
    await expect(threatMiss).not.toHaveText('—');

    // B-plane canvas is present and has nonzero dimensions
    const bplaneCanvas = simPage.locator('#bplane');
    await expect(bplaneCanvas).toBeVisible();
    const box = await bplaneCanvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
  });
});
