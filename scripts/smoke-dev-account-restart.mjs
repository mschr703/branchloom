import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = mkdtempSync(join(tmpdir(), 'branchloom-account-restart-'));

async function server() {
  const listener = createServer((request, response) => {
    if (request.url === '/api/me') {
      const role = /(?:^|; )f08=synthetic-cookie-secret-(admin|user)(?:;|$)/u.exec(request.headers.cookie ?? '')?.[1];
      response.writeHead(role ? 200 : 401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(role ? { subject: `${role}-fixture`, role } : {}));
    } else if (request.url?.startsWith('/login?as=')) {
      const role = new URL(request.url, 'http://localhost').searchParams.get('as');
      if (role !== 'admin' && role !== 'user') { response.writeHead(400); response.end(); return; }
      response.writeHead(200, { 'Set-Cookie': `f08=synthetic-cookie-secret-${role}; Path=/; HttpOnly; SameSite=Strict`, 'Content-Type': 'text/html' });
      response.end('<title>Account restart fixture</title>Signed in');
    } else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<title>Account restart fixture</title>'); }
  });
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  return { listener, port: listener.address().port };
}

async function run(phase, port) {
  const child = spawn(electron, [join(process.cwd(), 'scripts', 'smoke-dev-account-child.cjs'), phase], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BRANCHLOOM_ACCOUNT_RESTART_DIR: root, BRANCHLOOM_ACCOUNT_RESTART_PORT: String(port) },
  });
  let output = '';
  child.stdout.on('data', (part) => { output += part.toString(); });
  child.stderr.on('data', (part) => { output += part.toString(); });
  const timeout = setTimeout(() => child.kill(), 45_000);
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  clearTimeout(timeout);
  if (code !== 0 || !output.includes(`ACCOUNT_RESTART_${phase.toUpperCase()}_OK`)) {
    throw new Error(`Electron phase ${phase} failed (${code}): ${output.slice(-1200)}`);
  }
}

let first;
let second;
try {
  first = await server();
  await run('first', first.port);
  await new Promise((resolve) => first.listener.close(resolve)); first = null;
  second = await server();
  await run('second', second.port);
  console.log('Two isolated protected logins survived a real Electron process restart and changed preview port; targeted forget and revoke passed.');
} finally {
  if (first) await new Promise((resolve) => first.listener.close(resolve));
  if (second) await new Promise((resolve) => second.listener.close(resolve));
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
