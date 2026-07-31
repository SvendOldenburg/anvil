// PocketBase client for the Anvil MCP server.
//
// Auths as the shared `users` account (the same one the app logs in with),
// not the superuser -- least privilege, and nothing extra to keep in sync.
// Credentials live at ~/.claude/anvil-mcp.env, deliberately outside every git
// working tree.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENV_PATH = process.env.ANVIL_MCP_ENV
  || join(homedir(), '.claude', 'anvil-mcp.env');

// Loaded lazily, on the first tool call that needs PocketBase. Reading it at
// import time would kill the process before the MCP handshake, so a missing
// credentials file would surface in Claude Code as a bare "failed to connect"
// instead of a message saying which file to create.
let env = null;

/** Parse a KEY=VALUE file, tolerating the BOM PowerShell writes. */
function loadEnv() {
  if (env) return env;
  let raw;
  try {
    raw = readFileSync(ENV_PATH, 'utf8');
  } catch {
    throw new Error(
      `Missing ${ENV_PATH}. Create it with PB_URL, PB_IDENTITY and PB_PASSWORD `
      + `(the shared PocketBase \`users\` account). See mcp/README.md.`
    );
  }
  env = {};
  for (const line of raw.replace(/^﻿/, '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

function baseUrl() {
  return (loadEnv().PB_URL || 'https://pb.aetheriumforge.cloud').replace(/\/$/, '');
}

let token = null;

async function authenticate() {
  const { PB_IDENTITY, PB_PASSWORD } = loadEnv();
  const BASE = baseUrl();
  if (!PB_IDENTITY || !PB_PASSWORD) {
    throw new Error(`PB_IDENTITY / PB_PASSWORD missing from ${ENV_PATH}.`);
  }
  let res;
  try {
    res = await fetch(`${BASE}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: PB_IDENTITY, password: PB_PASSWORD }),
    });
  } catch {
    throw new Error(
      `PocketBase unreachable (${BASE}) -- the VPS may be mid-migration.`
    );
  }
  if (!res.ok) {
    throw new Error(
      `PocketBase auth failed (HTTP ${res.status}) -- check the credentials in ${ENV_PATH}. `
      + `If the users password was rotated, update the file.`
    );
  }
  token = (await res.json()).token;
}

async function request(path, { retry = true } = {}) {
  if (!token) await authenticate();
  const BASE = baseUrl();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error(
      `PocketBase unreachable (${BASE}) -- the VPS may be mid-migration.`
    );
  }
  // An expired token reads as 401/403; re-auth once, then give up.
  if ((res.status === 401 || res.status === 403) && retry) {
    token = null;
    return request(path, { retry: false });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PocketBase ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Every record in every Anvil collection, newest first.
 *
 * Sorting is hard-coded to session_date on purpose: a `created` sort returns
 * 400 on this PocketBase version, and no caller should be able to get that
 * wrong.
 */
export async function allRecords(collection, { since, until } = {}) {
  const filters = [];
  if (since) filters.push(`session_date >= "${since}"`);
  if (until) filters.push(`session_date <= "${until}"`);

  const items = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: '500',
      sort: '-session_date',
    });
    if (filters.length) params.set('filter', filters.join(' && '));
    const out = await request(
      `/api/collections/${collection}/records?${params}`
    );
    items.push(...out.items);
    if (page >= out.totalPages || out.items.length === 0) break;
  }
  return items;
}

/** YYYY-MM-DD for `days` ago (local time), or undefined when days is null. */
export function daysAgo(days) {
  if (days == null) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
