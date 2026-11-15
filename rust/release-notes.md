## Installation

1. Download `MyDownloader-…-win-x64.zip` below and extract it to a permanent folder (e.g. `C:\Users\<you>\MyDownloader`). No admin rights needed.
2. Run `MyDownloader.exe` once: the app registers itself with Chrome / Edge / Brave / Cốc Cốc.
3. Open `chrome://extensions` (or `edge://extensions`, `coccoc://extensions`), turn on **Developer mode**, click **Load unpacked** and select the `extension` folder next to `MyDownloader.exe`.

Torrent / Magnet / FTP need `aria2c.exe` next to `MyDownloader.exe` or on `PATH`.

## Updating

From 2.x: **Settings → Check for updates → Update now** (the app downloads the update, replaces its files and restarts), then click ⟳ (reload) on the extension card in `chrome://extensions`. To update by hand: quit MyDownloader (right-click the tray icon → Exit), extract the new version over the old folder and start it again.

**Coming from 1.x (Electron):** 1.x can't update itself to 2.x, so download the zip above. Your settings and download list are kept (`%APPDATA%\mydownloader`). Uninstall 1.x from Settings → Apps, remove the old extension and install it again from the new `extension` folder.
