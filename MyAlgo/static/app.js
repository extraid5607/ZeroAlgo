// =========================================================
// MyAlgo Trading Terminal Client
// =========================================================

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
  },
  authenticated: false,
  ocView: 'all',
  staticIp: '',
  proxyUrl: '',
  useProxy: false,
  outgoingIp: '',
};

// ---------------------------------------------------------
// Initialization
// ---------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkSession();
  loadExpiries(state.selectedIndex);
  loadFunds();
  loadStaticIpSettings();
  testOutgoingIp();

  // Background polling intervals
  setInterval(checkSession, 15000);
  setInterval(loadFunds, 10000);

  setInterval(() => {
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
// Session & Auth
// ---------------------------------------------------------
async function checkSession() {
  try {
    const res = await fetch('/api/session');
    const data = await res.json();
    state.authenticated = data.authenticated;

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

  // Update pill buttons
  document.querySelectorAll('#index-pills .pill-btn').forEach(b => {
    b.classList.toggle('active', b.innerText === indexName);
  });

  loadExpiries(indexName);
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

      const ceBuyBtn = ce.symbol ? `<button class="btn btn-buy" onclick="quickOrder('${ce.symbol}', 'BUY', ${ce.lotsize || state.currentLotSize}, ${ce.ltp || 0})">BUY</button>` : '';
      const ceSellBtn = ce.symbol ? `<button class="btn btn-sell" onclick="quickOrder('${ce.symbol}', 'SELL', ${ce.lotsize || state.currentLotSize}, ${ce.ltp || 0})">SELL</button>` : '';

      const peBuyBtn = pe.symbol ? `<button class="btn btn-buy" onclick="quickOrder('${pe.symbol}', 'BUY', ${pe.lotsize || state.currentLotSize}, ${pe.ltp || 0})">BUY</button>` : '';
      const peSellBtn = pe.symbol ? `<button class="btn btn-sell" onclick="quickOrder('${pe.symbol}', 'SELL', ${pe.lotsize || state.currentLotSize}, ${pe.ltp || 0})">SELL</button>` : '';

      rowsHtml += `
        <tr class="${isAtm ? 'atm-row' : ''}">
          <td class="th-call td-call" style="color: var(--text-muted); font-size: 12px;">${ceOi}</td>
          <td class="th-call td-call" style="font-weight: 700; color: var(--text-main);">${ceLtp}</td>
          <td class="th-call td-call">
            <div class="action-cell">
              ${ceBuyBtn}
              ${ceSellBtn}
            </div>
          </td>
          <td class="td-strike">${row.strike}${isAtm ? ' <span style="font-size: 10px; color: var(--blue);">●</span>' : ''}</td>
          <td class="th-put td-put">
            <div class="action-cell" style="justify-content: flex-start;">
              ${peBuyBtn}
              ${peSellBtn}
            </div>
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
      ? `<button class="btn btn-danger" style="padding: 4px 12px; font-size: 11px; font-weight: 700;" onclick="exitSinglePosition('${p.symbol}')">Square Off</button>`
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
                <button class="btn-sq-mini" onclick="exitSinglePosition('${p.symbol}')" title="Square off this position">
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
          <button class="btn-sq-mini" onclick="exitSinglePosition('${p.symbol}')" title="Square off this position">
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
// Order Ticket Modal
// ---------------------------------------------------------
function quickOrder(symbol, side, lotSize, ltp) {
  state.orderSide = side;
  state.currentLotSize = lotSize || 65;
  state.currentLtp = ltp || 0.0;

  const symbolInput = document.getElementById('order-symbol');
  if (symbolInput) symbolInput.value = symbol;

  const symbolBadge = document.getElementById('modal-order-symbol-badge');
  if (symbolBadge) symbolBadge.textContent = symbol;

  const priceBadge = document.getElementById('modal-order-price-badge');
  if (priceBadge) {
    const numPrice = parseFloat(ltp);
    priceBadge.textContent = (!isNaN(numPrice) && numPrice > 0) ? `₹${numPrice.toFixed(2)}` : '₹0.00';
  }

  document.getElementById('order-qty').value = state.currentLotSize;
  document.getElementById('order-price').value = ltp || 0.0;
  const lotHint = document.getElementById('order-lot-hint');
  if (lotHint) lotHint.innerText = `Lot size: ${state.currentLotSize}`;

  setOrderSide(side);
  setOrderProduct('NRML');
  setOrderType('MARKET');
  openOrderModal();
}

function openOrderModal() {
  updateOrderModalIpBanner();
  document.getElementById('order-modal').classList.add('open');
}

function closeOrderModal() {
  document.getElementById('order-modal').classList.remove('open');
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
    submitBtn.innerText = 'Submit BUY Order';
    submitBtn.style.background = 'var(--green)';
    if (priceBadge) {
      priceBadge.classList.remove('sell-price');
      priceBadge.classList.add('buy-price');
    }
  } else {
    buyBtn.className = 'radio-card';
    sellBtn.className = 'radio-card active sell';
    submitBtn.innerText = 'Submit SELL Order';
    submitBtn.style.background = 'var(--red)';
    if (priceBadge) {
      priceBadge.classList.remove('buy-price');
      priceBadge.classList.add('sell-price');
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

  const btn = document.getElementById('order-submit-btn');
  btn.disabled = true;

  const exch = symbol.toUpperCase().includes('SENSEX') ? 'BFO' : 'NFO';

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
        trigger_price
      })
    });
    const data = await res.json();

    if (res.ok && data.status === 'success') {
      showToast(`Order Placed: #${data.order_id}`, 'success');
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
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  container.appendChild(toast);

  const duration = type === 'error' ? 7000 : 4000;
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
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
