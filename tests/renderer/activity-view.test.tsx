import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectSnapshot } from '../../src/shared/types';
import { activityItems, formatDuration, sessionDuration } from '../../src/renderer/activity-data';
import { ActivityView } from '../../src/renderer/components/ActivityView';

const t0 = '2026-01-01T10:00:00.000Z';
const t1 = '2026-01-01T10:02:05.000Z';
const snapshot: ProjectSnapshot = {
  project: { id: 'p', name: 'Test', path: 'C:\\test', createdAt: t0 },
  columns: [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [
    { id: 'c1', projectId: 'p', columnId: 'todo', title: 'Fehler prüfen', description: '', priority: 'none', labels: [], position: 0, createdAt: t0, updatedAt: t0, archivedAt: null },
    { id: 'c2', projectId: 'p', columnId: 'todo', title: 'Noch offen', description: '', priority: 'none', labels: [], position: 1, createdAt: t0, updatedAt: t0, archivedAt: null },
  ],
  agents: [{ id: 'a', name: 'Test-CLI', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
  sessions: [
    { id: 'failed', projectId: 'p', cardId: 'c1', agentId: 'a', state: 'failed', startedAt: t0, endedAt: t1, exitCode: 2, output: 'private output' },
    { id: 'running', projectId: 'p', cardId: 'c1', agentId: 'a', state: 'running', startedAt: t1, endedAt: null, exitCode: null, output: 'private output' },
  ],
  workflows: [{ id: 'w', projectId: 'p', name: 'Review', cardIds: ['c1'], steps: [{ id: 's', columnId: 'todo', agentId: 'a', requireApproval: true }], state: 'paused', pauseReason: 'review', currentStep: 0, createdAt: t0, updatedAt: t1 }],
  notes: [],
};

describe('activity data', () => {
  it('uses stored start/end timestamps for duration and never guesses missing endpoints', () => {
    expect(sessionDuration(snapshot.sessions[0], Date.parse(t1) + 10_000)).toBe(125_000);
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(sessionDuration(snapshot.sessions[1], Date.parse(t1) + 65_000)).toBe(65_000);
    expect(formatDuration(null)).toBe('nicht erfasst');
  });

  it('shows all session runs, workflow attention, and cards without a run without duplicating card history', () => {
    const all = activityItems(snapshot, Date.parse(t1) + 65_000);
    expect(all.map((item) => `${item.kind}:${item.id}`)).toEqual(['session:running', 'workflow:w', 'session:failed', 'card:c2']);
    expect(all.find((item) => item.id === 'failed')).toMatchObject({ status: 'attention', statusLabel: 'Fehlgeschlagen', exitCode: 2 });
    expect(all.find((item) => item.id === 'w')).toMatchObject({ status: 'attention', statusLabel: 'Prüfung nötig', durationMs: null });
    expect(activityItems(snapshot, Date.parse(t1), 'card').map((item) => item.id)).toEqual(['c1', 'c2']);
  });

  it('renders real states and links to a separate usage view without repeated unknown metrics', () => {
    const html = renderToStaticMarkup(createElement(ActivityView, { snapshot, onOpenCard: () => undefined, onOpenWorkflow: () => undefined }));
    expect(html).toContain('Fehlgeschlagen');
    expect(html).toContain('Zum Workflow');
    expect(html).toContain('Zur Karte');
    expect(html).toContain('Verlauf ansehen');
    expect(html).toContain('Nutzung');
    expect(html).not.toContain('Token: nicht erfasst');
    expect(html).not.toContain('Kosten: nicht erfasst');
    expect(html).not.toContain('private output');
  });
});
