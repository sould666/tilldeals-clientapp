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
  addTrackedItems: (entries, source) => ipcRenderer.invoke('tilldeals:addTrackedItems', entries, source),
  removeTrackedItem: (id) => ipcRenderer.invoke('tilldeals:removeTrackedItem', id),
});

contextBridge.exposeInMainWorld('account', {
  getState: () => ipcRenderer.invoke('account:getState'),
  saveProfile: (input) => ipcRenderer.invoke('account:saveProfile', input),
  refreshEntitlements: () => ipcRenderer.invoke('account:refreshEntitlements'),
});

contextBridge.exposeInMainWorld('billing', {
  checkout: (product, quantity) => ipcRenderer.invoke('billing:checkout', product, quantity),
});

contextBridge.exposeInMainWorld('consultation', {
  request: (payload) => ipcRenderer.invoke('consultation:request', payload),
});

contextBridge.exposeInMainWorld('mydeals', {
  get: () => ipcRenderer.invoke('mydeals:get'),
  setRefreshInterval: (hours) => ipcRenderer.invoke('mydeals:setRefreshInterval', hours),
  openDeal: (dealId) => ipcRenderer.invoke('mydeals:openDeal', dealId),
  onUpdated: (callback) => ipcRenderer.on('mydeals:updated', () => callback()),
});
