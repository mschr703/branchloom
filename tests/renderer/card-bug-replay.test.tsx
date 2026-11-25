// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CardBugReplayPanel } from '../../src/renderer/components/CardBugReplayPanel';
import type { BugReplayResult, BugScenario } from '../../src/shared/bug-replay';

it('shows the saved expectation and requires a second explicit click before replay', async () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const scenario: BugScenario = {
    id: 'scenario-1', projectId: 'project-1', cardId: 'card-1', url: 'http://127.0.0.1:4020/',
    width: 900, height: 700, actions: [{ kind: 'click', target: { kind: 'id', value: 'menu' } }],
    diagnostics: [{ kind: 'console', category: 'TypeError', line: 12, capturedAt: '2026-11-25T08:00:00.000Z' }],
    expectation: { target: { kind: 'test-id', value: 'filter' }, state: 'visible' },
    cardRevision: 1, environmentProfile: 'profile', createdAt: '2026-11-25T08:00:00.000Z',
  };
  const result = {
    id: 'run-1', scenarioId: scenario.id, cardId: scenario.cardId, projectId: scenario.projectId,
    status: 'failed', observed: 'Expected control is hidden.', requestedUrl: scenario.url,
    environmentRunId: 'env-1', checkedAt: '2026-11-25T08:10:00.000Z', viewportWidth: 900, viewportHeight: 700,
    gitEvidence: { scope: 'card-worktree', state: 'clean', startHead: 'a'.repeat(40), endHead: 'a'.repeat(40), dirtyAtStart: false, dirtyAtEnd: false },
  } as BugReplayResult;
  const runBugScenario = vi.fn(async () => result);
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    bugScenarios: async () => [scenario], bugScenarioRuns: async () => [], runBugScenario,
  } });
  try {
    await act(async () => { root.render(<CardBugReplayPanel cardId="card-1" archived={false} />); });
    expect(mount.textContent).toContain('Startseite (/)');
    expect(mount.textContent).toContain('data-testid „filter“ sichtbar');
    const prepare = [...mount.querySelectorAll('button')].find((button) => button.textContent === 'Prüfung vorbereiten')!;
    await act(async () => { prepare.click(); });
    expect(runBugScenario).not.toHaveBeenCalled();
    expect(mount.textContent).toContain('Testdaten schreiben');
    const execute = [...mount.querySelectorAll('button')].find((button) => button.textContent === 'Jetzt im Testsystem ausführen')!;
    await act(async () => { execute.click(); });
    expect(runBugScenario).toHaveBeenCalledExactlyOnceWith(scenario.id);
    expect(mount.textContent).toContain('Erwartung verfehlt');
    expect(mount.textContent).toContain('TypeError (Zeile 12)');
    expect(mount.textContent).toContain('Prüfbedingungen und Git-Belege');
    expect(mount.textContent).toContain('env-1');
    expect(mount.textContent).toContain('Profil-Fingerprint');
    expect(mount.textContent).toContain('Karten-Worktree');
    expect(mount.textContent).toContain('Ungespeicherte Änderungen vor / nach');
  } finally {
    await act(async () => { root.unmount(); });
    mount.remove();
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
