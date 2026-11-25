import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TaskCleanupPreview } from '../../src/renderer/components/TaskRevisionPanel';
import type { TaskRevisionCleanupPreview as Preview } from '../../src/shared/task-revisions';

const base: Preview = { revisionId: 'revision', checkedAt: '2026-01-01T00:00:00.000Z',
  oldOnly: [{ term: 'PDF', source: 'title', excerpt: 'Export CSV and PDF' }], retained: ['CSV'], newOnly: [],
  source: null, matches: [] };

describe('task revision cleanup view', () => {
  it('distinguishes lexical hints from absent code evidence', () => {
    const html = renderToStaticMarkup(createElement(TaskCleanupPreview, { preview: base }));
    expect(html).toContain('Im neuen Text weiter genannt');
    expect(html).toContain('Nur im alten Text');
    expect(html).toContain('Export CSV and PDF');
    expect(html).toContain('kein Worktree gespeichert');
    expect(html).toContain('Branchloom löscht nichts');
  });

  it('names the exact changed file, line and hash while withholding any deletion action', () => {
    const html = renderToStaticMarkup(createElement(TaskCleanupPreview, { preview: { ...base,
      source: { head: 'a'.repeat(40), targetHead: 'b'.repeat(40), baseHead: 'c'.repeat(40), worktreeDirty: true,
        changedFileCount: 1, inspectedFileCount: 1, truncated: false },
      matches: [{ term: 'PDF', path: 'src/export.ts', line: 4, excerpt: "const format = 'PDF'", fileHash: 'd'.repeat(64) }],
    } }));
    expect(html).toContain('src/export.ts:4');
    expect(html).toContain('dddddddddddd');
    expect(html).toContain('nicht committierte Änderungen');
    expect(html).not.toContain('Löschen bestätigen');
  });
});
