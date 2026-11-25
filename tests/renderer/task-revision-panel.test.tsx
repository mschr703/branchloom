import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TaskRevisionPanel } from '../../src/renderer/components/TaskRevisionPanel';
import type { Card } from '../../src/shared/types';

const card: Card = { id: 'synthetic-card', projectId: 'synthetic-project', columnId: 'todo',
  title: 'Export CSV and PDF', description: 'Build both formats.', priority: 'none', labels: [],
  wireframeRequired: false, position: 0, createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', archivedAt: null };

describe('task revision entry point', () => {
  it('offers a compact explicit scope-and-reason draft without claiming delivery', () => {
    const html = renderToStaticMarkup(createElement(TaskRevisionPanel, { card, session: null,
      mutate: async () => null }));
    expect(html).toContain('<summary>Auftrag ändern');
    expect(html).toContain('Export CSV and PDF');
    expect(html).toContain('Warum ändert sich der Auftrag?');
    expect(html).toContain('Neue Revision bestätigen');
    expect(html).not.toContain('An diesen laufenden Agenten senden');
    expect(html).not.toContain('In neuen Startkontext aufgenommen');
  });
});
