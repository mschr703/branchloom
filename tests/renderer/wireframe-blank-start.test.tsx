// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { TaskWireframeEditor, starterWireframe } from '../../src/renderer/components/TaskWireframeEditor';
import type { CardWireframe } from '../../src/shared/card-wireframe';
import type { Card } from '../../src/shared/types';

it('starts on an empty artboard and leaves a saved layout intact on reopen', async () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const card = { id: 'synthetic-blank-card', title: 'Synthetic blank start' } as Card;
  let saved: CardWireframe | null = null;
  let saveCalls = 0;
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    cardWireframe: async () => saved,
    listWireframeComponents: async () => [],
    saveCardWireframe: async () => { saveCalls++; throw new Error('Unexpected save'); },
  } });
  try {
    await act(async () => { root.render(<TaskWireframeEditor projectId="synthetic-blank-project" cards={[card]} startCardId={card.id} focusMode={false} canEnterFocus onFocusModeChange={() => undefined} />); });
    const start = mount.querySelector('.task-wireframe-start')!;
    const actions = [...start.querySelectorAll<HTMLButtonElement>('.task-wireframe-start-actions button')];
    expect(actions.map((button) => button.textContent)).toEqual(['Leere Fläche beginnen', 'Fenstergerüst vorbereiten']);
    await act(async () => { actions[0]!.click(); });
    expect(mount.querySelector('.task-wireframe-canvas')).not.toBeNull();
    expect(mount.querySelectorAll('.task-wireframe-canvas .task-wireframe-element')).toHaveLength(0);
    expect(mount.querySelector('.task-wireframe-canvas-head')?.textContent).toContain('Desktop · leer');
    expect(mount.querySelector('.task-wireframe-start')).toBeNull();
    expect(saveCalls).toBe(0);

    const template = starterWireframe(card);
    saved = { projectId: 'synthetic-saved-project', cardId: card.id, ...template, interaction: null, revision: 1, approvedRevision: null, updatedAt: '2026-11-25T12:00:00.000Z' };
    await act(async () => { root.render(<TaskWireframeEditor projectId="synthetic-saved-project" cards={[card]} startCardId={card.id} focusMode={false} canEnterFocus onFocusModeChange={() => undefined} />); });
    expect(mount.querySelector('.task-wireframe-start')).toBeNull();
    expect(mount.querySelectorAll('.task-wireframe-canvas .task-wireframe-element')).toHaveLength(template.elements.length);
    expect(mount.querySelector('.task-wireframe-canvas-head')?.textContent).not.toContain('· leer');
    expect(saveCalls).toBe(0);
  } finally {
    await act(async () => { root.unmount(); });
    mount.remove();
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
