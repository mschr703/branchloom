import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentBrowserSettings } from '../../src/renderer/components/AgentBrowserSettings';

describe('agent browser settings', () => {
  it('starts disabled and explains the separate manual preview and read-only scope', () => {
    const html = renderToStaticMarkup(createElement(AgentBrowserSettings, { projectId: 'synthetic' }));
    expect(html).toContain('aria-label="Browser-Automation für Agenten"');
    expect(html).toContain('Gesperrt');
    expect(html).toContain('http://127.0.0.1:5173');
    expect(html).toContain('Webvorschau mit deinen Tabs und Anmeldungen');
    expect(html).toContain('Kein Klick, Formular, Login oder Submit');
    expect(html).toContain('Freigabe speichern');
  });
});
