const byteFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

let refreshTimer;
const diagnosisState = { mode: 'amateur', area: null, symptom: null, query: '', checkIndex: 0, outcome: null };
let tillDealsTransferObject = null;
let tillDealsRows = new Map();
let trackedItemNames = new Set();

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

function currentViewName() {
  return document.querySelector('[data-view]:not([hidden])')?.dataset.view || 'profile';
}

function updateMainHeading(viewName = currentViewName()) {
  const heading = document.querySelector('#main-heading');
  if (viewName === 'tilldeals') {
    heading.hidden = true;
    return;
  }
  heading.hidden = false;
  heading.textContent = t(`app.heading.${viewName}`);
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
  updateMainHeading(viewName);
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

function renderPaywall(target, response) {
  const container = typeof target === 'string' ? document.querySelector(target) : target;
  container.replaceChildren();
  if (response?.code !== 'PAYMENT_REQUIRED') return;
  const box = document.createElement('div');
  box.className = 'paywall';
  const note = document.createElement('p');
  note.textContent = t(`paywall.${response.product}`, { limit: response.limit ?? '', needed: response.needed ?? 1 });
  const status = document.createElement('p');
  status.className = 'utility-note';
  const button = makeActionButton(t('paywall.buy'), 'secondary-action', async () => {
    button.disabled = true;
    status.textContent = t('paywall.opening');
    const result = await window.billing.checkout(response.product, response.needed || 1);
    status.textContent = result.ok ? t('paywall.opened') : t('paywall.failed', { message: result.message });
    button.disabled = false;
  });
  box.append(note, button, status);
  container.append(box);
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
  if (outcome.type === 'resolved') {
    card.className = 'outcome-card resolved';
    card.innerHTML = `
      <p class="eyebrow">${t('diagnosis.resolvedWithoutReplacement')}</p>
      <h3>${present(outcome.label)}</h3>
      <p>${present(outcome.resolution)}</p>
    `;
    target.append(card);
    return;
  }

  card.className = 'outcome-card';
  card.innerHTML = `
    <p class="eyebrow">${t('diagnosis.suggestedReplacement')}</p>
    <h3>${present(outcome.label)}</h3>
    <p>${present(outcome.reason)}</p>
  `;
  const result = document.createElement('p');
  result.className = 'utility-note';
  const paywall = document.createElement('div');
  const searchButton = makeActionButton(t('diagnosis.findReplacement'), 'secondary-action', () => findReplacementDevice(outcome, searchButton, result, paywall));
  card.append(searchButton, result, paywall);
  target.append(card);
}

async function findReplacementDevice(outcome, button, resultElement, paywall) {
  button.disabled = true;
  resultElement.textContent = t('diagnosis.searching');
  renderPaywall(paywall, null);
  try {
    const response = await window.llm.findReplacementDevice({
      type: outcome.type,
      component: outcome.component,
      label: outcome.label,
      reason: outcome.reason,
      hardwareSnapshot: window.latestSnapshot,
    });
    resultElement.textContent = response.ok ? response.message : t('diagnosis.replacementFailed', { message: response.message });
    renderPaywall(paywall, response);
  } catch (error) {
    resultElement.textContent = t('diagnosis.replacementFailed', { message: error.message });
  } finally {
    button.disabled = false;
  }
}

async function chooseTillDealsUpgrade() {
  const button = document.querySelector('#tilldeals-ai-button');
  const status = document.querySelector('#tilldeals-status');
  const output = document.querySelector('#tilldeals-json');
  const result = document.querySelector('#tilldeals-result');
  const spendingTier = currentSpendingTier();
  const snapshot = window.latestSnapshot;

  if (!snapshot) {
    status.textContent = t('tilldeals.noSnapshot');
    return;
  }

  button.disabled = true;
  status.textContent = t('tilldeals.searching');
  renderPaywall('#tilldeals-paywall', null);
  output.hidden = true;
  output.textContent = '';
  result.hidden = true;

  try {
    const response = await window.llm.chooseBestHardwareUpgrade({
      hardwareSnapshot: snapshot,
      locale: getLocale(),
      spendingTier,
    });
    if (!response.ok) {
      status.textContent = t('tilldeals.failed', { message: response.message });
      renderPaywall('#tilldeals-paywall', response);
      return;
    }
    tillDealsTransferObject = response.transferObject;
    renderTillDealsTable(tillDealsTransferObject);
    output.textContent = JSON.stringify(tillDealsTransferObject, null, 2);
    output.hidden = false;
    status.textContent = t('tilldeals.ready');
  } catch (error) {
    status.textContent = t('tilldeals.failed', { message: error.message });
  } finally {
    button.disabled = false;
  }
}

const TILLDEALS_TIER_ORDER = ['cheap', 'moderate', 'expensive', 'takeMyMoney'];
const TILLDEALS_FIELD_ROWS = [
  { key: 'processor', labelKey: 'tilldeals.cat.cpu' },
  { key: 'motherboard', labelKey: 'tilldeals.cat.motherboard' },
  { key: 'ram', labelKey: 'tilldeals.cat.ram' },
  { key: 'drives', labelKey: 'tilldeals.cat.storage' },
  { key: 'monitor', labelKey: 'tilldeals.cat.display' },
  { key: 'additional1', labelKey: 'tilldeals.cat.extra1' },
  { key: 'additional2', labelKey: 'tilldeals.cat.extra2' },
];

function currentSpendingTier() {
  const slider = document.querySelector('#spending-tier');
  return TILLDEALS_TIER_ORDER[Number(slider.value)] || 'moderate';
}

function updateSpendingTierLabel() {
  document.querySelector('#spending-tier-value').textContent = t(`tilldeals.tier.${currentSpendingTier()}`);
}

function dependencyText(dependsOn) {
  if (!dependsOn || !dependsOn.length) return '\u2014';
  return `${t('tilldeals.dependsOnPrefix')}${dependsOn.join(', ')}`;
}

function summarizeCurrentField(currentSetup, fieldKey) {
  const liveSnapshot = window.latestSnapshot;
  const storageText = Array.isArray(liveSnapshot?.disks) && liveSnapshot.disks.length
    ? liveSnapshot.disks.map((item) => item.name || item.model || t('hardware.unknown')).join(', ')
    : Array.isArray(currentSetup?.storage) && currentSetup.storage.length
      ? currentSetup.storage.map((item) => item.name || t('hardware.unknown')).join(', ')
    : null;
  const displayText = Array.isArray(liveSnapshot?.graphics?.displays) && liveSnapshot.graphics.displays.length
    ? liveSnapshot.graphics.displays.map((item) => item.model || t('hardware.unknown')).join(', ')
    : Array.isArray(currentSetup?.displays) && currentSetup.displays.length
      ? currentSetup.displays.map((item) => item.model || t('hardware.unknown')).join(', ')
    : null;

  switch (fieldKey) {
    case 'processor':
      return liveSnapshot?.cpu?.brand || currentSetup?.cpuBrand || null;
    case 'motherboard':
      return `${liveSnapshot?.baseboard?.manufacturer || ''} ${liveSnapshot?.baseboard?.model || ''}`.trim() || currentSetup?.motherboard || null;
    case 'ram':
      return currentSetup?.ramProfile?.modulesSummary
        || (liveSnapshot?.memory?.total ? formatBytes(liveSnapshot.memory.total) : (currentSetup?.memoryTotalBytes ? formatBytes(currentSetup.memoryTotalBytes) : null));
    case 'drives':
      return storageText;
    case 'monitor':
      return displayText;
    default:
      return null;
  }
}

function isNullLikeText(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || ['null', 'none', 'n/a', 'na', '-', 'brak', 'brak danych'].includes(normalized);
}

function proposalDescription(proposal) {
  const parts = [];
  if (proposal?.tier) parts.push(t(`tilldeals.tier.${proposal.tier}`));
  if (proposal?.estimatedTotalCost) parts.push(`${getLocale() === 'pl' ? 'Szacowany koszt' : 'Estimated cost'}: ${proposal.estimatedTotalCost}`);
  if (proposal?.estimatedRange) parts.push(proposal.estimatedRange);
  if (proposal?.requiresPairing?.length) parts.push(dependencyText(proposal.requiresPairing));
  if (proposal?.reason) parts.push(proposal.reason);
  return parts.join(' | ');
}

function toggleMarkedRow(key) {
  const rowInfo = tillDealsRows.get(key);
  if (!rowInfo || rowInfo.tracked) return;
  rowInfo.selected = !rowInfo.selected;
  rowInfo.cell.classList.toggle('cell-marked', rowInfo.selected);
  rowInfo.button.textContent = rowInfo.selected ? '✓' : '+';
}

function buildTrackCell(value, key) {
  const cell = document.createElement('td');
  const rawValue = typeof value === 'string' ? value : value?.value;
  const rawCost = value && typeof value === 'object' ? value.estimatedCost : null;
  const normalizedValue = isNullLikeText(rawValue) ? null : rawValue;
  const normalizedCost = isNullLikeText(rawCost) ? null : rawCost;
  if (!normalizedValue) {
    cell.textContent = '\u2014';
    return cell;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'track-cell';

  const valueWrap = document.createElement('span');
  valueWrap.textContent = normalizedCost ? `${normalizedValue} (${normalizedCost})` : normalizedValue;

  const button = makeActionButton('+', 'trace-add-inline', () => toggleMarkedRow(key));
  button.title = t('tilldeals.markToTrack');

  wrapper.append(valueWrap, button);
  cell.append(wrapper);

  const tracked = trackedItemNames.has(normalizedValue.toLowerCase());
  if (tracked) {
    button.disabled = true;
    button.textContent = '✓';
    cell.classList.add('cell-tracked');
  }

  tillDealsRows.set(key, {
    button,
    cell,
    selected: false,
    tracked,
    entryData: {
      name: normalizedValue,
      category: key.replace(/^proposal-\d+-/, ''),
    },
  });

  return cell;
}

function renderTillDealsTable(transferObject) {
  const result = document.querySelector('#tilldeals-result');
  const body = document.querySelector('#tilldeals-table-body');
  const singleProposition = transferObject?.recommendation?.proposition
    || (Array.isArray(transferObject?.recommendation?.propositions) ? transferObject.recommendation.propositions[0] : null)
    || null;
  const currentSetup = transferObject?.currentSetup || {};
  const proposal = singleProposition || { fields: {}, reason: '', requiresPairing: [], tier: null, estimatedTotalCost: '', estimatedRange: '' };
  const descriptionValue = proposalDescription(proposal);

  body.replaceChildren();
  tillDealsRows = new Map();
  document.querySelector('#tilldeals-track-status').textContent = '';
  document.querySelector('#tilldeals-tracking-json').hidden = true;
  document.querySelector('#tilldeals-tracking-json').textContent = '';

  TILLDEALS_FIELD_ROWS.forEach((fieldRow, rowIndex) => {
    const tableRow = document.createElement('tr');
    const fieldNameCell = document.createElement('td');
    fieldNameCell.textContent = t(fieldRow.labelKey);
    tableRow.append(fieldNameCell);

    const currentCell = document.createElement('td');
    currentCell.textContent = present(summarizeCurrentField(currentSetup, fieldRow.key));
    tableRow.append(currentCell);

    const proposalValue = proposal?.fields?.[fieldRow.key] || null;
    const trackKey = `proposal-1-${fieldRow.key}`;
    tableRow.append(buildTrackCell(proposalValue, trackKey));

    if (rowIndex === 0) {
      const descriptionCell = document.createElement('td');
      descriptionCell.className = 'proposal-description-cell';
      descriptionCell.rowSpan = TILLDEALS_FIELD_ROWS.length;
      descriptionCell.textContent = present(descriptionValue);
      tableRow.append(descriptionCell);
    }

    body.append(tableRow);
  });

  result.hidden = body.children.length === 0;
}

async function addMarkedItemsToTracking() {
  const status = document.querySelector('#tilldeals-track-status');
  const output = document.querySelector('#tilldeals-tracking-json');
  const selected = Array.from(tillDealsRows.values()).filter((rowInfo) => rowInfo.selected && !rowInfo.tracked);

  if (!selected.length) {
    status.textContent = t('tilldeals.trackNoneSelected');
    return;
  }

  status.textContent = t('tilldeals.trackSaving');
  renderPaywall('#tilldeals-track-paywall', null);
  try {
    const response = await window.tilldeals.addTrackedItems(selected.map((rowInfo) => rowInfo.entryData), 'ai');
    if (!response.ok) {
      status.textContent = t('tilldeals.trackFailed', { message: response.message });
      renderPaywall('#tilldeals-track-paywall', response);
      return;
    }
    trackedItemNames = new Set(response.items.map((item) => item.name.toLowerCase()));
    selected.forEach((rowInfo) => {
      rowInfo.tracked = true;
      rowInfo.selected = false;
      rowInfo.button.disabled = true;
      rowInfo.button.textContent = '✓';
      rowInfo.cell.classList.remove('cell-marked');
      rowInfo.cell.classList.add('cell-tracked');
    });
    output.textContent = JSON.stringify(response.items, null, 2);
    output.hidden = false;
    status.textContent = response.synced ? t('tilldeals.trackSaved') : t('tilldeals.trackSavedLocal');
    window.dispatchEvent(new CustomEvent('trackedchange', { detail: { source: 'tilldeals' } }));
  } catch (error) {
    status.textContent = t('tilldeals.trackFailed', { message: error.message });
  }
}

async function refreshTrackedItemNames() {
  const items = await window.tilldeals.getTrackedItems();
  trackedItemNames = new Set(items.map((item) => item.name.toLowerCase()));
}

async function loadLastTillDealsRecommendation() {
  await refreshTrackedItemNames();
  const transferObject = await window.tilldeals.getLastRecommendation();
  if (!transferObject) return;
  tillDealsTransferObject = transferObject;
  renderTillDealsTable(transferObject);
  document.querySelector('#tilldeals-json').textContent = JSON.stringify(transferObject, null, 2);
  document.querySelector('#tilldeals-json').hidden = false;
  document.querySelector('#tilldeals-status').textContent = t('tilldeals.lastSaved');
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
    if (tillDealsTransferObject) {
      renderTillDealsTable(tillDealsTransferObject);
    }
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

function setupTillDeals() {
  document.querySelectorAll('.global-logo-bar').forEach((wrap) => {
    const img = wrap.querySelector('img');
    img.addEventListener('error', () => wrap.classList.add('logo-missing'));
    if (img.complete && img.naturalWidth === 0) {
      wrap.classList.add('logo-missing');
    }
  });
  const spendingSlider = document.querySelector('#spending-tier');
  spendingSlider.addEventListener('input', updateSpendingTierLabel);
  updateSpendingTierLabel();
  document.querySelector('#tilldeals-ai-button').addEventListener('click', chooseTillDealsUpgrade);
  document.querySelector('#tilldeals-track-button').addEventListener('click', addMarkedItemsToTracking);
  window.addEventListener('trackedchange', async (event) => {
    if (event.detail?.source === 'tilldeals') return;
    await refreshTrackedItemNames();
    if (tillDealsTransferObject) renderTillDealsTable(tillDealsTransferObject);
  });
  loadLastTillDealsRecommendation();
}

function setupLocale() {
  const localeSelect = document.querySelector('#locale');
  localeSelect.value = getLocale();
  localeSelect.addEventListener('change', (event) => setLocale(event.target.value));
  window.addEventListener('localechange', () => {
    localeSelect.value = getLocale();
    updateMainHeading();
    if (window.latestSnapshot) {
      render(window.latestSnapshot);
    }
    if (tillDealsTransferObject) {
      renderTillDealsTable(tillDealsTransferObject);
    }
    renderDiagnosisFlow();
    refreshOpenAiKeyStatus();
  });
}

setupNavigation();
setupSettings();
setupTillDeals();
setupLocale();
document.querySelector('#refresh').addEventListener('click', loadHardware);
loadHardware();
