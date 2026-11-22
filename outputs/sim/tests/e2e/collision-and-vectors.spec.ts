import { test, expect } from './fixtures';

test.describe('Dual Vector Arrows & True Collision Destruction Physics', () => {
  test('Auto-Avoidance AI toggles cleanly between ON and OFFLINE states', async ({ simPage }) => {
    const autoDodgeToggle = simPage.locator('#autoDodgeToggle');
    const autoDodgeLabel = simPage.locator('#autoDodgeLabel');
    const planState = simPage.locator('#planState');

    await expect(autoDodgeToggle).toBeVisible();
    await expect(autoDodgeToggle).toBeChecked();
    await expect(autoDodgeLabel).toHaveText('ON');

    // Toggle OFF
    await autoDodgeToggle.uncheck();
    await expect(autoDodgeToggle).not.toBeChecked();
    await expect(autoDodgeLabel).toHaveText('OFF');
    await expect(planState).toHaveText('OFFLINE');

    // Toggle back ON
    await autoDodgeToggle.check();
    await expect(autoDodgeToggle).toBeChecked();
    await expect(autoDodgeLabel).toHaveText('ON');
    await expect(planState).toHaveText('STANDBY');
  });

  test('Test Crash triggers direct collision, impact announcement, and camera recovery', async ({ simPage }) => {
    const testCrashBtn = simPage.locator('#testCrashBtn');
    const livePill = simPage.locator('#livePill');
    const autoDodgeLabel = simPage.locator('#autoDodgeLabel');
    const camModeTag = simPage.locator('#camModeTag');

    await expect(testCrashBtn).toBeVisible();

    // Click TEST CRASH
    await testCrashBtn.click();

    // Auto-dodge should immediately switch to OFF
    await expect(autoDodgeLabel).toHaveText('OFF');

    // Status pill should display direct intercept warning
    await expect(livePill).toContainText('Direct Intercept Course');

    // Camera switches to INSPECT VIEW to watch the incoming kinetic encounter
    await expect(camModeTag).toHaveText('INSPECT VIEW', { timeout: 8000 });

    // Wait for the physical collision & dissolution sequence
    await expect(livePill).toContainText('Impact Confirmed', { timeout: 15000 });

    // After dissolution, camera automatically glides back to PLANET VIEW
    await expect(camModeTag).toHaveText('PLANET VIEW', { timeout: 15000 });
  });
});
