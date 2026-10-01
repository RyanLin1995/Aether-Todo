'use strict';
/**
 * 端到端 GUI 测试：启动真实 Electron 应用，通过 CDP 驱动界面
 * 覆盖：注册 → 主界面 → AI 自然语言建任务 → 确认入库 → 任务渲染 → 截图
 * 运行：node tests/e2e.js
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 9333;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-e2e-'));
const SHOT_DIR = path.join(ROOT, 'tests', 'screenshots');

const electronBin =
  process.platform === 'win32'
    ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');

// 可通过 AITODO_BIN 指定可执行文件路径（例如打包后的 dist/win-unpacked/AI待办.exe）
const customBin = process.env.AITODO_BIN;
const bin = customBin || electronBin;
const baseArgs = customBin ? [] : ['.'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  console.log(...a);
}

async function waitForTargets(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 还没起来 */
    }
    await sleep(500);
  }
  throw new Error('等待调试端口超时');
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error('WebSocket 连接失败'));
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[Browser Exception]', JSON.stringify(msg.params.exceptionDetails));
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => a.value || a.description || '').join(' ');
        console.log(`[Browser Console ${msg.params.type}]`, text);
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, 30000);
    });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || '页面脚本异常');
    }
    return r.result.value;
  }

  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const file = path.join(SHOT_DIR, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* 忽略 */
    }
  }
}

async function main() {
  log('启动 Electron…');
  // 注意：宿主环境可能注入 ELECTRON_RUN_AS_NODE=1，会让 electron.exe 退化成纯 node，必须清除
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    bin,
    [
      ...baseArgs,
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${USER_DATA}`,
      // 受限环境（无 GPU / 沙箱）下保证仍能启动并截图
      '--no-sandbox',
      '--disable-gpu',
      '--disable-gpu-sandbox',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
    ],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.trim()) process.stdout.write(`[app] ${s}`);
  });

  const cleanup = () => {
    try {
      // Windows 上 child.kill() 杀不干净 Electron 进程树，必须用 taskkill /T
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill();
      }
    } catch {
      /* 忽略 */
    }
  };
  process.on('exit', cleanup);

  let failed = 0;
  const check = (name, ok, detail = '') => {
    log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failed += 1;
  };

  // 本地 mock OpenAI 服务器：验证「测试连接」与 callLLM 全链路（不依赖外网）
  // model = 'mock-empty' 时返回空内容，用于验证“模型偶发空内容仍视为连接正常”
  const mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let model = '';
      try {
        model = JSON.parse(body).model || '';
      } catch {
        /* 忽略 */
      }
      const content =
        model === 'mock-empty'
          ? ''
          : JSON.stringify({
              reply: 'Mock reply: 1 task(s) would be created for testing.',
              intent: 'chat',
              tasks: [],
              matchTitles: [],
            });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockServer.address().port;
  log(`mock OpenAI 已启动: http://127.0.0.1:${mockPort}/v1`);

  // 本地 HTTP 代理：同时支持绝对 URI 转发与 CONNECT 隧道，用于验证代理链路
  let proxyHits = 0;
  const proxyServer = http.createServer((req, res) => {
    proxyHits += 1;
    let target;
    try {
      target = new URL(req.url);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  proxyServer.on('connect', (req, clientSocket, head) => {
    proxyHits += 1;
    const [host, port] = String(req.url).split(':');
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.end());
  });
  await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  const proxyPort = proxyServer.address().port;
  log(`本地测试代理已启动: http://127.0.0.1:${proxyPort}`);

  try {
    const target = await waitForTargets();
    log('已连接渲染进程');
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await sleep(1200);

    const shots = [];

    // 1. 免登录：启动即主界面
    await sleep(600);
    const appVisible = await cdp.evaluate(`!document.getElementById('app-view').classList.contains('hidden')`);
    check('启动后直接进入主界面（无登录环节）', appVisible === true);
    const noAuthDom = await cdp.evaluate(`document.getElementById('auth-view') === null && !document.querySelector('.tab')`);
    check('登录/注册 DOM 已彻底移除', noAuthDom === true);
    const noLogout = await cdp.evaluate(`document.getElementById('btn-logout') === null`);
    check('顶栏不再有退出登录按钮', noLogout === true);
    shots.push(await cdp.shot('01-主界面（空列表）'));

    // 3. AI 自然语言建任务
    await cdp.evaluate(`
      (async () => {
        const input = document.getElementById('chat-input');
        input.value = '明天下午三点前把周报发给老板，很急；另外周末有空给妈妈打个电话';
        document.getElementById('btn-send').click();
      })()
    `);
    await sleep(2500);
    const botReplies = await cdp.evaluate(`document.querySelectorAll('#chat-messages .msg.bot').length`);
    check('AI 返回了回复', botReplies >= 1, `${botReplies} 条`);
    const proposalCount = await cdp.evaluate(`document.querySelectorAll('.proposal .proposal-item').length`);
    check('AI 解析出任务候选', proposalCount >= 1, `${proposalCount} 条候选`);

    const firstTitle = await cdp.evaluate(
      `document.querySelector('.proposal .proposal-item input[type=text]')?.value || ''`
    );
    check('候选任务有标题', String(firstTitle).length > 0, String(firstTitle));
    const prioTag = await cdp.evaluate(`
      Array.from(document.querySelectorAll('.proposal .proposal-item select'))[0]?.value || ''
    `);
    check('AI 已判定优先级', ['high', 'medium', 'low'].includes(prioTag), prioTag);
    shots.push(await cdp.shot('03-AI解析结果'));

    // 4. 确认加入待办
    await cdp.evaluate(`
      (async () => {
        const btns = Array.from(document.querySelectorAll('.proposal-foot .ui-btn'));
        const add = btns.find(b => b.textContent.includes('加入待办'));
        add.click();
      })()
    `);
    await sleep(1800);
    const taskCount = await cdp.evaluate(`document.querySelectorAll('#task-list .task-card').length`);
    check('任务已写入列表', taskCount >= 1, `${taskCount} 条任务`);

    const meta = await cdp.evaluate(`
      (() => {
        const card = document.querySelector('#task-list .task-card');
        if (!card) return null;
        return {
          title: card.querySelector('.task-title')?.textContent,
          tags: Array.from(card.querySelectorAll('.tag')).map(t => t.textContent),
          reason: card.querySelector('.task-reason')?.textContent || '',
        };
      })()
    `);
    check('任务卡片含类别标签', meta && meta.tags.some((t) => ['工作', '学习', '生活', '健康', '财务', '社交', '其他'].includes(t)), JSON.stringify(meta?.tags));
    check('任务卡片含 AI 判定理由', meta && meta.reason.length > 0, meta?.reason);
    check('任务卡片含时间标签', meta && meta.tags.some((t) => t.includes('📅') || /\d{1,2}:\d{2}/.test(t)), JSON.stringify(meta?.tags));
    shots.push(await cdp.shot('04-任务已添加'));

    // 5. 手动新建任务
    await cdp.evaluate(`document.getElementById('btn-new').click()`);
    await sleep(600);
    await cdp.evaluate(`
      (async () => {
        const card = document.querySelector('#task-list .task-card');
        const input = card.querySelector('input[type=text]');
        input.value = '手动创建的任务：买牛奶';
        const save = Array.from(card.querySelectorAll('button')).find(b => b.textContent.includes('保存'));
        save.click();
      })()
    `);
    await sleep(1200);
    const afterManual = await cdp.evaluate(
      `Array.from(document.querySelectorAll('#task-list .task-title')).map(n => n.textContent)`
    );
    check('手动新建任务成功', afterManual.some((t) => t.includes('买牛奶')), JSON.stringify(afterManual));

    // 6. 完成 & 筛选
    await cdp.evaluate(`
      (async () => {
        const cards = Array.from(document.querySelectorAll('#task-list .task-card'));
        cards[0].querySelector('.check').click();
      })()
    `);
    await sleep(1200);
    const stats = await cdp.evaluate(`document.getElementById('stat-done').textContent`);
    check('勾选完成后「已完成」计数增加', Number(stats) >= 1, `已完成 ${stats}`);

    await cdp.evaluate(`
      document.querySelector('#view-filter li[data-view="done"]').click();
    `);
    await sleep(900);
    const doneList = await cdp.evaluate(
      `Array.from(document.querySelectorAll('#task-list .task-card')).map(c => c.classList.contains('done'))`
    );
    check('「已完成」视图只显示已完成任务', doneList.length > 0 && doneList.every(Boolean), JSON.stringify(doneList));
    shots.push(await cdp.shot('05-已完成视图'));

    // 7. 设置弹窗
    await cdp.evaluate(`document.getElementById('btn-settings').click()`);
    await sleep(700);
    const modalOpen = await cdp.evaluate(`!document.getElementById('settings-modal').classList.contains('hidden')`);
    check('设置弹窗可打开', modalOpen === true);
    const aboutText = await cdp.evaluate(`document.getElementById('about-info').textContent`);
    check('设置页显示版本信息', String(aboutText).includes('版本'), String(aboutText).slice(0, 60));
    check('设置页标注 Apache-2.0 许可', String(aboutText).includes('Apache-2.0'), String(aboutText).slice(0, 80));
    shots.push(await cdp.shot('06-设置'));

    // 7.1 测试连接（本地 mock OpenAI，验证 callLLM 全链路）
    await cdp.evaluate(`
      (async () => {
        const set = (id, v) => {
          const n = document.getElementById(id);
          n.value = v;
          n.dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('set-baseurl', 'http://127.0.0.1:${mockPort}/v1');
        set('set-apikey', 'sk-e2e-mock');
        set('set-model', 'mock-model');
      })()
    `);
    await sleep(1000);
    await cdp.evaluate(`document.getElementById('btn-test-ai').click()`);
    await sleep(3000);
    const testResult = await cdp.evaluate(`document.getElementById('ai-test-result').textContent`);
    check(
      '测试连接走通远端 mock（callLLM 验证）',
      testResult.includes('连接成功') || /Connected/i.test(testResult),
      testResult
    );
    // 7.1c 模型返回空内容时，测活仍应显示“连接成功”（不当作调用失败）
    await cdp.evaluate(`
      (async () => {
        const set = (id, v) => {
          const n = document.getElementById(id);
          n.value = v;
          n.dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('set-model', 'mock-empty');
      })()
    `);
    await sleep(900);
    await cdp.evaluate(`document.getElementById('btn-test-ai').click()`);
    await sleep(3000);
    let emptyResult = await cdp.evaluate(`document.getElementById('ai-test-result').textContent`);
    // 空响应会重试一次，冷启动时可能还没跑完 —— 再等等
    if (/正在测试|Testing/i.test(emptyResult)) {
      await sleep(3000);
      emptyResult = await cdp.evaluate(`document.getElementById('ai-test-result').textContent`);
    }
    check(
      '模型返回空内容时测活仍显示连接成功',
      (emptyResult.includes('连接成功') || /Connected/i.test(emptyResult)) && !emptyResult.includes('❌'),
      emptyResult
    );
    await cdp.evaluate(`
      (async () => {
        const set = (id, v) => {
          const n = document.getElementById(id);
          n.value = v;
          n.dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('set-model', 'mock-model');
      })()
    `);
    await sleep(700);

    // 7.2 主题切换（daisyUI data-theme）
    const themeDark = await cdp.evaluate(`
      (async () => {
        const sel = document.getElementById('set-theme');
        sel.value = 'dark';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        const html = document.documentElement;
        return { attr: html.getAttribute('data-theme'), bg: getComputedStyle(html).backgroundColor };
      })()
    `);
    check('切换深色主题生效', themeDark.attr === 'dark' && themeDark.bg && themeDark.bg !== 'rgb(255, 255, 255)', JSON.stringify(themeDark));
    shots.push(await cdp.shot('06b-深色主题'));
    await cdp.evaluate(`
      (async () => {
        const sel = document.getElementById('set-theme');
        sel.value = 'light';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await sleep(400);
    check(
      '切回浅色主题生效',
      (await cdp.evaluate(`document.documentElement.getAttribute('data-theme')`)) === 'light'
    );

    // 7.1b 自定义代理链路：设置代理后再测连接，应经由本地代理到达 mock
    await cdp.evaluate(`
      (async () => {
        const set = (id, v) => {
          const n = document.getElementById(id);
          n.value = v;
          n.dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('set-proxy-mode', 'custom');
        await new Promise(r => setTimeout(r, 300));
        set('set-proxy-url', 'http://127.0.0.1:${proxyPort}');
      })()
    `);
    await sleep(1000);
    const proxyFieldVisible = await cdp.evaluate(
      `!document.getElementById('proxy-url-field').classList.contains('hidden')`
    );
    check('选自定义代理后显示地址输入框', proxyFieldVisible === true, String(proxyFieldVisible));
    const hitsBefore = proxyHits;
    await cdp.evaluate(`document.getElementById('btn-test-ai').click()`);
    await sleep(3500);
    const proxiedResult = await cdp.evaluate(`document.getElementById('ai-test-result').textContent`);
    check(
      '经自定义代理连接成功',
      (proxiedResult.includes('连接成功') || /Connected/i.test(proxiedResult)) && proxyHits > hitsBefore,
      `${proxiedResult} / 代理命中 ${proxyHits - hitsBefore} 次`
    );
    shots.push(await cdp.shot('06c-代理设置'));

    // 关闭代理，恢复直连
    await cdp.evaluate(`
      (async () => {
        const sel = document.getElementById('set-proxy-mode');
        sel.value = 'none';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await sleep(600);
    const proxyOffHidden = await cdp.evaluate(
      `document.getElementById('proxy-url-field').classList.contains('hidden')`
    );
    check('切回不使用代理后隐藏地址输入框', proxyOffHidden === true, String(proxyOffHidden));

    // 清空 Key，恢复本地引擎，避免影响后续用例
    await cdp.evaluate(`
      (async () => {
        const n = document.getElementById('set-apikey');
        n.value = '';
        n.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await sleep(700);
    await cdp.evaluate(`document.getElementById('btn-close-settings').click()`);

    // 8. 提醒：创建一条已到点的任务，触发主进程通知
    const reminderResult = await cdp.evaluate(`
      (async () => {
        await window.api.createTask({
          title: '端到端提醒测试任务',
          category: '其他',
          priority: 'high',
          dueAt: new Date(Date.now() - 60000).toISOString(),
          remindAt: new Date(Date.now() - 60000).toISOString(),
        });
        const r = await window.api.checkReminders();
        return r;
      })()
    `);
    check('到期任务可被提醒调度器捕获', reminderResult && reminderResult.data && reminderResult.data.count >= 1, `count=${reminderResult?.data?.count}`);

    // 9. 刷新页面：仍免登录，且数据本地持久化
    await cdp.send('Page.reload', { ignoreCache: false });
    await sleep(2500);
    const afterReload = await cdp.evaluate(`
      (() => ({
        appVisible: !document.getElementById('app-view').classList.contains('hidden'),
        tasks: document.querySelectorAll('#task-list .task-card').length,
      }))()
    `);
    check('刷新后仍免登录进入主界面', afterReload.appVisible === true);
    check('刷新后数据保留（本地持久化）', afterReload.tasks >= 1, `${afterReload.tasks} 条`);
    shots.push(await cdp.shot('07-刷新后数据保留'));

    // 10. 切换界面语言到英文
    await cdp.evaluate(`
      (async () => {
        document.getElementById('btn-settings').click();
        await new Promise(r => setTimeout(r, 400));
        const sel = document.getElementById('set-locale');
        sel.value = 'en-US';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await sleep(1800);
    const en = await cdp.evaluate(`
      (() => ({
        newBtn: document.getElementById('btn-new').textContent,
        views: Array.from(document.querySelectorAll('#view-filter li')).map(n => n.textContent),
        cats: Array.from(document.querySelectorAll('#category-filter li')).map(n => n.textContent).slice(0, 3),
        docTitle: document.title,
        settings: document.getElementById('btn-settings').textContent,
        send: document.getElementById('btn-send').textContent,
        tags: Array.from(document.querySelectorAll('#task-list .tag')).map(n => n.textContent).slice(0, 2),
      }))()
    `);
    check('切换英文后按钮文案为英文', en.newBtn.includes('New task'), en.newBtn);
    check('切换英文后顶栏按钮为英文', en.settings.trim().includes('Settings'), en.settings);
    check('切换英文后视图列表为英文', en.views.includes('Active'), JSON.stringify(en.views));
    check('切换英文后类别为英文', en.cats.includes('Work'), JSON.stringify(en.cats));
    check('切换英文后窗口标题为 AI Todo', en.docTitle.includes('Todo'), en.docTitle);
    check('切换英文后任务标签为英文', en.tags.some((x) => /priority|Work|Study|Life|Health|Finance|Social|Other/i.test(x)), JSON.stringify(en.tags));
    shots.push(await cdp.shot('08-英文界面'));

    // 11. 英文自然语言输入 → 英文解析结果
    await cdp.evaluate(`document.getElementById('btn-close-settings').click()`);
    await sleep(400);
    await cdp.evaluate(`
      (async () => {
        const input = document.getElementById('chat-input');
        input.value = 'Send the weekly report to my boss tomorrow at 3pm, urgent';
        document.getElementById('btn-send').click();
      })()
    `);
    await sleep(2600);
    const enAi = await cdp.evaluate(`
      (() => {
        const bots = Array.from(document.querySelectorAll('#chat-messages .msg.bot'));
        const last = bots[bots.length - 1];
        return {
          text: last ? last.textContent.slice(0, 200) : '',
          title: document.querySelector('.proposal-item input[type=text]')?.value || '',
          prio: document.querySelector('.proposal-item select')?.value || '',
        };
      })()
    `);
    check('英文输入得到英文回复', /task/i.test(enAi.text) && !/[一-龥]/.test(enAi.text), enAi.text.slice(0, 90));
    check('英文输入解析出任务标题', enAi.title.length > 0 && !/[一-龥]/.test(enAi.title), enAi.title);
    check('英文输入判定优先级', ['high', 'medium', 'low'].includes(enAi.prio), enAi.prio);
    shots.push(await cdp.shot('09-英文AI解析'));

    // 12. 刷新后语言保持
    await cdp.send('Page.reload', { ignoreCache: false });
    await sleep(2500);
    const keepLocale = await cdp.evaluate(`
      (() => ({
        newBtn: document.getElementById('btn-new').textContent,
        docTitle: document.title,
      }))()
    `);
    check('刷新后仍保持英文（语言已持久化）', keepLocale.newBtn.includes('New task'), keepLocale.newBtn);

    // 13. 切回简体中文
    await cdp.evaluate(`
      (async () => {
        document.getElementById('btn-settings').click();
        await new Promise(r => setTimeout(r, 400));
        const sel = document.getElementById('set-locale');
        sel.value = 'zh-CN';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await sleep(1600);
    const zh = await cdp.evaluate(`
      (() => ({
        newBtn: document.getElementById('btn-new').textContent,
        cats: Array.from(document.querySelectorAll('#category-filter li')).map(n => n.textContent).slice(0, 3),
      }))()
    `);
    check('可切回简体中文', zh.newBtn.includes('新建任务'), zh.newBtn);
    check('切回中文后类别为中文', zh.cats.includes('工作'), JSON.stringify(zh.cats));
    shots.push(await cdp.shot('10-切回中文'));

    // 14. 统计页
    await cdp.evaluate(`document.querySelector('#view-filter li[data-view=stats]').click()`);
    await sleep(1500);
    const statView = await cdp.evaluate(`
      (() => ({
        visible: !document.getElementById('stats-view').classList.contains('hidden'),
        taskHidden: document.getElementById('task-list').classList.contains('hidden'),
        metrics: Array.from(document.querySelectorAll('.stats-metric-value')).map(n => n.textContent),
        weekBars: document.querySelectorAll('.stats-col').length,
        tabs: Array.from(document.querySelectorAll('.stats-tab')).map(n => n.textContent.trim()),
        hasChart: !!document.querySelector('.stats-bar'),
      }))()
    `);
    check('统计页可打开且隐藏任务列表', statView.visible && statView.taskHidden, JSON.stringify(statView).slice(0, 60));
    check('统计显示 4 项指标', statView.metrics.length === 4, JSON.stringify(statView.metrics));
    check('本周趋势有 7 根柱', statView.weekBars === 7, String(statView.weekBars));
    check('统计含三个时间维度切换', statView.tabs.length === 3, JSON.stringify(statView.tabs));
    check('已完成任务计入统计', Number(statView.metrics[0]) >= 1, statView.metrics[0]);
    shots.push(await cdp.shot('11-统计页'));

    await cdp.evaluate(`document.querySelectorAll('.stats-tab')[2].click()`);
    await sleep(1200);
    const yearBars = await cdp.evaluate(`document.querySelectorAll('.stats-col').length`);
    check('今年趋势有 12 根柱', yearBars === 12, String(yearBars));
    shots.push(await cdp.shot('12-统计页-今年'));

    await cdp.evaluate(`document.querySelector('#view-filter li[data-view=active]').click()`);
    await sleep(900);
    const backToTasks = await cdp.evaluate(`!document.getElementById('task-list').classList.contains('hidden')`);
    check('可从统计页返回任务列表', backToTasks === true, String(backToTasks));

    // 15. 番茄钟 + 浮窗
    await cdp.evaluate(`document.querySelector('#view-filter li[data-view=active]').click()`);
    await sleep(1000);
    const pomoStarted = await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('#task-list .task-card button'));
        const btn = btns.find((b) => b.classList.contains('pomo-btn') || b.textContent.includes('🍅'));
        if (!btn) return { clicked: false };
        btn.click();
        return { clicked: true, hasCount: true };
      })()
    `);
    check('任务卡片有番茄钟按钮', pomoStarted.clicked === true, JSON.stringify(pomoStarted));
    await sleep(2000);

    const pomoState = await cdp.evaluate(`
      (async () => {
        const res = await window.api.pomodoroStatus();
        return {
          running: Boolean(res.data),
          minutes: res.data ? res.data.minutes : null,
          indicatorVisible: !document.getElementById('pomodoro-indicator').classList.contains('hidden'),
          indicatorText: document.getElementById('pomodoro-indicator').textContent.trim(),
        };
      })()
    `);
    check('番茄钟已启动', pomoState.running === true && pomoState.minutes > 0, JSON.stringify(pomoState));
    check('顶栏显示专注倒计时', pomoState.indicatorVisible && /\d{2}:\d{2}/.test(pomoState.indicatorText), pomoState.indicatorText);

    // 浮窗：CDP 目标里应出现 float.html
    const floatTargets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const floatTarget = floatTargets.find((t) => (t.url || '').includes('float.html'));
    check('番茄钟会打开浮窗', Boolean(floatTarget), floatTarget ? 'float.html 已加载' : '未找到浮窗');
    shots.push(await cdp.shot('13-番茄钟运行中'));

    // 浮窗内容
    if (floatTarget) {
      const fws = new WebSocket(floatTarget.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        fws.onopen = res;
        fws.onerror = rej;
      });
      const floatEval = (expression) =>
        new Promise((resolve) => {
          const msgId = Math.floor(Math.random() * 1e6);
          const onMsg = (e) => {
            const m = JSON.parse(e.data);
            if (m.id === msgId) {
              fws.removeEventListener('message', onMsg);
              resolve(m.result?.result?.value);
            }
          };
          fws.addEventListener('message', onMsg);
          fws.send(
            JSON.stringify({ id: msgId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })
          );
        });
      const floatInfo = await floatEval(`
        (() => ({
          title: document.getElementById('float-title').textContent,
          clock: document.getElementById('float-clock').textContent,
          slider: document.getElementById('float-opacity').value,
          hasStop: !document.getElementById('float-stop').classList.contains('hidden'),
        }))()
      `);
      check('浮窗显示当前任务', Boolean(floatInfo.title) && floatInfo.title !== '—', floatInfo.title);
      check('浮窗显示番茄倒计时', /\d{2}:\d{2}/.test(floatInfo.clock), floatInfo.clock);
      check('浮窗有透明度滑块', Number(floatInfo.slider) >= 30 && Number(floatInfo.slider) <= 100, floatInfo.slider);
      fws.close();
    }

    // 透明度可调并持久化
    const opacityRes = await cdp.evaluate(`
      (async () => {
        await window.api.floatSetOpacity(0.7);
        const st = await window.api.floatState();
        return st.data ? st.data.opacity : null;
      })()
    `);
    check('透明度可调整', Math.abs(Number(opacityRes) - 0.7) < 0.01, String(opacityRes));

    // 停止番茄钟
    await cdp.evaluate(`window.api.pomodoroStop()`);
    await sleep(900);
    const pomoStopped = await cdp.evaluate(`
      (async () => {
        const res = await window.api.pomodoroStatus();
        return {
          running: Boolean(res.data),
          indicatorHidden: document.getElementById('pomodoro-indicator').classList.contains('hidden'),
        };
      })()
    `);
    check('番茄钟可停止并隐藏指示器', pomoStopped.running === false && pomoStopped.indicatorHidden, JSON.stringify(pomoStopped));

    // 收起浮窗
    await cdp.evaluate(`window.api.floatHide()`);
    await sleep(600);

    log('\n截图输出：');
    for (const s of shots) log(`  📷 ${s}`);

    cdp.close();
  } catch (err) {
    failed += 1;
    log(`\n执行异常：${err.message}`);
    if (stderr.trim()) log(`应用 stderr:\n${stderr.slice(0, 3000)}`);
  } finally {
    mockServer.close();
    proxyServer.close();
    cleanup();
  }

  // 沙箱环境里 GPU 进程崩溃属正常噪声，不计入失败
  const noise = /GPU process exited|persistent_cache_sandboxed_file_factory|DevTools listening|Fontconfig|gpu_process_host/;
  const realErrors = stderr
    .split('\n')
    .filter((l) => l.trim() && !noise.test(l))
    .join('\n');
  const fatal = /Uncaught|TypeError:|Cannot read properties|Error: ENOSPC/.test(realErrors);
  if (fatal) {
    log(`\n⚠ 检测到应用异常日志：\n${realErrors.slice(0, 2000)}`);
    failed += 1;
  }

  log(`\n${'='.repeat(48)}`);
  log(failed === 0 ? '端到端测试全部通过 ✅' : `端到端测试失败 ${failed} 项 ❌`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
