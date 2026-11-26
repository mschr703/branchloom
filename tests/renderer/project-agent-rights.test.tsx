// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectAgentRights } from '../../src/renderer/components/ProjectAgentRights';
import type { StudioAPI } from '../../src/shared/types';

afterEach(() => vi.unstubAllGlobals());

describe('project Codex access settings', () => {
  it('requires a deliberate acknowledgement before persisting full access', async () => {
    const save = vi.fn(async ({ projectId, mode }: { projectId: string; mode: 'workspace' | 'full' }) => ({ projectId, mode }));
    vi.stubGlobal('studio', {
      projectCodexWorkflowAccess: async (projectId: string) => ({ projectId, mode: 'workspace' }),
      setProjectCodexWorkflowAccess: save,
    } as unknown as StudioAPI);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(<ProjectAgentRights projectId="synthetic" />); });
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
      await act(async () => { host.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]!.click(); });
      expect(host.textContent).toContain('außerhalb des Projektordners');
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
      await act(async () => { host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
      await act(async () => { host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });
      expect(save).toHaveBeenCalledWith({ projectId: 'synthetic', mode: 'full', acknowledgeFullAccess: true });
      expect(host.textContent).toContain('Voller Codex-Zugriff ist');
    } finally {
      await act(async () => { root.unmount(); });
      if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
      else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      host.remove();
    }
  });
});
