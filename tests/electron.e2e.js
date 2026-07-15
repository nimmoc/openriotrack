const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function main() {
  const outputDir = path.join(__dirname, '..', 'test-results');
  const executablePath = process.env.RIO_MANAGER_EXECUTABLE || undefined;
  fs.mkdirSync(outputDir, { recursive: true });

  const electronApp = await electron.launch({
    executablePath,
    args: executablePath ? [] : ['.'],
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, RIO_MANAGER_DEMO: '1' }
  });

  try {
    const page = await electronApp.firstWindow();
    assert.equal(await page.title(), 'OpenRioTrack');
    assert.equal(await page.locator('.brand h1').textContent(), 'OpenRioTrack');
    assert.equal(await page.locator('.brand-mark').textContent(), 'ORT');
    assert.match(await page.locator('#platformLabel').textContent(), /^OpenRioTrack 1\.0 · by nimmoc · /);
    await page.waitForSelector('text=设备已连接');
    await page.waitForSelector('tbody tr');

    assert.equal(await page.locator('tbody tr').count(), 5);
    assert.equal(await page.locator('#addButton').isEnabled(), true);
    assert.equal(await page.locator('#deleteButton').isEnabled(), false);

    const windowCount = electronApp.windows().length;
    await page.evaluate(() => window.open('https://example.com'));
    await page.waitForTimeout(100);
    assert.equal(electronApp.windows().length, windowCount);
    assert.match(page.url(), /^file:/);

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['test'], 'dropped.mp3', { type: 'audio/mpeg' }));
      document.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
    });
    assert.equal(await page.locator('#dropOverlay').getAttribute('aria-hidden'), 'false');
    assert.match(await page.locator('#dropTarget').textContent(), /内部/);
    await page.screenshot({ path: path.join(outputDir, 'rio800-manager-drop.png') });
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['test'], 'dropped.mp3', { type: 'audio/mpeg' }));
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    });
    assert.equal(await page.locator('#dropOverlay').getAttribute('aria-hidden'), 'true');

    await page.locator('#searchInput').fill('Teardrop');
    assert.equal(await page.locator('tbody tr').count(), 1);
    await page.locator('#searchInput').fill('');
    assert.equal(await page.locator('tbody tr').count(), 5);

    await page.locator('tbody tr').first().locator('input[type="checkbox"]').check();
    assert.equal(await page.locator('#deleteButton').isEnabled(), true);
    assert.match(await page.locator('#selectionSummary').textContent(), /已选 1 首 · 5\.1 MB/);
    await page.locator('#deleteButton').click();
    await page.waitForSelector('#confirmDialog[open]');
    assert.match(await page.locator('#confirmText').textContent(), /1 首歌曲/);
    await page.locator('#confirmDialog button[value="cancel"]').click();

    await page.locator('#deleteButton').click();
    await page.waitForSelector('#confirmDialog[open]');
    await page.locator('#confirmDeleteButton').click();
    await page.waitForSelector('#progressTitle:text-is("删除完成")');
    assert.equal(await page.locator('.loading-state').isVisible(), false);
    assert.equal(await page.locator('#connectionLabel').textContent(), '设备已连接');
    assert.equal(await page.locator('tbody tr').count(), 5);

    await page.locator('#memorySelect').selectOption('1');
    assert.equal(await page.locator('tbody tr').count(), 2);
    assert.equal(await page.locator('#trackCount').textContent(), '2 首');
    assert.equal(await page.locator('#selectionSummary').isHidden(), true);

    const collisions = await page.evaluate(() => {
      const selectors = ['.titlebar', '.device-strip', '.toolbar', '.table-wrap', '.statusbar'];
      const rects = selectors.map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { selector, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      });
      return rects.filter((rect, index) => index > 0 && rect.top < rects[index - 1].bottom - 1);
    });
    assert.deepEqual(collisions, []);

    const screenshotName = executablePath ? 'rio800-manager-packaged.png' : 'rio800-manager-main.png';
    await page.screenshot({ path: path.join(outputDir, screenshotName) });
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
