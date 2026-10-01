/** 设置弹窗 */
import { $, toast, initTheme, setTheme, type ThemeChoice, icon } from './utils';
import { t, setLocale } from './i18n';
import { Settings, AI, App, FloatWindow } from './api';
import type { AppSettings } from '../../shared/types';

/**
 * 「整体液态程度」主控变量 --liquid 的取值区间：拉条 0–100 线性映射到 0.3–1。
 * 注意语义是「材质厚度/折射程度」而非不透明度：
 *   · 0.3 = 轻薄通透，但仍保留磨砂模糊与高光（见 styles.css 的 --liquid-* 派生变量）
 *   · 1.0 = 厚重折射
 */
const OPACITY_MIN = 0.3;
const OPACITY_MAX = 1;
const OPACITY_SPAN = OPACITY_MAX - OPACITY_MIN;

function clampOpacity(value: number): number {
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Number.isFinite(value) ? value : OPACITY_MAX));
}
/** 液态程度 → 拉条位置（0–100） */
function opacityToSlider(value: number): number {
  return Math.round(((clampOpacity(value) - OPACITY_MIN) / OPACITY_SPAN) * 100);
}
/** 拉条位置（0–100） → 液态程度（0.3–1） */
function sliderToOpacity(value: number): number {
  const pos = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 100));
  return clampOpacity(OPACITY_MIN + (pos / 100) * OPACITY_SPAN);
}

export interface SettingsPanel {
  open: () => Promise<void>;
  relocalize: () => void;
}

export function mountSettings({
  getSettings,
  onChanged,
  onLocaleChange,
}: {
  getSettings: () => Partial<AppSettings>;
  onChanged: (next: AppSettings) => void;
  onLocaleChange: (locale: string) => void;
}): SettingsPanel {
  const modal = $('#settings-modal') as HTMLElement;
  const baseUrl = $('#set-baseurl') as HTMLInputElement;
  const apiKey = $('#set-apikey') as HTMLInputElement;
  const model = $('#set-model') as HTMLInputElement;
  const aiEnabled = $('#set-ai-enabled') as HTMLInputElement;
  const reminder = $('#set-reminder') as HTMLInputElement;
  const lead = $('#set-lead') as HTMLInputElement;
  const localeSel = $('#set-locale') as HTMLSelectElement;
  const proxyMode = $('#set-proxy-mode') as HTMLSelectElement;
  const proxyUrl = $('#set-proxy-url') as HTMLInputElement;
  const proxyUrlField = $('#proxy-url-field') as HTMLElement;
  const themeSel = $('#set-theme') as HTMLSelectElement;
  const pomoMinutes = $('#set-pomo-minutes') as HTMLInputElement;
  const floatOpacity = $('#set-float-opacity') as HTMLInputElement;
  const valFloatOpacity = $('#val-float-opacity') as HTMLElement;
  const testBtn = $('#btn-test-ai') as HTMLButtonElement;
  const testResult = $('#ai-test-result') as HTMLElement;
  const closeBtn = $('#btn-close-settings') as HTMLElement;
  const uninstallBtn = $('#btn-uninstall') as HTMLElement;

  const closeIcon = $('#btn-close-icon') as HTMLElement;
  if (closeIcon) {
    closeIcon.innerHTML = '';
    closeIcon.appendChild(icon('close', { size: 14 }));
  }

  if (uninstallBtn) {
    uninstallBtn.innerHTML = '';
    uninstallBtn.appendChild(icon('trash', { size: 13 }));
    uninstallBtn.appendChild(document.createTextNode(` ${t('settings.uninstall')}`));
  }

  function fill(): void {
    const s = getSettings();
    baseUrl.value = s.aiBaseUrl || '';
    apiKey.value = s.aiApiKey || '';
    model.value = s.aiModel || '';
    aiEnabled.checked = Boolean(s.aiEnabled);
    reminder.checked = Boolean(s.reminderEnabled);
    lead.value = String(s.reminderLeadMinutes ?? 0);
    localeSel.value = (s.locale as string) || 'zh-CN';
    themeSel.value = initTheme();
    proxyMode.value = s.proxyMode || 'none';
    proxyUrl.value = s.proxyUrl || '';
    proxyUrlField.classList.toggle('hidden', proxyMode.value !== 'custom');
    if (pomoMinutes) pomoMinutes.value = String(s.pomodoroMinutes ?? 25);
    applyLiquid(clampOpacity(s.liquidOpacity ?? s.floatOpacity ?? 0.92));
  }

  /**
   * 应用「整体液态程度」：写入全局主控变量 --liquid，
   * 界面玻璃、按钮、灵动岛材质（模糊/折射/高光/描边/厚度）全部由它派生。
   */
  function applyLiquid(value: number, dragging = false): number {
    const level = clampOpacity(value);
    const pos = opacityToSlider(level);
    if (floatOpacity) {
      floatOpacity.value = String(pos);
      // 自绘轨道用它填充已选段，滑块位置与填充进度严格一致，两端不留白
      floatOpacity.style.setProperty('--range-progress', `${pos}%`);
    }
    if (valFloatOpacity) {
      valFloatOpacity.textContent = `${Math.round(level * 100)}%`;
      valFloatOpacity.classList.toggle('is-active', dragging);
    }
    // 预览卡单独设置 --liquid，展示该取值下的真实材质
    const preview = $('#opacity-preview') as HTMLElement | null;
    if (preview) preview.style.setProperty('--liquid', level.toFixed(3));
    // 主界面与所有窗口共享的主控变量
    document.documentElement.style.setProperty('--liquid', level.toFixed(3));
    return level;
  }

  async function save(patch: Partial<AppSettings>): Promise<AppSettings | null> {
    try {
      const next = await Settings.update(patch);
      onChanged(next);
      toast(t('settings.saved'), 'success');
      return next;
    } catch (err) {
      toast((err as Error).message, 'error');
      return null;
    }
  }

  baseUrl.addEventListener('change', () => void save({ aiBaseUrl: baseUrl.value.trim() }));
  apiKey.addEventListener('change', () => void save({ aiApiKey: apiKey.value.trim() }));
  model.addEventListener('change', () => void save({ aiModel: model.value.trim() }));
  aiEnabled.addEventListener('change', () => void save({ aiEnabled: aiEnabled.checked }));
  reminder.addEventListener('change', () => void save({ reminderEnabled: reminder.checked }));
  lead.addEventListener('change', () =>
    void save({ reminderLeadMinutes: Math.max(0, Number(lead.value) || 0) })
  );

  // 番茄时钟时长变更
  if (pomoMinutes) {
    pomoMinutes.addEventListener('change', () => {
      const val = Math.max(1, Math.min(180, Number(pomoMinutes.value) || 25));
      pomoMinutes.value = String(val);
      void save({ pomodoroMinutes: val });
    });
  }

  // 整体液态程度调节（主界面 + 灵动岛统一材质）：input 即时预览，change 持久化保存
  if (floatOpacity) {
    floatOpacity.addEventListener('input', () => {
      const level = applyLiquid(sliderToOpacity(Number(floatOpacity.value)), true);
      void FloatWindow.setOpacity(level);
    });
    floatOpacity.addEventListener('change', () => {
      const level = applyLiquid(sliderToOpacity(Number(floatOpacity.value)));
      void save({ floatOpacity: level, liquidOpacity: level });
    });
    // 拖动结束（含键盘微调）后取消数值胶囊高亮，持久化交给 change 事件
    const endDrag = () => {
      applyLiquid(sliderToOpacity(Number(floatOpacity.value)));
    };
    floatOpacity.addEventListener('pointerup', endDrag);
    floatOpacity.addEventListener('keyup', endDrag);
  }

  // 语言切换：立即生效并持久化
  localeSel.addEventListener('change', async () => {
    const next = await save({ locale: localeSel.value });
    const locale = (next && next.locale) || localeSel.value;
    setLocale(locale);
    if (onLocaleChange) onLocaleChange(locale);
  });

  proxyMode.addEventListener('change', async () => {
    proxyUrlField.classList.toggle('hidden', proxyMode.value !== 'custom');
    await save({ proxyMode: proxyMode.value as AppSettings['proxyMode'] });
  });
  proxyUrl.addEventListener('change', () => void save({ proxyUrl: proxyUrl.value.trim() }));

  // 主题切换：立即生效并持久化
  themeSel.addEventListener('change', () => {
    setTheme(themeSel.value as ThemeChoice);
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.innerHTML = '';
    testBtn.appendChild(icon('loader', { size: 14, class: 'animate-spin' }));
    testBtn.appendChild(document.createTextNode(` ${t('settings.testing')}`));

    testResult.innerHTML = '';
    testResult.className = 'test-result-badge testing';
    testResult.appendChild(icon('loader', { size: 13, class: 'animate-spin' }));
    testResult.appendChild(document.createTextNode(` ${t('settings.testing')}`));

    try {
      const res = await AI.test({
        aiBaseUrl: baseUrl.value.trim(),
        aiApiKey: apiKey.value.trim(),
        aiModel: model.value.trim(),
      });
      // 成功样式：精美高光标签，带有 checkCircle Lucide 图标
      testResult.innerHTML = '';
      testResult.className = 'test-result-badge success';
      testResult.appendChild(icon('checkCircle', { size: 13 }));
      const msg = res.raw ? t('settings.testOk') : t('settings.testOkEmpty');
      testResult.appendChild(document.createTextNode(` ${msg}`));
      toast(msg, 'success');
    } catch (err) {
      // 失败样式：精美警告红色标签，带有 alertTriangle 图标，杜绝 Emoji
      testResult.innerHTML = '';
      testResult.className = 'test-result-badge error';
      testResult.appendChild(icon('alertTriangle', { size: 13 }));
      const errMsg = (err as Error).message;
      testResult.appendChild(document.createTextNode(` ${errMsg}`));
      toast(errMsg, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.innerHTML = '';
      testBtn.appendChild(icon('sliders', { size: 13 }));
      testBtn.appendChild(document.createTextNode(` ${t('settings.test')}`));
    }
  });

  // 卸载：仅安装版可用（由 app:info 的 canUninstall 控制显隐）
  uninstallBtn.addEventListener('click', async () => {
    if (!window.confirm(t('settings.uninstallConfirm'))) return;
    try {
      await App.uninstall();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  });

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  return {
    async open() {
      fill();
      testResult.innerHTML = '';
      testResult.className = 'test-result-badge';
      testBtn.innerHTML = '';
      testBtn.appendChild(icon('sliders', { size: 13 }));
      testBtn.appendChild(document.createTextNode(` ${t('settings.test')}`));

      try {
        const info = await App.info();
        $('#about-info')!.innerHTML = t('settings.aboutInfo', {
          version: String(info.version ?? ''),
          electron: String(info.electron ?? ''),
          node: String(info.node ?? ''),
          dir: String(info.dataDir ?? ''),
        });
        // 仅安装版提供卸载入口
        uninstallBtn.classList.toggle('hidden', !info.canUninstall);
      } catch {
        /* 忽略 */
      }
      modal.classList.remove('hidden');
    },
    /** 语言切换后刷新弹窗内文案 */
    relocalize() {
      fill();
      const closeIcon = $('#btn-close-icon') as HTMLElement;
      if (closeIcon && !closeIcon.hasChildNodes()) {
        closeIcon.appendChild(icon('close', { size: 14 }));
      }
      if (uninstallBtn) {
        uninstallBtn.innerHTML = '';
        uninstallBtn.appendChild(icon('trash', { size: 13 }));
        uninstallBtn.appendChild(document.createTextNode(` ${t('settings.uninstall')}`));
      }
      testBtn.innerHTML = '';
      testBtn.appendChild(icon('sliders', { size: 13 }));
      testBtn.appendChild(document.createTextNode(` ${t('settings.test')}`));
    },
  };
}
