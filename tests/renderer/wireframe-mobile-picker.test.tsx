// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { TaskWireframeEditor } from '../../src/renderer/components/TaskWireframeEditor';
import type { Card } from '../../src/shared/types';

it('adds an element from the compact picker while keeping save and approval separate', async () => {
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
    await act(async () => { root.render(<TaskWireframeEditor projectId="synthetic-mobile-picker" cards={[card]} startCardId={card.id} focusMode={false} canEnterFocus onFocusModeChange={() => undefined} />); });
    const starter = [...mount.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Fenstergerüst vorbereiten')!;
    await act(async () => { starter.click(); });
    const before = mount.querySelectorAll('.task-wireframe-canvas .task-wireframe-element').length;
    const picker = mount.querySelector<HTMLSelectElement>('select[aria-label="Element zur Zeichenfläche hinzufügen"]')!;
    expect(picker.querySelectorAll('option')).toHaveLength(7);
    await act(async () => { picker.value = 'ellipse'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(mount.querySelectorAll('.task-wireframe-canvas .task-wireframe-element')).toHaveLength(before + 1);
    expect(mount.querySelector('.task-wireframe-canvas .kind-ellipse')).not.toBeNull();
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
