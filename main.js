const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { RioBackend } = require('./lib/rio-backend');

let mainWindow;
let backend;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#f5f7f8',
    title: 'OpenRioTrack',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (currentUrl && url !== currentUrl) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function migrateLegacyData(dataDir) {
  const appDataDir = app.getPath('appData');
  const legacyDirs = ['OpenRio', 'openrio', 'rio800-manager', 'Rio 800 Manager']
    .map((name) => path.join(appDataDir, name))
    .filter((dir) => path.resolve(dir) !== path.resolve(dataDir));

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    for (const filename of ['metadata-cache.json', 'last-backend-error.log']) {
      const destination = path.join(dataDir, filename);
      if (fs.existsSync(destination)) continue;

      const legacyDir = legacyDirs.find((dir) => fs.existsSync(path.join(dir, filename)));
      if (legacyDir) fs.copyFileSync(path.join(legacyDir, filename), destination);
    }
  } catch {
    // Migration is optional; the device remains usable without the local cache.
  }
}

function registerIpc() {
  ipcMain.handle('rio:get-platform', () => ({
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    demo: backend.demo
  }));

  ipcMain.handle('rio:get-snapshot', (_event, options) => backend.getSnapshot(options));
  ipcMain.handle('rio:probe', () => backend.probe());

  ipcMain.handle('rio:choose-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要传输的音乐',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的音频', extensions: ['mp3', 'wma', 'wav'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });

    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('rio:upload', (_event, request) => backend.upload(request, (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rio:progress', progress);
    }
  }));

  ipcMain.handle('rio:delete', (_event, request) => backend.deleteTracks(request, (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rio:progress', progress);
    }
  }));

  ipcMain.handle('rio:cancel', () => backend.cancel());

  ipcMain.handle('rio:open-driver-guide', () => {
    const guide = app.isPackaged
      ? path.join(process.resourcesPath, 'licenses', 'WINDOWS_DRIVER.md')
      : path.join(__dirname, 'licenses', 'WINDOWS_DRIVER.md');
    return shell.openPath(guide);
  });
}

app.whenReady().then(() => {
  const dataDir = app.getPath('userData');
  migrateLegacyData(dataDir);
  backend = new RioBackend({
    rootDir: __dirname,
    resourcesDir: process.resourcesPath,
    isPackaged: app.isPackaged,
    demo: process.env.RIO_MANAGER_DEMO === '1',
    dataDir
  });
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backend) backend.cancel();
});
