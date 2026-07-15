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
    await page.waitForSelector('#trackRows tr');
    const rowCount = await page.locator('#trackRows tr').count();
    const bodyText = await page.locator('body').innerText();

    assert.equal(rowCount, 37);
    assert.doesNotMatch(bodyText, /preferences\.bin/i);
    assert.match(bodyText, /STUPID POP SONGS/);
    assert.equal(await page.locator('#addButton').isEnabled(), true);

    const internalRows = page.locator('#trackRows tr');
    await internalRows.nth(0).locator('input[type="checkbox"]').check();
    await internalRows.nth(1).locator('input[type="checkbox"]').check();
    assert.match(await page.locator('#selectionSummary').textContent(), /^已选 2 首 · [\d.]+ MB$/);

    await page.locator('#memorySelect').selectOption('1');
    assert.equal(await page.locator('#trackRows tr').count(), 4);
    assert.equal(await page.locator('#selectionSummary').isHidden(), true);
    const expansionText = await page.locator('body').innerText();
    assert.match(expansionText, /六层楼/);
    assert.match(expansionText, /宋冬野/);
    assert.match(expansionText, /安和桥北/);
    assert.match(expansionText, /莉莉安/);
    await page.screenshot({ path: path.join(outputDir, 'rio800-manager-device.png') });
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
