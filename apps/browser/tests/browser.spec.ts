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
  await expect(page.locator('.channel-row[aria-label="controller.target"]')).toHaveCount(0);
  await page.getByPlaceholder('Filter channels').fill('Target');
  await expect(controllerGroup).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.channel-row[aria-label="controller.target"]')).toBeVisible();
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
  const fontSizeSlider = settingsPanel.getByRole('slider', { name: 'Font size' });
  await fontSizeSlider.fill('140');
  await expect(page.locator('html')).toHaveCSS('--font-scale', '1.4');
  await expect(page.locator('.plot-stage')).toHaveAttribute('data-axis-font-size', '20');
  await page.screenshot({ path: '../../artifacts/debugscope-settings.png', fullPage: true });
  await idleScrollSwitch.click();
  await expect(idleScrollSwitch).toHaveAttribute('aria-checked', 'true');
  await page.locator('.brand-block').click();
  await expect(settingsPanel).toBeHidden();
  await page.reload();
  await expect(page.locator('.uplot')).toBeVisible();
  await openSettings.click();
  await expect(idleScrollSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(fontSizeSlider).toHaveValue('140');
  await fontSizeSlider.fill('100');
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
  await expect(page.locator('.scope-panel:not(.panel-sources)')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Scope 2' }).locator('.legend-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Activate Scope 2' }).dblclick();
  const scopeTitleInput = page.getByRole('textbox', { name: 'Rename Scope 2' });
  await scopeTitleInput.fill('Aux scope');
  await scopeTitleInput.press('Enter');
  const auxScope = page.getByRole('region', { name: 'Aux scope' });
  await expect(auxScope).toBeVisible();
  await auxScope.getByLabel('Y axis mode for Aux scope').selectOption('manual');
  await page.waitForTimeout(250);
  await expect(auxScope.locator('.plot-stage')).toHaveAttribute('data-y-min', /\d/);
  await expect(auxScope.locator('.plot-stage')).toHaveAttribute('data-y-max', /\d/);
  await auxScope.getByLabel('Visible time window for Aux scope').fill('5');
  await auxScope.getByLabel('Visible time window for Aux scope').blur();
  await expect(page.getByRole('region', { name: 'Scope 1' })
    .getByLabel('Y axis mode for Scope 1')).toHaveValue('fit');
  await expect(page.getByRole('region', { name: 'Scope 1' })
    .getByLabel('Visible time window for Scope 1')).toHaveValue('10');
  await expect(page.locator('.channel-heading .channel-count')).toHaveText('2 / 7');
  await page.screenshot({ path: '../../artifacts/debugscope-multiple-scopes.png', fullPage: true });

  await page.reload();
  await expect(page.locator('.scope-panel:not(.panel-sources)')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Aux scope' }).locator('.legend-item')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Aux scope' })
    .getByLabel('Y axis mode for Aux scope')).toHaveValue('manual');
  await expect(page.getByRole('region', { name: 'Aux scope' }).locator('.plot-stage'))
    .toHaveAttribute('data-y-min', /\d/);
  await expect(page.getByRole('region', { name: 'Aux scope' })
    .getByLabel('Visible time window for Aux scope')).toHaveValue('5');
  await page.getByRole('button', { name: 'Activate Scope 1' }).click();
  await expect(page.locator('.channel-heading .channel-count')).toHaveText('4 / 7');
  await page.getByRole('button', { name: 'Delete Aux scope' }).click();
  await expect(page.locator('.scope-panel:not(.panel-sources)')).toHaveCount(1);

  await page.getByRole('button', { name: /Pause/ }).click();
  await expect(page.getByText('PAUSED')).toBeVisible();

  const yAxisMode = page.getByLabel('Y axis mode for Scope 1');
  await expect(yAxisMode).toHaveValue('fit');
  await yAxisMode.selectOption('zero-min');
  await expect(yAxisMode).toHaveValue('zero-min');
  await yAxisMode.selectOption('zero-max');
  await expect(yAxisMode).toHaveValue('zero-max');
  await yAxisMode.selectOption('manual');
  await expect(yAxisMode.locator('..')).toHaveAttribute('title', /wheel to zoom Y/);
  await yAxisMode.selectOption('fit');

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
  await dragBy(page, scopeOne.getByRole('button', { name: 'Move Scope 1' }), -gridWidth, 400);
  await dragBy(page, scopeOne.getByRole('button', { name: 'Resize Scope 1' }), -gridWidth / 4, 0);
  await expect(scopeOne).toHaveAttribute('data-grid-width', '6');
  await dragBy(page, valuePanel.getByRole('button', { name: 'Resize Value Bars 1' }), -gridWidth, 0);
  await dragBy(
    page,
    valuePanel.getByRole('button', { name: 'Move Value Bars 1' }),
    gridWidth,
    -8 * 84,
  );
  await expect(valuePanel).toHaveAttribute('data-grid-x', '10');
  const valueY = Number(await valuePanel.getAttribute('data-grid-y'));
  const leftBounds = await scopeOne.boundingBox();
  const rightBounds = await valuePanel.boundingBox();
  expect(leftBounds).not.toBeNull();
  expect(rightBounds).not.toBeNull();
  await expect.poll(async () => {
    const left = (await scopeOne.boundingBox())!;
    const right = (await valuePanel.boundingBox())!;
    return Math.max(0, left.x + left.width - right.x);
  }).toBeLessThanOrEqual(1);
  await expect(page.locator('.workspace')).toHaveCSS('padding', '0px');
  await expect(page.locator('.scope-grid')).toHaveCSS('gap', '0px');

  await page.getByRole('button', { name: 'Add panel' }).click();
  await page.getByRole('menuitem', { name: /Indicators/ }).click();
  const indicatorPicker = page.getByRole('dialog', { name: 'Channels for Indicators 1' });
  await indicatorPicker.locator('.scope-picker-groups').getByRole('button', { name: /limit/ }).click();
  await page.getByRole('button', { name: 'Close channels for Indicators 1' }).click();
  const indicatorPanel = page.getByRole('region', { name: 'Indicators 1' });
  await expect(indicatorPanel.locator('.indicator-item')).toHaveCount(3);
  await expect(indicatorPanel.locator('.legend-item')).toHaveCount(0);
  await expect(indicatorPanel.locator('.indicator-group-name')).toHaveText('limit');
  await expect(indicatorPanel.locator('.indicator-copy small')).toHaveCount(0);
  await expect(indicatorPanel.locator('.indicator-item').first()).toHaveAttribute('title', /limit\.0/);
  await dragBy(
    page,
    indicatorPanel.getByRole('button', { name: 'Resize Indicators 1' }),
    -gridWidth,
    -1_000,
  );
  await expect(indicatorPanel).toHaveAttribute('data-grid-width', '2');
  await expect(indicatorPanel).toHaveAttribute('data-grid-height', '1');
  await indicatorPanel.getByRole('button', { name: 'Configure colors for Indicators 1' }).click();
  await expect(page.getByRole('dialog', { name: 'State colors for Indicators 1' })).toBeVisible();
  await page.getByLabel('State label 2').fill('Clear');
  await page.locator('.brand-block').click();
  await expect(page.getByRole('dialog', { name: 'State colors for Indicators 1' })).toBeHidden();
  await expect(indicatorPanel.locator('.indicator-state').first()).toHaveText(/^-?\d/);
  await expect(indicatorPanel.getByText('On', { exact: true })).toHaveCount(0);
  await page.locator('.workspace').evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({ path: '../../artifacts/debugscope-instruments.png', fullPage: true });

  await page.reload();
  await expect(page.locator('.scope-panel:not(.panel-sources)')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Scope 1' })).toHaveAttribute('data-grid-width', '6');
  await expect(page.getByRole('region', { name: 'Value Bars 1' })).toHaveAttribute('data-grid-x', '10');
  await expect(page.getByRole('region', { name: 'Value Bars 1' }).locator('.value-bar-item')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Value Bars 1' })
    .getByRole('button', { name: 'Edit minimum for Target' })).toHaveText('800');
  await expect(page.getByRole('region', { name: 'Value Bars 1' })
    .getByRole('button', { name: 'Edit maximum for Target' })).toHaveText('1600');
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
  expect(workspace.panels).toHaveLength(4);
  expect(workspace.panels.find((panel) => panel.type === 'scope')).toMatchObject({
    yScaleMode: 'fit',
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
    layout: { x: 10, y: valueY, width: 2 },
  });
  expect(workspace.panels.find((panel) => panel.type === 'indicators')).toMatchObject({
    channelGroup: 'limit',
  });
  await page.getByRole('button', { name: 'Close settings panel' }).click();

  await page.getByRole('button', { name: 'Delete Indicators 1' }).click();
  await expect(page.locator('.scope-panel:not(.panel-sources)')).toHaveCount(2);
  await openSettings.click();
  await settingsPanel.getByLabel('Import workspace configuration').setInputFiles(downloadPath);
  await expect(settingsPanel.getByRole('status')).toContainText('Imported 4 panels');
  await page.getByRole('button', { name: 'Close settings panel' }).click();
  await expect(page.locator('.scope-panel:not(.panel-sources)')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Value Bars 1' })).toHaveAttribute('data-grid-x', '10');
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

  await page.getByLabel('Visible time window for Scope 1').fill('5');
  await page.getByLabel('Visible time window for Scope 1').blur();
  await page.getByRole('button', { name: /Resume/ }).click();
  await expect(page.getByText('DEMO LIVE', { exact: true })).toBeVisible();

  const plotOverlay = page.locator('.u-over');
  await yAxisMode.selectOption('manual');
  await plotOverlay.hover({ position: { x: 300, y: 100 } });
  await page.mouse.wheel(0, -220);
  await expect(page.getByRole('button', { name: 'Return to live' })).toBeHidden();
  await plotOverlay.dblclick({ position: { x: 300, y: 100 } });
  await yAxisMode.selectOption('fit');
  await plotOverlay.hover({ position: { x: 300, y: 100 } });
  await page.mouse.wheel(0, -220);
  await expect(page.getByRole('button', { name: 'Return to live' })).toBeVisible();
  await plotOverlay.dblclick({ position: { x: 300, y: 100 } });
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

test('compact layout includes the default configuration panel in the flow', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await page.goto('/?demo=1');
  const sources = page.getByRole('region', { name: 'Programs & Channels', exact: true });
  const scope = page.getByRole('region', { name: 'Scope 1', exact: true });
  await expect(sources).toBeVisible();
  const before = (await scope.boundingBox())!.y;
  await sources.getByRole('button', { name: 'Collapse Programs & Channels', exact: true }).click();
  await expect.poll(async () => Math.round((await sources.boundingBox())!.height)).toBe(28);
  await expect.poll(async () => (await scope.boundingBox())!.y).toBeLessThan(before);
});

test('workspace panels collapse and reflow vertically', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?demo=1');

  await page.getByRole('button', { name: 'Add panel' }).click();
  await page.getByRole('menuitem', { name: /Value bars/ }).click();
  await page.getByRole('button', { name: 'Close channels for Value Bars 1' }).click();

  const scope = page.getByRole('region', { name: 'Scope 1' });
  const valueBars = page.getByRole('region', { name: 'Value Bars 1' });
  await expect(scope).toHaveAttribute('data-grid-height', '8');
  await expect(valueBars).toHaveAttribute('data-grid-y', '8');

  const reflowStarted = page.waitForFunction(() => (
    (document.querySelector('[data-panel-id^="scope-default"]')?.getAnimations().length ?? 0) > 0
  ));
  await scope.getByRole('button', { name: 'Collapse Scope 1' }).click();
  await reflowStarted;
  await expect(scope).toHaveAttribute('aria-expanded', 'false');
  await expect(scope).toHaveAttribute('data-grid-height', '0.5');
  await expect.poll(async () => Math.round((await scope.boundingBox())?.height ?? 0)).toBe(42);
  await expect(scope.locator('.plot-stage')).toHaveCount(0);
  await expect(valueBars).toHaveAttribute('data-grid-y', '4');

  await page.reload();
  const restoredScope = page.getByRole('region', { name: 'Scope 1' });
  const restoredValueBars = page.getByRole('region', { name: 'Value Bars 1' });
  await expect(restoredScope).toHaveAttribute('aria-expanded', 'false');
  await expect(restoredValueBars).toHaveAttribute('data-grid-y', '4');

  await restoredScope.getByRole('button', { name: 'Expand Scope 1' }).click();
  await expect(restoredScope).toHaveAttribute('data-grid-height', '8');
  await expect(restoredValueBars).toHaveAttribute('data-grid-y', '8');
  await expect(restoredScope.locator('.plot-stage')).toBeVisible();
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
  await expect(page.locator('.scope-panel:not(.panel-sources)')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Value Bars 1' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Indicators 1' })).toBeVisible();
});


test('interface styles and configuration sections persist with thin panel headers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo=1');
  await expect(page.locator('.sidebar-footer')).toHaveCount(0);
  await expect(page.locator('.brand-mark')).not.toHaveAttribute('role', 'button');
  await expect(page.locator('.sidebar-toggle')).toBeHidden();
  const channelsTop = (await page.locator('.channels-section').boundingBox())?.y ?? 0;
  await page.getByRole('button', { name: 'Collapse programs', exact: true }).click();
  await expect(page.locator('.source-list')).toHaveCount(0);
  await expect.poll(async () => (await page.locator('.channels-section').boundingBox())?.y ?? 0)
    .toBeLessThan(channelsTop);
  await page.getByRole('button', { name: 'Collapse channels', exact: true }).click();
  await expect(page.locator('.search-box')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByLabel('Interface style').selectOption('cards');
  await page.keyboard.press('Escape');
  await expect(page.locator('.workspace')).toHaveCSS('padding', '12px');
  await expect(page.locator('.scope-panel:not(.panel-sources)').first()).toHaveCSS('border-radius', '8px');
  const scope = page.getByRole('region', { name: 'Scope 1' });
  await scope.getByRole('button', { name: 'Collapse Scope 1', exact: true }).click();
  await expect.poll(async () => Math.round((await scope.boundingBox())!.height)).toBe(30);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-visual-style', 'cards');
  await expect(page.locator('.panel-sources')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand programs', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand channels', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand programs', exact: true }).click();
  await page.getByRole('button', { name: 'Expand channels', exact: true }).click();
  await expect(page.locator('.source-list')).toBeVisible();
  await expect(page.locator('.search-box')).toBeVisible();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByLabel('Interface style').selectOption('compact');
  await page.keyboard.press('Escape');
  await expect.poll(async () => Math.round((await scope.boundingBox())!.height)).toBe(42);
  await expect(page.locator('.workspace')).toHaveCSS('padding', '0px');
  await scope.getByRole('button', { name: 'Expand Scope 1', exact: true }).click();
  await expect(scope.locator('.scope-y-control')).toHaveCSS('height', '22px');
});

test('configuration is a persistent movable grid panel and frees space when collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo=1');
  const sources = page.getByRole('region', { name: 'Programs & Channels', exact: true });
  const scope = page.getByRole('region', { name: 'Scope 1', exact: true });
  await expect(page.locator('.scope-grid > .panel-sources')).toHaveCount(1);
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(sources).toHaveAttribute('data-grid-x', '0');
  await expect(sources).toHaveAttribute('data-grid-width', '3');
  await expect(scope).toHaveAttribute('data-grid-x', '3');
  const panelBackground = await scope.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(sources.locator('.sources-panel-content')).toHaveCSS('background-color', panelBackground);

  await expect(scope).toHaveAttribute('data-grid-y', '0');
  await page.getByRole('button', { name: 'Add panel' }).click();
  await page.getByRole('menuitem', { name: /Value bars/ }).click();
  await page.getByRole('button', { name: 'Close channels for Value Bars 1' }).click();
  const belowSources = page.getByRole('region', { name: 'Value Bars 1', exact: true });
  const workspaceWidth = (await page.locator('.scope-grid').boundingBox())!.width;
  await dragBy(page, belowSources.getByRole('button', { name: 'Resize Value Bars 1' }), -workspaceWidth * 0.75, 0);
  await dragBy(page, belowSources.getByRole('button', { name: 'Move Value Bars 1' }), 0, -325);
  await expect(belowSources).toHaveAttribute('data-grid-y', '4.25');
  await sources.getByRole('button', { name: 'Collapse channels', exact: true }).click();
  await expect(sources.locator('.search-box')).toHaveCount(0);
  await expect(sources.locator('.source-list')).toBeVisible();
  await sources.getByRole('button', { name: 'Collapse Programs & Channels', exact: true }).click();
  await expect(scope).toHaveAttribute('data-grid-y', '0');
  await expect.poll(async () => Math.round((await sources.boundingBox())!.height)).toBe(42);
  await page.reload();
  await expect(sources).toHaveAttribute('aria-expanded', 'false');
  await expect(belowSources).toHaveAttribute('data-grid-y', '0.5');
  await expect(scope).toHaveAttribute('data-grid-y', '0');
  await sources.getByRole('button', { name: 'Expand Programs & Channels', exact: true }).click();
  await expect(scope).toHaveAttribute('data-grid-y', '0');
  await expect(sources.getByRole('button', { name: 'Expand channels', exact: true })).toBeVisible();
  const gridWidth = (await page.locator('.scope-grid').boundingBox())!.width;
  await dragBy(page, sources.getByRole('button', { name: 'Resize Programs & Channels', exact: true }), gridWidth / 4, 84);
  await expect(sources).toHaveAttribute('data-grid-width', '6');
  await expect(sources).toHaveAttribute('data-grid-height', '5');
  await dragBy(page, sources.getByRole('button', { name: 'Move Programs & Channels', exact: true }), gridWidth / 2, 0);
  await expect(sources).toHaveAttribute('data-grid-x', '6');
  await page.reload();
  await expect(sources).toHaveAttribute('data-grid-x', '6');
  await expect(sources).toHaveAttribute('data-grid-height', '5');
});

test('previous top default migrates to the left without losing channels', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('debugscope.scope-layouts.v1', JSON.stringify({
      __debugscope_workspace_template__: [
        { id: 'sources-default', type: 'sources', title: 'Programs & Channels', channelKeys: [],
          layout: { x: 0, y: 0, width: 12, height: 4 } },
        { id: 'scope-existing', type: 'scope', title: 'Existing scope', channelKeys: ['controller.target'],
          layout: { x: 0, y: 4, width: 12, height: 8 }, yScaleMode: 'fit', windowMode: 'auto', windowSeconds: 10 },
      ],
    }));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo=1');
  await expect(page.locator('.panel-sources')).toHaveAttribute('data-grid-width', '3');
  const scope = page.getByRole('region', { name: 'Existing scope' });
  await expect(scope).toHaveAttribute('data-grid-x', '3');
  await expect(scope).toHaveAttribute('data-grid-y', '0');
  await expect(scope.locator('.legend-item')).toHaveCount(1);
});

test('collapsed panels do not lock dragging or resizing and keep their expanded size', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo=1');
  const sources = page.getByRole('region', { name: 'Programs & Channels', exact: true });
  const scope = page.getByRole('region', { name: 'Scope 1', exact: true });
  const width = (await page.locator('.scope-grid').boundingBox())!.width;
  await sources.getByRole('button', { name: 'Collapse Programs & Channels', exact: true }).click();
  await expect(sources.getByRole('button', { name: 'Move Programs & Channels', exact: true })).toBeEnabled();
  await expect(scope.getByRole('button', { name: 'Move Scope 1' })).toBeEnabled();
  await expect(scope.getByRole('button', { name: 'Resize Scope 1' })).toBeEnabled();
  await dragBy(page, scope.getByRole('button', { name: 'Resize Scope 1' }), -width / 4, 84);
  await expect(scope).toHaveAttribute('data-grid-width', '6');
  await expect(scope).toHaveAttribute('data-grid-height', '9');
  await dragBy(page, scope.getByRole('button', { name: 'Move Scope 1' }), width / 4, 0);
  await expect(scope).toHaveAttribute('data-grid-x', '6');
  // Use actual pointer events for the folded header, including an overlapping drop.
  const handle = await sources.getByRole('button', { name: 'Move Programs & Channels', exact: true }).boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + width / 2, handle!.y + handle!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(sources).toHaveAttribute('data-grid-x', '6');
  await expect(sources).toHaveAttribute('aria-expanded', 'false');
  await expect(scope).toHaveAttribute('data-grid-y', '0.5');
  await page.reload();
  await expect(sources).toHaveAttribute('data-grid-x', '6');
  await expect(scope).toHaveAttribute('data-grid-y', '0.5');
  await sources.getByRole('button', { name: 'Expand Programs & Channels', exact: true }).click();
  await expect(sources).toHaveAttribute('data-grid-height', '4');
  await expect(scope).toHaveAttribute('data-grid-y', '4');
  await expect(scope).toHaveAttribute('data-grid-height', '9');
});

test('drag follows the pointer continuously and settles onto a fine grid', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo=1');
  const sources = page.getByRole('region', { name: 'Programs & Channels', exact: true });
  const original = (await sources.boundingBox())!;
  const handle = (await sources.getByRole('button', { name: 'Move Programs & Channels', exact: true }).boundingBox())!;
  const startX = handle.x + handle.width / 2;
  const startY = handle.y + handle.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 17, startY + 17);
  await expect.poll(async () => Math.round((await sources.boundingBox())!.x - original.x)).toBe(17);
  await expect.poll(async () => Math.round((await sources.boundingBox())!.y - original.y)).toBe(17);
  await page.mouse.move(startX + 19, startY + 19);
  await expect.poll(async () => Math.round((await sources.boundingBox())!.x - original.x)).toBe(19);
  await page.mouse.up();
  await expect.poll(async () => Math.round((await sources.boundingBox())!.x - original.x)).toBe(Math.round((await page.locator('.scope-grid').boundingBox())!.width / 48));
  await expect.poll(async () => Math.round((await sources.boundingBox())!.y - original.y)).toBe(21);
  const x = await sources.getAttribute('data-grid-x');
  const y = await sources.getAttribute('data-grid-y');
  await page.reload();
  await expect(sources).toHaveAttribute('data-grid-x', x!);
  await expect(sources).toHaveAttribute('data-grid-y', y!);
  // Escape restores the layout, including when the final pointer event is still queued.
  await sources.getByRole('button', { name: 'Move Programs & Channels', exact: true }).dispatchEvent('pointerdown', {
    button: 0, clientX: 50, clientY: 50,
  });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 200 })));
  await page.keyboard.press('Escape');
  await expect(sources).toHaveAttribute('data-grid-x', x!);
  await expect(sources).toHaveAttribute('data-grid-y', y!);
});

test('empty space follows every pointer step and only snaps to the grid on release', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto('/?demo=1');
  const sources = page.getByRole('region', { name: 'Programs & Channels', exact: true });
  const before = (await sources.boundingBox())!;
  const handle = (await sources.getByRole('button', { name: 'Move Programs & Channels', exact: true }).boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Below all neighbors, even movement close to the workspace's left edge is free.
  for (const offset of [5, 9, 18, 26, 33, 19]) {
    await page.mouse.move(x + offset, y + 800 + offset);
    await expect.poll(async () => Math.round((await sources.boundingBox())!.x - before.x)).toBe(offset);
    await expect.poll(async () => Math.round((await sources.boundingBox())!.y - before.y)).toBe(800 + offset);
  }
  await page.mouse.up();
  await expect.poll(async () => Math.round((await sources.boundingBox())!.x - before.x)).toBe(Math.round((await page.locator('.scope-grid').boundingBox())!.width / 48));
  await expect.poll(async () => Math.round((await sources.boundingBox())!.y - before.y)).toBe(819);
});

test('displaced neighbors leave no invisible edge magnets behind', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo=1');
  const sources = page.getByRole('region', { name: 'Programs & Channels', exact: true });
  const scope = page.getByRole('region', { name: 'Scope 1', exact: true });
  const before = (await sources.boundingBox())!;
  const handle = (await sources.getByRole('button', { name: 'Move Programs & Channels', exact: true }).boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y);
  await expect(scope).toHaveAttribute('data-grid-y', '4');
  await page.waitForTimeout(200);
  await page.mouse.move(x + 5, y);
  await expect.poll(async () => Math.round((await sources.boundingBox())!.x - before.x)).toBe(5);
  await expect(scope).toHaveAttribute('data-grid-y', '4');
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('edge magnets hold small overlaps on release and let deliberate moves push neighbors', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo=1');
  const sources = page.getByRole('region', { name: 'Programs & Channels', exact: true });
  const scope = page.getByRole('region', { name: 'Scope 1', exact: true });
  const originalX = await sources.getAttribute('data-grid-x');
  const originalY = await scope.getAttribute('data-grid-y');
  const handle = (await sources.getByRole('button', { name: 'Move Programs & Channels', exact: true }).boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 5, y);
  await expect(sources).toHaveAttribute('data-grid-x', originalX!);
  await page.mouse.move(x + 18, y);
  await page.waitForTimeout(200);
  await expect(sources).toHaveAttribute('data-grid-x', originalX!);
  await expect(scope).toHaveAttribute('data-grid-y', originalY!);
  await page.mouse.up();
  await expect(sources).toHaveAttribute('data-grid-x', originalX!);
  await expect(scope).toHaveAttribute('data-grid-y', originalY!);
  await page.reload();
  await expect(sources).toHaveAttribute('data-grid-x', originalX!);
  await expect(scope).toHaveAttribute('data-grid-y', originalY!);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 5, y);
  await page.mouse.move(x + 24, y);
  await expect(scope).toHaveAttribute('data-grid-y', '4');
  await page.mouse.up();
  await expect(scope).toHaveAttribute('data-grid-y', '4');
});

test('crossing panel edges does not repeatedly push neighbors during a drag', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo=1');
  const sources = page.getByRole('region', { name: 'Programs & Channels', exact: true });
  const scope = page.getByRole('region', { name: 'Scope 1', exact: true });
  const before = (await scope.boundingBox())!;
  const handle = (await sources.getByRole('button', { name: 'Move Programs & Channels', exact: true }).boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const offset of [18, 0, 24, 0, 30]) {
    await page.mouse.move(x + offset, y);
    // Wait for the next rendered frame, then measure the geometry, not just state.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const current = (await scope.boundingBox())!;
    expect(Math.abs(current.y - before.y)).toBeLessThan(1);
    expect(Math.abs(current.height - before.height)).toBeLessThan(1);
    expect(await scope.evaluate((element) => element.getAnimations().length)).toBe(0);
  }
  // Steady pointer motion within the same collision must not postpone preview forever.
  for (const offset of [31, 32, 33, 34, 35, 36]) {
    await page.mouse.move(x + offset, y);
    await page.waitForTimeout(30);
  }
  await expect(scope).toHaveAttribute('data-grid-y', '4');
  await expect(page.locator('body')).toHaveAttribute('data-layout-interaction', 'move');
  await expect.poll(async () => (await scope.boundingBox())!.y).toBeGreaterThan(before.y + 300);
  await page.mouse.move(x, y);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(scope).toHaveAttribute('data-grid-y', '4');
  await page.mouse.move(x + 30, y);
  await expect(scope).toHaveAttribute('data-grid-y', '4');
  await page.mouse.up();
  await expect(scope).toHaveAttribute('data-grid-y', '4');
  await page.reload();
  await expect(scope).toHaveAttribute('data-grid-y', '4');
  await sources.getByRole('button', { name: 'Move Programs & Channels', exact: true }).dispatchEvent('pointerdown', {
    button: 0, clientX: 50, clientY: 50,
  });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 80, clientY: 200 })));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await expect(scope).toHaveAttribute('data-grid-y', '4');
  await expect(page.locator('body')).not.toHaveAttribute('data-layout-interaction');
});

for (const overshoot of [-6, 6]) {
  test(`resize aligns with the panel above and beside it from ${overshoot}px off the edge`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('debugscope.scope-layouts.v1', JSON.stringify({
        __debugscope_workspace_template__: [
          { id: 'sources', type: 'sources', title: 'Programs & Channels', channelKeys: [], layout: { x: 0, y: 0, width: 3, height: 4 } },
          { id: 'above', type: 'indicators', title: 'Above', channelKeys: [], layout: { x: 3, y: 0, width: 8.13, height: 2 } },
          { id: 'beside', type: 'indicators', title: 'Beside', channelKeys: [], layout: { x: 3, y: 2, width: 4, height: 1.27 } },
          { id: 'resized', type: 'indicators', title: 'Resized', channelKeys: [], layout: { x: 7, y: 2, width: 3, height: 1 } },
        ],
      }));
    });
    await page.goto('/');
    const panel = page.getByRole('region', { name: 'Resized', exact: true });
    const above = page.getByRole('region', { name: 'Above', exact: true });
    const beside = page.getByRole('region', { name: 'Beside', exact: true });
    const rect = (await panel.boundingBox())!;
    const top = (await above.boundingBox())!;
    const left = (await beside.boundingBox())!;
    await dragBy(page, panel.getByRole('button', { name: 'Resize Resized', exact: true }),
      top.x + top.width - rect.x - rect.width + overshoot,
      left.y + left.height - rect.y - rect.height + overshoot);
    await expect.poll(async () => {
      const current = (await panel.boundingBox())!;
      return Math.abs(current.x + current.width - top.x - top.width);
    }).toBeLessThan(1);
    await expect.poll(async () => {
      const current = (await panel.boundingBox())!;
      return Math.abs(current.y + current.height - left.y - left.height);
    }).toBeLessThan(1);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('debugscope.scope-layouts.v1')!));
    const layout = stored.__debugscope_workspace_template__.find((item: { id: string }) => item.id === 'resized').layout;
    expect(layout.x + layout.width).toBeCloseTo(11.25);
    expect(layout.y + layout.height).toBeCloseTo(3.25);
  });
}

for (const viewportWidth of [1100, 1700]) {
  test(`move and resize settle on shared grid lines at width ${viewportWidth}`, async ({ page }) => {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await page.goto('/?demo=1');
    const sources = page.getByRole('region', { name: 'Programs & Channels', exact: true });
    const before = (await sources.boundingBox())!;
    await dragBy(page, sources.getByRole('button', { name: 'Move Programs & Channels', exact: true }), 19, 19);
    await expect.poll(async () => Math.round((await sources.boundingBox())!.x - before.x)).toBe(Math.round((await page.locator('.scope-grid').boundingBox())!.width / 48));
    await expect.poll(async () => Math.round((await sources.boundingBox())!.y - before.y)).toBe(21);
    const moved = (await sources.boundingBox())!;
    await dragBy(page, sources.getByRole('button', { name: 'Resize Programs & Channels', exact: true }), 19, 19);
    await expect.poll(async () => Math.round((await sources.boundingBox())!.width - moved.width)).toBe(Math.round((await page.locator('.scope-grid').boundingBox())!.width / 48));
    await expect.poll(async () => Math.round((await sources.boundingBox())!.height - moved.height)).toBe(21);
    await page.reload();
    await expect.poll(async () => Math.round((await sources.boundingBox())!.width - moved.width)).toBe(Math.round((await page.locator('.scope-grid').boundingBox())!.width / 48));
    await expect.poll(async () => Math.round((await sources.boundingBox())!.height - moved.height)).toBe(21);
  });
}
