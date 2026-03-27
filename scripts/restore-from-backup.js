#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEFAULT_TABLES = ['bookings', 'designers', 'services', 'accounts'];
const UPSERT_BATCH_SIZE = Number(process.env.RESTORE_BATCH_SIZE || 200);
const TIMEOUT_MS = Number(process.env.RESTORE_TIMEOUT_MS || 30000);

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue;
    const [k, v] = raw.slice(2).split('=');
    args[k] = v === undefined ? true : v;
  }
  return args;
}

const args = parseArgs(process.argv);
const BACKUP_DIR = path.resolve(args.dir || process.env.BACKUP_DIR || '');
const DRY_RUN = args['dry-run'] === true || String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
const CLEAR_TARGET = args['clear-target'] === true || String(process.env.CLEAR_TARGET || 'false').toLowerCase() === 'true';
const TABLES = (args.tables || process.env.RESTORE_TABLES || DEFAULT_TABLES.join(','))
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
const RESTORE_CONFIRM = process.env.RESTORE_CONFIRM || '';

if (!BACKUP_DIR) {
  console.error('請提供 --dir=/path/to/backup');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，無法執行還原');
  process.exit(1);
}
if (CLEAR_TARGET && RESTORE_CONFIRM !== 'YES_I_UNDERSTAND') {
  console.error('CLEAR_TARGET 需要額外設定 RESTORE_CONFIRM=YES_I_UNDERSTAND');
  process.exit(1);
}

function loadJson(name) {
  const filePath = path.join(BACKUP_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function fetchJson(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url} -> ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function clearTable(table) {
  const key = table === 'accounts' ? 'username' : 'id';
  const url = `${SUPABASE_URL}/rest/v1/${table}?${key}=not.is.null`;
  await fetchJson(url, { method: 'DELETE', headers: headers({ Prefer: 'return=minimal' }) });
}

async function upsertTable(table, rows) {
  if (!rows || !rows.length) return;
  const conflict = table === 'accounts' ? 'username' : 'id';
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`;
  for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
    await fetchJson(url, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(batch),
    });
  }
}

async function main() {
  const manifest = loadJson('manifest');
  const restorePlan = {};

  for (const table of TABLES) {
    const rows = loadJson(table);
    if (rows === null) continue;
    restorePlan[table] = Array.isArray(rows) ? rows.length : Object.keys(rows).length;
  }

  console.log(JSON.stringify({
    backupDir: BACKUP_DIR,
    dryRun: DRY_RUN,
    clearTarget: CLEAR_TARGET,
    restorePlan,
    manifestCreatedAt: manifest?.createdAt || null,
    backupMode: manifest?.backupMode || null,
  }, null, 2));

  if (DRY_RUN) return;

  for (const table of TABLES) {
    const rows = loadJson(table);
    if (rows === null) continue;
    if (!Array.isArray(rows)) {
      throw new Error(`${table}.json 不是陣列，無法直接還原`);
    }
    if (CLEAR_TARGET) {
      console.log(`[restore] clearing table: ${table}`);
      await clearTable(table);
    }
    console.log(`[restore] upserting ${rows.length} rows into ${table}`);
    await upsertTable(table, rows);
  }

  console.log('[restore] finished successfully');
}

main().catch((err) => {
  console.error('[restore] failed:', err.stack || err.message || String(err));
  process.exit(1);
});
