const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  onState: (callback) => {
    ipcRenderer.on('pet-state', (_event, data) => {
      callback(data);
    });
  },
  onAction: (callback) => {
    ipcRenderer.on('pet-action', (_event, data) => {
      callback(data);
    });
  },
  onPaused: (callback) => {
    ipcRenderer.on('pet-paused', (_event, data) => {
      callback(data);
    });
  },
  setIgnoreMouseEvents: (ignore) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore);
  },
  startDrag: (offset) => {
    ipcRenderer.send('drag-start', offset);
  },
  endDrag: () => {
    ipcRenderer.send('drag-end');
  }
});
