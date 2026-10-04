let authViewState = null;
let authBusy = false;
let resendAllowedAt = 0;
let authFeedback = null;

function setAuthFeedback(key, retryAfterSeconds) {
  authFeedback = key ? { key, retryAt: retryAfterSeconds ? Date.now() + retryAfterSeconds * 1000 : 0 } : null;
  renderAuthFeedback();
}

function renderAuthFeedback() {
  const remaining = authFeedback ? Math.max(0, Math.ceil((authFeedback.retryAt - Date.now()) / 1000)) : 0;
  document.querySelector('#auth-status').textContent = authFeedback
    ? t(authFeedback.key) + (remaining > 0 ? ` ${t('auth.retry', { seconds: remaining })}` : '')
    : '';
}

function renderAuth() {
  renderAuthFeedback();
  if (!authViewState) return;
  const expired = authViewState.expiresAt && Date.parse(authViewState.expiresAt) <= Date.now();
  const hasSession = authViewState.status !== 'signedOut';
  const signedIn = hasSession && !expired;
  const remaining = Math.max(0, Math.ceil((resendAllowedAt - Date.now()) / 1000));
  document.querySelector('#auth-state').textContent = t(`auth.${expired ? 'expired' : authViewState.status}`, {
    email: authViewState.account?.email || '',
    date: authViewState.expiresAt ? new Date(authViewState.expiresAt).toLocaleString() : '',
  });
  document.querySelector('#auth-storage').textContent = authViewState.storageNotice
    ? t(`auth.error.${authViewState.storageNotice}`)
    : authViewState.storage === 'encrypted' ? t('auth.encrypted') : '';
  document.querySelector('#auth-request-code').disabled = authBusy || signedIn || remaining > 0;
  document.querySelector('#auth-email').disabled = authBusy || signedIn;
  const challengeActive = authViewState.challenge && Date.parse(authViewState.challenge.expiresAt) > Date.now();
  document.querySelector('#auth-verify-code').disabled = authBusy || !challengeActive;
  document.querySelector('#auth-code').disabled = authBusy || !challengeActive;
  for (const id of ['auth-refresh', 'auth-logout', 'auth-local-logout']) {
    document.querySelector(`#${id}`).disabled = authBusy || !hasSession;
  }
  document.querySelector('#auth-challenge').textContent = authViewState.challenge
    ? t(challengeActive ? 'auth.challenge' : 'auth.error.CODE_EXPIRED', {
      date: new Date(authViewState.challenge.expiresAt).toLocaleString(), seconds: remaining,
    })
    : remaining > 0 ? t('auth.retry', { seconds: remaining }) : '';
}

async function authAction(operation, successKey) {
  if (authBusy) return;
  authBusy = true;
  renderAuth();
  setAuthFeedback('auth.working');
  try {
    const result = await operation();
    authViewState = result.auth;
    resendAllowedAt = Date.now() + (result.auth.resendAfterSeconds || 0) * 1000;
    if (result.ok) {
      setAuthFeedback(successKey);
    } else {
      setAuthFeedback(`auth.error.${result.code}`, result.retryAfterSeconds);
    }
    return result;
  } catch {
    window.hardware.log('error', 'Authentication IPC operation failed.');
    setAuthFeedback('auth.error.IPC_ERROR');
  } finally {
    authBusy = false;
    renderAuth();
  }
}

document.querySelector('#auth-email-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await authAction(() => window.auth.requestCode(document.querySelector('#auth-email').value), 'auth.sent');
  document.querySelector('#auth-code').value = '';
  if (result?.ok) document.querySelector('#auth-code').focus();
});
document.querySelector('#auth-code-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await authAction(() => window.auth.verifyCode(document.querySelector('#auth-code').value), 'auth.verified');
  document.querySelector('#auth-code').value = '';
});
document.querySelector('#auth-refresh').addEventListener('click', () => authAction(() => window.auth.refresh()));
document.querySelector('#auth-logout').addEventListener('click', async () => {
  const result = await authAction(() => window.auth.logout());
  if (result?.ok) setAuthFeedback(result.revoked ? 'auth.revoked' : 'auth.noSession');
});
document.querySelector('#auth-local-logout').addEventListener('click', () => authAction(() => window.auth.signOutLocal(), 'auth.localSignedOut'));
window.addEventListener('localechange', renderAuth);
setInterval(renderAuth, 1000);
authAction(() => window.auth.refresh());
