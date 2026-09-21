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
const TILLDEALS_API_URL = 'https://deals.tillgreen.eu/api/hardware-upgrade-recommendations';
const TILLDEALS_TRACKING_API_URL = 'https://deals.tillgreen.eu/api/tracked-items';
const UPGRADE_SPENDING_TIERS = ['cheap', 'moderate', 'expensive', 'takeMyMoney'];

function getOpenAiKeyPath() {
  return path.join(app.getPath('userData'), 'openai.key');
}

function getTillDealsLastResultPath() {
  return path.join(app.getPath('userData'), 'tilldeals-last-recommendation.json');
}

function saveTillDealsLastRecommendation(transferObject) {
  fs.writeFileSync(getTillDealsLastResultPath(), JSON.stringify(transferObject));
}

function loadTillDealsLastRecommendation() {
  const filePath = getTillDealsLastResultPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    writeLog('error', 'Could not read saved TillDeals recommendation.', errorDetails(error));
    return null;
  }
}

function getTillDealsTrackedItemsPath() {
  return path.join(app.getPath('userData'), 'tilldeals-tracked-items.json');
}

function loadTillDealsTrackedItems() {
  const filePath = getTillDealsTrackedItemsPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    writeLog('error', 'Could not read TillDeals tracked items.', errorDetails(error));
    return [];
  }
}

function appendTillDealsTrackedItems(entries) {
  const stored = loadTillDealsTrackedItems();
  const timestamp = new Date().toISOString();
  const withMeta = entries.map((entry) => ({ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, addedAt: timestamp }));
  const merged = [...withMeta, ...stored].slice(0, 200);
  fs.writeFileSync(getTillDealsTrackedItemsPath(), JSON.stringify(merged));
  return merged;
}

function buildTrackingTransferObject(entries) {
  const items = Array.from(new Set(entries.flatMap((entry) => Array.isArray(entry.items) ? entry.items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
  return {
    destination: {
      method: 'POST',
      url: TILLDEALS_TRACKING_API_URL,
    },
    generatedAt: new Date().toISOString(),
    sourceApp: 'TillDeals Hardware',
    items,
  };
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
    memorySlotsUsed: snapshot.memorySlots?.used ?? null,
    memorySlotsFree: Number.isFinite(snapshot.memorySlots?.total) && Number.isFinite(snapshot.memorySlots?.used)
      ? Math.max(snapshot.memorySlots.total - snapshot.memorySlots.used, 0)
      : null,
    memoryMaxCapacityBytes: snapshot.memorySlots?.maxCapacity ?? null,
    graphicsModels: (snapshot.graphics?.controllers || []).map((controller) => controller.model).filter(Boolean),
  };
}

function compactList(values, mapper, limit = 12) {
  return (Array.isArray(values) ? values : []).map(mapper).filter(Boolean).slice(0, limit);
}

function containsAny(value, patterns) {
  const text = String(value || '').toLocaleLowerCase();
  return patterns.some((pattern) => text.includes(pattern));
}

function buildMemoryUpgradeAssessment(snapshot) {
  const totalBytes = snapshot?.memory?.total ?? null;
  const slotsTotal = snapshot?.memorySlots?.total ?? null;
  const slotsUsed = snapshot?.memorySlots?.used ?? null;
  const slotsFree = Number.isFinite(slotsTotal) && Number.isFinite(slotsUsed) ? Math.max(slotsTotal - slotsUsed, 0) : null;
  const maxCapacityBytes = snapshot?.memorySlots?.maxCapacity ?? null;
  const capacityHeadroomBytes = Number.isFinite(maxCapacityBytes) && Number.isFinite(totalBytes)
    ? Math.max(maxCapacityBytes - totalBytes, 0)
    : null;
  const slotsAreFull = slotsFree === 0;
  const maxCapacityReached = capacityHeadroomBytes === 0;

  return {
    slotsAreFull,
    maxCapacityReached,
    capacityHeadroomBytes,
    upgradeLikelyAvailable: capacityHeadroomBytes === null ? null : capacityHeadroomBytes > 0,
    decisionHint: slotsAreFull && maxCapacityReached
      ? 'RAM is already at the detected motherboard capacity; do not recommend RAM.'
      : 'Check slot availability, current modules, and motherboard max capacity before recommending RAM.',
  };
}

function buildPlatformUpgradeAssessment(snapshot, hardware) {
  const cpuBrand = hardware.cpuBrand || '';
  const cpuSocket = hardware.cpuSocket || '';
  const motherboard = hardware.motherboard || '';
  const memoryType = hardware.memoryType || '';
  const graphicsModels = hardware.graphicsModels || [];
  const storageNames = compactList(snapshot?.disks, (disk) => disk.name || disk.model || '', 24).join(' ');
  const legacyIntelPlatform = containsAny(`${cpuBrand} ${cpuSocket} ${motherboard} ${memoryType}`, [
    'i7-4', 'i5-4', 'i3-4', 'lga1150', 'b85', 'h81', 'h87', 'z87', 'q87', 'ddr3',
  ]);
  const modernGamingGpu = graphicsModels.some((model) => /rtx\s*30|rtx\s*40|rx\s*6\d{3}|rx\s*7\d{3}/i.test(model));
  const nativeNvmeSupportLikely = legacyIntelPlatform ? false : null;
  const nvmeDrivePresentLikely = /nvme|snv|snvs|970\s*evo|980\s*pro|990\s*pro|wd\s*black\s*sn/i.test(storageNames);

  return {
    legacyPlatform: legacyIntelPlatform,
    cpuGpuBottleneckLikely: legacyIntelPlatform && modernGamingGpu,
    nativeNvmeSupportLikely,
    nvmeDrivePresentLikely,
    nvmeWorkaroundLikely: nativeNvmeSupportLikely === false && nvmeDrivePresentLikely,
    recommendedUpgradeScope: legacyIntelPlatform
      ? 'Evaluate three distinct upgrade tiers separately: 1) RAM-only change if it removes a real bottleneck, 2) a same-socket, same-motherboard CPU swap to a higher-tier chip supported by this board, 3) a full platform bundle (motherboard + CPU + compatible RAM) only if tiers 1-2 cannot fix the bottleneck. Do not skip straight to a full platform bundle when a cheaper same-socket CPU or RAM change is realistic.'
      : 'Consider component-level upgrades after checking compatibility.',
    decisionHint: legacyIntelPlatform && modernGamingGpu
      ? 'A modern GPU paired with this older CPU/motherboard/RAM platform can bottleneck games. Rank a same-socket CPU upgrade and a full platform bundle as separate options and explain the cost/benefit difference between them.'
      : 'Check CPU, motherboard, RAM generation, GPU balance, and storage bus support before ranking upgrades.',
  };
}

function buildUpgradeAdvisorInput(snapshot) {
  const hardware = buildHardwareDataLayer(snapshot);
  return {
    collectedAt: snapshot?.collectedAt || new Date().toISOString(),
    source: snapshot?.source || 'Unknown',
    currentSetup: {
      ...hardware,
      systemModel: `${snapshot?.system?.manufacturer || ''} ${snapshot?.system?.model || ''}`.trim() || null,
      memoryTotalBytes: snapshot?.memory?.total ?? null,
      memoryAvailableBytes: snapshot?.memory?.available ?? null,
      memoryUpgradeAssessment: buildMemoryUpgradeAssessment(snapshot),
      platformUpgradeAssessment: buildPlatformUpgradeAssessment(snapshot, hardware),
      memoryModules: compactList(snapshot?.memoryLayout, (module) => ({
        sizeBytes: module.size ?? null,
        type: module.type || null,
        clockSpeedMhz: module.clockSpeed ?? null,
      })),
      storage: compactList(snapshot?.disks, (disk) => ({
        name: disk.name || disk.model || null,
        sizeBytes: disk.size ?? null,
        type: disk.type || disk.interfaceType || disk.mediaType || null,
        interfaceType: disk.interfaceType || disk.interface || null,
      })),
      displays: compactList(snapshot?.graphics?.displays, (display) => ({
        model: display.model || null,
        resolution: display.resolutionX && display.resolutionY ? `${display.resolutionX}x${display.resolutionY}` : null,
      })),
    },
    currentPeripherals: {
      audio: compactList(snapshot?.audio, (device) => ({ name: device.name || null, manufacturer: device.manufacturer || null })),
      network: compactList(snapshot?.network, (item) => ({ name: item.iface || item.ifaceName || null, ip4: item.ip4 || null })),
      devices: compactList(snapshot?.deviceInventory, (device) => ({
        category: device.category || null,
        name: device.name || device.model || null,
        manufacturer: device.manufacturer || null,
      }), 24),
    },
  };
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch (_error) {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI response did not include a JSON object.');
    return JSON.parse(match[0]);
  }
}

function normalizePropositionEntry(raw, index) {
  const tier = UPGRADE_SPENDING_TIERS.includes(raw?.tier) ? raw.tier : 'moderate';
  const fields = raw?.fields && typeof raw.fields === 'object' ? raw.fields : {};
  return {
    rank: Number.isFinite(raw?.rank) ? raw.rank : index + 1,
    title: raw?.title || `Proposition ${index + 1}`,
    tier,
    estimatedRange: raw?.estimatedRange || '',
    fields: {
      processor: fields.processor || null,
      motherboard: fields.motherboard || null,
      ram: fields.ram || null,
      drives: fields.drives || null,
      monitor: fields.monitor || null,
      additional1: fields.additional1 || null,
      additional2: fields.additional2 || null,
    },
    requiresPairing: Array.isArray(raw?.requiresPairing) ? raw.requiresPairing.filter(Boolean) : [],
    reason: raw?.reason || '',
  };
}

function fallbackLegacyProposition(rawRecommendation) {
  const categories = rawRecommendation?.categories || {};
  return {
    rank: 1,
    title: 'Migrated legacy recommendation',
    tier: 'moderate',
    estimatedRange: '',
    fields: {
      processor: categories.cpu?.upgradedValue || null,
      motherboard: categories.motherboard?.upgradedValue || null,
      ram: categories.ram?.upgradedValue || null,
      drives: categories.storage?.upgradedValue || null,
      monitor: categories.display?.upgradedValue || null,
      additional1: categories.extra1?.upgradedValue || null,
      additional2: categories.extra2?.upgradedValue || null,
    },
    requiresPairing: [],
    reason: rawRecommendation?.reason || '',
  };
}

function normalizeUpgradeRecommendation(rawRecommendation) {
  const rawPropositions = Array.isArray(rawRecommendation?.propositions) ? rawRecommendation.propositions : [];
  const normalized = rawPropositions.slice(0, 4).map(normalizePropositionEntry);
  while (normalized.length < 4) {
    normalized.push(normalizePropositionEntry({}, normalized.length));
  }

  if (!rawPropositions.length && rawRecommendation?.categories) {
    normalized[0] = fallbackLegacyProposition(rawRecommendation);
  }

  return {
    summary: rawRecommendation?.summary || '',
    reason: rawRecommendation?.reason || '',
    propositions: normalized,
  };
}

function buildDealsTransferObject(advisorInput, recommendation) {
  return {
    destination: {
      method: 'POST',
      url: TILLDEALS_API_URL,
    },
    logo: {
      asset: 'logo.svg',
      alt: 'TillDeals',
    },
    generatedAt: new Date().toISOString(),
    sourceApp: 'TillDeals Hardware',
    currentSetup: advisorInput.currentSetup,
    currentPeripherals: advisorInput.currentPeripherals,
    recommendation,
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

async function findReplacementDevice({ component, label, reason, hardwareSnapshot, type }) {
  if (type === 'resolved') {
    throw new Error('This outcome does not require a hardware replacement.');
  }

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

async function chooseBestHardwareUpgrade({ hardwareSnapshot, locale, spendingTier }) {
  const key = loadOpenAiKey();
  if (!key) throw new Error('No OpenAI API key is configured. Add one in Settings.');

  const advisorInput = buildUpgradeAdvisorInput(hardwareSnapshot);
  const selectedTier = UPGRADE_SPENDING_TIERS.includes(spendingTier) ? spendingTier : 'moderate';
  const prompt = [
    'You are helping a user choose hardware and peripheral upgrades for the lowest realistic cost.',
    'Assess the current setup JSON and current peripherals. Return exactly 4 concrete upgrade propositions, not an assessment grid.',
    'Each proposition must include separate fields for processor, motherboard, ram, drives, monitor, additional1, additional2.',
    'If a proposition requires changing 2+ components together (for example CPU + motherboard), state this explicitly in requiresPairing and explain why in reason.',
    'Target spending tier provided by user. Main proposition should match selected tier. You may include nearby tiers in other propositions for contrast.',
    'Memory rule: memorySlotsTotal is total physical RAM slots, memorySlotsUsed is occupied slots, and memorySlotsFree is available empty slots. If memorySlotsFree is 0, do not suggest add-only RAM unless replacing modules is realistic.',
    'Platform rule: if cpuGpuBottleneckLikely is true, include at least one proposition that materially improves CPU/platform bottleneck (not just 5-8% uplift). Avoid trivial same-generation swaps unless you clearly state low expected gain.',
    'NVMe rule: if nativeNvmeSupportLikely is false and nvmeWorkaroundLikely is true, mention adapter limitation and include at least one proposition that resolves it natively.',
    'Return only a valid JSON object. Do not include markdown fences or extra text.',
    'Required JSON shape:',
    JSON.stringify({
      summary: 'Short overall summary in the requested locale.',
      propositions: [
        {
          rank: 1,
          title: 'Short proposition title',
          tier: 'cheap | moderate | expensive | takeMyMoney',
          estimatedRange: 'price range text',
          fields: {
            processor: 'specific processor change or null',
            motherboard: 'specific motherboard change or null',
            ram: 'specific RAM change or null',
            drives: 'specific drive change or null',
            monitor: 'specific monitor change or null',
            additional1: 'optional extra hardware or null',
            additional2: 'optional extra hardware or null',
          },
          requiresPairing: ['cpu + motherboard if needed'],
          reason: 'why this proposition and expected impact',
        },
      ],
      reason: 'Overall explanation of priority across the 4 propositions.',
    }),
    `Selected spending tier: ${selectedTier}`,
    `Requested locale: ${locale === 'en' ? 'English' : 'Polish'}`,
    `Current setup JSON: ${JSON.stringify(advisorInput)}`,
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
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenAI returned status ${response.status}.`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('No recommendation was returned.');
    const recommendation = normalizeUpgradeRecommendation(parseJsonObject(content));
    const transferObject = buildDealsTransferObject(advisorInput, recommendation);
    saveTillDealsLastRecommendation(transferObject);
    return transferObject;
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
      disks = @($disks | ForEach-Object { @{ name = $_.Model; model = $_.Model; size = [int64]$_.Size; mediaType = $_.MediaType; interfaceType = $_.InterfaceType; pnpDeviceId = $_.PNPDeviceID } })
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
  ipcMain.handle('llm:chooseBestHardwareUpgrade', async (_event, payload) => {
    try {
      const transferObject = await chooseBestHardwareUpgrade(payload || {});
      writeLog('info', 'LLM TillDeals hardware upgrade recommendation completed.');
      return { ok: true, transferObject };
    } catch (error) {
      writeLog('error', 'LLM TillDeals hardware upgrade recommendation failed.', errorDetails(error));
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle('tilldeals:getLastRecommendation', () => loadTillDealsLastRecommendation());
  ipcMain.handle('tilldeals:getTrackedItems', () => loadTillDealsTrackedItems());
  ipcMain.handle('tilldeals:addTrackedItems', (_event, entries) => {
    try {
      const list = Array.isArray(entries) ? entries : [];
      if (!list.length) return { ok: false, message: 'No items were marked for tracking.' };
      appendTillDealsTrackedItems(list);
      const trackingPayload = buildTrackingTransferObject(list);
      writeLog('info', 'TillDeals tracked items added.', { count: list.length });
      return { ok: true, trackingPayload };
    } catch (error) {
      writeLog('error', 'Could not add TillDeals tracked items.', errorDetails(error));
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
