const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright-core');

async function main() {
  const root = path.join(__dirname, '..');
  const buildDir = path.join(root, 'build');
  fs.mkdirSync(buildDir, { recursive: true });

  const electronApp = await electron.launch({
    args: ['.'],
    cwd: root,
    env: { ...process.env, RIO_MANAGER_DEMO: '1' }
  });

  try {
    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1024, height: 1024 });
    await page.goto(pathToFileURL(path.join(__dirname, 'icon.html')).href);
    await page.screenshot({ path: path.join(buildDir, 'icon.png'), omitBackground: true });
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
