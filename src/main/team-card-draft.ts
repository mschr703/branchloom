import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
// Yjs exports a CommonJS entry for Electron's main-process build.
const Y = require('yjs') as typeof import('yjs', { with: { 'resolution-mode': 'require' } });
import { requireTeamProjectCapability } from './team-workspace';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_UPDATE = 64 * 1024;
const MAX_STATE = 512 * 1024;
const MAX_TEXT = 100_000;

export interface TeamCardDraft {
  projectId: string;
  cardId: string;
  revision: number;
  update: string;
  updatedAt: string | null;
}

type DraftRow = { state: Buffer; revision: number; updated_at: string };
type MutationRow = { project_id: string; card_id: string; update_hash: string; revision: number };

function card(db: Database.Database, projectId: string, cardId: string, writable: boolean): void {
  if (!UUID.test(projectId) || !UUID.test(cardId)) throw new Error('Invalid team draft target.');
  const row = db.prepare('SELECT archived_at FROM cards WHERE id = ? AND project_id = ?')
    .get(cardId, projectId) as { archived_at: string | null } | undefined;
  if (!row || (writable && row.archived_at)) throw new Error('Team card draft is unavailable.');
}

function row(db: Database.Database, cardId: string): DraftRow | undefined {
  return db.prepare('SELECT state, revision, updated_at FROM team_card_drafts WHERE card_id = ?').get(cardId) as DraftRow | undefined;
}

function snapshot(projectId: string, cardId: string, current: DraftRow | undefined): TeamCardDraft {
  return { projectId, cardId, revision: current?.revision ?? 0,
    update: current?.state.toString('base64') ?? '', updatedAt: current?.updated_at ?? null };
}

export function readTeamCardDraft(db: Database.Database, input: {
  credential: string; projectId: string; cardId: string;
}): TeamCardDraft {
  requireTeamProjectCapability(db, input.credential, input.projectId, 'read');
  card(db, input.projectId, input.cardId, false);
  return snapshot(input.projectId, input.cardId, row(db, input.cardId));
}

/** Only draft text changes here. Accepting it as a card plan is a separate permissioned command. */
export function applyTeamCardDraftUpdate(db: Database.Database, input: {
  credential: string; projectId: string; cardId: string; mutationId: string; update: string;
}): TeamCardDraft & { repeated: boolean } {
  if (typeof input.mutationId !== 'string' || !UUID.test(input.mutationId) ||
    typeof input.update !== 'string' || input.update.length > Math.ceil(MAX_UPDATE * 4 / 3) + 4) {
    throw new Error('Invalid team draft update.');
  }
  const bytes = Buffer.from(input.update, 'base64');
  if (!bytes.length || bytes.length > MAX_UPDATE || bytes.toString('base64') !== input.update) {
    throw new Error('Invalid team draft update.');
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  return db.transaction(() => {
    const actor = requireTeamProjectCapability(db, input.credential, input.projectId, 'edit_draft');
    card(db, input.projectId, input.cardId, true);
    const previous = db.prepare(`SELECT project_id, card_id, update_hash, revision FROM team_card_draft_mutations
      WHERE workspace_id = ? AND mutation_id = ?`).get(actor.workspaceId, input.mutationId) as MutationRow | undefined;
    if (previous) {
      if (previous.project_id !== input.projectId || previous.card_id !== input.cardId || previous.update_hash !== hash) {
        throw new Error('Team draft mutation ID was already used for another update.');
      }
      return { ...snapshot(input.projectId, input.cardId, row(db, input.cardId)), repeated: true };
    }
    const before = row(db, input.cardId);
    const document = new Y.Doc();
    let state: Buffer;
    try {
      if (before) Y.applyUpdate(document, before.state);
      Y.applyUpdate(document, bytes);
      if (document.getText('body').length > MAX_TEXT) throw new Error('Team draft text is too long.');
      state = Buffer.from(Y.encodeStateAsUpdate(document));
    } catch (error) {
      if (error instanceof Error && error.message === 'Team draft text is too long.') throw error;
      throw new Error('Invalid team draft update.');
    } finally { document.destroy(); }
    if (state.length > MAX_STATE) throw new Error('Team draft state is too large.');
    const changed = !before || !before.state.equals(state);
    const revision = (before?.revision ?? 0) + (changed ? 1 : 0);
    const updatedAt = changed ? new Date().toISOString() : before!.updated_at;
    if (changed) db.prepare(`INSERT INTO team_card_drafts (card_id, project_id, state, revision, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(card_id) DO UPDATE SET state = excluded.state,
      revision = excluded.revision, updated_at = excluded.updated_at`)
      .run(input.cardId, input.projectId, state, revision, updatedAt);
    db.prepare(`INSERT INTO team_card_draft_mutations
      (workspace_id, mutation_id, project_id, card_id, update_hash, revision) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(actor.workspaceId, input.mutationId, input.projectId, input.cardId, hash, revision);
    return { ...snapshot(input.projectId, input.cardId, row(db, input.cardId)), repeated: false };
  }).immediate();
}
