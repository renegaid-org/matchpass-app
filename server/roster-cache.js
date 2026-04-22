// server/roster-cache.js — In-memory cache for staff rosters (kind 39001)
// Map<clubPubkey, { rosterEvent, staff, createdAt }>

import { parseRosterEvent } from './roster.js';

export class RosterCache {
  constructor() { this._rosters = new Map(); }

  // Store a roster event. Returns false if stale (older created_at than current)
  // or future-dated (prevents permanent roster pinning if a club key is compromised).
  set(clubPubkey, rosterEvent) {
    const now = Math.floor(Date.now() / 1000);
    if (rosterEvent.created_at > now + 600) return false;
    const existing = this._rosters.get(clubPubkey);
    if (existing && rosterEvent.created_at <= existing.createdAt) return false;
    const staff = parseRosterEvent(rosterEvent);
    this._rosters.set(clubPubkey, { rosterEvent, staff, createdAt: rosterEvent.created_at });
    return true;
  }

  get(clubPubkey) { return this._rosters.get(clubPubkey); }

  // Find a staff member by pubkey across ALL clubs.
  // Returns { pubkey, role, displayName, expiresAt, clubPubkey } or null.
  // Entries whose expires_at is in the past are treated as absent so the
  // admin does not need to republish the roster to evict temp staff.
  findStaff(staffPubkey) {
    const now = Math.floor(Date.now() / 1000);
    for (const [clubPubkey, { staff }] of this._rosters) {
      const member = staff.find(s => s.pubkey === staffPubkey);
      if (!member) continue;
      if (member.expiresAt && member.expiresAt <= now) return null;
      return { ...member, clubPubkey };
    }
    return null;
  }

  get clubPubkeys() { return [...this._rosters.keys()]; }

  get size() { return this._rosters.size; }

  clear() { this._rosters.clear(); }
}
