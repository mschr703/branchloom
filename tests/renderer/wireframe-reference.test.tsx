// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { TaskWireframeEditor, starterWireframe } from '../../src/renderer/components/TaskWireframeEditor';
import type { CardWireframe } from '../../src/shared/card-wireframe';
import type { Card, ProjectQaCapture } from '../../src/shared/types';

it('shows a saved QA image only as a switchable editor reference', async () => {
  const mount = document.createElement('div'); document.body.append(mount);
  const root = createRoot(mount);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const card = { id: 'synthetic-reference-card', title: 'Synthetic reference' } as Card;
  const saved: CardWireframe = { projectId: 'synthetic-reference-project', cardId: card.id, ...starterWireframe(card), interaction: null, revision: 1, approvedRevision: null, updatedAt: '2026-11-26T10:00:00Z' };
  const capture: ProjectQaCapture = { id: 'synthetic-report', cardId: card.id, requestedUrl: 'http://127.0.0.1:5173/', endedAt: '2026-11-26T11:00:00Z', status: 'passed', viewportWidth: 1280, viewportHeight: 800 };
  const image = 'data:image/png;base64,c3ludGhldGlj';
  let saveCalls = 0;
  Object.defineProperty(window, 'studio', { configurable: true, value: { cardWireframe: async () => saved, listWireframeComponents: async () => [], saveCardWireframe: async () => { saveCalls++; throw new Error('Unexpected save'); } } });
  try {
    await act(async () => { root.render(<TaskWireframeEditor projectId="synthetic-reference-project" cards={[card]} startCardId={card.id} referenceCapture={{ capture, image }} focusMode canEnterFocus onFocusModeChange={() => undefined} />); });
    expect(mount.querySelector<HTMLImageElement>('.task-wireframe-reference-image')?.src).toBe(image);
    expect(mount.textContent).toContain('QA-Aufnahme vom');
    expect(mount.querySelectorAll('.task-wireframe-canvas .task-wireframe-element')).toHaveLength(saved.elements.length);
    const toggle = mount.querySelector<HTMLInputElement>('.task-wireframe-reference-controls input[type="checkbox"]')!;
    await act(async () => { toggle.click(); });
    expect(mount.querySelector('.task-wireframe-reference-image')).toBeNull();
    expect(mount.querySelectorAll('.task-wireframe-canvas .task-wireframe-element')).toHaveLength(saved.elements.length);
    await act(async () => { toggle.click(); });
    expect(mount.querySelector('.task-wireframe-reference-image')).not.toBeNull();
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
