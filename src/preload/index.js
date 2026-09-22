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
  clearAll: (deleteFile = false) => ipcRenderer.invoke('tasks:clearAll', deleteFile),
  removeBatch: (ids, deleteFile = false) => ipcRenderer.invoke('tasks:removeBatch', ids, deleteFile),
  checkDuplicate: (url) => ipcRenderer.invoke('tasks:checkDuplicate', url),
  remove: (id, deleteFile) => ipcRenderer.invoke('tasks:remove', id, deleteFile),

  setSpeedLimit: (bps) => ipcRenderer.invoke('settings:speedLimit', bps),
  setMaxConcurrent: (n) => ipcRenderer.invoke('settings:maxConcurrent', n),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),

  showInFolder: (p) => ipcRenderer.invoke('shell:show', p),
  openFile: (p) => ipcRenderer.invoke('shell:open', p),

  // Auto-Updater APIs
  checkUpdate: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: (payload) => ipcRenderer.invoke('updater:download', payload),
  installUpdate: (installerPath) => ipcRenderer.invoke('updater:install', installerPath),
  onUpdateProgress: (cb) => {
    const handler = (_e, p) => cb(p)
    ipcRenderer.on('updater:progress', handler)
    return () => ipcRenderer.removeListener('updater:progress', handler)
  },

  // Extension Bridge Event Listeners & Decision
  setBridgeDecision: (downloadId, action) => ipcRenderer.invoke('bridge:decision', { downloadId, action }),
  onLinkReceived: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('bridge:link-received', handler)
    return () => ipcRenderer.removeListener('bridge:link-received', handler)
  },
  onDuplicateDetected: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('bridge:duplicate-detected', handler)
    return () => ipcRenderer.removeListener('bridge:duplicate-detected', handler)
  },

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
