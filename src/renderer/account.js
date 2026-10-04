const MYDEALS_CATEGORIES = ['processor', 'motherboard', 'ram', 'drives', 'monitor', 'graphics', 'other'];

function setStatus(selector, text) {
  document.querySelector(selector).textContent = text;
}

function syncStatusText(profile, backend) {
  if (!backend.businessApisAvailable) return profile ? t('backend.localProfile') : t('backend.profileHelp');
  if (profile?.syncedAt) return t('account.synced', { date: new Date(profile.syncedAt).toLocaleString() });
  return t('account.notSynced', { message: profile?.syncError || t('account.pending') });
}

async function renderAccountSettings() {
  const state = await window.account.getState();
  document.querySelector('#account-email').value = state.profile?.email || '';
  document.querySelector('#account-name').value = state.profile?.displayName || '';
  setStatus('#account-status', syncStatusText(state.profile, state.backend));
  renderBackendHealth(state.backend.health);
  const { entitlements } = state;
  setStatus('#account-plan', t('account.plan', {
    limit: entitlements.trackedItemLimit,
    ai: entitlements.aiService ? t('diagnosis.yes') : t('diagnosis.no'),
    refresh: Math.min(...entitlements.refreshHours),
    key: state.machineKeyShort,
  }) + (state.isVirtual ? ` ${t('account.virtual')}` : ''));
  return state;
}

function renderBackendHealth(health) {
  const text = health.status === 'ok' ? t('backend.healthy', { release: health.release })
    : health.status === 'error' ? t('backend.failed', { message: health.message })
      : t('backend.unchecked');
  setStatus('#backend-health-status', text);
}

async function checkBackendHealth() {
  const button = document.querySelector('#backend-check-health');
  button.disabled = true;
  setStatus('#backend-health-status', t('backend.checking'));
  try {
    const state = await window.account.checkBackendHealth();
    renderBackendHealth(state.health);
  } catch (error) {
    window.hardware.log('error', 'Could not check TillDeals health.', { message: error.message });
    setStatus('#backend-health-status', t('backend.failed', { message: error.message }));
  } finally {
    button.disabled = false;
  }
}

function readProfileForm(emailSelector, nameSelector) {
  return {
    email: document.querySelector(emailSelector).value,
    displayName: document.querySelector(nameSelector).value,
  };
}

function setupOnboarding(state) {
  document.querySelector('#onboarding-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    setStatus('#onboarding-status', t('account.saving'));
    const result = await window.account.saveProfile({
      ...readProfileForm('#onboarding-email', '#onboarding-name'),
      acceptTerms: document.querySelector('#onboarding-terms').checked,
    });
    button.disabled = false;
    if (!result.ok) {
      setStatus('#onboarding-status', t(`account.invalid.${result.field}`));
      return;
    }
    document.body.classList.remove('onboarding');
    showView('profile');
    renderAccountSettings();
  });

  if (!state.profileComplete) {
    document.body.classList.add('onboarding');
    showView('onboarding');
  }
}

function setupAccountSettings() {
  document.querySelector('#backend-check-health').addEventListener('click', checkBackendHealth);
  document.querySelector('#account-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('#account-status', t('account.saving'));
    const result = await window.account.saveProfile(readProfileForm('#account-email', '#account-name'));
    if (!result.ok) {
      setStatus('#account-status', t(`account.invalid.${result.field}`));
      return;
    }
    await renderAccountSettings();
  });
  document.querySelector('#account-refresh-plan').addEventListener('click', async (event) => {
    event.target.disabled = true;
    const result = await window.account.refreshEntitlements();
    await renderAccountSettings();
    if (!result.ok) setStatus('#account-status', t('account.planFailed', { message: remoteActionMessage(result) }));
    event.target.disabled = false;
    renderMyDeals();
  });
}

function bestDealFor(item, deals) {
  return deals
    .filter((deal) => deal.trackedItemId === item.id)
    .sort((a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity))[0] || null;
}

function buildDealCell(deal) {
  const cell = document.createElement('td');
  if (!deal) {
    cell.textContent = '\u2014';
    return cell;
  }
  const text = document.createElement('span');
  text.textContent = [deal.title, deal.price !== null ? `${deal.price} ${deal.currency}`.trim() : null, deal.shop].filter(Boolean).join(' | ');
  cell.append(text);
  if (deal.hasLink) {
    cell.append(' ', makeActionButton(t('mydeals.open'), 'text-action', () => window.mydeals.openDeal(deal.id)));
  }
  return cell;
}

async function renderMyDeals() {
  const data = await window.mydeals.get();
  const { entitlements } = data;
  setStatus('#mydeals-plan', t('mydeals.plan', { count: data.items.length, limit: entitlements.trackedItemLimit }));

  const select = document.querySelector('#mydeals-refresh');
  select.replaceChildren(...data.refreshOptions.map((hours) => {
    const option = document.createElement('option');
    option.value = String(hours);
    const paid = !entitlements.refreshHours.includes(hours);
    option.textContent = `${t('mydeals.every', { hours })}${paid ? ` (${t('mydeals.paid')})` : ''}`;
    option.selected = hours === data.refreshHours;
    return option;
  }));

  const categorySelect = document.querySelector('#mydeals-add-category');
  const selectedCategory = categorySelect.value || 'other';
  categorySelect.replaceChildren(...MYDEALS_CATEGORIES.map((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = t(`mydeals.cat.${category}`);
    option.selected = category === selectedCategory;
    return option;
  }));

  const body = document.querySelector('#mydeals-table-body');
  body.replaceChildren(...data.items.map((item) => {
    const row = document.createElement('tr');
    [item.name, t(`mydeals.cat.${item.category}`), t(`mydeals.source.${item.source}`)].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    row.append(buildDealCell(bestDealFor(item, data.deals)));
    const actionCell = document.createElement('td');
    actionCell.append(makeActionButton(t('mydeals.remove'), 'text-action', async () => {
      await window.tilldeals.removeTrackedItem(item.id);
      window.dispatchEvent(new CustomEvent('trackedchange', { detail: { source: 'mydeals' } }));
    }));
    row.append(actionCell);
    return row;
  }));
  if (!data.items.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = t('mydeals.empty');
    row.append(cell);
    body.append(row);
  }

  setStatus('#mydeals-updated', !data.backend.businessApisAvailable
    ? (data.fetchedAt ? t('backend.cachedDeals', { date: new Date(data.fetchedAt).toLocaleString() }) : t('backend.unavailable'))
    : data.fetchedAt
      ? t('mydeals.updated', { date: new Date(data.fetchedAt).toLocaleString(), next: new Date(data.nextRefreshAt).toLocaleString() })
      : t('mydeals.noData'));
}

function setupMyDeals() {
  document.querySelector('[data-nav="mydeals"]').addEventListener('click', renderMyDeals);
  document.querySelector('#mydeals-refresh').addEventListener('change', async (event) => {
    const result = await window.mydeals.setRefreshInterval(Number(event.target.value));
    renderPaywall('#mydeals-paywall', result);
    setStatus('#mydeals-refresh-status', result.ok ? t('mydeals.refreshSaved') : result.message);
    renderMyDeals();
  });
  document.querySelector('#mydeals-add-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.querySelector('#mydeals-add-name');
    const result = await window.tilldeals.addTrackedItems([{
      name: input.value,
      category: document.querySelector('#mydeals-add-category').value,
    }], 'manual');
    renderPaywall('#mydeals-paywall', result);
    if (!result.ok) {
      setStatus('#mydeals-add-status', result.message);
      return;
    }
    input.value = '';
    setStatus('#mydeals-add-status', result.synced ? t('tilldeals.trackSaved') : t('tilldeals.trackSavedLocal'));
    window.dispatchEvent(new CustomEvent('trackedchange', { detail: { source: 'mydeals' } }));
  });
  window.addEventListener('trackedchange', renderMyDeals);
  window.mydeals.onUpdated(renderMyDeals);
  renderMyDeals();
}

function setupContact() {
  document.querySelector('#contact-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    setStatus('#contact-status', t('contact.sending'));
    const result = await window.consultation.request({
      topic: document.querySelector('#contact-topic').value,
      message: document.querySelector('#contact-message').value,
      includeHardware: document.querySelector('#contact-include-hardware').checked,
      hardwareSnapshot: window.latestSnapshot,
    });
    setStatus('#contact-status', result.ok ? t('contact.opened') : t('contact.failed', { message: remoteActionMessage(result) }));
    button.disabled = false;
  });
}

async function setupAccount() {
  setupAccountSettings();
  setupMyDeals();
  setupContact();
  const state = await renderAccountSettings();
  setupOnboarding(state);
  checkBackendHealth();
  window.addEventListener('localechange', () => {
    renderAccountSettings();
    renderMyDeals();
  });
}

setupAccount();
