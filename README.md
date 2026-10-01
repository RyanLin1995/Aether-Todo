<p align="center">
  <img src="build/icon.png" width="112" alt="Aether Todo" />
</p>

<h1 align="center">Aether Todo</h1>

<p align="center">
  <b>A personal time console for the vibe-coding era</b><br/>
  You're running several AI agents at once — don't lose track of yourself<br/>
  Drop a task in plain words, get priority and a due time, and a nudge when it's time
</p>

<p align="center">
  <a href="https://github.com/RyanLin1995/Aether-Todo/releases/latest"><img src="https://img.shields.io/github/v/release/RyanLin1995/Aether-Todo?style=flat-square&label=latest&color=7C3AED" alt="Latest Release"></a>
  <a href="https://github.com/RyanLin1995/Aether-Todo/releases"><img src="https://img.shields.io/github/downloads/RyanLin1995/Aether-Todo/total?style=flat-square&color=7C3AED&label=downloads" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-blue?style=flat-square" alt="Platform">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="https://github.com/RyanLin1995/Aether-Todo/releases/latest">Download</a> ·
  <a href="./README_CN.md">简体中文</a>
</p>

![Aether Todo main window](docs/screenshots/main.png)

## Why I built this

After vibe coding took over my day, I found myself running "multithreaded".

- Claude Code is working on one thing, Codex on another repo, and in the back of my head there's "reply to the boss later" and "don't forget the milk".
- My attention got sliced into pieces. The agents shipped a lot; *I* remembered almost nothing.
- What I was missing wasn't more agents — it was something that would **re-plan my time and call me back** when it's time to do the thing.

So I built Aether Todo — a local-first to-do + focus app for Windows.

Toss the scattered "I'll do this later" thoughts into it in plain words. It sorts them by priority, keeps an eye on progress, and reminds you on time. No account, no network, no upload — your data stays on your machine.

## What it looks like

<table>
<tr>
<td width="50%"><img src="docs/screenshots/island.png" alt="Dynamic Island widget"></td>
<td width="50%"><img src="docs/screenshots/notification.png" alt="Reminder"></td>
</tr>
<tr>
<td><img src="docs/screenshots/stats.png" alt="Statistics"></td>
<td><img src="docs/screenshots/main-dark.png" alt="Dark mode"></td>
</tr>
</table>

## One sentence → one task

Say or type **"send the weekly report to my boss before 3pm tomorrow, it's urgent"**:

```
Due         Tomorrow 15:00
Priority    High   (reason: "it's urgent", and it's due today)
Category    Work
```

Hit "Add" → you get a reminder on time. Changed your mind? Say *"I already finished the weekly report"* and it finds the task and marks it done.

## Features

- **Natural language → tasks** — talk like a human; one sentence can split into several tasks
- **Automatic priority & category** — High / Medium / Low, each with a plain-language reason
- **On-time reminders** — "remind me early" support, tray service keeps running even after you close the window
- **Pomodoro (pause / resume)** — configurable focus length
- **Dynamic Island widget** — snaps to the screen edge; glance at the current task and countdown anytime
- **Statistics dashboard** — weekly / monthly / yearly completion, trends, category breakdown
- **Liquid Glass UI** — light / dark themes, real-time opacity slider
- **Bilingual** — 简体中文 / English, switchable instantly (UI, AI replies, notifications)
- **Local-only** — a single human-readable JSON file, atomic writes, zero telemetry
- **Works with or without an API key** — any OpenAI-compatible LLM (DeepSeek, Qwen, Zhipu, Ollama…); no key or network error → it silently falls back to the built-in local rule engine

## Download

Windows x64, double-click to install, with a **Chinese / English** setup wizard.

**[Download the latest release](https://github.com/RyanLin1995/Aether-Todo/releases/latest)**

> The installer isn't code-signed, so Windows SmartScreen may warn on first launch — click "More info → Run anyway".

## Run it yourself

```bash
bun install                                        # dependencies
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  node node_modules/electron/install.js            # Electron binary (Bun skips postinstall)
bun run start                                      # build + launch
```

| Command | What it does |
|---|---|
| `bun run start` | Build and launch |
| `bun run typecheck` | TypeScript strict type check |
| `bun run test` | Logic & boundary tests |
| `bun run build` | Package into `dist/*-Setup.exe` |

## Tech stack

Electron 44 · TypeScript (strict) · Bun · local JSON storage · zero native dependencies.

<details>
<summary>AI configuration / project structure / model output contract</summary>

**AI configuration**: Settings → AI model — base URL, API key, model name, plus an optional network proxy (direct / system / custom HTTP). Leave the key empty to stay on the local rule engine forever.

**Project structure**

```
src/
  shared/types.ts      types shared by main & renderer
  main/                Electron main process: window, tray, notifications, store, AI, reminder scheduler
  preload.ts           contextBridge API surface
  renderer/            UI: tasks, assistant, settings, statistics, Pomodoro
build/                 icon source & packaging assets
scripts/               build, icon generation, diagnostics
tests/                 logic tests + CDP-driven GUI tests
docs/screenshots/      README images
```

**Model output contract (strict JSON, graceful fallback on malformed output)**

```json
{
  "reply": "Got it — I marked the report as high priority.",
  "intent": "create",
  "tasks": [
    {
      "title": "Send the weekly report to my boss",
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

`intent`: `create` · `complete` · `list` · `chat`.
</details>

## License

[Apache-2.0](LICENSE) © 2026 ai_todo contributors

## Acknowledgements

Designed, implemented, tested and packaged end-to-end by **WorkBuddy**, an AI assistant — architecture decisions, dual AI engine, the UI, the CDP-based GUI test harness, icon generation, and the installer pipeline all included. Standing on the shoulders of Electron, Bun, electron-builder and the Node.js ecosystem.
