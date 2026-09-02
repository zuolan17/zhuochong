const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  getConfig: () => ipcRenderer.invoke('chat:get-config'),
  saveConfig: (config) => ipcRenderer.invoke('chat:save-config', config),
  testConnection: (config) => ipcRenderer.invoke('chat:test-connection', config)
});
