import { api } from './api.js';
import { QRScanner } from './scanner.js';
import { escapeHtml } from './utils.js';
import { parseCredential } from './credential.js';

let parentScanner = null;
let childScanner = null;
let parentData = null;
let childData = null;

export async function initSafeguarding() {
  const parentVideo = document.getElementById('sg-parent-video');
  parentScanner = new QRScanner(parentVideo, handleParentScan);
  parentScanner.start();
  await loadLinkages();
}

async function handleParentScan(qrData) {
  try {
    const cred = await parseCredential(qrData);
    parentData = cred;
    parentScanner.stop();

    const blossomBase = cred.blossom_url || window.__BLOSSOM_BASE || '';
    const photoSrc = cred.photo_hash ? `${blossomBase}/${cred.photo_hash}` : '';
    document.getElementById('sg-parent-photo').src = photoSrc;
    document.getElementById('sg-parent-pubkey').textContent = cred.pubkey.slice(0, 16) + '...';

    document.getElementById('sg-step-parent').style.display = 'none';
    document.getElementById('sg-step-child').style.display = 'block';

    const childVideo = document.getElementById('sg-child-video');
    childScanner = new QRScanner(childVideo, handleChildScan);
    childScanner.start();
  } catch (err) {
    console.error(err);
  }
}

async function handleChildScan(qrData) {
  try {
    const cred = await parseCredential(qrData);
    childData = cred;
    childScanner.stop();

    const parentBlossom = parentData.blossom_url || window.__BLOSSOM_BASE || '';
    const childBlossom = cred.blossom_url || window.__BLOSSOM_BASE || '';
    document.getElementById('sg-confirm-parent').src = parentData.photo_hash ? `${parentBlossom}/${parentData.photo_hash}` : '';
    document.getElementById('sg-confirm-child').src = cred.photo_hash ? `${childBlossom}/${cred.photo_hash}` : '';

    document.getElementById('sg-step-child').style.display = 'none';
    document.getElementById('sg-step-confirm').style.display = 'block';
  } catch (err) {
    console.error(err);
  }
}

window.confirmLinkage = async function() {
  if (!parentData || !childData) return;
  const relationship = document.getElementById('sg-relationship').value;

  try {
    await api('/api/linkages', {
      method: 'POST',
      body: {
        parent_signet_pubkey: parentData.pubkey,
        child_signet_pubkey: childData.pubkey,
        relationship,
      },
    });

    document.getElementById('sg-step-confirm').style.display = 'none';
    document.getElementById('sg-result').style.display = 'block';
    setTimeout(() => {
      document.getElementById('sg-result').style.display = 'none';
      resetSafeguarding();
    }, 3000);
    await loadLinkages();
  } catch (err) {
    alert('Verification failed: ' + err.message);
  }
};

window.resetSafeguarding = function() {
  parentData = null;
  childData = null;
  if (parentScanner) parentScanner.stop();
  if (childScanner) childScanner.stop();
  document.querySelectorAll('.sg-step').forEach(el => el.style.display = 'none');
  document.getElementById('sg-step-parent').style.display = 'block';
  document.getElementById('sg-result').style.display = 'none';
  const parentVideo = document.getElementById('sg-parent-video');
  parentScanner = new QRScanner(parentVideo, handleParentScan);
  parentScanner.start();
};

async function loadLinkages() {
  try {
    const linkages = await api('/api/linkages');
    const el = document.getElementById('sg-linkages-list');
    if (linkages.length === 0) {
      el.innerHTML = '<p style="color:#64748b;font-style:italic;">No verified linkages yet.</p>';
    } else {
      el.innerHTML = linkages.map(l => `
        <div style="background:#1e293b;padding:1rem;border-radius:8px;border-left:4px solid #059669;margin-bottom:0.5rem;">
          <div style="font-size:0.9rem;color:#95d5b2;">${escapeHtml(l.relationship)} linkage</div>
          <div style="font-size:0.75rem;color:#64748b;font-family:monospace;">Parent: ${escapeHtml(l.parent_signet_pubkey.slice(0,16))}...</div>
          <div style="font-size:0.75rem;color:#64748b;font-family:monospace;">Child: ${escapeHtml(l.child_signet_pubkey.slice(0,16))}...</div>
          <div style="font-size:0.75rem;color:#64748b;margin-top:0.25rem;">Verified by ${escapeHtml(l.verified_by_name)} on ${new Date(l.verified_at).toLocaleDateString()}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error(err);
  }
}
