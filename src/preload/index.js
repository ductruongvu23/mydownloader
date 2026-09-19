// src/preload/index.js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  add: (urls, opts) => ipcRenderer.invoke('tasks:add', urls, opts),
  list: () => ipcRenderer.invoke('tasks:list'),
  pause: (id) => ipcRenderer.invoke('tasks:pause', id),
  resume: (id) => ipcRenderer.invoke('tasks:resume', id),
  pauseAll: () => ipcRenderer.invoke('tasks:pauseAll'),
  resumeAll: () => ipcRenderer.invoke('tasks:resumeAll'),
  clearDone: () => ipcRenderer.invoke('tasks:clearDone'),
  remove: (id, deleteFile) => ipcRenderer.invoke('tasks:remove', id, deleteFile),

  setSpeedLimit: (bps) => ipcRenderer.invoke('settings:speedLimit', bps),
  setMaxConcurrent: (n) => ipcRenderer.invoke('settings:maxConcurrent', n),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),

  showInFolder: (p) => ipcRenderer.invoke('shell:show', p),
  openFile: (p) => ipcRenderer.invoke('shell:open', p),

  onUpdate: (cb) => {
    const handler = (_e, t) => cb(t)
    ipcRenderer.on('tasks:update', handler)
    return () => ipcRenderer.removeListener('tasks:update', handler)
  },
  onCleared: (cb) => {
    const handler = (_e, ids) => cb(ids)
    ipcRenderer.on('tasks:cleared', handler)
    return () => ipcRenderer.removeListener('tasks:cleared', handler)
  },
  onRemoved: (cb) => {
    const handler = (_e, id) => cb(id)
    ipcRenderer.on('tasks:removed', handler)
    return () => ipcRenderer.removeListener('tasks:removed', handler)
  }
})
