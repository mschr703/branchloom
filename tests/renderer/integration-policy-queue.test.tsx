// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationQueuePanel } from '../../src/renderer/components/IntegrationQueuePanel';
import type { Card } from '../../src/shared/types';

const card: Card = { id: 'card', projectId: 'project', columnId: 'todo', title: 'Synthetic', description: '',
  priority: 'none', labels: [], position: 0, createdAt: '2026-11-26T00:00:00.000Z',
  updatedAt: '2026-11-26T00:00:00.000Z', archivedAt: null };
let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null; host?.remove(); host = null;
  vi.unstubAllGlobals();
});

async function mount(mode: 'manual' | 'automatic') {
  let selected = mode;
  const studio = {
    integrationQueue: vi.fn(async () => []),
    integrationEvidence: vi.fn(async () => ({ configuredScript: 'verify', test: null, review: null })),
    integrationPolicy: vi.fn(async () => ({ projectId: 'project', mode: selected, updatedAt: null })),
    divergentIntegration: vi.fn(async () => null),
    setIntegrationPolicy: vi.fn(async (input: { mode: 'manual' | 'automatic' }) => {
      selected = input.mode; return { projectId: 'project', mode: selected, updatedAt: null };
    }),
  };
  vi.stubGlobal('studio', studio);
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<IntegrationQueuePanel card={card} cards={[card]} queueState="running"
    onIntegrated={vi.fn()} onOpenDiff={vi.fn()} />));
  return studio;
}

describe('integration rights during a running queue', () => {
  it('keeps the enable control disabled and explains when it becomes available', async () => {
    const studio = await mount('manual');
    const checkbox = host?.querySelector<HTMLInputElement>('.integration-policy input[type="checkbox"]');
    expect(checkbox?.disabled).toBe(true);
    expect(host?.textContent).toContain('zuerst die Queue pausieren');
    expect(studio.setIntegrationPolicy).not.toHaveBeenCalled();
  });

  it('lets the user turn off an already enabled automatic integration rule', async () => {
    const studio = await mount('automatic');
    const checkbox = host?.querySelector<HTMLInputElement>('.integration-policy input[type="checkbox"]');
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.disabled).toBe(false);
    await act(async () => checkbox?.click());
    expect(studio.setIntegrationPolicy).toHaveBeenCalledWith({ projectId: 'project', mode: 'manual', confirm: false });
    expect(checkbox?.checked).toBe(false);
  });
});
