import { expect, test } from '@playwright/test';
import { isPhone, openPanel, pressToast, row, start, switchTo, tick, toast, write } from './helpers';

test.describe('the two side options', () => {
  test('Write adds a task, and Undo takes it back', async ({ page }) => {
    await start(page);
    await write(page, 'Buy apples');
    await expect(row(page, 'Buy apples')).toBeVisible();
    await expect(toast(page)).toContainText('Added: “Buy apples”');
    await pressToast(page, 'Undo');
    await expect(row(page, 'Buy apples')).toHaveCount(0);
    await expect(toast(page)).toContainText('Undone.');
  });

  test('Write explains a duplicate next to the field, without adding it twice', async ({ page }) => {
    await start(page);
    const scope = await openPanel(page, 'Write');
    await scope.getByLabel('What do you need to do?').fill('call anu');
    await scope.getByRole('button', { name: 'Add to the list' }).click();
    await expect(scope.getByRole('alert')).toContainText('already on the list');
    await expect(row(page, 'Call Anu')).toHaveCount(1);
  });

  test('Choose adds with one tap; a second tap does not add it again', async ({ page }) => {
    await start(page);
    let scope = await openPanel(page, 'Choose');
    await scope.getByRole('button', { name: /Drink water/ }).click();
    await expect(scope.getByRole('button', { name: /Drink water/ })).toContainText('On the list');
    await scope.getByRole('button', { name: /Drink water/ }).click();
    await expect(toast(page)).toContainText('already on the list');
    if (isPhone(page)) await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click();
    scope = page.locator('.list');
    await expect(scope.locator('.row', { hasText: 'Drink water' })).toHaveCount(1);
  });
});

test.describe('the list', () => {
  test('ticks a task off and back on', async ({ page }) => {
    await start(page);
    await tick(page, 'Call Anu');
    await expect(page.locator('.rows--done')).toContainText('Call Anu');
    await expect(toast(page)).toContainText('Done: “Call Anu”. Well done!');
    await tick(page, 'Call Anu');
    await expect(page.locator('.rows--done')).not.toContainText('Call Anu');
  });

  test('a double tap on a circle ticks it once', async ({ page }) => {
    await start(page);
    await page.getByRole('checkbox', { name: 'Call Anu' }).dblclick();
    await expect(page.getByRole('checkbox', { name: 'Call Anu' })).toHaveAttribute('aria-checked', 'true');
  });

  test('Undo, Redo, Undo: the message always says what really happened', async ({ page }) => {
    await start(page);
    await write(page, 'Water the roses');
    await pressToast(page, 'Undo');
    await expect(toast(page)).toContainText('Undone.');
    await pressToast(page, 'Redo');
    await expect(toast(page)).toContainText('Done again.');
    await expect(row(page, 'Water the roses')).toHaveCount(1);
    await pressToast(page, 'Undo');
    await expect(toast(page)).toContainText('Undone.');
    await expect(row(page, 'Water the roses')).toHaveCount(0);
  });

  test('changes the words of a task from its sheet', async ({ page }) => {
    await start(page);
    await row(page, 'Call Anu').locator('.row__main').click();
    const sheet = page.locator('dialog[open]');
    await expect(sheet.getByText('You added it')).toBeVisible();
    await sheet.getByLabel('The words').fill('Call Anu about Sunday');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'Call Anu about Sunday')).toBeVisible();
  });
});

test.describe('suggestions', () => {
  test('the owner accepts what two helpers prepared together', async ({ page }) => {
    await start(page);
    await expect(page.locator('.banner')).toContainText('Saraa and Bat suggest 2 changes.');
    await page.locator('.banner').getByRole('button', { name: 'Look' }).click();
    const sheet = page.locator('dialog[open]');
    await expect(sheet).toContainText('On the list for 12 days.');
    await sheet.getByRole('button', { name: 'Yes, accept all 2' }).click();
    await expect(page.locator('.banner')).toHaveCount(0);
    await expect(row(page, 'Buy kefir')).not.toHaveAttribute('data-pending');
    await expect(row(page, 'Call about the radio')).toHaveCount(0);
  });

  test('a helper’s addition waits for an OK and can be taken back', async ({ page }) => {
    await start(page, 'Saraa');
    await write(page, 'Buy honey');
    await expect(row(page, 'Buy honey')).toContainText('Waiting for an OK');
    await row(page, 'Buy honey').getByRole('button', { name: 'Take back' }).click();
    await expect(row(page, 'Buy honey')).toHaveCount(0);
  });

  test('a viewer can look, but nothing invites changes', async ({ page }) => {
    await start(page, 'Bold');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    const scope = await openPanel(page, 'Write');
    await expect(scope).toContainText('You can look at this list, but not change it.');
  });
});

test.describe('what changed', () => {
  test('undoes an earlier change from the history', async ({ page }) => {
    await start(page);
    await page.getByRole('link', { name: 'What changed' }).click();
    await expect(page.getByRole('heading', { name: 'What changed' })).toBeFocused();
    const entry = page.locator('.entry', { hasText: 'You added “Go for a walk”' }).first();
    await entry.getByRole('button', { name: 'Undo' }).click();
    await expect(toast(page)).toContainText('Undone.');
    await page.getByRole('link', { name: 'Back to the list' }).click();
    await expect(page.locator('.rows').first()).not.toContainText('Go for a walk');
  });
});

test.describe('people', () => {
  test('trusts Saraa from the hint, and explains what a team can do together', async ({ page }) => {
    await start(page);
    await page.getByRole('link', { name: 'People' }).click();
    const saraa = page.locator('.person', { hasText: 'Saraa' });
    await expect(saraa).toContainText('last 7 suggestions were all accepted');
    await saraa.getByRole('button', { name: /Let Saraa do this directly/ }).click();
    await expect(saraa).toContainText('Own mix');
    await expect(toast(page)).toContainText('Saraa: Own mix');

    await page.getByRole('button', { name: 'Bat', pressed: false }).click();
    await page.getByRole('button', { name: 'Bold', pressed: false }).click();
    await expect(page.locator('.team__result')).toContainText('Together, Bat and Bold can add things and tick off.');
    await expect(page.locator('.team__result')).toContainText('Their suggestions need an OK from Dulmaa or Anu.');
  });

  test('never lets the last owner give up control', async ({ page }) => {
    await start(page);
    await page.getByRole('link', { name: 'People' }).click();
    await page.locator('.person', { hasText: 'Dulmaa' }).getByRole('button', { name: 'Change' }).click();
    const sheet = page.locator('dialog[open]');
    await sheet.getByRole('radio', { name: /Can approve/ }).check();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByRole('alert')).toContainText('Someone must always be able to decide who can do what.');
  });
});

test.describe('settings', () => {
  test('switches to Mongolian and to the largest text', async ({ page }) => {
    await start(page);
    await page.locator('.me').click();
    const sheet = page.locator('dialog[open]');
    await sheet.getByRole('button', { name: 'Largest' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-text-size', '2');
    await sheet.getByRole('button', { name: 'Монгол' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'mn');
    await sheet.getByRole('button', { name: 'Болсон' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Хийх зүйлс' })).toBeVisible();
  });
});

test.describe('desktop only', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 960, 'needs the side panel and a keyboard');

  test('works with the keyboard alone', async ({ page }) => {
    await start(page);
    await page.getByLabel('What do you need to do?').focus();
    await page.keyboard.type('Read the paper');
    await page.keyboard.press('Enter');
    await expect(row(page, 'Read the paper')).toBeVisible();
    await expect(page.getByLabel('What do you need to do?')).toBeFocused();
    const box = page.getByRole('checkbox', { name: 'Read the paper' });
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toHaveAttribute('aria-checked', 'true');
  });

  test('two tabs are two people, and stay in step', async ({ browser }) => {
    const context = await browser.newContext();
    const dulmaa = await context.newPage();
    const saraa = await context.newPage();
    await start(dulmaa, 'Dulmaa');
    await start(saraa, 'Saraa');
    await write(saraa, 'Buy candles');
    await expect(dulmaa.locator('.banner')).toContainText('suggest 3 changes');
    await expect(row(dulmaa, 'Buy candles')).toContainText('Suggested by Saraa');
    await context.close();
  });

  test('switching person changes what the buttons promise', async ({ page }) => {
    await start(page);
    await switchTo(page, 'Saraa');
    await page.getByRole('tab', { name: 'Write' }).click();
    await expect(page.locator('.side').getByRole('button', { name: 'Suggest adding' })).toBeVisible();
  });
});
