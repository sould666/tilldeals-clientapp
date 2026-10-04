const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updates', {
  getState: () => ipcRenderer.invoke('updates:getState'),
  check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'),
  install: () => ipcRenderer.invoke('updates:install'),
  onChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updates:changed', listener);
    return () => ipcRenderer.removeListener('updates:changed', listener);
  },
});

contextBridge.exposeInMainWorld('auth', {
  getState: () => ipcRenderer.invoke('auth:getState'),
  requestCode: (email) => ipcRenderer.invoke('auth:requestCode', { email }),
  verifyCode: (code) => ipcRenderer.invoke('auth:verifyCode', { code }),
  refresh: () => ipcRenderer.invoke('auth:refresh'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  signOutLocal: () => ipcRenderer.invoke('auth:signOutLocal'),
});

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
  checkBackendHealth: () => ipcRenderer.invoke('account:checkBackendHealth'),
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
