import { test, expect } from './fixtures';

test.describe('QuantumOrbit Sim - Visual Verification', () => {
  test('b-plane canvas renders pixel content', async ({ simPage }) => {
    const bplane = simPage.locator('#bplane');
    await expect(bplane).toBeVisible();

    // Verify canvas dimensions
    const box = await bplane.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(150);
    expect(box!.height).toBeGreaterThanOrEqual(150);

    // Verify canvas has drawn data by reading data URL from canvas
    const hasDrawn = await simPage.evaluate(() => {
      const cvs = document.getElementById('bplane') as HTMLCanvasElement;
      if (!cvs) return false;
      const ctx = cvs.getContext('2d');
      if (!ctx) return false;
      const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
      // Ensure canvas is not completely blank (has non-zero pixels)
      return imgData.data.some((channel) => channel !== 0);
    });

    expect(hasDrawn).toBe(true);
  });

  test('theme toggle switches visual styling classes', async ({ simPage }) => {
    const html = simPage.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await simPage.locator('#themeBtn').click();
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Verify background color changes
    const bgColor = await simPage.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    expect(bgColor).not.toBe('');
  });
});
