# TillDeals Hardware

Local hardware overview built with Electron. It reads CPU, memory, graphics, storage, mainboard, BIOS, network, temperatures, and other permitted local system details.

The app detects its operating environment. A native Windows build reads Windows hardware directly. When the development app runs inside WSL2, it queries the Windows host through PowerShell/CIM so the result is not limited to the WSL virtual machine. A native Linux build uses the local Linux data exposed by `systeminformation`.

## Build a Windows package

Prerequisites: Git, Node.js 20 or later, and npm.

```bash
git clone https://github.com/sould666/tilldeals-clientapp.git
cd tilldeals-clientapp
npm ci --no-audit --no-fund
npm run deploy:win
```

To test CPU and GPU sensor APIs in the current environment:

```bash
npm run test:sensors
```

The deploy script creates an unsigned, self-contained Windows x64 ZIP archive in `dist/`. It includes Electron and all application dependencies, so the target Windows PC does not need Node.js or npm.

Extract the archive to a normal Windows folder such as `C:\Users\<user>\Downloads\TillDeals Hardware` and run `TillDeals Hardware.exe`.

When building from WSL, do not run the packaged executable from `/home/...`. Copy the ZIP to a Windows path, extract it there, and launch it from Windows Explorer.

## Development

```bash
npm start
```

Runtime diagnostics are written to `%APPDATA%\TillDeals Hardware\runtime.log` on Windows.

The Settings and Manual Diagnosis views show local collection behavior and identify sensors that are unavailable because a driver or firmware does not expose them. Temperature values are reported only when a supported sensor returns a valid reading; they are never inferred from unrelated values.

Manual Diagnosis starts with the observed symptom rather than a hardware area. The app assigns the likely problem area after the symptom is selected and provides two modes: `Początkujący` uses short, safe checks in plain language, while `Profesjonalny` provides more technical evidence-gathering steps.