# Improvements roadmap — Clipboard

Status: ☐ todo · ⏳ in progress · ✅ done

## 🔑 High impact (real clipboard manager experience)

- ✅ **Keyboard navigation** — ↑↓ to scroll (highlighted selection synced with mouse), `Enter` and `1-9` to copy the selected clip with a "Copied" animation (even when a clip bumps to the top). Auto-paste (simulated Ctrl+V + window close) was **dropped by UX choice**: Enter now just copies.
- ✅ **Skip password managers** — the watcher respects the `ExcludeClipboardContentFromMonitorProcessing` and `CanIncludeInClipboardHistory` clipboard formats (DWORD value read for the latter to follow Microsoft's semantics). Always-on, no UI.
- ✅ **Custom icon** — minimalist clipboard outline + filled emerald clip on dark squircle background.

## 🔒 Privacy hardening

- ✅ **Encryption at rest** — SQLCipher (full DB) + AES-256-GCM for PNGs.
  Master key generated at first launch (32 bytes) and stored in `key.bin`
  encrypted via Windows DPAPI (user scope). Automatic migration from
  legacy plaintext DB (backup in `clips.plain.bak`) and plaintext PNGs at
  first launch. Images served to the frontend via dedicated command
  `read_image_bytes` + Blob/ObjectURL instead of `asset://`. Visible
  tradeoff: removed "Open location" for images (PNGs on disk are opaque).
- ✅ **Auto-delete of sensitive clips**: "Never save them" toggle + TTL in minutes (sweep every 60s, doesn't touch pinned clips). Also, if the toggle is on and a sensitive value is re-copied, the existing one in history is removed too.
- ✅ **Granularity of sensitive categories** — multi-checkbox (email/IBAN/cards/tokens) to decide which types are subject to don't-save and TTL. The UI masking remains always active on all detected sensitive values, regardless of the choice.
- ✅ **No HTML/RTF for sensitive clips** — if the categorizer marks the text as sensitive, the watcher discards HTML/RTF: markup may leak provenance/context next to the cleartext.
- ☐ ~~Panic hotkey~~ — dropped for UX (accidental-press risk).
- ☐ ~~Optional passphrase~~ — dropped: too high a cost (typed at every launch, no recovery if forgotten) for the benefit on a personal app.

## ✨ Spec / features completion

- ✅ **Edit clip content** (pencil on hover → inline editor; on save it re-categorizes type and sensitivity).
- ✅ **Drag & drop reordering of pinned clips** — built on `@dnd-kit/sortable` (no more HTML5 drag image, smooth FLIP animations, optimistic update at drop to avoid the post-release jitter).
- ✅ **Tag colors** — native color picker (full wheel) both from the sidebar dot and from the chip dots on cards; deterministic fallback from tag name.
- ✅ **More content types**: **files copied** (CF_HDROP) + **HTML** (CF_HTML read/written via WinAPI) + **RTF** (CF_RTF). Badge on the card showing which formats are present (HTML / RTF / HTML+RTF), "Copy as plain text" button to paste without formatting.
- ✅ **"Paste as plain text"** — dedicated button on clips with HTML that puts only CF_UNICODETEXT (no formatting).
- ✅ **Group by date** in history (Pinned / Today / Yesterday / This week / This month / Older). Thin headers between groups.
- ✅ **Multi-selection** + bulk delete — Ctrl/Alt+click (configurable) to enable, Shift+click to extend the range, selection mode with checkboxes and action bar (Delete, Pin/Unpin, Add tag).
- ✅ **Export / Import** of history in JSON (images inlined in base64). "Merge" mode (skip duplicates by hash) and "Replace" mode (wipe + reinsert).
- ✅ **Shared tag picker**: popover with search + list + "Create new" both on the card (+tag) and in the multi-selection bar.
- ✅ **Pinned tags** in sidebar: star to pin/unpin, "Pinned" section above "Tags".
- ✅ **Self-write guard** — when the app itself writes a clip to the clipboard (copy from history), the watcher consumes the matching event and doesn't auto-bump it to the top. No more continuous reordering when using the history.

## 🎨 Polish & distribution

- ✅ **Keyboard badges 1-9** on the first 9 cards (visual reminder of the shortcut).
- ✅ **Open location** in hover actions for **files only** (images are encrypted on disk, opening Explorer wouldn't help). Uses `explorer.exe /select,"path"` with proper quoting.
- ✅ **Search highlight** in previews: query occurrences highlighted in yellow.
- ✅ **Reduced thumbnails** saved as `<hash>.thumb.png` (200px on longest side, bilinear resize). Backfill at startup for existing images. Card loads the thumb; full-screen preview uses the original PNG.
- ✅ **GUI overhaul** — brand header (logo + wordmark, collapsible chevron), glass effect on sidebar/cards (backdrop-blur), emerald glow on selected/copied, radial green gradient background, breathing room (gap-2.5 lists, p-4 sidebar).
- ✅ **Micro-animations everywhere** — card hover lift, new-clip slide-in, "Copied" with back-out bounce, modals fade+scale in/out (`useExitAnimation` hook + state machine), sidebar ActiveBar that slides between active items, multi-select checkbox pop, tag-picker scale, L-guide drawn for the Pinned sub-entry (vertical then horizontal, reverse on exit), View Transitions reserved as a fallback. All respect `prefers-reduced-motion`.
- ✅ **Onboarding at first launch** — overlay with brand, configured hotkey shown, 4 tips (open shortcut, keyboard nav, pin & tags, encryption + masking). Persisted via `onboarded` boolean in the store.
- ✅ **Full English UI + README**.
- ✅ **Auto-update** (`tauri-plugin-updater`) + **GitHub Actions CI**. Silent check on launch; when an update is available a green glowing "Update to vX.Y.Z" button appears at the bottom of the sidebar. Clicking it downloads the signed bundle (minisign), verifies it, installs, and relaunches. Releases are produced by `.github/workflows/release.yml` on `v*` tag push: builds on `windows-latest` with Strawberry Perl (SQLCipher/OpenSSL), signs MSI + NSIS with `TAURI_SIGNING_PRIVATE_KEY` secret, generates `latest.json` manifest, publishes a GitHub Release with all artifacts.
- ☐ **Code signing** (removes SmartScreen warning — needs a paid certificate).

## 🧰 Code quality

- ✅ **More tests** — backend coverage from 11 → **48 tests** (db, categorizer with edge cases, images, crypto round-trip and wrong-key reject, in-place encryption migration, watcher `consume_self_write` extracted as a pure function). The watcher and Tauri commands are partially covered through their pure helpers; the I/O parts (arboard, clipboard-master, Tauri State) remain hard to test without an integration harness.
- ✅ **UI errors**: toast system (ToasterProvider + useNotify) with error/success/info types, slide-in from the right + slide-out, auto-dismiss after 4.5s, manual close. Used in tag rename; extendable to any async handler.

---

### Done (2026-05-28)
- ✅ Custom icon → simplified outline+clip
- ✅ Edit clip content
- ✅ Tag colors (native picker from sidebar and chips)
- ✅ Keyboard navigation (Enter/1-9 = copy) + "Copied" feedback
- ✅ Skip password managers (respects exclusion formats)
- ✅ Sensitive clip auto-delete (toggle + TTL + remove on re-copy)
- ✅ Sensitive category granularity (email/IBAN/cards/tokens multi-checkbox)
- ✅ Settings split into tabs (General / Security / Reset), stable height
- ✅ Group by date in history
- ✅ Drag & drop reorder of pinned clips (HTML5 → dnd-kit)
- ✅ Multi-selection with action bar and configurable modifier
- ✅ Export / Import JSON with native dialog (merge / replace)
- ✅ Reduced thumbnails for images (bilinear resize + backfill)
- ✅ Shared tag picker + pinned tags in the sidebar
- ✅ Tag polish: rename (double click), bulk remove tag, sort by most used
- ✅ Extended backend tests (47 unit tests)
- ✅ Files copied from Explorer (CF_HDROP read/write)
- ✅ Toast system for UI errors
- ✅ HTML capture (CF_HTML) + "Copy as plain text" button
- ✅ RTF capture (CF_RTF)
- ✅ 1-9 keyboard badges, Open location, Search highlight
- ✅ Encryption at rest (SQLCipher + AES-GCM PNG, DPAPI master key)
- ✅ GUI overhaul (brand, glass, animations, sidebar restructure)
- ✅ Self-write guard (no more auto-bump when copying from history)
- ✅ Onboarding at first launch
- ✅ Full English i18n (UI + README + tray + error messages)
- ✅ Auto-update via `tauri-plugin-updater` + GitHub Actions release workflow
- ✅ First public release: **v0.1.0** with signed MSI + NSIS bundles

### Done (2026-05-29)
- ✅ Renamed app identifier `com.matte.clipboardmanager` → `com.clipboardmanager.app` (neutral, no personal name) + bump to v0.2.0
- ✅ Stats panel (Settings tab): total clips, pinned, images, sensitive, tags + disk usage (encrypted DB + images). New `get_stats` command, `Db::stats()` with test
- ✅ More sensitive categories: Codice Fiscale (IT), US SSN, private/SSH keys, JWT, crypto addresses, mask-only strings — beyond email/IBAN/card/token (54 backend tests total)
- ✅ Settings → About panel: app version (runtime `getVersion`), GitHub repo link (opener), license
- ✅ Proprietary license (all rights reserved) + real README screenshots
- ✅ "Copy image as file" — puts an image clip on the clipboard as CF_HDROP (decrypted to a cleaned temp dir) so it can be pasted into a folder with Ctrl+V; button on the card and in the preview
- ✅ Fuzzy search across the whole history (content, preview, tags, OCR text), typo-tolerant and ranked
- ✅ OCR on images via Windows.Media.Ocr (no external deps, offline) — search works inside screenshots; background OCR on capture + startup backfill; toggle in Settings → Security (on by default)
- ✅ Quick actions on clips: open links in the browser, open files with the default app (`open_path` via ShellExecuteW). Email/mailto dropped (depends on an unpredictable OS default handler)
- ✅ "Paste as" / transforms — "Copy as…" popover on text clips (UPPERCASE / lowercase / trim / slugify / pretty JSON, JSON disabled when the content isn't valid JSON) and on image clips (base64 / markdown `![](data:…)`). Pure transforms in `transforms.rs` (7 unit tests, 61 total); `copy_transformed` command reuses the self-write guard and never mutates the saved clip
- ✅ **Color swatches** inline before every CSS color value (hex/rgb/hsl) in text clips, alongside the search highlight. Color-only clips get a "Color" tag (categorizer) instead of "Code"/"Numbers"; its sidebar dot defaults to neutral white so it never clashes with the content swatch
- ✅ **Drag clips onto sidebar tags** to tag them — single card or multi-selection (bulk). Single shared `DndContext` in App spanning sidebar + list; preserves pinned reorder, click-to-copy, multi-select, 8px activation. Custom collision detection (overlay-rect centered on cursor) so a tag activates only when the card visually overlaps it. Overlay centered on cursor + cursor hidden, real image thumbnail / file basename / stacked-card preview with count badge. Tall images clipped to a fixed max-height in the card. Animations: tag glow pulse on hover, confirm pop, ghost flying into the tag, delayed chip pop — all respect reduced-motion
- ✅ **Image size limit** — optional cap (off by default) in Settings → Security. Measured on the compressed PNG size (MB); images over the limit are skipped (they stay on the Windows clipboard). New `max_image_bytes` atomic + `apply_max_image_bytes` command; `images::save_png_bytes` avoids re-encoding
- ✅ **Responsive Settings dialog** — fixed-height scrollable body so the modal stays put when switching tabs; tabs wrap instead of overflowing; modal capped at `max-h-[85vh]`
- ✅ **History limit default 200 → 5000** — `DEFAULT_MAX_HISTORY` and `list_clips`' `DEFAULT_LIMIT` (now points at it, so the UI loads everything kept, not just 200). Existing user-set values are preserved
- ✅ **Syntax highlighting** for code clips — `CodeBlock` (highlight.js "common" bundle + github-dark theme) on clips tagged "Code", shown when no search query is active (avoids clashing with the yellow match highlight). hljs output is escaped, no XSS from clipboard content

- ✅ **Merge clips by drag (groups)** — drag a non-pinned card onto another same-type card → confirm popup → they fuse into a "group" card. New `clip_items` table (one group → N items), `content_type='group'`, `merge_clips` (transactional, inherits target's pin, unites tags). Group card shows an aggregate preview (thumbnail grid for images, compact list for text/files); click opens a detail view with per-item copy and editable labels on text items; image items open a lightbox. Sidebar "Groups" section with Images/Files/Text sub-filters. Export/Import v2 serializes group items (images inlined b64). Group PNGs cleaned up on delete; startup orphan cleanup covers them too.

- ✅ **Sidebar macro-sections (Clipboard / Tools / Design)** — first step toward turning the app into a small dev toolbox. The sidebar is now a stack of collapsible section headers (reusable `SectionHeader` + `SectionBody`, same grid-rows animation as the old brand header). Accordion behaviour: opening one closes the others; clicking the open one closes it (`activeSection: Section | null` lifted to `App.tsx`). `<main>` became a router: it shows the clipboard (search + `ClipList`) only when `activeSection === "clipboard"`, otherwise a centered placeholder ("Tools"/"Design" coming soon, or "Select a section" when all closed). Keyboard nav (↑↓ / Enter / 1-9) is guarded to the clipboard section only. Tools and Design are placeholders for now (Port Killer, Pixel Perfect, project launcher to come). Single scroll container over the three sections; `UpdateButton` stays pinned at the bottom outside it.

- ✅ **Tags as a category** — tags now behave exactly like the `Groups` category instead of an always-visible flat list. New `MainKind: "tags"` container row (always present when ≥1 tag exists, hidden otherwise): selecting it filters the list to all tagged clips and expands the individual tags below; choosing another category collapses them again. Three-level hierarchy with a single vertical ActiveBar anchored to "Tags": the tag rows (`Code`, `Color`, …) are sub-entries with an L-guide (sized like the categories' "Pinned"), and each selected tag's own "Pinned" is a third-level sub-sub-entry (more indented/smaller, with its own L-guide). Tag rows keep all their functions (always-left color swatch, star to pin the tag, double-click rename, drag-to-tag drop). Removed the separate `TagActiveBar` — the nav's `ActiveBar` now drives the tag highlight too (`filter.name` added to its deps). Sort A-Z / by count moved into the "Tags" header.

### Done (2026-05-30) — codebase audit & refactor

Multi-agent audit (security / efficiency / code quality) followed by a sequence of behaviour-preserving refactors. Goal: make the codebase scalable so small changes stay small. Verified at every step with `cargo test` (83 passing) + `npx tsc --noEmit`. Audit report kept locally in `AUDIT.md` (gitignored).

- ✅ **Security: import path-traversal fixed** — a malicious export file with an `image_filename` like `..\..\Windows\x.png` could write outside `images/`. New `safe_image_filename` keeps only the final file name; 4 unit tests. (Crypto/SQL-injection/FFI all audited clean.)
- ✅ **Performance: N+1 tags eliminated** — `Db::collect` loaded tags with one query *per clip* (up to 5000 on every `clips-changed`). Now a single batched query grouped in memory (`tags_for_clips`). 10–50× faster at full history.
- ✅ **Performance: SQLite PRAGMAs** — `synchronous=NORMAL` (WAL-recommended, fewer fsyncs), `cache_size=-8000`, `temp_store=MEMORY`.
- ✅ **Clippy cleanup** — 17 → a handful of warnings (the rest auto-fixed or fixed by hand; the dead `write_text_with_html` annotated, not deleted).
- ✅ **Strong types: `ContentType` enum** — replaced the bare `"text"`/`"image"`/`"group"` strings (~19 sites) with a Rust enum (serde lowercase + `FromSql`/`ToSql`, so SQLite/JSON are unchanged) and a TS union. Adding a kind now fails compilation at every `match`/`switch` to update.
- ✅ **Strong types: `TagInfo`/`Tag`** — replaced the anonymous tuple `(String,i64,Option<String>,bool)` / `[string,number,string|null,boolean]` (8 frontend sites) with named structs.
- ✅ **Shared `Arc<RuntimeState>`** — the watcher's `start(...)` went from 11 loose params to taking the single shared state; `lib.rs` no longer clones 8 atomics by hand. Adding a setting no longer touches the watcher signature.
- ✅ **Split `commands.rs`** (~980 lines) into `commands/clipboard/{clips,tags,io}` + `commands/system/{settings,shell,stats}`, re-exported via `pub use` (so `lib.rs`'s `invoke_handler!` is untouched). Ready to add `tools/`/`design/` sections.
- ✅ **Split `db.rs`** (1583 lines) into `db/{mod,clips,tags,groups,tests}` — multiple `impl Db` on one struct, shared helpers `pub(crate)` in `mod.rs`.
- ✅ **Typed errors: `AppError`** (`thiserror`) — all commands return `AppResult<T>`; `#[from]` for rusqlite/io/serde_json/base64, `From<String>` for domain messages, `impl Serialize` so the frontend still gets a plain error string. Removed the ~50 repeated `.map_err(|e| e.to_string())`.
- ✅ **Frontend test harness** — Vitest + React Testing Library + jsdom (dev-only). `src/test/setup.ts` (jest-dom + `scrollIntoView` stub), `src/test/fixtures.ts` (`makeClip`/`makeTag`). `App.test.tsx` mocks the Tauri layer (mostly `lib/api.ts`, since all invoke goes through it) and covers rendering, copy (click + Enter) and search. Scripts `npm test` / `npm run test:watch`. Fills the "no frontend tests" gap from the audit and gave the safety net for the hook extraction below.
- ✅ **`App.tsx` god component split into custom hooks** — 885 → ~600 lines, behaviour unchanged (verified by the new tests + manual drag&drop check). Extracted `useClipboardData` (clips/tags, reload, `clips-changed`, "Copied" flash), `useBulkSelection` (multi-select + bulk ops), `useKeyboardNav` (ESC + ↑↓/Enter/1-9/Del), `useClipDnd` (the whole drag&drop: collision detection, overlay, drop-on-tag/merge, pinned reorder, flying ghost). App.tsx is now an orchestrator that composes them.

### Done (2026-05-31) — Tools section + style audit of the new code

- ✅ **Tools macro-section is live** — the sidebar's `Tools` section is now a real dashboard. `src/tools/registry.ts` is the single source of truth (`ToolDescriptor`: id/label/description/icon-component/component); `ToolsSection` renders a card grid with **favorites** (star) and **drag-to-reorder** (own `DndContext`), persisted in `settings.json` via `useToolPrefs` (order reconciled against the registry, so adding a tool drops it in at the end and removing one leaves no orphans). Opening a card shows the tool full-screen with a back button. ~19 tools shipped: **Port Killer** (Rust backend `commands/tools/ports.rs`: lists listening TCP IPv4/IPv6 ports via `GetExtendedTcpTable`, resolves process name/description, kills by PID — FFI confined, errors via `AppError`), plus all-frontend converters/utilities (JSON formatter, YAML↔JSON, .env↔JSON, HTML entities, Base64/URL, case, slug, JWT decoder, Regex tester, Cron parser, Timestamp, Number base, Generators, Fake data, QR code, Hash compare, Markdown preview).
- ✅ **Per-section accent system** — each macro-section (Clipboard/Tools/Design) has an accent color defined once in `index.css` (`[data-section]{--accent}`); the app cross-fades it on switch. Tailwind `accent-*` utilities read the CSS var.

- ✅ **Style audit of the Tools code + fixes** (third multi-agent pass, kept in `AUDIT.md`). The tools worked but systematically violated the project's #1 principle (single source of truth): the same snippets were copy-pasted across many tools, with drift already starting. Extracted the shared pieces and migrated every call site, behaviour-preserving, verified with `tsc` + 25 Vitest tests + 83 Rust tests + prod build:
  - `hooks/useCopy` (clipboard write **with** error toast — the 14 tools had no `try/catch`, a rejected `writeText` was a silent unhandled rejection) → migrated all 14.
  - `tools/shared/`: `Toggle`, `ToolButton` (neutral/accent, padding decided by label vs icon-only — kills the `px-2.5`/`p-2` drift), `OutputPane` + `INPUT_TEXTAREA_CLASS`, `hash.ts` (one `HASH_ALGOS`/`HashAlgo` — Generators and HashCompare had **divergent** lists; HashCompare now also exposes SHA-384), `codec.ts` (`base64UrlToText` shared by Base64Url + JWT), `ui.ts` (`tabBtnClass` for the segmented controls in 7 tools).
  - `components/ConfirmDialog` — the confirm modal was copied 1:1 between App's merge-prompt and PortKiller; now one component.
  - `lib/format.ts` gained `humanBytes` (was triplicated across JsonFormatter/HashCompare/Settings).
  - Strong types: `hashBytes(algo: HashAlgo)` (was `string` + two `as` casts).
  - **Bug fixed — EnvJson round-trip**: multiline values (e.g. PEM keys) were silently corrupted (newline broke the line-based parser). Now `\n`/`\r` are escaped/unescaped symmetrically inside double quotes; `parseEnv`/`toEnv` extracted to `tools/env-json/env.ts` with a round-trip test.
  - **A11y — ToolsSection**: the sortable wrapper spread dnd-kit's `role`/`tabIndex` over `ToolCard`'s own `role="button"` → two nested buttons / two tab stops. Now drops role/tabIndex, keeps the aria-*.
  - **Simplicity — NumberBase**: removed a `try/catch` guarding a throw the regex already makes impossible.

### Next candidates (not yet done)
- **Quality tooling** — no ESLint, no CI quality-gate (CI runs only on `v*` release tags; the Rust + frontend tests + `tsc` never run on push/PR). Vitest is set up, but not wired into CI yet.
- **More frontend tests** — the harness covers App.tsx basics; add tests for the extracted hooks (esp. `useBulkSelection` range select) and key components (ClipCard, Sidebar). Drag&drop stays manual (hard to simulate in jsdom).
- **List virtualization** — `@tanstack/react-virtual` (approved); with 5000-clip default the whole list is in the DOM and every image invokes the backend even off-screen. The biggest remaining runtime win; pairs with frontend memoization.
- **Frontend handler hooks** — App.tsx still holds the ~15 `handle*` action callbacks (copy/pin/delete/tag/transform/…); could become a `useClipActions` hook for an even thinner App. Lower priority than the above.
- **More Tools** — the section and its registry are live; adding a tool is `tools/<name>/<Name>.tsx` + one registry entry. Candidates: colour-picker/converter, diff for JSON, UUID/ULID inspector, etc.
- **Design section content** — Pixel Perfect overlay (on-screen ruler + magnifier color picker), local palette.
- **Dev project launcher** — reads a local config and opens VS Code + terminal + browser on the dev port via system APIs. Section not decided yet (Tools, or a dedicated one).
- **Multi-copy in group detail** — select several items and copy them together; deferred because the Windows clipboard only holds one image.
- **prune_to_limit PNG cleanup** — pruned group PNGs are only removed by the startup orphan sweep, not immediately. Minor (temporary disk only).
- Code signing (paid certificate → removes SmartScreen warning on install)

### Dropped (cost/benefit on a personal app)
- ~~Optional passphrase~~ — typed at every launch, no recovery if forgotten.
- ~~Drag-out of a clip to an external app~~ — needs fragile low-level OLE drag from a webview; unreliable.
