import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectChat } from '../../src/renderer/components/ProjectChat';
import type { ProjectSnapshot } from '../../src/shared/types';

describe('project chat surface', () => {
  it('offers an explicit ask path and a separate evidence area without claiming a saved draft', () => {
    const snapshot = { project: { id: 'p1', name: 'Synthetic', path: '/synthetic', createdAt: '' }, columns: [], cards: [], agents: [], sessions: [], workflows: [], notes: [], queue: { state: 'off' } } as ProjectSnapshot;
    const html = renderToStaticMarkup(<ProjectChat snapshot={snapshot} />);
    expect(html).toContain('Projektgespräch');
    expect(html).toContain('Deine Frage');
    expect(html).toContain('Synthetic');
    expect(html).toContain('Quellen');
    expect(html).toContain('Offene Entscheidungen');
    expect(html).not.toContain('Karte erstellt');
  });
});
