'use strict';
/** 液态玻璃专项验证：①全局液态程度材质 ②灵动岛液态玻璃 ③应用内通知卡 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 9471;
const OUT_DIR = path.join(ROOT, 'tests', 'screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
}
// 从 rgba/oklab 色值里取 alpha
function alpha(color) {
  const m = /rgba?\([^)]*?,\s*([\d.]+)\)/.exec(color || '');
  if (m) return Number(m[1]);
  const o = /oklab\([^)]*\/\s*([\d.]+)\)/.exec(color || '');
  if (o) return Number(o[1]);
  return /oklab\([^)]*\)/.test(color || '') ? 1 : 0;
}
function blurPx(filter) {
  const m = /blur\(([\d.]+)px\)/.exec(filter || '');
  if (m) return Number(m[1]);
  // 直接读到已解析的 --liquid-blur（如 "16.6px"）
  const raw = /^([\d.]+)px$/.exec(String(filter || '').trim());
  return raw ? Number(raw[1]) : 0;
}
// 拆分 box-shadow 的各个图层（按顶层逗号切分）
function shadowLayers(shadow) {
  return String(shadow || '')
    .split(/,(?![^()]*\))/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const ready = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  return ready.then(() => ({
    send: (method, params = {}) =>
      new Promise((res) => {
        const i = ++id;
        pending.set(i, res);
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
  }));
}
async function evalJs(conn, expression) {
  const r = await conn.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result?.value;
}
async function shot(conn, name) {
  const r = await conn.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  console.log(`  📷 ${path.join(OUT_DIR, name)}`);
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-liquid-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--no-sandbox'],
    { cwd: ROOT, env, stdio: 'ignore' }
  );
  const kill = () => {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {}
  };

  let mainTarget = null;
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      mainTarget = l.find((t) => (t.url || '').includes('index.html'));
      if (mainTarget) break;
    } catch {}
    await sleep(400);
  }
  if (!mainTarget) throw new Error('主界面未就绪');
  const m = await connect(mainTarget);
  await m.send('Runtime.enable');
  await m.send('Page.enable');
  await sleep(2200);

  const setLevel = (slider) =>
    evalJs(
      m,
      `(() => {
        const el = document.getElementById('set-float-opacity');
        if (el) {
          el.value = ${slider};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return 1;
      })()`
    );
  const openSettings = () => evalJs(m, `document.getElementById('btn-settings').click(); 1`);
  const closeSettings = () => evalJs(m, `document.getElementById('btn-close-settings').click(); 1`);

  const readMaterial = () =>
    evalJs(
      m,
      `(() => {
        const cs = getComputedStyle(document.documentElement);
        const g = (sel, prop) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el)[prop] : null;
        };
        return {
          liquid: cs.getPropertyValue('--liquid').trim(),
          alpha: cs.getPropertyValue('--liquid-alpha').trim(),
          blur: cs.getPropertyValue('--liquid-blur').trim(),
          saturate: cs.getPropertyValue('--liquid-saturate').trim(),
          highlight: cs.getPropertyValue('--liquid-highlight').trim(),
          glass: cs.getPropertyValue('--glass-opacity').trim(),
          topbarBg: g('.topbar', 'backgroundColor'),
          topbarFilter: g('.topbar', 'backdropFilter') || g('.topbar', 'webkitBackdropFilter'),
          // 取标准玻璃按钮（ghost / primary / danger-text 为有意扁平化的变体，不适用材质断言）
          btnBg: g('.ui-btn:not(.ghost):not(.primary):not(.danger-text)', 'backgroundColor'),
          btnImage: (g('.ui-btn:not(.ghost):not(.primary):not(.danger-text)', 'backgroundImage') || '').slice(0, 60),
          btnFilter:
            g('.ui-btn:not(.ghost):not(.primary):not(.danger-text)', 'backdropFilter') ||
            g('.ui-btn:not(.ghost):not(.primary):not(.danger-text)', 'webkitBackdropFilter'),
          btnShadow: g('.ui-btn:not(.ghost):not(.primary):not(.danger-text)', 'boxShadow'),
        };
      })()`
    );

  // ================= ① 全局液态程度 =================
  console.log('\n[①] 整体液态程度：材质联动与低取值仍具玻璃质感');
  await openSettings();
  await sleep(600);

  await setLevel(0);
  await sleep(500);
  const low = await readMaterial();
  check('拉条 0 → --liquid = 0.3', Math.abs(Number(low.liquid) - 0.3) < 0.005, low.liquid);
  check('30% 时底色仍可见（alpha ≥ 0.22）', Number(low.alpha) >= 0.22, `--liquid-alpha=${low.alpha}`);
  check('30% 时仍有磨砂模糊（blur ≥ 10px）', blurPx(low.blur) >= 10, low.blur);
  check('30% 时界面玻璃底色不再接近全透明', Number(low.glass) >= 0.35, `--glass-opacity=${low.glass}`);
  check('30% 时顶栏保留模糊折射', blurPx(low.topbarFilter) >= 10, low.topbarFilter);
  check(
    '30% 时按钮有玻璃底与模糊',
    (alpha(low.btnBg) >= 0.15 || /gradient|oklab/.test(low.btnImage || '')) && blurPx(low.btnFilter) >= 10,
    `${low.btnBg} | ${low.btnImage} | ${low.btnFilter}`
  );
  check('30% 时按钮保留内高光', /inset/.test(low.btnShadow || ''), (low.btnShadow || '').slice(0, 48));
  await shot(m, 'liquid-1-main-30.png');

  await setLevel(100);
  await sleep(600);
  const high = await readMaterial();
  check('拉条 100 → --liquid = 1', Math.abs(Number(high.liquid) - 1) < 0.005, high.liquid);
  check('100% 模糊更强', blurPx(high.blur) > blurPx(low.blur), `${low.blur} → ${high.blur}`);
  check('100% 底色更厚', Number(high.alpha) > Number(low.alpha), `${low.alpha} → ${high.alpha}`);
  check('100% 折射饱和更高', parseFloat(high.saturate) > parseFloat(low.saturate), `${low.saturate} → ${high.saturate}`);
  check('100% 高光更亮', Number(high.highlight) > Number(low.highlight), `${low.highlight} → ${high.highlight}`);
  await shot(m, 'liquid-2-main-100.png');
  await closeSettings();
  await sleep(400);

  // ================= ② 灵动岛液态玻璃 =================
  console.log('\n[②] 灵动岛液态玻璃材质');
  await evalJs(
    m,
    `(async () => {
      const t = await window.api.createTask({ title: 'Q3 周报发给老板', category: '工作', priority: 'high' });
      await window.api.floatShow();
      await window.api.floatSetTask(t.data.id);
      return 1;
    })()`
  );
  await sleep(1800);
  let l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const f = await connect(l.find((t) => (t.url || '').includes('float.html')));
  await f.send('Runtime.enable');
  await f.send('Page.enable');
  await sleep(500);
  await evalJs(f, `document.getElementById('island-compact-view').click(); 1`);
  await sleep(700);

  const readIsland = () =>
    evalJs(
      f,
      `(() => {
        const cs = getComputedStyle(document.documentElement);
        const g = (sel, prop) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el)[prop] : null;
        };
        return {
          liquid: cs.getPropertyValue('--liquid').trim(),
          islandBg: g('.dynamic-island', 'backgroundColor'),
          islandImage: (g('.dynamic-island', 'backgroundImage') || '').slice(0, 60),
          islandFilter: g('.dynamic-island', 'backdropFilter') || g('.dynamic-island', 'webkitBackdropFilter'),
          islandShadow: g('.dynamic-island', 'boxShadow'),
          iconBg: g('.island-icon-btn', 'backgroundColor'),
          iconFilter: g('.island-icon-btn', 'backdropFilter') || g('.island-icon-btn', 'webkitBackdropFilter'),
          iconBorder: g('.island-icon-btn', 'borderTopColor'),
          pillBg: g('.island-pill-btn', 'backgroundColor'),
          pillImage: (g('.island-pill-btn', 'backgroundImage') || '').slice(0, 40),
          pillShadow: g('.island-pill-btn', 'boxShadow'),
          pillFilter: g('.island-pill-btn', 'backdropFilter') || g('.island-pill-btn', 'webkitBackdropFilter'),
          collapseBg: g('.island-btn-collapse', 'backgroundColor'),
          collapseBorder: g('.island-btn-collapse', 'borderTopColor'),
          nextBg: g('#island-next-task', 'backgroundColor'),
        };
      })()`
    );

  const island = await readIsland();
  check('灵动岛跟随液态程度', Math.abs(Number(island.liquid) - 1) < 0.02, island.liquid);
  check('岛背景有玻璃底色', alpha(island.islandBg) >= 0.5, island.islandBg);
  check('岛背景有镜面渐变高光', /gradient/.test(island.islandImage || ''), island.islandImage);
  check('岛背景有背景模糊与折射', blurPx(island.islandFilter) >= 10, island.islandFilter);
  const islandShadowLayers = shadowLayers(island.islandShadow);
  check(
    '岛背景保留内侧描边与高光（无外侧黑投影）',
    islandShadowLayers.some((s) => /inset/.test(s)) &&
      islandShadowLayers.every((s) => /inset/.test(s) || /rgba\(0, 0, 0, 0\)|transparent/.test(s)),
    (island.islandShadow || '').slice(0, 70)
  );
  check('岛内图标按钮有玻璃底', alpha(island.iconBg) > 0.03, island.iconBg);
  check('岛内图标按钮有模糊折射', blurPx(island.iconFilter) >= 3, island.iconFilter);
  check('岛内图标按钮有描边', alpha(island.iconBorder) > 0.03, island.iconBorder);
  check(
    '岛内药丸按钮有玻璃底与模糊',
    (alpha(island.pillBg) > 0.03 || /gradient/.test(island.pillImage || '')) && blurPx(island.pillFilter) >= 3,
    `${island.pillBg} | ${island.pillImage} | ${island.pillFilter}`
  );
  check('收起按钮仍与「下一个任务」区分', island.collapseBg !== island.nextBg && island.collapseBorder !== 'rgba(0, 0, 0, 0)', `${island.collapseBg} vs ${island.nextBg}`);
  await shot(f, 'liquid-3-island-100.png');

  // 岛在低液态程度下依然可见
  await openSettings();
  await sleep(400);
  await setLevel(0);
  await sleep(700);
  await closeSettings();
  await sleep(600);
  const islandLow = await readIsland();
  check(
    '低液态程度下岛背景仍可见（不是全透明）',
    Math.abs(Number(islandLow.liquid) - 0.3) < 0.02 && alpha(islandLow.islandBg) >= 0.4,
    `liquid=${islandLow.liquid} bg=${islandLow.islandBg}`
  );
  await shot(f, 'liquid-4-island-30.png');

  // ================= ③ 应用内通知卡 =================
  console.log('\n[③] 应用内液态玻璃通知卡');
  await evalJs(
    m,
    `(async () => {
      await window.api.updateSettings({ reminderEnabled: true });
      await window.api.createTask({
        title: '番茄钟结束提醒验证',
        category: '工作',
        priority: 'high',
        dueAt: new Date(Date.now() - 60000).toISOString(),
        remindAt: new Date(Date.now() - 60000).toISOString(),
      });
      await window.api.checkReminders();
      return 1;
    })()`
  );
  await sleep(1500);

  let notifyTarget = null;
  for (let i = 0; i < 20; i++) {
    l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    notifyTarget = l.find((t) => (t.url || '').includes('notify.html'));
    if (notifyTarget) break;
    await sleep(400);
  }
  check('通知使用应用内窗口（非系统原生通知）', Boolean(notifyTarget), notifyTarget ? notifyTarget.url : '未找到 notify.html');
  if (notifyTarget) {
    const n = await connect(notifyTarget);
    await n.send('Runtime.enable');
    await n.send('Page.enable');
    await sleep(700);
    const card = await evalJs(
      n,
      `(() => {
        const el = document.getElementById('notify-card');
        const cs = getComputedStyle(el);
        const iconCs = getComputedStyle(document.getElementById('notify-icon'));
        const progCs = getComputedStyle(document.getElementById('notify-progress'));
        return {
          hidden: el.classList.contains('is-hidden'),
          tone: el.dataset.tone,
          title: document.getElementById('notify-title').textContent,
          body: document.getElementById('notify-body').textContent.slice(0, 30),
          radius: cs.borderRadius,
          bg: cs.backgroundColor,
          filter: cs.backdropFilter || cs.webkitBackdropFilter,
          shadow: cs.boxShadow,
          border: cs.borderTopColor,
          font: cs.fontFamily,
          iconColor: iconCs.color,
          hasIcon: Boolean(document.querySelector('#notify-icon svg')),
          progressAnim: progCs.animationName,
          liquid: getComputedStyle(document.documentElement).getPropertyValue('--liquid').trim(),
        };
      })()`
    );
    check('通知卡已显示', card.hidden === false, JSON.stringify({ tone: card.tone, title: card.title }));
    check('通知卡标题/正文已填充', Boolean(card.title) && Boolean(card.body), `${card.title} | ${card.body}`);
    check('通知卡为液态玻璃（有玻璃底）', alpha(card.bg) >= 0.2 || /oklab/.test(card.bg), card.bg);
    check('通知卡有背景模糊与折射', blurPx(card.filter) >= 10, card.filter);
    check('通知卡圆角与软件一致（18px）', card.radius === '18px', card.radius);
    check('通知卡有厚度投影与内高光', /inset/.test(card.shadow || ''), (card.shadow || '').slice(0, 52));
    check('通知卡有细腻描边', alpha(card.border) > 0.02, card.border);
    check('通知卡复用应用字体', /system-ui|Segoe|YaHei|sans-serif/i.test(card.font || ''), (card.font || '').slice(0, 40));
    check('通知图标为 Lucide 矢量图标（非 Emoji）', card.hasIcon === true);
    check('通知卡跟随液态程度', Math.abs(Number(card.liquid) - 0.3) < 0.02, card.liquid);
    check('自动消失进度条动画在跑', card.progressAnim === 'notify-countdown', card.progressAnim);
    await shot(n, 'liquid-5-notification.png');

    // 关闭按钮
    await evalJs(n, `document.getElementById('notify-close').click(); 1`);
    await sleep(900);
    const afterClose = await evalJs(n, `document.getElementById('notify-card').classList.contains('is-hidden') || document.getElementById('notify-card').classList.contains('is-leaving')`);
    check('关闭按钮可关闭通知卡', afterClose === true);
  }

  console.log(`\n================================================\n通过 ${passed} 项，失败 ${failed} 项`);
  kill();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('执行异常：', e.message);
  process.exit(1);
});
