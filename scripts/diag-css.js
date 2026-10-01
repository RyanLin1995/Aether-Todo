'use strict';
/** 抓取 .btn / .chip / .tag 相关 CSS 规则，定位样式为何不生效 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9448;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-css-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--no-sandbox', '--disable-gpu'],
    { cwd: ROOT, env, stdio: 'ignore' }
  );
  const kill = () => {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  };

  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) break;
    } catch {
      /* ignore */
    }
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
  await sleep(2400);

  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const hits = [];
      const wanted = ['btn', 'chip', 'tag', 'engine-badge', 'check'];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try { rules = Array.from(sheet.cssRules); } catch { continue; }
        for (const rule of rules) {
          const sel = rule.selectorText || '';
          if (!wanted.some((w) => sel.includes(w))) continue;
          if (/^(\.btn|\.btn\.|\.chip$|\.tag|\.tag\.|\.check|\.engine-badge)/.test(sel)) {
            hits.push({ sel, props: (rule.style && rule.style.cssText || '').replace(/\\s+/g, ' ').slice(0, 160) });
          }
        }
      }
      const grab = (sel, props) => {
        const n = document.querySelector(sel);
        if (!n) return sel + ' → 元素不存在';
        const s = getComputedStyle(n);
        return sel + ' → ' + props.map((p) => p + ': ' + s[p]).join(' | ');
      };
      return {
        rules: hits,
        computed: [
          grab('#btn-new', ['backgroundColor', 'color', 'height', 'borderRadius']),
          grab('.task-actions .btn.ghost', ['backgroundColor', 'color', 'height']),
          grab('.chip', ['backgroundColor', 'color', 'height']),
          grab('.tag.prio-high', ['backgroundColor', 'color', 'height']),
        ],
      };
    })()`,
    returnByValue: true,
  });
  const data = r?.result?.value;
  console.log('=== computed ===');
  for (const line of data.computed) console.log(line);
  console.log('\n=== 规则命中（' + data.rules.length + ' 条）===');
  for (const h of data.rules) console.log(h.sel + '  ⇒  ' + h.props);

  ws.close();
  kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
