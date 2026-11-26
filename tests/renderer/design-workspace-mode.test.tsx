// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DesignInspectionView } from '../../src/renderer/components/DesignInspectionView';

vi.mock('../../src/renderer/components/TaskWireframeEditor', () => ({
  TaskWireframeEditor: ({ focusMode, onFocusModeChange }: { focusMode: boolean; onFocusModeChange: (next: boolean) => void }) => <>
    <input aria-label="Synthetic draft" defaultValue="Unsaved layout" />
    <button type="button" className="task-wireframe-focus-toggle" onClick={() => onFocusModeChange(!focusMode)}>{focusMode ? 'Zur Design-Inspektion' : 'Arbeitsfläche vergrößern'}</button>
  </>,
}));
vi.mock('../../src/renderer/components/DesignStateRoutes', () => ({ DesignStateRoutes: () => null }));
vi.mock('../../src/renderer/components/DesignViewportCanvas', () => ({ DesignViewportCanvas: () => null }));
vi.mock('../../src/renderer/components/ComponentCatalogPanel', () => ({ ComponentCatalogPanel: () => null }));
vi.mock('../../src/renderer/components/ThemeTokensPanel', () => ({ ThemeTokensPanel: () => null }));
vi.mock('../../src/renderer/components/DesignVoiceTask', () => ({ DesignVoiceTask: () => null }));

it('keeps an unsaved draft mounted while inspecting the running app and hides native preview on return', async () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const previousResize = globalThis.ResizeObserver;
  const previousIntersection = globalThis.IntersectionObserver;
  const previousFrame = globalThis.requestAnimationFrame;
  const previousCancelFrame = globalThis.cancelAnimationFrame;
  const previousScrollIntoView = Element.prototype.scrollIntoView;
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as typeof ResizeObserver;
  globalThis.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} } as typeof IntersectionObserver;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  const setBounds = vi.fn(async () => undefined);
  const setVisible = vi.fn(async () => ({ projectId: null, sourceUrl: null, ready: false, armed: false, themePreview: null }));
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    designSelections: async () => [], onDesignSelection: () => () => undefined,
    listProjectWireframes: async () => ({ items: [], moreAvailable: false }),
    listProjectQaCaptures: async () => ({ items: [], moreAvailable: false }),
    designInspectionSetBounds: setBounds, designInspectionSetVisible: setVisible,
    designInspectionStart: async () => ({ projectId: 'synthetic-project', sourceUrl: 'http://127.0.0.1:5173/', ready: true, armed: false, themePreview: null, elementPreview: null }),
  } });
  try {
    await act(async () => { root.render(<DesignInspectionView projectId="synthetic-project" active cards={[]} columns={[]} queueState="off" onOpenCard={() => undefined} onCreated={() => undefined} />); });
    const draft = mount.querySelector<HTMLInputElement>('input[aria-label="Synthetic draft"]')!;
    const buttons = [...mount.querySelectorAll<HTMLButtonElement>('.design-workspace-modes button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Übersicht', 'Entwurf', 'Laufende App prüfen']);
    expect(mount.textContent).toContain('Noch kein Entwurf gespeichert');
    expect(mount.querySelector('.design-workspace-draft')?.hasAttribute('hidden')).toBe(true);
    expect(mount.querySelector('.design-inspection-tools')?.hasAttribute('hidden')).toBe(true);
    await act(async () => { buttons[1]!.click(); });
    expect(mount.querySelector('.design-workspace-draft')?.hasAttribute('hidden')).toBe(false);
    draft.value = 'Changed but not saved';

    await act(async () => { buttons[2]!.click(); });
    expect(mount.querySelector('.design-workspace-draft')?.hasAttribute('hidden')).toBe(true);
    expect(mount.querySelector('.design-inspection-tools')?.hasAttribute('hidden')).toBe(false);
    expect(setVisible).not.toHaveBeenCalledWith(false);

    const url = mount.querySelector<HTMLInputElement>('.design-inspection-toolbar input[type="url"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(url, 'http://127.0.0.1:5173/');
      url.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { mount.querySelector<HTMLButtonElement>('.design-inspection-toolbar button')!.click(); });
    expect(mount.querySelector<HTMLButtonElement>('.design-inspection-toolbar button')!.textContent).toBe('Öffne…');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(mount.querySelector<HTMLButtonElement>('.design-inspection-toolbar button')!.textContent).toBe('Vorschau öffnen');

    await act(async () => { buttons[1]!.click(); });
    expect(mount.querySelector('input[aria-label="Synthetic draft"]')).toBe(draft);
    expect(draft.value).toBe('Changed but not saved');
    expect(mount.querySelector('.design-inspection-tools')?.hasAttribute('hidden')).toBe(true);
    expect(setBounds).toHaveBeenLastCalledWith(null);

    const focusToggle = mount.querySelector<HTMLButtonElement>('.task-wireframe-focus-toggle')!;
    await act(async () => { focusToggle.click(); });
    expect(mount.querySelector('.design-inspection.wireframe-focus')).not.toBeNull();
    expect(mount.querySelector('.design-workspace-draft')?.hasAttribute('hidden')).toBe(false);
    await act(async () => { focusToggle.click(); });
    expect(mount.querySelector('.design-inspection.wireframe-focus')).toBeNull();
    expect(mount.querySelector('.design-workspace-draft')?.hasAttribute('hidden')).toBe(true);
    expect(mount.querySelector('.design-inspection-tools')?.hasAttribute('hidden')).toBe(false);
    const returnToDraft = [...mount.querySelectorAll<HTMLButtonElement>('.design-workspace-modes button')].find((button) => button.textContent === 'Entwurf')!;
    await act(async () => { returnToDraft.click(); });
    expect(mount.querySelector('.design-workspace-draft')?.hasAttribute('hidden')).toBe(false);
    expect(mount.querySelector('input[aria-label="Synthetic draft"]')).toBe(draft);
    draft.focus();
    expect(document.activeElement).toBe(draft);
  } finally {
    await act(async () => { root.unmount(); });
    mount.remove();
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    globalThis.ResizeObserver = previousResize;
    globalThis.IntersectionObserver = previousIntersection;
    globalThis.requestAnimationFrame = previousFrame;
    globalThis.cancelAnimationFrame = previousCancelFrame;
    Element.prototype.scrollIntoView = previousScrollIntoView;
  }
});
