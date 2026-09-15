const byteFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

let refreshTimer;
const diagnosisState = { mode: 'amateur', symptom: null };

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return 'Not reported';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${byteFormatter.format(value / 1024 ** index)} ${units[index]}`;
}

function present(value) {
  return value === undefined || value === null || value === '' ? 'Not reported' : String(value);
}

function list(values, formatter = present) {
  return values?.length ? values.map(formatter).join(', ') : 'Not reported';
}

function slotSummary(memorySlots) {
  if (!memorySlots) return 'Not reported';
  return `${memorySlots.used ?? 'Unknown'} used of ${memorySlots.total ?? 'unknown'} slots`;
}

function addSection(title, entries) {
  const template = document.querySelector('#section-template');
  const section = template.content.cloneNode(true);
  section.querySelector('h2').textContent = title;
  const list = section.querySelector('dl');

  entries.forEach(([label, value]) => {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = present(value);
    list.append(term, detail);
  });

  document.querySelector('#details').append(section);
}

function showView(viewName) {
  document.querySelectorAll('[data-view]').forEach((view) => {
    view.hidden = view.dataset.view !== viewName;
  });
  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.classList.toggle('active', button.dataset.nav === viewName);
  });
}

function renderDiagnosis(snapshot) {
  const checks = [
    ['Operating system source', snapshot.source],
    ['Temperature data', snapshot.temperatures?.main !== null || snapshot.temperatures?.cores?.length ? 'Available' : 'Not exposed by driver'],
    ['GPU sensor data', snapshot.temperatures?.gpu?.length ? 'Available' : 'Not exposed by driver'],
    ['Memory slot data', snapshot.memorySlots?.total ? `${snapshot.memorySlots.used} of ${snapshot.memorySlots.total} used` : 'Not reported'],
    ['Device inventory', snapshot.deviceInventory?.length ? `${snapshot.deviceInventory.length} devices` : 'No devices reported'],
  ];
  const target = document.querySelector('#diagnosis-results');
  target.replaceChildren();
  checks.forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'diagnosis-row';
    item.innerHTML = `<span>${label}</span><strong>${present(value)}</strong>`;
    target.append(item);
  });
}

function diagnosisSteps(category, symptom, mode) {
  if (mode === 'amateur') {
    const steps = [
      `Sprawdź spokojnie, czy problem „${symptom}” występuje ponownie.`,
      'Zapisz, kiedy problem się pojawia i co robisz w tym momencie.',
    ];
    if (category === 'Dysk / pliki') {
      steps.push('Zabezpiecz ważne pliki, zanim zaczniesz naprawiać dysk lub system.');
    } else if (category === 'Temperatura / chłodzenie') {
      steps.push('Sprawdź, czy komputer ma wolne otwory wentylacyjne i czy wentylatory pracują.');
    } else if (category === 'Internet / sieć') {
      steps.push('Sprawdź, czy ten sam problem występuje na innym urządzeniu.');
    } else {
      steps.push('Uruchom komputer ponownie i sprawdź, czy problem nadal występuje.');
    }
    steps.push('Zapisz wynik i przekaż go serwisowi lub przejdź do kolejnych testów.');
    return steps;
  }

  const steps = [
    `Potwierdź problem: sprawdź, czy objaw „${symptom}” występuje ponownie.`,
    'Zapisz moment wystąpienia, używany program oraz czynności wykonywane tuż przed problemem.',
  ];

  if (category === 'Temperatura / chłodzenie') {
    steps.push('Sprawdź temperaturę i obciążenie CPU/GPU podczas występowania objawu. Brak odczytu czujnika oznacza brak danych, nie prawidłową temperaturę.');
    steps.push('Sprawdź drożność otworów wentylacyjnych, pracę wentylatorów i kurz po wyłączeniu komputera.');
  } else if (category === 'Dysk / pliki') {
    steps.push('Sprawdź, czy problem dotyczy jednego dysku, konkretnego pliku czy całego systemu.');
    steps.push('Wykonaj kopię ważnych danych przed testami dysku lub naprawą systemu plików.');
  } else if (category === 'Programy / gry') {
    steps.push('Sprawdź, czy inne programy działają poprawnie i czy problem pojawił się po aktualizacji.');
    steps.push('Zapisz dokładny komunikat błędu oraz sprawdź wymagania programu i sterownik grafiki.');
  } else if (category === 'Internet / sieć') {
    steps.push('Sprawdź, czy problem występuje na innym urządzeniu oraz przez inne połączenie, na przykład Ethernet zamiast Wi-Fi.');
    steps.push('Porównaj ping i stabilność połączenia podczas problemu, nie tylko prędkość pobierania.');
  } else {
    steps.push('Sprawdź, czy problem występuje po ponownym uruchomieniu oraz przy odłączonych niedawno podłączonych urządzeniach.');
    steps.push('Porównaj zachowanie komputera bezpośrednio po uruchomieniu i podczas obciążenia.');
  }

  steps.push('Zapisz wynik obserwacji i przejdź do właściwej sekcji sprzętu lub skonsultuj zapisane objawy z serwisem.');
  return steps;
}

function categoryForSymptom(symptom) {
  return DIAGNOSIS_TREE.find((category) => category.symptoms.includes(symptom));
}

function makeActionButton(label, className, onClick) {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function renderDiagnosisFlow() {
  const target = document.querySelector('#diagnosis-flow');
  target.replaceChildren();
  const heading = document.createElement('p');
  heading.className = 'diagnosis-path';
  heading.textContent = [
    'Komputer działa, ale występuje problem',
    diagnosisState.symptom ? categoryForSymptom(diagnosisState.symptom)?.name : null,
    diagnosisState.symptom,
  ].filter(Boolean).join('  /  ');
  target.append(heading);

  const modeBar = document.createElement('div');
  modeBar.className = 'diagnosis-mode';
  modeBar.append(document.createTextNode('Tryb: '));
  ['amateur', 'professional'].forEach((mode) => {
    modeBar.append(makeActionButton(mode === 'amateur' ? 'Początkujący' : 'Profesjonalny', `mode-button${diagnosisState.mode === mode ? ' active' : ''}`, () => {
      diagnosisState.mode = mode;
      renderDiagnosisFlow();
    }));
  });
  target.append(modeBar);

  if (!diagnosisState.symptom) {
    const title = document.createElement('h3');
    title.textContent = 'Co dokładnie się dzieje?';
    target.append(title);
    const explanation = document.createElement('p');
    explanation.className = 'utility-note';
    explanation.textContent = 'Wybierz objaw. Aplikacja przypisze prawdopodobny obszar problemu i przygotuje kolejne kroki.';
    target.append(explanation);
    const choices = document.createElement('div');
    choices.className = 'diagnosis-choices symptoms';
    DIAGNOSIS_TREE.flatMap((category) => category.symptoms).forEach((symptom) => choices.append(makeActionButton(symptom, 'diagnosis-choice', () => {
      diagnosisState.symptom = symptom;
      renderDiagnosisFlow();
    })));
    target.append(choices);
    return;
  }

  const category = categoryForSymptom(diagnosisState.symptom);

  target.append(makeActionButton('← Wszystkie objawy', 'text-action', () => {
    diagnosisState.symptom = null;
    renderDiagnosisFlow();
  }));
  const area = document.createElement('p');
  area.className = 'assigned-area';
  area.textContent = `Prawdopodobny obszar: ${category?.name || 'Inne'}`;
  target.append(area);
  const title = document.createElement('h3');
  title.textContent = diagnosisState.mode === 'amateur' ? 'Co możesz sprawdzić' : 'Kroki oceny technicznej';
  target.append(title);
  const steps = document.createElement('ol');
  steps.className = 'diagnosis-steps';
  diagnosisSteps(category?.name || 'Inne', diagnosisState.symptom, diagnosisState.mode).forEach((step) => {
    const item = document.createElement('li');
    item.textContent = step;
    steps.append(item);
  });
  target.append(steps);
}

function setupNavigation() {
  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.nav));
  });
  document.querySelector('#back-to-profile').addEventListener('click', () => showView('profile'));
  document.querySelector('[data-nav="diagnosis"]').addEventListener('click', () => {
    showView('diagnosis');
    renderDiagnosisFlow();
    if (window.latestSnapshot) renderDiagnosis(window.latestSnapshot);
  });
  document.querySelector('#auto-refresh').addEventListener('change', (event) => {
    clearInterval(refreshTimer);
    refreshTimer = event.target.checked ? setInterval(loadHardware, 60000) : undefined;
    window.hardware.log('info', 'Auto-refresh setting changed.', { enabled: event.target.checked });
  });
}

function render(snapshot) {
  const { os, system, cpu, memory, memoryLayout, memorySlots, graphics, baseboard, bios, disks, filesystems, network, battery, audio, deviceInventory, temperatures } = snapshot;
  document.querySelector('#updated-at').textContent = `Updated ${new Date(snapshot.collectedAt).toLocaleString()} | ${snapshot.source}`;
  document.querySelector('#summary').replaceChildren(
    ...[
      ['Operating system', `${os.distro} ${os.release}`],
      ['Processor', cpu.brand],
      ['Installed memory', formatBytes(memory.total)],
      ['Graphics', list(graphics.controllers, (gpu) => gpu.model)],
    ].map(([label, value]) => {
      const item = document.createElement('div');
      item.innerHTML = `<span>${label}</span><strong>${present(value)}</strong>`;
      return item;
    }),
  );

  document.querySelector('#details').replaceChildren();
  addSection('System', [
    ['Manufacturer', system.manufacturer],
    ['Model', system.model],
    ['Version', system.version],
    ['Platform', os.platform],
    ['Kernel', os.kernel],
    ['Architecture', os.arch],
  ]);
  addSection('Processor', [
    ['Model', cpu.brand],
    ['Physical cores', cpu.physicalCores],
    ['Logical cores', cpu.cores],
    ['Speed', cpu.speed ? `${cpu.speed} GHz` : null],
    ['Socket', cpu.socket],
    ['Temperature', temperatures?.main === null || temperatures?.main === undefined ? 'Not reported' : `${temperatures.main} °C`],
    ['Core temperatures', list(temperatures?.cores, (temperature) => `${temperature} °C`)],
    ['Sensor status', temperatures?.cpuSource],
  ]);
  addSection('Memory', [
    ['Installed', formatBytes(memory.total)],
    ['Available', formatBytes(memory.available)],
    ['Active', formatBytes(memory.active)],
    ['Slots', slotSummary(memorySlots)],
    ['Maximum capacity', formatBytes(memorySlots?.maxCapacity)],
    ['Modules', list(memoryLayout, (module) => `${formatBytes(module.size)} ${module.type || ''} ${module.clockSpeed ? `${module.clockSpeed} MHz` : ''}`.trim())],
  ]);
  addSection('Graphics', [
    ['Controllers', list(graphics.controllers, (gpu) => `${gpu.vendor || 'Unknown'} ${gpu.model || ''}`.trim())],
    ['VRAM', list(graphics.controllers, (gpu) => formatBytes(gpu.vram))],
    ['Temperature', list(temperatures?.gpu, (temperature) => `${temperature} °C`)],
    ['Power draw', list(graphics.controllers, (gpu) => gpu.powerDraw ? `${gpu.powerDraw} W` : 'Not reported')],
    ['Displays', list(graphics.displays, (display) => `${display.model || 'Unknown'} ${display.resolutionX || '?'}x${display.resolutionY || '?'}`)],
  ]);
  addSection('Mainboard & BIOS', [
    ['Mainboard', `${baseboard.manufacturer || ''} ${baseboard.model || ''}`.trim()],
    ['BIOS vendor', bios.vendor],
    ['BIOS version', bios.version],
    ['BIOS date', bios.releaseDate],
  ]);
  addSection('Storage', [
    ['Physical disks', list(disks, (disk) => `${disk.name || disk.model || 'Unknown'} (${formatBytes(disk.size)})`)],
    ['Mounted filesystems', list(filesystems, (filesystem) => `${filesystem.fs} (${formatBytes(filesystem.used)} of ${formatBytes(filesystem.size)})`)],
  ]);
  addSection('PCI & device inventory', [
    ['Detected devices', list(deviceInventory, (device) => `${device.category || 'Device'}: ${device.name || device.model || 'Unknown'}`)],
  ]);
  addSection('Network & peripherals', [
    ['Interfaces', list(network, (item) => `${item.iface || item.ifaceName || 'Unknown'}${item.ip4 ? `: ${item.ip4}` : ''}`)],
    ['Battery', battery.hasBattery ? `${battery.percent}%${battery.isCharging ? ', charging' : ''}` : 'No battery reported'],
    ['Audio', list(audio, (device) => device.name || device.manufacturer)],
  ]);
}

async function loadHardware() {
  const button = document.querySelector('#refresh');
  button.disabled = true;
  document.querySelector('#updated-at').textContent = 'Reading hardware details...';
  window.hardware.log('info', 'Renderer requested a hardware refresh.');

  try {
    const snapshot = await window.hardware.read();
    window.latestSnapshot = snapshot;
    window.hardware.log('info', 'Renderer received hardware data.', { source: snapshot.source });
    render(snapshot);
    renderDiagnosis(snapshot);
  } catch (error) {
    window.hardware.log('error', 'Renderer hardware refresh failed.', { message: error.message, stack: error.stack });
    document.querySelector('#updated-at').textContent = `Could not read hardware details: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

window.addEventListener('error', (event) => {
  window.hardware.log('error', 'Renderer uncaught error.', { message: event.message, filename: event.filename, line: event.lineno, column: event.colno });
});
window.addEventListener('unhandledrejection', (event) => {
  window.hardware.log('error', 'Renderer unhandled rejection.', { reason: String(event.reason) });
});

setupNavigation();
document.querySelector('#refresh').addEventListener('click', loadHardware);
loadHardware();
