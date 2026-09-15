import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Only replace the browser sharing chooser/crop boundary. Encode actual frames
// with the browser's MediaRecorder and verify the downloaded video decodes.
async function captureFixture(page: Page, mode: 'ok' | 'cancel' | 'wrong-tab' = 'ok') {
  await page.addInitScript(mode => {
    const state = window as unknown as {
      CropTarget: unknown; captureTrack: MediaStreamTrack; croppedPanel: string | null;
    };
    state.CropTarget = { fromElement: async (element: Element) => element };
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      if (mode === 'cancel') throw new DOMException('Cancelled', 'NotAllowedError');
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d')!;
      const paint = () => { context.fillStyle = '#24ab56'; context.fillRect(0, 0, 320, 180); };
      paint();
      const stream = canvas.captureStream(30);
      const timer = setInterval(paint, 30);
      const track = stream.getVideoTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      Object.assign(track, { cropTo: async (element: Element) => {
        if (mode === 'wrong-tab') throw new Error('Wrong tab');
        state.croppedPanel = element.getAttribute('aria-label');
      } });
      state.captureTrack = track;
      return stream;
    } });
  }, mode);
}

test('every panel has a recording control, including collapsed panels', async ({ page }) => {
  await page.goto('/?demo=1');
  for (const name of [/Value bars/, /Indicators/, /Wristed instrument/]) {
    await page.getByRole('button', { name: 'Add panel', exact: true }).click();
    await page.getByRole('menuitem', { name }).click();
  }
  const panels = page.locator('[data-panel-id]');
  await expect(panels).toHaveCount(5);
  for (const panel of await panels.all()) {
    const name = await panel.getAttribute('aria-label');
    await expect(panel.getByRole('button', { name: `Record ${name}`, exact: true })).toBeVisible();
    await panel.getByRole('button', { name: `Collapse ${name}`, exact: true }).click();
    await expect(panel.getByRole('button', { name: `Record ${name}`, exact: true })).toBeVisible();
  }
});

for (const stop of ['button', 'sharing', 'remove'] as const) {
  test(`recording downloads playable panel video when stopped via ${stop}`, async ({ page }) => {
    await captureFixture(page);
    await page.goto('/?demo=1');
    if (stop === 'remove') {
      await page.getByRole('button', { name: 'Add panel', exact: true }).click();
      await page.getByRole('menuitem', { name: /Waveform/ }).click();
    }
    await page.getByRole('button', { name: 'Record Scope 1', exact: true }).click();
    const stopButton = page.getByRole('button', { name: 'Stop recording Scope 1', exact: true });
    await expect(stopButton).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).croppedPanel)).toBe('Scope 1');
    await expect(stopButton).toContainText('0:01');
    const download = page.waitForEvent('download');
    if (stop === 'button') await stopButton.click();
    else if (stop === 'sharing') await page.evaluate(() => (window as any).captureTrack.dispatchEvent(new Event('ended')));
    else await page.getByRole('button', { name: 'Delete Scope 1', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^Scope 1-.*\.webm$/);
    const bytes = await readFile((await file.path())!);
    expect(bytes.length).toBeGreaterThan(100);
    const decoded = await page.evaluate(async base64 => {
      const video = document.createElement('video');
      video.src = `data:video/webm;base64,${base64}`;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('Video did not decode'));
      });
      return [video.videoWidth, video.videoHeight];
    }, bytes.toString('base64'));
    expect(decoded).toEqual([320, 180]);
    await expect.poll(() => page.evaluate(() => (window as any).captureTrack.readyState)).toBe('ended');
    if (stop !== 'remove') await expect(page.getByRole('button', { name: 'Record Scope 1', exact: true })).toBeEnabled();
  });
}

for (const mode of ['cancel', 'wrong-tab'] as const) {
  test(`${mode} never records the uncropped tab and releases capture`, async ({ page }) => {
    await captureFixture(page, mode);
    await page.goto('/?demo=1');
    const record = page.getByRole('button', { name: 'Record Scope 1', exact: true });
    await record.click();
    await expect(record).toBeEnabled();
    await expect(record).toHaveAttribute('aria-pressed', 'false');
    if (mode === 'wrong-tab') {
      await expect(page.getByRole('alert')).toContainText('Select the current DebugScope tab');
      await expect.poll(() => page.evaluate(() => (window as any).captureTrack.readyState)).toBe('ended');
    } else await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('unsupported browsers explain recording requirements', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'CropTarget', { value: undefined }));
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Record Scope 1', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Region Capture');
});
