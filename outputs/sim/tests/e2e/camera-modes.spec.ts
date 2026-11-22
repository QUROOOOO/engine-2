import { test, expect } from './fixtures';

test.describe('Dual-Reference-Frame Camera System & Cinema Mode', () => {
  test('camera mode indicator reflects INSPECT vs PLANET mode and return-to-earth action', async ({ simPage }) => {
    const camModePill = simPage.locator('#camModePill');
    const camModeTag = simPage.locator('#camModeTag');
    const camModeTarget = simPage.locator('#camModeTarget');
    const returnEarthBtn = simPage.locator('#returnEarthBtn');

    await expect(camModePill).toBeVisible();

    // When an active encounter or satellite is tracked, Return to Earth button is available
    if (await returnEarthBtn.isVisible()) {
      await returnEarthBtn.click();
      await expect(camModeTag).toHaveText('PLANET VIEW', { timeout: 5000 });
      await expect(camModeTarget).toHaveText('Earth Center');
      await expect(returnEarthBtn).toBeHidden();
    } else {
      await expect(camModeTag).toHaveText('PLANET VIEW');
      await expect(camModeTarget).toHaveText('Earth Center');
    }

    // Now select satellite #1 (Cartosat) to enter OBJECT_CENTRIC inspection
    const firstSat = simPage.locator('.obj[data-kind="sat"]').first();
    await firstSat.click();

    // Wait for transit into OBJECT_CENTRIC inspection
    await expect(camModeTag).toHaveText('INSPECT VIEW', { timeout: 8000 });
    await expect(returnEarthBtn).toBeVisible();

    // Click Return to Earth again
    await returnEarthBtn.click();
    await expect(camModeTag).toHaveText('PLANET VIEW', { timeout: 5000 });
    await expect(camModeTarget).toHaveText('Earth Center');
    await expect(returnEarthBtn).toBeHidden();
  });

  test('cinema mode toggles smoothly via CINEMA button and restores via exit button', async ({ simPage }) => {
    const cinemaBtn = simPage.locator('#cinemaBtn');
    const exitBtn = simPage.locator('#exitCinemaBtn');
    const body = simPage.locator('body');

    await expect(cinemaBtn).toBeVisible();
    await expect(exitBtn).toBeHidden();
    await expect(body).not.toHaveAttribute('data-cinema', 'true');

    // Click CINEMA button
    await cinemaBtn.click();
    await expect(body).toHaveAttribute('data-cinema', 'true');
    await expect(exitBtn).toBeVisible();

    // Click Exit Cinema button
    await exitBtn.click();
    await expect(body).not.toHaveAttribute('data-cinema', 'true');
    await expect(exitBtn).toBeHidden();
  });
});
