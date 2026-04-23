// server/scan-tracker.js — Ephemeral daily admission log (cleared at midnight)

const MAX_DUPLICATE_FLAGS = 1000;

export class ScanTracker {
  constructor() {
    this._admissions = new Map(); // fanPubkey -> { gate, time, staffId }
    this._duplicateFlags = [];
    this._stats = { green: 0, amber: 0, red: 0 };
    // Per-staff breakdown for the Stewards dashboard tab (§4.5.4).
    // Map<staffId, { green, amber, red }>. Cleared at midnight with the rest.
    this._byStaff = new Map();
  }

  // Check for duplicate admission and record this scan.
  // Returns null (no dup), { stewardError: true } (double-tap), or { duplicate: true }.
  checkAndRecord(fanPubkey, gate, staffId) {
    const prior = this._admissions.get(fanPubkey);
    if (prior) {
      const msSince = Date.now() - prior.time;
      if (msSince < 30_000 && prior.staffId === staffId) return { stewardError: true };
      if (this._duplicateFlags.length < MAX_DUPLICATE_FLAGS) {
        this._duplicateFlags.push({
          id: `${fanPubkey}:${Date.now()}`,
          fanPubkey,
          firstGate: prior.gate,
          firstStaffId: prior.staffId,
          firstTime: prior.time,
          secondGate: gate,
          secondStaffId: staffId,
          secondTime: Date.now(),
          dismissed: false,
          note: null,
        });
      }
      return { duplicate: true };
    }
    this._admissions.set(fanPubkey, { gate, time: Date.now(), staffId });
    return null;
  }

  // List open (not-dismissed) duplicate flags. Used by officer dashboard.
  listOpenFlags() {
    return this._duplicateFlags.filter(f => !f.dismissed);
  }

  dismissFlag(id, note) {
    const flag = this._duplicateFlags.find(f => f.id === id);
    if (!flag) return false;
    flag.dismissed = true;
    flag.note = note || null;
    flag.dismissedAt = Date.now();
    return true;
  }

  recordResult(decision, staffId = null) {
    if (this._stats[decision] === undefined) return;
    this._stats[decision]++;
    if (staffId && staffId !== 'anonymous') {
      const s = this._byStaff.get(staffId) || { green: 0, amber: 0, red: 0 };
      s[decision]++;
      this._byStaff.set(staffId, s);
    }
  }

  /** Per-staff breakdown, keyed by staff pubkey. */
  getStaffStats(staffId) {
    return this._byStaff.get(staffId) || { green: 0, amber: 0, red: 0 };
  }

  /** [{ staffId, green, amber, red, total }] across all staff who scanned today. */
  listStaffStats() {
    return [...this._byStaff.entries()].map(([staffId, s]) => ({
      staffId,
      ...s,
      total: s.green + s.amber + s.red,
    }));
  }

  getStats() {
    return {
      ...this._stats,
      total: this._stats.green + this._stats.amber + this._stats.red,
      duplicateFlags: [...this._duplicateFlags],
    };
  }

  clearDay() {
    this._admissions.clear();
    this._duplicateFlags = [];
    this._stats = { green: 0, amber: 0, red: 0 };
    this._byStaff.clear();
  }
}
