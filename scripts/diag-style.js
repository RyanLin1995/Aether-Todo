'use strict';
/** 样式诊断：抓取渲染后的计算样式，输出字号层次、字体族与 WCAG 对比度 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9446;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-style-'));
const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    electronBin,
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`, '--no-sandbox', '--disable-gpu'],
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
  await sleep(2500);

  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      // 用 canvas 把 oklch/含 alpha 的颜色转成真实 RGB（并做 alpha 混合）
      const toRgba = (c) => {
        const cv = document.createElement('canvas');
        cv.width = 1;
        cv.height = 1;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const lum = ([r, g, b]) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (fgStr, bgStr) => {
        const fg = toRgba(fgStr);
        const bg = toRgba(bgStr);
        const a = fg[3];
        const blended = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
        const l1 = lum(blended), l2 = lum([bg[0], bg[1], bg[2]]);
        const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
        return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
      };
      const bgOf = (node) => {
        let n = node;
        while (n && n !== document.documentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
          n = n.parentElement;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      const probe = (sel) => {
        const n = document.querySelector(sel);
        if (!n) return null;
        const s = getComputedStyle(n);
        const color = s.color;
        const bg = bgOf(n);
        return { size: s.fontSize, weight: s.fontWeight, color, bg, contrast: ratio(color, bg), fontFamily: s.fontFamily.split(',')[0] };
      };
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        root: getComputedStyle(document.documentElement).fontSize,
        body: probe('body'),
        items: {
          'content h2': probe('#content-title'),
          'task title': probe('.task-title'),
          'task note': probe('.task-note'),
          'task reason': probe('.task-reason'),
          'tag': probe('.tag'),
          'stat num': probe('.stat-num'),
          'stat label': probe('.stat-label'),
          'sidebar h3': probe('.side-block h3'),
          'filter li': probe('.filter-list li'),
          'assistant sub': probe('.assistant-sub'),
          'msg': probe('.msg'),
          'chip': probe('.chip'),
          'hint': probe('.hint'),
          'engine badge': probe('.engine-badge'),
        },
      };
    })()`,
    returnByValue: true,
  });
  console.log(JSON.stringify(r.result?.value, null, 2));

  ws.close();
  kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('诊断失败:', e.message);
  process.exit(1);
});
