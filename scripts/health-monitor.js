#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.AKB_API_BASE || 'https://akb-salon-server.onrender.com';
const BASELINE_FILE = path.resolve(process.env.BASELINE_FILE || '.ops/state/latest-backup-manifest.json');
const TIMEOUT_MS = Number(process.env.MONITOR_TIMEOUT_MS || 15000);
const DROP_THRESHOLD_PCT = Number(process.env.BOOKING_DROP_THRESHOLD_PCT || 50);
const MAX_BACKUP_AGE_HOURS = Number(process.env.MAX_BACKUP_AGE_HOURS || 30);
const ALLOW_ZERO_BOOKINGS = String(process.env.ALLOW_ZERO_BOOKINGS || 'false').toLowerCase() === 'true';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || '';
const AUTO_CLOSE_MONITOR_ISSUE = String(process.env.AUTO_CLOSE_MONITOR_ISSUE || 'true').toLowerCase() === 'true';
const ALERT_TITLE = '🚨 AKB 預約數據異常監控';

async function fetchJson(url, options = {}, timeoutMs = TIMEOUT_MS) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url} -> ${text.slice(0, 400)}`);
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

function readBaseline() {
  try {
    if (!fs.existsSync(BASELINE_FILE)) return null;
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  } catch (err) {
    return { _readError: err.message };
  }
}

function hoursSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.round((ms / 3600000) * 100) / 100;
}

function formatJson(data) {
  return '```json\n' + JSON.stringify(data, null, 2) + '\n```';
}

async function githubRequest(pathname, options = {}) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return null;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.headers || {}),
  };
  return fetchJson(`https://api.github.com${pathname}`, { ...options, headers }, TIMEOUT_MS);
}

async function findOpenAlertIssue() {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return null;
  const q = encodeURIComponent(`repo:${GITHUB_REPOSITORY} is:issue is:open in:title \"${ALERT_TITLE}\"`);
  const result = await githubRequest(`/search/issues?q=${q}`);
  return result && Array.isArray(result.items) && result.items.length ? result.items[0] : null;
}

async function ensureIssueOpen(body) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return;
  const openIssue = await findOpenAlertIssue();
  if (openIssue) {
    await githubRequest(`/repos/${GITHUB_REPOSITORY}/issues/${openIssue.number}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    return;
  }
  await githubRequest(`/repos/${GITHUB_REPOSITORY}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: ALERT_TITLE, body }),
  });
}

async function closeIssueIfOpen(body) {
  if (!AUTO_CLOSE_MONITOR_ISSUE || !GITHUB_TOKEN || !GITHUB_REPOSITORY) return;
  const openIssue = await findOpenAlertIssue();
  if (!openIssue) return;
  await githubRequest(`/repos/${GITHUB_REPOSITORY}/issues/${openIssue.number}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  await githubRequest(`/repos/${GITHUB_REPOSITORY}/issues/${openIssue.number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  });
}

async function main() {
  const baseline = readBaseline();
  const [health, bookings] = await Promise.all([
    fetchJson(`${API_BASE}/api/health`),
    fetchJson(`${API_BASE}/api/bookings`),
  ]);

  const anomalies = [];
  const warnings = [];
  const currentCount = Array.isArray(bookings) ? bookings.length : null;
  const baselineCount = baseline?.counts?.bookings ?? baseline?.manifest?.counts?.bookings ?? null;
  const baselineCreatedAt = baseline?.createdAt ?? baseline?.manifest?.createdAt ?? null;
  const baselineAgeHours = hoursSince(baselineCreatedAt);

  if (baseline?._readError) {
    anomalies.push(`無法讀取 baseline 檔：${baseline._readError}`);
  }
  if (!health || health.status !== 'ok') {
    anomalies.push(`health.status 異常：${health ? health.status : '無回應'}`);
  }
  if (!health || health.storage !== 'supabase') {
    anomalies.push(`storage 異常：${health ? health.storage : '未知'}`);
  }
  if (typeof health?.bookings === 'number' && typeof currentCount === 'number' && health.bookings !== currentCount) {
    warnings.push(`health.bookings (${health.bookings}) 與 /api/bookings (${currentCount}) 不一致`);
  }
  if (!ALLOW_ZERO_BOOKINGS && baselineCount > 0 && currentCount === 0) {
    anomalies.push(`目前 bookings=0，但最近 baseline bookings=${baselineCount}`);
  }
  if (baselineCount > 0 && currentCount !== null) {
    const dropPct = Math.round(((baselineCount - currentCount) / baselineCount) * 10000) / 100;
    if (currentCount < baselineCount && dropPct >= DROP_THRESHOLD_PCT) {
      anomalies.push(`bookings 較最近 baseline 下降 ${dropPct}%（${baselineCount} -> ${currentCount}）`);
    }
  }
  if (baselineAgeHours !== null && baselineAgeHours > MAX_BACKUP_AGE_HOURS) {
    anomalies.push(`最近備份 manifest 已超過 ${MAX_BACKUP_AGE_HOURS} 小時：目前 ${baselineAgeHours} 小時`);
  }
  if (!baselineCreatedAt) {
    warnings.push('尚未找到最近備份 manifest，無法做筆數對比');
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    apiBase: API_BASE,
    health,
    currentBookings: currentCount,
    baselineBookings: baselineCount,
    baselineCreatedAt,
    baselineAgeHours,
    anomalies,
    warnings,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (anomalies.length) {
    const body = [
      '# AKB 預約數據監控警報',
      '',
      anomalies.map((item) => `- ${item}`).join('\n'),
      warnings.length ? ['', '## Warnings', warnings.map((item) => `- ${item}`).join('\n')].join('\n') : '',
      '',
      '## Snapshot',
      formatJson(summary),
    ].filter(Boolean).join('\n');
    await ensureIssueOpen(body);
    process.exit(1);
  }

  const recoverBody = [
    '# AKB 預約數據監控已恢復正常',
    '',
    warnings.length ? warnings.map((item) => `- ${item}`).join('\n') : '- 無額外警告',
    '',
    '## Snapshot',
    formatJson(summary),
  ].join('\n');
  await closeIssueIfOpen(recoverBody);
}

main().catch(async (err) => {
  const message = err.stack || err.message || String(err);
  console.error('[health-monitor] failed:', message);
  try {
    await ensureIssueOpen(`# AKB 預約數據監控執行失敗\n\n- ${message}`);
  } catch (_) {}
  process.exit(1);
});
