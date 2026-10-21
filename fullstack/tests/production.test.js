'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('production without a mailer refuses OTP and never logs the code', { timeout: 20000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'havs-prod-test-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HAVS_DATA_DIR: dataDir,
      PORT: '0',
      AI_PROVIDER: 'mock',
      ALLOW_DEV_OTP: '',
      SMTP_URL: '',
      RESEND_API_KEY: '',
      OTP_FROM_EMAIL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 10000);
      child.stdout.on('data', () => {
        const match = output.match(/localhost:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited (${code}): ${output}`));
      });
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/auth/request-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'production@example.com' })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'email_not_configured');
    assert.doesNotMatch(output, /OTP production@example\.com/);
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve);
    });
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
