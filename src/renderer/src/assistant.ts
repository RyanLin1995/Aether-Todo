/** AI 助手面板：多轮对话 + 文件/邮件解析 + 任务提取确认 + 等待动效 */
import { el, toast, fmtDateTime, priorityLabel, categoryLabel, CATEGORIES, icon } from './utils';
import { t } from './i18n';
import { Tasks, AI } from './api';
import type { Task, TaskPatch, UnderstandResult } from '../../shared/types';

export interface AssistantContext {
  getTasks: () => Task[];
  onTasksChanged: () => void;
}

export interface AssistantPanel {
  send: (text: string) => Promise<void>;
  handleFile: (file: File) => Promise<void>;
  loadHistory: () => Promise<void>;
  welcome: () => void;
  relocalize: () => void;
  toggle: () => void;
}

interface DraftItem extends TaskPatch {
  checked: boolean;
}

/** 解析邮件 (.eml/.msg) 文本内容提取主题和纯文本正文 */
function parseEmlContent(raw: string): { subject: string; from: string; date: string; body: string } {
  const lines = raw.split(/\r?\n/);
  let subject = '';
  let from = '';
  let date = '';
  let inHeader = true;
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (inHeader) {
      if (line.trim() === '') {
        inHeader = false;
        continue;
      }
      const lower = line.toLowerCase();
      if (lower.startsWith('subject:')) {
        subject = line.slice(8).trim();
      } else if (lower.startsWith('from:')) {
        from = line.slice(5).trim();
      } else if (lower.startsWith('date:')) {
        date = line.slice(5).trim();
      }
    } else {
      if (line.startsWith('--') || line.startsWith('Content-')) continue;
      bodyLines.push(line);
    }
  }

  const cleanBody = bodyLines.join('\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    subject: subject || '待办邮件',
    from,
    date,
    body: cleanBody.slice(0, 3000),
  };
}

/** 提取拖拽或选择的文件文本内容 */
async function extractFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  try {
    const text = await file.text();
    if (name.endsWith('.eml') || name.endsWith('.msg')) {
      const eml = parseEmlContent(text);
      return `【解析邮件】\n主题：${eml.subject}\n发件人：${eml.from || '未知'}\n时间：${eml.date || '未注明'}\n正文简述：\n${eml.body || '无正文内容'}\n请根据以上邮件提炼待办任务。`;
    }
    return `【文件提炼任务】\n文件名：${file.name}\n内容：\n${text.slice(0, 3000)}`;
  } catch (err) {
    return `【文件信息】\n文件名：${file.name}\n请根据该文件创建相应任务。`;
  }
}

export function mountAssistant({ getTasks, onTasksChanged }: AssistantContext): AssistantPanel {
  const panel = document.getElementById('assistant-panel') as HTMLElement;
  const listEl = document.getElementById('chat-messages') as HTMLElement;
  const inputEl = document.getElementById('chat-input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('btn-send') as HTMLButtonElement;
  const dropzone = document.getElementById('assistant-dropzone') as HTMLElement;
  const fileInput = document.getElementById('file-upload-input') as HTMLInputElement;
  const attachBtn = document.getElementById('btn-attach-file') as HTMLElement;
  const closeBtn = document.getElementById('btn-close-assistant') as HTMLElement;
  const toggleBtn = document.getElementById('btn-toggle-assistant') as HTMLElement;

  let thinkingEl: HTMLElement | null = null;

  /** 流式渲染：主进程边生成边推送 reply 当前值，这里实时刷新气泡 */
  let streamHandler: ((reply: string) => void) | null = null;
  AI.onChunk(({ reply }) => {
    if (streamHandler) streamHandler(reply);
  });

  function scrollBottom(): void {
    requestAnimationFrame(() => {
      listEl.scrollTop = listEl.scrollHeight;
    });
  }

  /** 挂上流式气泡：首片到达时替换思考动画，之后逐字生长。
   *  返回 finalize：停止监听并返回已生成的气泡（无流式内容时返回 null），调用方复用气泡定稿，避免闪烁。 */
  function attachStreamBubble(): (opts?: { drop?: boolean }) => HTMLElement | null {
    let node: HTMLElement | null = null;
    let content: HTMLElement | null = null;
    streamHandler = (replyText: string) => {
      if (!node) {
        hideThinking();
        content = el('div', { class: 'msg-content streaming' });
        node = el('div', { class: 'msg bot' }, [content]);
        listEl.appendChild(node);
      }
      if (content) content.textContent = replyText;
      scrollBottom();
    };
    return (opts = {}) => {
      streamHandler = null;
      if (node && opts.drop) {
        node.remove();
        node = null;
        content = null;
      }
      return node;
    };
  }

  function bubble(role: 'user' | 'bot', text: string, extra?: HTMLElement): HTMLElement {
    const node = el('div', { class: `msg ${role === 'user' ? 'user' : 'bot'}` });
    if (text) {
      const content = el('div', { class: 'msg-content', text });
      node.appendChild(content);
    }
    if (extra) node.appendChild(extra);
    listEl.appendChild(node);
    scrollBottom();
    return node;
  }

  /** 展现高科技液态等待动效 */
  function showThinking(text: string = t('assistant.thinking')): void {
    hideThinking();
    thinkingEl = el('div', { class: 'msg bot msg-thinking' }, [
      el('div', { class: 'thinking-bubble' }, [
        el('div', { class: 'thinking-dots' }, [
          el('span', { class: 'dot' }),
          el('span', { class: 'dot' }),
          el('span', { class: 'dot' }),
        ]),
        el('span', { class: 'thinking-text', text }),
      ]),
    ]);
    listEl.appendChild(thinkingEl);
    scrollBottom();
  }

  function hideThinking(): void {
    if (thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }

  /** AI 输出的待办候选：可勾选、可编辑后再入库 */
  function proposalCreate(tasks: TaskPatch[]): HTMLElement {
    const items: DraftItem[] = tasks.map((x) => ({ ...x, checked: true }));
    const box = el('div', { class: 'proposal' });
    const head = el('div', { class: 'proposal-head' }, [
      icon('sparkles', { size: 13, class: 'text-primary' }),
      el('span', { text: t('assistant.proposalHead', { n: items.length }) }),
    ]);
    box.appendChild(head);

    for (const item of items) {
      const cb = el('input', { type: 'checkbox', class: 'proposal-checkbox' }) as HTMLInputElement;
      cb.checked = true;
      cb.addEventListener('change', () => {
        item.checked = cb.checked;
      });

      const titleInput = el('input', {
        type: 'text',
        class: 'task-edit-input proposal-title-input',
        value: item.title || '',
      }) as HTMLInputElement;
      titleInput.addEventListener('input', () => {
        item.title = titleInput.value;
      });

      const prioSel = el('select', { class: 'task-edit-select' }) as HTMLSelectElement;
      for (const v of ['high', 'medium', 'low'] as const) {
        const o = el('option', { value: v, text: priorityLabel(v) }) as HTMLOptionElement;
        if (item.priority === v) o.selected = true;
        prioSel.appendChild(o);
      }
      prioSel.addEventListener('change', () => {
        item.priority = prioSel.value as TaskPatch['priority'];
      });

      const catSel = el('select', { class: 'task-edit-select' }) as HTMLSelectElement;
      for (const c of CATEGORIES) {
        const o = el('option', { value: c, text: categoryLabel(c) }) as HTMLOptionElement;
        if (item.category === c) o.selected = true;
        catSel.appendChild(o);
      }
      catSel.addEventListener('change', () => {
        item.category = catSel.value;
      });

      const metaParts: (Node | string)[] = [];
      if (item.dueAt) {
        metaParts.push(icon('calendar', { size: 11 }));
        metaParts.push(` ${fmtDateTime(item.dueAt)}`);
      } else {
        metaParts.push(t('assistant.noTime'));
      }
      if (item.priorityReason) {
        metaParts.push(` · ${item.priorityReason}`);
      }

      const line = el('div', { class: 'proposal-content' }, [
        titleInput,
        el('div', { class: 'pi-meta' }, metaParts),
        el('div', { class: 'task-edit-row' }, [prioSel, catSel]),
      ]);

      box.appendChild(el('div', { class: 'proposal-item' }, [cb, line]));
    }

    const foot = el('div', { class: 'proposal-foot' }, [
      el(
        'button',
        { class: 'ui-btn tiny ghost', onclick: () => box.remove() },
        [icon('close', { size: 12 }), t('assistant.proposalIgnore')]
      ),
      el(
        'button',
        {
          class: 'ui-btn tiny primary',
          onclick: async () => {
            const picked = items.filter((i) => i.checked && (i.title || '').trim());
            if (!picked.length) return toast(t('assistant.pickFirst'), 'warning');
            try {
              await Tasks.createMany(
                picked.map((i) => ({
                  title: (i.title || '').trim(),
                  note: i.note || '',
                  category: i.category,
                  priority: i.priority,
                  priorityReason: i.priorityReason || '',
                  dueAt: i.dueAt ?? null,
                  remindAt: i.remindAt || i.dueAt || null,
                  source: 'ai' as const,
                }))
              );
              box.remove();
              bubble('bot', t('assistant.added', { n: picked.length }));
              toast(t('assistant.added', { n: picked.length }), 'success');
              onTasksChanged();
            } catch (err) {
              toast((err as Error).message, 'error');
            }
          },
        },
        [icon('plus', { size: 12 }), t('assistant.proposalAdd')]
      ),
    ]);
    box.appendChild(foot);
    return box;
  }

  /** 完成任务的确认卡片 */
  function proposalComplete(ids: string[]): HTMLElement | null {
    const tasks = getTasks();
    const matched = tasks.filter((x) => ids.includes(x.id) || ids.includes(x.title));
    if (!matched.length) return null;
    const box = el('div', { class: 'proposal' });
    const head = el('div', { class: 'proposal-head' }, [
      icon('checkCheck', { size: 13, class: 'text-success' }),
      el('span', { text: t('assistant.completeHead', { n: matched.length }) }),
    ]);
    box.appendChild(head);

    for (const task of matched) {
      box.appendChild(
        el('div', { class: 'proposal-item' }, [
          el('div', { class: 'proposal-content' }, [
            el('div', { text: task.title, class: 'proposal-complete-title' }),
            el('div', {
              class: 'pi-meta',
              text: `${categoryLabel(task.category)} · ${priorityLabel(task.priority)}`,
            }),
          ]),
        ])
      );
    }
    const foot = el('div', { class: 'proposal-foot' }, [
      el(
        'button',
        { class: 'ui-btn tiny ghost', onclick: () => box.remove() },
        [icon('close', { size: 12 }), t('task.cancel')]
      ),
      el(
        'button',
        {
          class: 'ui-btn tiny primary',
          onclick: async () => {
            try {
              await Tasks.bulkComplete(matched.map((x) => x.id));
              box.remove();
              bubble('bot', t('assistant.completed', { n: matched.length }));
              toast(t('assistant.completed', { n: matched.length }), 'success');
              onTasksChanged();
            } catch (err) {
              toast((err as Error).message, 'error');
            }
          },
        },
        [icon('check', { size: 12 }), t('assistant.completeConfirm')]
      ),
    ]);
    box.appendChild(foot);
    return box;
  }

  function updateSendBtn(parsing: boolean): void {
    sendBtn.disabled = parsing;
    sendBtn.innerHTML = '';
    if (parsing) {
      sendBtn.appendChild(icon('loader', { size: 14, class: 'animate-spin' }));
      sendBtn.appendChild(document.createTextNode(` ${t('assistant.parsing')}`));
    } else {
      sendBtn.appendChild(icon('send', { size: 14 }));
      sendBtn.appendChild(document.createTextNode(` ${t('assistant.send')}`));
    }
  }

  async function send(text: string): Promise<void> {
    const content = String(text || '').trim();
    if (!content) return;
    inputEl.value = '';
    bubble('user', content);
    updateSendBtn(true);
    showThinking();
    const detachStream = attachStreamBubble();

    try {
      const res = await AI.chat(content);
      const result = res as UnderstandResult;
      let extra: HTMLElement | null = null;
      if (result.intent === 'create' && Array.isArray(result.tasks) && result.tasks.length) {
        extra = proposalCreate(result.tasks);
      } else if (result.intent === 'complete' && Array.isArray(result.matchTitles) && result.matchTitles.length) {
        extra = proposalComplete(result.matchTitles);
      }
      const warn = result.error
        ? el('div', { class: 'warn' }, [
            icon('alertCircle', { size: 13 }),
            el('span', { text: ` ${result.error}` }),
          ])
        : null;

      hideThinking();
      // 复用流式气泡定稿：直接写入最终文本并追加确认卡片，避免闪屏
      const streamed = detachStream();
      let node: HTMLElement;
      if (streamed) {
        const content = streamed.querySelector('.msg-content') as HTMLElement | null;
        if (content) {
          content.classList.remove('streaming');
          content.textContent = result.reply;
        }
        if (extra) streamed.appendChild(extra);
        node = streamed;
      } else {
        node = bubble('bot', result.reply, extra ?? undefined);
      }
      if (warn) node.appendChild(warn);
      if (result.engine === 'ai') {
        const badge = document.getElementById('engine-badge') as HTMLElement;
        if (badge) {
          badge.textContent = t('engine.ai');
          badge.classList.add('ai');
        }
      }
    } catch (err) {
      hideThinking();
      detachStream({ drop: true });
      const errBox = el('div', { class: 'bot-error-msg' }, [
        icon('alertTriangle', { size: 14, class: 'text-error' }),
        el('span', { text: ` ${t('assistant.errorPrefix')}${(err as Error).message}` }),
      ]);
      bubble('bot', '', errBox);
      toast((err as Error).message, 'error');
    } finally {
      streamHandler = null;
      hideThinking();
      updateSendBtn(false);
    }
  }

  async function handleFile(file: File): Promise<void> {
    const isEml = file.name.endsWith('.eml') || file.name.endsWith('.msg');
    const badge = el('div', { class: 'file-upload-bubble' }, [
      icon(isEml ? 'mail' : 'fileText', { size: 14, class: 'text-primary' }),
      el('span', { text: file.name }),
    ]);
    bubble('user', '', badge);
    updateSendBtn(true);
    showThinking(t('assistant.parsingFile'));
    const detachStream = attachStreamBubble();

    try {
      const parsedText = await extractFileText(file);
      const res = await AI.chat(parsedText);
      const result = res as UnderstandResult;
      let extra: HTMLElement | null = null;
      if (Array.isArray(result.tasks) && result.tasks.length) {
        extra = proposalCreate(result.tasks);
      }
      hideThinking();
      const streamed = detachStream();
      const finalText = result.reply || `已从文件 ${file.name} 中解析出以下待办事项：`;
      if (streamed) {
        const content = streamed.querySelector('.msg-content') as HTMLElement | null;
        if (content) {
          content.classList.remove('streaming');
          content.textContent = finalText;
        }
        if (extra) streamed.appendChild(extra);
      } else {
        bubble('bot', finalText, extra ?? undefined);
      }
    } catch (err) {
      hideThinking();
      detachStream({ drop: true });
      const errBox = el('div', { class: 'bot-error-msg' }, [
        icon('alertTriangle', { size: 14, class: 'text-error' }),
        el('span', { text: ` 解析文件失败：${(err as Error).message}` }),
      ]);
      bubble('bot', '', errBox);
      toast((err as Error).message, 'error');
    } finally {
      streamHandler = null;
      hideThinking();
      updateSendBtn(false);
    }
  }

  // 绑定拖拽投放事件
  if (dropzone) {
    dropzone.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-active');
    });
    dropzone.addEventListener('dragleave', (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-active');
    });
    dropzone.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-active');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        void handleFile(files[0]);
      }
    });
    dropzone.addEventListener('click', () => {
      if (fileInput) fileInput.click();
    });
  }

  // 全窗口拖拽文件支持（拖到整个应用时自动展开 AI 助手并提示）
  window.addEventListener('dragover', (e: DragEvent) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      if (panel && panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
      }
    }
  });

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        void handleFile(fileInput.files[0]);
        fileInput.value = '';
      }
    });
  }

  if (attachBtn) {
    attachBtn.addEventListener('click', () => {
      if (fileInput) fileInput.click();
    });
  }

  // 折叠与展开控制
  function togglePanel(): void {
    if (!panel) return;
    panel.classList.toggle('collapsed');
  }

  if (closeBtn) closeBtn.addEventListener('click', togglePanel);
  if (toggleBtn) toggleBtn.addEventListener('click', togglePanel);

  sendBtn.addEventListener('click', () => void send(inputEl.value));
  inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(inputEl.value);
    }
  });

  document.getElementById('chat-quick')!.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('.chip');
    if (chip) void send(chip.textContent || '');
  });

  const clearBtn = document.getElementById('btn-clear-chat');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      listEl.innerHTML = '';
      try {
        await AI.clear();
      } catch {
        /* 忽略 */
      }
      bubble('bot', t('assistant.cleared'));
      toast(t('assistant.cleared'), 'info');
    });
  }

  function setupIcons(): void {
    const headIcon = document.getElementById('assistant-head-icon');
    if (headIcon) {
      headIcon.innerHTML = '';
      headIcon.appendChild(icon('bot', { size: 16 }));
    }
    const dropzoneIcon = document.getElementById('dropzone-icon');
    if (dropzoneIcon) {
      dropzoneIcon.innerHTML = '';
      dropzoneIcon.appendChild(icon('upload', { size: 15, class: 'text-primary' }));
    }
    const attachIcon = document.getElementById('btn-attach-icon');
    if (attachIcon) {
      attachIcon.innerHTML = '';
      attachIcon.appendChild(icon('paperclip', { size: 13, class: 'text-base-content/60' }));
    }
    const closeIcon = document.getElementById('btn-close-assistant-icon');
    if (closeIcon) {
      closeIcon.innerHTML = '';
      closeIcon.appendChild(icon('chevronRight', { size: 14 }));
    }
    const toggleIcon = document.getElementById('btn-assistant-icon');
    if (toggleIcon) {
      toggleIcon.innerHTML = '';
      toggleIcon.appendChild(icon('bot', { size: 14 }));
    }
    if (clearBtn) {
      clearBtn.innerHTML = '';
      clearBtn.appendChild(icon('reset', { size: 12 }));
      clearBtn.appendChild(document.createTextNode(` ${t('assistant.clear')}`));
    }
  }

  setupIcons();
  updateSendBtn(false);

  return {
    send,
    handleFile,
    toggle: togglePanel,
    async loadHistory() {
      try {
        const history = await AI.history();
        listEl.innerHTML = '';
        if (!history.length) {
          bubble('bot', t('assistant.welcome'));
          return;
        }
        for (const m of history) bubble(m.role === 'user' ? 'user' : 'bot', m.content);
      } catch {
        bubble('bot', t('assistant.welcome'));
      }
    },
    welcome() {
      listEl.innerHTML = '';
      bubble('bot', t('assistant.welcome'));
    },
    relocalize() {
      setupIcons();
      updateSendBtn(sendBtn.disabled);
      if (!listEl.children.length) this.welcome();
    },
  };
}
