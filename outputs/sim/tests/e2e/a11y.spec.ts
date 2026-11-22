import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

test.describe('QuantumOrbit Sim - Accessibility (WCAG 2.2 AA)', () => {
  test('@a11y default dark mode view has zero critical or serious a11y violations', async ({ simPage }) => {
    const accessibilityScanResults = await new AxeBuilder({ page: simPage })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const seriousViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(
      seriousViolations,
      `Detected accessibility violations: ${JSON.stringify(seriousViolations, null, 2)}`
    ).toEqual([]);
  });

  test('@a11y help navigation modal has zero critical or serious a11y violations when open', async ({ simPage }) => {
    await simPage.locator('#helpBtn').click();
    await expect(simPage.locator('#help')).toBeVisible();
    await simPage.waitForTimeout(300);

    const accessibilityScanResults = await new AxeBuilder({ page: simPage })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const seriousViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(seriousViolations).toEqual([]);

    await simPage.locator('#helpClose').click();
  });

  test('@a11y light mode theme has zero critical or serious a11y violations', async ({ simPage }) => {
    await simPage.locator('#themeBtn').click();
    await expect(simPage.locator('html')).toHaveAttribute('data-theme', 'light');
    await simPage.waitForFunction(() => {
      const sel = document.querySelector('.obj.sel');
      if (!sel) return true;
      const bg = getComputedStyle(sel).backgroundColor;
      return bg !== 'rgb(16, 19, 23)';
    });
    await simPage.waitForTimeout(400);

    const accessibilityScanResults = await new AxeBuilder({ page: simPage })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const seriousViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(seriousViolations).toEqual([]);
  });
});
