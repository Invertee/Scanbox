const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scanbox', {
  listScanners: () => ipcRenderer.invoke('scanner:list'),
  scan: (options) => ipcRenderer.invoke('scanner:scan', options),
  chooseImage: (options) => ipcRenderer.invoke('image:choose', options),
  redetect: (options) => ipcRenderer.invoke('batch:redetect', options),
  chooseOutputFolder: () => ipcRenderer.invoke('folder:choose'),
  getLastOutputFolder: () => ipcRenderer.invoke('folder:last-used'),
  getLastPhotoDetails: () => ipcRenderer.invoke('photo-details:last-used'),
  savePhotoDetails: (details) => ipcRenderer.invoke('photo-details:save', details),
  getNextOutputNumber: (options) => ipcRenderer.invoke('folder:next-number', options),
  saveBatch: (payload) => ipcRenderer.invoke('batch:save', payload),
  openScannerHelp: () => ipcRenderer.invoke('app:open-scanner-help'),
  openMapCredits: () => ipcRenderer.invoke('app:open-map-credits'),
  searchMapPlaces: (query) => ipcRenderer.invoke('map:search', query)
});
