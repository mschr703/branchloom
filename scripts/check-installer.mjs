import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = join(process.cwd(), 'out', 'installer');
const setup = readdirSync(root).filter((name) => /^Branchloom-Setup-[0-9][^/\\]*\.exe$/.test(name));
if (setup.length !== 1) throw new Error('Expected exactly one Branchloom NSIS installer.');
const feedPath = join(root, 'win-unpacked', 'resources', 'app-update.yml');
if (!existsSync(feedPath)) throw new Error('Installer update feed is missing.');
const feed = new Map();
const allowedFeedFields = new Set(['provider', 'owner', 'repo', 'updaterCacheDirName']);
for (const line of readFileSync(feedPath, 'utf8').split(/\r?\n/u)) {
  if (!line.trim() || line.startsWith('#')) continue;
  const field = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(\S(?:.*\S)?)$/u.exec(line);
  if (!field || !allowedFeedFields.has(field[1])) throw new Error('Installer update feed has an unexpected field or format.');
  if (feed.has(field[1])) throw new Error(`Installer update feed repeats ${field[1]}.`);
  feed.set(field[1], field[2]);
}
for (const [field, expected] of Object.entries({ provider: 'github', owner: 'mschr703', repo: 'branchloom' })) {
  if (feed.get(field) !== expected) throw new Error(`Installer update feed ${field} does not match the official repository.`);
}
if (!existsSync(join(root, 'latest.yml'))) throw new Error('Installer release metadata is missing.');
if (!existsSync(join(root, 'win-unpacked', 'resources', 'app', 'LICENSE'))) throw new Error('Installer license is missing.');
if (!existsSync(join(root, 'win-unpacked', 'resources', 'app', 'docs', 'COMMERCIAL_LICENSING.md'))) throw new Error('Installer commercial licensing notice is missing.');
const manifest = readFileSync(join(root, 'latest.yml'), 'utf8');
const version = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version;
if (manifest.match(/^version: (.+)$/m)?.[1] !== version) throw new Error('Installer release version does not match the package.');
if (manifest.match(/^path: (.+)$/m)?.[1] !== setup[0]) throw new Error('Installer release path does not match the package.');
if (Number(manifest.match(/^\s+size: (\d+)$/m)?.[1]) !== statSync(join(root, setup[0])).size) throw new Error('Installer release size does not match the package.');
const checksums = [...manifest.matchAll(/^\s*sha512: ([A-Za-z0-9+/=]+)$/gm)].map((match) => match[1]);
if (checksums.length !== 2 || checksums[0] !== checksums[1]) throw new Error('Installer release checksums disagree.');
const hash = createHash('sha512');
for await (const chunk of createReadStream(join(root, setup[0]))) hash.update(chunk);
if (hash.digest('base64') !== checksums[0]) throw new Error('Installer release checksum does not match the package.');
console.log('Installer, update feed, release checksum, and licensing notices are valid.');
