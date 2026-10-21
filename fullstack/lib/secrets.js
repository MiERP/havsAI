'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function loadKey(dataDir) {
  const env = String(process.env.SETTINGS_KEY || '').trim();
  if (env) {
    if (/^[0-9a-f]{64}$/i.test(env)) return Buffer.from(env, 'hex');
    try {
      const decoded = Buffer.from(env, 'base64');
      if (decoded.length === 32) return decoded;
    } catch {}
    return crypto.scryptSync(env, 'havsai-settings-key', 32);
  }

  const file = path.join(dataDir, 'settings.key');
  if (fs.existsSync(file)) {
    const key = fs.readFileSync(file);
    if (key.length === 32) return key;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

function createSecretStore(dataDir) {
  const key = loadKey(dataDir);

  return {
    encrypt(value) {
      if (value === undefined || value === null || value === '') return null;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
      return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
    },

    decrypt(payload) {
      if (!payload) return null;
      try {
        const [iv, tag, data] = String(payload).split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
      } catch {
        return null;
      }
    },

    hint(payload) {
      const value = this.decrypt(payload);
      if (!value) return '';
      return `••••${value.slice(-4)}`;
    }
  };
}

module.exports = { createSecretStore };
