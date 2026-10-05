/** Automated WCAG 2.1 AA checks (axe-core) on every screen, light and dark. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { start } from './helpers';

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const problems = results.violations.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.length}× — ${v.help}`);
  expect(problems, problems.join('\n')).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} mode`, () => {
    // Reduced motion: audit finished screens, not sheets halfway through fading in.
    test.use({ colorScheme: scheme, reducedMotion: 'reduce' });

    test('home, sheets and pages pass axe', async ({ page }) => {
      await start(page);
      await audit(page, 'home');

      await page.locator('.banner').getByRole('button', { name: 'Look' }).click();
      await audit(page, 'review sheet');
      await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click();

      await page.locator('.me').click();
      await audit(page, 'settings sheet');
      await page.locator('dialog[open]').getByRole('button', { name: 'Done' }).click();

      await page.getByRole('link', { name: 'What changed' }).click();
      await audit(page, 'what changed');

      await page.getByRole('link', { name: 'People' }).click();
      await audit(page, 'people');
    });
  });
}

test('the welcome screen passes axe', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date('2026-10-05T15:30:00+08:00'));
  await page.goto('/');
  await audit(page, 'welcome');
});
