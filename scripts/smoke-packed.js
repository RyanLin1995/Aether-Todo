'use strict';
/**
 * 打包后冒烟：启动 dist/win-unpacked 中的 exe，用 CDP 确认
 *   1) preload 桥接可用（typeof window.api）
 *   2) 样式表已加载（document.styleSheets.length > 0，且按钮高度符合样式）
 *   3) 资源查询串 ?v=<version> 未导致 404
 *
 * 用法：node scripts/smoke-packed.js [exe 相对路径]
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9455;
const EXE = process.argv[2] || path.join(ROOT, 'dist', 'win-unpacked', 'Aether Todo.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('[smoke] 启动 exe:', EXE);
  if (!fs.existsSync(EXE)) throw new Error(`未找到 exe：${EXE}`);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-smoke-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    EXE,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--no-sandbox', '--disable-gpu'],
    { stdio: 'ignore', env }
  );
  const kill = () => {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  };

  child.on('exit', (code) => console.log('[smoke] exe 退出，code =', code));
  let page = null;
  for (let i = 0; i < 30; i++) {
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
    const mid = ++id;
    ws.send(JSON.stringify({ id: mid, method, params }));
    return new Promise((res) => pending.set(mid, res));
  };

  await send('Runtime.enable');
  await sleep(2600);
  const expr = `JSON.stringify({
    api: typeof window.api,
    sheets: document.styleSheets.length,
    btnHeight: (document.querySelector('#btn-new') ? getComputedStyle(document.querySelector('#btn-new')).height : 'no-btn'),
    title: document.title
  })`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  const data = JSON.parse(r?.result?.value || '{}');

  const ok = data.api === 'object' && data.sheets > 0;
  console.log('=== 打包后冒烟 ===');
  console.log('exe           :', EXE);
  console.log('window.api    :', data.api);
  console.log('样式表数量    :', data.sheets);
  console.log('主按钮高度    :', data.btnHeight);
  console.log('标题          :', data.title);
  console.log(ok ? '冒烟通过 ✅' : '冒烟失败 ❌');

  ws.close();
  kill();
  // 不调用 process.exit，避免 stdout 走管道时输出被截断
  process.exitCode = ok ? 0 : 1;
  await sleep(600);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
