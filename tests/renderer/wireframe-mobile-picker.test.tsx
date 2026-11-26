// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { TaskWireframeEditor } from '../../src/renderer/components/TaskWireframeEditor';
import type { Card } from '../../src/shared/types';

it('offers all six element kinds in a compact keyboard-accessible add menu', async () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    cardWireframe: async () => null,
    listWireframeComponents: async () => [],
  } });
  const card = { id: 'synthetic-card', title: 'Synthetic window' } as Card;
  try {
    await act(async () => { root.render(<TaskWireframeEditor projectId="synthetic-add-menu" cards={[card]} startCardId={card.id} focusMode={false} canEnterFocus onFocusModeChange={() => undefined} />); });
    const starter = [...mount.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Fenstergerüst vorbereiten')!;
    await act(async () => { starter.click(); });
    const addMenu = mount.querySelector<HTMLDetailsElement>('.task-wireframe-add-menu')!;
    const addSummary = addMenu.querySelector<HTMLElement>('summary')!;
    const addButtons = [...addMenu.querySelectorAll<HTMLButtonElement>('.task-wireframe-menu-items button')];
    expect(addButtons.map((button) => button.textContent)).toEqual(['Fläche', 'Text', 'Knopf', 'Eingabe', 'Ellipse', 'Linie']);
    expect(addSummary.getAttribute('aria-disabled')).toBe('false');
    expect(addButtons.every((button) => !button.disabled)).toBe(true);
    const tools = mount.querySelector<HTMLElement>('.task-wireframe-toolset')!;
    const selectTool = tools.querySelector<HTMLButtonElement>('button[aria-label="Auswählen"]')!;
    const rectangleTool = tools.querySelector<HTMLButtonElement>('button[data-wireframe-draw-kind="panel"]')!;
    expect(selectTool.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { rectangleTool.click(); });
    expect(rectangleTool.getAttribute('aria-pressed')).toBe('true');
    expect(selectTool.getAttribute('aria-pressed')).toBe('false');
    await act(async () => { selectTool.click(); });
    expect(selectTool.getAttribute('aria-pressed')).toBe('true');
    expect(rectangleTool.getAttribute('aria-pressed')).toBe('false');
    for (const [index, kind] of ['panel', 'text', 'button', 'field', 'ellipse', 'line'].entries()) {
      await act(async () => { addSummary.click(); });
      expect(addMenu.open).toBe(true);
      const before = mount.querySelectorAll('.task-wireframe-canvas .task-wireframe-element').length;
      await act(async () => { addButtons[index]!.click(); });
      expect(addMenu.open).toBe(false);
      expect(document.activeElement).toBe(addSummary);
      expect(mount.querySelectorAll('.task-wireframe-canvas .task-wireframe-element')).toHaveLength(before + 1);
      expect(mount.querySelector(`.task-wireframe-canvas .kind-${kind}`)).not.toBeNull();
    }
    await act(async () => { addSummary.click(); });
    await act(async () => { addButtons[0]!.focus(); addButtons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(addMenu.open).toBe(false);
    expect(document.activeElement).toBe(addSummary);
    const moreMenu = mount.querySelector<HTMLDetailsElement>('.task-wireframe-more-menu')!;
    expect([...moreMenu.querySelectorAll<HTMLButtonElement>('button')].map((button) => button.textContent)).toEqual(['PNG exportieren', 'Mit Agent neu vorschlagen']);
    expect(moreMenu.querySelector<HTMLButtonElement>('.task-wireframe-propose')?.disabled).toBe(true);
    expect(mount.querySelector<HTMLButtonElement>('.task-wireframe-actions button.primary-button')?.disabled).toBe(true);
    expect([...mount.querySelectorAll<HTMLButtonElement>('.task-wireframe-actions button')].find((button) => button.textContent === 'Entwurf speichern')?.disabled).toBe(false);
  } finally {
    await act(async () => { root.unmount(); });
    mount.remove();
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
