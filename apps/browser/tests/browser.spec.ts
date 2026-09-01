import { expect, test } from '@playwright/test';

test('desktop workbench renders and core controls work', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo=1');

  await expect(page.getByRole('region', { name: 'Scope 1' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.scope-toolbar')).toHaveCount(0);
  await expect(page.locator('.source-card strong').getByText('control-loop', { exact: true })).toBeVisible();
  await expect(page.locator('.uplot')).toBeVisible();
  await expect(page.locator('.legend-item')).toHaveCount(4);

  await page.waitForTimeout(1_200);
  await page.screenshot({ path: '../../artifacts/debugscope-1440x900.png', fullPage: true });

  const openSettings = page.getByRole('button', { name: 'Open settings' });
  await openSettings.click();
  const settingsPanel = page.getByRole('dialog', { name: 'Settings' });
  const idleScrollSwitch = settingsPanel.getByRole('switch', {
    name: 'Continue scrolling when idle',
  });
  await expect(settingsPanel).toBeVisible();
  await expect(idleScrollSwitch).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: '../../artifacts/debugscope-settings.png', fullPage: true });
  await idleScrollSwitch.click();
  await expect(idleScrollSwitch).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Close settings panel' }).click();
  await page.reload();
  await expect(page.locator('.uplot')).toBeVisible();
  await openSettings.click();
  await expect(idleScrollSwitch).toHaveAttribute('aria-checked', 'true');
  await idleScrollSwitch.click();
  await page.keyboard.press('Escape');
  await expect(settingsPanel).toBeHidden();

  await page.getByRole('button', { name: 'Add scope' }).click();
  const scopeTwoPicker = page.getByRole('dialog', { name: 'Channels for Scope 2' });
  await expect(scopeTwoPicker).toBeVisible();
  await scopeTwoPicker.getByRole('checkbox').filter({ hasText: 'Target' }).click();
  await scopeTwoPicker.getByRole('checkbox').filter({ hasText: 'Error' }).click();
  await page.screenshot({ path: '../../artifacts/debugscope-scope-picker.png', fullPage: true });
  await page.getByRole('button', { name: 'Close channels for Scope 2' }).click();
  await expect(page.locator('.scope-panel')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Scope 2' }).locator('.legend-item')).toHaveCount(2);
  await expect(page.locator('.channel-heading .channel-count')).toHaveText('2 / 4');
  await page.screenshot({ path: '../../artifacts/debugscope-multiple-scopes.png', fullPage: true });

  await page.reload();
  await expect(page.locator('.scope-panel')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Scope 2' }).locator('.legend-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Activate Scope 1' }).click();
  await expect(page.locator('.channel-heading .channel-count')).toHaveText('4 / 4');
  await page.getByRole('button', { name: 'Delete Scope 2' }).click();
  await expect(page.locator('.scope-panel')).toHaveCount(1);

  await page.getByRole('button', { name: /Pause/ }).click();
  await expect(page.getByText('PAUSED')).toBeVisible();

  const autoY = page.getByRole('button', { name: 'Auto Y' });
  await expect(autoY).toHaveAttribute('aria-pressed', 'true');
  await autoY.click();
  await expect(autoY).toHaveAttribute('aria-pressed', 'false');
  await autoY.click();

  await page.getByRole('button', { name: 'Style Error', exact: true }).click();
  await page.getByLabel('Color for Error').evaluate((element) => {
    const input = element as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(input, '#00aa55');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const curvePicker = page.getByRole('button', { name: 'Curve for Error' });
  await expect(curvePicker).toContainText('Linear');
  await curvePicker.click();
  const curveOptions = page.getByRole('listbox', { name: 'Curve for Error options' });
  await expect(curveOptions.locator('.style-preview')).toHaveCount(3);
  await curveOptions.getByRole('option', { name: 'Stepped' }).click();
  await expect(page.locator('.uplot')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Style Error' })).toBeVisible();

  await curvePicker.click();
  await page.getByRole('listbox', { name: 'Curve for Error options' })
    .getByRole('option', { name: 'Linear' })
    .click();

  const strokePicker = page.getByRole('button', { name: 'Stroke for Error' });
  await strokePicker.click();
  const strokeOptions = page.getByRole('listbox', { name: 'Stroke for Error options' });
  await expect(strokeOptions.locator('.style-preview')).toHaveCount(4);
  await page.screenshot({ path: '../../artifacts/debugscope-style-options.png', fullPage: true });
  await strokeOptions.getByRole('option', { name: 'Dash-dot' }).click();
  await expect(page.locator('.legend-line.dashdot')).toHaveCount(1);
  await page.getByLabel('Width for Error').selectOption('3');
  await expect(page.getByRole('dialog', { name: 'Style Error' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Style Error' }).getByText('#00AA55')).toBeVisible();
  await page.getByRole('button', { name: 'Close style editor' }).click();

  await page.getByRole('button', { name: 'Hide Error', exact: true }).click();
  await expect(page.locator('.channel-heading .channel-count')).toHaveText('3 / 4');
  await expect(page.locator('.legend-item')).toHaveCount(3);

  await page.getByLabel('Visible time window').selectOption('5');
  await page.getByRole('button', { name: /Resume/ }).click();
  await expect(page.getByText('DEMO LIVE', { exact: true })).toBeVisible();

  const plotOverlay = page.locator('.u-over');
  await plotOverlay.hover({ position: { x: 500, y: 220 } });
  await page.mouse.wheel(0, -220);
  await expect(page.getByRole('button', { name: 'Return to live' })).toBeVisible();
  await plotOverlay.dblclick({ position: { x: 500, y: 220 } });
  await expect(page.getByRole('button', { name: 'Return to live' })).toBeHidden();

  for (const channel of ['Target', 'Speed', 'Estimate']) {
    await page.getByRole('button', { name: `Hide ${channel}`, exact: true }).click();
  }
  await expect(page.getByText('No channels in Scope 1')).toBeVisible();
  await page.getByRole('button', { name: 'Show all channels' }).click();
  await expect(page.locator('.channel-heading .channel-count')).toHaveText('4 / 4');

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: '../../artifacts/debugscope-dark-1440x900.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect.poll(async () => {
    const text = await page.locator('.status-group').first().locator('span').nth(2).locator('b').textContent();
    return Number(text?.replaceAll(',', '') ?? Number.POSITIVE_INFINITY);
  }).toBeLessThan(120);

  expect(consoleErrors).toEqual([]);
});

test('compact layout keeps the waveform primary', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await page.goto('/?demo=1');

  const menu = page.getByRole('button', { name: 'Open channels' });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.waitForTimeout(220);
  await page.screenshot({ path: '../../artifacts/debugscope-760x720.png', fullPage: true });

  await page.getByRole('button', { name: 'Close channels' }).last().click();
  await expect(page.locator('.scope-panel')).toBeVisible();
});
