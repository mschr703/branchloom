import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const forbiddenPath = /(^|\/)(?:\.env(?:\..*)?|\.kangentic|\.claude|\.codex|data|browser-profile|transcripts?)(\/|$)|\.(?:sqlite(?:-wal|-shm)?|pem|p12|key|log)$/i;
const forbiddenText = [
  { category: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { category: 'credential token', pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g },
  { category: 'environment credential', pattern: /\b(?:OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*[:=]\s*["']?[^\s"'#]{16,}/gi },
  { category: 'personal home path', pattern: /(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s]+[\\/]/g },
];

const failures = [];
function checkContent(label, content) {
  for (const { category, pattern } of forbiddenText) {
    pattern.lastIndex = 0;
    let count = 0;
    for (const match of content.matchAll(pattern)) {
      const line = 1 + (content.slice(0, match.index).match(/\n/g)?.length ?? 0);
      failures.push(`${label}:${line}: ${category}`);
      if (++count >= 20) break;
    }
  }
}

for (const file of files) {
  const normalized = file.replaceAll('\\', '/');
  if (forbiddenPath.test(normalized)) {
    failures.push(`${file}: forbidden staged path`);
    continue;
  }
  // Review the exact blob that would be committed. A clean working-tree copy
  // must not hide sensitive content already staged in Git's index.
  const content = execFileSync('git', ['show', `:${file}`], {
    encoding: 'utf8', maxBuffer: 11 * 1024 * 1024,
  });
  checkContent(file, content);
}

// A token committed and then deleted is still publishable through Git history.
// Read only reachable blobs from HEAD; never print their contents.
let objects = '';
try {
  objects = execFileSync('git', ['rev-list', '--objects', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  // A new repository has no HEAD yet. The staged-file check above still runs.
}
const entries = objects.split(/\r?\n/).filter(Boolean).map((line) => {
  const separator = line.indexOf(' ');
  return { hash: separator < 0 ? line : line.slice(0, separator), path: separator < 0 ? '' : line.slice(separator + 1) };
});
if (entries.length) {
  const headers = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    input: entries.map((entry) => entry.hash).join('\n') + '\n', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  }).trimEnd().split('\n');
  if (headers.length !== entries.length) throw new Error('Incomplete Git object inventory');
  const blobs = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const match = headers[index].match(/^([a-f0-9]+) (\w+) (\d+)$/);
    if (!match || match[1] !== entry.hash) throw new Error('Invalid Git object inventory');
    if (match[2] !== 'blob') continue;
    const size = Number(match[3]);
    const label = entry.path || entry.hash.slice(0, 12);
    const historical = `${label} [history ${entry.hash.slice(0, 12)}]`;
    if (forbiddenPath.test(label.replaceAll('\\', '/'))) failures.push(`${historical}: forbidden historical path`);
    if (size > 10 * 1024 * 1024) failures.push(`${historical}: blob exceeds 10 MiB`);
    else blobs.push({ hash: entry.hash, historical, size });
  }

  function checkBatch(items) {
    if (!items.length) return;
    const batch = execFileSync('git', ['cat-file', '--batch'], {
      input: items.map((item) => item.hash).join('\n') + '\n', maxBuffer: 12 * 1024 * 1024,
    });
    let offset = 0;
    for (const item of items) {
      const lineEnd = batch.indexOf(10, offset);
      if (lineEnd < 0) throw new Error('Incomplete Git object header');
      const match = batch.toString('ascii', offset, lineEnd).match(/^([a-f0-9]+) blob (\d+)$/);
      if (!match || match[1] !== item.hash || Number(match[2]) !== item.size) throw new Error('Invalid Git object header');
      offset = lineEnd + 1;
      checkContent(item.historical, batch.toString('utf8', offset, offset + item.size));
      offset += item.size + 1;
    }
    if (offset !== batch.length) throw new Error('Unexpected trailing Git object data');
  }

  let batch = [];
  let batchBytes = 0;
  for (const blob of blobs) {
    if (batchBytes + blob.size > 10 * 1024 * 1024) {
      checkBatch(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(blob);
    batchBytes += blob.size;
  }
  checkBatch(batch);
}
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`Public check passed (${files.length} tracked files, ${entries.length} reachable objects).`);
}
