const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

const execFileAsync = promisify(execFile);

function getLogDirectory() {
  if (app.isReady()) return app.getPath('userData');

  const baseDirectory = process.platform === 'win32'
    ? process.env.APPDATA
    : process.env.XDG_STATE_HOME || process.env.HOME || process.cwd();
  return path.join(baseDirectory, 'TillDeals Hardware');
}

function writeLog(level, message, details) {
  try {
    const logDirectory = getLogDirectory();
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      level,
      message,
      details,
    });
    fs.mkdirSync(logDirectory, { recursive: true });
    fs.appendFileSync(path.join(logDirectory, 'runtime.log'), `${entry}\n`);
  } catch (error) {
    console.error('Could not write runtime log.', error);
  }
}

function errorDetails(error) {
  return { message: error?.message ?? String(error), stack: error?.stack };
}

writeLog('info', 'Main process module started.', { platform: process.platform, node: process.version });

let si;
try {
  si = require('systeminformation');
  writeLog('info', 'systeminformation module loaded.');
} catch (error) {
  writeLog('error', 'Could not load systeminformation.', errorDetails(error));
  throw error;
}

function isWsl() {
  return Boolean(process.env.WSL_DISTRO_NAME) || os.release().toLowerCase().includes('microsoft');
}

async function getWindowsHostSnapshot() {
  writeLog('info', 'Reading hardware from Windows host through WSL.');
  const script = String.raw`
    $ErrorActionPreference = 'Stop'
    $computer = Get-CimInstance Win32_ComputerSystem
    $operatingSystem = Get-CimInstance Win32_OperatingSystem
    $processor = Get-CimInstance Win32_Processor | Select-Object -First 1
    $memoryModules = @(Get-CimInstance Win32_PhysicalMemory)
    $graphics = @(Get-CimInstance Win32_VideoController)
    $baseboard = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
    $bios = Get-CimInstance Win32_BIOS | Select-Object -First 1
    $disks = @(Get-CimInstance Win32_DiskDrive)
    $filesystems = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 3')
    $network = @(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled = True')
    $battery = @(Get-CimInstance Win32_Battery)
    $audio = @(Get-CimInstance Win32_SoundDevice)
    [ordered]@{
      os = @{ distro = $operatingSystem.Caption; release = $operatingSystem.Version; platform = 'win32'; kernel = $operatingSystem.BuildNumber; arch = $operatingSystem.OSArchitecture }
      system = @{ manufacturer = $computer.Manufacturer; model = $computer.Model; version = $computer.SystemType }
      cpu = @{ brand = $processor.Name; physicalCores = $processor.NumberOfCores; cores = $processor.NumberOfLogicalProcessors; speed = [math]::Round($processor.MaxClockSpeed / 1000, 2); socket = $processor.SocketDesignation }
      memory = @{ total = [int64]$computer.TotalPhysicalMemory; available = [int64]$operatingSystem.FreePhysicalMemory * 1KB; active = [int64]$computer.TotalPhysicalMemory - ([int64]$operatingSystem.FreePhysicalMemory * 1KB) }
      memoryLayout = @($memoryModules | ForEach-Object { @{ size = [int64]$_.Capacity; type = $_.SMBIOSMemoryType; clockSpeed = $_.ConfiguredClockSpeed } })
      graphics = @{ controllers = @($graphics | ForEach-Object { @{ vendor = $_.AdapterCompatibility; model = $_.Name } }); displays = @() }
      baseboard = @{ manufacturer = $baseboard.Manufacturer; model = $baseboard.Product }
      bios = @{ vendor = $bios.Manufacturer; version = $bios.SMBIOSBIOSVersion; releaseDate = $bios.ReleaseDate }
      disks = @($disks | ForEach-Object { @{ name = $_.Model; model = $_.Model; size = [int64]$_.Size } })
      filesystems = @($filesystems | ForEach-Object { @{ fs = $_.DeviceID; size = [int64]$_.Size; used = [int64]$_.Size - [int64]$_.FreeSpace } })
      network = @($network | ForEach-Object { @{ iface = $_.Description; ip4 = ($_.IPAddress | Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' } | Select-Object -First 1) } })
      battery = @{ hasBattery = $battery.Count -gt 0; percent = if ($battery.Count) { $battery[0].EstimatedChargeRemaining } else { 0 }; isCharging = if ($battery.Count) { $battery[0].BatteryStatus -in 2, 6, 7, 8, 9 } else { $false } }
      audio = @($audio | ForEach-Object { @{ name = $_.Name; manufacturer = $_.Manufacturer } })
    } | ConvertTo-Json -Depth 6 -Compress
  `;
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ], { windowsHide: true, maxBuffer: 1024 * 1024 });

  const snapshot = { ...JSON.parse(stdout), source: 'Windows host (via WSL)', collectedAt: new Date().toISOString() };
  writeLog('info', 'Windows host hardware read completed.');
  return snapshot;
}

async function getHardwareSnapshot() {
  if (isWsl()) {
    try {
      return await getWindowsHostSnapshot();
    } catch (error) {
      console.warn('Could not query the Windows host; using WSL hardware details instead.', error.message);
      writeLog('warn', 'Windows host hardware read failed; using WSL details.', errorDetails(error));
    }
  }

  writeLog('info', 'Reading hardware from the local operating system.');
  const [
    os,
    system,
    cpu,
    memory,
    memoryLayout,
    graphics,
    baseboard,
    bios,
    disks,
    filesystems,
    network,
    battery,
    audio,
  ] = await Promise.all([
    si.osInfo(),
    si.system(),
    si.cpu(),
    si.mem(),
    si.memLayout(),
    si.graphics(),
    si.baseboard(),
    si.bios(),
    si.diskLayout(),
    si.fsSize(),
    si.networkInterfaces(),
    si.battery(),
    si.audio(),
  ]);

  const snapshot = {
    os,
    system,
    cpu,
    memory,
    memoryLayout,
    graphics,
    baseboard,
    bios,
    disks,
    filesystems,
    network,
    battery,
    audio,
    source: 'Local operating system',
    collectedAt: new Date().toISOString(),
  };
  writeLog('info', 'Local operating system hardware read completed.');
  return snapshot;
}

function createWindow() {
  writeLog('info', 'Creating application window.');
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 840,
    minHeight: 620,
    backgroundColor: '#f5f3ec',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.webContents.on('did-finish-load', () => writeLog('info', 'Renderer finished loading.'));
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    writeLog('error', 'Renderer failed to load.', { errorCode, errorDescription, validatedUrl });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    writeLog('error', 'Renderer process exited.', details);
  });
  window.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch((error) => {
    writeLog('error', 'Could not load renderer file.', errorDetails(error));
  });
}

app.whenReady().then(() => {
  writeLog('info', 'Application ready.', { platform: process.platform, isWsl: isWsl() });
  ipcMain.handle('hardware:read', async () => {
    writeLog('info', 'Hardware read requested by renderer.');
    try {
      return await getHardwareSnapshot();
    } catch (error) {
      writeLog('error', 'Hardware read failed.', errorDetails(error));
      throw error;
    }
  });
  ipcMain.on('runtime:log', (_event, level, message, details) => writeLog(level, message, details));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  writeLog('info', 'All application windows closed.');
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => writeLog('error', 'Uncaught exception.', errorDetails(error)));
process.on('unhandledRejection', (error) => writeLog('error', 'Unhandled promise rejection.', errorDetails(error)));
