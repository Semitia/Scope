import { expect, test } from '@playwright/test';

test('channel editor escapes a short panel and stays usable within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Add panel', exact: true }).click();
  await page.getByRole('menuitem', { name: /Indicators/ }).click();
  const panel = page.getByRole('region', { name: 'Indicators 1', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Channels for Indicators 1', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.parentElement === document.body)).toBe(true);
  const small = (await panel.boundingBox())!;
  const popup = (await dialog.boundingBox())!;
  expect(popup.height).toBeGreaterThan(small.height + 100);
  expect(popup.y).toBeGreaterThanOrEqual(12);
  expect(popup.y + popup.height).toBeLessThanOrEqual(788);
  await dialog.getByRole('checkbox', { name: /controller.speed/ }).click();
  await expect(dialog.getByRole('checkbox', { name: /controller.speed/ })).toBeChecked();
  await page.screenshot({ path: '../../artifacts/floating-channel-picker.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await panel.getByRole('button', { name: 'Choose channels for Indicators 1', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 380, height: 500 });
  await expect.poll(async () => {
    const rect = (await dialog.boundingBox())!;
    return rect.x >= 12 && rect.y >= 12 && rect.x + rect.width <= 368 && rect.y + rect.height <= 488;
  }).toBe(true);
  await dialog.getByRole('button', { name: 'Close channels for Indicators 1', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('instrument settings float outside the parent and preserve editable controls', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Add panel', exact: true }).click();
  await page.getByRole('menuitem', { name: /Wristed instrument/ }).click();
  const panel = page.getByRole('region', { name: 'Wristed Instrument 1', exact: true });
  await panel.getByRole('button', { name: 'Configure Wristed Instrument 1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Instrument settings for Wristed Instrument 1', exact: true });
  expect(await dialog.evaluate(element => element.parentElement === document.body)).toBe(true);
  await dialog.getByRole('spinbutton', { name: 'alpha manual value' }).fill('0.8');
  await expect(dialog.getByRole('spinbutton', { name: 'alpha manual value' })).toHaveValue('0.8');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
