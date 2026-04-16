// server/roster-cache.js — In-memory cache for staff rosters (kind 39001)
// Map<clubPubkey, { rosterEvent, staff, createdAt }>

import { parseRosterEvent } from './roster.js';

export class RosterCache {
  constructor() { this._rosters = new Map(); }

  // Store a roster event. Returns false if stale (older created_at than current).
  set(clubPubkey, rosterEvent) {
    const existing = this._rosters.get(clubPubkey);
    if (existing && rosterEvent.created_at <= existing.createdAt) return false;
    const staff = parseRosterEvent(rosterEvent);
    this._rosters.set(clubPubkey, { rosterEvent, staff, createdAt: rosterEvent.created_at });
    return true;
  }

  get(clubPubkey) { return this._rosters.get(clubPubkey); }

  // Find a staff member by pubkey across ALL clubs.
  // Returns { pubkey, role, displayName, clubPubkey } or null.
  findStaff(staffPubkey) {
    for (const [clubPubkey, { staff }] of this._rosters) {
      const member = staff.find(s => s.pubkey === staffPubkey);
      if (member) return { ...member, clubPubkey };
    }
    return null;
  }

  get clubPubkeys() { return [...this._rosters.keys()]; }

  get size() { return this._rosters.size; }

  clear() { this._rosters.clear(); }
}
