import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentBrowserBridge } from '../../src/main/agent-browser-bridge';
import { agentBrowserPolicy, checkedAgentBrowserOrigin, checkedAgentBrowserPath, setAgentBrowserPolicy } from '../../src/main/agent-browser-policy';
import { SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-browser-agent-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Inspect local UI' });
  const agent = store.saveAgent({ name: 'Synthetic CLI', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
  const run = store.createSession({ cardId: card.id, agentId: agent.id });
  return { root, store, project, run };
}

describe('local browser agent policy', () => {
  it('fails closed when the optional loopback service cannot bind', async () => {
    const { store, project, run } = fixture();
    setAgentBrowserPolicy(store, { projectId: project.id, enabled: true, origin: 'http://127.0.0.1:5173' });
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const bridge = new AgentBrowserBridge(store, async () => { throw new Error('Must not inspect'); }, (occupied.address() as AddressInfo).port);
    try {
      await expect(bridge.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(bridge.available).toBe(false);
      expect(bridge.environment(run.id)).toEqual({});
      expect(bridge.instructions(project.id)).toBe('');
    } finally {
      bridge.close();
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
      store.close();
    }
  });

  it('accepts only an exact loopback development origin and a bounded local path', () => {
    expect(checkedAgentBrowserOrigin('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
    for (const origin of ['https://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1', 'http://127.0.0.1:5173/other', 'http://127.0.0.1:5173?token=x', 'http://user:pass@127.0.0.1:5173', 'http://127.0.0.1.evil:5173']) {
      expect(() => checkedAgentBrowserOrigin(origin)).toThrow();
    }
    expect(checkedAgentBrowserPath('/preview')).toBe('/preview');
    for (const path of ['//example.com', 'https://example.com', '/preview?token=x', '/preview#section', '/bad path']) {
      expect(() => checkedAgentBrowserPath(path)).toThrow();
    }
  });

  it('persists a disabled default and a deliberate per-project grant', () => {
    const { root, store, project } = fixture();
    expect(agentBrowserPolicy(store, project.id)).toEqual({ projectId: project.id, enabled: false, origin: '' });
    expect(() => setAgentBrowserPolicy(store, { projectId: project.id, enabled: true, origin: '' })).toThrow();
    const enabled = setAgentBrowserPolicy(store, { projectId: project.id, enabled: true, origin: 'http://127.0.0.1:5173' });
    expect(enabled.enabled).toBe(true);
    store.close();
    const reopened = new StudioStore(join(root, 'studio.sqlite'));
    expect(agentBrowserPolicy(reopened, project.id)).toEqual(enabled);
    reopened.close();
  });

  it('gives only a live opted-in card run a read-only, revocable tool', async () => {
    const { store, project, run } = fixture();
    const reads: string[] = [];
    const bridge = new AgentBrowserBridge(store, async (origin, path, allowed) => {
      reads.push(`${origin}${path}`);
      expect(allowed()).toBe(true);
      return { url: `${origin}${path}`, title: 'Synthetic page', text: 'Visible text', readAt: new Date().toISOString(), truncated: false };
    });
    await bridge.start();
    try {
      expect(bridge.environment(run.id)).toEqual({});
      setAgentBrowserPolicy(store, { projectId: project.id, enabled: true, origin: 'http://127.0.0.1:5173' });
      const env = bridge.environment(run.id);
      const url = `${env.BRANCHLOOM_AGENT_BROWSER_URL}?path=%2Fpreview`;
      const headers = { Authorization: `Bearer ${env.BRANCHLOOM_AGENT_BROWSER_TOKEN}` };
      expect((await fetch(url, { headers: { ...headers, Origin: 'https://attacker.example' } })).status).toBe(403);
      expect((await fetch(url, { method: 'POST', headers })).status).toBe(405);
      expect((await fetch(url, { headers: { Authorization: 'Bearer invalid' } })).status).toBe(401);
      expect((await fetch(`${env.BRANCHLOOM_AGENT_BROWSER_URL}?path=%2F%2Fevil.example`, { headers })).status).toBe(409);
      const result = await fetch(url, { headers });
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ title: 'Synthetic page', text: 'Visible text' });
      expect(reads).toEqual(['http://127.0.0.1:5173/preview']);
      setAgentBrowserPolicy(store, { projectId: project.id, enabled: true, origin: 'http://127.0.0.1:5181' });
      expect((await fetch(url, { headers })).status).toBe(409);
      bridge.revoke(run.id);
      expect((await fetch(url, { headers })).status).toBe(401);
      const next = bridge.environment(run.id);
      store.finishSession(run.id, 'stopped', null);
      expect((await fetch(next.BRANCHLOOM_AGENT_BROWSER_URL!, { headers: { Authorization: `Bearer ${next.BRANCHLOOM_AGENT_BROWSER_TOKEN}` } })).status).toBe(409);
    } finally { bridge.close(); store.close(); }
  });

  it('lets a real synthetic CLI read through the granted bridge without exposing the token in output', async () => {
    const { root, store, project, run } = fixture();
    store.finishSession(run.id, 'exited', 0);
    const script = join(root, 'browser-agent.cjs');
    writeFileSync(script, `async function main() {
      const endpoint = process.env.BRANCHLOOM_AGENT_BROWSER_URL;
      const token = process.env.BRANCHLOOM_AGENT_BROWSER_TOKEN;
      if (!endpoint || !token) throw new Error('Missing browser capability');
      const response = await fetch(endpoint + '?path=%2Fpreview', { headers: { Authorization: 'Bearer ' + token } });
      const page = await response.json();
      if (response.status !== 200 || page.text !== 'Synthetic browser content') throw new Error('Browser read failed');
      console.log('BROWSER_READ_OK');
    }
    main().catch((error) => { console.error(error.message); process.exitCode = 1; });\n`);
    const agent = store.saveAgent({ name: 'Browser CLI fixture', kind: 'custom', command: process.execPath, args: [script], model: null, enabled: true });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Browser task' });
    setAgentBrowserPolicy(store, { projectId: project.id, enabled: true, origin: 'http://127.0.0.1:5173' });
    const bridge = new AgentBrowserBridge(store, async (origin, path) => ({ url: `${origin}${path}`, title: 'Synthetic', text: 'Synthetic browser content', readAt: new Date().toISOString(), truncated: false }));
    await bridge.start();
    let finish!: (id: string) => void;
    const finished = new Promise<string>((resolve) => { finish = resolve; });
    const runner = new SessionRunner(store, () => undefined, (session) => finish(session.id), null, bridge);
    try {
      const session = runner.start({ cardId: card.id, agentId: agent.id, mode: 'one-shot', prompt: 'Read the local preview.' });
      expect(await Promise.race([finished, new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Synthetic CLI timed out')), 10_000))])).toBe(session.id);
      expect(store.session(session.id).state).toBe('exited');
      expect(store.session(session.id).output).toContain('BROWSER_READ_OK');
      expect(store.session(session.id).output).not.toContain('BRANCHLOOM_AGENT_BROWSER_TOKEN');
    } finally { runner.dispose(); bridge.close(); store.close(); }
  }, 15_000);

  it('does not return page text when permission is revoked during a pending read', async () => {
    const { store, project, run } = fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const bridge = new AgentBrowserBridge(store, async (origin, path) => {
      entered();
      await pending;
      return { url: `${origin}${path}`, title: 'Too late', text: 'Secret page text', readAt: new Date().toISOString(), truncated: false };
    });
    setAgentBrowserPolicy(store, { projectId: project.id, enabled: true, origin: 'http://127.0.0.1:5173' });
    await bridge.start();
    try {
      const env = bridge.environment(run.id);
      const request = fetch(env.BRANCHLOOM_AGENT_BROWSER_URL!, { headers: { Authorization: `Bearer ${env.BRANCHLOOM_AGENT_BROWSER_TOKEN}` } });
      await started;
      expect((await fetch(env.BRANCHLOOM_AGENT_BROWSER_URL!, { headers: { Authorization: `Bearer ${env.BRANCHLOOM_AGENT_BROWSER_TOKEN}` } })).status).toBe(409);
      setAgentBrowserPolicy(store, { projectId: project.id, enabled: false, origin: 'http://127.0.0.1:5173' });
      bridge.revokeProject(project.id);
      release();
      const response = await request;
      expect(response.status).toBe(409);
      expect(await response.text()).not.toContain('Secret page text');
    } finally { bridge.close(); store.close(); }
  });
});
