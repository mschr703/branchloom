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
    await act(async () => { root.render(<DesignProjectOverview cards={[card]} index={{ items: [wireframe], moreAvailable: false }} selections={[]} loading={false} error="" onRetry={() => undefined} onOpenDraft={onOpenDraft} onOpenPreview={() => undefined} />); });
    expect(host.textContent).toContain('Account layout');
    expect(host.textContent).toContain('Gespeichert, nicht freigegeben');
    expect(host.textContent).toContain('Automatische Übernahme von Agentenentwürfen ist noch in Arbeit');
    await act(async () => { host.querySelector<HTMLButtonElement>('.design-overview-document')!.click(); });
    expect(onOpenDraft).toHaveBeenCalledWith('card-1');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});
