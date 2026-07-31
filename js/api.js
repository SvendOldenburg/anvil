import { PB_URL as PB } from './config.js';

// --- Auth (the shared PocketBase `users` account, same as Vessel and Lumen) ---

let _token = null;

export async function login(email, password) {
  const res = await fetch(`${PB}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) throw new Error('Login failed');
  const data = await res.json();
  _token = data.token;
  localStorage.setItem('anvil_token', _token);
  return data;
}

export function logout() {
  _token = null;
  localStorage.removeItem('anvil_token');
}

// Validate the stored token against the server and renew it. Returns true
// if we have a usable session. A stored token that only *exists* isn't
// enough -- if it has expired, every read comes back empty and every save
// 400s, with no login prompt. (That's the 2026-07-07 Vessel bug: the phone
// PWA silently stopped working, and reinstalling didn't help because
// localStorage survives a home-screen delete.) So we refresh on boot: a
// good token gets a fresh TTL, a dead one gets cleared so login shows.
export async function restoreSession() {
  _token = localStorage.getItem('anvil_token');
  if (!_token) return false;
  try {
    const res = await fetch(`${PB}/api/collections/users/auth-refresh`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      _token = data.token;
      localStorage.setItem('anvil_token', _token);
      return true;
    }
    // 400/401/403 = the server rejected the token. It's dead -- force re-login.
    if (res.status >= 400 && res.status < 500) {
      logout();
      return false;
    }
    // Server-side (5xx) hiccup -- keep the token and let the app try.
    return true;
  } catch {
    // Network failure (offline) -- keep the token so offline use still works.
    return true;
  }
}

function authHeaders() {
  return _token ? { 'Authorization': `Bearer ${_token}` } : {};
}

// --- Records ---

async function pbReq(method, path, body) {
  const opts = { method, headers: { ...authHeaders() } };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${PB}${path}`, opts);
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `PB ${res.status}`);
  return data;
}

// PocketBase stores date as session_date; expose it as date to the rest of the app
function fromPB(item) {
  if (!item) return null;
  const { session_date, ...rest } = item;
  return { ...rest, date: session_date };
}

function toPB(data) {
  const { date, id, created, updated, collectionId, collectionName, ...rest } = data;
  if (date !== undefined) return { ...rest, session_date: date };
  return rest;
}

function collection(name) {
  const base = `/api/collections/${name}/records`;

  return {
    async list(limit = 500) {
      const r = await pbReq('GET', `${base}?sort=-session_date&perPage=${limit}`);
      return r.items.map(fromPB);
    },

    // sorted oldest-first, optional date cutoff (YYYY-MM-DD)
    async listAsc(cutoff) {
      let url = `${base}?sort=session_date&perPage=500`;
      if (cutoff) url += `&filter=${encodeURIComponent(`session_date>="${cutoff}"`)}`;
      const r = await pbReq('GET', url);
      return r.items.map(fromPB);
    },

    async last() {
      const r = await pbReq('GET', `${base}?sort=-session_date&perPage=1`);
      return r.items.length ? fromPB(r.items[0]) : null;
    },

    async lastOfType(type) {
      const filter = encodeURIComponent(`type="${type}"`);
      const r = await pbReq('GET', `${base}?sort=-session_date&perPage=1&filter=${filter}`);
      return r.items.length ? fromPB(r.items[0]) : null;
    },

    async byDate(date) {
      const filter = encodeURIComponent(`session_date="${date}"`);
      const r = await pbReq('GET', `${base}?filter=${filter}&perPage=1`);
      return r.items.length ? fromPB(r.items[0]) : null;
    },

    async add(data) {
      return pbReq('POST', base, toPB(data));
    },

    async update(id, data) {
      return pbReq('PATCH', `${base}/${id}`, toPB(data));
    },

    async delete(id) {
      return pbReq('DELETE', `${base}/${id}`);
    },
  };
}

export const api = {
  strength_sessions:   collection('strength_sessions'),
  rower_sessions:      collection('rower_sessions'),
  kettlebell_sessions: collection('kettlebell_sessions'),
  barbell_sessions:    collection('barbell_sessions'),
  dumbbell_sessions:   collection('dumbbell_sessions'),
  bodyweight:          collection('bodyweight'),
  body_measurements:   collection('body_measurements'),
};

// Keep settings local -- they're device preferences, not training data
export async function getSetting(key, defaultVal) {
  const raw = localStorage.getItem(`setting_${key}`);
  return raw !== null ? JSON.parse(raw) : defaultVal;
}

export async function setSetting(key, value) {
  localStorage.setItem(`setting_${key}`, JSON.stringify(value));
}
