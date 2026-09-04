# TillDeals Hardware

Local Windows hardware overview built with Electron. It reads CPU, memory, graphics, storage, mainboard, BIOS, network, and other permitted local system details.

## Build a Windows package

Prerequisites: Git, Node.js 20 or later, and npm.

```bash
git clone https://github.com/sould666/tilldeals-clientapp.git
cd tilldeals-clientapp
npm ci --no-audit --no-fund
npm run deploy:win
```

The deploy script creates an unsigned, self-contained Windows x64 ZIP archive in `dist/`. It includes Electron and all application dependencies, so the target Windows PC does not need Node.js or npm.

Extract the archive to a normal Windows folder such as `C:\Users\<user>\Downloads\TillDeals Hardware` and run `TillDeals Hardware.exe`.

When building from WSL, do not run the packaged executable from `/home/...`. Copy the ZIP to a Windows path, extract it there, and launch it from Windows Explorer.

## Development

```bash
npm start
```

Runtime diagnostics are written to `%APPDATA%\TillDeals Hardware\runtime.log` on Windows.