/** The school example: plans broken into steps, rounds, next steps, and who sees what. */
import { expect, test } from '@playwright/test';
import { isPhone, openPanel, pressToast, row, sheet, startSchool, toast } from './helpers';

test.describe('breaking a task into steps', () => {
  test('a teacher writes a plan; the app works out the rounds and her next step', async ({ page }) => {
    await startSchool(page, 'Saraa');
    const scope = await openPanel(page, 'Write');
    await scope.getByLabel('What do you need to do?').fill('Sports day');
    await scope.getByRole('button', { name: 'Break it into steps' }).click();
    await scope.getByLabel('Step 1', { exact: true }).fill('Book the field');
    await scope.getByRole('button', { name: 'Add a step' }).click();
    await scope.getByLabel('Step 2', { exact: true }).fill('Run the races');
    await expect(scope.locator('.shape')).toContainText('2 steps · 1 round · all can start now');
    // The races wait for the field: one more round.
    await scope.locator('.pstep').nth(1).getByRole('button', { name: /Book the field/ }).click();
    await expect(scope.locator('.pstep').nth(1)).toContainText('Round 2');
    await expect(scope.locator('.pstep').nth(1)).toContainText('Waiting for it adds a round.');
    await expect(scope.locator('.shape')).toContainText('2 steps · 2 rounds · 1 can start now');
    await scope.getByRole('button', { name: 'Add with 2 steps' }).click();
    await expect(toast(page)).toContainText('Added: “Sports day” with 2 steps');
    await expect(page.locator('.row[data-plan]', { hasText: 'Sports day' })).toContainText('2 rounds to go');
    await expect(page.locator('.next')).toContainText('Book the field');
  });

  test('a step cannot wait for itself in a circle', async ({ page }) => {
    await startSchool(page, 'Saraa');
    const scope = await openPanel(page, 'Write');
    await scope.getByLabel('What do you need to do?').fill('Loop');
    await scope.getByRole('button', { name: 'Break it into steps' }).click();
    await scope.getByLabel('Step 1', { exact: true }).fill('A');
    await scope.getByRole('button', { name: 'Add a step' }).click();
    await scope.getByLabel('Step 2', { exact: true }).fill('B');
    await scope.locator('.pstep').nth(1).getByRole('button', { name: /A$/ }).click();
    await expect(scope.locator('.pstep').nth(0).getByRole('button', { name: /B$/ })).toBeDisabled();
  });
});

test.describe('ready-made plans', () => {
  test('choosing a plan shows who does what before adding it', async ({ page }) => {
    await startSchool(page, 'Saraa');
    const scope = await openPanel(page, 'Choose');
    await scope.getByRole('button', { name: /Homework/ }).click();
    const preview = sheet(page);
    await expect(preview).toContainText('5 steps in 3 rounds');
    await expect(preview).toContainText('Every student (3)');
    await preview.getByRole('button', { name: 'Add this plan' }).click();
    await expect(toast(page)).toContainText('Added: “Homework” with 5 steps');
    if (isPhone(page)) await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.row[data-plan]', { hasText: 'Homework' }).first()).toBeVisible();
  });
});

test.describe('doing the steps', () => {
  test('a student sees only their part, and ticks their own step from "Your next steps"', async ({ page }) => {
    await startSchool(page, 'Anu');
    await expect(page.locator('.list')).toContainText('Reading homework: chapter 4');
    await expect(page.locator('.list')).not.toContainText('Parent meeting');
    await expect(page.locator('.list')).not.toContainText('Call the education office');
    await page.locator('.next').getByRole('checkbox', { name: 'Do the homework' }).click();
    await expect(toast(page)).toContainText('Done: “Do the homework”. Well done!');
    await pressToast(page, 'Undo');
    await expect(page.locator('.next').getByRole('checkbox', { name: 'Do the homework' })).toBeVisible();
  });

  test('a student sees the steps around hers by name, and the rest only as a number', async ({ page }) => {
    await startSchool(page, 'Anu');
    await row(page, 'Exam week').locator('.row__main').first().click();
    const plan = sheet(page);
    await expect(plan).toContainText('You see your part of this plan.');
    await expect(plan).toContainText('Hold the exam');
    await expect(plan).not.toContainText('Print the papers');
    await expect(plan).not.toContainText('Book the rooms');
    await plan.locator('.srow__main', { hasText: 'Hold the exam' }).click();
    const step = sheet(page);
    await expect(step.getByRole('heading', { name: /Step \d+/ })).toBeVisible();
    await expect(step).toContainText(/other steps?/);
    await expect(step).not.toContainText('Print the papers');
    await expect(step).not.toContainText('Book the rooms');
  });

  test('the plan shows its rounds; a step that waits cannot be ticked yet', async ({ page }) => {
    await startSchool(page, 'Tuya');
    await row(page, 'Exam week').locator('.row__main').first().click();
    const plan = sheet(page);
    await expect(plan).toContainText('10 steps in 5 rounds');
    await expect(plan).toContainText('At the same time: 5 rounds instead of 10.');
    await expect(plan.locator('.round').first()).toContainText('Done');
    await expect(plan.getByRole('checkbox', { name: 'Hold the exam' })).toHaveCount(0);
    await expect(plan.locator('.srow').filter({ has: page.locator('.srow__text', { hasText: /^Hold the exam$/ }) })).toContainText(
      'Waits for',
    );
    await plan.getByRole('checkbox', { name: 'Print the papers' }).click();
    await expect(toast(page)).toContainText('Done: “Print the papers”');
  });

  test('changing what a step waits for, from its sheet', async ({ page }) => {
    await startSchool(page, 'Tuya');
    await row(page, 'Exam week').locator('.row__main').first().click();
    await sheet(page).locator('.srow__main', { hasText: 'Mark the papers' }).click();
    const step = sheet(page);
    await expect(step.getByRole('heading', { name: /Step \d+/ })).toBeVisible();
    await step.getByRole('button', { name: /Print the papers/ }).click();
    await expect(toast(page)).toContainText('Changed what “Mark the papers” waits for');
  });
});
