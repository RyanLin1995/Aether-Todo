'use strict';
/** 诊断浮窗：抓取浮窗页面的 console 错误与 API 可用性 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9449;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectTo(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
      console.log(`  [console.${m.params.type}] ${String(text).slice(0, 300)}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      console.log(`  [exception] ${(d.exception?.description || d.text || '').slice(0, 500)}`);
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
  return { ws, send };
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-float-'));
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

  let main = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await listTargets();
      main = list.find((t) => (t.url || '').includes('index.html'));
      if (main) break;
    } catch {
      /* ignore */
    }
    await sleep(400);
  }
  if (!main) throw new Error('主界面未就绪');

  const m = await connectTo(main);
  await m.send('Runtime.enable');
  await sleep(2000);

  // 造一条任务并打开浮窗
  await m.send('Runtime.evaluate', {
    expression: `(async () => {
      await window.api.createTask({ title: '浮窗诊断任务', category: '工作', priority: 'high', source: 'manual' });
      await window.api.floatShow();
      return 'ok';
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  await sleep(2500);

  const list = await listTargets();
  const floatTarget = list.find((t) => (t.url || '').includes('float.html'));
  if (!floatTarget) {
    console.log('未找到浮窗 target');
    kill();
    process.exit(1);
  }
  console.log('浮窗 target:', floatTarget.url);

  const f = await connectTo(floatTarget);
  await f.send('Runtime.enable');
  await sleep(1200);

  const probe = await f.send('Runtime.evaluate', {
    expression: `(async () => {
      const api = window.api;
      let stateResult = 'not-called';
      let err = null;
      try {
        const r = await api.floatState();
        stateResult = JSON.stringify(r).slice(0, 300);
      } catch (e) { err = String(e); }
      return {
        hasApi: typeof api !== 'undefined',
        apiKeys: api ? Object.keys(api).slice(0, 40) : [],
        titleEl: document.getElementById('float-title')?.textContent,
        stateResult,
        err,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('[浮窗探测]', JSON.stringify(probe?.result?.value, null, 2));

  m.ws.close();
  f.ws.close();
  kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('诊断失败:', e.message);
  process.exit(1);
});
