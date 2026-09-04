const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hardware', {
  read: () => ipcRenderer.invoke('hardware:read'),
  log: (level, message, details) => ipcRenderer.send('runtime:log', level, message, details),
});
