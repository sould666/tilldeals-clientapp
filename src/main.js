const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
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

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

function getOpenAiKeyPath() {
  return path.join(app.getPath('userData'), 'openai.key');
}

function hasOpenAiKey() {
  return fs.existsSync(getOpenAiKeyPath());
}

function saveOpenAiKey(key) {
  const keyPath = getOpenAiKeyPath();
  if (!key) {
    if (fs.existsSync(keyPath)) fs.rmSync(keyPath);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system.');
  }
  fs.writeFileSync(keyPath, safeStorage.encryptString(key));
}

function loadOpenAiKey() {
  const keyPath = getOpenAiKeyPath();
  if (!fs.existsSync(keyPath)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(fs.readFileSync(keyPath));
}

// Reduces a hardware snapshot to the fields relevant for compatibility matching.
// Never forward serial numbers or the full raw snapshot to an external API.
function buildHardwareDataLayer(snapshot) {
  if (!snapshot) return {};
  return {
    os: snapshot.os?.platform,
    cpuBrand: snapshot.cpu?.brand,
    cpuSocket: snapshot.cpu?.socket,
    motherboard: `${snapshot.baseboard?.manufacturer || ''} ${snapshot.baseboard?.model || ''}`.trim(),
    memoryType: snapshot.memoryLayout?.find((module) => module.type)?.type || null,
    memorySlotsTotal: snapshot.memorySlots?.total ?? null,
    graphicsModels: (snapshot.graphics?.controllers || []).map((controller) => controller.model).filter(Boolean),
  };
}

async function testOpenAiConnection() {
  const key = loadOpenAiKey();
  if (!key) return { ok: false, message: 'No OpenAI API key is configured.' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (response.ok) return { ok: true, message: 'Connected to OpenAI successfully.' };
    if (response.status === 401) return { ok: false, message: 'OpenAI rejected the API key.' };
    return { ok: false, message: `OpenAI returned status ${response.status}.` };
  } catch (error) {
    return { ok: false, message: `Could not reach OpenAI: ${error.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function findReplacementDevice({ component, label, reason, hardwareSnapshot }) {
  const key = loadOpenAiKey();
  if (!key) throw new Error('No OpenAI API key is configured. Add one in Settings.');

  const dataLayer = buildHardwareDataLayer(hardwareSnapshot);
  const prompt = [
    'A local diagnostic app identified a hardware part that likely needs replacement.',
    `Part to replace: ${String(label || component || '').slice(0, 200)}`,
    `Diagnosis reason: ${String(reason || '').slice(0, 500)}`,
    `Known existing hardware for compatibility: ${JSON.stringify(dataLayer)}`,
    'Suggest a specific, currently sold replacement part that is compatible with the existing hardware. Keep the answer under 120 words.',
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenAI returned status ${response.status}.`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || 'No suggestion was returned.';
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTemperatures(temperatures, graphics) {
  const main = Number.isFinite(temperatures?.main) ? temperatures.main : null;
  const cores = Array.isArray(temperatures?.cores) ? temperatures.cores.filter(Number.isFinite) : [];
  const gpu = (graphics?.controllers || [])
    .map((controller) => controller.temperatureGpu)
    .filter(Number.isFinite);
  return {
    main,
    cores,
    gpu,
    cpuAvailable: main !== null || cores.length > 0,
    cpuSource: main !== null || cores.length > 0 ? 'systeminformation / OS sensor' : 'No exposed CPU sensor',
    gpuAvailable: gpu.length > 0,
  };
}

async function getWindowsHostSnapshot() {
  writeLog('info', 'Reading hardware from Windows host through WSL.');
  const script = String.raw`
    $ErrorActionPreference = 'Stop'
    $computer = Get-CimInstance Win32_ComputerSystem
    $operatingSystem = Get-CimInstance Win32_OperatingSystem
    $processor = Get-CimInstance Win32_Processor | Select-Object -First 1
    $memoryModules = @(Get-CimInstance Win32_PhysicalMemory)
    $memoryArrays = @(Get-CimInstance Win32_PhysicalMemoryArray)
    $graphics = @(Get-CimInstance Win32_VideoController)
    $thermalZones = @(Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace root/wmi -ErrorAction SilentlyContinue)
    $devices = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -in @('Display', 'Media', 'Net', 'Storage', 'USB', 'System') -and $_.Status -eq 'OK' })
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
      memorySlots = @{ total = [int](($memoryArrays | Measure-Object -Property MemoryDevices -Sum).Sum); maxCapacity = [int64](($memoryArrays | Measure-Object -Property MaxCapacity -Sum).Sum) * 1KB; used = $memoryModules.Count }
      graphics = @{ controllers = @($graphics | ForEach-Object { @{ vendor = $_.AdapterCompatibility; model = $_.Name; vram = $_.AdapterRAM } }); displays = @() }
      deviceInventory = @($devices | ForEach-Object { @{ name = $_.Name; category = $_.PNPClass; manufacturer = $_.Manufacturer; deviceId = $_.DeviceID } })
      temperatures = @{ main = if ($thermalZones.Count) { [math]::Round(($thermalZones | Measure-Object -Property CurrentTemperature -Average).Average / 10 - 273.15, 1) } else { $null }; cores = @(); gpu = @(); cpuAvailable = $thermalZones.Count -gt 0; cpuSource = if ($thermalZones.Count) { 'Windows ACPI thermal zone' } else { 'Windows ACPI sensor unavailable' }; gpuAvailable = $false }
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
    temperatures,
    baseboard,
    bios,
    disks,
    filesystems,
    network,
    battery,
    audio,
    deviceInventory,
  ] = await Promise.all([
    si.osInfo(),
    si.system(),
    si.cpu(),
    si.mem(),
    si.memLayout(),
    si.graphics(),
    si.cpuTemperature(),
    si.baseboard(),
    si.bios(),
    si.diskLayout(),
    si.fsSize(),
    si.networkInterfaces(),
    si.battery(),
    si.audio(),
    si.usb(),
  ]);

  const snapshot = {
    os,
    system,
    cpu,
    memory,
    memoryLayout,
    memorySlots: {
      total: baseboard.memSlots,
      used: memoryLayout.filter((module) => module.size > 0).length,
      maxCapacity: null,
    },
    graphics,
    temperatures: normalizeTemperatures(temperatures, graphics),
    baseboard,
    bios,
    disks,
    filesystems,
    network,
    battery,
    audio,
    deviceInventory,
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
  ipcMain.handle('settings:getOpenAiKeyStatus', () => ({
    hasKey: hasOpenAiKey(),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  }));
  ipcMain.handle('settings:setOpenAiKey', (_event, key) => {
    try {
      saveOpenAiKey(typeof key === 'string' ? key.trim() : '');
      writeLog('info', 'OpenAI API key updated.', { hasKey: hasOpenAiKey() });
      return { ok: true };
    } catch (error) {
      writeLog('error', 'Could not store OpenAI API key.', errorDetails(error));
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle('settings:testOpenAiConnection', async () => {
    const result = await testOpenAiConnection();
    writeLog('info', 'OpenAI connection test completed.', { ok: result.ok });
    return result;
  });
  ipcMain.handle('llm:findReplacementDevice', async (_event, payload) => {
    try {
      const message = await findReplacementDevice(payload || {});
      writeLog('info', 'LLM replacement device lookup completed.', { component: payload?.component });
      return { ok: true, message };
    } catch (error) {
      writeLog('error', 'LLM replacement device lookup failed.', errorDetails(error));
      return { ok: false, message: error.message };
    }
  });
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
