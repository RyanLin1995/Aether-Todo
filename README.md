# Aether Todo

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey)](#)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](#)
[![Bun](https://img.shields.io/badge/bun-1.4-f472b6?logo=bun&logoColor=white)](#)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](#)

A vanguard, local-first Windows to-do experience crafted with **Liquid Glass** aesthetics. Transforms natural speech into structured tasks — with automatic priority, category, customizable Pomodoro focus, and reminders. Zero account, zero telemetry, 100% offline-ready.

Say **"send the weekly report to my boss before 3pm tomorrow, it's urgent"** → parsed into a task with deadline, priority (*high*, with a stated reason) and category (*Work*) → confirm → reminded on time.

简体中文文档：[README_CN.md](README_CN.md)

![Aether Todo](tests/screenshots/audit/01-main-initial.png)

## Features

- 💧 **Liquid Glass Design System** — Awwwards / FWA tier craftsmanship with specular rim lights, fluid mesh glow, crystal borders & physics-based interactions
- 🏝️ **Dynamic Island Floating Widget** — Seamless morphing between compact pill and expanded island modes, complete with pulse rings, luminous progress bars, and micro-capsule controls
- 💎 **Pure Vector System** — Unified Lucide icons throughout the app, completely free of Emoji
- ↕️ **Drag-and-Drop Task Reordering** — Intuitive handle drag-and-drop with real-time insertion glow lines, persisted to local disk
- 🍅 **Versatile Pomodoro Timer (Pause & Resume)** — Configurable focus duration, pause/resume capability, and safe confirmation dialogs to protect focus sessions
- 📧 **Drop Email & File Extraction** — Drag `.eml` emails or documents directly into the AI assistant for instant task generation
- 💭 **AI Deep Thinking Wave Animation** — Fluid three-dot wave animation during task decomposition for mindful feedback
- ⚙️ **System-wide Liquid Opacity** — Real-time slider adjusting blur and glass opacity across both main app and floating island
- 📐 **Adaptive Fluid Layout** — Fully responsive task cards with stable action pills that adapt smoothly across any window size (1000px to 4K ultra-wide)
- 🤖 **Natural Language → Tasks** — Chat with the built-in assistant; one sentence can become several tasks
- 🎯 **Automatic Priority** — High / Medium / Low, each with a human-readable verdict
- 🗂 **Automatic Categories** — Work · Study · Life · Health · Finance · Social · Other
- ⏰ **Reminders** — OS notifications, "remind me early", background tray service
- 💬 **Bi-directional Conversation** — *"I already finished the weekly report"* → it finds and completes the task
- 🌐 **Bilingual UI** — 简体中文 / English, switchable in Settings
- 🌓 **Dark Mode** — Light / Dark / Follow-System with glassmorphic depth
- 📊 **Statistics Dashboard** — Weekly / Monthly / Yearly completion stats, trend charts, and category breakdowns
- 🔌 **Proxy Support** — LLM requests go direct, via the system proxy, or through a custom HTTP proxy
- 🔒 **Local-only Data** — Human-readable JSON storage, atomic writes, zero telemetry

**Works with or without an API key.** The AI layer has two engines: any OpenAI-compatible LLM (DeepSeek, Qwen, Zhipu, OpenAI, local Ollama…) and a built-in local rule engine (zh/en time parsing + keyword priority + category dictionary). No key, network error, or timeout → it silently falls back to local parsing.

## Quick start

```bash
bun install                                        # dependencies
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  node node_modules/electron/install.js            # Electron binary (Bun skips postinstall)
bun run start                                      # build + launch
```

> [!WARNING]
> If your shell sets `ELECTRON_RUN_AS_NODE=1`, `electron.exe` degrades to plain Node. `bun run start` strips it via `scripts/launch.js`.

### End users

Run **`dist/Aether Todo-1.0.0-Setup.exe`** — NSIS installer with a **language picker (简体中文 / English)**, desktop & Start-menu shortcuts, and a proper uninstaller (also reachable from *Settings → About → Uninstall app*).

## Scripts

| Command | Description |
|---|---|
| `bun run start` / `dev` | Build (TS → bundles) and launch |
| `bun run typecheck` | `tsc --noEmit` (strict mode) |
| `bun run test` | Logic & boundary tests (store, zh/en time parsing, priority/category, reminders, i18n) |
| `node scripts/verify-all-buttons.js` | Automated full button audit verifying success & error states across 22 test nodes |
| `bun run icon` | Regenerate the app icon |
| `bun run build` | Full pipeline: prebuild, asset injection, and package into `dist/Aether Todo-1.0.0-Setup.exe` |

## Configuring the AI (optional)

Settings → **AI model**: base URL, API key, model name, plus a **network proxy** choice (none / system / custom HTTP). **Test connection** verifies the whole chain; leave the key empty to stay on the local engine forever.

<details>
<summary>Model output contract (strict JSON)</summary>

```json
{
  "reply": "Got it — I marked the report as high priority.",
  "intent": "create",
  "tasks": [
    {
      "title": "Send the weekly report to my boss",
      "note": "",
      "category": "工作",
      "priority": "high",
      "priorityReason": "Boss is waiting and it's due today",
      "dueAt": "2026-09-30T15:00:00+08:00",
      "remindAt": "2026-09-30T14:50:00+08:00"
    }
  ],
  "matchTitles": []
}
```

`intent`: `create` · `complete` · `list` · `chat`. Malformed output is handled gracefully (local fallback).
</details>

## Project structure

```
src/
  shared/types.ts      types shared by main & renderer
  main/                Electron main process (TypeScript)
    main.ts            window, tray, notifications, single-instance lock
    ipc.ts             all IPC handlers
    store.ts           JSON file database (atomic writes)
    ai.ts              dual AI engine (remote LLM + local rules)
    prompt.ts          bilingual system prompts
    i18n.ts            main-process strings
    reminder.ts        due-task scheduler
    crypto.ts          ID generation, password hashing
  preload.ts           contextBridge API surface
  renderer/
    index.html · styles.css
    src/               app.ts · api.ts · tasks.ts · assistant.ts · settings.ts · i18n.ts · utils.ts
dist-electron/         built main/preload bundles (generated)
src/renderer-dist/     built renderer bundle (generated)
scripts/               launch.js · make-icon.js · diag.js
tests/                 run.ts (logic) · e2e.js (GUI) · screenshots/
```

## Testing

```bash
bun run typecheck   # strict TS, clean
bun run test        # 51/51
bun run test:e2e    # 41/41 — drives the real window over CDP
```

E2E covers: boot without login → AI parsing → confirm tasks → complete/filter → settings → reminders → language switching → persistence after reload. It can also run against the packaged exe:

```bash
AITODO_BIN="dist/win-unpacked/AI待办.exe" node tests/e2e.js
```

## Internationalization & theming

简体中文 (default) and English, switchable in **Settings → Language** — no restart. Applies to the UI, local-engine replies & verdicts, the LLM prompt, notifications, tray menu, window title, and date formatting. Categories are stored as internal Chinese keys and localized at display time.

Theming runs on daisyUI 5 design tokens: **light / dark / follow-system**, also in Settings and persisted locally.

To add a language: add a message table with identical keys to both `src/main/i18n.ts` and `src/renderer/src/i18n.ts` (a unit test enforces key parity), then register it in `SUPPORTED_LOCALES`.

## Building & data

```bash
bun run build   # → dist/AI Todo App-1.0.0-Setup.exe (~107 MB, NSIS, x64)
```

- Data lives at `%APPDATA%\ai-todo\data\db.json` — single file, atomic writes, nothing leaves your machine except the LLM request you configure.
- Binaries are pulled via npmmirror (`ELECTRON_MIRROR`, `ELECTRON_BUILDER_BINARIES_MIRROR`).
- The installer is not code-signed; Windows SmartScreen may warn on first launch. For public distribution, set `CSC_LINK` / `CSC_KEY_PASSWORD`.

## License

[Apache-2.0](LICENSE) © 2026 ai_todo contributors

## Acknowledgements

Designed, implemented, tested and packaged end-to-end by **WorkBuddy**, an AI assistant — architecture decisions, dual AI engine, CDP-based GUI test harness, icon generation, and the installer pipeline all included. Standing on Electron, Bun, electron-builder and the Node.js ecosystem.
