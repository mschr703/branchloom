import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { agentCardMetadataEnabled, cardMetadataFingerprint, projectLabels, updateAgentCardMetadata } from './agent-card-metadata';
import { recordAgentQuestion } from './agent-questions';
import type { StudioStore } from './store';

const MAX_BODY_BYTES = 4_096;

function respond(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

function body(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { reject(new Error('Request body is too large.')); request.resume(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (bytes > MAX_BODY_BYTES) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON body.')); }
    });
    request.on('error', reject);
  });
}

/** A capability is scoped to one live PTY session and never persisted. */
export class AgentCardMetadataBridge {
  private server: Server | null = null;
  private port = 0;
  private readonly sessions = new Map<string, string>();

  constructor(
    private readonly store: StudioStore,
    private readonly changed: (sessionId: string, cardId: string, kind: 'metadata' | 'question') => void,
    private readonly listenPort = 0,
    private readonly unavailable: (error: Error) => void = () => undefined,
  ) {}

  get available(): boolean { return this.server?.listening === true && this.port > 0; }

  async start(): Promise<void> {
    if (this.server) throw new Error('Agent card metadata bridge is already running.');
    const server = createServer((request, response) => { void this.handle(request, response); });
    this.server = server;
    const failClosed = (error: Error) => {
      if (this.server !== server) return;
      this.sessions.clear();
      this.server = null;
      this.port = 0;
      try { this.unavailable(error); } catch { /* A diagnostic callback cannot revive the capability. */ }
      try { server.close(); } catch { /* A failed bind has no active listener. */ }
    };
    server.on('error', failClosed);
    server.on('close', () => {
      if (this.server === server) {
        this.sessions.clear(); this.server = null; this.port = 0;
        try { this.unavailable(new Error('Agent card metadata bridge closed.')); } catch { /* Keep the bridge closed. */ }
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        try { server.listen(this.listenPort, '127.0.0.1'); }
        catch (error) { server.off('error', onError); server.off('listening', onListening); reject(error); }
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Agent card metadata bridge has no local port.');
      if (this.server !== server) throw new Error('Agent card metadata bridge closed during startup.');
      this.port = address.port;
    } catch (error) {
      failClosed(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  close(): void {
    this.sessions.clear();
    this.server?.close();
    this.server = null;
    this.port = 0;
  }

  instructions(projectId: string): string {
    if (!this.available) return '';
    const questionTool = `\n\nBranchloom question tool (only for this running card):
When you need a user decision, POST JSON {"requestId":"new UUID","question":"one precise question"} to BRANCHLOOM_AGENT_QUESTION_URL with Authorization: Bearer <BRANCHLOOM_AGENT_QUESTION_TOKEN> and Content-Type: application/json. Read the token inside the child process from its environment; never print it or put it in project files. This creates a question in the local Decision Inbox, linked to this exact card and session. Wait for the answer in this session; plain terminal output alone does not create an inbox question.`;
    if (!agentCardMetadataEnabled(this.store, projectId)) return questionTool;
    return questionTool + `\n\nCard metadata tool (only for this running Branchloom card):
The user enabled agent edits to priority and labels for this project. Make an actual local HTTP tool call; mentioning metadata in your answer changes nothing. Use BRANCHLOOM_CARD_METADATA_URL and BRANCHLOOM_CARD_METADATA_TOKEN from your process environment. Never print the token or include it in a commit.
Read the token inside a child process (for example Node's process.env); never expand it into shell command arguments, logs, or project files.
GET the URL with Authorization: Bearer <token> to read the current priority, labels, project labels and fingerprint. POST JSON to the same URL with Content-Type: application/json, Authorization: Bearer <token>, requestId (new UUID), expectedFingerprint (from GET), a short reason, and priority (none|low|medium|high|urgent) and/or labels (complete list, up to 12 names). A stale response requires a new GET. The server enforces this session's card and project, validates all fields, and records an audit. It cannot move cards or edit descriptions.`;
  }

  environment(sessionId: string): Record<string, string> {
    if (!this.available) return {};
    const session = this.store.session(sessionId);
    if (session.state !== 'running') return {};
    this.revoke(sessionId);
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, sessionId);
    return {
      BRANCHLOOM_AGENT_QUESTION_URL: `http://127.0.0.1:${this.port}/v1/agent-question`,
      BRANCHLOOM_AGENT_QUESTION_TOKEN: token,
      ...(agentCardMetadataEnabled(this.store, session.projectId)
        ? { BRANCHLOOM_CARD_METADATA_URL: `http://127.0.0.1:${this.port}/v1/card-metadata`, BRANCHLOOM_CARD_METADATA_TOKEN: token } : {}),
    };
  }

  revoke(sessionId: string): void {
    for (const [token, scopedSessionId] of this.sessions) if (scopedSessionId === sessionId) this.sessions.delete(token);
  }

  revokeProject(projectId: string): void {
    for (const [token, sessionId] of this.sessions) {
      try { if (this.store.session(sessionId).projectId === projectId) this.sessions.delete(token); }
      catch { this.sessions.delete(token); }
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.available || request.headers.host !== `127.0.0.1:${this.port}` || request.headers.origin
      || !['/v1/card-metadata', '/v1/agent-question'].includes(request.url ?? '')) {
      respond(response, 403, { error: 'Forbidden.' }); return;
    }
    if (request.method !== 'GET' && request.method !== 'POST') { respond(response, 405, { error: 'Method not allowed.' }); return; }
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '');
    const sessionId = match ? this.sessions.get(match[1]!) : undefined;
    if (!sessionId) { respond(response, 401, { error: 'Invalid or expired session capability.' }); return; }
    try {
      const session = this.store.session(sessionId);
      if (session.state !== 'running') throw new Error('Agent session is no longer running.');
      const card = this.store.card(session.cardId);
      if (card.projectId !== session.projectId || card.archivedAt) throw new Error('The session card is unavailable.');
      if (request.url === '/v1/agent-question') {
        if (request.method !== 'POST') { respond(response, 405, { error: 'Method not allowed.' }); return; }
        if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) { respond(response, 415, { error: 'JSON content type required.' }); return; }
        const value = await body(request);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid question request.');
        const input = value as Record<string, unknown>;
        if (Object.keys(input).some((key) => !['requestId', 'question'].includes(key))) throw new Error('Unsupported question field.');
        const saved = recordAgentQuestion(this.store, { sessionId, requestId: input.requestId as string, question: input.question as string });
        this.changed(sessionId, card.id, 'question');
        respond(response, 200, { questionId: saved.id, cardId: card.id, sessionId, cardRevision: saved.cardRevision });
        return;
      }
      if (!agentCardMetadataEnabled(this.store, session.projectId)) throw new Error('Agent card metadata changes are unavailable.');
      if (request.method === 'GET') {
        respond(response, 200, { cardId: card.id, projectId: card.projectId, priority: card.priority,
          labels: card.labels, projectLabels: projectLabels(this.store, card.projectId), fingerprint: cardMetadataFingerprint(card) });
        return;
      }
      if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) { respond(response, 415, { error: 'JSON content type required.' }); return; }
      const value = await body(request);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid metadata request.');
      const input = value as Record<string, unknown>;
      if (Object.keys(input).some((key) => !['requestId', 'expectedFingerprint', 'priority', 'labels', 'reason'].includes(key))) {
        throw new Error('Unsupported metadata field.');
      }
      const result = updateAgentCardMetadata(this.store, {
        sessionId, requestId: input.requestId as string, expectedFingerprint: input.expectedFingerprint as string,
        priority: input.priority as import('../shared/types').CardPriority | undefined,
        labels: input.labels as string[] | undefined, reason: input.reason as string,
      });
      this.changed(sessionId, card.id, 'metadata');
      respond(response, 200, { cardId: card.id, priority: result.card.priority,
        labels: result.card.labels, fingerprint: result.fingerprint, auditId: result.audit.id });
    } catch (error) {
      respond(response, 409, { error: error instanceof Error ? error.message : 'Metadata update failed.' });
    }
  }
}
