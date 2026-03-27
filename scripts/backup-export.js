#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_BASE = process.env.AKB_API_BASE || 'https://akb-salon-server.onrender.com';
const OUTPUT_DIR = path.resolve(process.env.BACKUP_OUTPUT_DIR || 'backup-output');
const TIMEOUT_MS = Number(process.env.BACKUP_TIMEOUT_MS || 20000);
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USE_SUPABASE_DIRECT = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const PAGE_SIZE = Number(process.env.SUPABASE_PAGE_SIZE || 1000);

function nowIso() {
  return new Date().toISOString();
}

function safeStamp(iso) {
  return iso.replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function fetchJson(url, options = {}, timeoutMs = TIMEOUT_MS) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url} -> ${text.slice(0, 500)}`);
      }
      return text ? JSON.parse(text) : null;
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchApiDataset() {
  const [health, bookings, designers, services, customers, accounts] = await Promise.all([
    fetchJson(`${API_BASE}/api/health`),
    fetchJson(`${API_BASE}/api/bookings`),
    fetchJson(`${API_BASE}/api/designers`),
    fetchJson(`${API_BASE}/api/services`),
    fetchJson(`${API_BASE}/api/customers`),
    fetchJson(`${API_BASE}/api/accounts`),
  ]);

  return {
    mode: 'api',
    warnings: [
      'API 模式下 accounts 只會備份安全欄位，不包含 passwordHash。完整帳號還原請使用 Supabase service role 直連備份。',
      'customers 為衍生資料，可由 bookings 重建。',
    ],
    datasets: { health, bookings, designers, services, customers, accounts },
  };
}

async function fetchSupabaseTable(table) {
  const all = [];
  let from = 0;

  while (true) {
    const params = new URLSearchParams({ select: '*' });
    const url = `${SUPABASE_URL}/rest/v1/${table}?${params.toString()}`;
    const rows = await fetchJson(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Range: `${from}-${from + PAGE_SIZE - 1}`,
      },
    });

    const chunk = Array.isArray(rows) ? rows : [];
    all.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

function normalizeBookings(list) {
  return [...(list || [])].sort((a, b) => {
    const av = Number(a.updatedAt ?? a.updated_at ?? a.createdAt ?? a.created_at ?? 0);
    const bv = Number(b.updatedAt ?? b.updated_at ?? b.createdAt ?? b.created_at ?? 0);
    return bv - av;
  });
}

function normalizeIdAsc(list) {
  return [...(list || [])].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
}

async function fetchSupabaseDataset() {
  const [health, bookings, designers, services, accounts] = await Promise.all([
    fetchJson(`${API_BASE}/api/health`).catch(() => null),
    fetchSupabaseTable('bookings'),
    fetchSupabaseTable('designers'),
    fetchSupabaseTable('services'),
    fetchSupabaseTable('accounts'),
  ]);

  return {
    mode: 'supabase-rest',
    warnings: [],
    datasets: {
      health,
      bookings: normalizeBookings(bookings),
      designers: normalizeIdAsc(designers),
      services: normalizeIdAsc(services),
      accounts,
    },
  };
}

function writeJson(filePath, data) {
  const json = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(filePath, json, 'utf8');
  return json;
}

async function main() {
  const startedAt = nowIso();
  const runStamp = safeStamp(startedAt);
  const backupDir = path.join(OUTPUT_DIR, `akb-backup-${runStamp}`);
  ensureDir(backupDir);

  const source = USE_SUPABASE_DIRECT ? await fetchSupabaseDataset() : await fetchApiDataset();
  const { datasets } = source;

  const files = {};
  const manifest = {
    version: 1,
    createdAt: startedAt,
    backupMode: source.mode,
    source: {
      apiBase: API_BASE,
      supabaseUrl: SUPABASE_URL || null,
      gitSha: process.env.GIT_SHA || process.env.GITHUB_SHA || null,
      workflowRunId: process.env.GITHUB_RUN_ID || null,
      workflowRunNumber: process.env.GITHUB_RUN_NUMBER || null,
    },
    warnings: source.warnings,
    counts: {
      bookings: Array.isArray(datasets.bookings) ? datasets.bookings.length : null,
      designers: Array.isArray(datasets.designers) ? datasets.designers.length : null,
      services: Array.isArray(datasets.services) ? datasets.services.length : null,
      customers: Array.isArray(datasets.customers) ? datasets.customers.length : null,
      accounts: Array.isArray(datasets.accounts) ? datasets.accounts.length : Object.keys(datasets.accounts || {}).length,
    },
    health: datasets.health || null,
    files,
  };

  for (const [name, data] of Object.entries(datasets)) {
    if (data === undefined) continue;
    const fileName = `${name}.json`;
    const filePath = path.join(backupDir, fileName);
    const json = writeJson(filePath, data);
    files[fileName] = {
      bytes: Buffer.byteLength(json),
      sha256: sha256(json),
    };
  }

  const manifestPath = path.join(backupDir, 'manifest.json');
  const manifestJson = writeJson(manifestPath, manifest);
  files['manifest.json'] = {
    bytes: Buffer.byteLength(manifestJson),
    sha256: sha256(manifestJson),
  };

  const checksumLines = Object.entries(files)
    .map(([name, meta]) => `${meta.sha256}  ${name}`)
    .join('\n') + '\n';
  fs.writeFileSync(path.join(backupDir, 'sha256.txt'), checksumLines, 'utf8');

  const latestPointer = {
    latestBackupDir: path.basename(backupDir),
    createdAt: startedAt,
    manifest,
  };
  writeJson(path.join(OUTPUT_DIR, 'latest-backup.json'), latestPointer);

  console.log('Backup finished successfully');
  console.log(JSON.stringify({
    backupDir,
    backupMode: source.mode,
    counts: manifest.counts,
    warnings: manifest.warnings,
  }, null, 2));
}

main().catch((err) => {
  console.error('[backup-export] failed:', err.stack || err.message || String(err));
  process.exit(1);
});
