import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QueueResultsPanel } from '../../src/renderer/components/QueueResultsPanel';
import type { QueueResults } from '../../src/shared/queue-results';

describe('queue results panel', () => {
  it('shows sourced card and workflow links without claiming tests or a merge', () => {
    const results: QueueResults = { projectId: 'p', total: 1, truncated: false,
      counts: { done: 0, 'needs-attention': 1, running: 0, skipped: 0, pending: 0 },
      items: [{ cardId: 'card', cardTitle: '<Check this>', workflowId: 'flow', workflowName: 'Review route',
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
    const results: QueueResults = { projectId: 'p', total: 2, truncated: false,
      counts: { done: 0, 'needs-attention': 0, running: 1, skipped: 0, pending: 1 },
      items: [
        { cardId: 'a', cardTitle: 'Running', workflowId: 'flow-a', workflowName: 'Route A', status: 'running', updatedAt: '2026-11-26T01:00:00.000Z', lastSession: null },
        { cardId: 'b', cardTitle: 'Pending', workflowId: 'flow-b', workflowName: 'Route B', status: 'pending', updatedAt: '2026-11-26T01:00:00.000Z', lastSession: null },
      ] };
    const html = renderToStaticMarkup(createElement(QueueResultsPanel, { results, error: null, onRetry: () => {} }));
    expect(html).toContain('1 laufen');
    expect(html).toContain('1 ausstehend');
  });
});
