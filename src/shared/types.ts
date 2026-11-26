import type { ConflictRadarResult, ProjectConflictRadarResult } from './conflict-radar';
import type { DraftTurn, TaskDraftReply } from './task-draft';
import type { ProjectChatInput, ProjectChatReply } from './project-chat';
import type { CardDiffPreview, CreateReviewComment, ReviewComment } from './diff-review';
import type { ChangelogPeriod, ChangelogScope, ProjectChangelog } from './changelog';
import type { ThemeTokenInventory, ThemeTokenDefinition, ThemeTokenEditPreview, ThemeTokenEditResult } from './theme-tokens';
import type { CreateReviewRuleFromComment, ReviewRule, UpdateReviewRule } from './review-rules';
import type { ReviewInboxPage, ReviewInboxQuery, AcknowledgeReviewInboxComment, AcknowledgeQaInboxReport, AcknowledgeGuestInboxComment } from './review-inbox';
import type { CreateOutputErrorCard, OutputErrorPreview, OutputErrorSourceKind } from './output-errors';
import type { WhiteboardImpact, WhiteboardDirectImporter } from './whiteboard-impact';
import type { DesignElementPreviewInput, DesignInspectionState, DesignSelection, ThemePreviewInput } from './design-inspection';
import type { WhiteboardDiscussionInput, WhiteboardDiscussionReply } from './whiteboard-discussion';
import type { DesignStateRoute, DesignStateRouteInput, DesignStateRouteKey } from './design-state-routes';
import type { DesignA11yCheck } from './design-a11y';
import type { DesignViewportResult } from './design-viewports';
import type { ComponentCatalog } from './component-catalog';
import type { ComponentRecommendationResult } from './component-recommendations';
import type { AddCardComponentChoice, AddCardComponentVariant, CardComponentChoiceState, ProjectComponentLibrary } from './card-component-choice';
import type { GlobalInboxPage, GlobalInboxQuery } from './global-inbox';
import type { QaGitEvidence } from './qa-git-evidence';
import type { CardCriterion, CardCriterionEvidenceKind } from './card-acceptance';
import type { IdeaMatchKind, IdeaMatchPreview } from './idea-matches';
import type { SessionRunEvidence } from './session-evidence';
import type { AgentHandoffPreview, AgentHandoffReceipt, AgentHandoffSelection } from './agent-handoff';
import type { CardWireframe, CardWireframeKey, SaveCardWireframeInput, WireframeArtboard, WireframeProposal } from './card-wireframe';
import type { SaveWireframeComponentInput, WireframeComponent } from './wireframe-components';
import type { SessionRecoveryState } from './session-recovery';
import type { CardRunGate } from './parallel-runs';
import type { ProjectMemoryIndexStatus, ProjectMemorySearch, ProjectMemorySearchInput, ProjectMemorySourceDetail, ProjectMemorySourceInput } from './project-memory-index';
import type { ReleaseUpdateState } from './release-update';
import type { UsageSessionPage } from './usage';
import type { IntegrationItem } from './integration-queue';
import type { AgentQuestion, AnswerAgentQuestions } from './agent-questions';
import type { ConfirmTaskRevisionInput, TaskRevisionCleanupPreview, TaskRevisionHistory } from './task-revisions';

export type SessionState = 'running' | 'exited' | 'failed' | 'stopped';
export type WorkflowState = 'draft' | 'running' | 'paused' | 'done';
export type QueueState = 'off' | 'running' | 'paused';
export type CardPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type ColumnEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface Project { id: string; name: string; path: string; createdAt: string }
export interface ProjectGroup { id: string; name: string }
export type ProjectSort = 'name' | 'newest';
export interface ProjectOrganization { groups: ProjectGroup[]; assignments: Record<string, string>; sort: ProjectSort }
export type WhiteboardReference = { kind: 'card'; cardId: string } | { kind: 'folder' | 'file'; path: string };
export interface WhiteboardNode { id: string; projectId: string; title: string; description: string; x: number; y: number; reference: WhiteboardReference | null; createdAt: string; updatedAt: string }
export interface WhiteboardEdge { id: string; projectId: string; sourceId: string; targetId: string; label: string; createdAt: string; cardId: string | null }
export interface WhiteboardSnapshot { nodes: WhiteboardNode[]; edges: WhiteboardEdge[] }
export interface Column { id: string; projectId: string; name: string; position: number; autoStart: boolean; agentId: string | null; model: string | null; effort: ColumnEffort | null }
export interface Card { id: string; projectId: string; columnId: string; title: string; description: string; priority: CardPriority; labels: string[]; wireframeRequired: boolean; position: number; createdAt: string; updatedAt: string; archivedAt: string | null }
export type BulkCardAction = { projectId: string; cardIds: string[]; action: 'move'; columnId: string } | { projectId: string; cardIds: string[]; action: 'archive' } | { projectId: string; cardIds: string[]; action: 'priority'; priority: CardPriority };
export interface CardAttachment { id: string; cardId: string; name: string; size: number; addedAt: string; available: boolean; canOpen: boolean }
export type CardContextKind = 'file' | 'folder' | 'url' | 'design';
export interface CardDesignContextCandidate { selectionId: string; fingerprint: string; label: string; sourceUrl: string }
export interface CardContextReference { id: string; cardId: string; projectId: string; kind: CardContextKind; target: string; addedAt: string; available: boolean; label?: string | null; note?: string | null }
export interface CardContextPreview { id: string; kind: CardContextKind; target: string; text: string | null; truncated: boolean; note: string }
export interface AgentPreset { id: string; name: string; kind: 'codex' | 'claude' | 'gemini' | 'antigravity' | 'custom'; command: string; args: string[]; model: string | null; enabled: boolean }
export interface AgentDetection { kind: AgentPreset['kind']; command: string; available: boolean; version: string | null; status: 'ready' | 'found' | 'missing' | 'timeout' | 'error'; profileId?: string }
export type AgentCapability = 'start' | 'input' | 'stop' | 'resume';
export interface AgentCapabilityEvidence { agentId: string; capability: AgentCapability; sessionId: string; observedAt: string }
export interface Session { id: string; projectId: string; cardId: string; agentId: string; state: SessionState; startedAt: string; endedAt: string | null; exitCode: number | null; output: string; worktreePath?: string | null; codexThreadId?: string | null }
export interface InterruptedSessionReview { sessionId: string; projectId: string; cardId: string; cardTitle: string; agentName: string; interruptedAt: string; worktreePath: string | null }
export type CommandShell = 'powershell' | 'cmd';
export interface CommandTerminal { id: string; projectId: string; shell: CommandShell; state: SessionState; startedAt: string; endedAt: string | null; exitCode: number | null; output: string; cardId: string | null; worktreePath: string | null }
export interface CommandTerminalTarget { cardId: string; cardTitle: string; branch: string; path: string }
export interface CommandTerminalEvent { terminalId: string; projectId: string; type: 'output' | 'state'; data: string; state?: SessionState }
export interface SessionSearchHit { sessionId: string; cardId: string; cardTitle: string; agentName: string; startedAt: string; snippet: string }
export interface WorkflowStep { id: string; columnId: string; agentId: string | null; requireApproval: boolean; model?: string | null; effort?: ColumnEffort | null; useWorktree?: boolean; parallel?: boolean }
export interface WorkflowStepHaltpoint { id: string; afterStepIndex: number; stepId: string; state: 'requested' | 'reached'; requestedAt: string; reachedAt: string | null }
export interface Workflow { id: string; projectId: string; name: string; cardIds: string[]; steps: WorkflowStep[]; state: WorkflowState; currentStep: number; haltpoint?: WorkflowStepHaltpoint; pauseReason?: 'approval' | 'manual' | 'review' | 'wireframe' | 'haltpoint' | 'user'; startError?: { message: string; at: string }; queueSkip?: { reason: string; at: string }; createdAt: string; updatedAt: string }
export interface ProjectQueue { projectId: string; state: QueueState; templateWorkflowId: string | null; activeWorkflowId: string | null; pauseReason: string | null; completedCount: number; updatedAt: string | null; continueBlocked?: boolean; autoResumeIdle?: boolean; autoTest?: boolean; runUntil?: string | null }
export interface ProjectRunPauseActivity { kind: 'agent' | 'integration-test' | 'integration'; id: string; cardId: string; title: string; startedAt: string }
export interface ProjectRunPause { projectId: string; state: 'active' | 'requested' | 'paused'; requestedAt: string | null; running: ProjectRunPauseActivity[] }
export interface WorkflowAgentSettings { agentId: string | null; model: string | null; effort: 'low' | 'medium' | 'high' | null }
export interface WorkflowProposal { title: string; explanation: string; cards: Array<{ title: string; description: string }>; columnIds: string[] }
export interface MemoryNote { id: string; projectId: string; title: string; body: string; tags: string[]; links: string[]; createdAt: string; updatedAt: string }
export interface MemoryVaultExportResult { count: number; directory: string }
export interface MemoryVaultImportFile { key: string; title: string; tags: string[]; eligible: boolean; reason: string | null }
export interface MemoryVaultImportPreview { token: string; directoryName: string; files: MemoryVaultImportFile[]; eligible: number }
export interface MemoryVaultImportResult { count: number }
export interface ProjectPackagePreview { fingerprint: string; name: string; columns: number; cards: number; notes: number; workflows: number }
export interface ProjectPackageExportResult { file: string; columns: number; cards: number; notes: number; workflows: number }
export interface ProjectSnapshot { project: Project; columns: Column[]; cards: Card[]; agents: AgentPreset[]; sessions: Session[]; interruptedSessions?: InterruptedSessionReview[]; workflows: Workflow[]; notes: MemoryNote[]; queue: ProjectQueue; runPause: ProjectRunPause }
export interface SessionEvent { sessionId: string; cardId: string; type: 'output' | 'state'; data: string; state?: SessionState }
export interface BrowserBounds { x: number; y: number; width: number; height: number }
export interface BrowserTabState { id: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null }
export interface BrowserDiagnostic { id: string; kind: 'console' | 'load'; message: string; pageUrl: string; sourceUrl: string | null; line: number | null; capturedAt: string }
export interface BrowserState { tabs: BrowserTabState[]; activeTabId: string | null; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null; diagnostics: BrowserDiagnostic[] }
export interface BrowserCaptureResult { width: number; height: number }
export type CardQaPageObservation =
  | { kind: 'missing-title' }
  | { kind: 'missing-image-alt'; count: number; scanned: number }
  | { kind: 'horizontal-overflow'; pixels: number; clientWidth: number };
export type CardQaPageCheck = 'not-run' | 'complete' | 'partial' | 'unavailable';
export interface CardQaReport { id: string; cardId: string; projectId: string; requestedUrl: string; finalUrl: string | null; startedAt: string; endedAt: string; status: 'passed' | 'failed' | 'error'; diagnostics: BrowserDiagnostic[]; pageCheck: CardQaPageCheck; pageObservations: CardQaPageObservation[]; note: string | null; screenshotAvailable: boolean; viewportWidth: number; viewportHeight: number; gitEvidence: QaGitEvidence | null }
export type CardQaViewport = 'desktop' | 'tablet' | 'mobile';
export interface CardQaBatchResult { requested: number; reports: CardQaReport[]; error: string | null }
export interface TrelloImportCard { sourceId: string; title: string; description: string; labels: string[]; labelNote: string | null; listId: string | null; listName: string | null; archived: boolean; eligible: boolean; reason: string | null; importedCardId: string | null; importedIdeaId: string | null; sourceChange?: 'changed' | 'same' | 'unknown' }
export interface TrelloImportPreview { fingerprint: string; boardName: string | null; cards: TrelloImportCard[]; total: number; eligible: number; duplicates: number }
export interface TrelloImportResult { created: Card[]; skippedDuplicateIds: string[] }
export interface TrelloIdeaImportResult { created: import('./ideas').Idea[]; skippedDuplicateIds: string[] }
export interface TrelloIdeaComparison {
  fingerprint: string; sourceId: string; ideaId: string; ideaCardId: string | null;
  sourceTitle: string; sourceBody: string; localTitle: string; localBody: string;
  baselineTitle: string | null; baselineBody: string | null; localUpdatedAt: string; localSignature: string;
  sourceChange: 'changed' | 'same' | 'unknown'; localChange: 'changed' | 'same' | 'unknown';
  eligible: boolean; reason: string | null;
}
export interface TrelloBoardSummary { id: string; name: string }
export interface TrelloConnectionStatus { connected: boolean; memberName: string | null }
export interface WorktreeReview { cardId: string; path: string; branch: string; targetPath: string; targetBranch: string | null; sourceHead: string; targetHead: string; sourceStatus: string[]; targetStatus: string[]; uncommittedStat: string; committedStat: string; ahead: number; behind: number; canFastForward: boolean; blockers: string[]; previewToken: string }
export interface PrDraftPreview { cardId: string; sourceHead: string; targetHead: string; text: string; reportCount: number }

export type TeamDraftWindowEvent = { watchId: string; event: import('../main/team-remote-client').TeamDraftStreamEvent }
  | { watchId: string; type: 'error' | 'connected'; message?: string };

export interface StudioAPI {
  hostedTeamProject(projectId: string): Promise<import('../main/team-local-service').HostedTeamWorkspace | null>;
  createLocalTeamWorkspace(input: { projectId: string; workspaceName: string; ownerName: string }): Promise<import('../main/team-local-service').HostedTeamWorkspace>;
  inviteTeamMember(input: { projectId: string; role: 'admin' | 'editor' | 'developer' | 'viewer' }): Promise<{ inviteSecret: string; coordinatorUrl: string; expiresAt: string }>;
  revokeTeamMember(input: { projectId: string; memberId: string }): Promise<import('../main/team-local-service').HostedTeamWorkspace>;
  teamConnections(): Promise<import('../main/team-connection-store').SavedTeamConnection[]>;
  pendingTeamJoin(): Promise<{ coordinatorUrl: string; displayName: string } | null>;
  joinTeam(input: { coordinatorUrl: string; inviteSecret: string; displayName: string }): Promise<import('../main/team-connection-store').SavedTeamConnection>;
  resumeTeamJoin(): Promise<import('../main/team-connection-store').SavedTeamConnection>;
  cancelTeamJoin(): Promise<void>;
  teamWorkspace(workspaceId: string): Promise<{ member: import('../main/team-workspace').TeamMember; projects: Array<{ id: string; name: string; canEditDraft: boolean; canManageTask: boolean }> }>;
  teamBoard(input: { workspaceId: string; projectId: string }): Promise<import('../main/team-remote-client').CollaborativeTeamBoard>;
  setTeamCardPriority(input: { workspaceId: string; projectId: string; cardId: string; priority: CardPriority;
    expectedRevision: number; mutationId: string }): Promise<{ cardId: string; revision: number; priority: CardPriority; repeated: boolean }>;
  moveTeamCard(input: { workspaceId: string; projectId: string; cardId: string; columnId: string;
    expectedRevision: number; mutationId: string }): Promise<{ cardId: string; columnId: string; revision: number; repeated: boolean }>;
  teamCardDraft(input: { workspaceId: string; projectId: string; cardId: string }): Promise<import('../main/team-card-draft').TeamCardDraft>;
  updateTeamCardDraft(input: { workspaceId: string; projectId: string; cardId: string; mutationId: string; update: string }): Promise<import('../main/team-card-draft').TeamCardDraft & { repeated: boolean }>;
  pendingTeamCardDraftUpdates(input: { workspaceId: string; projectId: string; cardId: string }): Promise<import('../main/team-draft-outbox').PendingTeamDraftUpdate[]>;
  resumeTeamCardDraftUpdates(input: { workspaceId: string; projectId: string; cardId: string }): Promise<number>;
  startTeamDraftWatch(input: { watchId: string; workspaceId: string; projectId: string; cardId: string }): Promise<void>;
  stopTeamDraftWatch(watchId: string): Promise<void>;
  onTeamDraftEvent(callback: (event: TeamDraftWindowEvent) => void): () => void;
  apiContractOverview(projectId: string): Promise<import('./api-contract').ApiContractOverview>;
  previewApiContract(input: { projectId: string; draft: import('./api-contract').ApiContractDraft }): Promise<import('./api-contract').ApiContractPreview>;
  saveApiContract(input: { projectId: string; draft: import('./api-contract').ApiContractDraft; fingerprint: string; expectedLatestRevision: number }): Promise<import('./api-contract').ApiContractVersion>;
  bindCardApiContract(input: { projectId: string; cardId: string; revision: number | null; expectedContentRevision: number }): Promise<import('./api-contract').ApiContractOverview>;
  checkApiContractResponse(input: { projectId: string; revision: number; status: number; responseText: string }): Promise<import('./api-contract').ApiContractCheck>;
  apiContractMockState(projectId: string): Promise<import('./api-contract').ApiContractMockState>;
  startApiContractMock(input: { projectId: string; revision: number }): Promise<import('./api-contract').ApiContractMockState>;
  stopApiContractMock(projectId: string): Promise<import('./api-contract').ApiContractMockState>;
  checkApiContractEndpoint(input: { projectId: string; revision: number; baseUrl: string }): Promise<import('./api-contract').ApiContractLiveCheck>;
  apiContractLiveChecks(projectId: string): Promise<import('./api-contract').ApiContractLiveCheck[]>;
  requirementConflictBoard(projectId: string): Promise<import('./requirement-conflicts').RequirementConflictBoard>;
  addRequirementClaim(input: { projectId: string; cardId: string; criterionId: string; component: string; scope: string; property: string; stance: import('./requirement-conflicts').RequirementStance; expectedCardRevision: number; expectedCriterionText?: string; suggestionEvidence?: import('./requirement-conflicts').RequirementSuggestionEvidence }): Promise<import('./requirement-conflicts').RequirementConflictBoard>;
  refreshRequirementClaim(input: { projectId: string; claimId: string; expectedCardRevision: number }): Promise<import('./requirement-conflicts').RequirementConflictBoard>;
  removeRequirementClaim(input: { projectId: string; claimId: string }): Promise<import('./requirement-conflicts').RequirementConflictBoard>;
  resolveRequirementConflict(input: { projectId: string; pairKey: string; fingerprint: string; status: 'chosen' | 'dismissed'; winnerClaimId?: string | null; reason: string }): Promise<import('./requirement-conflicts').RequirementConflictBoard>;
  releaseUpdateState(): Promise<ReleaseUpdateState>;
  installReleaseUpdate(): Promise<ReleaseUpdateState>;
  laterReleaseUpdate(): Promise<ReleaseUpdateState>;
  onReleaseUpdateState(callback: (state: ReleaseUpdateState) => void): () => void;
  agentCardMetadataEnabled(projectId: string): Promise<boolean>;
  agentCardMetadataAvailable(): Promise<boolean>;
  setAgentCardMetadataEnabled(input: { projectId: string; enabled: boolean }): Promise<boolean>;
  agentCardMetadataAudit(projectId: string): Promise<import('./agent-card-metadata').AgentCardMetadataAudit[]>;
  agentBrowserPolicy(projectId: string): Promise<import('./agent-browser').AgentBrowserPolicy>;
  projectCodexWorkflowAccess(projectId: string): Promise<import('./project-agent-rights').ProjectCodexWorkflowAccess>;
  setProjectCodexWorkflowAccess(input: import('./project-agent-rights').SetProjectCodexWorkflowAccessInput): Promise<import('./project-agent-rights').ProjectCodexWorkflowAccess>;
  agentBrowserAvailable(): Promise<boolean>;
  setAgentBrowserPolicy(input: import('./agent-browser').AgentBrowserPolicy): Promise<import('./agent-browser').AgentBrowserPolicy>;
  devEnvironmentProfile(projectId: string): Promise<import('./dev-environment').DevEnvironmentProfile | null>;
  saveDevEnvironmentProfile(input: import('./dev-environment').SaveDevEnvironmentProfile): Promise<import('./dev-environment').DevEnvironmentProfile>;
  devEnvironmentAudit(input: { projectId: string; cardId: string }): Promise<import('./dev-environment').DevEnvironmentAuditEvent[]>;
  inspectDevEnvironment(input: { projectId: string; cardId: string }): Promise<import('./dev-environment').DevEnvironmentInspection>;
  adviseDevEnvironment(input: { projectId: string; cardId: string }): Promise<import('./dev-environment').GuidedDevEnvironmentAdvice>;
  applyGuidedDevEnvironment(input: { adviceId: string; projectId: string; cardId: string }): Promise<import('./dev-environment').DevEnvironmentProfile>;
  cardDevEnvironment(cardId: string): Promise<import('./dev-environment').CardDevEnvironment | null>;
  verifyCardDevEnvironment(input: { cardId: string; expectedRunId: string }): Promise<import('./dev-environment').CardDevEnvironment>;
  startCardDevEnvironment(input: { cardId: string; expectedProfileFingerprint: string }): Promise<import('./dev-environment').CardDevEnvironment>;
  stopCardDevEnvironment(runId: string): Promise<import('./dev-environment').CardDevEnvironment>;
  devAccountOverview(input: { projectId: string; cardId: string }): Promise<import('./dev-account').DevAccountOverview>;
  createDevAccount(input: import('./dev-account').CreateDevAccount): Promise<import('./dev-account').DevAccount>;
  assignDevAccount(input: { projectId: string; cardId: string; accountId: string | null; expectedCardRevision: number }): Promise<import('./dev-account').DevAccountOverview>;
  openDevAccount(cardId: string): Promise<string>;
  probeDevAccount(cardId: string): Promise<import('./dev-account').DevAccountProbe>;
  forgetDevAccountSession(input: { projectId: string; accountId: string }): Promise<void>;
  devAccountSavedLoginStatus(cardId: string): Promise<import('./dev-account').DevAccountSavedLoginStatus>;
  saveDevAccountLogin(cardId: string): Promise<import('./dev-account').DevAccountSavedLoginStatus>;
  devAccountSeedConfig(cardId: string): Promise<import('./dev-account').DevAccountSeedConfig | null>;
  saveDevAccountSeedConfig(input: { cardId: string; path: string }): Promise<import('./dev-account').DevAccountSeedConfig>;
  lastDevAccountSeedAttempt(input: { cardId: string; targetId: string }): Promise<import('./dev-account').DevAccountSeedAttempt | null>;
  checkDevAccountSeed(input: { cardId: string; targetId: string }): Promise<import('./dev-account').DevAccountSeedCheck>;
  createDevAccountSeed(input: { cardId: string; targetId: string; checkId: string }): Promise<import('./dev-account').DevAccountSeedAttempt>;
  projects(): Promise<Project[]>;
  projectOrganization(): Promise<ProjectOrganization>;
  createProjectGroup(name: string): Promise<ProjectOrganization>;
  renameProjectGroup(input: { groupId: string; name: string }): Promise<ProjectOrganization>;
  deleteProjectGroup(groupId: string): Promise<ProjectOrganization>;
  assignProjectGroup(input: { projectId: string; groupId: string | null }): Promise<ProjectOrganization>;
  setProjectSort(sort: ProjectSort): Promise<ProjectOrganization>;
  componentCatalog(projectId: string): Promise<ComponentCatalog>;
  componentRecommendations(cardId: string): Promise<ComponentRecommendationResult>;
  cardComponentChoiceState(cardId: string): Promise<CardComponentChoiceState>;
  projectComponentLibrary(projectId: string): Promise<ProjectComponentLibrary>;
  addCardComponentChoice(input: AddCardComponentChoice): Promise<CardComponentChoiceState>;
  removeCardComponentChoice(input: { cardId: string; choiceId: string; expectedContentRevision: number }): Promise<CardComponentChoiceState>;
  addCardComponentVariant(input: AddCardComponentVariant): Promise<CardComponentChoiceState>;
  removeCardComponentVariant(input: { cardId: string; variantId: string; expectedContentRevision: number }): Promise<CardComponentChoiceState>;
  cardComponentVariantScreenshot(input: { cardId: string; variantId: string }): Promise<string>;
  createProject(input: { name: string; path: string }): Promise<Project>;
  chooseProjectFolder(): Promise<string | null>;
  exportProjectPackage(projectId: string): Promise<ProjectPackageExportResult | null>;
  previewProjectPackage(): Promise<ProjectPackagePreview | null>;
  importProjectPackage(input: { fingerprint: string; name: string; path: string }): Promise<Project>;
  snapshot(projectId: string): Promise<ProjectSnapshot>;
  usageSessions(input: { projectId: string; since: string }): Promise<UsageSessionPage>;
  projectChangelog(input: { projectId: string; period: ChangelogPeriod; scope?: ChangelogScope }): Promise<ProjectChangelog>;
  listMilestones(projectId: string): Promise<import('./milestones').ProjectMilestone[]>;
  createMilestone(input: { projectId: string; label: string }): Promise<import('./milestones').ProjectMilestone>;
  createMilestoneWithPreview(input: { projectId: string; label: string; url: string }): Promise<import('./milestones').ProjectMilestone>;
  milestonePreviewImage(input: { projectId: string; milestoneId: string }): Promise<string>;
  compareMilestone(input: { projectId: string; milestoneId: string }): Promise<import('./milestones').MilestoneComparison>;
  checkoutMilestone(input: { projectId: string; milestoneId: string; confirm: boolean }): Promise<import('./milestones').MilestoneCheckout>;
  ideas(projectId: string): Promise<import('./ideas').Idea[]>;
  previewIdeaMatches(input: { projectId: string; ideaId: string }): Promise<IdeaMatchPreview>;
  linkIdeaMatch(input: { projectId: string; ideaId: string; kind: IdeaMatchKind; sourceId: string; expectedSignature: string }): Promise<IdeaMatchPreview>;
  unlinkIdeaMatch(input: { projectId: string; ideaId: string; kind: IdeaMatchKind; sourceId: string }): Promise<IdeaMatchPreview>;
  saveIdea(input: { projectId: string; id?: string; title: string; body: string; category: import('./ideas').IdeaCategory; turns: DraftTurn[] }): Promise<import('./ideas').Idea>;
  discussIdea(input: { projectId: string; turns: DraftTurn[]; title: string; body: string; category: import('./ideas').IdeaCategory }): Promise<import('./ideas').IdeaReply>;
  convertIdeaToCard(input: { projectId: string; ideaId: string; columnId: string }): Promise<Card>;
  previewTrelloIdeas(input: { projectId: string; json: string }): Promise<TrelloImportPreview>;
  acceptTrelloIdeas(input: { projectId: string; json: string; fingerprint: string; sourceIds: string[]; category: import('./ideas').IdeaCategory }): Promise<TrelloIdeaImportResult>;
  compareTrelloIdea(input: { projectId: string; json: string; sourceId: string }): Promise<TrelloIdeaComparison>;
  applyTrelloIdeaSource(input: { projectId: string; json: string; sourceId: string; fingerprint: string; localSignature: string; copyTitle: boolean; copyBody: boolean }): Promise<TrelloIdeaComparison>;
  previewTrelloBoardIdeas(input: { projectId: string; boardId: string }): Promise<TrelloImportPreview>;
  acceptTrelloBoardIdeas(input: { projectId: string; boardId: string; fingerprint: string; sourceIds: string[]; category: import('./ideas').IdeaCategory }): Promise<TrelloIdeaImportResult>;
  compareTrelloBoardIdea(input: { projectId: string; boardId: string; sourceId: string }): Promise<TrelloIdeaComparison>;
  applyTrelloBoardIdeaSource(input: { projectId: string; boardId: string; sourceId: string; fingerprint: string; localSignature: string; copyTitle: boolean; copyBody: boolean }): Promise<TrelloIdeaComparison>;
  whiteboard(projectId: string): Promise<WhiteboardSnapshot>;
  discussWhiteboardSelection(input: WhiteboardDiscussionInput): Promise<WhiteboardDiscussionReply>;
  themeTokens(projectId: string): Promise<ThemeTokenInventory>;
  previewThemeTokenEdit(input: { projectId: string; token: ThemeTokenDefinition; value: string }): Promise<ThemeTokenEditPreview>;
  applyThemeTokenEdit(input: { projectId: string; token: ThemeTokenDefinition; value: string; reviewToken: string; confirm: boolean }): Promise<ThemeTokenEditResult>;
  whiteboardImpact(input: { projectId: string; nodeId: string }): Promise<WhiteboardImpact>;
  createCardFromWhiteboardImpact(input: { projectId: string; nodeId: string; referencePath: string; site: WhiteboardDirectImporter; columnId: string; title: string; description: string }): Promise<Card>;
  previewRepoMap(projectId: string): Promise<import('./repo-map').RepoMapProposal>;
  acceptRepoMap(input: { projectId: string; fingerprint: string; nodeIds: string[] }): Promise<import('./repo-map').RepoMapImportResult>;
  createWhiteboardNode(input: { projectId: string; title: string; description?: string; x: number; y: number; reference?: WhiteboardReference | null }): Promise<WhiteboardNode>;
  updateWhiteboardNode(input: { projectId: string; id: string; title?: string; description?: string; x?: number; y?: number; reference?: WhiteboardReference | null; expectedUpdatedAt?: string }): Promise<WhiteboardNode>;
  deleteWhiteboardNode(input: { projectId: string; id: string }): Promise<void>;
  createWhiteboardEdge(input: { projectId: string; sourceId: string; targetId: string; label?: string; expectedSourceUpdatedAt?: string; expectedTargetUpdatedAt?: string }): Promise<WhiteboardEdge>;
  createCardFromWhiteboardEdge(input: { projectId: string; edgeId: string; columnId: string; title: string; description: string }): Promise<Card>;
  deleteWhiteboardEdge(input: { projectId: string; id: string }): Promise<void>;
  createColumn(input: { projectId: string; name: string; autoStart?: boolean; agentId?: string | null; model?: string | null; effort?: ColumnEffort | null }): Promise<Column>;
  updateColumn(input: { id: string; name?: string; autoStart?: boolean; agentId?: string | null; model?: string | null; effort?: ColumnEffort | null }): Promise<Column>;
  reorderColumn(input: { id: string; direction: 'left' | 'right' }): Promise<Column>;
  deleteColumn(id: string): Promise<void>;
  createCard(input: { projectId: string; columnId: string; title: string; description?: string; priority?: CardPriority; labels?: string[] }): Promise<Card>;
  designTaskCandidate(input: { projectId: string; selectionId: string }): Promise<CardDesignContextCandidate>;
  createCardFromDesignRequest(input: { projectId: string; selectionId: string; expectedFingerprint: string; columnId: string; title: string; description: string }): Promise<Card>;
  updateCard(input: { id: string; title?: string; description?: string; priority?: CardPriority; labels?: string[]; wireframeRequired?: boolean }): Promise<Card>;
  taskRevisionHistory(input: { projectId: string; cardId: string }): Promise<TaskRevisionHistory>;
  previewTaskRevisionCleanup(input: { projectId: string; cardId: string; revisionId: string }): Promise<TaskRevisionCleanupPreview>;
  confirmTaskRevision(input: ConfirmTaskRevisionInput): Promise<TaskRevisionHistory>;
  submitTaskRevision(input: { projectId: string; cardId: string; revisionId: string; sessionId: string }): Promise<TaskRevisionHistory>;
  cardSplitLinks(cardId: string): Promise<import('./card-split').CardSplitLinks>;
  previewCardSplit(input: import('./card-split').CardSplitInput): Promise<import('./card-split').CardSplitPreview>;
  createCardSplit(input: import('./card-split').CardSplitInput & { token: string; confirm: boolean }): Promise<import('./card-split').CardSplitResult>;
  cardCriteria(cardId: string): Promise<CardCriterion[]>;
  createCardCriterion(input: { cardId: string; text: string }): Promise<CardCriterion[]>;
  updateCardCriterion(input: { cardId: string; criterionId: string; text: string }): Promise<CardCriterion[]>;
  deleteCardCriterion(input: { cardId: string; criterionId: string }): Promise<CardCriterion[]>;
  linkCardCriterionEvidence(input: { cardId: string; criterionId: string; kind: CardCriterionEvidenceKind; sourceId: string; note: string }): Promise<CardCriterion[]>;
  unlinkCardCriterionEvidence(input: { cardId: string; criterionId: string; evidenceId: string }): Promise<CardCriterion[]>;
  moveCard(input: { id: string; columnId: string }): Promise<Card>;
  bulkUpdateCards(input: BulkCardAction): Promise<Card[]>;
  reorderCard(input: { id: string; direction: 'up' | 'down' }): Promise<Card>;
  setCardArchived(input: { id: string; archived: boolean }): Promise<Card>;
  copyCardId(input: { projectId: string; cardId: string }): Promise<void>;
  cardAttachments(cardId: string): Promise<CardAttachment[]>;
  chooseCardAttachments(cardId: string): Promise<CardAttachment[] | null>;
  openCardAttachment(input: { cardId: string; attachmentId: string }): Promise<void>;
  removeCardAttachment(input: { cardId: string; attachmentId: string }): Promise<void>;
  cardContextReferences(cardId: string): Promise<CardContextReference[]>;
  cardContextCandidateFromAttachment(input: { cardId: string; attachmentId: string }): Promise<string>;
  cardContextCandidateFromWhiteboardNode(input: { cardId: string; nodeId: string }): Promise<{ kind: 'file' | 'folder'; target: string }>;
  addCardContextReferenceFromWhiteboardNode(input: { cardId: string; nodeId: string; expectedKind: 'file' | 'folder'; expectedTarget: string }): Promise<CardContextReference[]>;
  cardContextCandidateFromDesignSelection(input: { cardId: string; selectionId: string }): Promise<CardDesignContextCandidate>;
  addCardContextReferenceFromDesignSelection(input: { cardId: string; selectionId: string; expectedFingerprint: string; note: string }): Promise<CardContextReference[]>;
  addCardContextReference(input: { cardId: string; kind: CardContextKind; target: string }): Promise<CardContextReference[]>;
  previewCardContextReference(input: { cardId: string; referenceId: string }): Promise<CardContextPreview>;
  removeCardContextReference(input: { cardId: string; referenceId: string }): Promise<CardContextReference[]>;
  agents(): Promise<AgentPreset[]>;
  detectAgents(): Promise<AgentDetection[]>;
  agentCapabilityEvidence(): Promise<AgentCapabilityEvidence[]>;
  sessionRecovery(sessionId: string): Promise<SessionRecoveryState>;
  cardRunGate(cardId: string): Promise<CardRunGate>;
  setProjectRunCapacity(input: { projectId: string; capacity: number }): Promise<number>;
  setCardRunDependencies(input: { cardId: string; prerequisiteCardIds: string[] }): Promise<CardRunGate>;
  approveCardDependency(input: { cardId: string; prerequisiteCardId?: string; qaReportId: string; note: string }): Promise<CardRunGate>;
  saveAgent(input: Omit<AgentPreset, 'id'> & { id?: string }): Promise<AgentPreset>;
  startSession(input: { cardId: string; agentId?: string; prompt?: string; useWorktree?: boolean }): Promise<Session>;
  resumeCodexSession(input: { sessionId: string; picker?: boolean }): Promise<Session>;
  acknowledgeInterruptedSession(input: { projectId: string; sessionId: string }): Promise<void>;
  sendSession(input: { sessionId: string; text: string }): Promise<void>;
  writeSessionInput(input: { sessionId: string; data: string }): Promise<void>;
  resizeSession(input: { sessionId: string; cols: number; rows: number }): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  commandTerminals(projectId: string): Promise<CommandTerminal[]>;
  commandTerminalTargets(projectId: string): Promise<CommandTerminalTarget[]>;
  startCommandTerminal(input: { projectId: string; shell: CommandShell; cardId?: string | null }): Promise<CommandTerminal>;
  writeCommandTerminal(input: { terminalId: string; data: string }): Promise<void>;
  resizeCommandTerminal(input: { terminalId: string; cols: number; rows: number }): Promise<void>;
  stopCommandTerminal(terminalId: string): Promise<void>;
  onCommandTerminalEvent(callback: (event: CommandTerminalEvent) => void): () => void;
  searchSessionTranscripts(input: { projectId: string; query: string }): Promise<SessionSearchHit[]>;
  refreshProjectMemoryIndex(projectId: string, force?: boolean): Promise<ProjectMemoryIndexStatus>;
  searchProjectMemoryIndex(input: ProjectMemorySearchInput): Promise<ProjectMemorySearch>;
  projectMemoryMapSources(projectId: string): Promise<import('./project-memory-index').ProjectMemoryMapSources>;
  readProjectMemorySource(input: ProjectMemorySourceInput): Promise<ProjectMemorySourceDetail | null>;
  sessionForProject(input: { projectId: string; sessionId: string }): Promise<Session>;
  sessionRunEvidence(input: { projectId: string; sessionId: string }): Promise<SessionRunEvidence>;
  linkSessionQa(input: { projectId: string; sessionId: string; reportId: string }): Promise<SessionRunEvidence>;
  unlinkSessionQa(input: { projectId: string; sessionId: string; reportId: string }): Promise<SessionRunEvidence>;
  previewAgentHandoff(input: { projectId: string; cardId: string; sourceSessionId: string; targetAgentId: string; useWorktree: boolean }): Promise<AgentHandoffPreview>;
  startAgentHandoff(input: { preview: AgentHandoffPreview; selected: AgentHandoffSelection[] }): Promise<Session>;
  agentHandoffReceipt(input: { projectId: string; sessionId: string }): Promise<AgentHandoffReceipt | null>;
  createWorkflow(input: { projectId: string; name: string; cardIds: string[]; steps: WorkflowStep[] }): Promise<Workflow>;
  updateDraftWorkflow(input: { id: string; name: string; cardIds: string[]; steps: WorkflowStep[] }): Promise<Workflow>;
  deleteDraftWorkflow(id: string): Promise<string>;
  setWorkflowState(input: { id: string; state: 'running' | 'paused' }): Promise<Workflow>;
  setWorkflowStepHaltpoint(input: { id: string; afterStepIndex: number | null }): Promise<Workflow>;
  workflowRunEvidence(input: { projectId: string; workflowId: string }): Promise<import('./workflow-evidence').WorkflowRunEvidence>;
  queueStartPreview(input: { projectId: string; templateWorkflowId: string; durationHours: 0 | 1 | 4 | 8 }): Promise<import('./queue-start-review').QueueStartReview>;
  setProjectQueue(input: { projectId: string; state: QueueState; templateWorkflowId?: string; runUntil?: string | null;
    durationHours?: 0 | 1 | 4 | 8; reviewToken?: string }): Promise<ProjectQueue>;
  setQueueContinueBlocked(input: { projectId: string; enabled: boolean }): Promise<ProjectQueue>;
  setQueueAutoResumeIdle(input: { projectId: string; enabled: boolean }): Promise<ProjectQueue>;
  setQueueAutoTest(input: { projectId: string; enabled: boolean; confirm: boolean }): Promise<ProjectQueue>;
  setProjectRunPause(input: { projectId: string; paused: boolean }): Promise<ProjectRunPause>;
  queueCandidates(projectId: string): Promise<Card[]>;
  queueResults(projectId: string): Promise<import('./queue-results').QueueResults>;
  skipQueuedCard(input: { projectId: string; workflowId: string; reason: string }): Promise<ProjectQueue>;
  workflowAgentSettings(): Promise<WorkflowAgentSettings>;
  saveWorkflowAgentSettings(input: WorkflowAgentSettings): Promise<WorkflowAgentSettings>;
  proposeWorkflow(input: { projectId: string; request: string }): Promise<WorkflowProposal>;
  proposeReviewedWorkflow(input: { projectId: string; request: string }): Promise<import('./plan-review').ReviewedPlan>;
  reviewedPlans(projectId: string): Promise<import('./plan-review').ReviewedPlan[]>;
  planComments(planId: string): Promise<import('./plan-review').PlanComment[]>;
  createPlanComment(input: { planId: string; fingerprint: string; line: number; body: string }): Promise<import('./plan-review').PlanComment>;
  acceptReviewedPlan(input: { planId: string; fingerprint: string }): Promise<Workflow>;
  discussTaskDraft(input: { projectId: string; turns: DraftTurn[] }): Promise<TaskDraftReply>;
  discussProject(input: ProjectChatInput): Promise<ProjectChatReply>;
  acceptWorkflowProposal(input: { projectId: string; proposal: WorkflowProposal }): Promise<Workflow>;
  previewTrelloImport(input: { projectId: string; json: string }): Promise<TrelloImportPreview>;
  acceptTrelloImport(input: { projectId: string; columnId: string; columnByListId?: Record<string, string>; json: string; fingerprint: string; sourceIds: string[] }): Promise<TrelloImportResult>;
  trelloConnectionStatus(): Promise<TrelloConnectionStatus>;
  trelloSignInAvailable(): Promise<boolean>;
  signInWithTrello(): Promise<TrelloConnectionStatus>;
  cancelTrelloSignIn(): Promise<void>;
  openTrelloAppAdmin(): Promise<void>;
  openTrelloAuthorization(key: string): Promise<void>;
  connectTrello(input: { key: string; token: string }): Promise<TrelloConnectionStatus>;
  disconnectTrello(): Promise<void>;
  trelloBoards(): Promise<TrelloBoardSummary[]>;
  previewTrelloBoard(input: { projectId: string; boardId: string }): Promise<TrelloImportPreview>;
  acceptTrelloBoard(input: { projectId: string; columnId: string; columnByListId?: Record<string, string>; boardId: string; fingerprint: string; sourceIds: string[] }): Promise<TrelloImportResult>;
  reviewCardWorktree(cardId: string): Promise<WorktreeReview | null>;
  openCardWorktree(input: { projectId: string; cardId: string }): Promise<void>;
  previewCardWorktreeCleanup(cardId: string): Promise<import('./worktree-cleanup').WorktreeCleanupPreview | null>;
  previewPrDraft(cardId: string): Promise<PrDraftPreview | null>;
  previewCardDiff(cardId: string): Promise<CardDiffPreview | null>;
  listReviewComments(cardId: string): Promise<ReviewComment[]>;
  createReviewComment(input: CreateReviewComment): Promise<ReviewComment>;
  reviewInboxItems(input: ReviewInboxQuery): Promise<ReviewInboxPage>;
  agentQuestions(projectId: string): Promise<AgentQuestion[]>;
  agentQuestionDecisionCount(projectId: string): Promise<number>;
  answerAgentQuestions(input: AnswerAgentQuestions): Promise<AgentQuestion[]>;
  globalInboxItems(input: GlobalInboxQuery): Promise<GlobalInboxPage>;
  acknowledgeReviewInboxComment(input: AcknowledgeReviewInboxComment): Promise<void>;
  acknowledgeQaInboxReport(input: AcknowledgeQaInboxReport): Promise<void>;
  acknowledgeGuestInboxComment(input: AcknowledgeGuestInboxComment): Promise<void>;
  reviewRules(projectId: string): Promise<ReviewRule[]>;
  createReviewRuleFromComment(input: CreateReviewRuleFromComment): Promise<ReviewRule>;
  updateReviewRule(input: UpdateReviewRule): Promise<ReviewRule>;
  deleteReviewRule(input: { projectId: string; id: string }): Promise<void>;
  reviewCardConflicts(cardId: string): Promise<ConflictRadarResult>;
  reviewProjectConflicts(projectId: string): Promise<ProjectConflictRadarResult>;
  integrationQueue(projectId: string): Promise<IntegrationItem[]>;
  integrationResultFolder(projectId: string): Promise<import('./integration-results').IntegrationResultFolder>;
  integrationPolicy(projectId: string): Promise<import('./integration-queue').IntegrationPolicy>;
  setIntegrationPolicy(input: { projectId: string; mode: 'manual' | 'automatic'; confirm: boolean }): Promise<import('./integration-queue').IntegrationPolicy>;
  manualRevisionFiles(cardId: string): Promise<string[]>;
  manualRevisions(cardId: string): Promise<import('./manual-revision').ManualRevision[]>;
  captureManualRevision(input: { cardId: string; path: string }): Promise<import('./manual-revision').ManualRevision>;
  previewManualRevision(id: string): Promise<import('./manual-revision').ManualMergePreview>;
  setManualRevisionConflictChoice(input: { revisionId: string; previewToken: string; conflictId: string;
    choice: 'manual' | 'agent' | 'custom' | null; customText?: string }): Promise<import('./manual-revision').ManualMergePreview>;
  applyManualRevision(input: { revisionId: string; previewToken: string; resolutionToken?: string; confirm: boolean }): Promise<import('./manual-revision').ManualRevision>;
  enqueueIntegration(cardId: string): Promise<IntegrationItem>;
  prepareIntegration(cardId: string): Promise<IntegrationItem>;
  divergentIntegration(cardId: string): Promise<import('./divergent-integration').DivergentIntegration | null>;
  startDivergentIntegration(cardId: string): Promise<import('./divergent-integration').DivergentIntegration>;
  retryMissingDivergentIntegration(cardId: string): Promise<import('./divergent-integration').DivergentIntegration>;
  divergentIntegrationDiff(cardId: string): Promise<string>;
  openDivergentIntegration(cardId: string): Promise<void>;
  approveIntegration(input: { cardId: string; confirm: boolean }): Promise<IntegrationItem>;
  integrationEvidence(cardId: string): Promise<import('./integration-evidence').IntegrationEvidence>;
  setIntegrationTestScript(input: { projectId: string; scriptName: string }): Promise<string | null>;
  attestIntegrationReview(input: { cardId: string; confirm: boolean }): Promise<import('./integration-evidence').IntegrationEvidence>;
  runIntegrationTest(cardId: string): Promise<import('./integration-evidence').IntegrationTestEvidence>;
  saveNote(input: { projectId: string; id?: string; title: string; body: string; tags: string[]; links: string[] }): Promise<MemoryNote>;
  memoryGitCandidates(projectId: string): Promise<import('./memory-git-source').MemoryGitCommit[]>;
  memoryGitSource(input: { projectId: string; noteId: string }): Promise<import('./memory-git-source').MemoryGitSource | null>;
  attachMemoryGitSource(input: { projectId: string; noteId: string; commit: string }): Promise<import('./memory-git-source').MemoryGitSource>;
  removeMemoryGitSource(input: { projectId: string; noteId: string }): Promise<void>;
  deleteNote(id: string): Promise<void>;
  exportMemoryVault(projectId: string): Promise<MemoryVaultExportResult | null>;
  previewMemoryVaultImport(projectId: string): Promise<MemoryVaultImportPreview | null>;
  acceptMemoryVaultImport(input: { projectId: string; token: string; keys: string[] }): Promise<MemoryVaultImportResult>;
  transcribe(audio: Uint8Array): Promise<string>;
  onSessionEvent(callback: (event: SessionEvent) => void): () => void;
  browserState(): Promise<BrowserState>;
  browserNavigate(address: string): Promise<BrowserState>;
  browserBack(): Promise<BrowserState>;
  browserForward(): Promise<BrowserState>;
  browserReload(): Promise<BrowserState>;
  browserCapture(): Promise<BrowserCaptureResult>;
  browserOpenExternal(): Promise<void>;
  browserNewTab(): Promise<BrowserState>;
  browserSelectTab(id: string): Promise<BrowserState>;
  browserCloseTab(id: string): Promise<BrowserState>;
  browserSetVisible(visible: boolean): Promise<BrowserState>;
  browserSetBounds(bounds: BrowserBounds | null): Promise<BrowserState>;
  browserCreateDiagnosticCard(input: { projectId: string; columnId: string; diagnosticId: string; reproduction: string }): Promise<Card>;
  startBugCapture(projectId: string): Promise<void>;
  markBugResize(): Promise<void>;
  stopBugCapture(): Promise<import('./bug-replay').BugCaptureDraft>;
  discardBugCapture(): Promise<void>;
  saveBugScenario(input: { token: string; cardId: string; actions: import('./bug-replay').BugReplayAction[];
    expectation: { target: import('./bug-replay').BugReplayTarget; state: 'visible' | 'hidden' } }): Promise<import('./bug-replay').BugScenario>;
  bugScenarios(cardId: string): Promise<import('./bug-replay').BugScenario[]>;
  bugScenarioRuns(scenarioId: string): Promise<import('./bug-replay').BugReplayResult[]>;
  runBugScenario(scenarioId: string): Promise<import('./bug-replay').BugReplayResult>;
  cardQaReports(cardId: string): Promise<CardQaReport[]>;
  runCardQa(input: { cardId: string; url: string; viewport: CardQaViewport }): Promise<CardQaReport>;
  runCardQaBatch(input: { cardId: string; urls: string[]; viewport: CardQaViewport }): Promise<CardQaBatchResult>;
  cardQaScreenshot(input: { cardId: string; reportId: string }): Promise<string>;
  startTeamReviewRoom(input: { projectId: string; cardId: string; qaReportId: string; scenario: string; reviewerName: string }): Promise<{ room: import('./team-review').TeamReviewRoom; invite: import('./team-review').TeamReviewInvite; reviewerSecret: string; url: string }>;
  teamReviewRooms(cardId: string): Promise<import('./team-review').TeamReviewRoom[]>;
  teamReviewInvites(roomId: string): Promise<import('./team-review').TeamReviewInvite[]>;
  teamReviewComments(roomId: string): Promise<import('./team-review').TeamReviewComment[]>;
  teamReviewRevision(roomId: string): Promise<import('./team-review').TeamReviewRevision>;
  teamReviewImage(roomId: string): Promise<string>;
  newTeamReviewInvite(input: { roomId: string; reviewerName: string }): Promise<{ invite: import('./team-review').TeamReviewInvite; reviewerSecret: string; url: string }>;
  newTailnetTeamReviewInvite(input: { roomId: string; reviewerName: string }): Promise<{ invite: import('./team-review').TeamReviewInvite; reviewerSecret: string; url: string }>;
  revokeTeamReviewInvite(input: { roomId: string; inviteId: string }): Promise<import('./team-review').TeamReviewInvite>;
  closeTeamReviewRoom(roomId: string): Promise<import('./team-review').TeamReviewRoom>;
  openTeamReviewInvite(input: { secret: string; transport: 'local' | 'tailnet' }): Promise<void>;
  copyTeamReviewInvite(input: { secret: string; transport: 'local' | 'tailnet' }): Promise<void>;
  createTeamBoardInvite(input: { projectId: string; displayName: string; transport: 'local' | 'tailnet'; canComment?: boolean }): Promise<{ invite: import('./team-board').TeamBoardInvite; secret: string; url: string }>;
  teamBoardInvites(projectId: string): Promise<import('./team-board').TeamBoardInvite[]>;
  teamBoardComments(projectId: string): Promise<import('./team-board').TeamBoardComment[]>;
  teamBoardCardComments(input: { projectId: string; cardId: string }): Promise<import('./team-board').TeamBoardComment[]>;
  revokeTeamBoardInvite(input: { projectId: string; inviteId: string }): Promise<import('./team-board').TeamBoardInvite>;
  openTeamBoardInvite(input: { secret: string; transport: 'local' | 'tailnet' }): Promise<void>;
  copyTeamBoardInvite(input: { secret: string; transport: 'local' | 'tailnet' }): Promise<void>;
  qaCoverageRoutes(projectId: string): Promise<import('./qa-coverage').QaCoverageRoute[]>;
  saveQaCoverageRoute(input: import('./qa-coverage').SaveQaCoverageRoute): Promise<import('./qa-coverage').QaCoverageRoute>;
  removeQaCoverageRoute(input: { projectId: string; routeId: string }): Promise<void>;
  runQaCoverageCell(input: { projectId: string; routeId: string; viewport: CardQaViewport }): Promise<CardQaReport>;
  previewQaFixCard(input: { projectId: string; sourceCardId: string; reportId: string }): Promise<import('./qa-fix-card').QaFixCardPreview>;
  createQaFixCard(input: import('./qa-fix-card').CreateQaFixCard): Promise<Card>;
  designSelections(projectId: string): Promise<DesignSelection[]>;
  cardWireframe(input: CardWireframeKey): Promise<CardWireframe | null>;
  exportWireframePng(input: { projectId: string; cardId: string; artboard: WireframeArtboard; dataUrl: string }): Promise<{ file: string } | null>;
  saveCardWireframe(input: SaveCardWireframeInput): Promise<CardWireframe>;
  approveCardWireframe(input: CardWireframeKey & { expectedRevision: number }): Promise<CardWireframe>;
  proposeCardWireframe(input: CardWireframeKey): Promise<WireframeProposal>;
  listWireframeComponents(projectId: string): Promise<WireframeComponent[]>;
  saveWireframeComponent(input: SaveWireframeComponentInput): Promise<WireframeComponent>;
  removeWireframeComponent(input: { projectId: string; id: string }): Promise<void>;
  designStateRoutes(projectId: string): Promise<DesignStateRoute[]>;
  saveDesignStateRoute(input: DesignStateRouteInput): Promise<DesignStateRoute>;
  removeDesignStateRoute(input: DesignStateRouteKey): Promise<void>;
  openDesignStateRoute(input: DesignStateRouteKey): Promise<DesignInspectionState>;
  designInspectionState(): Promise<DesignInspectionState>;
  designInspectionApplyThemePreview(input: ThemePreviewInput): Promise<DesignInspectionState>;
  designInspectionResetThemePreview(projectId: string): Promise<DesignInspectionState>;
  designInspectionApplyElementPreview(input: DesignElementPreviewInput): Promise<DesignInspectionState>;
  designInspectionResetElementPreview(projectId: string): Promise<DesignInspectionState>;
  designInspectionStart(input: { projectId: string; url: string }): Promise<DesignInspectionState>;
  designInspectionArm(projectId: string): Promise<DesignInspectionState>;
  designInspectionSelectSelector(input: { projectId: string; selector: string }): Promise<DesignSelection>;
  designInspectionCheckA11y(input: { projectId: string; selectionId: string }): Promise<DesignA11yCheck>;
  designInspectionSetBounds(bounds: BrowserBounds | null): Promise<DesignInspectionState>;
  designInspectionSetVisible(visible: boolean): Promise<DesignInspectionState>;
  designViewportCapture(projectId: string): Promise<DesignViewportResult>;
  designViewportCancel(projectId: string): Promise<void>;
  onDesignSelection(callback: (selection: DesignSelection) => void): () => void;
  previewOutputErrors(input: { projectId: string; sourceKind: OutputErrorSourceKind; sourceId: string }): Promise<OutputErrorPreview>;
  createOutputErrorCard(input: CreateOutputErrorCard): Promise<Card>;
  onBrowserState(callback: (state: BrowserState) => void): () => void;
  onBrowserSearchShortcut(callback: () => void): () => void;
}
