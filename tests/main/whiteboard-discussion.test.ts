import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { createWhiteboardEdge, createWhiteboardNode, updateWhiteboardNode, whiteboardSnapshot } from '../../src/main/whiteboard';
import { discussWhiteboardSelection } from '../../src/main/whiteboard-discussion';
import { savedWhiteboardCardContext } from '../../src/main/whiteboard-card-context';
import { SessionRunner } from '../../src/main/cli';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-whiteboard-discussion-test-'));
  roots.push(root);
  const projectPath = join(root, 'repo');
  mkdirSync(projectPath);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic project', path: projectPath });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Build preview', description: 'The preview is open; tests remain.' });
  const agent = store.saveAgent({ name: 'Codex', kind: 'codex', command: process.execPath, args: [], model: null, enabled: true });
  store.saveWorkflowAgentSettings({ agentId: agent.id, model: 'test-model', effort: 'low' });
  return { store, project, card };
}

describe('selected Whiteboard discussion', () => {
  it('sends selected saved sources and a draft to a read-only agent without saving the draft', async () => {
    const { store, project, card } = fixture();
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Preview', description: 'Current layout', x: 0, y: 0, reference: { kind: 'card', cardId: card.id } });
    const before = whiteboardSnapshot(store, project.id);
    const reply = await discussWhiteboardSelection(store, { projectId: project.id, nodeIds: [node.id], question: 'What remains?', draft: { kind: 'node', title: 'New view', description: 'Proposed only' } }, async (call) => {
      expect(call.args).toContain('read-only');
      expect(call.args).toContain('--ignore-user-config');
      expect(call.stdin).toContain(node.id);
      expect(call.stdin).toContain('Proposed only');
      writeFileSync(call.outputPath, JSON.stringify({ answer: 'The preview has open tests.', citedNodeIds: [node.id], citedProjectSourceIds: [], suggestedTitle: 'Test preview', suggestedDescription: 'Run UI checks.' }));
    });
    expect(reply).toMatchObject({ citedNodeIds: [node.id], suggestedTitle: 'Test preview' });
    expect(reply.sources[0]?.cardStatus).toBeTruthy();
    expect(whiteboardSnapshot(store, project.id)).toEqual(before);
    store.close();
  });

  it('rejects cross-project selections and invented citations', async () => {
    const { store, project } = fixture();
    const otherPath = mkdtempSync(join(tmpdir(), 'branchloom-whiteboard-other-test-'));
    roots.push(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    const node = createWhiteboardNode(store, { projectId: other.id, title: 'Other plan', x: 0, y: 0 });
    await expect(discussWhiteboardSelection(store, { projectId: project.id, nodeIds: [node.id], question: 'Explain' }, async () => { throw new Error('agent must not run'); })).rejects.toThrow('anderen Projekt');
    const own = createWhiteboardNode(store, { projectId: project.id, title: 'Own plan', x: 0, y: 0 });
    await expect(discussWhiteboardSelection(store, { projectId: project.id, nodeIds: [own.id], question: 'Explain' }, async (call) => {
      writeFileSync(call.outputPath, JSON.stringify({ answer: 'Done', citedNodeIds: [node.id], citedProjectSourceIds: [], suggestedTitle: '', suggestedDescription: '' }));
    })).rejects.toThrow('unbelegte');
    store.close();
  });

  it('rejects a reply when a selected saved source changes while the agent answers', async () => {
    const { store, project } = fixture();
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Draft screen', x: 0, y: 0 });
    await expect(discussWhiteboardSelection(store, { projectId: project.id, nodeIds: [node.id], question: 'Is this current?' }, async (call) => {
      updateWhiteboardNode(store, { projectId: project.id, id: node.id, description: 'Changed while answering', expectedUpdatedAt: node.updatedAt });
      writeFileSync(call.outputPath, JSON.stringify({ answer: 'Yes', citedNodeIds: [node.id], citedProjectSourceIds: [], suggestedTitle: '', suggestedDescription: '' }));
    })).rejects.toThrow('während der Antwort');
    store.close();
  });

  it('does not send secrets from selected boxes to a model', async () => {
    const { store, project } = fixture();
    const marker = `-----BEGIN ${'PRIVATE'} KEY-----`;
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Private source', description: `${marker}\nsynthetic`, x: 0, y: 0 });
    await expect(discussWhiteboardSelection(store, { projectId: project.id, nodeIds: [node.id], question: 'Explain' }, async () => {
      throw new Error('Model must not run.');
    })).rejects.toThrow();
    store.close();
  });

  it('withholds an answer and draft suggestion without any supported citation', async () => {
    const { store, project } = fixture();
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Only a box', x: 0, y: 0 });
    const reply = await discussWhiteboardSelection(store, { projectId: project.id, nodeIds: [node.id], question: 'Is it finished?' }, async (call) => {
      writeFileSync(call.outputPath, JSON.stringify({ answer: 'Everything is done.', citedNodeIds: [], citedProjectSourceIds: [], suggestedTitle: 'Release now', suggestedDescription: 'Ship.' }));
    });
    expect(reply.answer).toContain('keine verlässliche Antwort');
    expect(reply.suggestedTitle).toBe('');
    store.close();
  });

  it('uses only explicitly saved card-linked boxes for card agent context', () => {
    const { store, project, card } = fixture();
    const linked = createWhiteboardNode(store, { projectId: project.id, title: 'Saved context', description: 'A planned screen', x: 0, y: 0, reference: { kind: 'card', cardId: card.id } });
    const unrelated = createWhiteboardNode(store, { projectId: project.id, title: 'Unrelated', x: 100, y: 0 });
    const text = savedWhiteboardCardContext(store, card.id);
    expect(text).toContain(`[whiteboard:${linked.id}]`);
    expect(text).not.toContain(unrelated.id);
    expect(text).not.toContain('Unrelated');
    store.close();
  });

  it('delivers saved card-linked Whiteboard context through a real local CLI session', async () => {
    const { store, project, card } = fixture();
    const node = createWhiteboardNode(store, { projectId: project.id, title: 'Saved screen sketch', description: 'Navigation and detail panel', x: 0, y: 0, shape: 'note', reference: { kind: 'card', cardId: card.id } });
    const agent = store.saveAgent({ name: 'Synthetic prompt reader', kind: 'custom', command: process.execPath,
      args: ['-e', 'console.log(process.argv[1])', '{prompt}'], model: null, enabled: true });
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const runner = new SessionRunner(store, () => undefined, () => finish());
    try {
      const session = runner.start({ cardId: card.id, agentId: agent.id, mode: 'one-shot' });
      await Promise.race([finished, new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Local CLI did not exit.')), 10_000))]);
      expect(store.session(session.id).state).toBe('exited');
      expect(store.session(session.id).output).toContain(`[whiteboard:${node.id}]`);
      expect(store.session(session.id).output).toContain('[shape:note]');
      expect(store.session(session.id).output).toContain('Navigation and detail panel');
    } finally { runner.dispose(); store.close(); }
  }, 15_000);

  it('rejects stale node and edge drafts before write', () => {
    const { store, project } = fixture();
    const one = createWhiteboardNode(store, { projectId: project.id, title: 'One', x: 0, y: 0 });
    const two = createWhiteboardNode(store, { projectId: project.id, title: 'Two', x: 100, y: 0 });
    expect(() => updateWhiteboardNode(store, { projectId: project.id, id: one.id, x: 50, expectedUpdatedAt: 'stale' })).toThrow('seit dem Entwurf');
    expect(() => createWhiteboardEdge(store, { projectId: project.id, sourceId: one.id, targetId: two.id, expectedSourceUpdatedAt: 'stale' })).toThrow('seit dem Verbindungsentwurf');
    expect(whiteboardSnapshot(store, project.id)).toMatchObject({ edges: [] });
    store.close();
  });
});
