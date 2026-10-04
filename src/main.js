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

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  writeLog('warn', 'Another instance is already running; exiting.');
  app.quit();
}

let mainWindow = null;

let si;
try {
  si = require('systeminformation');
  writeLog('info', 'systeminformation module loaded.');
} catch (error) {
  writeLog('error', 'Could not load systeminformation.', errorDetails(error));
  throw error;
}

const account = require('./account');
const { createAuth, registerAuthIpc } = require('./auth');
const { rendererTrust } = require('./window-trust');
const { createUpdates, registerUpdatesIpc } = require('./updates');
const trust = rendererTrust(path.join(__dirname, 'renderer', 'index.html'), () => mainWindow);

function isWsl() {
  return Boolean(process.env.WSL_DISTRO_NAME) || os.release().toLowerCase().includes('microsoft');
}

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const TILLDEALS_API_URL = 'https://deals.tillgreen.eu/api/hardware-upgrade-recommendations';
const UPGRADE_SPENDING_TIERS = ['cheap', 'moderate', 'expensive', 'takeMyMoney'];
const MAX_RECOMMENDATION_ATTEMPTS = 3;

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

function clearTillDealsLastRecommendation() {
  const filePath = getTillDealsLastResultPath();
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
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

function toGiBLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
}

function buildRamProfile(snapshot) {
  const modules = compactList(snapshot?.memoryLayout, (module) => {
    if (!module || !Number.isFinite(module.size) || module.size <= 0) return null;
    return {
      sizeBytes: module.size,
      sizeLabel: toGiBLabel(module.size),
      type: module.type || null,
      clockSpeedMhz: module.clockSpeed ?? null,
      profile: [toGiBLabel(module.size), module.type || null, module.clockSpeed ? `${module.clockSpeed} MHz` : null].filter(Boolean).join(' '),
    };
  }, 8);

  return {
    installedTotalLabel: toGiBLabel(snapshot?.memory?.total ?? null),
    slots: {
      total: snapshot?.memorySlots?.total ?? null,
      used: snapshot?.memorySlots?.used ?? null,
      free: Number.isFinite(snapshot?.memorySlots?.total) && Number.isFinite(snapshot?.memorySlots?.used)
        ? Math.max(snapshot.memorySlots.total - snapshot.memorySlots.used, 0)
        : null,
    },
    maxCapacityLabel: toGiBLabel(snapshot?.memorySlots?.maxCapacity ?? null),
    moduleTypes: Array.from(new Set(modules.map((module) => module.type).filter(Boolean))),
    moduleSpeedsMhz: Array.from(new Set(modules.map((module) => module.clockSpeedMhz).filter(Number.isFinite))).sort((a, b) => a - b),
    modules,
    modulesSummary: modules.map((module) => module.profile).join(', ') || null,
    decisionHint: 'Always evaluate RAM by module generation/type, clock speed, and slot constraints - not by total capacity alone.',
  };
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
  const ramProfile = buildRamProfile(snapshot);
  return {
    collectedAt: snapshot?.collectedAt || new Date().toISOString(),
    source: snapshot?.source || 'Unknown',
    currentSetup: {
      ...hardware,
      systemModel: `${snapshot?.system?.manufacturer || ''} ${snapshot?.system?.model || ''}`.trim() || null,
      memoryTotalBytes: snapshot?.memory?.total ?? null,
      memoryAvailableBytes: snapshot?.memory?.available ?? null,
      ramProfile,
      memoryUpgradeAssessment: buildMemoryUpgradeAssessment(snapshot),
      platformUpgradeAssessment: buildPlatformUpgradeAssessment(snapshot, hardware),
      memoryModules: ramProfile.modules.map((module) => ({
        sizeBytes: module.sizeBytes,
        type: module.type,
        clockSpeedMhz: module.clockSpeedMhz,
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

function normalizeFieldEntry(value) {
  const sanitizeText = (input) => {
    const text = String(input || '').trim();
    if (!text) return null;
    const normalized = text.toLowerCase();
    if (['null', 'none', 'n/a', 'na', '-', 'brak', 'brak danych'].includes(normalized)) return null;
    return text;
  };

  if (!value) return null;
  if (typeof value === 'string') {
    const clean = sanitizeText(value);
    return clean ? { value: clean, estimatedCost: null } : null;
  }
  if (typeof value === 'object') {
    const cleanValue = sanitizeText(value.value);
    const cleanCost = sanitizeText(value.estimatedCost);
    if (!cleanValue) return null;
    return {
      value: cleanValue,
      estimatedCost: cleanCost,
    };
  }
  return null;
}

function normalizePropositionEntry(raw, index) {
  const tier = UPGRADE_SPENDING_TIERS.includes(raw?.tier) ? raw.tier : 'moderate';
  const fields = raw?.fields && typeof raw.fields === 'object' ? raw.fields : {};
  return {
    rank: Number.isFinite(raw?.rank) ? raw.rank : index + 1,
    title: raw?.title || `Proposition ${index + 1}`,
    tier,
    estimatedTotalCost: raw?.estimatedTotalCost || null,
    estimatedRange: raw?.estimatedRange || '',
    fields: {
      processor: normalizeFieldEntry(fields.processor),
      motherboard: normalizeFieldEntry(fields.motherboard),
      ram: normalizeFieldEntry(fields.ram),
      drives: normalizeFieldEntry(fields.drives),
      monitor: normalizeFieldEntry(fields.monitor),
      additional1: normalizeFieldEntry(fields.additional1),
      additional2: normalizeFieldEntry(fields.additional2),
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
    estimatedTotalCost: null,
    estimatedRange: '',
    fields: {
      processor: normalizeFieldEntry(categories.cpu?.upgradedValue || null),
      motherboard: normalizeFieldEntry(categories.motherboard?.upgradedValue || null),
      ram: normalizeFieldEntry(categories.ram?.upgradedValue || null),
      drives: normalizeFieldEntry(categories.storage?.upgradedValue || null),
      monitor: normalizeFieldEntry(categories.display?.upgradedValue || null),
      additional1: normalizeFieldEntry(categories.extra1?.upgradedValue || null),
      additional2: normalizeFieldEntry(categories.extra2?.upgradedValue || null),
    },
    requiresPairing: [],
    reason: rawRecommendation?.reason || '',
  };
}

function normalizeUpgradeRecommendation(rawRecommendation) {
  const rawPropositions = Array.isArray(rawRecommendation?.propositions) ? rawRecommendation.propositions : [];
  const propositionSource = rawRecommendation?.proposition || rawPropositions[0] || null;
  const proposition = propositionSource ? normalizePropositionEntry(propositionSource, 0) : normalizePropositionEntry({}, 0);

  if (!rawPropositions.length && rawRecommendation?.categories) {
    return {
      summary: rawRecommendation?.summary || '',
      reason: rawRecommendation?.reason || '',
      proposition: fallbackLegacyProposition(rawRecommendation),
    };
  }

  return {
    summary: rawRecommendation?.summary || '',
    reason: rawRecommendation?.reason || '',
    proposition,
  };
}

function normalizeMemoryType(type) {
  const raw = String(type || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw.includes('DDR5')) return 'DDR5';
  if (raw.includes('DDR4')) return 'DDR4';
  if (raw.includes('DDR3')) return 'DDR3';
  if (raw.includes('DDR2')) return 'DDR2';
  if (raw.includes('DDR')) return 'DDR';

  const code = Number(raw);
  const byCode = {
    20: 'DDR',
    21: 'DDR2',
    24: 'DDR3',
    26: 'DDR4',
    34: 'DDR5',
  };
  return byCode[code] || null;
}

function extractRamGenerations(text) {
  const value = String(text || '').toUpperCase();
  const matches = value.match(/DDR\s*[2-5]/g) || [];
  return Array.from(new Set(matches.map((match) => match.replace(/\s+/g, ''))));
}

function ramGenerationRank(generation) {
  const normalized = String(generation || '').toUpperCase().replace(/\s+/g, '');
  const map = {
    DDR2: 2,
    DDR3: 3,
    DDR4: 4,
    DDR5: 5,
  };
  return map[normalized] || null;
}

function normalizeComparableText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isMotherboardChanged(currentBoard, proposedBoard) {
  if (!proposedBoard) return false;
  const current = normalizeComparableText(currentBoard);
  const proposed = normalizeComparableText(proposedBoard);
  if (!current || !proposed) return true;
  return current !== proposed && !current.includes(proposed) && !proposed.includes(current);
}

function parseCpuRank(cpuName) {
  const value = String(cpuName || '').toLowerCase();
  const intelMatch = value.match(/\bi([3579])[-\s]?(\d{4,5})\b/i);
  if (intelMatch) {
    const tier = Number(intelMatch[1]);
    const model = Number(intelMatch[2]);
    const generation = intelMatch[2].length === 5 ? Number(intelMatch[2].slice(0, 2)) : Number(intelMatch[2].slice(0, 1));
    return { vendor: 'intel', score: tier * 1000000 + generation * 10000 + model };
  }

  const ryzenMatch = value.match(/\bryzen\s*([3579])\s*(\d{4,5})\b/i);
  if (ryzenMatch) {
    const tier = Number(ryzenMatch[1]);
    const model = Number(ryzenMatch[2]);
    const generation = Number(ryzenMatch[2].slice(0, 1));
    return { vendor: 'amd', score: tier * 1000000 + generation * 10000 + model };
  }

  return null;
}

function parseCpuClassTier(cpuName) {
  const value = String(cpuName || '').toLowerCase();
  const intel = value.match(/\bi([3579])[-\s]?\d{4,5}\b/i);
  if (intel) return Number(intel[1]);
  const ryzen = value.match(/\bryzen\s*([3579])\s*\d{4,5}\b/i);
  if (ryzen) return Number(ryzen[1]);
  return null;
}

function isLikelyCpuDowngrade(currentCpu, proposedCpu) {
  if (!proposedCpu) return false;
  const currentClass = parseCpuClassTier(currentCpu);
  const proposedClass = parseCpuClassTier(proposedCpu);
  if (Number.isFinite(currentClass) && Number.isFinite(proposedClass) && proposedClass < currentClass) {
    return true;
  }

  const currentRank = parseCpuRank(currentCpu);
  const proposedRank = parseCpuRank(proposedCpu);
  if (!currentRank || !proposedRank) return false;
  if (currentRank.vendor !== proposedRank.vendor) {
    return proposedRank.score + 150000 < currentRank.score;
  }
  return proposedRank.score < currentRank.score;
}

function areLikelySameComponent(currentValue, proposedValue) {
  const current = normalizeComparableText(currentValue);
  const proposed = normalizeComparableText(proposedValue);
  if (!current || !proposed) return false;
  return current === proposed || current.includes(proposed) || proposed.includes(current);
}

function parseRamTotalGiB(text) {
  const value = String(text || '').toUpperCase();
  if (!value) return null;

  let total = 0;
  const multiplied = [...value.matchAll(/(\d+(?:[\.,]\d+)?)\s*[X*]\s*(\d+(?:[\.,]\d+)?)\s*G(?:B)?/g)];
  multiplied.forEach((match) => {
    const a = Number(match[1].replace(',', '.'));
    const b = Number(match[2].replace(',', '.'));
    if (Number.isFinite(a) && Number.isFinite(b)) total += a * b;
  });
  if (total > 0) return total;

  const singles = [...value.matchAll(/(\d+(?:[\.,]\d+)?)\s*G(?:B)?/g)]
    .map((match) => Number(match[1].replace(',', '.')))
    .filter(Number.isFinite);
  if (!singles.length) return null;
  return singles.reduce((sum, number) => sum + number, 0);
}

function parseRamMaxSpeedMhz(text) {
  const value = String(text || '').toUpperCase();
  const speeds = [...value.matchAll(/(\d{3,5})\s*MHZ/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  if (!speeds.length) return null;
  return Math.max(...speeds);
}

function parseRamKit(text) {
  const value = String(text || '').toUpperCase();
  const match = value.match(/(\d+)\s*[X*]\s*(\d+(?:[\.,]\d+)?)\s*G(?:B)?/);
  if (!match) return null;
  const count = Number(match[1]);
  const size = Number(match[2].replace(',', '.'));
  if (!Number.isFinite(count) || !Number.isFinite(size)) return null;
  return { count, sizeGiB: size };
}

function isRamProposalNoOp(currentSetup, proposedRamText) {
  const proposedGeneration = extractRamGenerations(proposedRamText)[0] || null;
  const currentGeneration = normalizeMemoryType((currentSetup?.ramProfile?.moduleTypes || [])[0]);

  const proposedTotalGiB = parseRamTotalGiB(proposedRamText);
  const currentTotalGiB = Number.isFinite(currentSetup?.memoryTotalBytes) ? currentSetup.memoryTotalBytes / (1024 ** 3) : null;

  const proposedSpeed = parseRamMaxSpeedMhz(proposedRamText);
  const currentSpeed = Array.isArray(currentSetup?.ramProfile?.moduleSpeedsMhz) && currentSetup.ramProfile.moduleSpeedsMhz.length
    ? Math.max(...currentSetup.ramProfile.moduleSpeedsMhz)
    : null;

  const proposedKit = parseRamKit(proposedRamText);
  const moduleSizesGiB = (currentSetup?.ramProfile?.modules || [])
    .map((module) => Number.isFinite(module?.sizeBytes) ? module.sizeBytes / (1024 ** 3) : null)
    .filter(Number.isFinite);
  const currentKit = moduleSizesGiB.length && moduleSizesGiB.every((size) => Math.abs(size - moduleSizesGiB[0]) < 0.01)
    ? { count: moduleSizesGiB.length, sizeGiB: moduleSizesGiB[0] }
    : null;

  const sameGeneration = !proposedGeneration || !currentGeneration || proposedGeneration === currentGeneration;
  const noCapacityGain = Number.isFinite(currentTotalGiB) && Number.isFinite(proposedTotalGiB)
    ? proposedTotalGiB <= currentTotalGiB + 0.25
    : false;
  const noSpeedGain = Number.isFinite(currentSpeed) && Number.isFinite(proposedSpeed)
    ? proposedSpeed <= currentSpeed
    : false;
  const sameKit = Boolean(proposedKit && currentKit
    && proposedKit.count === currentKit.count
    && Math.abs(proposedKit.sizeGiB - currentKit.sizeGiB) < 0.01);

  return sameGeneration && (sameKit || (noCapacityGain && noSpeedGain));
}

function validateRecommendationProposal(advisorInput, recommendation) {
  const issues = [];
  const currentSetup = advisorInput?.currentSetup || {};
  const proposition = recommendation?.proposition || {};
  const fields = proposition?.fields || {};

  const currentRamGenerations = Array.from(new Set((currentSetup?.ramProfile?.moduleTypes || [])
    .map(normalizeMemoryType)
    .filter(Boolean)));
  const currentRamGeneration = currentRamGenerations[0] || null;
  const proposedRam = fields?.ram?.value || null;
  const proposedBoard = fields?.motherboard?.value || null;
  const boardChanged = isMotherboardChanged(currentSetup?.motherboard, proposedBoard);

  if (proposedRam) {
    const proposedRamGenerations = extractRamGenerations(proposedRam);
    if (!proposedRamGenerations.length) {
      issues.push('RAM proposition is missing explicit generation (DDR3/DDR4/DDR5).');
    }
    if (currentRamGeneration && !boardChanged && proposedRamGenerations.length && !proposedRamGenerations.includes(currentRamGeneration)) {
      issues.push(`RAM generation mismatch: current platform is ${currentRamGeneration}, but proposition suggests ${proposedRamGenerations.join(', ')} without motherboard change.`);
    }
  }

  if (proposedBoard && proposedRam) {
    const pairing = Array.isArray(proposition?.requiresPairing) ? proposition.requiresPairing.join(' ').toLowerCase() : '';
    if (boardChanged && !pairing.includes('motherboard')) {
      issues.push('Motherboard is changed but requiresPairing does not explicitly include motherboard dependency details.');
    }
  }

  const currentCpu = currentSetup?.cpuBrand || null;
  const proposedCpu = fields?.processor?.value || null;
  if (isLikelyCpuDowngrade(currentCpu, proposedCpu)) {
    issues.push(`Likely CPU downgrade detected: current "${currentCpu}" vs proposed "${proposedCpu}".`);
  }

  const legacyPlatform = Boolean(currentSetup?.platformUpgradeAssessment?.legacyPlatform);
  const cpuGpuBottleneckLikely = Boolean(currentSetup?.platformUpgradeAssessment?.cpuGpuBottleneckLikely);
  if (legacyPlatform && cpuGpuBottleneckLikely && proposedCpu && !proposedBoard) {
    issues.push('CPU-only proposition on this legacy platform is not accepted when bottleneck is likely; provide a same-socket validated uplift or a paired platform proposition.');
  }

  if (proposedCpu && areLikelySameComponent(currentCpu, proposedCpu)) {
    issues.push('Processor proposition repeats current processor. Use null when unchanged.');
  }

  const currentBoard = currentSetup?.motherboard || null;
  if (proposedBoard && areLikelySameComponent(currentBoard, proposedBoard)) {
    issues.push('Motherboard proposition repeats current motherboard. Use null when unchanged.');
  }

  const currentRamGiB = Number.isFinite(currentSetup?.memoryTotalBytes) ? currentSetup.memoryTotalBytes / (1024 ** 3) : null;
  const proposedRamGiB = parseRamTotalGiB(proposedRam);
  const proposedRamGenerations = extractRamGenerations(proposedRam);
  const currentRamRank = ramGenerationRank(currentRamGeneration);
  const proposedRamRank = ramGenerationRank(proposedRamGenerations[0]);
  const generationUpgradeWithBoardSwap = boardChanged && Number.isFinite(currentRamRank) && Number.isFinite(proposedRamRank) && proposedRamRank > currentRamRank;
  if (Number.isFinite(currentRamGiB) && Number.isFinite(proposedRamGiB)) {
    if (generationUpgradeWithBoardSwap) {
      if (proposedRamGiB + 0.25 < currentRamGiB * 0.5) {
        issues.push(`RAM capacity drop is too large even for generation upgrade: current about ${currentRamGiB.toFixed(1)} GB vs proposed about ${proposedRamGiB.toFixed(1)} GB.`);
      }
    } else if (proposedRamGiB + 0.25 < currentRamGiB) {
      issues.push(`RAM capacity regression: current is about ${currentRamGiB.toFixed(1)} GB but proposition suggests about ${proposedRamGiB.toFixed(1)} GB.`);
    }
  }

  if (proposedRam && isRamProposalNoOp(currentSetup, proposedRam)) {
    issues.push('RAM proposition is effectively identical to currently installed RAM (no practical gain).');
  }

  const changedFieldCount = ['processor', 'motherboard', 'ram', 'drives', 'monitor', 'additional1', 'additional2']
    .map((fieldName) => fields?.[fieldName]?.value)
    .filter(Boolean).length;
  if (changedFieldCount === 0) {
    issues.push('Proposition has no actual hardware change. At least one upgraded field is required.');
  }

  return issues;
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
  const basePrompt = [
    'You are helping a user choose hardware and peripheral upgrades for the lowest realistic cost.',
    'Assess the current setup JSON and current peripherals. Return exactly one concrete proposition, not many options.',
    'The single proposition must include separate fields for processor, motherboard, ram, drives, monitor, additional1, additional2.',
    'RAM data rule: use currentSetup.ramProfile and currentSetup.memoryModules as the primary RAM source. Do not treat RAM as only total GB.',
    'Current RAM context to respect: modulesSummary, installedTotalLabel, moduleTypes, moduleSpeedsMhz, slots.total/used/free.',
    'When considering RAM, inspect module type/generation, module speeds, modulesSummary, slots used/free, and max capacity.',
    'Memory-first rule: first evaluate whether the current motherboard + CPU can use faster compatible RAM (same RAM generation and supported speed/capacity). If yes and expected impact is meaningful for the selected spending tier, this should be the primary proposition before platform replacement.',
    'Compatibility is mandatory: do not propose an incompatible RAM generation for the current motherboard (for example DDR4 on a DDR3-only board) unless motherboard is also changed in the same proposition and listed in requiresPairing.',
    'Compatibility is mandatory: CPU socket must match proposed motherboard. If socket changes, CPU and motherboard must both be populated and listed in requiresPairing.',
    'If a field is not worth changing, set it to null.',
    'Never output "null" as text for field values or costs. Use actual JSON null.',
    'Never copy current CPU or motherboard into proposition fields. If unchanged, use null for that field.',
    'Do not propose a no-op. The proposition must introduce a meaningful hardware change versus current setup.',
    'Do not suggest a RAM kit that is effectively the same as currently installed modules (same generation, same speed, same total capacity).',
    'Target spending tier provided by user and keep recommendation realistic for that tier.',
    'Memory rule: memorySlotsTotal is total physical RAM slots, memorySlotsUsed is occupied slots, and memorySlotsFree is available empty slots. If memorySlotsFree is 0, do not suggest add-only RAM unless replacing modules is realistic and compatible. Use memory module clock speed/type plus platform data to decide whether a same-platform RAM upgrade is possible and useful.',
    'Platform rule: avoid trivial upgrades with around 5-8% gain unless explicitly marked as low-impact and justified.',
    'Include estimated total cost and per-field estimated cost where field is changed.',
    'NVMe rule: if nativeNvmeSupportLikely is false and nvmeWorkaroundLikely is true, mention adapter limitation and favor a proposition that can resolve it if tier allows.',
    'Return only a valid JSON object. Do not include markdown fences or extra text.',
    'Required JSON shape:',
    JSON.stringify({
      summary: 'Short overall summary in the requested locale.',
      proposition: {
        rank: 1,
        title: 'Short proposition title',
        tier: 'cheap | moderate | expensive | takeMyMoney',
        estimatedTotalCost: 'single estimated total cost',
        estimatedRange: 'price range text',
        fields: {
          processor: { value: 'specific processor change', estimatedCost: 'cost or null' },
          motherboard: { value: 'specific motherboard change', estimatedCost: 'cost or null' },
          ram: { value: 'specific RAM change', estimatedCost: 'cost or null' },
          drives: { value: 'specific drive change', estimatedCost: 'cost or null' },
          monitor: { value: 'specific monitor change', estimatedCost: 'cost or null' },
          additional1: { value: 'optional extra hardware', estimatedCost: 'cost or null' },
          additional2: { value: 'optional extra hardware', estimatedCost: 'cost or null' },
        },
        requiresPairing: ['cpu + motherboard if needed'],
        reason: 'why this proposition and expected impact',
      },
      reason: 'Overall explanation of this single proposition and expected impact.',
    }),
    `Selected spending tier: ${selectedTier}`,
    `Requested locale: ${locale === 'en' ? 'English' : 'Polish'}`,
    `Current setup JSON: ${JSON.stringify(advisorInput)}`,
  ].join('\n');

  let validationErrors = [];
  for (let attempt = 1; attempt <= MAX_RECOMMENDATION_ATTEMPTS; attempt += 1) {
    const prompt = validationErrors.length
      ? `${basePrompt}\nPrevious answer was rejected by strict validator for these reasons:\n- ${validationErrors.join('\n- ')}\nReturn a corrected valid JSON that fixes all listed issues.`
      : basePrompt;

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
      validationErrors = validateRecommendationProposal(advisorInput, recommendation);
      if (!validationErrors.length) {
        const transferObject = buildDealsTransferObject(advisorInput, recommendation);
        saveTillDealsLastRecommendation(transferObject);
        return transferObject;
      }

      writeLog('warn', 'TillDeals proposition failed validation gate.', {
        attempt,
        issues: validationErrors,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  clearTillDealsLastRecommendation();
  throw new Error(`No valid proposition generated after ${MAX_RECOMMENDATION_ATTEMPTS} attempts. Validation errors: ${validationErrors.join(' | ')}`);
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

  trust.restrictNavigation(window.webContents);
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
  mainWindow = window;
  window.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  writeLog('info', 'Second launch blocked; focusing existing window.');
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
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
    if (!account.canUseAi()) return account.paymentRequired('ai_service', 'AI features require the TillDeals AI service.');
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
    if (!account.canUseAi()) return account.paymentRequired('ai_service', 'AI features require the TillDeals AI service.');
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
  account.registerAccountIpc(ipcMain, {
    writeLog,
    summarizeHardware: buildHardwareDataLayer,
    broadcast: (channel) => mainWindow?.webContents.send(channel),
  });
  registerAuthIpc(ipcMain, {
    auth: createAuth({ app, safeStorage, log: writeLog }),
    isTrustedSender: trust.isTrustedSender,
    log: writeLog,
  });
  const installedWindows = process.platform === 'win32' && process.arch === 'x64' && app.isPackaged
    && !process.env.PORTABLE_EXECUTABLE_FILE
    && fs.existsSync(path.join(path.dirname(app.getPath('exe')), 'Uninstall TillDeals Hardware.exe'));
  const updates = createUpdates({
    updater: installedWindows ? require('electron-updater').autoUpdater : null,
    currentVersion: app.getVersion(),
    supported: installedWindows,
    unsupportedReason: !app.isPackaged ? 'development' : process.platform !== 'win32' || process.arch !== 'x64' ? 'platform' : 'installer',
    log: writeLog,
    broadcast: (channel, state) => mainWindow?.webContents.send(channel, state),
  });
  registerUpdatesIpc(ipcMain, { updates, isTrustedSender: trust.isTrustedSender, log: writeLog });
  createWindow();
  updates.check();

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
