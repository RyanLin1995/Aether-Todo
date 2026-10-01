'use strict';
/** 诊断：启动应用并抓取渲染进程 console 错误与 window.api 状态 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9445;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-diag-'));
const electronBin =
  process.platform === 'win32'
    ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    electronBin,
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`, '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    { cwd: ROOT, env, stdio: 'ignore' }
  );

  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) break;
    } catch {}
    await sleep(400);
  }
  if (!page) throw new Error('页面未就绪');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const pending = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      console.log(`[console.${m.params.type}]`, text.slice(0, 500));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      console.log('[exception]', (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 800));
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) => {
    const msgId = ++id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return new Promise((res) => pending.set(msgId, res));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500);

  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const cs = (sel, props) => {
        const n = document.querySelector(sel);
        if (!n) return null;
        const s = getComputedStyle(n);
        return Object.fromEntries(props.map((p) => [p, s[p]]));
      };
      return {
        html: cs('html', ['fontSize', 'fontFamily', 'lineHeight']),
        body: cs('body', ['fontSize', 'fontFamily', 'lineHeight']),
        taskTitle: cs('.task-title', ['fontSize', 'lineHeight', 'fontFamily']),
        taskNote: cs('.task-note', ['fontSize']),
        tag: cs('.tag', ['fontSize', 'lineHeight']),
        btn: cs('.btn', ['fontSize', 'height']),
        badge: cs('.engine-badge', ['fontSize']),
        msg: cs('.msg', ['fontSize', 'lineHeight']),
        chip: cs('.chip', ['fontSize']),
        textarea: cs('#chat-input', ['fontSize', 'lineHeight', 'fontFamily']),
        filterItem: cs('.filter-list li', ['fontSize']),
        statNum: cs('.stat-num', ['fontSize']),
        statLabel: cs('.stat-label', ['fontSize']),
        searchInput: cs('#search-input', ['fontSize', 'height']),
      };
    })()`,
    returnByValue: true,
  });
  console.log('[raw evaluate result]', JSON.stringify(r).slice(0, 400));
  console.log('[computed styles]', JSON.stringify(r.result?.value, null, 2));

  // 尝试发送一条 AI 消息
  await send('Runtime.evaluate', {
    expression: `(() => { const i = document.getElementById('chat-input'); if (i) { i.value = '明天买菜'; document.getElementById('btn-send').click(); } })()`,
  });
  await sleep(2500);
  const r2 = await send('Runtime.evaluate', {
    expression: `document.querySelectorAll('#chat-messages .msg').length`,
    returnByValue: true,
  });
  console.log('[chat msgs]', JSON.stringify(r2.result?.result?.value));

  ws.close();
  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('诊断失败:', e.message);
  process.exit(1);
});
