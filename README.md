# 🚀 MyDownloader

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/ductruongvu23/mydownloader?style=for-the-badge&logo=github&color=0284c7)](https://github.com/ductruongvu23/mydownloader/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-3b82f6?style=for-the-badge&logo=open-source-initiative&logoColor=white)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-egui_0.32-B7410E?style=for-the-badge&logo=rust&logoColor=white)](rust/)

**A lightweight multi-threaded download manager for Windows, with a browser extension that catches downloads and media.**

</div>

---

## 🦀 MyDownloader 2.0 — rewritten in Rust

Version 2.0 replaces Electron with Rust + egui: **1 process, ~94 MB RAM** (Electron 1.x: 4 processes, ~284 MB, measured on the same machine).

- **The extension talks to the app over native messaging** (`mydownloader-host.exe`) instead of HTTP on port 6801: web pages can no longer call into the app, and there is no port scanning or token anymore.
- **Links are caught even when the app is closed**: the browser starts the host, which launches the app hidden in the tray and hands the link over.
- **Clicking ✕ minimizes to the tray and downloads keep running**; quit from the tray menu. After a hard stop (crash, shutdown), downloads resume where they left off on the next start.
- Shares its data with 1.x (`%APPDATA%\mydownloader`: `settings.json`, `tasks.json`); the log is `mydownloader.log` in the same folder.

---

## 🌟 Features

### 🚀 Download engine
- Probes Range support before downloading and falls back to a single connection when the server doesn't support it.
- Adaptive connection count based on file size (1–32 connections per file, set in Settings); connections that finish early take over work from slow ones.
- Network errors retry only the failed segment (backoff, up to 8 times); 30 seconds without data counts as a stall and reconnects.
- Progress is saved to `<file>.part.json`, so after pausing or closing the app the download resumes where it stopped.
- The queue runs 1–20 downloads at once, with a global speed limit shared by all of them.
- Batch downloads from a pattern, e.g. `http://x/img[001-100].jpg`.
- Torrent / Magnet / FTP through `aria2c.exe` (not bundled: put it next to `MyDownloader.exe` or on `PATH`).

### 🎬 Browser extension (`extension/`, Manifest V3)
- Catches browser downloads: pauses the browser's copy, asks in the app, and cancels it only when you choose to download with MyDownloader.
- Captures real media streams (`.mp4`, `.webm`, `.m3u8`, `googlevideo.com`...) via `webRequest`; extracts MP4 streams from YouTube and TikTok.
- Floating download button on playing videos; context menu to download links, images, video/audio and selected links.
- Sends the source page's Referer, Cookie and User-Agent so CDNs don't block the download (403).

### 🎨 Interface
- Dark / light / system theme, Vietnamese / English.
- Filter by status, search, select several downloads to pause / resume / remove; paste a link (Ctrl+V) to add it quickly.
- Windows notifications when a download finishes or fails; optional start with Windows (hidden in the tray).

---

## 📥 Installation

Download `MyDownloader-<version>-win-x64.zip` from [Releases](https://github.com/ductruongvu23/mydownloader/releases), extract it to a permanent folder and run `MyDownloader.exe` once: the app registers its native messaging host with Chrome / Edge / Brave / Cốc Cốc / Chromium (it only writes to `HKCU`, so no admin rights are needed).

### 🔌 Installing the extension

1. In MyDownloader: **Settings** → **📂 Open extension folder** (the `extension` folder next to `MyDownloader.exe`).
2. Open `chrome://extensions` (`edge://extensions`, `coccoc://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder from step 1.

The extension has a fixed `key` in `manifest.json`, so its ID is always `pialejfhnnjfpkmlgkogbhphaeomhafe`, wherever the folder lives. If you installed the 1.x extension, remove it and install again with the steps above.

### 🔄 Updating

**Settings** → **Check for updates** → **Update now**: the app downloads the new zip, replaces the files in its folder and restarts itself. Then click ⟳ on the extension card in `chrome://extensions` so the browser loads the new extension. To update by hand: quit MyDownloader (right-click the tray icon → **Exit**), extract the new version over the old folder and start it again.

Version 1.x (Electron) can't update itself to 2.x: download the zip as above; your settings and download list are kept. Uninstall 1.x from Settings → Apps if you like.

---

## 🛠️ Development

Requires [Rust](https://rustup.rs/) and [MSYS2](https://www.msys2.org/) UCRT64 with `gcc` (`pacman -S mingw-w64-ucrt-x86_64-gcc`). The dev machine has no Windows SDK, so the project uses the GNU toolchain, selected automatically by `rust/rust-toolchain.toml`; the linker `C:/msys64/ucrt64/bin/gcc.exe` is set in `rust/.cargo/config.toml`. Run `cargo` inside `rust/` so both files take effect.

```bash
cd rust
cargo test --release
cargo build --release
```

Run `rust/target/release/MyDownloader.exe` once to register the native host; when started from `target/`, the app finds the `extension/` folder at the repo root.

### 📦 Packaging

```bash
powershell -ExecutionPolicy Bypass -File rust\package.ps1
```

Builds the release, then creates `rust/dist/MyDownloader/` (`MyDownloader.exe`, `mydownloader-host.exe`, `extension/`) and `rust/dist/MyDownloader-<version>-win-x64.zip`. The version comes from `rust/Cargo.toml` and is synced to `extension/manifest.json`. `resources/icon.ico` is embedded into both executables at build time (`rust/build.rs`, using MSYS2's `windres`). If you get *Permission denied*, quit the MyDownloader running from `rust/target/release` and run it again.

### 🚢 Publishing to GitHub Releases

```bash
powershell -ExecutionPolicy Bypass -File rust\package.ps1 -Release
```

Packages, then creates Release `v<version>` with the zip attached and the notes from `rust/release-notes.md` (requires the [GitHub CLI](https://cli.github.com/), logged in with `gh auth login`). The script only publishes when `rust/`, `extension/` and `resources/` have no uncommitted changes and the current commit is pushed; the tag is created on GitHub at that exact commit. Running it again for the same version only replaces the zip. The in-app updater (`rust/src/update.rs`) reads `releases/latest`: it compares `tag_name` with the running version and downloads the `MyDownloader-…-win….zip` asset, so don't change the tag format or the zip name. For each new version, bump `version` in `rust/Cargo.toml`, commit, push and run the command above.

---

## 🏗️ Project Structure

```
mydownloader/
├── rust/                     # Rust app (egui, tokio, reqwest)
│   ├── src/
│   │   ├── main.rs           # Startup: single instance, native host registration, start with Windows
│   │   ├── app.rs            # Core shared by the UI and IPC, tray icon
│   │   ├── ui.rs             # egui interface
│   │   ├── update.rs         # Self-update from GitHub Releases
│   │   ├── ipc.rs            # Named pipe receiving commands from the native host
│   │   ├── native.rs         # Native messaging host registration (HKCU), extension folder lookup
│   │   ├── settings.rs       # settings.json
│   │   ├── util.rs           # Data folder, logging, Win32 helpers
│   │   ├── engine/           # http.rs (multi-connection downloads), mod.rs (queue), aria2.rs, batch.rs
│   │   └── bin/host.rs       # mydownloader-host.exe: native messaging host
│   ├── build.rs              # Embeds the icon into the executables
│   ├── package.ps1           # Packaging / publishing to GitHub Releases
│   └── release-notes.md      # Notes published with each Release
├── extension/                # Chrome/Edge extension (Manifest V3)
│   ├── manifest.json         # fixed key -> ID pialejfhnnjfpkmlgkogbhphaeomhafe
│   ├── background.js         # Download capture, media sniffer, native host calls
│   ├── content.js            # Floating download button, YouTube / TikTok stream extraction
│   └── popup.html / popup.js # App connection status, quick link sending
├── resources/                # icon.ico, icon.png, tray.png
└── scripts/                  # gen-icons.cjs, setup-ltsc (Windows LTSC environment)
```

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE).
