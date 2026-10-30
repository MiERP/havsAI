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
    path.join(root, 'fullstack', 'admin.js'),
    path.join(root, 'fullstack', 'lib', 'ai.js'),
    path.join(root, 'fullstack', 'lib', 'secrets.js'),
    path.join(publicDir, 'speech.js'),
    path.join(publicDir, 'app.js'),
    path.join(publicDir, 'features.js'),
    path.join(publicDir, 'admin.js'),
    path.join(publicDir, 'sw.js')
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

test('exam prep text goes through the KaTeX pipeline', () => {
  const features = read(publicDir, 'features.js');
  assert.match(features, /function rich\(value\)/);
  assert.match(features, /rich\(section\.body/);
  assert.match(features, /rich\(example\.answer/);
  assert.match(features, /rich\(item\.question/);
  assert.doesNotMatch(features, /esc\(lesson\.intro\)/);
  assert.doesNotMatch(features, /esc\(example\.problem\)/);
});

test('the read-aloud toggle owns playback and gates speaking', () => {
  const app = read(publicDir, 'app.js');
  assert.match(app, /function speak\(text, forcedVoiceId\) \{\s*if \(!forcedVoiceId && !state\.voiceOn\) return;/);
  assert.match(app, /if \(state\.voiceOn\) speak\(full\);/);
  assert.match(app, /action === 'toggle-voice'[\s\S]{0,500}stopSpeech\(\)/);
  assert.match(app, /function syncVoiceFromProfile\(\)/);
});

test('truncated chat answers are signalled and partial math is salvaged', () => {
  const server = read(root, 'fullstack', 'server.js');
  assert.match(server, /CHAT_MAX_TOKENS/);
  assert.match(server, /type: 'truncated'/);

  const app = read(publicDir, 'app.js');
  assert.match(app, /function salvageTex\(/);
  assert.match(app, /incomplete: true/);
  assert.match(app, /json\.type === 'truncated'/);
  assert.match(read(publicDir, 'styles.css'), /\.math-tail/);
});

test('admin panel assets and routes are wired', () => {
  for (const file of ['admin.html', 'admin.js', 'admin.css']) {
    assert.ok(fs.existsSync(path.join(publicDir, file)), `missing ${file}`);
  }
  const server = read(root, 'fullstack', 'server.js');
  assert.match(server, /admin\.handle\(/);
  assert.match(server, /p === '\/admin'/);
  assert.match(read(publicDir, 'index.html'), /href="\/theme\.css"/);
});

test('brand palette uses havs orange and green', () => {
  const css = read(publicDir, 'styles.css');
  assert.match(css, /--accent:\s*#ea580c/i);
  assert.match(css, /--accent-2:\s*#00a10d/i);
  assert.match(css, /--on-accent:\s*#081005/i);
  assert.match(css, /--accent-rgb:\s*234,\s*88,\s*12/i);
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

test('multi-platform PWA manifest, icons, iOS meta tags, and service worker are configured', () => {
  for (const file of ['icon.svg', 'icon-maskable.svg', 'sw.js']) {
    assert.ok(fs.existsSync(path.join(publicDir, file)), `missing ${file}`);
  }
  const manifest = JSON.parse(read(publicDir, 'manifest.webmanifest'));
  assert.equal(manifest.orientation, 'any');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  assert.ok(manifest.icons.some((icon) => icon.src === '/icon.svg'));
  assert.ok(manifest.icons.some((icon) => icon.src === '/icon-maskable.svg' && icon.purpose === 'maskable'));
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2);

  const index = read(publicDir, 'index.html');
  assert.match(index, /apple-mobile-web-app-capable/);
  assert.match(index, /rel="icon"[^>]+href="\/icon\.svg"/);
  assert.match(index, /rel="apple-touch-icon"[^>]+href="\/icon\.svg"/);

  const sw = read(publicDir, 'sw.js');
  assert.match(sw, /\/api\//);
  assert.match(sw, /\/vendor\/katex\/katex\.min\.js/);
});

test('unified platform bridge, chat history management, and responsive desktop layout are wired', () => {
  const app = read(publicDir, 'app.js');
  assert.match(app, /havsPlatform/);
  assert.match(app, /havs-native-ready/);
  assert.match(app, /havs-device-info/);
  assert.match(app, /havs-set-theme/);
  assert.match(app, /serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(app, /new-chat/);
  assert.match(app, /delete-chat/);
  assert.match(app, /rename-chat/);

  const css = read(publicDir, 'styles.css');
  assert.match(css, /@media\s*\(min-width:\s*768px\)/);
  assert.match(css, /@media\s*\(min-width:\s*1024px\)/);
  assert.match(css, /\.layout-shell\s*\{[^}]*flex-direction:\s*row/);
  assert.match(css, /\.chat-stage\s*\{[^}]*flex:\s*1/);
  assert.match(css, /\.side-nav/);
  assert.match(css, /\.chat-sidebar/);

  const features = read(publicDir, 'features.js');
  assert.match(features, /install-app/);
  assert.match(features, /request-push/);
});

test('desktop application shell is pre-configured to connect to the production server', () => {
  const desktopDir = path.join(root, 'desktop');
  for (const file of ['config.json', 'package.json', 'main.js', 'preload.js', 'Program.cs']) {
    assert.ok(fs.existsSync(path.join(desktopDir, file)), `missing desktop/${file}`);
  }
  const config = JSON.parse(read(desktopDir, 'config.json'));
  assert.equal(config.serverUrl, 'https://103-20-102-229.sslip.io');
  const mainJs = read(desktopDir, 'main.js');
  assert.match(mainJs, /103-20-102-229\.sslip\.io/);
  const programCs = read(desktopDir, 'Program.cs');
  assert.match(programCs, /103-20-102-229\.sslip\.io/);
});
