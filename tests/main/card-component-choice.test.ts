import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { scanProjectComponents } from '../../src/main/component-catalog';
import { addCardComponentChoice, addCardComponentVariant, assertCardComponentChoiceResume, cardComponentChoiceContext, cardComponentChoiceState, cardComponentVariantScreenshot, recordSessionComponentChoices, removeCardComponentChoice, removeCardComponentVariant } from '../../src/main/card-component-choice';
import { reserveCardSession } from '../../src/main/parallel-runs';
import { SessionRunner } from '../../src/main/cli';
import { sessionRunEvidence } from '../../src/main/session-evidence';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) {
  try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
  catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
} });

function git(root: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-component-choice-'));
  roots.push(root);
  const projectPath = join(root, 'project'); mkdirSync(projectPath); mkdirSync(join(projectPath, 'src'));
  git(projectPath, 'init', '-q');
  writeFileSync(join(projectPath, 'src', 'Dialogs.tsx'), 'export function SettingsDialog() { return <dialog>Settings</dialog>; }\nexport function ConfirmDialog() { return <dialog>Confirm</dialog>; }\n');
  git(projectPath, 'add', 'src/Dialogs.tsx');
  git(projectPath, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'two dialogs');
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Components', path: projectPath });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Settings view' });
  return { root, dbPath, projectPath, store, project, card };
}
async function choose(store: StudioStore, cardId: string, projectPath: string, name: string, purpose: string) {
  const candidate = (await scanProjectComponents(projectPath)).candidates.find((item) => item.name === name)!;
  return addCardComponentChoice(store, { cardId, expectedContentRevision: cardComponentChoiceState(store, cardId).contentRevision,
    name, path: candidate.path, line: candidate.line, sourceFingerprint: candidate.sourceFingerprint, purpose });
}
function qaReport(store: StudioStore, cardId: string, projectId: string, revision: number, id: string, route: string, status = 'passed') {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/hS0AAAAASUVORK5CYII=', 'base64');
  store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, final_url, started_at, ended_at, status, diagnostics_json, page_check, page_observations_json, screenshot_png, viewport_width, viewport_height, git_evidence_json, content_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'ok', '[]', ?, 1280, 800, 'null', ?)`).run(id, cardId, projectId, route, route, new Date().toISOString(), new Date().toISOString(), status, image, revision);
}

describe('card component references', () => {
  it('binds two rendered local dialog variants to one checked export and preserves their images across restart', async () => {
    const { dbPath, projectPath, store, project, card } = fixture();
    try {
      const chosen = await choose(store, card.id, projectPath, 'SettingsDialog', 'Use for settings');
      const choiceId = chosen.choices[0]!.id;
      qaReport(store, card.id, project.id, chosen.contentRevision, 'qa-compact', 'http://127.0.0.1:5173/stories/dialog/compact?token=synthetic-secret#internal');
      const one = addCardComponentVariant(store, { cardId: card.id, choiceId, expectedContentRevision: chosen.contentRevision, reportId: 'qa-compact', label: 'Compact' });
      expect(one.choices[0]?.variants).toMatchObject([{ label: 'Compact', reportId: 'qa-compact', previewUrl: 'http://127.0.0.1:5173/stories/dialog/compact' }]);
      qaReport(store, card.id, project.id, one.contentRevision, 'qa-same-route', 'http://127.0.0.1:5173/stories/dialog/compact?variant=other');
      expect(() => addCardComponentVariant(store, { cardId: card.id, choiceId, expectedContentRevision: one.contentRevision, reportId: 'qa-same-route', label: 'Duplicate route' })).toThrow('eigene Beispielroute');
      qaReport(store, card.id, project.id, one.contentRevision, 'qa-wide', 'http://127.0.0.1:5173/stories/dialog/wide');
      const two = addCardComponentVariant(store, { cardId: card.id, choiceId, expectedContentRevision: one.contentRevision, reportId: 'qa-wide', label: 'Wide' });
      expect(two.choices[0]?.variants).toHaveLength(2);
      const context = cardComponentChoiceContext(store, card.id, projectPath);
      expect(context).toContain('Compact'); expect(context).toContain('Wide'); expect(context).toContain('qaReportId');
      expect(context).not.toContain('synthetic-secret');
      expect(() => addCardComponentVariant(store, { cardId: card.id, choiceId, expectedContentRevision: one.contentRevision, reportId: 'qa-wide', label: 'Stale' })).toThrow('Karte wurde geändert');
      const agent = store.saveAgent({ name: 'Synthetic', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
      const session = reserveCardSession(store, { cardId: card.id, agentId: agent.id });
      recordSessionComponentChoices(store, card.id, session.id);
      expect(() => removeCardComponentVariant(store, { cardId: card.id, variantId: two.choices[0]!.variants[0]!.id, expectedContentRevision: two.contentRevision })).toThrow('Laufenden');
      store.finishSession(session.id, 'exited', 0);
      const removed = removeCardComponentVariant(store, { cardId: card.id, variantId: two.choices[0]!.variants[0]!.id, expectedContentRevision: two.contentRevision });
      expect(removed.choices[0]?.variants).toHaveLength(1);
      expect(() => assertCardComponentChoiceResume(store, card.id, session.id, projectPath)).toThrow('geändert');
    } finally { store.close(); }
    const reopened = new StudioStore(dbPath);
    try {
      const state = cardComponentChoiceState(reopened, card.id);
      expect(state.choices[0]?.variants).toMatchObject([{ label: 'Wide' }]);
      expect(cardComponentVariantScreenshot(reopened, { cardId: card.id, variantId: state.choices[0]!.variants[0]!.id })).toMatch(/^data:image\/png;base64,/);
    } finally { reopened.close(); }
  });

  it('rejects foreign, failed, old-revision, and changed-source variant evidence', async () => {
    const { projectPath, store, project, card } = fixture();
    try {
      const chosen = await choose(store, card.id, projectPath, 'SettingsDialog', 'Use for settings');
      const choiceId = chosen.choices[0]!.id;
      qaReport(store, card.id, project.id, chosen.contentRevision, 'failed', 'http://127.0.0.1:5173/stories/fail', 'failed');
      expect(() => addCardComponentVariant(store, { cardId: card.id, choiceId, expectedContentRevision: chosen.contentRevision, reportId: 'failed', label: 'Failure' })).toThrow('erfolgreiche');
      expect(() => addCardComponentVariant(store, { cardId: card.id, choiceId, expectedContentRevision: chosen.contentRevision, reportId: 'foreign', label: 'Foreign' })).toThrow('erfolgreiche');
      qaReport(store, card.id, project.id, chosen.contentRevision - 1, 'old', 'http://127.0.0.1:5173/stories/old');
      expect(() => addCardComponentVariant(store, { cardId: card.id, choiceId, expectedContentRevision: chosen.contentRevision, reportId: 'old', label: 'Old' })).toThrow('älteren Kartenrevision');
      writeFileSync(join(projectPath, 'src', 'Dialogs.tsx'), 'export function SettingsDialog() { return <dialog>Changed</dialog>; }\n');
      expect(() => addCardComponentVariant(store, { cardId: card.id, choiceId, expectedContentRevision: chosen.contentRevision, reportId: 'old', label: 'Changed' })).toThrow('Komponentenquelle hat sich geändert');
    } finally { store.close(); }
  });
  it('stores two source-bound dialog choices and sends both to a real card agent', async () => {
    const { dbPath, projectPath, store, project, card } = fixture();
    try {
      await choose(store, card.id, projectPath, 'SettingsDialog', 'Use for project settings');
      await choose(store, card.id, projectPath, 'ConfirmDialog', 'Use before deleting data');
      expect(cardComponentChoiceState(store, card.id).choices).toMatchObject([
        { name: 'SettingsDialog', current: true }, { name: 'ConfirmDialog', current: true },
      ]);
      const context = cardComponentChoiceContext(store, card.id, projectPath);
      expect(context).toContain('SettingsDialog'); expect(context).toContain('ConfirmDialog');
      const agent = store.saveAgent({ name: 'Synthetic reader', kind: 'custom', command: process.execPath,
        args: ['-e', 'console.log(process.argv[1])', '{prompt}'], model: null, enabled: true });
      let complete!: () => void;
      const done = new Promise<void>((resolve) => { complete = resolve; });
      const runner = new SessionRunner(store, () => undefined, () => complete());
      try {
        const session = runner.start({ cardId: card.id, agentId: agent.id, mode: 'one-shot' });
        await Promise.race([done, new Promise<void>((_, reject) => setTimeout(() => reject(new Error('CLI did not exit')), 10_000))]);
        const output = store.session(session.id).output;
        expect(output).toContain('SettingsDialog'); expect(output).toContain('ConfirmDialog');
        expect(sessionRunEvidence(store, { projectId: project.id, sessionId: session.id }).launch?.sources).toContain('component-reference');
      } finally { runner.dispose(); }
    } finally { store.close(); }
    const reopened = new StudioStore(dbPath);
    try { expect(cardComponentChoiceState(reopened, card.id).choices).toHaveLength(2); }
    finally { reopened.close(); }
  }, 20_000);

  it('marks changed sources stale and blocks a new agent start instead of silently replacing them', async () => {
    const { projectPath, store, card } = fixture();
    try {
      await choose(store, card.id, projectPath, 'SettingsDialog', 'Use for settings');
      writeFileSync(join(projectPath, 'src', 'Dialogs.tsx'), 'export function SettingsDialog() { return <dialog>Changed</dialog>; }\nexport function ConfirmDialog() { return <dialog>Confirm</dialog>; }\n');
      expect(cardComponentChoiceState(store, card.id).choices[0]?.current).toBe(false);
      expect(() => cardComponentChoiceContext(store, card.id, projectPath)).toThrow('veraltet');
      const agent = store.saveAgent({ name: 'Synthetic reader', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
      const runner = new SessionRunner(store, () => undefined, () => undefined);
      try { expect(() => runner.start({ cardId: card.id, agentId: agent.id, mode: 'interactive' })).toThrow('veraltet'); }
      finally { runner.dispose(); }
      expect((store.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE card_id = ?').get(card.id) as { count: number }).count).toBe(0);
    } finally { store.close(); }
  });

  it('rejects stale card revision, missing source, foreign-project candidate, and edits during a live run', async () => {
    const { root, projectPath, store, project, card } = fixture();
    try {
      const candidate = (await scanProjectComponents(projectPath)).candidates[0]!;
      const stale = cardComponentChoiceState(store, card.id).contentRevision;
      store.updateCard({ id: card.id, title: 'Changed card' });
      await expect(addCardComponentChoice(store, { cardId: card.id, expectedContentRevision: stale,
        name: candidate.name, path: candidate.path, line: candidate.line, sourceFingerprint: candidate.sourceFingerprint, purpose: 'Use this dialog' })).rejects.toThrow('Karte wurde geändert');
      const otherPath = join(root, 'other'); mkdirSync(otherPath); git(otherPath, 'init', '-q');
      const other = store.createProject({ name: 'Other', path: otherPath });
      const foreign = store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Other' });
      await expect(addCardComponentChoice(store, { cardId: foreign.id, expectedContentRevision: cardComponentChoiceState(store, foreign.id).contentRevision,
        name: candidate.name, path: candidate.path, line: candidate.line, sourceFingerprint: candidate.sourceFingerprint, purpose: 'Use this dialog' })).rejects.toThrow('nicht gefunden');
      const selected = await choose(store, card.id, projectPath, 'SettingsDialog', 'Use for settings');
      const agent = store.saveAgent({ name: 'Synthetic', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
      const running = reserveCardSession(store, { cardId: card.id, agentId: agent.id });
      expect(() => removeCardComponentChoice(store, { cardId: card.id, choiceId: selected.choices[0]!.id, expectedContentRevision: selected.contentRevision })).toThrow('Laufenden');
      store.finishSession(running.id, 'stopped', null);
      expect(removeCardComponentChoice(store, { cardId: card.id, choiceId: selected.choices[0]!.id, expectedContentRevision: selected.contentRevision }).choices).toEqual([]);
      expect(project.id).not.toBe(other.id);
    } finally { store.close(); }
  });

  it('rejects resume when component choices changed after the original run', async () => {
    const { projectPath, store, card } = fixture();
    try {
      await choose(store, card.id, projectPath, 'SettingsDialog', 'Use for settings');
      const agent = store.saveAgent({ name: 'Synthetic', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
      const session = reserveCardSession(store, { cardId: card.id, agentId: agent.id });
      recordSessionComponentChoices(store, card.id, session.id);
      store.finishSession(session.id, 'exited', 0);
      expect(() => assertCardComponentChoiceResume(store, card.id, session.id, projectPath)).not.toThrow();
      await choose(store, card.id, projectPath, 'ConfirmDialog', 'Use before deleting');
      expect(() => assertCardComponentChoiceResume(store, card.id, session.id, projectPath)).toThrow('geändert');
    } finally { store.close(); }
  });
});
