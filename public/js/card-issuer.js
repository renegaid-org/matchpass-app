import { api } from './api.js';
import { QRScanner } from './scanner.js';
import { escapeHtml } from './utils.js';
import { parseCredential } from './credential.js';

let scanner = null;
let currentFan = null;
let selectedCardType = 'yellow';

export function initCardIssuerView() {
  const videoEl = document.getElementById('ci-video');
  scanner = new QRScanner(videoEl, handleScan);
  scanner.start();
}

async function handleScan(qrData) {
  try {
    const credential = await parseCredential(qrData);
    const { pubkey, photo_hash, blossom_url } = credential;

    currentFan = { pubkey, photo_hash };

    // Show fan info
    const blossomBase = blossom_url || window.__BLOSSOM_BASE || '';
    const photoSrc = photo_hash ? `${blossomBase}/${photo_hash}` : '';
    document.getElementById('ci-fan-photo').src = photoSrc;
    document.getElementById('ci-fan-photo').onerror = function() { this.style.display = 'none'; };

    // Get fan status via scan API (roaming_check, not gate_entry)
    const scanBody = credential.raw_event
      ? { venue_entry_event: credential.raw_event, scan_type: 'roaming_check' }
      : { fan_signet_pubkey: pubkey, photo_hash, scan_type: 'roaming_check' };

    const scanResult = await api('/api/scan', {
      method: 'POST',
      body: scanBody,
    });

    const statusEl = document.getElementById('ci-fan-status');
    const detailEl = document.getElementById('ci-fan-detail');
    statusEl.textContent = scanResult.colour.toUpperCase();
    statusEl.style.color = scanResult.colour === 'green' ? '#059669' : scanResult.colour === 'amber' ? '#d97706' : '#dc2626';
    detailEl.textContent = scanResult.reason || (scanResult.yellowCount > 0 ? `${scanResult.yellowCount} yellow(s)` : 'Clean');

    // Show auto-red warning if they have 1+ active yellows
    const warningEl = document.getElementById('ci-auto-red-warning');
    warningEl.style.display = scanResult.yellowCount >= 1 && selectedCardType === 'yellow' ? 'block' : 'none';

    document.getElementById('ci-scanner-mode').style.display = 'none';
    document.getElementById('ci-fan-info').style.display = 'block';
    scanner.stop();
  } catch (err) {
    console.error('Scan error:', err);
  }
}

window.selectCardType = function(type) {
  selectedCardType = type;
  document.querySelectorAll('.ci-type-btn').forEach(btn => {
    btn.style.opacity = btn.dataset.type === type ? '1' : '0.4';
  });
  // Update auto-red warning
  const warningEl = document.getElementById('ci-auto-red-warning');
  if (warningEl && currentFan) {
    const detailText = document.getElementById('ci-fan-detail').textContent;
    const hasYellows = detailText.includes('yellow');
    warningEl.style.display = hasYellows && type === 'yellow' ? 'block' : 'none';
  }
};

window.submitCard = async function() {
  if (!currentFan) return;
  const category = document.getElementById('ci-category').value;
  if (!category) { alert('Select a category'); return; }

  const body = {
    card_type: selectedCardType,
    fan_signet_pubkey: currentFan.pubkey,
    category,
    match_date: new Date().toISOString().split('T')[0],
    notes: document.getElementById('ci-notes').value || null,
    seat_or_location: document.getElementById('ci-seat').value || null,
  };

  try {
    const result = await api('/api/cards', { method: 'POST', body });
    showCardResult(selectedCardType, result.autoRed);
  } catch (err) {
    alert('Failed to issue card: ' + err.message);
  }
};

window.cancelCard = function() {
  currentFan = null;
  document.getElementById('ci-fan-info').style.display = 'none';
  document.getElementById('ci-scanner-mode').style.display = 'block';
  document.getElementById('ci-category').value = '';
  document.getElementById('ci-notes').value = '';
  document.getElementById('ci-seat').value = '';
  scanner.start();
};

window.showUnlinkedForm = function() {
  scanner.stop();
  document.getElementById('ci-scanner-mode').style.display = 'none';
  document.getElementById('ci-unlinked-form').style.display = 'block';
};

window.cancelUnlinked = function() {
  document.getElementById('ci-unlinked-form').style.display = 'none';
  document.getElementById('ci-scanner-mode').style.display = 'block';
  scanner.start();
};

window.submitUnlinked = async function() {
  const description = document.getElementById('ci-ul-description').value;
  if (!description) { alert('Description required'); return; }
  const category = document.getElementById('ci-ul-category').value;
  if (!category) { alert('Select a category'); return; }

  try {
    await api('/api/cards/unlinked', {
      method: 'POST',
      body: {
        card_type: 'yellow',
        category,
        match_date: new Date().toISOString().split('T')[0],
        seat_or_location: document.getElementById('ci-ul-seat').value || null,
        description,
      },
    });
    showCardResult('yellow', false, true);
  } catch (err) {
    alert('Failed: ' + err.message);
  }
};

function showCardResult(type, autoRed, unlinked = false) {
  const resultEl = document.getElementById('ci-result');
  const textEl = document.getElementById('ci-result-text');
  const detailEl = document.getElementById('ci-result-detail');

  resultEl.style.background = type === 'yellow' ? '#d97706' : '#dc2626';
  resultEl.style.display = 'flex';
  textEl.textContent = `${type.toUpperCase()} CARD ISSUED`;
  detailEl.textContent = autoRed ? 'AUTO RED TRIGGERED — review pending' : (unlinked ? 'Unlinked — match to credential later' : 'Notification sent to fan');

  setTimeout(() => {
    resultEl.style.display = 'none';
    currentFan = null;
    document.getElementById('ci-fan-info').style.display = 'none';
    document.getElementById('ci-unlinked-form').style.display = 'none';
    document.getElementById('ci-scanner-mode').style.display = 'block';
    document.getElementById('ci-category').value = '';
    document.getElementById('ci-notes').value = '';
    document.getElementById('ci-seat').value = '';
    scanner.start();
  }, 3000);
}
