import { setSessionToken, clearSessionToken, getSessionToken, apiWithNip98, trySync } from './api.js';
import { detectBackend, createNip98Event, Nip07Backend, Nip46Backend, LocalKeyBackend } from './signing.js';
import { initGateView } from './gate.js';
import { initCardIssuerView } from './card-issuer.js';
import { initDashboard } from './dashboard.js';
import { initSafeguarding } from './safeguarding.js';
import { initAdmin } from './admin.js';
import { escapeHtml } from './utils.js';

const LOGIN_URL = `${location.origin}/api/auth/login`;

async function loadView(name) {
  const VALID_VIEWS = ['gate', 'card-issuer', 'dashboard', 'safeguarding', 'admin'];
  if (!VALID_VIEWS.includes(name)) throw new Error('Invalid view');
  const response = await fetch(`/views/${name}.html`);
  const html = await response.text();
  document.getElementById('app').innerHTML = html;
  return html;
}

// --- Login UI ---

function showLoginScreen() {
  const backend = detectBackend();
  const app = document.getElementById('app');

  let content = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a472a;color:#95d5b2;flex-direction:column;padding:2rem;">
      <h1 style="font-family:Georgia,serif;margin-bottom:1rem;">MatchPass</h1>
      <div id="login-status" style="margin-bottom:1rem;color:#f59e0b;display:none;"></div>
      <div id="login-form" style="width:100%;max-width:400px;">`;

  if (backend === Nip07Backend) {
    content += `
        <p style="margin-bottom:1rem;text-align:center;">Signet detected &mdash; sign in with your Steward Pass</p>
        <button id="btn-nip07" style="background:#059669;color:white;width:100%;padding:1rem;font-size:1rem;border:none;border-radius:8px;cursor:pointer;">Sign In</button>`;
  } else if (backend === Nip46Backend) {
    content += `
        <p style="margin-bottom:1rem;text-align:center;">Remote signer connected &mdash; sign in with your Steward Pass</p>
        <button id="btn-nip46" style="background:#059669;color:white;width:100%;padding:1rem;font-size:1rem;border:none;border-radius:8px;cursor:pointer;">Connect & Sign In</button>`;
  } else if (backend === LocalKeyBackend) {
    content += `
        <p style="margin-bottom:1rem;text-align:center;">Enter your PIN to unlock your Steward Pass</p>
        <input id="pin-input" type="password" inputmode="numeric" placeholder="PIN" style="width:100%;padding:1rem;font-size:1.2rem;border-radius:8px;border:none;margin-bottom:1rem;text-align:center;box-sizing:border-box;">
        <button id="btn-local" style="background:#059669;color:white;width:100%;padding:1rem;font-size:1rem;border:none;border-radius:8px;cursor:pointer;">Unlock & Sign In</button>`;
  } else {
    content += `
        <p style="margin-bottom:1.5rem;text-align:center;font-size:1.1rem;">Sign in with your Steward Pass</p>
        <button id="btn-setup-signet" style="background:#059669;color:white;width:100%;padding:1rem;font-size:1rem;border:none;border-radius:8px;cursor:pointer;margin-bottom:1rem;">Sign In with Signet</button>
        <button id="btn-no-pass" style="background:transparent;color:#95d5b2;width:100%;padding:0.75rem;font-size:0.9rem;border:1px solid #334155;border-radius:8px;cursor:pointer;">I don&rsquo;t have a Steward Pass yet</button>`;
  }

  content += `
      </div>
      <button id="btn-change-method" style="background:transparent;color:#64748b;border:none;margin-top:1rem;cursor:pointer;font-size:0.85rem;display:${backend ? 'block' : 'none'};">Change signing method</button>
    </div>`;

  app.innerHTML = content;
  bindLoginHandlers();
}

function bindLoginHandlers() {
  document.getElementById('btn-nip07')?.addEventListener('click', async () => {
    try {
      showStatus('Requesting signature...');
      await loginWithBackend(Nip07Backend);
    } catch (err) {
      showStatus(escapeHtml(err.message));
    }
  });

  document.getElementById('btn-nip46')?.addEventListener('click', async () => {
    try {
      showStatus('Connecting to remote signer...');
      await loginWithBackend(Nip46Backend);
    } catch (err) {
      showStatus(escapeHtml(err.message));
    }
  });

  document.getElementById('btn-local')?.addEventListener('click', async () => {
    const pin = document.getElementById('pin-input')?.value;
    if (!pin) { showStatus('Enter your PIN'); return; }
    try {
      showStatus('Unlocking...');
      await LocalKeyBackend.unlock(pin);
      await loginWithBackend(LocalKeyBackend);
    } catch (err) {
      showStatus(escapeHtml(err.message));
    }
  });

  document.getElementById('pin-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-local')?.click();
  });

  document.getElementById('btn-setup-signet')?.addEventListener('click', () => {
    if (Nip07Backend.isAvailable()) {
      loginWithBackend(Nip07Backend).catch(err => showStatus(escapeHtml(err.message)));
    } else {
      showSignetSetupGuide();
    }
  });

  document.getElementById('btn-no-pass')?.addEventListener('click', () => {
    showSignetSetupGuide();
  });

  document.getElementById('btn-change-method')?.addEventListener('click', () => {
    showMethodPicker();
  });
}

function showStatus(msg) {
  const el = document.getElementById('login-status');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

async function loginWithBackend(backend) {
  const pubkey = await backend.getPublicKey();
  const unsignedEvent = createNip98Event(pubkey, 'POST', LOGIN_URL);
  const signedEvent = await backend.signEvent(unsignedEvent);
  const base64 = btoa(JSON.stringify(signedEvent));

  showStatus('Authenticating...');
  const result = await apiWithNip98('/api/auth/login', 'POST', base64);

  localStorage.setItem('mp_token', result.token);
  localStorage.setItem('mp_role', result.staff.role);
  localStorage.setItem('mp_expires_at', result.expires_at);
  setSessionToken(result.token);
  init();
}

// --- NIP-46 Setup ---

function showNip46Setup() {
  const form = document.getElementById('login-form');
  form.innerHTML = `
    <p style="margin-bottom:1rem;text-align:center;">Paste your bunker URI</p>
    <input id="bunker-input" type="text" placeholder="bunker://..." style="width:100%;padding:1rem;font-size:0.9rem;border-radius:8px;border:none;margin-bottom:1rem;box-sizing:border-box;">
    <button id="btn-save-bunker" style="background:#059669;color:white;width:100%;padding:1rem;font-size:1rem;border:none;border-radius:8px;cursor:pointer;">Connect & Sign In</button>
    <button id="btn-back" style="background:transparent;color:#64748b;width:100%;padding:0.5rem;border:none;cursor:pointer;margin-top:0.5rem;">Back</button>`;

  document.getElementById('btn-save-bunker').addEventListener('click', async () => {
    const uri = document.getElementById('bunker-input').value.trim();
    if (!uri.startsWith('bunker://')) { showStatus('URI must start with bunker://'); return; }
    localStorage.setItem('mp_bunker_uri', uri);
    try {
      showStatus('Connecting to remote signer...');
      await loginWithBackend(Nip46Backend);
    } catch (err) {
      showStatus(escapeHtml(err.message));
    }
  });

  document.getElementById('btn-back').addEventListener('click', () => showLoginScreen());
}

// --- Local Key Setup ---

function showLocalKeySetup() {
  const form = document.getElementById('login-form');
  form.innerHTML = `
    <p style="margin-bottom:1rem;text-align:center;">Choose a PIN to protect your key</p>
    <input id="new-pin" type="password" inputmode="numeric" placeholder="Choose PIN (4+ digits)" style="width:100%;padding:1rem;font-size:1.2rem;border-radius:8px;border:none;margin-bottom:0.5rem;text-align:center;box-sizing:border-box;">
    <input id="confirm-pin" type="password" inputmode="numeric" placeholder="Confirm PIN" style="width:100%;padding:1rem;font-size:1.2rem;border-radius:8px;border:none;margin-bottom:1rem;text-align:center;box-sizing:border-box;">
    <button id="btn-create-key" style="background:#059669;color:white;width:100%;padding:1rem;font-size:1rem;border:none;border-radius:8px;cursor:pointer;">Create Key & Sign In</button>
    <button id="btn-back" style="background:transparent;color:#64748b;width:100%;padding:0.5rem;border:none;cursor:pointer;margin-top:0.5rem;">Back</button>`;

  document.getElementById('btn-create-key').addEventListener('click', async () => {
    const pin = document.getElementById('new-pin').value;
    const confirm = document.getElementById('confirm-pin').value;
    if (pin.length < 4) { showStatus('PIN must be at least 4 characters'); return; }
    if (pin !== confirm) { showStatus('PINs do not match'); return; }

    try {
      showStatus('Generating key...');
      const pubkey = await LocalKeyBackend.generateAndStore(pin);
      showStatus(`Key created. Your pubkey: ${pubkey.slice(0, 8)}...${pubkey.slice(-8)}. Give this to your admin to register, then sign in.`);

      try {
        await LocalKeyBackend.unlock(pin);
        await loginWithBackend(LocalKeyBackend);
      } catch {
        showStatus(`Key created. Pubkey: ${pubkey.slice(0, 8)}...${pubkey.slice(-8)}. Ask your admin to register this pubkey, then sign in.`);
      }
    } catch (err) {
      showStatus(escapeHtml(err.message));
    }
  });

  document.getElementById('btn-back').addEventListener('click', () => showLoginScreen());
}

// --- Signet Setup Guide ---

function showSignetSetupGuide() {
  const form = document.getElementById('login-form');
  form.innerHTML = `
    <div style="text-align:left;line-height:1.8;">
      <p style="margin-bottom:1rem;font-weight:700;font-size:1.05rem;">Get your Steward Pass</p>
      <div style="margin-bottom:1rem;padding:0.75rem;background:#0f172a;border-radius:8px;border-left:3px solid #059669;">
        <strong style="color:#d8f3dc;">1.</strong> Open <a href="https://mysignet.app" target="_blank" rel="noopener" style="color:#059669;text-decoration:underline;">mysignet.app</a> and create your identity
      </div>
      <div style="margin-bottom:1rem;padding:0.75rem;background:#0f172a;border-radius:8px;border-left:3px solid #059669;">
        <strong style="color:#d8f3dc;">2.</strong> Create a persona for your club role (e.g. &ldquo;Belper Town FC &mdash; Steward&rdquo;)
      </div>
      <div style="margin-bottom:1rem;padding:0.75rem;background:#0f172a;border-radius:8px;border-left:3px solid #059669;">
        <strong style="color:#d8f3dc;">3.</strong> Give your persona&rsquo;s public key to your club admin so they can register you
      </div>
      <div style="margin-bottom:1rem;padding:0.75rem;background:#0f172a;border-radius:8px;border-left:3px solid #059669;">
        <strong style="color:#d8f3dc;">4.</strong> Come back here and sign in
      </div>
      <p style="margin-top:1rem;font-size:0.85rem;color:#64748b;">Already have a Nostr key? You can also use a <a href="#" id="link-advanced" style="color:#64748b;text-decoration:underline;">browser extension or remote signer</a>.</p>
    </div>
    <button id="btn-back" style="background:transparent;color:#64748b;width:100%;padding:0.5rem;border:none;cursor:pointer;margin-top:1rem;">Back</button>`;

  document.getElementById('link-advanced')?.addEventListener('click', (e) => {
    e.preventDefault();
    showMethodPicker();
  });
  document.getElementById('btn-back')?.addEventListener('click', () => showLoginScreen());
}

// --- Method Picker ---

function showMethodPicker() {
  const form = document.getElementById('login-form');
  form.innerHTML = `
    <p style="margin-bottom:1rem;text-align:center;">Choose signing method</p>
    <button id="btn-pick-nip07" style="background:#2d6a4f;color:white;width:100%;padding:1rem;font-size:1rem;border:none;border-radius:8px;cursor:pointer;margin-bottom:0.5rem;">Browser Extension (NIP-07)</button>
    <button id="btn-pick-nip46" style="background:#2d6a4f;color:white;width:100%;padding:1rem;font-size:1rem;border:none;border-radius:8px;cursor:pointer;margin-bottom:0.5rem;">Remote Signer (NIP-46)</button>
    <button id="btn-pick-local" style="background:#2d6a4f;color:white;width:100%;padding:1rem;font-size:1rem;border:none;border-radius:8px;cursor:pointer;">Local Key (PIN)</button>
    <button id="btn-back" style="background:transparent;color:#64748b;width:100%;padding:0.5rem;border:none;cursor:pointer;margin-top:0.5rem;">Back</button>`;

  document.getElementById('btn-pick-nip07').addEventListener('click', () => {
    if (!Nip07Backend.isAvailable()) {
      showStatus('No NIP-07 extension detected. Install nos2x or Alby and reload.');
      return;
    }
    showLoginScreen();
  });

  document.getElementById('btn-pick-nip46').addEventListener('click', () => showNip46Setup());
  document.getElementById('btn-pick-local').addEventListener('click', () => {
    if (LocalKeyBackend.isAvailable()) showLoginScreen();
    else showLocalKeySetup();
  });
  document.getElementById('btn-back').addEventListener('click', () => showLoginScreen());
}

// --- Sign Out ---

function addSignOutHandler() {
  const btn = document.getElementById('btn-signout');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const token = localStorage.getItem('mp_token');
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        });
      } catch { /* logout is best-effort */ }
    }
    localStorage.removeItem('mp_token');
    localStorage.removeItem('mp_role');
    localStorage.removeItem('mp_expires_at');
    clearSessionToken();
    LocalKeyBackend.lock();
    Nip46Backend.disconnect();
    init();
  });
}

// --- Main Init ---

async function init() {
  const token = localStorage.getItem('mp_token');
  const role = localStorage.getItem('mp_role');
  const expiresAt = localStorage.getItem('mp_expires_at');

  if (token && expiresAt && new Date(expiresAt) < new Date()) {
    localStorage.removeItem('mp_token');
    localStorage.removeItem('mp_role');
    localStorage.removeItem('mp_expires_at');
    clearSessionToken();
    showLoginScreen();
    return;
  }

  if (!token) {
    showLoginScreen();
    return;
  }

  setSessionToken(token);

  if (role === 'gate_steward') {
    await loadView('gate');
    const videoEl = document.getElementById('gate-video');
    const resultEl = document.getElementById('gate-result');
    initGateView(videoEl, resultEl);
  } else if (role === 'roaming_steward') {
    await loadView('card-issuer');
    initCardIssuerView();
  } else if (role === 'safety_officer') {
    await loadView('dashboard');
    initDashboard();
  } else if (role === 'safeguarding_officer') {
    await loadView('safeguarding');
    initSafeguarding();
  } else if (role === 'admin') {
    await loadView('admin');
    initAdmin();
  } else {
    document.getElementById('app').innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#1a472a;color:#95d5b2;gap:1rem;padding:2rem;">
        <h1 style="font-family:Georgia,serif;">MatchPass</h1>
        <button class="btn" style="background:#059669;color:white;width:100%;max-width:300px;" onclick="selectRole('gate_steward')">Gate Scanner</button>
        <button class="btn" style="background:#059669;color:white;width:100%;max-width:300px;" onclick="selectRole('roaming_steward')">Card Issuer</button>
        <button class="btn" style="background:#059669;color:white;width:100%;max-width:300px;" onclick="selectRole('safety_officer')">Dashboard</button>
        <button class="btn" style="background:#059669;color:white;width:100%;max-width:300px;" onclick="selectRole('safeguarding_officer')">Safeguarding</button>
        <button class="btn" style="background:#059669;color:white;width:100%;max-width:300px;" onclick="selectRole('admin')">Admin</button>
        <button id="btn-signout" style="background:transparent;color:#64748b;border:1px solid #64748b;width:100%;max-width:300px;">Sign Out</button>
      </div>
    `;
    window.selectRole = (r) => {
      localStorage.setItem('mp_role', r);
      init();
    };
    addSignOutHandler();
  }

  const badge = document.getElementById('offline-badge');
  if (badge) {
    window.addEventListener('offline', () => badge.classList.add('visible'));
    window.addEventListener('online', () => {
      badge.classList.remove('visible');
      trySync();
    });
    if (!navigator.onLine) badge.classList.add('visible');
  }
}

init();
