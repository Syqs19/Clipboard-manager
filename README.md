# Clipboard

A **clipboard history manager for Windows**: local, encrypted, no accounts, no cloud. It saves everything you copy (text, links, images, files, HTML/RTF), organizes it by category and tag, and lets you bring it back with a keyboard shortcut.

> **Privacy-first**: zero network, zero telemetry, zero external services. Everything stays on your PC, encrypted at rest with your Windows key.

---

## What it does

- **Automatic clipboard history**: text, URLs, images (PNG), files copied from Explorer (CF_HDROP), HTML and RTF.
- **Quick open** with `Ctrl+Shift+V` (configurable). Navigate with `↑↓`, copy with `Enter` or `1-9` for the top nine clips.
- **Sidebar categories**: All, Images, Files, Text. Each category exposes a "Pinned" sub-entry to filter only the pinned clips of that type.
- **Manual and automatic tags** with custom colors, shared picker, drag & drop reordering of pinned items.
- **Sensitive data detected and masked** automatically: emails, IBANs, credit cards, tokens/JWTs. Toggle "Never save" and a configurable TTL for automatic deletion.
- **Password-manager friendly**: respects the `ExcludeClipboardContentFromMonitorProcessing` and `CanIncludeInClipboardHistory` clipboard formats, so KeePass / 1Password / Bitwarden clipboards never land in history.
- **JSON Export / Import** to move history to another machine.
- **Tray icon** with menu (Open, Pause capture, Settings, Quit).

## Privacy & security

The SQLite history file (`%APPDATA%\com.matte.clipboardmanager\clips.db`) is encrypted with **SQLCipher** (AES-256). Images on disk (`images/*.png`) are encrypted with **AES-256-GCM**.

The master key is generated on first launch and stored in `key.bin`, **encrypted via Windows DPAPI** (user scope): only your Windows account on the same machine can decrypt it. No password to remember.

Opening the files with DB Browser or a PNG viewer just shows random bytes. UI masking of sensitive contents is orthogonal to encryption — it protects against shoulder-surfing even when the data is decrypted.

**What it doesn't protect against**: malware running under your Windows account can call DPAPI just like you can. For that you'd need a manual passphrase (not yet implemented).

## Stack

- **Tauri 2.x** (Rust backend) + **React + TypeScript + Vite** + **Tailwind CSS v4**
- SQLite via **`rusqlite`** with the `bundled-sqlcipher-vendored-openssl` feature (engine + crypto compiled into the executable)
- Clipboard: **`clipboard-master`** (event-driven monitor) + **`arboard`** (read/write text/image)
- Drag & drop of pinned items: **`@dnd-kit`**
- Encryption: **`aes-gcm`** + **Windows DPAPI** (`CryptProtectData` / `CryptUnprotectData`)

## Install

Grab the installer from the [Releases](https://github.com/Syqs19/Clipboard-manager/releases) page (`.msi` or `.exe`) and run it. Code signing isn't set up yet, so Windows SmartScreen may show a warning — click "More info" → "Run anyway".

## Development

### Prerequisites

- **Node.js** 20+ and npm
- **Rust** (https://rustup.rs/) with the MSVC toolchain
- **Visual Studio Build Tools 2022** with the "Desktop development with C++" workload
- **Strawberry Perl** (needed to build OpenSSL/SQLCipher): `winget install StrawberryPerl.StrawberryPerl`

### Commands

| Task | Command |
|------|---------|
| Dev (hot-reload) | `npm run tauri dev` |
| Build installer | `npm run tauri build` → `.msi` + `.exe` (NSIS) in `src-tauri/target/release/bundle/` |
| Frontend type-check | `npx tsc --noEmit` |
| Rust backend tests | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Regenerate icons | `npm run tauri -- icon app-icon.png` |

### Architecture

Backend (`src-tauri/src/`):
- `lib.rs` — Tauri builder: opens DB, registers hotkey, builds tray, starts watcher, handles close-to-tray.
- `clipboard_watcher.rs` — background thread; captures text/URLs/images/files/HTML/RTF, dedup, prune, emits `clips-changed`.
- `categorizer.rs` — classifies text → tag (Link/Email/Numbers/Code/...) + sensitive flag.
- `db.rs` — SQLCipher (WAL); `clips`/`tags`/`clip_tags` tables; dedup by FNV-1a hash.
- `crypto.rs` — master key (DPAPI) + AES-GCM for PNGs.
- `commands.rs` — Tauri commands invoked from the frontend (list/search/copy/pin/...).
- `settings.rs` — shared runtime state.
- `tray.rs` — tray icon + menu.
- `images.rs` — encrypted PNG encode/decode + thumbnails.
- `win_clipboard.rs` — WinAPI for CF_HDROP, CF_HTML, CF_RTF and exclusion formats.

Frontend (`src/`):
- `App.tsx` — global state, keyboard navigation, watcher events.
- `components/` — Sidebar, SearchBar, ClipList, ClipCard, Settings, ImagePreview, TagPicker, Toaster, Onboarding.
- `lib/` — `api.ts` (invoke + listen wrapper), `format.ts` (masking + tag colors), `useImageUrl.ts` (loading encrypted images via Blob), `useExitAnimation.ts` (hook for exit animations).

Runtime data: `%APPDATA%\com.matte.clipboardmanager\` → `clips.db` (encrypted), `key.bin` (DPAPI), `images/*.png` (encrypted), `settings.json`.

## Scope choices

- **Windows-only** (deliberate — not cross-platform).
- **Dark mode only** (by choice).
- `Enter` / `1-9` = **copy only**, no auto-paste: the window stays open and the user runs `Ctrl+V` wherever they want.

## Roadmap

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for the detailed status. Pending:

- Auto-update via `tauri-plugin-updater` + GitHub Actions CI for releases
- Code signing (removes SmartScreen — needs a paid certificate)

## License

Personal, not yet publicly released.
