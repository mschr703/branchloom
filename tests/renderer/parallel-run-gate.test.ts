import { describe, expect, it } from 'vitest';
import { parallelStartWarning } from '../../src/renderer/parallel-run-gate';
import type { CardRunGate } from '../../src/shared/parallel-runs';

const gate: CardRunGate = {
  cardId: 'next', projectId: 'project', capacity: 2, runningCount: 1,
  running: [{ cardId: 'first', title: 'First', sessionId: 'session', worktreePath: null }],
  dependency: null, dependencies: [], blockers: [], canStart: true,
};

describe('parallel run start control', () => {
  it('blocks a second UI start while the first agent uses the project folder, even with Worktree selected', () => {
    expect(parallelStartWarning(gate, true)).toContain('Projektordner');
    expect(parallelStartWarning(gate, false)).toContain('Projektordner');
  });

  it('requires a Worktree for the next card when all existing runs are isolated', () => {
    const isolated = { ...gate, running: [{ ...gate.running[0]!, worktreePath: 'C:\\synthetic\\worktree' }] };
    expect(parallelStartWarning(isolated, false)).toContain('Git-Worktree');
    expect(parallelStartWarning(isolated, true)).toBeNull();
  });
});
