import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DecisionInbox, ReviewInboxList } from '../../src/renderer/components/DecisionInbox';
import { decisionItems, filterDecisionItems } from '../../src/renderer/decision-inbox';
import type { ProjectSnapshot, Workflow } from '../../src/shared/types';

const date = '2026-01-01T10:00:00.000Z';
const approval: Workflow = {
  id: 'approval', projectId: 'project', name: 'Freigabe prüfen', cardIds: ['card'],
  steps: [{ id: 'step', columnId: 'planning', agentId: 'agent', requireApproval: true }],
  state: 'paused', pauseReason: 'approval', currentStep: 0, createdAt: date, updatedAt: date,
};
const snapshot: ProjectSnapshot = {
  project: { id: 'project', name: 'Synthetisches Projekt', path: 'C:\\synthetic', createdAt: date },
  columns: [{ id: 'planning', projectId: 'project', name: 'Planning', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [{ id: 'card', projectId: 'project', columnId: 'planning', title: 'Karte prüfen', description: '', priority: 'none', labels: [], position: 0, createdAt: date, updatedAt: date, archivedAt: null }],
  agents: [{ id: 'agent', name: 'Synthetischer Agent', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
  sessions: [], workflows: [approval], notes: [],
  queue: { projectId: 'project', state: 'paused', templateWorkflowId: approval.id, activeWorkflowId: approval.id, pauseReason: 'Workflow wartet auf Freigabe.', completedCount: 0, updatedAt: date },
};

describe('decision inbox', () => {
  it('offers a voluntary all-project scope while keeping the current project selected by default', () => {
    const html = renderToStaticMarkup(createElement(DecisionInbox, {
      snapshot, onOpenWorkflow: () => undefined, onOpenQueue: () => undefined,
      onOpenGlobalItem: () => undefined,
    }));
    expect(html).toContain('aria-label="Projektumfang"');
    expect(html).toContain('aria-pressed="true">Dieses Projekt');
    expect(html).toContain('aria-pressed="false">Alle Projekte');
    expect(html).toContain('Freigabe prüfen');
    expect(html).not.toContain('Entscheidungen aller Projekte');
  });
  it('shows only persisted paused states and excludes skipped workflows', () => {
    const items = decisionItems({
      ...snapshot,
      workflows: [
        approval,
        { ...approval, id: 'manual', name: 'Handarbeit', pauseReason: 'manual' },
        { ...approval, id: 'review', name: 'Prüfen', pauseReason: 'review' },
        { ...approval, id: 'skipped', queueSkip: { reason: 'bewusst übersprungen', at: date } },
        { ...approval, id: 'running', state: 'running' },
        { ...approval, id: 'done', state: 'done' },
        { ...approval, id: 'draft', state: 'draft' },
      ],
    });
    expect(items.map((item) => item.id)).toEqual(['queue', 'workflow:approval', 'workflow:manual', 'workflow:review']);
    expect(items.find((item) => item.id === 'workflow:approval')).toMatchObject({ title: 'Schrittfreigabe: Freigabe prüfen', category: 'approval', context: 'Schritt 1 von 1 · Planning · Synthetischer Agent · Karten: Karte prüfen', updatedAt: date });
    expect(items.find((item) => item.id === 'workflow:review')?.reason).toContain('externe Aktionen wiederholen');
    expect(items.find((item) => item.id === 'workflow:review')?.nextAction).toContain('Agentenergebnis');
    expect(items[0]).toMatchObject({ reason: 'Workflow wartet auf Freigabe.', context: 'Aktiver Ablauf: Freigabe prüfen' });
    expect(items[0].nextAction).toContain('Prüfe zuerst den aktiven Workflow');
  });

  it('filters by saved reason and searchable card context without changing decisions', () => {
    const items = decisionItems({ ...snapshot, workflows: [approval, { ...approval, id: 'review', pauseReason: 'review', name: 'Anderer Ablauf' }] });
    expect(filterDecisionItems(items, 'approval', '').map((item) => item.id)).toEqual(['workflow:approval']);
    expect(filterDecisionItems(items, 'all', 'KARTE PRÜFEN').map((item) => item.id)).toEqual(['workflow:approval', 'workflow:review']);
    expect(filterDecisionItems(items, 'manual', 'Karte')).toEqual([]);
    expect(filterDecisionItems(items, 'all', '   ')).toEqual(items);
  });

  it('reports missing saved agent honestly rather than inventing one', () => {
    const items = decisionItems({ ...snapshot, agents: [], queue: { ...snapshot.queue, state: 'off' } });
    expect(items[0].context).toContain('Agent nicht mehr vorhanden');
  });

  it('shows one page-level search and reason filter when the inbox grows', () => {
    const workflows = Array.from({ length: 5 }, (_, index) => ({ ...approval, id: `pause-${index}`, name: `Prüfung ${index}` }));
    const html = renderToStaticMarkup(createElement(DecisionInbox, { snapshot: { ...snapshot, workflows, queue: { ...snapshot.queue, state: 'off' } }, onOpenWorkflow: () => undefined, onOpenQueue: () => undefined }));
    expect(html.match(/Entscheidung suchen/g)).toHaveLength(1);
    expect(html).toContain('<option value="review">Prüfung</option>');
    expect(html).toContain('Prüfung 4');
  });

  it('has an honest empty state for an active queue and finished work', () => {
    const quiet = { ...snapshot, queue: { ...snapshot.queue, state: 'running' as const }, workflows: [{ ...approval, state: 'done' as const }] };
    expect(decisionItems(quiet)).toEqual([]);
    const html = renderToStaticMarkup(createElement(DecisionInbox, { snapshot: quiet, onOpenWorkflow: () => undefined, onOpenQueue: () => undefined }));
    expect(html).toContain('Reviews und Browser-QA werden geladen');
    expect(html).not.toContain('Freigabe prüfen');
  });

  it('renders real queue reasons as escaped text and offers navigation without executing actions', () => {
    const reason = '<script>unsafe</script>';
    const html = renderToStaticMarkup(createElement(DecisionInbox, { snapshot: { ...snapshot, queue: { ...snapshot.queue, pauseReason: reason } }, onOpenWorkflow: () => undefined, onOpenQueue: () => undefined }));
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Zur Warteschlange');
    expect(html).toContain('Zum Workflow');
    expect(html).toContain('Aktiven Workflow öffnen');
    expect(html).toContain('Nächster Schritt:');
    expect(html).toContain('Aktualisiert');
    expect(html).not.toContain('Schritt freigeben');
    expect(html).not.toContain('Queue fortsetzen');
  });

  it('renders saved review sources as escaped text with navigation and acknowledgement, without approval controls', () => {
    const html = renderToStaticMarkup(createElement(ReviewInboxList, {
      items: [
        { id: 'plan-comment', kind: 'plan', projectId: 'project', sourceId: 'plan', sourceTitle: 'Plan <script>', location: 'Planzeile 1', body: 'Prüfe <img>', createdAt: date },
        { id: 'diff-comment', kind: 'diff', projectId: 'project', sourceId: 'card', sourceTitle: 'Karte prüfen', location: 'Diff src/test.ts:7', body: 'Fehlerfall prüfen', createdAt: date },
      ], hasMore: true, busy: null, loadingMore: false,
      onOpenPlan: () => undefined, onOpenDiffComment: () => undefined, onOpenQaReport: () => undefined, onAcknowledge: () => undefined, onLoadMore: () => undefined,
    }));
    expect(html).toContain('Plan öffnen');
    expect(html).toContain('Kommentar öffnen');
    expect(html).toContain('Als geprüft markieren');
    expect(html).toContain('Ältere Einträge laden');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('Schritt freigeben');
  });

  it('shows a failed Browser-QA report as a source-linked review without an approval action', () => {
    const html = renderToStaticMarkup(createElement(ReviewInboxList, {
      items: [{ id: 'qa-report', kind: 'qa', projectId: 'project', sourceId: 'card', sourceTitle: 'Karte',
        location: 'Route: http://127.0.0.1:5173/path', body: 'Fehler gefunden: 1. Synthetic <console>', createdAt: date, qaStatus: 'failed' }],
      hasMore: false, busy: null, loadingMore: false,
      onOpenPlan: () => undefined, onOpenDiffComment: () => undefined, onOpenQaReport: () => undefined,
      onAcknowledge: () => undefined, onLoadMore: () => undefined,
    }));
    expect(html).toContain('Browser-QA · Fehler');
    expect(html).toContain('Bericht öffnen');
    expect(html).toContain('Route: http://127.0.0.1:5173/path');
    expect(html).toContain('Synthetic &lt;console&gt;');
    expect(html).not.toContain('<console>');
    expect(html).not.toContain('Schritt freigeben');
  });

  it('shows a persisted interruption with inspect and explicit review actions', () => {
    const interrupted = {
      sessionId: 'interrupted', projectId: snapshot.project.id, cardId: 'card',
      cardTitle: 'Karte prüfen', agentName: 'Synthetischer Agent', interruptedAt: date,
      worktreePath: 'C:\\synthetic\\worktree',
    };
    const source = { ...snapshot, workflows: [], queue: { ...snapshot.queue, state: 'off' as const }, interruptedSessions: [interrupted] };
    const items = decisionItems(source);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'session:interrupted', kind: 'session', category: 'review', sessionId: 'interrupted', cardId: 'card' });
    expect(items[0].reason).toContain('nicht automatisch wiederholt');
    expect(filterDecisionItems(items, 'review', 'Karte prüfen')).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(DecisionInbox, {
      snapshot: source, onOpenWorkflow: () => undefined, onOpenQueue: () => undefined,
      onOpenSession: () => undefined, onOpenCard: () => undefined, onAcknowledgeSession: () => undefined,
    }));
    expect(html).toContain('Verlauf prüfen');
    expect(html).toContain('Karte und Dateien öffnen');
    expect(html).toContain('Prüfung abgeschlossen');
    expect(html).not.toContain('Queue fortsetzen');
  });
});
