const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatAPI', {
  getConfig: () => ipcRenderer.invoke('chat:get-config'),
  saveConfig: (config) => ipcRenderer.invoke('chat:save-config', config),
  sendMessage: (text) => ipcRenderer.invoke('chat:send-message', text)
});
