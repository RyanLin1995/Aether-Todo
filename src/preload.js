'use strict';
/** 预加载脚本：安全地把主进程能力暴露给渲染进程（本机单机应用，无登录态） */
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  listTasks: (filter) => ipcRenderer.invoke('tasks:list', { filter }),
  createTask: (task) => ipcRenderer.invoke('tasks:create', { task }),
  createTasks: (tasks) => ipcRenderer.invoke('tasks:createMany', { tasks }),
  updateTask: (id, patch) => ipcRenderer.invoke('tasks:update', { id, patch }),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', { id }),
  bulkComplete: (ids) => ipcRenderer.invoke('tasks:bulkComplete', { ids }),
  stats: () => ipcRenderer.invoke('tasks:stats'),

  aiChat: (text) => ipcRenderer.invoke('ai:chat', { text }),
  aiPreview: (text) => ipcRenderer.invoke('ai:preview', { text }),
  aiHistory: () => ipcRenderer.invoke('ai:history'),
  aiClearHistory: () => ipcRenderer.invoke('ai:clearHistory'),
  aiTest: (settings) => ipcRenderer.invoke('ai:test', { settings }),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', { patch }),
  getDefaults: () => ipcRenderer.invoke('settings:defaults'),

  checkReminders: () => ipcRenderer.invoke('reminder:checkNow'),
  appInfo: () => ipcRenderer.invoke('app:info'),

  onReminderOpen: (cb) => {
    const handler = (_e, id) => cb(id);
    ipcRenderer.on('reminder:open', handler);
    return () => ipcRenderer.removeListener('reminder:open', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
