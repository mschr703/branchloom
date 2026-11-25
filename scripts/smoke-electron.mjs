import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const explicitIndex = process.argv.indexOf('--executable');
const explicitExecutable = explicitIndex < 0 ? null : process.argv[explicitIndex + 1];
if (explicitIndex >= 0 && !explicitExecutable) throw new Error('--executable braucht einen Pfad');
const timeoutIndex = process.argv.indexOf('--timeout-ms');
const timeoutMs = timeoutIndex < 0 ? 120_000 : Number(process.argv[timeoutIndex + 1]);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 600_000) {
  throw new Error('--timeout-ms must be an integer between 30000 and 600000');
}
const packaged = process.argv.includes('--package') || explicitExecutable !== null;
const f06 = process.argv.includes('--f06');
const executable = explicitExecutable ?? (packaged
  ? join(process.cwd(), 'out', 'Branchloom-win32-x64', 'Branchloom.exe')
  : require('electron'));
if (!existsSync(executable)) throw new Error(`Electron-Binary fehlt: ${executable}`);
const smokeFlag = f06 ? '--studio-smoke-f06' : '--studio-smoke';
const args = packaged ? [smokeFlag] : ['.', smokeFlag];
const child = spawn(executable, args, {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, JARVIS_STUDIO_DEV_SERVER: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-10000); });
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-10000); });
let timedOut = false;
const timeout = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
child.on('error', (error) => {
  clearTimeout(timeout);
  console.error(`Electron-Start fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearTimeout(timeout);
  if (code === 0 && stdout.includes(f06 ? 'STUDIO_SMOKE_F06_OK' : 'STUDIO_SMOKE_OK')) {
    console.log(f06 ? `${packaged ? 'Paket' : 'Quellbuild'}: F06 board revision, live CLI delivery, source cleanup evidence, reload and stopped-session guard passed.`
      : `${packaged ? 'Paket' : 'Quellbuild'}: Renderer, IPC, SQLite, Terminal/Agenten-PTY, Board, Ideenraum, Aufgabenklärung, Whiteboard, Kartenkontext mit bestätigtem Anhang-, Whiteboard-Dateibox- und Design-Beleg-Drop, lokale Karten-QA mit mehreren Routen, DOM-Hinweisen und Screenshots, visueller Vergleich, gespeicherte Prüfgrößenansicht, Design-Aufnahmen in drei Größen, Changelog-Quellwahl und Memory-Übernahme erfolgreich.`);
  } else {
    console.error(timedOut ? `Electron-Smoke nach ${timeoutMs / 1000} Sekunden ohne Abschluss-Signal abgebrochen.` : `Electron-Smoke fehlgeschlagen (Exit ${code ?? 'unbekannt'}).`);
    console.error(stderr.slice(-2000) || stdout.slice(-2000));
    process.exitCode = 1;
  }
});
