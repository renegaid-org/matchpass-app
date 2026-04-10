import { api } from './api.js';
import { escapeHtml } from './utils.js';

export async function initAdmin() {
  await loadClub();
  await loadSeason();
  await loadStaff();
}

async function loadClub() {
  try {
    const club = await api('/api/clubs/mine');
    document.getElementById('admin-name').value = club.name || '';
    document.getElementById('admin-ground').value = club.ground_name || '';
    document.getElementById('admin-league').value = club.league || '';
    document.getElementById('admin-fa').value = club.fa_affiliation || '';
  } catch (err) {
    console.error(err);
  }
}

async function loadSeason() {
  try {
    const season = await api('/api/seasons/active');
    document.getElementById('admin-active-season').innerHTML =
      `<div style="padding:0.75rem;background:#0f172a;border-radius:8px;border-left:4px solid #059669;">
        <span style="font-weight:700;color:#d8f3dc;">${escapeHtml(season.name)}</span>
        <span style="font-size:0.8rem;color:#64748b;margin-left:0.5rem;">${escapeHtml(season.start_date)} to ${escapeHtml(season.end_date)}</span>
      </div>`;
  } catch (err) {
    document.getElementById('admin-active-season').innerHTML =
      '<p style="color:#64748b;font-style:italic;">No active season. Create one below.</p>';
  }
}

async function loadStaff() {
  try {
    const staff = await api('/api/staff');
    const el = document.getElementById('admin-staff-list');
    if (staff.length === 0) {
      el.innerHTML = '<p style="color:#64748b;font-style:italic;">No staff members.</p>';
    } else {
      el.innerHTML = staff.map(s => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:#0f172a;border-radius:8px;margin-bottom:0.5rem;">
          <div>
            <span style="font-weight:700;color:#d8f3dc;">${escapeHtml(s.display_name || 'Unnamed')}</span>
            <span style="font-size:0.8rem;color:#64748b;margin-left:0.5rem;">${escapeHtml(s.role.replaceAll('_', ' '))}</span>
          </div>
          ${s.is_active
            ? `<button style="background:#dc2626;color:white;border:none;padding:0.4rem 0.8rem;border-radius:6px;cursor:pointer;font-size:0.8rem;" data-remove-staff="${escapeHtml(s.staff_id)}">Remove</button>`
            : '<span style="color:#64748b;font-size:0.8rem;">Inactive</span>'
          }
        </div>
      `).join('');
    }
  } catch (err) {
    console.error(err);
  }
}

window.saveClub = async function() {
  try {
    await api('/api/clubs/mine', {
      method: 'PUT',
      body: {
        name: document.getElementById('admin-name').value,
        ground_name: document.getElementById('admin-ground').value,
        league: document.getElementById('admin-league').value,
        fa_affiliation: document.getElementById('admin-fa').value || null,
      },
    });
    alert('Club profile saved.');
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
};

window.createSeason = async function() {
  const name = document.getElementById('admin-season-name').value;
  const start = document.getElementById('admin-season-start').value;
  const end = document.getElementById('admin-season-end').value;
  if (!name || !start || !end) { alert('All season fields required'); return; }
  try {
    await api('/api/seasons', {
      method: 'POST',
      body: { name, start_date: start, end_date: end },
    });
    await loadSeason();
    document.getElementById('admin-season-name').value = '';
  } catch (err) {
    alert('Failed: ' + err.message);
  }
};

window.addStaff = async function() {
  const pubkey = document.getElementById('admin-staff-pubkey').value;
  const name = document.getElementById('admin-staff-name').value;
  const role = document.getElementById('admin-staff-role').value;
  if (!pubkey) { alert('Pubkey required'); return; }
  try {
    await api('/api/staff', {
      method: 'POST',
      body: { signet_pubkey: pubkey, display_name: name, role },
    });
    await loadStaff();
    document.getElementById('admin-staff-pubkey').value = '';
    document.getElementById('admin-staff-name').value = '';
  } catch (err) {
    alert('Failed: ' + err.message);
  }
};

// Event delegation for remove staff buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-staff]');
  if (btn) window.removeStaff(btn.dataset.removeStaff);
});

window.removeStaff = async function(id) {
  if (!confirm('Remove this staff member?')) return;
  try {
    await api(`/api/staff/${id}`, { method: 'DELETE' });
    await loadStaff();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
};
