// server/scan-tracker.js — Ephemeral daily admission log (cleared at midnight)

export class ScanTracker {
  constructor() {
    this._admissions = new Map(); // fanPubkey -> { gate, time, staffId }
    this._duplicateFlags = [];
    this._stats = { green: 0, amber: 0, red: 0 };
  }

  // Check for duplicate admission and record this scan.
  // Returns null (no dup), { stewardError: true } (double-tap), or { duplicate: true }.
  checkAndRecord(fanPubkey, gate, staffId) {
    const prior = this._admissions.get(fanPubkey);
    if (prior) {
      const msSince = Date.now() - prior.time;
      if (msSince < 30_000 && prior.staffId === staffId) return { stewardError: true };
      this._duplicateFlags.push({ fanPubkey, firstGate: prior.gate, secondGate: gate, time: new Date() });
      return { duplicate: true };
    }
    this._admissions.set(fanPubkey, { gate, time: Date.now(), staffId });
    return null;
  }

  recordResult(decision) {
    if (this._stats[decision] !== undefined) this._stats[decision]++;
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
  }
}
