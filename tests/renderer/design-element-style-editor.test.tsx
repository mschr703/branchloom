// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DesignElementStyleEditor } from '../../src/renderer/components/DesignElementStyleEditor';
import type { DesignInspectionState, DesignSelection } from '../../src/shared/design-inspection';

const selection: DesignSelection = {
  id: '00000000-0000-4000-8000-000000000001', projectId: 'project',
  sourceUrl: 'http://127.0.0.1:5173/page', selector: 'button#save', tag: 'button', text: 'Save',
  styles: { color: 'rgb(1, 2, 3)', borderRadius: '4px', fontSize: '16px' }, tokens: [], capturedAt: '2026-11-25T07:00:00Z',
};
const base: DesignInspectionState = { projectId: 'project', sourceUrl: selection.sourceUrl, ready: true, armed: false, themePreview: null, elementPreview: null };
const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
const priorApi = Object.getOwnPropertyDescriptor(window, 'studio');
afterEach(() => {
  if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  if (priorApi) Object.defineProperty(window, 'studio', priorApi);
  else Reflect.deleteProperty(window, 'studio');
});

it('requires an explicit preview, then prepares editable card text and restores the browser draft', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const apply = vi.fn(async () => ({ ...base, elementPreview: { selectionId: selection.id, style: { color: '#010203' } } }));
  const reset = vi.fn(async () => base);
  Object.defineProperty(window, 'studio', { configurable: true, value: { designInspectionApplyElementPreview: apply, designInspectionResetElementPreview: reset } });
  const prepare = vi.fn();
  const mount = document.createElement('div'); document.body.append(mount);
  const root = createRoot(mount);
  let state: DesignInspectionState = base;
  const render = () => root.render(<DesignElementStyleEditor projectId="project" selections={[selection]} state={state} onPreviewState={(next) => { state = next; render(); }} onPrepare={prepare} />);
  try {
    await act(async () => { render(); });
    const button = (label: string) => [...mount.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!;
    expect(button('In Vorschau testen').disabled).toBe(true);
    await act(async () => { mount.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    expect(button('In Vorschau testen').disabled).toBe(false);
    await act(async () => { button('In Vorschau testen').click(); });
    expect(apply).toHaveBeenCalledWith({ projectId: 'project', selectionId: selection.id, style: { color: '#010203' } });
    expect(button('Vorschau zurücksetzen').disabled).toBe(false);
    await act(async () => { button('Als Karte vorbereiten').click(); });
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0]?.[1]).toContain('color: #010203');
    await act(async () => { button('Vorschau zurücksetzen').click(); });
    expect(reset).toHaveBeenCalledWith('project');
    expect(button('Vorschau zurücksetzen').disabled).toBe(true);
  } finally { await act(async () => { root.unmount(); }); mount.remove(); }
});

it('keeps preview disabled for a stale route', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const mount = document.createElement('div'); document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () => { root.render(<DesignElementStyleEditor projectId="project" selections={[selection]} state={{ ...base, sourceUrl: 'http://127.0.0.1:5173/other' }} onPreviewState={() => undefined} onPrepare={() => undefined} />); });
    await act(async () => { mount.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    expect(mount.textContent).toContain('Öffne die gespeicherte Quellroute');
    expect([...mount.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === 'In Vorschau testen')?.disabled).toBe(true);
  } finally { await act(async () => { root.unmount(); }); mount.remove(); }
});
