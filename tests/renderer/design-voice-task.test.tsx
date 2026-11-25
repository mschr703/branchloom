import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesignVoiceTask } from '../../src/renderer/components/DesignVoiceTask';
import type { DesignSelection } from '../../src/shared/design-inspection';
import type { Column } from '../../src/shared/types';

const selection: DesignSelection = { id: '00000000-0000-4000-8000-000000000001', projectId: 'project', sourceUrl: 'http://127.0.0.1:5173/page', selector: 'button#save', tag: 'button', text: 'Save', styles: {}, tokens: [], capturedAt: '2026-11-24T05:00:00Z' };
const columns: Column[] = [{ id: 'todo', projectId: 'project', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }];

describe('design voice task', () => {
  it('offers an explicit recording control and a separate, initially blocked save action', () => {
    const html = renderToStaticMarkup(createElement(DesignVoiceTask, { projectId: 'project', selection, columns, queueState: 'off', onOpenCard: () => undefined, onCreated: () => undefined, onCancel: () => undefined }));
    expect(html).toContain('Wunsch aufnehmen');
    expect(html).toContain('Text vor dem Speichern prüfen und bearbeiten');
    expect(html).toContain('Quelle: http://127.0.0.1:5173/page');
    expect(html).toContain('Karte mit Beleg speichern');
    expect(html).toMatch(/type="submit"[^>]*disabled/);
    expect(html).not.toContain('Agent starten');
  });

  it('makes a running queue visible in the request form', () => {
    const html = renderToStaticMarkup(createElement(DesignVoiceTask, { projectId: 'project', selection, columns, queueState: 'running', onOpenCard: () => undefined, onCreated: () => undefined, onCancel: () => undefined }));
    expect(html).toContain('Warteschlange läuft');
  });

  it('shows a visual preview request as editable text before card save', () => {
    const html = renderToStaticMarkup(createElement(DesignVoiceTask, { projectId: 'project', selection, columns, queueState: 'off', prefillDescription: 'Requested CSS: color: #aabbcc', onOpenCard: () => undefined, onCreated: () => undefined, onCancel: () => undefined }));
    expect(html).toContain('Requested CSS: color: #aabbcc');
    expect(html).toContain('Karte mit Beleg speichern');
  });
});
