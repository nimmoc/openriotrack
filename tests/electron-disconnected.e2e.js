const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function main() {
  const root = path.join(__dirname, '..');
  const outputDir = path.join(root, 'test-results');
  const executablePath = process.env.RIO_MANAGER_EXECUTABLE || undefined;
  fs.mkdirSync(outputDir, { recursive: true });

  const electronApp = await electron.launch({
    executablePath,
    args: executablePath ? [] : ['.'],
    cwd: root,
    env: { ...process.env, RIO_MANAGER_DEMO: '0' }
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('body').innerText();
    assert.match(bodyText, /未连接 Rio 800/);
    assert.equal(await page.locator('#addButton').isEnabled(), false);
    assert.equal(await page.locator('#deleteButton').isEnabled(), false);
    assert.match(await page.locator('#deviceMeta').textContent(), /连接 USB/);
    await page.screenshot({ path: path.join(outputDir, 'rio800-manager-disconnected.png') });
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
