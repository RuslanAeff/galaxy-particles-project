import { test, expect } from '@playwright/test';

const ids = ['galaxy', 'torus', 'dna', 'vortex', 'blackhole', 'atom', 'nebula'];

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#scene-loading')).toBeHidden();
  await expect(page.locator('#scene-error')).toBeHidden();
  await expect(page.locator('#scene canvas')).toBeVisible();
}

test('starts without camera or model requests and renders every formation', async ({ page }, testInfo) => {
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => {
    if (/mediapipe|googleapis|jsdelivr/.test(request.url())) externalRequests.push(request.url());
  });
  await ready(page);
  await expect(page.locator('#fps')).not.toHaveText('—');
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Animasyonu duraklat', exact: true }).click();
  for (const id of ids) {
    await page.locator('[data-shape="' + id + '"]').click();
    await expect(page.locator('[data-shape="' + id + '"]')).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: testInfo.outputPath(id + '.png') });
  }
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('steady animation avoids uploading large particle buffers every frame', async ({ page }) => {
  await page.addInitScript(() => {
    window.largeUploads = 0;
    for (const method of ['bufferData', 'bufferSubData']) {
      const original = WebGL2RenderingContext.prototype[method];
      WebGL2RenderingContext.prototype[method] = function (...args) {
        const data = args[method === 'bufferData' ? 1 : 2];
        if (data?.byteLength > 10000) window.largeUploads++;
        return original.apply(this, args);
      };
    }
  });
  await ready(page);
  await expect(page.locator('#fps')).not.toHaveText('—');
  await page.locator('#quality').selectOption('balanced');
  const before = await page.evaluate(() => window.largeUploads);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.largeUploads)).toBe(before);
  for (const id of ['atom', 'galaxy', 'dna', 'blackhole', 'torus']) {
    await page.locator('[data-shape="' + id + '"]').click();
  }
  await expect(page.locator('[data-shape="torus"]')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1600);
  const after = await page.evaluate(() => window.largeUploads);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.largeUploads)).toBe(after);
});

test('pause, speed, quality, shortcuts and help stay usable', async ({ page }) => {
  await ready(page);
  await page.locator('#scene').focus();
  await page.keyboard.press('6');
  await expect(page.locator('[data-shape="atom"]')).toHaveAttribute('aria-pressed', 'true');
  // Number keys keep working once focus lands on a shape button, while the space
  // bar stays with that button so it activates instead of toggling playback.
  await page.locator('[data-shape="nebula"]').click();
  await page.keyboard.press('3');
  await expect(page.locator('[data-shape="dna"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-shape="nebula"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#pause-button')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#scene').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#pause-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#fps')).toHaveText('0');
  await page.locator('#quality').selectOption('low');
  await expect(page.locator('#particle-count')).toHaveText('6.000');
  await page.locator('#quality').selectOption('high');
  await expect(page.locator('#particle-count')).toHaveText('24.000');
  await page.locator('#speed').fill('1.5');
  await expect(page.locator('#speed-value')).toHaveText('1.5×');
  await page.getByRole('button', { name: 'Nasıl çalışır?' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.guide-item')).toHaveCount(7);
  await expect(page.locator('#gesture-guide')).toContainText('Başparmak');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('camera denial leaves manual discovery usable and permits retry', async ({ page }) => {
  await page.addInitScript(() => {
    window.cameraAttempts = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.cameraAttempts++;
      throw new DOMException('Denied by test', 'NotAllowedError');
    };
  });
  await ready(page);
  expect(await page.evaluate(() => window.cameraAttempts)).toBe(0);
  await page.locator('#camera-button').click();
  await expect(page.locator('#status-text')).toContainText('Kamera izni verilmedi');
  await expect(page.locator('#scene-error')).toBeHidden();
  await expect(page.locator('#camera-preview')).toBeHidden();
  await page.locator('[data-shape="dna"]').click();
  await expect(page.locator('[data-shape="dna"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#camera-button').click();
  await expect(page.locator('#status-text')).toContainText('Kamera izni verilmedi');
  expect(await page.evaluate(() => window.cameraAttempts)).toBe(2);
});

test('failed model download releases its camera stream', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const context = canvas.getContext('2d');
      context.fillRect(0, 0, 320, 240);
      window.testStream = canvas.captureStream(20);
      window.testCanvas = canvas;
      return window.testStream;
    };
  });
  await page.route('**/hand_landmarker.task', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await ready(page);
  await page.locator('#camera-button').click();
  await expect(page.locator('#status-text')).toContainText('modeli indirilemedi', { timeout: 20_000 });
  expect(await page.evaluate(() => window.testStream.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
  await expect(page.locator('#camera-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#scene-error')).toBeHidden();
});

test('reduced motion begins paused and still permits changing shapes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await expect(page.locator('#pause-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#fps')).toHaveText('0');
  await page.locator('[data-shape="nebula"]').click();
  await expect(page.locator('#scene-subtitle')).toHaveText('Bulutsu');
  await page.locator('#tour-button').click();
  await expect(page.locator('#tour-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#toast')).toContainText('önce animasyonu sürdür');
  await page.locator('#pause-button').click();
  await expect(page.locator('#pause-button')).toHaveAttribute('aria-pressed', 'false');
});

test('automatic discovery pauses and yields to a manual selection', async ({ page }) => {
  await ready(page);
  await page.locator('#tour-button').click();
  await expect(page.locator('#tour-button')).toHaveAttribute('aria-pressed', 'true');
  // The tour advances every 8s; allow generous headroom on a cold browser.
  await expect(page.locator('[data-shape="torus"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await page.locator('#pause-button').click();
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-shape="torus"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-shape="atom"]').click();
  await expect(page.locator('#tour-button')).toHaveAttribute('aria-pressed', 'false');
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
  test('responsive layout ' + viewport.width + '×' + viewport.height, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('[data-shape="atom"]').click();
    await expect(page.locator('[data-shape="atom"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#quality').selectOption('low');
    await expect(page.locator('#particle-count')).toHaveText('6.000');
    await page.screenshot({ path: testInfo.outputPath('responsive.png'), fullPage: true });
  });
}
