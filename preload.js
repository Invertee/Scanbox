const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scanbox', {
  listScanners: () => ipcRenderer.invoke('scanner:list'),
  scan: (options) => ipcRenderer.invoke('scanner:scan', options),
  chooseImage: () => ipcRenderer.invoke('image:choose'),
  redetect: (options) => ipcRenderer.invoke('batch:redetect', options),
  chooseOutputFolder: () => ipcRenderer.invoke('folder:choose'),
  getLastOutputFolder: () => ipcRenderer.invoke('folder:last-used'),
  getNextOutputNumber: (options) => ipcRenderer.invoke('folder:next-number', options),
  saveBatch: (payload) => ipcRenderer.invoke('batch:save', payload),
  openScannerHelp: () => ipcRenderer.invoke('app:open-scanner-help'),
  openMapCredits: () => ipcRenderer.invoke('app:open-map-credits')
});
