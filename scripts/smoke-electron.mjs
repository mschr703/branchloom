import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const explicitIndex = process.argv.indexOf('--executable');
const explicitExecutable = explicitIndex < 0 ? null : process.argv[explicitIndex + 1];
if (explicitIndex >= 0 && !explicitExecutable) throw new Error('--executable braucht einen Pfad');
const timeoutIndex = process.argv.indexOf('--timeout-ms');
// The broad smoke includes several real Git, browser, and PTY flows. A packaged
// Windows run can approach four minutes under concurrent CI or local load.
const timeoutMs = timeoutIndex < 0 ? 360_000 : Number(process.argv[timeoutIndex + 1]);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 600_000) {
  throw new Error('--timeout-ms must be an integer between 30000 and 600000');
}
const packaged = process.argv.includes('--package') || explicitExecutable !== null;
const f06 = process.argv.includes('--f06');
const f01 = process.argv.includes('--f01');
const f03 = process.argv.includes('--f03');
const g02 = process.argv.includes('--g02');
const g02Auto = process.argv.includes('--g02-auto');
const usage = process.argv.includes('--usage');
const changelog = process.argv.includes('--changelog');
const whiteboard = process.argv.includes('--whiteboard');
const chatCanvas = process.argv.includes('--chat-canvas');
const teamWorkspace = process.argv.includes('--team-workspace');
if (Number(f01) + Number(f03) + Number(f06) + Number(g02) + Number(g02Auto) + Number(usage) + Number(changelog) + Number(whiteboard) + Number(chatCanvas) + Number(teamWorkspace) > 1) throw new Error('Choose one focused smoke mode.');
const executable = explicitExecutable ?? (packaged
  ? join(process.cwd(), 'out', 'Branchloom-win32-x64', 'Branchloom.exe')
  : require('electron'));
if (!existsSync(executable)) throw new Error(`Electron-Binary fehlt: ${executable}`);
const smokeFlag = f01 ? '--studio-smoke-f01' : f03 ? '--studio-smoke-f03' : f06 ? '--studio-smoke-f06' : g02 ? '--studio-smoke-g02'
  : g02Auto ? '--studio-smoke-g02-auto' : usage ? '--studio-smoke-usage' : changelog ? '--studio-smoke-changelog' : whiteboard ? '--studio-smoke-whiteboard' : chatCanvas ? '--studio-smoke-chat-canvas' : teamWorkspace ? '--studio-smoke-team-workspace' : '--studio-smoke';
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
  const expectedMarker = f01 ? 'STUDIO_SMOKE_F01_OK' : f03 ? 'STUDIO_SMOKE_F03_OK' : f06 ? 'STUDIO_SMOKE_F06_OK' : g02 ? 'G02_SMOKE_OK'
    : g02Auto ? 'G02_AUTO_SMOKE_OK' : usage ? 'STUDIO_SMOKE_USAGE_OK' : changelog ? 'STUDIO_SMOKE_CHANGELOG_OK' : whiteboard ? 'STUDIO_SMOKE_WHITEBOARD_OK' : chatCanvas ? 'STUDIO_SMOKE_CHAT_CANVAS_OK' : teamWorkspace ? 'STUDIO_SMOKE_TEAM_WORKSPACE_OK' : 'STUDIO_SMOKE_OK';
  if (code === 0 && stdout.includes(expectedMarker)) {
    console.log(f01 ? `${packaged ? 'Paket' : 'Quellbuild'}: F01 saved project profile, two visible card previews with distinct live worktree versions, browser tabs, logs, independent stop and reload passed.`
      : f03 ? `${packaged ? 'Paket' : 'Quellbuild'}: F03-Kartenansicht, bewusst gespeicherte Revision, Dreifachvergleich, Konfliktwahl, Wiederöffnen und veraltete Zieldatei erfolgreich.`
      : f06 ? `${packaged ? 'Paket' : 'Quellbuild'}: F06 board revision, live CLI delivery, source cleanup evidence, reload and stopped-session guard passed.`
      : g02 ? `${packaged ? 'Paket' : 'Quellbuild'}: G02-Kartenklick, Diff-Prüfung, npm-Testbeleg, bestätigter Fast-Forward und divergierter zweiter Worktree erfolgreich.`
      : g02Auto ? `${packaged ? 'Paket' : 'Quellbuild'}: G02 automatic policy, current review/test evidence, project pause, background fast-forward and restart receipt passed.`
      : usage ? `${packaged ? 'Paket' : 'Quellbuild'}: Usage origin, workflow links, unknown tokens and visible navigation passed.`
      : changelog ? `${packaged ? 'Paket' : 'Quellbuild'}: Changelog receipt, current Git ancestry, review/test snapshot and visible card link passed.`
      : whiteboard ? `${packaged ? 'Paket' : 'Quellbuild'}: saved Whiteboard, tracked-source preview, keyboard evidence and unchanged board passed.`
      : chatCanvas ? `${packaged ? 'Package' : 'Source build'}: visible project chat, explicit canvas save, selected Whiteboard node and persisted reload passed.`
      : teamWorkspace ? `${packaged ? 'Package' : 'Source build'}: visible team setup, separate member credentials, presence, revisioned priority and column controls, offline draft replay without duplication, coordinator reconnect and retained owner credential passed.`
      : `${packaged ? 'Paket' : 'Quellbuild'}: Renderer, IPC, SQLite, Terminal/Agenten-PTY, Board, Ideenraum, Aufgabenklärung, Whiteboard, Kartenkontext mit bestätigtem Anhang-, Whiteboard-Dateibox- und Design-Beleg-Drop, lokale Karten-QA mit mehreren Routen, DOM-Hinweisen und Screenshots, visueller Vergleich, gespeicherte Prüfgrößenansicht, Design-Aufnahmen in drei Größen, Changelog-Quellwahl und Memory-Übernahme erfolgreich.`);
  } else {
    console.error(timedOut ? `Electron-Smoke nach ${timeoutMs / 1000} Sekunden ohne Abschluss-Signal abgebrochen.` : `Electron-Smoke fehlgeschlagen (Exit ${code ?? 'unbekannt'}).`);
    if (stdout.trim()) console.error(`Recent app stdout:\n${stdout.slice(-8000)}`);
    if (stderr.trim()) console.error(`Recent app stderr:\n${stderr.slice(-8000)}`);
    process.exitCode = 1;
  }
});
