// =========================================================
// ZeroAlgo Trading Terminal Client
// =========================================================

// ---------------------------------------------------------
// PWA (Progressive Web App) Mobile & Desktop Installation
// ---------------------------------------------------------
let deferredInstallPrompt = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('ZeroAlgo Service Worker registered:', reg.scope))
      .catch(err => console.log('ZeroAlgo Service Worker registration failed:', err));
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const desktopBtn = document.getElementById('btn-pwa-install');
  const mobileBtn = document.getElementById('mobile-btn-pwa-install');
  if (desktopBtn) desktopBtn.style.display = 'inline-flex';
  if (mobileBtn) mobileBtn.style.display = 'inline-flex';
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const desktopBtn = document.getElementById('btn-pwa-install');
  const mobileBtn = document.getElementById('mobile-btn-pwa-install');
  if (desktopBtn) desktopBtn.style.display = 'none';
  if (mobileBtn) mobileBtn.style.display = 'none';
  showToast('🎉 ZeroAlgo installed successfully on your device!', 'success');
});

function installPWA() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        showToast('Installing ZeroAlgo App...', 'info');
      }
      deferredInstallPrompt = null;
      const desktopBtn = document.getElementById('btn-pwa-install');
      const mobileBtn = document.getElementById('mobile-btn-pwa-install');
      if (desktopBtn) desktopBtn.style.display = 'none';
      if (mobileBtn) mobileBtn.style.display = 'none';
    });
  } else {
    // Check if iOS Safari
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIos) {
      alert("To install ZeroAlgo on your iPhone / iPad:\n\n1. Tap the Share button (square with arrow ⎋) at the bottom of Safari.\n2. Scroll down and tap 'Add to Home Screen' ➕.\n3. Tap 'Add' in the top-right corner.");
    } else {
      showToast("To install, tap your browser's menu (⋮ or ⚙️) and select 'Install app' or 'Add to Home screen'", "info");
    }
  }
}

let state = {
  activeTab: 'tab-option-chain',
  selectedIndex: 'NIFTY',
  selectedExpiry: null,
  expiries: [],
  strikeCount: 10,
  orderSide: 'BUY',
  currentLotSize: 65,
  lotSizes: {
    NIFTY: 65,
    BANKNIFTY: 15,
    FINNIFTY: 25,
    MIDCPNIFTY: 50,
    SENSEX: 20,
    CRUDEOIL: 100,
    CRUDEOILM: 10,
    NATURALGAS: 1250,
    NATGASMINI: 250,
    GOLD: 1,
    GOLDM: 10,
    SILVER: 30,
    SILVERM: 5,
    COPPER: 2500,
    ZINC: 5000,
    ALUMINIUM: 5000,
  },
  authenticated: false,
  ocView: 'all',
  staticIp: '',
  proxyUrl: '',
  useProxy: false,
  outgoingIp: '',
  // Multi-account state
  accounts: [],
  activeAccountId: '',
  orderTargetMode: 'active', // 'active' | 'all'
  // Basket Order state
  basketMode: false,
  basket: [],
  basketTargetMode: 'active', // 'active' | 'all'
  latestChainData: null,
  terminalLocked: true,
};

// ---------------------------------------------------------
// Terminal Security & Master PIN Authentication
// ---------------------------------------------------------
const TERMINAL_AUTH_KEY = 'zeroalgo_terminal_token';

function getTerminalToken() {
  return localStorage.getItem(TERMINAL_AUTH_KEY) || sessionStorage.getItem(TERMINAL_AUTH_KEY) || '';
}

function setTerminalToken(token, remember) {
  if (remember) {
    localStorage.setItem(TERMINAL_AUTH_KEY, token);
    sessionStorage.removeItem(TERMINAL_AUTH_KEY);
  } else {
    sessionStorage.setItem(TERMINAL_AUTH_KEY, token);
    localStorage.removeItem(TERMINAL_AUTH_KEY);
  }
}

function clearTerminalToken() {
  localStorage.removeItem(TERMINAL_AUTH_KEY);
  sessionStorage.removeItem(TERMINAL_AUTH_KEY);
}

// Global fetch interceptor to attach X-Terminal-Token and intercept 401
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  let [resource, config] = args;
  config = config ? { ...config } : {};
  config.headers = config.headers ? new Headers(config.headers) : new Headers();

  const token = getTerminalToken();
  if (token && !config.headers.has('X-Terminal-Token')) {
    config.headers.set('X-Terminal-Token', token);
  }

  const response = await originalFetch(resource, config);

  const urlStr = typeof resource === 'string' ? resource : (resource ? resource.url : '');
  if (response.status === 401 && urlStr.includes('/api/') && !urlStr.includes('/api/auth/pin')) {
    setTerminalLocked(true);
  }

  return response;
};

function setTerminalLocked(locked) {
  state.terminalLocked = locked;
  const modal = document.getElementById('terminal-lock-modal');
  const errorEl = document.getElementById('terminal-lock-error');
  const pinInput = document.getElementById('terminal-pin-input');

  if (modal) {
    if (locked) {
      modal.style.display = 'flex';
      if (errorEl) errorEl.style.display = 'none';
      if (pinInput) {
        pinInput.value = '';
        updatePinDisplay('');
        setTimeout(() => pinInput.focus(), 150);
      }
    } else {
      modal.style.display = 'none';
      if (pinInput) pinInput.value = '';
    }
  }
}

function onPinInput(val) {
  val = val.replace(/\D/g, '').slice(0, 8);
  const pinInput = document.getElementById('terminal-pin-input');
  if (pinInput && pinInput.value !== val) {
    pinInput.value = val;
  }
  updatePinDisplay(val);
  if (val.length === 4) {
    submitTerminalPin(val);
  }
}

function updatePinDisplay(val) {
  const dots = document.querySelectorAll('#pin-dots-display .pin-dot');
  dots.forEach((dot, index) => {
    if (index < val.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

function keypadPress(digit) {
  const pinInput = document.getElementById('terminal-pin-input');
  if (!pinInput) return;
  if (pinInput.value.length >= 8) return;
  const newVal = (pinInput.value + digit).slice(0, 8);
  pinInput.value = newVal;
  onPinInput(newVal);
}

function keypadClear() {
  const pinInput = document.getElementById('terminal-pin-input');
  if (!pinInput) return;
  pinInput.value = '';
  onPinInput('');
}

function keypadBackspace() {
  const pinInput = document.getElementById('terminal-pin-input');
  if (!pinInput) return;
  const newVal = pinInput.value.slice(0, -1);
  pinInput.value = newVal;
  onPinInput(newVal);
}

function handlePinSubmit(e) {
  if (e) e.preventDefault();
  const pinInput = document.getElementById('terminal-pin-input');
  const pin = pinInput ? pinInput.value.trim() : '';
  submitTerminalPin(pin);
}

async function submitTerminalPin(pin) {
  const errorEl = document.getElementById('terminal-lock-error');
  const cardEl = document.querySelector('.terminal-lock-card');
  const unlockBtn = document.getElementById('btn-unlock-terminal');
  const rememberCheckbox = document.getElementById('terminal-remember-device');
  const remember = rememberCheckbox ? rememberCheckbox.checked : true;

  if (!pin) {
    if (errorEl) {
      errorEl.textContent = 'Please enter Master PIN';
      errorEl.style.display = 'block';
    }
    return;
  }

  if (unlockBtn) {
    unlockBtn.disabled = true;
    unlockBtn.textContent = 'Verifying...';
  }

  try {
    const res = await originalFetch('/api/auth/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, remember })
    });
    const data = await res.json();

    if (res.ok && data.status === 'success' && data.token) {
      setTerminalToken(data.token, remember);
      setTerminalLocked(false);
      showToast('🔓 Terminal Unlocked', 'success');
      onTerminalUnlocked();
    } else {
      if (errorEl) {
        errorEl.textContent = data.message || 'Incorrect Master PIN. Access Denied.';
        errorEl.style.display = 'block';
      }
      if (cardEl) {
        cardEl.classList.add('shake-card');
        setTimeout(() => cardEl.classList.remove('shake-card'), 500);
      }
      keypadClear();
    }
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = 'Network error connecting to server';
      errorEl.style.display = 'block';
    }
  } finally {
    if (unlockBtn) {
      unlockBtn.disabled = false;
      unlockBtn.textContent = '🔓 Unlock Terminal';
    }
  }
}

async function checkTerminalAuth() {
  const token = getTerminalToken();
  if (!token) {
    setTerminalLocked(true);
    return false;
  }

  try {
    const res = await originalFetch('/api/auth/check', {
      headers: { 'X-Terminal-Token': token }
    });
    const data = await res.json();
    if (res.ok && data.authenticated) {
      setTerminalLocked(false);
      onTerminalUnlocked();
      return true;
    } else {
      clearTerminalToken();
      setTerminalLocked(true);
      return false;
    }
  } catch (err) {
    setTerminalLocked(true);
    return false;
  }
}

async function lockTerminal() {
  const token = getTerminalToken();
  if (token) {
    try {
      await originalFetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Terminal-Token': token }
      });
    } catch (e) {}
  }
  clearTerminalToken();
  setTerminalLocked(true);
  showToast('🔒 Terminal Locked', 'info');
}

let terminalDataInitialized = false;
function onTerminalUnlocked() {
  if (!terminalDataInitialized) {
    terminalDataInitialized = true;
    loadAccounts();
    checkSession();
    loadExpiries(state.selectedIndex);
    loadFunds();
    loadStaticIpSettings();
    testOutgoingIp();
    loadBasketFromStorage();
  } else {
    loadAccounts();
    checkSession();
    loadFunds();
    if (state.activeTab === 'tab-positions') loadPositions();
    if (state.activeTab === 'tab-orders') loadOrders();
    if (state.activeTab === 'tab-option-chain' && state.authenticated) loadOptionChain(true);
  }
}

// ---------------------------------------------------------
// Initialization
// ---------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkTerminalAuth();

  // Background polling intervals - only active when terminal is unlocked
  setInterval(() => {
    if (!state.terminalLocked) checkSession();
  }, 15000);
  setInterval(() => {
    if (!state.terminalLocked) loadFunds();
  }, 10000);
  setInterval(() => {
    if (!state.terminalLocked) loadAccounts();
  }, 20000);

  setInterval(() => {
    if (state.terminalLocked) return;
    if (state.activeTab === 'tab-positions') loadPositions();
    if (state.activeTab === 'tab-orders') loadOrders();
    if (state.activeTab === 'tab-option-chain' && state.authenticated) loadOptionChain(true);
  }, 4000);
});

// ---------------------------------------------------------
// Theme Management (Dark / Light)
// ---------------------------------------------------------
function initTheme() {
  const saved = localStorage.getItem('zeroalgo_theme') || localStorage.getItem('myalgo_theme') || 'dark';
  setTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  showToast(`Switched to ${next === 'light' ? 'Light' : 'Dark'} mode`, 'info');
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('zeroalgo_theme', theme);

  const desktopBtn = document.getElementById('theme-btn');
  const mobileBtn = document.getElementById('mobile-theme-btn');

  if (theme === 'light') {
    if (desktopBtn) desktopBtn.innerHTML = '🌙 Dark';
    if (mobileBtn) mobileBtn.innerHTML = '🌙';
  } else {
    if (desktopBtn) desktopBtn.innerHTML = '☀️ Light';
    if (mobileBtn) mobileBtn.innerHTML = '☀️';
  }
}

// ---------------------------------------------------------
// Navigation & Tabs
// ---------------------------------------------------------
function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const fn = btn.getAttribute('onclick') || '';
    btn.classList.toggle('active', fn.includes(tabId));
  });
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

  const activePanel = document.getElementById(tabId);
  if (activePanel) activePanel.classList.add('active');

  // Trigger immediate refresh for active view
  if (tabId === 'tab-positions') loadPositions();
  if (tabId === 'tab-orders') loadOrders();
  if (tabId === 'tab-account') {
    loadFunds();
    loadStaticIpSettings();
  }
  if (tabId === 'tab-option-chain') loadOptionChain();
}

// ---------------------------------------------------------
// Multi-Account Management
// ---------------------------------------------------------
async function loadAccounts() {
  try {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    if (data.status === 'success') {
      state.accounts = data.accounts || [];
      state.activeAccountId = data.active_id || (state.accounts[0] ? state.accounts[0].id : '');
      renderAccountDropdowns();
      renderAccountsModalList();
    }
  } catch (err) {
    console.error('Failed to load accounts:', err);
  }
}

function renderAccountDropdowns() {
  const headerSelect = document.getElementById('header-account-select');
  const mobileSelect = document.getElementById('mobile-account-select');
  const badgeCount = document.getElementById('accounts-count-badge');
  const orderAccCount = document.getElementById('order-all-acc-count');
  const orderActiveUccLabel = document.getElementById('order-active-ucc-label');

  if (badgeCount) badgeCount.innerText = state.accounts.length;
  if (orderAccCount) orderAccCount.innerText = state.accounts.length;
  const basketAccCount = document.getElementById('basket-accs-count');
  if (basketAccCount) basketAccCount.innerText = state.accounts.length;

  const activeAcc = state.accounts.find(a => a.id === state.activeAccountId) || state.accounts[0];
  if (orderActiveUccLabel && activeAcc) {
    orderActiveUccLabel.innerText = activeAcc.ucc;
  }

  const optionsHtml = state.accounts.map(a => {
    const dot = a.is_authenticated ? '🟢' : '⚪';
    const sel = a.id === state.activeAccountId ? 'selected' : '';
    return `<option value="${a.id}" ${sel}>${dot} ${a.name} (${a.ucc})</option>`;
  }).join('');

  if (headerSelect) headerSelect.innerHTML = optionsHtml;
  if (mobileSelect) mobileSelect.innerHTML = optionsHtml;
}

async function switchActiveAccount(accId) {
  if (!accId) return;
  try {
    const res = await fetch('/api/accounts/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accId })
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      state.activeAccountId = accId;
      state.accounts = data.accounts || state.accounts;
      showToast(`Active Account: ${data.ucc}`, 'info');
      renderAccountDropdowns();
      renderAccountsModalList();
      checkSession();
      loadFunds();

      // Clear previous account's rendered positions and orders immediately
      const posTable = document.getElementById('positions-tbody');
      const posCards = document.getElementById('positions-cards');
      if (posTable) posTable.innerHTML = '<tr><td colspan="7" class="loading">Loading positions...</td></tr>';
      if (posCards) posCards.innerHTML = '<div class="loading">Loading positions...</div>';
      const ordTable = document.getElementById('orders-tbody');
      const ordCards = document.getElementById('orders-cards');
      if (ordTable) ordTable.innerHTML = '<tr><td colspan="8" class="loading">Loading orders...</td></tr>';
      if (ordCards) ordCards.innerHTML = '<div class="loading">Loading orders...</div>';

      const totalPnlEl = document.getElementById('pos-total-pnl');
      if (totalPnlEl) totalPnlEl.textContent = '₹0.00';
      const posCountEl = document.getElementById('tab-open-pos-count');
      if (posCountEl) posCountEl.textContent = '0';

      loadPositions();
      loadOrders();
      if (state.activeTab === 'tab-option-chain') loadOptionChain(true);
    } else {
      showToast(data.message || 'Failed to switch account', 'error');
    }
  } catch (err) {
    showToast('Network error switching account', 'error');
  }
}

function openAccountsModal() {
  loadAccounts();
  const modal = document.getElementById('accounts-modal');
  if (modal) modal.classList.add('open');
}

function closeAccountsModal() {
  const modal = document.getElementById('accounts-modal');
  if (modal) modal.classList.remove('open');
}

function toggleAddAccountForm(show, editAcc = null) {
  const card = document.getElementById('add-account-card');
  const title = document.getElementById('account-form-title');
  const formId = document.getElementById('form-acc-id');
  const nameInput = document.getElementById('acc-name-input');
  const uccInput = document.getElementById('acc-ucc-input');
  const tokenInput = document.getElementById('acc-token-input');
  const mobileInput = document.getElementById('acc-mobile-input');
  const mpinInput = document.getElementById('acc-mpin-input');
  const totpInput = document.getElementById('acc-totp-input');

  if (!card) return;

  if (show) {
    card.style.display = 'block';
    if (editAcc) {
      title.innerText = `Edit Account: ${editAcc.name}`;
      formId.value = editAcc.id;
      nameInput.value = editAcc.name;
      uccInput.value = editAcc.ucc;
      tokenInput.value = editAcc.access_token || '';
      mobileInput.value = editAcc.mobile || '';
      mpinInput.value = '';
      totpInput.value = '';
    } else {
      title.innerText = 'Add New Kotak Account';
      formId.value = '';
      nameInput.value = `Account ${state.accounts.length + 1}`;
      uccInput.value = '';
      tokenInput.value = '';
      mobileInput.value = '';
      mpinInput.value = '';
      totpInput.value = '';
    }
  } else {
    card.style.display = 'none';
  }
}

async function submitSaveAccount(e) {
  e.preventDefault();
  const formId = document.getElementById('form-acc-id').value.trim();
  const name = document.getElementById('acc-name-input').value.trim();
  const ucc = document.getElementById('acc-ucc-input').value.trim().toUpperCase();
  const token = document.getElementById('acc-token-input').value.trim();
  const mobile = document.getElementById('acc-mobile-input').value.trim();
  const mpin = document.getElementById('acc-mpin-input').value.trim();
  const totp = document.getElementById('acc-totp-input').value.trim().toUpperCase();

  const payload = {
    name,
    ucc,
    access_token: token,
    mobile,
    mpin,
    totp_secret: totp,
  };

  if (totp && totp.length === 6 && /^\d+$/.test(totp)) {
    if (!confirm(`⚠️ "${totp}" looks like a temporary 6-digit OTP code (which changes every 30 seconds).\n\nThe "TOTP Secret Key" field is only for the permanent Base32 secret (letters like WKTZ7TVCIJU4RTSX...).\n\nIf you do not have the permanent secret key, click OK to leave it blank (you can easily enter your 6-digit OTP when clicking Login).`)) {
      return;
    }
    payload.totp_secret = "";
  }

  const isEdit = Boolean(formId);
  const url = isEdit ? `/api/accounts/${formId}` : '/api/accounts';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      showToast(data.message, 'success');
      toggleAddAccountForm(false);
      loadAccounts();
    } else {
      showToast(data.message || 'Failed to save account', 'error');
    }
  } catch (err) {
    showToast('Network error saving account', 'error');
  }
}

function openEditAccount(accId) {
  const acc = state.accounts.find(a => a.id === accId);
  if (acc) {
    toggleAddAccountForm(true, acc);
  }
}

async function deleteAccount(accId) {
  if (!confirm('Are you sure you want to remove this Kotak account?')) return;
  try {
    const res = await fetch(`/api/accounts/${accId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      showToast(data.message, 'info');
      loadAccounts();
      checkSession();
    } else {
      showToast(data.message || 'Failed to delete account', 'error');
    }
  } catch (err) {
    showToast('Network error deleting account', 'error');
  }
}

async function loginSingleAccount(accId) {
  const acc = state.accounts.find(a => a.id === accId);
  let totp = '';

  // If the account doesn't have a valid permanent TOTP secret key, prompt for current 6-digit code
  if (!acc || !acc.has_totp_secret) {
    const code = prompt(`Enter active 6-digit TOTP code for ${acc ? acc.name : 'Account'} (${acc ? acc.ucc : ''}) from your Authenticator app:`);
    if (!code || !code.trim()) {
      return; // Cancelled
    }
    totp = code.trim();
  }

  try {
    showToast(`Authenticating ${acc ? acc.ucc : 'account'} with Kotak Neo...`, 'info');
    const res = await fetch('/api/accounts/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accId, totp: totp })
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      showToast(`Account ${acc ? acc.ucc : ''} connected successfully!`, 'success');
      loadAccounts();
      checkSession();
      loadFunds();
    } else {
      showToast(data.message || 'Login failed', 'error');
    }
  } catch (err) {
    showToast('Network error during login: ' + err.message, 'error');
  }
}

async function loginAllAccounts() {
  const btn = document.getElementById('btn-login-all-acc');
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⚡ Logging in...';
  }
  showToast('Initiating automated login across all accounts...', 'info');
  try {
    const res = await fetch('/api/accounts/login-all', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      const succ = (data.results || []).filter(r => r.success).length;
      showToast(`Multi-Account Login: ${succ}/${(data.results || []).length} accounts online!`, 'success');
      loadAccounts();
      checkSession();
    } else {
      showToast('Multi-account login encountered an error', 'error');
    }
  } catch (err) {
    showToast('Network error during multi-account login', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '⚡ 1-Click Login All';
    }
  }
}

function renderAccountsModalList() {
  const list = document.getElementById('accounts-cards-list');
  if (!list) return;

  if (state.accounts.length === 0) {
    list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-dim);">No accounts configured. Click "+ Add Kotak Account" above.</div>`;
    return;
  }

  list.innerHTML = state.accounts.map(acc => {
    const isActive = acc.id === state.activeAccountId;
    const isAuth = acc.is_authenticated;
    const activeBadge = isActive ? '<span class="active-pill">Active</span>' : '';
    const statusDot = isAuth ? '<span style="color:var(--green); font-weight:600;">🟢 Online</span>' : '<span style="color:var(--red); font-weight:600;">⚪ Offline</span>';

    return `
      <div class="account-card ${isActive ? 'is-active' : ''}">
        <div class="account-card-info">
          <div class="account-card-title">
            ${acc.name} ${activeBadge}
          </div>
          <div class="account-card-meta">
            <span class="account-card-ucc">${acc.ucc}</span>
            <span>•</span>
            <span>📱 ${acc.mobile || '--'}</span>
            <span>•</span>
            <span>${statusDot}</span>
          </div>
        </div>
        <div class="account-card-actions">
          ${!isActive ? `<button type="button" class="btn btn-secondary btn-sm" onclick="switchActiveAccount('${acc.id}')" title="Set Active">Switch</button>` : ''}
          ${!isAuth ? `<button type="button" class="btn btn-primary btn-sm" onclick="loginSingleAccount('${acc.id}')" title="${acc.has_totp_secret ? 'Auto Login' : 'Login with OTP'}">${acc.has_totp_secret ? '⚡ Login' : '🔑 Login'}</button>` : ''}
          <button type="button" class="btn btn-secondary btn-sm" onclick="openEditAccount('${acc.id}')" title="Edit Account">✏️</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="deleteAccount('${acc.id}')" title="Delete Account" ${state.accounts.length <= 1 ? 'disabled style="opacity:0.4;"' : ''}>🗑</button>
        </div>
      </div>
    `;
  }).join('');
}

// ---------------------------------------------------------
// Session & Auth
// ---------------------------------------------------------
async function checkSession() {
  try {
    const res = await fetch('/api/session');
    const data = await res.json();
    state.authenticated = data.authenticated;
    if (data.accounts) {
      state.accounts = data.accounts;
      if (data.active_id) state.activeAccountId = data.active_id;
      renderAccountDropdowns();
      renderAccountsModalList();
    }

    const badge = document.getElementById('conn-badge');
    const statusText = document.getElementById('conn-status');
    const accUcc = document.getElementById('acc-ucc');
    const accStatus = document.getElementById('acc-status');
    const accEndpoint = document.getElementById('acc-endpoint');

    const mobBadge = document.getElementById('mobile-conn-badge');
    const mobStatus = document.getElementById('mobile-conn-status');

    if (data.authenticated) {
      badge.className = 'badge connected';
      statusText.innerText = `Connected (${data.ucc || 'Kotak'})`;
      if (mobBadge) mobBadge.className = 'badge connected';
      if (mobStatus) mobStatus.innerText = data.ucc || 'Connected';
      accUcc.innerText = data.ucc || '--';
      accStatus.innerText = 'Active Session';
      accStatus.style.color = 'var(--green)';
      accEndpoint.innerText = data.base_url || '--';
    } else {
      badge.className = 'badge disconnected';
      statusText.innerText = 'Disconnected';
      if (mobBadge) mobBadge.className = 'badge disconnected';
      if (mobStatus) mobStatus.innerText = 'Login';
      accUcc.innerText = data.ucc || '--';
      accStatus.innerText = 'Not Authenticated / Expired';
      accStatus.style.color = 'var(--red)';
      accEndpoint.innerText = 'Login required';
    }
  } catch (err) {
    console.error('Session check failed', err);
  }
}

async function submitLogin(e) {
  e.preventDefault();
  const mobile = document.getElementById('login-mobile').value.trim();
  const mpin = document.getElementById('login-mpin').value.trim();
  const totp = document.getElementById('login-totp').value.trim();
  const msgBox = document.getElementById('login-msg');
  const btn = document.getElementById('login-submit-btn');

  btn.disabled = true;
  btn.innerText = 'Authenticating...';
  msgBox.style.display = 'none';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, mpin, totp })
    });
    const data = await res.json();

    if (res.ok && data.status === 'success') {
      showToast('Successfully authenticated with Kotak Neo!', 'success');
      closeLoginModal();
      checkSession();
      loadFunds();
      loadOptionChain();
    } else {
      msgBox.style.display = 'block';
      msgBox.style.color = 'var(--red)';
      msgBox.innerText = data.message || 'Login failed';
      showToast(data.message || 'Login failed', 'error');
    }
  } catch (err) {
    msgBox.style.display = 'block';
    msgBox.style.color = 'var(--red)';
    msgBox.innerText = 'Error connecting to local server: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.innerText = 'Authenticate with Kotak Neo';
  }
}

// ---------------------------------------------------------
// Account & Funds
// ---------------------------------------------------------
async function loadFunds() {
  try {
    const res = await fetch('/api/funds');
    const data = await res.json();

    if (data.status === 'success') {
      const avail = data.available_margin || 0.0;
      const used = data.used_margin || 0.0;
      const collateral = data.collateral || 0.0;
      const total = data.total_balance || (avail + used);

      const marginStr = `₹${avail.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      const headerMargin = document.getElementById('header-margin');
      if (headerMargin) headerMargin.innerText = marginStr;
      const mobMargin = document.getElementById('mobile-margin');
      if (mobMargin) mobMargin.innerText = marginStr;

      const accAvail = document.getElementById('acc-avail-cash');
      if (accAvail) accAvail.innerText = marginStr;
      const accUsed = document.getElementById('acc-used-margin');
      if (accUsed) accUsed.innerText = `₹${used.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      const accCollateral = document.getElementById('acc-collateral');
      if (accCollateral) accCollateral.innerText = `₹${collateral.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      const accTotal = document.getElementById('acc-total-balance');
      if (accTotal) accTotal.innerText = `₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    }
  } catch (err) {
    console.error('Funds load error', err);
  }
}

// ---------------------------------------------------------
// Option Chain
// ---------------------------------------------------------
function selectIndex(indexName) {
  state.selectedIndex = indexName;
  state.currentLotSize = state.lotSizes[indexName] || 50;

  // Reset MCX dropdown if selected
  const mcxSelect = document.getElementById('mcx-symbol-select');
  if (mcxSelect) {
    mcxSelect.value = '';
    mcxSelect.classList.remove('active');
  }

  // Update pill buttons
  document.querySelectorAll('#index-pills .pill-btn').forEach(b => {
    b.classList.toggle('active', b.innerText === indexName);
  });

  loadExpiries(indexName);
}

function selectMcxSymbol(sym) {
  if (!sym) return;
  state.selectedIndex = sym;
  state.currentLotSize = state.lotSizes[sym] || 1;

  // Deactivate all index pill buttons
  document.querySelectorAll('#index-pills .pill-btn').forEach(b => {
    b.classList.remove('active');
  });

  // Highlight MCX select as active
  const mcxSelect = document.getElementById('mcx-symbol-select');
  if (mcxSelect) {
    mcxSelect.classList.add('active');
  }

  loadExpiries(sym);
}

async function loadExpiries(symbol) {
  try {
    const res = await fetch(`/api/expiries?symbol=${symbol}`);
    const data = await res.json();
    const select = document.getElementById('oc-expiry-select');
    select.innerHTML = '';

    if (data.expiries && data.expiries.length > 0) {
      state.expiries = data.expiries;
      data.expiries.forEach((exp, idx) => {
        const opt = document.createElement('option');
        opt.value = exp;
        opt.innerText = exp;
        if (idx === 0) opt.selected = true;
        select.appendChild(opt);
      });
      state.selectedExpiry = data.expiries[0];
      loadOptionChain();
    } else {
      select.innerHTML = '<option value="">No Expiries</option>';
    }
  } catch (err) {
    console.error('Expiries load error', err);
  }
}

async function loadOptionChain(silent = false) {
  const expirySelect = document.getElementById('oc-expiry-select');
  const countSelect = document.getElementById('oc-count-select');
  const expiry = expirySelect ? expirySelect.value : '';
  const count = countSelect ? countSelect.value : '20';
  const tbody = document.getElementById('oc-table-body');

  if (!expiry) return;

  if (!silent) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-dim);">Loading live option chain for ${state.selectedIndex}...</td></tr>`;
  }

  try {
    const res = await fetch(`/api/option-chain?symbol=${state.selectedIndex}&expiry=${expiry}&count=${encodeURIComponent(count)}`);
    const data = await res.json();

    if (data.status !== 'success') {
      if (!silent) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--red);">${data.message || 'Failed to load option chain'}</td></tr>`;
      }
      return;
    }

    // Save chain data for presets
    state.latestChainData = data;

    // Update spot and ATM tag
    document.getElementById('oc-spot-price').innerText = `₹${data.spot_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('oc-atm-tag').innerText = `ATM ${data.atm_strike}`;

    // Render ladder
    let rowsHtml = '';
    data.chain.forEach(row => {
      const isAtm = row.is_atm;
      const ce = row.ce || {};
      const pe = row.pe || {};

      const ceLtp = ce.ltp > 0 ? `₹${ce.ltp.toFixed(2)}` : '--';
      const peLtp = pe.ltp > 0 ? `₹${pe.ltp.toFixed(2)}` : '--';
      const ceOi = ce.oi ? Number(ce.oi).toLocaleString('en-IN') : '--';
      const peOi = pe.oi ? Number(pe.oi).toLocaleString('en-IN') : '--';

      let ceActionCell = '';
      let peActionCell = '';

      if (!state.basketMode) {
        // Normal Mode: Punch single order like earlier
        const ceBuyBtn = ce.symbol ? `<button class="btn btn-buy" onclick="quickOrder('${ce.symbol}', 'BUY', ${ce.lotsize || state.currentLotSize}, ${ce.ltp || 0})">BUY</button>` : '';
        const ceSellBtn = ce.symbol ? `<button class="btn btn-sell" onclick="quickOrder('${ce.symbol}', 'SELL', ${ce.lotsize || state.currentLotSize}, ${ce.ltp || 0})">SELL</button>` : '';
        ceActionCell = `<div class="action-cell">${ceBuyBtn}${ceSellBtn}</div>`;

        const peBuyBtn = pe.symbol ? `<button class="btn btn-buy" onclick="quickOrder('${pe.symbol}', 'BUY', ${pe.lotsize || state.currentLotSize}, ${pe.ltp || 0})">BUY</button>` : '';
        const peSellBtn = pe.symbol ? `<button class="btn btn-sell" onclick="quickOrder('${pe.symbol}', 'SELL', ${pe.lotsize || state.currentLotSize}, ${pe.ltp || 0})">SELL</button>` : '';
        peActionCell = `<div class="action-cell" style="justify-content: flex-start;">${peBuyBtn}${peSellBtn}</div>`;
      } else {
        // Basket Mode: Compact [ B ] [ S ] buttons + Lots dropdown
        if (ce.symbol) {
          const bLeg = state.basket.find(l => l.symbol === ce.symbol);
          const isBuy = bLeg && bLeg.side === 'BUY';
          const isSell = bLeg && bLeg.side === 'SELL';
          const lots = bLeg ? (bLeg.lots || 1) : 1;
          const lotSelector = bLeg ? `
            <div class="oc-lot-select-wrap">
              <span>Lots</span>
              <select class="oc-lot-dropdown" onchange="setBasketLegLots('${ce.symbol}', this.value)">
                ${[1,2,3,4,5,10,15,20,50].map(n => `<option value="${n}" ${lots === n ? 'selected' : ''}>${n}</option>`).join('')}
              </select>
            </div>
          ` : '';

          ceActionCell = `
            <div class="oc-basket-cell">
              <div class="oc-bs-group">
                <button class="oc-bs-btn ${isBuy ? 'active-b' : ''}" onclick="toggleBasketStrike('${ce.symbol}', 'BUY', ${ce.lotsize || state.currentLotSize}, ${ce.ltp || 0})" title="Add/Toggle BUY leg in Basket">B</button>
                <button class="oc-bs-btn ${isSell ? 'active-s' : ''}" onclick="toggleBasketStrike('${ce.symbol}', 'SELL', ${ce.lotsize || state.currentLotSize}, ${ce.ltp || 0})" title="Add/Toggle SELL leg in Basket">S</button>
              </div>
              ${lotSelector}
            </div>
          `;
        }

        if (pe.symbol) {
          const bLeg = state.basket.find(l => l.symbol === pe.symbol);
          const isBuy = bLeg && bLeg.side === 'BUY';
          const isSell = bLeg && bLeg.side === 'SELL';
          const lots = bLeg ? (bLeg.lots || 1) : 1;
          const lotSelector = bLeg ? `
            <div class="oc-lot-select-wrap">
              <span>Lots</span>
              <select class="oc-lot-dropdown" onchange="setBasketLegLots('${pe.symbol}', this.value)">
                ${[1,2,3,4,5,10,15,20,50].map(n => `<option value="${n}" ${lots === n ? 'selected' : ''}>${n}</option>`).join('')}
              </select>
            </div>
          ` : '';

          peActionCell = `
            <div class="oc-basket-cell">
              <div class="oc-bs-group">
                <button class="oc-bs-btn ${isBuy ? 'active-b' : ''}" onclick="toggleBasketStrike('${pe.symbol}', 'BUY', ${pe.lotsize || state.currentLotSize}, ${pe.ltp || 0})" title="Add/Toggle BUY leg in Basket">B</button>
                <button class="oc-bs-btn ${isSell ? 'active-s' : ''}" onclick="toggleBasketStrike('${pe.symbol}', 'SELL', ${pe.lotsize || state.currentLotSize}, ${pe.ltp || 0})" title="Add/Toggle SELL leg in Basket">S</button>
              </div>
              ${lotSelector}
            </div>
          `;
        }
      }

      rowsHtml += `
        <tr class="${isAtm ? 'atm-row' : ''}">
          <td class="th-call td-call" style="color: var(--text-muted); font-size: 12px;">${ceOi}</td>
          <td class="th-call td-call" style="font-weight: 700; color: var(--text-main);">${ceLtp}</td>
          <td class="th-call td-call">
            ${ceActionCell}
          </td>
          <td class="td-strike">${row.strike}${isAtm ? ' <span style="font-size: 10px; color: var(--blue);">●</span>' : ''}</td>
          <td class="th-put td-put">
            ${peActionCell}
          </td>
          <td class="th-put td-put" style="font-weight: 700; color: var(--text-main);">${peLtp}</td>
          <td class="th-put td-put" style="color: var(--text-muted); font-size: 12px;">${peOi}</td>
        </tr>
      `;
    });

    tbody.innerHTML = rowsHtml;

    // Auto-scroll to ATM strike on initial load or count change
    if (!silent) {
      setTimeout(() => {
        const atmRow = tbody.querySelector('.atm-row');
        if (atmRow) {
          atmRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 50);
    }
  } catch (err) {
    console.error('Option chain error', err);
  }
}

function setOcView(mode) {
  state.ocView = mode;
  document.querySelectorAll('.view-mode-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`btn-view-${mode}`);
  if (activeBtn) activeBtn.classList.add('active');

  const container = document.getElementById('oc-table-container');
  if (container) {
    container.classList.remove('view-ce-only', 'view-pe-only');
    if (mode === 'ce') container.classList.add('view-ce-only');
    if (mode === 'pe') container.classList.add('view-pe-only');
  }
}

// ---------------------------------------------------------
// Orders & Trades
// ---------------------------------------------------------
let rawOrders = [];
let rawTrades = [];

async function loadOrders() {
  try {
    const res = await fetch('/api/orders');
    const data = await res.json();
    rawOrders = data.orders || [];
    rawTrades = data.trades || [];
    applyOrdersFilter();
    renderTrades(rawTrades);
  } catch (err) {
    console.error('Orders error', err);
  }
}

function filterOrders(statusFilter) {
  state.ordersFilter = statusFilter;
  document.querySelectorAll('#tab-orders .pill-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('onclick').includes(statusFilter));
  });
  applyOrdersFilter();
}

function applyOrdersFilter() {
  const statusFilter = state.ordersFilter || 'ALL';
  if (statusFilter === 'ALL') {
    renderOrders(rawOrders);
  } else if (statusFilter === 'OPEN') {
    renderOrders(rawOrders.filter(o => ['OPEN', 'PENDING', 'TRIGGER_PENDING'].includes((o.ordSt || o.status || '').toUpperCase())));
  } else if (statusFilter === 'COMPLETE') {
    renderOrders(rawOrders.filter(o => ['COMPLETE', 'TRADED'].includes((o.ordSt || o.status || '').toUpperCase())));
  }
}

function renderOrders(orders) {
  renderOrdersDesktopTable(orders);
  renderOrdersMobileCards(orders);
}

function renderOrdersDesktopTable(orders) {
  const tbody = document.getElementById('orders-table-body');
  if (!tbody) return;
  if (!orders || orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 30px; color: var(--text-dim);">No orders found.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => {
    const orderId = o.nOrdNo || o.order_id || '--';
    const time = o.ordDtTm || o.time || '--';
    const sym = o.trdSym || o.symbol || '--';
    const side = (o.trnsTp || o.side || '').toUpperCase() === 'B' ? 'BUY' : 'SELL';
    const prod = o.prod || o.product || 'MIS';
    const qty = o.qty || o.quantity || 0;
    const price = o.prc || o.price || 0.0;
    const type = o.prcTp || o.order_type || 'MARKET';
    const status = (o.ordSt || o.status || 'UNKNOWN').toUpperCase();

    let statusColor = 'var(--text-muted)';
    if (['COMPLETE', 'TRADED'].includes(status)) statusColor = 'var(--green)';
    if (['REJECTED', 'CANCELLED', 'CANCELED'].includes(status)) statusColor = 'var(--red)';
    if (['OPEN', 'PENDING', 'TRIGGER_PENDING'].includes(status)) statusColor = 'var(--yellow)';

    const isCancellable = ['OPEN', 'PENDING', 'TRIGGER_PENDING'].includes(status);
    const cancelBtn = isCancellable ? `<button class="btn btn-secondary" style="padding: 3px 10px; font-size: 11px; font-weight: 700;" onclick="cancelOrder('${orderId}')">Cancel</button>` : '--';

    return `
      <tr>
        <td style="text-align: left; font-size: 11px; color: var(--text-dim);">${time}</td>
        <td style="text-align: left; font-family: monospace;">${orderId}</td>
        <td style="text-align: left; font-weight: 700;">${sym}</td>
        <td style="text-align: center; font-weight: 800; color: ${side === 'BUY' ? 'var(--green)' : 'var(--red)'};">${side}</td>
        <td style="text-align: center; font-size: 11px;">${prod}</td>
        <td style="font-weight: 700;">${qty}</td>
        <td>${type === 'MKT' ? 'MKT' : '₹' + Number(price).toFixed(2)}</td>
        <td>${type}</td>
        <td style="text-align: center; font-weight: 800; color: ${statusColor};">${status}</td>
        <td style="text-align: center;">${cancelBtn}</td>
      </tr>
    `;
  }).join('');
}

function renderOrdersMobileCards(orders) {
  const container = document.getElementById('orders-mobile-list');
  if (!container) return;
  if (!orders || orders.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-dim); font-size: 12px;">No orders found.</div>`;
    return;
  }

  container.innerHTML = orders.map(o => {
    const orderId = o.nOrdNo || o.order_id || '--';
    const time = o.ordDtTm || o.time || '--';
    const sym = o.trdSym || o.symbol || '--';
    const side = (o.trnsTp || o.side || '').toUpperCase() === 'B' ? 'BUY' : 'SELL';
    const prod = o.prod || o.product || 'MIS';
    const qty = o.qty || o.quantity || 0;
    const price = o.prc || o.price || 0.0;
    const type = o.prcTp || o.order_type || 'MARKET';
    const status = (o.ordSt || o.status || 'UNKNOWN').toUpperCase();

    let statusPillClass = 'status-pending';
    if (['COMPLETE', 'TRADED'].includes(status)) statusPillClass = 'status-complete';
    if (['REJECTED', 'CANCELLED', 'CANCELED'].includes(status)) statusPillClass = 'status-rejected';
    if (['OPEN', 'PENDING', 'TRIGGER_PENDING'].includes(status)) statusPillClass = 'status-open';

    const isCancellable = ['OPEN', 'PENDING', 'TRIGGER_PENDING'].includes(status);
    const cancelBtn = isCancellable 
      ? `<button class="btn-cancel-mini" onclick="cancelOrder('${orderId}')">Cancel</button>`
      : `<span style="font-family: monospace; font-size: 10px; color: var(--text-dim);">#${orderId}</span>`;

    return `
      <div class="order-card">
        <div class="order-card-header">
          <div class="order-sym-wrap">
            <span class="order-sym">${sym}</span>
            <div class="card-badges-row">
              <span class="badge-micro ${side === 'BUY' ? 'buy' : 'sell'}">${side}</span>
              <span class="badge-micro tag-prod">${prod}</span>
              <span class="badge-micro tag-prod">${type}</span>
            </div>
          </div>
          <span class="status-pill-sm ${statusPillClass}">${status}</span>
        </div>
        <div class="order-meta-line">
          <span>${qty} Qty • ${type === 'MKT' ? 'MKT' : '₹' + Number(price).toFixed(2)} • ${time}</span>
          ${cancelBtn}
        </div>
      </div>
    `;
  }).join('');
}

function renderTrades(trades) {
  renderTradesDesktopTable(trades);
  renderTradesMobileCards(trades);
}

function renderTradesDesktopTable(trades) {
  const tbody = document.getElementById('trades-table-body');
  if (!tbody) return;
  if (!trades || trades.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-dim);">No executed trades today.</td></tr>`;
    return;
  }

  tbody.innerHTML = trades.map(t => {
    const time = t.flDtTm || t.time || '--';
    const tradeId = t.flId || t.trade_id || '--';
    const sym = t.trdSym || t.symbol || '--';
    const side = (t.trnsTp || t.side || '').toUpperCase() === 'B' ? 'BUY' : 'SELL';
    const qty = t.fQty || t.quantity || 0;
    const price = t.fPrc || t.price || 0.0;

    return `
      <tr>
        <td style="text-align: left; font-size: 11px; color: var(--text-dim);">${time}</td>
        <td style="text-align: left; font-family: monospace;">${tradeId}</td>
        <td style="text-align: left; font-weight: 700;">${sym}</td>
        <td style="text-align: center; font-weight: 800; color: ${side === 'BUY' ? 'var(--green)' : 'var(--red)'};">${side}</td>
        <td style="font-weight: 700;">${qty}</td>
        <td>₹${Number(price).toFixed(2)}</td>
      </tr>
    `;
  }).join('');
}

function renderTradesMobileCards(trades) {
  const container = document.getElementById('trades-mobile-list');
  if (!container) return;
  if (!trades || trades.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-dim); font-size: 12px;">No executed trades today.</div>`;
    return;
  }

  container.innerHTML = trades.map(t => {
    const time = t.flDtTm || t.time || '--';
    const tradeId = t.flId || t.trade_id || '--';
    const sym = t.trdSym || t.symbol || '--';
    const side = (t.trnsTp || t.side || '').toUpperCase() === 'B' ? 'BUY' : 'SELL';
    const qty = t.fQty || t.quantity || 0;
    const price = t.fPrc || t.price || 0.0;

    return `
      <div class="trade-card">
        <div class="trade-card-header">
          <div class="order-sym-wrap">
            <span class="order-sym">${sym}</span>
            <div class="card-badges-row">
              <span class="badge-micro ${side === 'BUY' ? 'buy' : 'sell'}">${side}</span>
              <span class="badge-micro tag-prod">Filled</span>
            </div>
          </div>
          <span style="font-family: monospace; font-size: 10px; color: var(--text-dim);">#${tradeId}</span>
        </div>
        <div class="order-meta-line">
          <span>${qty} Qty @ ₹${Number(price).toFixed(2)}</span>
          <span style="font-size: 10px; color: var(--text-dim);">${time}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function cancelOrder(orderId) {
  if (!confirm(`Cancel order #${orderId}?`)) return;
  try {
    const res = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      showToast(`Order #${orderId} cancelled`, 'success');
      loadOrders();
    } else {
      showToast(data.message || 'Failed to cancel', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ---------------------------------------------------------
// Positions (Anti-Flicker & Stable Order)
// ---------------------------------------------------------
let rawPositions = [];
let prevPosPrices = {};

function filterPositions(filter) {
  state.positionsFilter = filter;
  document.querySelectorAll('#pos-filter-group .pill-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('onclick').includes(filter));
  });
  renderPositions(rawPositions);
}

async function loadPositions() {
  try {
    const res = await fetch('/api/positions');
    const data = await res.json();

    const unPnl = data.total_unrealized_pnl || 0.0;
    const rePnl = data.total_realized_pnl || 0.0;
    const totPnl = data.total_pnl || 0.0;
    const openPositions = (data.positions || []).filter(p => (p.net_qty || 0) !== 0);

    // Update UI headers & counters without flickering
    const headerPnl = document.getElementById('header-pnl');
    if (headerPnl) {
      headerPnl.innerText = `₹${totPnl.toFixed(2)}`;
      headerPnl.className = `stat-value ${totPnl >= 0 ? 'green' : 'red'}`;
    }

    const mobPnl = document.getElementById('mobile-pnl');
    if (mobPnl) {
      mobPnl.innerText = `₹${totPnl.toFixed(2)}`;
      mobPnl.className = `m-stat-val ${totPnl >= 0 ? 'green' : 'red'}`;
    }

    // Update Positions Tab Summary Bar
    const totPnlEl = document.getElementById('pos-total-pnl');
    if (totPnlEl) {
      totPnlEl.innerText = `${totPnl >= 0 ? '+' : ''}₹${totPnl.toFixed(2)}`;
      totPnlEl.style.color = totPnl >= 0 ? 'var(--green)' : 'var(--red)';
    }

    const unPnlEl = document.getElementById('pos-unrealized-pnl');
    if (unPnlEl) {
      unPnlEl.innerText = `₹${unPnl.toFixed(2)}`;
      unPnlEl.style.color = unPnl >= 0 ? 'var(--green)' : 'var(--red)';
    }

    const rePnlEl = document.getElementById('pos-realized-pnl');
    if (rePnlEl) {
      rePnlEl.innerText = `₹${rePnl.toFixed(2)}`;
      rePnlEl.style.color = rePnl >= 0 ? 'var(--green)' : 'var(--red)';
    }

    const openCountEl = document.getElementById('pos-open-count');
    if (openCountEl) openCountEl.innerText = openPositions.length;

    const tabCountEl = document.getElementById('tab-open-pos-count');
    if (tabCountEl) tabCountEl.innerText = openPositions.length;

    renderPositions(data.positions || []);
  } catch (err) {
    console.error('Positions error', err);
  }
}

function renderPositions(positions) {
  rawPositions = positions || [];
  const openCount = rawPositions.filter(p => (p.net_qty || 0) !== 0).length;
  const closedCount = rawPositions.length - openCount;

  // Update filter pills count
  const pillAll = document.getElementById('pos-pill-all-count');
  if (pillAll) pillAll.innerText = rawPositions.length;
  const pillOpen = document.getElementById('pos-pill-open-count');
  if (pillOpen) pillOpen.innerText = openCount;
  const pillClosed = document.getElementById('pos-pill-closed-count');
  if (pillClosed) pillClosed.innerText = closedCount;

  // Filter based on active selection
  const filter = state.positionsFilter || 'ALL';
  let filtered = rawPositions;
  if (filter === 'OPEN') filtered = rawPositions.filter(p => (p.net_qty || 0) !== 0);
  if (filter === 'CLOSED') filtered = rawPositions.filter(p => (p.net_qty || 0) === 0);

  // Deterministic stable sorting: Open positions first, then alphabetically by symbol
  filtered.sort((a, b) => {
    const aClosed = (a.net_qty || 0) === 0 ? 1 : 0;
    const bClosed = (b.net_qty || 0) === 0 ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;
    return (a.symbol || '').localeCompare(b.symbol || '');
  });

  renderPositionsDesktopTable(filtered);
  renderPositionsMobileCards(filtered);
}

function renderPositionsDesktopTable(positions) {
  const tbody = document.getElementById('positions-table-body');
  if (!tbody) return;

  if (!positions || positions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-dim);">No positions found.</td></tr>`;
    return;
  }

  // Remove placeholder if present
  const emptyRow = tbody.querySelector('td[colspan="8"]');
  if (emptyRow) tbody.innerHTML = '';

  const currentIds = new Set();

  positions.forEach((p, index) => {
    const posId = `${p.symbol}_${p.product}`;
    currentIds.add(posId);

    const netQty = p.net_qty || 0;
    const isOpen = netQty !== 0;
    const pnl = p.pnl || 0.0;
    const ltp = Number(p.ltp || 0);
    const prevLtp = prevPosPrices[posId];
    prevPosPrices[posId] = ltp;

    let flashClass = '';
    if (prevLtp !== undefined && prevLtp !== 0 && ltp !== 0 && prevLtp !== ltp) {
      flashClass = ltp > prevLtp ? 'flash-up' : 'flash-down';
    }

    const pnlColor = pnl >= 0 ? 'var(--green)' : 'var(--red)';
    const sideBadge = netQty > 0 
      ? `<span style="color: var(--green); font-weight: 700;">+${netQty} LONG</span>`
      : netQty < 0
      ? `<span style="color: var(--red); font-weight: 700;">${netQty} SHORT</span>`
      : `<span style="color: var(--text-dim);">0 CLOSED</span>`;

    const squareOffBtn = isOpen
      ? `<button class="btn btn-danger" style="padding: 4px 12px; font-size: 11px; font-weight: 700;" onclick="event.stopPropagation(); openPositionActions('${p.symbol}', '${p.product}')">Exit</button>`
      : '<span style="color: var(--text-dim);">--</span>';

    let row = tbody.querySelector(`tr[data-pos-id="${posId}"]`);
    if (!row) {
      row = document.createElement('tr');
      row.setAttribute('data-pos-id', posId);
      row.innerHTML = `
        <td class="col-sym" style="text-align: left; font-weight: 700;"></td>
        <td class="col-prod" style="text-align: center; font-size: 11px;"></td>
        <td class="col-qty"></td>
        <td class="col-buy"></td>
        <td class="col-sell"></td>
        <td class="col-ltp" style="font-weight: 700;"></td>
        <td class="col-pnl" style="font-weight: 800;"></td>
        <td class="col-action" style="text-align: center;"></td>
      `;
      tbody.appendChild(row);
    }

    row.style.cursor = 'pointer';
    row.onclick = () => openPositionActions(p.symbol, p.product);

    // In-place updates to avoid flicker
    row.querySelector('.col-sym').textContent = p.symbol;
    row.querySelector('.col-prod').textContent = p.product;
    row.querySelector('.col-qty').innerHTML = sideBadge;
    row.querySelector('.col-buy').textContent = `₹${Number(p.buy_avg || 0).toFixed(2)}`;
    row.querySelector('.col-sell').textContent = `₹${Number(p.sell_avg || 0).toFixed(2)}`;
    
    const ltpEl = row.querySelector('.col-ltp');
    ltpEl.textContent = `₹${ltp.toFixed(2)}`;
    if (flashClass) {
      ltpEl.classList.remove('flash-up', 'flash-down');
      void ltpEl.offsetWidth; // trigger reflow
      ltpEl.classList.add(flashClass);
    }

    const pnlEl = row.querySelector('.col-pnl');
    pnlEl.textContent = `${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}`;
    pnlEl.style.color = pnlColor;

    row.querySelector('.col-action').innerHTML = squareOffBtn;

    // Maintain stable order in DOM
    if (tbody.children[index] !== row) {
      tbody.insertBefore(row, tbody.children[index] || null);
    }
  });

  // Remove rows that no longer exist or are filtered out
  tbody.querySelectorAll('tr[data-pos-id]').forEach(r => {
    if (!currentIds.has(r.getAttribute('data-pos-id'))) {
      r.remove();
    }
  });
}

function renderPositionsMobileCards(positions) {
  const container = document.getElementById('positions-mobile-list');
  if (!container) return;

  if (!positions || positions.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-dim); font-size: 12px;">No positions found.</div>`;
    return;
  }

  // Remove placeholder if present
  const emptyDiv = container.querySelector('div:not([data-pos-id])');
  if (emptyDiv) container.innerHTML = '';

  const currentIds = new Set();

  positions.forEach((p, index) => {
    const posId = `${p.symbol}_${p.product}`;
    currentIds.add(posId);

    const netQty = p.net_qty || 0;
    const isOpen = netQty !== 0;
    const pnl = p.pnl || 0.0;
    const ltp = Number(p.ltp || 0);
    const prevLtp = prevPosPrices[posId];

    let flashClass = '';
    if (prevLtp !== undefined && prevLtp !== 0 && ltp !== 0 && prevLtp !== ltp) {
      flashClass = ltp > prevLtp ? 'flash-up' : 'flash-down';
    }

    const pnlClass = pnl > 0 ? 'pnl-green' : pnl < 0 ? 'pnl-red' : 'pnl-dim';
    const sideClass = netQty > 0 ? 'buy' : netQty < 0 ? 'sell' : 'dim';
    const sideText = netQty > 0 ? `+${netQty}` : netQty < 0 ? `${netQty}` : '0';
    const avgPrice = netQty >= 0 ? Number(p.buy_avg || 0).toFixed(2) : Number(p.sell_avg || 0).toFixed(2);

    let card = container.querySelector(`.pos-card[data-pos-id="${posId}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = `pos-card ${!isOpen ? 'pos-closed' : ''}`;
      card.setAttribute('data-pos-id', posId);
      card.onclick = () => openPositionActions(p.symbol, p.product);
      card.innerHTML = `
        <div class="pos-row-main">
          <div class="pos-left">
            <div class="pos-sym-line">
              <span class="pos-sym-title">${p.symbol}</span>
              <span class="badge-micro ${sideClass} card-qty-badge">${sideText}</span>
            </div>
            <div class="pos-sub-tags">
              <span class="badge-micro tag-prod">${p.product}</span>
              <span class="pos-meta-text">Avg ₹${avgPrice} • LTP <span class="card-ltp">₹${ltp.toFixed(2)}</span></span>
            </div>
          </div>
          <div class="pos-right">
            <div class="pos-card-pnl ${pnlClass}">${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}</div>
            <div class="pos-action-wrap">
              ${isOpen ? `
                <button class="btn-sq-mini" onclick="event.stopPropagation(); openPositionActions('${p.symbol}', '${p.product}')" title="Actions for this position">
                  Exit
                </button>
              ` : `<span class="closed-label">Closed</span>`}
            </div>
          </div>
        </div>
      `;
      container.appendChild(card);
    } else {
      // In-place update without rebuilding DOM (Anti-Blink)
      card.className = `pos-card ${!isOpen ? 'pos-closed' : ''}`;
      card.onclick = () => openPositionActions(p.symbol, p.product);

      const pnlEl = card.querySelector('.pos-card-pnl');
      if (pnlEl) {
        pnlEl.className = `pos-card-pnl ${pnlClass}`;
        pnlEl.textContent = `${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}`;
      }

      const qtyBadge = card.querySelector('.card-qty-badge');
      if (qtyBadge) {
        qtyBadge.className = `badge-micro ${sideClass} card-qty-badge`;
        qtyBadge.textContent = sideText;
      }

      const metaEl = card.querySelector('.pos-meta-text');
      if (metaEl) {
        metaEl.innerHTML = `Avg ₹${avgPrice} • LTP <span class="card-ltp">₹${ltp.toFixed(2)}</span>`;
      }

      const ltpEl = card.querySelector('.card-ltp');
      if (ltpEl && flashClass) {
        ltpEl.classList.remove('flash-up', 'flash-down');
        void ltpEl.offsetWidth;
        ltpEl.classList.add(flashClass);
      }

      const actionWrap = card.querySelector('.pos-action-wrap');
      if (actionWrap) {
        actionWrap.innerHTML = isOpen ? `
          <button class="btn-sq-mini" onclick="event.stopPropagation(); openPositionActions('${p.symbol}', '${p.product}')" title="Actions for this position">
            Exit
          </button>
        ` : `<span class="closed-label">Closed</span>`;
      }
    }

    // Maintain stable order in DOM
    if (container.children[index] !== card) {
      container.insertBefore(card, container.children[index] || null);
    }
  });

  // Remove cards that no longer exist or are filtered out
  container.querySelectorAll('.pos-card[data-pos-id]').forEach(c => {
    if (!currentIds.has(c.getAttribute('data-pos-id'))) {
      c.remove();
    }
  });
}

async function exitSinglePosition(symbol) {
  if (!confirm(`Square off position in ${symbol}?`)) return;
  try {
    const res = await fetch('/api/positions/exit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      showToast(`Position squared off: ${symbol}`, 'success');
      loadPositions();
    } else {
      showToast(data.message || 'Exit failed', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

async function exitAllPositions() {
  if (!confirm('⚠️ PANIC ACTION: Are you sure you want to CLOSE ALL open positions at MARKET price?')) return;
  try {
    const res = await fetch('/api/positions/exit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exit_all: true })
    });
    const data = await res.json();
    showToast('Exit all triggered!', 'info');
    loadPositions();
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ---------------------------------------------------------
// Position Actions Modal (Add More / Exit Selection)
// ---------------------------------------------------------
let selectedPositionAction = null;

function openPositionActions(symbol, product) {
  const pos = rawPositions.find(p => p.symbol === symbol && (!product || p.product === product)) ||
              rawPositions.find(p => p.symbol === symbol);
  if (!pos) return;

  selectedPositionAction = pos;

  const netQty = pos.net_qty || 0;
  const isLong = netQty > 0;
  const isShort = netQty < 0;
  const isOpen = netQty !== 0;
  const ltp = Number(pos.ltp || 0);
  const pnl = Number(pos.pnl || 0.0);
  const avgPrice = netQty >= 0 ? Number(pos.buy_avg || 0) : Number(pos.sell_avg || 0);

  // Set modal header & badges
  const symEl = document.getElementById('pos-action-symbol');
  if (symEl) symEl.textContent = pos.symbol;

  const prodEl = document.getElementById('pos-action-product');
  if (prodEl) prodEl.textContent = pos.product || 'NRML';

  const sideBadgeEl = document.getElementById('pos-action-side-badge');
  if (sideBadgeEl) {
    sideBadgeEl.className = `badge-micro ${isLong ? 'buy' : isShort ? 'sell' : 'dim'}`;
    sideBadgeEl.textContent = isLong ? `+${netQty} LONG` : isShort ? `${netQty} SHORT` : '0 CLOSED';
  }

  const netQtyEl = document.getElementById('pos-action-net-qty');
  if (netQtyEl) {
    netQtyEl.textContent = `${netQty > 0 ? '+' : ''}${netQty}`;
    netQtyEl.style.color = isLong ? 'var(--green)' : isShort ? 'var(--red)' : 'var(--text-dim)';
  }

  const avgPriceEl = document.getElementById('pos-action-avg-price');
  if (avgPriceEl) avgPriceEl.textContent = `₹${avgPrice.toFixed(2)}`;

  const ltpEl = document.getElementById('pos-action-ltp');
  if (ltpEl) ltpEl.textContent = `₹${ltp.toFixed(2)}`;

  const pnlEl = document.getElementById('pos-action-pnl');
  if (pnlEl) {
    pnlEl.textContent = `${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}`;
    pnlEl.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  }

  // Dynamic Button 1: Add More
  const addTitleEl = document.getElementById('pos-add-title');
  const addDescEl = document.getElementById('pos-add-desc');
  if (addTitleEl) {
    addTitleEl.textContent = isLong ? 'Add More (BUY)' : isShort ? 'Add More (SELL)' : 'Re-enter (BUY)';
  }
  if (addDescEl) {
    addDescEl.textContent = isLong ? 'Buy additional lots with Market/Limit' : isShort ? 'Sell additional lots with Market/Limit' : 'Place new order with Market/Limit';
  }

  // Dynamic Button 2: Exit Position
  const exitBtnEl = document.getElementById('btn-pos-exit');
  const exitTitleEl = document.getElementById('pos-exit-title');
  const exitDescEl = document.getElementById('pos-exit-desc');
  if (exitTitleEl) {
    exitTitleEl.textContent = isLong ? 'Exit Position (SELL)' : isShort ? 'Exit Position (BUY)' : 'Trade Opposite (SELL)';
  }
  if (exitDescEl) {
    exitDescEl.textContent = isOpen ? 'Square off or reduce quantity with Market/Limit' : 'Place opposite side order';
  }
  if (exitBtnEl) {
    exitBtnEl.style.display = 'block';
  }

  // Quick 1-click square off link
  const quickExitEl = document.getElementById('btn-pos-quick-market-exit');
  if (quickExitEl) {
    quickExitEl.style.display = isOpen ? 'inline-block' : 'none';
  }

  const modal = document.getElementById('position-action-modal');
  if (modal) modal.classList.add('open');
}

function closePositionActionModal() {
  const modal = document.getElementById('position-action-modal');
  if (modal) modal.classList.remove('open');
}

function executePositionAction(actionType) {
  if (!selectedPositionAction) return;
  const pos = selectedPositionAction;
  closePositionActionModal();

  const netQty = pos.net_qty || 0;
  const isLong = netQty > 0;
  const ltp = Number(pos.ltp || 0);
  const lotSize = getLotSizeForSymbol(pos.symbol);

  if (actionType === 'ADD') {
    // Add More: same side as position (BUY if long, SELL if short)
    const side = isLong ? 'BUY' : (netQty < 0 ? 'SELL' : 'BUY');
    openPositionOrderModal(pos.symbol, side, lotSize, lotSize, ltp, pos.product || 'NRML', `Add to Position`);
  } else if (actionType === 'EXIT') {
    // Exit: opposite side to square off/reduce (SELL if long, BUY if short)
    const side = isLong ? 'SELL' : 'BUY';
    const openQty = Math.abs(netQty) || lotSize;
    openPositionOrderModal(pos.symbol, side, openQty, lotSize, ltp, pos.product || 'NRML', `Exit Position`);
  }
}

function executePositionQuickExit() {
  if (!selectedPositionAction) return;
  const symbol = selectedPositionAction.symbol;
  closePositionActionModal();
  exitSinglePosition(symbol);
}

// ---------------------------------------------------------
// Order Ticket Modal
// ---------------------------------------------------------
function openPositionOrderModal(symbol, side, qty, lotSize, ltp, product = 'NRML', modalTitle = 'Place Order') {
  state.orderSide = side;
  state.currentLotSize = lotSize || 65;
  state.currentLtp = ltp || 0.0;

  const titleEl = document.getElementById('order-modal-title');
  if (titleEl) titleEl.textContent = modalTitle;

  const symbolInput = document.getElementById('order-symbol');
  if (symbolInput) symbolInput.value = symbol;

  const symbolBadge = document.getElementById('modal-order-symbol-badge');
  if (symbolBadge) symbolBadge.textContent = symbol;

  const priceBadge = document.getElementById('modal-order-price-badge');
  if (priceBadge) {
    const numPrice = parseFloat(ltp);
    priceBadge.textContent = (!isNaN(numPrice) && numPrice > 0) ? `₹${numPrice.toFixed(2)}` : '₹0.00';
  }

  const qtyInput = document.getElementById('order-qty');
  if (qtyInput) qtyInput.value = qty;

  const priceInput = document.getElementById('order-price');
  if (priceInput) priceInput.value = (ltp && !isNaN(ltp)) ? parseFloat(ltp).toFixed(2) : 0.0;

  const lotHint = document.getElementById('order-lot-hint');
  if (lotHint) lotHint.innerText = `Qty: ${qty} | Lot size: ${state.currentLotSize}`;

  setOrderSide(side);
  setOrderProduct(product || 'NRML');
  setOrderType('MARKET');
  openOrderModal();
}

function quickOrder(symbol, side, lotSize, ltp) {
  openPositionOrderModal(symbol, side, lotSize || 65, lotSize || 65, ltp, 'NRML', 'Place Order');
}

function openOrderModal() {
  updateOrderModalIpBanner();
  document.getElementById('order-modal').classList.add('open');
}

function closeOrderModal() {
  document.getElementById('order-modal').classList.remove('open');
  const titleEl = document.getElementById('order-modal-title');
  if (titleEl) titleEl.textContent = 'Place Order';
}

function setOrderSide(side) {
  state.orderSide = side;
  const buyBtn = document.getElementById('side-buy-btn');
  const sellBtn = document.getElementById('side-sell-btn');
  const submitBtn = document.getElementById('order-submit-btn');
  const priceBadge = document.getElementById('modal-order-price-badge');

  if (side === 'BUY') {
    buyBtn.className = 'radio-card active buy';
    sellBtn.className = 'radio-card';
    submitBtn.style.background = 'var(--green)';
    if (priceBadge) {
      priceBadge.classList.remove('sell-price');
      priceBadge.classList.add('buy-price');
    }
  } else {
    buyBtn.className = 'radio-card';
    sellBtn.className = 'radio-card active sell';
    submitBtn.style.background = 'var(--red)';
    if (priceBadge) {
      priceBadge.classList.remove('buy-price');
      priceBadge.classList.add('sell-price');
    }
  }
  setOrderTarget(state.orderTargetMode || 'active');
}

function setOrderTarget(mode) {
  state.orderTargetMode = mode;
  const activeBtn = document.getElementById('btn-order-target-active');
  const allBtn = document.getElementById('btn-order-target-all');
  const modeInput = document.getElementById('order-target-mode');

  if (activeBtn && allBtn) {
    activeBtn.classList.toggle('active', mode === 'active');
    allBtn.classList.toggle('active', mode === 'all');
  }
  if (modeInput) modeInput.value = mode;

  const submitBtn = document.getElementById('order-submit-btn');
  if (submitBtn) {
    const side = state.orderSide || 'BUY';
    if (mode === 'all') {
      submitBtn.innerText = `Submit ${side} Order to ALL Accounts (${state.accounts.length})`;
    } else {
      const activeAcc = state.accounts.find(a => a.id === state.activeAccountId);
      const ucc = activeAcc ? activeAcc.ucc : 'Active';
      submitBtn.innerText = `Submit ${side} Order (${ucc})`;
    }
  }
}

function setOrderType(type) {
  const typeInput = document.getElementById('order-type');
  if (typeInput) typeInput.value = type;

  const buttons = document.querySelectorAll('#order-type-bar .segment-btn');
  buttons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });

  togglePriceFields();
}

function setOrderProduct(prod) {
  const prodInput = document.getElementById('order-product');
  if (prodInput) prodInput.value = prod;

  const buttons = document.querySelectorAll('#order-product-bar .segment-btn');
  buttons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.prod === prod);
  });
}

function togglePriceFields() {
  const type = (document.getElementById('order-type')?.value || 'MARKET').trim();
  const priceRow = document.getElementById('price-row');
  const limitGroup = document.getElementById('limit-price-group');
  const triggerGroup = document.getElementById('trigger-price-group');

  if (!priceRow || !limitGroup || !triggerGroup) return;

  if (type === 'LIMIT') {
    priceRow.style.display = 'grid';
    limitGroup.style.display = 'flex';
    triggerGroup.style.display = 'none';
  } else if (type === 'SL') {
    priceRow.style.display = 'grid';
    limitGroup.style.display = 'flex';
    triggerGroup.style.display = 'flex';
  } else if (type === 'SL-M') {
    priceRow.style.display = 'grid';
    limitGroup.style.display = 'none';
    triggerGroup.style.display = 'flex';
  } else {
    // MARKET
    priceRow.style.display = 'none';
    limitGroup.style.display = 'none';
    triggerGroup.style.display = 'none';
  }
}

function adjustQty(lotsDelta) {
  const input = document.getElementById('order-qty');
  let val = parseInt(input.value) || state.currentLotSize;
  val = Math.max(state.currentLotSize, val + (lotsDelta * state.currentLotSize));
  input.value = val;
}

async function submitOrder(e) {
  e.preventDefault();
  const symbol = document.getElementById('order-symbol').value.trim();
  const product = document.getElementById('order-product').value;
  const order_type = document.getElementById('order-type').value;
  const quantity = parseInt(document.getElementById('order-qty').value);
  const price = parseFloat(document.getElementById('order-price').value) || 0.0;
  const trigger_price = parseFloat(document.getElementById('order-trigger-price').value) || 0.0;
  const target_mode = state.orderTargetMode || 'active';

  const btn = document.getElementById('order-submit-btn');
  btn.disabled = true;
  btn.innerText = 'Submitting...';

  const symUpper = symbol.toUpperCase();
  const MCX_LIST = ['CRUDEOIL', 'CRUDEOILM', 'NATURALGAS', 'NATGASMINI', 'GOLD', 'GOLDM', 'SILVER', 'SILVERM', 'COPPER', 'ZINC', 'ALUMINIUM'];
  let exch = 'NFO';
  if (MCX_LIST.some(m => symUpper.startsWith(m))) {
    exch = 'MCX';
  } else if (symUpper.includes('SENSEX') || symUpper.includes('BANKEX')) {
    exch = 'BFO';
  }

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        exchange: exch,
        side: state.orderSide,
        product,
        order_type,
        quantity,
        price,
        trigger_price,
        target_mode,
      })
    });
    const data = await res.json();

    if (res.ok && data.status === 'success') {
      if (data.multi) {
        showToast(data.message, 'success');
        (data.results || []).forEach(r => {
          if (!r.success) {
            showToast(`⚠️ ${r.name} (${r.ucc}): ${r.message}`, 'error');
          }
        });
      } else {
        showToast(`Order Placed: #${data.order_id} (${data.ucc || ''})`, 'success');
      }
      closeOrderModal();
      loadOrders();
      loadPositions();
    } else {
      showToast(data.message || 'Order failed', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    setOrderTarget(state.orderTargetMode || 'active');
  }
}

// ---------------------------------------------------------
// Login Modal
// ---------------------------------------------------------
function openLoginModal() {
  document.getElementById('login-modal').classList.add('open');
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.remove('open');
}

// ---------------------------------------------------------
// Toast Notifications
// ---------------------------------------------------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Prevent toast buildup: keep maximum 2 visible toasts at a time
  while (container.children.length >= 2) {
    container.removeChild(container.firstChild);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.title = 'Click to dismiss';
  toast.onclick = () => toast.remove();

  const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : (type === 'warning' ? '⚠️' : 'ℹ️'));
  toast.innerHTML = `<span style="font-size: 13px;">${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  const duration = type === 'error' ? 5000 : 2000;
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'opacity 0.25s, transform 0.25s';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// ---------------------------------------------------------
// Static IP & Proxy Whitelist Management
// ---------------------------------------------------------
function updateOrderModalIpBanner() {
  const ipText = document.getElementById('order-ip-text');
  const ipBadge = document.getElementById('order-ip-badge');
  if (!ipText) return;

  if (state.useProxy && state.proxyUrl) {
    ipText.innerText = `Punching via Static Proxy: ${state.proxyUrl} (Registered: ${state.staticIp || 'Active'})`;
    ipBadge.innerText = 'Proxy Active';
    ipBadge.style.color = 'var(--green)';
    ipBadge.style.background = 'rgba(16, 185, 129, 0.15)';
  } else if (state.staticIp) {
    const outgoing = state.outgoingIp || 'Dynamic Network';
    const isMatch = state.outgoingIp && state.outgoingIp === state.staticIp;
    if (isMatch) {
      ipText.innerText = `Punching via: ${state.staticIp} (Verified Whitelist Match)`;
      ipBadge.innerText = 'Static IP Match';
      ipBadge.style.color = 'var(--green)';
      ipBadge.style.background = 'rgba(16, 185, 129, 0.15)';
    } else {
      ipText.innerHTML = `⚠️ Real Outgoing IP: <b>${outgoing}</b> &ne; Static IP: <b>${state.staticIp}</b> (Enable Proxy)`;
      ipBadge.innerText = '⚠️ IP Mismatch';
      ipBadge.style.color = 'var(--red)';
      ipBadge.style.background = 'rgba(239, 68, 68, 0.15)';
    }
  } else if (state.outgoingIp) {
    ipText.innerText = `Punching via: ${state.outgoingIp} (Dynamic/Home IP - Not Whitelisted)`;
    ipBadge.innerText = '⚠️ Dynamic IP';
    ipBadge.style.color = 'var(--yellow)';
    ipBadge.style.background = 'rgba(245, 158, 11, 0.15)';
  } else {
    ipText.innerText = 'Punching via: Direct Network Route (Whitelist Required)';
    ipBadge.innerText = '⚠️ Unconfigured IP';
    ipBadge.style.color = 'var(--text-muted)';
    ipBadge.style.background = 'var(--border)';
  }
}

async function loadStaticIpSettings() {
  try {
    const res = await fetch('/api/static-ip');
    const data = await res.json();
    if (data.status === 'success' && data.settings) {
      state.staticIp = data.settings.static_ip || '';
      state.proxyUrl = data.settings.proxy_url || '';
      state.useProxy = Boolean(data.settings.use_proxy);

      const staticInput = document.getElementById('setting-static-ip');
      const proxyInput = document.getElementById('setting-proxy-url');
      const useProxyCheck = document.getElementById('setting-use-proxy');

      if (staticInput) staticInput.value = state.staticIp;
      if (proxyInput) proxyInput.value = state.proxyUrl;
      if (useProxyCheck) useProxyCheck.checked = state.useProxy;

      const staticDisp = document.getElementById('ip-display-static');
      if (staticDisp) {
        staticDisp.innerText = state.staticIp ? state.staticIp : 'Not Configured';
        staticDisp.style.color = state.staticIp ? 'var(--blue)' : 'var(--text-dim)';
      }

      const routeDisp = document.getElementById('ip-display-route');
      if (routeDisp) {
        if (state.useProxy && state.proxyUrl) {
          routeDisp.innerText = 'Static Proxy Active';
          routeDisp.style.color = 'var(--green)';
        } else if (state.staticIp) {
          routeDisp.innerText = 'Static IP Header Active';
          routeDisp.style.color = 'var(--blue)';
        } else {
          routeDisp.innerText = 'Direct Line';
          routeDisp.style.color = 'var(--text-muted)';
        }
      }

      updateOrderModalIpBanner();
    }
  } catch (err) {
    console.error('Error loading static IP settings:', err);
  }
}

async function saveStaticIpSettings(e) {
  if (e) e.preventDefault();
  const staticIp = (document.getElementById('setting-static-ip').value || '').trim();
  const proxyUrl = (document.getElementById('setting-proxy-url').value || '').trim();
  const useProxy = document.getElementById('setting-use-proxy').checked;
  const btn = document.getElementById('btn-save-ip');

  btn.disabled = true;
  btn.innerText = 'Saving...';

  try {
    const res = await fetch('/api/static-ip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        static_ip: staticIp,
        proxy_url: proxyUrl,
        use_proxy: useProxy,
      }),
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      showToast('Static IP & Proxy configuration saved!', 'success');
      state.staticIp = staticIp;
      state.proxyUrl = proxyUrl;
      state.useProxy = useProxy;
      loadStaticIpSettings();
      testOutgoingIp();
    } else {
      showToast(data.message || 'Failed to save settings', 'error');
    }
  } catch (err) {
    showToast('Failed to save settings: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = '💾 Save & Apply Static IP';
  }
}

async function testOutgoingIp() {
  const btn = document.getElementById('btn-test-ip');
  const outDisp = document.getElementById('ip-display-outgoing');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Testing IP...';
  }
  if (outDisp) outDisp.innerText = 'Querying outgoing IP...';

  try {
    const res = await fetch('/api/test-ip');
    const data = await res.json();
    if (data.status === 'success') {
      state.outgoingIp = data.outgoing_ip;
      if (outDisp) {
        if (data.is_static_match) {
          outDisp.innerHTML = `${data.outgoing_ip} <span style="font-size: 11px; color: var(--green); margin-left: 6px;">● Verified Match</span>`;
        } else if (state.staticIp) {
          outDisp.innerHTML = `${data.outgoing_ip} <span style="font-size: 11px; color: var(--yellow); margin-left: 6px;">(Registered: ${state.staticIp})</span>`;
        } else {
          outDisp.innerText = data.outgoing_ip;
        }
      }
      updateOrderModalIpBanner();
      showToast(`Current Outgoing IP: ${data.outgoing_ip}`, 'info');
    } else {
      if (outDisp) outDisp.innerText = data.outgoing_ip || 'Error checking IP';
      showToast(data.message || 'Error checking outgoing IP', 'error');
    }
  } catch (err) {
    if (outDisp) outDisp.innerText = 'Failed to connect';
    showToast('Failed to check outgoing IP: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '🔍 Check Outgoing IP';
    }
  }
}

// =========================================================
// Basket Orders Management & Execution
// =========================================================

function resolveExchange(symbol) {
  const sym = (symbol || '').toUpperCase();
  const MCX_LIST = ['CRUDEOIL', 'CRUDEOILM', 'NATURALGAS', 'NATGASMINI', 'GOLD', 'GOLDM', 'SILVER', 'SILVERM', 'COPPER', 'ZINC', 'ALUMINIUM'];
  if (MCX_LIST.some(m => sym.startsWith(m))) return 'MCX';
  if (sym.includes('SENSEX') || sym.includes('BANKEX')) return 'BFO';
  return 'NFO';
}

function getLotSizeForSymbol(symbol) {
  const sym = (symbol || '').toUpperCase();
  for (const [key, size] of Object.entries(state.lotSizes)) {
    if (sym.startsWith(key)) return size;
  }
  return 50;
}

function loadBasketFromStorage() {
  try {
    const raw = localStorage.getItem('zeroalgo_basket');
    if (raw) {
      state.basket = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to load basket from storage', err);
    state.basket = [];
  }
  updateBasketModeUI();
}

function saveBasketToStorage() {
  try {
    localStorage.setItem('zeroalgo_basket', JSON.stringify(state.basket));
  } catch (err) {
    console.error('Failed to save basket to storage', err);
  }
  updateBasketModeUI();
}

function toggleBasketMode() {
  state.basketMode = !state.basketMode;
  updateBasketModeUI();
  // Immediately re-render option chain table so action cells switch to B/S or BUY/SELL
  loadOptionChain(true);
  showToast(
    state.basketMode
      ? '🧺 Basket Mode ON: Click [B] or [S] on any strike to add/remove'
      : 'Basket Mode OFF: Click BUY/SELL to punch orders directly',
    'info'
  );
}

function updateBasketModeUI() {
  const btn = document.getElementById('btn-basket-mode');
  const statusText = document.getElementById('basket-mode-status-text');
  const badge = document.getElementById('basket-mode-count-badge');
  const dock = document.getElementById('oc-basket-dock');
  const dockCount = document.getElementById('dock-legs-count');
  const dockSummary = document.getElementById('dock-legs-summary');
  const dockChips = document.getElementById('dock-legs-chips');
  const dockExecBtn = document.getElementById('btn-dock-execute');
  const dockAccsCount = document.getElementById('dock-accs-count');

  if (dockAccsCount) {
    dockAccsCount.innerText = state.accounts.length || 1;
  }

  const count = state.basket.length;

  if (btn && statusText) {
    btn.classList.toggle('active', !!state.basketMode);
    statusText.innerText = state.basketMode ? 'ON' : 'OFF';
  }

  if (badge) {
    badge.innerText = `${count} Leg${count === 1 ? '' : 's'}`;
    badge.style.display = (state.basketMode || count > 0) ? 'inline-block' : 'none';
  }

  // Show dock whenever Basket Mode is ON or there are legs in the basket
  if (dock) {
    dock.style.display = (state.basketMode || count > 0) ? 'block' : 'none';
  }

  if (dockCount) dockCount.innerText = count;

  if (dockSummary) {
    if (count === 0) {
      dockSummary.innerText = 'Click [B] or [S] on any strike in the table to add';
    } else {
      const buys = state.basket.filter(l => l.side === 'BUY').length;
      const sells = state.basket.filter(l => l.side === 'SELL').length;
      const totalLots = state.basket.reduce((acc, l) => acc + (parseInt(l.lots) || 1), 0);
      dockSummary.innerText = `${buys} BUY, ${sells} SELL • ${totalLots} Total Lots`;
    }
  }

  if (dockChips) {
    if (count === 0) {
      dockChips.innerHTML = '<span style="font-size: 11px; color: var(--text-dim); font-style: italic;">No strikes selected yet</span>';
    } else {
      dockChips.innerHTML = state.basket.map((leg) => {
        const isBuy = leg.side === 'BUY';
        const chipClass = isBuy ? 'buy-chip' : 'sell-chip';
        return `
          <div class="dock-leg-chip ${chipClass}">
            <strong>${leg.side}</strong>
            <span>${leg.symbol}</span>
            <span class="dock-chip-qty">${leg.lots || 1} Lot (${leg.quantity})</span>
            <span class="dock-chip-remove" onclick="removeBasketLegBySymbol('${leg.symbol}')" title="Remove strike">✕</span>
          </div>
        `;
      }).join('');
    }
  }

  if (dockExecBtn) {
    dockExecBtn.disabled = count === 0;
    dockExecBtn.style.opacity = count === 0 ? '0.5' : '1';
    dockExecBtn.innerText = count === 0 ? '🚀 Place Basket Order' : `🚀 Place Basket Order (${count} Legs)`;
  }
}

function toggleBasketStrike(symbol, side, lotSize, ltp) {
  const existingIdx = state.basket.findIndex(l => l.symbol === symbol);
  const lSize = lotSize || getLotSizeForSymbol(symbol);

  if (existingIdx >= 0) {
    const existing = state.basket[existingIdx];
    if (existing.side === side) {
      // Clicked the active side again -> remove from basket
      state.basket.splice(existingIdx, 1);
      showToast(`Removed ${symbol} from Basket`, 'info');
    } else {
      // Clicked opposite side -> flip side
      existing.side = side;
      showToast(`Switched ${symbol} to ${side}`, 'info');
    }
  } else {
    // Add new strike with 1 lot
    state.basket.push({
      symbol: symbol,
      side: side,
      product: 'NRML',
      order_type: 'MARKET',
      lots: 1,
      quantity: lSize,
      price: ltp || 0.0,
      exchange: resolveExchange(symbol),
      lotSize: lSize,
      status: 'Draft',
      order_id: null,
      error: null
    });
    showToast(`Added ${symbol} (${side}) to Basket`, 'success');
  }

  saveBasketToStorage();
  loadOptionChain(true); // Re-render table cells immediately
}

function setBasketLegLots(symbol, lotsVal) {
  const leg = state.basket.find(l => l.symbol === symbol);
  if (leg) {
    leg.lots = parseInt(lotsVal) || 1;
    leg.quantity = leg.lots * (leg.lotSize || getLotSizeForSymbol(symbol));
    saveBasketToStorage();
  }
}

function removeBasketLegBySymbol(symbol) {
  const idx = state.basket.findIndex(l => l.symbol === symbol);
  if (idx >= 0) {
    state.basket.splice(idx, 1);
    saveBasketToStorage();
    loadOptionChain(true);
    showToast(`Removed ${symbol} from Basket`, 'info');
  }
}

function clearBasket() {
  if (state.basket.length === 0) return;
  state.basket = [];
  saveBasketToStorage();
  loadOptionChain(true);
  showToast('Basket cleared', 'info');
}

function setBasketTarget(mode) {
  state.basketTargetMode = mode;
  const activeBtn = document.getElementById('dock-target-active');
  const allBtn = document.getElementById('dock-target-all');
  if (activeBtn && allBtn) {
    activeBtn.classList.toggle('active', mode === 'active');
    allBtn.classList.toggle('active', mode === 'all');
  }
  updateBasketModeUI();
}

function addCurrentModalToBasket() {
  const symbol = (document.getElementById('order-symbol').value || '').trim();
  if (!symbol) {
    showToast('Please select an option contract first', 'error');
    return;
  }

  const side = state.orderSide || 'BUY';
  const product = document.getElementById('order-product').value || 'NRML';
  const order_type = document.getElementById('order-type').value || 'MARKET';
  const quantity = parseInt(document.getElementById('order-qty').value) || state.currentLotSize || 50;
  const price = parseFloat(document.getElementById('order-price').value) || 0.0;
  const exchange = resolveExchange(symbol);
  const lotSize = state.currentLotSize || getLotSizeForSymbol(symbol);
  const lots = Math.max(1, Math.round(quantity / lotSize));

  const existing = state.basket.find(l => l.symbol === symbol);
  if (existing) {
    existing.side = side;
    existing.product = product;
    existing.order_type = order_type;
    existing.lots = lots;
    existing.quantity = quantity;
    existing.price = price;
  } else {
    state.basket.push({
      symbol,
      side,
      product,
      order_type,
      lots,
      quantity,
      price,
      exchange,
      lotSize,
      status: 'Draft',
      order_id: null,
      error: null
    });
  }

  saveBasketToStorage();
  loadOptionChain(true);
  closeOrderModal();
  showToast(`Added ${symbol} (${side}) to Basket (${state.basket.length} total)`, 'success');
}

async function executeBasket() {
  if (state.basket.length === 0) {
    showToast('Basket is empty. Add strikes first.', 'error');
    return;
  }

  const btn = document.getElementById('btn-dock-execute');
  if (btn) {
    btn.disabled = true;
    btn.innerText = `⏳ Placing ${state.basket.length} Orders...`;
  }

  const payload = {
    orders: state.basket.map(l => ({
      symbol: l.symbol,
      exchange: l.exchange || resolveExchange(l.symbol),
      side: l.side,
      product: l.product || 'NRML',
      order_type: l.order_type || 'MARKET',
      quantity: l.quantity,
      price: l.order_type === 'LIMIT' ? (parseFloat(l.price) || 0.0) : 0.0,
      trigger_price: 0.0,
    })),
    target_mode: state.basketTargetMode || 'active'
  };

  try {
    const res = await fetch('/api/basket-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.results && Array.isArray(data.results)) {
      const placed = data.results.filter(r => r.success);
      const failed = data.results.filter(r => !r.success);

      if (placed.length > 0 && failed.length === 0) {
        showToast(`All ${placed.length} Basket Orders Placed Successfully!`, 'success');
        // Clear placed basket
        state.basket = [];
        saveBasketToStorage();
        loadOptionChain(true);
      } else if (placed.length > 0 && failed.length > 0) {
        showToast(`Basket Partial: ${placed.length} placed, ${failed.length} failed. Check Orders.`, 'warning');
      } else {
        const firstErr = failed[0] ? failed[0].message : 'Order failed';
        showToast(`Basket Failed: ${firstErr}`, 'error');
      }
    } else {
      showToast(data.message || 'Basket execution finished', data.status === 'error' ? 'error' : 'success');
    }

    loadOrders(); // Refresh orders book immediately
  } catch (err) {
    console.error('Basket execution error', err);
    showToast('Basket execution error: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = state.basket.length === 0 ? '🚀 Place Basket Order' : `🚀 Place Basket Order (${state.basket.length} Legs)`;
    }
  }
}
