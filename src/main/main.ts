/**
 * 主进程入口：窗口、托盘、通知、提醒调度、单实例锁
 * 注意：本文件经 bun build 打包为 dist-electron/main.js（CJS，external electron），
 * 静态资源路径一律基于 app.getAppPath()（开发=项目根，打包=app.asar 根）。
 */
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  shell,
  nativeImage,
  nativeTheme,
  screen,
  session,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createStore } from './store';
import { registerIpc } from './ipc';
import { createReminderService } from './reminder';
import { createPomodoroService } from './pomodoro';
import * as i18n from './i18n';
import type { NotifyPayload, NotifyTone } from '../shared/types';

if (process.platform === 'win32') {
  // 必须与 electron-builder 的 build.appId 完全一致：
  // NSIS 安装器给桌面 / 开始菜单快捷方式写入的 AppUserModelID 取自 appId（com.aethertodo.desktop），
  // 若这里设置不一致，Windows 任务栏无法把运行中的窗口关联到已安装快捷方式，会回退成默认图标。
  app.setAppUserModelId('com.aethertodo.desktop');
}

const isDev = process.argv.includes('--dev');
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let activeUserId: string | null = null;
let store: ReturnType<typeof createStore> | null = null;
let reminder: ReturnType<typeof createReminderService> | null = null;
let pomodoro: ReturnType<typeof createPomodoroService> | null = null;
let floatWindow: BrowserWindow | null = null;
/** 应用内通知窗口（液态玻璃通知卡），懒创建 */
let notifyWindow: BrowserWindow | null = null;
let lastNotify: NotifyPayload | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let quitting = false;
let locale = i18n.DEFAULT_LOCALE as string;

/** 向所有窗口广播事件（主界面 + 浮窗） */
function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * 「整体液态程度」→ 浮窗窗口整体不透明度。
 * 语义是材质厚度而不是透明度：低取值也要保留可见的玻璃质感，因此给窗口整体不透明度留 0.78 的下限，
 * 轻薄感由窗口内部的液态材质（模糊 / 高光 / 描边 / 底色）表达，而不是把整个窗口变透明。
 */
function liquidToWindowOpacity(level: number): number {
  const l = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0.92));
  return Math.min(1, Math.max(0.78, 0.78 + l * 0.22));
}

/** 浮窗：无边框、置顶、可拖动、半透明，靠近屏幕边缘自动吸附 */
function createFloatWindow(): BrowserWindow {
  if (floatWindow && !floatWindow.isDestroyed()) return floatWindow;

  const settings = activeUserId && store ? store.getSettings(activeUserId) : null;
  const opacity = liquidToWindowOpacity(settings?.floatOpacity ?? 0.92);
  const display = screen.getPrimaryDisplay().workArea;
  const width = 320;
  const height = 176;
  let x = settings?.floatX ?? display.x + display.width - width - 24;
  let y = settings?.floatY ?? display.y + display.height - height - 24;
  x = Math.max(display.x, Math.min(x, display.x + display.width - width));
  y = Math.max(display.y, Math.min(y, display.y + display.height - height));

  floatWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: i18n.t(locale, 'float.title'),
    icon: nativeImage.createFromPath(path.join(APP_ROOT, 'src', 'main', 'assets', 'icon.png')),
    webPreferences: {
      preload: path.join(APP_ROOT, 'dist-electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  floatWindow.setAlwaysOnTop(true, 'floating');
  floatWindow.setOpacity(opacity);
  floatWindow.loadFile(path.join(APP_ROOT, 'src', 'renderer', 'float.html'));
  floatWindow.once('ready-to-show', () => floatWindow?.showInactive());

  const persist = (patch: { floatX?: number; floatY?: number; floatOpacity?: number }) => {
    if (activeUserId && store) store.updateSettings(activeUserId, patch);
  };

  /** 贴边吸附：松开拖拽后自动吸附到工作区边缘（阈值 32px，防抖避免拖拽颤动） */
  let snapTimer: ReturnType<typeof setTimeout> | null = null;
  const snapToEdge = () => {
    const win = floatWindow;
    if (!win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const SNAP = 32;
    let nx = bounds.x;
    let ny = bounds.y;

    // 水平方向：左边缘或右边缘吸附
    if (bounds.x <= workArea.x + SNAP) {
      nx = workArea.x;
    } else if (bounds.x + bounds.width >= workArea.x + workArea.width - SNAP) {
      nx = workArea.x + workArea.width - bounds.width;
    }

    // 垂直方向：上边缘或下边缘吸附
    if (bounds.y <= workArea.y + SNAP) {
      ny = workArea.y;
    } else if (bounds.y + bounds.height >= workArea.y + workArea.height - SNAP) {
      ny = workArea.y + workArea.height - bounds.height;
    }

    if (nx !== bounds.x || ny !== bounds.y) {
      win.setBounds({ width: bounds.width, height: bounds.height, x: Math.round(nx), y: Math.round(ny) });
    }
    persist({ floatX: Math.round(nx), floatY: Math.round(ny) });
  };

  floatWindow.on('moved', () => {
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(snapToEdge, 120);
  });

  floatWindow.on('closed', () => {
    floatWindow = null;
  });

  return floatWindow;
}

function showFloatWindow(): void {
  const win = createFloatWindow();
  if (!win.isVisible()) win.showInactive();
  win.webContents.send('tasks:changed', null);
}

function toggleFloatWindow(): void {
  if (floatWindow && !floatWindow.isDestroyed() && floatWindow.isVisible()) {
    floatWindow.hide();
    return;
  }
  showFloatWindow();
}

/** 应用根目录：开发=项目根，打包=app.asar 根 */
const APP_ROOT = app.getAppPath();

/** 切换语言：窗口标题 + 托盘菜单随之更新 */
function applyLocale(next: string): string {
  locale = i18n.normalizeLocale(next);
  if (mainWindow) mainWindow.setTitle(i18n.t(locale, 'app.title'));
  buildTray();
  return locale;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#f6f7fb',
    title: i18n.t(locale, 'app.title'),
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(path.join(APP_ROOT, 'src', 'main', 'assets', 'icon.png')),
    webPreferences: {
      // bun bundle 会把 __dirname 静态替换为源码目录，因此这里必须用运行时的 app.getAppPath()
      preload: path.join(APP_ROOT, 'dist-electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(APP_ROOT, 'src', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show();
    if (isDev) mainWindow!.webContents.openDevTools({ mode: 'detach' });
  });

  // 关闭窗口 → 最小化到托盘，而不是直接退出
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow!.hide();
      return;
    }
    mainWindow = null;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

/**
 * 应用内通知：右下角弹出的液态玻璃通知卡。
 * 取代系统原生通知（原生弹窗是系统主题，和软件风格割裂），配色 / 圆角 / 字体 / 动效统一复用 ui-toast 体系。
 */
function createNotifyWindow(): BrowserWindow {
  if (notifyWindow && !notifyWindow.isDestroyed()) return notifyWindow;

  const NOTIFY_W = 344;
  const NOTIFY_H = 104;
  notifyWindow = new BrowserWindow({
    width: NOTIFY_W,
    height: NOTIFY_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: i18n.t(locale, 'notify.windowTitle'),
    icon: nativeImage.createFromPath(path.join(APP_ROOT, 'src', 'main', 'assets', 'icon.png')),
    webPreferences: {
      preload: path.join(APP_ROOT, 'dist-electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  notifyWindow.setAlwaysOnTop(true, 'pop-up-menu');
  notifyWindow.loadFile(path.join(APP_ROOT, 'src', 'renderer', 'notify.html'));
  notifyWindow.on('closed', () => {
    notifyWindow = null;
  });

  return notifyWindow;
}

/** 把通知窗口贴到主显示器工作区右下角 */
function positionNotifyWindow(win: BrowserWindow): void {
  const area = screen.getPrimaryDisplay().workArea;
  const [w, h] = win.getSize();
  win.setPosition(Math.round(area.x + area.width - w - 18), Math.round(area.y + area.height - h - 18), false);
}

function hideNotifyWindow(): void {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  const win = notifyWindow;
  if (!win || win.isDestroyed()) return;
  win.webContents.send('notify:hide');
  // 等淡出动画结束后再隐藏窗口
  setTimeout(() => {
    if (notifyWindow && !notifyWindow.isDestroyed()) notifyWindow.hide();
  }, 260);
}

function notify({
  title,
  body,
  task,
  tone = 'info',
}: {
  title: string;
  body: string;
  task?: { id: string; priority: string };
  tone?: NotifyTone;
}): void {
  try {
    const settings = activeUserId && store ? store.getSettings(activeUserId) : null;
    const payload: NotifyPayload = {
      title,
      body,
      tone,
      taskId: task ? task.id : null,
      liquid: Math.min(1, Math.max(0.3, settings?.liquidOpacity ?? settings?.floatOpacity ?? 0.92)),
      theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      duration: tone === 'success' ? 7000 : 6000,
    };
    lastNotify = payload;

    const win = createNotifyWindow();
    positionNotifyWindow(win);
    win.showInactive();
    win.webContents.send('notify:show', payload);

    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => hideNotifyWindow(), payload.duration || 6000);
  } catch {
    /* 通知失败不影响主流程 */
  }
}

/** 点击通知：打开主界面并定位到任务 */
function openTaskFromNotify(id: string | null): void {
  hideNotifyWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    mainWindow?.once('ready-to-show', () => {
      mainWindow?.webContents.send('reminder:open', id);
    });
    return;
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('reminder:open', id);
}

function buildTray(): void {
  const iconPath = path.join(APP_ROOT, 'src', 'main', 'assets', 'tray.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    // 兜底：用一张 16x16 的纯色图标，避免无图标导致托盘创建失败
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAP0lEQVR42u3PMQEAAAgDoJnc/9F2gR1sgQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOA1FwABTwAB3wAAAABJRU5ErkJggg=='
    );
  }
  if (tray) {
    tray.setImage(icon);
    tray.setToolTip(i18n.t(locale, 'tray.tooltip'));
    tray.setContextMenu(buildTrayMenu());
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip(i18n.t(locale, 'tray.tooltip'));
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: i18n.t(locale, 'tray.open'),
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    {
      label: i18n.t(locale, 'tray.float'),
      click: () => toggleFloatWindow(),
    },
    {
      label: i18n.t(locale, 'tray.check'),
      click: () => {
        const due = reminder ? reminder.check() : [];
        notify({
          title: i18n.t(locale, 'notify.check.title'),
          body: due.length
            ? i18n.t(locale, 'notify.check.due', { count: due.length, first: due[0].title })
            : i18n.t(locale, 'notify.check.none'),
        });
      },
    },
    { type: 'separator' },
    {
      label: i18n.t(locale, 'tray.exit'),
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

/**
 * 版本升级后清理渲染进程缓存。
 * 静态资源走 file:// 加载（asar 内文件 mtime 固定），Chromium 的磁盘/内存缓存会命中旧副本，
 * 表现为「装了新版但样式没变」。这里只在版本号变化时清一次，避免每次启动都牺牲加载速度。
 */
async function purgeCacheOnUpgrade(): Promise<void> {
  const markerPath = path.join(app.getPath('userData'), 'last-version.txt');
  const current = app.getVersion();
  let previous = '';
  try {
    previous = fs.readFileSync(markerPath, 'utf8').trim();
  } catch {
    previous = '';
  }
  if (previous === current) return;
  try {
    await session.defaultSession.clearCache();
    console.log(`[cache] 版本 ${previous || '(首次)'} → ${current}，已清理渲染进程缓存`);
  } catch (err) {
    console.error('[cache] 清理失败', err);
  }
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, current);
  } catch (err) {
    console.error('[cache] 写入版本标记失败', err);
  }
}

async function bootstrap(): Promise<void> {
  await purgeCacheOnUpgrade();
  store = createStore(getDataDir());
  reminder = createReminderService({
    store,
    getActiveUserId: () => activeUserId,
    notify,
  });

  const localUser = store.ensureLocalUser();
  activeUserId = localUser.id;
  applyLocale((store.getSettings(localUser.id) || {}).locale);

  pomodoro = createPomodoroService({
    store,
    getActiveUserId: () => activeUserId,
    notify,
    broadcast,
  });

  registerIpc({
    store,
    reminder,
    pomodoro,
    broadcast,
    float: {
      show: () => showFloatWindow(),
      hide: () => floatWindow?.hide(),
      toggle: () => toggleFloatWindow(),
      openMain: () => {
        if (floatWindow && !floatWindow.isDestroyed()) floatWindow.hide();
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
      setOpacity: (value: number) => {
        const clamped = Math.min(1, Math.max(0.3, value));
        floatWindow?.setOpacity(liquidToWindowOpacity(clamped));
        if (activeUserId && store) store.updateSettings(activeUserId, { floatOpacity: clamped, liquidOpacity: clamped });
        return clamped;
      },
      /**
       * 灵动岛命中区域跟随视觉：透明窗口在 Windows 上不做逐像素命中测试，
       * 固定窗口矩形会整块拦截下层点击。光标不在岛内时整窗穿透（forward 保持
       * mousemove 转发，渲染进程据此在移入岛内时恢复命中），岛矩形外即可点击下层内容。
       */
      setIgnoreMouseEvents: (ignore: boolean) => {
        if (floatWindow && !floatWindow.isDestroyed()) {
          floatWindow.setIgnoreMouseEvents(ignore, { forward: true });
        }
      },
    },
    notifyActions: {
      latest: () => lastNotify,
      close: () => hideNotifyWindow(),
      openTask: (id: string | null) => openTaskFromNotify(id),
    },
    setActiveUserId: (id) => {
      activeUserId = id;
      if (reminder) reminder.check();
    },
    onLocaleChange: (next) => applyLocale(next),
    appInfo: {
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      node: process.versions.node,
      isDev,
    },
  });

  createWindow();
  buildTray();
  reminder.start();
}

function getDataDir(): string {
  return path.join(app.getPath('userData'), 'data');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap).catch((err) => console.error('[bootstrap] 启动失败', err));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });

  app.on('before-quit', () => {
    quitting = true;
    if (reminder) reminder.stop();
    if (pomodoro) pomodoro.stop();
    // 销毁浮窗与托盘，避免 Windows 通知区域残留幽灵图标
    if (floatWindow && !floatWindow.isDestroyed()) {
      floatWindow.destroy();
      floatWindow = null;
    }
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });
}
