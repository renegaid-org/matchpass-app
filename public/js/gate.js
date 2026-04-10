import { api } from './api.js';
import { QRScanner, NFCScanner } from './scanner.js';
import { escapeHtml } from './utils.js';
import { parseCredential } from './credential.js';

let scanner = null;
let currentMode = 'qr';

export function initGateView(videoEl, resultEl) {
  // Hide NFC button if not supported
  const nfcBtn = document.getElementById('btn-nfc');
  if (nfcBtn && !NFCScanner.isSupported()) {
    nfcBtn.style.display = 'none';
  }

  startQRMode(videoEl);

  resultEl.addEventListener('click', () => {
    resultEl.style.display = 'none';
    if (currentMode === 'qr' && scanner) {
      scanner.scanning = true;
      scanner._scanLoop();
    }
  });

  window.toggleGateMode = function(mode) {
    if (mode === currentMode) return;
    if (scanner) { scanner.stop(); scanner = null; }
    currentMode = mode;

    const cameraArea = document.getElementById('camera-area');
    const nfcArea = document.getElementById('nfc-area');
    const btnQR = document.getElementById('btn-qr');
    const btnNFC = document.getElementById('btn-nfc');

    if (mode === 'nfc') {
      if (cameraArea) cameraArea.style.display = 'none';
      if (nfcArea) nfcArea.style.display = 'flex';
      if (btnQR) { btnQR.classList.remove('active'); btnQR.style.background = '#1e293b'; btnQR.style.color = '#64748b'; }
      if (btnNFC) { btnNFC.classList.add('active'); btnNFC.style.background = '#2d6a4f'; btnNFC.style.color = 'white'; }
      startNFCMode();
    } else {
      if (cameraArea) cameraArea.style.display = 'block';
      if (nfcArea) nfcArea.style.display = 'none';
      if (btnQR) { btnQR.classList.add('active'); btnQR.style.background = '#2d6a4f'; btnQR.style.color = 'white'; }
      if (btnNFC) { btnNFC.classList.remove('active'); btnNFC.style.background = '#1e293b'; btnNFC.style.color = '#64748b'; }
      startQRMode(videoEl);
    }
  };
}

function startQRMode(videoEl) {
  scanner = new QRScanner(videoEl, handleScan);
  scanner.start();
}

async function startNFCMode() {
  try {
    scanner = new NFCScanner(handleScan);
    await scanner.start();
  } catch (err) {
    console.error('NFC start failed:', err);
    const nfcText = document.querySelector('.nfc-text');
    if (nfcText) nfcText.textContent = 'NFC not available: ' + err.message;
  }
}

async function handleScan(qrData) {
  const resultEl = document.getElementById('gate-result');
  const photoEl = document.getElementById('gate-photo');
  const statusTextEl = document.getElementById('gate-status-text');
  const statusDetailEl = document.getElementById('gate-status-detail');

  try {
    const credential = await parseCredential(qrData);
    const { pubkey, photo_hash, blossom_url } = credential;

    const blossomBase = blossom_url || window.__BLOSSOM_BASE || '';
    const photoUrl = photo_hash ? `${blossomBase}/${photo_hash}` : null;

    const scanBody = credential.raw_event
      ? { venue_entry_event: credential.raw_event, scan_type: 'gate_entry' }
      : { fan_signet_pubkey: pubkey, photo_hash, scan_type: 'gate_entry' };

    const scanResult = await api('/api/scan', {
      method: 'POST',
      body: scanBody,
    });

    let detail = '';
    if (scanResult.duplicate) {
      detail = 'Duplicate scan — flagged for review';
    } else if (scanResult.colour === 'amber') {
      detail = scanResult.photoMismatch ? 'Photo mismatch' : `${scanResult.yellowCount} yellow${scanResult.yellowCount !== 1 ? 's' : ''}`;
    } else if (scanResult.colour === 'red') {
      detail = scanResult.reason || 'Entry denied';
    }

    showResult(resultEl, scanResult.colour, scanResult.colour.toUpperCase(), detail, photoUrl, photoEl, statusTextEl, statusDetailEl);
  } catch (err) {
    console.error('Scan error:', err);
    showResult(resultEl, 'amber', 'ERROR', err.message, null, photoEl, statusTextEl, statusDetailEl);
  }
}

function showResult(resultEl, colour, text, detail, photoUrl, photoEl, statusTextEl, statusDetailEl) {
  resultEl.className = `gate-result ${colour}`;
  resultEl.style.display = 'flex';

  if (photoUrl) {
    const img = document.createElement('img');
    img.src = photoUrl;
    img.alt = 'Fan photo';
    img.onerror = function() { this.parentNode.innerHTML = '<div class="no-photo">No photo available</div>'; };
    photoEl.innerHTML = '';
    photoEl.appendChild(img);
  } else {
    photoEl.innerHTML = '<div class="no-photo">No photo</div>';
  }

  statusTextEl.textContent = text;
  statusDetailEl.textContent = detail;

  if (colour === 'green') {
    setTimeout(() => { resultEl.style.display = 'none'; }, 3000);
  }
}
