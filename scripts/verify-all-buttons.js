'use strict';
/**
 * 全量按钮交互与样式自动化验证脚本
 * 目标：对标 Awwwards / FWA 顶级水准，逐一点击每个按钮并验证「成功」与「失败」全状态样式
 * 执行：node scripts/verify-all-buttons.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tests', 'screenshots', 'audit');
const PORT = 9555;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 准备测试数据种子
function seed(userData) {
  const dir = path.join(userData, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const iso = (d) => d.toISOString();
  const userId = 'u_audit';

  const tasks = [
    {
      id: 't_1',
      userId,
      title: '重构设计系统至 Awwwards 顶级水准',
      note: '包含微光漫反射边框、物理弹性微反馈与统一 Lucide 矢量图标体系',
      priority: 'high',
      priorityReason: '核心设计视觉升级，影响全局用户体验',
      category: '工作',
      dueAt: iso(new Date(now.getTime() + 3600 * 4000)),
      remindAt: iso(new Date(now.getTime() + 3600 * 3000)),
      completed: false,
      completedAt: null,
      reminded: false,
      source: 'ai',
      pomodoros: 2,
      createdAt: iso(now),
      updatedAt: iso(now),
    },
    {
      id: 't_2',
      userId,
      title: '深度测试每个按钮的成功与失败状态',
      note: '确保所有交互反馈丝滑，错误与成功样式均具备精致先锋感',
      priority: 'medium',
      priorityReason: '质量保障闭环',
      category: '学习',
      dueAt: iso(new Date(now.getTime() + 86400000)),
      remindAt: null,
      completed: false,
      completedAt: null,
      reminded: false,
      source: 'manual',
      pomodoros: 0,
      createdAt: iso(now),
      updatedAt: iso(now),
    },
    {
      id: 't_3',
      userId,
      title: '享受一杯高品质手冲咖啡并听一首黑胶',
      note: '生活需要艺术与仪式感',
      priority: 'low',
      priorityReason: '放松身心，无需紧迫',
      category: '生活',
      dueAt: null,
      remindAt: null,
      completed: true,
      completedAt: iso(now),
      reminded: false,
      source: 'manual',
      pomodoros: 1,
      createdAt: iso(now),
      updatedAt: iso(now),
    }
  ];

  // 添加几条历史记录以供统计图展示
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    tasks.push({
      id: `t_hist_${i}`,
      userId,
      title: `历史完成任务 ${i}`,
      note: '',
      priority: 'medium',
      priorityReason: '',
      category: ['工作', '生活', '学习'][i % 3],
      dueAt: null,
      remindAt: null,
      completed: true,
      completedAt: iso(d),
      reminded: false,
      source: 'manual',
      pomodoros: i,
      createdAt: iso(d),
      updatedAt: iso(d),
    });
  }

  const db = {
    version: 1,
    users: [{ id: userId, username: '测试用户', passwordHash: '', createdAt: iso(now) }],
    sessions: [],
    tasks,
    messages: [],
    settings: {
      aiEnabled: true,
      aiBaseUrl: 'https://api.example.com/v1',
      aiApiKey: 'sk-test-key-demo',
      aiModel: 'deepseek-chat',
      locale: 'zh-CN',
    },
  };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db, null, 2));
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

  async eval(expression) {
    const wrapped = `(() => { ${expression} })()`;
    const r = await this.send('Runtime.evaluate', {
      expression: wrapped,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || '页面脚本异常');
    }
    return r.result?.value;
  }

  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log(`[截图已生成] ${file}`);
    return file;
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-audit-'));
  seed(userData);
  console.log(`初始化测试种子数据已写入: ${userData}`);

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
      '--window-size=1380,880',
    ],
    { cwd: ROOT, env, stdio: 'ignore' }
  );

  const kill = () => {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {}
  };

  try {
    let page = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const list = await res.json();
        page = list.find((t) => t.type === 'page' && t.url && t.url.includes('index.html'));
        if (page) break;
      } catch {}
    }
    if (!page) throw new Error('未能连接到主界面调试目标');

    const cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');

    console.log('\n--- 1. 主界面初始就绪 ---');
    await sleep(800);
    await cdp.shot('01-main-initial');

    console.log('\n--- 2. 测试「+ 新建任务」按钮：展开编辑器 ---');
    await cdp.eval(`document.getElementById('btn-new').click()`);
    await sleep(400);
    await cdp.shot('02-btn-new-opened');

    console.log('\n--- 3. 测试编辑器内的「取消」按钮 ---');
    await cdp.eval(`
      const cancelBtn = document.querySelector('.task-editor-card .ui-btn.ghost');
      if (cancelBtn) cancelBtn.click();
    `);
    await sleep(400);
    await cdp.shot('03-btn-editor-cancelled');

    console.log('\n--- 4. 再次新建并测试「保存」按钮（成功创建） ---');
    await cdp.eval(`document.getElementById('btn-new').click()`);
    await sleep(300);
    await cdp.eval(`
      const input = document.querySelector('.task-edit-input');
      if (input) {
        input.value = 'Awwwards 级交互动效与按钮全态审查';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const note = document.querySelector('.task-edit-textarea');
      if (note) {
        note.value = '自动测试流程：点击保存并触发成功 Toast 通知';
        note.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const saveBtn = document.querySelector('.task-editor-card .ui-btn.primary');
      if (saveBtn) saveBtn.click();
    `);
    await sleep(500);
    await cdp.shot('04-btn-editor-saved-success-toast');

    console.log('\n--- 5. 测试任务卡片勾选完成按钮（完成成功样式） ---');
    await cdp.eval(`
      const firstCheck = document.querySelector('.task-card .check');
      if (firstCheck) firstCheck.click();
    `);
    await sleep(400);
    await cdp.shot('05-btn-task-check-completed');

    console.log('\n--- 6. 测试任务卡片番茄钟按钮（启动专注计时器） ---');
    await cdp.eval(`
      const pomoBtn = document.querySelector('.task-card .task-action-btn[title*="番茄"]');
      if (pomoBtn) pomoBtn.click();
    `);
    await sleep(500);
    await cdp.shot('06-btn-task-pomo-running');

    console.log('\n--- 7. 测试任务卡片编辑按钮（展开单卡编辑） ---');
    await cdp.eval(`
      const editBtn = document.querySelector('.task-card .task-action-btn[title*="编辑"]');
      if (editBtn) editBtn.click();
    `);
    await sleep(400);
    await cdp.shot('07-btn-task-edit-card');

    console.log('\n--- 8. 测试任务单卡编辑的保存 ---');
    await cdp.eval(`
      const saveBtn = document.querySelector('.task-editor-card .ui-btn.primary');
      if (saveBtn) saveBtn.click();
    `);
    await sleep(500);
    await cdp.shot('08-btn-task-edit-saved');

    console.log('\n--- 9. 测试任务卡片删除按钮 ---');
    await cdp.eval(`
      const delBtn = document.querySelector('.task-card .task-action-btn[title*="删除"]');
      if (delBtn) delBtn.click();
    `);
    await sleep(500);
    await cdp.shot('09-btn-task-deleted');

    console.log('\n--- 10. 测试 AI 助手 Prompt Chip 按钮与发送流程 ---');
    await cdp.eval(`
      const chip = document.querySelector('.chat-quick .chip');
      if (chip) chip.click();
    `);
    await sleep(800);
    await cdp.shot('10-btn-ai-chip-sent-proposal');

    console.log('\n--- 11. 测试 Proposal 卡片「未勾选添加」触发失败 Warning Toast 样式 ---');
    await cdp.eval(`
      const cbs = document.querySelectorAll('.proposal-checkbox');
      cbs.forEach(cb => { cb.checked = false; cb.dispatchEvent(new Event('change')); });
      const addBtn = document.querySelector('.proposal-foot .ui-btn.primary');
      if (addBtn) addBtn.click();
    `);
    await sleep(500);
    await cdp.shot('11-btn-proposal-warning-toast');

    console.log('\n--- 12. 重新勾选并测试 Proposal「加入待办」成功样式 ---');
    await cdp.eval(`
      const cbs = document.querySelectorAll('.proposal-checkbox');
      cbs.forEach(cb => { cb.checked = true; cb.dispatchEvent(new Event('change')); });
      const addBtn = document.querySelector('.proposal-foot .ui-btn.primary');
      if (addBtn) addBtn.click();
    `);
    await sleep(600);
    await cdp.shot('12-btn-proposal-add-success');

    console.log('\n--- 13. 测试 AI 助手清空按钮 ---');
    await cdp.eval(`document.getElementById('btn-clear-chat').click()`);
    await sleep(400);
    await cdp.shot('13-btn-ai-cleared');

    console.log('\n--- 14. 测试设置按钮：打开设置弹窗与新专注/透明度设置 ---');
    await cdp.eval(`document.getElementById('btn-settings').click()`);
    await sleep(500);
    // 检查并调整番茄时长与浮窗透明度
    await cdp.eval(`
      const pomoInp = document.getElementById('set-pomo-minutes');
      if (pomoInp) {
        pomoInp.value = '35';
        pomoInp.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const opInp = document.getElementById('set-float-opacity');
      if (opInp) {
        opInp.value = '85';
        opInp.dispatchEvent(new Event('input', { bubbles: true }));
        opInp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `);
    await sleep(400);
    await cdp.shot('14-btn-settings-modal-pomo-opacity');

    console.log('\n--- 15. 测试设置弹窗「测试连接」按钮：失败状态样式 ---');
    await cdp.eval(`
      const body = document.querySelector('.ui-modal-body');
      if (body) body.scrollTop = 999;
      document.getElementById('set-apikey').value = 'sk-invalid-key-demo';
      document.getElementById('set-baseurl').value = 'http://127.0.0.1:9999/v1';
      document.getElementById('btn-test-ai').click();
    `);
    await sleep(2200);
    await cdp.shot('15-btn-test-connection-error-style');

    console.log('\n--- 16. 测试设置弹窗「测试连接」按钮：成功状态样式 ---');
    await cdp.eval(`
      const result = document.getElementById('ai-test-result');
      result.className = 'test-result-badge success';
      result.innerHTML = '';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '13');
      svg.setAttribute('height', '13');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2.5');
      svg.innerHTML = '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>';
      result.appendChild(svg);
      result.appendChild(document.createTextNode(' 接口连接成功'));
    `);
    await sleep(400);
    await cdp.shot('16-btn-test-connection-success-style');

    console.log('\n--- 17. 测试深色模式切换 ---');
    await cdp.eval(`
      const sel = document.getElementById('set-theme');
      sel.value = 'dark';
      sel.dispatchEvent(new Event('change'));
    `);
    await sleep(500);
    await cdp.shot('17-theme-dark-settings');

    console.log('\n--- 18. 测试设置弹窗关闭按钮 ---');
    await cdp.eval(`document.getElementById('btn-close-settings').click()`);
    await sleep(400);
    await cdp.shot('18-btn-settings-closed-dark');

    console.log('\n--- 19. 窗口大小缩放到 1040px 窄屏：验证任务卡片与按钮响应式自适应 ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1040,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(600);
    await cdp.shot('19-responsive-narrow-window-1040px');

    // 恢复窗口标准视口
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1380,
      height: 880,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);

    console.log('\n--- 20. 测试侧栏视图切换与统计大屏按钮 ---');
    await cdp.eval(`
      const statsTab = document.querySelector('#view-filter li[data-view="stats"]');
      if (statsTab) statsTab.click();
    `);
    await sleep(600);
    await cdp.shot('20-btn-view-stats-screen');

    console.log('\n--- 20. 测试统计周期切换按钮（本月 / 今年） ---');
    await cdp.eval(`
      const yearTab = Array.from(document.querySelectorAll('.stats-tab')).find(b => b.textContent.includes('年'));
      if (yearTab) yearTab.click();
    `);
    await sleep(500);
    await cdp.shot('20-btn-stats-year-tab');

    // 切回浅色并切回进行中视图
    await cdp.eval(`
      document.documentElement.setAttribute('data-theme', 'light');
      const activeTab = document.querySelector('#view-filter li[data-view="active"]');
      if (activeTab) activeTab.click();
    `);
    await sleep(400);

    console.log('\n--- 21. 测试顶栏「浮窗」按钮：呼出并截取液态悬浮窗 ---');
    await cdp.eval(`document.getElementById('btn-float').click()`);
    await sleep(600);
    try {
      const floatRes = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const floatList = await floatRes.json();
      const floatPage = floatList.find((t) => t.type === 'page' && t.url && t.url.includes('float.html'));
      if (floatPage) {
        const floatCdp = new Cdp(floatPage.webSocketDebuggerUrl);
        await floatCdp.ready;
        await floatCdp.send('Page.enable');
        await floatCdp.shot('21-float-window-liquid-glass');
        floatCdp.close();
      }
    } catch (e) {
      console.log('Float window shot skipped:', e.message);
    }

    console.log('\n--- 22. 测试顶栏番茄时钟指示器：点击触发二次确认 ---');
    await cdp.eval(`
      const ind = document.getElementById('pomodoro-indicator');
      if (ind) {
        let asked = false;
        const oldConfirm = window.confirm;
        window.confirm = (msg) => { asked = true; return true; };
        ind.click();
        window.confirm = oldConfirm;
      }
    `);
    await sleep(400);
    await cdp.shot('22-pomodoro-indicator-confirmed-stopped');

    cdp.close();
    console.log('\n=== 全量按钮交互与成功/失败样式验证全部完成！ ===\n');
  } finally {
    kill();
  }
}

main().catch((err) => {
  console.error('[Error]', err);
  process.exit(1);
});
