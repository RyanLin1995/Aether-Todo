# Aether Todo（心流待办）

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey)](#)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](#)
[![Bun](https://img.shields.io/badge/bun-1.4-f472b6?logo=bun&logoColor=white)](#)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](#)

对标 Awwwards / FWA 顶级水准打造的先锋**液态玻璃（Liquid Glass）**待办与心流专注体验。用自然口语描述一件事，自动拆解为带时间、优先级、类别的结构化任务，并具备可贴边吸附微型悬浮窗与深度可配置番茄钟。无需注册、无需登录、零遥测、纯本地。

说一句 **「明天下午三点前把周报发给老板，很急」** → 解析出截止时间、优先级（高，附判定理由）、类别（工作）→ 确认入库 → 准时弹提醒。

English documentation: [README.md](README.md)

![Aether Todo 主界面](tests/screenshots/audit/01-main-initial.png)

## 功能

- 💧 **液态玻璃设计体系** —— 先锋水光折射、环境流体光斑、晶质双层高光边框、物理弹性触感
- 🏝️ **苹果先锋灵动岛（Dynamic Island）悬浮窗** —— 胶囊态与展开态无缝弹性形态切换，灵动脉冲呼吸环、倒计时细流光进度条、任务与操作微药丸
- 💎 **纯净矢量体系** —— 界面全程统一采用 Lucide 矢量图标，彻底告别 Emoji 表情符号
- ↕️ **任务拖拽自定义排序** —— 鼠标拖动专用手柄自由调整待办先后顺序，实时微光指示线，落盘持久化
- 🍅 **全能番茄钟（支持暂停/继续）** —— 专注时长自由配置，支持暂停、恢复与提前结束二次确认，已完成时长自动统计
- 📧 **邮件与文件拖拽提炼** —— 支持将 `.eml` 邮件或工作文档直接拖入 AI 助手，自动智能提炼待办任务
- 💭 **AI 深度思考等待动效** —— 任务解析过程伴随先锋液态三点跳跃波动动效，带来沉浸式心流反馈
- ⚙️ **整体液态透明度控制** —— 支持设置主界面毛玻璃与灵动岛悬浮窗的整体透明度，滑动实时生效
- 📐 **流式自适应排版** —— 全响应式任务卡片与自适应固定操作药丸，从 1000px 紧凑分屏到 4K 超宽屏自适应缩放无变形
- 🤖 **自然语言建任务** —— 对话式输入，一句话可拆成多条任务
- 🎯 **自动判优先级** —— 高/中/低，每条附人类可读的判定理由
- 🗂 **自动分类** —— 工作 · 学习 · 生活 · 健康 · 财务 · 社交 · 其他
- ⏰ **到点提醒** —— 系统通知、支持「提前提醒」，托盘后台持续工作
- 💬 **双向智能对话** —— 「周报我已经写完了」→ 自动找到任务并标记完成
- 🌐 **双语界面** —— 简体中文 / English，设置里即切即用
- 🌓 **深色模式** —— 浅色 / 深色 / 跟随系统，液态折射光泽随主题无缝流动
- 📊 **统计大屏** —— 本周 / 本月 / 今年的完成量、趋势柱状图与分类环形进度
- 🔌 **网络代理** —— 大模型请求直连、跟随系统代理，或走自定义 HTTP 代理
- 🔒 **纯本地隐私** —— 单个人类可读的 JSON 文件存储，原子写入，零遥测

**有 Key 没 Key 都能用。** AI 层双引擎：任意 OpenAI 兼容大模型（DeepSeek、通义、智谱、OpenAI、本地 Ollama…）+ 内置本地规则引擎（中英文时间解析 + 优先级关键词 + 类别词典）。没配 Key、网络出错或超时 → 自动降级本地解析，永不下线。

## 快速开始

```bash
bun install                                        # 安装依赖
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  node node_modules/electron/install.js            # 补齐 Electron 二进制（Bun 不跑 postinstall）
bun run start                                      # 构建 + 启动
```

> [!WARNING]
> 若终端存在 `ELECTRON_RUN_AS_NODE=1`，`electron.exe` 会退化成普通 Node。`bun run start` 已通过 `scripts/launch.js` 自动清理。

### 普通用户

直接运行 **`dist/Aether Todo-1.0.0-Setup.exe`** —— NSIS 安装向导支持**中英文选择**，自动创建桌面与开始菜单快捷方式，并提供标准卸载程序（也可在应用内「设置 → 关于 → 卸载应用」触发）。

## 常用命令

| 命令 | 说明 |
|---|---|
| `bun run start` / `dev` | 构建（TS → 产物）并启动 |
| `bun run typecheck` | `tsc --noEmit`（strict 模式） |
| `bun run test` | 逻辑与边界测试（存储、中英时间解析、优先级/分类、提醒、i18n 等） |
| `node scripts/verify-all-buttons.js` | 全量按钮点击与成功/失败全状态自动化审查（22 个关键交互节点） |
| `bun run icon` | 重新生成应用图标 |
| `bun run build` | 全量打包产出 `dist/Aether Todo-1.0.0-Setup.exe` |

## AI 配置（可选）

设置 → **AI 大模型**：接口地址、API Key、模型名称，以及**网络代理**（不使用 / 跟随系统 / 自定义 HTTP）。「测试连接」会验证整条链路；Key 留空则始终使用本地规则引擎。

<details>
<summary>模型输出契约（严格 JSON）</summary>

```json
{
  "reply": "收到，周报已标为高优先级。",
  "intent": "create",
  "tasks": [
    {
      "title": "把周报发给老板",
      "note": "",
      "category": "工作",
      "priority": "high",
      "priorityReason": "老板在等且今天截止",
      "dueAt": "2026-09-30T15:00:00+08:00",
      "remindAt": "2026-09-30T14:50:00+08:00"
    }
  ],
  "matchTitles": []
}
```

`intent`：`create`（新增）· `complete`（完成）· `list`（查询）· `chat`（追问）。输出非 JSON 也能优雅兜底。
</details>

## 项目结构

```
src/
  shared/types.ts      主进程/渲染进程共享类型
  main/                Electron 主进程（TypeScript）
    main.ts            窗口、托盘、通知、单实例锁
    ipc.ts             全部 IPC 接口
    store.ts           JSON 文件数据库（原子写入）
    ai.ts              双引擎（远端大模型 + 本地规则）
    prompt.ts          双语系统提示词
    i18n.ts            主进程文案
    reminder.ts        到期任务调度器
    crypto.ts          ID 生成、密码哈希
  preload.ts           contextBridge 暴露的安全 API
  renderer/
    index.html · styles.css
    src/               app.ts · api.ts · tasks.ts · assistant.ts · settings.ts · i18n.ts · utils.ts
dist-electron/         主进程/preload 构建产物（自动生成）
src/renderer-dist/     渲染层构建产物（自动生成）
scripts/               launch.js · make-icon.js · diag.js
tests/                 run.ts（逻辑测试）· e2e.js（GUI 测试）· screenshots/
```

## 测试

```bash
bun run typecheck   # strict TS 零错误
bun run test        # 51/51
bun run test:e2e    # 41/41 —— 驱动真实窗口
```

E2E 覆盖：免登录启动 → AI 解析 → 确认入库 → 完成/筛选 → 设置 → 提醒 → 语言切换 → 刷新持久化。也可直接对打包后的 exe 跑：

```bash
AITODO_BIN="dist/win-unpacked/AI待办.exe" node tests/e2e.js
```

## 国际化与主题（i18n & theming）

界面内置简体中文（默认）与 English，在「设置 → 界面语言」随时切换，无需重启。作用于界面、本地引擎回复与判定理由、大模型提示词、系统通知、托盘菜单、窗口标题、日期格式。类别内部存中文 key，显示时翻译。

主题基于 daisyUI 5 设计令牌：**浅色 / 深色 / 跟随系统**，在「设置 → 主题」切换并本地持久化。

新增语言：在 `src/main/i18n.ts` 与 `src/renderer/src/i18n.ts` 各加一份 key 一致的文案表（单元测试强制 key 对齐），再注册到 `SUPPORTED_LOCALES`。

## 构建与数据

```bash
bun run build   # → dist/AI Todo App-1.0.0-Setup.exe（约 107 MB，NSIS，x64）
```

- 数据位置：`%APPDATA%\ai-todo\data\db.json` —— 单文件、原子写入，除你配置的大模型请求外数据不出本机。
- 二进制走 npmmirror 镜像（`ELECTRON_MIRROR`、`ELECTRON_BUILDER_BINARIES_MIRROR`）。
- 安装包未做商业代码签名，首次运行 SmartScreen 可能提示；对外分发需配置 `CSC_LINK` / `CSC_KEY_PASSWORD`。

## 许可证

[Apache-2.0](LICENSE) © 2026 ai_todo contributors

## 致谢

本应用由 AI 助手 **WorkBuddy** 端到端完成：架构选型、双引擎 AI、界面、CDP 驱动的 GUI 测试、图标生成与安装程序打包。底层站在 Electron、Bun、electron-builder 与 Node.js 生态的肩膀上。
