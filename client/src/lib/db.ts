/**
 * IndexedDB schema for the matchpass-app PWA.
 *
 * Stores:
 *  - session: the NIP-46 pairing {sessionSecret, remotePubkey, relayUrl}
 *  - stewardStats: today's scan counts per steward, cleared at midnight
 *  - pendingEvents: signed chain events queued while offline
 *  - pendingScans: venue entry scans queued while offline
 *  - unlinkedIncidents: steward's private incident notes (never sent)
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'matchpass-app';
const DB_VERSION = 1;

export interface SessionRecord {
  sessionSecretHex: string;
  remotePubkey: string;
  relayUrl: string;
  pairedAt: number;
}

export interface StewardStatsRecord {
  date: string; // YYYY-MM-DD
  steward: string; // pubkey hex
  green: number;
  amber: number;
  red: number;
  photoEscalations: number;
  flags: number;
}

export interface PendingEventRecord {
  id: string;
  event: unknown;
  queuedAt: number;
}

export interface PendingScanRecord {
  id: string;
  venueEntry: unknown;
  gateId: string | null;
  localDecision: string;
  queuedAt: number;
}

export interface UnlinkedIncidentRecord {
  id: string;
  description: string;
  category: string;
  time: number;
  photoDataUrl?: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('session')) {
          db.createObjectStore('session');
        }
        if (!db.objectStoreNames.contains('stewardStats')) {
          db.createObjectStore('stewardStats', { keyPath: ['date', 'steward'] });
        }
        if (!db.objectStoreNames.contains('pendingEvents')) {
          db.createObjectStore('pendingEvents', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pendingScans')) {
          db.createObjectStore('pendingScans', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('unlinkedIncidents')) {
          db.createObjectStore('unlinkedIncidents', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveSession(session: SessionRecord): Promise<void> {
  const d = await db();
  await d.put('session', session, 'current');
}

export async function loadSession(): Promise<SessionRecord | undefined> {
  const d = await db();
  return d.get('session', 'current');
}

export async function clearSession(): Promise<void> {
  const d = await db();
  await d.delete('session', 'current');
}

export async function todayKey(): Promise<string> {
  return new Date().toISOString().slice(0, 10);
}

export async function incrementStat(steward: string, field: 'green' | 'amber' | 'red' | 'photoEscalations' | 'flags'): Promise<void> {
  const d = await db();
  const date = await todayKey();
  const tx = d.transaction('stewardStats', 'readwrite');
  const existing = (await tx.store.get([date, steward])) as StewardStatsRecord | undefined;
  const next: StewardStatsRecord = existing ?? {
    date,
    steward,
    green: 0,
    amber: 0,
    red: 0,
    photoEscalations: 0,
    flags: 0,
  };
  next[field] = (next[field] ?? 0) + 1;
  await tx.store.put(next);
  await tx.done;
}

export async function getTodayStats(steward: string): Promise<StewardStatsRecord> {
  const d = await db();
  const date = await todayKey();
  const record = (await d.get('stewardStats', [date, steward])) as StewardStatsRecord | undefined;
  return record ?? { date, steward, green: 0, amber: 0, red: 0, photoEscalations: 0, flags: 0 };
}

export async function addUnlinkedIncident(rec: UnlinkedIncidentRecord): Promise<void> {
  const d = await db();
  await d.put('unlinkedIncidents', rec);
}

export async function listUnlinkedIncidents(): Promise<UnlinkedIncidentRecord[]> {
  const d = await db();
  const all = (await d.getAll('unlinkedIncidents')) as UnlinkedIncidentRecord[];
  return all.sort((a, b) => b.time - a.time);
}

export async function deleteUnlinkedIncident(id: string): Promise<void> {
  const d = await db();
  await d.delete('unlinkedIncidents', id);
}
