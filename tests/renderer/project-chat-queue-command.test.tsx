// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectChat } from '../../src/renderer/components/ProjectChat';
import type { ProjectSnapshot } from '../../src/shared/types';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('routes a work-until request to the reviewed queue instead of treating a model answer as permission', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 26, 15));
  const discussProject = vi.fn();
  vi.stubGlobal('studio', { discussProject });
  const snapshot = { project: { id: 'project', name: 'Synthetic', path: '/synthetic', createdAt: '' },
    columns: [], cards: [], agents: [], sessions: [], workflows: [], notes: [], queue: { state: 'off' } } as ProjectSnapshot;
  const mount = document.createElement('div'); document.body.append(mount);
  const root = createRoot(mount);
  const onQueueCommand = vi.fn();
  try {
    await act(async () => root.render(<ProjectChat snapshot={snapshot} onQueueCommand={onQueueCommand} />));
    const field = mount.querySelector<HTMLTextAreaElement>('#project-chat-message')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'hey arbeite bis 20 Uhr');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => mount.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onQueueCommand).toHaveBeenCalledWith('hey arbeite bis 20 Uhr');
    expect(discussProject).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); mount.remove(); }
});
