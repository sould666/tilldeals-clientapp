const byteFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

let refreshTimer;
const diagnosisState = { mode: 'amateur', area: null, symptom: null, query: '', checkIndex: 0, outcome: null };

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return t('status.notReported');
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${byteFormatter.format(value / 1024 ** index)} ${units[index]}`;
}

function present(value) {
  return value === undefined || value === null || value === '' ? t('status.notReported') : String(value);
}

function list(values, formatter = present) {
  return values?.length ? values.map(formatter).join(', ') : t('status.notReported');
}

function localizedSource(source) {
  if (source === 'Local operating system') return getLocale() === 'pl' ? 'Lokalny system operacyjny' : source;
  if (source === 'Windows host (via WSL)') return getLocale() === 'pl' ? 'Host Windows (przez WSL)' : source;
  return source;
}

function slotSummary(memorySlots) {
  if (!memorySlots) return t('status.notReported');
  return t('status.usedSlots', { used: memorySlots.used ?? t('hardware.unknown'), total: memorySlots.total ?? t('hardware.unknown') });
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

  if (!diagnosisState.area) {
    const title = document.createElement('h3');
    title.textContent = t('diagnosis.chooseArea');
    target.append(title);
    const explanation = document.createElement('p');
    explanation.className = 'utility-note';
    explanation.textContent = t('diagnosis.chooseAreaHelp');
    target.append(explanation);
    const areaChoices = document.createElement('div');
    areaChoices.className = 'diagnosis-areas';
    DIAGNOSIS_AREAS.forEach((area) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'area-choice';
      button.innerHTML = `<span class="area-icon">${area.icon}</span><span>${area.name}</span>`;
      button.addEventListener('click', () => {
        diagnosisState.area = area.id;
        diagnosisState.query = '';
        renderDiagnosisFlow();
      });
      areaChoices.append(button);
    });
    target.append(areaChoices);
    return;
  }

  if (diagnosisState.area && !diagnosisState.symptom) {
    target.append(makeActionButton(t('diagnosis.backAreas'), 'text-action', () => {
      diagnosisState.area = null;
      diagnosisState.query = '';
      renderDiagnosisFlow();
    }));
    const title = document.createElement('h3');
    title.textContent = t('diagnosis.chooseSymptom');
    target.append(title);
    const search = document.createElement('input');
    const query = diagnosisState.query.trim().toLocaleLowerCase();
    search.className = `diagnosis-search${query ? ' has-query' : ''}`;
    search.type = 'search';
    search.placeholder = t('diagnosis.searchPlaceholder');
    search.value = diagnosisState.query;
    search.setAttribute('aria-label', t('diagnosis.searchPlaceholder'));
    search.addEventListener('input', (event) => {
      diagnosisState.query = event.target.value;
      renderDiagnosisFlow();
      document.querySelector('.diagnosis-search')?.focus();
    });
    target.append(search);

    if (query) {
      const matches = DIAGNOSIS_TREE.filter((category) => category.area === diagnosisState.area)
        .flatMap((category) => category.symptoms.filter((symptom) => symptom.toLocaleLowerCase().includes(query)));
      const choices = document.createElement('div');
      choices.className = 'diagnosis-choices symptoms';
      matches.forEach((symptom) => choices.append(makeActionButton(symptom, 'diagnosis-choice', () => {
        diagnosisState.symptom = symptom;
        diagnosisState.query = '';
        diagnosisState.checkIndex = 0;
        diagnosisState.outcome = null;
        renderDiagnosisFlow();
      })));
      if (!matches.length) {
        const empty = document.createElement('p');
        empty.className = 'diagnosis-empty';
        empty.textContent = t('diagnosis.noSearchResults', { query: diagnosisState.query });
        target.append(empty);
      }
      target.append(choices);
    }
    return;
  }

  const category = categoryForSymptom(diagnosisState.symptom);

  target.append(makeActionButton(t('diagnosis.backSymptoms'), 'text-action', () => {
    diagnosisState.area = null;
    diagnosisState.symptom = null;
    diagnosisState.checkIndex = 0;
    diagnosisState.outcome = null;
    renderDiagnosisFlow();
  }));

  const outcomeData = typeof getDiagnosisOutcome === 'function' ? getDiagnosisOutcome(diagnosisState.symptom) : null;
  if (outcomeData) {
    renderChecklistWizard(target, outcomeData);
    return;
  }

  const title = document.createElement('h3');
  title.textContent = t('diagnosis.amateurSteps');
  target.append(title);
  const steps = document.createElement('ol');
  steps.className = 'diagnosis-steps';
  diagnosisSteps(category?.name || 'Inne', diagnosisState.symptom, 'amateur').forEach((step) => {
    const item = document.createElement('li');
    item.textContent = step;
    steps.append(item);
  });
  target.append(steps);
}

function renderChecklistWizard(target, outcomeData) {
  if (diagnosisState.outcome) {
    renderOutcomeCard(target, diagnosisState.outcome);
    return;
  }

  const check = outcomeData.checks[diagnosisState.checkIndex];
  if (!check) {
    diagnosisState.outcome = outcomeData.finalOutcome;
    renderOutcomeCard(target, diagnosisState.outcome);
    return;
  }

  const title = document.createElement('h3');
  title.textContent = t('diagnosis.check');
  target.append(title);

  const question = document.createElement('p');
  question.className = 'checklist-question';
  question.textContent = check.question;
  target.append(question);

  const answers = document.createElement('div');
  answers.className = 'diagnosis-mode';
  answers.append(makeActionButton(t('diagnosis.yes'), 'mode-button', () => {
    diagnosisState.checkIndex += 1;
    renderDiagnosisFlow();
  }));
  answers.append(makeActionButton(t('diagnosis.no'), 'mode-button', () => {
    diagnosisState.outcome = check.no || outcomeData.finalOutcome;
    renderDiagnosisFlow();
  }));
  target.append(answers);
}

function renderOutcomeCard(target, outcome) {
  const card = document.createElement('div');
  card.className = 'outcome-card';
  card.innerHTML = `
    <p class="eyebrow">${t('diagnosis.suggestedReplacement')}</p>
    <h3>${present(outcome.label)}</h3>
    <p>${present(outcome.reason)}</p>
  `;
  const result = document.createElement('p');
  result.className = 'utility-note';
  const searchButton = makeActionButton(t('diagnosis.findReplacement'), 'secondary-action', () => findReplacementDevice(outcome, searchButton, result));
  card.append(searchButton, result);
  target.append(card);
}

async function findReplacementDevice(outcome, button, resultElement) {
  button.disabled = true;
  resultElement.textContent = t('diagnosis.searching');
  try {
    const response = await window.llm.findReplacementDevice({
      component: outcome.component,
      label: outcome.label,
      reason: outcome.reason,
      hardwareSnapshot: window.latestSnapshot,
    });
    resultElement.textContent = response.ok ? response.message : t('diagnosis.replacementFailed', { message: response.message });
  } catch (error) {
    resultElement.textContent = t('diagnosis.replacementFailed', { message: error.message });
  } finally {
    button.disabled = false;
  }
}

function setupNavigation() {
  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.nav));
  });
  document.querySelector('#back-to-profile').addEventListener('click', () => showView('profile'));
  document.querySelector('[data-nav="diagnosis"]').addEventListener('click', () => {
    showView('diagnosis');
    diagnosisState.area = null;
    diagnosisState.symptom = null;
    diagnosisState.query = '';
    diagnosisState.checkIndex = 0;
    diagnosisState.outcome = null;
    renderDiagnosisFlow();
  });
  document.querySelector('#auto-refresh').addEventListener('change', (event) => {
    clearInterval(refreshTimer);
    refreshTimer = event.target.checked ? setInterval(loadHardware, 60000) : undefined;
    window.hardware.log('info', 'Auto-refresh setting changed.', { enabled: event.target.checked });
  });
}

function render(snapshot) {
  const { os, system, cpu, memory, memoryLayout, memorySlots, graphics, baseboard, bios, disks, filesystems, network, battery, audio, deviceInventory, temperatures } = snapshot;
  document.querySelector('#updated-at').textContent = t('hardware.updated', { date: new Date(snapshot.collectedAt).toLocaleString(), source: localizedSource(snapshot.source) });
  document.querySelector('#summary').replaceChildren(
    ...[
      [t('hardware.operatingSystem'), `${os.distro} ${os.release}`],
      [t('hardware.processor'), cpu.brand],
      [t('hardware.installedMemory'), formatBytes(memory.total)],
      [t('hardware.graphics'), list(graphics.controllers, (gpu) => gpu.model)],
    ].map(([label, value]) => {
      const item = document.createElement('div');
      item.innerHTML = `<span>${label}</span><strong>${present(value)}</strong>`;
      return item;
    }),
  );

  document.querySelector('#details').replaceChildren();
  addSection(t('hardware.system'), [
    [t('hardware.manufacturer'), system.manufacturer],
    [t('hardware.model'), system.model],
    [t('hardware.version'), system.version],
    [t('hardware.platform'), os.platform],
    [t('hardware.kernel'), os.kernel],
    [t('hardware.architecture'), os.arch],
  ]);
  addSection(t('hardware.processor'), [
    [t('hardware.model'), cpu.brand],
    [t('hardware.physicalCores'), cpu.physicalCores],
    [t('hardware.logicalCores'), cpu.cores],
    [t('hardware.speed'), cpu.speed ? `${cpu.speed} GHz` : null],
    [t('hardware.socket'), cpu.socket],
    [t('hardware.temperature'), temperatures?.main === null || temperatures?.main === undefined ? t('status.notReported') : `${temperatures.main} °C`],
    [t('hardware.coreTemperatures'), list(temperatures?.cores, (temperature) => `${temperature} °C`)],
    [t('hardware.sensorStatus'), temperatures?.cpuSource],
  ]);
  addSection(t('hardware.memory'), [
    [t('hardware.installed'), formatBytes(memory.total)],
    [t('hardware.available'), formatBytes(memory.available)],
    [t('hardware.active'), formatBytes(memory.active)],
    [t('hardware.slots'), slotSummary(memorySlots)],
    [t('hardware.maxCapacity'), formatBytes(memorySlots?.maxCapacity)],
    [t('hardware.modules'), list(memoryLayout, (module) => `${formatBytes(module.size)} ${module.type || ''} ${module.clockSpeed ? `${module.clockSpeed} MHz` : ''}`.trim())],
  ]);
  addSection(t('hardware.graphics'), [
    [t('hardware.controllers'), list(graphics.controllers, (gpu) => `${gpu.vendor || t('hardware.unknown')} ${gpu.model || ''}`.trim())],
    [t('hardware.vram'), list(graphics.controllers, (gpu) => formatBytes(gpu.vram))],
    [t('hardware.temperature'), list(temperatures?.gpu, (temperature) => `${temperature} °C`)],
    [t('hardware.powerDraw'), list(graphics.controllers, (gpu) => gpu.powerDraw ? `${gpu.powerDraw} W` : t('status.notReported'))],
    [t('hardware.displays'), list(graphics.displays, (display) => `${display.model || t('hardware.unknown')} ${display.resolutionX || '?'}x${display.resolutionY || '?'}`)],
  ]);
  addSection(t('hardware.mainboardBios'), [
    [t('hardware.mainboard'), `${baseboard.manufacturer || ''} ${baseboard.model || ''}`.trim()],
    [t('hardware.biosVendor'), bios.vendor],
    [t('hardware.biosVersion'), bios.version],
    [t('hardware.biosDate'), bios.releaseDate],
  ]);
  addSection(t('hardware.storage'), [
    [t('hardware.physicalDisks'), list(disks, (disk) => `${disk.name || disk.model || t('hardware.unknown')} (${formatBytes(disk.size)})`)],
    [t('hardware.filesystems'), list(filesystems, (filesystem) => `${filesystem.fs} (${formatBytes(filesystem.used)} / ${formatBytes(filesystem.size)})`)],
  ]);
  addSection(t('hardware.inventorySection'), [
    [t('hardware.detectedDevices'), list(deviceInventory, (device) => `${device.category || t('hardware.unknown')}: ${device.name || device.model || t('hardware.unknown')}`)],
  ]);
  addSection(t('hardware.network'), [
    [t('hardware.interfaces'), list(network, (item) => `${item.iface || item.ifaceName || t('hardware.unknown')}${item.ip4 ? `: ${item.ip4}` : ''}`)],
    [t('hardware.battery'), battery.hasBattery ? `${battery.percent}%${battery.isCharging ? `, ${t('hardware.charging')}` : ''}` : t('hardware.noBattery')],
    [t('hardware.audio'), list(audio, (device) => device.name || device.manufacturer)],
  ]);
}

async function loadHardware() {
  const button = document.querySelector('#refresh');
  button.disabled = true;
  document.querySelector('#updated-at').textContent = t('app.reading');
  window.hardware.log('info', 'Renderer requested a hardware refresh.');

  try {
    const snapshot = await window.hardware.read();
    window.latestSnapshot = snapshot;
    window.hardware.log('info', 'Renderer received hardware data.', { source: snapshot.source });
    render(snapshot);
  } catch (error) {
    window.hardware.log('error', 'Renderer hardware refresh failed.', { message: error.message, stack: error.stack });
    document.querySelector('#updated-at').textContent = t('hardware.readFailed', { message: error.message });
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

async function refreshOpenAiKeyStatus() {
  const status = await window.settings.getOpenAiKeyStatus();
  const statusText = document.querySelector('#openai-key-status');
  if (!status.encryptionAvailable) {
    statusText.textContent = t('settings.secureUnavailable');
  } else {
    statusText.textContent = status.hasKey ? t('settings.keySaved') : t('settings.noKey');
  }
}

function setupSettings() {
  refreshOpenAiKeyStatus();
  document.querySelector('#save-openai-key').addEventListener('click', async () => {
    const input = document.querySelector('#openai-key');
    const result = await window.settings.setOpenAiKey(input.value);
    input.value = '';
    document.querySelector('#openai-key-status').textContent = result.ok ? t('settings.saved') : t('settings.saveFailed', { message: result.message });
    await refreshOpenAiKeyStatus();
  });
  document.querySelector('#test-openai-key').addEventListener('click', async (event) => {
    event.target.disabled = true;
    const statusText = document.querySelector('#openai-key-status');
    statusText.textContent = t('settings.testing');
    const result = await window.settings.testOpenAiConnection();
    statusText.textContent = result.message;
    event.target.disabled = false;
  });
}

function setupLocale() {
  const localeSelect = document.querySelector('#locale');
  localeSelect.value = getLocale();
  localeSelect.addEventListener('change', (event) => setLocale(event.target.value));
  window.addEventListener('localechange', () => {
    localeSelect.value = getLocale();
    if (window.latestSnapshot) {
      render(window.latestSnapshot);
    }
    renderDiagnosisFlow();
    refreshOpenAiKeyStatus();
  });
}

setupNavigation();
setupSettings();
setupLocale();
document.querySelector('#refresh').addEventListener('click', loadHardware);
loadHardware();
