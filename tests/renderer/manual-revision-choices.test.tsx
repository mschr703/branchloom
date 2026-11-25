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
  conflicts: [{ id: 'conflict', base: 'title=Old\n', manual: 'title=Maxim\n', agent: 'title=Agent\n', choice: null, customText: null, chosenAt: null }],
  resolvedCombined: null, resolutionToken: 'resolution', staleReason: null, previewToken: 'preview',
};

describe('manual conflict choice view', () => {
  it('shows each version and an explicit editor for an unresolved conflict', () => {
    const html = renderToStaticMarkup(createElement(ManualConflictChoices, { preview, busy: false, onChoose: () => {} }));
    expect(html).toContain('Überschneidung 1 von 1 · Entscheidung offen');
    expect(html).toContain('title=Old');
    expect(html).toContain('title=Maxim');
    expect(html).toContain('title=Agent');
    expect(html).toContain('Manuelle Fassung übernehmen');
    expect(html).toContain('Agentenfassung übernehmen');
    expect(html).toContain('Eigene Fassung schreiben');
    expect(html).not.toContain('checked=""');
  });

  it('shows a bounded text editor separately from the persisted custom choice', () => {
    const html = renderToStaticMarkup(createElement(ManualConflictChoices, { preview, busy: false,
      editingConflictId: 'conflict', editedText: 'title=Both\n', onChoose: () => {}, onEdit: () => {},
      onEditText: () => {}, onCancelEdit: () => {} }));
    expect(html).toContain('Eigene Fassung für diesen Konfliktblock');
    expect(html).toContain('title=Both');
    expect(html).toContain('maxLength="32768"');
    expect(html).toContain('Auswahl speichern');
    const saved = renderToStaticMarkup(createElement(ManualConflictChoices, { preview: {
      ...preview, conflicts: [{ ...preview.conflicts[0]!, choice: 'custom', customText: 'title=Both\n' }],
    }, busy: false, onChoose: () => {} }));
    expect(saved).toContain('Gespeicherte eigene Fassung');
    expect(saved).toContain('title=Both');
  });

  it('locks other conflict choices while a draft is open but leaves save and cancel reachable', () => {
    const twoConflicts: ManualMergePreview = { ...preview, conflicts: [
      preview.conflicts[0]!, { ...preview.conflicts[0]!, id: 'second' },
    ] };
    const html = renderToStaticMarkup(createElement(ManualConflictChoices, { preview: twoConflicts, busy: false,
      editingConflictId: 'conflict', editedText: 'title=Both\n', onChoose: () => {}, onEdit: () => {},
      onEditText: () => {}, onCancelEdit: () => {} }));
    const fields = html.match(/<fieldset[\s\S]*?<\/fieldset>/gu) ?? [];
    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatch(/<input[^>]*disabled=""/u);
    expect(fields[0]).not.toMatch(/<textarea[^>]*disabled=""/u);
    expect(fields[0]).toMatch(/<button[^>]*>Auswahl speichern<\/button>/u);
    expect(fields[0]).toMatch(/<button[^>]*>Abbrechen<\/button>/u);
    expect(fields[0]).not.toMatch(/<button[^>]*disabled=""[^>]*>(Auswahl speichern|Abbrechen)<\/button>/u);
    expect(fields[1]).toMatch(/^<fieldset disabled=""/u);
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
