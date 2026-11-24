import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { discussProject } from '../../src/main/project-chat';
import type { PlannerInvocation } from '../../src/main/workflow-planner';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(withCard = true) {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-project-chat-test-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic project', path: root });
  if (withCard) store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Review preview', description: 'A first draft exists; mobile QA is still open.' });
  const agent = store.saveAgent({ name: 'Codex', kind: 'codex', command: process.execPath, args: [], model: null, enabled: true });
  store.saveWorkflowAgentSettings({ agentId: agent.id, model: 'test-model', effort: 'low' });
  return { root, store, project };
}

describe('project conversation', () => {
  it('uses bounded local evidence, cites it and leaves the board unchanged', async () => {
    const { root, store, project } = fixture();
    const before = store.snapshot(project.id).cards;
    let invocation!: PlannerInvocation;
    const result = await discussProject(store, { projectId: project.id, turns: [{ role: 'user', text: 'What is the review preview status?' }] }, async (call) => {
      invocation = call;
      const id = JSON.parse(call.stdin!.split('Sources: ')[1]!.split('\n\n')[0]!) as Array<{ id: string }>;
      writeFileSync(call.outputPath, JSON.stringify({ answer: 'The draft exists; mobile QA remains open.', citedSourceIds: [id[0]!.id], suggestionKind: 'task', suggestionTitle: 'Check mobile QA', suggestionBody: 'Verify the review preview on mobile.', suggestionSteps: ['Open the preview', 'Check narrow viewport'] }));
    });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.kind).toBe('task');
    expect(result.suggestion?.steps).toHaveLength(2);
    expect(result.index.state).toBe('git-unavailable');
    expect(invocation.cwd).not.toBe(root);
    expect(invocation.args).toContain('read-only');
    expect(invocation.args).toContain('--ignore-user-config');
    expect(invocation.stdin).toContain('Review preview');
    expect(store.snapshot(project.id).cards).toEqual(before);
    store.close();
  });

  it('does not run a model or invent status without sources', async () => {
    const { store, project } = fixture(false);
    const result = await discussProject(store, { projectId: project.id, turns: [{ role: 'user', text: 'What is finished?' }] }, async () => { throw new Error('must not run'); });
    expect(result.sources).toEqual([]);
    expect(result.answer).toContain('no indexed project sources');
    store.close();
  });

  it('rejects invented citations and hides unsupported model output', async () => {
    const { store, project } = fixture();
    const input = { projectId: project.id, turns: [{ role: 'user' as const, text: 'Review status?' }] };
    await expect(discussProject(store, input, async (call) => {
      writeFileSync(call.outputPath, JSON.stringify({ answer: 'Done.', citedSourceIds: ['task:invented'], suggestionKind: 'none', suggestionTitle: '', suggestionBody: '', suggestionSteps: [] }));
    })).rejects.toThrow('not supplied');
    const answer = await discussProject(store, input, async (call) => {
      writeFileSync(call.outputPath, JSON.stringify({ answer: 'Everything is complete.', citedSourceIds: [], suggestionKind: 'task', suggestionTitle: 'Ship', suggestionBody: 'Ship now', suggestionSteps: [] }));
    });
    expect(answer.answer).toContain('could not verify');
    expect(answer.suggestion).toBeNull();
    store.close();
  });

  it('does not hand indexed secrets to the model', async () => {
    const { store, project } = fixture(false);
    const marker = `-----BEGIN ${'PRIVATE'} KEY-----`;
    store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Private key', description: `${marker}\nsynthetic\n-----END ${'PRIVATE'} KEY-----` });
    await expect(discussProject(store, { projectId: project.id, turns: [{ role: 'user', text: 'Private key?' }] }, async () => { throw new Error('must not run'); })).rejects.toThrow();
    store.close();
  });

  it('keeps sources inside the selected project', async () => {
    const { root, store, project } = fixture(false);
    const otherPath = join(root, 'other');
    mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other project', path: otherPath });
    store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Secret roadmap', description: 'Only another project has this.' });
    const answer = await discussProject(store, { projectId: project.id, turns: [{ role: 'user', text: 'Secret roadmap?' }] }, async () => { throw new Error('must not run'); });
    expect(answer.sources).toEqual([]);
    expect(answer.answer).toContain('no indexed project sources');
    store.close();
  });

  it('requires the configured agent to be available before invoking it', async () => {
    const { store, project } = fixture();
    store.saveWorkflowAgentSettings({ agentId: null, model: null, effort: null });
    await expect(discussProject(store, { projectId: project.id, turns: [{ role: 'user', text: 'Review status?' }] }, async () => { throw new Error('must not run'); }))
      .rejects.toThrow('Choose a workflow agent');
    store.close();
  });
});
