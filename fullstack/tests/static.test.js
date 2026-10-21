'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const publicDir = path.join(__dirname, '..', 'public');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

test('browser and server scripts pass a syntax check', () => {
  for (const file of [
    path.join(root, 'fullstack', 'server.js'),
    path.join(publicDir, 'app.js'),
    path.join(publicDir, 'features.js')
  ]) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${path.basename(file)}: ${result.stderr}`);
  }
});

test('KaTeX is self-hosted and trust is disabled', () => {
  const index = read(publicDir, 'index.html');
  assert.match(index, /\/vendor\/katex\/katex\.min\.css/);
  assert.match(index, /\/vendor\/katex\/katex\.min\.js/);
  assert.doesNotMatch(index, /https?:\/\/[^"']+\.(?:js|css)/);

  const app = read(publicDir, 'app.js');
  assert.match(app, /trust:\s*false/);

  assert.ok(fs.existsSync(path.join(publicDir, 'vendor', 'katex', 'katex.min.js')));
  assert.ok(fs.existsSync(path.join(publicDir, 'vendor', 'katex', 'katex.min.css')));
});

test('brand palette uses havs orange and green', () => {
  const css = read(publicDir, 'styles.css');
  assert.match(css, /--accent:\s*#ea580c/i);
  assert.match(css, /--accent-2:\s*#00a10d/i);
  assert.match(css, /\.logo \{[^}]*color:\s*var\(--accent-2\)/);
  assert.match(css, /\.logo span \{[^}]*color:\s*var\(--accent\)/);
  assert.doesNotMatch(css, /#6c5ce7|#8b7cff|#d6a400/i);
  assert.match(read(publicDir, 'app.js'), /strokeStyle = '#ea580c'/);
  assert.match(read(publicDir, 'index.html'), /theme-color" content="#00a10d"/i);

  const webManifest = read(publicDir, 'manifest.webmanifest');
  assert.match(webManifest, /"theme_color":\s*"#00a10d"/i);
  assert.match(webManifest, /"background_color":\s*"#ffffff"/i);

  const colors = read(root, 'app', 'src', 'main', 'res', 'values', 'colors.xml');
  assert.match(colors, /havs_green">#00A10D</i);
  assert.match(colors, /havs_orange">#EA580C</i);

  const theme = read(root, 'app', 'src', 'main', 'res', 'values', 'themes.xml');
  assert.match(theme, /@color\/havs_orange/);
  assert.match(theme, /@android:color\/white/);
});

test('Lab iframe stays sandboxed without same-origin access', () => {
  const features = read(publicDir, 'features.js');
  assert.match(features, /<iframe[^>]+sandbox="allow-scripts"/);
  assert.doesNotMatch(features, /sandbox="[^"]*allow-same-origin/);
});

test('push-open stays internal and cannot override the web origin', () => {
  const manifest = read(root, 'app', 'src', 'main', 'AndroidManifest.xml');
  const activity = manifest.match(/<activity[^>]*android:name="\.push\.PushOpenActivity"[^>]*>/);
  assert.ok(activity, 'PushOpenActivity declaration missing');
  assert.match(activity[0], /android:exported="false"/);
  assert.doesNotMatch(manifest, /com\.havs\.ai\.OPEN_PUSH/);

  const launcher = read(root, 'app', 'src', 'main', 'java', 'com', 'havs', 'ai', 'twa', 'LauncherActivity.kt');
  assert.doesNotMatch(launcher, /web_url|setWebUrl/);

  const push = read(root, 'app', 'src', 'main', 'java', 'com', 'havs', 'ai', 'push', 'PushOpenActivity.kt');
  assert.doesNotMatch(push, /web_url/);
  assert.match(push, /PushRoutePolicy\.resolve/);
});

test('CI runs the fullstack suite and compiles device tests', () => {
  const ci = read(root, '.github', 'workflows', 'ci.yml');
  assert.match(ci, /node-version:\s*'22'/);
  assert.match(ci, /npm ci/);
  assert.match(ci, /npm test/);
  assert.match(ci, /compileDebugAndroidTestKotlin/);
});

test('App Links and PWA identity use the deployed host', () => {
  const manifest = read(root, 'app', 'src', 'main', 'AndroidManifest.xml');
  assert.match(manifest, /android:host="\$\{appLinkHost\}"/);
  assert.doesNotMatch(manifest, /app\.havs\.ai/);

  const gradle = read(root, 'app', 'build.gradle.kts');
  assert.match(gradle, /manifestPlaceholders\["appLinkHost"\]\s*=\s*"103-20-102-229\.sslip\.io"/);

  const webManifest = read(publicDir, 'manifest.webmanifest');
  assert.match(webManifest, /"id":\s*"https:\/\/103-20-102-229\.sslip\.io\/"/);
  assert.doesNotMatch(webManifest, /havs\.local/);
});
