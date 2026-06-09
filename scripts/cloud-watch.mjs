#!/usr/bin/env node

const DEFAULTS = {
  apiUrl: 'https://sigma-api-production-b005.up.railway.app',
  dashboardUrl: 'https://sigma-dashboard-production-a7a7.up.railway.app',
  hermesUrl: 'https://hermes-agent-production-62ee.up.railway.app',
};

const config = {
  apiUrl: stripTrailingSlash(process.env.CLOUD_WATCH_API_URL ?? DEFAULTS.apiUrl),
  dashboardUrl: stripTrailingSlash(process.env.CLOUD_WATCH_DASHBOARD_URL ?? DEFAULTS.dashboardUrl),
  hermesUrl: stripTrailingSlash(process.env.CLOUD_WATCH_HERMES_URL ?? DEFAULTS.hermesUrl),
  includeWriteSmoke: parseBoolean(process.env.CLOUD_WATCH_WRITE_SMOKE),
  timeoutMs: parsePositiveInteger(process.env.CLOUD_WATCH_TIMEOUT_MS, 15000),
  reportPath: process.env.CLOUD_WATCH_REPORT_PATH,
};

const startedAt = new Date().toISOString();
const checks = [];

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function assertCondition(condition, message, detail = {}) {
  if (!condition) {
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
}

function redact(value) {
  if (!value || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value, (key, innerValue) => {
    if (key === 'apiKeySet') return innerValue;
    if (/key|token|secret|password|authorization/i.test(key)) return '[redacted]';
    return innerValue;
  }));
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { response, body, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function runCheck(name, fn) {
  const checkStarted = Date.now();
  try {
    const detail = await fn();
    const record = {
      name,
      ok: true,
      durationMs: Date.now() - checkStarted,
      detail: redact(detail),
    };
    checks.push(record);
    console.log(`ok ${name}`);
    return record;
  } catch (err) {
    const record = {
      name,
      ok: false,
      durationMs: Date.now() - checkStarted,
      error: err instanceof Error ? err.message : String(err),
      detail: redact(err?.detail),
    };
    checks.push(record);
    console.error(`fail ${name}: ${record.error}`);
    return record;
  }
}

async function checkApiHealth() {
  const { response, body } = await request(`${config.apiUrl}/health`);
  assertCondition(response.ok, `sigma-api health returned HTTP ${response.status}`, body);
  assertCondition(body?.status === 'ok', 'sigma-api health payload was not ok', body);
  return { http: response.status, status: body.status, service: body.service };
}

async function checkDashboardTrading() {
  const { response, text } = await request(`${config.dashboardUrl}/trading`);
  assertCondition(response.ok, `sigma-dashboard /trading returned HTTP ${response.status}`, { body: text.slice(0, 200) });
  assertCondition(text.length > 1000, 'sigma-dashboard /trading returned an unexpectedly small page', { length: text.length });
  return { http: response.status, bytes: text.length };
}

async function checkHermesHealth() {
  const { response, body } = await request(`${config.hermesUrl}/health`);
  assertCondition(response.ok, `hermes-agent health returned HTTP ${response.status}`, body);
  return { http: response.status, status: body?.status ?? 'unknown', service: body?.service };
}

async function checkTradingSafety() {
  const { response, body } = await request(`${config.apiUrl}/v1/trading/config`);
  assertCondition(response.ok, `trading config returned HTTP ${response.status}`, body);
  assertCondition(body?.tradingMode === 'dry-run', 'trading mode is not dry-run', body);
  assertCondition(body?.brokerExecution === false, 'broker execution is not disabled', body);
  return {
    http: response.status,
    tradingMode: body.tradingMode,
    executionMode: body.executionMode,
    brokerExecution: body.brokerExecution,
  };
}

async function checkMarketDataConfig() {
  const { response, body } = await request(`${config.apiUrl}/v1/market-data/config`);
  assertCondition(response.ok, `market data config returned HTTP ${response.status}`, body);
  assertCondition(body?.provider === 'massive', 'market data provider is not Massive', body);

  const serialized = JSON.stringify(body);
  assertCondition(!/"apiKey"\s*:/.test(serialized), 'market data config exposed an API key field', body);

  return {
    http: response.status,
    provider: body.provider,
    baseUrl: body.baseUrl,
    apiKeySet: body.apiKeySet,
  };
}

async function checkLLMConfig() {
  const { response, body } = await request(`${config.apiUrl}/v1/llm/config`);
  assertCondition(response.ok, `LLM config returned HTTP ${response.status}`, body);

  const chain = body?.config?.chain;
  assertCondition(Array.isArray(chain), 'LLM config did not return a chain', body);
  assertCondition(body?.config?.primaryModel === 'deepseek-v4-flash', 'LLM primary model is not DeepSeek flash', body);
  assertCondition(chain[0]?.baseUrl === 'https://api.deepseek.com', 'LLM primary is not routed to DeepSeek direct', body);
  assertCondition(chain[1]?.baseUrl === 'https://api.deepseek.com', 'LLM secondary is not routed to DeepSeek direct', body);
  assertCondition(chain[2]?.baseUrl === 'https://openrouter.ai/api/v1', 'LLM fallback is not routed to OpenRouter', body);
  assertCondition(chain.every(provider => provider.apiKeySet === true), 'LLM chain has an unset API key', body);

  const serialized = JSON.stringify(body);
  assertCondition(!/"apiKey"\s*:/.test(serialized), 'LLM config exposed an API key field', body);

  return {
    http: response.status,
    primaryModel: body.config.primaryModel,
    chain: chain.map(provider => ({
      id: provider.id,
      baseUrl: provider.baseUrl,
      apiKeySet: provider.apiKeySet,
    })),
  };
}

async function checkNovaQueryContract() {
  const { response, body } = await request(`${config.apiUrl}/v1/nova/query`, {
    method: 'POST',
    body: JSON.stringify({
      transcript: 'Where is my stop loss on this ticket?',
      activeApp: 'TradingView',
      activeWindowTitle: 'MNQ order ticket',
    }),
  });
  const status = body?.statusModel;
  assertCondition(response.ok, `Nova query returned HTTP ${response.status}`, body);
  assertCondition(status?.mode === 'risk_coach', 'Nova query mode was not risk_coach', body);
  assertCondition(status?.intentType === 'risk_review', 'Nova query intent was not risk_review', body);
  assertCondition(status?.riskState === 'read_only', 'Nova query risk state was not read_only', body);
  assertCondition(status?.highlightSafety?.blocksInteraction === false, 'Nova highlights may block interaction', body);
  return {
    http: response.status,
    mode: status.mode,
    intentType: status.intentType,
    riskState: status.riskState,
    blocksInteraction: status.highlightSafety.blocksInteraction,
  };
}

async function checkNovaJournalContract() {
  const { response, body } = await request(`${config.apiUrl}/v1/nova/journal`, {
    method: 'POST',
    body: JSON.stringify({
      sessionId: `cloud-watch-${Date.now()}`,
      transcript: 'Capture this cloud watch journal note.',
      screenshotPointer: 'memory://nova-screenshot/cloud-watch',
      activeApp: 'TradingView',
      activeWindowTitle: 'MNQ chart',
      tags: ['cloud-watch', 'nova'],
      notes: 'Automated cloud watch write smoke.',
    }),
  });
  const status = body?.statusModel;
  assertCondition(response.status === 201, `Nova journal returned HTTP ${response.status}`, body);
  assertCondition(Boolean(body?.entry?.id), 'Nova journal did not return an entry id', body);
  assertCondition(status?.mode === 'journal', 'Nova journal mode was not journal', body);
  assertCondition(status?.riskState === 'read_only', 'Nova journal risk state was not read_only', body);
  return {
    http: response.status,
    entryId: body.entry.id,
    mode: status.mode,
    riskState: status.riskState,
  };
}

async function checkVoiceDraftContractAndCleanup() {
  const { response, body } = await request(`${config.apiUrl}/v1/voice/draft-simulated-trade`, {
    method: 'POST',
    body: JSON.stringify({
      transcript: 'Draft a simulated MNQ long at 19000 with a 10 point stop, risk 100 dollars, 2R.',
    }),
  });
  const status = body?.statusModel;
  assertCondition(response.status === 202, `voice draft returned HTTP ${response.status}`, body);
  assertCondition(Boolean(body?.approvalId), 'voice draft did not return an approval id', body);
  assertCondition(status?.mode === 'draft', 'voice draft mode was not draft', body);
  assertCondition(status?.riskState === 'approval_only', 'voice draft risk state was not approval_only', body);
  assertCondition(status?.executionState === 'approval_required', 'voice draft execution state was not approval_required', body);
  assertCondition(body?.brokerExecution === false, 'voice draft broker execution was not disabled', body);

  const cleanup = await request(`${config.apiUrl}/v1/approvals/${body.approvalId}`, {
    method: 'POST',
    body: JSON.stringify({
      approved: false,
      resolvedBy: 'cloud-watch',
      reason: 'Automated cloud watch cleanup',
    }),
  });
  assertCondition(cleanup.response.ok, `approval cleanup returned HTTP ${cleanup.response.status}`, cleanup.body);

  const verify = await request(`${config.apiUrl}/v1/approvals/${body.approvalId}`);
  assertCondition(verify.response.ok, `approval cleanup verification returned HTTP ${verify.response.status}`, verify.body);
  assertCondition(verify.body?.status === 'denied', 'voice draft approval cleanup did not deny the approval', verify.body);

  return {
    http: response.status,
    approvalId: body.approvalId,
    mode: status.mode,
    riskState: status.riskState,
    executionState: status.executionState,
    cleanupStatus: verify.body.status,
  };
}

await runCheck('sigma-api health', checkApiHealth);
await runCheck('sigma-dashboard trading page', checkDashboardTrading);
await runCheck('hermes-agent health', checkHermesHealth);
await runCheck('trading safety config', checkTradingSafety);
await runCheck('market data config', checkMarketDataConfig);
await runCheck('LLM config', checkLLMConfig);
await runCheck('Nova query contract', checkNovaQueryContract);

if (config.includeWriteSmoke) {
  await runCheck('Nova journal contract write smoke', checkNovaJournalContract);
  await runCheck('Nova voice draft contract cleanup smoke', checkVoiceDraftContractAndCleanup);
}

const report = {
  ok: checks.every(check => check.ok),
  startedAt,
  endedAt: new Date().toISOString(),
  includeWriteSmoke: config.includeWriteSmoke,
  targets: {
    apiUrl: config.apiUrl,
    dashboardUrl: config.dashboardUrl,
    hermesUrl: config.hermesUrl,
  },
  checks,
};

console.log(JSON.stringify(report, null, 2));

if (config.reportPath) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(config.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (!report.ok) process.exit(1);
