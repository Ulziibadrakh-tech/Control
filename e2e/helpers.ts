import { expect, type Locator, type Page } from '@playwright/test';

/** A fixed afternoon, so the sample history and greetings are the same on every run. */
export const NOW = new Date('2026-10-05T15:30:00+08:00');

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 960;

/** Open the app fresh, with the home or the school example, and pick who is using it. */
export async function start(page: Page, who = 'Dulmaa', example: 'home' | 'school' = 'home'): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`/?example=${example}`);
  const welcome = page.locator('.welcome');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(welcome.or(page.locator('.top'))).toBeVisible();
  if (await welcome.isVisible()) {
    await welcome.locator('.who__btn', { hasText: who }).click();
  } else if (!((await heading.textContent()) ?? '').includes(who)) {
    // Another tab in the same browser already chose someone; this tab becomes `who`.
    await switchTo(page, who);
  }
  await expect(heading).toContainText(who);
}

/** Where the Write / Choose panels live: beside the list, or in a sheet on phones. */
export async function openPanel(page: Page, panel: 'Write' | 'Choose'): Promise<Locator> {
  if (isPhone(page)) {
    await page.locator('.bottombar').getByRole('button', { name: panel }).click();
    return page.locator('dialog[open]');
  }
  await page.getByRole('tab', { name: panel }).click();
  return page.locator('.side');
}

export async function write(page: Page, text: string): Promise<void> {
  const scope = await openPanel(page, 'Write');
  await scope.getByLabel('What do you need to do?').fill(text);
  await scope.getByRole('button', { name: /Add to the list|Suggest adding/ }).click();
}

export const row = (page: Page, text: string): Locator => page.locator('.row', { hasText: text });

export const toast = (page: Page): Locator => page.locator('.toast');

/**
 * Press the button on the current message the way a person does: after reading it.
 * (Taps in the first half second are ignored on purpose; they are usually the tail of a double tap.)
 */
export async function pressToast(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(600);
  await toast(page).getByRole('button', { name }).click();
}

/** Tick a task, waiting like a person between taps (a double tap ticks once). */
export async function tick(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(600);
  await page.getByRole('checkbox', { name }).click();
}

export async function switchTo(page: Page, who: string): Promise<void> {
  await page.locator('.me').click();
  await page.locator('dialog[open] .who__btn', { hasText: who }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(who);
}

/** The school example, as one of its people. */
export const startSchool = (page: Page, who: string): Promise<void> => start(page, who, 'school');

/** The open sheet on top. */
export const sheet = (page: Page): Locator => page.locator('dialog[open]').last();
