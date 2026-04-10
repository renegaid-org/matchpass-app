import { queueRequest, syncQueue, getQueueCount } from './offline-queue.js';

const API_BASE = '';
let sessionToken = null;

export function setSessionToken(token) {
  sessionToken = token;
}

export function clearSessionToken() {
  sessionToken = null;
}

export function getSessionToken() {
  return sessionToken;
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 401) {
        localStorage.removeItem('mp_token');
        localStorage.removeItem('mp_role');
        localStorage.removeItem('mp_expires_at');
        clearSessionToken();
      }
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    if (response.status === 204) return null;
    return response.json();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch') && options.method && options.method !== 'GET') {
      await queueRequest(path, options.method, options.body);
      console.log(`Offline: queued ${options.method} ${path}`);
      return { _offline: true, _queued: true };
    }
    throw err;
  }
}

export async function apiWithNip98(path, method, nostrAuthBase64) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Nostr ${nostrAuthBase64}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Login failed' }));
    throw new Error(error.error || 'Login failed');
  }

  return response.json();
}

export async function trySync() {
  const count = await getQueueCount();
  if (count === 0) return;
  console.log(`Online: syncing ${count} queued requests...`);
  return syncQueue(api);
}
