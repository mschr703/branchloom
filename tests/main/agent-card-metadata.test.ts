import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCardMetadataBridge } from '../../src/main/agent-card-metadata-bridge';
import { agentCardMetadataAudit, agentCardMetadataEnabled, setAgentCardMetadataEnabled } from '../../src/main/agent-card-metadata';
import { SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-agent-card-meta-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic project', path: root });
  const column = store.snapshot(project.id).columns[0]!;
  const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Synthetic task' });
  const other = store.createCard({ projectId: project.id, columnId: column.id, title: 'Other task' });
  const agent = store.saveAgent({ name: 'Synthetic agent', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
  return { root, file, store, project, card, other, agent };
}

function request(url: string, token: string, value: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}

describe('agent card metadata capability', () => {
  it('fails closed on a blocked loopback port and does not block the store', async () => {
    const { store, project, card, agent } = fixture();
    const session = store.createSession({ cardId: card.id, agentId: agent.id });
    setAgentCardMetadataEnabled(store, { projectId: project.id, enabled: true });
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const port = (occupied.address() as AddressInfo).port;
    const errors: string[] = [];
    const bridge = new AgentCardMetadataBridge(store, () => undefined, port, (error) => errors.push(error.message));
    try {
      await expect(bridge.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(bridge.available).toBe(false);
      expect(bridge.instructions(project.id)).toBe('');
      expect(bridge.environment(session.id)).toEqual({});
      expect(errors).toHaveLength(1);
      expect(store.card(card.id).priority).toBe('none');
    } finally {
      bridge.close();
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
      store.close();
    }
  });

  it('revokes live capabilities if the listener fails after startup', async () => {
    const { store, project, card, agent } = fixture();
    const session = store.createSession({ cardId: card.id, agentId: agent.id });
    setAgentCardMetadataEnabled(store, { projectId: project.id, enabled: true });
    const errors: string[] = [];
    const bridge = new AgentCardMetadataBridge(store, () => undefined, 0, (error) => errors.push(error.message));
    await bridge.start();
    const capability = bridge.environment(session.id);
    const listener = (bridge as unknown as { server: Server }).server;
    listener.emit('error', new Error('Synthetic listener failure'));
    expect(bridge.available).toBe(false);
    expect(bridge.environment(session.id)).toEqual({});
    expect(errors).toEqual(['Synthetic listener failure']);
    const response = await fetch(capability.BRANCHLOOM_CARD_METADATA_URL!, { headers: { Authorization: `Bearer ${capability.BRANCHLOOM_CARD_METADATA_TOKEN}` } }).catch(() => null);
    expect(response?.status).not.toBe(200);
    bridge.close(); store.close();
  });
  it('requires project opt-in and a live, card-scoped capability with fresh state', async () => {
    const { file, store, project, card, other, agent } = fixture();
    const session = store.createSession({ cardId: card.id, agentId: agent.id });
    const changed: string[] = [];
    const bridge = new AgentCardMetadataBridge(store, (sessionId) => changed.push(sessionId));
    await bridge.start();
    try {
      expect(agentCardMetadataEnabled(store, project.id)).toBe(false);
      expect(bridge.environment(session.id)).toEqual({});
      setAgentCardMetadataEnabled(store, { projectId: project.id, enabled: true });
      const env = bridge.environment(session.id);
      const url = env.BRANCHLOOM_CARD_METADATA_URL!;
      const token = env.BRANCHLOOM_CARD_METADATA_TOKEN!;
      const headers = { Authorization: `Bearer ${token}` };
      const initial = await fetch(url, { headers });
      expect(initial.status).toBe(200);
      const current = await initial.json() as { cardId: string; priority: string; labels: string[]; fingerprint: string };
      expect(current).toMatchObject({ cardId: card.id, priority: 'none', labels: [] });
      expect((await request(url, token, { requestId: randomUUID(), expectedFingerprint: current.fingerprint, cardId: other.id, priority: 'urgent', reason: 'Wrong card' })).status).toBe(409);
      expect((await request(url, token, { requestId: randomUUID(), expectedFingerprint: current.fingerprint, labels: Array.from({ length: 13 }, (_, index) => `Label ${index}`), reason: 'Too many labels' })).status).toBe(409);
      expect((await fetch(url, { headers: { ...headers, Origin: 'https://example.invalid' } })).status).toBe(403);
      expect((await fetch(url, { headers: { Authorization: 'Bearer invalid' } })).status).toBe(401);
      const requestId = randomUUID();
      const update = await request(url, token, { requestId, expectedFingerprint: current.fingerprint, priority: 'high', labels: ['Review', 'review'], reason: 'Deadline is near' });
      expect(update.status).toBe(200);
      expect(store.card(card.id)).toMatchObject({ priority: 'high', labels: ['Review'] });
      expect(store.card(other.id).priority).toBe('none');
      expect(changed).toEqual([session.id]);
      const fresh = await (await fetch(url, { headers })).json() as { fingerprint: string; projectLabels: string[] };
      expect(fresh.projectLabels).toEqual(['Review']);
      expect((await request(url, token, { requestId: randomUUID(), expectedFingerprint: current.fingerprint, priority: 'urgent', reason: 'Stale' })).status).toBe(409);
      expect((await request(url, token, { requestId, expectedFingerprint: fresh.fingerprint, priority: 'urgent', reason: 'Duplicate' })).status).toBe(409);
      expect(agentCardMetadataAudit(store, project.id)).toMatchObject([{ sessionId: session.id, cardId: card.id, agentName: agent.name, beforePriority: 'none', afterPriority: 'high', reason: 'Deadline is near' }]);
      setAgentCardMetadataEnabled(store, { projectId: project.id, enabled: false });
      expect((await request(url, token, { requestId: randomUUID(), expectedFingerprint: fresh.fingerprint, priority: 'urgent', reason: 'Denied' })).status).toBe(409);
      bridge.revokeProject(project.id);
      setAgentCardMetadataEnabled(store, { projectId: project.id, enabled: true });
      expect((await fetch(url, { headers })).status).toBe(401);
      store.finishSession(session.id, 'stopped', null);
      bridge.revoke(session.id);
      expect((await fetch(url, { headers })).status).toBe(401);
    } finally { bridge.close(); store.close(); }
    const reopened = new StudioStore(file);
    try { expect(agentCardMetadataAudit(reopened, project.id)).toHaveLength(1); expect(agentCardMetadataEnabled(reopened, project.id)).toBe(true); }
    finally { reopened.close(); }
  });

  it('serializes racing updates and only accepts one expected fingerprint', async () => {
    const { store, project, card, agent } = fixture();
    const session = store.createSession({ cardId: card.id, agentId: agent.id });
    setAgentCardMetadataEnabled(store, { projectId: project.id, enabled: true });
    const bridge = new AgentCardMetadataBridge(store, () => undefined);
    await bridge.start();
    try {
      const env = bridge.environment(session.id);
      const url = env.BRANCHLOOM_CARD_METADATA_URL!;
      const token = env.BRANCHLOOM_CARD_METADATA_TOKEN!;
      const { fingerprint } = await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json() as { fingerprint: string };
      const results = await Promise.all([
        request(url, token, { requestId: randomUUID(), expectedFingerprint: fingerprint, priority: 'medium', reason: 'First' }),
        request(url, token, { requestId: randomUUID(), expectedFingerprint: fingerprint, priority: 'urgent', reason: 'Second' }),
      ]);
      expect(results.map((item) => item.status).sort()).toEqual([200, 409]);
      expect(agentCardMetadataAudit(store, project.id)).toHaveLength(1);
    } finally { bridge.close(); store.close(); }
  });

  it('lets a real local CLI process update only its own card through the bridge', async () => {
    const { root, store, project, card } = fixture();
    const script = join(root, 'metadata-agent.cjs');
    writeFileSync(script, `const { randomUUID } = require('node:crypto');
(async () => {
  const url = process.env.BRANCHLOOM_CARD_METADATA_URL;
  const token = process.env.BRANCHLOOM_CARD_METADATA_TOKEN;
  const headers = { Authorization: 'Bearer ' + token };
  const current = await (await fetch(url, { headers })).json();
  const result = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), expectedFingerprint: current.fingerprint,
      priority: 'urgent', labels: ['Needs review'], reason: 'Synthetic CLI checked the task' }) });
  if (result.status !== 200) throw new Error('Metadata call failed: ' + result.status);
  console.log('METADATA_TOOL_OK');
})().catch((error) => { console.error(error.message); process.exitCode = 1; });\n`);
    const agent = store.saveAgent({ name: 'Metadata CLI fixture', kind: 'custom', command: process.execPath, args: [script], model: null, enabled: true });
    setAgentCardMetadataEnabled(store, { projectId: project.id, enabled: true });
    const bridge = new AgentCardMetadataBridge(store, () => undefined);
    await bridge.start();
    let resolveFinished!: (id: string) => void;
    const finished = new Promise<string>((resolve) => { resolveFinished = resolve; });
    const runner = new SessionRunner(store, () => undefined, (session) => resolveFinished(session.id), bridge);
    try {
      const session = runner.start({ cardId: card.id, agentId: agent.id, mode: 'one-shot', prompt: 'Set metadata via the tool.' });
      expect(bridge.instructions(project.id)).toContain('BRANCHLOOM_CARD_METADATA_URL');
      expect(await Promise.race([finished, new Promise<string>((_, reject) => setTimeout(() => reject(new Error('CLI did not finish')), 10_000))])).toBe(session.id);
      expect(store.session(session.id).state).toBe('exited');
      expect(store.session(session.id).output).toContain('METADATA_TOOL_OK');
      expect(store.session(session.id).output).not.toContain('BRANCHLOOM_CARD_METADATA_TOKEN');
      expect(store.card(card.id)).toMatchObject({ priority: 'urgent', labels: ['Needs review'] });
      expect(agentCardMetadataAudit(store, project.id)[0]).toMatchObject({ sessionId: session.id, agentId: agent.id });
    } finally { runner.dispose(); bridge.close(); store.close(); }
  }, 15_000);
});
