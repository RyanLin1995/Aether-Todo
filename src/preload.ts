/** 预加载脚本：安全地把主进程能力暴露给渲染进程（本机单机应用，无登录态） */
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  listTasks: (filter: unknown) => ipcRenderer.invoke('tasks:list', { filter }),
  createTask: (task: unknown) => ipcRenderer.invoke('tasks:create', { task }),
  createTasks: (tasks: unknown[]) => ipcRenderer.invoke('tasks:createMany', { tasks }),
  updateTask: (id: string, patch: unknown) => ipcRenderer.invoke('tasks:update', { id, patch }),
  deleteTask: (id: string) => ipcRenderer.invoke('tasks:delete', { id }),
  // 重复任务：勾选完成（自动推进下一期）/ 按作用域编辑 / 按作用域删除
  toggleCompleteTask: (id: string, completed: boolean) =>
    ipcRenderer.invoke('tasks:toggleComplete', { id, completed }),
  updateTaskScoped: (id: string, patch: unknown, scope: string) =>
    ipcRenderer.invoke('tasks:updateScoped', { id, patch, scope }),
  deleteTaskScoped: (id: string, scope: string) => ipcRenderer.invoke('tasks:deleteScoped', { id, scope }),
  seriesForTask: (id: string) => ipcRenderer.invoke('series:forTask', { id }),
  bulkComplete: (ids: string[]) => ipcRenderer.invoke('tasks:bulkComplete', { ids }),
  reorderTasks: (ids: string[]) => ipcRenderer.invoke('tasks:reorder', { ids }),
  stats: () => ipcRenderer.invoke('tasks:stats'),
  statsTimeline: () => ipcRenderer.invoke('stats:timeline'),

  aiChat: (text: string) => ipcRenderer.invoke('ai:chat', { text }),
  aiPreview: (text: string) => ipcRenderer.invoke('ai:preview', { text }),
  aiHistory: () => ipcRenderer.invoke('ai:history'),
  aiClearHistory: () => ipcRenderer.invoke('ai:clearHistory'),
  aiTest: (settings: unknown) => ipcRenderer.invoke('ai:test', { settings }),
  onAiChatChunk: (cb: (data: { reply: string }) => void) => {
    const handler = (_e: unknown, d: { reply: string }) => cb(d);
    ipcRenderer.on('ai:chat:chunk', handler);
    return () => ipcRenderer.removeListener('ai:chat:chunk', handler);
  },

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: unknown) => ipcRenderer.invoke('settings:update', { patch }),
  getDefaults: () => ipcRenderer.invoke('settings:defaults'),

  checkReminders: () => ipcRenderer.invoke('reminder:checkNow'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  appUninstall: () => ipcRenderer.invoke('app:uninstall'),

  // 番茄钟
  pomodoroStart: (taskId: string, minutes?: number) => ipcRenderer.invoke('pomodoro:start', { taskId, minutes }),
  pomodoroStop: () => ipcRenderer.invoke('pomodoro:stop'),
  pomodoroPause: () => ipcRenderer.invoke('pomodoro:pause'),
  pomodoroResume: () => ipcRenderer.invoke('pomodoro:resume'),
  pomodoroStatus: () => ipcRenderer.invoke('pomodoro:status'),

  // 浮窗
  floatShow: () => ipcRenderer.invoke('float:show'),
  floatHide: () => ipcRenderer.invoke('float:hide'),
  floatToggle: () => ipcRenderer.invoke('float:toggle'),
  floatOpenMain: () => ipcRenderer.invoke('float:openMain'),
  floatSetOpacity: (opacity: number) => ipcRenderer.invoke('float:setOpacity', { opacity }),
  floatSetIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.invoke('float:setIgnoreMouse', { ignore }),
  floatState: () => ipcRenderer.invoke('float:state'),
  floatSetTask: (id: string) => ipcRenderer.invoke('float:setTask', { id }),
  floatCycleTask: (dir: number) => ipcRenderer.invoke('float:cycleTask', { dir }),
  onFloatStateChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('float:state-changed', handler);
    return () => ipcRenderer.removeListener('float:state-changed', handler);
  },

  onPomodoroChanged: (cb: (s: unknown) => void) => {
    const handler = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('pomodoro:changed', handler);
    return () => ipcRenderer.removeListener('pomodoro:changed', handler);
  },
  onPomodoroTick: (cb: (s: unknown) => void) => {
    const handler = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('pomodoro:tick', handler);
    return () => ipcRenderer.removeListener('pomodoro:tick', handler);
  },
  onTasksChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('tasks:changed', handler);
    return () => ipcRenderer.removeListener('tasks:changed', handler);
  },

  onReminderOpen: (cb: (id: string | null) => void) => {
    const handler = (_e: unknown, id: string | null) => cb(id);
    ipcRenderer.on('reminder:open', handler);
    return () => ipcRenderer.removeListener('reminder:open', handler);
  },

  // 应用内通知（液态玻璃通知卡，替代系统原生通知）
  notifyInit: () => ipcRenderer.invoke('notify:init'),
  onNotifyShow: (cb: (data: unknown) => void) => {
    const handler = (_e: unknown, d: unknown) => cb(d);
    ipcRenderer.on('notify:show', handler);
    return () => ipcRenderer.removeListener('notify:show', handler);
  },
  onNotifyHide: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('notify:hide', handler);
    return () => ipcRenderer.removeListener('notify:hide', handler);
  },
  notifyClose: () => ipcRenderer.invoke('notify:close'),
  notifyOpenTask: (id: string | null) => ipcRenderer.invoke('notify:openTask', { id }),
};

contextBridge.exposeInMainWorld('api', api);
