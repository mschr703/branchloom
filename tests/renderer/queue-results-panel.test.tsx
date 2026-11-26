import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QueueResultsPanel } from '../../src/renderer/components/QueueResultsPanel';
import type { QueueResults } from '../../src/shared/queue-results';

describe('queue results panel', () => {
  it('shows sourced card and workflow links without claiming tests or a merge', () => {
    const results: QueueResults = { projectId: 'p', total: 1, truncated: false, latestActivation: null,
      counts: { done: 0, 'needs-attention': 1, running: 0, skipped: 0, pending: 0 },
      items: [{ cardId: 'card', cardTitle: '<Check this>', workflowId: 'flow', workflowName: 'Review route', activationId: null,
        status: 'needs-attention', updatedAt: '2026-11-26T01:00:00.000Z', lastSession: { id: 'session', state: 'failed', exitCode: 1 } }] };
    const html = renderToStaticMarkup(createElement(QueueResultsPanel, { results, error: null, onRetry: () => {}, onOpenCard: () => {}, onOpenSession: () => {} }));
    expect(html).toContain('1 brauchen Prüfung');
    expect(html).toContain('&lt;Check this&gt;');
    expect(html).toContain('href="#workflow-flow"');
    expect(html).toContain('Sitzung ansehen');
    expect(html).toContain('kein Nachweis für bestandene Tests oder einen Merge');
    expect(html).not.toContain('<Check this>');
  });

  it('keeps active and unstarted work visible in the collapsed summary', () => {
    const results: QueueResults = { projectId: 'p', total: 2, truncated: false, latestActivation: null,
      counts: { done: 0, 'needs-attention': 0, running: 1, skipped: 0, pending: 1 },
      items: [
        { cardId: 'a', cardTitle: 'Running', workflowId: 'flow-a', workflowName: 'Route A', activationId: null, status: 'running', updatedAt: '2026-11-26T01:00:00.000Z', lastSession: null },
        { cardId: 'b', cardTitle: 'Pending', workflowId: 'flow-b', workflowName: 'Route B', activationId: null, status: 'pending', updatedAt: '2026-11-26T01:00:00.000Z', lastSession: null },
      ] };
    const html = renderToStaticMarkup(createElement(QueueResultsPanel, { results, error: null, onRetry: () => {} }));
    expect(html).toContain('1 laufen');
    expect(html).toContain('1 ausstehend');
  });

  it('shows a stopped start even when it claimed no cards', () => {
    const results: QueueResults = { projectId: 'p', total: 0, truncated: false,
      counts: { done: 0, 'needs-attention': 0, running: 0, skipped: 0, pending: 0 }, items: [],
      latestActivation: { id: 'start', startedAt: '2026-11-26T01:00:00.000Z', endedAt: '2026-11-26T02:00:00.000Z',
        endState: 'paused', endReason: 'Safe pause', runUntil: '2026-11-26T03:00:00.000Z', continueBlocked: true, total: 0,
        counts: { done: 0, 'needs-attention': 0, running: 0, skipped: 0, pending: 0 } } };
    const html = renderToStaticMarkup(createElement(QueueResultsPanel, { results, error: null, onRetry: () => {} }));
    expect(html).toContain('Letzter Start');
    expect(html).toContain('0 beanspruchte Karten');
    expect(html).toContain('Safe pause');
    expect(html).toContain('Gewähltes Ende');
    expect(html).toContain('Unabhängige Karten');
    expect(html).toContain('noch keine Karte beansprucht');
  });
});
