import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScanTracker } from '../server/scan-tracker.js';

const fanPubkey = 'a'.repeat(64);
const gate = 'gate-1';
const staffId = 's'.repeat(64);

describe('ScanTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new ScanTracker();
    vi.useRealTimers();
  });

  it('first admission returns null', () => {
    expect(tracker.checkAndRecord(fanPubkey, gate, staffId)).toBeNull();
  });

  it('same staff within 30s returns { stewardError: true }', () => {
    tracker.checkAndRecord(fanPubkey, gate, staffId);
    const result = tracker.checkAndRecord(fanPubkey, gate, staffId);
    expect(result).toEqual({ stewardError: true });
  });

  it('different gate returns { duplicate: true }', () => {
    tracker.checkAndRecord(fanPubkey, gate, staffId);
    // Use a different staffId so it hits the duplicate path (not stewardError)
    const result = tracker.checkAndRecord(fanPubkey, 'gate-2', 'b'.repeat(64));
    expect(result).toEqual({ duplicate: true });
  });

  it('different staff same gate returns { duplicate: true }', () => {
    tracker.checkAndRecord(fanPubkey, gate, staffId);
    const result = tracker.checkAndRecord(fanPubkey, gate, 'b'.repeat(64));
    expect(result).toEqual({ duplicate: true });
  });

  it('recordResult tracks counts correctly (green, amber, red, total)', () => {
    tracker.recordResult('green');
    tracker.recordResult('green');
    tracker.recordResult('amber');
    tracker.recordResult('red');

    const stats = tracker.getStats();
    expect(stats.green).toBe(2);
    expect(stats.amber).toBe(1);
    expect(stats.red).toBe(1);
    expect(stats.total).toBe(4);
  });

  it('getStats includes duplicateFlags array', () => {
    tracker.checkAndRecord(fanPubkey, gate, staffId);
    // Different staff triggers duplicate flag
    tracker.checkAndRecord(fanPubkey, 'gate-2', 'b'.repeat(64));

    const stats = tracker.getStats();
    expect(Array.isArray(stats.duplicateFlags)).toBe(true);
    expect(stats.duplicateFlags).toHaveLength(1);
    expect(stats.duplicateFlags[0].fanPubkey).toBe(fanPubkey);
    expect(stats.duplicateFlags[0].firstGate).toBe(gate);
    expect(stats.duplicateFlags[0].secondGate).toBe('gate-2');
  });

  it('recordResult with staffId tracks per-staff breakdown', () => {
    const alice = 'a'.repeat(64);
    const bob = 'b'.repeat(64);
    tracker.recordResult('green', alice);
    tracker.recordResult('green', alice);
    tracker.recordResult('red', alice);
    tracker.recordResult('amber', bob);

    expect(tracker.getStaffStats(alice)).toEqual({ green: 2, amber: 0, red: 1 });
    expect(tracker.getStaffStats(bob)).toEqual({ green: 0, amber: 1, red: 0 });
    // Global stats still aggregate.
    expect(tracker.getStats().total).toBe(4);
  });

  it('listStaffStats returns an entry per staff who scanned', () => {
    tracker.recordResult('green', 'a'.repeat(64));
    tracker.recordResult('red', 'b'.repeat(64));
    const list = tracker.listStaffStats();
    expect(list).toHaveLength(2);
    expect(list.map(e => e.staffId).sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });

  it('recordResult without staffId still updates global but skips per-staff', () => {
    tracker.recordResult('green');
    tracker.recordResult('green', 'anonymous');
    expect(tracker.getStats().green).toBe(2);
    expect(tracker.listStaffStats()).toHaveLength(0);
  });

  it('clearDay resets everything (stats to 0, admissions cleared, second checkAndRecord returns null)', () => {
    tracker.checkAndRecord(fanPubkey, gate, staffId);
    tracker.checkAndRecord(fanPubkey, 'gate-2', 'b'.repeat(64)); // creates duplicate flag
    tracker.recordResult('green');
    tracker.recordResult('red');

    tracker.recordResult('green', 'c'.repeat(64));
    tracker.clearDay();

    const stats = tracker.getStats();
    expect(stats.green).toBe(0);
    expect(stats.amber).toBe(0);
    expect(stats.red).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.duplicateFlags).toHaveLength(0);
    expect(tracker.listStaffStats()).toHaveLength(0);

    // Fan can be admitted again after clearDay
    expect(tracker.checkAndRecord(fanPubkey, gate, staffId)).toBeNull();
  });
});
