import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ManualConflictChoices } from '../../src/renderer/components/ManualRevisionPanel';
import type { ManualMergePreview } from '../../src/shared/manual-revision';

const preview: ManualMergePreview = {
  revision: { id: 'revision', cardId: 'card', projectId: 'project', path: 'form.txt', baseHead: 'base',
    targetBranch: 'main', targetHead: 'head', targetHash: 'hash', capturedAt: '2026-01-01T00:00:00Z',
    appliedAt: null, appliedHash: null },
  sourceHead: 'source', targetHead: 'head', base: 'title=Old\n', manual: 'title=Maxim\n', agent: 'title=Agent\n',
  combined: '', hasConflicts: true,
  conflicts: [{ id: 'conflict', base: 'title=Old\n', manual: 'title=Maxim\n', agent: 'title=Agent\n', choice: null, chosenAt: null }],
  resolvedCombined: null, resolutionToken: 'resolution', staleReason: null, previewToken: 'preview',
};

describe('manual conflict choice view', () => {
  it('shows each version and two explicit options for an unresolved conflict', () => {
    const html = renderToStaticMarkup(createElement(ManualConflictChoices, { preview, busy: false, onChoose: () => {} }));
    expect(html).toContain('Überschneidung 1 von 1 · Entscheidung offen');
    expect(html).toContain('title=Old');
    expect(html).toContain('title=Maxim');
    expect(html).toContain('title=Agent');
    expect(html).toContain('Manuelle Fassung übernehmen');
    expect(html).toContain('Agentenfassung übernehmen');
    expect(html).not.toContain('checked=""');
  });

  it('shows the persisted choice and disables inputs when the preview is stale', () => {
    const html = renderToStaticMarkup(createElement(ManualConflictChoices, { preview: {
      ...preview, staleReason: 'Target changed', conflicts: [{ ...preview.conflicts[0]!, choice: 'agent', chosenAt: '2026-01-01T00:00:00Z' }],
    }, busy: false, onChoose: () => {} }));
    expect(html).toContain('· entschieden');
    expect(html).toContain('checked=""');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Gespeichert:');
  });
});
