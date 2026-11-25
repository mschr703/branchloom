import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { QaGitEvidence } from '../shared/qa-git-evidence';
import type { CreatedTeamReviewInvite, CreatedTeamReviewRoom, TeamReviewComment, TeamReviewInvite, TeamReviewRevision, TeamReviewRoom } from '../shared/team-review';
import type { StudioStore } from './store';
import { qaGitPoint } from './qa-git-evidence';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_ROOMS_PER_PROJECT = 30;
const MAX_COMMENTS_PER_ROOM = 300;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

type RoomRow = {
  id: string; project_id: string; card_id: string; qa_report_id: string; scenario: string;
  image_sha256: string; image_png: Buffer; image_width: number; image_height: number;
  checkout_observation_json: string; created_at: string; closed_at: string | null;
};
type InviteRow = { id: string; room_id: string; display_name: string; role: 'reviewer'; created_at: string; revoked_at: string | null; secret_hash: string };
type CommentRow = { id: string; room_id: string; card_id: string; participant_id: string; display_name: string; body: string; x: number; y: number; image_sha256: string; created_at: string; client_mutation_id: string };

export function installTeamReview(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_review_rooms (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      qa_report_id TEXT NOT NULL,
      scenario TEXT NOT NULL,
      image_sha256 TEXT NOT NULL,
      image_png BLOB NOT NULL,
      image_width INTEGER NOT NULL,
      image_height INTEGER NOT NULL,
      checkout_observation_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_team_review_rooms_card ON team_review_rooms(card_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS team_review_invites (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES team_review_rooms(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role = 'reviewer'),
      secret_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS team_review_comments (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES team_review_rooms(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES team_review_invites(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      body TEXT NOT NULL,
      x REAL NOT NULL CHECK(x >= 0 AND x <= 1),
      y REAL NOT NULL CHECK(y >= 0 AND y <= 1),
      image_sha256 TEXT NOT NULL,
      client_mutation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(room_id, participant_id, client_mutation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_team_review_comments_room ON team_review_comments(room_id, created_at, id);
  `);
}

const asRoom = (row: RoomRow): TeamReviewRoom => ({
  id: row.id, projectId: row.project_id, cardId: row.card_id, qaReportId: row.qa_report_id,
  scenario: row.scenario, imageSha256: row.image_sha256, imageWidth: row.image_width,
  imageHeight: row.image_height, checkoutObservation: JSON.parse(row.checkout_observation_json) as QaGitEvidence | null,
  createdAt: row.created_at, closedAt: row.closed_at,
});
const asInvite = (row: InviteRow): TeamReviewInvite => ({ id: row.id, roomId: row.room_id, displayName: row.display_name, role: row.role, createdAt: row.created_at, revokedAt: row.revoked_at });
const asComment = (row: CommentRow): TeamReviewComment => ({ id: row.id, roomId: row.room_id, cardId: row.card_id, participantId: row.participant_id, displayName: row.display_name, body: row.body, x: row.x, y: row.y, imageSha256: row.image_sha256, createdAt: row.created_at });

function requiredRoom(store: StudioStore, roomId: string): RoomRow {
  const row = store.db.prepare('SELECT * FROM team_review_rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
  if (!row) throw new Error('Review room does not exist.');
  return row;
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || bytes.length > MAX_IMAGE_BYTES || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('The QA screenshot is not a supported PNG.');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('The QA screenshot dimensions are not supported.');
  return { width, height };
}

export function createTeamReviewRoom(store: StudioStore, input: { projectId: string; cardId: string; qaReportId: string; scenario: string; reviewerName: string }): CreatedTeamReviewRoom {
  if (!input || typeof input.projectId !== 'string' || typeof input.cardId !== 'string' || typeof input.qaReportId !== 'string') throw new Error('Review room input is incomplete.');
  const scenario = typeof input.scenario === 'string' ? input.scenario.trim() : '';
  const reviewerName = typeof input.reviewerName === 'string' ? input.reviewerName.trim() : '';
  if (!scenario || scenario.length > 120 || scenario.includes('\0') || !reviewerName || reviewerName.length > 80 || reviewerName.includes('\0')) throw new Error('Scenario and reviewer name are required and must be short.');
  const card = store.card(input.cardId);
  if (card.projectId !== input.projectId) throw new Error('Card belongs to another project.');
  const count = store.db.prepare('SELECT COUNT(*) AS count FROM team_review_rooms WHERE project_id = ?').get(input.projectId) as { count: number };
  if (count.count >= MAX_ROOMS_PER_PROJECT) throw new Error('Maximum number of review rooms reached for this project.');
  const report = store.db.prepare('SELECT screenshot_png, git_evidence_json FROM card_qa_reports WHERE id = ? AND card_id = ? AND project_id = ?')
    .get(input.qaReportId, input.cardId, input.projectId) as { screenshot_png: Buffer | null; git_evidence_json: string } | undefined;
  if (!report?.screenshot_png) throw new Error('A saved QA screenshot is required for a shared review.');
  const dimensions = pngDimensions(report.screenshot_png);
  const imageSha256 = createHash('sha256').update(report.screenshot_png).digest('hex');
  const secret = randomBytes(32).toString('base64url');
  const timestamp = new Date().toISOString();
  const row: RoomRow = {
    id: randomUUID(), project_id: input.projectId, card_id: input.cardId, qa_report_id: input.qaReportId,
    scenario, image_sha256: imageSha256, image_png: report.screenshot_png, image_width: dimensions.width,
    image_height: dimensions.height, checkout_observation_json: report.git_evidence_json,
    created_at: timestamp, closed_at: null,
  };
  const invite: InviteRow = { id: randomUUID(), room_id: row.id, display_name: reviewerName,
    role: 'reviewer', secret_hash: createHash('sha256').update(secret).digest('hex'), created_at: timestamp, revoked_at: null };
  store.db.transaction(() => {
    store.db.prepare('INSERT INTO team_review_rooms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.project_id, row.card_id, row.qa_report_id, row.scenario, row.image_sha256, row.image_png,
        row.image_width, row.image_height, row.checkout_observation_json, row.created_at, row.closed_at);
    store.db.prepare('INSERT INTO team_review_invites VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(invite.id, invite.room_id, invite.display_name, invite.role, invite.secret_hash, invite.created_at, invite.revoked_at);
  })();
  return { room: asRoom(row), invite: asInvite(invite), reviewerSecret: secret };
}

export function teamReviewRoom(store: StudioStore, roomId: string): TeamReviewRoom { return asRoom(requiredRoom(store, roomId)); }

/** A fresh checkout comparison, not proof of the preview server's served revision. */
export async function teamReviewRevision(store: StudioStore, roomId: string): Promise<TeamReviewRevision> {
  const room = teamReviewRoom(store, roomId);
  const current = await qaGitPoint(store, store.card(room.cardId));
  const observed = room.checkoutObservation;
  let status: TeamReviewRevision['status'] = 'unavailable';
  if (observed?.state === 'clean' && observed.endHead && current.head && current.dirty !== null) {
    if (current.scope !== observed.scope) status = 'checkout-changed';
    else if (current.head !== observed.endHead) status = 'different-head';
    else if (current.dirty) status = 'working-tree-dirty';
    else status = 'same-clean-head';
  }
  return { status, currentHead: current.head, checkedAt: new Date().toISOString() };
}

export function createTeamReviewInvite(store: StudioStore, input: { roomId: string; reviewerName: string }): CreatedTeamReviewInvite {
  const room = requiredRoom(store, input.roomId);
  if (room.closed_at) throw new Error('Review room is closed.');
  const reviewerName = typeof input.reviewerName === 'string' ? input.reviewerName.trim() : '';
  if (!reviewerName || reviewerName.length > 80 || reviewerName.includes('\0')) throw new Error('Reviewer name is required and must be short.');
  const count = store.db.prepare('SELECT COUNT(*) AS count FROM team_review_invites WHERE room_id = ?').get(room.id) as { count: number };
  if (count.count >= 20) throw new Error('Review invitation limit reached.');
  const secret = randomBytes(32).toString('base64url');
  const row: InviteRow = { id: randomUUID(), room_id: room.id, display_name: reviewerName, role: 'reviewer',
    secret_hash: createHash('sha256').update(secret).digest('hex'), created_at: new Date().toISOString(), revoked_at: null };
  store.db.prepare('INSERT INTO team_review_invites VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.room_id, row.display_name, row.role, row.secret_hash, row.created_at, row.revoked_at);
  return { invite: asInvite(row), reviewerSecret: secret };
}

export function teamReviewRooms(store: StudioStore, cardId: string): TeamReviewRoom[] {
  store.card(cardId);
  return (store.db.prepare('SELECT * FROM team_review_rooms WHERE card_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(cardId, MAX_ROOMS_PER_PROJECT) as RoomRow[]).map(asRoom);
}

export function teamReviewInvites(store: StudioStore, roomId: string): TeamReviewInvite[] {
  requiredRoom(store, roomId);
  return (store.db.prepare('SELECT * FROM team_review_invites WHERE room_id = ? ORDER BY created_at, id LIMIT 20').all(roomId) as InviteRow[]).map(asInvite);
}

export function teamReviewImage(store: StudioStore, roomId: string): Buffer {
  const row = requiredRoom(store, roomId);
  if (createHash('sha256').update(row.image_png).digest('hex') !== row.image_sha256) throw new Error('Review snapshot failed its integrity check.');
  return row.image_png;
}

export function resolveTeamReviewInvite(store: StudioStore, secret: string): { room: TeamReviewRoom; invite: TeamReviewInvite } {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('Invalid review invitation.');
  const hash = createHash('sha256').update(secret).digest('hex');
  const row = store.db.prepare('SELECT * FROM team_review_invites WHERE secret_hash = ?').get(hash) as InviteRow | undefined;
  if (!row || row.revoked_at) throw new Error('Review invitation is unavailable.');
  const room = requiredRoom(store, row.room_id);
  return { room: asRoom(room), invite: asInvite(row) };
}

export function teamReviewComments(store: StudioStore, roomId: string): TeamReviewComment[] {
  requiredRoom(store, roomId);
  return (store.db.prepare('SELECT * FROM team_review_comments WHERE room_id = ? ORDER BY created_at, id LIMIT ?').all(roomId, MAX_COMMENTS_PER_ROOM) as CommentRow[]).map(asComment);
}

export function addTeamReviewComment(store: StudioStore, input: { reviewerSecret: string; clientMutationId: string; body: string; x: number; y: number }): TeamReviewComment {
  const { room, invite } = resolveTeamReviewInvite(store, input?.reviewerSecret);
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body || body.length > 2_000 || body.includes('\0') || typeof input.clientMutationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.clientMutationId)
    || !Number.isFinite(input.x) || input.x < 0 || input.x > 1 || !Number.isFinite(input.y) || input.y < 0 || input.y > 1) throw new Error('Review comment is invalid.');
  return store.db.transaction(() => {
    const previous = store.db.prepare('SELECT * FROM team_review_comments WHERE room_id = ? AND participant_id = ? AND client_mutation_id = ?')
      .get(room.id, invite.id, input.clientMutationId) as CommentRow | undefined;
    if (previous) {
      if (previous.body !== body || previous.x !== input.x || previous.y !== input.y) throw new Error('Review request ID was already used for different content.');
      return asComment(previous);
    }
    if (room.closedAt) throw new Error('Review room is closed.');
    const count = store.db.prepare('SELECT COUNT(*) AS count FROM team_review_comments WHERE room_id = ?').get(room.id) as { count: number };
    if (count.count >= MAX_COMMENTS_PER_ROOM) throw new Error('Review room comment limit reached.');
    const row: CommentRow = { id: randomUUID(), room_id: room.id, card_id: room.cardId, participant_id: invite.id,
      display_name: invite.displayName, body, x: input.x, y: input.y, image_sha256: room.imageSha256,
      client_mutation_id: input.clientMutationId, created_at: new Date().toISOString() };
    store.db.prepare('INSERT INTO team_review_comments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.room_id, row.card_id, row.participant_id, row.display_name, row.body, row.x, row.y, row.image_sha256, row.client_mutation_id, row.created_at);
    return asComment(row);
  })();
}

export function closeTeamReviewRoom(store: StudioStore, roomId: string): TeamReviewRoom {
  requiredRoom(store, roomId);
  store.db.prepare('UPDATE team_review_rooms SET closed_at = ? WHERE id = ? AND closed_at IS NULL').run(new Date().toISOString(), roomId);
  return teamReviewRoom(store, roomId);
}

export function revokeTeamReviewInvite(store: StudioStore, input: { roomId: string; inviteId: string }): TeamReviewInvite {
  requiredRoom(store, input.roomId);
  store.db.prepare('UPDATE team_review_invites SET revoked_at = ? WHERE id = ? AND room_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), input.inviteId, input.roomId);
  const row = store.db.prepare('SELECT * FROM team_review_invites WHERE id = ? AND room_id = ?').get(input.inviteId, input.roomId) as InviteRow | undefined;
  if (!row) throw new Error('Review invitation does not exist.');
  return asInvite(row);
}
