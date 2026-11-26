import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { AgentCapability, AgentCapabilityEvidence, AgentPreset, BulkCardAction, Card, CardAttachment, CardPriority, Column, ColumnEffort, CommandShell, CommandTerminal, InterruptedSessionReview, MemoryNote, Project, ProjectOrganization, ProjectQueue, ProjectSnapshot, ProjectSort, QueueState, Session, SessionSearchHit, SessionState, TrelloImportPreview, TrelloImportResult, Workflow, WorkflowAgentSettings, WorkflowProposal, WorkflowState, WorkflowStep } from '../shared/types';
import type { UsageSessionPage } from '../shared/usage';
import { cardLabels, cardPriority } from '../shared/card-metadata';
import { columnSettings } from '../shared/column-settings';
import { normalizedWorkflowStep, workflowStepSettings } from '../shared/workflow-step-settings';
import { validateWorkflowProposal } from './workflow-proposal';
import { parseTrelloBoard } from './trello-import';
import { installSessionSearch, searchSessionTranscripts } from './session-search';
import { installProjectMemoryIndex } from './project-memory-index';
import { installSessionRecovery } from './session-recovery';
import { cardRunGate, installActiveCardIndex, installParallelRuns } from './parallel-runs';
import { installApiContracts } from './api-contract';
import { installRequirementConflicts } from './requirement-conflicts';
import { installTaskRevisions } from './task-revisions';
import { installCardComponentChoices } from './card-component-choice';
import { installIntegrationQueue } from './integration-queue';
import { installManualRevisions } from './manual-revision';
import { installIntegrationEvidence } from './integration-evidence';
import { installProjectRunPause, projectRunPause } from './project-pause';
import { clearAgentCapabilityEvidence, installAgentCapabilities, listAgentCapabilityEvidence, recordAgentCapability } from './agent-capabilities';
import { installSessionEvidence } from './session-evidence';
import { parseProjectPackage, type ProjectPackage } from './project-package';
import { installAgentHandoffs } from './agent-handoff';
import { installAgentCardMetadata } from './agent-card-metadata';
import { installAgentBrowserPolicy } from './agent-browser-policy';
import { installProjectAgentRights } from './project-agent-rights';
import { installDevEnvironments } from './dev-environment';
import { installDevAccounts } from './dev-account';
import { attachmentAvailable, canOpenAttachment, checkedAttachmentPath, MAX_CARD_ATTACHMENTS } from './card-attachments';
import { installWhiteboard } from './whiteboard';
import { installReviewComments } from './diff-review';
import { installCardAcceptance } from './card-acceptance';
import { installCardSplits } from './card-split';
import { installIdeas } from './ideas';
import { installIdeaMatches } from './idea-matches';
import { installPlanReview } from './plan-review';
import { installMilestones } from './milestones';
import { installReviewRules } from './review-rules';
import { installReviewInbox } from './review-inbox';
import { installAgentQuestions } from './agent-questions';
import { installCardQa } from './card-qa';
import { installTeamReview } from './team-review';
import { installBugReplay } from './bug-replay';
import { installQaCoverage } from './qa-coverage';
import { installQaFixCards } from './qa-fix-card';
import { installCardContext } from './card-context';
import { installOutputErrors } from './output-errors';
import { installDesignInspection } from './design-inspection';
import { installDesignStateRoutes } from './design-state-routes';
import { installMemoryGitSources } from './memory-git-source';
import { installCardWireframes } from './card-wireframe';
import { installWireframeComponents } from './wireframe-components';
import { wireframeStartBlockReason } from './card-wireframe-gate';

const now = (): string => new Date().toISOString();
const asBool = (value: number): boolean => value === 1;
const json = (value: unknown): string => JSON.stringify(value);
const parseArray = <T>(value: string): T[] => JSON.parse(value) as T[];
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
function trimmed(value: string, label: string, max = 200): string {
  const result = value.trim();
  if (!result || result.length > max || /\0/.test(result)) throw new Error(`${label} must be 1-${max} characters`);
  return result;
}
function optionalText(value: string, label: string, max = 30000): string {
  if (value.length > max || /\0/.test(value)) throw new Error(`${label} exceeds ${max} characters`);
  return value;
}

interface ProjectRow { id: string; name: string; path: string; created_at: string }
interface ColumnRow { id: string; project_id: string; name: string; position: number; auto_start: number; agent_id: string | null; model: string | null; effort: ColumnEffort | null }
interface CardRow { id: string; project_id: string; column_id: string; title: string; description: string; priority: CardPriority; labels_json: string; wireframe_required: number; position: number; created_at: string; updated_at: string; archived_at: string | null }
interface AgentRow { id: string; name: string; kind: AgentPreset['kind']; command: string; args_json: string; model: string | null; enabled: number }
interface SessionRow { id: string; project_id: string; card_id: string; agent_id: string; state: SessionState; started_at: string; ended_at: string | null; exit_code: number | null; output: string; worktree_path: string | null; codex_thread_id: string | null }
interface CommandTerminalRow { id: string; project_id: string; shell: CommandShell; state: SessionState; started_at: string; ended_at: string | null; exit_code: number | null; output: string; card_id: string | null; worktree_path: string | null }
export interface CardWorktree { cardId: string; projectId: string; sourceRoot: string; path: string; branch: string; createdAt: string }
interface WorktreeRow { card_id: string; project_id: string; source_root: string; path: string; branch: string; created_at: string }
interface WorkflowRow { id: string; project_id: string; name: string; card_ids_json: string; steps_json: string; state: WorkflowState; current_step: number; created_at: string; updated_at: string }
interface QueueRow { project_id: string; state: QueueState; template_workflow_id: string | null; active_workflow_id: string | null; pause_reason: string | null; updated_at: string; continue_blocked: number; run_until: string | null }
interface QueueLaunchRetryRow { project_id: string; workflow_id: string; attempt_count: number; retry_at: string; last_error: string }
interface NoteRow { id: string; project_id: string; title: string; body: string; tags_json: string; links_json: string; created_at: string; updated_at: string }
interface AttachmentRow { id: string; card_id: string; path: string; name: string; size: number; added_at: string }

const project = (row: ProjectRow): Project => ({ id: row.id, name: row.name, path: row.path, createdAt: row.created_at });
const column = (row: ColumnRow): Column => ({ id: row.id, projectId: row.project_id, name: row.name, position: row.position, autoStart: asBool(row.auto_start), agentId: row.agent_id, model: row.model, effort: row.effort });
const card = (row: CardRow): Card => ({ id: row.id, projectId: row.project_id, columnId: row.column_id, title: row.title, description: row.description, priority: row.priority, labels: parseArray<string>(row.labels_json), wireframeRequired: asBool(row.wireframe_required), position: row.position, createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at });
const agent = (row: AgentRow): AgentPreset => ({ id: row.id, name: row.name, kind: row.kind, command: row.command, args: parseArray<string>(row.args_json), model: row.model, enabled: asBool(row.enabled) });
const session = (row: SessionRow): Session => ({ id: row.id, projectId: row.project_id, cardId: row.card_id, agentId: row.agent_id, state: row.state, startedAt: row.started_at, endedAt: row.ended_at, exitCode: row.exit_code, output: row.output, worktreePath: row.worktree_path, codexThreadId: row.codex_thread_id });
const commandTerminal = (row: CommandTerminalRow): CommandTerminal => ({ id: row.id, projectId: row.project_id, shell: row.shell, state: row.state, startedAt: row.started_at, endedAt: row.ended_at, exitCode: row.exit_code, output: row.output, cardId: row.card_id, worktreePath: row.worktree_path });
const workflow = (row: WorkflowRow): Workflow => ({ id: row.id, projectId: row.project_id, name: row.name, cardIds: parseArray<string>(row.card_ids_json), steps: parseArray<WorkflowStep>(row.steps_json).map(normalizedWorkflowStep), state: row.state, currentStep: row.current_step, createdAt: row.created_at, updatedAt: row.updated_at });
const note = (row: NoteRow): MemoryNote => ({ id: row.id, projectId: row.project_id, title: row.title, body: row.body, tags: parseArray<string>(row.tags_json), links: parseArray<string>(row.links_json), createdAt: row.created_at, updatedAt: row.updated_at });

/** The only persisted state. The database lives in Electron userData, never inside a project or Git repository. */
export class StudioStore {
  readonly db: Database.Database;
  readonly worktreeBase: string;

  constructor(file: string) {
    this.worktreeBase = join(dirname(file), 'worktrees');
    this.db = new Database(file);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    const hadUsageOrigins = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_usage_origins'").get());
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
      CREATE TABLE IF NOT EXISTS project_group_members (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, group_id TEXT NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS project_navigation (id INTEGER PRIMARY KEY CHECK (id = 1), sort TEXT NOT NULL CHECK (sort IN ('name', 'newest')));
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, command TEXT NOT NULL, args_json TEXT NOT NULL, model TEXT, enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS columns (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL, auto_start INTEGER NOT NULL DEFAULT 0, agent_id TEXT REFERENCES agents(id), model TEXT, effort TEXT);
      CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, column_id TEXT NOT NULL REFERENCES columns(id), title TEXT NOT NULL, description TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, priority TEXT NOT NULL DEFAULT 'none', labels_json TEXT NOT NULL DEFAULT '[]', wireframe_required INTEGER NOT NULL DEFAULT 0 CHECK (wireframe_required IN (0, 1)));
      CREATE TABLE IF NOT EXISTS card_attachments (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, path TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, added_at TEXT NOT NULL, UNIQUE(card_id, path));
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, agent_id TEXT NOT NULL REFERENCES agents(id), state TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER, output TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS command_terminals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, shell TEXT NOT NULL, state TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER, output TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, card_ids_json TEXT NOT NULL, steps_json TEXT NOT NULL, state TEXT NOT NULL, current_step INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_progress (workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, step_index INTEGER NOT NULL, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, session_id TEXT REFERENCES sessions(id), state TEXT NOT NULL, PRIMARY KEY (workflow_id, step_index, card_id));
      CREATE TABLE IF NOT EXISTS session_usage_origins (session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, origin TEXT NOT NULL CHECK (origin IN ('direct', 'workflow', 'queue')), workflow_id TEXT, workflow_name TEXT);
      CREATE TABLE IF NOT EXISTS workflow_start_errors (workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE, message TEXT NOT NULL, failed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_step_approvals (workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, step_index INTEGER NOT NULL, approved_at TEXT NOT NULL, PRIMARY KEY (workflow_id, step_index));
      CREATE TABLE IF NOT EXISTS workflow_step_haltpoints (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, after_step_index INTEGER NOT NULL, step_id TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('requested', 'reached', 'released', 'cancelled')), requested_at TEXT NOT NULL, reached_at TEXT, closed_at TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_active_haltpoint ON workflow_step_haltpoints(workflow_id) WHERE state IN ('requested', 'reached');
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, tags_json TEXT NOT NULL, links_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trello_imports (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_id TEXT NOT NULL, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, imported_at TEXT NOT NULL, PRIMARY KEY (project_id, source_id));
      CREATE TABLE IF NOT EXISTS card_worktrees (card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_root TEXT NOT NULL, path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_queues (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, state TEXT NOT NULL, template_workflow_id TEXT REFERENCES workflows(id), active_workflow_id TEXT REFERENCES workflows(id), pause_reason TEXT, updated_at TEXT NOT NULL, continue_blocked INTEGER NOT NULL DEFAULT 0 CHECK (continue_blocked IN (0, 1)), run_until TEXT);
      CREATE TABLE IF NOT EXISTS queue_runs (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id) ON DELETE CASCADE, PRIMARY KEY (project_id, card_id));
      CREATE TABLE IF NOT EXISTS queue_run_skips (workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE, reason TEXT NOT NULL, skipped_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS queue_launch_retries (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 1 AND 2), retry_at TEXT NOT NULL, last_error TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_columns_project ON columns(project_id, position);
      CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id, position);
      CREATE INDEX IF NOT EXISTS idx_card_attachments_card ON card_attachments(card_id, added_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_card ON sessions(card_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_usage ON sessions(project_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workflow_progress_session ON workflow_progress(session_id) WHERE session_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_command_terminals_project ON command_terminals(project_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id, state);
      CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id, updated_at DESC);
    `);
    // Older runs only receive attribution where a single persisted workflow link proves it.
    // Unlinked historical runs remain unknown instead of being called manual/direct.
    if (!hadUsageOrigins) this.db.exec(`INSERT OR IGNORE INTO session_usage_origins (session_id, origin, workflow_id, workflow_name)
      SELECT p.session_id, CASE WHEN q.workflow_id IS NULL THEN 'workflow' ELSE 'queue' END, p.workflow_id, w.name
      FROM workflow_progress p JOIN workflows w ON w.id = p.workflow_id
      JOIN sessions s ON s.id = p.session_id AND s.project_id = w.project_id
      LEFT JOIN queue_runs q ON q.workflow_id = p.workflow_id
      WHERE p.session_id IS NOT NULL
        AND (SELECT COUNT(*) FROM workflow_progress other WHERE other.session_id = p.session_id) = 1`);
    const sessionColumns = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    const terminalColumns = this.db.pragma('table_info(command_terminals)') as Array<{ name: string }>;
    if (!terminalColumns.some((item) => item.name === 'card_id')) this.db.exec('ALTER TABLE command_terminals ADD COLUMN card_id TEXT');
    if (!terminalColumns.some((item) => item.name === 'worktree_path')) this.db.exec('ALTER TABLE command_terminals ADD COLUMN worktree_path TEXT');
    if (!sessionColumns.some((item) => item.name === 'worktree_path')) this.db.exec('ALTER TABLE sessions ADD COLUMN worktree_path TEXT');
    if (!sessionColumns.some((item) => item.name === 'codex_thread_id')) this.db.exec('ALTER TABLE sessions ADD COLUMN codex_thread_id TEXT');
    if (!sessionColumns.some((item) => item.name === 'interrupted_at')) this.db.exec('ALTER TABLE sessions ADD COLUMN interrupted_at TEXT');
    if (!sessionColumns.some((item) => item.name === 'interruption_reviewed_at')) this.db.exec('ALTER TABLE sessions ADD COLUMN interruption_reviewed_at TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_interruption ON sessions(project_id, interrupted_at DESC) WHERE interrupted_at IS NOT NULL AND interruption_reviewed_at IS NULL');
    const cardColumns = this.db.pragma('table_info(cards)') as Array<{ name: string }>;
    const queueColumns = this.db.pragma('table_info(project_queues)') as Array<{ name: string }>;
    if (!queueColumns.some((item) => item.name === 'continue_blocked')) this.db.exec('ALTER TABLE project_queues ADD COLUMN continue_blocked INTEGER NOT NULL DEFAULT 0 CHECK (continue_blocked IN (0, 1))');
    if (!queueColumns.some((item) => item.name === 'run_until')) this.db.exec('ALTER TABLE project_queues ADD COLUMN run_until TEXT');
    if (!cardColumns.some((item) => item.name === 'archived_at')) this.db.exec('ALTER TABLE cards ADD COLUMN archived_at TEXT');
    if (!cardColumns.some((item) => item.name === 'priority')) this.db.exec("ALTER TABLE cards ADD COLUMN priority TEXT NOT NULL DEFAULT 'none'");
    if (!cardColumns.some((item) => item.name === 'labels_json')) this.db.exec("ALTER TABLE cards ADD COLUMN labels_json TEXT NOT NULL DEFAULT '[]'");
    if (!cardColumns.some((item) => item.name === 'wireframe_required')) this.db.exec('ALTER TABLE cards ADD COLUMN wireframe_required INTEGER NOT NULL DEFAULT 0 CHECK (wireframe_required IN (0, 1))');
    const columnColumns = this.db.pragma('table_info(columns)') as Array<{ name: string }>;
    if (!columnColumns.some((item) => item.name === 'model')) this.db.exec('ALTER TABLE columns ADD COLUMN model TEXT');
    if (!columnColumns.some((item) => item.name === 'effort')) this.db.exec('ALTER TABLE columns ADD COLUMN effort TEXT');
    installWhiteboard(this.db);
    installReviewComments(this.db);
    installIdeas(this.db);
    installIdeaMatches(this.db);
    installPlanReview(this.db);
    installMilestones(this.db);
    installReviewRules(this.db);
    installCardQa(this.db);
    installTeamReview(this.db);
    installBugReplay(this.db);
    installQaCoverage(this.db);
    installCardAcceptance(this.db);
    installCardSplits(this.db);
    installQaFixCards(this.db);
    installReviewInbox(this.db);
    installCardContext(this.db);
    installOutputErrors(this.db);
    installDesignInspection(this.db);
    installDesignStateRoutes(this.db);
    installMemoryGitSources(this.db);
    installCardWireframes(this.db);
    installWireframeComponents(this.db);
    installSessionSearch(this.db);
    installProjectMemoryIndex(this.db);
    installSessionRecovery(this.db);
    installAgentCapabilities(this.db);
    installSessionEvidence(this.db);
    installAgentHandoffs(this.db);
    installAgentCardMetadata(this.db);
    installAgentBrowserPolicy(this.db);
    installProjectAgentRights(this.db);
    installDevEnvironments(this);
    installDevAccounts(this.db);
    installParallelRuns(this.db);
    installProjectRunPause(this.db);
    installApiContracts(this.db);
    installRequirementConflicts(this.db);
    installAgentQuestions(this.db);
    installTaskRevisions(this.db);
    installCardComponentChoices(this.db);
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM agents').get() as { count: number };
    if (count.count === 0) {
      for (const preset of [
        { name: 'Codex CLI', kind: 'codex', command: 'codex' },
        { name: 'Claude Code', kind: 'claude', command: 'claude' },
        { name: 'Gemini CLI', kind: 'gemini', command: 'gemini' },
        { name: 'Antigravity CLI', kind: 'antigravity', command: 'agy' },
      ] as const) this.saveAgent({ ...preset, args: [], model: null, enabled: true });
    }
    // A process crash cannot leave an old PTY marked live. Restarting an agent
    // is a deliberate action; a possibly completed external write is never replayed.
    const interruptedAt = now();
    this.db.prepare("UPDATE sessions SET state = 'failed', ended_at = ?, interrupted_at = ?, output = substr(output || ?, -200000) WHERE state = 'running'")
      .run(interruptedAt, interruptedAt, '\n[Branchloom restarted; this session was not replayed.]\n');
    this.db.prepare("UPDATE command_terminals SET state = 'failed', ended_at = ?, output = substr(output || ?, -100000) WHERE state = 'running'")
      .run(now(), '\n[Branchloom restarted; this terminal was not replayed.]\n');
    this.db.prepare("UPDATE workflows SET state = 'paused', updated_at = ? WHERE state = 'running'").run(now());
    this.db.prepare("UPDATE workflow_progress SET state = 'needs_review' WHERE state = 'running'").run();
    this.db.prepare("UPDATE project_queues SET state = 'paused', pause_reason = CASE WHEN EXISTS (SELECT 1 FROM queue_launch_retries r WHERE r.project_id = project_queues.project_id) THEN 'App neu gestartet während eines CLI-Startfehlers. Es lief kein automatischer Retry nach Neustart; prüfe den Workflow und starte ihn ausdrücklich.' ELSE 'App neu gestartet: aktiven Workflow und Agentenlauf prüfen.' END, updated_at = ? WHERE state = 'running'").run(now());
    this.db.prepare('DELETE FROM queue_launch_retries').run();
    installActiveCardIndex(this.db);
    installIntegrationQueue(this);
    installManualRevisions(this);
    installIntegrationEvidence(this);
  }

  close(): void { this.db.close(); }
  projects(): Project[] { return (this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as ProjectRow[]).map(project); }
  projectOrganization(): ProjectOrganization {
    const groups = this.db.prepare('SELECT id, name FROM project_groups ORDER BY name COLLATE NOCASE, id').all() as Array<{ id: string; name: string }>;
    const members = this.db.prepare('SELECT project_id, group_id FROM project_group_members').all() as Array<{ project_id: string; group_id: string }>;
    const setting = this.db.prepare('SELECT sort FROM project_navigation WHERE id = 1').get() as { sort: ProjectSort } | undefined;
    return { groups, assignments: Object.fromEntries(members.map(({ project_id, group_id }) => [project_id, group_id])), sort: setting?.sort ?? 'name' };
  }
  createProjectGroup(name: string): ProjectOrganization {
    const value = trimmed(name, 'Group name', 60);
    if (this.db.prepare('SELECT 1 FROM project_groups WHERE name = ? COLLATE NOCASE').get(value)) throw new Error('Project group name already exists');
    this.db.prepare('INSERT INTO project_groups (id, name) VALUES (?, ?)').run(randomUUID(), value);
    return this.projectOrganization();
  }
  renameProjectGroup(input: { groupId: string; name: string }): ProjectOrganization {
    const value = trimmed(input.name, 'Group name', 60);
    if (this.db.prepare('SELECT 1 FROM project_groups WHERE name = ? COLLATE NOCASE AND id != ?').get(value, input.groupId)) throw new Error('Project group name already exists');
    const result = this.db.prepare('UPDATE project_groups SET name = ? WHERE id = ?').run(value, input.groupId);
    if (!result.changes) throw new Error('Project group not found');
    return this.projectOrganization();
  }
  deleteProjectGroup(groupId: string): ProjectOrganization {
    const result = this.db.prepare('DELETE FROM project_groups WHERE id = ?').run(groupId);
    if (!result.changes) throw new Error('Project group not found');
    return this.projectOrganization();
  }
  assignProjectGroup(input: { projectId: string; groupId: string | null }): ProjectOrganization {
    this.project(input.projectId);
    if (input.groupId === null) this.db.prepare('DELETE FROM project_group_members WHERE project_id = ?').run(input.projectId);
    else {
      const exists = this.db.prepare('SELECT 1 FROM project_groups WHERE id = ?').get(input.groupId);
      if (!exists) throw new Error('Project group not found');
      this.db.prepare('INSERT INTO project_group_members (project_id, group_id) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET group_id = excluded.group_id').run(input.projectId, input.groupId);
    }
    return this.projectOrganization();
  }
  setProjectSort(sort: ProjectSort): ProjectOrganization {
    if (sort !== 'name' && sort !== 'newest') throw new Error('Invalid project sort');
    this.db.prepare('INSERT INTO project_navigation (id, sort) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET sort = excluded.sort').run(sort);
    return this.projectOrganization();
  }
  project(id: string): Project { return project(required(this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined, 'Project not found')); }
  createProject(input: { name: string; path: string }): Project {
    const name = trimmed(input.name, 'Project name');
    if (!isAbsolute(input.path)) throw new Error('Choose an absolute project folder');
    const path = realpathSync(input.path);
    if (!statSync(path).isDirectory()) throw new Error('Project path must be a folder');
    const result: Project = { id: randomUUID(), name, path, createdAt: now() };
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(result.id, result.name, result.path, result.createdAt);
      for (const [position, columnName] of ['To Do', 'Planning', 'Executing', 'Review', 'Testing', 'Done'].entries()) {
        this.db.prepare('INSERT INTO columns (id, project_id, name, position, auto_start, agent_id) VALUES (?, ?, ?, ?, 0, NULL)').run(randomUUID(), result.id, columnName, position);
      }
    })();
    return result;
  }

  exportProjectPackage(projectId: string): ProjectPackage {
    const snapshot = this.snapshot(projectId);
    const criterionRows = this.db.prepare(`SELECT a.card_id, a.text FROM card_acceptance_criteria a
      JOIN cards c ON c.id = a.card_id WHERE c.project_id = ? ORDER BY a.position, a.created_at, a.id`).all(projectId) as Array<{ card_id: string; text: string }>;
    const criteriaByCard = new Map<string, string[]>();
    for (const row of criterionRows) {
      const list = criteriaByCard.get(row.card_id) ?? [];
      list.push(row.text);
      criteriaByCard.set(row.card_id, list);
    }
    return {
      format: 'jarvis-studio-project', version: 2, name: snapshot.project.name,
      columns: snapshot.columns.map((item) => ({ id: item.id, name: item.name, position: item.position })),
      cards: snapshot.cards.map((item) => ({ id: item.id, columnId: item.columnId, title: item.title, description: item.description, priority: item.priority, labels: item.labels, position: item.position, archived: item.archivedAt !== null, criteria: criteriaByCard.get(item.id) ?? [] })),
      notes: snapshot.notes.map((item) => ({ title: item.title, body: item.body, tags: item.tags, links: item.links })),
      workflows: snapshot.workflows.map((item) => ({ name: item.name, cardIds: item.cardIds, steps: item.steps.map((step) => ({ columnId: step.columnId, requireApproval: step.requireApproval })) })),
    };
  }

  importProjectPackage(input: { name: string; path: string; json: string }): Project {
    const data = parseProjectPackage(input.json);
    return this.db.transaction(() => {
      const created = this.createProject({ name: input.name, path: input.path });
      this.db.prepare('DELETE FROM columns WHERE project_id = ?').run(created.id);
      const columnIds = new Map<string, string>();
      const cardIds = new Map<string, string>();
      const stamp = now();
      const insertColumn = this.db.prepare('INSERT INTO columns (id, project_id, name, position, auto_start, agent_id, model, effort) VALUES (?, ?, ?, ?, 0, NULL, NULL, NULL)');
      for (const item of data.columns) {
        const id = randomUUID();
        columnIds.set(item.id, id);
        insertColumn.run(id, created.id, item.name, item.position);
      }
      const insertCard = this.db.prepare('INSERT INTO cards (id, project_id, column_id, title, description, position, created_at, updated_at, archived_at, priority, labels_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of data.cards) {
        const id = randomUUID();
        cardIds.set(item.id, id);
        insertCard.run(id, created.id, columnIds.get(item.columnId)!, item.title, item.description, item.position, stamp, stamp, item.archived ? stamp : null, item.priority, json(item.labels));
      }
      const insertCriterion = this.db.prepare('INSERT INTO card_acceptance_criteria (id, card_id, text, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const item of data.cards) for (const [position, text] of (item.criteria ?? []).entries()) {
        insertCriterion.run(randomUUID(), cardIds.get(item.id)!, text, position + 1, stamp, stamp);
      }
      for (const item of data.notes) this.saveNote({ projectId: created.id, title: item.title, body: item.body, tags: item.tags, links: item.links });
      const insertWorkflow = this.db.prepare('INSERT INTO workflows (id, project_id, name, card_ids_json, steps_json, state, current_step, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)');
      for (const item of data.workflows) {
        const steps: WorkflowStep[] = item.steps.map((step) => ({ id: randomUUID(), columnId: columnIds.get(step.columnId)!, agentId: null, requireApproval: true }));
        insertWorkflow.run(randomUUID(), created.id, item.name, json(item.cardIds.map((id) => cardIds.get(id)!)), json(steps), 'draft', stamp, stamp);
      }
      return created;
    })();
  }

  snapshot(projectId: string): ProjectSnapshot {
    const recentSessions = this.db.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 200').all(projectId) as SessionRow[];
    // Keep recovery transcripts available even when the ordinary recent-run cap is reached.
    const interruptedRows = this.db.prepare(`SELECT * FROM sessions WHERE project_id = ? AND interrupted_at IS NOT NULL
      AND interruption_reviewed_at IS NULL ORDER BY interrupted_at DESC, id DESC LIMIT 100`).all(projectId) as SessionRow[];
    const visibleSessions = [...new Map([...recentSessions, ...interruptedRows].map((row) => [row.id, row])).values()]
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
    return {
      project: this.project(projectId),
      columns: (this.db.prepare('SELECT * FROM columns WHERE project_id = ? ORDER BY position').all(projectId) as ColumnRow[]).map(column),
      cards: (this.db.prepare('SELECT * FROM cards WHERE project_id = ? ORDER BY position, created_at, id').all(projectId) as CardRow[]).map(card),
      agents: this.agents(),
      sessions: visibleSessions.map(session),
      interruptedSessions: this.interruptedSessions(projectId),
      workflows: (this.db.prepare('SELECT * FROM workflows WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as WorkflowRow[]).map((row) => this.hydrateWorkflow(row)),
      notes: (this.db.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as NoteRow[]).map(note),
      queue: this.projectQueue(projectId),
      runPause: projectRunPause(this, projectId),
    };
  }

  /** A bounded metadata-only read, independent of the snapshot's recent 200-session limit. */
  usageSessions(input: { projectId: string; since: string }): UsageSessionPage {
    if (!input || typeof input.projectId !== 'string' || typeof input.since !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.since)) throw new Error('Invalid usage request.');
    const sinceMs = Date.parse(input.since);
    if (!Number.isFinite(sinceMs) || sinceMs > Date.now() || Date.now() - sinceMs > 35 * 86_400_000) throw new Error('Usage range must be within 35 days.');
    this.project(input.projectId);
    const rows = this.db.prepare(`SELECT s.id, s.card_id, c.title AS card_title, s.agent_id, s.state, s.started_at, s.ended_at, s.exit_code,
      COALESCE(u.origin, 'unknown') AS origin, u.workflow_id, u.workflow_name
      FROM sessions s JOIN cards c ON c.id = s.card_id LEFT JOIN session_usage_origins u ON u.session_id = s.id
      WHERE s.project_id = ? AND s.started_at >= ? ORDER BY s.started_at DESC, s.id DESC LIMIT 10001`)
      .all(input.projectId, input.since) as Array<Pick<SessionRow, 'id' | 'card_id' | 'agent_id' | 'state' | 'started_at' | 'ended_at' | 'exit_code'> & {
        card_title: string; origin: 'direct' | 'workflow' | 'queue' | 'unknown'; workflow_id: string | null; workflow_name: string | null;
      }>;
    return { truncated: rows.length > 10000, sessions: rows.slice(0, 10000).map((row) => ({
      id: row.id, cardId: row.card_id, cardTitle: row.card_title, agentId: row.agent_id, state: row.state, startedAt: row.started_at,
      endedAt: row.ended_at, exitCode: row.exit_code,
      origin: row.origin, workflowId: row.workflow_id, workflowName: row.workflow_name,
    })) };
  }

  projectQueue(projectId: string): ProjectQueue {
    this.project(projectId);
    const row = this.db.prepare('SELECT * FROM project_queues WHERE project_id = ?').get(projectId) as QueueRow | undefined;
    const completedCount = (this.db.prepare("SELECT COUNT(*) AS count FROM queue_runs q JOIN workflows w ON w.id = q.workflow_id WHERE q.project_id = ? AND w.state = 'done' AND w.current_step >= json_array_length(w.steps_json)").get(projectId) as { count: number }).count;
    return row ? { projectId, state: row.state, templateWorkflowId: row.template_workflow_id, activeWorkflowId: row.active_workflow_id, pauseReason: row.pause_reason, completedCount, updatedAt: row.updated_at, continueBlocked: row.continue_blocked === 1, runUntil: row.run_until }
      : { projectId, state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount, updatedAt: null, continueBlocked: false, runUntil: null };
  }
  setQueueContinueBlocked(input: { projectId: string; enabled: boolean }): ProjectQueue {
    if (!input || typeof input.projectId !== 'string' || typeof input.enabled !== 'boolean') throw new Error('Invalid queue continuation policy.');
    return this.db.transaction(() => {
      const queue = this.projectQueue(input.projectId);
      if (queue.state === 'running') throw new Error('Pause the queue before changing its continuation policy.');
      if (queue.updatedAt === null) this.saveProjectQueue({ projectId: input.projectId, state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
      this.db.prepare('UPDATE project_queues SET continue_blocked = ?, updated_at = ? WHERE project_id = ?')
        .run(Number(input.enabled), now(), input.projectId);
      return this.projectQueue(input.projectId);
    }).immediate();
  }
  saveProjectQueue(input: { projectId: string; state: QueueState; templateWorkflowId: string | null; activeWorkflowId: string | null; pauseReason: string | null; runUntil?: string | null }): ProjectQueue {
    this.project(input.projectId);
    if (!['off', 'running', 'paused'].includes(input.state)) throw new Error('Ungültiger Warteschlangen-Status.');
    if (input.templateWorkflowId && this.workflow(input.templateWorkflowId).projectId !== input.projectId) throw new Error('Workflow-Vorlage gehört zu einem anderen Projekt.');
    if (input.activeWorkflowId && this.workflow(input.activeWorkflowId).projectId !== input.projectId) throw new Error('Aktiver Workflow gehört zu einem anderen Projekt.');
    const runUntil = input.runUntil === undefined ? this.projectQueue(input.projectId).runUntil ?? null : input.runUntil;
    this.db.prepare('INSERT INTO project_queues (project_id, state, template_workflow_id, active_workflow_id, pause_reason, updated_at, run_until) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET state=excluded.state, template_workflow_id=excluded.template_workflow_id, active_workflow_id=excluded.active_workflow_id, pause_reason=excluded.pause_reason, updated_at=excluded.updated_at, run_until=excluded.run_until').run(input.projectId, input.state, input.templateWorkflowId, input.activeWorkflowId, input.pauseReason, now(), runUntil);
    return this.projectQueue(input.projectId);
  }
  queueLaunchRetry(projectId: string): { workflowId: string; attemptCount: number; retryAt: string; lastError: string } | null {
    this.project(projectId);
    const row = this.db.prepare('SELECT * FROM queue_launch_retries WHERE project_id = ?').get(projectId) as QueueLaunchRetryRow | undefined;
    return row ? { workflowId: row.workflow_id, attemptCount: row.attempt_count, retryAt: row.retry_at, lastError: row.last_error } : null;
  }
  saveQueueLaunchRetry(input: { projectId: string; workflowId: string; attemptCount: number; retryAt: string; lastError: string }): void {
    if (!Number.isInteger(input.attemptCount) || input.attemptCount < 1 || input.attemptCount > 2 || !Number.isFinite(Date.parse(input.retryAt))) throw new Error('Ungültiger CLI-Startwiederholungszustand.');
    if (this.workflow(input.workflowId).projectId !== input.projectId) throw new Error('CLI-Startwiederholung gehört zu einem anderen Projekt.');
    this.db.prepare('INSERT INTO queue_launch_retries (project_id, workflow_id, attempt_count, retry_at, last_error) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET workflow_id=excluded.workflow_id, attempt_count=excluded.attempt_count, retry_at=excluded.retry_at, last_error=excluded.last_error')
      .run(input.projectId, input.workflowId, input.attemptCount, input.retryAt, input.lastError.slice(0, 500));
  }
  clearQueueLaunchRetry(projectId: string): void { this.db.prepare('DELETE FROM queue_launch_retries WHERE project_id = ?').run(projectId); }
  activeSessionForProject(projectId: string): Session | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE project_id = ? AND state = 'running' ORDER BY started_at DESC LIMIT 1").get(projectId) as SessionRow | undefined;
    return row ? session(row) : null;
  }
  runningSessionsForProject(projectId: string): Session[] {
    this.project(projectId);
    // The radar needs identity and worktree binding, never the potentially
    // 200 KiB transcript attached to each session.
    return (this.db.prepare("SELECT id, project_id, card_id, agent_id, state, started_at, ended_at, exit_code, '' AS output, worktree_path, codex_thread_id FROM sessions WHERE project_id = ? AND state = 'running' ORDER BY started_at DESC, id").all(projectId) as SessionRow[]).map(session);
  }
  queueCandidates(projectId: string, limit = 10): Card[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Ungültige Vorschaugröße für die Warteschlange.');
    return this.eligibleQueueCards(projectId).slice(0, limit);
  }
  private eligibleQueueCards(projectId: string): Card[] {
    const snapshot = this.snapshot(projectId);
    const todo = snapshot.columns.find((item) => item.name.trim().toLowerCase() === 'to do');
    if (!todo) throw new Error('Für die Warteschlange fehlt eine To-Do-Spalte.');
    const linked = new Set(snapshot.workflows.flatMap((item) => item.cardIds));
    const claimed = new Set((this.db.prepare('SELECT card_id FROM queue_runs WHERE project_id = ?').all(projectId) as Array<{ card_id: string }>).map((item) => item.card_id));
    return snapshot.cards.filter((item) => item.columnId === todo.id && !item.archivedAt && !linked.has(item.id) && !claimed.has(item.id)).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  runnableQueueCandidates(projectId: string, limit = 5): Card[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid queue preview size.');
    return this.eligibleQueueCards(projectId)
      .filter((item) => !cardRunGate(this, item.id).dependencies.some((dependency) => dependency.status === 'blocked'))
      .slice(0, limit);
  }
  nextQueueCard(projectId: string): Card | null {
    if (this.projectQueue(projectId).continueBlocked) return this.runnableQueueCandidates(projectId, 1)[0] ?? null;
    return this.queueCandidates(projectId, 1)[0] ?? null;
  }
  claimQueueCard(projectId: string, cardId: string, templateWorkflowId: string): Workflow {
    return this.db.transaction(() => {
      const queue = this.projectQueue(projectId);
      if (queue.state !== 'running' || queue.activeWorkflowId || queue.templateWorkflowId !== templateWorkflowId) throw new Error('Warteschlange ist nicht bereit.');
      if (this.nextQueueCard(projectId)?.id !== cardId) throw new Error('Karte ist nicht die nächste freie To-Do-Karte.');
      const template = this.workflow(templateWorkflowId);
      if (template.projectId !== projectId) throw new Error('Workflow-Vorlage gehört zu einem anderen Projekt.');
      const card = this.card(cardId);
      const flow = this.createWorkflow({ projectId, name: `${template.name}: ${card.title}`.slice(0, 200), cardIds: [cardId], steps: template.steps.map((step) => ({ ...step, id: randomUUID() })) });
      this.db.prepare('INSERT INTO queue_runs (project_id, card_id, workflow_id) VALUES (?, ?, ?)').run(projectId, cardId, flow.id);
      this.saveProjectQueue({ projectId, state: 'running', templateWorkflowId, activeWorkflowId: flow.id, pauseReason: null });
      return flow;
    })();
  }

  skipQueuedCard(input: { projectId: string; workflowId: string; reason: string }): ProjectQueue {
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500) throw new Error('Bitte einen Grund mit 3 bis 500 Zeichen angeben.');
    return this.db.transaction(() => {
      const queue = this.projectQueue(input.projectId);
      if (queue.state === 'running' || queue.activeWorkflowId !== input.workflowId) throw new Error('Nur der aktive angehaltene Queue-Workflow kann übersprungen werden.');
      const active = this.workflow(input.workflowId);
      if (active.projectId !== input.projectId || active.state !== 'paused') throw new Error('Der Queue-Workflow ist nicht pausiert.');
      if (this.activeSessionForProject(input.projectId)) throw new Error('Ein Agent läuft noch; zuerst die Sitzung beenden.');
      const run = this.db.prepare('SELECT card_id FROM queue_runs WHERE project_id = ? AND workflow_id = ?').get(input.projectId, input.workflowId) as { card_id: string } | undefined;
      if (!run || active.cardIds.length !== 1 || active.cardIds[0] !== run.card_id) throw new Error('Keine gültige Queue-Zuordnung für diesen Workflow.');
      const runningProgress = this.db.prepare("SELECT 1 FROM workflow_progress WHERE workflow_id = ? AND state = 'running' LIMIT 1").get(input.workflowId);
      if (runningProgress) throw new Error('Der Workflow hat noch einen laufenden Schritt.');
      this.db.prepare('INSERT INTO queue_run_skips (workflow_id, reason, skipped_at) VALUES (?, ?, ?)').run(input.workflowId, reason, now());
      return this.saveProjectQueue({ projectId: input.projectId, state: queue.state, templateWorkflowId: queue.templateWorkflowId, activeWorkflowId: null, pauseReason: queue.state === 'paused' ? 'Queue-Karte ausdrücklich übersprungen. Verlauf prüfen und Queue für die nächste Karte fortsetzen.' : null });
    })();
  }

  /** Advances only an explicitly opted-in queue after an inactive, genuinely blocked workflow. */
  skipBlockedQueueCard(input: { projectId: string; workflowId: string }): ProjectQueue {
    return this.db.transaction(() => {
      const queue = this.projectQueue(input.projectId);
      if (queue.state !== 'running' || queue.continueBlocked !== true || queue.activeWorkflowId !== input.workflowId) {
        throw new Error('Queue continuation is not active for this workflow.');
      }
      const active = this.workflow(input.workflowId);
      if (active.projectId !== input.projectId || active.state !== 'paused'
        || !['approval', 'manual', 'review', 'wireframe'].includes(active.pauseReason ?? '')) {
        throw new Error('This workflow is not an automatically skippable blocker.');
      }
      if (this.activeSessionForProject(input.projectId)) throw new Error('An agent is still running in this project.');
      const run = this.db.prepare('SELECT card_id FROM queue_runs WHERE project_id = ? AND workflow_id = ?')
        .get(input.projectId, input.workflowId) as { card_id: string } | undefined;
      if (!run || active.cardIds.length !== 1 || active.cardIds[0] !== run.card_id) throw new Error('Queue workflow binding is invalid.');
      if (this.db.prepare("SELECT 1 FROM workflow_progress WHERE workflow_id = ? AND state = 'running' LIMIT 1").get(input.workflowId)) {
        throw new Error('The workflow still has a running step.');
      }
      const reason = `Automatisch wegen ${active.pauseReason} zurückgestellt; Workflow und Ergebnis prüfen.`;
      this.db.prepare('INSERT INTO queue_run_skips (workflow_id, reason, skipped_at) VALUES (?, ?, ?)')
        .run(input.workflowId, reason, now());
      return this.saveProjectQueue({ projectId: input.projectId, state: 'running', templateWorkflowId: queue.templateWorkflowId,
        activeWorkflowId: null, pauseReason: null });
    }).immediate();
  }

  column(id: string): Column { return column(required(this.db.prepare('SELECT * FROM columns WHERE id = ?').get(id) as ColumnRow | undefined, 'Column not found')); }
  createColumn(input: { projectId: string; name: string; autoStart?: boolean; agentId?: string | null; model?: string | null; effort?: ColumnEffort | null }): Column {
    this.project(input.projectId);
    const name = trimmed(input.name, 'Column name');
    const names = this.db.prepare('SELECT name FROM columns WHERE project_id = ?').all(input.projectId) as Array<{ name: string }>;
    if (names.some((item) => item.name.toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'))) throw new Error('Spaltenname existiert in diesem Projekt bereits.');
    const selectedAgent = input.agentId ? this.agent(input.agentId) : null;
    const settings = columnSettings(selectedAgent?.kind ?? null, input.model, input.effort);
    const row: Column = { id: randomUUID(), projectId: input.projectId, name, position: (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM columns WHERE project_id = ?').get(input.projectId) as { next: number }).next, autoStart: input.autoStart === true, agentId: input.agentId ?? null, ...settings };
    if (row.autoStart && !row.agentId) throw new Error('Für automatischen Start zuerst einen Spaltenagenten wählen.');
    this.db.prepare('INSERT INTO columns (id, project_id, name, position, auto_start, agent_id, model, effort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(row.id, row.projectId, row.name, row.position, Number(row.autoStart), row.agentId, row.model, row.effort);
    return row;
  }
  updateColumn(input: { id: string; name?: string; autoStart?: boolean; agentId?: string | null; model?: string | null; effort?: ColumnEffort | null }): Column {
    const old = this.column(input.id);
    const name = input.name === undefined ? old.name : trimmed(input.name, 'Column name');
    if (name !== old.name) {
      const others = this.db.prepare('SELECT name FROM columns WHERE project_id = ? AND id <> ?').all(old.projectId, old.id) as Array<{ name: string }>;
      if (others.some((item) => item.name.toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'))) throw new Error('Spaltenname existiert in diesem Projekt bereits.');
      if (old.name.toLocaleLowerCase('de-DE') === 'to do' && name.toLocaleLowerCase('de-DE') !== 'to do' && this.projectQueue(old.projectId).state !== 'off') throw new Error('To-Do-Spalte erst nach Ausschalten der Warteschlange umbenennen.');
    }
    const agentId = input.agentId === undefined ? old.agentId : input.agentId;
    const selectedAgent = agentId ? this.agent(agentId) : null;
    const settings = columnSettings(selectedAgent?.kind ?? null, input.model === undefined ? old.model : input.model, input.effort === undefined ? old.effort : input.effort);
    const value = { ...old, name, autoStart: input.autoStart ?? old.autoStart, agentId, ...settings };
    if (value.autoStart && !value.agentId) throw new Error('Für automatischen Start zuerst einen Spaltenagenten wählen.');
    this.db.prepare('UPDATE columns SET name = ?, auto_start = ?, agent_id = ?, model = ?, effort = ? WHERE id = ?').run(value.name, Number(value.autoStart), value.agentId, value.model, value.effort, input.id);
    return value;
  }
  reorderColumn(input: { id: string; direction: 'left' | 'right' }): Column {
    if (input.direction !== 'left' && input.direction !== 'right') throw new Error('Ungültige Spaltenrichtung.');
    return this.db.transaction(() => {
      const current = this.column(input.id);
      const columns = (this.db.prepare('SELECT * FROM columns WHERE project_id = ? ORDER BY position, id').all(current.projectId) as ColumnRow[]).map(column);
      const index = columns.findIndex((item) => item.id === current.id);
      const neighbor = columns[index + (input.direction === 'left' ? -1 : 1)];
      if (!neighbor) throw new Error('Spalte ist bereits am Rand des Boards.');
      const update = this.db.prepare('UPDATE columns SET position = ? WHERE id = ?');
      update.run(neighbor.position, current.id);
      update.run(current.position, neighbor.id);
      return this.column(current.id);
    })();
  }
  deleteColumn(id: string): void {
    this.db.transaction(() => {
      const target = this.column(id);
      const columns = (this.db.prepare('SELECT * FROM columns WHERE project_id = ? ORDER BY position, id').all(target.projectId) as ColumnRow[]).map(column);
      if (columns.length <= 1) throw new Error('Die letzte Board-Spalte kann nicht gelöscht werden.');
      if (this.db.prepare('SELECT 1 FROM cards WHERE column_id = ? LIMIT 1').get(id)) throw new Error('Spalte enthält noch aktive oder archivierte Karten.');
      const workflows = this.db.prepare('SELECT steps_json FROM workflows WHERE project_id = ?').all(target.projectId) as Array<{ steps_json: string }>;
      if (workflows.some((row) => parseArray<WorkflowStep>(row.steps_json).some((step) => step.columnId === id))) throw new Error('Spalte wird noch von einem Workflow verwendet.');
      if (target.name.trim().toLocaleLowerCase('de-DE') === 'to do' && this.projectQueue(target.projectId).state !== 'off') throw new Error('To-Do-Spalte erst nach Ausschalten der Warteschlange löschen.');
      this.db.prepare('DELETE FROM columns WHERE id = ?').run(id);
      const update = this.db.prepare('UPDATE columns SET position = ? WHERE id = ?');
      columns.filter((item) => item.id !== id).forEach((item, index) => update.run(index, item.id));
    })();
  }
  card(id: string): Card { return card(required(this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined, 'Card not found')); }
  createCard(input: { projectId: string; columnId: string; title: string; description?: string; priority?: CardPriority; labels?: string[] }): Card {
    const destination = this.column(input.columnId);
    if (destination.projectId !== input.projectId) throw new Error('Column belongs to another project');
    const stamp = now();
    const value: Card = { id: randomUUID(), projectId: input.projectId, columnId: input.columnId, title: trimmed(input.title, 'Card title'), description: optionalText(input.description ?? '', 'Card description'), priority: cardPriority(input.priority ?? 'none'), labels: cardLabels(input.labels ?? []), wireframeRequired: false, position: (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cards WHERE column_id = ?').get(input.columnId) as { next: number }).next, createdAt: stamp, updatedAt: stamp, archivedAt: null };
    this.db.prepare('INSERT INTO cards (id, project_id, column_id, title, description, position, created_at, updated_at, archived_at, priority, labels_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)').run(value.id, value.projectId, value.columnId, value.title, value.description, value.position, value.createdAt, value.updatedAt, value.priority, json(value.labels));
    return value;
  }
  updateCard(input: { id: string; title?: string; description?: string; priority?: CardPriority; labels?: string[]; wireframeRequired?: boolean }): Card {
    const old = this.card(input.id);
    if (old.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    if (input.wireframeRequired !== undefined && typeof input.wireframeRequired !== 'boolean') throw new Error('Ungültige Wireframe-Einstellung.');
    if (input.wireframeRequired !== undefined && input.wireframeRequired !== old.wireframeRequired &&
      this.db.prepare("SELECT 1 FROM sessions WHERE card_id = ? AND state = 'running' LIMIT 1").get(input.id)) throw new Error('Laufenden Agenten zuerst stoppen, bevor die Wireframe-Einstellung geändert wird.');
    const value = { ...old, title: input.title === undefined ? old.title : trimmed(input.title, 'Card title'), description: input.description === undefined ? old.description : optionalText(input.description, 'Card description'), priority: input.priority === undefined ? old.priority : cardPriority(input.priority), labels: input.labels === undefined ? old.labels : cardLabels(input.labels), wireframeRequired: input.wireframeRequired ?? old.wireframeRequired, updatedAt: now() };
    this.db.prepare('UPDATE cards SET title = ?, description = ?, priority = ?, labels_json = ?, wireframe_required = ?, updated_at = ? WHERE id = ?').run(value.title, value.description, value.priority, json(value.labels), value.wireframeRequired ? 1 : 0, value.updatedAt, input.id);
    return value;
  }
  moveCard(input: { id: string; columnId: string }): Card {
    const old = this.card(input.id);
    if (old.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    const destination = this.column(input.columnId);
    if (destination.projectId !== old.projectId) throw new Error('Cannot move a card to another project');
    const value = { ...old, columnId: destination.id, position: (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cards WHERE column_id = ?').get(destination.id) as { next: number }).next, updatedAt: now() };
    this.db.prepare('UPDATE cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?').run(value.columnId, value.position, value.updatedAt, input.id);
    return value;
  }
  bulkUpdateCards(input: BulkCardAction): Card[] {
    if (!input || !Array.isArray(input.cardIds) || input.cardIds.length < 1 || input.cardIds.length > 100 || input.cardIds.some((id) => typeof id !== 'string' || !id.trim()) || new Set(input.cardIds).size !== input.cardIds.length) throw new Error('Wähle 1 bis 100 unterschiedliche Karten.');
    if (input.action !== 'move' && input.action !== 'archive' && input.action !== 'priority') throw new Error('Ungültige Sammelaktion.');
    const priority = input.action === 'priority' ? cardPriority(input.priority) : null;
    return this.db.transaction(() => {
      this.project(input.projectId);
      // A running queue may claim or launch cards when the board changes. Require an explicit pause first.
      if (this.projectQueue(input.projectId).state === 'running') throw new Error('Warteschlange vor einer Sammelaktion pausieren.');
      const destination = input.action === 'move' ? this.column(input.columnId) : null;
      if (destination && destination.projectId !== input.projectId) throw new Error('Zielspalte gehört zu einem anderen Projekt.');
      const cards = input.cardIds.map((id) => this.card(id));
      if (cards.some((item) => item.projectId !== input.projectId)) throw new Error('Karte gehört zu einem anderen Projekt.');
      if (cards.some((item) => item.archivedAt)) throw new Error('Archivierte Karte zuerst wiederherstellen.');
      const selected = new Set(input.cardIds);
      const runningSessions = this.db.prepare("SELECT card_id FROM sessions WHERE project_id = ? AND state = 'running'").all(input.projectId) as Array<{ card_id: string }>;
      if (runningSessions.some((row) => selected.has(row.card_id))) throw new Error('Laufende Agentensitzung zuerst stoppen.');
      const workflows = this.db.prepare("SELECT card_ids_json FROM workflows WHERE project_id = ? AND state IN ('running', 'paused')").all(input.projectId) as Array<{ card_ids_json: string }>;
      if (workflows.some((row) => parseArray<string>(row.card_ids_json).some((id) => selected.has(id)))) throw new Error('Aktiven Workflow mit ausgewählter Karte zuerst beenden.');
      const stamp = now();
      if (input.action === 'archive') {
        const update = this.db.prepare('UPDATE cards SET archived_at = ?, updated_at = ? WHERE id = ?');
        for (const item of cards) update.run(stamp, stamp, item.id);
      } else if (priority !== null) {
        const update = this.db.prepare('UPDATE cards SET priority = ?, updated_at = ? WHERE id = ?');
        for (const item of cards) if (item.priority !== priority) update.run(priority, stamp, item.id);
      } else {
        const update = this.db.prepare('UPDATE cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?');
        let position = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cards WHERE column_id = ?').get(destination!.id) as { next: number }).next;
        for (const item of cards) if (item.columnId !== destination!.id) update.run(destination!.id, position++, stamp, item.id);
      }
      return cards.map((item) => this.card(item.id));
    })();
  }
  reorderCard(input: { id: string; direction: 'up' | 'down' }): Card {
    if (input.direction !== 'up' && input.direction !== 'down') throw new Error('Ungültige Kartenrichtung.');
    return this.db.transaction(() => {
      const current = this.card(input.id);
      if (current.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
      const rows = this.db.prepare('SELECT id, archived_at FROM cards WHERE column_id = ? ORDER BY position, created_at, id')
        .all(current.columnId) as Array<{ id: string; archived_at: string | null }>;
      const active = rows.filter((row) => !row.archived_at);
      const index = active.findIndex((row) => row.id === current.id);
      const neighbor = active[index + (input.direction === 'up' ? -1 : 1)];
      if (!neighbor) throw new Error('Karte ist bereits am Rand der Spalte.');

      // Keep archived cards in their slots while swapping adjacent active cards.
      // Renumber in one transaction so legacy duplicate positions are repaired too.
      const from = rows.findIndex((row) => row.id === current.id);
      const to = rows.findIndex((row) => row.id === neighbor.id);
      [rows[from], rows[to]] = [rows[to]!, rows[from]!];
      const update = this.db.prepare('UPDATE cards SET position = ? WHERE id = ?');
      rows.forEach((row, position) => update.run(position, row.id));
      return this.card(current.id);
    })();
  }
  setCardArchived(input: { id: string; archived: boolean }): Card {
    if (typeof input.archived !== 'boolean') throw new Error('Archivstatus muss wahr oder falsch sein.');
    const old = this.card(input.id);
    if (Boolean(old.archivedAt) === input.archived) return old;
    if (input.archived) {
      if (this.db.prepare("SELECT 1 FROM sessions WHERE card_id = ? AND state = 'running' LIMIT 1").get(old.id)) throw new Error('Laufende Agentensitzung zuerst stoppen.');
      const running = this.db.prepare("SELECT card_ids_json FROM workflows WHERE project_id = ? AND state = 'running'").all(old.projectId) as Array<{ card_ids_json: string }>;
      if (running.some((row) => parseArray<string>(row.card_ids_json).includes(old.id))) throw new Error('Laufenden Workflow mit dieser Karte zuerst pausieren.');
    }
    const stamp = now();
    this.db.prepare('UPDATE cards SET archived_at = ?, updated_at = ? WHERE id = ?').run(input.archived ? stamp : null, stamp, old.id);
    return this.card(old.id);
  }

  cardAttachments(cardId: string): CardAttachment[] {
    this.card(cardId);
    const rows = this.db.prepare('SELECT * FROM card_attachments WHERE card_id = ? ORDER BY added_at, id').all(cardId) as AttachmentRow[];
    return rows.map((row) => ({ id: row.id, cardId: row.card_id, name: row.name, size: row.size, addedAt: row.added_at, available: attachmentAvailable(row.path), canOpen: canOpenAttachment(row.name) }));
  }

  addCardAttachments(cardId: string, paths: string[]): CardAttachment[] {
    const card = this.card(cardId);
    if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_CARD_ATTACHMENTS) throw new Error('Wähle höchstens 20 Dateien.');
    const files = paths.map(checkedAttachmentPath);
    this.db.transaction(() => {
      const existing = new Set((this.db.prepare('SELECT path FROM card_attachments WHERE card_id = ?').all(cardId) as Array<{ path: string }>).map((row) => row.path));
      const added = new Set(files.map((file) => file.path).filter((path) => !existing.has(path)));
      if (existing.size + added.size > MAX_CARD_ATTACHMENTS) throw new Error('Eine Karte kann höchstens 20 Anhänge haben.');
      const insert = this.db.prepare('INSERT OR IGNORE INTO card_attachments (id, card_id, path, name, size, added_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const file of files) insert.run(randomUUID(), cardId, file.path, file.name, file.size, now());
    })();
    return this.cardAttachments(cardId);
  }

  attachmentPathForCard(input: { cardId: string; attachmentId: string }): string {
    this.card(input.cardId);
    const row = this.db.prepare('SELECT * FROM card_attachments WHERE id = ? AND card_id = ?').get(input.attachmentId, input.cardId) as AttachmentRow | undefined;
    if (!row) throw new Error('Anhang gehört nicht zu dieser Karte.');
    if (!attachmentAvailable(row.path)) throw new Error('Die verknüpfte Datei fehlt oder ihr Pfad hat sich geändert.');
    if (!canOpenAttachment(row.name)) throw new Error('Dieser Dateityp wird aus Sicherheitsgründen nicht geöffnet.');
    return row.path;
  }

  removeCardAttachment(input: { cardId: string; attachmentId: string }): void {
    const card = this.card(input.cardId);
    if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    const result = this.db.prepare('DELETE FROM card_attachments WHERE id = ? AND card_id = ?').run(input.attachmentId, input.cardId);
    if (result.changes !== 1) throw new Error('Anhang gehört nicht zu dieser Karte.');
  }

  previewTrelloImport(input: { projectId: string; json: string }): TrelloImportPreview {
    this.project(input.projectId);
    const parsed = parseTrelloBoard(input.json);
    const imported = new Map((this.db.prepare('SELECT source_id, card_id FROM trello_imports WHERE project_id = ?').all(input.projectId) as Array<{ source_id: string; card_id: string }>).map((row) => [row.source_id, row.card_id]));
    const importedIdeas = new Map((this.db.prepare('SELECT source_id, idea_id FROM trello_idea_imports WHERE project_id = ?').all(input.projectId) as Array<{ source_id: string; idea_id: string }>).map((row) => [row.source_id, row.idea_id]));
    const cards = parsed.cards.map((item) => ({ ...item, importedCardId: imported.get(item.sourceId) ?? null, importedIdeaId: importedIdeas.get(item.sourceId) ?? null }));
    return {
      fingerprint: parsed.fingerprint,
      boardName: parsed.boardName,
      cards,
      total: cards.length,
      eligible: cards.filter((item) => item.eligible && !item.importedCardId && !item.importedIdeaId).length,
      duplicates: cards.filter((item) => item.importedCardId !== null || item.importedIdeaId !== null).length,
    };
  }

  acceptTrelloImport(input: { projectId: string; columnId: string; columnByListId?: Record<string, string>; json: string; fingerprint: string; sourceIds: string[] }): TrelloImportResult {
    this.project(input.projectId);
    if (this.column(input.columnId).projectId !== input.projectId) throw new Error('Die Zielspalte gehört zu einem anderen Projekt.');
    const parsed = parseTrelloBoard(input.json);
    if (parsed.fingerprint !== input.fingerprint) throw new Error('Die Trello-Datei hat sich seit der Vorschau geändert. Bitte erneut prüfen.');
    if (!Array.isArray(input.sourceIds) || input.sourceIds.length === 0 || input.sourceIds.length > parsed.cards.length || new Set(input.sourceIds).size !== input.sourceIds.length) throw new Error('Bitte gültige Karten-IDs einmalig auswählen.');
    const sourceCards = new Map(parsed.cards.map((item) => [item.sourceId, item]));
    const columnByListId = new Map<string, string>();
    if (input.columnByListId !== undefined) {
      if (!input.columnByListId || typeof input.columnByListId !== 'object' || Array.isArray(input.columnByListId)) throw new Error('Ungültige Trello-Listen-Zuordnung.');
      const entries = Object.entries(input.columnByListId);
      if (entries.length > parsed.cards.length) throw new Error('Zu viele Trello-Listen-Zuordnungen.');
      const availableListIds = new Set(parsed.cards.map((item) => item.listId).filter((id): id is string => id !== null));
      for (const [listId, destinationId] of entries) {
        if (!availableListIds.has(listId) || typeof destinationId !== 'string') throw new Error('Eine Trello-Listen-Zuordnung ist ungültig.');
        if (this.column(destinationId).projectId !== input.projectId) throw new Error('Eine Zielspalte gehört zu einem anderen Projekt.');
        columnByListId.set(listId, destinationId);
      }
    }
    for (const sourceId of input.sourceIds) {
      const item = sourceCards.get(sourceId);
      if (!item || !item.eligible) throw new Error('Eine gewählte Trello-Karte kann nicht importiert werden.');
    }
    return this.db.transaction(() => {
      const created: Card[] = [];
      const skippedDuplicateIds: string[] = [];
      const lookup = this.db.prepare('SELECT card_id FROM trello_imports WHERE project_id = ? AND source_id = ?');
      const ideaLookup = this.db.prepare('SELECT idea_id FROM trello_idea_imports WHERE project_id = ? AND source_id = ?');
      const insert = this.db.prepare('INSERT INTO trello_imports (project_id, source_id, card_id, imported_at) VALUES (?, ?, ?, ?)');
      for (const sourceId of input.sourceIds) {
        if (lookup.get(input.projectId, sourceId) || ideaLookup.get(input.projectId, sourceId)) {
          skippedDuplicateIds.push(sourceId);
          continue;
        }
        const item = sourceCards.get(sourceId)!;
        // Direct store insertion intentionally bypasses the IPC move-to-column auto-start path.
        const added = this.createCard({ projectId: input.projectId, columnId: (item.listId && columnByListId.get(item.listId)) || input.columnId, title: item.title, description: item.description, labels: item.labels });
        const newCard = item.archived ? this.setCardArchived({ id: added.id, archived: true }) : added;
        insert.run(input.projectId, sourceId, newCard.id, now());
        created.push(newCard);
      }
      return { created, skippedDuplicateIds };
    })();
  }

  agents(): AgentPreset[] { return (this.db.prepare('SELECT * FROM agents ORDER BY name').all() as AgentRow[]).map(agent); }
  agent(id: string): AgentPreset { return agent(required(this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined, 'Agent not found')); }
  agentCapabilityEvidence(): AgentCapabilityEvidence[] { return listAgentCapabilityEvidence(this.db); }
  recordAgentCapability(sessionId: string, capability: AgentCapability): void { recordAgentCapability(this.db, sessionId, capability); }
  saveAgent(input: Omit<AgentPreset, 'id'> & { id?: string }): AgentPreset {
    if (!['codex', 'claude', 'gemini', 'antigravity', 'custom'].includes(input.kind)) throw new Error('Invalid agent kind');
    if (!Array.isArray(input.args) || input.args.length > 40 || input.args.some((arg) => typeof arg !== 'string' || arg.length > 1000 || /[\0\r\n]/.test(arg))) throw new Error('Invalid agent arguments');
    const command = trimmed(input.command, 'Agent command', 1000);
    if (/[\r\n]/.test(command)) throw new Error('Invalid agent command');
    const value: AgentPreset = { id: input.id ?? randomUUID(), name: trimmed(input.name, 'Agent name'), kind: input.kind, command, args: input.args, model: input.model ? trimmed(input.model, 'Model name', 200) : null, enabled: input.enabled === true };
    const previous = input.id ? this.db.prepare('SELECT kind, command, args_json, model FROM agents WHERE id = ?').get(input.id) as Pick<AgentRow, 'kind' | 'command' | 'args_json' | 'model'> | undefined : undefined;
    const launchChanged = Boolean(previous && (previous.kind !== value.kind || previous.command !== value.command || previous.args_json !== json(value.args) || previous.model !== value.model));
    if (launchChanged && this.db.prepare("SELECT 1 FROM sessions WHERE agent_id = ? AND state = 'running' LIMIT 1").get(value.id)) {
      throw new Error('Laufendes Agentenprofil zuerst stoppen, bevor Startparameter geändert werden.');
    }
    this.db.prepare('INSERT INTO agents VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, command=excluded.command, args_json=excluded.args_json, model=excluded.model, enabled=excluded.enabled').run(value.id, value.name, value.kind, value.command, json(value.args), value.model, Number(value.enabled));
    if (launchChanged) clearAgentCapabilityEvidence(this.db, value.id);
    return value;
  }

  latestSession(cardId: string): Session | null { const row = this.db.prepare('SELECT * FROM sessions WHERE card_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(cardId) as SessionRow | undefined; return row ? session(row) : null; }
  session(id: string): Session { return session(required(this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined, 'Session not found')); }
  sessionForProject(projectId: string, sessionId: string): Session {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ? AND project_id = ?').get(sessionId, projectId) as SessionRow | undefined;
    if (!row) throw new Error('Sitzung gehört zu einem anderen Projekt oder wurde entfernt.');
    return session(row);
  }
  interruptedSessions(projectId: string): InterruptedSessionReview[] {
    this.project(projectId);
    const rows = this.db.prepare(`SELECT s.id AS session_id, s.project_id, s.card_id, c.title AS card_title, a.name AS agent_name, s.interrupted_at, s.worktree_path
      FROM sessions s JOIN cards c ON c.id = s.card_id JOIN agents a ON a.id = s.agent_id
      WHERE s.project_id = ? AND s.interrupted_at IS NOT NULL AND s.interruption_reviewed_at IS NULL
      ORDER BY s.interrupted_at DESC, s.id DESC LIMIT 100`).all(projectId) as Array<{
        session_id: string; project_id: string; card_id: string; card_title: string;
        agent_name: string; interrupted_at: string; worktree_path: string | null;
      }>;
    return rows.map((row) => ({
      sessionId: row.session_id, projectId: row.project_id, cardId: row.card_id,
      cardTitle: row.card_title, agentName: row.agent_name, interruptedAt: row.interrupted_at,
      worktreePath: row.worktree_path,
    }));
  }
  acknowledgeInterruptedSession(input: { projectId: string; sessionId: string }): void {
    this.project(input.projectId);
    const changed = this.db.prepare(`UPDATE sessions SET interruption_reviewed_at = ?
      WHERE id = ? AND project_id = ? AND state = 'failed'
        AND interrupted_at IS NOT NULL AND interruption_reviewed_at IS NULL`)
      .run(now(), input.sessionId, input.projectId);
    if (changed.changes !== 1) throw new Error('Unterbrechung wurde bereits geprüft oder gehört nicht zu diesem Projekt.');
  }
  commandTerminals(projectId: string): CommandTerminal[] {
    this.project(projectId);
    return (this.db.prepare('SELECT * FROM command_terminals WHERE project_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 30').all(projectId) as CommandTerminalRow[]).map(commandTerminal);
  }
  commandTerminal(id: string): CommandTerminal {
    return commandTerminal(required(this.db.prepare('SELECT * FROM command_terminals WHERE id = ?').get(id) as CommandTerminalRow | undefined, 'Terminal nicht gefunden.'));
  }
  activeCommandTerminalForCard(cardId: string): CommandTerminal | null {
    const row = this.db.prepare("SELECT * FROM command_terminals WHERE card_id = ? AND state = 'running' LIMIT 1").get(cardId) as CommandTerminalRow | undefined;
    return row ? commandTerminal(row) : null;
  }
  createCommandTerminal(input: { projectId: string; shell: CommandShell; cardId?: string | null; worktreePath?: string | null }): CommandTerminal {
    this.project(input.projectId);
    if (input.shell !== 'powershell' && input.shell !== 'cmd') throw new Error('Ungültige Shell.');
    if (this.db.prepare("SELECT 1 FROM command_terminals WHERE project_id = ? AND state = 'running' LIMIT 1").get(input.projectId)) throw new Error('Im Projekt läuft bereits ein Befehlsterminal.');
    if (input.cardId && this.card(input.cardId).projectId !== input.projectId) throw new Error('Karte gehört zu einem anderen Projekt.');
    if (Boolean(input.cardId) !== Boolean(input.worktreePath)) throw new Error('Karte und Worktree-Pfad müssen zusammen angegeben werden.');
    const value: CommandTerminal = { id: randomUUID(), projectId: input.projectId, shell: input.shell, state: 'running', startedAt: now(), endedAt: null, exitCode: null, output: '', cardId: input.cardId ?? null, worktreePath: input.worktreePath ?? null };
    this.db.prepare('INSERT INTO command_terminals (id, project_id, shell, state, started_at, ended_at, exit_code, output, card_id, worktree_path) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)').run(value.id, value.projectId, value.shell, value.state, value.startedAt, value.output, value.cardId, value.worktreePath);
    return value;
  }
  appendCommandOutput(id: string, text: string): void {
    if (!text) return;
    this.db.prepare('UPDATE command_terminals SET output = substr(output || ?, -100000) WHERE id = ? AND state = ?').run(text.slice(-100000), id, 'running');
  }
  finishCommandTerminal(id: string, state: Exclude<SessionState, 'running'>, exitCode: number | null): CommandTerminal {
    this.db.prepare("UPDATE command_terminals SET state = ?, ended_at = ?, exit_code = ? WHERE id = ? AND state = 'running'").run(state, now(), exitCode, id);
    return this.commandTerminal(id);
  }
  searchSessionTranscripts(projectId: string, query: string): SessionSearchHit[] {
    this.project(projectId);
    return searchSessionTranscripts(this.db, projectId, query);
  }
  createSession(input: { cardId: string; agentId: string; worktreePath?: string | null; codexThreadId?: string | null }): Session {
    const source = this.card(input.cardId);
    if (source.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    this.agent(input.agentId);
    if (input.codexThreadId && (this.agent(input.agentId).kind !== 'codex' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.codexThreadId))) throw new Error('Ungültige Codex-Gesprächs-ID.');
    const value: Session = { id: randomUUID(), projectId: source.projectId, cardId: source.id, agentId: input.agentId, state: 'running', startedAt: now(), endedAt: null, exitCode: null, output: '', worktreePath: input.worktreePath ?? null, codexThreadId: input.codexThreadId ?? null };
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO sessions (id, project_id, card_id, agent_id, state, started_at, ended_at, exit_code, output, worktree_path, codex_thread_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(value.id, value.projectId, value.cardId, value.agentId, value.state, value.startedAt, value.endedAt, value.exitCode, value.output, value.worktreePath, value.codexThreadId);
      this.db.prepare("INSERT INTO session_usage_origins (session_id, origin, workflow_id, workflow_name) VALUES (?, 'direct', NULL, NULL)").run(value.id);
    })();
    return value;
  }
  linkCodexThread(sessionId: string, threadId: string): void {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(threadId)) throw new Error('Ungültige Codex-Gesprächs-ID.');
    const row = this.session(sessionId);
    if (this.agent(row.agentId).kind !== 'codex' || row.state !== 'running') throw new Error('Codex-Gespräch kann dieser Sitzung nicht zugeordnet werden.');
    const changed = this.db.prepare("UPDATE sessions SET codex_thread_id = ? WHERE id = ? AND state = 'running' AND (codex_thread_id IS NULL OR codex_thread_id = ?)").run(threadId, sessionId, threadId);
    if (changed.changes !== 1) throw new Error('Codex-Gesprächs-ID der Sitzung widerspricht der vorhandenen Zuordnung.');
  }
  cardWorktree(cardId: string): CardWorktree | null {
    const row = this.db.prepare('SELECT * FROM card_worktrees WHERE card_id = ?').get(cardId) as WorktreeRow | undefined;
    return row ? { cardId: row.card_id, projectId: row.project_id, sourceRoot: row.source_root, path: row.path, branch: row.branch, createdAt: row.created_at } : null;
  }
  cardWorktreesForProject(projectId: string): CardWorktree[] {
    this.project(projectId);
    const rows = this.db.prepare('SELECT * FROM card_worktrees WHERE project_id = ? ORDER BY created_at, card_id').all(projectId) as WorktreeRow[];
    return rows.map((row) => ({ cardId: row.card_id, projectId: row.project_id, sourceRoot: row.source_root, path: row.path, branch: row.branch, createdAt: row.created_at }));
  }
  saveCardWorktree(input: Omit<CardWorktree, 'createdAt'>): CardWorktree {
    const source = this.card(input.cardId);
    if (source.projectId !== input.projectId) throw new Error('Worktree card belongs to another project');
    const value: CardWorktree = { ...input, createdAt: now() };
    this.db.prepare('INSERT INTO card_worktrees (card_id, project_id, source_root, path, branch, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(value.cardId, value.projectId, value.sourceRoot, value.path, value.branch, value.createdAt);
    return value;
  }
  appendOutput(id: string, text: string): void {
    if (!text) return;
    this.db.prepare('UPDATE sessions SET output = substr(output || ?, -200000) WHERE id = ?').run(text.slice(-200000), id);
  }
  finishSession(id: string, state: Exclude<SessionState, 'running'>, exitCode: number | null): Session {
    this.db.prepare("UPDATE sessions SET state = ?, ended_at = ?, exit_code = ? WHERE id = ? AND state = 'running'").run(state, now(), exitCode, id);
    return this.session(id);
  }

  interruptSessionOnShutdown(id: string): void {
    const interruptedAt = now();
    this.db.prepare(`UPDATE sessions
      SET state = 'failed', ended_at = ?, interrupted_at = ?, exit_code = NULL,
        output = substr(output || ?, -200000)
      WHERE id = ? AND state = 'running'`)
      .run(interruptedAt, interruptedAt, '\n[Branchloom closed while this session was running; this session was not replayed.]\n', id);
  }

  workflow(id: string): Workflow { return this.hydrateWorkflow(required(this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow | undefined, 'Workflow not found')); }
  private hydrateWorkflow(row: WorkflowRow): Workflow {
    const value = workflow(row);
    const haltpoint = this.db.prepare("SELECT id, after_step_index, step_id, state, requested_at, reached_at FROM workflow_step_haltpoints WHERE workflow_id = ? AND state IN ('requested', 'reached')").get(value.id) as { id: string; after_step_index: number; step_id: string; state: 'requested' | 'reached'; requested_at: string; reached_at: string | null } | undefined;
    if (haltpoint) value.haltpoint = { id: haltpoint.id, afterStepIndex: haltpoint.after_step_index, stepId: haltpoint.step_id, state: haltpoint.state, requestedAt: haltpoint.requested_at, reachedAt: haltpoint.reached_at };
    const startError = this.db.prepare('SELECT message, failed_at FROM workflow_start_errors WHERE workflow_id = ?').get(value.id) as { message: string; failed_at: string } | undefined;
    if (startError) value.startError = { message: startError.message, at: startError.failed_at };
    const skip = this.db.prepare('SELECT reason, skipped_at FROM queue_run_skips WHERE workflow_id = ?').get(value.id) as { reason: string; skipped_at: string } | undefined;
    if (skip) value.queueSkip = { reason: skip.reason, at: skip.skipped_at };
    if (value.state !== 'paused') return value;
    const step = value.steps[value.currentStep];
    const progress = this.workflowProgress(value.id, value.currentStep);
    const pauseReason: NonNullable<Workflow['pauseReason']> = value.haltpoint?.state === 'reached'
      ? 'haltpoint'
      : step?.requireApproval && !this.isStepApproved(value.id, value.currentStep)
      ? 'approval'
      : progress.some((item) => item.state === 'manual_wait')
        ? 'manual'
        : progress.some((item) => item.state === 'needs_review')
          ? 'review'
          : step?.agentId && progress.some((item) => item.state === 'pending' && wireframeStartBlockReason(this, item.cardId))
            ? 'wireframe'
            : 'user';
    return { ...value, pauseReason };
  }
  saveWorkflowStartError(id: string, reason: unknown): void {
    this.workflow(id);
    const message = (reason instanceof Error ? reason.message : String(reason)).replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 500) || 'Unbekannter Startfehler';
    this.db.prepare('INSERT INTO workflow_start_errors (workflow_id, message, failed_at) VALUES (?, ?, ?) ON CONFLICT(workflow_id) DO UPDATE SET message=excluded.message, failed_at=excluded.failed_at').run(id, message, now());
  }
  clearWorkflowStartError(id: string): void {
    this.db.prepare('DELETE FROM workflow_start_errors WHERE workflow_id = ?').run(id);
  }
  private validatedWorkflowSteps(projectId: string, steps: WorkflowStep[]): WorkflowStep[] {
    return steps.map((step) => {
      if (!step || typeof step !== 'object') throw new Error('Ungültiger Workflow-Schritt.');
      if (this.column(step.columnId).projectId !== projectId) throw new Error('Workflow-Spalte gehört zu einem anderen Projekt.');
      const agent = step.agentId ? this.agent(step.agentId) : null;
      if (step.useWorktree != null && typeof step.useWorktree !== 'boolean') throw new Error('Worktree-Auswahl muss ein Ja/Nein-Wert sein.');
      if (step.useWorktree && !agent) throw new Error('Ein manueller Schritt kann keinen Agenten-Worktree starten.');
      if (step.parallel != null && typeof step.parallel !== 'boolean') throw new Error('Paralleler Schritt muss ein Ja/Nein-Wert sein.');
      if (step.parallel && (!agent || !step.useWorktree)) throw new Error('Parallele Agenten brauchen getrennte Karten-Worktrees.');
      return { ...step, ...workflowStepSettings(agent?.kind ?? null, step.model, step.effort), useWorktree: step.useWorktree === true, parallel: step.parallel === true };
    });
  }
  createWorkflow(input: { projectId: string; name: string; cardIds: string[]; steps: WorkflowStep[] }): Workflow {
    this.project(input.projectId);
    if (!Array.isArray(input.cardIds) || !Array.isArray(input.steps) || input.cardIds.length === 0 || input.steps.length === 0 || input.steps.length > 30) throw new Error('Workflow needs cards and 1-30 steps');
    if (new Set(input.cardIds).size !== input.cardIds.length) throw new Error('Workflow has duplicate cards');
    for (const cardId of input.cardIds) {
      const item = this.card(cardId);
      if (item.projectId !== input.projectId) throw new Error('Workflow card belongs to another project');
      if (item.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    }
    const steps = this.validatedWorkflowSteps(input.projectId, input.steps);
    const stamp = now();
    const value: Workflow = { id: randomUUID(), projectId: input.projectId, name: trimmed(input.name, 'Workflow name'), cardIds: input.cardIds, steps, state: 'draft', currentStep: 0, createdAt: stamp, updatedAt: stamp };
    this.db.prepare('INSERT INTO workflows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(value.id, value.projectId, value.name, json(value.cardIds), json(value.steps), value.state, value.currentStep, value.createdAt, value.updatedAt);
    return value;
  }
  updateDraftWorkflow(input: { id: string; name: string; cardIds: string[]; steps: WorkflowStep[] }): Workflow {
    return this.db.transaction(() => {
      const old = this.workflow(input.id);
      if (old.state !== 'draft' || old.currentStep !== 0) throw new Error('Nur ungestartete Workflow-Entwürfe können bearbeitet werden.');
      if (this.db.prepare('SELECT 1 FROM workflow_progress WHERE workflow_id = ? LIMIT 1').get(old.id) || this.db.prepare('SELECT 1 FROM workflow_step_approvals WHERE workflow_id = ? LIMIT 1').get(old.id)) throw new Error('Workflow hat bereits Fortschritt und bleibt unverändert.');
      if (this.db.prepare('SELECT 1 FROM queue_runs WHERE workflow_id = ? LIMIT 1').get(old.id)) throw new Error('Beanspruchte Queue-Workflows bleiben unverändert.');
      const queue = this.projectQueue(old.projectId);
      if (queue.activeWorkflowId === old.id || (queue.templateWorkflowId === old.id && queue.state !== 'off')) throw new Error('Workflow wird von der Warteschlange verwendet. Zuerst die Queue ausschalten.');
      if (!Array.isArray(input.cardIds) || !Array.isArray(input.steps) || input.cardIds.length === 0 || input.steps.length === 0 || input.steps.length > 30) throw new Error('Workflow braucht Karten und 1 bis 30 Schritte.');
      if (new Set(input.cardIds).size !== input.cardIds.length) throw new Error('Workflow enthält doppelte Karten.');
      for (const cardId of input.cardIds) {
        const card = this.card(cardId);
        if (card.projectId !== old.projectId) throw new Error('Workflow-Karte gehört zu einem anderen Projekt.');
        if (card.archivedAt) throw new Error('Archivierte Workflow-Karte zuerst wiederherstellen.');
      }
      const steps = this.validatedWorkflowSteps(old.projectId, input.steps);
      // A draft route can change its step identities. A requested boundary
      // must never silently point to a different step after editing.
      this.db.prepare("UPDATE workflow_step_haltpoints SET state = 'cancelled', closed_at = ? WHERE workflow_id = ? AND state = 'requested'").run(now(), old.id);
      this.db.prepare('UPDATE workflows SET name = ?, card_ids_json = ?, steps_json = ?, updated_at = ? WHERE id = ?').run(trimmed(input.name, 'Workflow name'), json(input.cardIds), json(steps), now(), old.id);
      return this.workflow(old.id);
    })();
  }
  deleteDraftWorkflow(id: string): string {
    return this.db.transaction(() => {
      const workflow = this.workflow(id);
      if (workflow.state !== 'draft' || workflow.currentStep !== 0) throw new Error('Nur ungestartete Workflow-Entwürfe können gelöscht werden.');
      if (this.db.prepare('SELECT 1 FROM workflow_progress WHERE workflow_id = ? LIMIT 1').get(id) || this.db.prepare('SELECT 1 FROM workflow_step_approvals WHERE workflow_id = ? LIMIT 1').get(id)) throw new Error('Workflow hat bereits Fortschritt und bleibt im Verlauf erhalten.');
      if (this.db.prepare('SELECT 1 FROM queue_runs WHERE workflow_id = ? LIMIT 1').get(id)) throw new Error('Beanspruchte Queue-Workflows bleiben im Verlauf erhalten.');
      const queue = this.projectQueue(workflow.projectId);
      if (queue.activeWorkflowId === id || (queue.templateWorkflowId === id && queue.state !== 'off')) throw new Error('Workflow wird von der Warteschlange verwendet. Zuerst die Queue ausschalten.');
      if (queue.templateWorkflowId === id) this.saveProjectQueue({ projectId: workflow.projectId, state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
      this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
      return workflow.projectId;
    })();
  }
  setWorkflowState(id: string, state: WorkflowState): Workflow {
    const current = this.workflow(id);
    if (!['draft', 'running', 'paused', 'done'].includes(state)) throw new Error('Invalid workflow state');
    if (state === 'running' && current.cardIds.some((cardId) => this.card(cardId).archivedAt)) throw new Error('Archivierte Workflow-Karte zuerst wiederherstellen.');
    this.db.prepare('UPDATE workflows SET state = ?, updated_at = ? WHERE id = ?').run(state, now(), id);
    return this.workflow(id);
  }
  setWorkflowStepHaltpoint(input: { id: string; afterStepIndex: number | null }): Workflow {
    return this.db.transaction(() => {
      const flow = this.workflow(input.id);
      if (flow.state === 'done' || flow.queueSkip) throw new Error('Completed or skipped workflows cannot set a haltpoint.');
      const boundary = input.afterStepIndex;
      if (boundary !== null && (!Number.isInteger(boundary) || boundary < flow.currentStep || boundary >= flow.steps.length - 1)) {
        throw new Error('Choose an upcoming boundary before the final workflow step.');
      }
      if (flow.haltpoint?.state === 'reached' && boundary !== null) throw new Error('Resume or remove the reached haltpoint before choosing another.');
      if (boundary === null && !flow.haltpoint) return flow;
      if (flow.haltpoint?.state === 'requested' && flow.haltpoint.afterStepIndex === boundary) return flow;
      this.db.prepare("UPDATE workflow_step_haltpoints SET state = 'cancelled', closed_at = ? WHERE workflow_id = ? AND state IN ('requested', 'reached')").run(now(), flow.id);
      if (boundary !== null) {
        this.db.prepare("INSERT INTO workflow_step_haltpoints (id, workflow_id, after_step_index, step_id, state, requested_at) VALUES (?, ?, ?, ?, 'requested', ?)").run(randomUUID(), flow.id, boundary, flow.steps[boundary]!.id, now());
      }
      return this.workflow(flow.id);
    })();
  }
  releaseReachedWorkflowHaltpoint(id: string): void {
    this.db.prepare("UPDATE workflow_step_haltpoints SET state = 'released', closed_at = ? WHERE workflow_id = ? AND state = 'reached'").run(now(), id);
  }
  workflowAgentSettings(): WorkflowAgentSettings {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'workflow_agent'").get() as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) as WorkflowAgentSettings : { agentId: null, model: null, effort: null };
  }
  saveWorkflowAgentSettings(input: WorkflowAgentSettings): WorkflowAgentSettings {
    if (input.agentId !== null && (typeof input.agentId !== 'string' || !this.agent(input.agentId).enabled)) throw new Error('Choose an enabled workflow agent');
    if (input.model !== null && (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 || /[\r\n\0]/.test(input.model))) throw new Error('Invalid workflow model');
    if (input.effort !== null && !['low', 'medium', 'high'].includes(input.effort)) throw new Error('Invalid workflow effort');
    const value: WorkflowAgentSettings = { agentId: input.agentId, model: input.model?.trim() ?? null, effort: input.effort };
    this.db.prepare("INSERT INTO settings VALUES ('workflow_agent', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(json(value));
    return value;
  }
  acceptWorkflowProposal(input: { projectId: string; proposal: WorkflowProposal }): Workflow {
    const snapshot = this.snapshot(input.projectId);
    const proposal = validateWorkflowProposal(input.proposal, snapshot.columns);
    const todo = snapshot.columns.find((item) => item.name.toLowerCase() === 'to do') ?? snapshot.columns[0];
    if (!todo) throw new Error('Project has no board columns');
    return this.db.transaction(() => {
      const cards = proposal.cards.map((item) => this.createCard({ projectId: input.projectId, columnId: todo.id, title: item.title, description: item.description }));
      const steps: WorkflowStep[] = proposal.columnIds.map((id) => {
        const column = this.column(id);
        return { id: randomUUID(), columnId: id, agentId: column.agentId, requireApproval: !column.autoStart };
      });
      return this.createWorkflow({ projectId: input.projectId, name: proposal.title, cardIds: cards.map((item) => item.id), steps });
    })();
  }
  advanceWorkflow(id: string): Workflow {
    return this.db.transaction(() => {
      const old = this.workflow(id);
      if (old.state !== 'running') throw new Error('Only a running workflow can advance.');
      const progress = this.workflowProgress(id, old.currentStep);
      if (progress.length !== old.cardIds.length || progress.some((item) => item.state !== 'complete')) throw new Error('Workflow step is not complete.');
      const step = old.currentStep + 1;
      const boundaryReached = old.haltpoint?.state === 'requested' && old.haltpoint.afterStepIndex === old.currentStep && old.haltpoint.stepId === old.steps[old.currentStep]?.id;
      const state: WorkflowState = step >= old.steps.length ? 'done' : boundaryReached ? 'paused' : old.state;
      if (boundaryReached) this.db.prepare("UPDATE workflow_step_haltpoints SET state = 'reached', reached_at = ? WHERE id = ? AND state = 'requested'").run(now(), old.haltpoint!.id);
      this.db.prepare('UPDATE workflows SET current_step = ?, state = ?, updated_at = ? WHERE id = ?').run(step, state, now(), id);
      return this.workflow(id);
    })();
  }
  ensureWorkflowProgress(id: string, stepIndex: number, cardIds: string[]): void {
    const insert = this.db.prepare("INSERT OR IGNORE INTO workflow_progress (workflow_id, step_index, card_id, session_id, state) VALUES (?, ?, ?, NULL, 'pending')");
    this.db.transaction(() => { for (const cardId of cardIds) insert.run(id, stepIndex, cardId); })();
  }
  workflowProgress(id: string, stepIndex: number): Array<{ cardId: string; sessionId: string | null; state: 'pending' | 'running' | 'complete' | 'needs_review' | 'manual_wait' }> {
    const rows = this.db.prepare('SELECT card_id, session_id, state FROM workflow_progress WHERE workflow_id = ? AND step_index = ? ORDER BY rowid').all(id, stepIndex) as Array<{ card_id: string; session_id: string | null; state: 'pending' | 'running' | 'complete' | 'needs_review' | 'manual_wait' }>;
    return rows.map((row) => ({ cardId: row.card_id, sessionId: row.session_id, state: row.state }));
  }
  beginWorkflowCard(id: string, stepIndex: number, cardId: string, sessionId: string): void {
    this.db.transaction(() => {
      const changed = this.db.prepare("UPDATE workflow_progress SET state = 'running', session_id = ? WHERE workflow_id = ? AND step_index = ? AND card_id = ? AND state IN ('pending', 'needs_review')").run(sessionId, id, stepIndex, cardId);
      if (!changed.changes) return;
      const row = this.db.prepare(`SELECT w.project_id, w.name, s.project_id AS session_project,
        EXISTS(SELECT 1 FROM queue_runs q WHERE q.workflow_id = w.id) AS queued
        FROM workflows w JOIN sessions s ON s.id = ? WHERE w.id = ?`).get(sessionId, id) as {
        project_id: string; name: string; session_project: string; queued: number;
      } | undefined;
      if (!row || row.project_id !== row.session_project) return;
      this.db.prepare(`UPDATE session_usage_origins SET origin = ?, workflow_id = ?, workflow_name = ? WHERE session_id = ?`)
        .run(row.queued ? 'queue' : 'workflow', id, row.name, sessionId);
    })();
  }
  markManualWait(id: string, stepIndex: number, cardId: string): void {
    this.db.prepare("UPDATE workflow_progress SET state = 'manual_wait' WHERE workflow_id = ? AND step_index = ? AND card_id = ? AND state = 'pending'").run(id, stepIndex, cardId);
  }
  confirmManualWait(id: string, stepIndex: number): boolean {
    const row = this.db.prepare("SELECT card_id FROM workflow_progress WHERE workflow_id = ? AND step_index = ? AND state = 'manual_wait' ORDER BY rowid LIMIT 1").get(id, stepIndex) as { card_id: string } | undefined;
    if (!row) return false;
    this.db.prepare("UPDATE workflow_progress SET state = 'complete' WHERE workflow_id = ? AND step_index = ? AND card_id = ? AND state = 'manual_wait'").run(id, stepIndex, row.card_id);
    return true;
  }
  isStepApproved(id: string, stepIndex: number): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM workflow_step_approvals WHERE workflow_id = ? AND step_index = ?').get(id, stepIndex));
  }
  approveStep(id: string, stepIndex: number): void {
    this.db.prepare('INSERT OR IGNORE INTO workflow_step_approvals VALUES (?, ?, ?)').run(id, stepIndex, now());
  }
  resetWorkflowReview(id: string, stepIndex: number): void {
    this.db.prepare("UPDATE workflow_progress SET state = 'pending', session_id = NULL WHERE workflow_id = ? AND step_index = ? AND state = 'needs_review'").run(id, stepIndex);
  }
  finishWorkflowCard(sessionId: string, complete: boolean): void {
    this.db.prepare("UPDATE workflow_progress SET state = ? WHERE session_id = ? AND state = 'running'").run(complete ? 'complete' : 'needs_review', sessionId);
  }
  workflowForSession(sessionId: string): { id: string; stepIndex: number; cardId: string } | null {
    const row = this.db.prepare('SELECT workflow_id, step_index, card_id FROM workflow_progress WHERE session_id = ?').get(sessionId) as { workflow_id: string; step_index: number; card_id: string } | undefined;
    return row ? { id: row.workflow_id, stepIndex: row.step_index, cardId: row.card_id } : null;
  }

  note(id: string): MemoryNote { return note(required(this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined, 'Memory note not found')); }
  importMemoryVaultNotes(projectId: string, entries: Array<{ title: string; body: string; tags: string[] }>): number {
    this.project(projectId);
    if (!entries.length || entries.length > 200) throw new Error('Bitte 1 bis 200 neue Notizen auswählen.');
    return this.db.transaction(() => {
      const all = this.snapshot(projectId).notes;
      const titles = new Set(all.map((item) => item.title.trim().toLocaleLowerCase()));
      for (const entry of entries) {
        const key = entry.title.trim().toLocaleLowerCase();
        if (!key || titles.has(key)) throw new Error(`Notiztitel bereits vorhanden: ${entry.title}`);
        titles.add(key);
      }
      const created = entries.map((entry) => this.saveNote({ projectId, ...entry, links: [] }));
      const byTitle = new Map([...all, ...created].map((item) => [item.title.trim().toLocaleLowerCase(), item.id]));
      for (const item of created) {
        const links = new Set<string>();
        for (const match of item.body.matchAll(/\[\[([^\]]+)\]\]/g)) {
          const target = byTitle.get(match[1]!.trim().toLocaleLowerCase());
          if (target && target !== item.id) links.add(target);
        }
        if (links.size) this.saveNote({ projectId, id: item.id, title: item.title, body: item.body, tags: item.tags, links: [...links] });
      }
      return created.length;
    })();
  }
  saveNote(input: { projectId: string; id?: string; title: string; body: string; tags: string[]; links: string[] }): MemoryNote {
    this.project(input.projectId);
    if (!Array.isArray(input.tags) || !Array.isArray(input.links) || input.tags.length > 50 || input.links.length > 100) throw new Error('Too many tags or links');
    const tags = input.tags.map((tag) => trimmed(tag, 'Tag', 80));
    const links = input.links.map((link) => trimmed(link, 'Link', 200));
    if (input.id && this.note(input.id).projectId !== input.projectId) throw new Error('Note belongs to another project');
    const stamp = now();
    const value: MemoryNote = { id: input.id ?? randomUUID(), projectId: input.projectId, title: trimmed(input.title, 'Note title'), body: optionalText(input.body, 'Note body', 200000), tags, links, createdAt: input.id ? this.note(input.id).createdAt : stamp, updatedAt: stamp };
    this.db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, tags_json=excluded.tags_json, links_json=excluded.links_json, updated_at=excluded.updated_at').run(value.id, value.projectId, value.title, value.body, json(value.tags), json(value.links), value.createdAt, value.updatedAt);
    return value;
  }
  deleteNote(id: string): void { this.note(id); this.db.prepare('DELETE FROM notes WHERE id = ?').run(id); }
}
