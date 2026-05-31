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
- Identifier `com.clipboardmanager.app`; crate `clipboard-manager` / lib `clipboard_manager_lib`

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
- `lib.rs` — Tauri builder: opens DB, reads settings from store into a shared `Arc<RuntimeState>`, registers hotkey, builds tray, starts watcher, close-to-tray, runs the `invoke_handler!` registry. Settings sweeps (sensitive TTL) and OCR backfill run as background threads that read the same `Arc<RuntimeState>`.
- `clipboard_watcher.rs` — background thread; on clipboard change captures text/url/image/files, categorizes, dedups (move-to-top), prunes to limit, emits `clips-changed` (payload = clip id). `start(...)` takes the shared `Arc<RuntimeState>` (not loose atomics).
- `categorizer.rs` — classifies text → `ContentType` (Text/Url) + UI tag (Link/Email/Numbers/Code/Long text/Text) + `sensitive_kind`. Has unit tests.
- **`db/`** — SQLite (SQLCipher, WAL) split by domain (multiple `impl Db` blocks on one struct):
  - `db/mod.rs` — schema, migrations, `open/init`, hash fns (`now_millis`/`bytes_hash`/`content_hash`), the structs (`Clip`/`NewClip`/`ClipItem`/`NewClipItem`/`DbStats`/`TagInfo`/`Db`), the **`ContentType` enum** (serde lowercase + `FromSql`/`ToSql`), and `pub(crate)` shared helpers (`collect`, `map_row`, `tags_for_clips`, `items_for_clip_conn`, `SELECT_COLS`).
  - `db/clips.rs` — insert/dedup, list/search/get, pin/reorder, delete/prune, stats, OCR text, `update_clip_content`.
  - `db/tags.rs` — get_or_create/attach/detach/rename/color/pin, list (counts/export), `wipe_all`.
  - `db/groups.rs` — clip-group items (insert/list/get/label) and `merge_clips` (+ private `effective_type`/`clip_as_items`).
  - `db/tests.rs` — all DB unit tests (in-memory).
- **`commands/`** — Tauri commands, organized by **macro-section** (mirrors the sidebar; grows with future sections). `commands/mod.rs` holds shared type aliases (`Database`/`Key`/`Runtime` = the managed `Arc`s) + `DEFAULT_LIMIT` and **re-exports every command with `pub use`** so `lib.rs` keeps referring to them as `commands::<name>`:
  - `commands/clipboard/{clips,tags,io}.rs` — the Clipboard section (clip + group ops, tag ops, history export/import). `io.rs` has the `safe_image_filename` path-traversal guard + its tests.
  - `commands/system/{settings,shell,stats}.rs` — cross-cutting commands (apply_* settings, reveal/open via Windows shell, stats).
  - `commands/tools/{ports,convert,vectorize}.rs` — the Tools section's backend commands: `ports.rs` (`list_ports`/`kill_process` for the Port Killer; FFI confined and balanced), `convert.rs` (`convert_image_bytes_to_path`/`convert_images_batch` for the Image Converter, via the `image` crate; pure `convert_bytes` core with tests), and `vectorize.rs` (`vectorize_image_to_path` for Vectorial — raster→SVG tracing via `vtracer`; pure `vectorize_bytes` core with tests). `vtracer` carries its own old `image 0.23` isolated by Cargo — we only hand it raw RGBA bytes, never a typed image, so there is no version clash. Errors via `AppError` (`#[from] image::ImageError`).
  - When adding a section like Tools/Design, create `commands/<section>/` next to `clipboard/` — isolated, no impact on the rest.
- `error.rs` — **`AppError`** (`thiserror` enum) with `#[from]` for rusqlite/io/serde_json/base64 and `From<String>` for domain messages; `impl Serialize` emits the message string so the frontend still receives a plain error text. All commands return `AppResult<T>`; `?` propagates without `.map_err(|e| e.to_string())`.
- `settings.rs` — `RuntimeState` (paused / max_history / close_to_tray / dont_save_sensitive / sensitive_ttl / sensitive_kinds / ocr_enabled / max_image_bytes); `ALL_SENSITIVE_KINDS`. `crypto.rs` — DPAPI-wrapped master key + AES-256-GCM helpers. `images.rs` — encrypted PNG save/load + thumbnails. `ocr.rs` — Windows WinRT OCR (off-thread). `transforms.rs` — "Paste as" pure transforms. `win_clipboard.rs` — Win32 FFI (CF_HDROP, CF_HTML/RTF, exclusion flags). `tray.rs` — tray icon + menu.

Frontend (`src/`): `App.tsx` (orchestrator: high-level state + `activeSection` router; composes the hooks below — was an ~885-line god component, now ~600), `hooks/` (`useClipboardData` = clips/tags + reload + `clips-changed` + "Copied" flash; `useBulkSelection` = multi-select + bulk ops; `useKeyboardNav` = ESC + ↑↓/Enter/1-9/Del; `useClipDnd` = all drag&drop incl. `collisionDetection`/`snapCenterToCursor`; `useCopy` = clipboard write + toast, shared by all tools), `components/` (Sidebar, SearchBar, ClipList, ClipCard, GroupDetail, GroupPreview, ImagePreview, SelectionBar, Settings, TagPicker, TransformPicker, CodeBlock, Toaster, Onboarding, UpdateButton, ConfirmDialog, ToolsSection, ToolCard), `lib/api.ts` (invoke wrappers + events + the **`ContentType` union** and **`Tag` interface** mirroring the Rust types; also `PortInfo`), `lib/format.ts` (masking + tag colors + `humanBytes`), `lib/useImageUrl.ts`/`useExitAnimation.ts` (hooks). Tests: Vitest + RTL (`npm test`); `src/test/` (setup + fixtures), `src/App.test.tsx`, `src/lib/format.test.ts`, `src/tools/env-json/env.test.ts`.

**Tools section (`src/tools/`)** — a dev toolbox that grows by **registry**, not by editing the shell:
- `registry.ts` — the **single source of truth** for the tool list (`ToolDescriptor`: id, label, description, icon-component, component, optional `keywords` for search). `types.ts` defines `ToolDescriptor`. Adding a tool = create `tools/<name>/<Name>.tsx` + one typed entry; `ToolsSection`/`ToolCard`/`useToolPrefs` all read from the registry. The Tools dashboard has a search bar (`ToolsSection.matchesQuery`, tested) filtering on label+description+keywords, so e.g. "png" finds every image tool.
- `useToolPrefs.ts` — order + favorites persisted in `settings.json`, reconciled against the registry (new tools appear at the end, removed ones leave no orphans).
- `shared/` — **cross-tool single sources of truth** (the same way `lib/format.ts` is for the Clipboard domain): `Toggle.tsx` (checkbox+label), `ToolButton.tsx` (toolbar buttons, neutral/accent, icon-only vs label decided by presence of children), `OutputPane.tsx`/`panels.ts` (output box + shared textarea class), `hash.ts` (`HASH_ALGOS`/`HashAlgo`/`hashBytes`/`hashText`), `codec.ts` (`base64UrlToText`), `ui.ts` (`tabBtnClass` for segmented controls). Tools that diverge (custom `disabled`, different label classes) stay inline rather than over-parameterizing the shared component.
- ~21 tools today (Port Killer, JSON/YAML/.env/HTML-entities/Base64-URL/case/slug converters, JWT, Regex, Cron, Timestamp, Number base, Generators, Fake data, QR, Hash compare, Markdown, Image Converter, Vectorial). Each tool is autonomous in its folder and never imports from another tool. Tools with a backend (Port Killer, Image Converter, Vectorial) call their command via `lib/api.ts`; the rest are frontend-only.

Runtime data: `%APPDATA%\com.clipboardmanager.app\` → `clips.db` (SQLCipher), `key.bin` (DPAPI), `settings.json`, `images/*.png` (encrypted).

### Coding conventions introduced (keep consistent)

- **Type the type, don't stringly-type it.** Clip/item kinds use the `ContentType` enum (Rust) ↔ `ContentType` union (TS), kept aligned by hand. Adding a variant makes the compiler list every `match`/`switch` to update. Don't reintroduce bare `"image"`/`"group"` string comparisons.
- **Named structs over positional tuples** at the frontend boundary (e.g. `TagInfo`/`Tag`, not `[name, count, color, pinned]`).
- **Errors via `AppError`** (`AppResult<T>` + `?`), not `Result<_, String>` + `.map_err`.
- **Shared runtime state** is passed as the single `Arc<RuntimeState>`, not as loose atomics/params.
- New commands: write them in the right `commands/<section>/` file and they're auto-exported by the `pub use` in `commands/mod.rs` — but still remember to add the line to `invoke_handler!` in `lib.rs` (missing it is a runtime "command not found", not a compile error).

### Design principle: build for the future (modularity first)

**Non-negotiable goal: adding one feature must NOT break ten things.** The owner
has lived the opposite pain (a small change touched 10 scattered spots); every
design decision must avoid recreating that. The project will grow with new
macro-sections (Tools, Design, …) and their tools: write code that accepts them
"drop-in", not code that has to be reorganized every time.

Practical rules:
- **Decouple by domain/section.** New code goes in its own module/folder
  (`commands/<section>/`, `db/<domain>.rs`, dedicated hooks/components), not
  bolted onto the nearest file. A new section = an isolated folder.
- **One single source of truth.** No values/types/lists duplicated and kept in
  sync by hand (this is the #1 cause of "ten things break"). Prefer exhaustive
  enums, named structs, registries/tables that both the dispatch and the UI read
  from. If a piece of data lives in two places, merge it.
- **Make the compiler work for you.** Type things strongly (enums, structs, TS
  unions) so that adding or changing something produces compile errors that list
  every spot to update, instead of runtime bugs discovered at random.
- **A bit of extra structure is OK; speculative abstraction is NOT.** For this
  project it is right to invest in clean boundaries and extension points *even
  before* they are strictly needed, because the growth is declared and concrete.
  The line NOT to cross: abstractions for things with **a single**
  implementation, or for scenarios that won't arrive (e.g. a `Repository` trait
  to abstract the one SQLite DB, or "just in case" flexibility). The control
  question is "does this serve the project's real growth?" — if yes, do it even
  if it feels early; if it's only "might be useful in theory", don't.
- **Refactor with behaviour unchanged, then verify.** When you reorganize, do
  NOT change behaviour in the same step: move/decouple, verify everything is
  green (`cargo test` + `npx tsc --noEmit`), then change logic in a separate
  step if needed. Tests are the safety net that lets you refactor fearlessly;
  when you add non-trivial logic, add the test too.
- **Surgical changes.** Every changed line must trace to the request; don't
  "improve" unrelated adjacent code. Modularity is preserved this way too: the
  less surface you touch, the less breaks.

### Notable behaviors

- **Sensitive masking**: sensitive clips shown masked (email start+domain, token/IBAN prefix+last4); full content stays in DB and is copyable; eye toggle to reveal.
- **Dedup move-to-top**: re-copying existing content bumps it to top, no duplicate.
- **Hotkey** configurable (default `Ctrl+Shift+V`); **close-to-tray** + **autostart default OFF**.
- **Images**: captured as PNG, thumbnail in card, click → preview lightbox, dedicated "Immagini" sidebar section.
- **Tags**: auto + manual; per-tag color via native color picker (sidebar dot and card chips). In the sidebar tags live under a `Tags` **container category** (like `Groups`): the row is always shown when ≥1 tag exists, selecting it filters to all tagged clips and expands the tag rows below as sub-entries with an L-guide; each selected tag's own `Pinned` is a third-level sub-sub-entry. The single vertical ActiveBar stays anchored to `Tags`.
- **Sidebar macro-sections**: the sidebar is a stack of collapsible sections (`Clipboard` / `Tools` / `Design`) — accordion (one open at a time, click the open one to close). `App.tsx` holds `activeSection` (`Section | null`) and `<main>` routes on it: clipboard UI when `clipboard`, `<ToolsSection>` when `tools`, placeholder when `design`. `Tools` is live (a dashboard of tool cards driven by `tools/registry.ts`); `Design` is still a placeholder.
- **Per-section accent**: each macro-section has an accent color defined **once** in `index.css` as `[data-section="…"]{--accent: …}`. The app root carries `data-section` (global accent that cross-fades on switch); the sidebar header badges also carry `data-section` to show their fixed color. The Tailwind `accent-*` utilities read `var(--accent)`. No accent triple is duplicated in TS.

### Roadmap

See `IMPROVEMENTS.md` for done/pending items and next candidates.
