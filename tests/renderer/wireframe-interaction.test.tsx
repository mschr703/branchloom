import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WireframeInteractionEditor } from '../../src/renderer/components/WireframeInteractionEditor';
import type { WireframeElement, WireframeInteraction } from '../../src/shared/card-wireframe';

const button: WireframeElement = { id: 'open', kind: 'button', x: 20, y: 20, width: 120, height: 40, text: 'Details', tone: 'plain' };
const panel: WireframeElement = { id: 'panel', kind: 'panel', x: 200, y: 20, width: 240, height: 260, text: 'Seitenleiste', tone: 'muted' };
const interaction: WireframeInteraction = { triggerElementId: 'open', panelElementId: 'panel', trigger: 'click', action: 'toggle-panel', durationMs: 240, enterOffsetPx: 24, closedOpacity: 0, reducedMotionDurationMs: 0, focusOnOpen: 'panel', focusOnClose: 'trigger' };

describe('wireframe interaction editor', () => {
  it('keeps the saved click mode and exposes hover and keyboard focus with their closing rules', () => {
    const render = (trigger: WireframeInteraction['trigger']) => renderToStaticMarkup(createElement(WireframeInteractionEditor, { elements: [button, panel], interactions: [{ ...interaction, trigger }], disabled: false, onChange: () => undefined }));
    expect(render('click')).toContain('<option value="click" selected="">Klick</option>');
    const hover = render('hover');
    expect(hover).toContain('<option value="hover" selected="">Zeigerkontakt</option>');
    expect(hover).toContain('Verlassen der Vorschau schließt die Fläche');
    const focus = render('focus');
    expect(focus).toContain('<option value="focus" selected="">Tastaturfokus</option>');
    expect(focus).toContain('Tab aus der Vorschau schließt ohne Fokusfalle');
  });
  it('offers only a valid button and panel pair and renders the stored timing and focus requirements', () => {
    const empty = renderToStaticMarkup(createElement(WireframeInteractionEditor, { elements: [button], interactions: [], disabled: false, onChange: () => undefined }));
    expect(empty).toContain('Für eine Interaktion brauchst du');
    expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>Klick → Fläche anlegen/);
    const html = renderToStaticMarkup(createElement(WireframeInteractionEditor, { elements: [button, panel], interactions: [interaction], disabled: false, onChange: () => undefined }));
    expect(html).toContain('Interaktion Auslöser');
    expect(html).toContain('Interaktion Zielfläche');
    expect(html).toContain('240 ms · Fläche sichtbar');
    expect(html).toContain('Beim Öffnen auf die Fläche');
    expect(html).toContain('Reduzierte Bewegung: 0 ms');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-expanded="false"');
    const controlledPanel = html.match(/aria-controls="([^"]+)"/);
    expect(controlledPanel?.[1]).toBeTruthy();
    expect(html).toContain(`id="${controlledPanel?.[1]}"`);
    expect(html).toContain('Interaktionsvorschau');
  });
  it('renders separate selectable timeline rows for multiple saved interactions', () => {
    const secondButton = { ...button, id: 'settings', text: 'Einstellungen' };
    const html = renderToStaticMarkup(createElement(WireframeInteractionEditor, { elements: [button, secondButton, panel], interactions: [interaction, { ...interaction, triggerElementId: 'settings', durationMs: 400 }], disabled: false, onChange: () => undefined }));
    expect(html).toContain('Interaktionsabläufe');
    expect(html).toContain('Details → Seitenleiste');
    expect(html).toContain('Einstellungen → Seitenleiste');
    expect(html).toContain('400 ms');
    expect(html).toContain('Weiteren Ablauf hinzufügen');
  });
});
