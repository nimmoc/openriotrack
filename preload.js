const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('rio', {
  getPlatform: () => ipcRenderer.invoke('rio:get-platform'),
  getSnapshot: (options) => ipcRenderer.invoke('rio:get-snapshot', options),
  probe: () => ipcRenderer.invoke('rio:probe'),
  chooseFiles: () => ipcRenderer.invoke('rio:choose-files'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  upload: (request) => ipcRenderer.invoke('rio:upload', request),
  deleteTracks: (request) => ipcRenderer.invoke('rio:delete', request),
  cancel: () => ipcRenderer.invoke('rio:cancel'),
  openDriverGuide: () => ipcRenderer.invoke('rio:open-driver-guide'),
  onProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('rio:progress', handler);
    return () => ipcRenderer.removeListener('rio:progress', handler);
  }
});
