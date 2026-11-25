// Opt-in release acceptance. This must never run on a developer's Windows profile.
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OLD = '0.1.0';
const NEW = '0.1.2';
const REPOSITORY = 'mschr703/branchloom';
const EVIDENCE = join(process.cwd(), 'update-acceptance-evidence');
const steps = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message) => { throw new Error(message); };

if (process.argv.includes('--help')) {
  process.stdout.write('Run only through the manual installed-update-acceptance workflow on a fresh GitHub-hosted Windows VM.\n');
  process.exit(0);
}
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.GITHUB_REPOSITORY !== REPOSITORY
  || !process.env.APPDATA || !process.env.LOCALAPPDATA) {
  fail('Installed update acceptance requires the official fresh GitHub-hosted Windows runner.');
}
if (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version !== NEW) {
  fail('The checked-out package must be version 0.1.2.');
}
const profile = join(process.env.APPDATA, 'jarvis-studio');
if (existsSync(profile)) fail('Runner already has a Branchloom user profile; refusing to touch it.');
mkdirSync(EVIDENCE, { recursive: true });
const record = (name, detail = {}) => {
  steps.push({ name, at: new Date().toISOString(), ...detail });
  writeFileSync(join(EVIDENCE, 'summary.json'), JSON.stringify({ expected: [OLD, NEW], steps }, null, 2));
  process.stdout.write(`[installed update] ${name}\n`);
};

function manifest(text, version) {
  const expectedName = `Branchloom-Setup-${version}.exe`;
  const foundVersion = text.match(/^version:\s*(\S+)\s*$/m)?.[1];
  const foundPath = text.match(/^path:\s*(\S+)\s*$/m)?.[1];
  const sha512 = text.match(/^sha512:\s*([A-Za-z0-9+/=]+)\s*$/m)?.[1];
  if (foundVersion !== version || foundPath !== expectedName || !sha512 || Buffer.from(sha512, 'base64').length !== 64) {
    fail(`Published ${version} update manifest does not name the expected installer and SHA-512.`);
  }
  return { name: expectedName, sha512 };
}

async function publicText(url, headers = {}) {
  const response = await fetch(url, { headers: { 'User-Agent': 'branchloom-installed-update-acceptance', ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) fail(`Public release request failed: HTTP ${response.status} for ${new URL(url).pathname}`);
  return response.text();
}

async function downloadVerified(url, destination, expectedSha512) {
  const response = await fetch(url, { headers: { 'User-Agent': 'branchloom-installed-update-acceptance' }, signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) fail(`Old installer download failed: HTTP ${response.status}`);
  const stream = createWriteStream(destination, { flags: 'wx' });
  const hash = createHash('sha512');
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 250 * 1024 * 1024) fail('Old installer exceeds the 250 MB acceptance limit.');
      hash.update(chunk);
      if (!stream.write(chunk)) await once(stream, 'drain');
    }
    stream.end();
    await once(stream, 'finish');
  } catch (error) { stream.destroy(); throw error; }
  if (hash.digest('base64') !== expectedSha512) fail('Old installer SHA-512 does not match its published update manifest.');
  record('verified old installer', { version: OLD, bytes: size });
}

function run(executable, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (data) => { stderr = (stderr + data.toString()).slice(-1600); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Timed out running ${executable}`)); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${executable} exited ${code}: ${stderr}`));
    });
  });
}

function installedExe() {
  const programs = join(process.env.LOCALAPPDATA, 'Programs');
  if (!existsSync(programs)) fail('The per-user Programs directory was not created by NSIS.');
  const matches = readdirSync(programs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(programs, entry.name, 'Branchloom.exe'))
    .filter(existsSync);
  if (matches.length !== 1) fail(`Expected one installed Branchloom.exe below the per-user Programs directory; found ${matches.length}.`);
  return matches[0];
}
function installedVersion(exe) {
  const packagePath = join(exe, '..', 'resources', 'app', 'package.json');
  try { return JSON.parse(readFileSync(packagePath, 'utf8')).version; }
  catch { return null; }
}
async function waitForVersion(exe, version, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (installedVersion(exe) === version) return;
    await delay(1000);
  }
  fail(`Installed package did not become ${version} within ${timeoutMs / 1000} seconds.`);
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

async function connectPage(port, timeoutMs = 40_000) {
  const until = Date.now() + timeoutMs;
  let target;
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
      const pages = await response.json();
      target = pages.find((page) => page.type === 'page' && page.webSocketDebuggerUrl);
      if (target) break;
    } catch { /* App has not started yet. */ }
    await delay(300);
  }
  if (!target) fail('Installed app did not expose its Electron renderer for acceptance.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const command = (method, params = {}) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.delete(id)) reject(new Error(`CDP ${method} timed out`)); }, 12_000).unref();
    });
  };
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) fail(`Installed renderer evaluation failed: ${result.exceptionDetails.text}`);
    return result.result.value;
  };
  await command('Runtime.enable');
  await command('Page.enable');
  return {
    evaluate,
    async click(text) {
      const point = await evaluate(`(() => { const button = [...document.querySelectorAll('.release-update-actions button')].find((item) => item.textContent?.trim() === ${JSON.stringify(text)}); if (!button || button.disabled) return null; const r = button.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!point) fail(`The visible update button "${text}" is missing or disabled.`);
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    },
    async screenshot(name) {
      const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(EVIDENCE, name), Buffer.from(result.data, 'base64'));
    },
    close() { socket.close(); },
  };
}

async function launch(exe) {
  const port = await freePort();
  const child = spawn(exe, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (data) => { output = (output + data.toString()).slice(-1000); });
  try { return { child, page: await connectPage(port) }; }
  catch (error) { child.kill(); throw new Error(`${error.message} ${output}`); }
}
async function stopApp(launchResult) {
  launchResult.page.close();
  if (launchResult.child.exitCode !== null) return;
  // Electron has renderer/GPU children. A root-only kill can leave the
  // single-instance owner alive and make the next launch silently hand off.
  await run('taskkill.exe', ['/PID', String(launchResult.child.pid), '/T', '/F'], 15_000).catch(() => undefined);
  await delay(1200);
}
async function state(page) {
  return page.evaluate('window.studio.releaseUpdateState()');
}
async function waitForState(page, predicate, timeoutMs, description) {
  const until = Date.now() + timeoutMs;
  let seen = null;
  while (Date.now() < until) {
    try {
      seen = await state(page);
      if (predicate(seen)) return seen;
    } catch { /* The app may be restarting. */ }
    await delay(400);
  }
  fail(`Timed out waiting for ${description}; last state ${JSON.stringify(seen)}`);
}
function cachedSetups() {
  const root = join(process.env.LOCALAPPDATA, 'branchloom-updater');
  if (!existsSync(root)) return [];
  const visit = (path, depth) => depth > 3 ? [] : readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? visit(child, depth + 1) : /Branchloom-Setup-.*\.exe$/i.test(entry.name) ? [entry.name] : [];
  });
  return visit(root, 0);
}

let currentApp = null;
try {
  const api = JSON.parse(await publicText(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    Accept: 'application/vnd.github+json',
  }));
  if (api.tag_name !== `v${NEW}`) fail(`Latest public release is ${api.tag_name ?? 'unknown'}; expected v${NEW}. Run only after v${NEW} is published and while it is latest.`);
  const releaseRoot = `https://github.com/${REPOSITORY}/releases/download`;
  const oldManifest = manifest(await publicText(`${releaseRoot}/v${OLD}/latest.yml`), OLD);
  manifest(await publicText(`${releaseRoot}/v${NEW}/latest.yml`), NEW);
  record('published release preflight', { old: OLD, next: NEW });

  const root = join(tmpdir(), `branchloom-installed-update-${process.pid}`);
  mkdirSync(root, { recursive: true });
  const oldSetup = join(root, oldManifest.name);
  await downloadVerified(`${releaseRoot}/v${OLD}/${oldManifest.name}`, oldSetup, oldManifest.sha512);
  await run(oldSetup, ['/S'], 180_000);
  const exe = installedExe();
  await waitForVersion(exe, OLD, 30_000);
  record('installed old version', { version: OLD });

  // NSIS may auto-run the old app after silent installation. This runner is a
  // fresh, dedicated VM; closing that instance lets us attach CDP to our own.
  await run('taskkill.exe', ['/IM', 'Branchloom.exe', '/T', '/F'], 15_000).catch(() => undefined);
  currentApp = await launch(exe);
  const oldState = await waitForState(currentApp.page, (value) => value.currentVersion === OLD, 30_000, '0.1.0 startup');
  if (oldState.phase === 'unsupported') fail('The installed 0.1.0 app has no update feed.');
  const projectPath = join(root, 'synthetic-project');
  mkdirSync(projectPath);
  writeFileSync(join(projectPath, 'README.md'), '# Synthetic installed update acceptance\n');
  execFileSync('git', ['init', '-q'], { cwd: projectPath, windowsHide: true });
  execFileSync('git', ['-c', 'user.name=Synthetic QA', '-c', 'user.email=qa@example.invalid', 'add', '.'], { cwd: projectPath, windowsHide: true });
  execFileSync('git', ['-c', 'user.name=Synthetic QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'Synthetic acceptance project'], { cwd: projectPath, windowsHide: true });
  const saved = await currentApp.page.evaluate(`(async () => { const project = await window.studio.createProject({ name: 'Synthetic update acceptance', path: ${JSON.stringify(projectPath)} }); const snapshot = await window.studio.snapshot(project.id); const card = await window.studio.createCard({ projectId: project.id, columnId: snapshot.columns[0].id, title: 'Synthetic card survives update' }); return { projectId: project.id, cardId: card.id }; })()`);
  record('saved synthetic card through installed IPC');

  await waitForState(currentApp.page, (value) => value.phase === 'available' && value.availableVersion === NEW, 150_000, '0.1.2 update notice');
  await currentApp.page.screenshot('available-0.1.0.png');
  const beforeLater = cachedSetups();
  await currentApp.page.click('Später');
  await waitForState(currentApp.page, (value) => value.phase === 'current' && value.currentVersion === OLD, 10_000, 'Later dismissal');
  await delay(1500);
  if (installedVersion(exe) !== OLD || cachedSetups().length > beforeLater.length) fail('Later downloaded or installed an update.');
  record('Later stayed passive', { version: OLD });

  await stopApp(currentApp);
  currentApp = await launch(exe);
  await waitForState(currentApp.page, (value) => value.phase === 'available' && value.availableVersion === NEW, 150_000, 'notice after restart');
  await currentApp.page.screenshot('available-after-restart.png');
  record('notice returned after restart');

  await currentApp.page.click('Aktualisieren');
  const seen = new Set();
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline && installedVersion(exe) !== NEW) {
    try {
      const update = await state(currentApp.page);
      seen.add(update.phase);
      if (update.phase === 'blocked' || update.phase === 'error') fail(`Update stopped in ${update.phase}: ${update.message}`);
    } catch (error) {
      if (String(error.message).startsWith('Update stopped')) throw error;
      // The old renderer disconnects during quitAndInstall.
    }
    await delay(500);
  }
  await waitForVersion(exe, NEW, 30_000);
  if (!seen.has('downloading') && !seen.has('installing')) fail('No download or install phase was observed after the UI click.');
  record('update installed from UI click', { version: NEW, observedPhases: [...seen] });

  await stopApp(currentApp);
  await run('taskkill.exe', ['/IM', 'Branchloom.exe', '/T', '/F'], 15_000).catch(() => undefined);
  await delay(1500);
  currentApp = await launch(exe);
  const newState = await waitForState(currentApp.page, (value) => value.currentVersion === NEW, 30_000, 'updated app startup');
  if (newState.phase === 'unsupported') fail('Updated installed app lost its update feed.');
  const stillSaved = await currentApp.page.evaluate(`(async () => { const snapshot = await window.studio.snapshot(${JSON.stringify(saved.projectId)}); return snapshot.cards.some((card) => card.id === ${JSON.stringify(saved.cardId)} && card.title === 'Synthetic card survives update'); })()`);
  if (!stillSaved) fail('Synthetic card did not survive the installed update.');
  await currentApp.page.screenshot('updated-0.1.2.png');
  record('updated app and synthetic card verified', { version: NEW });
  process.stdout.write('INSTALLED_UPDATE_010_TO_012_OK\n');
} catch (error) {
  if (currentApp) await currentApp.page.screenshot('failed.png').catch(() => undefined);
  record('failed', { error: error instanceof Error ? error.message : String(error) });
  throw error;
} finally {
  if (currentApp) await stopApp(currentApp).catch(() => undefined);
}
