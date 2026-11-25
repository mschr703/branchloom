import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { componentRecommendations } from '../../src/main/component-recommendations';
import { scanProjectComponents } from '../../src/main/component-catalog';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-suggest-')); roots.push(root);
  const projectPath = join(root, 'project'); mkdirSync(projectPath); mkdirSync(join(projectPath, 'src'));
  const git = (...args: string[]) => { const result = spawnSync('git', args, { cwd: projectPath, encoding: 'utf8', windowsHide: true }); if (result.status !== 0) throw new Error(String(result.stderr || result.error)); };
  git('init', '-q');
  writeFileSync(join(projectPath, 'src', 'Dialogs.tsx'), 'export function SettingsDialog() { return <dialog>Settings</dialog>; }\nexport function ConfirmDialog() { return <dialog>Confirm</dialog>; }\n');
  git('add', 'src/Dialogs.tsx');
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: projectPath });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Build settings dialog', description: 'Use project source.' });
  return { root, projectPath, store, project, card };
}

describe('card-scoped component suggestions', () => {
  it('reads the current card and tracked export without binding a choice', async () => {
    const { store, card } = fixture();
    try {
      const result = await componentRecommendations(store, card.id);
      expect(result).toMatchObject({ cardId: card.id, cardRevision: 0, partial: false, recommendations: [{ candidate: { name: 'SettingsDialog', path: 'src/Dialogs.tsx', line: 1 } }] });
      expect(result.recommendations[0]?.candidate.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(store.db.prepare('SELECT COUNT(*) AS count FROM card_component_choices WHERE card_id = ?').get(card.id)).toEqual({ count: 0 });
    } finally { store.close(); }
  });

  it('rejects changed card revision or archive during the asynchronous scan', async () => {
    const { store, card, projectPath } = fixture();
    try {
      await expect(componentRecommendations(store, card.id, async () => {
        store.updateCard({ id: card.id, title: 'Build confirm dialog' });
        return scanProjectComponents(projectPath);
      })).rejects.toThrow('während der Suche geändert');
      await expect(componentRecommendations(store, card.id, async () => {
        store.setCardArchived({ id: card.id, archived: true });
        return scanProjectComponents(projectPath);
      })).rejects.toThrow('während der Suche geändert');
      await expect(componentRecommendations(store, card.id)).rejects.toThrow('Archivierte Karte');
    } finally { store.close(); }
  });
});
