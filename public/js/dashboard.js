import { api } from './api.js';
import { escapeHtml } from './utils.js';

export async function initDashboard() {
  await loadToday();
  await loadCards();
  await loadReviewQueue();
  await loadScanFlags();
  await loadStats();
}

async function loadToday() {
  try {
    const data = await api('/api/dashboard/today');
    const summary = document.getElementById('dash-today-summary');
    const green = data.scans.green || 0;
    const amber = data.scans.amber || 0;
    const red = data.scans.red || 0;
    const total = green + amber + red + (data.scans.mismatch || 0);

    summary.innerHTML = `
      <div style="background:#1e293b;padding:1rem;border-radius:8px;text-align:center;">
        <div style="font-size:2rem;font-weight:900;color:#d8f3dc;">${total}</div>
        <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;">Total Scans</div>
      </div>
      <div style="background:#1e293b;padding:1rem;border-radius:8px;text-align:center;">
        <div style="font-size:2rem;font-weight:900;color:#059669;">${green}</div>
        <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;">Green</div>
      </div>
      <div style="background:#1e293b;padding:1rem;border-radius:8px;text-align:center;">
        <div style="font-size:2rem;font-weight:900;color:#d97706;">${amber}</div>
        <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;">Amber</div>
      </div>
      <div style="background:#1e293b;padding:1rem;border-radius:8px;text-align:center;">
        <div style="font-size:2rem;font-weight:900;color:#dc2626;">${red}</div>
        <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;">Red</div>
      </div>
    `;

    const incidentsEl = document.getElementById('dash-incidents');
    const noIncidents = document.getElementById('dash-no-incidents');
    if (data.incidents.length === 0) {
      noIncidents.style.display = 'block';
      incidentsEl.innerHTML = '';
    } else {
      noIncidents.style.display = 'none';
      incidentsEl.innerHTML = data.incidents.map(c => cardRow(c)).join('');
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

async function loadCards() {
  try {
    const cards = await api('/api/cards');
    const el = document.getElementById('dash-cards-list');
    const noCards = document.getElementById('dash-no-cards');
    if (cards.length === 0) {
      noCards.style.display = 'block';
      el.innerHTML = '';
    } else {
      noCards.style.display = 'none';
      el.innerHTML = cards.map(c => cardRow(c)).join('');
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadReviewQueue() {
  try {
    const cards = await api('/api/dashboard/review-queue');
    const el = document.getElementById('dash-review-list');
    const noReviews = document.getElementById('dash-no-reviews');
    if (cards.length === 0) {
      noReviews.style.display = 'block';
      el.innerHTML = '';
    } else {
      noReviews.style.display = 'none';
      el.innerHTML = cards.map(c => reviewRow(c)).join('');
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadStats() {
  try {
    const stats = await api('/api/dashboard/season-stats');
    const summary = document.getElementById('dash-stats-summary');
    const yellows = stats.totalCards?.yellow || 0;
    const reds = stats.totalCards?.red || 0;

    summary.innerHTML = `
      <div style="background:#1e293b;padding:1rem;border-radius:8px;text-align:center;">
        <div style="font-size:2rem;font-weight:900;color:#eab308;">${yellows}</div>
        <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;">Yellows</div>
      </div>
      <div style="background:#1e293b;padding:1rem;border-radius:8px;text-align:center;">
        <div style="font-size:2rem;font-weight:900;color:#dc2626;">${reds}</div>
        <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;">Reds</div>
      </div>
      <div style="background:#1e293b;padding:1rem;border-radius:8px;text-align:center;">
        <div style="font-size:2rem;font-weight:900;color:#d8f3dc;">${yellows + reds}</div>
        <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;">Total</div>
      </div>
    `;

    const catEl = document.getElementById('dash-stats-categories');
    if (stats.byCategory && stats.byCategory.length > 0) {
      catEl.innerHTML = stats.byCategory.map(c =>
        `<div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid #1e293b;">
          <span style="color:#95d5b2;">${escapeHtml(c.category)}</span>
          <span style="color:#d8f3dc;font-weight:700;">${c.count}</span>
        </div>`
      ).join('');
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadScanFlags() {
  try {
    const flags = await api('/api/dashboard/scan-flags');
    const el = document.getElementById('dash-flags-list');
    const noFlags = document.getElementById('dash-no-flags');
    if (flags.length === 0) {
      noFlags.style.display = 'block';
      el.innerHTML = '';
    } else {
      noFlags.style.display = 'none';
      el.innerHTML = flags.map(f => flagRow(f)).join('');
    }
  } catch (err) {
    console.error(err);
  }
}

function flagRow(f) {
  const time = new Date(f.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = new Date(f.match_date).toLocaleDateString();
  const pubkeyShort = f.fan_signet_pubkey.slice(0, 8) + '...' + f.fan_signet_pubkey.slice(-8);
  const firstTime = f.first_scan_time ? new Date(f.first_scan_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '?';
  const secondTime = f.second_scan_time ? new Date(f.second_scan_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '?';

  return `<div style="background:#1e293b;padding:1.25rem;border-radius:8px;border-left:4px solid #f59e0b;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
      <span style="font-weight:700;color:#f59e0b;">DUPLICATE SCAN</span>
      <span style="font-size:0.8rem;color:#64748b;">${escapeHtml(date)} ${time}</span>
    </div>
    <div style="font-size:0.9rem;color:#95d5b2;font-family:monospace;">${escapeHtml(pubkeyShort)}</div>
    <div style="font-size:0.8rem;color:#64748b;margin-top:0.25rem;">First scan: ${firstTime}${f.first_gate_id ? ' @ ' + escapeHtml(f.first_gate_id) : ''} | Second scan: ${secondTime}${f.second_gate_id ? ' @ ' + escapeHtml(f.second_gate_id) : ''}</div>
    ${f.flagged_by_staff ? `<div style="font-size:0.8rem;color:#64748b;margin-top:0.25rem;">Flagged by ${escapeHtml(f.flagged_by_staff)}</div>` : ''}
    <div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
      <button class="btn" style="flex:1;background:#059669;color:white;min-height:44px;font-size:0.85rem;" data-flag-id="${escapeHtml(f.flag_id)}">Dismiss</button>
    </div>
  </div>`;
}

function cardRow(c) {
  const color = c.card_type === 'yellow' ? '#eab308' : '#dc2626';
  const time = new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `<div style="background:#1e293b;padding:1rem;border-radius:8px;border-left:4px solid ${color};">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:700;color:${color};text-transform:uppercase;">${escapeHtml(c.card_type)}</span>
      <span style="font-size:0.8rem;color:#64748b;">${time}</span>
    </div>
    <div style="font-size:0.9rem;color:#95d5b2;margin-top:0.25rem;">${escapeHtml(c.category)}</div>
    <div style="font-size:0.8rem;color:#64748b;margin-top:0.25rem;">by ${escapeHtml(c.issued_by_name || 'Unknown')} | ${escapeHtml(c.status)}</div>
    ${c.notes ? `<div style="font-size:0.8rem;color:#64748b;margin-top:0.25rem;font-style:italic;">${escapeHtml(c.notes)}</div>` : ''}
  </div>`;
}

function reviewRow(c) {
  const deadline = new Date(c.review_deadline);
  const now = new Date();
  const hoursLeft = Math.max(0, Math.round((deadline - now) / (1000 * 60 * 60)));
  const urgent = hoursLeft < 24;

  return `<div style="background:#1e293b;padding:1.25rem;border-radius:8px;border-left:4px solid #dc2626;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
      <span style="font-weight:700;color:#dc2626;">RED CARD — Review Required</span>
      <span style="font-size:0.8rem;color:${urgent ? '#dc2626' : '#64748b'};font-weight:${urgent ? '700' : '400'};">${hoursLeft}h remaining</span>
    </div>
    <div style="font-size:0.9rem;color:#95d5b2;">${escapeHtml(c.category)}</div>
    <div style="font-size:0.8rem;color:#64748b;margin-top:0.25rem;">Issued by ${escapeHtml(c.issued_by_name || 'Unknown')} on ${escapeHtml(c.match_date)}</div>
    ${c.notes ? `<div style="font-size:0.8rem;color:#64748b;margin-top:0.25rem;font-style:italic;">${escapeHtml(c.notes)}</div>` : ''}
    ${c.challenge_text ? `<div style="font-size:0.8rem;color:#d97706;margin-top:0.5rem;">Fan's challenge: ${escapeHtml(c.challenge_text)}</div>` : ''}
    <div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
      <button class="btn" style="flex:1;background:#dc2626;color:white;min-height:44px;font-size:0.85rem;" data-card-id="${escapeHtml(c.card_id)}" data-outcome="confirmed">Confirm</button>
      <button class="btn" style="flex:1;background:#d97706;color:white;min-height:44px;font-size:0.85rem;" data-card-id="${escapeHtml(c.card_id)}" data-outcome="downgraded">Downgrade</button>
      <button class="btn" style="flex:1;background:#059669;color:white;min-height:44px;font-size:0.85rem;" data-card-id="${escapeHtml(c.card_id)}" data-outcome="dismissed">Dismiss</button>
    </div>
  </div>`;
}

// Event delegation for dismiss/review buttons (avoid onclick interpolation)
document.addEventListener('click', (e) => {
  const flagBtn = e.target.closest('[data-flag-id]');
  if (flagBtn) { window.dismissFlag(flagBtn.dataset.flagId); return; }
  const cardBtn = e.target.closest('[data-card-id][data-outcome]');
  if (cardBtn) { window.reviewCard(cardBtn.dataset.cardId, cardBtn.dataset.outcome); return; }
});

window.switchTab = function(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.dash-tab').forEach(btn => {
    btn.style.background = '#1e293b'; btn.style.color = '#64748b';
    btn.classList.remove('active');
  });
  document.getElementById(`tab-${tab}`).style.display = 'block';
  const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
  if (activeBtn) { activeBtn.style.background = '#2d6a4f'; activeBtn.style.color = 'white'; activeBtn.classList.add('active'); }
};

window.dismissFlag = async function(flagId) {
  const notes = prompt('Dismiss notes (optional):') || '';
  try {
    await api(`/api/dashboard/scan-flags/${flagId}/dismiss`, {
      method: 'PATCH',
      body: { notes },
    });
    await loadScanFlags();
  } catch (err) {
    alert('Dismiss failed: ' + err.message);
  }
};

window.reviewCard = async function(cardId, outcome) {
  const notes = prompt('Review notes (optional):') || '';
  try {
    await api(`/api/dashboard/review/${cardId}`, {
      method: 'PATCH',
      body: { review_outcome: outcome, review_notes: notes },
    });
    await loadReviewQueue();
    await loadCards();
  } catch (err) {
    alert('Review failed: ' + err.message);
  }
};
