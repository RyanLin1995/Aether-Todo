/**
 * 冒烟测试：不依赖 Electron，直接测试主进程的纯逻辑模块
 * 运行：bun tests/run.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword, verifyPassword } from '../src/main/crypto';
import { createStore } from '../src/main/store';
import * as ai from '../src/main/ai';
import { createReminderService } from '../src/main/reminder';
import { createPomodoroService } from '../src/main/pomodoro';
import { buildSystemPrompt } from '../src/main/prompt';

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aitodo-test-'));
}

// ============ 1. 密码哈希 ============
console.log('\n[1] 密码安全');
test('哈希后可正确校验', () => {
  const h = hashPassword('hello123');
  assert.ok(verifyPassword('hello123', h));
  assert.ok(!verifyPassword('wrong', h));
});
test('相同密码生成不同哈希（随机盐）', () => {
  assert.notStrictEqual(hashPassword('same-pwd'), hashPassword('same-pwd'));
});
test('非法哈希串不会崩溃', () => {
  assert.strictEqual(verifyPassword('x', 'garbage'), false);
});

// ============ 2. 数据存储 ============
console.log('\n[2] 数据存储与本地用户（免登录）');
const dir = tmpDir();
const store = createStore(dir);

test('注册用户后可查询到', () => {
  const u = store.createUser({ username: 'alice', passwordHash: hashPassword('secret1') });
  assert.ok(u.id);
  assert.ok(store.findUserByName('alice'));
  assert.strictEqual(store.findUserByName('ALICE').id, u.id, '用户名应大小写不敏感');
});
test('新用户自带默认设置', () => {
  const u = store.findUserByName('alice');
  const s = store.getSettings(u.id);
  assert.strictEqual(s.aiEnabled, true);
  assert.ok('aiApiKey' in s);
});
test('ensureLocalUser 自动创建本机用户且幂等', () => {
  const s = createStore(tmpDir());
  const u = s.ensureLocalUser();
  assert.ok(u.id);
  assert.strictEqual(s.ensureLocalUser().id, u.id, '重复调用应返回同一用户');
  assert.ok('aiApiKey' in s.getSettings(u.id), '本地用户应带默认设置');
});
test('已有用户数据时复用首个用户（兼容旧版本数据）', () => {
  const s = createStore(tmpDir());
  const old = s.createUser({ username: '老用户', passwordHash: 'x' });
  assert.strictEqual(s.ensureLocalUser().id, old.id);
});

const uid = store.ensureLocalUser().id;

test('创建任务并可按状态筛选', () => {
  store.createTask(uid, { title: '写周报', category: '工作', priority: 'high', dueAt: '2026-10-01T10:00:00' });
  store.createTask(uid, { title: '跑步', category: '健康', priority: 'low' });
  const active = store.listTasks(uid, { status: 'active' });
  assert.strictEqual(active.length, 2);
  store.updateTask(uid, active[0].id, { completed: true });
  assert.strictEqual(store.listTasks(uid, { status: 'active' }).length, 1);
  assert.strictEqual(store.listTasks(uid, { status: 'done' }).length, 1);
});
test('按类别与优先级筛选', () => {
  assert.strictEqual(store.listTasks(uid, { status: 'all', category: '健康' }).length, 1);
  assert.strictEqual(store.listTasks(uid, { status: 'all', priority: 'high' }).length, 1);
});
test('关键字搜索命中标题', () => {
  assert.strictEqual(store.listTasks(uid, { status: 'all', keyword: '周报' }).length, 1);
  assert.strictEqual(store.listTasks(uid, { status: 'all', keyword: '不存在的词' }).length, 0);
});
test('非法类别回退为「其他」，非法优先级回退为「中」', () => {
  const t = store.createTask(uid, { title: 'x', category: '火星', priority: 'urgent' });
  assert.strictEqual(t.category, '其他');
  assert.strictEqual(t.priority, 'medium');
  store.deleteTask(uid, t.id);
});
test('删除任务生效', () => {
  const t = store.createTask(uid, { title: '待删除' });
  assert.strictEqual(store.deleteTask(uid, t.id), true);
  assert.strictEqual(store.deleteTask(uid, t.id), false);
});
test('统计数字正确', () => {
  const s = store.stats(uid);
  assert.strictEqual(s.total, s.active + s.done);
});
test('数据落盘后可重新加载', () => {
  const again = createStore(dir);
  assert.ok(again.findUserByName('alice'), '重新打开数据文件后用户仍存在');
  assert.ok(again.listTasks(uid, { status: 'all' }).length >= 2);
});
test('设置可持久化', () => {
  store.updateSettings(uid, { aiApiKey: 'sk-test', aiModel: 'gpt-4o-mini' });
  const again = createStore(dir);
  assert.strictEqual(again.getSettings(uid).aiApiKey, 'sk-test');
});
test('对话历史有上限（不超过 200 条）', () => {
  for (let i = 0; i < 210; i += 1) store.addMessage(uid, 'user', `msg-${i}`);
  const again = createStore(dir);
  assert.ok(again.getHistory(uid, 500).length <= 200);
  again.clearHistory(uid);
  assert.strictEqual(createStore(dir).getHistory(uid, 10).length, 0);
});

// ============ 3. 中文时间解析 ============
console.log('\n[3] 自然语言时间解析');
const NOW = new Date(2026, 8, 29, 10, 0, 0); // 2026-09-29 10:00 本地时间
const p = (s) => ai.parseDateTime(s, NOW);

const dayDiff = (iso) => {
  const d = new Date(iso);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
  return Math.round((a - b) / 86400000);
};

test('明天下午三点', () => {
  const d = new Date(p('明天下午三点开会').dueAt);
  assert.strictEqual(dayDiff(d), 1);
  assert.strictEqual(d.getHours(), 15);
  assert.strictEqual(d.getMinutes(), 0);
});
test('今晚八点半', () => {
  const d = new Date(p('今晚八点半去健身房').dueAt);
  assert.strictEqual(d.getDate(), NOW.getDate());
  assert.strictEqual(d.getHours(), 20);
  assert.strictEqual(d.getMinutes(), 30);
});
test('后天', () => {
  assert.strictEqual(dayDiff(p('后天交房租').dueAt), 2);
});
test('下周三 → 落在未来且为周三', () => {
  const d = new Date(p('下周三之前提交项目方案').dueAt);
  assert.strictEqual(d.getDay(), 3, '应为星期三');
  assert.ok(d.getTime() > NOW.getTime(), '应在未来');
  assert.ok(d.getTime() - NOW.getTime() <= 14 * 86400000, '应在两周内');
});
test('10月5日早上9点', () => {
  const d = new Date(p('10月5日早上9点开会').dueAt);
  assert.strictEqual(d.getMonth(), 9);
  assert.strictEqual(d.getDate(), 5);
  assert.strictEqual(d.getHours(), 9);
});
test('3小时后', () => {
  const d = new Date(p('3小时后提交日报').dueAt);
  assert.strictEqual(d.getHours(), 13);
});
test('30分钟后', () => {
  const d = new Date(p('30分钟后提醒我吃药').dueAt);
  assert.strictEqual(d.getTime() - NOW.getTime(), 30 * 60000);
});
test('无时间表达时返回 null', () => {
  assert.strictEqual(p('整理一下书架').dueAt, null);
});
test('只有日期没有时间 → 默认 18:00', () => {
  const d = new Date(p('12月20日交论文').dueAt);
  assert.strictEqual(d.getHours(), 18);
});

// ============ 4. 优先级与类别 ============
console.log('\n[4] AI 自动判优先级 / 分类');
test('紧急 + 工作 → 高优先级', () => {
  const r = ai.parseLocally('明天下午三点前把周报发给老板，很急', { now: NOW });
  assert.strictEqual(r.intent, 'create');
  assert.strictEqual(r.tasks[0].priority, 'high', `实际：${r.tasks[0].priority}`);
  assert.strictEqual(r.tasks[0].category, '工作');
  assert.ok(r.tasks[0].priorityReason.length > 0, '应给出判定理由');
  assert.ok(r.tasks[0].dueAt, '应解析出时间');
});
test('不急 + 生活 → 低优先级', () => {
  const r = ai.parseLocally('有空的时候把书架整理一下', { now: NOW });
  assert.strictEqual(r.tasks[0].priority, 'low');
  assert.strictEqual(r.tasks[0].category, '生活');
});
test('社交类别识别', () => {
  const r = ai.parseLocally('周末给妈妈打个电话', { now: NOW });
  assert.strictEqual(r.tasks[0].category, '社交');
});
test('财务类别识别', () => {
  const r = ai.parseLocally('记得交房租', { now: NOW });
  assert.strictEqual(r.tasks[0].category, '财务');
});
test('健康类别识别', () => {
  const r = ai.parseLocally('明天去体检', { now: NOW });
  assert.strictEqual(r.tasks[0].category, '健康');
});
test('学习类别识别', () => {
  const r = ai.parseLocally('下周考试要复习', { now: NOW });
  assert.strictEqual(r.tasks[0].category, '学习');
});
test('一句话拆成多条任务', () => {
  const r = ai.parseLocally('明天买菜，然后给客户发邮件', { now: NOW });
  assert.strictEqual(r.tasks.length, 2, `实际拆出 ${r.tasks.length} 条：${r.tasks.map((t) => t.title).join(' | ')}`);
  assert.strictEqual(r.tasks[0].category, '生活');
  assert.strictEqual(r.tasks[1].category, '工作');
});
test('临近 24 小时内到期自动升为高优先级', () => {
  const soon = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const pr = ai.detectPriority('提交一份材料', soon);
  assert.strictEqual(pr.priority, 'high');
});
test('识别「完成」意图并匹配已有任务', () => {
  const tasks = [{ id: 't1', title: '写周报', completed: false }];
  const r = ai.parseLocally('周报我已经写完了', { now: NOW, tasks });
  assert.strictEqual(r.intent, 'complete');
  assert.deepStrictEqual(r.matchTitles, ['t1']);
});
test('纯闲聊返回 chat 意图并给出引导', () => {
  const r = ai.parseLocally('你好呀', { now: NOW });
  assert.strictEqual(r.intent, 'chat');
  assert.ok(r.reply.length > 0);
});
test('提前提醒偏移生效', () => {
  const r = ai.parseLocally('明天下午三点开会，提前30分钟提醒我', { now: NOW });
  const due = new Date(r.tasks[0].dueAt).getTime();
  const remind = new Date(r.tasks[0].remindAt).getTime();
  assert.strictEqual((due - remind) / 60000, 30);
});

// ============ 5. JSON 提取 ============
console.log('\n[5] 模型输出解析');
test('可解析 Markdown 代码块中的 JSON', () => {
  const obj = ai.extractJson('好的：\n```json\n{"reply":"ok","intent":"create","tasks":[]}\n```');
  assert.strictEqual(obj.reply, 'ok');
});
test('可解析前后带废话的 JSON', () => {
  const obj = ai.extractJson('这是结果 {"reply":"hi","intent":"chat"} 希望有帮助');
  assert.strictEqual(obj.reply, 'hi');
});
test('非 JSON 返回 null 而不抛错', () => {
  assert.strictEqual(ai.extractJson('我没法按格式输出'), null);
});

// ============ 6. 提醒调度 ============
console.log('\n[6] 提醒调度');
test('到期任务触发通知且只触发一次', async () => {
  const d2 = tmpDir();
  const s2 = createStore(d2);
  const u2 = s2.createUser({ username: 'bob', passwordHash: hashPassword('secret2') });
  s2.createTask(u2.id, {
    title: '到点提醒我',
    dueAt: new Date(Date.now() + 60000).toISOString(),
    remindAt: new Date(Date.now() - 60000).toISOString(), // 已到点
    priority: 'high',
  });
  const notified = [];
  const svc = createReminderService({
    store: s2,
    getActiveUserId: () => u2.id,
    notify: (n) => notified.push(n),
  });
  await testAsync('  · 第一次检查触发通知', async () => {
    const due = svc.check();
    assert.strictEqual(due.length, 1);
    assert.strictEqual(notified.length, 1);
    assert.ok(notified[0].body.includes('到点提醒我'));
  });
  await testAsync('  · 第二次检查不重复提醒', async () => {
    const due = svc.check();
    assert.strictEqual(due.length, 0);
    assert.strictEqual(notified.length, 1);
  });
  await testAsync('  · 未登录用户不触发提醒', async () => {
    const s3 = createStore(tmpDir());
    const u3 = s3.createUser({ username: 'c', passwordHash: hashPassword('secret3') });
    s3.createTask(u3.id, { title: 'x', remindAt: new Date(Date.now() - 1000).toISOString() });
    const hits = [];
    const svc3 = createReminderService({ store: s3, getActiveUserId: () => null, notify: (n) => hits.push(n) });
    svc3.check();
    assert.strictEqual(hits.length, 0);
  });
  svc.stop();
});

// ============ 7. 提示词 ============
console.log('\n[7] 提示词');
test('系统提示词包含关键约束', () => {
  const prompt = buildSystemPrompt(NOW);
  for (const key of ['priority', 'category', 'intent', 'JSON', '2026']) {
    assert.ok(prompt.includes(key), `提示词缺少 ${key}`);
  }
  for (const c of ai.CATEGORIES) assert.ok(prompt.includes(c), `提示词缺少类别 ${c}`);
});

// ============ 8. 国际化 i18n ============
console.log('\n[8] 国际化（i18n）');
import * as mainI18n from '../src/main/i18n';

test('中英文 key 完全一致（无漏译）', () => {
  const zh = Object.keys(mainI18n.MESSAGES['zh-CN']).sort();
  const en = Object.keys(mainI18n.MESSAGES['en-US']).sort();
  assert.deepStrictEqual(zh, en, `差异：${zh.filter((k) => !en.includes(k)).concat(en.filter((k) => !zh.includes(k)))}`);
});
test('插值参数生效', () => {
  assert.ok(mainI18n.t('en-US', 'local.reply.listHeader', { count: 3 }).includes('3'));
  assert.ok(mainI18n.t('zh-CN', 'local.reply.listHeader', { count: 3 }).includes('3'));
});
test('未知语言回退，宽松匹配可用', () => {
  assert.strictEqual(mainI18n.normalizeLocale('fr-FR'), 'zh-CN');
  assert.strictEqual(mainI18n.normalizeLocale('en-GB'), 'en-US');
  assert.strictEqual(mainI18n.normalizeLocale('zh-TW'), 'zh-CN');
  assert.strictEqual(mainI18n.normalizeLocale(undefined), 'zh-CN');
});
test('英文提示词要求英文输出且保留中文类别 key', () => {
  const prompt = buildSystemPrompt(NOW, 'en-US');
  assert.ok(prompt.includes('Reply language'), '应说明回复语言');
  assert.ok(prompt.includes('工作'), '类别 key 必须是内部中文标识');
  assert.ok(!prompt.includes('你是「AI 待办」'), '不应再用中文角色描述');
});
test('中文提示词要求中文输出', () => {
  const prompt = buildSystemPrompt(NOW, 'zh-CN');
  assert.ok(prompt.includes('回复语言'));
  assert.ok(prompt.includes('AI Todo App（AI 待办）'));
});
test('英文输入 + 英文界面 → 本地引擎输出全英文', () => {
  const r = ai.parseLocally('Send the weekly report to my boss tomorrow at 3pm, urgent', {
    now: NOW,
    locale: 'en-US',
  });
  assert.strictEqual(r.intent, 'create');
  assert.strictEqual(r.tasks[0].priority, 'high', r.tasks[0].priorityReason);
  assert.ok(r.tasks[0].dueAt, '应解析出时间');
  assert.ok(!/[一-龥]/.test(r.reply), `回复应为英文：${r.reply}`);
  assert.ok(!/[一-龥]/.test(r.tasks[0].priorityReason), `理由应为英文：${r.tasks[0].priorityReason}`);
});
test('中文界面下英文输入也能解析（不崩）', () => {
  const r = ai.parseLocally('Buy milk tomorrow morning', { now: NOW });
  assert.strictEqual(r.intent, 'create');
  assert.strictEqual(r.tasks[0].category, '生活');
});
test('英文时间解析：tomorrow at 3pm / in 2 hours', () => {
  const d = new Date(ai.parseDateTime('tomorrow at 3pm', NOW).dueAt);
  assert.strictEqual(dayDiff(d), 1);
  assert.strictEqual(d.getHours(), 15);
  const d2 = new Date(ai.parseDateTime('in 2 hours', NOW).dueAt);
  assert.strictEqual(d2.getHours(), 12);
});
test('模型返回的英文类别归一为中文 key', () => {
  const list = ai.normalizeAiTasks([{ title: 'Pay rent', category: 'Finance' }], NOW, 'en-US');
  assert.strictEqual(list[0].category, '财务');
});
test('英文「完成」意图可识别', () => {
  const tasks = [{ id: 't9', title: 'Send the weekly report', completed: false }];
  const r = ai.parseLocally('I already finished the weekly report', { now: NOW, tasks, locale: 'en-US' });
  assert.strictEqual(r.intent, 'complete');
});

// ============ 8b. AI 重复任务识别 ============
console.log('\n[8b] AI 自然语言识别重复任务');
test('normalizeAiTasks：模型返回合法 repeat 规则', () => {
  const list = ai.normalizeAiTasks(
    [{ title: '喝水', repeat: { freq: 'day', interval: 1, weekdays: [], startDate: '2026-01-01', endMode: 'never', endDate: null, endCount: null } }],
    NOW,
    'zh-CN'
  );
  assert.ok(list[0].repeat, '应识别为重复任务');
  assert.strictEqual(list[0].repeat.freq, 'day');
  assert.strictEqual(list[0].repeat.interval, 1);
});
test('normalizeAiTasks：模型返回非法 freq 视为不重复', () => {
  const list = ai.normalizeAiTasks([{ title: 'X', repeat: { freq: 'hourly', interval: 1 } }], NOW, 'zh-CN');
  assert.strictEqual(list[0].repeat, null);
});
test('normalizeAiTasks：缺失 repeat 字段为一次性任务', () => {
  const list = ai.normalizeAiTasks([{ title: 'Y', dueAt: '2026-01-01T09:00:00+08:00' }], NOW, 'zh-CN');
  assert.strictEqual(list[0].repeat, null);
});
test('parseLocally：中文「每天」→ day', () => {
  const r = ai.parseLocally('每天提醒我喝水', { now: NOW });
  assert.strictEqual(r.intent, 'create');
  assert.strictEqual(r.tasks[0].repeat.freq, 'day');
});
test('parseLocally：中文「每周一三五」→ week + 周几 [1,3,5]', () => {
  const r = ai.parseLocally('每周一三五去健身', { now: NOW });
  assert.strictEqual(r.tasks[0].repeat.freq, 'week');
  assert.deepStrictEqual(r.tasks[0].repeat.weekdays, [1, 3, 5]);
});
test('parseLocally：中文「每3天」→ day interval=3', () => {
  const r = ai.parseLocally('每3天给绿植浇水', { now: NOW });
  assert.strictEqual(r.tasks[0].repeat.freq, 'day');
  assert.strictEqual(r.tasks[0].repeat.interval, 3);
});
test('parseLocally：普通一次性任务 repeat 为 null', () => {
  const r = ai.parseLocally('明天去体检', { now: NOW });
  assert.strictEqual(r.tasks[0].repeat, null);
});


// ============ 9. 空响应与内容提取 ============
console.log('\n[9] 空响应处理（模型偶发空内容）');
test('extractContent：标准 content', () => {
  assert.strictEqual(ai.extractContent({ choices: [{ message: { content: '你好' } }] }), '你好');
});
test('extractContent：多模态分片数组', () => {
  const data = { choices: [{ message: { content: [{ type: 'text', text: '前' }, { type: 'text', text: '后' }] } }] };
  assert.strictEqual(ai.extractContent(data), '前后');
});
test('extractContent：content 为空时回退 reasoning_content', () => {
  const data = { choices: [{ message: { content: '', reasoning_content: '{"intent":"chat"}' } }] };
  assert.strictEqual(ai.extractContent(data), '{"intent":"chat"}');
});
test('extractContent：只返回 tool_calls 时取参数', () => {
  const data = {
    choices: [{ message: { content: null, tool_calls: [{ function: { arguments: '{"reply":"ok"}' } }] } }],
  };
  assert.strictEqual(ai.extractContent(data), '{"reply":"ok"}');
});
test('extractContent：兼容旧 completion 风格 choices[0].text', () => {
  assert.strictEqual(ai.extractContent({ choices: [{ text: 'legacy' }] }), 'legacy');
});
test('extractContent：完全空响应返回空串', () => {
  assert.strictEqual(ai.extractContent({ choices: [{ message: { content: '' } }] }), '');
  assert.strictEqual(ai.extractContent({}), '');
});

const realFetch = globalThis.fetch;
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

await testAsync('SSE 流式：累积全文并逐片回调', async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"{\\"reply\\":\\"你"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"好"}}]}\n',
    'data: {"choices":[{"delta":{"content":"\\",\\"intent\\":\\"chat\\"}"}}]}\n\ndata: [DONE]\n\n',
  ];
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const s of chunks) c.enqueue(new TextEncoder().encode(s));
          c.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    )) as typeof fetch;
  try {
    const pushes: string[] = [];
    const text = await ai.callLLM({
      messages: [{ role: 'user', content: 'hi' }],
      settings: { aiBaseUrl: 'http://127.0.0.1:1/v1', aiApiKey: 'sk-test', aiModel: 'm' },
      stream: true,
      onChunk: (full) => pushes.push(full),
    });
    assert.strictEqual(text, '{"reply":"你好","intent":"chat"}');
    assert.ok(pushes.length >= 3, `应至少有 3 次增量回调，实际 ${pushes.length}`);
    assert.strictEqual(pushes[pushes.length - 1], text);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('extractStreamReply：从完整/半截 JSON 中提取 reply', () => {
  assert.strictEqual(ai.extractStreamReply('{"reply":"你好呀","intent":"chat"}'), '你好呀');
  assert.strictEqual(ai.extractStreamReply('{"reply":"你好\\n世界'), '你好\n世界');
  assert.strictEqual(ai.extractStreamReply('{"reply":"未闭合的文本'), '未闭合的文本');
  assert.strictEqual(ai.extractStreamReply('{"intent":"chat"}'), '');
  assert.strictEqual(ai.extractStreamReply(''), '');
});

await testAsync('空响应会自动重试一次', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse({ choices: [{ message: { content: '' } }] })
      : jsonResponse({ choices: [{ message: { content: '第二次有内容了' } }] });
  }) as typeof fetch;
  try {
    const text = await ai.callLLM({
      messages: [{ role: 'user', content: 'hi' }],
      settings: { aiBaseUrl: 'http://127.0.0.1:1/v1', aiApiKey: 'sk-test', aiModel: 'm' },
    });
    assert.strictEqual(text, '第二次有内容了');
    assert.strictEqual(calls, 2, '应重试一次');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await testAsync('始终空响应 → 降级本地解析且提示温和', async () => {
  globalThis.fetch = (async () => jsonResponse({ choices: [{ message: { content: '' } }] })) as typeof fetch;
  try {
    const r = await ai.understand({
      text: '明天下午三点前把周报发给老板，很急',
      settings: {
        locale: 'zh-CN',
        proxyMode: 'none',
        proxyUrl: '',
        pomodoroMinutes: 25,
        floatOpacity: 0.92,
        floatX: null,
        floatY: null,
        aiBaseUrl: 'http://127.0.0.1:1/v1',
        aiApiKey: 'sk-test',
        aiModel: 'm',
        aiEnabled: true,
        reminderEnabled: true,
        reminderLeadMinutes: 0,
      },
      now: NOW,
      tasks: [],
    });
    assert.strictEqual(r.engine, 'local');
    assert.ok(r.error && r.error.includes('没返回内容'), `提示应温和，实际：${r.error}`);
    assert.ok(!r.error.includes('失败'), `不应出现“失败”字样，实际：${r.error}`);
    assert.strictEqual(r.intent, 'create');
    assert.ok(r.tasks.length >= 1, '本地引擎仍应解析出任务');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await testAsync('HTTP 错误仍按调用失败提示', async () => {
  globalThis.fetch = (async () =>
    new Response('bad key', { status: 401 })) as typeof fetch;
  try {
    const r = await ai.understand({
      text: '明天买菜',
      settings: {
        locale: 'zh-CN',
        proxyMode: 'none',
        proxyUrl: '',
        pomodoroMinutes: 25,
        floatOpacity: 0.92,
        floatX: null,
        floatY: null,
        aiBaseUrl: 'http://127.0.0.1:1/v1',
        aiApiKey: 'sk-test',
        aiModel: 'm',
        aiEnabled: true,
        reminderEnabled: true,
        reminderLeadMinutes: 0,
      },
      now: NOW,
      tasks: [],
    });
    assert.strictEqual(r.engine, 'local');
    assert.ok(r.error && r.error.includes('失败'), `真实错误应提示失败，实际：${r.error}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ============ 10. 任务拖拽重排与番茄钟暂停/继续 ============
console.log('\n[10] 任务拖拽重排与番茄钟暂停/恢复');
{
  const s = createStore(tmpDir());
  const u = s.ensureLocalUser();
  const t1 = s.createTask(u.id, { title: 'Task 1', priority: 'low' });
  const t2 = s.createTask(u.id, { title: 'Task 2', priority: 'high' });
  const t3 = s.createTask(u.id, { title: 'Task 3', priority: 'medium' });

  test('reorderTasks 可持久化自定义任务排序', () => {
    // 逆序重排：t1, t3, t2
    const ok = s.reorderTasks(u.id, [t1.id, t3.id, t2.id]);
    assert.strictEqual(ok, true);
    const list = s.listTasks(u.id);
    assert.strictEqual(list[0].id, t1.id);
    assert.strictEqual(list[1].id, t3.id);
    assert.strictEqual(list[2].id, t2.id);
  });

  test('番茄钟支持暂停与继续，正确记录剩余时长', () => {
    const pomo = createPomodoroService({
      store: s,
      getActiveUserId: () => u.id,
      notify: () => {},
      broadcast: () => {},
    });
    const status = pomo.start(t1.id, 25);
    assert.strictEqual(status.isPaused, false);
    assert.ok(status.remainingMs > 0);

    const paused = pomo.pause();
    assert.ok(paused);
    assert.strictEqual(paused.isPaused, true);
    const pausedMs = paused.remainingMs;

    const resumed = pomo.resume();
    assert.ok(resumed);
    assert.strictEqual(resumed.isPaused, false);
    assert.ok(Math.abs(resumed.remainingMs - pausedMs) < 100);

    pomo.stop();
    assert.strictEqual(pomo.status(), null);
  });

  test('整体液态透明度 liquidOpacity 支持读写持久化', () => {
    const updated = s.updateSettings(u.id, { liquidOpacity: 0.75, floatOpacity: 0.75 });
    assert.strictEqual(updated.liquidOpacity, 0.75);
    assert.strictEqual(updated.floatOpacity, 0.75);
    const loaded = s.getSettings(u.id);
    assert.strictEqual(loaded.liquidOpacity, 0.75);
  });
}

// ============ 11. 重复任务 ============
console.log('\n[11] 重复任务（日期计算与系列实例）');
import { nextOccurrence, normalizeRule, toDateKey, isCountExhausted } from '../src/shared/recurrence';
import type { RepeatRule } from '../src/shared/types';

const mkRule = (over: Partial<RepeatRule> = {}): RepeatRule =>
  normalizeRule({
    freq: 'day',
    interval: 1,
    weekdays: [],
    startDate: '2026-01-01',
    endMode: 'never',
    endDate: null,
    endCount: null,
    ...over,
  }) as RepeatRule;

/** 本地日历日（YYYY-MM-DD）→ Date，避免 UTC 解析错位 */
const localDay = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

const nextKey = (from: string, r: RepeatRule): string | null => {
  const n = nextOccurrence(localDay(from), r);
  return n ? toDateKey(n) : null;
};

test('按天重复：间隔 N 天', () => {
  assert.strictEqual(nextKey('2026-03-01', mkRule({ freq: 'day', interval: 2, startDate: '2026-03-01' })), '2026-03-03');
  assert.strictEqual(nextKey('2026-12-30', mkRule({ freq: 'day', interval: 1, startDate: '2026-12-01' })), '2026-12-31');
});

test('按天重复：跨月与跨年', () => {
  assert.strictEqual(nextKey('2026-02-28', mkRule({ freq: 'day', interval: 1, startDate: '2026-02-01' })), '2026-03-01');
  assert.strictEqual(nextKey('2026-12-31', mkRule({ freq: 'day', interval: 1, startDate: '2026-12-01' })), '2027-01-01');
});

test('按周重复：同周内顺延到下一个指定周几', () => {
  // 2026-03-02 是周一；指定周一 + 周四
  const r = mkRule({ freq: 'week', interval: 1, weekdays: [1, 4], startDate: '2026-03-02' });
  assert.strictEqual(nextKey('2026-03-02', r), '2026-03-05');
  assert.strictEqual(nextKey('2026-03-05', r), '2026-03-09');
});

test('按周重复：每 2 周时跳过中间那一周', () => {
  const r = mkRule({ freq: 'week', interval: 2, weekdays: [1], startDate: '2026-03-02' });
  assert.strictEqual(nextKey('2026-03-02', r), '2026-03-16');
  assert.strictEqual(nextKey('2026-03-16', r), '2026-03-30');
});

test('按周重复：多天 + 跨月', () => {
  const r = mkRule({ freq: 'week', interval: 1, weekdays: [5, 7], startDate: '2026-03-01' });
  assert.strictEqual(nextKey('2026-03-27', r), '2026-03-29'); // 周五 → 周日
  assert.strictEqual(nextKey('2026-03-29', r), '2026-04-03'); // 周日 → 下周五（跨月）
});

test('按月重复：31 日在短月回退到月末，且不漂移', () => {
  const r = mkRule({ freq: 'month', interval: 1, startDate: '2026-01-31' });
  assert.strictEqual(nextKey('2026-01-31', r), '2026-02-28', '1/31 → 2/28（2026 非闰年）');
  assert.strictEqual(nextKey('2026-02-28', r), '2026-03-31', '回退后仍锚定 31 日，不漂移到 3/28');
  assert.strictEqual(nextKey('2026-03-31', r), '2026-04-30');
});

test('按月重复：闰年 2 月有 29 日', () => {
  const r = mkRule({ freq: 'month', interval: 1, startDate: '2028-01-31' });
  assert.strictEqual(nextKey('2028-01-31', r), '2028-02-29');
});

test('按月重复：间隔 N 个月可跨年', () => {
  const r = mkRule({ freq: 'month', interval: 3, startDate: '2026-11-30' });
  assert.strictEqual(nextKey('2026-11-30', r), '2027-02-28');
});

test('按年重复：2/29 在平年回退到 2/28，闰年恢复', () => {
  const r = mkRule({ freq: 'year', interval: 1, startDate: '2024-02-29' });
  assert.strictEqual(nextKey('2024-02-29', r), '2025-02-28');
  assert.strictEqual(nextKey('2025-02-28', r), '2026-02-28');
  assert.strictEqual(nextKey('2027-02-28', r), '2028-02-29');
});

test('结束条件：到指定日期（含当天）后停止', () => {
  const r = mkRule({ freq: 'day', interval: 1, startDate: '2026-03-01', endMode: 'until', endDate: '2026-03-10' });
  assert.strictEqual(nextKey('2026-03-09', r), '2026-03-10');
  assert.strictEqual(nextKey('2026-03-10', r), null, '已到结束日不再生成');
});

test('结束条件：完成 N 期后停止', () => {
  const r = mkRule({ freq: 'day', interval: 1, startDate: '2026-05-01', endMode: 'count', endCount: 3 });
  assert.strictEqual(isCountExhausted(r, 1), false);
  assert.strictEqual(isCountExhausted(r, 2), false);
  assert.strictEqual(isCountExhausted(r, 3), true, '已生成 3 期即停止');
});

test('非法规则被拒绝（不重复）', () => {
  assert.strictEqual(normalizeRule(null), null);
  assert.strictEqual(normalizeRule({ freq: 'week' }), null, '缺少起始日');
  assert.strictEqual(normalizeRule({ freq: 'hello', startDate: '2026-01-01' }), null, '非法频率');
  assert.strictEqual(normalizeRule({ freq: 'day', startDate: '2026-02-31' }), null, '非法日期');
  assert.strictEqual(
    normalizeRule({ freq: 'day', startDate: '2026-05-01', endMode: 'until', endDate: '2026-04-01' }),
    null,
    '结束日早于起始日'
  );
});

test('周几列表去重排序，空列表时沿用起始日的周几', () => {
  const r = normalizeRule({ freq: 'week', weekdays: [3, 1, 3, 7], startDate: '2026-03-04' }) as RepeatRule;
  assert.deepStrictEqual(r.weekdays, [1, 3, 7]);
  const fallback = normalizeRule({ freq: 'week', weekdays: [], startDate: '2026-03-04' }) as RepeatRule;
  assert.deepStrictEqual(fallback.weekdays, [3], '2026-03-04 是周三');
});

test('本地日历日不受 UTC 解析影响', () => {
  assert.strictEqual(toDateKey(new Date(2026, 0, 1, 23, 59)), '2026-01-01');
  assert.strictEqual(toDateKey(new Date(2026, 11, 31, 0, 1)), '2026-12-31');
});

// ---- 系列与实例 ----
{
  const s = createStore(tmpDir());
  const u = s.ensureLocalUser().id;

  const weekly = s.createTask(u, {
    title: '每周例会',
    category: '工作',
    priority: 'medium',
    dueAt: '2026-03-02T10:00:00',
    repeat: { freq: 'week', interval: 1, weekdays: [1], startDate: '2026-03-02', endMode: 'never', endDate: null, endCount: null },
  });

  test('创建重复任务：生成系列 + 首实例带 seriesId', () => {
    assert.ok(weekly.seriesId, '首实例应关联系列');
    assert.strictEqual(s.listSeries(u).length, 1);
    assert.strictEqual(s.getSeriesForTask(u, weekly.id)?.title, '每周例会');
  });

  test('完成当前期后自动生成下一期（保持时刻）', () => {
    const res = s.toggleComplete(u, weekly.id, true);
    assert.ok(res, '应返回更新结果');
    assert.ok(res!.next, '应推进出下一期');
    assert.strictEqual(toDateKey(new Date(res!.next!.dueAt!)), '2026-03-09');
    const t = new Date(res!.next!.dueAt!);
    assert.strictEqual(`${t.getHours()}:${t.getMinutes()}`, '10:0', '时刻沿用首实例');
    assert.strictEqual(res!.next!.completed, false);
    assert.strictEqual(res!.next!.seriesId, weekly.seriesId);
  });

  test('取消完成后回滚已生成的后续期', () => {
    const res = s.toggleComplete(u, weekly.id, false);
    assert.ok(res);
    assert.strictEqual(res!.next, null);
    assert.strictEqual(s.listTasks(u, { status: 'all' }).length, 1, '后续期应被撤销');
    assert.strictEqual(s.listSeries(u)[0].completedCount, 0);
  });

  test('每期保留独立的完成状态与备注', () => {
    const done = s.toggleComplete(u, weekly.id, true);
    const next = done!.next!;
    s.updateTask(u, next.id, { note: '第二期备注' });
    const first = s.getTask(u, weekly.id)!;
    const second = s.getTask(u, next.id)!;
    assert.strictEqual(first.completed, true);
    assert.strictEqual(second.completed, false);
    assert.strictEqual(second.note, '第二期备注');
    assert.strictEqual(first.note, '', '第一期备注不受影响');
    // 复位，供后续用例使用
    s.toggleComplete(u, weekly.id, false);
  });

  test('仅本次编辑：只改这一期', () => {
    const res = s.toggleComplete(u, weekly.id, true)!;
    const next = res.next!;
    s.updateTaskScoped(u, next.id, { title: '仅改这一期' }, 'once');
    assert.strictEqual(s.getTask(u, next.id)!.title, '仅改这一期');
    assert.strictEqual(s.getSeriesForTask(u, next.id)!.title, '每周例会', '系列模板不变');
    s.toggleComplete(u, weekly.id, false);
  });

  test('整个系列编辑：同步未完成的期，已完成的期保留原样', () => {
    const res = s.toggleComplete(u, weekly.id, true)!;
    const next = res.next!;
    s.updateTaskScoped(u, next.id, { title: '全员周会', note: '模板备注' }, 'series');
    assert.strictEqual(s.getTask(u, next.id)!.title, '全员周会');
    assert.strictEqual(s.getSeriesForTask(u, next.id)!.title, '全员周会');
    assert.strictEqual(s.getTask(u, weekly.id)!.title, '每周例会', '已完成的期保持历史');
    s.deleteTaskScoped(u, weekly.id, 'series');
  });

  test('仅本次删除：删当期并自动推进下一期', () => {
    const daily = s.createTask(u, {
      title: '日报',
      dueAt: '2026-06-01T09:00:00',
      repeat: { freq: 'day', interval: 1, weekdays: [], startDate: '2026-06-01', endMode: 'never', endDate: null, endCount: null },
    });
    const res = s.deleteTaskScoped(u, daily.id, 'once');
    assert.strictEqual(res.deleted, true);
    assert.ok(res.next, '应推进出下一期');
    assert.strictEqual(toDateKey(new Date(res.next!.dueAt!)), '2026-06-02');
    s.deleteTaskScoped(u, res.next!.id, 'series');
  });

  test('整个系列删除：清空所有期与系列', () => {
    const t = s.createTask(u, {
      title: '临时系列',
      dueAt: '2026-07-01T09:00:00',
      repeat: { freq: 'day', interval: 1, weekdays: [], startDate: '2026-07-01', endMode: 'never', endDate: null, endCount: null },
    });
    const res = s.toggleComplete(u, t.id, true)!;
    assert.strictEqual(s.listTasks(u, { status: 'all' }).length, 2);
    const del = s.deleteTaskScoped(u, t.id, 'series');
    assert.strictEqual(del.deleted, true);
    assert.strictEqual(del.next, null);
    assert.strictEqual(s.listTasks(u, { status: 'all' }).length, 0);
    assert.strictEqual(s.listSeries(u).length, 0);
  });

  test('完成 N 期后不再生成', () => {
    const t = s.createTask(u, {
      title: '三次打卡',
      dueAt: '2026-05-01T09:00:00',
      repeat: { freq: 'day', interval: 1, weekdays: [], startDate: '2026-05-01', endMode: 'count', endDate: null, endCount: 3 },
    });
    const a = s.toggleComplete(u, t.id, true)!;
    assert.ok(a.next, '第 2 期');
    const b = s.toggleComplete(u, a.next!.id, true)!;
    assert.ok(b.next, '第 3 期');
    const c = s.toggleComplete(u, b.next!.id, true)!;
    assert.strictEqual(c.next, null, '达到 3 期后停止');
    assert.strictEqual(s.listTasks(u, { status: 'all' }).length, 3);
    s.deleteTaskScoped(u, t.id, 'series');
  });

  test('未填截止时间时，重复任务落在起始日 09:00', () => {
    const t = s.createTask(u, {
      title: '无截止时间的重复',
      repeat: { freq: 'week', interval: 1, weekdays: [2], startDate: '2026-08-04', endMode: 'never', endDate: null, endCount: null },
    });
    const due = new Date(t.dueAt!);
    assert.strictEqual(toDateKey(due), '2026-08-04');
    assert.strictEqual(due.getHours(), 9);
    s.deleteTaskScoped(u, t.id, 'series');
  });

  test('重复任务重启后仍可继续推进（持久化）', () => {
    const t = s.createTask(u, {
      title: '持久化系列',
      dueAt: '2026-09-01T09:00:00',
      repeat: { freq: 'month', interval: 1, weekdays: [], startDate: '2026-09-01', endMode: 'never', endDate: null, endCount: null },
    });
    s.toggleComplete(u, t.id, true);
    s.reload();
    const series = s.listSeries(u).find((x) => x.title === '持久化系列');
    assert.ok(series, '系列应持久化');
    assert.strictEqual(series!.generatedCount, 2);
    const open = s.listTasks(u, { status: 'active' }).find((x) => x.seriesId === series!.id);
    assert.ok(open, '下一期应持久化');
    assert.strictEqual(toDateKey(new Date(open!.dueAt!)), '2026-10-01');
    s.deleteTaskScoped(u, t.id, 'series');
  });

  test('v1 老数据（无 series 字段）加载后视为普通任务', () => {
    const dirOld = tmpDir();
    const legacy = {
      version: 1,
      users: [{ id: 'u1', username: '本机用户', passwordHash: '', createdAt: '2026-01-01T00:00:00.000Z' }],
      sessions: [],
      tasks: [
        {
          id: 't1',
          userId: 'u1',
          title: '老任务',
          note: '',
          priority: 'medium',
          priorityReason: '',
          category: '工作',
          dueAt: null,
          remindAt: null,
          completed: false,
          completedAt: null,
          reminded: false,
          pomodoros: 0,
          source: 'manual',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      messages: [],
      settings: {},
    };
    fs.writeFileSync(path.join(dirOld, 'db.json'), JSON.stringify(legacy));
    const old = createStore(dirOld);
    const list = old.listTasks('u1', { status: 'all' });
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].seriesId, null, '老任务 seriesId 应为 null');
    assert.strictEqual(old.listSeries('u1').length, 0);
    assert.strictEqual(old.getSeriesForTask('u1', 't1'), null);
    // 老库可正常写入新结构
    const t = old.createTask('u1', {
      title: '升级后的重复任务',
      dueAt: '2026-10-01T09:00:00',
      repeat: { freq: 'day', interval: 1, weekdays: [], startDate: '2026-10-01', endMode: 'never', endDate: null, endCount: null },
    });
    assert.ok(t.seriesId);
  });
}

// ============ 汇总 ============
console.log(`\n${'='.repeat(48)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('\n失败详情：');
  for (const f of failures) console.log(` - ${f.name}: ${f.err.stack.split('\n').slice(0, 3).join('\n   ')}`);
  process.exit(1);
}
console.log('全部测试通过 ✅');
