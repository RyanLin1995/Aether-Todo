/**
 * 应用内通知卡（替代系统原生通知）
 * 桌面右下角弹出，使用与主界面一致的液态玻璃材质、圆角、字体与动效
 */
import { icon, type IconName } from './icons';
import type { NotifyPayload } from '../../shared/types';

interface NotifyApi {
  notifyInit(): Promise<{ ok: boolean; data?: NotifyPayload | null }>;
  onNotifyShow(cb: (data: NotifyPayload) => void): () => void;
  onNotifyHide(cb: () => void): () => void;
  notifyClose(): Promise<{ ok: boolean }>;
  notifyOpenTask(id: string | null): Promise<{ ok: boolean }>;
}

const api = (window as unknown as { api: NotifyApi }).api;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const TONE_ICON: Record<string, IconName> = {
  success: 'checkCircle',
  warning: 'bell',
  info: 'timer',
};

let hideTimer: ReturnType<typeof setTimeout> | null = null;

function render(payload: NotifyPayload): void {
  const card = $('notify-card');
  const iconBox = $('notify-icon');
  const title = $('notify-title');
  const body = $('notify-body');
  const progress = $('notify-progress');

  // 液态程度与主题：通知卡材质跟随「整体液态程度」设置
  document.documentElement.style.setProperty('--liquid', String(payload.liquid ?? 0.92));
  document.documentElement.setAttribute('data-theme', payload.theme === 'dark' ? 'dark' : 'light');

  card.dataset.tone = payload.tone || 'info';
  title.textContent = payload.title || '';
  body.textContent = payload.body || '';

  iconBox.innerHTML = '';
  const name = TONE_ICON[payload.tone] || 'timer';
  iconBox.appendChild(icon(name, { size: 15, strokeWidth: 2.2 }));

  // 自动消失进度条
  const duration = Math.max(2000, Math.min(15000, payload.duration ?? 6000));
  progress.style.animation = 'none';
  void progress.offsetWidth; // 强制重排以重启动画
  progress.style.animation = `notify-countdown ${duration}ms linear forwards`;

  card.classList.remove('is-hidden', 'is-leaving');
  card.classList.add('is-entering');

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => void dismiss(), duration + 260);
}

async function dismiss(): Promise<void> {
  const card = $('notify-card');
  if (!card || card.classList.contains('is-hidden')) return;
  card.classList.remove('is-entering');
  card.classList.add('is-leaving');
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  try {
    await api.notifyClose();
  } catch {
    /* 忽略 */
  }
  setTimeout(() => card.classList.add('is-hidden'), 220);
}

async function boot(): Promise<void> {
  $('notify-close').appendChild(icon('close', { size: 13 }));
  $('notify-close').addEventListener('click', (e) => {
    e.stopPropagation();
    void dismiss();
  });
  $('notify-card').addEventListener('click', () => {
    void api.notifyOpenTask(null).then(() => dismiss());
  });

  // 窗口可能先创建再推送，这里补拉一次当前通知
  try {
    const res = await api.notifyInit();
    if (res && res.ok && res.data) render(res.data);
  } catch {
    /* 忽略 */
  }

  api.onNotifyShow((payload) => render(payload));
  api.onNotifyHide(() => dismiss());
}

document.addEventListener('DOMContentLoaded', () => void boot());
