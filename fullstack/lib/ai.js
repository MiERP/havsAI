'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HOME = process.env.USERPROFILE || process.env.HOME || '';

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function envDefaults() {
  const auth = readJsonFile(path.join(HOME, '.commandcode', 'auth.json'));
  const config = readJsonFile(path.join(HOME, '.commandcode', 'config.json'));

  const commandcode = {
    provider: 'commandcode',
    apiKey: process.env.COMMANDCODE_API_KEY || auth?.apiKey || '',
    baseUrl: process.env.COMMANDCODE_BASE_URL || 'https://api.commandcode.ai/provider/v1',
    model: process.env.COMMANDCODE_MODEL || config?.model || 'deepseek/deepseek-v4.1-flash'
  };
  const deepseek = {
    provider: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  };
  const vision = {
    provider: 'commandcode',
    apiKey: process.env.VISION_API_KEY || commandcode.apiKey,
    baseUrl: process.env.VISION_BASE_URL || commandcode.baseUrl,
    model: process.env.VISION_MODEL || 'deepseek/deepseek-v4-flash-vision-exp',
    fallbackModel: process.env.VISION_FALLBACK_MODEL || 'deepseek/deepseek-v4-flash-vision-exp',
    reasoningEffort: process.env.VISION_REASONING_EFFORT || 'off'
  };
  const selected = process.env.AI_PROVIDER ||
    (commandcode.apiKey ? 'commandcode' : deepseek.apiKey ? 'deepseek' : 'mock');

  return { commandcode, deepseek, vision, selected };
}

function createAi({ db, secrets }) {
  const defaults = envDefaults();

  function providerRow(kind) {
    try {
      return db.prepare(
        'SELECT * FROM ai_providers WHERE kind = ? AND enabled = 1 ORDER BY is_default DESC, updated_at DESC LIMIT 1'
      ).get(kind);
    } catch {
      return null;
    }
  }

  function providerRows(kind) {
    try {
      return db.prepare(
        'SELECT * FROM ai_providers WHERE kind = ? AND enabled = 1 ORDER BY is_default DESC, updated_at DESC'
      ).all(kind);
    } catch {
      return [];
    }
  }

  function envKey(row) {
    if (row.kind === 'vision') {
      return row.provider === 'commandcode' ? (defaults.vision.apiKey || '') : '';
    }
    if (row.provider === 'commandcode') return defaults.commandcode.apiKey || '';
    if (row.provider === 'deepseek') return defaults.deepseek.apiKey || '';
    return '';
  }

  function fromRow(row) {
    if (!row || row.provider === 'mock') return null;
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      apiKey: secrets.decrypt(row.api_key_enc) || envKey(row),
      baseUrl: row.base_url || '',
      model: row.model || '',
      fallbackModel: row.fallback_model || row.model || '',
      reasoningEffort: row.reasoning_effort || ''
    };
  }

  function resolve(kind) {
    const row = providerRow(kind);
    if (row) return fromRow(row);

    if (kind === 'vision') {
      return defaults.vision.apiKey ? { ...defaults.vision } : null;
    }

    if (defaults.selected === 'commandcode' && defaults.commandcode.apiKey) {
      return { ...defaults.commandcode };
    }
    if (defaults.selected === 'deepseek' && defaults.deepseek.apiKey) {
      return { ...defaults.deepseek };
    }
    return null;
  }

  function resolveAll(kind) {
    const rows = providerRows(kind);
    if (rows.length && rows[0].provider === 'mock') return [];
    if (!rows.length && defaults.selected === 'mock') return [];
    const list = [];
    const seen = new Set();
    const push = (cfg) => {
      if (!cfg || cfg.provider === 'mock' || !cfg.apiKey || !cfg.baseUrl) return;
      const key = `${cfg.baseUrl}|${cfg.model}|${cfg.apiKey}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push(cfg);
    };
    for (const row of rows) {
      push(fromRow(row));
    }
    if (!list.length) {
      push(resolve(kind));
    }
    return list;
  }

  function describe() {
    const chat = resolve('chat');
    const vision = resolve('vision');
    return {
      provider: chat?.provider || 'mock',
      model: chat?.model || 'mock',
      visionModel: vision?.model || 'mock'
    };
  }

  async function testProvider(config) {
    if (!config || config.provider === 'mock') {
      return { ok: true, mock: true, latencyMs: 0 };
    }
    if (!config.baseUrl || !config.apiKey) {
      return { ok: false, error: 'incomplete_config', latencyMs: 0 };
    }

    const base = String(config.baseUrl).replace(/\/$/, '');
    const started = Date.now();
    try {
      if (config.provider !== 'commandcode') {
        const response = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${config.apiKey}` },
          signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
          return { ok: true, status: response.status, latencyMs: Date.now() - started };
        }
      }

      const fallback = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model || 'deepseek/deepseek-v4.1-flash',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false
        }),
        signal: AbortSignal.timeout(10000)
      });
      let detail = '';
      if (!fallback.ok) {
        try {
          const errJson = await fallback.json();
          detail = errJson?.error?.message || '';
        } catch {}
      }
      return {
        ok: fallback.ok,
        status: fallback.status,
        latencyMs: Date.now() - started,
        error: fallback.ok ? undefined : `HTTP ${fallback.status}${detail ? `: ${detail}` : ''}`
      };
    } catch (error) {
      return { ok: false, error: error.message, latencyMs: Date.now() - started };
    }
  }

  return { resolve, resolveAll, describe, testProvider, defaults };
}

module.exports = { createAi };
