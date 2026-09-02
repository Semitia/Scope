import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function dragBy(page: Page, handle: Locator, deltaX: number, deltaY: number) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('Drag handle is not visible');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await handle.dispatchEvent('pointerdown', {
    button: 0,
    buttons: 1,
    clientX: start.x,
    clientY: start.y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  });
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: 1,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0,
    }));
  }, { x: start.x + deltaX, y: start.y + deltaY });
}

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

  const controllerGroup = page.getByRole('button', { name: 'controller channel group' });
  await expect(controllerGroup).toHaveAttribute('aria-expanded', 'true');
  await controllerGroup.click();
  await expect(controllerGroup).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.channel-row').filter({ hasText: 'controller.target' })).toHaveCount(0);
  await page.getByPlaceholder('Filter channels').fill('Target');
  await expect(controllerGroup).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.channel-row').filter({ hasText: 'controller.target' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear channel filter' }).click();
  await expect(controllerGroup).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(controllerGroup).toHaveAttribute('aria-expanded', 'false');
  await controllerGroup.click();
  await expect(controllerGroup).toHaveAttribute('aria-expanded', 'true');

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
  await page.locator('.brand-block').click();
  await expect(settingsPanel).toBeHidden();
  await page.reload();
  await expect(page.locator('.uplot')).toBeVisible();
  await openSettings.click();
  await expect(idleScrollSwitch).toHaveAttribute('aria-checked', 'true');
  await idleScrollSwitch.click();
  await page.keyboard.press('Escape');
  await expect(settingsPanel).toBeHidden();

  await page.getByRole('button', { name: 'Add panel' }).click();
  await page.getByRole('menuitem', { name: /Waveform/ }).click();
  const scopeTwoPicker = page.getByRole('dialog', { name: 'Channels for Scope 2' });
  await expect(scopeTwoPicker).toBeVisible();
  await scopeTwoPicker.getByRole('checkbox').filter({ hasText: 'Target' }).click();
  await scopeTwoPicker.getByRole('checkbox').filter({ hasText: 'Error' }).click();
  await page.screenshot({ path: '../../artifacts/debugscope-scope-picker.png', fullPage: true });
  await page.getByRole('button', { name: 'Close channels for Scope 2' }).click();
  await expect(page.locator('.scope-panel')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Scope 2' }).locator('.legend-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Activate Scope 2' }).dblclick();
  const scopeTitleInput = page.getByRole('textbox', { name: 'Rename Scope 2' });
  await scopeTitleInput.fill('Aux scope');
  await scopeTitleInput.press('Enter');
  const auxScope = page.getByRole('region', { name: 'Aux scope' });
  await expect(auxScope).toBeVisible();
  await auxScope.getByRole('button', { name: 'Auto Y for Aux scope' }).click();
  await auxScope.getByLabel('Visible time window for Aux scope').selectOption('5');
  await expect(page.getByRole('region', { name: 'Scope 1' })
    .getByRole('button', { name: 'Auto Y for Scope 1' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Scope 1' })
    .getByLabel('Visible time window for Scope 1')).toHaveValue('10');
  await expect(page.locator('.channel-heading .channel-count')).toHaveText('2 / 7');
  await page.screenshot({ path: '../../artifacts/debugscope-multiple-scopes.png', fullPage: true });

  await page.reload();
  await expect(page.locator('.scope-panel')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Aux scope' }).locator('.legend-item')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Aux scope' })
    .getByRole('button', { name: 'Auto Y for Aux scope' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('region', { name: 'Aux scope' })
    .getByLabel('Visible time window for Aux scope')).toHaveValue('5');
  await page.getByRole('button', { name: 'Activate Scope 1' }).click();
  await expect(page.locator('.channel-heading .channel-count')).toHaveText('4 / 7');
  await page.getByRole('button', { name: 'Delete Aux scope' }).click();
  await expect(page.locator('.scope-panel')).toHaveCount(1);

  await page.getByRole('button', { name: /Pause/ }).click();
  await expect(page.getByText('PAUSED')).toBeVisible();

  const autoY = page.getByRole('button', { name: 'Auto Y for Scope 1' });
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
  await page.locator('.brand-block').click();
  await expect(page.getByRole('dialog', { name: 'Style Error' })).toBeHidden();

  await page.getByRole('button', { name: 'Hide Error', exact: true }).click();
  await expect(page.locator('.channel-heading .channel-count')).toHaveText('3 / 7');
  await expect(page.locator('.legend-item')).toHaveCount(3);

  await page.getByRole('button', { name: 'Add panel' }).click();
  await page.getByRole('menuitem', { name: /Value bars/ }).click();
  const valuePicker = page.getByRole('dialog', { name: 'Channels for Value Bars 1' });
  await valuePicker.locator('.scope-picker-groups').getByRole('button', { name: /limit/ }).click();
  await expect(page.getByRole('region', { name: 'Value Bars 1' }).locator('.value-bar-item')).toHaveCount(3);
  await valuePicker.getByRole('button', { name: 'Clear' }).click();
  await valuePicker.getByRole('checkbox').filter({ hasText: 'Target' }).click();
  await valuePicker.getByRole('checkbox').filter({ hasText: 'Speed' }).click();
  await page.locator('.brand-block').click();
  await expect(valuePicker).toBeHidden();
  const valuePanel = page.getByRole('region', { name: 'Value Bars 1' });
  await expect(valuePanel.locator('.value-bar-item')).toHaveCount(2);
  await valuePanel.getByRole('button', { name: 'Edit minimum for Target' }).click();
  await valuePanel.getByLabel('Minimum for Target').fill('800');
  await valuePanel.getByLabel('Minimum for Target').press('Enter');
  await valuePanel.getByRole('button', { name: 'Edit maximum for Target' }).click();
  await valuePanel.getByLabel('Maximum for Target').fill('1600');
  await valuePanel.getByLabel('Maximum for Target').press('Enter');
  await expect(valuePanel.getByRole('button', { name: 'Use history range for Target' })).toBeVisible();
  await expect(valuePanel.locator('.value-bar-marker')).toHaveCount(2);

  const gridWidth = (await page.locator('.scope-grid').boundingBox())?.width ?? 1_000;
  const scopeOne = page.getByRole('region', { name: 'Scope 1' });
  await dragBy(page, scopeOne.getByRole('button', { name: 'Resize Scope 1' }), -gridWidth / 2, 0);
  await expect(scopeOne).toHaveAttribute('data-grid-width', '6');
  await dragBy(page, valuePanel.getByRole('button', { name: 'Resize Value Bars 1' }), -gridWidth / 2, 0);
  await dragBy(
    page,
    valuePanel.getByRole('button', { name: 'Move Value Bars 1' }),
    gridWidth / 2 + 6,
    -8 * 84,
  );
  await expect(valuePanel).toHaveAttribute('data-grid-x', '6');
  await expect(valuePanel).toHaveAttribute('data-grid-y', '0');

  await page.getByRole('button', { name: 'Add panel' }).click();
  await page.getByRole('menuitem', { name: /Indicators/ }).click();
  const indicatorPicker = page.getByRole('dialog', { name: 'Channels for Indicators 1' });
  await indicatorPicker.locator('.scope-picker-groups').getByRole('button', { name: /limit/ }).click();
  await page.getByRole('button', { name: 'Close channels for Indicators 1' }).click();
  const indicatorPanel = page.getByRole('region', { name: 'Indicators 1' });
  await expect(indicatorPanel.locator('.indicator-item')).toHaveCount(3);
  await indicatorPanel.getByRole('button', { name: 'Configure colors for Indicators 1' }).click();
  await expect(indicatorPanel.getByRole('dialog', { name: 'State colors for Indicators 1' })).toBeVisible();
  await indicatorPanel.getByLabel('State label 2').fill('Clear');
  await page.locator('.brand-block').click();
  await expect(indicatorPanel.getByRole('dialog', { name: 'State colors for Indicators 1' })).toBeHidden();
  await expect(indicatorPanel.locator('.indicator-state').first()).toHaveText(/^-?\d/);
  await expect(indicatorPanel.getByText('On', { exact: true })).toHaveCount(0);
  await page.locator('.workspace').evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({ path: '../../artifacts/debugscope-instruments.png', fullPage: true });

  await page.reload();
  await expect(page.locator('.scope-panel')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Scope 1' })).toHaveAttribute('data-grid-width', '6');
  await expect(page.getByRole('region', { name: 'Value Bars 1' })).toHaveAttribute('data-grid-x', '6');
  await expect(page.getByRole('region', { name: 'Value Bars 1' }).locator('.value-bar-item')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Value Bars 1' })
    .getByRole('button', { name: 'Edit minimum for Target' })).toHaveText('800');
  await expect(page.getByRole('region', { name: 'Value Bars 1' })
    .getByRole('button', { name: 'Edit maximum for Target' })).toHaveText('1,600');
  await expect(page.getByRole('region', { name: 'Indicators 1' }).locator('.indicator-item')).toHaveCount(3);

  await openSettings.click();
  const downloadPromise = page.waitForEvent('download');
  await settingsPanel.getByRole('button', { name: 'Export workspace' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('debugscope-control-loop.workspace.json');
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Workspace download did not produce a local file');
  const workspace = JSON.parse(await readFile(downloadPath, 'utf8')) as {
    schema: string;
    version: number;
    panels: Array<Record<string, unknown>>;
  };
  expect(workspace.schema).toBe('debugscope.workspace');
  expect(workspace.version).toBe(1);
  expect(workspace.panels).toHaveLength(3);
  expect(workspace.panels.find((panel) => panel.type === 'scope')).toMatchObject({
    autoY: true,
    windowSeconds: 10,
  });
  expect(workspace.panels.find((panel) => panel.type === 'value-bar')).toMatchObject({
    channelKeys: ['controller.target', 'controller.speed'],
    rangeMode: 'auto',
    manualMin: 0,
    manualMax: 1,
    channelRanges: {
      'controller.target': { mode: 'manual', min: 800, max: 1600 },
    },
    layout: { x: 6, y: 0, width: 6 },
  });
  expect(workspace.panels.find((panel) => panel.type === 'indicators')).toMatchObject({
    channelGroup: 'limit',
  });
  await page.getByRole('button', { name: 'Close settings panel' }).click();

  await page.getByRole('button', { name: 'Delete Indicators 1' }).click();
  await expect(page.locator('.scope-panel')).toHaveCount(2);
  await openSettings.click();
  await settingsPanel.getByLabel('Import workspace configuration').setInputFiles(downloadPath);
  await expect(settingsPanel.getByRole('status')).toContainText('Imported 3 panels');
  await page.getByRole('button', { name: 'Close settings panel' }).click();
  await expect(page.locator('.scope-panel')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Value Bars 1' })).toHaveAttribute('data-grid-x', '6');
  await page.getByRole('region', { name: 'Indicators 1' })
    .getByRole('button', { name: 'Configure colors for Indicators 1' })
    .click();
  await expect(page.getByLabel('State label 2')).toHaveValue('Clear');
  await page.getByRole('button', { name: 'Close colors for Indicators 1' }).click();
  const restoredValuePanel = page.getByRole('region', { name: 'Value Bars 1' });
  await restoredValuePanel.getByRole('button', { name: 'Use history range for Target' }).click();
  await expect(restoredValuePanel.getByRole('button', {
    name: 'Reset learned range for Target',
  })).toBeVisible();

  await page.getByRole('button', { name: /Pause/ }).click();

  await page.getByLabel('Visible time window for Scope 1').selectOption('5');
  await page.getByRole('button', { name: /Resume/ }).click();
  await expect(page.getByText('DEMO LIVE', { exact: true })).toBeVisible();

  const plotOverlay = page.locator('.u-over');
  await plotOverlay.hover({ position: { x: 500, y: 100 } });
  await page.mouse.wheel(0, -220);
  await expect(page.getByRole('button', { name: 'Return to live' })).toBeVisible();
  await plotOverlay.dblclick({ position: { x: 500, y: 100 } });
  await expect(page.getByRole('button', { name: 'Return to live' })).toBeHidden();

  for (const channel of ['Target', 'Speed', 'Estimate']) {
    await page.getByRole('button', { name: `Hide ${channel}`, exact: true }).click();
  }
  await expect(page.getByText('No channels in Scope 1')).toBeVisible();
  await page.getByRole('button', { name: 'Show all channels' }).click();
  await expect(page.locator('.channel-heading .channel-count')).toHaveText('7 / 7');

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

test('workspace panels can be prepared without a producer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByText('Waiting for a producer')).toBeVisible();

  await page.getByRole('button', { name: 'Add panel' }).click();
  await page.getByRole('menuitem', { name: /Value bars/ }).click();
  await expect(page.getByText('No value channels selected')).toBeVisible();
  await page.getByRole('button', { name: 'Close channels for Value Bars 1' }).click();

  await page.getByRole('button', { name: 'Add panel' }).click();
  await page.getByRole('menuitem', { name: /Indicators/ }).click();
  await page.getByRole('button', { name: 'Close channels for Indicators 1' }).click();
  await expect(page.getByText('No state channels selected')).toBeVisible();
  await page.reload();
  await expect(page.locator('.scope-panel')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Value Bars 1' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Indicators 1' })).toBeVisible();
});
