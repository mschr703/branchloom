import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QueueResultsPanel } from '../../src/renderer/components/QueueResultsPanel';
import type { QueueResults } from '../../src/shared/queue-results';

describe('queue results panel', () => {
  it('shows sourced card and workflow links without claiming tests or a merge', () => {
    const results: QueueResults = { projectId: 'p', total: 1, truncated: false, latestActivation: null, latestItems: [], latestTruncated: false,
      counts: { done: 0, 'needs-attention': 1, running: 0, skipped: 0, pending: 0 },
      items: [{ cardId: 'card', cardTitle: '<Check this>', workflowId: 'flow', workflowName: 'Review route', activationId: null,
        status: 'needs-attention', updatedAt: '2026-11-26T01:00:00.000Z', lastSession: { id: 'session', state: 'failed', exitCode: 1 }, integration: null, test: null }] };
    const html = renderToStaticMarkup(createElement(QueueResultsPanel, { results, error: null, onRetry: () => {}, onOpenCard: () => {}, onOpenSession: () => {} }));
    expect(html).toContain('1 brauchen Prüfung');
    expect(html).toContain('&lt;Check this&gt;');
    expect(html).toContain('href="#workflow-flow"');
    expect(html).toContain('Sitzung ansehen');
    expect(html).toContain('kein Test- oder Merge-Nachweis');
    expect(html).not.toContain('<Check this>');
  });

  it('keeps active and unstarted work visible in the collapsed summary', () => {
    const results: QueueResults = { projectId: 'p', total: 2, truncated: false, latestActivation: null, latestItems: [], latestTruncated: false,
      counts: { done: 0, 'needs-attention': 0, running: 1, skipped: 0, pending: 1 },
      items: [
        { cardId: 'a', cardTitle: 'Running', workflowId: 'flow-a', workflowName: 'Route A', activationId: null, status: 'running', updatedAt: '2026-11-26T01:00:00.000Z', lastSession: null, integration: null, test: null },
        { cardId: 'b', cardTitle: 'Pending', workflowId: 'flow-b', workflowName: 'Route B', activationId: null, status: 'pending', updatedAt: '2026-11-26T01:00:00.000Z', lastSession: null, integration: null, test: null },
      ] };
    const html = renderToStaticMarkup(createElement(QueueResultsPanel, { results, error: null, onRetry: () => {} }));
    expect(html).toContain('1 laufen');
    expect(html).toContain('1 ausstehend');
  });

  it('shows a stopped start even when it claimed no cards', () => {
    const results: QueueResults = { projectId: 'p', total: 0, truncated: false, latestItems: [], latestTruncated: false,
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

  it('shows the latest start first and keeps older cards in a separate history disclosure', () => {
    const old = { cardId: 'old', cardTitle: 'Earlier work', workflowId: 'flow-old', workflowName: 'Earlier route', activationId: 'first',
      status: 'done' as const, updatedAt: '2026-11-26T00:00:00.000Z', lastSession: null, integration: null, test: null };
    const current = { cardId: 'current', cardTitle: 'Needs a decision', workflowId: 'flow-current', workflowName: 'Current route', activationId: 'second',
      status: 'needs-attention' as const, updatedAt: '2026-11-26T01:00:00.000Z', lastSession: null, integration: null, test: null };
    const results: QueueResults = { projectId: 'p', total: 2, truncated: false, latestTruncated: false,
      counts: { done: 1, 'needs-attention': 1, running: 0, skipped: 0, pending: 0 }, items: [current, old], latestItems: [current],
      latestActivation: { id: 'second', startedAt: '2026-11-26T01:00:00.000Z', endedAt: '2026-11-26T02:00:00.000Z', endState: 'paused',
        endReason: 'Needs input', runUntil: null, continueBlocked: false, total: 1,
        counts: { done: 0, 'needs-attention': 1, running: 0, skipped: 0, pending: 0 } } };
    const html = renderToStaticMarkup(createElement(QueueResultsPanel, { results, error: null, onRetry: () => {} }));
    expect(html).toContain('Letzter Queue-Start');
    expect(html).toContain('1 brauchen Prüfung');
    expect(html).toContain('Gesamte Queue-Historie · 2 Karten');
    expect(html.indexOf('Needs a decision')).toBeLessThan(html.indexOf('Earlier work'));
  });

  it('shows stored test and integration receipts with their source ids without claiming current Git state', () => {
    const sourceHead = 'a'.repeat(40);
    const targetHead = 'b'.repeat(40);
    const results: QueueResults = { projectId: 'p', total: 1, truncated: false, latestItems: [], latestTruncated: false,
      counts: { done: 1, 'needs-attention': 0, running: 0, skipped: 0, pending: 0 }, latestActivation: null,
      items: [{ cardId: 'card', cardTitle: 'Finished card', workflowId: 'flow', workflowName: 'Route', activationId: null,
        status: 'done', updatedAt: '2026-11-26T01:00:00.000Z', lastSession: null,
        integration: { id: 7, state: 'integrated', sourceHead, targetBranch: 'main', integratedHead: sourceHead, approvalMode: 'manual' },
        test: { id: 12, state: 'passed', scriptName: 'test', sourceHead, targetHead, endedAt: '2026-11-26T01:10:00.000Z' },
        qa: { id: 'qa-synthetic', status: 'failed', endedAt: '2026-11-26T01:11:00.000Z',
          viewportWidth: 390, viewportHeight: 844, pageCheck: 'complete' } }] };
    const html = renderToStaticMarkup(createElement(QueueResultsPanel, { results, error: null, onRetry: () => {} }));
    expect(html).toContain('Gespeicherter Test #12: npm run test · bestanden');
    expect(html).toContain('Gespeicherte Integration #7: übernommen · Ziel main · manuell');
    expect(html).toContain('Gespeicherte Browser-QA qa-synth · mit Fehlern · 390 × 844 px');
    expect(html).toContain(sourceHead);
    expect(html).toContain(targetHead);
    expect(html).toContain('Git-Stand und die vom Dev-Server ausgelieferte Codeversion werden hier nicht erneut geprüft');
  });
});
