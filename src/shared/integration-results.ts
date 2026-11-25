import type { IntegrationState } from './integration-queue';

export interface IntegrationResultEntry {
  cardId: string;
  title: string;
  state: IntegrationState;
  reason: string | null;
  sourceHead: string;
  targetHead: string;
  targetBranch: string;
  integratedHead: string | null;
  approvalMode: 'manual' | 'automatic' | null;
  updatedAt: string;
  review: { reviewedAt: string; matchesSavedSnapshot: boolean } | null;
  test: { scriptName: string; state: string; exitCode: number | null; endedAt: string | null;
    matchesSavedSnapshot: boolean } | null;
  gitPresence: 'present' | 'missing' | 'unverified' | null;
  currentTargetHead: string | null;
}

export interface IntegrationResultFolder {
  projectId: string;
  projectName: string;
  generatedAt: string;
  entries: IntegrationResultEntry[];
  omittedCount: number;
}

const singleLine = (value: string) => value.replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ').trim();
const md = (value: string) => singleLine(value).replace(/[\\`*_\[\]<>|]/gu, '\\$&');
const short = (value: string) => value.slice(0, 12);

/** Human-readable copy of the stored queue and evidence; it never claims an unverified Git outcome. */
export function integrationResultsMarkdown(folder: IntegrationResultFolder): string {
  const integrated = folder.entries.filter((entry) => entry.state === 'integrated');
  const open = folder.entries.filter((entry) => entry.state !== 'integrated');
  const lines = [`# Integrationsergebnisse: ${md(folder.projectName)}`, '',
    `Erstellt: ${folder.generatedAt}`, `Übernommen: ${integrated.length} · Offen: ${open.length}`, ''];
  const append = (entry: IntegrationResultEntry) => {
    const target = entry.integratedHead ? ` → \`${short(entry.integratedHead)}\`` : '';
    lines.push(`- **${md(entry.title)}** (\`${short(entry.sourceHead)}\`${target}, ${md(entry.targetBranch)})`);
    lines.push(`  - Zustand: ${entry.state}; Freigabe: ${entry.approvalMode ?? 'nicht gespeichert'}; aktuelles Ziel: ${entry.gitPresence ?? 'nicht geprüft'}${entry.currentTargetHead ? ` (\`${short(entry.currentTargetHead)}\`)` : ''}.`);
    lines.push(`  - Diff-Prüfung: ${entry.review ? `${entry.review.matchesSavedSnapshot ? 'für gespeicherten Stand belegt' : 'anderer Stand'} am ${entry.review.reviewedAt}` : 'kein Beleg'}; Test: ${entry.test ? `${entry.test.state} (${md(entry.test.scriptName)}, Exit ${entry.test.exitCode ?? 'unbekannt'})${entry.test.matchesSavedSnapshot ? '' : ', anderer Stand'}` : 'kein Beleg'}.`);
    if (entry.reason) lines.push(`  - Blocker: ${md(entry.reason)}`);
  };
  lines.push('## Übernommen');
  if (!integrated.length) lines.push('Keine übernommenen Karten.');
  for (const entry of integrated) append(entry);
  lines.push('', '## Offen');
  if (!open.length) lines.push('Keine offenen Integrationen.');
  for (const entry of open) append(entry);
  if (folder.omittedCount) lines.push('', `${folder.omittedCount} ältere Einträge sind in dieser Ansicht nicht enthalten.`);
  return `${lines.join('\n')}\n`;
}
