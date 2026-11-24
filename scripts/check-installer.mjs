import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'out', 'installer');
const setup = readdirSync(root).filter((name) => /^Branchloom-Setup-[0-9][^/\\]*\.exe$/.test(name));
if (setup.length !== 1) throw new Error('Expected exactly one Branchloom NSIS installer.');
if (!existsSync(join(root, 'win-unpacked', 'resources', 'app-update.yml'))) throw new Error('Installer update feed is missing.');
if (!existsSync(join(root, 'latest.yml'))) throw new Error('Installer release metadata is missing.');
if (!existsSync(join(root, 'win-unpacked', 'resources', 'app', 'LICENSE'))) throw new Error('Installer license is missing.');
if (!existsSync(join(root, 'win-unpacked', 'resources', 'app', 'docs', 'COMMERCIAL_LICENSING.md'))) throw new Error('Installer commercial licensing notice is missing.');
console.log('Installer, update feed, and release metadata are present.');
