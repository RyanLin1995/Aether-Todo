'use strict';
/**
 * 视觉预览与元素审查
 *   node scripts/preview.js      生成截图（浅色/统计页/设置/深色统计）+ 元素样式审查
 * 产物：tests/screenshots/preview-*.png
 * 说明：启动前会向独立 user-data 目录写入种子数据（含跨月历史完成记录），
 *       让统计页有真实分布可看。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tests', 'screenshots');
const PORT = 9447;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TITLES = {
  工作: ['把周报发给老板', '整理项目需求文档', '回复客户邮件', '评审设计方案', '修复登录 Bug', '准备周会材料'],
  学习: ['背 50 个单词', '复习线性代数', '看完一章教材', '完成课程作业', '写读书笔记'],
  生活: ['买牛奶和面包', '取快递', '打扫房间', '给植物浇水', '整理衣柜', '预约理发'],
  健康: ['跑步 5 公里', '做肩颈拉伸', '预约体检', '早睡打卡', '健身房练背'],
  财务: ['整理本月账单', '报销差旅费', '缴纳水电费', '更新预算表'],
  社交: ['给妈妈打电话', '回复朋友消息', '准备生日礼物', '约朋友吃饭'],
};

/** 写入种子数据：12 个月的完成记录 + 若干待办 */
function seed(userData) {
  const dir = path.join(userData, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const iso = (d) => d.toISOString();
  const userId = 'u_preview';
  const cats = Object.keys(TITLES);
  const tasks = [];
  let n = 0;

  const push = (date, category, title, completed, extra = {}) => {
    tasks.push({
      id: 't_' + n++,
      userId,
      title,
      note: '',
      priority: extra.priority || 'medium',
      priorityReason: extra.priorityReason || '',
      category,
      dueAt: extra.dueAt || null,
      remindAt: extra.remindAt || null,
      completed,
      completedAt: completed ? iso(date) : null,
      reminded: false,
      source: extra.source || 'manual',
      createdAt: iso(new Date(date.getTime() - 3600 * 1000)),
      updatedAt: iso(date),
    });
  };

  // 过去 12 个月：每月 4~10 条完成记录，分散在不同日子
  for (let m = 11; m >= 0; m--) {
    const base = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const count = 4 + ((m * 5 + 3) % 7);
    for (let i = 0; i < count; i++) {
      const day = 1 + ((i * 3 + m * 2) % 27);
      const d = new Date(base.getFullYear(), base.getMonth(), day, 9 + (i % 10), (i * 17) % 60);
      if (d > now) continue;
      const cat = cats[(i + m) % cats.length];
      const list = TITLES[cat];
      push(d, cat, list[(i + m) % list.length], true, { priority: ['high', 'medium', 'low'][i % 3] });
    }
  }

  // 本周内补几条（让「本周」维度有内容）
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  for (let i = 0; i < dow; i++) {
    const d = new Date(weekStart.getTime() + i * 86400000);
    d.setHours(10 + (i % 6), 15, 0, 0);
    if (d > now) continue;
    const cat = cats[i % cats.length];
    push(d, cat, TITLES[cat][i % TITLES[cat].length], true, { priority: i === 0 ? 'high' : 'medium' });
  }

  // 待办（未完成）
  const at = (h, mi) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi, 0, 0));
  push(now, '工作', '把周报发给老板', false, {
    priority: 'high',
    priorityReason: '描述中包含「很急」且今天截止',
    dueAt: at(15, 0),
    remindAt: at(14, 50),
    source: 'ai',
  });
  push(now, '生活', '买牛奶和面包', false, { dueAt: at(19, 0), remindAt: at(18, 30) });
  push(now, '社交', '给妈妈打个电话', false, {
    priority: 'low',
    priorityReason: '描述中包含「有空」，时间上并不紧迫',
    source: 'ai',
  });
  push(now, '工作', '提交项目方案', false, { priority: 'high' });
  push(now, '健康', '预约下周体检', false, {});

  const db = {
    version: 1,
    users: [
      {
        id: userId,
        username: '本机用户',
        passwordHash: '',
        createdAt: iso(new Date(now.getTime() - 86400000 * 365)),
      },
    ],
    sessions: [],
    tasks,
    messages: [],
    settings: {},
  };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db, null, 2));
  return tasks.length;
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-preview-'));
  console.log(`种子数据已写入：${seed(userData)} 条任务`);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [
      '.',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userData}`,
      '--no-sandbox',
      '--disable-gpu',
      '--force-device-scale-factor=1',
      '--window-size=1280,820',
    ],
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
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, `preview-${name}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log(`截图: ${file}`);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2400);

  // 造一轮对话，让助手面板有内容
  await evalJs(`window.api.aiChat('明天下午三点前把周报发给老板，很急')`);
  await sleep(500);
  await evalJs(`location.reload()`);
  await sleep(2600);
  await shot('light-main');

  // 统计页：本周 → 今年
  await evalJs(`document.querySelector('#view-filter li[data-view=stats]').click()`);
  await sleep(1400);
  await shot('light-stats-week');
  await evalJs(
    `Array.from(document.querySelectorAll('.stats-tab')).find(b => /今年|This year/.test(b.textContent)).click()`
  );
  await sleep(1000);
  await shot('light-stats-year');

  // 设置弹窗
  await evalJs(`document.getElementById('btn-settings').click()`);
  await sleep(700);
  await shot('light-settings');
  await evalJs(`document.getElementById('btn-close-settings').click()`);
  await sleep(300);

  // 深色主题下的统计页
  await evalJs(`(async () => { localStorage.setItem('ai_todo_theme','dark'); location.reload(); })()`);
  await sleep(2600);
  await evalJs(`document.querySelector('#view-filter li[data-view=stats]').click()`);
  await sleep(1400);
  await shot('dark-stats');

  ws.close();
  kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('预览失败:', e.message);
  process.exit(1);
});
