const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hardware', {
  read: () => ipcRenderer.invoke('hardware:read'),
  log: (level, message, details) => ipcRenderer.send('runtime:log', level, message, details),
});

contextBridge.exposeInMainWorld('settings', {
  getOpenAiKeyStatus: () => ipcRenderer.invoke('settings:getOpenAiKeyStatus'),
  setOpenAiKey: (key) => ipcRenderer.invoke('settings:setOpenAiKey', key),
  testOpenAiConnection: () => ipcRenderer.invoke('settings:testOpenAiConnection'),
});

contextBridge.exposeInMainWorld('llm', {
  findReplacementDevice: (payload) => ipcRenderer.invoke('llm:findReplacementDevice', payload),
  chooseBestHardwareUpgrade: (payload) => ipcRenderer.invoke('llm:chooseBestHardwareUpgrade', payload),
});

contextBridge.exposeInMainWorld('tilldeals', {
  getLastRecommendation: () => ipcRenderer.invoke('tilldeals:getLastRecommendation'),
  getTrackedItems: () => ipcRenderer.invoke('tilldeals:getTrackedItems'),
  addTrackedItems: (entries) => ipcRenderer.invoke('tilldeals:addTrackedItems', entries),
});
