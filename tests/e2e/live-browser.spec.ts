import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const LIVE_UDP_PORT = 49_171;

function runLiveProducer(): Promise<void> {
  const workspaceRoot = process.cwd();
  return new Promise((resolvePromise, rejectPromise) => {
    const producer = spawn('python3', [resolve(workspaceRoot, 'tests/fixtures/emit_live_python.py')], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        PYTHONPATH: resolve(workspaceRoot, 'sdk/python'),
        DEBUGSCOPE_UDP_HOST: '127.0.0.1',
        DEBUGSCOPE_UDP_PORT: String(LIVE_UDP_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    producer.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    producer.once('error', rejectPromise);
    producer.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`live producer exited with ${code}: ${stderr}`));
    });
  });
}

function sendMalformedDatagram(): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = dgram.createSocket('udp4');
    socket.send(Buffer.from('not-a-dscp-packet'), LIVE_UDP_PORT, '127.0.0.1', (error) => {
      socket.close();
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

test('Python SDK streams through UDP and Hub into the browser workbench', async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByText('Hub connected', { exact: true })).toBeVisible();
  await expect(page.getByText('Waiting for a producer')).toBeVisible();

  const producer = runLiveProducer();
  await expect(page.locator('.source-card strong').getByText('live-python', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('controller.speed', { exact: true })).toBeVisible();
  await expect(page.getByText('controller.target', { exact: true })).toBeVisible();
  await expect(page.locator('.channel-row')).toHaveCount(4);
  await expect(page.locator('.legend-item')).toHaveCount(4);
  await expect(page.locator('.uplot')).toBeVisible();
  await producer;
  await page.waitForTimeout(150);

  const timeAfterProducer = Number(await page.locator('.plot-stage').getAttribute('data-live-time'));
  await page.waitForTimeout(450);
  const timeAfterWaiting = Number(await page.locator('.plot-stage').getAttribute('data-live-time'));
  expect(Math.abs(timeAfterWaiting - timeAfterProducer)).toBeLessThan(0.05);

  await page.getByRole('button', { name: 'Open settings' }).click();
  const idleScrollSwitch = page.getByRole('switch', { name: 'Continue scrolling when idle' });
  await expect(idleScrollSwitch).toHaveAttribute('aria-checked', 'false');
  await idleScrollSwitch.click();
  await page.getByRole('button', { name: 'Close settings panel' }).click();

  const timeBeforeIdleScroll = Number(await page.locator('.plot-stage').getAttribute('data-live-time'));
  await page.waitForTimeout(450);
  const timeAfterIdleScroll = Number(await page.locator('.plot-stage').getAttribute('data-live-time'));
  expect(timeAfterIdleScroll - timeBeforeIdleScroll).toBeGreaterThan(0.3);

  const secondRun = runLiveProducer();
  await secondRun;
  await expect(page.locator('.source-card')).toHaveCount(1);

  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
  await sendMalformedDatagram();
  await expect.poll(async () => {
    const response = await request.get('/health');
    const health = await response.json() as { malformedPackets: number };
    return health.malformedPackets;
  }).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/debugscope-live-1440x900.png', fullPage: true });

  await page.getByRole('button', { name: 'Delete live-python' }).click();
  await expect(page.locator('.source-card')).toHaveCount(0);
  await expect(page.getByText('Waiting for a producer')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
