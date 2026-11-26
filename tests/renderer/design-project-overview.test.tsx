// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DesignProjectOverview } from '../../src/renderer/components/DesignProjectOverview';
import type { CardWireframe } from '../../src/shared/card-wireframe';
import type { Card } from '../../src/shared/types';

it('shows only persisted designs and opens the matching task editor', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const onOpenDraft = vi.fn();
  const card = { id: 'card-1', title: 'Account screen', projectId: 'project', columnId: 'column', description: '', priority: 'none', labels: [], wireframeRequired: false, position: 0, archivedAt: null, createdAt: '', updatedAt: '' } as Card;
  const wireframe: CardWireframe = { projectId: 'project', cardId: 'card-1', title: 'Account layout', elements: [{ id: 'heading', kind: 'text', x: 30, y: 30, width: 300, height: 40, text: 'Account', tone: 'plain' }], artboards: {}, interactions: [], interaction: null, revision: 2, approvedRevision: null, updatedAt: '2026-11-26T10:00:00Z' };
  try {
    await act(async () => { root.render(<DesignProjectOverview cards={[card]} index={{ items: [wireframe], moreAvailable: false }} captures={{ items: [], moreAvailable: false }} selections={[]} loading={false} error="" captureLoading={false} captureError="" onRetry={() => undefined} onRetryCaptures={() => undefined} onOpenDraft={onOpenDraft} onOpenQaCard={() => undefined} onOpenReference={() => undefined} onOpenPreview={() => undefined} />); });
    expect(host.textContent).toContain('Account layout');
    expect(host.textContent).toContain('Gespeichert, nicht freigegeben');
    expect(host.textContent).toContain('Entwürfe und Aufnahmen aus diesem Projekt.');
    await act(async () => { host.querySelector<HTMLButtonElement>('.design-overview-document')!.click(); });
    expect(onOpenDraft).toHaveBeenCalledWith('card-1');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});

it('shows a saved QA image as dated evidence and opens its source card', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const screenshot = vi.fn(async () => 'data:image/png;base64,c3ludGhldGlj');
  Object.defineProperty(window, 'studio', { configurable: true, value: { cardQaScreenshot: screenshot } });
  const onOpenQaCard = vi.fn();
  const onOpenReference = vi.fn();
  const card = { id: 'card-1', title: 'Account screen', projectId: 'project', columnId: 'column', description: '', priority: 'none', labels: [], wireframeRequired: false, position: 0, archivedAt: null, createdAt: '', updatedAt: '' } as Card;
  const capture = { id: 'report-1', cardId: card.id, requestedUrl: 'http://127.0.0.1:5173/account', endedAt: '2026-11-26T10:00:00Z', status: 'passed' as const, viewportWidth: 1280, viewportHeight: 800 };
  try {
    await act(async () => { root.render(<DesignProjectOverview cards={[card]} index={{ items: [], moreAvailable: false }} captures={{ items: [capture], moreAvailable: false }} selections={[]} loading={false} error="" captureLoading={false} captureError="" onRetry={() => undefined} onRetryCaptures={() => undefined} onOpenDraft={() => undefined} onOpenQaCard={onOpenQaCard} onOpenReference={onOpenReference} onOpenPreview={() => undefined} />); });
    expect(screenshot).toHaveBeenCalledWith({ cardId: 'card-1', reportId: 'report-1' });
    expect(host.querySelector<HTMLImageElement>('.design-overview-capture img')?.src).toContain('data:image/png;base64,');
    expect(host.textContent).toContain('/account · 1280 × 800');
    expect(host.textContent).toContain('weder ein bearbeitbarer Entwurf');
    expect(host.querySelector('.design-overview-primary.has-captures')).not.toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>('.design-overview-capture')!.click(); });
    expect(onOpenQaCard).toHaveBeenCalledWith('card-1');
    await act(async () => { host.querySelector<HTMLButtonElement>('.design-overview-reference-action')!.click(); });
    expect(onOpenReference).toHaveBeenCalledWith(capture, 'data:image/png;base64,c3ludGhldGlj');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});
