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

### Next candidates (not yet done)
- **Syntax highlighting** for code clips in the preview (frontend-only polish).
- **Image size limit** — optional cap so a huge screenshot doesn't bloat the encrypted store (skip/limit images over N MB).
- **List virtualization** — only worth it if the history limit is raised to thousands (with the default cap it isn't needed).
- Code signing (paid certificate → removes SmartScreen warning on install)

### Dropped (cost/benefit on a personal app)
- ~~Optional passphrase~~ — typed at every launch, no recovery if forgotten.
- ~~Drag-out of a clip to an external app~~ — needs fragile low-level OLE drag from a webview; unreliable.
