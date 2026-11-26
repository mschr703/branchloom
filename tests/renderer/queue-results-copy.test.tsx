// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { QueueResultsPanel } from '../../src/renderer/components/QueueResultsPanel';
import { queueResultsMarkdown } from '../../src/shared/queue-results-markdown';
import type { QueueResults } from '../../src/shared/queue-results';

const emptyCounts = { done: 0, 'needs-attention': 0, running: 0, skipped: 0, pending: 0 };
const saved: QueueResults = { projectId: 'synthetic', total: 0, truncated: false, counts: emptyCounts, items: [],
  latestItems: [], latestTruncated: false,
  latestActivation: { id: 'start-1', startedAt: '2026-11-26T01:00:00.000Z', endedAt: null,
    endState: null, endReason: null, runUntil: null, continueBlocked: false, counts: emptyCounts, total: 0 } };

describe('queue result copy', () => {
  it('escapes card content and includes bounded source ids without inventing current Git evidence', () => {
    const sourceHead = 'a'.repeat(40);
    const report = { ...saved, total: 1, latestActivation: { ...saved.latestActivation!, total: 1 },
      latestItems: [{ cardId: 'card', cardTitle: '<Title>\n# forged', workflowId: 'flow', workflowName: 'Route',
        activationId: 'start-1', status: 'done' as const, updatedAt: '2026-11-26T02:00:00.000Z', lastSession: null,
        test: { id: 4, state: 'passed' as const, scriptName: 'test', sourceHead, targetHead: 'b'.repeat(40), endedAt: '2026-11-26T02:01:00.000Z' },
        integration: { id: 7, state: 'integrated' as const, sourceHead, targetBranch: 'main', integratedHead: sourceHead, approvalMode: 'manual' as const } }] };
    const markdown = queueResultsMarkdown(report, '2026-11-26T03:00:00.000Z');
    expect(markdown).toContain('Start-ID: `start-1`');
    expect(markdown).toContain('**\\<Title\\> # forged**');
    expect(markdown).toContain('Gespeicherter npm-Test #4');
    expect(markdown).toContain('Gespeicherte Integration #7');
    expect(markdown).toContain(sourceHead);
    expect(markdown).toContain('Git-Stand wurde für diese Zusammenfassung nicht erneut geprüft');
    expect(markdown).not.toContain('\n# forged');
  });

  it('reads the current report only after the user clicks Copy', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const fresh = { ...saved, latestActivation: { ...saved.latestActivation!, endState: 'paused' as const,
      endedAt: '2026-11-26T02:00:00.000Z', endReason: 'Needs input' } };
    const queueResults = vi.fn(async () => fresh);
    const writeText = vi.fn(async (_value: string) => {});
    vi.stubGlobal('studio', { queueResults });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      await act(async () => root.render(<QueueResultsPanel results={saved} error={null} onRetry={() => {}} />));
      expect(queueResults).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
      const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('Zusammenfassung kopieren'));
      if (!button) throw new Error('Missing copy button');
      await act(async () => button.click());
      expect(queueResults).toHaveBeenCalledWith('synthetic');
      expect(writeText).toHaveBeenCalledOnce();
      expect(writeText.mock.calls[0]?.[0]).toContain('Needs input');
      expect(host.textContent).toContain('Zusammenfassung kopiert');
      writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
      await act(async () => button.click());
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('konnte nicht kopiert werden');
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
  });
});
