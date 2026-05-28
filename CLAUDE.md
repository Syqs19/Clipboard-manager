# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

---

## Part 1 — Behavioral Guidelines

Derived from Andrej Karpathy's observations on common LLM coding pitfalls. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Part 2 — Project Context

### What this is

A **local, no-cloud clipboard manager** desktop app for the user's own Windows PC.
**Privacy-first: everything is local — zero network, zero telemetry, zero accounts.**
Repo: https://github.com/Syqs19/Clipboard-manager

### Stack

- **Tauri 2.x** (Rust backend) + **React + TypeScript + Vite** + **Tailwind CSS v4**
- SQLite via **`rusqlite`** with the `bundled` feature (engine compiled into the exe)
- Clipboard: **`clipboard-master`** (event-driven monitor, Windows `AddClipboardFormatListener`) + **`arboard`** (read/write text & images)
- Plugins: `tauri-plugin-global-shortcut`, `tauri-plugin-autostart`, `tauri-plugin-store`
- Identifier `com.matte.clipboardmanager`; crate `clipboard-manager` / lib `clipboard_manager_lib`

### Scope decisions

- **Windows-only** (deliberate — not cross-platform).
- **No light theme** (dark-only, by user's choice).
- Keyboard: Enter / 1-9 = **copy only** (no auto-paste, no hide — direct-paste/enigo was dropped per UX feedback).

### Commands (run from project root)

| Task | Command |
|------|---------|
| Dev (hot-reload) | `npm run tauri dev` |
| Build installer | `npm run tauri build` → `.msi` + `.exe` (NSIS) in `src-tauri/target/release/bundle/` |
| Frontend type-check | `npx tsc --noEmit` |
| Rust unit tests | `cargo test --manifest-path "src-tauri\Cargo.toml"` |
| Regenerate app icon | `npm run tauri -- icon app-icon.png` |

**Environment quirks (Windows):**
- `cargo`/`rustc` are NOT on the default PATH — prepend `%USERPROFILE%\.cargo\bin` each shell.
- Use **`git.exe`** explicitly in commands.
- Git user is `Syqs19`; HTTPS push works via Git Credential Manager.
- **Never add a `Co-Authored-By` trailer to commits** (user preference; past history was rewritten to remove it).

### Architecture / key files

Backend (`src-tauri/src/`):
- `lib.rs` — Tauri builder: opens DB, reads settings from store, registers hotkey, builds tray, starts watcher, close-to-tray, commands.
- `clipboard_watcher.rs` — background thread; on clipboard change captures text/url/image, categorizes, dedups (move-to-top), prunes to limit, emits `clips-changed` (payload = clip id).
- `categorizer.rs` — classifies text → tag (Link/Email/Numeri/Codice/Testo lungo/Testo) + `sensitive` flag (IBAN/cards/email/long tokens). Has unit tests.
- `db.rs` — SQLite (WAL); `clips`/`tags`/`clip_tags`; dedup by FNV-1a hash; pin/prune/search/tag ops. Has unit tests.
- `commands.rs` — Tauri commands invoked from the frontend (list/search/copy/pin/delete/clear/tags/colors/edit/settings).
- `settings.rs` — `RuntimeState` (paused / max_history / close_to_tray atomics).
- `tray.rs` — tray icon + menu; `images.rs` — PNG save/load (re-copy images).

Frontend (`src/`): `App.tsx` (state, keyboard nav, events), `components/` (Sidebar, SearchBar, ClipList, ClipCard, Settings, ImagePreview), `lib/api.ts` (invoke wrappers + events), `lib/format.ts` (masking + tag colors).

Runtime data: `%APPDATA%\com.matte.clipboardmanager\` → `clips.db`, `settings.json`, `images/*.png`.

### Notable behaviors

- **Sensitive masking**: sensitive clips shown masked (email start+domain, token/IBAN prefix+last4); full content stays in DB and is copyable; eye toggle to reveal.
- **Dedup move-to-top**: re-copying existing content bumps it to top, no duplicate.
- **Hotkey** configurable (default `Ctrl+Shift+V`); **close-to-tray** + **autostart default OFF**.
- **Images**: captured as PNG, thumbnail in card, click → preview lightbox, dedicated "Immagini" sidebar section.
- **Tags**: auto + manual; per-tag color via native color picker (sidebar dot and card chips).

### Roadmap

See `IMPROVEMENTS.md` for done/pending items and next candidates.
