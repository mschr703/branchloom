import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, safeStorage, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import type { AgentPreset, CommandTerminalEvent, QueueState, SessionEvent, StudioAPI, WorkflowAgentSettings, WorkflowProposal, WorkflowStep } from '../shared/types';
import { StudioBrowser } from './browser';
import { projectMemoryMapSources, readProjectMemorySource, refreshProjectMemoryIndex, searchProjectMemoryIndex } from './project-memory-index';
import { createDiagnosticCard } from './error-catcher';
import { cardQaReports, cardQaScreenshot, runCardQa, runCardQaBatch } from './card-qa';
import { closeTeamReviewRoom, createTeamReviewInvite, createTeamReviewRoom, resolveTeamReviewInvite, revokeTeamReviewInvite, teamReviewComments, teamReviewImage, teamReviewInvites, teamReviewRevision, teamReviewRooms } from './team-review';
import { TeamReviewHttp } from './team-review-http';
import { createTeamBoardInvite, resolveTeamBoardInvite, revokeTeamBoardInvite, teamBoardInvites } from './team-board';
import { TeamBoardHttp } from './team-board-http';
import { activeTailnetIPv4 } from './team-review-tailnet';
import { bugScenarios, bugScenarioRuns, runBugScenario, saveBugScenario } from './bug-replay';
import { qaCoverageRoutes, saveQaCoverageRoute, removeQaCoverageRoute, runQaCoverageCell } from './qa-coverage';
import { cardCriteria, createCardCriterion, updateCardCriterion, deleteCardCriterion, linkCardCriterionEvidence, unlinkCardCriterionEvidence } from './card-acceptance';
import { cardSplitLinks, createCardSplit, previewCardSplit } from './card-split';
import { createQaFixCard, previewQaFixCard } from './qa-fix-card';
import { DesignInspector, designSelections, saveDesignSelection } from './design-inspection';
import { approveCardWireframe, approvedCardWireframeContext, cardWireframe, saveCardWireframe } from './card-wireframe';
import { listWireframeComponents, removeWireframeComponent, saveWireframeComponent } from './wireframe-components';
import { checkedWireframePng, wireframeExportFilename, writeWireframePngExclusive } from './wireframe-export';
import { proposeCardWireframe } from './wireframe-proposal';
import { designStateRoute, designStateRoutes, removeDesignStateRoute, saveDesignStateRoute } from './design-state-routes';
import { addCardContextReference, addCardContextReferenceFromDesignSelection, addCardContextReferenceFromWhiteboardNode, cardContextCandidateFromAttachment, cardContextCandidateFromDesignSelection, cardContextCandidateFromWhiteboardNode, cardContextReferences, createCardFromDesignRequest, designTaskCandidate, previewCardContextReference, removeCardContextReference } from './card-context';
import { createOutputErrorCard, previewOutputErrors } from './output-errors';
import { BrowserSessionPersistence } from './browser-persistence';
import { detectAgents, SessionRunner } from './cli';
import { confirmTaskRevision, submitTaskRevision, taskRevisionHistory } from './task-revisions';
import { previewTaskRevisionCleanup } from './task-revision-cleanup';
import { CommandTerminalRunner } from './command-terminal';
import { ensureCardWorktree, previewCardWorktreeCleanup, reviewCardWorktree, verifiedCardWorktreePath } from './git-worktree';
import { advanceAutomaticIntegrations, approveIntegration, enqueueIntegration, integrationPolicy, integrationQueue, prepareIntegration, setIntegrationPolicy } from './integration-queue';
import { divergentIntegration, divergentIntegrationDiff, retryMissingDivergentIntegration, startDivergentIntegration } from './divergent-integration';
import { integrationResultFolder } from './integration-results';
import { runG02VisibleSmoke } from './smoke-g02';
import { runG02AutoSmoke } from './smoke-g02-auto';
import { runUsageSmoke } from './smoke-usage';
import { runChatCanvasSmoke } from './smoke-chat-canvas';
import { runChangelogVisibleSmoke } from './smoke-changelog';
import { runWhiteboardVisibleSmoke } from './smoke-whiteboard';
import { applyManualRevision, captureManualRevision, manualRevisionFiles, manualRevisions, previewManualRevision, setManualRevisionConflictChoice } from './manual-revision';
import { runF03Acceptance } from './f03-acceptance-smoke';
import { attestIntegrationReview, integrationEvidence, runIntegrationTest, setIntegrationTestScript } from './integration-evidence';
import { previewPrDraft } from './pr-draft';
import { scanProjectComponents } from './component-catalog';
import { componentRecommendations } from './component-recommendations';
import { addCardComponentChoice, addCardComponentVariant, cardComponentChoiceState, cardComponentVariantScreenshot, projectComponentLibrary, removeCardComponentChoice, removeCardComponentVariant } from './card-component-choice';
import { checkoutMilestone, compareMilestone, createMilestone, createMilestoneWithPreview, listMilestones, milestonePreviewImage } from './milestones';
import { createReviewComment, listReviewComments, previewCardDiff } from './diff-review';
import { acknowledgeQaInboxReport, acknowledgeReviewInboxComment, reviewInboxItems } from './review-inbox';
import { agentQuestions, answerAgentQuestions } from './agent-questions';
import { globalInboxItems } from './global-inbox';
import { acceptReviewedPlan, createPlanComment, listPlanComments, listReviewedPlans, saveReviewedPlan } from './plan-review';
import { createReviewRuleFromComment, deleteReviewRule, listReviewRules, updateReviewRule } from './review-rules';
import { reviewCardWorktreeConflicts, reviewProjectConflicts } from './conflict-radar';
import { exportMemoryVaultToDirectory } from './memory-vault';
import { scanMemoryVault } from './memory-vault-import';
import { attachMemoryGitSource, memoryGitCandidates, memoryGitSource, removeMemoryGitSource } from './memory-git-source';
import { StudioStore } from './store';
import { apiContractOverview, bindCardApiContract, checkApiContractResponse, previewApiContract, saveApiContract } from './api-contract';
import { ApiContractHttp } from './api-contract-http';
import { addRequirementClaim, refreshRequirementClaim, removeRequirementClaim, requirementConflictBoard, resolveRequirementConflict } from './requirement-conflicts';
import { createCardFromWhiteboardEdge, createWhiteboardEdge, createWhiteboardNode, deleteWhiteboardEdge, deleteWhiteboardNode, updateWhiteboardNode, whiteboardSnapshot } from './whiteboard';
import { discussWhiteboardSelection } from './whiteboard-discussion';
import { analyzeWhiteboardImpact, createCardFromWhiteboardImpact } from './whiteboard-impact';
import { acceptRepoMap, previewRepoMap } from './repo-map-import';
import { parseProjectPackage, PROJECT_PACKAGE_LIMIT } from './project-package';
import { ProjectQueueEngine } from './queue';
import { queueResults } from './queue-results';
import { SessionRecoveryMonitor } from './session-recovery';
import { approveCardDependency, cardRunGate, setCardRunDependencies, setProjectRunCapacity } from './parallel-runs';
import { setProjectRunPause } from './project-pause';
import { WorkflowEngine } from './workflows';
import { workflowRunEvidence } from './workflow-evidence';
import { linkSessionQa, sessionRunEvidence, unlinkSessionQa } from './session-evidence';
import { agentHandoffReceipt, previewAgentHandoff, startAgentHandoff } from './agent-handoff';
import { agentCardMetadataAudit, agentCardMetadataEnabled, setAgentCardMetadataEnabled } from './agent-card-metadata';
import { AgentCardMetadataBridge } from './agent-card-metadata-bridge';
import { agentBrowserPolicy, setAgentBrowserPolicy } from './agent-browser-policy';
import { projectCodexWorkflowAccess, setProjectCodexWorkflowAccess } from './project-agent-rights';
import { queueStartPreview, startReviewedProjectQueue } from './queue-start-review';
import { AgentBrowserBridge } from './agent-browser-bridge';
import { inspectAgentBrowserPage } from './agent-browser-inspector';
import { DevEnvironmentRunner, devEnvironmentAudit, devEnvironmentProfile, saveDevEnvironmentProfile, startApprovedDevEnvironment } from './dev-environment';
import { runF01VisibleSmoke } from './smoke-f01';
import { DevAccountBrowser } from './dev-account-browser';
import { assignDevAccount, createDevAccount, devAccountForProject, devAccountOverview } from './dev-account';
import { GuidedDevEnvironment, inspectDevEnvironment } from './guided-dev-environment';
import { proposeWorkflow } from './workflow-planner';
import { discussTaskDraft } from './task-draft';
import { discussProject, projectChatSources } from './project-chat';
import { convertIdeaToCard, discussIdea, listIdeas, saveIdea } from './ideas';
import { linkIdeaMatch, previewIdeaMatches, unlinkIdeaMatch } from './idea-matches';
import { acceptTrelloIdeas, applyTrelloIdeaSource, compareTrelloIdea, previewTrelloIdeas } from './trello-ideas';
import { transcribeAudio } from './voice/transcribe';
import { projectChangelog } from './changelog';
import { scanThemeTokens } from './theme-tokens';
import { applyThemeTokenEdit, previewThemeTokenEdit } from './theme-token-edit';
import { TrelloConnection } from './trello-connection';
import { TrelloSignIn, trelloPublicAppKey } from './trello-sign-in';
import { ReleaseUpdateController } from './release-updater';

let window: BrowserWindow | null = null;
let store: StudioStore | null = null;
let teamReviewHttp: TeamReviewHttp | null = null;
let tailnetReviewHttp: TeamReviewHttp | null = null;
let tailnetReviewIp: string | null = null;
let teamBoardHttp: TeamBoardHttp | null = null;
let tailnetBoardHttp: TeamBoardHttp | null = null;
let tailnetBoardIp: string | null = null;
let runner: SessionRunner | null = null;
let commandRunner: CommandTerminalRunner | null = null;
let devEnvironmentRunner: DevEnvironmentRunner | null = null;
let devAccountBrowser: DevAccountBrowser | null = null;
let apiContractHttp: ApiContractHttp | null = null;
let queueEngine: ProjectQueueEngine;
let recoveryMonitor: SessionRecoveryMonitor | null = null;
let browser: StudioBrowser | null = null;
let designInspector: DesignInspector | null = null;
let trelloSignIn: TrelloSignIn | null = null;
let agentCardMetadataBridge: AgentCardMetadataBridge | null = null;
let agentBrowserBridge: AgentBrowserBridge | null = null;
let releaseUpdater: ReleaseUpdateController;
let releaseCheckTimer: NodeJS.Timeout | null = null;
let releaseStartTimer: NodeJS.Timeout | null = null;
let integrationAutoTimer: NodeJS.Timeout | null = null;
let smokeQaServer: ReturnType<typeof createServer> | null = null;
const smokeF06 = process.argv.includes('--studio-smoke-f06');
const smokeF01 = process.argv.includes('--studio-smoke-f01');
const smokeF03 = process.argv.includes('--studio-smoke-f03');
const g02Smoke = process.argv.includes('--studio-smoke-g02');
const smokeG02Auto = process.argv.includes('--studio-smoke-g02-auto');
const smokeUsage = process.argv.includes('--studio-smoke-usage');
const smokeChangelog = process.argv.includes('--studio-smoke-changelog');
const smokeWhiteboard = process.argv.includes('--studio-smoke-whiteboard');
const smokeChatCanvas = process.argv.includes('--studio-smoke-chat-canvas');
const smoke = process.argv.includes('--studio-smoke') || smokeF01 || smokeF03 || smokeF06 || g02Smoke || smokeG02Auto || smokeUsage || smokeChangelog || smokeWhiteboard || smokeChatCanvas;
const smokeDataDirectory = smoke ? mkdtempSync(join(tmpdir(), 'branchloom-smoke-')) : null;
const devDataDirectory = !app.isPackaged ? process.env.BRANCHLOOM_DEV_USER_DATA : undefined;
if (smokeDataDirectory) {
  app.setPath('userData', smokeDataDirectory);
  const haltpointCounter = join(smokeDataDirectory, 'f07-launches.txt');
  writeFileSync(join(smokeDataDirectory, 'f07-agent.cmd'), [
    '@echo off',
    `echo launch>>"${haltpointCounter}"`,
    'ping -n 4 127.0.0.1 >nul',
    'echo [JARVIS_STEP_DONE]',
  ].join('\r\n'));
  mkdirSync(join(smokeDataDirectory, 'src'));
  writeFileSync(join(smokeDataDirectory, 'src', 'widget.ts'), 'export const widget = 1;');
  writeFileSync(join(smokeDataDirectory, 'screen.ts'), "import './src/widget';");
  writeFileSync(join(smokeDataDirectory, 'src', 'theme.css'), ':root { --smoke-ink: #243b32; }\n');
  writeFileSync(join(smokeDataDirectory, 'page.ts'), "import './screen';");
  writeFileSync(join(smokeDataDirectory, 'app.ts'), "import './page';");
} else if (devDataDirectory) {
  if (!isAbsolute(devDataDirectory)) throw new Error('BRANCHLOOM_DEV_USER_DATA muss ein absoluter Pfad sein.');
  mkdirSync(devDataDirectory, { recursive: true });
  app.setPath('userData', devDataDirectory);
} else {
  // Keep the existing Jarvis Studio profile when upgrading to Branchloom.
  // Changing the Electron/package name must not make projects appear to vanish.
  const dataDirectory = join(app.getPath('appData'), 'jarvis-studio');
  mkdirSync(dataDirectory, { recursive: true });
  app.setPath('userData', dataDirectory);
}

// A second normal app process must not reopen the live SQLite profile and
// mistake its running PTYs for sessions interrupted by a restart. Isolated
// developer/smoke profiles are kept independent for tests.
const sharedProfileInstance = !smokeDataDirectory && !devDataDirectory;
const ownsSharedProfile = !sharedProfileInstance || app.requestSingleInstanceLock();
if (sharedProfileInstance && ownsSharedProfile) {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
}

function mustStore(): StudioStore {
  if (!store) throw new Error('Store is not ready');
  return store;
}

function installIpc(): void {
  const db = mustStore();
  apiContractHttp = new ApiContractHttp(db);
  const trello = new TrelloConnection(app.getPath('userData'), safeStorage);
  trelloSignIn = new TrelloSignIn(trello, trelloPublicAppKey(app.getAppPath()), (url) => shell.openExternal(url));
  let workflowEngine: WorkflowEngine;
  let previewedPackage: { file: string; fingerprint: string } | null = null;
  let previewedVault: { projectId: string; root: string; fingerprint: string; token: string } | null = null;
  const packageContent = (file: string): { json: string; fingerprint: string } => {
    if (statSync(file).size > PROJECT_PACKAGE_LIMIT) throw new Error('Projektpaket ist größer als 8 MiB.');
    const json = readFileSync(file, 'utf8');
    parseProjectPackage(json);
    return { json, fingerprint: createHash('sha256').update(json).digest('hex') };
  };
  runner = new SessionRunner(db, (event: SessionEvent) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:session-event', event);
  }, (session, finalMessage) => {
    workflowEngine.onSessionFinished(session, finalMessage);
    queueEngine.onSessionFinished(session);
  }, agentCardMetadataBridge, agentBrowserBridge);
  workflowEngine = new WorkflowEngine(db, runner, () => net.isOnline());
  queueEngine = new ProjectQueueEngine(db, workflowEngine, () => net.isOnline());
  recoveryMonitor = new SessionRecoveryMonitor(db, () => net.isOnline(), (sessionId) => runner?.hasLiveProcess(sessionId) ?? false,
    (projectId) => queueEngine.pauseForConnectionLoss(projectId), () => queueEngine.resumeIdleAfterReconnect());
  recoveryMonitor.start();
  commandRunner = new CommandTerminalRunner(db, (event: CommandTerminalEvent) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:command-terminal-event', event);
  });
  const devRunner = new DevEnvironmentRunner(db);
  devEnvironmentRunner = devRunner;
  const devGuide = new GuidedDevEnvironment(db, devRunner);
  devAccountBrowser = new DevAccountBrowser(db, devRunner, () => window);

  const bind = <K extends keyof StudioAPI>(name: K, handler: (...args: never[]) => unknown): void => {
    ipcMain.handle(`studio:${String(name)}`, (event, ...args: unknown[]) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Ungültiger IPC-Absender.');
      return (handler as (...values: unknown[]) => unknown)(...args);
    });
  };
  bind('releaseUpdateState', () => releaseUpdater.snapshot());
  bind('installReleaseUpdate', () => releaseUpdater.update());
  bind('laterReleaseUpdate', () => releaseUpdater.later());
  bind('projects', () => db.projects());
  bind('projectOrganization', () => db.projectOrganization());
  bind('createProjectGroup', (name: string) => db.createProjectGroup(name));
  bind('renameProjectGroup', (input: { groupId: string; name: string }) => db.renameProjectGroup(input));
  bind('deleteProjectGroup', (groupId: string) => db.deleteProjectGroup(groupId));
  bind('assignProjectGroup', (input: { projectId: string; groupId: string | null }) => db.assignProjectGroup(input));
  bind('setProjectSort', (sort: 'name' | 'newest') => db.setProjectSort(sort));
  bind('componentCatalog', (projectId: string) => scanProjectComponents(db.project(projectId).path));
  bind('componentRecommendations', (cardId: string) => componentRecommendations(db, cardId));
  bind('cardComponentChoiceState', (cardId: string) => cardComponentChoiceState(db, cardId));
  bind('projectComponentLibrary', (projectId: string) => projectComponentLibrary(db, projectId));
  bind('addCardComponentChoice', (input: Parameters<StudioAPI['addCardComponentChoice']>[0]) => addCardComponentChoice(db, input));
  bind('removeCardComponentChoice', (input: Parameters<StudioAPI['removeCardComponentChoice']>[0]) => removeCardComponentChoice(db, input));
  bind('addCardComponentVariant', (input: Parameters<StudioAPI['addCardComponentVariant']>[0]) => addCardComponentVariant(db, input));
  bind('removeCardComponentVariant', (input: Parameters<StudioAPI['removeCardComponentVariant']>[0]) => removeCardComponentVariant(db, input));
  bind('cardComponentVariantScreenshot', (input: Parameters<StudioAPI['cardComponentVariantScreenshot']>[0]) => cardComponentVariantScreenshot(db, input));
  bind('usageSessions', (input: Parameters<StudioAPI['usageSessions']>[0]) => db.usageSessions(input));
  bind('createProject', (input: { name: string; path: string }) => db.createProject(input));
  bind('chooseProjectFolder', async () => {
    if (!window || window.isDestroyed()) throw new Error('Das Projektfenster ist nicht verfügbar.');
    const choice = await dialog.showOpenDialog(window, { title: 'Vorhandenen Codeordner auswählen', properties: ['openDirectory'] });
    return choice.canceled ? null : choice.filePaths[0] ?? null;
  });
  bind('exportProjectPackage', async (projectId: string) => {
    if (!window || window.isDestroyed()) throw new Error('Das Exportfenster ist nicht verfügbar.');
    const data = db.exportProjectPackage(projectId);
    const content = JSON.stringify(data, null, 2) + '\n';
    if (Buffer.byteLength(content, 'utf8') > PROJECT_PACKAGE_LIMIT) throw new Error('Projektpaket ist größer als 8 MiB.');
    const choice = await dialog.showSaveDialog(window, { title: 'Projektpaket speichern', defaultPath: 'branchloom-project.json', filters: [{ name: 'Branchloom Projektpaket', extensions: ['json'] }] });
    if (choice.canceled || !choice.filePath) return null;
    try { writeFileSync(choice.filePath, content, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Die Datei existiert bereits. Wähle einen neuen Dateinamen.');
      throw error;
    }
    return { file: choice.filePath, columns: data.columns.length, cards: data.cards.length, notes: data.notes.length, workflows: data.workflows.length };
  });
  bind('previewProjectPackage', async () => {
    if (!window || window.isDestroyed()) throw new Error('Das Importfenster ist nicht verfügbar.');
    previewedPackage = null;
    const choice = await dialog.showOpenDialog(window, { title: 'Projektpaket auswählen', properties: ['openFile'], filters: [{ name: 'Branchloom Projektpaket', extensions: ['json'] }] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const file = choice.filePaths[0];
    const { json, fingerprint } = packageContent(file);
    const data = parseProjectPackage(json);
    previewedPackage = { file, fingerprint };
    return { fingerprint, name: data.name, columns: data.columns.length, cards: data.cards.length, notes: data.notes.length, workflows: data.workflows.length };
  });
  bind('importProjectPackage', (input: { fingerprint: string; name: string; path: string }) => {
    if (!previewedPackage || input.fingerprint !== previewedPackage.fingerprint) throw new Error('Projektpaket erneut auswählen.');
    const { json, fingerprint } = packageContent(previewedPackage.file);
    if (fingerprint !== previewedPackage.fingerprint) throw new Error('Projektpaket wurde nach der Vorschau verändert. Bitte erneut auswählen.');
    const created = db.importProjectPackage({ name: input.name, path: input.path, json });
    previewedPackage = null;
    return created;
  });
  bind('snapshot', (projectId: string) => db.snapshot(projectId));
  bind('apiContractOverview', (projectId: string) => apiContractOverview(db, projectId));
  bind('previewApiContract', (input: Parameters<StudioAPI['previewApiContract']>[0]) => previewApiContract(db, input));
  bind('saveApiContract', async (input: Parameters<StudioAPI['saveApiContract']>[0]) => {
    const version = saveApiContract(db, input);
    await apiContractHttp!.stop(input.projectId);
    return version;
  });
  bind('bindCardApiContract', (input: Parameters<StudioAPI['bindCardApiContract']>[0]) => bindCardApiContract(db, input));
  bind('checkApiContractResponse', (input: Parameters<StudioAPI['checkApiContractResponse']>[0]) => checkApiContractResponse(db, input));
  bind('apiContractMockState', (projectId: string) => apiContractHttp!.state(projectId));
  bind('startApiContractMock', (input: Parameters<StudioAPI['startApiContractMock']>[0]) => apiContractHttp!.start(input));
  bind('stopApiContractMock', (projectId: string) => apiContractHttp!.stop(projectId));
  bind('checkApiContractEndpoint', (input: Parameters<StudioAPI['checkApiContractEndpoint']>[0]) => apiContractHttp!.check(input));
  bind('apiContractLiveChecks', (projectId: string) => apiContractHttp!.checks(projectId));
  bind('requirementConflictBoard', (projectId: string) => requirementConflictBoard(db, projectId));
  bind('addRequirementClaim', (input: Parameters<StudioAPI['addRequirementClaim']>[0]) => addRequirementClaim(db, input));
  bind('refreshRequirementClaim', (input: Parameters<StudioAPI['refreshRequirementClaim']>[0]) => refreshRequirementClaim(db, input));
  bind('removeRequirementClaim', (input: Parameters<StudioAPI['removeRequirementClaim']>[0]) => removeRequirementClaim(db, input));
  bind('resolveRequirementConflict', (input: Parameters<StudioAPI['resolveRequirementConflict']>[0]) => resolveRequirementConflict(db, input));
  bind('projectChangelog', (input: Parameters<StudioAPI['projectChangelog']>[0]) => projectChangelog(db, input.projectId, input.period, new Date(), input.scope ?? 'head'));
  bind('listMilestones', (projectId: string) => listMilestones(db, projectId));
  bind('createMilestone', (input: Parameters<StudioAPI['createMilestone']>[0]) => createMilestone(db, input));
  bind('createMilestoneWithPreview', (input: Parameters<StudioAPI['createMilestoneWithPreview']>[0]) => createMilestoneWithPreview(db, input));
  bind('milestonePreviewImage', (input: Parameters<StudioAPI['milestonePreviewImage']>[0]) => milestonePreviewImage(db, input));
  bind('compareMilestone', (input: Parameters<StudioAPI['compareMilestone']>[0]) => compareMilestone(db, input));
  bind('checkoutMilestone', (input: Parameters<StudioAPI['checkoutMilestone']>[0]) => checkoutMilestone(db, input));
  bind('ideas', (projectId: string) => listIdeas(db, projectId));
  bind('previewIdeaMatches', (input: Parameters<StudioAPI['previewIdeaMatches']>[0]) => previewIdeaMatches(db, input));
  bind('linkIdeaMatch', (input: Parameters<StudioAPI['linkIdeaMatch']>[0]) => linkIdeaMatch(db, input));
  bind('unlinkIdeaMatch', (input: Parameters<StudioAPI['unlinkIdeaMatch']>[0]) => unlinkIdeaMatch(db, input));
  bind('saveIdea', (input: Parameters<StudioAPI['saveIdea']>[0]) => saveIdea(db, input));
  bind('discussIdea', (input: Parameters<StudioAPI['discussIdea']>[0]) => discussIdea(db, input));
  bind('convertIdeaToCard', (input: Parameters<StudioAPI['convertIdeaToCard']>[0]) => convertIdeaToCard(db, input));
  bind('previewTrelloIdeas', (input: Parameters<StudioAPI['previewTrelloIdeas']>[0]) => previewTrelloIdeas(db, input));
  bind('acceptTrelloIdeas', (input: Parameters<StudioAPI['acceptTrelloIdeas']>[0]) => acceptTrelloIdeas(db, input));
  bind('compareTrelloIdea', (input: Parameters<StudioAPI['compareTrelloIdea']>[0]) => compareTrelloIdea(db, input));
  bind('applyTrelloIdeaSource', (input: Parameters<StudioAPI['applyTrelloIdeaSource']>[0]) => applyTrelloIdeaSource(db, input));
  bind('whiteboard', (projectId: string) => whiteboardSnapshot(db, projectId));
  bind('discussWhiteboardSelection', (input: Parameters<StudioAPI['discussWhiteboardSelection']>[0]) => discussWhiteboardSelection(db, input));
  bind('themeTokens', (projectId: string) => scanThemeTokens(db, projectId));
  bind('previewThemeTokenEdit', (input: Parameters<StudioAPI['previewThemeTokenEdit']>[0]) => previewThemeTokenEdit(db, input));
  bind('applyThemeTokenEdit', (input: Parameters<StudioAPI['applyThemeTokenEdit']>[0]) => applyThemeTokenEdit(db, input));
  bind('whiteboardImpact', (input: Parameters<StudioAPI['whiteboardImpact']>[0]) => analyzeWhiteboardImpact(db, input));
  bind('createCardFromWhiteboardImpact', (input: Parameters<StudioAPI['createCardFromWhiteboardImpact']>[0]) => createCardFromWhiteboardImpact(db, input));
  bind('previewRepoMap', (projectId: string) => previewRepoMap(db, projectId));
  bind('acceptRepoMap', (input: Parameters<StudioAPI['acceptRepoMap']>[0]) => acceptRepoMap(db, input));
  bind('createWhiteboardNode', (input: Parameters<StudioAPI['createWhiteboardNode']>[0]) => createWhiteboardNode(db, input));
  bind('updateWhiteboardNode', (input: Parameters<StudioAPI['updateWhiteboardNode']>[0]) => updateWhiteboardNode(db, input));
  bind('deleteWhiteboardNode', (input: Parameters<StudioAPI['deleteWhiteboardNode']>[0]) => deleteWhiteboardNode(db, input));
  bind('createWhiteboardEdge', (input: Parameters<StudioAPI['createWhiteboardEdge']>[0]) => createWhiteboardEdge(db, input));
  bind('createCardFromWhiteboardEdge', (input: Parameters<StudioAPI['createCardFromWhiteboardEdge']>[0]) => createCardFromWhiteboardEdge(db, input));
  bind('deleteWhiteboardEdge', (input: Parameters<StudioAPI['deleteWhiteboardEdge']>[0]) => deleteWhiteboardEdge(db, input));
  bind('createColumn', (input: Parameters<StudioAPI['createColumn']>[0]) => db.createColumn(input));
  bind('updateColumn', (input: Parameters<StudioAPI['updateColumn']>[0]) => db.updateColumn(input));
  bind('reorderColumn', (input: Parameters<StudioAPI['reorderColumn']>[0]) => db.reorderColumn(input));
  bind('deleteColumn', (id: string) => db.deleteColumn(id));
  bind('createCard', (input: Parameters<StudioAPI['createCard']>[0]) => {
    const card = db.createCard(input);
    queueEngine.onBoardChanged(card.projectId);
    return card;
  });
  bind('designTaskCandidate', (input: Parameters<StudioAPI['designTaskCandidate']>[0]) => designTaskCandidate(db, input));
  bind('createCardFromDesignRequest', (input: Parameters<StudioAPI['createCardFromDesignRequest']>[0]) => createCardFromDesignRequest(db, input));
  bind('updateCard', (input: Parameters<StudioAPI['updateCard']>[0]) => db.updateCard(input));
  bind('taskRevisionHistory', (input: Parameters<StudioAPI['taskRevisionHistory']>[0]) => taskRevisionHistory(db, input));
  bind('previewTaskRevisionCleanup', (input: Parameters<StudioAPI['previewTaskRevisionCleanup']>[0]) => previewTaskRevisionCleanup(db, input));
  bind('confirmTaskRevision', (input: Parameters<StudioAPI['confirmTaskRevision']>[0]) => confirmTaskRevision(db, input));
  bind('submitTaskRevision', (input: Parameters<StudioAPI['submitTaskRevision']>[0]) => {
    if (!runner) throw new Error('Agent runner is unavailable');
    return submitTaskRevision(db, runner, input);
  });
  bind('agentCardMetadataEnabled', (projectId: string) => agentCardMetadataEnabled(db, projectId));
  bind('agentCardMetadataAvailable', () => agentCardMetadataBridge?.available === true);
  bind('setAgentCardMetadataEnabled', (input: Parameters<StudioAPI['setAgentCardMetadataEnabled']>[0]) => {
    const enabled = setAgentCardMetadataEnabled(db, input);
    if (!enabled) agentCardMetadataBridge?.revokeProject(input.projectId);
    return enabled;
  });
  bind('agentCardMetadataAudit', (projectId: string) => agentCardMetadataAudit(db, projectId));
  bind('agentBrowserPolicy', (projectId: string) => agentBrowserPolicy(db, projectId));
  bind('projectCodexWorkflowAccess', (projectId: string) => projectCodexWorkflowAccess(db, projectId));
  bind('setProjectCodexWorkflowAccess', (input: Parameters<StudioAPI['setProjectCodexWorkflowAccess']>[0]) => setProjectCodexWorkflowAccess(db, input));
  bind('agentBrowserAvailable', () => agentBrowserBridge?.available === true);
  bind('setAgentBrowserPolicy', (input: Parameters<StudioAPI['setAgentBrowserPolicy']>[0]) => {
    const policy = setAgentBrowserPolicy(db, input);
    agentBrowserBridge?.revokeProject(input.projectId);
    return policy;
  });
  bind('devEnvironmentProfile', (projectId: string) => devEnvironmentProfile(db, projectId));
  bind('saveDevEnvironmentProfile', (input: Parameters<StudioAPI['saveDevEnvironmentProfile']>[0]) => saveDevEnvironmentProfile(db, input));
  bind('devEnvironmentAudit', (input: Parameters<StudioAPI['devEnvironmentAudit']>[0]) => devEnvironmentAudit(db, input.projectId, input.cardId));
  bind('inspectDevEnvironment', (input: Parameters<StudioAPI['inspectDevEnvironment']>[0]) => devGuide.inspect(input));
  bind('adviseDevEnvironment', (input: Parameters<StudioAPI['adviseDevEnvironment']>[0]) => devGuide.advise(input));
  bind('applyGuidedDevEnvironment', (input: Parameters<StudioAPI['applyGuidedDevEnvironment']>[0]) => devGuide.apply(input));
  bind('cardDevEnvironment', (cardId: string) => devEnvironmentRunner?.card(cardId) ?? null);
  bind('verifyCardDevEnvironment', (input: Parameters<StudioAPI['verifyCardDevEnvironment']>[0]) =>
    devRunner.verifyCurrentPreview(input.cardId, input.expectedRunId));
  bind('startCardDevEnvironment', async (input: Parameters<StudioAPI['startCardDevEnvironment']>[0]) => {
    const run = await startApprovedDevEnvironment(db, devRunner, input);
    if (run) devAccountBrowser?.closeCard(input.cardId);
    return run;
  });
  bind('stopCardDevEnvironment', (runId: string) => {
    const run = devEnvironmentRunner?.stop(runId);
    if (run) devAccountBrowser?.closeCard(run.cardId);
    return run;
  });
  bind('devAccountOverview', (input: Parameters<StudioAPI['devAccountOverview']>[0]) => devAccountOverview(db, input));
  bind('createDevAccount', (input: Parameters<StudioAPI['createDevAccount']>[0]) => createDevAccount(db, input));
  bind('assignDevAccount', (input: Parameters<StudioAPI['assignDevAccount']>[0]) => {
    const result = assignDevAccount(db, input);
    devAccountBrowser?.closeCard(input.cardId);
    return result;
  });
  bind('openDevAccount', (cardId: string) => devAccountBrowser?.open(cardId));
  bind('probeDevAccount', (cardId: string) => devAccountBrowser?.probe(cardId));
  bind('devAccountSavedLoginStatus', (cardId: string) => devAccountBrowser?.savedLoginStatus(cardId));
  bind('saveDevAccountLogin', (cardId: string) => devAccountBrowser?.saveLogin(cardId));
  bind('devAccountSeedConfig', (cardId: string) => devAccountBrowser?.seedConfig(cardId));
  bind('saveDevAccountSeedConfig', (input: Parameters<StudioAPI['saveDevAccountSeedConfig']>[0]) => devAccountBrowser?.saveSeedConfig(input));
  bind('lastDevAccountSeedAttempt', (input: Parameters<StudioAPI['lastDevAccountSeedAttempt']>[0]) => devAccountBrowser?.lastSeedAttempt(input.cardId, input.targetId));
  bind('checkDevAccountSeed', (input: Parameters<StudioAPI['checkDevAccountSeed']>[0]) => devAccountBrowser?.checkSeed(input.cardId, input.targetId));
  bind('createDevAccountSeed', (input: Parameters<StudioAPI['createDevAccountSeed']>[0]) => devAccountBrowser?.createSeed(input.cardId, input.targetId, input.checkId));
  bind('forgetDevAccountSession', async (input: Parameters<StudioAPI['forgetDevAccountSession']>[0]) => {
    devAccountForProject(db, input.projectId, input.accountId);
    await devAccountBrowser?.forget(input.accountId);
  });
  bind('cardSplitLinks', (cardId: string) => cardSplitLinks(db, cardId));
  bind('previewCardSplit', (input: Parameters<StudioAPI['previewCardSplit']>[0]) => previewCardSplit(db, input));
  bind('createCardSplit', (input: Parameters<StudioAPI['createCardSplit']>[0]) => createCardSplit(db, input));
  bind('cardCriteria', (cardId: string) => cardCriteria(db, cardId));
  bind('createCardCriterion', (input: Parameters<StudioAPI['createCardCriterion']>[0]) => createCardCriterion(db, input));
  bind('updateCardCriterion', (input: Parameters<StudioAPI['updateCardCriterion']>[0]) => updateCardCriterion(db, input));
  bind('deleteCardCriterion', (input: Parameters<StudioAPI['deleteCardCriterion']>[0]) => deleteCardCriterion(db, input));
  bind('linkCardCriterionEvidence', (input: Parameters<StudioAPI['linkCardCriterionEvidence']>[0]) => linkCardCriterionEvidence(db, input));
  bind('unlinkCardCriterionEvidence', (input: Parameters<StudioAPI['unlinkCardCriterionEvidence']>[0]) => unlinkCardCriterionEvidence(db, input));
  bind('setCardArchived', (input: { id: string; archived: boolean }) => {
    const card = db.setCardArchived(input);
    queueEngine.onBoardChanged(card.projectId);
    return card;
  });
  bind('copyCardId', async (input: { projectId: string; cardId: string }) => {
    const card = db.card(input.cardId);
    if (card.projectId !== input.projectId) throw new Error('Die Karte gehört nicht zum gewählten Projekt.');
    await clipboard.writeText(card.id);
    if (await clipboard.readText() !== card.id) throw new Error('Karten-ID konnte nicht kopiert werden.');
  });
  bind('cardAttachments', (cardId: string) => db.cardAttachments(cardId));
  bind('chooseCardAttachments', async (cardId: string) => {
    if (db.card(cardId).archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    if (!window || window.isDestroyed()) throw new Error('Das Dateifenster ist nicht verfügbar.');
    const choice = await dialog.showOpenDialog(window, { title: 'Dateien mit Karte verknüpfen', properties: ['openFile', 'multiSelections'] });
    return choice.canceled || !choice.filePaths.length ? null : db.addCardAttachments(cardId, choice.filePaths);
  });
  bind('openCardAttachment', async (input: { cardId: string; attachmentId: string }) => {
    const path = db.attachmentPathForCard(input);
    const error = await shell.openPath(path);
    if (error) throw new Error(`Datei konnte nicht geöffnet werden: ${error}`);
  });
  bind('removeCardAttachment', (input: { cardId: string; attachmentId: string }) => db.removeCardAttachment(input));
  bind('cardContextReferences', (cardId: string) => cardContextReferences(db, cardId));
  bind('cardContextCandidateFromAttachment', (input: Parameters<StudioAPI['cardContextCandidateFromAttachment']>[0]) => cardContextCandidateFromAttachment(db, input));
  bind('cardContextCandidateFromWhiteboardNode', (input: Parameters<StudioAPI['cardContextCandidateFromWhiteboardNode']>[0]) => cardContextCandidateFromWhiteboardNode(db, input));
  bind('addCardContextReferenceFromWhiteboardNode', (input: Parameters<StudioAPI['addCardContextReferenceFromWhiteboardNode']>[0]) => addCardContextReferenceFromWhiteboardNode(db, input));
  bind('cardContextCandidateFromDesignSelection', (input: Parameters<StudioAPI['cardContextCandidateFromDesignSelection']>[0]) => cardContextCandidateFromDesignSelection(db, input));
  bind('addCardContextReferenceFromDesignSelection', (input: Parameters<StudioAPI['addCardContextReferenceFromDesignSelection']>[0]) => addCardContextReferenceFromDesignSelection(db, input));
  bind('addCardContextReference', (input: Parameters<StudioAPI['addCardContextReference']>[0]) => addCardContextReference(db, input));
  bind('previewCardContextReference', (input: Parameters<StudioAPI['previewCardContextReference']>[0]) => previewCardContextReference(db, input));
  bind('removeCardContextReference', (input: Parameters<StudioAPI['removeCardContextReference']>[0]) => removeCardContextReference(db, input));
  bind('moveCard', (input: { id: string; columnId: string }) => {
    const before = db.card(input.id);
    const moved = db.moveCard(input);
    const column = db.column(input.columnId);
    if (before.columnId !== column.id && column.autoStart && column.agentId) {
      try { runner?.start({ cardId: moved.id, agentId: column.agentId }); }
      catch (error) {
        // A failed launch must not make the board look as though an agent ran.
        db.moveCard({ id: moved.id, columnId: before.columnId });
        throw error;
      }
    }
    queueEngine.onBoardChanged(moved.projectId);
    return moved;
  });
  bind('bulkUpdateCards', (input: Parameters<StudioAPI['bulkUpdateCards']>[0]) => db.bulkUpdateCards(input));
  bind('reorderCard', (input: Parameters<StudioAPI['reorderCard']>[0]) => db.reorderCard(input));
  bind('agents', () => db.agents());
  bind('detectAgents', () => detectAgents(db.agents()));
  bind('agentCapabilityEvidence', () => db.agentCapabilityEvidence());
  bind('sessionRecovery', (sessionId: string) => recoveryMonitor?.state(sessionId));
  bind('cardRunGate', (cardId: string) => cardRunGate(db, cardId));
  bind('setProjectRunCapacity', (input: Parameters<StudioAPI['setProjectRunCapacity']>[0]) => setProjectRunCapacity(db, input));
  bind('setCardRunDependencies', (input: Parameters<StudioAPI['setCardRunDependencies']>[0]) => {
    const gate = setCardRunDependencies(db, input);
    queueEngine.onBoardChanged(gate.projectId);
    return gate;
  });
  bind('approveCardDependency', (input: Parameters<StudioAPI['approveCardDependency']>[0]) => {
    const gate = approveCardDependency(db, input);
    queueEngine.onBoardChanged(gate.projectId);
    return gate;
  });
  bind('saveAgent', (input: Omit<AgentPreset, 'id'> & { id?: string }) => db.saveAgent(input));
  bind('startSession', (input: { cardId: string; agentId?: string; prompt?: string; useWorktree?: boolean }) => runner?.start(input));
  bind('resumeCodexSession', (input: { sessionId: string; picker?: boolean }) => runner?.resumeCodex(input));
  bind('acknowledgeInterruptedSession', (input: { projectId: string; sessionId: string }) => db.acknowledgeInterruptedSession(input));
  bind('sendSession', (input: { sessionId: string; text: string }) => runner?.send(input));
  bind('writeSessionInput', (input: { sessionId: string; data: string }) => runner?.writeRaw(input));
  bind('resizeSession', (input: { sessionId: string; cols: number; rows: number }) => runner?.resize(input));
  bind('stopSession', (sessionId: string) => {
    runner?.stop(sessionId);
    const stopped = db.session(sessionId);
    workflowEngine.onSessionFinished(stopped);
    queueEngine.onSessionFinished(stopped);
  });
  bind('commandTerminals', (projectId: string) => db.commandTerminals(projectId));
  bind('commandTerminalTargets', (projectId: string) => db.cardWorktreesForProject(projectId).slice(-100).map((item) => ({ cardId: item.cardId, cardTitle: db.card(item.cardId).title, branch: item.branch, path: item.path })));
  bind('startCommandTerminal', (input: Parameters<StudioAPI['startCommandTerminal']>[0]) => commandRunner?.start(input));
  bind('writeCommandTerminal', (input: Parameters<StudioAPI['writeCommandTerminal']>[0]) => commandRunner?.write(input));
  bind('resizeCommandTerminal', (input: Parameters<StudioAPI['resizeCommandTerminal']>[0]) => commandRunner?.resize(input));
  bind('stopCommandTerminal', (terminalId: string) => commandRunner?.stop(terminalId));
  bind('searchSessionTranscripts', (input: { projectId: string; query: string }) => db.searchSessionTranscripts(input.projectId, input.query));
  bind('refreshProjectMemoryIndex', (projectId: string, force?: boolean) => refreshProjectMemoryIndex(db, projectId, force));
  bind('searchProjectMemoryIndex', (input: Parameters<StudioAPI['searchProjectMemoryIndex']>[0]) => searchProjectMemoryIndex(db, input));
  bind('projectMemoryMapSources', (projectId: string) => projectMemoryMapSources(db, projectId));
  bind('readProjectMemorySource', (input: Parameters<StudioAPI['readProjectMemorySource']>[0]) => readProjectMemorySource(db, input));
  bind('sessionForProject', (input: { projectId: string; sessionId: string }) => db.sessionForProject(input.projectId, input.sessionId));
  bind('sessionRunEvidence', (input: Parameters<StudioAPI['sessionRunEvidence']>[0]) => sessionRunEvidence(db, input));
  bind('linkSessionQa', (input: Parameters<StudioAPI['linkSessionQa']>[0]) => linkSessionQa(db, input));
  bind('unlinkSessionQa', (input: Parameters<StudioAPI['unlinkSessionQa']>[0]) => unlinkSessionQa(db, input));
  bind('previewAgentHandoff', (input: Parameters<StudioAPI['previewAgentHandoff']>[0]) => previewAgentHandoff(db, input));
  bind('startAgentHandoff', (input: Parameters<StudioAPI['startAgentHandoff']>[0]) => { if (!runner) throw new Error('Agentenlauf ist nicht verfügbar.'); return startAgentHandoff(db, runner, input); });
  bind('agentHandoffReceipt', (input: Parameters<StudioAPI['agentHandoffReceipt']>[0]) => agentHandoffReceipt(db, input));
  bind('createWorkflow', (input: { projectId: string; name: string; cardIds: string[]; steps: WorkflowStep[] }) => db.createWorkflow(input));
  bind('updateDraftWorkflow', (input: Parameters<StudioAPI['updateDraftWorkflow']>[0]) => {
    const result = db.updateDraftWorkflow(input);
    queueEngine.onBoardChanged(result.projectId);
    return result;
  });
  bind('deleteDraftWorkflow', (id: string) => {
    const projectId = db.deleteDraftWorkflow(id);
    queueEngine.onBoardChanged(projectId);
    return projectId;
  });
  bind('setWorkflowState', (input: Parameters<StudioAPI['setWorkflowState']>[0]) => {
    if (input.state === 'paused') {
      const before = db.workflow(input.id);
      const queue = db.projectQueue(before.projectId);
      if (queue.state === 'running' && queue.activeWorkflowId === before.id) {
        queueEngine.setState({ projectId: before.projectId, state: 'paused' });
        return db.workflow(before.id);
      }
    }
    const workflow = workflowEngine.setState(input);
    queueEngine.onBoardChanged(workflow.projectId);
    return workflow;
  });
  bind('setWorkflowStepHaltpoint', (input: Parameters<StudioAPI['setWorkflowStepHaltpoint']>[0]) => workflowEngine.setStepHaltpoint(input));
  bind('workflowRunEvidence', (input: Parameters<StudioAPI['workflowRunEvidence']>[0]) => workflowRunEvidence(db, input));
  bind('queueStartPreview', (input: Parameters<StudioAPI['queueStartPreview']>[0]) => queueStartPreview(db, input));
  bind('setProjectQueue', (input: Parameters<StudioAPI['setProjectQueue']>[0]) => startReviewedProjectQueue(db, queueEngine, input));
  bind('setQueueContinueBlocked', (input: Parameters<StudioAPI['setQueueContinueBlocked']>[0]) => db.setQueueContinueBlocked(input));
  bind('setQueueAutoResumeIdle', (input: Parameters<StudioAPI['setQueueAutoResumeIdle']>[0]) => db.setQueueAutoResumeIdle(input));
  bind('setQueueAutoTest', (input: Parameters<StudioAPI['setQueueAutoTest']>[0]) => db.setQueueAutoTest(input));
  bind('setProjectRunPause', (input: Parameters<StudioAPI['setProjectRunPause']>[0]) => {
    const state = setProjectRunPause(db, input);
    if (input.paused) queueEngine.cancelProjectRetry(input.projectId);
    return state;
  });
  bind('queueCandidates', (projectId: string) => db.projectQueue(projectId).continueBlocked
    ? db.runnableQueueCandidates(projectId, 5) : db.queueCandidates(projectId, 5));
  bind('queueResults', (projectId: string) => queueResults(db, projectId));
  bind('skipQueuedCard', (input: Parameters<StudioAPI['skipQueuedCard']>[0]) => db.skipQueuedCard(input));
  bind('workflowAgentSettings', () => db.workflowAgentSettings());
  bind('saveWorkflowAgentSettings', (input: WorkflowAgentSettings) => db.saveWorkflowAgentSettings(input));
  bind('proposeWorkflow', (input: { projectId: string; request: string }) => proposeWorkflow(db, input));
  bind('proposeReviewedWorkflow', async (input: { projectId: string; request: string }) => saveReviewedPlan(db, { ...input, proposal: await proposeWorkflow(db, input) }));
  bind('reviewedPlans', (projectId: string) => listReviewedPlans(db, projectId));
  bind('planComments', (planId: string) => listPlanComments(db, planId));
  bind('createPlanComment', (input: Parameters<StudioAPI['createPlanComment']>[0]) => createPlanComment(db, input));
  bind('acceptReviewedPlan', (input: Parameters<StudioAPI['acceptReviewedPlan']>[0]) => acceptReviewedPlan(db, input));
  bind('discussTaskDraft', (input: Parameters<StudioAPI['discussTaskDraft']>[0]) => discussTaskDraft(db, input));
  bind('discussProject', async (input: Parameters<StudioAPI['discussProject']>[0]) => {
    // Only the isolated focused smoke answers its exact synthetic prompt without a model.
    if (smokeChatCanvas && input.turns.length === 1 && input.turns[0]?.role === 'user'
      && input.turns[0].text === 'BRANCHLOOM_CHAT_CANVAS_SMOKE') {
      const { index, sources } = await projectChatSources(db, input.projectId, 'status');
      const source = sources.find((item) => item.kind === 'task' && item.title === 'Canvas smoke source');
      if (!source) throw new Error('Synthetic chat source was not indexed.');
      return { answer: `The saved source is task:${source.sourceId}.`, sources: [source], index,
        suggestion: { kind: 'canvas' as const, title: 'Draft from chat', body: 'Review the saved source.', steps: ['Inspect source'] } };
    }
    return discussProject(db, input);
  });
  bind('acceptWorkflowProposal', (input: { projectId: string; proposal: WorkflowProposal }) => db.acceptWorkflowProposal(input));
  bind('previewTrelloImport', (input: { projectId: string; json: string }) => db.previewTrelloImport(input));
  bind('acceptTrelloImport', (input: Parameters<StudioAPI['acceptTrelloImport']>[0]) => db.acceptTrelloImport(input));
  bind('trelloConnectionStatus', () => trello.status());
  bind('trelloSignInAvailable', () => trelloSignIn?.available() ?? false);
  bind('signInWithTrello', () => trelloSignIn!.run());
  bind('cancelTrelloSignIn', () => trelloSignIn?.cancel());
  bind('openTrelloAppAdmin', async () => { await shell.openExternal('https://trello.com/apps/admin'); });
  bind('openTrelloAuthorization', async (key: string) => { await shell.openExternal(trello.authorizationUrl(key)); });
  bind('connectTrello', (input: { key: string; token: string }) => trello.connect(input));
  bind('disconnectTrello', () => trello.disconnect());
  bind('trelloBoards', () => trello.boards());
  bind('previewTrelloBoard', async (input: { projectId: string; boardId: string }) => db.previewTrelloImport({ projectId: input.projectId, json: await trello.boardJson(input.boardId) }));
  bind('acceptTrelloBoard', async (input: Parameters<StudioAPI['acceptTrelloBoard']>[0]) => db.acceptTrelloImport({ projectId: input.projectId, columnId: input.columnId, columnByListId: input.columnByListId, fingerprint: input.fingerprint, sourceIds: input.sourceIds, json: await trello.boardJson(input.boardId) }));
  bind('previewTrelloBoardIdeas', async (input: Parameters<StudioAPI['previewTrelloBoardIdeas']>[0]) => previewTrelloIdeas(db, { projectId: input.projectId, json: await trello.boardJson(input.boardId) }));
  bind('acceptTrelloBoardIdeas', async (input: Parameters<StudioAPI['acceptTrelloBoardIdeas']>[0]) => acceptTrelloIdeas(db, { projectId: input.projectId, category: input.category, fingerprint: input.fingerprint, sourceIds: input.sourceIds, json: await trello.boardJson(input.boardId) }));
  bind('compareTrelloBoardIdea', async (input: Parameters<StudioAPI['compareTrelloBoardIdea']>[0]) => compareTrelloIdea(db, { projectId: input.projectId, sourceId: input.sourceId, json: await trello.boardJson(input.boardId) }));
  bind('applyTrelloBoardIdeaSource', async (input: Parameters<StudioAPI['applyTrelloBoardIdeaSource']>[0]) => applyTrelloIdeaSource(db, { projectId: input.projectId, sourceId: input.sourceId, fingerprint: input.fingerprint, localSignature: input.localSignature, copyTitle: input.copyTitle, copyBody: input.copyBody, json: await trello.boardJson(input.boardId) }));
  bind('reviewCardWorktree', (cardId: string) => reviewCardWorktree(db, cardId));
  bind('openCardWorktree', async (input: { projectId: string; cardId: string }) => {
    const path = verifiedCardWorktreePath(db, input);
    if (!path) throw new Error('Für diese Karte gibt es keinen gespeicherten Git-Worktree.');
    const error = await shell.openPath(path);
    if (error) throw new Error(`Git-Worktree konnte nicht geöffnet werden: ${error}`);
  });
  bind('previewCardWorktreeCleanup', (cardId: string) => previewCardWorktreeCleanup(db, cardId));
  bind('previewPrDraft', (cardId: string) => previewPrDraft(db, cardId));
  bind('previewCardDiff', (cardId: string) => previewCardDiff(db, cardId));
  bind('listReviewComments', (cardId: string) => listReviewComments(db, cardId));
  bind('createReviewComment', (input: Parameters<StudioAPI['createReviewComment']>[0]) => createReviewComment(db, input));
  bind('reviewInboxItems', (input: Parameters<StudioAPI['reviewInboxItems']>[0]) => reviewInboxItems(db, input));
  bind('agentQuestions', (projectId: string) => agentQuestions(db, projectId));
  bind('answerAgentQuestions', (input: Parameters<StudioAPI['answerAgentQuestions']>[0]) => answerAgentQuestions(db, input, (sessionId, text) => {
    if (!runner) throw new Error('Agent runner is unavailable.');
    runner.send({ sessionId, text });
  }));
  bind('globalInboxItems', (input: Parameters<StudioAPI['globalInboxItems']>[0]) => globalInboxItems(db, input));
  bind('acknowledgeReviewInboxComment', (input: Parameters<StudioAPI['acknowledgeReviewInboxComment']>[0]) => acknowledgeReviewInboxComment(db, input));
  bind('acknowledgeQaInboxReport', (input: Parameters<StudioAPI['acknowledgeQaInboxReport']>[0]) => acknowledgeQaInboxReport(db, input));
  bind('reviewRules', (projectId: string) => listReviewRules(db, projectId));
  bind('createReviewRuleFromComment', (input: Parameters<StudioAPI['createReviewRuleFromComment']>[0]) => createReviewRuleFromComment(db, input));
  bind('updateReviewRule', (input: Parameters<StudioAPI['updateReviewRule']>[0]) => updateReviewRule(db, input));
  bind('deleteReviewRule', (input: Parameters<StudioAPI['deleteReviewRule']>[0]) => deleteReviewRule(db, input));
  bind('reviewCardConflicts', (cardId: string) => reviewCardWorktreeConflicts(db, cardId));
  bind('reviewProjectConflicts', (projectId: string) => reviewProjectConflicts(db, projectId));
  bind('integrationQueue', (projectId: string) => integrationQueue(db, projectId));
  bind('integrationResultFolder', (projectId: string) => integrationResultFolder(db, projectId));
  bind('integrationPolicy', (projectId: string) => integrationPolicy(db, projectId));
  bind('setIntegrationPolicy', (input: Parameters<StudioAPI['setIntegrationPolicy']>[0]) => setIntegrationPolicy(db, input));
  bind('manualRevisionFiles', (cardId: string) => manualRevisionFiles(db, cardId));
  bind('manualRevisions', (cardId: string) => manualRevisions(db, cardId));
  bind('captureManualRevision', (input: Parameters<StudioAPI['captureManualRevision']>[0]) => captureManualRevision(db, input));
  bind('previewManualRevision', (id: string) => previewManualRevision(db, id));
  bind('setManualRevisionConflictChoice', (input: Parameters<StudioAPI['setManualRevisionConflictChoice']>[0]) => setManualRevisionConflictChoice(db, input));
  bind('applyManualRevision', (input: Parameters<StudioAPI['applyManualRevision']>[0]) => applyManualRevision(db, input));
  bind('enqueueIntegration', (cardId: string) => enqueueIntegration(db, cardId));
  bind('prepareIntegration', (cardId: string) => prepareIntegration(db, cardId));
  bind('divergentIntegration', (cardId: string) => divergentIntegration(db, cardId));
  bind('startDivergentIntegration', (cardId: string) => startDivergentIntegration(db, cardId));
  bind('retryMissingDivergentIntegration', (cardId: string) => retryMissingDivergentIntegration(db, cardId));
  bind('divergentIntegrationDiff', (cardId: string) => divergentIntegrationDiff(db, cardId));
  bind('openDivergentIntegration', async (cardId: string) => {
    const attempt = divergentIntegration(db, cardId);
    if (!attempt || attempt.state === 'missing') throw new Error('The assigned integration worktree is unavailable.');
    const error = await shell.openPath(attempt.path);
    if (error) throw new Error(error);
  });
  bind('approveIntegration', (input: { cardId: string; confirm: boolean }) => approveIntegration(db, input));
  bind('integrationEvidence', (cardId: string) => integrationEvidence(db, cardId));
  bind('setIntegrationTestScript', (input: Parameters<StudioAPI['setIntegrationTestScript']>[0]) => setIntegrationTestScript(db, input));
  bind('attestIntegrationReview', (input: Parameters<StudioAPI['attestIntegrationReview']>[0]) => attestIntegrationReview(db, input));
  bind('runIntegrationTest', (cardId: string) => runIntegrationTest(db, cardId));
  bind('saveNote', (input: { projectId: string; id?: string; title: string; body: string; tags: string[]; links: string[] }) => db.saveNote(input));
  bind('memoryGitCandidates', (projectId: string) => memoryGitCandidates(db, projectId));
  bind('memoryGitSource', (input: Parameters<StudioAPI['memoryGitSource']>[0]) => memoryGitSource(db, input));
  bind('attachMemoryGitSource', (input: Parameters<StudioAPI['attachMemoryGitSource']>[0]) => attachMemoryGitSource(db, input));
  bind('removeMemoryGitSource', (input: Parameters<StudioAPI['removeMemoryGitSource']>[0]) => removeMemoryGitSource(db, input));
  bind('deleteNote', (id: string) => db.deleteNote(id));
  bind('exportMemoryVault', async (projectId: string) => {
    const snapshot = db.snapshot(projectId);
    if (!snapshot.notes.length) throw new Error('Dieses Projekt hat noch keine Memory-Notizen.');
    if (!window || window.isDestroyed()) throw new Error('Das Exportfenster ist nicht verfügbar.');
    const selection = await dialog.showOpenDialog(window, {
      title: 'Ordner für Memory-Export auswählen',
      buttonLabel: 'Neuen Exportordner hier anlegen',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const current = db.snapshot(projectId);
    return exportMemoryVaultToDirectory(current.notes, selection.filePaths[0], current.project.name);
  });
  bind('previewMemoryVaultImport', async (projectId: string) => {
    db.project(projectId);
    if (!window || window.isDestroyed()) throw new Error('Das Importfenster ist nicht verfügbar.');
    previewedVault = null;
    const selection = await dialog.showOpenDialog(window, {
      title: 'Markdown-Vault-Ordner auswählen',
      properties: ['openDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const scanned = scanMemoryVault(selection.filePaths[0], db.snapshot(projectId).notes.map((item) => item.title));
    const token = randomUUID();
    previewedVault = { projectId, root: scanned.root, fingerprint: scanned.fingerprint, token };
    return { token, directoryName: basename(scanned.root), files: scanned.files, eligible: scanned.files.filter((item) => item.eligible).length };
  });
  bind('acceptMemoryVaultImport', (input: { projectId: string; token: string; keys: string[] }) => {
    if (!previewedVault || previewedVault.projectId !== input.projectId || previewedVault.token !== input.token) throw new Error('Vault bitte erneut auswählen.');
    if (!Array.isArray(input.keys) || !input.keys.length || input.keys.length > 200 || new Set(input.keys).size !== input.keys.length) throw new Error('Ungültige Dateiauswahl.');
    const scanned = scanMemoryVault(previewedVault.root, db.snapshot(input.projectId).notes.map((item) => item.title));
    if (scanned.fingerprint !== previewedVault.fingerprint) throw new Error('Vault-Dateien wurden seit der Vorschau geändert. Bitte erneut auswählen.');
    const entries = input.keys.map((key) => {
      const file = scanned.parsed.get(key);
      if (!file) throw new Error(`Datei nicht importierbar: ${String(key).slice(0, 100)}`);
      return file;
    });
    const count = db.importMemoryVaultNotes(input.projectId, entries);
    previewedVault = null;
    return { count };
  });
  bind('transcribe', (audio: Uint8Array) => {
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0 || audio.byteLength > 8 * 1024 * 1024) throw new Error('Die Audioaufnahme muss zwischen 1 Byte und 8 MiB groß sein.');
    return transcribeAudio(audio);
  });
  bind('browserState', () => browser?.state());
  bind('browserNavigate', (address: string) => browser?.navigate(address));
  bind('browserBack', () => browser?.back());
  bind('browserForward', () => browser?.forward());
  bind('browserReload', () => browser?.reload());
  bind('browserCapture', () => browser?.captureActive());
  bind('browserOpenExternal', () => browser?.openActiveExternally());
  bind('browserNewTab', () => browser?.newTab());
  bind('browserSelectTab', (id: string) => browser?.selectTab(id));
  bind('browserCloseTab', (id: string) => browser?.closeTab(id));
  bind('browserSetVisible', (visible: boolean) => browser?.setVisible(visible === true));
  bind('browserSetBounds', (bounds: { x: number; y: number; width: number; height: number } | null) => browser?.setBounds(bounds));
  bind('browserCreateDiagnosticCard', (input: Parameters<StudioAPI['browserCreateDiagnosticCard']>[0]) => {
    if (!browser) throw new Error('Browser nicht verfügbar.');
    return createDiagnosticCard(db, input, browser.diagnostic(input.diagnosticId));
  });
  bind('startBugCapture', (projectId: string) => { db.project(projectId); if (!browser) throw new Error('Browser nicht verfügbar.'); return browser.startBugCapture(projectId); });
  bind('markBugResize', () => { if (!browser) throw new Error('Browser nicht verfügbar.'); return browser.markBugResize(); });
  bind('stopBugCapture', () => { if (!browser) throw new Error('Browser nicht verfügbar.'); return browser.stopBugCapture(); });
  bind('discardBugCapture', () => { if (!browser) throw new Error('Browser nicht verfügbar.'); return browser.discardBugCapture(); });
  bind('saveBugScenario', (input: Parameters<StudioAPI['saveBugScenario']>[0]) => {
    if (!browser) throw new Error('Browser nicht verfügbar.');
    const scenario = saveBugScenario(db, devRunner, browser.bugCaptureForToken(input.token), input);
    browser.clearBugCapture(input.token);
    return scenario;
  });
  bind('bugScenarios', (cardId: string) => bugScenarios(db, cardId));
  bind('bugScenarioRuns', (scenarioId: string) => bugScenarioRuns(db, scenarioId));
  bind('runBugScenario', (scenarioId: string) => runBugScenario(db, devRunner, scenarioId));
  bind('cardQaReports', (cardId: string) => cardQaReports(db, cardId));
  bind('runCardQa', (input: Parameters<StudioAPI['runCardQa']>[0]) => runCardQa(db, input));
  bind('runCardQaBatch', (input: Parameters<StudioAPI['runCardQaBatch']>[0]) => runCardQaBatch(db, input));
  bind('cardQaScreenshot', (input: Parameters<StudioAPI['cardQaScreenshot']>[0]) => cardQaScreenshot(db, input));
  bind('startTeamReviewRoom', async (input: Parameters<StudioAPI['startTeamReviewRoom']>[0]) => {
    teamReviewHttp ??= new TeamReviewHttp(db);
    await teamReviewHttp.start();
    const created = createTeamReviewRoom(db, input);
    return { room: created.room, invite: created.invite, reviewerSecret: created.reviewerSecret, url: teamReviewHttp.reviewUrl(created.reviewerSecret) };
  });
  bind('teamReviewRooms', (cardId: string) => teamReviewRooms(db, cardId));
  bind('teamReviewInvites', (roomId: string) => teamReviewInvites(db, roomId));
  bind('teamReviewComments', (roomId: string) => teamReviewComments(db, roomId));
  bind('teamReviewRevision', (roomId: string) => teamReviewRevision(db, roomId));
  bind('teamReviewImage', (roomId: string) => `data:image/png;base64,${teamReviewImage(db, roomId).toString('base64')}`);
  bind('newTeamReviewInvite', async (input: Parameters<StudioAPI['newTeamReviewInvite']>[0]) => {
    teamReviewHttp ??= new TeamReviewHttp(db);
    await teamReviewHttp.start();
    const created = createTeamReviewInvite(db, input);
    return { invite: created.invite, reviewerSecret: created.reviewerSecret, url: teamReviewHttp.reviewUrl(created.reviewerSecret) };
  });
  bind('newTailnetTeamReviewInvite', async (input: Parameters<StudioAPI['newTailnetTeamReviewInvite']>[0]) => {
    const ip = await activeTailnetIPv4();
    if (tailnetReviewIp && tailnetReviewIp !== ip) { tailnetReviewHttp?.close(); tailnetReviewHttp = null; }
    tailnetReviewHttp ??= new TeamReviewHttp(db, ip, new Set());
    tailnetReviewIp = ip;
    await tailnetReviewHttp.start();
    const created = createTeamReviewInvite(db, input);
    tailnetReviewHttp.allowSecret(created.reviewerSecret);
    return { invite: created.invite, reviewerSecret: created.reviewerSecret, url: tailnetReviewHttp.reviewUrl(created.reviewerSecret) };
  });
  bind('revokeTeamReviewInvite', (input: Parameters<StudioAPI['revokeTeamReviewInvite']>[0]) => revokeTeamReviewInvite(db, input));
  bind('closeTeamReviewRoom', (roomId: string) => closeTeamReviewRoom(db, roomId));
  bind('openTeamReviewInvite', async (input: Parameters<StudioAPI['openTeamReviewInvite']>[0]) => {
    resolveTeamReviewInvite(db, input.secret);
    const listener = input.transport === 'local' ? teamReviewHttp : input.transport === 'tailnet' ? tailnetReviewHttp : null;
    if (!listener) throw new Error('Review listener is not running.');
    await shell.openExternal(listener.reviewUrl(input.secret));
  });
  bind('copyTeamReviewInvite', (input: Parameters<StudioAPI['copyTeamReviewInvite']>[0]) => {
    resolveTeamReviewInvite(db, input.secret);
    const listener = input.transport === 'local' ? teamReviewHttp : input.transport === 'tailnet' ? tailnetReviewHttp : null;
    if (!listener) throw new Error('Review listener is not running.');
    clipboard.writeText(listener.reviewUrl(input.secret));
  });
  bind('createTeamBoardInvite', async (input: Parameters<StudioAPI['createTeamBoardInvite']>[0]) => {
    db.project(input.projectId);
    let listener: TeamBoardHttp;
    if (input.transport === 'local') {
      teamBoardHttp ??= new TeamBoardHttp(db);
      listener = teamBoardHttp;
    } else if (input.transport === 'tailnet') {
      const ip = await activeTailnetIPv4();
      if (tailnetBoardIp && tailnetBoardIp !== ip) { tailnetBoardHttp?.close(); tailnetBoardHttp = null; }
      tailnetBoardHttp ??= new TeamBoardHttp(db, ip);
      tailnetBoardIp = ip;
      listener = tailnetBoardHttp;
    } else throw new Error('Choose a local or Tailscale board link.');
    await listener.start();
    const created = createTeamBoardInvite(db, input);
    listener.allowSecret(created.secret);
    return { ...created, url: listener.url(created.secret) };
  });
  bind('teamBoardInvites', (projectId: string) => teamBoardInvites(db, projectId));
  bind('revokeTeamBoardInvite', (input: Parameters<StudioAPI['revokeTeamBoardInvite']>[0]) => revokeTeamBoardInvite(db, input));
  bind('openTeamBoardInvite', async (input: Parameters<StudioAPI['openTeamBoardInvite']>[0]) => {
    resolveTeamBoardInvite(db, input.secret);
    const listener = input.transport === 'local' ? teamBoardHttp : input.transport === 'tailnet' ? tailnetBoardHttp : null;
    if (!listener) throw new Error('Board listener is not running.');
    await shell.openExternal(listener.url(input.secret));
  });
  bind('copyTeamBoardInvite', (input: Parameters<StudioAPI['copyTeamBoardInvite']>[0]) => {
    resolveTeamBoardInvite(db, input.secret);
    const listener = input.transport === 'local' ? teamBoardHttp : input.transport === 'tailnet' ? tailnetBoardHttp : null;
    if (!listener) throw new Error('Board listener is not running.');
    clipboard.writeText(listener.url(input.secret));
  });
  bind('qaCoverageRoutes', (projectId: string) => qaCoverageRoutes(db, projectId));
  bind('saveQaCoverageRoute', (input: Parameters<StudioAPI['saveQaCoverageRoute']>[0]) => saveQaCoverageRoute(db, input));
  bind('removeQaCoverageRoute', (input: Parameters<StudioAPI['removeQaCoverageRoute']>[0]) => removeQaCoverageRoute(db, input));
  bind('runQaCoverageCell', (input: Parameters<StudioAPI['runQaCoverageCell']>[0]) => runQaCoverageCell(db, input));
  bind('previewQaFixCard', (input: Parameters<StudioAPI['previewQaFixCard']>[0]) => previewQaFixCard(db, input));
  bind('createQaFixCard', (input: Parameters<StudioAPI['createQaFixCard']>[0]) => createQaFixCard(db, input));
  bind('designSelections', (projectId: string) => designSelections(db, projectId));
  bind('cardWireframe', (input: Parameters<StudioAPI['cardWireframe']>[0]) => cardWireframe(db, input));
  bind('exportWireframePng', async (input: Parameters<StudioAPI['exportWireframePng']>[0]) => {
    if (!window || window.isDestroyed()) throw new Error('Das Exportfenster ist nicht verfügbar.');
    const card = db.card(input.cardId);
    if (card.projectId !== input.projectId) throw new Error('Karte gehört zu einem anderen Projekt.');
    db.project(input.projectId);
    const image = checkedWireframePng(input);
    if (nativeImage.createFromBuffer(image).isEmpty()) throw new Error('Das PNG-Bild lässt sich nicht lesen.');
    if (smoke && smokeDataDirectory) {
      const file = join(smokeDataDirectory, `wireframe-${input.artboard}.png`);
      writeWireframePngExclusive(file, image);
      return { file };
    }
    const choice = await dialog.showSaveDialog(window, { title: 'Zeichenfläche als PNG speichern', defaultPath: wireframeExportFilename(card.title, input.artboard), filters: [{ name: 'PNG-Bild', extensions: ['png'] }] });
    if (choice.canceled || !choice.filePath) return null;
    if (db.card(input.cardId).projectId !== input.projectId) throw new Error('Karte gehört inzwischen zu einem anderen Projekt.');
    writeWireframePngExclusive(choice.filePath, image);
    return { file: choice.filePath };
  });
  bind('saveCardWireframe', async (input: Parameters<StudioAPI['saveCardWireframe']>[0]) => {
    if (smoke) await new Promise((resolve) => setTimeout(resolve, 180));
    return saveCardWireframe(db, input);
  });
  bind('approveCardWireframe', (input: Parameters<StudioAPI['approveCardWireframe']>[0]) => approveCardWireframe(db, input));
  bind('proposeCardWireframe', (input: Parameters<StudioAPI['proposeCardWireframe']>[0]) => proposeCardWireframe(db, input));
  bind('listWireframeComponents', (projectId: string) => listWireframeComponents(db, projectId));
  bind('saveWireframeComponent', (input: Parameters<StudioAPI['saveWireframeComponent']>[0]) => saveWireframeComponent(db, input));
  bind('removeWireframeComponent', (input: Parameters<StudioAPI['removeWireframeComponent']>[0]) => removeWireframeComponent(db, input));
  bind('designStateRoutes', (projectId: string) => designStateRoutes(db, projectId));
  bind('saveDesignStateRoute', (input: Parameters<StudioAPI['saveDesignStateRoute']>[0]) => saveDesignStateRoute(db, input));
  bind('removeDesignStateRoute', (input: Parameters<StudioAPI['removeDesignStateRoute']>[0]) => removeDesignStateRoute(db, input));
  bind('openDesignStateRoute', (input: Parameters<StudioAPI['openDesignStateRoute']>[0]) => {
    if (!designInspector) throw new Error('Design-Vorschau ist nicht verfügbar.');
    if (designInspector.state().themePreview) throw new Error('Setze zuerst die flüchtige Theme-Vorschau zurück.');
    const route = designStateRoute(db, input);
    return designInspector.start({ projectId: input.projectId, url: route.url });
  });
  bind('designInspectionState', () => designInspector?.state());
  bind('designInspectionApplyThemePreview', (input: Parameters<StudioAPI['designInspectionApplyThemePreview']>[0]) => designInspector?.applyThemePreview(input));
  bind('designInspectionResetThemePreview', (projectId: string) => designInspector?.resetThemePreview(projectId));
  bind('designInspectionApplyElementPreview', (input: Parameters<StudioAPI['designInspectionApplyElementPreview']>[0]) => designInspector?.applyElementPreview(input));
  bind('designInspectionResetElementPreview', (projectId: string) => designInspector?.resetElementPreview(projectId));
  bind('designInspectionStart', (input: Parameters<StudioAPI['designInspectionStart']>[0]) => designInspector?.start(input));
  bind('designInspectionArm', (projectId: string) => designInspector?.arm(projectId));
  bind('designInspectionSelectSelector', (input: Parameters<StudioAPI['designInspectionSelectSelector']>[0]) => designInspector?.selectSelector(input.projectId, input.selector));
  bind('designInspectionCheckA11y', (input: Parameters<StudioAPI['designInspectionCheckA11y']>[0]) => designInspector?.checkA11y(input.projectId, input.selectionId));
  bind('designInspectionSetBounds', (bounds: Parameters<StudioAPI['designInspectionSetBounds']>[0]) => designInspector?.setBounds(bounds));
  bind('designInspectionSetVisible', (visible: boolean) => designInspector?.setVisible(visible === true));
  bind('designViewportCapture', (projectId: string) => designInspector?.captureViewports(projectId));
  bind('designViewportCancel', (projectId: string) => designInspector?.cancelViewportCapture(projectId));
  bind('previewOutputErrors', (input: Parameters<StudioAPI['previewOutputErrors']>[0]) => previewOutputErrors(db, input));
  bind('createOutputErrorCard', (input: Parameters<StudioAPI['createOutputErrorCard']>[0]) => createOutputErrorCard(db, input));
}

async function runF06VisibleSmoke(smokeWindow: BrowserWindow, smokeStore: StudioStore, milestoneProjectId: string): Promise<void> {
  // Exercise the card's visible revision controls against a live, synthetic CLI.
  const f06Script = join(smokeDataDirectory!, 'f06-agent.cmd');
  writeFileSync(f06Script, ['@echo off', ':loop', 'set /p line=', 'echo F06_AGENT_INPUT:%line%', 'goto loop'].join('\r\n'));
  const f06Agent = smokeStore.saveAgent({ name: 'F06 synthetic CLI', kind: 'custom',
    command: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
    args: ['/C', f06Script], model: null, enabled: true });
  const f06Card = smokeStore.createCard({ projectId: milestoneProjectId, columnId: smokeStore.snapshot(milestoneProjectId).columns[0]!.id,
    title: 'Export CSV and PDF', description: 'Create PDF and CSV reports.' });
  const f06Worktree = ensureCardWorktree(smokeStore, f06Card.id);
  mkdirSync(join(f06Worktree.cwd, 'src'), { recursive: true });
  const f06Source = join(f06Worktree.cwd, 'src', 'f06-export.ts');
  const f06SourceContent = "export const reportFormat = 'PDF';\n";
  writeFileSync(f06Source, f06SourceContent);
  execFileSync('git', ['-C', f06Worktree.cwd, 'add', '--', 'src/f06-export.ts'], { windowsHide: true });
  execFileSync('git', ['-C', f06Worktree.cwd, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid',
    'commit', '-qm', 'Add synthetic PDF report'], { windowsHide: true });
  const f06SourceHash = createHash('sha256').update(f06SourceContent).digest('hex');
  const f06Session = runner!.start({ cardId: f06Card.id, agentId: f06Agent.id, useWorktree: true });
  if (smokeStore.session(f06Session.id).state !== 'running') throw new Error('F06 synthetic CLI did not start.');
  await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
  const f06Revision = await smokeWindow.webContents.executeJavaScript(`(async () => {
    const cardId = ${JSON.stringify(f06Card.id)};
    const projectId = ${JSON.stringify(milestoneProjectId)};
    const sourceHash = ${JSON.stringify(f06SourceHash)};
    const wait = async (predicate, label) => {
      for (let i = 0; i < 300; i++) { const result = await predicate(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 50)); }
      throw new Error('F06 UI smoke timed out: ' + label);
    };
    const project = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
    project.click();
    const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')]
      .find((item) => item.getAttribute('aria-label') === 'Meilenstein-Vorschau auswählen'), 'milestone project');
    choice.click();
    await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger')?.getAttribute('aria-label') === 'Projekt auswählen: Meilenstein-Vorschau', 'selected project');
    const nav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Board');
    if (!nav) throw new Error('F06 board navigation missing.');
    nav.click();
    const card = await wait(() => document.getElementById('board-card-' + cardId), 'visible card');
    card.click();
    const panel = await wait(() => document.querySelector('.card-drawer .task-revisions'), 'revision panel');
    panel.querySelector('summary')?.click();
    await wait(() => panel.querySelector('input') && panel.querySelectorAll('textarea').length === 2, 'revision form');
    await wait(async () => (await window.studio.taskRevisionHistory({ projectId, cardId })).contentRevision >= 0, 'revision history');
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    const title = panel.querySelector('input');
    const [description, reason] = panel.querySelectorAll('textarea');
    if (!inputSetter || !textSetter || !title || !description || !reason) throw new Error('F06 revision controls missing.');
    inputSetter.call(title, 'Export CSV only'); title.dispatchEvent(new Event('input', { bubbles: true }));
    textSetter.call(description, 'Create CSV reports. F06_SCOPE_CHANGED_ONLY'); description.dispatchEvent(new Event('input', { bubbles: true }));
    textSetter.call(reason, 'PDF export was removed from the request.'); reason.dispatchEvent(new Event('input', { bubbles: true }));
    const confirm = await wait(() => panel.querySelector('button[type="submit"]:not(:disabled)'), 'confirm revision');
    confirm.click();
    const history = await wait(async () => {
      const value = await window.studio.taskRevisionHistory({ projectId, cardId });
      return value.revisions[0]?.delivery === 'prepared' ? value : null;
    }, 'prepared revision');
    const revision = history.revisions[0];
    if (revision.fromTitle !== 'Export CSV and PDF' || revision.toTitle !== 'Export CSV only'
      || revision.reason !== 'PDF export was removed from the request.' || revision.sourceSessionId !== ${JSON.stringify(f06Session.id)})
      throw new Error('F06 old/new/reason or source session was not persisted.');
    const row = await wait(() => panel.querySelector('.task-revision'), 'visible revision');
    if (!row.textContent?.includes('Bereitgestellt') || !row.textContent.includes(revision.reason)) throw new Error('F06 prepared status or reason not visible.');
    row.querySelector('details summary')?.click();
    if (!row.textContent?.includes('Export CSV and PDF') || !row.textContent.includes('F06_SCOPE_CHANGED_ONLY'))
      throw new Error('F06 comparison omitted old or new scope.');
    const inspect = await wait(() => [...row.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Bereinigung prüfen') && !button.disabled), 'cleanup inspection button');
    inspect.click();
    const match = await wait(() => row.querySelector('.task-cleanup-matches li'), 'source cleanup evidence');
    if (!match.textContent?.includes('src/f06-export.ts:1') || !match.textContent.includes(sourceHash.slice(0, 12))
      || match.querySelector('code[title]')?.getAttribute('title') !== sourceHash)
      throw new Error('F06 cleanup evidence omitted file, line or complete hash.');
    if (row.querySelector('.task-cleanup-preview button')) throw new Error('F06 cleanup preview offered an automatic action.');
    const submit = await wait(() => [...row.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('An diesen laufenden Agenten senden') && !button.disabled), 'send to source session');
    submit.click();
    await wait(async () => (await window.studio.taskRevisionHistory({ projectId, cardId })).revisions[0]?.delivery === 'submitted', 'submitted revision');
    await wait(() => row.textContent?.includes('An Terminal geschrieben'), 'visible submitted status');
    return revision.id;
  })()`);
  for (let attempt = 0; attempt < 100 && !smokeStore.session(f06Session.id).output.includes('F06_SCOPE_CHANGED_ONLY'); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  if (!smokeStore.session(f06Session.id).output.includes('F06_SCOPE_CHANGED_ONLY')) throw new Error('F06 live CLI did not receive the revised scope.');
  await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
  await smokeWindow.webContents.executeJavaScript(`(async () => {
    const projectId = ${JSON.stringify(milestoneProjectId)};
    const cardId = ${JSON.stringify(f06Card.id)};
    const revisionId = ${JSON.stringify(f06Revision)};
    const wait = async (predicate, label) => {
      for (let i = 0; i < 300; i++) { const result = await predicate(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 50)); }
      throw new Error('F06 reload timed out: ' + label);
    };
    const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
    picker.click();
    const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')]
      .find((item) => item.getAttribute('aria-label') === 'Meilenstein-Vorschau auswählen'), 'milestone project');
    choice.click();
    await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger')?.getAttribute('aria-label') === 'Projekt auswählen: Meilenstein-Vorschau', 'selected project');
    const nav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Board'), 'Board navigation');
    nav.click();
    const card = await wait(() => document.getElementById('board-card-' + cardId), 'reloaded card');
    card.click();
    const panel = await wait(() => document.querySelector('.card-drawer .task-revisions'), 'reloaded revision panel');
    panel.querySelector('summary')?.click();
    const row = await wait(() => panel.querySelector('.task-revision'), 'reloaded revision');
    if (!row.textContent?.includes('An Terminal geschrieben') || !row.textContent.includes('PDF export was removed from the request.'))
      throw new Error('F06 delivery or reason disappeared after renderer reload.');
    const persisted = (await window.studio.taskRevisionHistory({ projectId, cardId })).revisions[0];
    if (persisted?.id !== revisionId || persisted.targetSessionId !== ${JSON.stringify(f06Session.id)})
      throw new Error('F06 persisted delivery points to another session.');
    return true;
  })()`);
  const f06Second = confirmTaskRevision(smokeStore, { projectId: milestoneProjectId, cardId: f06Card.id,
    expectedContentRevision: taskRevisionHistory(smokeStore, { projectId: milestoneProjectId, cardId: f06Card.id }).contentRevision,
    title: 'Export CSV with header', description: 'Create CSV reports with headers.', reason: 'The consumer needs headers.' }).revisions[0]!;
  runner!.stop(f06Session.id);
  if (smokeStore.session(f06Session.id).state !== 'stopped') throw new Error('F06 old CLI did not stop.');
  let rejectedStoppedDelivery = false;
  try { submitTaskRevision(smokeStore, runner!, { projectId: milestoneProjectId, cardId: f06Card.id,
    revisionId: f06Second.id, sessionId: f06Session.id }); }
  catch (error) { rejectedStoppedDelivery = String(error).includes('no longer running'); }
  if (!rejectedStoppedDelivery || taskRevisionHistory(smokeStore, { projectId: milestoneProjectId, cardId: f06Card.id }).revisions[0]?.delivery !== 'prepared')
    throw new Error('F06 stopped session accepted or changed a prepared revision.');
  await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
  await smokeWindow.webContents.executeJavaScript(`(async () => {
    const cardId = ${JSON.stringify(f06Card.id)};
    const wait = async (predicate, label) => {
      for (let i = 0; i < 300; i++) { const result = await predicate(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 50)); }
      throw new Error('F06 stopped-state UI timed out: ' + label);
    };
    const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
    picker.click();
    const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')]
      .find((item) => item.getAttribute('aria-label') === 'Meilenstein-Vorschau auswählen'), 'milestone project');
    choice.click();
    await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger')?.getAttribute('aria-label') === 'Projekt auswählen: Meilenstein-Vorschau', 'selected project');
    const nav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Board'), 'Board navigation');
    nav.click();
    const card = await wait(() => document.getElementById('board-card-' + cardId), 'revised card');
    card.click();
    const panel = await wait(() => document.querySelector('.card-drawer .task-revisions'), 'revision panel');
    panel.querySelector('summary')?.click();
    const current = await wait(() => panel.querySelector('.task-revision'), 'prepared revision');
    if (!current.textContent?.includes('Bereitgestellt') || !current.textContent.includes('The consumer needs headers.')
      || !current.textContent.includes('Der ursprüngliche Lauf ist nicht mehr aktiv'))
      throw new Error('F06 stopped-session state is not explained in the card.');
    if ([...current.querySelectorAll('button')].some((button) => button.textContent?.includes('An diesen laufenden Agenten senden')))
      throw new Error('F06 stopped session still offers delivery.');
    return true;
  })()`);
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1500,
    height: 930,
    minWidth: 420,
    minHeight: 650,
    show: !smoke,
    title: 'Branchloom',
    icon: join(__dirname, '..', '..', 'assets', 'branchloom.ico'),
    backgroundColor: '#f6f7f5',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: !smokeWhiteboard,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  browser = new StudioBrowser(window, (state) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:browser-state', state);
  }, () => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:browser-search-shortcut');
  }, new BrowserSessionPersistence(app.getPath('userData')));
  designInspector = new DesignInspector(window, mustStore(), (selection) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:design-selection', selection);
  });
  // `npm start` runs the built renderer from source, while `npm run dev`
  // explicitly opts into Vite. Electron's app.isPackaged is false in both
  // source modes, so it cannot decide this on its own.
  if (!app.isPackaged && process.env.JARVIS_STUDIO_DEV_SERVER === '1') void window.loadURL('http://127.0.0.1:5181');
  else void window.loadFile(join(__dirname, '../../dist/renderer/index.html'));
  if (smokeWhiteboard) {
    window.webContents.once('did-finish-load', () => {
      void runWhiteboardVisibleSmoke(window!, mustStore(), smokeDataDirectory!).then(() => {
        process.stdout.write('STUDIO_SMOKE_WHITEBOARD_OK\n');
        app.quit();
      }).catch((error: unknown) => { console.error('STUDIO_SMOKE_WHITEBOARD_FAILED', error); app.exit(1); });
    });
  } else if (smokeChatCanvas) {
    window.webContents.once('did-finish-load', () => {
      void runChatCanvasSmoke(window!, mustStore(), smokeDataDirectory!).then(() => {
        process.stdout.write('STUDIO_SMOKE_CHAT_CANVAS_OK\n');
        app.quit();
      }).catch((error: unknown) => { console.error('STUDIO_SMOKE_CHAT_CANVAS_FAILED', error); app.exit(1); });
    });
  } else if (smokeUsage) {
    window.webContents.once('did-finish-load', () => {
      void runUsageSmoke(window!, mustStore(), smokeDataDirectory!).then(() => {
        process.stdout.write('STUDIO_SMOKE_USAGE_OK\n');
        app.quit();
      }).catch((error: unknown) => { console.error('STUDIO_SMOKE_USAGE_FAILED', error); app.exit(1); });
    });
  } else if (smokeChangelog) {
    window.webContents.once('did-finish-load', () => {
      void runChangelogVisibleSmoke(window!, mustStore(), smokeDataDirectory!).then(() => {
        process.stdout.write('STUDIO_SMOKE_CHANGELOG_OK\n');
        app.quit();
      }).catch((error: unknown) => { console.error('STUDIO_SMOKE_CHANGELOG_FAILED', error); app.exit(1); });
    });
  } else if (smokeF01) {
    window.webContents.once('did-finish-load', () => {
      void runF01VisibleSmoke(window!, mustStore(), devEnvironmentRunner!, smokeDataDirectory!).then(() => {
        process.stdout.write('STUDIO_SMOKE_F01_OK\n');
        app.quit();
      }).catch((error: unknown) => { console.error('STUDIO_SMOKE_F01_FAILED', error); app.exit(1); });
    });
  } else if (smokeG02Auto) {
    window.webContents.once('did-finish-load', () => {
      void runG02AutoSmoke(window!, mustStore(), smokeDataDirectory!).then(() => {
        process.stdout.write('G02_AUTO_SMOKE_OK\n');
        app.quit();
      }).catch((error: unknown) => { console.error('G02_AUTO_SMOKE_FAILED', error); app.exit(1); });
    });
  } else if (smokeF03) {
    window.webContents.once('did-finish-load', () => {
      void runF03Acceptance(window!, mustStore(), smokeDataDirectory!).then(() => {
        process.stdout.write('STUDIO_SMOKE_F03_OK\n');
        app.quit();
      }).catch((error) => {
        console.error('STUDIO_SMOKE_F03_FAILED', error);
        app.exit(1);
      });
    });
  } else if (smokeF06) {
    window.webContents.once('did-finish-load', () => {
      void (async () => {
        const projectPath = join(smokeDataDirectory!, 'f06-project');
        mkdirSync(projectPath);
        writeFileSync(join(projectPath, 'README.md'), '# Synthetic F06 project\n');
        execFileSync('git', ['init', '-q', projectPath], { windowsHide: true });
        execFileSync('git', ['-C', projectPath, 'add', 'README.md'], { windowsHide: true });
        execFileSync('git', ['-C', projectPath, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid',
          'commit', '-qm', 'Initial synthetic project'], { windowsHide: true });
        const smokeStore = mustStore();
        const project = smokeStore.createProject({ name: 'Meilenstein-Vorschau', path: projectPath });
        await runF06VisibleSmoke(window!, smokeStore, project.id);
        process.stdout.write('STUDIO_SMOKE_F06_OK\n');
        app.quit();
      })().catch((error) => { console.error('STUDIO_SMOKE_F06_FAILED', error); app.exit(1); });
    });
  } else if (g02Smoke) {
    window.webContents.once('did-finish-load', () => {
      void runG02VisibleSmoke(window!, mustStore(), smokeDataDirectory!).then(() => {
        process.stdout.write('G02_SMOKE_OK\n');
        app.quit();
      }).catch((error: unknown) => {
        console.error('G02_SMOKE_FAILED:', error);
        app.exit(1);
      });
    });
  } else if (smoke) {
    writeFileSync(join(smokeDataDirectory!, 'context.md'), '# BRANCHLOOM_CONTEXT_SMOKE\n');
    writeFileSync(join(smokeDataDirectory!, 'drop.md'), '# BRANCHLOOM_DROP_SMOKE\n');
    const failSmoke = (error: unknown) => {
      console.error('STUDIO_SMOKE_FAILED: renderer/IPC/SQLite/Board', error);
      app.exit(1);
    };
    let stateRouteHits = 0;
    const qaServerReady = new Promise<string>((resolve, reject) => {
      smokeQaServer = createServer((request, response) => {
        if (request.url?.startsWith('/stories/dialog/')) {
          const compact = request.url.startsWith('/stories/dialog/compact');
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(`<!doctype html><title>Dialog variant</title><main><dialog open style="position:static;margin:2rem;padding:${compact ? '1rem' : '3rem'};max-width:${compact ? '280px' : '560px'}"><h1>${compact ? 'Compact settings' : 'Wide settings'}</h1><button>Save</button></dialog></main>`);
          return;
        }
        if (request.url?.startsWith('/?state=empty')) stateRouteHits++;
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Branchloom QA Smoke</title><style>:root{--smoke-ink:#243b32}body{min-width:1600px;background:#fff}#design-smoke-target{color:var(--smoke-ink);padding:8px}</style><img id="qa-observation-image"><button id="design-smoke-target">Synthetic design target</button><script>window.__designSmokeClicks=0;document.querySelector("#design-smoke-target").addEventListener("click",()=>window.__designSmokeClicks++);console.error("BRANCHLOOM_QA_SMOKE_ERROR")</script>');
      });
      smokeQaServer.once('error', reject);
      smokeQaServer.listen(0, '127.0.0.1', () => {
        const address = smokeQaServer?.address();
        if (!address || typeof address === 'string') reject(new Error('QA-Smoke-Server hat keinen TCP-Port.'));
        else resolve(`http://127.0.0.1:${address.port}/`);
      });
    });
    window.webContents.once('did-finish-load', () => { void qaServerReady.then((qaUrl) => {
      const script = `
        (async () => {
          for (let attempt = 0; attempt < 600 && !document.querySelector('.app-shell'); attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          if (!document.querySelector('.app-shell') || !document.body.textContent?.includes('Branchloom')) {
            throw new Error('Renderer hat die Oberfläche nicht aufgebaut: ' + document.body.textContent?.slice(0, 200));
          }
          if (!window.studio) throw new Error('Preload-API fehlt.');
          if ((await window.studio.projects()).length !== 0) throw new Error('Smoke-Datenordner ist nicht leer.');
          const project = await window.studio.createProject({ name: 'Smoke-Projekt', path: ${JSON.stringify(smokeDataDirectory)} });
          const initial = await window.studio.snapshot(project.id);
          const todo = initial.columns.find((column) => column.name === 'To Do');
          if (!todo || initial.columns.length < 3) throw new Error('Standardspalten fehlen.');
          const card = await window.studio.createCard({ projectId: project.id, columnId: todo.id, title: 'Smoke-Karte' });
          const wbFolder = await window.studio.createWhiteboardNode({ projectId: project.id, title: 'Smoke-Ordner', x: 10, y: 20, reference: { kind: 'folder', path: 'src' } });
          const wbCard = await window.studio.createWhiteboardNode({ projectId: project.id, title: 'Smoke-Aufgabe', x: 220, y: 20, reference: { kind: 'card', cardId: card.id } });
          await window.studio.createWhiteboardEdge({ projectId: project.id, sourceId: wbFolder.id, targetId: wbCard.id, label: 'gehört zu' });
          const directImpact = await window.studio.whiteboardImpact({ projectId: project.id, nodeId: wbFolder.id });
          if (directImpact.partial || directImpact.importers.length !== 1 || directImpact.importers[0].path !== 'screen.ts') throw new Error('Whiteboard-Änderungswirkung über IPC fehlt.');
          if (directImpact.transitiveImporters.length !== 2 || directImpact.transitiveImporters[0].path !== 'page.ts' || directImpact.transitiveImporters[0].chain[0].line !== 1 || directImpact.transitiveImporters[1].path !== 'app.ts') throw new Error('Whiteboard-Importkette über IPC fehlt.');
          await window.studio.reorderColumn({ id: initial.columns[1].id, direction: 'right' });
          await window.studio.updateColumn({ id: initial.columns[2].id, name: 'Smoke-Umbenannt' });
          const removable = await window.studio.createColumn({ projectId: project.id, name: 'Smoke-Leer' });
          await window.studio.deleteColumn(removable.id);
          const saved = await window.studio.snapshot(project.id);
          if (!saved.cards.some((item) => item.id === card.id && item.title === 'Smoke-Karte')) {
            throw new Error('Karte wurde nicht über IPC und SQLite gespeichert.');
          }
          if (saved.columns[2]?.id !== initial.columns[1].id) throw new Error('Spaltenreihenfolge wurde nicht gespeichert.');
          if (saved.columns[1]?.name !== 'Smoke-Umbenannt') throw new Error('Spaltenname wurde nicht gespeichert.');
          if (saved.columns.some((item) => item.id === removable.id)) throw new Error('Leere Spalte wurde nicht gelöscht.');
          const trelloIdeaJson = JSON.stringify({ name: 'Synthetisches Trello-Board', lists: [{ id: 'cccccccccccccccccccccccc', name: 'Ideen' }], cards: [{ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', idList: 'cccccccccccccccccccccccc', name: 'Trello-Idee im Smoke', desc: 'Später planen', closed: false }] });
          const trelloIdeaPreview = await window.studio.previewTrelloIdeas({ projectId: project.id, json: trelloIdeaJson });
          if (trelloIdeaPreview.eligible !== 1 || (await window.studio.ideas(project.id)).length !== 0) throw new Error('Trello-Ideen-Vorschau schrieb vor Bestätigung oder war unvollständig.');
          const staged = await window.studio.acceptTrelloIdeas({ projectId: project.id, json: trelloIdeaJson, fingerprint: trelloIdeaPreview.fingerprint, sourceIds: ['bbbbbbbbbbbbbbbbbbbbbbbb'], category: 'backlog' });
          if (staged.created.length !== 1 || staged.created[0].cardId || (await window.studio.snapshot(project.id)).cards.length !== saved.cards.length) throw new Error('Trello-Idee wurde nicht ausschließlich im Ideenraum vorgemerkt.');
          if ((await window.studio.previewTrelloIdeas({ projectId: project.id, json: trelloIdeaJson })).duplicates !== 1) throw new Error('Trello-Idee wurde nach dem Import nicht als Duplikat erkannt.');
          const idea = await window.studio.saveIdea({ projectId: project.id, title: 'Smoke-Idee', body: 'Synthetische Notiz', category: 'backlog', turns: [] });
          if ((await window.studio.ideas(project.id))[0]?.id !== idea.id) throw new Error('Idee wurde nicht über IPC und SQLite gespeichert.');
          const ideaCard = await window.studio.convertIdeaToCard({ projectId: project.id, ideaId: idea.id, columnId: saved.columns[1].id });
          if (ideaCard.title !== idea.title || (await window.studio.ideas(project.id))[0]?.cardId !== ideaCard.id) throw new Error('Idee wurde nicht bewusst in eine Karte übernommen.');
          if ((await window.studio.snapshot(project.id)).sessions.length !== 0) throw new Error('Ideenübernahme startete einen Agenten.');
          const changedTrelloIdeaJson = JSON.stringify({ name: 'Synthetisches Trello-Board', lists: [{ id: 'cccccccccccccccccccccccc', name: 'Ideen' }], cards: [{ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', idList: 'cccccccccccccccccccccccc', name: 'Trello-Idee aktualisiert', desc: 'Neue Quelle', closed: false }] });
          const sourceComparison = await window.studio.compareTrelloIdea({ projectId: project.id, json: changedTrelloIdeaJson, sourceId: 'bbbbbbbbbbbbbbbbbbbbbbbb' });
          if (sourceComparison.sourceChange !== 'changed' || sourceComparison.localChange !== 'same') throw new Error('Trello-Quellenvergleich erkannte die neue Quelle nicht.');
          const sourceApplied = await window.studio.applyTrelloIdeaSource({ projectId: project.id, json: changedTrelloIdeaJson, sourceId: sourceComparison.sourceId, fingerprint: sourceComparison.fingerprint, localSignature: sourceComparison.localSignature, copyTitle: true, copyBody: false });
          if (sourceApplied.localTitle !== 'Trello-Idee aktualisiert' || sourceApplied.sourceChange !== 'changed' || !(await window.studio.ideas(project.id)).some((item) => item.id === staged.created[0].id && item.title === sourceApplied.localTitle)) throw new Error('Selektive Trello-Quellenübernahme änderte die lokale Idee nicht korrekt.');
          const candidates = await window.studio.queueCandidates(project.id);
          const initialRunGate = await window.studio.cardRunGate(card.id);
          if (initialRunGate.capacity !== 2 || initialRunGate.runningCount !== 0 || !initialRunGate.canStart) throw new Error('Parallele Startbedingungen fehlen im IPC.');
          if (await window.studio.setProjectRunCapacity({ projectId: project.id, capacity: 3 }) !== 3
            || (await window.studio.cardRunGate(card.id)).capacity !== 3) throw new Error('Projektkapazität wurde nicht gespeichert.');
          const extraDependency = await window.studio.setCardRunDependencies({ cardId: card.id, prerequisiteCardIds: [ideaCard.id] });
          if (extraDependency.dependencies.length !== 1 || extraDependency.canStart || extraDependency.dependencies[0]?.prerequisiteCardId !== ideaCard.id) {
            throw new Error('Zusätzlicher Kartenvorgänger wurde nicht über IPC gespeichert oder gesperrt.');
          }
          if (!(await window.studio.cardRunGate(card.id)).dependencies.some((item) => item.prerequisiteCardId === ideaCard.id)
            || !(await window.studio.setCardRunDependencies({ cardId: card.id, prerequisiteCardIds: [] })).canStart) {
            throw new Error('Kartenvorgänger wurde nicht über IPC entfernt oder der Start blieb gesperrt.');
          }
          if (candidates.length !== 1 || candidates[0].id !== card.id) throw new Error('Queue-Vorschau wich von der freien To-Do-Karte ab.');
          const draft = await window.studio.createWorkflow({ projectId: project.id, name: 'Smoke-Entwurf', cardIds: [card.id], steps: [{ id: 'smoke-step', columnId: saved.columns[2].id, agentId: null, requireApproval: false }] });
          if ((await window.studio.queueCandidates(project.id)).length !== 0) throw new Error('Karte mit Workflow-Entwurf blieb in der Queue.');
          const edited = await window.studio.updateDraftWorkflow({ id: draft.id, name: 'Smoke-Entwurf bearbeitet', cardIds: [card.id], steps: [{ id: 'smoke-step-edited', columnId: saved.columns[2].id, agentId: null, requireApproval: true }] });
          if (edited.name !== 'Smoke-Entwurf bearbeitet' || !edited.steps[0]?.requireApproval) throw new Error('Workflow-Entwurf wurde nicht bearbeitet.');
          await window.studio.deleteDraftWorkflow(draft.id);
          if ((await window.studio.queueCandidates(project.id))[0]?.id !== card.id) throw new Error('Gelöschter Entwurf gab die Karte nicht frei.');
          if (${process.platform === 'win32'}) {
            const terminal = await window.studio.startCommandTerminal({ projectId: project.id, shell: 'cmd' });
            await window.studio.writeCommandTerminal({ terminalId: terminal.id, data: 'set STUDIO_SMOKE_PREFIX=JARVIS_STUDIO_\\r' });
            await window.studio.writeCommandTerminal({ terminalId: terminal.id, data: 'echo %STUDIO_SMOKE_PREFIX%TERMINAL_OK\\r' });
            let echoed = false;
            let lastOutput = '';
            for (let attempt = 0; attempt < 600; attempt++) {
              const row = (await window.studio.commandTerminals(project.id)).find((item) => item.id === terminal.id);
              lastOutput = row?.output ?? '';
              if (row?.output.includes('JARVIS_STUDIO_TERMINAL_OK')) { echoed = true; break; }
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            await window.studio.stopCommandTerminal(terminal.id);
            if (!echoed) throw new Error('cmd-PTY gab keine Ausgabe zurück: ' + lastOutput.slice(-400));
            const agent = await window.studio.saveAgent({
              name: 'Smoke-Agent', kind: 'custom', command: ${JSON.stringify(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'))},
              args: ['/C', 'echo JARVIS_STUDIO_AGENT_OK && echo Error: BRANCHLOOM_OUTPUT_TEST'], model: null, enabled: true,
            });
            const paused = await window.studio.setProjectRunPause({ projectId: project.id, paused: true });
            if (paused.state !== 'paused' || (await window.studio.snapshot(project.id)).runPause.state !== 'paused')
              throw new Error('Projektweite sichere Pause wurde nicht gespeichert.');
            let pauseBlocked = false;
            try { await window.studio.startSession({ cardId: card.id, agentId: agent.id, prompt: '' }); }
            catch (error) { pauseBlocked = String(error).includes('sicher angehalten'); }
            if (!pauseBlocked || (await window.studio.snapshot(project.id)).sessions.length !== 0)
              throw new Error('Projektpause hat einen echten Karten-Agentenstart nicht gesperrt.');
            await window.studio.setProjectRunPause({ projectId: project.id, paused: false });
            const syntheticToken = 'sk-' + 's'.repeat(24);
            const sessionsBeforeGuard = (await window.studio.snapshot(project.id)).sessions.length;
            let guardMessage = '';
            try { await window.studio.startSession({ cardId: card.id, agentId: agent.id, prompt: 'Check\\n' + syntheticToken }); }
            catch (error) { guardMessage = String(error); }
            if (!guardMessage.includes('Agentenauftrag, Zeile 2 (API-Schlüssel)') || guardMessage.includes(syntheticToken)
              || (await window.studio.snapshot(project.id)).sessions.length !== sessionsBeforeGuard) {
              throw new Error('Modellübergabe-Sperre über IPC gab Wert aus oder startete einen Agenten.');
            }
            const session = await window.studio.startSession({ cardId: card.id, agentId: agent.id, prompt: '' });
            let agentFinished = false;
            for (let attempt = 0; attempt < 600; attempt++) {
              const row = (await window.studio.snapshot(project.id)).sessions.find((item) => item.id === session.id);
              if (row?.state === 'exited' && row.output.includes('JARVIS_STUDIO_AGENT_OK')) { agentFinished = true; break; }
              if (row?.state === 'failed') throw new Error('Lokaler Smoke-Agent ist fehlgeschlagen: ' + row.output.slice(-400));
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            if (!agentFinished) throw new Error('Lokaler Smoke-Agent beendete seinen PTY-Lauf nicht.');
            const capabilityProof = await window.studio.agentCapabilityEvidence();
            if (!capabilityProof.some((item) => item.agentId === agent.id && item.sessionId === session.id && item.capability === 'start')) {
              throw new Error('Der echte Agenten-PTY-Start erschien nicht im Fähigkeitsbeleg.');
            }
            if (capabilityProof.some((item) => item.agentId === agent.id && item.capability !== 'start')) {
              throw new Error('Der reine Agentenstart behauptete weitere Fähigkeiten.');
            }
            const launchProof = await window.studio.sessionRunEvidence({ projectId: project.id, sessionId: session.id });
            if (launchProof.launch?.agentName !== 'Smoke-Agent' || launchProof.launch.sources.length !== 0 || launchProof.launch.promptDelivery !== 'none'
              || launchProof.launch.versionCheck !== 'unchecked' || launchProof.launch.git.scope !== 'project'
              || launchProof.linkedQa.length) throw new Error('Lokaler Agentenlauf hat keinen begrenzten Startbeleg: ' + JSON.stringify(launchProof));
            const recovery = await window.studio.sessionRecovery(session.id);
            if (recovery.process !== 'ended' || !['online', 'offline'].includes(recovery.signal) || !recovery.checkedAt) throw new Error('Lokaler Agentenlauf oder sein aktuelles Netzsignal fehlt im Wiederaufnahmebeleg.');
          }
          return true;
        })()
      `;
      void window!.webContents.executeJavaScript(script).then(() => {
        const smokeStore = mustStore();
        const smokeProject = smokeStore.projects()[0]!;
        const smokeSnapshot = smokeStore.snapshot(smokeProject.id);
        const smokeCard = smokeSnapshot.cards.find((item) => item.title === 'Smoke-Karte')!;
        const f07Agent = smokeStore.saveAgent({ name: 'F07 synthetic CLI', kind: 'custom',
          command: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
          args: ['/C', join(smokeDataDirectory!, 'f07-agent.cmd')], model: null, enabled: true });
        const f07Card = smokeStore.createCard({ projectId: smokeProject.id, columnId: smokeSnapshot.columns[0]!.id, title: 'BRANCHLOOM_F07_HALTPOINT_CARD' });
        const f07Flow = smokeStore.createWorkflow({ projectId: smokeProject.id, name: 'BRANCHLOOM_F07_HALTPOINT_FLOW', cardIds: [f07Card.id], steps: [
          { id: 'f07-first', columnId: smokeSnapshot.columns[1]!.id, agentId: f07Agent.id, requireApproval: false },
          { id: 'f07-second', columnId: smokeSnapshot.columns[2]!.id, agentId: f07Agent.id, requireApproval: false },
        ] });
        const f07SafeCard = smokeStore.createCard({ projectId: smokeProject.id, columnId: smokeSnapshot.columns[0]!.id, title: 'BRANCHLOOM_F07_SAFE_PAUSE_CARD' });
        const f07SafeFlow = smokeStore.createWorkflow({ projectId: smokeProject.id, name: 'BRANCHLOOM_F07_SAFE_PAUSE_FLOW', cardIds: [f07SafeCard.id], steps: [
          { id: 'f07-safe', columnId: smokeSnapshot.columns[1]!.id, agentId: f07Agent.id, requireApproval: false },
        ] });
        const evidenceCard = smokeStore.createCard({ projectId: smokeProject.id, columnId: smokeSnapshot.columns[2]!.id, title: 'BRANCHLOOM_WORKFLOW_EVIDENCE_CARD' });
        const evidenceAgent = smokeStore.agents().find((item) => item.kind === 'codex')!;
        const evidenceFlow = smokeStore.createWorkflow({ projectId: smokeProject.id, name: 'BRANCHLOOM_WORKFLOW_EVIDENCE_FLOW', cardIds: [evidenceCard.id], steps: [
          { id: 'synthetic-evidence-step', columnId: evidenceCard.columnId, agentId: evidenceAgent.id, requireApproval: false },
        ] });
        smokeStore.ensureWorkflowProgress(evidenceFlow.id, 0, [evidenceCard.id]);
        const evidenceSession = smokeStore.createSession({ cardId: evidenceCard.id, agentId: evidenceAgent.id });
        smokeStore.beginWorkflowCard(evidenceFlow.id, 0, evidenceCard.id, evidenceSession.id);
        smokeStore.finishSession(evidenceSession.id, 'exited', 0);
        smokeStore.finishWorkflowCard(evidenceSession.id, false);
        const designContextSelection = saveDesignSelection(smokeStore, smokeProject.id, `${qaUrl}?token=synthetic`, {
          selector: 'button#design-context', tag: 'button', text: 'Synthetic design context', styles: { color: 'rgb(36, 59, 50)' }, tokens: [],
        });
        smokeStore.addCardAttachments(smokeCard.id, [join(smokeDataDirectory!, 'drop.md')]);
        const smokePlan = saveReviewedPlan(smokeStore, { projectId: smokeProject.id, request: 'Synthetischen Review-Plan prüfen', proposal: {
          title: 'Smoke-Review-Plan', explanation: 'Nur ein lokaler UI-Test.',
          cards: [{ title: 'Smoke-Review-Aufgabe', description: 'Synthetisch.' }], columnIds: [smokeSnapshot.columns[0]!.id],
        } });
        createPlanComment(smokeStore, { planId: smokePlan.id, fingerprint: smokePlan.fingerprint, line: 1, body: 'BRANCHLOOM_PLAN_REVIEW_SMOKE' });
        smokeStore.db.prepare(`INSERT INTO review_comments (id,card_id,fingerprint,file_path,side,line,body,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), smokeCard.id, 'f'.repeat(64), 'src/synthetic.ts', 'new', 14, 'BRANCHLOOM_DIFF_REVIEW_SMOKE', new Date().toISOString());
        const secondProjectPath = join(smokeProject.path, 'second-project');
        mkdirSync(secondProjectPath, { recursive: true });
        const smokeWindow = window!;
        smokeWindow.webContents.once('did-finish-load', () => {
          const boardScript = `
            (async () => {
              for (let attempt = 0; attempt < 600 && ![...document.querySelectorAll('.task-card')].some((item) => item.textContent?.includes('Smoke-Karte')); attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (![...document.querySelectorAll('.task-card')].some((item) => item.textContent?.includes('Smoke-Karte'))) {
                throw new Error('Gespeicherte Karte wurde nach Reload nicht im Board gerendert.');
              }
              const boardProject = (await window.studio.projects())[0];
              const switcher = document.querySelector('.sidebar-projects .project-switcher-trigger');
              if (!switcher || switcher.getAttribute('aria-label') !== 'Projekt auswählen: Smoke-Projekt') throw new Error('Visible project switcher is missing.');
              switcher.click();
              for (let attempt = 0; attempt < 20 && !document.querySelector('.project-switcher-panel'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const switcherPanel = document.querySelector('.project-switcher-panel');
              if (!switcherPanel?.querySelector('input[aria-label="Projekte suchen"]')) throw new Error('Project switcher search is missing.');
              switcherPanel.querySelector('.project-switcher-toolbar button')?.click();
              for (let attempt = 0; attempt < 20 && !switcherPanel.querySelector('input[aria-label="Neue Gruppe"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const groupInput = switcherPanel.querySelector('input[aria-label="Neue Gruppe"]');
              const groupSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!groupInput || !groupSetter) throw new Error('Project group cannot be created.');
              groupSetter.call(groupInput, 'Synthetic group'); groupInput.dispatchEvent(new Event('input', { bubbles: true }));
              switcherPanel.querySelector('.project-switcher-organize form')?.requestSubmit();
              let group;
              for (let attempt = 0; attempt < 100; attempt++) {
                group = (await window.studio.projectOrganization()).groups.find((item) => item.name === 'Synthetic group');
                if (group) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!group) throw new Error('Project group was not saved through the UI.');
              for (let attempt = 0; attempt < 20 && !switcherPanel.querySelector('.project-switcher-place-trigger'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              switcherPanel.querySelector('.project-switcher-place-trigger')?.click();
              for (let attempt = 0; attempt < 20 && !switcherPanel.querySelector('.project-switcher-place'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              [...switcherPanel.querySelectorAll('.project-switcher-place button')].find((item) => item.textContent === 'Synthetic group')?.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.projectOrganization()).assignments[boardProject.id] !== group.id; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.projectOrganization()).assignments[boardProject.id] !== group.id) throw new Error('Group assignment was not saved through the UI.');
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              for (let attempt = 0; attempt < 20 && document.querySelector('.project-switcher-panel'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.project-switcher-panel')) throw new Error('Project switcher did not close on Escape.');
              const evidenceSessionId = ${JSON.stringify(evidenceSession.id)};
              let baselineSessions = (await window.studio.snapshot(boardProject.id)).sessions;
              if (!baselineSessions.some((item) => item.id === evidenceSessionId)) throw new Error('Synthetische Workflow-Sitzung fehlt nach Reload.');
              if (${process.platform === 'win32'}) {
              const f07FlowId = ${JSON.stringify(f07Flow.id)};
              const f07CardId = ${JSON.stringify(f07Card.id)};
              const f07WorkflowNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Workflows'));
              if (!f07WorkflowNav) throw new Error('F07: Workflow navigation is missing.');
              f07WorkflowNav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('#workflow-' + f07FlowId + ' .workflow-haltpoint'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const f07Article = document.getElementById('workflow-' + f07FlowId);
              const f07Set = [...(f07Article?.querySelectorAll('.workflow-haltpoint-actions button') ?? [])].find((item) => item.textContent?.includes('Haltepunkt setzen'));
              if (!f07Set) throw new Error('F07: The two-step workflow has no visible haltpoint action.');
              f07Set.click();
              for (let attempt = 0; attempt < 100 && !f07Article?.textContent?.includes('Haltepunkt angefordert'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!f07Article?.textContent?.includes('Haltepunkt angefordert')) throw new Error('F07: Requested boundary is not shown.');
              const f07Start = [...f07Article.querySelectorAll('.workflow-actions button')].find((item) => item.textContent?.trim() === 'Starten');
              if (!f07Start) throw new Error('F07: The workflow cannot be started through the UI.');
              f07Start.click();
              for (let attempt = 0; attempt < 200 && !f07Article.textContent?.includes('Haltepunkt erreicht'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const f07Reached = (await window.studio.snapshot(boardProject.id)).workflows.find((item) => item.id === f07FlowId);
              if (f07Reached?.state !== 'paused' || f07Reached.currentStep !== 1 || f07Reached.haltpoint?.state !== 'reached'
                || !f07Article.textContent?.includes('Nach Haltepunkt fortsetzen')
                || (await window.studio.snapshot(boardProject.id)).sessions.filter((item) => item.cardId === f07CardId).length !== 1)
                throw new Error('F07: The first real CLI step did not stop visibly before its successor: ' + JSON.stringify({ flow: f07Reached, article: f07Article.textContent?.slice(0, 500), sessions: (await window.studio.snapshot(boardProject.id)).sessions.filter((item) => item.cardId === f07CardId).map((item) => ({ state: item.state, exitCode: item.exitCode, output: item.output.slice(-250) })) }));
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board')?.click();
              for (let attempt = 0; attempt < 100 && !document.getElementById('board-card-' + f07CardId); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              document.getElementById('board-card-' + f07CardId)?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer')?.textContent?.includes('Haltepunkt nach Schritt 1 erreicht'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-drawer')?.textContent?.includes('Haltepunkt nach Schritt 1 erreicht')) throw new Error('F07: The affected card does not show the reached boundary.');
              document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.card-drawer'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              f07WorkflowNav.click();
              const f07SafeId = ${JSON.stringify(f07SafeFlow.id)};
              for (let attempt = 0; attempt < 100 && !document.getElementById('workflow-' + f07SafeId); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const f07SafeStart = [...(document.getElementById('workflow-' + f07SafeId)?.querySelectorAll('.workflow-actions button') ?? [])].find((item) => item.textContent?.trim() === 'Starten');
              if (!f07SafeStart) throw new Error('F07: Safe-pause workflow cannot start through the UI.');
              f07SafeStart.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.snapshot(boardProject.id)).sessions.some((item) => item.cardId === ${JSON.stringify(f07SafeCard.id)} && item.state === 'running'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.snapshot(boardProject.id)).sessions.some((item) => item.cardId === ${JSON.stringify(f07SafeCard.id)} && item.state === 'running')) throw new Error('F07: The second CLI was not running before safe pause.');
              const f07Pause = document.querySelector('.project-pause-button');
              f07Pause?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.project-pause-status')?.textContent?.includes('Anhalten angefordert'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.snapshot(boardProject.id)).runPause.state !== 'requested'
                || !document.querySelector('.project-pause-status')?.textContent?.includes('Anhalten angefordert')) throw new Error('F07: Active CLI is not shown as a requested pause.');
              for (let attempt = 0; attempt < 200 && !document.querySelector('.project-pause-status')?.textContent?.includes('Projekt angehalten'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.snapshot(boardProject.id)).runPause.state !== 'paused'
                || !document.querySelector('.project-pause-status')?.textContent?.includes('Projekt angehalten')) throw new Error('F07: Safe pause did not become visible after the CLI ended.');
              document.querySelector('.project-pause-button')?.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.snapshot(boardProject.id)).runPause.state !== 'active'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board')?.click();
              for (let attempt = 0; attempt < 100 && !document.getElementById('board-card-' + f07CardId); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              }
              baselineSessions = (await window.studio.snapshot(boardProject.id)).sessions;
              const pauseControl = document.querySelector('.project-pause-button');
              if (!pauseControl || pauseControl.disabled || pauseControl.getAttribute('aria-label') !== 'Sicher anhalten')
                throw new Error('Projektweite sichere Pause ist nicht als bedienbarer Schalter sichtbar.');
              pauseControl.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.project-pause-status'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.snapshot(boardProject.id)).runPause.state !== 'paused' || document.querySelector('.project-pause-status')?.textContent?.includes('Projekt angehalten') !== true)
                throw new Error('Projektpause wurde im Renderer nicht als angehalten angezeigt.');
              const resumeControl = document.querySelector('.project-pause-button');
              if (resumeControl?.getAttribute('aria-label') !== 'Projekt fortsetzen') throw new Error('Bewusstes Fortsetzen ist nicht sichtbar.');
              resumeControl.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.project-pause-status'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.snapshot(boardProject.id)).runPause.state !== 'active' || document.querySelector('.project-pause-status'))
                throw new Error('Projektpause wurde nach bewusstem Fortsetzen nicht aufgehoben.');
              const baselineSessionIds = baselineSessions.map((item) => item.id).sort();
              const sessionsUnchanged = async () => JSON.stringify((await window.studio.snapshot(boardProject.id)).sessions.map((item) => item.id).sort()) === JSON.stringify(baselineSessionIds);
              const storedColumns = (await window.studio.snapshot(boardProject.id)).columns.map((item) => item.name);
              const renderedColumns = [...document.querySelectorAll('.board-column .column-title h3')].map((item) => item.textContent);
              if (JSON.stringify(renderedColumns) !== JSON.stringify(storedColumns)) throw new Error('Gespeicherte Spaltenreihenfolge wurde nach Reload nicht gerendert.');
              const bulkCard = (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.title === 'Smoke-Karte');
              if (!bulkCard || bulkCard.priority !== 'none') throw new Error('Bulk-Priorität: Ausgangskarte fehlt.');
              if (${process.platform === 'win32'} && baselineSessions.filter((item) => item.cardId === bulkCard.id).length !== 1) throw new Error('Ursprünglicher lokaler Smoke-Lauf fehlt.');
              const keyboardCard = document.getElementById('board-card-' + bulkCard.id);
              if (!keyboardCard) throw new Error('Karten-Tastaturtest: Auslöser fehlt.');
              const quickTrigger = keyboardCard.parentElement?.querySelector('.card-quick-trigger');
              if (!(quickTrigger instanceof HTMLButtonElement)) throw new Error('Card quick-action trigger is missing.');
              quickTrigger.click();
              for (let attempt = 0; attempt < 100 && !keyboardCard.parentElement?.querySelector('.card-quick-actions'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const quickActions = keyboardCard.parentElement?.querySelector('.card-quick-actions');
              const hasSavedSession = baselineSessions.some((item) => item.cardId === bulkCard.id);
              if (!quickActions?.textContent?.includes('Karten-ID kopieren') || quickActions.textContent.includes('Worktree öffnen') || quickActions.textContent.includes('Sitzung ansehen') !== hasSavedSession) throw new Error('Card quick actions have the wrong options: ' + JSON.stringify({ text: quickActions?.textContent, hasSavedSession, cardId: bulkCard.id, sessions: baselineSessions.filter((item) => item.cardId === bulkCard.id).map((item) => ({ id: item.id, worktreePath: item.worktreePath })) }));
              quickActions.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
              for (let attempt = 0; attempt < 100 && (document.querySelector('.card-quick-actions') || document.activeElement !== quickTrigger); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.card-quick-actions') || document.activeElement !== quickTrigger) throw new Error('Card quick actions did not close on Escape and restore focus.');
              quickTrigger.click();
              for (let attempt = 0; attempt < 100 && !keyboardCard.parentElement?.querySelector('.card-quick-actions'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const copyAction = [...(keyboardCard.parentElement?.querySelectorAll('.card-quick-actions button') ?? [])].find((item) => item.textContent?.includes('Karten-ID kopieren'));
              copyAction?.click();
              for (let attempt = 0; attempt < 100 && keyboardCard.parentElement?.querySelector('.card-quick-actions'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (keyboardCard.parentElement?.querySelector('.card-quick-actions') || document.activeElement !== quickTrigger || !document.querySelector('.board-page p.sr-only[role="status"]')?.textContent?.includes('Karten-ID')) throw new Error('Card ID was not copied or focus was not restored: ' + JSON.stringify({ open: Boolean(keyboardCard.parentElement?.querySelector('.card-quick-actions')), focus: document.activeElement?.getAttribute('aria-label'), announcement: document.querySelector('.board-page p.sr-only[role="status"]')?.textContent, error: keyboardCard.parentElement?.querySelector('.card-quick-error')?.textContent }));
              if (hasSavedSession) {
                quickTrigger.click();
                for (let attempt = 0; attempt < 100 && !keyboardCard.parentElement?.querySelector('.card-quick-actions'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                const sessionAction = [...(keyboardCard.parentElement?.querySelectorAll('.card-quick-actions button') ?? [])].find((item) => item.textContent?.includes('Sitzung ansehen'));
                sessionAction?.click();
                for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (![...document.querySelectorAll('.card-drawer .section-heading')].some((item) => item.textContent?.includes('Terminal')) || !document.querySelector('.card-drawer')?.contains(document.activeElement)) throw new Error('Quick action did not open the saved session in the card dialog.');
                document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
                for (let attempt = 0; attempt < 100 && (document.querySelector('.card-drawer') || document.activeElement !== quickTrigger); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (document.querySelector('.card-drawer') || document.activeElement !== quickTrigger) throw new Error('Closing the card dialog did not restore focus to the quick-action trigger.');
              }
              let foreignWorktreeBlocked = false;
              try { await window.studio.openCardWorktree({ projectId: 'foreign-project', cardId: bulkCard.id }); }
              catch (reason) { foreignWorktreeBlocked = String(reason).includes('gewählten Projekt'); }
              let foreignCopyBlocked = false;
              try { await window.studio.copyCardId({ projectId: 'foreign-project', cardId: bulkCard.id }); }
              catch (reason) { foreignCopyBlocked = String(reason).includes('gewählten Projekt'); }
              if (!foreignWorktreeBlocked || !foreignCopyBlocked || !(await sessionsUnchanged())) throw new Error('Cross-project card quick action was not rejected.');
              keyboardCard.focus();
              keyboardCard.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer[role="dialog"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const keyboardDialog = document.querySelector('.card-drawer[role="dialog"]');
              const keyboardClose = keyboardDialog?.querySelector('button[aria-label="Karte schließen"]');
              if (!keyboardDialog || keyboardDialog.getAttribute('aria-modal') !== 'true' || keyboardDialog.getAttribute('aria-labelledby') !== keyboardDialog.querySelector('h2')?.id || document.activeElement !== keyboardClose) throw new Error('Karten-Tastaturtest: Dialogbezeichnung oder Anfangsfokus fehlt.');
              if (${process.platform === 'win32'}) {
                for (let attempt = 0; attempt < 100 && !keyboardDialog.querySelector('.session-recovery')?.textContent?.includes('Gerät meldet'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (!keyboardDialog.querySelector('.session-recovery')?.textContent?.includes('Dieser Lauf ist beendet')) throw new Error('Gespeicherter Agentenlauf zeigt keinen belegten Wiederaufnahme-Status.');
              }
              const keyboardControls = [...keyboardDialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])')]
                .filter((item) => item.getClientRects().length > 0);
              const keyboardFirst = keyboardControls[0];
              const keyboardLast = keyboardControls.at(-1);
              if (!keyboardFirst || !keyboardLast || keyboardFirst === keyboardLast || !keyboardFirst.classList.contains('card-replay-jump')) throw new Error('Karten-Tastaturtest: Erster oder letzter Dialogfokus fehlt.');
              keyboardFirst.focus();
              keyboardFirst.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
              if (document.activeElement !== keyboardLast) throw new Error('Karten-Tastaturtest: Rückwärts-Tab verließ den Dialog.');
              keyboardLast.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
              if (document.activeElement !== keyboardFirst) throw new Error('Karten-Tastaturtest: Vorwärts-Tab kehrte nicht zum Dialoganfang zurück.');
              keyboardClose.focus();
              keyboardClose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
              for (let attempt = 0; attempt < 100 && (document.querySelector('.card-drawer') || document.activeElement !== keyboardCard); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.card-drawer') || document.activeElement !== keyboardCard || !(await sessionsUnchanged())) throw new Error('Karten-Tastaturtest: Escape schloss nicht mit Fokus-Rückgabe oder startete einen Agenten.');
              keyboardCard.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const gateDialog = document.querySelector('.card-drawer');
              for (let attempt = 0; attempt < 100 && !gateDialog?.querySelector('[aria-label="Parallele Kartenläufe"]')?.textContent?.includes('0 von 3 Plätzen'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!gateDialog?.querySelector('[aria-label="Parallele Kartenläufe"]')?.textContent?.includes('0 von 3 Plätzen')) throw new Error('Kartenansicht zeigt die gespeicherte Projektkapazität nicht.');
              const gateLabel = [...(gateDialog?.querySelectorAll('label') ?? [])].find((item) => item.textContent?.includes('Wireframe vor Agentenstart prüfen'));
              const gateToggle = gateLabel?.querySelector('input[type="checkbox"]');
              if (!(gateToggle instanceof HTMLInputElement) || gateToggle.checked) throw new Error('Optionale Karten-Wireframe-Freigabe fehlt oder ist standardmäßig aktiv.');
              gateToggle.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.snapshot(boardProject.id)).cards.find((item) => item.id === bulkCard.id)?.wireframeRequired; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.snapshot(boardProject.id)).cards.find((item) => item.id === bulkCard.id)?.wireframeRequired) throw new Error('Wireframe-Pflicht wurde nicht gespeichert.');
              let gateBlocked = false;
              try { await window.studio.startSession({ cardId: bulkCard.id, agentId: ${JSON.stringify(evidenceAgent.id)}, prompt: 'Synthetischer gesperrter Start' }); }
              catch (reason) { gateBlocked = String(reason).includes('aktuell freigegebenen Wireframe'); }
              if (!gateBlocked || !(await sessionsUnchanged())) throw new Error('Karten-Wireframe-Pflicht ließ einen Agenten ohne Freigabe starten.');
              gateDialog?.querySelector('button[aria-label="Karte schließen"]')?.click();
              const bulkSelect = document.querySelector('.board-card-wrap input[aria-label="„Smoke-Karte“ für Sammelaktion auswählen"]');
              if (!bulkSelect) throw new Error('Bulk-Priorität: Kartenauswahl fehlt.');
              bulkSelect.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.board-bulk-more'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const bulkMore = document.querySelector('.board-bulk-more');
              if (!bulkMore) throw new Error('Bulk-Priorität: weitere Aktion fehlt.');
              bulkMore.querySelector('summary')?.click();
              const bulkPrioritySelect = bulkMore.querySelector('select[aria-label="Priorität für ausgewählte Karten"]');
              const bulkSelectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!bulkPrioritySelect || !bulkSelectSetter) throw new Error('Bulk-Priorität: Auswahlliste fehlt.');
              bulkSelectSetter.call(bulkPrioritySelect, 'high');
              bulkPrioritySelect.dispatchEvent(new Event('change', { bubbles: true }));
              let bulkCheckButton;
              for (let attempt = 0; attempt < 100; attempt++) {
                bulkCheckButton = [...document.querySelectorAll('.board-bulk-more button')].find((item) => item.textContent?.includes('Priorität prüfen'));
                if (bulkCheckButton && !bulkCheckButton.disabled) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!bulkCheckButton || bulkCheckButton.disabled || (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.id === bulkCard.id)?.priority !== 'none') throw new Error('Bulk-Priorität: Vorschau fehlt oder schrieb vor Bestätigung.');
              bulkCheckButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('[aria-label="Prioritätsänderung bestätigen"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const bulkConfirmation = document.querySelector('[aria-label="Prioritätsänderung bestätigen"]');
              for (let attempt = 0; attempt < 100 && (!bulkConfirmation?.textContent?.includes('1 Karte auf „Hoch“ setzen?') || !bulkConfirmation.textContent.includes('1 davon ändert sich.')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!bulkConfirmation?.textContent?.includes('1 Karte auf „Hoch“ setzen?') || !bulkConfirmation.textContent.includes('1 davon ändert sich.')) throw new Error('Bulk-Priorität: Bestätigung zeigt keine echte Änderung: ' + JSON.stringify({ text: bulkConfirmation?.textContent, selected: [...document.querySelectorAll('.board-card-wrap input[type="checkbox"]:checked')].map((item) => item.getAttribute('aria-label')), priority: (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.id === bulkCard.id)?.priority }));
              bulkConfirmation.querySelector('button')?.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.id === bulkCard.id)?.priority !== 'high'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.snapshot(boardProject.id)).cards.find((item) => item.id === bulkCard.id)?.priority !== 'high' || !(await sessionsUnchanged())) throw new Error('Bulk-Priorität: Bestätigung speicherte nicht atomar oder startete einen Agenten.');
              for (let attempt = 0; attempt < 100 && !document.querySelector('.board-bulk-result'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.board-bulk-result')?.textContent?.includes('1 Karte hat jetzt Priorität „Hoch“')) throw new Error('Bulk-Priorität: sichtbarer Ergebnistext fehlt.');
              const ideasNavAfterReload = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Ideenraum'));
              if (!ideasNavAfterReload) throw new Error('Ideenraum-Navigation fehlt.');
              ideasNavAfterReload.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.ideas-note-open'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (![...document.querySelectorAll('.ideas-note-open')].some((item) => item.textContent?.includes('Smoke-Idee'))) throw new Error('Gespeicherte Idee wurde nach Reload nicht angezeigt.');
              const smokeNote = [...document.querySelectorAll('.ideas-note')].find((item) => item.textContent?.includes('Smoke-Idee'));
              const discussNote = smokeNote?.querySelector('.ideas-note-foot button');
              if (!(discussNote instanceof HTMLButtonElement)) throw new Error('Tastaturweg zum Weiterdenken fehlt.');
              discussNote.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.ideas-conversation-subject')?.textContent?.includes('Smoke-Idee'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.ideas-ask textarea')?.disabled || !(await sessionsUnchanged())) throw new Error('Weiterdenken öffnete nicht nur die gespeicherte Notiz.');
              const dragData = new DataTransfer();
              smokeNote.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dragData }));
              const discussionDrop = document.querySelector('.ideas-conversation');
              discussionDrop?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dragData }));
              discussionDrop?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dragData }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.ideas-conversation-subject')?.textContent?.includes('Smoke-Idee'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.ideas-conversation-subject')?.textContent?.includes('Smoke-Idee') || !(await sessionsUnchanged())) throw new Error('Notiz-Drop öffnete keine lokale Diskussion oder startete einen Agenten.');
              const ideaImport = [...document.querySelectorAll('.ideas-heading > button')].find((item) => item.textContent?.includes('Aus Trello vormerken'));
              const selectedTrelloIdea = [...document.querySelectorAll('.ideas-note-open')].find((item) => item.textContent?.includes('Trello-Idee aktualisiert'));
              if (!(ideaImport instanceof HTMLButtonElement) || !(selectedTrelloIdea instanceof HTMLButtonElement)) throw new Error('Aktualisierte Trello-Idee oder Import-Einstieg fehlt im Ideenraum.');
              selectedTrelloIdea.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.ideas-editor input')?.value !== 'Trello-Idee aktualisiert'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.ideas-editor input')?.value !== 'Trello-Idee aktualisiert') throw new Error('Vorgemerkte Trello-Idee wurde nicht geöffnet.');
              ideaImport.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.trello-import-dialog'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const ideaDialog = document.querySelector('.trello-import-dialog');
              if (!ideaDialog?.textContent?.includes('Trello-Ideen vormerken')) throw new Error('Trello-Ideen-Vorschau wurde nicht geöffnet.');
              const trelloIdeaFileTab = [...ideaDialog.querySelectorAll('.trello-source-tabs button')].find((item) => item.textContent?.includes('JSON-Datei'));
              if (!trelloIdeaFileTab) throw new Error('Trello-Ideen: JSON-Datei-Einstieg fehlt.');
              trelloIdeaFileTab.click();
              for (let attempt = 0; attempt < 100 && !ideaDialog.querySelector('input[type="file"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const ideaFile = ideaDialog.querySelector('input[type="file"]');
              if (!(ideaFile instanceof HTMLInputElement)) throw new Error('Trello-Ideen: Dateiauswahl fehlt.');
              const changedSource = JSON.stringify({ name: 'Synthetisches Trello-Board', lists: [{ id: 'cccccccccccccccccccccccc', name: 'Ideen' }], cards: [{ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', idList: 'cccccccccccccccccccccccc', name: 'Trello-Idee aktualisiert', desc: 'Neue Quelle', closed: false }] });
              const trelloIdeaTransfer = new DataTransfer();
              trelloIdeaTransfer.items.add(new File([changedSource], 'synthetic-trello.json', { type: 'application/json' }));
              ideaFile.files = trelloIdeaTransfer.files;
              ideaFile.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && ![...ideaDialog.querySelectorAll('button')].some((item) => item.textContent?.includes('Datei prüfen') && !item.disabled); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const inspectFile = [...ideaDialog.querySelectorAll('button')].find((item) => item.textContent?.includes('Datei prüfen'));
              if (!(inspectFile instanceof HTMLButtonElement) || inspectFile.disabled) throw new Error('Trello-Ideen: synthetische Datei wurde nicht gelesen.');
              inspectFile.click();
              for (let attempt = 0; attempt < 100 && !ideaDialog.querySelector('.trello-preview-item button'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const trelloIdeaCompareButton = ideaDialog.querySelector('.trello-preview-item button');
              if (!(trelloIdeaCompareButton instanceof HTMLButtonElement) || !ideaDialog.textContent?.includes('Trello-Quelle geändert')) throw new Error('Trello-Ideen: Quelländerung wurde nicht sichtbar.');
              trelloIdeaCompareButton.click();
              for (let attempt = 0; attempt < 100 && !ideaDialog.querySelector('.trello-source-comparison'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const comparisonPanel = ideaDialog.querySelector('.trello-source-comparison');
              if (!comparisonPanel?.textContent?.includes('Neue Quelle') || !comparisonPanel.textContent.includes('Später planen')) throw new Error('Trello-Ideen: Quellenvergleich zeigt die beiden Fassungen nicht.');
              const notesChoice = [...comparisonPanel.querySelectorAll('.trello-compare-actions label')].find((item) => item.textContent?.includes('Notizen aus Trello'));
              const notesInput = notesChoice?.querySelector('input');
              if (!(notesInput instanceof HTMLInputElement)) throw new Error('Trello-Ideen: Feldauswahl fehlt.');
              notesInput.click();
              const applySourceButton = [...comparisonPanel.querySelectorAll('button')].find((item) => item.textContent?.includes('Ausgewählte Felder übernehmen'));
              if (!(applySourceButton instanceof HTMLButtonElement) || applySourceButton.disabled) throw new Error('Trello-Ideen: bewusste Übernahme fehlt.');
              applySourceButton.click();
              for (let attempt = 0; attempt < 100 && !ideaDialog.querySelector('.trello-source-comparison [role="status"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!ideaDialog.querySelector('.trello-source-comparison [role="status"]') || !(await window.studio.ideas(boardProject.id)).some((item) => item.title === 'Trello-Idee aktualisiert' && item.body.includes('Neue Quelle'))) throw new Error('Trello-Ideen: selektive Übernahme erreichte SQLite nicht.');
              for (let attempt = 0; attempt < 100 && !document.querySelector('.ideas-editor textarea')?.value.includes('Neue Quelle'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.ideas-editor textarea')?.value.includes('Neue Quelle')) throw new Error('Trello-Ideen: geöffneter Editor blieb nach Quellenübernahme veraltet.');
              for (let attempt = 0; attempt < 100 && ideaDialog.querySelector('button[aria-label="Schließen"]')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              ideaDialog.querySelector('button[aria-label="Schließen"]')?.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.trello-import-dialog'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.trello-import-dialog') || (await window.studio.ideas(boardProject.id)).length !== 2) throw new Error('Abbruch im Trello-Ideen-Dialog veränderte den Ideenraum.');
              const localIdeaButton = [...document.querySelectorAll('.ideas-note-open')].find((item) => item.textContent?.includes('Smoke-Idee'));
              if (!(localIdeaButton instanceof HTMLButtonElement)) throw new Error('Lokale Idee für Duplikatvergleich fehlt.');
              const localIdea = (await window.studio.ideas(boardProject.id)).find((item) => item.title === 'Smoke-Idee');
              if (!localIdea) throw new Error('Gespeicherte Vergleichsidee fehlt.');
              await window.studio.updateCard({ id: bulkCard.id, title: 'Smoke-Idee', description: 'Smoke-Karte als Vergleichsquelle' });
              localIdeaButton.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.ideas-editor input')?.value !== 'Smoke-Idee'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              document.querySelector('.ideas-similar > summary')?.click();
              const matchCheck = [...document.querySelectorAll('.idea-match-panel button')].find((item) => item.textContent?.includes('Vorschläge prüfen'));
              if (!(matchCheck instanceof HTMLButtonElement) || matchCheck.disabled) throw new Error('Ähnlichkeitsprüfung ist nicht bewusst startbar.');
              matchCheck.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.idea-match-pair'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const matchPair = document.querySelector('.idea-match-pair');
              if (!matchPair?.textContent?.includes('Synthetische Notiz') || !matchPair.textContent.includes('Smoke-Karte')) throw new Error('Ideen-/Board-Vergleich zeigt die beiden Quellen nicht: ' + matchPair?.textContent?.slice(0, 300));
              const matchLink = [...document.querySelectorAll('.idea-match-actions button')].find((item) => item.textContent?.includes('Als dieselbe Idee verknüpfen'));
              if (!(matchLink instanceof HTMLButtonElement) || matchLink.disabled || (await window.studio.previewIdeaMatches({ projectId: boardProject.id, ideaId: localIdea.id })).links.length) throw new Error('Duplikat-Vorschau schrieb vor Bestätigung.');
              matchLink.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.previewIdeaMatches({ projectId: boardProject.id, ideaId: localIdea.id })).links.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const matched = await window.studio.previewIdeaMatches({ projectId: boardProject.id, ideaId: localIdea.id });
              if (matched.links[0]?.id !== bulkCard.id || !document.querySelector('.idea-match-links')?.textContent?.includes('Bereits verbunden') || !(await sessionsUnchanged())) throw new Error('Bewusste Duplikat-Verknüpfung wurde nicht gespeichert oder startete einen Agenten.');
              const unlinkMatch = [...document.querySelectorAll('.idea-match-links button')].find((item) => item.textContent?.includes('Lösen'));
              unlinkMatch?.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.previewIdeaMatches({ projectId: boardProject.id, ideaId: localIdea.id })).links.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.previewIdeaMatches({ projectId: boardProject.id, ideaId: localIdea.id })).links.length) throw new Error('Duplikat-Verknüpfung ließ sich nicht lösen.');
              await window.studio.updateCard({ id: bulkCard.id, title: 'Smoke-Karte', description: bulkCard.description });
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board')?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.task-card'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const discussion = [...document.querySelectorAll('.board-header-actions button')].find((item) => item.textContent?.includes('Aufgabe vorbereiten'));
              if (!discussion) throw new Error('Aufgabenklärung fehlt im Board.');
              discussion.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('[role="dialog"][aria-label="Aufgabe besprechen"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('[role="dialog"][aria-label="Aufgabe besprechen"]')) throw new Error('Aufgabenklärung öffnete sich nicht.');
              document.querySelector('[role="dialog"][aria-label="Aufgabe besprechen"] button[aria-label="Schließen"]')?.click();
              const projectChatNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Projektgespräch'));
              if (!projectChatNav) throw new Error('Projektgespräch fehlt in der Navigation.');
              projectChatNav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.project-chat textarea'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.project-chat[aria-label="Projektgespräch"] textarea') || !(await sessionsUnchanged())) throw new Error('Projektgespräch wurde nicht als lesende Arbeitsfläche geöffnet.');
              const conversationField = document.querySelector('.project-chat textarea');
              document.querySelector('button[aria-label="Projektgespräch als Seitenleiste"]')?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.project-chat-host.dock:not([hidden])'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.project-chat-host.dock:not([hidden])') || !conversationField?.isConnected || !(await sessionsUnchanged())) throw new Error('Projektgespräch blieb beim Wechsel in die Seitenleiste nicht erhalten.');
              const whiteboardNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Whiteboard'));
              if (!whiteboardNav) throw new Error('Whiteboard-Navigation fehlt.');
              whiteboardNav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.wb-view'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.project-chat-host.dock:not([hidden])') || !conversationField?.isConnected) throw new Error('Projektgespräch ging beim Wechsel zum Whiteboard verloren.');
              document.querySelector('button[aria-label="Projektgespräch schließen"]')?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.project-chat-host.dock[hidden]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.project-chat-host.dock[hidden]') || !conversationField?.isConnected) throw new Error('Projektgespräch wurde beim Schließen unerwartet gelöscht: hidden=' + Boolean(document.querySelector('.project-chat-host.dock[hidden]')) + ', connected=' + conversationField?.isConnected + '.');
              let whiteboardReady = false;
              for (let attempt = 0; attempt < 300; attempt++) {
                whiteboardReady = Boolean(document.querySelector('.wb-canvas') && document.querySelector('.wb-node'));
                if (whiteboardReady) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const whiteboard = await window.studio.whiteboard(boardProject.id);
              if (!whiteboardReady || whiteboard.nodes.length !== 2 || whiteboard.edges.length !== 1) throw new Error('Whiteboard-Boxen oder Verbindungen wurden nach Reload nicht angezeigt/gespeichert.');
              const folderNode = [...document.querySelectorAll('.wb-node')].find((item) => item.textContent?.includes('Smoke-Ordner'));
              if (!folderNode) throw new Error('Whiteboard-Ordnerbox fehlt im Canvas.');
              folderNode.click();
              let impactButton;
              for (let attempt = 0; attempt < 100; attempt++) {
                impactButton = [...document.querySelectorAll('.wb-impact button')].find((item) => item.textContent?.includes('Direkte Imports prüfen'));
                if (impactButton && !impactButton.disabled) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!impactButton || impactButton.disabled) throw new Error('Whiteboard-Änderungswirkung fehlt im Inspector.');
              impactButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.wb-impact-result'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.wb-impact-result')?.textContent?.includes('screen.ts:1')) throw new Error('Whiteboard-Importbeleg fehlt im Inspector.');
              if (!document.querySelector('.wb-impact-result')?.textContent?.includes('page.ts:1') || !document.querySelector('.wb-impact-result')?.textContent?.includes('app.ts:1')) throw new Error('Whiteboard-Importkette fehlt im Inspector.');
              if (!document.querySelector('.wb-impact-result')?.textContent?.includes('Bezug: Ordner src')) throw new Error('Whiteboard-Importbeleg zeigt keinen geprüften Bezug.');
              const impactSessionsBefore = (await window.studio.snapshot(boardProject.id)).sessions.length;
              const impactDraftButton = document.querySelector('.wb-impact-result button[aria-label^="Kartenentwurf aus Import"]');
              if (!impactDraftButton) throw new Error('Whiteboard-Importbeleg bietet keinen Kartenentwurf.');
              impactDraftButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('form[aria-label="Karte aus Importbeleg"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const impactForm = document.querySelector('form[aria-label="Karte aus Importbeleg"]');
              if (!impactForm?.querySelector('input') || !impactForm?.querySelector('textarea') || !impactForm.textContent?.includes('screen.ts:1')) throw new Error('Editierbarer Whiteboard-Import-Kartenentwurf fehlt.');
              const impactSubmit = impactForm.querySelector('button[type="submit"]');
              if (!impactSubmit || impactSubmit.disabled) throw new Error('Whiteboard-Import-Kartenentwurf konnte nicht bestätigt werden.');
              impactSubmit.click();
              let impactCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                impactCard = (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.title.includes('Änderung an src/widget.ts prüfen'));
                if (impactCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!impactCard?.description.includes('Whiteboard-Importbezug:') || !impactCard.description.includes('screen.ts:1 importiert src/widget.ts')) throw new Error('Whiteboard-Import-Karte ohne geprüften Quellenbezug.');
              if ((await window.studio.snapshot(boardProject.id)).sessions.length !== impactSessionsBefore) throw new Error('Whiteboard-Import-Karte startete einen Agenten.');
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-drawer')) throw new Error('Neue Whiteboard-Import-Karte wurde nicht geöffnet.');
              document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
              whiteboardNav.click();
              let folderAfterCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                folderAfterCard = [...document.querySelectorAll('.wb-node')].find((item) => item.textContent?.includes('Smoke-Ordner'));
                if (folderAfterCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!folderAfterCard) throw new Error('Whiteboard nach Kartenanlage nicht erreichbar.');
              folderAfterCard.click();
              let impactButtonAgain;
              for (let attempt = 0; attempt < 100; attempt++) {
                impactButtonAgain = [...document.querySelectorAll('.wb-impact button')].find((item) => item.textContent?.includes('Direkte Imports prüfen'));
                if (impactButtonAgain && !impactButtonAgain.disabled) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!impactButtonAgain || impactButtonAgain.disabled) throw new Error('Whiteboard-Importprüfung nach Kartenanlage fehlt.');
              impactButtonAgain.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.wb-impact-result'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.wb-impact-result')) throw new Error('Whiteboard-Importprüfung nach Kartenanlage ohne Ergebnis.');
              const pathInput = [...document.querySelectorAll('.wb-inspector label')].find((item) => item.textContent?.includes('Relativer Ordnerpfad'))?.querySelector('input');
              const pathSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!pathInput || !pathSetter) throw new Error('Whiteboard-Pfadeditor fehlt.');
              pathSetter.call(pathInput, 'anderer-pfad');
              pathInput.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && document.querySelector('.wb-impact-result'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.wb-impact-result')) throw new Error('Veralteter Whiteboard-Importbeleg bleibt nach Pfadänderung sichtbar.');
              const linkedNode = [...document.querySelectorAll('.wb-node')].find((item) => item.textContent?.includes('Smoke-Aufgabe'));
              if (!linkedNode) throw new Error('Verknüpfte Whiteboard-Box fehlt im Canvas.');
              linkedNode.click();
              let openLinkedCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                openLinkedCard = [...document.querySelectorAll('.wb-inspector button')].find((item) => item.textContent?.includes('Karte öffnen'));
                if (openLinkedCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!openLinkedCard) throw new Error('Whiteboard-Kartenlink fehlt im Inspector.');
              openLinkedCard.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-drawer')?.textContent?.includes('Smoke-Karte')) throw new Error('Whiteboard-Kartenlink öffnete nicht die Karte.');
              const qaForm = document.querySelector('.card-drawer .card-qa-form');
              if (!qaForm) throw new Error('Karten-QA-Formular fehlt.');
              for (let attempt = 0; attempt < 100 && document.querySelector('.card-qa')?.textContent?.includes('Gespeicherte Prüfungen werden geladen'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.card-qa')?.textContent?.includes('Gespeicherte Prüfungen werden geladen')) throw new Error('Karten-QA-Berichte wurden nicht geladen.');
              const qaInput = qaForm.querySelector('input');
              if (!qaInput) throw new Error('Karten-QA-URL-Feld fehlt.');
              const qaValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!qaValueSetter) throw new Error('Browser-QA-Eingabe kann im Smoke nicht gesetzt werden.');
              qaValueSetter.call(qaInput, ${JSON.stringify(qaUrl)});
              qaInput.dispatchEvent(new Event('input', { bubbles: true }));
              const qaViewport = qaForm.querySelector('select');
              const viewportSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!qaViewport || !viewportSetter) throw new Error('Karten-QA-Prüfgrößen fehlen.');
              viewportSetter.call(qaViewport, 'tablet');
              qaViewport.dispatchEvent(new Event('change', { bubbles: true }));
              const qaButton = qaForm.querySelector('button[type="submit"]');
              for (let attempt = 0; attempt < 100 && qaButton?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!qaButton || qaButton.disabled) throw new Error('Karten-QA-Schaltfläche wurde nicht aktiv.');
              qaButton?.click();
              let qaReport;
              const qaCard = (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.title === 'Smoke-Karte');
              if (!qaCard) throw new Error('QA-Smoke-Karte fehlt.');
              for (let attempt = 0; attempt < 500; attempt++) {
                qaReport = (await window.studio.cardQaReports(qaCard.id))[0];
                if (qaReport) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (qaReport?.status !== 'failed' || qaReport.viewportWidth !== 768 || qaReport.viewportHeight !== 1024 || !qaReport.diagnostics.some((item) => item.message.includes('BRANCHLOOM_QA_SMOKE_ERROR')) || qaReport.pageCheck !== 'complete' || !qaReport.pageObservations.some((item) => item.kind === 'missing-image-alt') || !qaReport.pageObservations.some((item) => item.kind === 'horizontal-overflow')) throw new Error('Lokale Karten-QA hat Tablet-Viewport, Browserfehler oder DOM-Hinweise nicht gespeichert: ' + JSON.stringify({ report: qaReport, form: qaForm.textContent, value: qaInput.value, disabled: qaButton?.disabled, error: document.querySelector('.card-qa .inline-error')?.textContent }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-qa-report')?.textContent?.includes('BRANCHLOOM_QA_SMOKE_ERROR'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-qa-report')?.textContent?.includes('BRANCHLOOM_QA_SMOKE_ERROR') || !document.querySelector('.card-qa-report')?.textContent?.includes('Bildern ohne alt-Attribut') || !document.querySelector('.card-qa-report')?.textContent?.includes('breiter als der sichtbare Inhaltsbereich') || !document.querySelector('.card-qa-report')?.textContent?.includes('Git im Projektordner')) throw new Error('Karten-QA-Bericht wurde nicht samt DOM- und Git-Belegen sichtbar gerendert.');
              const teamReview = document.querySelector('.card-qa-report .team-review-panel');
              if (!teamReview) throw new Error('Saved QA screenshot has no local review panel.');
              teamReview.querySelector('summary')?.click();
              const reviewInputs = teamReview.querySelectorAll('.team-review-form input');
              if (reviewInputs.length !== 2) throw new Error('Local review scenario or reviewer input is missing.');
              qaValueSetter.call(reviewInputs[0], 'Synthetic settings review');
              reviewInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
              qaValueSetter.call(reviewInputs[1], 'Synthetic reviewer');
              reviewInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
              teamReview.querySelector('.team-review-form button[type="submit"]')?.click();
              let sharedRoom;
              for (let attempt = 0; attempt < 100; attempt++) {
                sharedRoom = (await window.studio.teamReviewRooms(qaCard.id))[0];
                if (sharedRoom && teamReview.querySelector('.team-review-share input')?.value.startsWith('http://127.0.0.1:') && teamReview.textContent?.includes('Synthetic settings review')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (sharedRoom?.qaReportId !== qaReport.id || !teamReview.querySelector('.team-review-share input')?.value.startsWith('http://127.0.0.1:') || !teamReview.textContent?.includes('Synthetic settings review')) throw new Error('Local review did not save or show its scoped link: ' + JSON.stringify({ sharedRoom, visible: teamReview.textContent, link: teamReview.querySelector('.team-review-share input')?.value }));
              if (!(await window.studio.teamReviewImage(sharedRoom.id)).startsWith('data:image/png;base64,')) throw new Error('Local review did not keep its saved screenshot.');
              const runSession = (await window.studio.snapshot(boardProject.id)).sessions.find((item) => item.cardId === qaCard.id);
              if (!runSession) throw new Error('Agentenlauf für Laufbeleg fehlt.');
              const runPanel = document.querySelector('.card-drawer .session-evidence');
              if (!runPanel) throw new Error('Laufbeleg fehlt in der Kartenansicht.');
              runPanel.querySelector('summary')?.click();
              for (let attempt = 0; attempt < 100 && !runPanel.querySelector('.session-evidence-facts'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!runPanel.textContent?.includes('Kein Starttext') || !runPanel.textContent?.includes('CLI-Version') || !runPanel.textContent?.includes('Kein verifizierter Git-HEAD')) throw new Error('Startquellen oder offene Nachweise fehlen im sichtbaren Laufbeleg.');
              runPanel.querySelector('.session-evidence-qa-head button')?.click();
              let runQaSelect;
              for (let attempt = 0; attempt < 100; attempt++) {
                runQaSelect = runPanel.querySelector('.session-evidence-qa form select');
                if (runQaSelect?.querySelector('option[value="' + qaReport.id + '"]')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!runQaSelect?.querySelector('option[value="' + qaReport.id + '"]')) throw new Error('Gespeicherter QA-Bericht erschien nicht zur bewussten Laufzuordnung.');
              viewportSetter.call(runQaSelect, qaReport.id); runQaSelect.dispatchEvent(new Event('change', { bubbles: true }));
              const runQaForm = runPanel.querySelector('.session-evidence-qa form');
              for (let attempt = 0; attempt < 100 && runQaForm?.querySelector('button[type="submit"]')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              runQaForm?.querySelector('button[type="submit"]')?.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.sessionRunEvidence({ projectId: boardProject.id, sessionId: runSession.id })).linkedQa.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const linkedRunQa = await window.studio.sessionRunEvidence({ projectId: boardProject.id, sessionId: runSession.id });
              if (linkedRunQa.linkedQa[0]?.reportId !== qaReport.id || linkedRunQa.linkedQa[0]?.status !== 'failed' || !runPanel.textContent?.includes('Mit Fehlern')) throw new Error('Fehlgeschlagene QA wurde dem Lauf nicht korrekt und sichtbar zugeordnet.');
              const handoff = document.querySelector('.card-drawer .agent-handoff');
              const agentSelect = [...document.querySelectorAll('.card-drawer label')].find((item) => item.textContent?.includes('Agent auswählen'))?.querySelector('select');
              const targetAgent = (await window.studio.snapshot(boardProject.id)).agents.find((item) => item.enabled && item.id !== runSession.agentId);
              if (!handoff || !agentSelect || !targetAgent) throw new Error('Agentenwechsel-Einstieg oder anderer Zielagent fehlt.');
              viewportSetter.call(agentSelect, targetAgent.id); agentSelect.dispatchEvent(new Event('change', { bubbles: true }));
              handoff.querySelector('summary')?.click();
              let prepareHandoff;
              for (let attempt = 0; attempt < 100; attempt++) {
                prepareHandoff = [...handoff.querySelectorAll('button')].find((item) => item.textContent?.includes('Kontextpaket vorbereiten'));
                if (prepareHandoff && !prepareHandoff.disabled) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!prepareHandoff || prepareHandoff.disabled) throw new Error('Kontextpaket ließ sich vor einem Agentenwechsel nicht vorbereiten.');
              const handoffSessionsBefore = (await window.studio.snapshot(boardProject.id)).sessions.length;
              prepareHandoff.click();
              for (let attempt = 0; attempt < 100 && !handoff.querySelector('.agent-handoff-preview'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!handoff.querySelector('.agent-handoff-preview textarea') || !handoff.textContent?.includes('Gespeicherte Sitzung') || !handoff.textContent?.includes('Browser-QA') || (await window.studio.snapshot(boardProject.id)).sessions.length !== handoffSessionsBefore) throw new Error('Quellmarkierte, editierbare Kontextvorschau fehlte oder startete vor Bestätigung einen Agenten.');
              for (let attempt = 0; attempt < 100 && prepareHandoff.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (prepareHandoff.disabled) throw new Error('Kontextvorschau blieb nach dem Laden gesperrt.');
              prepareHandoff.click();
              viewportSetter.call(agentSelect, runSession.agentId); agentSelect.dispatchEvent(new Event('change', { bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 250));
              if (handoff.querySelector('.agent-handoff-preview') || (await window.studio.snapshot(boardProject.id)).sessions.length !== handoffSessionsBefore) throw new Error('Verspätete Kontextvorschau blieb nach Zielagentwechsel sichtbar oder startete einen Lauf.');
              const acceptance = document.querySelector('.card-drawer .card-acceptance');
              const acceptanceForm = acceptance?.querySelector('.card-acceptance-create');
              const acceptanceInput = acceptanceForm?.querySelector('input');
              if (!acceptanceForm || !acceptanceInput) throw new Error('Karten-Abnahmekriterienformular fehlt.');
              qaValueSetter.call(acceptanceInput, 'Mobile Navigation zeigt den Fehlerzustand');
              acceptanceInput.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && acceptanceForm.querySelector('button[type="submit"]')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              acceptanceForm.querySelector('button[type="submit"]')?.click();
              let acceptanceCriterion;
              for (let attempt = 0; attempt < 100; attempt++) {
                acceptanceCriterion = (await window.studio.cardCriteria(qaCard.id))[0];
                if (acceptanceCriterion && acceptance?.textContent?.includes('1 ohne gültigen Prüfverweis')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!acceptanceCriterion || !acceptance?.textContent?.includes('1 ohne gültigen Prüfverweis')) throw new Error('Abnahmekriterium oder sichtbare Prüflücke fehlt.');
              const acceptanceRefresh = acceptance.querySelector('.card-acceptance-status button');
              for (let attempt = 0; attempt < 100 && acceptanceRefresh?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!acceptanceRefresh || acceptanceRefresh.disabled) throw new Error('Prüfquellen-Aktualisierung blieb gesperrt.');
              acceptanceRefresh?.click();
              let linkForm;
              let linkSelect;
              let linkNote;
              for (let attempt = 0; attempt < 100; attempt++) {
                const acceptanceDetails = acceptance.querySelector('.card-acceptance-edit');
                if (acceptanceDetails && !acceptanceDetails.open) acceptanceDetails.querySelector('summary')?.click();
                linkForm = acceptanceDetails?.querySelectorAll('form')[1];
                linkSelect = linkForm?.querySelector('select');
                linkNote = linkForm?.querySelector('input');
                if (linkSelect?.querySelector('option[value="qa:' + qaReport.id + '"]')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!linkForm || !linkSelect || !linkNote || !linkSelect.querySelector('option[value="qa:' + qaReport.id + '"]')) throw new Error('Gespeicherter QA-Bericht fehlt als Karten-Prüfquelle: ' + JSON.stringify({ options: [...(linkSelect?.options ?? [])].map((option) => option.value), expected: qaReport.id, directReports: (await window.studio.cardQaReports(qaCard.id)).map((item) => item.id) }));
              viewportSetter.call(linkSelect, 'qa:' + qaReport.id);
              linkSelect.dispatchEvent(new Event('change', { bubbles: true }));
              qaValueSetter.call(linkNote, 'Der Bericht zeigt den Konsole-Fehler bei Tablet-Größe.');
              linkNote.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && linkForm.querySelector('button[type="submit"]')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              linkForm.querySelector('button[type="submit"]')?.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.cardCriteria(qaCard.id))[0]?.evidence.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const linkedAcceptance = (await window.studio.cardCriteria(qaCard.id))[0];
              if (linkedAcceptance?.evidence[0]?.sourceId !== qaReport.id || linkedAcceptance.evidence[0]?.sourceStatus !== 'failed' || !acceptance.textContent?.includes('QA mit Fehlern') || !(await sessionsUnchanged())) throw new Error('QA-Verweis am Abnahmekriterium oder Agentenruhe fehlt.');
              const acceptanceSource = [...acceptance.querySelectorAll('.card-acceptance-evidence-actions button')].find((item) => item.textContent?.includes('Quelle öffnen'));
              if (!acceptanceSource) throw new Error('Verknüpfter QA-Bericht lässt sich nicht öffnen.');
              acceptanceSource.click();
              for (let attempt = 0; attempt < 100 && document.activeElement?.id !== 'card-qa-report-' + qaReport.id; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.activeElement?.id !== 'card-qa-report-' + qaReport.id) throw new Error('QA-Verweis führte nicht zum zugeordneten Bericht.');
              const splitPanel = document.querySelector('.card-drawer .card-split');
              const splitOpen = [...(splitPanel?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('Teilkarten planen'));
              if (!splitOpen) throw new Error('Karten-Teilung ist in der Kartenansicht nicht erreichbar.');
              const beforeSplit = (await window.studio.snapshot(boardProject.id)).cards.length;
              splitOpen.click();
              for (let attempt = 0; attempt < 100 && !splitPanel?.querySelector('.card-split-editor'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const splitEditor = splitPanel?.querySelector('.card-split-editor');
              const splitTitles = splitEditor?.querySelectorAll('.card-split-drafts input');
              const splitDescriptions = splitEditor?.querySelectorAll('.card-split-drafts textarea');
              const splitDependencies = splitEditor?.querySelectorAll('.card-split-drafts select');
              const splitTextSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (!splitEditor || splitTitles?.length !== 2 || splitDescriptions?.length !== 2 || splitDependencies?.length !== 2 || !splitTextSetter) throw new Error('Bearbeitbarer Teilkarten-Entwurf fehlt.');
              qaValueSetter.call(splitTitles[0], 'BRANCHLOOM_SPLIT_PLAN'); splitTitles[0].dispatchEvent(new Event('input', { bubbles: true }));
              qaValueSetter.call(splitTitles[1], 'BRANCHLOOM_SPLIT_BUILD'); splitTitles[1].dispatchEvent(new Event('input', { bubbles: true }));
              splitTextSetter.call(splitDescriptions[1], 'Synthetische Umsetzung nach Planung.'); splitDescriptions[1].dispatchEvent(new Event('input', { bubbles: true }));
              viewportSetter.call(splitDependencies[1], '0'); splitDependencies[1].dispatchEvent(new Event('change', { bubbles: true }));
              const splitPreviewButton = [...splitEditor.querySelectorAll('button')].find((item) => item.textContent?.includes('Vorschau prüfen'));
              for (let attempt = 0; attempt < 100 && splitPreviewButton?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!splitPreviewButton || splitPreviewButton.disabled) throw new Error('Teilungsvorschau blieb gesperrt.');
              splitPreviewButton.click();
              for (let attempt = 0; attempt < 100 && !splitPanel.querySelector('.card-split-preview'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!splitPanel.querySelector('.card-split-preview')?.textContent?.includes('BRANCHLOOM_SPLIT_BUILD') || (await window.studio.snapshot(boardProject.id)).cards.length !== beforeSplit) throw new Error('Teilungsvorschau fehlt oder hat vor Bestätigung Karten angelegt.');
              const splitConfirm = [...splitPanel.querySelectorAll('.card-split-preview button')].find((item) => item.textContent?.includes('Teilkarten anlegen'));
              if (!splitConfirm) throw new Error('Expliziter Teilkarten-Übernahmeknopf fehlt.');
              splitConfirm.click();
              let splitCards;
              for (let attempt = 0; attempt < 100; attempt++) {
                splitCards = (await window.studio.snapshot(boardProject.id)).cards.filter((item) => item.title.startsWith('BRANCHLOOM_SPLIT_'));
                if (splitCards.length === 2 && splitPanel.textContent?.includes('BRANCHLOOM_SPLIT_BUILD')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const splitLinks = await window.studio.cardSplitLinks(qaCard.id);
              if (splitCards?.length !== 2 || splitLinks.children.length !== 2 || splitLinks.children[1]?.dependsOnCardId !== splitCards.find((item) => item.title === 'BRANCHLOOM_SPLIT_PLAN')?.id || (await window.studio.cardSplitLinks(splitCards.find((item) => item.title === 'BRANCHLOOM_SPLIT_BUILD').id)).parent?.cardId !== qaCard.id || !(await sessionsUnchanged())) throw new Error('Teilung speicherte Eltern-/Abhängigkeitslinks nicht oder startete einen Agenten.');
              const fixButton = [...document.querySelectorAll('.card-qa-report .card-qa-fix-card button')].find((item) => item.textContent?.includes('Fixkarte vorbereiten'));
              if (!fixButton) throw new Error('QA-Fixkarten-Aktion fehlt im gespeicherten Fehlerbericht.');
              const countBeforeFix = (await window.studio.snapshot(boardProject.id)).cards.length;
              fixButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-qa-fix-card form'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const fixForm = document.querySelector('.card-qa-fix-card form');
              if (!fixForm || !(fixForm.querySelector('textarea')?.value ?? '').includes('BRANCHLOOM_QA_SMOKE_ERROR') || (await window.studio.snapshot(boardProject.id)).cards.length !== countBeforeFix) throw new Error('QA-Fixkarten-Entwurf oder unveränderte Karte vor Bestätigung fehlt.');
              const fixTitle = fixForm.querySelector('input');
              const fixDescription = fixForm.querySelector('textarea');
              const fixColumn = fixForm.querySelector('select');
              const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (!fixTitle || !fixDescription || !fixColumn || !textSetter) throw new Error('QA-Fixkarten-Entwurf ist nicht editierbar.');
              qaValueSetter.call(fixTitle, 'BRANCHLOOM_QA_FIX_CARD'); fixTitle.dispatchEvent(new Event('input', { bubbles: true }));
              textSetter.call(fixDescription, 'Synthetischer Reproduktionsschritt'); fixDescription.dispatchEvent(new Event('input', { bubbles: true }));
              const planningColumn = (await window.studio.snapshot(boardProject.id)).columns.find((item) => item.name === 'Planning');
              if (!planningColumn) throw new Error('Manuelle Planning-Spalte fehlt.');
              viewportSetter.call(fixColumn, planningColumn.id); fixColumn.dispatchEvent(new Event('change', { bubbles: true }));
              fixForm.querySelector('button[type="submit"]')?.click();
              let qaFixCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                qaFixCard = (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.title === 'BRANCHLOOM_QA_FIX_CARD');
                if (qaFixCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!qaFixCard || qaFixCard.columnId !== planningColumn.id || !qaFixCard.description.includes('Synthetischer Reproduktionsschritt') || !qaFixCard.description.includes(qaReport.id) || !(await sessionsUnchanged())) throw new Error('Bestätigte QA-Fixkarte, Quellenbezug oder Agentenruhe fehlt.');
              const screenshotButton = [...document.querySelectorAll('.card-qa-screenshot button')].find((item) => item.textContent?.includes('Screenshot ansehen'));
              if (!screenshotButton) throw new Error('QA-Screenshot-Knopf fehlt.');
              screenshotButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-qa-screenshot img[src^="data:image/png;base64,"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const screenshotImage = document.querySelector('.card-qa-screenshot img[src^="data:image/png;base64,"]');
              if (!screenshotImage) throw new Error('QA-Screenshot wurde nach Klick nicht im Kartenbericht geöffnet.');
              await screenshotImage.decode();
              if (!screenshotImage.naturalWidth || screenshotImage.naturalWidth > 960 || screenshotImage.naturalHeight > 600) throw new Error('QA-Screenshot überschreitet die begrenzten Bildmaße.');
              for (let attempt = 0; attempt < 100 && qaButton.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (qaButton.disabled) throw new Error('Zweiter QA-Lauf konnte nicht gestartet werden.');
              viewportSetter.call(qaViewport, 'mobile');
              qaViewport.dispatchEvent(new Event('change', { bubbles: true }));
              qaButton.click();
              let comparisonReports;
              for (let attempt = 0; attempt < 300; attempt++) {
                comparisonReports = await window.studio.cardQaReports(qaCard.id);
                if (comparisonReports.length >= 2) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (comparisonReports?.length !== 2 || !comparisonReports.every((item) => item.screenshotAvailable) || comparisonReports[0].viewportWidth !== 390 || comparisonReports[0].viewportHeight !== 844) throw new Error('Zwei QA-Screenshots oder Mobile-Viewport fehlen.');
              for (let attempt = 0; attempt < 100 && document.querySelector('.card-qa-screenshot img'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.card-qa-screenshot img')) throw new Error('Eingeklappter QA-Bericht hielt den geladenen Screenshot im DOM.');
              let comparisonSelects;
              for (let attempt = 0; attempt < 100; attempt++) {
                comparisonSelects = [...document.querySelectorAll('.card-qa-comparison select')];
                if (comparisonSelects.length === 2) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (comparisonSelects?.length !== 2) throw new Error('Visual-Diff-Auswahl fehlt.');
              const selectValueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!selectValueSetter) throw new Error('Visual-Diff-Auswahl kann im Smoke nicht gesetzt werden.');
              selectValueSetter.call(comparisonSelects[0], comparisonReports[1].id);
              comparisonSelects[0].dispatchEvent(new Event('change', { bubbles: true }));
              selectValueSetter.call(comparisonSelects[1], comparisonReports[0].id);
              comparisonSelects[1].dispatchEvent(new Event('change', { bubbles: true }));
              const compareButton = [...document.querySelectorAll('.card-qa-comparison button')].find((item) => item.textContent?.includes('Visuell vergleichen'));
              for (let attempt = 0; attempt < 100 && compareButton?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!compareButton || compareButton.disabled) throw new Error('Visual-Diff-Vergleich wurde nicht aktiv.');
              compareButton.click();
              for (let attempt = 0; attempt < 100 && document.querySelectorAll('.card-qa-comparison-images img').length !== 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const comparedImages = [...document.querySelectorAll('.card-qa-comparison-images img')];
              if (comparedImages.length !== 2) throw new Error('Visual-Diff zeigte nicht beide gespeicherten Bilder.');
              await Promise.all(comparedImages.map((image) => image.decode()));
              if (document.querySelector('.card-qa-overlay-toggle')) throw new Error('Unterschiedliche Viewports boten fälschlich eine Überlagerung an.');
              if (!document.querySelector('.card-qa-comparison-view')?.textContent?.includes('Viewport: 768 × 1024 px') || !document.querySelector('.card-qa-comparison-view')?.textContent?.includes('Viewport: 390 × 844 px') || !document.querySelector('.card-qa-comparison-view')?.textContent?.includes('Git im Projektordner') || !document.querySelector('.card-qa-comparison-view')?.textContent?.includes('keinem Commit nachweislich zugeordnet') || !document.querySelector('.card-qa-comparison-view')?.textContent?.includes('Keine Pixelbewertung')) throw new Error('Visual-Diff-Quellen, Prüfgrößen, Git-Belege oder Grenzen fehlen.');
              [...document.querySelectorAll('.card-qa-comparison-images button')].find((item) => item.textContent?.includes('Screenshot A vergrößern'))?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-qa-comparison-images figure.expanded'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-qa-comparison-images figure.expanded')) throw new Error('Visual-Diff-Vergrößerung fehlt.');
              [...document.querySelectorAll('.card-qa-comparison-view button')].find((item) => item.textContent?.includes('Vergleich schließen'))?.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.card-qa-comparison-images img'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.card-qa-comparison-images img') || document.activeElement !== compareButton) throw new Error('Geschlossener Visual-Diff hielt Bilder oder Fokus nicht korrekt.');
              const matrix = document.querySelector('.card-qa-viewport-matrix');
              const matrixButton = [...(matrix?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('Gespeicherte Größen ansehen'));
              if (!matrix || !matrixButton || !matrix.textContent?.includes('Prüfgrößen einer Route')) throw new Error('Gespeicherte QA-Prüfgrößen fehlen.');
              if (matrix.querySelector('img')) throw new Error('QA-Prüfgrößen luden Bilder ohne ausdrücklichen Klick.');
              matrixButton.click();
              for (let attempt = 0; attempt < 100 && matrix.querySelectorAll('.card-qa-viewport-matrix-grid img').length !== 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const matrixImages = [...matrix.querySelectorAll('.card-qa-viewport-matrix-grid img')];
              if (matrixImages.length !== 2 || !matrix.textContent?.includes('Kein Screenshot dieser Größe für die Route gespeichert.') || !matrix.textContent?.includes('1280 × 800 px') || !matrix.textContent?.includes('768 × 1024 px') || !matrix.textContent?.includes('390 × 844 px') || !matrix.textContent?.includes('Keine gleichzeitige Live-Vorschau')) throw new Error('QA-Prüfgrößen zeigen nicht die zwei gespeicherten Aufnahmen, die Desktop-Lücke und die Grenzen.');
              if (matrix.querySelectorAll('time').length !== 2 || !matrix.textContent?.includes(${JSON.stringify(qaUrl)})) throw new Error('QA-Prüfgrößen zeigen Quelle und Zeiten nicht.');
              await Promise.all(matrixImages.map((item) => item.decode()));
              [...matrix.querySelectorAll('button')].find((item) => item.textContent?.includes('Größenansicht schließen'))?.click();
              for (let attempt = 0; attempt < 100 && matrix.querySelector('img'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (matrix.querySelector('img') || document.activeElement !== matrixButton) throw new Error('QA-Prüfgrößen hielten Bilder oder Fokus nach Schließen.');
              const qaExtra = qaForm.querySelector('textarea');
              const qaExtraSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (!qaExtra || !qaExtraSetter) throw new Error('Mehrfach-Routenfeld fehlt im Karten-QA-Formular.');
              qaExtraSetter.call(qaExtra, ${JSON.stringify(`${qaUrl}second\n${qaUrl}third`)});
              qaExtra.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !qaButton.textContent?.includes('Lokale Routen prüfen'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!qaButton.textContent?.includes('Lokale Routen prüfen')) throw new Error('Mehrfach-Routenlauf wurde nicht angeboten.');
              qaButton.click();
              let batchReports;
              for (let attempt = 0; attempt < 500; attempt++) {
                batchReports = await window.studio.cardQaReports(qaCard.id);
                if (batchReports.length === 5 && document.querySelector('.card-qa [role="status"]')?.textContent?.includes('3 von 3 Routen gespeichert')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (batchReports?.length !== 5 || !batchReports.some((item) => item.requestedUrl.endsWith('/second')) || !batchReports.some((item) => item.requestedUrl.endsWith('/third')) || !document.querySelector('.card-qa [role="status"]')?.textContent?.includes('3 von 3 Routen gespeichert')) throw new Error('Mehrfach-Routenlauf speicherte oder zeigte nicht alle drei QA-Berichte.');
              if (!(await sessionsUnchanged())) throw new Error('Mehrfach-Routenlauf startete einen Agenten.');
              const matchingMobile = batchReports.find((item) => item.id !== comparisonReports[0].id && item.requestedUrl === ${JSON.stringify(qaUrl)} && item.viewportWidth === 390 && item.viewportHeight === 844 && item.screenshotAvailable);
              if (!matchingMobile) throw new Error('Zweiter gespeicherter Mobile-Screenshot derselben Route fehlt.');
              const matchingSelects = [...document.querySelectorAll('.card-qa-comparison select')];
              if (matchingSelects.length !== 2) throw new Error('Vergleichsauswahl nach mehreren Routen fehlt.');
              selectValueSetter.call(matchingSelects[0], comparisonReports[0].id);
              matchingSelects[0].dispatchEvent(new Event('change', { bubbles: true }));
              selectValueSetter.call(matchingSelects[1], matchingMobile.id);
              matchingSelects[1].dispatchEvent(new Event('change', { bubbles: true }));
              const matchingCompare = [...document.querySelectorAll('.card-qa-comparison button')].find((item) => item.textContent?.includes('Visuell vergleichen'));
              for (let attempt = 0; attempt < 100 && matchingCompare?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(matchingCompare instanceof HTMLButtonElement) || matchingCompare.disabled) throw new Error('Gleichgroßer Vergleich wurde nicht aktiv.');
              matchingCompare.click();
              let overlayToggle;
              for (let attempt = 0; attempt < 100; attempt++) {
                overlayToggle = document.querySelector('.card-qa-overlay-toggle');
                if (overlayToggle) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!(overlayToggle instanceof HTMLButtonElement)) throw new Error('Gleichgroße gespeicherte Bilder boten keine Überlagerung an.');
              overlayToggle.click();
              let slider;
              for (let attempt = 0; attempt < 100 && !slider; attempt++) { slider = document.querySelector('input[aria-label="Anteil von Screenshot B"]'); if (!slider) await new Promise((resolve) => setTimeout(resolve, 50)); }
              const rangeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!(slider instanceof HTMLInputElement) || !rangeSetter) throw new Error('Tastaturbedienbarer QA-Bildregler fehlt.');
              slider.focus();
              rangeSetter.call(slider, '70'); slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-qa-overlay-stage')?.getAttribute('aria-label')?.includes('70 Prozent'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-qa-overlay-stage')?.getAttribute('aria-label')?.includes('70 Prozent') || !document.querySelector('.card-qa-comparison-view')?.textContent?.includes('Viewport: 390 × 844 px')) throw new Error('Bildregler oder Quellenmetadaten wurden nicht sichtbar aktualisiert.');
              overlayToggle.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.card-qa-overlay-stage'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.card-qa-overlay-stage')) throw new Error('Geschlossene Überlagerung hielt Bilder im DOM.');
              [...document.querySelectorAll('.card-qa-comparison-view button')].find((item) => item.textContent?.includes('Vergleich schließen'))?.click();
              const contextForm = document.querySelector('.card-drawer .card-context-form');
              const contextInput = contextForm?.querySelector('input');
              if (!contextForm || !contextInput) throw new Error('Karten-Kontextformular fehlt.');
              qaValueSetter.call(contextInput, 'context.md');
              contextInput.dispatchEvent(new Event('input', { bubbles: true }));
              const contextButton = contextForm.querySelector('button[type="submit"]');
              for (let attempt = 0; attempt < 100 && contextButton?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!contextButton || contextButton.disabled) throw new Error('Karten-Kontextschaltfläche wurde nicht aktiv.');
              contextButton.click();
              let contextRefs;
              for (let attempt = 0; attempt < 100; attempt++) {
                contextRefs = await window.studio.cardContextReferences(qaCard.id);
                if (contextRefs.length) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (contextRefs?.[0]?.target !== 'context.md') throw new Error('Projektdatei wurde nicht als Kartenkontext gespeichert.');
              let contextPreviewButton;
              for (let attempt = 0; attempt < 100; attempt++) {
                contextPreviewButton = document.querySelector('.card-context-list button.secondary-button');
                if (contextPreviewButton) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!contextPreviewButton) throw new Error('Gespeicherter Kontextbezug wurde nicht im Kartendrawer angezeigt.');
              contextPreviewButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-context-preview')?.textContent?.includes('BRANCHLOOM_CONTEXT_SMOKE'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-context-preview')?.textContent?.includes('BRANCHLOOM_CONTEXT_SMOKE')) throw new Error('Begrenzte Projektdatei-Vorschau wurde nicht angezeigt.');
              let dragSource;
              for (let attempt = 0; attempt < 100; attempt++) {
                dragSource = document.querySelector('.card-attachment-name[draggable="true"]');
                if (dragSource) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const dropTarget = document.querySelector('.card-context');
              if (!dragSource || !dropTarget) throw new Error('Kartenanhang oder Kontext-Dropziel fehlt.');
              const transfer = new DataTransfer();
              dragSource.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
              dropTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
              dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
              for (let attempt = 0; attempt < 100 && contextInput.value !== 'drop.md'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (contextInput.value !== 'drop.md' || !dropTarget.textContent?.includes('Projektdatei „drop.md“ vorbereitet')) throw new Error('Drag-and-drop füllte den geprüften Kontextentwurf nicht.');
              if ((await window.studio.cardContextReferences(qaCard.id)).length !== 1) throw new Error('Drop speicherte den Kontext ohne Bestätigung.');
              contextButton.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.cardContextReferences(qaCard.id)).length !== 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.cardContextReferences(qaCard.id)).some((item) => item.target === 'drop.md')) throw new Error('Bestätigter Drop wurde nicht als Kartenkontext gespeichert.');
              const whiteboardContextNode = await window.studio.createWhiteboardNode({ projectId: boardProject.id, title: 'Smoke-Dateibox', x: 30, y: 30, reference: { kind: 'file', path: 'src/widget.ts' } });
              const whiteboardDetails = document.querySelector('.card-context-whiteboard');
              whiteboardDetails?.querySelector('summary')?.click();
              let whiteboardSource;
              for (let attempt = 0; attempt < 100; attempt++) {
                whiteboardSource = [...document.querySelectorAll('.card-context-whiteboard-source[draggable="true"]')].find((item) => item.textContent?.includes('Smoke-Dateibox'));
                if (whiteboardSource) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!whiteboardSource || !whiteboardDetails?.textContent?.includes('src/widget.ts')) throw new Error('Whiteboard-Dateibox fehlt als Kartenkontextquelle: ' + whiteboardDetails?.outerHTML.slice(0, 1200));
              const whiteboardTransfer = new DataTransfer();
              whiteboardSource.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: whiteboardTransfer }));
              if (whiteboardTransfer.getData('application/x-branchloom-whiteboard-file') !== whiteboardContextNode.id) throw new Error('Whiteboard-Drag enthält nicht die gespeicherte Box-ID.');
              dropTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: whiteboardTransfer }));
              dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: whiteboardTransfer }));
              for (let attempt = 0; attempt < 100 && contextInput.value !== 'src/widget.ts'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (contextInput.value !== 'src/widget.ts' || !dropTarget.textContent?.includes('Whiteboard-Datei „src/widget.ts“ vorbereitet')) throw new Error('Whiteboard-Drop füllte den geprüften Dateientwurf nicht.');
              if ((await window.studio.cardContextReferences(qaCard.id)).length !== 2) throw new Error('Whiteboard-Drop speicherte ohne Bestätigung.');
              contextButton.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.cardContextReferences(qaCard.id)).length !== 3; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.cardContextReferences(qaCard.id)).some((item) => item.target === 'src/widget.ts')) throw new Error('Bestätigte Whiteboard-Datei wurde nicht gespeichert.');
              const whiteboardKeyboardButton = [...whiteboardDetails.querySelectorAll('button')].find((item) => item.textContent?.includes('Vorbereiten'));
              if (!whiteboardKeyboardButton) throw new Error('Whiteboard-Datei hat keine Tastaturalternative.');
              whiteboardKeyboardButton.click();
              for (let attempt = 0; attempt < 100 && !dropTarget.textContent?.includes('Whiteboard-Datei „src/widget.ts“ vorbereitet'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.cardContextReferences(qaCard.id)).length !== 3 || !(await sessionsUnchanged())) throw new Error('Whiteboard-Tastaturvorbereitung änderte Daten oder startete einen Agenten.');
              const contextFolderNode = await window.studio.createWhiteboardNode({ projectId: boardProject.id, title: 'Smoke-Ordnerbox', x: 40, y: 40, reference: { kind: 'folder', path: 'src' } });
              [...whiteboardDetails.querySelectorAll('button')].find((item) => item.textContent?.includes('Whiteboard neu laden'))?.click();
              let folderSource;
              for (let attempt = 0; attempt < 100; attempt++) {
                folderSource = [...whiteboardDetails.querySelectorAll('.card-context-whiteboard-source[draggable="true"]')].find((item) => item.textContent?.includes('Smoke-Ordnerbox'));
                if (folderSource) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!folderSource?.textContent?.includes('Ordner · src')) throw new Error('Whiteboard-Ordnerbox fehlt als Kartenkontextquelle.');
              const folderTransfer = new DataTransfer();
              folderSource.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: folderTransfer }));
              if (folderTransfer.getData('application/x-branchloom-whiteboard-file') !== contextFolderNode.id) throw new Error('Whiteboard-Ordner-Drag enthält nicht nur die Box-ID.');
              dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: folderTransfer }));
              for (let attempt = 0; attempt < 100 && (contextInput.value !== 'src' || !dropTarget.textContent?.includes('Whiteboard-Ordner „src“ vorbereitet')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (contextInput.value !== 'src' || !dropTarget.textContent?.includes('Whiteboard-Ordner „src“ vorbereitet') || dropTarget.querySelector('select')?.value !== 'folder') throw new Error('Ordner-Drop füllte den geprüften Entwurf nicht.');
              if ((await window.studio.cardContextReferences(qaCard.id)).length !== 3) throw new Error('Ordner-Drop speicherte ohne Bestätigung.');
              contextButton.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.cardContextReferences(qaCard.id)).length !== 4; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const folderRef = (await window.studio.cardContextReferences(qaCard.id)).find((item) => item.kind === 'folder' && item.target === 'src');
              if (!folderRef?.available) throw new Error('Bestätigte Whiteboard-Ordnerquelle wurde nicht gespeichert.');
              const folderListItem = [...dropTarget.querySelectorAll('.card-context-list li')].find((item) => item.textContent?.includes('Projektordner, Inhalt nicht gelesen'));
              folderListItem?.querySelector('button.secondary-button')?.click();
              for (let attempt = 0; attempt < 100 && !folderListItem?.textContent?.includes('Inhalte wurden nicht gelesen'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!folderListItem?.textContent?.includes('Inhalte wurden nicht gelesen')) throw new Error('Ordner-Vorschau las Inhalte oder fehlte.');
              const folderKeyboardButton = [...whiteboardDetails.querySelectorAll('li')].find((item) => item.textContent?.includes('Smoke-Ordnerbox'))?.querySelector('button');
              if (!folderKeyboardButton) throw new Error('Whiteboard-Ordner hat keine Tastaturalternative.');
              folderKeyboardButton.click();
              for (let attempt = 0; attempt < 100 && !dropTarget.textContent?.includes('Whiteboard-Ordner „src“ vorbereitet'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.cardContextReferences(qaCard.id)).length !== 4 || !(await sessionsUnchanged())) throw new Error('Ordner-Tastaturvorbereitung änderte Daten oder startete einen Agenten.');
              const designContextDetails = [...dropTarget.querySelectorAll('details.card-context-whiteboard')].find((item) => item.querySelector('summary')?.textContent?.includes('Design-Belege'));
              designContextDetails?.querySelector('summary')?.click();
              let designContextSource;
              for (let attempt = 0; attempt < 100; attempt++) {
                designContextSource = [...(designContextDetails?.querySelectorAll('.card-context-whiteboard-source[draggable="true"]') ?? [])].find((item) => item.textContent?.includes('button#design-context'));
                if (designContextSource) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!designContextSource) throw new Error('Gespeicherter Design-Beleg fehlt als Kartenquelle.');
              const designContextTransfer = new DataTransfer();
              designContextSource.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: designContextTransfer }));
              if (designContextTransfer.getData('application/x-branchloom-design-selection') !== ${JSON.stringify(designContextSelection.id)}) throw new Error('Design-Drag enthielt nicht nur die gespeicherte Beleg-ID.');
              dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: designContextTransfer }));
              for (let attempt = 0; attempt < 100 && (dropTarget.querySelector('select')?.value !== 'design' || !dropTarget.textContent?.includes('Design-Beleg „button · button#design-context“ vorbereitet')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const designContextNote = contextForm.querySelector('input[placeholder="Was soll am Element geändert werden?"]');
              if (dropTarget.querySelector('select')?.value !== 'design' || !designContextNote || !dropTarget.textContent?.includes('Die Seite wurde nicht geladen')) throw new Error('Design-Drop füllte den Belegentwurf nicht.');
              if ((await window.studio.cardContextReferences(qaCard.id)).length !== 4) throw new Error('Design-Drop speicherte ohne Bestätigung.');
              qaValueSetter.call(designContextNote, 'Smoke-Auftrag am Knopf'); designContextNote.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && contextForm.querySelector('input[placeholder="Was soll am Element geändert werden?"]')?.value !== 'Smoke-Auftrag am Knopf'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              contextButton.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.cardContextReferences(qaCard.id)).length !== 5; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const designContextRef = (await window.studio.cardContextReferences(qaCard.id)).find((item) => item.kind === 'design');
              if (!designContextRef?.available || designContextRef.target !== ${JSON.stringify(designContextSelection.id)} || designContextRef.note !== 'Smoke-Auftrag am Knopf') throw new Error('Design-Beleg oder editierte Notiz wurde nicht bestätigt.');
              const designContextItem = [...dropTarget.querySelectorAll('.card-context-list li')].find((item) => item.textContent?.includes('Gespeicherter Design-Beleg'));
              designContextItem?.querySelector('button.secondary-button')?.click();
              for (let attempt = 0; attempt < 100 && !designContextItem?.textContent?.includes('Selektor: button#design-context'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!designContextItem?.textContent?.includes('Auftrag: Smoke-Auftrag am Knopf') || designContextItem.textContent.includes('token=synthetic')) throw new Error('Design-Kontextvorschau fehlt oder zeigt Query-Werte.');
              const designContextKeyboard = [...(designContextDetails?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('Vorbereiten'));
              if (!designContextKeyboard) throw new Error('Design-Beleg hat keine Tastaturalternative.');
              designContextKeyboard.click();
              for (let attempt = 0; attempt < 100 && !dropTarget.textContent?.includes('Design-Beleg „button · button#design-context“ vorbereitet'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.cardContextReferences(qaCard.id)).length !== 5 || !(await sessionsUnchanged())) throw new Error('Design-Tastaturvorbereitung änderte Daten oder startete einen Agenten.');
              const outputPanel = document.querySelector('.card-drawer .output-errors');
              for (let attempt = 0; attempt < 100 && !outputPanel?.querySelector('form'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const outputForm = outputPanel?.querySelector('form');
              if (!outputForm?.textContent?.includes('BRANCHLOOM_OUTPUT_TEST')) throw new Error('Gespeicherter Agentenfehler erschien nicht zur Auswahl.');
              outputForm.querySelector('button[type="submit"]')?.click();
              let outputCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                outputCard = (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.title.includes('BRANCHLOOM_OUTPUT_TEST'));
                if (outputCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!outputCard?.description.includes('BRANCHLOOM_OUTPUT_TEST')) throw new Error('Ausgewählter Agentenfehler wurde nicht als Karte gespeichert.');
              if (!(await sessionsUnchanged())) throw new Error('Fehlerkarten-Anlage startete einen weiteren Agenten.');
              document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Whiteboard'))?.click();
              let connectionIndex;
              for (let attempt = 0; attempt < 100; attempt++) {
                connectionIndex = document.querySelector('.wb-connection-index summary');
                if (connectionIndex) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              connectionIndex?.click();
              let edgeListButton;
              for (let attempt = 0; attempt < 100; attempt++) {
                edgeListButton = document.querySelector('.wb-connection-index button, .wb-edge-list-item');
                if (edgeListButton) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!edgeListButton) throw new Error('Whiteboard-Verbindung fehlt in der zugänglichen Auswahl.');
              edgeListButton.click();
              let suggestCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                suggestCard = [...document.querySelectorAll('.wb-inspector button')].find((item) => item.textContent?.includes('Kartenentwurf aus Verbindung'));
                if (suggestCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!suggestCard) throw new Error('Kartenentwurf aus Whiteboard-Verbindung fehlt.');
              suggestCard.click();
              let cardDraft;
              for (let attempt = 0; attempt < 100; attempt++) {
                cardDraft = document.querySelector('.wb-card-form');
                if (cardDraft) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!cardDraft?.querySelector('input')?.value.includes('→') || !cardDraft.querySelector('select')?.value) throw new Error('Editierbarer Whiteboard-Kartenentwurf fehlt.');
              const beforeCardCount = (await window.studio.snapshot(boardProject.id)).cards.length;
              const createFromEdge = [...cardDraft.querySelectorAll('button')].find((item) => item.textContent?.includes('Karte anlegen'));
              if (!createFromEdge) throw new Error('Ausdrückliche Kartenanlage fehlt.');
              createFromEdge.click();
              let createdEdgeCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                createdEdgeCard = (await window.studio.whiteboard(boardProject.id)).edges[0]?.cardId;
                if (createdEdgeCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const afterCardSnapshot = await window.studio.snapshot(boardProject.id);
              if (!createdEdgeCard || afterCardSnapshot.cards.length !== beforeCardCount + 1 || !afterCardSnapshot.cards.find((item) => item.id === createdEdgeCard)?.description.includes('Whiteboard-Bezug:')) throw new Error('Whiteboard-Karte wurde nicht mit Quellenbezug gespeichert.');
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-drawer')) throw new Error('Neue Whiteboard-Karte wurde nicht geöffnet.');
              document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
              const workflowNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Workflows'));
              if (!workflowNav) throw new Error('Workflow-Navigation fehlt.');
              workflowNav.click();
              let previewVisible = false;
              for (let attempt = 0; attempt < 300; attempt++) {
                previewVisible = Boolean(document.querySelector('.queue-preview ol')?.textContent?.includes('Smoke-Karte'));
                if (previewVisible) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!previewVisible) throw new Error('Nächste freie To-Do-Karte wurde im Workflow nicht angezeigt.');
              const evidenceFlowId = ${JSON.stringify(evidenceFlow.id)};
              const evidenceCardId = ${JSON.stringify(evidenceCard.id)};
              const evidenceFromIpc = await window.studio.workflowRunEvidence({ projectId: boardProject.id, workflowId: evidenceFlowId });
              if (evidenceFromIpc.rows.length !== 1 || evidenceFromIpc.rows[0].cardId !== evidenceCardId || evidenceFromIpc.rows[0].state !== 'needs_review' || evidenceFromIpc.rows[0].session?.id !== evidenceSessionId || evidenceFromIpc.rows[0].session?.exitCode !== 0) throw new Error('Gespeicherter Workflow-Verlauf fehlt nach Neustart im lesenden IPC.');
              let evidencePanelButton;
              for (let attempt = 0; attempt < 100; attempt++) {
                evidencePanelButton = document.querySelector('#workflow-' + evidenceFlowId + ' .workflow-evidence > button');
                if (evidencePanelButton) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!evidencePanelButton) throw new Error('Workflow-Verlaufsknopf fehlt nach Neustart.');
              evidencePanelButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('#workflow-' + evidenceFlowId + ' .workflow-evidence-list'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const evidencePanel = document.querySelector('#workflow-' + evidenceFlowId + ' .workflow-evidence-panel');
              if (!evidencePanel?.textContent?.includes('Prüfung nötig') || !evidencePanel.textContent.includes('Exit-Code: 0') || ![...evidencePanel.querySelectorAll('button')].some((item) => item.textContent?.includes('Karte öffnen')) || ![...evidencePanel.querySelectorAll('button')].some((item) => item.textContent?.includes('Verlauf öffnen'))) throw new Error('Persistierter Schritt- und Sitzungsbeleg wurde im Workflow nicht gerendert.');
              const evidenceCardButton = [...evidencePanel.querySelectorAll('button')].find((item) => item.textContent?.includes('Karte öffnen'));
              evidenceCardButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer')?.textContent?.includes('BRANCHLOOM_WORKFLOW_EVIDENCE_CARD'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-drawer')?.textContent?.includes('BRANCHLOOM_WORKFLOW_EVIDENCE_CARD')) throw new Error('Workflow-Verlauf öffnete die zugehörige Karte nicht.');
              document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
              workflowNav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('#workflow-' + evidenceFlowId + ' .workflow-evidence > button'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              document.querySelector('#workflow-' + evidenceFlowId + ' .workflow-evidence > button')?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('#workflow-' + evidenceFlowId + ' .workflow-evidence-links'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const evidenceSessionButton = [...document.querySelectorAll('#workflow-' + evidenceFlowId + ' .workflow-evidence-links button')].find((item) => item.textContent?.includes('Verlauf öffnen'));
              if (!evidenceSessionButton) throw new Error('Workflow-Sitzungsnavigation fehlt.');
              evidenceSessionButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.activity-transcript-dialog')?.textContent?.includes('BRANCHLOOM_WORKFLOW_EVIDENCE_CARD'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.activity-transcript-dialog')?.textContent?.includes('BRANCHLOOM_WORKFLOW_EVIDENCE_CARD')) throw new Error('Workflow-Verlauf öffnete den gespeicherten Agentenlauf nicht.');
              document.querySelector('.activity-transcript-dialog button[aria-label="Verlauf schließen"]')?.click();
              workflowNav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.queue-preview ol'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const workflowProject = (await window.studio.projects())[0];
              const workflowSnapshot = await window.studio.snapshot(workflowProject.id);
              const workflowCard = workflowSnapshot.cards.find((item) => item.title === 'Smoke-Karte');
              const workflowStepColumn = workflowSnapshot.columns.find((item) => item.name === 'Smoke-Umbenannt');
              if (!workflowCard || !workflowStepColumn) throw new Error('Workflow-Smoke-Daten fehlen.');
              const deleteDraft = await window.studio.createWorkflow({ projectId: workflowProject.id, name: 'Zu löschender Entwurf', cardIds: [workflowCard.id], steps: [{ id: 'delete-smoke-step', columnId: workflowStepColumn.id, agentId: null, requireApproval: false }] });
              document.querySelector('button[aria-label="Aktualisieren"]')?.click();
              let deleteButton;
              for (let attempt = 0; attempt < 300; attempt++) {
                deleteButton = [...document.querySelectorAll('#workflow-' + deleteDraft.id + ' button')].find((item) => item.textContent?.includes('Entwurf löschen'));
                if (deleteButton) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!deleteButton) throw new Error('Entwurf-Löschknopf fehlt.');
              const editButton = [...document.querySelectorAll('#workflow-' + deleteDraft.id + ' button')].find((item) => item.textContent?.includes('Entwurf bearbeiten'));
              if (!editButton) throw new Error('Entwurf-Bearbeitenknopf fehlt.');
              editButton.click();
              let editDialog;
              for (let attempt = 0; attempt < 300; attempt++) {
                editDialog = [...document.querySelectorAll('.dialog.wide')].find((item) => item.textContent?.includes('Workflow-Entwurf bearbeiten'));
                if (editDialog) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!editDialog || editDialog.querySelector('input[placeholder="Zum Beispiel: Implementieren und prüfen"]')?.value !== 'Zu löschender Entwurf') throw new Error('Entwurf-Bearbeitenformular wurde nicht vorausgefüllt.');
              editDialog.querySelector('button[aria-label="Schließen"]')?.click();
              for (let attempt = 0; attempt < 300 && document.querySelector('.dialog.wide'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              deleteButton.click();
              let confirmDelete;
              for (let attempt = 0; attempt < 300; attempt++) {
                confirmDelete = document.querySelector('[role="dialog"][aria-label="Workflow-Entwurf löschen"] .danger-button');
                if (confirmDelete) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!confirmDelete) throw new Error('Bestätigung für Workflow-Entwurf fehlt.');
              confirmDelete.click();
              let draftDeleted = false;
              for (let attempt = 0; attempt < 300; attempt++) {
                draftDeleted = !(await window.studio.snapshot(workflowProject.id)).workflows.some((item) => item.id === deleteDraft.id);
                if (draftDeleted && document.querySelector('.queue-preview ol')?.textContent?.includes('Smoke-Karte')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!draftDeleted || !document.querySelector('.queue-preview ol')?.textContent?.includes('Smoke-Karte')) throw new Error('Workflow-Entwurf wurde nicht sichtbar gelöscht und Karte nicht freigegeben.');
              if (${process.platform === 'win32'}) {
                const activityNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Aktivität'));
                if (!activityNav) throw new Error('Aktivitätsnavigation fehlt.');
                activityNav.click();
                let openTranscript;
                for (let attempt = 0; attempt < 300; attempt++) {
                  openTranscript = [...document.querySelectorAll('.activity-item')].find((item) => item.querySelector('h3')?.textContent?.includes('Smoke-Karte') && [...item.querySelectorAll('button')].some((button) => button.textContent?.includes('Verlauf ansehen')))?.querySelector('button');
                  if (openTranscript) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                if (!openTranscript) throw new Error('Agentenlauf fehlt in der Aktivitätsansicht.');
                openTranscript.click();
                let transcriptDialog;
                for (let attempt = 0; attempt < 100; attempt++) {
                  transcriptDialog = document.querySelector('.activity-transcript-dialog');
                  if (transcriptDialog) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                const transcriptClose = transcriptDialog?.querySelector('button[aria-label="Verlauf schließen"]');
                const transcriptLast = transcriptDialog?.querySelector('.dialog-actions button:last-child');
                if (!transcriptDialog || transcriptDialog.getAttribute('aria-modal') !== 'true' || !transcriptClose || !transcriptLast || document.activeElement !== transcriptClose) throw new Error('Agentenverlauf hat keinen benannten Dialog mit Anfangsfokus.');
                transcriptClose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
                if (document.activeElement !== transcriptLast) throw new Error('Rückwärts-Tab verließ den Agentenverlauf.');
                transcriptLast.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
                if (document.activeElement !== transcriptClose) throw new Error('Vorwärts-Tab verließ den Agentenverlauf.');
                transcriptDialog.focus();
                transcriptDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
                if (document.activeElement !== transcriptLast) throw new Error('Rückwärts-Tab vom Dialograhmen verließ den Agentenverlauf.');
                transcriptClose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                for (let attempt = 0; attempt < 100 && (document.querySelector('.activity-transcript-dialog') || document.activeElement !== openTranscript); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (document.querySelector('.activity-transcript-dialog') || document.activeElement !== openTranscript) throw new Error('Escape gab den Fokus nicht an den Agentenverlauf-Auslöser zurück.');
                openTranscript.click();
                let saveNote;
                for (let attempt = 0; attempt < 300; attempt++) {
                  saveNote = [...document.querySelectorAll('.activity-transcript-dialog button')].find((item) => item.textContent?.includes('In Memory speichern'));
                  if (saveNote) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                if (!saveNote) throw new Error('Memory-Übernahme fehlt im Agentenverlauf.');
                saveNote.click();
                let savedNote = false;
                for (let attempt = 0; attempt < 300; attempt++) {
                  const project = (await window.studio.projects())[0];
                  const current = await window.studio.snapshot(project.id);
                  savedNote = current.notes.some((note) => note.title === 'Agentenlauf: Smoke-Karte' && note.tags.includes('agentenlauf') && note.body.includes('JARVIS_STUDIO_AGENT_OK'));
                  if (savedNote && document.querySelector('.topbar-title h1')?.textContent === 'Memory') break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                if (!savedNote || document.querySelector('.topbar-title h1')?.textContent !== 'Memory') throw new Error('Agentenlauf wurde nicht sichtbar als lokale Memory-Notiz gespeichert.');
                [...document.querySelectorAll('.knowledge-index-view-tabs button')].find((item) => item.textContent?.includes('Beziehungen'))?.click();
                for (let attempt = 0; attempt < 100 && !document.querySelector('.knowledge-map-view'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                let linkedFileVisible = false;
                for (let excerpt = 0; excerpt < 20 && !linkedFileVisible; excerpt++) {
                  for (let attempt = 0; attempt < 100 && document.querySelector('.knowledge-map-source-status'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                  const fileEntry = [...document.querySelectorAll('.knowledge-map-list button')].find((item) => item.textContent?.includes('Datei · src/widget.ts'));
                  if (fileEntry) {
                    fileEntry.click();
                    for (let attempt = 0; attempt < 100 && document.querySelector('.knowledge-map-inspector h3')?.textContent !== 'src/widget.ts'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                    linkedFileVisible = document.querySelector('.knowledge-map-inspector h3')?.textContent === 'src/widget.ts'
                      && Boolean(document.querySelector('.knowledge-map-inspector .knowledge-map-related button'));
                    break;
                  }
                  const nextExcerpt = document.querySelector('button[aria-label="Weitere Aufgaben zeigen"]');
                  if (!(nextExcerpt instanceof HTMLButtonElement) || nextExcerpt.disabled) break;
                  nextExcerpt.click();
                }
                if (!linkedFileVisible || !document.querySelector('.knowledge-map-node.source')) throw new Error('Gespeicherter Datei-Kartenbezug erschien nicht in der Memory-Beziehungskarte: ' + JSON.stringify({
                  hasMap: Boolean(document.querySelector('.knowledge-map-view')),
                  activeTab: [...document.querySelectorAll('.knowledge-index-view-tabs button')].find((item) => item.getAttribute('aria-pressed') === 'true')?.textContent,
                  entries: document.querySelector('.knowledge-map-list')?.textContent?.slice(0, 700),
                  status: document.querySelector('.knowledge-map-source-status')?.textContent,
                }));
                const arrangement = document.querySelector('.knowledge-map-arrangements[aria-label="Kartenanordnung"]');
                const networkButton = [...(arrangement?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Netz');
                const structureButton = [...(arrangement?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Struktur');
                if (!(networkButton instanceof HTMLButtonElement) || !(structureButton instanceof HTMLButtonElement)
                  || networkButton.getAttribute('aria-pressed') !== 'true' || !document.querySelector('.knowledge-map-layout.network')) {
                  throw new Error('Die belegte Memory-Netzansicht ist nicht als Standard erreichbar.');
                }
                const sourceListBefore = document.querySelector('.knowledge-map-list')?.textContent;
                structureButton.click();
                for (let attempt = 0; attempt < 100 && !document.querySelector('.knowledge-map-layout.structure .knowledge-map-node.source'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (structureButton.getAttribute('aria-pressed') !== 'true' || !document.querySelector('.knowledge-map-layout.structure .knowledge-map-node.source')
                  || document.querySelector('.knowledge-map-list')?.textContent !== sourceListBefore) {
                  throw new Error('Der Wechsel zur Memory-Strukturansicht verlor die belegte Quellenliste.');
                }
                networkButton.click();
                for (let attempt = 0; attempt < 100 && !document.querySelector('.knowledge-map-layout.network .knowledge-map-node.source'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (networkButton.getAttribute('aria-pressed') !== 'true' || document.querySelector('.knowledge-map-list')?.textContent !== sourceListBefore
                  || document.querySelector('.knowledge-map-inspector h3')?.textContent !== 'src/widget.ts') {
                  throw new Error('Der Memory-Netzwechsel verlor Quellbeleg oder Auswahl.');
                }
                let sourceButton;
                for (let attempt = 0; attempt < 300; attempt++) {
                  sourceButton = [...document.querySelectorAll('.memory-modebar button')].find((item) => item.textContent?.includes('Quellverlauf öffnen'));
                  if (sourceButton) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                if (!sourceButton) throw new Error('Quellverlauf-Link fehlt an der Memory-Notiz.');
                sourceButton.click();
                let sourceOpened = false;
                for (let attempt = 0; attempt < 300; attempt++) {
                  sourceOpened = document.querySelector('.topbar-title h1')?.textContent === 'Aktivität' && Boolean(document.querySelector('.activity-transcript-dialog')?.textContent?.includes('JARVIS_STUDIO_AGENT_OK'));
                  if (sourceOpened) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                if (!sourceOpened) throw new Error('Quellverlauf wurde nicht aus Memory geöffnet.');
                const sourceClose = document.querySelector('.activity-transcript-dialog button[aria-label="Verlauf schließen"]');
                sourceClose?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                const activitySearch = document.querySelector('input[aria-label="Aktivität durchsuchen"]');
                for (let attempt = 0; attempt < 100 && (document.querySelector('.activity-transcript-dialog') || document.activeElement !== activitySearch); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (!activitySearch || document.querySelector('.activity-transcript-dialog') || document.activeElement !== activitySearch) throw new Error('Externer Quellverlauf gab den Fokus nicht an die Aktivitätssuche zurück.');
              }
              const decisionsNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Entscheidungen'));
              if (!decisionsNav) throw new Error('Review-Inbox-Navigation fehlt.');
              decisionsNav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.decision-review-section')?.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const planInboxButton = [...document.querySelectorAll('.decision-review-item')].find((item) => item.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE'))?.querySelector('button.secondary-button');
              if (!planInboxButton) throw new Error('Plan-Kommentar fehlt in der Review-Inbox.');
              planInboxButton.click();
              for (let attempt = 0; attempt < 100 && (document.activeElement?.id !== 'workflow-plan-review' || !document.querySelector('#workflow-plan-review')?.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.activeElement?.id !== 'workflow-plan-review' || !document.querySelector('#workflow-plan-review')?.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE')) throw new Error('Plan-Navigation setzte den Tastaturfokus nicht auf den gespeicherten Plan: ' + JSON.stringify({ active: document.activeElement?.outerHTML?.slice(0, 250), plan: document.querySelector('#workflow-plan-review')?.textContent?.slice(-300), view: document.querySelector('.topbar-title h1')?.textContent }));
              const decisionsNavAfterPlan = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Entscheidungen'));
              if (!decisionsNavAfterPlan) throw new Error('Rückweg zur Review-Inbox fehlt.');
              decisionsNavAfterPlan.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.decision-review-section')?.textContent?.includes('BRANCHLOOM_DIFF_REVIEW_SMOKE'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const diffInboxButton = [...document.querySelectorAll('.decision-review-item')].find((item) => item.textContent?.includes('BRANCHLOOM_DIFF_REVIEW_SMOKE'))?.querySelector('button.secondary-button');
              if (!diffInboxButton) throw new Error('Diff-Kommentar fehlt in der Review-Inbox.');
              diffInboxButton.click();
              for (let attempt = 0; attempt < 100 && !(document.activeElement?.classList.contains('review-diff-comment') && document.activeElement?.textContent?.includes('BRANCHLOOM_DIFF_REVIEW_SMOKE')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.topbar-title h1')?.textContent !== 'Board' || !document.activeElement?.classList.contains('review-diff-comment') || !document.activeElement?.textContent?.includes('BRANCHLOOM_DIFF_REVIEW_SMOKE')) throw new Error('Diff-Kommentar wurde ohne Worktree nicht geöffnet und fokussiert: ' + JSON.stringify({ view: document.querySelector('.topbar-title h1')?.textContent, active: document.activeElement?.outerHTML?.slice(0, 250), drawer: document.querySelector('.card-drawer')?.textContent?.slice(-350), review: document.querySelector('.review-diff')?.textContent?.slice(-350) }));
              const decisionsNavAfterDiff = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Entscheidungen'));
              if (!decisionsNavAfterDiff) throw new Error('Rückweg zur QA-Inbox fehlt.');
              decisionsNavAfterDiff.click();
              let qaInboxItem;
              for (let attempt = 0; attempt < 100; attempt++) {
                qaInboxItem = document.querySelector('.decision-review-item[data-qa-report-id="' + qaReport.id + '"]');
                if (qaInboxItem?.textContent?.includes('BRANCHLOOM_QA_SMOKE_ERROR')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!qaInboxItem?.textContent?.includes('BRANCHLOOM_QA_SMOKE_ERROR') || !qaInboxItem.textContent.includes('Route: http://127.0.0.1:')) throw new Error('Echter fehlgeschlagener Browser-QA-Bericht fehlt mit Route und Diagnose in der Inbox.');
              qaInboxItem.querySelector('button.secondary-button')?.click();
              for (let attempt = 0; attempt < 100 && document.activeElement?.id !== 'card-qa-report-' + qaReport.id; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.topbar-title h1')?.textContent !== 'Board' || document.activeElement?.id !== 'card-qa-report-' + qaReport.id || !document.activeElement?.textContent?.includes('BRANCHLOOM_QA_SMOKE_ERROR')) throw new Error('QA-Inbox öffnete und fokussierte den konkreten Kartenbericht nicht.');
              const decisionsNavAfterQa = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Entscheidungen'));
              if (!decisionsNavAfterQa) throw new Error('Rückweg zur QA-Quittierung fehlt.');
              decisionsNavAfterQa.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.decision-review-item[data-qa-report-id="' + qaReport.id + '"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              document.querySelector('.decision-review-item[data-qa-report-id="' + qaReport.id + '"] .decision-subaction')?.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.reviewInboxItems({ projectId: boardProject.id })).items.some((item) => item.id === qaReport.id); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.reviewInboxItems({ projectId: boardProject.id })).items.some((item) => item.id === qaReport.id) || !(await window.studio.cardQaReports(qaCard.id)).some((item) => item.id === qaReport.id)) throw new Error('QA-Quittierung entfernte nicht nur den Inbox-Eintrag.');
              if (!(await sessionsUnchanged())) throw new Error('QA-Inbox startete einen weiteren Agenten.');
              const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
              const liveProjectComment = await window.studio.createPlanComment({ planId: ${JSON.stringify(smokePlan.id)}, fingerprint: ${JSON.stringify(smokePlan.fingerprint)}, line: 1, body: 'BRANCHLOOM_LIVE_PROJECT_INBOX' });
              if (document.querySelector('.decision-review-section')?.textContent?.includes('BRANCHLOOM_LIVE_PROJECT_INBOX')) throw new Error('Projekt-Inbox wurde ohne Aktualisierung verändert.');
              Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
              document.dispatchEvent(new Event('visibilitychange'));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.decision-review-section')?.textContent?.includes('BRANCHLOOM_LIVE_PROJECT_INBOX'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.decision-review-section')?.textContent?.includes('BRANCHLOOM_LIVE_PROJECT_INBOX') || !(await window.studio.reviewInboxItems({ projectId: boardProject.id })).items.some((item) => item.id === liveProjectComment.id)) throw new Error('Projekt-Inbox lud neuen gespeicherten Kommentar nicht sichtbar nach.');
              const globalButton = [...document.querySelectorAll('.decision-scope button')].find((item) => item.textContent?.includes('Alle Projekte'));
              if (!globalButton) throw new Error('Projektübergreifender Inbox-Modus fehlt.');
              globalButton.click();
              let globalPlan;
              for (let attempt = 0; attempt < 100; attempt++) {
                globalPlan = [...document.querySelectorAll('.cross-project-inbox .decision-item')].find((item) => item.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE'));
                if (globalPlan) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!globalPlan?.textContent?.includes('Projekt: ' + boardProject.name)) throw new Error('Projektzuordnung fehlt in der globalen Inbox.');
              if (document.querySelector('.cross-project-inbox [data-global-inbox-id="qa:' + qaReport.id + '"]')) throw new Error('Quittierte QA steht noch in der globalen Inbox.');
              const liveGlobalComment = await window.studio.createPlanComment({ planId: ${JSON.stringify(smokePlan.id)}, fingerprint: ${JSON.stringify(smokePlan.fingerprint)}, line: 1, body: 'BRANCHLOOM_LIVE_GLOBAL_INBOX' });
              if (document.querySelector('.cross-project-inbox')?.textContent?.includes('BRANCHLOOM_LIVE_GLOBAL_INBOX')) throw new Error('Globale Inbox wurde ohne Aktualisierung verändert.');
              document.dispatchEvent(new Event('visibilitychange'));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.cross-project-inbox')?.textContent?.includes('BRANCHLOOM_LIVE_GLOBAL_INBOX'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.cross-project-inbox')?.textContent?.includes('BRANCHLOOM_LIVE_GLOBAL_INBOX') || !(await window.studio.globalInboxItems()).items.some((item) => item.id === 'plan:' + liveGlobalComment.id)) throw new Error('Globale Inbox lud neuen gespeicherten Kommentar nicht sichtbar nach.');
              if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility); else delete document.visibilityState;
              const refreshedGlobalPlan = [...document.querySelectorAll('.cross-project-inbox .decision-item')].find((item) => item.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE'));
              const refreshedPlanButton = refreshedGlobalPlan?.querySelector('button.secondary-button');
              if (!refreshedPlanButton?.isConnected) throw new Error('Plan-Knopf fehlt nach der Aktualisierung der globalen Inbox.');
              refreshedPlanButton.click();
              for (let attempt = 0; attempt < 200 && (document.activeElement?.id !== 'workflow-plan-review' || !document.activeElement?.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.activeElement?.id !== 'workflow-plan-review' || !document.activeElement?.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE')) throw new Error('Globale Inbox öffnete den konkreten Plan nicht: ' + JSON.stringify({ active: document.activeElement?.outerHTML?.slice(0, 250), plan: document.querySelector('#workflow-plan-review')?.textContent?.slice(-300), view: document.querySelector('.topbar-title h1')?.textContent }));
              if (!(await sessionsUnchanged())) throw new Error('Globale Inbox startete einen Agenten.');
              document.querySelector('.project-actions summary')?.click();
              [...document.querySelectorAll('.project-actions-menu button')].find((item) => item.textContent?.includes('Codeordner hinzufügen'))?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.modal-backdrop form.dialog'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const form = document.querySelector('.modal-backdrop form.dialog');
              const inputs = form?.querySelectorAll('input');
              const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!form || inputs?.length !== 2 || !inputSetter) throw new Error('Zweitprojekt-Dialog fehlt.');
              inputSetter.call(inputs[0], 'Smoke-Zweitprojekt'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
              inputSetter.call(inputs[1], ${JSON.stringify(secondProjectPath)}); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
              form.requestSubmit();
              let secondProject;
              for (let attempt = 0; attempt < 100; attempt++) {
                secondProject = (await window.studio.projects()).find((project) => project.name === 'Smoke-Zweitprojekt');
                if (secondProject && document.querySelector('#project-select')?.value === secondProject.id) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!secondProject || document.querySelector('#project-select')?.value !== secondProject.id) throw new Error('Zweitprojekt wurde nicht sichtbar ausgewählt.');
              const secondSnapshot = await window.studio.snapshot(secondProject.id);
              const secondCard = await window.studio.createCard({ projectId: secondProject.id, columnId: secondSnapshot.columns[0].id, title: 'Zweitprojekt-Aufgabe' });
              const secondWorkflow = await window.studio.createWorkflow({ projectId: secondProject.id, name: 'BRANCHLOOM_GLOBAL_OTHER_PROJECT', cardIds: [secondCard.id],
                steps: [{ id: 'second-approval', columnId: secondSnapshot.columns[0].id, agentId: null, requireApproval: true }] });
              let invalidCompletionRejected = false;
              try { await window.studio.setWorkflowState({ id: secondWorkflow.id, state: 'done' }); }
              catch (error) { invalidCompletionRejected = String(error).includes('nur gestartet oder pausiert'); }
              if (!invalidCompletionRejected || (await window.studio.snapshot(secondProject.id)).workflows.find((item) => item.id === secondWorkflow.id)?.state !== 'draft') throw new Error('Direkter Abschluss eines ungestarteten Workflows wurde nicht abgewiesen.');
              await window.studio.setWorkflowState({ id: secondWorkflow.id, state: 'running' });
              if ((await window.studio.snapshot(secondProject.id)).workflows.find((item) => item.id === secondWorkflow.id)?.state !== 'paused') throw new Error('Zweitprojekt-Workflow erreichte die Freigabepause nicht.');
              const projectSelect = document.querySelector('#project-select');
              const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!projectSelect || !selectSetter) throw new Error('Projektwahl fehlt.');
              selectSetter.call(projectSelect, boardProject.id); projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && document.querySelector('#project-select')?.value !== boardProject.id; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const decisionsAgain = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Entscheidungen'));
              decisionsAgain?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.decision-scope'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              [...document.querySelectorAll('.decision-scope button')].find((item) => item.textContent?.includes('Alle Projekte'))?.click();
              let otherItem;
              for (let attempt = 0; attempt < 100; attempt++) {
                otherItem = [...document.querySelectorAll('.cross-project-inbox .decision-item')].find((item) => item.textContent?.includes('BRANCHLOOM_GLOBAL_OTHER_PROJECT'));
                if (otherItem) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!otherItem?.textContent?.includes('Projekt: Smoke-Zweitprojekt') || otherItem.getAttribute('data-global-inbox-id') !== 'workflow:' + secondWorkflow.id) throw new Error('Projektübergreifende Quelle ist falsch zugeordnet.');
              otherItem.querySelector('button.secondary-button')?.click();
              for (let attempt = 0; attempt < 100 && (document.querySelector('#project-select')?.value !== secondProject.id || !document.querySelector('.workflow-list')?.textContent?.includes('BRANCHLOOM_GLOBAL_OTHER_PROJECT')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('#project-select')?.value !== secondProject.id || !document.querySelector('.workflow-list')?.textContent?.includes('BRANCHLOOM_GLOBAL_OTHER_PROJECT')) throw new Error('Projektwechsel öffnete nicht die exakte Workflow-Quelle.');
              const pausedStep = document.querySelector('#workflow-' + secondWorkflow.id + ' .route-step.paused[aria-current="step"]');
              if (!pausedStep?.textContent?.includes('Hier pausiert')) throw new Error('Der pausierte Workflow-Schritt ist in der Oberfläche nicht erkennbar.');
              if ((await window.studio.snapshot(secondProject.id)).sessions.length !== 0) throw new Error('Projektwechsel startete einen Agenten.');
              selectSetter.call(projectSelect, boardProject.id); projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && document.querySelector('#project-select')?.value !== boardProject.id; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('#project-select')?.value !== boardProject.id) throw new Error('Smoke-Projekt wurde nicht wiederhergestellt.');
              const contractDraft = { method: 'GET', path: '/api/smoke-items', response: 'array', fields: [{ name: 'id', type: 'string', required: true }], error: { status: 404, code: 'NOT_FOUND', message: 'Missing' } };
              const contractPreview = await window.studio.previewApiContract({ projectId: boardProject.id, draft: contractDraft });
              await window.studio.saveApiContract({ projectId: boardProject.id, draft: contractDraft, fingerprint: contractPreview.fingerprint, expectedLatestRevision: contractPreview.expectedLatestRevision });
              const agentsNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Agenten');
              if (!agentsNav) throw new Error('Agenten-Navigation für API-Vertrag fehlt.');
              agentsNav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.api-contract__http'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const contractHttp = document.querySelector('.api-contract__http');
              if (!contractHttp?.textContent?.includes('Mock starten') || !contractHttp.textContent.includes('Endpoint jetzt prüfen')) throw new Error('API-Mock und Endpoint-Prüfung fehlen in der Oberfläche.');
              const contractCards = await window.studio.snapshot(boardProject.id);
              const freeCards = contractCards.cards.filter((card) => !card.archivedAt &&
                !contractCards.sessions.some((session) => session.cardId === card.id && session.state === 'running')).slice(0, 2);
              if (freeCards.length !== 2) throw new Error('F02 needs two free cards to verify the shared binding UI.');
              for (const card of freeCards) {
                let row;
                for (let attempt = 0; attempt < 100; attempt++) {
                  row = [...document.querySelectorAll('.api-contract__cards > div')].find((item) => item.querySelector('span')?.textContent === card.title);
                  if (row?.querySelector('button')?.textContent === 'Verbinden') break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                const button = row?.querySelector('button');
                if (!button || button.textContent !== 'Verbinden' || button.disabled) throw new Error('F02 card binding control is unavailable.');
                button.click();
                for (let attempt = 0; attempt < 100 && !(await window.studio.apiContractOverview(boardProject.id)).bindings.some((binding) =>
                  binding.cardId === card.id && binding.revision === 1 && binding.current); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (!(await window.studio.apiContractOverview(boardProject.id)).bindings.some((binding) =>
                  binding.cardId === card.id && binding.revision === 1 && binding.current)) throw new Error('F02 card did not receive the approved revision.');
              }
              if ((await window.studio.apiContractOverview(boardProject.id)).bindings.filter((binding) =>
                freeCards.some((card) => card.id === binding.cardId) && binding.revision === 1 && binding.current).length !== 2)
                throw new Error('F02 frontend and backend cards do not share the approved revision.');
              const mismatchedSample = document.querySelector('.api-contract__sample textarea');
              const setSample = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (!mismatchedSample || !setSample) throw new Error('F02 response checker is missing.');
              setSample.call(mismatchedSample, '[{"id": 5}]');
              mismatchedSample.dispatchEvent(new Event('input', { bubbles: true }));
              const checkSample = [...document.querySelectorAll('.api-contract__sample button')].find((button) => button.textContent?.includes('Antwort prüfen'));
              for (let attempt = 0; attempt < 100 && checkSample?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!checkSample || checkSample.disabled) throw new Error('F02 response checker did not accept a sample.');
              checkSample.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.api-contract__result')?.textContent?.includes('$[0].id'); attempt++)
                await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.api-contract__result')?.textContent?.includes('$[0].id: erwartet string, gefunden number'))
                throw new Error('F02 did not show the exact mismatched field and expected type.');
              [...contractHttp.querySelectorAll('button')].find((button) => button.textContent?.includes('Mock starten'))?.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.apiContractMockState(boardProject.id)).running; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const mockState = await window.studio.apiContractMockState(boardProject.id);
              if (!mockState.running || !mockState.url?.includes('/api/smoke-items')) throw new Error('API-Mock startete nicht auf der gespeicherten Route.');
              for (let attempt = 0; attempt < 100 && !contractHttp.querySelector('.api-contract__http-address'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              [...contractHttp.querySelectorAll('button')].find((button) => button.textContent?.includes('Adresse für Check übernehmen'))?.click();
              for (let attempt = 0; attempt < 100 && contractHttp.querySelector('input[aria-label="Lokaler API-Server"]')?.value !== new URL(mockState.url).origin; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (contractHttp.querySelector('input[aria-label="Lokaler API-Server"]')?.value !== new URL(mockState.url).origin) throw new Error('Mock-Adresse wurde nicht in den lokalen Check übernommen.');
              [...contractHttp.querySelectorAll('button')].find((button) => button.textContent?.includes('Endpoint jetzt prüfen'))?.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.apiContractLiveChecks(boardProject.id)).length; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const liveCheck = (await window.studio.apiContractLiveChecks(boardProject.id))[0];
              for (let attempt = 0; attempt < 100 && !contractHttp.textContent?.includes('Lokale Antwort erfüllt Revision 1'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!liveCheck?.valid || liveCheck.status !== 200 || !contractHttp.textContent?.includes('Lokale Antwort erfüllt Revision 1')) throw new Error('Lokaler API-Endpoint-Check blieb ohne sichtbaren, passenden Beleg.');
              [...contractHttp.querySelectorAll('button')].find((button) => button.textContent?.includes('Mock stoppen'))?.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.apiContractMockState(boardProject.id)).running; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.apiContractMockState(boardProject.id)).running) throw new Error('API-Mock wurde nicht gestoppt.');
              return true;
            })()
          `;
          void smokeWindow.webContents.executeJavaScript(boardScript).then(async () => {
            if (process.platform === 'win32') {
            const lateSession = smokeStore.snapshot(smokeProject.id).sessions.find((item) => item.cardId === f07Card.id);
            if (!lateSession || lateSession.state !== 'exited') throw new Error('F07: Real CLI completion is missing before the late-event check.');
            const beforeLateCount = readFileSync(join(smokeDataDirectory!, 'f07-launches.txt'), 'utf8').trim().split(/\r?\n/).length;
            new WorkflowEngine(smokeStore, runner!).onSessionFinished(lateSession);
            if (smokeStore.snapshot(smokeProject.id).sessions.filter((item) => item.cardId === f07Card.id).length !== 1
              || readFileSync(join(smokeDataDirectory!, 'f07-launches.txt'), 'utf8').trim().split(/\r?\n/).length !== beforeLateCount)
              throw new Error('F07: Late completion launched the next step without explicit resume.');
            }
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const projectId = ${JSON.stringify(smokeProject.id)};
              const cardId = ${JSON.stringify(smokeCard.id)};
              const route = ${JSON.stringify(qaUrl)};
              const nav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board');
              if (!nav) throw new Error('Board-Navigation für QA-Abdeckung fehlt.');
              nav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.column-settings-trigger'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const settingsTrigger = document.querySelector('.column-settings-trigger');
              if (!(settingsTrigger instanceof HTMLButtonElement)) throw new Error('Spalteneinstellungen fehlen im Board-Kopf.');
              settingsTrigger.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.column-settings-sheet'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const settingsSheet = document.querySelector('.column-settings-sheet');
              if (!settingsSheet?.querySelector('.column-settings select[aria-label^="Agent für"]') || !settingsSheet.textContent?.includes('Sitzungen aktueller Karten') || document.querySelector('.column-footer .column-settings')) throw new Error('Spaltenagent, Automatik oder Sitzungen liegen nicht im Kopfpanel.');
              settingsSheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              for (let attempt = 0; attempt < 100 && document.querySelector('.column-settings-sheet'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.column-settings-sheet')) throw new Error('Spalteneinstellungen schließen nicht mit Escape.');
              for (let attempt = 0; attempt < 100 && !document.querySelector('.qa-coverage > summary'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              let panel = document.querySelector('.qa-coverage');
              panel?.querySelector('summary')?.click();
              for (let attempt = 0; attempt < 100 && !panel?.querySelector('form select'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              for (let attempt = 0; attempt < 100 && !panel?.textContent?.includes('Noch keine Route ausgewählt'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!panel?.textContent?.includes('Noch keine Route ausgewählt')) throw new Error('Leerer QA-Abdeckungszustand fehlt.');
              const form = panel?.querySelector('form');
              const cardSelect = form?.querySelector('select');
              const routeInput = form?.querySelector('input[type="url"]');
              const tablet = [...(form?.querySelectorAll('fieldset input') ?? [])][1];
              const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!form || !cardSelect || !routeInput || !tablet || !selectSetter || !inputSetter) throw new Error('QA-Abdeckungsformular fehlt.');
              selectSetter.call(cardSelect, cardId); cardSelect.dispatchEvent(new Event('change', { bubbles: true }));
              inputSetter.call(routeInput, route); routeInput.dispatchEvent(new Event('input', { bubbles: true }));
              tablet.click();
              for (let attempt = 0; attempt < 100 && form.querySelector('button[type="submit"]')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              form.querySelector('button[type="submit"]')?.click();
              let selected;
              for (let attempt = 0; attempt < 100; attempt++) {
                selected = (await window.studio.qaCoverageRoutes(projectId))[0];
                if (selected && panel?.querySelector('tbody tr')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!selected || JSON.stringify(selected.viewports) !== JSON.stringify(['desktop', 'tablet'])
                || selected.cells[0]?.state !== 'missing' || selected.cells[1]?.report?.status !== 'failed'
                || !panel?.textContent?.includes('Kein Bericht') || !panel.textContent.includes('Fehler gefunden')) {
                throw new Error('QA-Abdeckungsmatrix zeigte gewählte Größen, Lücke und Fehler nicht korrekt.');
              }
              const sessionsBefore = (await window.studio.snapshot(projectId)).sessions.length;
              let runButton;
              for (let attempt = 0; attempt < 100; attempt++) {
                runButton = panel.querySelector('tbody tr td:nth-child(2) .qa-coverage-cell button.secondary-button');
                if (runButton && !runButton.disabled) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!runButton || runButton.disabled) throw new Error('Gezielter QA-Start für fehlende Zelle fehlt.');
              runButton.click();
              for (let attempt = 0; attempt < 500; attempt++) {
                selected = (await window.studio.qaCoverageRoutes(projectId))[0];
                if (selected?.cells[0]?.report && panel?.querySelector('tbody tr td:nth-child(2)')?.textContent?.includes('Fehler gefunden')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (selected?.cells[0]?.report?.status !== 'failed' || (await window.studio.snapshot(projectId)).sessions.length !== sessionsBefore) throw new Error('Gezielter QA-Lauf speicherte keinen Fehlerbericht oder startete einen Agenten.');
              const otherProject = (await window.studio.projects()).find((item) => item.name === 'Smoke-Zweitprojekt');
              const projectSelect = document.querySelector('#project-select');
              if (!otherProject || !projectSelect) throw new Error('Projektwechsel für QA-Abdeckung fehlt.');
              selectSetter.call(projectSelect, otherProject.id); projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.qa-coverage[data-project-id="' + otherProject.id + '"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const otherPanel = document.querySelector('.qa-coverage');
              otherPanel?.querySelector('summary')?.click();
              for (let attempt = 0; attempt < 100 && !otherPanel?.textContent?.includes('Noch keine Route ausgewählt'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!otherPanel?.textContent?.includes('Noch keine Route ausgewählt') || otherPanel.textContent.includes(route)) throw new Error('QA-Abdeckung zeigte eine Route aus einem fremden Projekt.');
              selectSetter.call(projectSelect, projectId); projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.qa-coverage[data-project-id="' + projectId + '"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              panel = document.querySelector('.qa-coverage');
              panel?.querySelector('summary')?.click();
              for (let attempt = 0; attempt < 100 && !panel?.querySelector('tbody tr'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!panel?.textContent?.includes(route)) throw new Error('Gespeicherte QA-Abdeckung fehlte nach dem Projektwechsel.');
              const tabletLink = panel.querySelector('tbody tr td:nth-child(3) .qa-coverage-cell button.text-button');
              const tabletReportId = selected.cells[1]?.report?.id;
              tabletLink?.click();
              for (let attempt = 0; attempt < 100 && document.activeElement?.id !== 'card-qa-report-' + tabletReportId; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!tabletReportId || document.activeElement?.id !== 'card-qa-report-' + tabletReportId) throw new Error('QA-Abdeckungszelle öffnete den Quellenbericht nicht.');
              return true;
            })()`);
            execFileSync('git', ['init', '-q', smokeDataDirectory!], { windowsHide: true });
            execFileSync('git', ['-C', smokeDataDirectory!, 'add', '--', 'src/theme.css'], { windowsHide: true });
            execFileSync('git', ['-C', smokeDataDirectory!, '-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic smoke theme'], { windowsHide: true });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const project = (await window.studio.projects())[0];
              const report = await window.studio.projectChangelog({ projectId: project.id, period: 'week', scope: 'saved-worktrees' });
              if (report.state !== 'ready' || report.scope !== 'saved-worktrees' || report.checkedWorktrees !== 0 || report.issues.length || !report.commits.some((item) => item.subject === 'Synthetic smoke theme' && item.sources?.[0]?.kind === 'project-head')) throw new Error('Changelog-IPC lieferte den synthetischen Git-Commit nicht.');
              const nav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Changelog');
              if (!nav) throw new Error('Changelog-Navigation fehlt.');
              nav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.changelog-page select'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const source = [...document.querySelectorAll('.changelog-controls label')].find((item) => item.textContent?.includes('Quellen'))?.querySelector('select');
              if (!source || source.value !== 'head') throw new Error('Changelog-Quellwahl fehlt oder Standard wurde verändert.');
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!setter) throw new Error('Changelog-Quellwahl ist nicht bedienbar.');
              setter.call(source, 'saved-worktrees'); source.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.changelog-worktree-summary'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.changelog-worktree-summary')?.textContent?.includes('0 gespeicherte') || !document.querySelector('.changelog-groups')?.textContent?.includes('Synthetic smoke theme') || !document.querySelector('.changelog-timeline')?.textContent?.includes('Synthetic smoke theme')) throw new Error('Changelog-Worktree-Ansicht zeigte den geprüften Commit nicht im zeitlichen Überblick.');
              return true;
            })()`);
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const nav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Design');
              if (!nav) throw new Error('Design-Navigation fehlt.');
              nav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.task-wireframe-source select'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              let wireframe = document.querySelector('.task-wireframe');
              const cardSelect = wireframe?.querySelector('.task-wireframe-source select');
              const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!(cardSelect instanceof HTMLSelectElement) || !selectSetter) throw new Error('Aufgaben-Wireframe-Auswahl fehlt.');
              selectSetter.call(cardSelect, ${JSON.stringify(smokeCard.id)}); cardSelect.dispatchEvent(new Event('change', { bubbles: true }));
              let starter;
              for (let attempt = 0; attempt < 200; attempt++) {
                wireframe = document.querySelector('.task-wireframe');
                starter = [...(wireframe?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Fenstergerüst vorbereiten'));
                if (wireframe?.querySelector('.task-wireframe-source select')?.value === ${JSON.stringify(smokeCard.id)} && wireframe.textContent?.includes(${JSON.stringify(`Für „${smokeCard.title}“ gibt es noch keinen Wireframe.`)}) && starter instanceof HTMLButtonElement && starter.isConnected && !starter.disabled) break;
                starter = undefined;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!(starter instanceof HTMLButtonElement)) throw new Error('Kartenbezogener Entwurfsstart für die ausgewählte Karte fehlt. Auswahl: ' + wireframe?.querySelector('.task-wireframe-source select')?.value + '; sichtbarer Zustand: ' + (wireframe?.textContent?.trim().slice(-320) ?? 'keine Wireframe-Ansicht'));
              if (![...(wireframe?.querySelectorAll('button') ?? [])].some((button) => button.textContent?.includes('Mit Agent vorschlagen'))) throw new Error('Optionaler Agentenvorschlag fehlt.');
              const beforeSessions = (await window.studio.snapshot(${JSON.stringify(smokeProject.id)})).sessions.length;
              for (let attempt = 0; attempt < 200; attempt++) {
                wireframe = document.querySelector('.task-wireframe');
                starter = [...(wireframe?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Fenstergerüst vorbereiten'));
                if (starter instanceof HTMLButtonElement && starter.isConnected && !starter.disabled && wireframe?.querySelector('.task-wireframe-source select')?.value === ${JSON.stringify(smokeCard.id)} && wireframe.textContent?.includes(${JSON.stringify(`Für „${smokeCard.title}“ gibt es noch keinen Wireframe.`)})) break;
                starter = undefined;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!(starter instanceof HTMLButtonElement)) throw new Error('Wireframe-Startknopf wurde nach dem Sitzungs-Snapshot ausgetauscht oder die Karte gewechselt.');
              starter.click();
              for (let attempt = 0; attempt < 200; attempt++) {
                wireframe = document.querySelector('.task-wireframe');
                if (wireframe?.querySelector('.task-wireframe-canvas')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!wireframe?.querySelector('.task-wireframe-canvas')) throw new Error('Fenstergerüst erschien nach dem Startklick nicht auf der Zeichenfläche. Auswahl: ' + wireframe?.querySelector('.task-wireframe-source select')?.value + '; Startknopf verbunden: ' + starter.isConnected + '; sichtbarer Zustand: ' + (wireframe?.textContent?.trim().slice(-320) ?? 'keine Wireframe-Ansicht'));
              const focusToggle = wireframe.querySelector('.task-wireframe-focus-toggle');
              if (!(focusToggle instanceof HTMLButtonElement) || focusToggle.disabled) throw new Error('Wireframe-Arbeitsmodus fehlt.');
              focusToggle.focus(); focusToggle.click(); focusToggle.click();
              for (let attempt = 0; attempt < 100; attempt++) {
                if (document.querySelector('.design-inspection.wireframe-focus') && document.querySelector('.design-inspection-tools[hidden]') && document.activeElement === focusToggle && wireframe.querySelector('.task-wireframe-canvas')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!document.querySelector('.design-inspection.wireframe-focus') || !document.querySelector('.design-inspection-tools[hidden]') || document.activeElement !== focusToggle || !wireframe.querySelector('.task-wireframe-canvas')) throw new Error('Fokusmodus verdeckte den Entwurf oder verlor die Tastaturbedienung: ' + JSON.stringify({ focused: document.activeElement?.outerHTML?.slice(0, 160), toggleConnected: focusToggle.isConnected, pressed: focusToggle.getAttribute('aria-pressed'), hidden: !!document.querySelector('.design-inspection-tools[hidden]'), canvas: !!wireframe.querySelector('.task-wireframe-canvas') }));
              const overview = wireframe.querySelector('.task-wireframe-overview');
              const previews = overview?.querySelectorAll('button');
              if (previews?.length !== 3 || !overview?.textContent?.includes('Noch kein Entwurf') || !overview.textContent.includes('960 × 600') || wireframe.querySelector('.task-wireframe-artboard-switch')) throw new Error('Drei Mini-Zeichenflächen oder deren Maße fehlen im Fokusmodus.');
              const mobilePreview = [...previews].find((button) => button.getAttribute('aria-label')?.startsWith('Mobile,'));
              const desktopPreview = [...previews].find((button) => button.getAttribute('aria-label')?.startsWith('Desktop,'));
              if (!(mobilePreview instanceof HTMLButtonElement) || !(desktopPreview instanceof HTMLButtonElement)) throw new Error('Mini-Zeichenflächen sind nicht per Tastatur erreichbar.');
              mobilePreview.focus(); mobilePreview.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-variant-empty'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (mobilePreview.getAttribute('aria-pressed') !== 'true' || !wireframe.querySelector('.task-wireframe-variant-empty')) throw new Error('Fehlende Mobile-Zeichenfläche wurde nicht bewusst zum Bearbeiten geöffnet.');
              desktopPreview.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelector('.task-wireframe-variant-empty'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (desktopPreview.getAttribute('aria-pressed') !== 'true' || !wireframe.querySelector('.task-wireframe-canvas')) throw new Error('Desktop-Zeichenfläche wurde nach Überblick nicht wieder editierbar.');
              focusToggle.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.design-inspection-tools[hidden]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.design-inspection.wireframe-focus') || !document.querySelector('.design-inspection-toolbar')) throw new Error('Rückweg zur Design-Inspektion fehlt.');
              if (!document.querySelector('.design-workspace-draft[hidden]')) throw new Error('Die Entwurfsfläche sollte nach Rückkehr zur Live-Inspektion verborgen sein.');
              const draftMode = [...document.querySelectorAll('.design-workspace-modes button')].find((button) => button.textContent?.trim() === 'Entwurf');
              if (!(draftMode instanceof HTMLButtonElement)) throw new Error('Entwurfs-Tab fehlt nach dem Fokusmodus.');
              draftMode.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.design-workspace-draft[hidden]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.design-workspace-draft[hidden]') || !document.querySelector('.design-inspection-tools[hidden]')) throw new Error('Entwurf wurde vor der weiteren Bearbeitung nicht sichtbar geöffnet.');
              const inlineTitle = [...wireframe.querySelectorAll('.task-wireframe-element')].find((item) => item.textContent?.includes('Smoke-Karte'));
              if (!(inlineTitle instanceof HTMLButtonElement)) throw new Error('Textobjekt für direkte Bearbeitung fehlt.');
              inlineTitle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('[data-wireframe-inline-editor]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              let inlineInput = wireframe.querySelector('[data-wireframe-inline-editor]');
              const inlineSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!(inlineInput instanceof HTMLInputElement) || !inlineSetter || document.activeElement !== inlineInput) throw new Error('Doppelklick öffnete keinen fokussierten Texteditor auf der Zeichenfläche.');
              inlineSetter.call(inlineInput, 'Abgebrochener Text'); inlineInput.dispatchEvent(new Event('input', { bubbles: true }));
              inlineInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              for (let attempt = 0; attempt < 100 && wireframe.querySelector('[data-wireframe-inline-editor]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (inlineTitle.textContent?.includes('Abgebrochener Text') || !inlineTitle.textContent?.includes('Smoke-Karte')) throw new Error('Escape verwarf den direkten Textentwurf nicht.');
              inlineTitle.focus(); inlineTitle.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('[data-wireframe-inline-editor]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              inlineInput = wireframe.querySelector('[data-wireframe-inline-editor]');
              if (!(inlineInput instanceof HTMLInputElement)) throw new Error('F2 öffnete den Texteditor nicht.');
              inlineSetter.call(inlineInput, 'Direkt geändert'); inlineInput.dispatchEvent(new Event('input', { bubbles: true }));
              inlineInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
              for (let attempt = 0; attempt < 100 && !inlineTitle.textContent?.includes('Direkt geändert'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!inlineTitle.textContent?.includes('Direkt geändert') || wireframe.querySelector('[data-wireframe-inline-editor]') || (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} })) !== null) throw new Error('Direkte Textänderung fehlte oder wurde ohne Speichern persistiert.');
              // Reopen before the previous edit's animation-frame focus restore can
              // take focus away from the newly mounted input.
              inlineTitle.focus(); inlineTitle.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('[data-wireframe-inline-editor]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const reopenedInput = wireframe.querySelector('[data-wireframe-inline-editor]');
              if (!(reopenedInput instanceof HTMLInputElement)) throw new Error('Schnelles erneutes Öffnen des Texteditors fehlte.');
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              if (document.activeElement !== reopenedInput) throw new Error('Ein älterer Fokus-Restore verdrängte den erneut geöffneten Texteditor: ' + document.activeElement?.outerHTML?.slice(0, 160));
              reopenedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              for (let attempt = 0; attempt < 100 && wireframe.querySelector('[data-wireframe-inline-editor]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelector('[data-wireframe-inline-editor]') || !inlineTitle.textContent?.includes('Direkt geändert')) throw new Error('Schnelles erneutes Öffnen und Verwerfen änderte den Text.');
              const inlineUndo = [...wireframe.querySelectorAll('.task-wireframe-history button')].find((button) => button.textContent?.includes('Rückgängig'));
              if (!(inlineUndo instanceof HTMLButtonElement)) throw new Error('Rückgängig für direkte Textänderung fehlt.');
              inlineUndo.click();
              for (let attempt = 0; attempt < 100 && !inlineTitle.textContent?.includes('Smoke-Karte'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!inlineTitle.textContent?.includes('Smoke-Karte')) throw new Error('Direkte Textänderung ließ sich nicht in einem Schritt rückgängig machen.');
              inlineTitle.focus(); inlineTitle.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('[data-wireframe-inline-editor]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              inlineInput = wireframe.querySelector('[data-wireframe-inline-editor]');
              if (!(inlineInput instanceof HTMLInputElement)) throw new Error('Direkter Texteditor fehlt beim erneuten Öffnen.');
              inlineSetter.call(inlineInput, 'X'.repeat(130)); inlineInput.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && inlineInput.value.length !== 120; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (inlineInput.value.length !== 120) throw new Error('Direkte Textbearbeitung begrenzte die Eingabe nicht auf 120 Zeichen.');
              for (let attempt = 0; attempt < 100 && document.activeElement !== inlineInput; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.activeElement !== inlineInput) throw new Error('Direkter Texteditor erhielt vor Blur keinen Tastaturfokus.');
              inlineInput.blur(); inlineInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && inlineTitle.textContent?.length !== 120; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (inlineTitle.textContent?.length !== 120) throw new Error('Textänderung beim Verlassen des Felds wurde nicht übernommen: ' + JSON.stringify({ text: inlineTitle.textContent?.slice(0, 30), length: inlineTitle.textContent?.length, editor: Boolean(wireframe.querySelector('[data-wireframe-inline-editor]')), inputLength: inlineInput.value.length, active: document.activeElement?.tagName }));
              inlineUndo.click();
              for (let attempt = 0; attempt < 100 && !inlineTitle.textContent?.includes('Smoke-Karte'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!inlineTitle.textContent?.includes('Smoke-Karte')) throw new Error('Textänderung nach Verlassen des Felds ließ sich nicht rückgängig machen.');
              const premature = await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} });
              if (premature !== null) throw new Error('Fenstergerüst wurde vor dem ausdrücklichen Speichern in SQLite angelegt.');
              const canvasStage = wireframe.querySelector('.task-wireframe-canvas');
              const shrinkView = wireframe.querySelector('button[aria-label="Ansicht verkleinern"]');
              const growView = wireframe.querySelector('button[aria-label="Ansicht vergrößern"]');
              const gridView = [...wireframe.querySelectorAll('.task-wireframe-view-controls button')].find((button) => button.textContent?.includes('8 px Raster'));
              const viewPort = wireframe.querySelector('.task-wireframe-canvas-viewport');
              if (!(canvasStage instanceof HTMLElement) || !(shrinkView instanceof HTMLButtonElement) || !(growView instanceof HTMLButtonElement) || !(gridView instanceof HTMLButtonElement) || !(viewPort instanceof HTMLElement)) throw new Error('Wireframe-Ansichtssteuerung fehlt.');
              const widthBeforeZoom = canvasStage.getBoundingClientRect().width;
              shrinkView.click();
              for (let attempt = 0; attempt < 100 && canvasStage.getBoundingClientRect().width >= widthBeforeZoom; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (canvasStage.getBoundingClientRect().width >= widthBeforeZoom) throw new Error('Wireframe-Zoom verkleinerte die Zeichenfläche nicht.');
              growView.click(); growView.click(); growView.click();
              for (let attempt = 0; attempt < 100 && viewPort.scrollWidth <= viewPort.clientWidth; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (viewPort.scrollWidth <= viewPort.clientWidth || viewPort.tabIndex !== 0) throw new Error('Vergrößerte Zeichenfläche ist nicht scrollbar oder per Tastatur erreichbar.');
              gridView.click();
              for (let attempt = 0; attempt < 100 && !canvasStage.classList.contains('has-grid'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!canvasStage.classList.contains('has-grid') || gridView.getAttribute('aria-pressed') !== 'true' || (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} })) !== null) throw new Error('Rasteransicht wurde nicht aktiviert oder speicherte vorzeitig.');
              const firstLayer = wireframe.querySelectorAll('.task-wireframe-layers li button')[0];
              const secondLayer = wireframe.querySelectorAll('.task-wireframe-layers li button')[1];
              if (!(firstLayer instanceof HTMLButtonElement) || !(secondLayer instanceof HTMLButtonElement)) throw new Error('Wireframe-Ebenen für Mehrfachauswahl fehlen.');
              const stageRect = canvasStage.getBoundingClientRect();
              if (!stageRect.width || !stageRect.height) throw new Error('Wireframe-Zeichenfläche hat keine messbaren Maße für die Rahmenauswahl.');
              const originalCapture = canvasStage.setPointerCapture.bind(canvasStage);
              const originalHasCapture = canvasStage.hasPointerCapture.bind(canvasStage);
              const originalRelease = canvasStage.releasePointerCapture.bind(canvasStage);
              let syntheticCaptured = false;
              canvasStage.setPointerCapture = () => { syntheticCaptured = true; };
              canvasStage.hasPointerCapture = () => syntheticCaptured;
              canvasStage.releasePointerCapture = () => { syntheticCaptured = false; };
              const stagePointer = (type, x, y, shiftKey = false) => canvasStage.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 42, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, shiftKey }));
              try {
                stagePointer('pointerdown', stageRect.right - 2, stageRect.bottom - 2);
                stagePointer('pointermove', stageRect.left + 2, stageRect.top + 2);
                for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-marquee'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (!wireframe.querySelector('.task-wireframe-marquee')) throw new Error('Rahmenauswahl wurde beim Ziehen nicht angezeigt.');
                stagePointer('pointerup', stageRect.left + 2, stageRect.top + 2);
                for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element[aria-pressed="true"]').length < 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (wireframe.querySelectorAll('.task-wireframe-element[aria-pressed="true"]').length < 2 || wireframe.querySelector('.task-wireframe-marquee') || (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} })) !== null) throw new Error('Rahmenauswahl markierte die Elemente nicht oder speicherte vorzeitig.');
                stagePointer('pointerdown', stageRect.right - 2, stageRect.bottom - 2);
                canvasStage.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
                if (wireframe.querySelector('.task-wireframe-marquee') || wireframe.querySelectorAll('.task-wireframe-element[aria-pressed="true"]').length < 2) throw new Error('Escape brach die Rahmenauswahl nicht ohne Änderung ab.');
                stagePointer('pointerdown', stageRect.right - 2, stageRect.bottom - 2);
                stagePointer('pointerup', stageRect.right - 2, stageRect.bottom - 2);
                for (let attempt = 0; attempt < 100 && wireframe.querySelector('.task-wireframe-element[aria-pressed="true"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (wireframe.querySelector('.task-wireframe-element[aria-pressed="true"]')) throw new Error('Klick auf freie Zeichenfläche hob die Auswahl nicht auf.');

                const drawEllipse = wireframe.querySelector('[data-wireframe-draw-kind="ellipse"]');
                if (!(drawEllipse instanceof HTMLButtonElement)) throw new Error('Direktes Ellipsenwerkzeug fehlt.');
                const countBeforeDrawing = wireframe.querySelectorAll('.task-wireframe-element').length;
                drawEllipse.click();
                for (let attempt = 0; attempt < 100 && drawEllipse.getAttribute('aria-pressed') !== 'true'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (drawEllipse.getAttribute('aria-pressed') !== 'true') throw new Error('Zeichenwerkzeug wurde nicht aktiviert.');
                const drawStartX = stageRect.left + stageRect.width * .68;
                const drawStartY = stageRect.top + stageRect.height * .66;
                const drawEndX = stageRect.left + stageRect.width * .83;
                const drawEndY = stageRect.top + stageRect.height * .86;
                stagePointer('pointerdown', drawStartX, drawStartY);
                stagePointer('pointermove', drawEndX, drawEndY);
                for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-drawing-preview.kind-ellipse'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (!wireframe.querySelector('.task-wireframe-drawing-preview.kind-ellipse')) throw new Error('Direktes Zeichnen zeigte keine Formvorschau.');
                stagePointer('pointerup', drawEndX, drawEndY);
                for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== countBeforeDrawing + 1; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (wireframe.querySelectorAll('.task-wireframe-element').length !== countBeforeDrawing + 1 || !wireframe.querySelector('.task-wireframe-element.kind-ellipse[aria-pressed="true"]') || wireframe.querySelector('.task-wireframe-drawing-preview') || (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} })) !== null) throw new Error('Direktes Zeichnen erzeugte keine ungespeicherte ausgewählte Ellipse.');
                const drawingUndo = [...wireframe.querySelectorAll('.task-wireframe-history button')].find((button) => button.textContent?.includes('Rückgängig'));
                if (!(drawingUndo instanceof HTMLButtonElement) || drawingUndo.disabled) throw new Error('Direktes Zeichnen lieferte keinen Rückgängig-Schritt.');
                drawingUndo.click();
                for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== countBeforeDrawing; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (wireframe.querySelectorAll('.task-wireframe-element').length !== countBeforeDrawing) throw new Error('Direkte Form ließ sich nicht mit einem Schritt rückgängig machen.');
                stagePointer('pointerdown', drawStartX, drawStartY);
                stagePointer('pointermove', drawEndX, drawEndY);
                canvasStage.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
                if (wireframe.querySelector('.task-wireframe-drawing-preview') || wireframe.querySelectorAll('.task-wireframe-element').length !== countBeforeDrawing) throw new Error('Escape brach die noch ungespeicherte Zeichengeste nicht ab.');
                stagePointer('pointerdown', drawStartX, drawStartY);
                stagePointer('pointermove', drawStartX + 3, drawStartY + 3);
                stagePointer('pointerup', drawStartX + 3, drawStartY + 3);
                if (wireframe.querySelectorAll('.task-wireframe-element').length !== countBeforeDrawing) throw new Error('Ein kleiner Zeigerzug erzeugte versehentlich eine Form.');
                canvasStage.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
                for (let attempt = 0; attempt < 100 && drawEllipse.getAttribute('aria-pressed') !== 'false'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (drawEllipse.getAttribute('aria-pressed') !== 'false') throw new Error('Zeichenwerkzeug ließ sich nicht per Escape verlassen.');
              } finally {
                canvasStage.setPointerCapture = originalCapture;
                canvasStage.hasPointerCapture = originalHasCapture;
                canvasStage.releasePointerCapture = originalRelease;
              }
              firstLayer.click(); secondLayer.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-multi'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const centerSelection = [...wireframe.querySelectorAll('.task-wireframe-align-grid button')].find((button) => button.textContent?.includes('Mitte X'));
              if (!(centerSelection instanceof HTMLButtonElement) || firstLayer.getAttribute('aria-pressed') !== 'true' || secondLayer.getAttribute('aria-pressed') !== 'true') throw new Error('Mehrfachauswahl oder Ausrichtungssteuerung fehlt.');
              centerSelection.click();
              const titleElement = [...wireframe.querySelectorAll('.task-wireframe-element')].find((item) => item.textContent?.includes('Smoke-Karte'));
              for (let attempt = 0; attempt < 100 && titleElement?.style.left === '4.375%'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(titleElement instanceof HTMLElement) || titleElement.style.left === '4.375%') throw new Error('Mehrfachauswahl wurde nicht ausgerichtet.');
              const alignmentUndo = [...wireframe.querySelectorAll('.task-wireframe-history button')].find((button) => button.textContent?.includes('Rückgängig'));
              if (!(alignmentUndo instanceof HTMLButtonElement)) throw new Error('Ausrichtung wurde nicht als Bearbeitungsschritt gespeichert.');
              alignmentUndo.click();
              for (let attempt = 0; attempt < 100 && titleElement.style.left !== '4.375%'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (titleElement.style.left !== '4.375%') throw new Error('Mehrfachausrichtung ließ sich nicht rückgängig machen.');
              const groupFirst = wireframe.querySelectorAll('.task-wireframe-layers li button')[2];
              const groupSecond = wireframe.querySelectorAll('.task-wireframe-layers li button')[3];
              if (!(groupFirst instanceof HTMLButtonElement) || !(groupSecond instanceof HTMLButtonElement)) throw new Error('Bewegliche Gruppenebenen fehlen.');
              groupFirst.click();
              for (let attempt = 0; attempt < 100 && groupFirst.getAttribute('aria-pressed') !== 'true'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              groupSecond.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
              for (let attempt = 0; attempt < 100 && (groupFirst.getAttribute('aria-pressed') !== 'true' || groupSecond.getAttribute('aria-pressed') !== 'true'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const groupButton = [...wireframe.querySelectorAll('.task-wireframe-group-actions button')].find((button) => button.textContent?.includes('Gruppieren'));
              if (!(groupButton instanceof HTMLButtonElement) || groupButton.disabled) throw new Error('Gruppieren fehlt für die Mehrfachauswahl.');
              groupButton.click();
              for (let attempt = 0; attempt < 100 && !groupFirst.textContent?.includes('Gruppe'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              groupFirst.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element[aria-pressed="true"]').length < 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-element[aria-pressed="true"]').length !== 2 || !groupSecond.textContent?.includes('Gruppe')) throw new Error('Klick auf ein Gruppenmitglied wählte nicht die ganze Gruppe: ' + JSON.stringify({ selected: [...wireframe.querySelectorAll('.task-wireframe-layers li button[aria-pressed="true"]')].map((item) => item.textContent), first: groupFirst.textContent, second: groupSecond.textContent }));
              const groupCount = wireframe.querySelectorAll('.task-wireframe-element').length;
              groupFirst.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== groupCount + 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-element').length !== groupCount + 2 || wireframe.querySelectorAll('.task-wireframe-element[aria-pressed="true"]').length !== 2) throw new Error('Strg+D duplizierte die Gruppe nicht vollständig.');
              alignmentUndo.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== groupCount; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const groupedItem = wireframe.querySelectorAll('.task-wireframe-element')[2];
              const groupedBefore = groupedItem?.getBoundingClientRect();
              if (!(groupedItem instanceof HTMLElement) || !groupedBefore) throw new Error('Gruppiertes Element fehlt für den Zieh-Test.');
              const originalGroupCapture = groupedItem.setPointerCapture.bind(groupedItem);
              groupedItem.setPointerCapture = () => {};
              const groupPositions = [...wireframe.querySelectorAll('.task-wireframe-element')].slice(2, 4).map((item) => item.style.left);
              try {
                const x = groupedBefore.left + Math.min(12, groupedBefore.width / 2);
                const y = groupedBefore.top + Math.min(12, groupedBefore.height / 2);
                groupedItem.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 43, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y }));
                groupedItem.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 43, pointerType: 'mouse', button: 0, buttons: 1, clientX: x + 24, clientY: y + 16 }));
                groupedItem.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 43, pointerType: 'mouse', button: 0, buttons: 0, clientX: x + 24, clientY: y + 16 }));
                for (let attempt = 0; attempt < 100 && [...wireframe.querySelectorAll('.task-wireframe-element')].slice(2, 4).some((item, index) => item.style.left === groupPositions[index]); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
                if ([...wireframe.querySelectorAll('.task-wireframe-element')].slice(2, 4).some((item, index) => item.style.left === groupPositions[index])) throw new Error('Ziehen eines Gruppenmitglieds bewegte nicht die ganze Gruppe.');
              } finally { groupedItem.setPointerCapture = originalGroupCapture; }
              alignmentUndo.click();
              for (let attempt = 0; attempt < 100 && [...wireframe.querySelectorAll('.task-wireframe-element')].slice(2, 4).some((item, index) => item.style.left !== groupPositions[index]); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              groupFirst.click();
              for (let attempt = 0; attempt < 100 && ![...wireframe.querySelectorAll('.task-wireframe-multi button')].some((item) => item.textContent?.includes('Gruppe bearbeiten')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const enterGroup = [...wireframe.querySelectorAll('.task-wireframe-multi button')].find((item) => item.textContent?.includes('Gruppe bearbeiten'));
              if (!(enterGroup instanceof HTMLButtonElement)) throw new Error('Gruppeninhalt ist nicht zugänglich.');
              enterGroup.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-group-path'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const groupX = wireframe.querySelector('.task-wireframe-geometry input');
              const groupTextSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!(groupX instanceof HTMLInputElement) || !groupTextSetter || wireframe.querySelectorAll('.task-wireframe-element[aria-pressed="true"]').length !== 1) throw new Error('Gruppenbearbeitung wählte kein einzelnes Mitglied.');
              const memberBefore = groupX.value;
              const siblingBefore = wireframe.querySelectorAll('.task-wireframe-element')[3]?.style.left;
              groupTextSetter.call(groupX, String(Number(memberBefore) + 5)); groupX.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && groupX.value !== String(Number(memberBefore) + 5); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (groupX.value !== String(Number(memberBefore) + 5) || wireframe.querySelectorAll('.task-wireframe-element')[3]?.style.left !== siblingBefore || (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} })) !== null) throw new Error('Mitgliedsgeometrie wurde nicht isoliert und ungespeichert bearbeitet.');
              alignmentUndo.click();
              for (let attempt = 0; attempt < 100 && groupX.value !== memberBefore; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (groupX.value !== memberBefore || !wireframe.querySelector('.task-wireframe-group-path')) throw new Error('Gruppenmitglied ließ sich nicht lokal rückgängig machen.');
              const member = wireframe.querySelectorAll('.task-wireframe-element')[2];
              const memberLeft = member?.style.left;
              if (!(member instanceof HTMLButtonElement)) throw new Error('Gruppenmitglied ist nicht per Tastatur erreichbar.');
              member.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
              for (let attempt = 0; attempt < 100 && member.style.left === memberLeft; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (member.style.left === memberLeft || wireframe.querySelectorAll('.task-wireframe-element')[3]?.style.left !== siblingBefore) throw new Error('Pfeiltaste bewegte nicht nur das gewählte Gruppenmitglied.');
              alignmentUndo.click();
              for (let attempt = 0; attempt < 100 && member.style.left !== memberLeft; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (member.style.left !== memberLeft) throw new Error('Pfeiltastenbewegung des Gruppenmitglieds ließ sich nicht rückgängig machen.');
              groupFirst.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              for (let attempt = 0; attempt < 100 && wireframe.querySelector('.task-wireframe-group-path'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelector('.task-wireframe-group-path') || wireframe.querySelectorAll('.task-wireframe-element[aria-pressed="true"]').length !== 2) throw new Error('Escape verließ die Gruppe nicht mit Vollgruppenauswahl.');
              alignmentUndo.click();
              for (let attempt = 0; attempt < 100 && groupFirst.textContent?.includes('Gruppe'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (groupFirst.textContent?.includes('Gruppe')) throw new Error('Gruppierung ließ sich nicht rückgängig machen.');
              wireframe.querySelectorAll('.task-wireframe-layers li button')[1]?.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('input[aria-label="Text des ausgewählten Elements"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const text = wireframe.querySelector('input[aria-label="Text des ausgewählten Elements"]');
              const textSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!(text instanceof HTMLInputElement) || !textSetter) throw new Error('Wireframe-Eigenschaften fehlen.');
              textSetter.call(text, 'Geprüfter Entwurf'); text.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && ![...wireframe.querySelectorAll('.task-wireframe-element')].some((item) => item.textContent?.includes('Geprüfter Entwurf')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const boardNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board');
              if (!boardNav) throw new Error('Board-Navigation fehlt beim Wireframe.');
              boardNav.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.task-wireframe'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              nav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.task-wireframe-canvas'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              wireframe = document.querySelector('.task-wireframe');
              if (!wireframe?.textContent?.includes('Ungespeicherter Entwurf aus dieser App-Sitzung wiederhergestellt') || ![...wireframe.querySelectorAll('.task-wireframe-element')].some((item) => item.textContent?.includes('Geprüfter Entwurf')) || (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} })) !== null) throw new Error('Ungespeicherter Wireframe ging beim Ansichtswechsel verloren oder wurde vorzeitig gespeichert.');
              wireframe.querySelectorAll('.task-wireframe-layers li button')[1]?.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-geometry input'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const xField = wireframe.querySelector('.task-wireframe-geometry input');
              if (!(xField instanceof HTMLInputElement)) throw new Error('Wireframe-X-Eingabe fehlt.');
              textSetter.call(xField, ''); xField.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && xField.value !== ''; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (xField.value !== '') throw new Error('Wireframe-X-Feld lässt sich nicht leeren.');
              textSetter.call(xField, '60'); xField.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && [...wireframe.querySelectorAll('.task-wireframe-element')].find((item) => item.textContent?.includes('Geprüfter Entwurf'))?.style.left !== '6.25%'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ([...wireframe.querySelectorAll('.task-wireframe-element')].find((item) => item.textContent?.includes('Geprüfter Entwurf'))?.style.left !== '6.25%') throw new Error('Ersetzte Wireframe-X-Koordinate wurde nicht übernommen.');
              const element = [...wireframe.querySelectorAll('.task-wireframe-element')].find((item) => item.textContent?.includes('Geprüfter Entwurf'));
              if (!(element instanceof HTMLButtonElement)) throw new Error('Editierter Text erschien nicht auf der Fläche.');
              element.focus(); element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
              for (let attempt = 0; attempt < 100 && wireframe.querySelector('.task-wireframe-geometry input')?.value !== '61'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const resizeHandle = wireframe.querySelector('.task-wireframe-resize');
              if (!(resizeHandle instanceof HTMLButtonElement) || resizeHandle.disabled) throw new Error('Wireframe-Größengriff fehlt.');
              resizeHandle.focus(); resizeHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-geometry input')[2]?.value !== '630'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-geometry input')[2]?.value !== '630') throw new Error('Tastatur-Größenänderung wurde nicht übernommen.');
              const undo = [...wireframe.querySelectorAll('.task-wireframe-history button')].find((button) => button.textContent?.includes('Rückgängig'));
              const redo = [...wireframe.querySelectorAll('.task-wireframe-history button')].find((button) => button.textContent?.includes('Wiederholen'));
              if (!(undo instanceof HTMLButtonElement) || !(redo instanceof HTMLButtonElement)) throw new Error('Wireframe-Verlauf fehlt.');
              undo.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-geometry input')[2]?.value !== '620'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-geometry input')[2]?.value !== '620') throw new Error('Größenänderung ließ sich nicht rückgängig machen.');
              redo.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-geometry input')[2]?.value !== '630'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-geometry input')[2]?.value !== '630') throw new Error('Größenänderung ließ sich nicht wiederholen.');
              const layerForward = [...wireframe.querySelectorAll('.task-wireframe-layer-order button')].find((button) => button.textContent?.includes('Eine Ebene vor'));
              if (!(layerForward instanceof HTMLButtonElement) || layerForward.disabled) throw new Error('Ebenensteuerung fehlt.');
              layerForward.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-layers li button')[2]?.textContent?.includes('Geprüfter Entwurf') !== true; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-layers li button')[2]?.textContent?.includes('Geprüfter Entwurf') !== true) throw new Error('Ebenenreihenfolge wurde nicht geändert.');
              const fontSize = wireframe.querySelector('input[aria-label="Schriftgröße in Pixel"]');
              if (!(fontSize instanceof HTMLInputElement)) throw new Error('Schriftgröße fehlt in der Eigenschaftenleiste.');
              textSetter.call(fontSize, '20'); fontSize.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && fontSize.value !== '20'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const activeStage = wireframe.querySelector('.task-wireframe-canvas');
              const activeGrowView = wireframe.querySelector('button[aria-label="Ansicht vergrößern"]');
              const activeShrinkView = wireframe.querySelector('button[aria-label="Ansicht verkleinern"]');
              if (!(activeStage instanceof HTMLElement) || !(activeGrowView instanceof HTMLButtonElement) || !(activeShrinkView instanceof HTMLButtonElement)) throw new Error('Aktuelle Wireframe-Zeichenfläche oder Zoomsteuerung fehlt.');
              const scaledFont = (target, stage, artboardWidth) => Math.abs(parseFloat(getComputedStyle(target).fontSize) - 20 * stage.clientWidth / artboardWidth) < 1;
              if (fontSize.value !== '20' || !element.style.fontSize.endsWith('cqw') || !scaledFont(element, activeStage, 960)) throw new Error('Schriftgröße wurde nicht in Artboard-Pixeln auf die Canvas-Breite skaliert: ' + JSON.stringify({ value: fontSize.value, style: element.style.fontSize, computed: getComputedStyle(element).fontSize, stageWidth: activeStage.clientWidth, containerType: getComputedStyle(activeStage).containerType }));
              const wrap = wireframe.querySelector('.task-wireframe-canvas-wrap');
              if (!(wrap instanceof HTMLElement)) throw new Error('Wireframe-Canvas-Container fehlt.');
              const originalStageWidth = activeStage.clientWidth;
              wrap.style.maxWidth = Math.round(originalStageWidth * .75) + 'px';
              for (let attempt = 0; attempt < 100 && (activeStage.clientWidth >= originalStageWidth || !scaledFont(element, activeStage, 960)); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (activeStage.clientWidth >= originalStageWidth || !scaledFont(element, activeStage, 960)) throw new Error('Schriftgröße folgt einer schmaleren Desktop-Zeichenfläche nicht: ' + JSON.stringify({ originalWidth: originalStageWidth, currentWidth: activeStage.clientWidth, computed: getComputedStyle(element).fontSize, expected: 20 * activeStage.clientWidth / 960 }));
              wrap.style.maxWidth = '';
              for (let attempt = 0; attempt < 100 && (activeStage.clientWidth !== originalStageWidth || !scaledFont(element, activeStage, 960)); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (activeStage.clientWidth !== originalStageWidth || !scaledFont(element, activeStage, 960)) throw new Error('Schriftgröße wurde nach Desktop-Resize nicht wiederhergestellt: ' + JSON.stringify({ originalWidth: originalStageWidth, currentWidth: activeStage.clientWidth, computed: getComputedStyle(element).fontSize, expected: 20 * activeStage.clientWidth / 960 }));
              const glyph = document.createRange(); glyph.selectNodeContents(element);
              const glyphHeight100 = glyph.getBoundingClientRect().height;
              activeGrowView.click();
              let glyphHeight125 = 0;
              for (let attempt = 0; attempt < 100; attempt++) {
                glyphHeight125 = glyph.getBoundingClientRect().height;
                if (wireframe.querySelector('.task-wireframe-view-controls output')?.textContent?.trim() === '125 %' && glyphHeight100 && Math.abs(glyphHeight125 / glyphHeight100 - 1.25) <= .08) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!glyphHeight100 || Math.abs(glyphHeight125 / glyphHeight100 - 1.25) > .08) throw new Error('Schriftgröße folgt dem Zoom nicht proportional: ' + JSON.stringify({ before: glyphHeight100, after: glyphHeight125, expectedRatio: 1.25, zoom: wireframe.querySelector('.task-wireframe-view-controls output')?.textContent?.trim() }));
              activeShrinkView.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelector('.task-wireframe-view-controls output')?.textContent?.trim() !== '100 %'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelector('.task-wireframe-view-controls output')?.textContent?.trim() !== '100 %') throw new Error('Wireframe-Zoom kehrte nicht zur Ausgangsstufe zurück.');
              const navigationView = wireframe.querySelector('.task-wireframe-canvas-viewport');
              if (!(navigationView instanceof HTMLElement)) throw new Error('Wireframe-Ansicht für direkte Navigation fehlt.');
              const pointerRect = activeStage.getBoundingClientRect();
              const pointerX = pointerRect.left + pointerRect.width / 2;
              const pointerY = pointerRect.top + Math.min(pointerRect.height / 2, 100);
              navigationView.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -1, clientX: pointerX, clientY: pointerY }));
              for (let attempt = 0; attempt < 100 && wireframe.querySelector('.task-wireframe-view-controls output')?.textContent?.trim() !== '125 %'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const zoomedRect = activeStage.getBoundingClientRect();
              if (wireframe.querySelector('.task-wireframe-view-controls output')?.textContent?.trim() !== '125 %' || Math.abs(zoomedRect.left + zoomedRect.width / 2 - pointerX) > 4) throw new Error('Strg + Mausrad zoomte nicht um den Zeiger: ' + JSON.stringify({ zoom: wireframe.querySelector('.task-wireframe-view-controls output')?.textContent?.trim(), anchorBefore: pointerX, anchorAfter: zoomedRect.left + zoomedRect.width / 2 }));
              navigationView.scrollLeft = Math.max(1, (navigationView.scrollWidth - navigationView.clientWidth) / 2);
              const scrollBeforePan = navigationView.scrollLeft;
              const originalViewCapture = navigationView.setPointerCapture.bind(navigationView);
              const originalViewHasCapture = navigationView.hasPointerCapture.bind(navigationView);
              const originalViewRelease = navigationView.releasePointerCapture.bind(navigationView);
              let viewCaptured = false;
              navigationView.setPointerCapture = () => { viewCaptured = true; };
              navigationView.hasPointerCapture = () => viewCaptured;
              navigationView.releasePointerCapture = () => { viewCaptured = false; };
              try {
                navigationView.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 73, pointerType: 'mouse', button: 1, buttons: 4, clientX: pointerX, clientY: pointerY }));
                navigationView.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 73, pointerType: 'mouse', button: 1, buttons: 4, clientX: pointerX + 35, clientY: pointerY }));
                if (!viewCaptured || navigationView.scrollLeft >= scrollBeforePan - 20 || wireframe.querySelector('.task-wireframe-marquee')) throw new Error('Mittlere Maustaste verschob die Ansicht nicht unabhängig vom Auswahlrahmen: ' + JSON.stringify({ captured: viewCaptured, before: scrollBeforePan, after: navigationView.scrollLeft }));
                navigationView.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 73, pointerType: 'mouse', button: 1, buttons: 0, clientX: pointerX + 35, clientY: pointerY }));
                if (viewCaptured) throw new Error('Ansichtsverschiebung gab den Zeiger nicht frei.');
                navigationView.scrollLeft = Math.max(1, (navigationView.scrollWidth - navigationView.clientWidth) / 2);
                const selectedBeforePan = [...wireframe.querySelectorAll('.task-wireframe-element[aria-pressed="true"]')].map((item) => item.getAttribute('data-wireframe-id'));
                activeStage.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ', code: 'Space' }));
                const beforeSpacePan = navigationView.scrollLeft;
                activeStage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 74, pointerType: 'mouse', button: 0, buttons: 1, clientX: pointerX, clientY: pointerY }));
                activeStage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 74, pointerType: 'mouse', button: 0, buttons: 1, clientX: pointerX + 30, clientY: pointerY }));
                activeStage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 74, pointerType: 'mouse', button: 0, buttons: 0, clientX: pointerX + 30, clientY: pointerY }));
                activeStage.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ', code: 'Space' }));
                if (navigationView.scrollLeft >= beforeSpacePan - 20 || wireframe.querySelector('.task-wireframe-marquee') || JSON.stringify(selectedBeforePan) !== JSON.stringify([...wireframe.querySelectorAll('.task-wireframe-element[aria-pressed="true"]')].map((item) => item.getAttribute('data-wireframe-id')))) throw new Error('Leertaste + Ziehen verschob die Ansicht nicht ohne Auswahländerung.');
              } finally {
                navigationView.setPointerCapture = originalViewCapture;
                navigationView.hasPointerCapture = originalViewHasCapture;
                navigationView.releasePointerCapture = originalViewRelease;
              }
              activeShrinkView.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelector('.task-wireframe-view-controls output')?.textContent?.trim() !== '100 %'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelector('.task-wireframe-view-controls output')?.textContent?.trim() !== '100 %') throw new Error('Ansicht kehrte nach direkter Navigation nicht zur Ausgangsstufe zurück.');
              undo.click();
              for (let attempt = 0; attempt < 100 && element.style.fontSize !== ''; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (element.style.fontSize !== '') throw new Error('Stiländerung ließ sich nicht rückgängig machen.');
              redo.click();
              for (let attempt = 0; attempt < 100 && !element.style.fontSize.endsWith('cqw'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!scaledFont(element, activeStage, 960)) throw new Error('Skalierte Schriftgröße ließ sich nicht wiederholen.');
              const textColor = [...wireframe.querySelectorAll('.task-wireframe-color-control')].find((control) => control.textContent?.includes('Textfarbe'))?.querySelector('input[type="checkbox"]');
              if (!(textColor instanceof HTMLInputElement)) throw new Error('Textfarbensteuerung fehlt.');
              textColor.click();
              for (let attempt = 0; attempt < 100 && element.style.color !== 'var(--text)'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (element.style.color !== 'var(--text)') throw new Error('Semantische Textfarbe wurde nicht sichtbar übernommen.');
              const themeBefore = document.documentElement.dataset.theme;
              const computedBefore = getComputedStyle(element).color;
              const themeButton = document.querySelector('.theme-toggle');
              if (!(themeButton instanceof HTMLButtonElement)) throw new Error('Theme-Schalter fehlt.');
              themeButton.click();
              for (let attempt = 0; attempt < 100 && (document.documentElement.dataset.theme === themeBefore || getComputedStyle(element).color === computedBefore || element.style.color !== 'var(--text)'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.documentElement.dataset.theme === themeBefore || getComputedStyle(element).color === computedBefore || element.style.color !== 'var(--text)') throw new Error('Wireframe-Textfarbe folgt dem Themewechsel nicht: ' + JSON.stringify({ themeBefore, themeAfter: document.documentElement.dataset.theme, computedBefore, computedAfter: getComputedStyle(element).color, inlineColor: element.style.color }));
              themeButton.click();
              for (let attempt = 0; attempt < 100 && (document.documentElement.dataset.theme !== themeBefore || getComputedStyle(element).color !== computedBefore); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.documentElement.dataset.theme !== themeBefore || getComputedStyle(element).color !== computedBefore) throw new Error('Wireframe-Textfarbe wurde nach Theme-Rückkehr nicht wiederhergestellt: ' + JSON.stringify({ themeBefore, themeAfter: document.documentElement.dataset.theme, computedBefore, computedAfter: getComputedStyle(element).color }));
              const addEllipse = [...wireframe.querySelectorAll('.task-wireframe-toolbar button')].find((item) => item.textContent?.trim() === 'Ellipse');
              const addLine = [...wireframe.querySelectorAll('.task-wireframe-toolbar button')].find((item) => item.textContent?.trim() === 'Linie');
              if (!(addEllipse instanceof HTMLButtonElement) || !(addLine instanceof HTMLButtonElement)) throw new Error('Formenwerkzeuge fehlen.');
              addEllipse.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-element.kind-ellipse'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const ellipse = wireframe.querySelector('.task-wireframe-element.kind-ellipse');
              if (!(ellipse instanceof HTMLButtonElement) || getComputedStyle(ellipse).borderRadius !== '50%' || ellipse.textContent !== '') throw new Error('Ellipse erschien nicht als editierbare Form.');
              addLine.click();
              for (let attempt = 0; attempt < 100 && (!wireframe.querySelector('.task-wireframe-element.kind-line svg line') || !wireframe.querySelector('select[aria-label="Linienrichtung"]')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const line = wireframe.querySelector('.task-wireframe-element.kind-line');
              const direction = wireframe.querySelector('select[aria-label="Linienrichtung"]');
              const lineSelectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!(line instanceof HTMLButtonElement) || !(direction instanceof HTMLSelectElement) || !lineSelectSetter || !line.querySelector('svg line')) throw new Error('Linie oder Linienrichtung fehlt.');
              lineSelectSetter.call(direction, 'rising'); direction.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && line.querySelector('svg line')?.getAttribute('y1') !== '98'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (line.querySelector('svg line')?.getAttribute('y1') !== '98' || (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} })) !== null) throw new Error('Linienrichtung wurde nicht lokal geändert oder ungefragt gespeichert.');
              line.scrollIntoView({ block: 'center', inline: 'center' });
              const lineBounds = line.getBoundingClientRect();
              const clearPoint = { x: lineBounds.left + lineBounds.width * .1, y: lineBounds.top + lineBounds.height * .5 };
              const strokePoint = { x: lineBounds.left + lineBounds.width * .5, y: lineBounds.top + lineBounds.height * .5 };
              const behindLine = document.elementFromPoint(clearPoint.x, clearPoint.y);
              const onLine = document.elementFromPoint(strokePoint.x, strokePoint.y);
              if (!(behindLine instanceof Element) || !behindLine.closest('.task-wireframe-element.kind-ellipse') || !(onLine instanceof Element) || !onLine.classList.contains('task-wireframe-line-hit')) throw new Error('Linien-Hitfläche verdeckt die darunterliegende Ellipse oder verfehlt den sichtbaren Strich: ' + JSON.stringify({ behind: behindLine?.outerHTML.slice(0, 100), onLine: onLine?.outerHTML.slice(0, 100), bounds: lineBounds.toJSON() }));
              ellipse.focus(); ellipse.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
              line.focus(); line.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
              line.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
              if (wireframe.querySelector('[data-wireframe-inline-editor]')) throw new Error('Formen öffneten irrtümlich einen Inline-Texteditor.');
              const mobileArtboard = [...wireframe.querySelectorAll('.task-wireframe-artboard-switch button')].find((button) => button.textContent?.includes('Mobile'));
              if (!(mobileArtboard instanceof HTMLButtonElement)) throw new Error('Mobile-Wireframe-Auswahl fehlt.');
              mobileArtboard.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-variant-empty'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelector('.task-wireframe-canvas')) throw new Error('Fehlende Mobile-Variante wurde als fertiges Layout dargestellt.');
              const copyArtboard = [...wireframe.querySelectorAll('.task-wireframe-variant-empty button')].find((button) => button.textContent?.includes('Desktop als Ausgangspunkt kopieren'));
              if (!(copyArtboard instanceof HTMLButtonElement)) throw new Error('Startkopie für Mobile fehlt.');
              copyArtboard.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-canvas-wrap[data-artboard="mobile"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-element').length !== 8) throw new Error('Mobile-Startkopie hat die Formen nicht übernommen.');
              const mobileStage = wireframe.querySelector('.task-wireframe-canvas');
              const mobileTitle = [...wireframe.querySelectorAll('.task-wireframe-element')].find((item) => item.textContent?.includes('Geprüfter Entwurf'));
              if (!(mobileStage instanceof HTMLElement) || !(mobileTitle instanceof HTMLElement) || !scaledFont(mobileTitle, mobileStage, 390)) throw new Error('Mobile-Schriftgröße passt nicht zur eigenen Artboard-Breite.');
              const exportButton = wireframe.querySelector('.task-wireframe-export');
              if (!(exportButton instanceof HTMLButtonElement) || exportButton.disabled) throw new Error('PNG-Export für Mobile fehlt.');
              exportButton.click();
              for (let attempt = 0; attempt < 100 && !wireframe.textContent?.includes('Mobile-PNG gespeichert:'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!wireframe.textContent?.includes('Mobile-PNG gespeichert:') || (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} })) !== null) throw new Error('PNG-Export gelang nicht oder speicherte ungefragt die Kartenrevision: ' + JSON.stringify({ notice: wireframe.querySelector('.task-wireframe-notice')?.textContent, error: wireframe.querySelector('.inline-error')?.textContent, disabled: wireframe.querySelector('.task-wireframe-export')?.hasAttribute('disabled') }));

              wireframe.querySelectorAll('.task-wireframe-layers li button')[2]?.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-duplicate'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const duplicate = wireframe.querySelector('.task-wireframe-duplicate');
              if (!(duplicate instanceof HTMLButtonElement) || duplicate.disabled) throw new Error('Wireframe-Duplizieren fehlt für ein ausgewähltes Mobile-Element.');
              duplicate.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== 9; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-element').length !== 9 || wireframe.querySelectorAll('.task-wireframe-element[aria-pressed="true"]').length !== 1) throw new Error('Duplikat wurde nicht als neues ausgewähltes Mobile-Element eingefügt.');
              undo.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== 8; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-element').length !== 8) throw new Error('Duplizieren ließ sich nicht in einem Schritt rückgängig machen.');
              redo.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== 9; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-element').length !== 9) throw new Error('Duplizieren ließ sich nicht wiederholen.');
              undo.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== 8; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const mobileLayer = wireframe.querySelectorAll('.task-wireframe-layers li button')[2];
              if (!(mobileLayer instanceof HTMLButtonElement)) throw new Error('Mobile-Ebene für Tastaturduplikat fehlt.');
              mobileLayer.click();
              for (let attempt = 0; attempt < 100 && mobileLayer.getAttribute('aria-pressed') !== 'true'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (mobileLayer.getAttribute('aria-pressed') !== 'true' || !wireframe.querySelector('.task-wireframe-duplicate')) throw new Error('Mobile-Auswahl für Tastaturduplikat wurde nicht übernommen.');
              mobileLayer.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== 9; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-element').length !== 9) throw new Error('Strg+D duplizierte die ausgewählte Ebene nicht.');
              for (let attempt = 0; attempt < 100 && document.activeElement !== wireframe.querySelector('.task-wireframe-layers li button[aria-pressed="true"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.activeElement !== wireframe.querySelector('.task-wireframe-layers li button[aria-pressed="true"]')) throw new Error('Tastaturfokus folgte dem neuen Duplikat nicht.');
              undo.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== 8; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-element').length !== 8) throw new Error('Tastaturduplikat ließ sich nicht rückgängig machen.');
              wireframe.querySelectorAll('.task-wireframe-layers li button')[2]?.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-geometry input'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const mobileX = wireframe.querySelector('.task-wireframe-geometry input');
              if (!(mobileX instanceof HTMLInputElement)) throw new Error('Mobile-Eigenschaften fehlen.');
              textSetter.call(mobileX, '70'); mobileX.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && mobileX.value !== '70'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (mobileX.value !== '70') throw new Error('Mobile-Koordinate wurde nicht editiert.');
              if ((await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} })) !== null) throw new Error('Mobile-Bearbeitung speicherte den Entwurf vor dem ausdrücklichen Klick.');
              const desktopArtboard = [...wireframe.querySelectorAll('.task-wireframe-artboard-switch button')].find((button) => button.textContent?.includes('Desktop'));
              if (!(desktopArtboard instanceof HTMLButtonElement)) throw new Error('Desktop-Wireframe-Auswahl fehlt.');
              desktopArtboard.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-canvas-wrap[data-artboard="desktop"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              wireframe.querySelectorAll('.task-wireframe-layers li button')[2]?.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelector('.task-wireframe-geometry input')?.value !== '61'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelector('.task-wireframe-geometry input')?.value !== '61') throw new Error('Mobile-Bearbeitung änderte Desktop-Koordinaten.');
              for (let attempt = 0; attempt < 100 && ![...wireframe.querySelectorAll('.task-wireframe-actions button')].some((button) => button.textContent?.includes('Entwurf speichern') && !button.disabled); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const save = [...wireframe.querySelectorAll('.task-wireframe-actions button')].find((button) => button.textContent?.includes('Entwurf speichern'));
              if (!(save instanceof HTMLButtonElement) || save.disabled) throw new Error('Entwurf ist nicht speicherbar.');
              save.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('input[aria-label="Text des ausgewählten Elements"]')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 1));
              const lockedText = wireframe.querySelector('input[aria-label="Text des ausgewählten Elements"]');
              if (!(lockedText instanceof HTMLInputElement) || !lockedText.disabled) throw new Error('Wireframe-Eingabe blieb während Speichern bedienbar.');
              textSetter.call(lockedText, 'Späte Eingabe'); lockedText.dispatchEvent(new Event('input', { bubbles: true }));
              let stored;
              for (let attempt = 0; attempt < 100 && !stored; attempt++) { stored = await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} }); if (!stored) await new Promise((resolve) => setTimeout(resolve, 50)); }
              if (!stored || stored.elements.find((item) => item.id === 'window-title')?.text !== 'Geprüfter Entwurf' || stored.elements.find((item) => item.id === 'window-title')?.x !== 61 || stored.elements.find((item) => item.id === 'window-title')?.width !== 630 || stored.elements.find((item) => item.id === 'window-title')?.style?.fontSize !== 20 || stored.elements.find((item) => item.id === 'window-title')?.style?.textColor !== '@foreground' || stored.elements[2]?.id !== 'window-title' || !stored.elements.some((item) => item.kind === 'ellipse') || !stored.elements.some((item) => item.kind === 'line' && item.lineDirection === 'rising') || !stored.artboards.mobile?.some((item) => item.kind === 'line' && item.lineDirection === 'rising') || stored.artboards.mobile?.find((item) => item.id === 'window-title')?.x !== 70 || stored.artboards.mobile?.find((item) => item.id === 'window-title')?.style?.fontSize !== 20 || stored.approvedRevision !== null) throw new Error('Wireframe-Text, Geometrie, Formen, getrennte Mobile-Variante oder Freigabezustand wurden nicht gespeichert.');
              const approve = [...wireframe.querySelectorAll('.task-wireframe-actions button')].find((button) => button.textContent?.includes('Für Agenten freigeben'));
              for (let attempt = 0; attempt < 100 && approve?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(approve instanceof HTMLButtonElement) || approve.disabled) throw new Error('Gespeicherter Entwurf ist nicht freigebbar.');
              approve.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} }))?.approvedRevision !== 1; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} }))?.approvedRevision !== 1 || (await window.studio.snapshot(${JSON.stringify(smokeProject.id)})).sessions.length !== beforeSessions) throw new Error('Entwurfsfreigabe startete einen Agenten oder blieb nicht gespeichert.');
              const approvedElement = [...wireframe.querySelectorAll('.task-wireframe-element')].find((item) => item.textContent?.includes('Geprüfter Entwurf'));
              if (!(approvedElement instanceof HTMLButtonElement)) throw new Error('Freigegebenes Element fehlt.');
              approvedElement.focus(); approvedElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
              for (let attempt = 0; attempt < 100 && wireframe.querySelector('.task-wireframe-geometry input')?.value !== '60'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelector('.task-wireframe-geometry input')?.value !== '60') throw new Error('Freigegebener Entwurf ließ sich nicht lokal ändern.');
              undo.click();
              for (let attempt = 0; attempt < 100 && (wireframe.querySelector('.task-wireframe-geometry input')?.value !== '61' || !save.disabled); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelector('.task-wireframe-geometry input')?.value !== '61' || !save.disabled || !wireframe.querySelector('.task-wireframe-actions span')?.textContent?.includes('Version 1 · freigegeben') || (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} }))?.approvedRevision !== 1) throw new Error('Rückgängig auf gespeicherten Stand ließ Freigabe oder Speicherzustand nicht unverändert.');
              const library = wireframe.querySelector('.task-wireframe-components');
              if (!(library instanceof HTMLDetailsElement)) throw new Error('Projekt-Bausteinbibliothek fehlt im Wireframe-Editor.');
              library.open = true;
              const componentName = library.querySelector('input[aria-label="Name des Designbausteins"]');
              const componentSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!(componentName instanceof HTMLInputElement) || !componentSetter) throw new Error('Bausteinname fehlt.');
              componentSetter.call(componentName, 'Geprüfter Kopf');
              componentName.dispatchEvent(new Event('input', { bubbles: true }));
              const saveComponent = [...library.querySelectorAll('button')].find((item) => item.textContent?.includes('Auswahl speichern'));
              for (let attempt = 0; attempt < 100 && saveComponent?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(saveComponent instanceof HTMLButtonElement) || saveComponent.disabled) throw new Error('Ausgewähltes Element lässt sich nicht als Baustein speichern.');
              saveComponent.click();
              let savedComponent;
              for (let attempt = 0; attempt < 100 && !savedComponent; attempt++) { savedComponent = (await window.studio.listWireframeComponents(${JSON.stringify(smokeProject.id)}))[0]; if (!savedComponent) await new Promise((resolve) => setTimeout(resolve, 50)); }
              if (savedComponent?.name !== 'Geprüfter Kopf' || savedComponent?.elements.length !== 1 || (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} }))?.approvedRevision !== 1) throw new Error('Baustein-Speicherung änderte den Kartenentwurf oder bewahrte die Auswahl nicht.');
              const componentMobile = [...wireframe.querySelectorAll('.task-wireframe-artboard-switch button')].find((item) => item.textContent?.includes('Mobile'));
              if (!(componentMobile instanceof HTMLButtonElement)) throw new Error('Mobile-Zeichenfläche für Baustein fehlt.');
              componentMobile.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-canvas-wrap[data-artboard="mobile"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const insertComponent = [...library.querySelectorAll('button')].find((item) => item.textContent?.includes('Einfügen'));
              for (let attempt = 0; attempt < 100 && insertComponent?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(insertComponent instanceof HTMLButtonElement) || insertComponent.disabled) throw new Error('Baustein lässt sich auf Mobile nicht einfügen.');
              insertComponent.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== 9; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-element').length !== 9 || !wireframe.querySelector('.task-wireframe-element[aria-pressed="true"]')) throw new Error('Baustein-Kopie wurde nicht sichtbar eingefügt und ausgewählt.');
              undo.click();
              for (let attempt = 0; attempt < 100 && wireframe.querySelectorAll('.task-wireframe-element').length !== 8; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (wireframe.querySelectorAll('.task-wireframe-element').length !== 8 || (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} }))?.approvedRevision !== 1) throw new Error('Baustein-Einfügen ließ sich nicht rückgängig machen oder änderte Freigabe.');
              desktopArtboard.click();
              for (let attempt = 0; attempt < 100 && !wireframe.querySelector('.task-wireframe-canvas-wrap[data-artboard="desktop"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const liveDesignMode = [...document.querySelectorAll('.design-workspace-modes button')].find((item) => item.textContent?.includes('Laufende App prüfen'));
              if (!(liveDesignMode instanceof HTMLButtonElement)) throw new Error('Live-Design-Ansicht fehlt.');
              liveDesignMode.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.design-inspection-tools')?.hasAttribute('hidden'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.design-inspection-toolbar'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const input = document.querySelector('.design-inspection-toolbar input');
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!input || !setter) throw new Error('Design-URL-Eingabe fehlt.');
              setter.call(input, ${JSON.stringify(qaUrl)});
              input.dispatchEvent(new Event('input', { bubbles: true }));
              const button = document.querySelector('.design-inspection-toolbar button[type="submit"]');
              for (let attempt = 0; attempt < 100 && button?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!button || button.disabled) throw new Error('Design-Vorschau-Knopf blieb gesperrt.');
              button.click();
              for (let attempt = 0; attempt < 300 && !(await window.studio.designInspectionState()).ready; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.designInspectionState()).ready) throw new Error('Lokale Design-Vorschau wurde nicht geladen: ' + document.querySelector('.design-inspection .inline-error')?.textContent);
              document.querySelector('.design-inspection-viewport')?.scrollIntoView({ block: 'center' });
              await new Promise((resolve) => setTimeout(resolve, 150));
              const visibleRect = document.querySelector('.design-inspection-viewport')?.getBoundingClientRect();
              if (!visibleRect) throw new Error('Sichtbare Design-Vorschau fehlt.');
              await window.studio.designInspectionSetBounds({ x: visibleRect.x, y: visibleRect.y, width: visibleRect.width, height: visibleRect.height });
              return true;
            })()`);
            if (!designInspector!.smokeLayoutState().attached) {
              const observation = await smokeWindow.webContents.executeJavaScript(`(() => ({ rect: document.querySelector('.design-inspection-viewport')?.getBoundingClientRect().toJSON(), window: [innerWidth, innerHeight], scrollTop: document.querySelector('.view-area')?.scrollTop, hidden: document.querySelector('.design-inspection-tools')?.hasAttribute('hidden') }))()`);
              throw new Error('Geladene native Design-Vorschau wurde vor dem Fokuswechsel nicht eingeblendet: ' + JSON.stringify({ observation, native: designInspector!.smokeLayoutState() }));
            }
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const draftTab = [...document.querySelectorAll('.design-workspace-modes button')].find((button) => button.textContent?.trim() === 'Entwurf');
              if (!(draftTab instanceof HTMLButtonElement)) throw new Error('Entwurfs-Tab fehlt vor dem Fokuswechsel.');
              draftTab.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.design-workspace-draft[hidden]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.design-workspace-draft[hidden]')) throw new Error('Wireframe blieb vor dem Fokuswechsel verborgen.');
              const liveFocus = document.querySelector('.task-wireframe-focus-toggle');
              for (let attempt = 0; attempt < 100 && liveFocus?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(liveFocus instanceof HTMLButtonElement) || liveFocus.disabled) throw new Error('Arbeitsmodus blieb bei geladener Live-Vorschau gesperrt.');
              liveFocus.focus(); liveFocus.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.design-inspection-tools[hidden]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              for (let attempt = 0; attempt < 100 && !(document.activeElement instanceof HTMLButtonElement && document.activeElement.matches('.task-wireframe-focus-toggle[aria-pressed="true"]')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.designInspectionState()).ready || !document.querySelector('.design-inspection.wireframe-focus') || !(document.activeElement instanceof HTMLButtonElement && document.activeElement.matches('.task-wireframe-focus-toggle[aria-pressed="true"]'))) throw new Error('Fokusmodus schloss die Live-Vorschau oder verlor den Rückweg: ' + JSON.stringify({ ready: (await window.studio.designInspectionState()).ready, focusMode: Boolean(document.querySelector('.design-inspection.wireframe-focus')), focused: document.activeElement?.outerHTML?.slice(0, 200), toggleConnected: liveFocus.isConnected, hidden: Boolean(document.querySelector('.design-inspection-tools[hidden]')) }));
              await new Promise((resolve) => setTimeout(resolve, 100));
              return true;
            })()`);
            if (designInspector!.smokeLayoutState().attached) throw new Error('Native Live-Vorschau verdeckt die Wireframe-Arbeitsfläche im Fokusmodus.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const liveFocus = document.querySelector('.task-wireframe-focus-toggle');
              if (!(liveFocus instanceof HTMLButtonElement)) throw new Error('Arbeitsmodus-Rückweg fehlt.');
              liveFocus.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.design-inspection-tools[hidden]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.designInspectionState()).ready || !document.querySelector('.design-inspection-toolbar')) throw new Error('Live-Vorschau wurde beim Rückweg nicht erhalten.');
              document.querySelector('.design-inspection-viewport')?.scrollIntoView({ block: 'center' });
              await new Promise((resolve) => setTimeout(resolve, 150));
              const restoredRect = document.querySelector('.design-inspection-viewport')?.getBoundingClientRect();
              if (!restoredRect) throw new Error('Zurückgekehrte Design-Vorschau fehlt.');
              await window.studio.designInspectionSetBounds({ x: restoredRect.x, y: restoredRect.y, width: restoredRect.width, height: restoredRect.height });
              return true;
            })()`);
            if (!designInspector!.smokeLayoutState().attached) throw new Error('Native Live-Vorschau wurde nach dem Fokusmodus nicht wieder eingeblendet: ' + JSON.stringify(designInspector!.smokeLayoutState()));
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const pick = [...document.querySelectorAll('.design-inspection-toolbar button')].find((item) => item.textContent?.includes('Element auswählen'));
              for (let attempt = 0; attempt < 100 && pick?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!pick || pick.disabled) throw new Error('Design-Auswahl blieb gesperrt.');
              pick.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.designInspectionState()).armed; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.designInspectionState()).armed) throw new Error('Design-Auswahl wurde nicht aktiviert: ' + JSON.stringify({ state: await window.studio.designInspectionState(), rect: document.querySelector('.design-inspection-viewport')?.getBoundingClientRect().toJSON(), error: document.querySelector('.design-inspection .inline-error')?.textContent }));
              return true;
            })()`);
            const wireframeContext = approvedCardWireframeContext(smokeStore, { projectId: smokeProject.id, cardId: smokeCard.id });
            if (!wireframeContext.includes('Geprüfter Entwurf') || !wireframeContext.includes('"fontSize":20') || !wireframeContext.includes('"lineDirection":"rising"') || !wireframeContext.includes('"kind":"ellipse"')) throw new Error('Freigegebener Wireframe-Kontext mit Gestaltung und Formen fehlt für den nächsten Agentenstart.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const draftTab = [...document.querySelectorAll('.design-workspace-modes button')].find((button) => button.textContent?.trim() === 'Entwurf');
              if (!(draftTab instanceof HTMLButtonElement)) throw new Error('Entwurfs-Tab fehlt für die Interaktionsprüfung.');
              draftTab.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.design-workspace-draft[hidden]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.design-workspace-draft[hidden]')) throw new Error('Interaktionsentwurf blieb während der Prüfung verborgen.');
              const editor = document.querySelector('.task-wireframe');
              const add = [...(editor?.querySelectorAll('.wireframe-interaction button') ?? [])].find((item) => item.textContent?.includes('Klick → Fläche anlegen'));
              if (!(add instanceof HTMLButtonElement) || add.disabled) throw new Error('Interaktionseditor fehlt oder hat keine gültigen Ziele.');
              add.click();
              for (let attempt = 0; attempt < 100 && !editor?.querySelector('.wireframe-interaction-preview'); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              const preview = editor?.querySelector('.wireframe-interaction-preview');
              const trigger = preview?.querySelector('button');
              const panel = preview?.querySelector('.wireframe-interaction-panel');
              if (!(trigger instanceof HTMLButtonElement) || !(panel instanceof HTMLElement)) throw new Error('Interaktionsvorschau fehlt.');
              trigger.click();
              for (let attempt = 0; attempt < 100 && (!panel.classList.contains('is-open') || document.activeElement !== panel); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (!panel.classList.contains('is-open') || document.activeElement !== panel) throw new Error('Klick öffnete die Vorschau nicht mit Fokus auf der Fläche.');
              panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              for (let attempt = 0; attempt < 100 && (panel.classList.contains('is-open') || document.activeElement !== trigger); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (panel.classList.contains('is-open') || document.activeElement !== trigger) throw new Error('Escape schloss die Fläche nicht mit Fokusrückgabe.');
              const reduced = editor?.querySelector('.wireframe-interaction-reduced input');
              if (!(reduced instanceof HTMLInputElement)) throw new Error('Reduzierte Bewegung fehlt.');
              reduced.click();
              for (let attempt = 0; attempt < 100 && preview.style.getPropertyValue('--interaction-duration') !== '0ms'; attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (preview.style.getPropertyValue('--interaction-duration') !== '0ms') throw new Error('Reduzierte Vorschau hat keine 0-ms-Dauer.');
              const addMidpoint = [...(editor?.querySelectorAll('.wireframe-interaction button') ?? [])].find((item) => item.textContent?.includes('Zwischenpunkt hinzufügen'));
              if (!(addMidpoint instanceof HTMLButtonElement)) throw new Error('Bearbeitbarer Zwischenpunkt fehlt.');
              addMidpoint.click();
              for (let attempt = 0; attempt < 100 && !panel.classList.contains('has-midpoint'); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (!panel.classList.contains('at-50') || !editor?.querySelector('.wireframe-interaction-timeline-legend')?.textContent?.includes('120 ms')) throw new Error('Zwischenpunkt erschien nicht auf der Zeitspur.');
              const midpointSelect = editor?.querySelector('select[aria-label="Zwischenpunkt Zeitpunkt"]');
              const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!(midpointSelect instanceof HTMLSelectElement) || !setSelect) throw new Error('Zwischenpunkt-Zeitwahl fehlt.');
              setSelect.call(midpointSelect, '75'); midpointSelect.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !panel.classList.contains('at-75'); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (!panel.classList.contains('at-75') || !editor?.querySelector('.wireframe-interaction-timeline-legend')?.textContent?.includes('180 ms')) throw new Error('Zwischenpunkt-Zeit wurde nicht übernommen.');
              reduced.click();
              for (let attempt = 0; attempt < 100 && preview.style.getPropertyValue('--interaction-duration') !== '240ms'; attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              trigger.click();
              for (let attempt = 0; attempt < 100 && !panel.classList.contains('is-open'); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (!getComputedStyle(panel).animationName.includes('wireframe-enter-three-quarter')) throw new Error('Zwischenpunkt wird nicht animiert.');
              panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              for (let attempt = 0; attempt < 100 && panel.classList.contains('is-open'); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if ((await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} }))?.interaction) throw new Error('Interaktion wurde ohne Speichern persistiert.');
              const save = [...(editor?.querySelectorAll('.task-wireframe-actions button') ?? [])].find((item) => item.textContent?.includes('Entwurf speichern'));
              if (!(save instanceof HTMLButtonElement) || save.disabled) throw new Error('Interaktion konnte nicht gespeichert werden.');
              save.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} }))?.revision !== 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              const stored = await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} });
              if (stored?.revision !== 2 || stored.approvedRevision !== null || stored.interaction?.durationMs !== 240 || stored.interaction?.midpoint?.atPercent !== 75) throw new Error('Interaktion wurde nicht als neue unfreigegebene Revision gespeichert.');
              return true;
            })()`);
            if (approvedCardWireframeContext(smokeStore, { projectId: smokeProject.id, cardId: smokeCard.id })) throw new Error('Interaktionsänderung gab sich vorzeitig an Agenten weiter.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const editor = document.querySelector('.task-wireframe');
              const approve = [...(editor?.querySelectorAll('.task-wireframe-actions button') ?? [])].find((item) => item.textContent?.includes('Für Agenten freigeben'));
              for (let attempt = 0; attempt < 100 && approve?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (!(approve instanceof HTMLButtonElement) || approve.disabled) throw new Error('Interaktionsrevision konnte nicht freigegeben werden.');
              approve.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} }))?.approvedRevision !== 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              const reload = editor?.querySelector('button[aria-label="Gespeicherten Entwurf neu laden"]');
              if (!(reload instanceof HTMLButtonElement)) throw new Error('Interaktion kann nicht neu geladen werden.');
              reload.click();
              for (let attempt = 0; attempt < 100 && !editor?.querySelector('.wireframe-interaction-fields'); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (!editor?.querySelector('.wireframe-interaction-fields')) throw new Error('Interaktion erschien nach Neuladen nicht.');
              return true;
            })()`);
            if (!approvedCardWireframeContext(smokeStore, { projectId: smokeProject.id, cardId: smokeCard.id }).includes('"midpoint":{"atPercent":75')) throw new Error('Freigegebener Zwischenpunkt fehlt im Agentenkontext.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              for (let attempt = 0; attempt < 100 && !document.querySelector('.task-wireframe select[aria-label="Interaktion Auslösung"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              const editor = document.querySelector('.task-wireframe');
              const mode = editor?.querySelector('select[aria-label="Interaktion Auslösung"]');
              const preview = editor?.querySelector('.wireframe-interaction-preview');
              const trigger = preview?.querySelector('button');
              const panel = preview?.querySelector('.wireframe-interaction-panel');
              const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!(mode instanceof HTMLSelectElement) || !(preview instanceof HTMLElement) || !(trigger instanceof HTMLButtonElement) || !(panel instanceof HTMLElement) || !setSelect) throw new Error('Interaktions-Auswahl oder Vorschau fehlt.');
              setSelect.call(mode, 'hover'); mode.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && (editor?.querySelector('select[aria-label="Interaktion Auslösung"]')?.value !== 'hover' || !editor?.querySelector('.wireframe-interaction-track-label')?.textContent?.includes('Zeigerkontakt')); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (editor?.querySelector('select[aria-label="Interaktion Auslösung"]')?.value !== 'hover' || !editor?.querySelector('.wireframe-interaction-track-label')?.textContent?.includes('Zeigerkontakt')) throw new Error('Hover-Modus wurde nicht übernommen.');
              trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
              for (let attempt = 0; attempt < 100 && (!panel.classList.contains('is-open') || document.activeElement !== panel); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (!panel.classList.contains('is-open') || document.activeElement !== panel) throw new Error('Zeigerkontakt öffnete die Fläche nicht mit Panel-Fokus.');
              preview.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }));
              for (let attempt = 0; attempt < 100 && (panel.classList.contains('is-open') || document.activeElement !== trigger); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (panel.classList.contains('is-open') || document.activeElement !== trigger) throw new Error('Verlassen der Hover-Vorschau schloss die Fläche nicht mit Fokusrückgabe.');
              setSelect.call(mode, 'focus'); mode.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && (editor?.querySelector('select[aria-label="Interaktion Auslösung"]')?.value !== 'focus' || !editor?.querySelector('.wireframe-interaction-track-label')?.textContent?.includes('Fokus')); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (editor?.querySelector('select[aria-label="Interaktion Auslösung"]')?.value !== 'focus' || !editor?.querySelector('.wireframe-interaction-track-label')?.textContent?.includes('Fokus')) throw new Error('Fokus-Modus wurde nicht übernommen.');
              const outside = mode;
              outside.focus(); trigger.focus();
              // Hidden Electron smoke windows can update activeElement without firing focusin.
              // Deliver the browser event that React uses for the focus trigger.
              trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: outside }));
              for (let attempt = 0; attempt < 100 && (!panel.classList.contains('is-open') || document.activeElement !== panel); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (!panel.classList.contains('is-open') || document.activeElement !== panel) throw new Error('Tastaturfokus öffnete die Fläche nicht: ' + JSON.stringify({ mode: mode.value, track: editor?.querySelector('.wireframe-interaction-track-label')?.textContent, active: document.activeElement?.outerHTML.slice(0, 230), panelOpen: panel.classList.contains('is-open') }));
              outside.focus();
              panel.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
              for (let attempt = 0; attempt < 100 && panel.classList.contains('is-open'); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (panel.classList.contains('is-open') || document.activeElement !== outside) throw new Error('Tab aus der Fokus-Vorschau erzeugte eine Fokusfalle.');
              trigger.focus(); trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: outside }));
              for (let attempt = 0; attempt < 100 && document.activeElement !== panel; attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              for (let attempt = 0; attempt < 100 && (panel.classList.contains('is-open') || document.activeElement !== trigger); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
              if (panel.classList.contains('is-open') || document.activeElement !== trigger) throw new Error('Escape gab Fokus nicht zurück oder öffnete die Fläche erneut.');
              trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: panel }));
              await new Promise((resolve) => setTimeout(resolve, 100));
              if (panel.classList.contains('is-open')) throw new Error('Fokus-Auslöser öffnete nach Escape sofort wieder.');
              const stored = await window.studio.cardWireframe({ projectId: ${JSON.stringify(smokeProject.id)}, cardId: ${JSON.stringify(smokeCard.id)} });
              if (stored?.revision !== 2 || stored.interaction?.trigger !== 'click') throw new Error('Trigger-Wechsel überschrieb die freigegebene Click-Fassung vor dem Speichern.');
              return true;
            })()`);
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const previewTab = [...document.querySelectorAll('.design-workspace-modes button')].find((button) => button.textContent?.includes('Laufende App prüfen'));
              if (!(previewTab instanceof HTMLButtonElement)) throw new Error('Live-Vorschau-Tab fehlt nach der Interaktionsbearbeitung.');
              previewTab.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.design-inspection-tools[hidden]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.design-inspection-tools[hidden]')) throw new Error('Live-Vorschau blieb für die Design-Auswahl verborgen.');
              return true;
            })()`);
            await designInspector!.smokeClick('#design-smoke-target');
            let saved = false;
            for (let attempt = 0; attempt < 100; attempt++) {
              const items = designSelections(smokeStore, smokeProject.id);
              if (items[0]?.selector.includes('#design-smoke-target') && items[0]?.styles.color && items[0]?.tokens.some((token) => token.name === '--smoke-ink')) { saved = true; break; }
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            if (!saved) throw new Error('Design-Klick speicherte Selektor, berechneten Stil oder CSS-Variable nicht.');
            const visible = await smokeWindow.webContents.executeJavaScript(`(async () => {
              for (let attempt = 0; attempt < 100 && !document.querySelector('.design-inspection-evidence')?.textContent?.includes('#design-smoke-target'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              return document.querySelector('.design-inspection-evidence')?.textContent?.includes('#design-smoke-target') && document.querySelector('.design-inspection-evidence')?.textContent?.includes('rgb(');
            })()`);
            if (!visible) throw new Error('Design-Auswahl erschien nicht sichtbar in der App.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const evidence = document.querySelector('.design-inspection-evidence li');
              const entry = evidence?.querySelector('.design-voice-entry button');
              if (!entry || entry.disabled) throw new Error('Design-Wunsch ist nicht bedienbar.');
              const before = (await window.studio.snapshot(${JSON.stringify(smokeProject.id)})).cards.length;
              const beforeSessions = (await window.studio.snapshot(${JSON.stringify(smokeProject.id)})).sessions.map((item) => item.id).sort();
              entry.click();
              for (let attempt = 0; attempt < 100 && !evidence?.querySelector('.design-voice-task'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              let form = evidence?.querySelector('.design-voice-task');
              if (!form?.textContent?.includes('Wunsch aufnehmen') || !form.textContent.includes('Quelle: http://127.0.0.1:')) throw new Error('Design-Entwurf zeigt Aufnahme oder Quelle nicht.');
              [...form.querySelectorAll('button')].find((item) => item.textContent?.includes('Verwerfen'))?.click();
              for (let attempt = 0; attempt < 100 && evidence?.querySelector('.design-voice-task'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (evidence?.querySelector('.design-voice-task') || (await window.studio.snapshot(${JSON.stringify(smokeProject.id)})).cards.length !== before) throw new Error('Verworfener Design-Entwurf speicherte eine Karte.');
              entry.click();
              for (let attempt = 0; attempt < 100 && !evidence?.querySelector('.design-voice-task'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              form = evidence?.querySelector('.design-voice-task');
              const save = form?.querySelector('button[type="submit"]');
              if (!save?.disabled || (await window.studio.snapshot(${JSON.stringify(smokeProject.id)})).cards.length !== before) throw new Error('Design-Wunsch wurde vor Bestätigung gespeichert.');
              const textarea = form.querySelector('textarea');
              const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (!textarea || !setter) throw new Error('Design-Transkript ist nicht editierbar.');
              setter.call(textarea, 'Make the selected button easier to see.');
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && save.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (save.disabled) throw new Error('Design-Wunsch blieb nach editierbarem Text gesperrt.');
              form.requestSubmit();
              for (let attempt = 0; attempt < 100 && !form.textContent?.includes('Karte mit diesem Design-Beleg gespeichert'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!form.textContent?.includes('Karte mit diesem Design-Beleg gespeichert')) throw new Error('Design-Karte wurde nicht sichtbar bestätigt: ' + form.textContent);
              const snapshot = await window.studio.snapshot(${JSON.stringify(smokeProject.id)});
              const card = snapshot.cards.find((item) => item.description === 'Make the selected button easier to see.');
              if (!card || snapshot.cards.length !== before + 1 || JSON.stringify(snapshot.sessions.map((item) => item.id).sort()) !== JSON.stringify(beforeSessions)) throw new Error('Design-Karte fehlte oder startete einen Agenten.');
              const refs = await window.studio.cardContextReferences(card.id);
              if (refs.length !== 1 || refs[0].kind !== 'design' || !refs[0].available) throw new Error('Design-Karte hat keinen überprüften Beleg.');
              return true;
            })()`);
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const evidence = document.querySelector('.design-inspection-evidence li');
              const check = [...(evidence?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('Kontrast und Zielgröße prüfen'));
              if (!check || check.disabled) throw new Error('Die freiwillige Elementprüfung ist nicht bedienbar.');
              check.click();
              for (let attempt = 0; attempt < 100 && !evidence?.querySelector('.design-a11y-result') && !evidence?.querySelector('.inline-error'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const report = evidence?.querySelector('.design-a11y-result');
              if (!report?.textContent?.includes('Textkontrast') || !report.textContent.includes('Interaktives Ziel') || !report.textContent.includes('CSS-px') || !report.textContent.includes('4,5:1')) throw new Error('Live-Elementmessung fehlt: ' + (evidence?.textContent ?? '').slice(-600));
              return true;
            })()`);
            if (designSelections(smokeStore, smokeProject.id).length !== 2) throw new Error('Die lesende Elementprüfung veränderte gespeicherte Belege.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              document.querySelector('.design-inspection-selector summary')?.click();
              const field = document.querySelector('.design-inspection-selector input');
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!field || !setter) throw new Error('CSS-Selektor-Eingabe fehlt.');
              setter.call(field, '#design-smoke-target');
              field.dispatchEvent(new Event('input', { bubbles: true }));
              const button = document.querySelector('.design-inspection-selector button');
              for (let attempt = 0; attempt < 100 && button?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!button || button.disabled) throw new Error('Tastatur-Auswahl blieb gesperrt.');
              button.click();
              return true;
            })()`);
            for (let attempt = 0; attempt < 100 && designSelections(smokeStore, smokeProject.id).length < 3; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
            if (designSelections(smokeStore, smokeProject.id).length !== 3) throw new Error('CSS-Selektor-Auswahl speicherte keinen weiteren Beleg.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              document.querySelector('.theme-tokens-head button')?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.theme-tokens-list button:last-child'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const item = [...document.querySelectorAll('.theme-tokens-list li')].find((node) => node.textContent?.includes('--smoke-ink'));
              if (!item) throw new Error('Versionierter Smoke-Token fehlt im sichtbaren Design-Panel.');
              [...item.querySelectorAll('button')].find((button) => button.textContent?.includes('Testen'))?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.theme-tokens-preview input'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const field = document.querySelector('.theme-tokens-preview input');
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!field || !setter) throw new Error('Theme-Playground-Eingabe fehlt.');
              setter.call(field, '#aabbcc');
              field.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && document.querySelector('.theme-tokens-preview button[type="submit"]')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              document.querySelector('.theme-tokens-preview button[type="submit"]')?.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.designInspectionState()).themePreview; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.designInspectionState()).themePreview?.value !== '#aabbcc') throw new Error('Theme-Vorschau wurde nicht angewendet: ' + document.querySelector('.theme-tokens-preview')?.textContent);
              return true;
            })()`);
            const changedTheme = await designInspector!.smokeThemeValue('#design-smoke-target', '--smoke-ink');
            if (changedTheme.inline !== '#aabbcc' || changedTheme.computed !== 'rgb(170, 187, 204)') throw new Error('Theme-Vorschau änderte den berechneten Stil nicht: ' + JSON.stringify(changedTheme));
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              [...document.querySelectorAll('.theme-tokens-preview button')].find((button) => button.textContent?.includes('Zurücksetzen'))?.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.designInspectionState()).themePreview; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.designInspectionState()).themePreview) throw new Error('Theme-Vorschau blieb nach Zurücksetzen aktiv.');
              return true;
            })()`);
            const resetTheme = await designInspector!.smokeThemeValue('#design-smoke-target', '--smoke-ink');
            if (resetTheme.inline || resetTheme.computed !== 'rgb(36, 59, 50)') throw new Error('Theme-Vorschau wurde nicht rückgängig gemacht: ' + JSON.stringify(resetTheme));
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const panel = document.querySelector('.design-state-routes');
              const projectId = ${JSON.stringify(smokeProject.id)};
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!panel || !setter) throw new Error('Design-Zustandsrouten fehlen.');
              for (let attempt = 0; attempt < 100 && !panel.querySelector('form input'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const field = panel.querySelector('form input');
              const save = [...panel.querySelectorAll('form button')].find((item) => item.textContent?.includes('Route speichern'));
              if (!field || !save) throw new Error('Design-Zustandsroute ist nicht editierbar.');
              setter.call(field, ${JSON.stringify(qaUrl)}); field.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && save.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (save.disabled) throw new Error('Normal-Route blieb unbestätigbar.');
              save.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.designStateRoutes(projectId)).some((item) => item.kind === 'normal'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.designStateRoutes(projectId)).some((item) => item.kind === 'normal')) throw new Error('Normal-Route wurde nicht gespeichert.');
              const empty = [...panel.querySelectorAll('.design-state-routes-tabs button')].find((item) => item.textContent?.includes('Empty'));
              if (!empty) throw new Error('Empty-Auswahl fehlt.');
              empty.click();
              for (let attempt = 0; attempt < 100 && !panel.querySelector('form label')?.textContent?.includes('Empty'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const emptyUrl = ${JSON.stringify(qaUrl + '?state=empty')};
              setter.call(field, emptyUrl); field.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && save.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (save.disabled) throw new Error('Empty-Route blieb unbestätigbar.');
              save.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.designStateRoutes(projectId)).some((item) => item.kind === 'empty'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const routes = await window.studio.designStateRoutes(projectId);
              if (routes.length !== 2 || routes.find((item) => item.kind === 'empty')?.url !== emptyUrl) throw new Error('Designzustände wurden nicht getrennt gespeichert.');
              const open = [...panel.querySelectorAll('form button')].find((item) => item.textContent?.includes('Gespeicherte Route öffnen'));
              for (let attempt = 0; attempt < 100 && open?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!open || open.disabled) throw new Error('Gespeicherte Empty-Route blieb unöffnbar.');
              open.click();
              for (let attempt = 0; attempt < 100 && !panel.textContent?.includes('Empty geöffnet'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!panel.textContent?.includes('Empty geöffnet') || document.querySelector('.design-inspection-toolbar input')?.value !== emptyUrl) throw new Error('Gespeicherte Empty-Route wurde nicht sichtbar geöffnet: ' + JSON.stringify({ notice: panel.textContent?.slice(-500), toolbarUrl: document.querySelector('.design-inspection-toolbar input')?.value, expected: emptyUrl, preview: document.querySelector('.design-inspection-state')?.textContent }));
              return true;
            })()`);
            if (stateRouteHits !== 1) throw new Error('Empty-Route wurde nicht genau einmal vom lokalen Server geladen: ' + stateRouteHits);
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const canvas = document.querySelector('.design-viewport-canvas');
              const button = [...(canvas?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('Größen aufnehmen'));
              if (!canvas || !button || button.disabled || canvas.querySelector('img')) throw new Error('Design-Größenaufnahme ist nicht ausdrücklich startbar.');
              button.click();
              for (let attempt = 0; attempt < 800 && canvas.querySelectorAll('img').length !== 3 && !canvas.querySelector('.inline-error'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const images = [...canvas.querySelectorAll('img')];
              if (images.length !== 3 || !canvas.textContent?.includes('1280 × 800 px') || !canvas.textContent?.includes('768 × 1024 px') || !canvas.textContent?.includes('390 × 844 px') || !canvas.textContent?.includes(${JSON.stringify(qaUrl)})) throw new Error('Drei Design-Größen fehlen: ' + canvas.textContent?.slice(0, 800));
              await Promise.all(images.map((image) => image.decode()));
              if (!images.every((image) => image.naturalWidth > 0)) throw new Error('Design-Aufnahmen sind keine lesbaren Bilder.');
              [...canvas.querySelectorAll('button')].find((item) => item.textContent?.includes('Aufnahmen schließen'))?.click();
              for (let attempt = 0; attempt < 100 && canvas.querySelector('img'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (canvas.querySelector('img') || document.activeElement !== button) throw new Error('Design-Aufnahmen blieben nach Schließen sichtbar oder der Fokus ging verloren.');
              return true;
            })()`);
            if (readFileSync(join(smokeDataDirectory!, 'src', 'theme.css'), 'utf8') !== ':root { --smoke-ink: #243b32; }\n' || designSelections(smokeStore, smokeProject.id).length !== 3) throw new Error('Theme-Vorschau änderte Quelldatei oder gespeicherte Auswahl.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              document.querySelector('.theme-tokens-preview button[type="submit"]')?.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.designInspectionState()).themePreview?.value !== '#aabbcc'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const reviewButton = [...document.querySelectorAll('.theme-tokens-preview button')].find((button) => button.textContent?.includes('Dateiänderung prüfen'));
              for (let attempt = 0; attempt < 100 && reviewButton?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              reviewButton?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.theme-tokens-edit-review'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.theme-tokens-edit-review')?.textContent?.includes('--smoke-ink: #aabbcc')) throw new Error('CSS-Änderungsdiff fehlt.');
              return true;
            })()`);
            if (readFileSync(join(smokeDataDirectory!, 'src', 'theme.css'), 'utf8') !== ':root { --smoke-ink: #243b32; }\n') throw new Error('CSS-Datei wurde schon bei der Diff-Prüfung geschrieben.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              [...document.querySelectorAll('.theme-tokens-edit-review button')].find((button) => button.textContent?.includes('In CSS übernehmen'))?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.theme-tokens-edit-result'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.theme-tokens-edit-result')?.textContent?.includes('#aabbcc')) throw new Error('CSS-Übernahme wurde nicht sichtbar bestätigt: ' + document.querySelector('.theme-tokens .inline-error')?.textContent);
              for (let attempt = 0; attempt < 100 && document.querySelector('.theme-tokens-edit-result button')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              document.querySelector('.theme-tokens-edit-result button')?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.theme-tokens-edit-review')?.textContent?.includes('#243b32'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.theme-tokens-edit-review')?.textContent?.includes('#243b32')) throw new Error('Rücknahme-Diff fehlt: ' + document.querySelector('.theme-tokens .inline-error')?.textContent);
              return true;
            })()`);
            if (readFileSync(join(smokeDataDirectory!, 'src', 'theme.css'), 'utf8') !== ':root { --smoke-ink: #aabbcc; }\n') throw new Error('CSS-Datei wurde vor Rücknahmebestätigung verändert.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              [...document.querySelectorAll('.theme-tokens-edit-review button')].find((button) => button.textContent?.includes('Rücknahme bestätigen'))?.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.theme-tokens-edit-result'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.theme-tokens-edit-result') || !document.querySelector('.theme-tokens')?.textContent?.includes('zurückgenommen')) throw new Error('Rücknahme wurde nicht sichtbar bestätigt: ' + document.querySelector('.theme-tokens .inline-error')?.textContent);
              return true;
            })()`);
            if (readFileSync(join(smokeDataDirectory!, 'src', 'theme.css'), 'utf8') !== ':root { --smoke-ink: #243b32; }\n') throw new Error('CSS-Rücknahme stellte die Quelldatei nicht wieder her.');
            await smokeWindow.webContents.executeJavaScript(`[...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board')?.click()`);
            for (let attempt = 0; attempt < 100 && designInspector?.state().ready; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
            if (designInspector?.state().ready) throw new Error('Design-Vorschau blieb nach Ansichtswechsel offen.');
            const previousContentSize = smokeWindow.getContentSize();
            smokeWindow.setMinimumSize(390, 650);
            smokeWindow.setContentSize(390, 800);
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const nav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Design');
              if (!(nav instanceof HTMLButtonElement)) throw new Error('Design-Navigation für schmale Fokusansicht fehlt.');
              nav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.task-wireframe-focus-toggle'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const focus = document.querySelector('.task-wireframe-focus-toggle');
              for (let attempt = 0; attempt < 100 && focus?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(focus instanceof HTMLButtonElement) || focus.disabled) throw new Error('Kartenentwurf war in der schmalen Ansicht nicht wieder erreichbar.');
              focus.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.design-inspection.wireframe-focus'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const surface = document.querySelector('.design-inspection.wireframe-focus');
              const canvas = surface?.querySelector('.task-wireframe-canvas-viewport');
              const properties = surface?.querySelector('.task-wireframe-properties');
              const overview = surface?.querySelector('.task-wireframe-overview');
              if (innerWidth !== 390 || !surface || !canvas || !properties || !overview || surface.scrollWidth > innerWidth + 1 || overview.getBoundingClientRect().right > innerWidth + 1 || canvas.getBoundingClientRect().right > innerWidth + 1 || properties.getBoundingClientRect().top < canvas.getBoundingClientRect().bottom) throw new Error('Fokusansicht oder Zeichenflächenüberblick überläuft bei 390 px oder stapelt den Inspector nicht unter die Zeichenfläche.');
              if (parseFloat(getComputedStyle(properties.querySelector('label')).fontSize) < 12) throw new Error('Inspector-Text ist in der Fokusansicht zu klein.');
              focus.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.design-inspection.wireframe-focus'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.design-inspection-toolbar')) throw new Error('Design-Inspektion fehlt nach schmaler Fokusansicht.');
              return true;
            })()`);
            smokeWindow.setContentSize(previousContentSize[0]!, previousContentSize[1]!);
            smokeWindow.setMinimumSize(420, 650);
            await smokeWindow.webContents.executeJavaScript(`[...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board')?.click()`);
            const milestonePath = join(smokeDataDirectory!, 'milestone-preview-project');
            mkdirSync(milestonePath);
            writeFileSync(join(milestonePath, 'README.md'), '# Synthetic milestone preview\n');
            mkdirSync(join(milestonePath, 'src'));
            writeFileSync(join(milestonePath, 'src', 'widget.ts'), 'export const milestoneWidget = 1;\n');
            execFileSync('git', ['init', '-q', milestonePath], { windowsHide: true });
            execFileSync('git', ['-C', milestonePath, 'add', 'README.md', 'src/widget.ts'], { windowsHide: true });
            execFileSync('git', ['-C', milestonePath, '-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic preview milestone'], { windowsHide: true });
            const milestoneProjectId = await smokeWindow.webContents.executeJavaScript(`(async () => {
              const milestoneProject = await window.studio.createProject({ name: 'Meilenstein-Vorschau', path: ${JSON.stringify(milestonePath)} });
              const item = await window.studio.createMilestoneWithPreview({ projectId: milestoneProject.id, label: 'Synthetische Vorschau', url: ${JSON.stringify(`${qaUrl}?token=synthetic`)} });
              if (!item.previewAvailable || item.previewSource !== ${JSON.stringify(qaUrl)} || (await window.studio.listMilestones(milestoneProject.id))[0]?.id !== item.id) throw new Error('Screenshot wurde nicht am lokalen Git-Meilenstein gespeichert.');
              const image = await window.studio.milestonePreviewImage({ projectId: milestoneProject.id, milestoneId: item.id });
              if (!image.startsWith('data:image/png;base64,iVBORw0KGgo')) throw new Error('Gespeicherter Vorschau-PNG fehlt.');
              return milestoneProject.id;
            })()`);
            await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const select = document.querySelector('#project-select');
              if (!(select instanceof HTMLSelectElement)) throw new Error('Projektauswahl fehlt.');
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!setter) throw new Error('Projektauswahl kann nicht gesetzt werden.');
              setter.call(select, ${JSON.stringify(milestoneProjectId)}); select.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('#project-select option:checked')?.textContent?.includes('Meilenstein-Vorschau'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((button) => button.textContent?.trim() === 'Zeitmaschine')?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.milestones-item'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.milestones-item')?.textContent?.includes('Synthetische Vorschau')) throw new Error('Meilenstein fehlt in der Zeitmaschine.');
              const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              const label = document.querySelector('.milestones-create > label input');
              const url = document.querySelector('.milestones-preview-option input');
              if (!inputSetter || !(label instanceof HTMLInputElement) || !(url instanceof HTMLInputElement)) throw new Error('Optionale Vorschau-Eingaben fehlen.');
              inputSetter.call(label, 'Sichtbarer UI-Meilenstein'); label.dispatchEvent(new Event('input', { bubbles: true }));
              inputSetter.call(url, ${JSON.stringify(`${qaUrl}?token=synthetic`)}); url.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && document.querySelector('.milestones-create button[type="submit"]')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              document.querySelector('.milestones-create button[type="submit"]')?.click();
              for (let attempt = 0; attempt < 100 && document.querySelectorAll('.milestones-item').length < 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const created = [...document.querySelectorAll('.milestones-item')].find((button) => button.textContent?.includes('Sichtbarer UI-Meilenstein'));
              if (!created?.textContent?.includes('Vorschau')) throw new Error('UI-Anlage mit lokalem Screenshot fehlgeschlagen: ' + document.querySelector('.milestones-feedback.error')?.textContent);
              created.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.milestones-comparison'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const show = [...document.querySelectorAll('.milestones-preview-result button')].find((button) => button.textContent?.includes('Vorschau ansehen'));
              if (!(show instanceof HTMLButtonElement)) throw new Error('Vorschau-Knopf fehlt.');
              show.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.milestones-preview-result img'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.milestones-preview-result img')?.getAttribute('src')?.startsWith('data:image/png;base64,')) throw new Error('Screenshot ist in der Zeitmaschine nicht sichtbar.');
              const selectors = [...document.querySelectorAll('.milestones-image-compare-controls select')];
              if (selectors.length !== 2 || document.querySelector('.milestones-image-compare-grid img')) throw new Error('Bildvergleich lädt ohne bewusste Auswahl oder ist nicht verfügbar.');
              const options = [...selectors[0].options].filter((option) => option.value);
              if (options.length !== 2) throw new Error('Es werden nicht genau zwei synthetische Vorschauaufnahmen zur Wahl angeboten.');
              const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!selectSetter) throw new Error('Vergleichsauswahl kann nicht gesetzt werden.');
              selectSetter.call(selectors[0], options[1].value); selectors[0].dispatchEvent(new Event('change', { bubbles: true }));
              selectSetter.call(selectors[1], options[0].value); selectors[1].dispatchEvent(new Event('change', { bubbles: true }));
              const imageCompare = document.querySelector('.milestones-image-compare-controls button');
              for (let attempt = 0; attempt < 100 && imageCompare?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(imageCompare instanceof HTMLButtonElement) || imageCompare.disabled) throw new Error('Vergleichsknopf wurde nach Auswahl nicht aktiviert.');
              imageCompare.focus();
              if (document.activeElement !== imageCompare) throw new Error('Vergleichsknopf ist nicht per Tastatur fokussierbar.');
              imageCompare.click();
              for (let attempt = 0; attempt < 100 && document.querySelectorAll('.milestones-image-compare-grid img').length !== 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const comparedImages = [...document.querySelectorAll('.milestones-image-compare-grid img')];
              if (comparedImages.length !== 2 || !comparedImages.every((image) => image.getAttribute('src')?.startsWith('data:image/png;base64,') && image.getAttribute('alt'))) throw new Error('Vorher/Nachher-Bilder oder Bildbeschreibungen fehlen.');
              await Promise.all(comparedImages.map((image) => image.decode()));
              return true;
            })()`);
            process.stdout.write('STUDIO_SMOKE_MEMORY_START\n');
            const memoryNote = smokeStore.saveNote({ projectId: milestoneProjectId, title: 'Commit-Beleg Smoke', body: 'Synthetische Git-Quelle', tags: [], links: [] });
            const memoryHead = execFileSync('git', ['-C', milestonePath, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
            await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const select = document.querySelector('#project-select');
              if (!(select instanceof HTMLSelectElement)) throw new Error('Projektauswahl fehlt bei Memory-Git-Quelle.');
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!setter) throw new Error('Projektauswahl ist nicht bedienbar.');
              setter.call(select, ${JSON.stringify(milestoneProjectId)}); select.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('#project-select option:checked')?.textContent?.includes('Meilenstein-Vorschau'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((button) => button.textContent?.trim() === 'Memory')?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.knowledge-index-sources')?.textContent?.includes('Commits'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const index = document.querySelector('.project-knowledge-index');
              const notes = document.querySelector('.memory-list');
              if (!index || !notes || !(index.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING)) throw new Error('Automatischer Projektindex steht nicht vor den Notizen.');
              let found;
              for (let attempt = 0; attempt < 100; attempt++) {
                found = await window.studio.searchProjectMemoryIndex({ projectId: ${JSON.stringify(milestoneProjectId)}, query: 'milestone', kind: 'commit' });
                if (found.hits.some((hit) => hit.kind === 'commit' && hit.gitRef === ${JSON.stringify(memoryHead)})) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!found?.hits.some((hit) => hit.kind === 'commit' && hit.gitRef === ${JSON.stringify(memoryHead)})) throw new Error('Gespeicherter Git-Commit fehlt im lokalen Projektindex: ' + JSON.stringify(found?.status));
              const graphSources = await window.studio.projectMemoryMapSources(${JSON.stringify(milestoneProjectId)});
              if (graphSources.gitRef !== ${JSON.stringify(memoryHead)} || graphSources.headCommit?.sourceId !== ${JSON.stringify(memoryHead)}
                || !graphSources.codeFiles.some((file) => file.path === 'src/widget.ts')) throw new Error('Memory-Karte nennt keinen belegten Git-Stand mit Quelldatei.');
              const gitLayer = [...document.querySelectorAll('.knowledge-map-layers button')].find((button) => button.textContent?.trim() === 'Git-Quellen');
              if (!(gitLayer instanceof HTMLButtonElement)) throw new Error('Git-Quellen-Ebene fehlt in der Memory-Karte.');
              gitLayer.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.knowledge-map-list')?.textContent?.includes('src/widget.ts'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.knowledge-map-list')?.textContent?.includes('src/widget.ts')) throw new Error('Indexierte Datei fehlt in der sichtbaren Memory-Karte.');
              const fileList = document.querySelector('.knowledge-map-list');
              if (!(fileList instanceof HTMLDetailsElement)) throw new Error('Memory-Quellenliste fehlt.');
              fileList.open = true;
              const fileNode = [...document.querySelectorAll('.knowledge-map-list button')].find((button) => button.textContent?.includes('src/widget.ts'));
              if (!(fileNode instanceof HTMLButtonElement)) throw new Error('Indexierte Datei ist nicht per Tastatur auswählbar.');
              fileNode.focus();
              if (document.activeElement !== fileNode) throw new Error('Indexierte Datei ist nicht per Tastatur fokussierbar.');
              fileNode.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.knowledge-map-source-preview')?.textContent?.includes('milestoneWidget'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.knowledge-map-source-preview')?.textContent?.includes('milestoneWidget')) throw new Error('Datei-Quellbeleg fehlt im Memory-Inspector.');
              const source = await window.studio.readProjectMemorySource({ projectId: ${JSON.stringify(milestoneProjectId)}, kind: 'commit', sourceId: ${JSON.stringify(memoryHead)} });
              if (!source?.body.includes('Synthetic preview milestone')) throw new Error('Git-Quellbeleg lässt sich nicht projektbezogen öffnen.');
              let note;
              for (let attempt = 0; attempt < 100; attempt++) {
                note = [...document.querySelectorAll('.memory-item')].find((item) => item.textContent?.includes('Commit-Beleg Smoke'));
                if (note) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!(note instanceof HTMLButtonElement)) throw new Error('Synthetische Memory-Notiz fehlt.');
              note.click();
              let choose;
              for (let attempt = 0; attempt < 100; attempt++) {
                choose = undefined;
                const selected = document.querySelector('.memory-item.selected');
                const preview = document.querySelector('.memory-preview h2');
                if (selected?.textContent?.includes('Commit-Beleg Smoke') && preview?.textContent === 'Commit-Beleg Smoke') {
                  choose = [...document.querySelectorAll('.memory-git-source button')].find((button) => button.textContent?.includes('Commit auswählen'));
                }
                if (choose && !choose.disabled) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!(choose instanceof HTMLButtonElement)) throw new Error('Git-Quellenauswahl fehlt: ' + JSON.stringify({ selected: document.querySelector('.memory-item.selected')?.textContent?.slice(0, 100), preview: document.querySelector('.memory-preview h2')?.textContent, source: document.querySelector('.memory-git-source')?.textContent?.slice(0, 160), page: Boolean(document.querySelector('.memory-page')) }));
              if (choose.disabled) throw new Error('Git-Quellenauswahl blieb gesperrt.');
              choose.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.memory-git-source-chooser input[type="radio"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const candidate = document.querySelector('.memory-git-source-chooser input[type="radio"]');
              if (!(candidate instanceof HTMLInputElement)) throw new Error('Geprüfter Git-Commit fehlt in der Auswahl.');
              candidate.click();
              const attach = [...document.querySelectorAll('.memory-git-source-chooser button')].find((button) => button.textContent?.includes('Quelle verknüpfen'));
              if (!(attach instanceof HTMLButtonElement)) throw new Error('Bestätigung der Git-Quelle fehlt.');
              for (let attempt = 0; attempt < 100 && attach.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              attach.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.memory-git-source-record')?.textContent?.includes(${JSON.stringify(memoryHead)}); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.memory-git-source-record')?.textContent?.includes('Commit ist in der aktuellen Projekt-Historie')) throw new Error('Git-Quelle wurde nicht sichtbar bestätigt: ' + document.querySelector('.memory-git-source')?.textContent?.slice(0, 500));
              const saved = await window.studio.memoryGitSource({ projectId: ${JSON.stringify(milestoneProjectId)}, noteId: ${JSON.stringify(memoryNote.id)} });
              if (saved?.hash !== ${JSON.stringify(memoryHead)} || saved.state !== 'in-history') throw new Error('Git-Quelle wurde nicht in SQLite gespeichert.');
              return true;
            })()`);
            process.stdout.write('STUDIO_SMOKE_MEMORY_MAP_OK\n');
            await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const select = document.querySelector('#project-select');
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!(select instanceof HTMLSelectElement) || !setter) throw new Error('Projektauswahl fehlt nach Memory-Neustart.');
              setter.call(select, ${JSON.stringify(milestoneProjectId)}); select.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('#project-select option:checked')?.textContent?.includes('Meilenstein-Vorschau'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((button) => button.textContent?.trim() === 'Memory')?.click();
              let note;
              for (let attempt = 0; attempt < 100; attempt++) {
                note = [...document.querySelectorAll('.memory-item')].find((item) => item.textContent?.includes('Commit-Beleg Smoke'));
                if (note) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!(note instanceof HTMLButtonElement)) throw new Error('Memory-Notiz fehlt nach Reload.');
              note.click();
              for (let attempt = 0; attempt < 100; attempt++) {
                const record = document.querySelector('.memory-git-source-record')?.textContent;
                if (record?.includes(${JSON.stringify(memoryHead)}) && record.includes('Commit ist in der aktuellen Projekt-Historie')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const record = document.querySelector('.memory-git-source-record')?.textContent;
              if (!record?.includes(${JSON.stringify(memoryHead)}) || !record.includes('Commit ist in der aktuellen Projekt-Historie')) throw new Error('Git-Quelle wurde nach Reload nicht erneut geprüft: ' + JSON.stringify({ selected: document.querySelector('.memory-item.selected')?.textContent?.slice(0, 100), preview: document.querySelector('.memory-preview h2')?.textContent, source: document.querySelector('.memory-git-source')?.textContent?.slice(0, 220), page: Boolean(document.querySelector('.memory-page')) }));
              return true;
            })()`);
            const cleanupCard = smokeStore.createCard({ projectId: milestoneProjectId, columnId: smokeStore.snapshot(milestoneProjectId).columns[0]!.id, title: 'Worktree-Aufräumprüfung Smoke' });
            const cleanupWorktree = ensureCardWorktree(smokeStore, cleanupCard.id);
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const select = document.querySelector('#project-select');
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!(select instanceof HTMLSelectElement) || !setter) throw new Error('Terminal-Worktree: Projektauswahl fehlt.');
              setter.call(select, ${JSON.stringify(milestoneProjectId)}); select.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('#project-select option:checked')?.textContent?.includes('Meilenstein-Vorschau'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((button) => button.textContent?.trim() === 'Terminal')?.click();
              let target;
              for (let attempt = 0; attempt < 100; attempt++) {
                target = document.querySelector('select[aria-label="Terminal-Arbeitsordner auswählen"]');
                if (target?.querySelector('option[value="${cleanupCard.id}"]')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!(target instanceof HTMLSelectElement) || !target.querySelector('option[value="${cleanupCard.id}"]')) throw new Error('Gespeicherter Karten-Worktree fehlt in der Terminal-Auswahl.');
              setter.call(target, ${JSON.stringify(cleanupCard.id)}); target.dispatchEvent(new Event('change', { bubbles: true }));
              const shell = document.querySelector('select[aria-label="Shell auswählen"]');
              if (!(shell instanceof HTMLSelectElement)) throw new Error('Terminal-Shell-Auswahl fehlt.');
              setter.call(shell, 'cmd'); shell.dispatchEvent(new Event('change', { bubbles: true }));
              const start = [...document.querySelectorAll('.command-terminal-start button')].find((button) => button.textContent?.includes('Terminal starten'));
              if (!(start instanceof HTMLButtonElement)) throw new Error('Terminal-Startknopf fehlt.');
              start.click();
              let terminal;
              for (let attempt = 0; attempt < 100; attempt++) {
                terminal = (await window.studio.commandTerminals(${JSON.stringify(milestoneProjectId)}))[0];
                if (terminal?.state === 'running') break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!terminal || terminal.cardId !== ${JSON.stringify(cleanupCard.id)} || terminal.worktreePath !== ${JSON.stringify(cleanupWorktree.path)}) throw new Error('Terminal startete nicht im gewählten Karten-Worktree.');
              await window.studio.writeCommandTerminal({ terminalId: terminal.id, data: 'cd\\r' });
              let output = '';
              for (let attempt = 0; attempt < 100; attempt++) {
                output = (await window.studio.commandTerminals(${JSON.stringify(milestoneProjectId)}))[0]?.output ?? '';
                if (output.includes(${JSON.stringify(cleanupWorktree.cwd)})) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              await window.studio.stopCommandTerminal(terminal.id);
              if (!output.includes(${JSON.stringify(cleanupWorktree.cwd)})) throw new Error('Terminal-PTY meldete nicht den gespeicherten Worktree als Arbeitsordner.');
              if (!document.querySelector('.command-terminal-history')?.textContent?.includes('Worktree-Aufräumprüfung Smoke')) throw new Error('Terminal-Verlauf zeigt die Kartenherkunft nicht.');
              const nextStart = [...document.querySelectorAll('.command-terminal-start button')].find((button) => button.textContent?.includes('Terminal starten'));
              for (let attempt = 0; attempt < 100 && nextStart?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(nextStart instanceof HTMLButtonElement) || nextStart.disabled) throw new Error('Terminal-Start blieb nach Stop gesperrt.');
              nextStart.click();
              setter.call(select, ${JSON.stringify(smokeProject.id)}); select.dispatchEvent(new Event('change', { bubbles: true }));
              let delayed;
              for (let attempt = 0; attempt < 100; attempt++) {
                delayed = (await window.studio.commandTerminals(${JSON.stringify(milestoneProjectId)}))[0];
                if (delayed?.id !== terminal.id && delayed?.state === 'running') break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!delayed || delayed.id === terminal.id || delayed.state !== 'running') throw new Error('Verzögerter Terminal-Start für Projekt A fehlt.');
              for (let attempt = 0; attempt < 100 && document.querySelector('#project-select')?.value !== ${JSON.stringify(smokeProject.id)}; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('#project-select')?.value !== ${JSON.stringify(smokeProject.id)} || document.querySelector('.command-terminal-history')?.textContent?.includes('Worktree-Aufräumprüfung Smoke')) throw new Error('Terminal aus Projekt A erschien nach Projektwechsel in Projekt B.');
              await window.studio.stopCommandTerminal(delayed.id);
              return true;
            })()`);
            await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const select = document.querySelector('#project-select');
              if (!(select instanceof HTMLSelectElement)) throw new Error('Projektauswahl fehlt bei Worktree-Prüfung.');
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!setter) throw new Error('Projektauswahl ist nicht bedienbar.');
              setter.call(select, ${JSON.stringify(milestoneProjectId)}); select.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('#project-select option:checked')?.textContent?.includes('Meilenstein-Vorschau'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((button) => button.textContent?.trim() === 'Board')?.click();
              let card;
              for (let attempt = 0; attempt < 100; attempt++) {
                card = [...document.querySelectorAll('.task-card')].find((item) => item.textContent?.includes('Worktree-Aufräumprüfung Smoke'));
                if (card) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!(card instanceof HTMLElement)) throw new Error('Worktree-Karte fehlt im Board.');
              card.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const review = [...document.querySelectorAll('.card-drawer button')].find((button) => button.textContent?.includes('Git-Stand prüfen'));
              if (!(review instanceof HTMLButtonElement)) throw new Error('Git-Stand-Knopf fehlt.');
              review.click();
              let cleanup;
              for (let attempt = 0; attempt < 100; attempt++) {
                cleanup = [...document.querySelectorAll('.card-drawer button')].find((button) => button.textContent?.includes('Aufräumbarkeit prüfen'));
                if (cleanup) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!(cleanup instanceof HTMLButtonElement)) throw new Error('Lesende Aufräumaktion fehlt.');
              for (let attempt = 0; attempt < 100 && cleanup.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (cleanup.disabled) throw new Error('Lesende Aufräumaktion blieb gesperrt: ' + document.querySelector('.card-drawer')?.textContent?.slice(0, 500));
              cleanup.click();
              for (let attempt = 0; attempt < 300 && !document.querySelector('[aria-label="Lesende Worktree-Aufräumprüfung"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const panel = document.querySelector('[aria-label="Lesende Worktree-Aufräumprüfung"]');
              if (!panel?.textContent?.includes('Commit im Ziel: belegt') || !panel.textContent?.includes('entfernt hier weder Dateien noch Git-Branches')) throw new Error('Worktree-Aufräumprüfung zeigt Belege oder Löschgrenze nicht: ' + panel?.textContent?.slice(0, 1000) + ' / ' + document.querySelector('.card-drawer')?.textContent?.slice(0, 500));
              const api = await window.studio.previewCardWorktreeCleanup(${JSON.stringify(cleanupCard.id)});
              if (!api || api.path !== ${JSON.stringify(cleanupWorktree.path)} || !api.mergedIntoTarget || api.blockers.length) throw new Error('Worktree-Aufräumprüfung liefert falschen IPC-Stand.');
              return true;
            })()`);
            if (!statSync(cleanupWorktree.path).isDirectory() || smokeStore.cardWorktree(cleanupCard.id)?.path !== cleanupWorktree.path) throw new Error('Lesende Aufräumprüfung veränderte den Worktree.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const status = await window.studio.trelloConnectionStatus();
              if (status.connected) throw new Error('Synthetisches Smoke-Profil enthält unerwartet Trello-Zugangsdaten.');
              document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
              const open = [...document.querySelectorAll('.board-header-actions button')].find((button) => button.textContent?.includes('Trello importieren'));
              if (!(open instanceof HTMLButtonElement)) throw new Error('Trello-Importknopf fehlt im Board.');
              open.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.trello-import-dialog'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const dialog = document.querySelector('.trello-import-dialog');
              if (!dialog?.textContent?.includes('Trello verbinden') || !dialog.textContent.includes('Lesefreigabe im Browser öffnen')) throw new Error('Trello-Verbindungsansicht fehlt.');
              const fileTab = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'JSON-Datei');
              if (!(fileTab instanceof HTMLButtonElement)) throw new Error('JSON-Alternative fehlt.');
              for (let attempt = 0; attempt < 100 && fileTab.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              fileTab.click();
              for (let attempt = 0; attempt < 100 && !dialog.querySelector('input[type="file"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!dialog.querySelector('input[type="file"]')) throw new Error('JSON-Dateiauswahl fehlt.');
              dialog.querySelector('button[aria-label="Schließen"]')?.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.trello-import-dialog'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.trello-import-dialog')) throw new Error('Trello-Import schloss nicht.');
              return true;
            })()`);
            const nativeOpenDialog = dialog.showOpenDialog;
            let packagePickerOpened = false;
            try {
              dialog.showOpenDialog = (async (...args: unknown[]) => {
                if ((args.at(-1) as { title?: string })?.title !== 'Projektpaket auswählen') throw new Error('Unexpected native dialog during project import check.');
                packagePickerOpened = true;
                return { canceled: true, filePaths: [] };
              }) as typeof dialog.showOpenDialog;
              await smokeWindow.webContents.executeJavaScript(`(() => {
                document.querySelector('.project-actions summary')?.click();
                const action = [...document.querySelectorAll('.project-actions-menu button')].find((item) => item.textContent?.includes('Branchloom-Paket (.json) importieren'));
                if (!(action instanceof HTMLButtonElement)) throw new Error('Direct JSON package action is missing.');
                action.click();
                if (document.querySelector('.project-import-choice')) throw new Error('A redundant import choice opened.');
              })()`);
              for (let attempt = 0; attempt < 100 && !packagePickerOpened; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
              if (!packagePickerOpened) throw new Error('JSON package action did not open the native file picker.');
            } finally { dialog.showOpenDialog = nativeOpenDialog; }
            let folderPickerOpened = false;
            try {
              dialog.showOpenDialog = (async (...args: unknown[]) => {
                const options = args.at(-1) as { title?: string; properties?: string[] };
                if (options.title !== 'Vorhandenen Codeordner auswählen' || !options.properties?.includes('openDirectory')) throw new Error('Project folder picker used unexpected native dialog options.');
                folderPickerOpened = true;
                return { canceled: false, filePaths: [smokeProject.path] };
              }) as typeof dialog.showOpenDialog;
              await smokeWindow.webContents.executeJavaScript(`(async () => {
                const add = document.querySelector('button[aria-label="Codeordner hinzufügen"]');
                if (!(add instanceof HTMLButtonElement)) throw new Error('Project add action is missing.');
                add.click();
                for (let attempt = 0; attempt < 100 && !document.querySelector('#new-project-folder'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
                const choose = [...document.querySelectorAll('.project-folder-field button')].find((button) => button.textContent?.includes('Ordner auswählen'));
                if (!(choose instanceof HTMLButtonElement)) throw new Error('Native folder choice is missing in the project form.');
                choose.click();
              })()`);
              for (let attempt = 0; attempt < 100 && !folderPickerOpened; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
              if (!folderPickerOpened) throw new Error('Project folder choice did not reach the native dialog.');
              await smokeWindow.webContents.executeJavaScript(`(async () => {
                for (let attempt = 0; attempt < 100 && document.querySelector('#new-project-folder')?.value !== ${JSON.stringify(smokeProject.path)}; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
                if (document.querySelector('#new-project-folder')?.value !== ${JSON.stringify(smokeProject.path)}) throw new Error('Chosen folder did not populate the project form.');
                if (!document.querySelector('.modal-backdrop input[placeholder="Mein Projekt"]')?.value) throw new Error('Chosen folder did not suggest a project name.');
                const cancel = [...document.querySelectorAll('.modal-backdrop button')].find((button) => button.textContent?.trim() === 'Abbrechen');
                if (!(cancel instanceof HTMLButtonElement)) throw new Error('Project form cancel action is missing.');
                cancel.click();
              })()`);
            } finally { dialog.showOpenDialog = nativeOpenDialog; }
            // F08: a real Electron session must keep two synthetic local logins apart.
            const identityServerPath = join(smokeDataDirectory!, 'f08-identity-server.cjs');
            writeFileSync(identityServerPath, `const http = require('node:http');
const port = Number(process.argv[2]);
const accounts = new Map();
http.createServer((request, response) => {
  if (request.url === '/api/me') {
    const found = /(?:^|; )f08=(admin|user)(?:;|$)/.exec(request.headers.cookie || '');
    response.writeHead(found ? 200 : 401, { 'Content-Type': 'application/json' });
    response.end(found ? JSON.stringify({ subject: found[1] + '-fixture', role: found[1] }) : '{}');
  } else if (request.url?.startsWith('/__branchloom/accounts')) {
    const admin = /(?:^|; )f08=admin(?:;|$)/.test(request.headers.cookie || '');
    if (!admin) { response.writeHead(403); response.end(); return; }
    if (request.method === 'GET') {
      const subject = new URL(request.url, 'http://localhost').searchParams.get('subject');
      const role = new URL(request.url, 'http://localhost').searchParams.get('role');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ subject, role, exists: accounts.get(subject) === role }));
    } else if (request.method === 'POST') {
      let body = '';
      request.on('data', (part) => { body += part; });
      request.on('end', () => {
        const input = JSON.parse(body);
        const created = !accounts.has(input.subject);
        accounts.set(input.subject, input.role);
        response.writeHead(created ? 201 : 200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ...input, exists: true, created }));
      });
    } else { response.writeHead(405); response.end(); }
  } else if (request.url?.startsWith('/login?as=')) {
    const role = new URL(request.url, 'http://localhost').searchParams.get('as');
    response.writeHead(200, { 'Set-Cookie': 'f08=' + role + '; Path=/; SameSite=Strict', 'Content-Type': 'text/html' });
    response.end('<title>BRANCHLOOM_F08_READY</title>Signed in');
  } else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<title>BRANCHLOOM_F08_READY</title>'); }
}).listen(port, '127.0.0.1');
`);
            // Keep the synthetic project outside the profile worktree directory.
            // The earlier smoke project is the profile root itself.
            const f08ProjectRoot = join(smokeDataDirectory!, 'f08-source');
            mkdirSync(f08ProjectRoot);
            writeFileSync(join(f08ProjectRoot, 'README.md'), '# Synthetic account preview\n');
            execFileSync('git', ['init', '-q', f08ProjectRoot], { windowsHide: true });
            execFileSync('git', ['-C', f08ProjectRoot, 'add', '--', 'README.md'], { windowsHide: true });
            execFileSync('git', ['-C', f08ProjectRoot, '-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic account preview'], { windowsHide: true });
            const f08Project = smokeStore.createProject({ name: 'Smoke accounts', path: f08ProjectRoot });
            const f08Card = smokeStore.createCard({ projectId: f08Project.id, columnId: smokeStore.snapshot(f08Project.id).columns[0]!.id, title: 'Synthetic account card' });
            const f08Other = smokeStore.createCard({ projectId: f08Project.id, columnId: smokeStore.snapshot(f08Project.id).columns[0]!.id, title: 'Synthetic second account card' });
            const f08Profile = saveDevEnvironmentProfile(smokeStore, { projectId: f08Project.id, executable: 'node', args: [identityServerPath, '{port}', '127.0.0.1'], healthPath: '/', healthMarker: 'BRANCHLOOM_F08_READY' });
            if (!f08Profile) throw new Error('Synthetic F08 preview profile was not saved.');
            let f08FirstRun = await devEnvironmentRunner!.start(f08Card.id);
            let f08SecondRun = await devEnvironmentRunner!.start(f08Other.id);
            for (let attempt = 0; attempt < 100 && (f08FirstRun.state === 'starting' || f08SecondRun.state === 'starting'); attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              f08FirstRun = devEnvironmentRunner!.card(f08Card.id)!;
              f08SecondRun = devEnvironmentRunner!.card(f08Other.id)!;
            }
            if (f08FirstRun.state !== 'ready' || f08SecondRun.state !== 'ready') {
              throw new Error(`Synthetic F08 previews did not become ready: ${f08FirstRun.state} ${f08FirstRun.output.slice(-300)} / ${f08SecondRun.state} ${f08SecondRun.output.slice(-300)}`);
            }
            const firstAccount = createDevAccount(smokeStore, { projectId: f08Project.id, service: 'Smoke shop', environment: 'local', role: 'admin', subject: 'admin-fixture', probePath: '/api/me' });
            const secondAccount = createDevAccount(smokeStore, { projectId: f08Project.id, service: 'Smoke shop', environment: 'local', role: 'user', subject: 'user-fixture', probePath: '/api/me' });
            for (const [cardId, accountId] of [[f08Card.id, firstAccount.id], [f08Other.id, secondAccount.id]] as const) {
              const overview = devAccountOverview(smokeStore, { projectId: f08Project.id, cardId });
              assignDevAccount(smokeStore, { projectId: f08Project.id, cardId, accountId, expectedCardRevision: overview.cardRevision });
            }
            // F01 guided setup: source evidence, a visible card click and a real local server.
            mkdirSync(join(milestonePath, 'node_modules', 'vite', 'bin'), { recursive: true });
            writeFileSync(join(milestonePath, 'package.json'), JSON.stringify({ name: 'smoke-guided-app', scripts: { dev: 'vite' }, devDependencies: { vite: '^7.0.0' } }));
            writeFileSync(join(milestonePath, 'index.html'), '<!doctype html><title>Smoke Guided App</title>');
            writeFileSync(join(milestonePath, 'variant.txt'), 'base');
            writeFileSync(join(milestonePath, 'node_modules', 'vite', 'bin', 'vite.js'), `const http=require('node:http'); const fs=require('node:fs');
const port=Number(process.argv[process.argv.indexOf('--port')+1]);
http.createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<title>Smoke Guided App</title>'+fs.readFileSync('variant.txt','utf8'))}).listen(port,'127.0.0.1');`);
            execFileSync('git', ['-C', milestonePath, 'add', '-f', 'package.json', 'index.html', 'variant.txt', 'node_modules/vite/bin/vite.js'], { windowsHide: true });
            execFileSync('git', ['-C', milestonePath, '-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic guided preview app'], { windowsHide: true });
            const guidedCard = smokeStore.createCard({ projectId: milestoneProjectId, columnId: smokeStore.snapshot(milestoneProjectId).columns[0]!.id, title: 'Guided preview smoke card' });
            const guidedOther = smokeStore.createCard({ projectId: milestoneProjectId, columnId: smokeStore.snapshot(milestoneProjectId).columns[0]!.id, title: 'Other preview smoke card' });
            writeFileSync(join(ensureCardWorktree(smokeStore, guidedCard.id).cwd, 'variant.txt'), 'Variant A');
            writeFileSync(join(ensureCardWorktree(smokeStore, guidedOther.id).cwd, 'variant.txt'), 'Variant B');
            const guidedInspection = inspectDevEnvironment(smokeStore, devEnvironmentRunner!, { projectId: milestoneProjectId, cardId: guidedCard.id });
            if (guidedInspection.candidates.length !== 1 || !guidedInspection.evidence.some((item) => item.id === 'html-title')) throw new Error('F01 guided Git HEAD evidence is missing.');
            const guidedProfile = saveDevEnvironmentProfile(smokeStore, guidedInspection.candidates[0]!.profile);
            if (devEnvironmentAudit(smokeStore, milestoneProjectId, guidedCard.id)[0]?.profileFingerprint !== guidedProfile.fingerprint) throw new Error('F01 profile save receipt is missing.');
            await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              for (let attempt = 0; attempt < 100 && !document.querySelector('#project-select'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const select = document.querySelector('#project-select');
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!(select instanceof HTMLSelectElement) || !setter) throw new Error('F08 project switch is missing.');
              setter.call(select, ${JSON.stringify(f08Project.id)});
              select.dispatchEvent(new Event('change', { bubbles: true }));
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board')?.click();
              let card;
              for (let attempt = 0; attempt < 100 && !card; attempt++) {
                card = [...document.querySelectorAll('.task-card')].find((item) => item.textContent?.includes('Synthetic account card'));
                if (!card) await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!(card instanceof HTMLElement)) throw new Error('F08 synthetic card did not render on the board.');
              card.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer .dev-account-panel'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const panel = document.querySelector('.card-drawer .dev-account-panel');
              if (!panel?.textContent?.includes('Dev-Konto')) throw new Error('F08 card drawer has no account section.');
              panel.querySelector('button[aria-expanded="false"]')?.click();
              for (let attempt = 0; attempt < 100 && !panel.querySelector('.dev-account-actions'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!panel.textContent?.includes('Smoke shop · local · admin') || !panel.textContent.includes('Anmeldefenster öffnen') || !panel.textContent.includes('Zugang prüfen')) throw new Error('F08 assigned account controls are missing in the card drawer.');
              const probe = [...panel.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Zugang prüfen');
              if (!(probe instanceof HTMLButtonElement) || probe.disabled) throw new Error('F08 identity-check action is unavailable for a ready preview.');
              probe.click();
              for (let attempt = 0; attempt < 100 && !panel.textContent?.includes('Anmeldung abgelaufen oder fehlt'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!panel.textContent?.includes('Anmeldung abgelaufen oder fehlt')) throw new Error('F08 visible identity check did not report missing login.');
              return true;
            })()`);
            const f08Initial = await smokeWindow.webContents.executeJavaScript(`(async () => {
              const first = await window.studio.probeDevAccount(${JSON.stringify(f08Card.id)});
              const second = await window.studio.probeDevAccount(${JSON.stringify(f08Other.id)});
              if (first.state !== 'login-required' || second.state !== 'login-required') throw new Error('F08 synthetic sessions unexpectedly share a login.');
              await window.studio.openDevAccount(${JSON.stringify(f08Card.id)});
              await window.studio.openDevAccount(${JSON.stringify(f08Other.id)});
              return true;
            })()`);
            if (!f08Initial) throw new Error('F08 account IPC did not open both assigned windows.');
            const accountWindows = BrowserWindow.getAllWindows().filter((item) => item.getParentWindow() === smokeWindow);
            if (accountWindows.length !== 2) throw new Error('F08 did not open distinct visible account windows.');
            // The target page can replace BrowserWindow's title after load.
            // Identify each account window by its distinct managed preview origin.
            const adminWindow = accountWindows.find((item) => new URL(item.webContents.getURL()).origin === new URL(f08FirstRun.url).origin);
            const userWindow = accountWindows.find((item) => new URL(item.webContents.getURL()).origin === new URL(f08SecondRun.url).origin);
            if (!adminWindow || !userWindow || adminWindow.webContents.session === userWindow.webContents.session) throw new Error('F08 account partitions are not isolated.');
            await adminWindow.loadURL(`${f08FirstRun.url}login?as=admin`);
            const f08Admin = await devAccountBrowser!.probe(f08Card.id);
            const f08UnloggedUser = await devAccountBrowser!.probe(f08Other.id);
            if (f08Admin.state !== 'verified' || f08UnloggedUser.state !== 'login-required') throw new Error('F08 real-session login isolation failed.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const panel = () => document.querySelector('.card-drawer .dev-account-panel');
              if (!panel()) throw new Error('F08 account panel is missing for protected-login action.');
              const button = (label) => [...(panel()?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === label);
              for (let attempt = 0; attempt < 200 && button('Zugang prüfen')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const probe = button('Zugang prüfen');
              if (!probe || probe.disabled) throw new Error('F08 identity-check button did not become ready after login.');
              probe.click();
              for (let attempt = 0; attempt < 200 && !panel()?.textContent?.includes('Konto und Rolle bestätigt'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const save = button('Anmeldung für Neustart speichern');
              if (!save || save.disabled) throw new Error('F08 protected-login opt-in did not become available after identity verification: ' + panel()?.textContent?.slice(0, 500));
              save.click();
              for (let attempt = 0; attempt < 200 && !panel()?.textContent?.includes('Login-Cookies dieses Kontos geschützt'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!panel()?.textContent?.includes('Login-Cookies dieses Kontos geschützt')) throw new Error('F08 protected-login save did not report success: ' + panel()?.textContent?.slice(0, 500));
              return true;
            })()`);
            if (devAccountBrowser!.savedLoginStatus(f08Card.id).state !== 'saved') throw new Error('F08 protected-login state was not stored.');
            devAccountBrowser!.saveSeedConfig({ cardId: f08Card.id, path: '/__branchloom/accounts' });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const panel = document.querySelector('.card-drawer .dev-account-panel');
              if (!panel) throw new Error('F08 seed panel is missing.');
              const button = (label) => [...panel.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
              button('Status aktualisieren')?.click();
              for (let attempt = 0; attempt < 100 && button('Zielkonto prüfen')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const section = [...panel.querySelectorAll('details')].find((item) => item.querySelector('summary')?.textContent?.includes('Testkonto'));
              if (!section) throw new Error('F08 visible seed section is missing.');
              section.open = true;
              const check = button('Zielkonto prüfen');
              if (!check || check.disabled) throw new Error('F08 visible seed lookup is unavailable.');
              check.click();
              for (let attempt = 0; attempt < 100 && (!panel.textContent?.includes('Zielkonto fehlt') || !button('Jetzt anlegen') || button('Jetzt anlegen')?.disabled); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!panel.textContent?.includes('Zielkonto fehlt')) throw new Error('F08 visible seed lookup did not see the missing target.');
              const create = button('Jetzt anlegen');
              if (!create || create.disabled) throw new Error('F08 separate creation confirmation is missing.');
              create.click();
              for (let attempt = 0; attempt < 100 && !panel.textContent?.includes('Ziel-App hat die Kontoanlage bestätigt'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!panel.textContent?.includes('Ziel-App hat die Kontoanlage bestätigt')) throw new Error('F08 visible seed creation was not confirmed.');
              return true;
            })()`);
            if (devAccountBrowser!.lastSeedAttempt(f08Card.id, secondAccount.id)?.state !== 'created' || (await devAccountBrowser!.checkSeed(f08Card.id, secondAccount.id)).state !== 'exists') throw new Error('F08 target account did not persist in the live preview.');
            await userWindow.loadURL(`${f08SecondRun.url}login?as=user`);
            if ((await devAccountBrowser!.probe(f08Other.id)).state !== 'verified') throw new Error('F08 second real-session login failed.');
            await devAccountBrowser!.forget(firstAccount.id);
            if ((await devAccountBrowser!.probe(f08Card.id)).state !== 'login-required' || (await devAccountBrowser!.probe(f08Other.id)).state !== 'verified') throw new Error('F08 forget cleared the wrong account session.');
            const grantRevision = devAccountOverview(smokeStore, { projectId: f08Project.id, cardId: f08Other.id }).cardRevision;
            assignDevAccount(smokeStore, { projectId: f08Project.id, cardId: f08Other.id, accountId: null, expectedCardRevision: grantRevision });
            devAccountBrowser!.closeCard(f08Other.id);
            try { await devAccountBrowser!.probe(f08Other.id); throw new Error('F08 revoked account remained available.'); }
            catch (reason) { if (!(reason instanceof Error) || !reason.message.includes('No development account')) throw reason; }
            devEnvironmentRunner!.stop(f08FirstRun.id);
            devEnvironmentRunner!.stop(f08SecondRun.id);
            devAccountBrowser!.closeAll();
            await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              for (let attempt = 0; attempt < 100 && !document.querySelector('.project-switcher-trigger:not(.is-compact)'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const trigger = document.querySelector('.project-switcher-trigger:not(.is-compact)');
              if (!(trigger instanceof HTMLButtonElement)) throw new Error('F01 guided project picker is missing.');
              trigger.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.project-switcher-panel'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const projectButton = [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')]
                .find((item) => item.textContent?.includes('Meilenstein-Vorschau'));
              if (!(projectButton instanceof HTMLButtonElement)) throw new Error('F01 guided project is missing from the visible picker.');
              projectButton.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('#project-select')?.value !== ${JSON.stringify(milestoneProjectId)}; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('#project-select')?.value !== ${JSON.stringify(milestoneProjectId)}) throw new Error('F01 visible project switch did not select the target project.');
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board')?.click();
              let card;
              for (let attempt = 0; attempt < 100 && !card; attempt++) {
                card = [...document.querySelectorAll('.task-card')].find((item) => item.textContent?.includes('Guided preview smoke card'));
                if (!card) await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!(card instanceof HTMLElement)) throw new Error('F01 guided card is not visible: ' + JSON.stringify({
                project: document.querySelector('#project-select')?.value, tasks: [...document.querySelectorAll('.task-card')].slice(0, 8).map((item) => item.textContent?.slice(0, 80)),
                board: document.querySelector('.board-view')?.textContent?.slice(0, 300),
              }));
              card.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer .card-dev-env'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const panel = document.querySelector('.card-drawer .card-dev-env');
              const inspect = [...(panel?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === 'Projektstand prüfen');
              if (!(inspect instanceof HTMLButtonElement)) throw new Error('F01 guided inspection action is missing.');
              inspect.click();
              for (let attempt = 0; attempt < 100 && !panel?.textContent?.includes('1 belegter Startvorschlag'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!panel?.textContent?.includes('1 belegter Startvorschlag') || !panel.textContent.includes('Einrichtung mit Agent besprechen')) throw new Error('F01 guided evidence did not render.');
              const start = [...panel.querySelectorAll('button')].find((item) => item.textContent?.includes('Für diese Karte starten'));
              if (!(start instanceof HTMLButtonElement) || start.disabled) throw new Error('F01 explicit start action is missing.');
              start.click();
              for (let attempt = 0; attempt < 100 && !panel.textContent?.includes('Bereit'); attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
              if (!panel.textContent?.includes('Bereit')) throw new Error('F01 synthetic preview did not become ready through the card action.');
              const audit = await window.studio.devEnvironmentAudit({ projectId: ${JSON.stringify(milestoneProjectId)}, cardId: ${JSON.stringify(guidedCard.id)} });
              if (!audit.some((item) => item.kind === 'start' && item.outcome === 'started')) throw new Error('F01 start approval receipt is missing.');
              const preview = [...panel.querySelectorAll('button')].find((item) => item.textContent?.includes('Vorschau öffnen'));
              if (!(preview instanceof HTMLButtonElement)) throw new Error('F01 ready preview action is missing.');
              const cardRun = await window.studio.cardDevEnvironment(${JSON.stringify(guidedCard.id)});
              if (!cardRun || cardRun.state !== 'ready') throw new Error('F01 card run changed before browser action.');
              preview.click();
              let state;
              for (let attempt = 0; attempt < 100; attempt++) {
                state = await window.studio.browserState();
                if (state.url === cardRun.url) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (state?.url !== cardRun.url) throw new Error('F01 card action opened the wrong browser tab.');
              return true;
            })()`);
            const guidedRun = devEnvironmentRunner!.card(guidedCard.id);
            if (!guidedRun || guidedRun.state !== 'ready' || !guidedRun.managed || !(await (await fetch(guidedRun.url)).text()).includes('Variant A')) throw new Error('F01 guided card preview opened the wrong app.');
            const otherRun = await startApprovedDevEnvironment(smokeStore, devEnvironmentRunner!, { cardId: guidedOther.id, expectedProfileFingerprint: guidedProfile.fingerprint });
            for (let attempt = 0; attempt < 100 && devEnvironmentRunner!.card(guidedOther.id)?.state === 'starting'; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
            if (devEnvironmentRunner!.card(guidedOther.id)?.state !== 'ready' || guidedRun.port === otherRun.port
              || !(await (await fetch(otherRun.url)).text()).includes('Variant B')) throw new Error('F01 second card did not reuse the profile on a distinct preview.');
            devEnvironmentRunner!.stop(guidedRun.id);
            if (!(await (await fetch(otherRun.url)).text()).includes('Variant B')) throw new Error('F01 stopping the first card stopped the second preview.');
            devEnvironmentRunner!.stop(otherRun.id);
            if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Trello-Smoke: Windows-Verschlüsselung ist nicht verfügbar.');
            const sealed = await safeStorage.encryptStringAsync('branchloom-trello-smoke');
            if ((await safeStorage.decryptStringAsync(sealed)).result !== 'branchloom-trello-smoke') throw new Error('Trello-Smoke: Windows-Verschlüsselung konnte nicht lesen.');
            const png = nativeImage.createFromBuffer(readFileSync(join(smokeDataDirectory!, 'wireframe-mobile.png')));
            const pixels = png.toBitmap();
            let hasDrawing = false;
            for (let offset = 4; offset < pixels.length; offset += 4) {
              if (pixels[offset] !== pixels[0] || pixels[offset + 1] !== pixels[1] || pixels[offset + 2] !== pixels[2]) { hasDrawing = true; break; }
            }
            if (png.isEmpty() || png.getSize().width !== 390 || png.getSize().height !== 844 || !hasDrawing) throw new Error('PNG-Export enthielt keine gezeichnete Mobile-Fläche.');
            writeFileSync(join(smokeDataDirectory!, 'src', 'SettingsDialog.tsx'), 'export function SettingsDialog() { return <dialog open>Settings</dialog>; }\n');
            execFileSync('git', ['-C', smokeDataDirectory!, 'add', '--', 'src/SettingsDialog.tsx'], { windowsHide: true });
            const f10Card = smokeStore.createCard({ projectId: smokeProject.id, columnId: smokeSnapshot.columns[0]!.id, title: 'Build settings dialog', description: 'Choose an existing settings dialog component.' });
            await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const cardId = ${JSON.stringify(f10Card.id)};
              const projectId = ${JSON.stringify(smokeProject.id)};
              const origin = ${JSON.stringify(qaUrl)};
              const wait = async (predicate, label) => {
                for (let i = 0; i < 300; i++) { const value = await predicate(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); }
                throw new Error('F10 UI smoke timed out: ' + label);
              };
              const trigger = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'visible project picker');
              trigger.click();
              const projectChoice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')].find((item) => item.getAttribute('aria-label') === 'Smoke-Projekt auswählen'), 'project picker choice');
              projectChoice.click();
              await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger')?.getAttribute('aria-label') === 'Projekt auswählen: Smoke-Projekt', 'selected project');
              const nav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board');
              if (!nav) throw new Error('F10 board navigation missing.');
              nav.click();
              const task = await wait(() => document.getElementById('board-card-' + cardId), 'card');
              task.click();
              const panel = await wait(() => document.querySelector('.card-drawer .card-component-choice'), 'component panel');
              panel.querySelector('summary')?.click();
              const suggest = await wait(() => [...panel.querySelectorAll('button')].find((button) => button.textContent?.includes('Aus Kartentext vorschlagen') && !button.disabled), 'suggest button');
              suggest.click();
              const suggestion = await wait(() => [...panel.querySelectorAll('.card-component-choice__suggestions li')].find((item) => item.textContent?.includes('SettingsDialog')), 'source-backed suggestion');
              if (!suggestion.textContent?.includes('src/SettingsDialog.tsx') || !suggestion.textContent.includes('SHA-256')) throw new Error('F10 suggestion source evidence missing.');
              suggestion.querySelector('button')?.click();
              const purpose = await wait(() => panel.querySelector('.card-component-choice__confirm input'), 'manual confirmation');
              const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!setInput) throw new Error('F10 input setter missing.');
              setInput.call(purpose, 'Use the existing settings dialog'); purpose.dispatchEvent(new Event('input', { bubbles: true }));
              const confirm = await wait(() => [...panel.querySelectorAll('.card-component-choice__confirm button')].find((button) => !button.disabled), 'confirm button');
              confirm.click();
              await wait(async () => (await window.studio.cardComponentChoiceState(cardId)).choices.length === 1, 'stored choice');
              for (const [label, path] of [['Compact', 'compact'], ['Wide', 'wide']]) {
                const capture = await wait(() => [...panel.querySelectorAll('button')].find((button) => button.textContent?.includes('Beispielroute als Variante erfassen') && !button.disabled), 'capture variant');
                capture.click();
                const form = await wait(() => panel.querySelector('.card-component-choice__variant-form'), 'variant form');
                const inputs = form.querySelectorAll('input');
                if (inputs.length !== 2) throw new Error('F10 variant form inputs missing.');
                setInput.call(inputs[0], label); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                setInput.call(inputs[1], origin + 'stories/dialog/' + path); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
                const submit = await wait(() => form.querySelector('button[type="submit"]:not(:disabled)'), 'variant submit');
                submit.click();
                await wait(async () => (await window.studio.cardComponentChoiceState(cardId)).choices[0]?.variants.some((item) => item.label === label), 'captured ' + label);
              }
              const state = await window.studio.cardComponentChoiceState(cardId);
              if (state.choices[0]?.variants.length !== 2 || !panel.textContent?.includes('Compact') || !panel.textContent.includes('Wide')) throw new Error('F10 two saved variants are not shown on the card.');
              const view = [...panel.querySelectorAll('.card-component-choice__snapshot button')][0];
              view?.click();
              await wait(() => panel.querySelector('.card-component-choice__snapshot img'), 'rendered screenshot');
              return true;
            })()`);

            const f10ReuseCard = smokeStore.createCard({ projectId: smokeProject.id, columnId: smokeSnapshot.columns[0]!.id, title: 'Reuse settings dialog' });
            await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const cardId = ${JSON.stringify(f10ReuseCard.id)};
              const wait = async (predicate, label) => { for (let i = 0; i < 300; i++) { const result = await predicate(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error('F10 library UI smoke timed out: ' + label); };
              const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
              picker.click();
              const project = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')].find((item) => item.getAttribute('aria-label') === 'Smoke-Projekt auswählen'), 'project');
              project.click();
              await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger')?.getAttribute('aria-label') === 'Projekt auswählen: Smoke-Projekt', 'selected project');
              const nav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board'), 'board navigation');
              nav.click();
              const task = await wait(() => document.getElementById('board-card-' + cardId), 'card');
              task.click();
              const panel = await wait(() => document.querySelector('.card-drawer .card-component-choice'), 'component panel');
              panel.querySelector('summary')?.click();
              const libraryButton = await wait(() => [...panel.querySelectorAll('button')].find((item) => item.textContent?.includes('Im Projekt verwendet')), 'library button');
              libraryButton.click();
              const source = await wait(() => [...panel.querySelectorAll('.card-component-choice__library li')].find((item) => item.textContent?.includes('SettingsDialog')), 'source row');
              if (!source.textContent?.includes('src/SettingsDialog.tsx') || !source.textContent.includes('SHA-256') || !source.textContent.includes('Compact') || !source.textContent.includes('Wide')) throw new Error('F10 project library omitted source or QA evidence.');
              const snapshot = [...source.querySelectorAll('button')].find((item) => item.textContent?.includes('Gerenderte Variante ansehen'));
              snapshot?.click();
              await wait(() => source.querySelector('.card-component-choice__snapshot img'), 'QA screenshot');
              const inspect = [...source.querySelectorAll('button')].find((item) => item.textContent?.includes('Für diese Karte prüfen'));
              if (!(inspect instanceof HTMLButtonElement) || inspect.disabled) throw new Error('F10 source cannot be inspected for another card.');
              inspect.click();
              const purpose = await wait(() => panel.querySelector('.card-component-choice__confirm input'), 'purpose');
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!setter) throw new Error('F10 input setter missing.');
              setter.call(purpose, 'Reuse the reviewed settings dialog'); purpose.dispatchEvent(new Event('input', { bubbles: true }));
              const confirm = await wait(() => [...panel.querySelectorAll('.card-component-choice__confirm button')].find((item) => !item.disabled), 'confirmation');
              confirm.click();
              const state = await wait(async () => { const current = await window.studio.cardComponentChoiceState(cardId); return current.choices.length ? current : null; }, 'saved choice');
              if (state.choices[0]?.name !== 'SettingsDialog' || state.choices[0]?.variants.length !== 0) throw new Error('F10 reuse copied old QA variants or saved the wrong source.');
              return true;
            })()`);
            await runF06VisibleSmoke(smokeWindow, smokeStore, milestoneProjectId);

            const f04SourceCard = smokeStore.createCard({ projectId: smokeProject.id, columnId: smokeSnapshot.columns[0]!.id, title: 'F04 source navigation' });
            const f04CandidateCard = smokeStore.createCard({ projectId: smokeProject.id, columnId: smokeSnapshot.columns[0]!.id, title: 'F04 candidate navigation' });
            const f04SourceText = 'Navigation must be visible at widths up to 768 px.';
            const f04CandidateText = 'Navigation must not be visible at widths up to 768 px.';
            const f04SourceCriterion = createCardCriterion(smokeStore, { cardId: f04SourceCard.id, text: f04SourceText }).at(-1)!;
            addRequirementClaim(smokeStore, { projectId: smokeProject.id, cardId: f04SourceCard.id, criterionId: f04SourceCriterion.id,
              component: 'Navigation', scope: 'Widths up to 768 px', property: 'Visibility', stance: 'required',
              expectedCardRevision: requirementConflictBoard(smokeStore, smokeProject.id).cardRevisions[f04SourceCard.id]! });
            const f04CandidateCriterion = createCardCriterion(smokeStore, { cardId: f04CandidateCard.id, text: f04CandidateText }).at(-1)!;
            await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const projectId = ${JSON.stringify(smokeProject.id)};
              const sourceId = ${JSON.stringify(f04SourceCard.id)};
              const candidateId = ${JSON.stringify(f04CandidateCard.id)};
              const criterionId = ${JSON.stringify(f04CandidateCriterion.id)};
              const sourceText = ${JSON.stringify(f04SourceText)};
              const candidateText = ${JSON.stringify(f04CandidateText)};
              const wait = async (predicate, label) => { for (let i = 0; i < 300; i++) { const result = await predicate(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error('F04 UI smoke timed out: ' + label); };
              const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'visible project picker');
              picker.click();
              const project = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')].find((item) => item.getAttribute('aria-label') === 'Smoke-Projekt auswählen'), 'project');
              project.click();
              await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger')?.getAttribute('aria-label') === 'Projekt auswählen: Smoke-Projekt', 'selected project');
              const nav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Entscheidungen'), 'decisions navigation');
              nav.click();
              const panel = await wait(() => document.querySelector('.requirement-conflicts'), 'conflict panel');
              const hint = await wait(() => [...panel.querySelectorAll('.requirement-conflicts__suggestions article')].find((item) => item.textContent?.includes(candidateText)), 'new criterion hint');
              if (!hint.textContent?.includes(sourceText) || !hint.textContent.includes('Vermuteter Bereich: Widths up to 768 px') || !hint.textContent.includes('Unsicher:')) throw new Error('F04 hint omitted source, scope or uncertainty.');
              [...hint.querySelectorAll('button')].find((item) => item.textContent?.includes('Regelmarkierung prüfen'))?.click();
              const setup = await wait(() => panel.querySelector('.requirement-conflicts__setup[open]'), 'review form');
              await wait(() => setup.querySelectorAll('select')[1]?.value === criterionId, 'candidate criterion selected');
              const mark = await wait(() => setup.querySelector('button[type="submit"]:not(:disabled)'), 'mark rule button');
              mark.click();
              const conflict = await wait(async () => (await window.studio.requirementConflictBoard(projectId)).conflicts.find((item) =>
                [item.left.cardId, item.right.cardId].includes(sourceId) && [item.left.cardId, item.right.cardId].includes(candidateId)), 'classified conflict');
              const row = await wait(() => [...panel.querySelectorAll('.requirement-conflicts__item')].find((item) => item.textContent?.includes(candidateText)), 'visible conflict');
              if (!row.textContent?.includes(sourceText)) throw new Error('F04 conflict omitted source statement.');
              [...row.querySelectorAll('button')].find((item) => item.textContent?.includes('Hinweis entscheiden'))?.click();
              const form = await wait(() => row.querySelector('.requirement-conflicts__resolve'), 'decision form');
              const choice = form.querySelector('select');
              const reason = form.querySelector('input');
              const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!choice || !reason || !selectSetter || !inputSetter) throw new Error('F04 decision controls missing.');
              selectSetter.call(choice, 'dismissed'); choice.dispatchEvent(new Event('change', { bubbles: true }));
              inputSetter.call(reason, 'Different navigation instances in this synthetic scenario.'); reason.dispatchEvent(new Event('input', { bubbles: true }));
              const submit = await wait(() => form.querySelector('button[type="submit"]:not(:disabled)'), 'decision submit');
              submit.click();
              await wait(async () => (await window.studio.requirementConflictBoard(projectId)).conflicts.find((item) => item.pairKey === conflict.pairKey)?.decision?.status === 'dismissed', 'saved dismissal');
              if ((await window.studio.cardCriteria(sourceId)).find((item) => item.id === conflict.left.criterionId || item.id === conflict.right.criterionId)?.text !== sourceText ||
                (await window.studio.cardCriteria(candidateId)).find((item) => item.id === criterionId)?.text !== candidateText) throw new Error('F04 decision changed a source statement.');
              return true;
            })()`);

            const f05Root = join(smokeDataDirectory!, 'f05-question-project');
            mkdirSync(f05Root, { recursive: true });
            const f05AgentPath = join(f05Root, 'question-agent.cjs');
            writeFileSync(join(f05Root, 'README.md'), 'Synthetic shared-question acceptance project.\n');
            writeFileSync(f05AgentPath, [
              "const { randomUUID } = require('node:crypto');",
              '(async () => {',
              '  const response = await fetch(process.env.BRANCHLOOM_AGENT_QUESTION_URL, {',
              "    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.BRANCHLOOM_AGENT_QUESTION_TOKEN, 'Content-Type': 'application/json' },",
              "    body: JSON.stringify({ requestId: randomUUID(), question: 'Can members edit archived projects?' })",
              '  });',
              "  if (!response.ok) throw new Error('Question tool returned ' + response.status);",
              "  console.log('F05_QUESTION_POSTED');",
              "  let received = '';",
              "  process.stdin.on('data', (chunk) => { received += String(chunk); if (received.includes('Archived projects are read-only.')) { console.log('F05_ANSWER_RECEIVED'); process.exit(0); } });",
              '  process.stdin.resume();',
              "})().catch((error) => { console.error(error.message); process.exit(1); });",
            ].join('\n'));
            execFileSync('git', ['init', '-q', f05Root], { windowsHide: true });
            execFileSync('git', ['-C', f05Root, 'add', 'README.md', 'question-agent.cjs'], { windowsHide: true });
            execFileSync('git', ['-C', f05Root, '-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic F05 project'], { windowsHide: true });
            const f05Project = smokeStore.createProject({ name: 'F05 Fragenprojekt', path: f05Root });
            setProjectRunCapacity(smokeStore, { projectId: f05Project.id, capacity: 3 });
            const f05Agent = smokeStore.saveAgent({ name: 'F05 synthetic question agent', kind: 'custom', command: 'node', args: [f05AgentPath], model: null, enabled: true });
            const f05Column = smokeStore.snapshot(f05Project.id).columns[0]!.id;
            const f05Cards = ['Frontend', 'Backend', 'Unrelated'].map((title) => smokeStore.createCard({ projectId: f05Project.id, columnId: f05Column, title }));
            const f05Runs = f05Cards.map((card) => runner!.start({ cardId: card.id, agentId: f05Agent.id, prompt: '', mode: 'one-shot', useWorktree: true }));
            let f05Questions = agentQuestions(smokeStore, f05Project.id);
            for (let attempt = 0; attempt < 200 && f05Questions.length < 3; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              f05Questions = agentQuestions(smokeStore, f05Project.id);
            }
            if (f05Questions.length !== 3 || f05Runs.some((run) => smokeStore.session(run.id).state !== 'running')) {
              throw new Error('F05 three live CLI questions were not available for the visible inbox test.');
            }
            await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const projectId = ${JSON.stringify(f05Project.id)};
              const firstIds = ${JSON.stringify(f05Questions.filter((item) => f05Cards.slice(0, 2).some((card) => card.id === item.cardId)).map((item) => item.id))};
              const thirdId = ${JSON.stringify(f05Questions.find((item) => item.cardId === f05Cards[2]!.id)!.id)};
              const wait = async (predicate, label) => {
                for (let i = 0; i < 300; i++) { const result = await predicate(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 50)); }
                throw new Error('F05 UI smoke timed out: ' + label);
              };
              const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
              picker.click();
              const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')].find((item) => item.getAttribute('aria-label') === 'F05 Fragenprojekt auswählen'), 'question project');
              choice.click();
              await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger')?.getAttribute('aria-label') === 'Projekt auswählen: F05 Fragenprojekt', 'selected question project');
              const nav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Entscheidungen'), 'Decisions navigation');
              nav.click();
              const panel = await wait(() => document.querySelector('.agent-questions'), 'question inbox');
              const suggestion = await wait(() => panel.querySelector('.agent-question-suggestions button'), 'sourced question suggestion');
              suggestion.click();
              const compose = await wait(() => panel.querySelector('.agent-question-compose'), 'recipient review');
              await wait(() => compose.querySelectorAll('.agent-question-recipients li').length === 3, 'three suggested recipients');
              const omit = compose.querySelector('button[aria-label="Frage von Unrelated abwählen"]');
              if (!omit) throw new Error('F05 unrelated recipient cannot be removed.');
              omit.click();
              await wait(() => compose.querySelectorAll('.agent-question-recipients li').length === 2, 'two reviewed recipients');
              if (!firstIds.every((id) => panel.querySelector('[data-agent-question-id="' + id + '"] input[type="checkbox"]')?.checked)
                || panel.querySelector('[data-agent-question-id="' + thirdId + '"] input[type="checkbox"]')?.checked) throw new Error('F05 recipient selection is incorrect.');
              const answer = compose.querySelector('textarea');
              const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (!answer || !setter) throw new Error('F05 answer editor missing.');
              setter.call(answer, 'Archived projects are read-only.'); answer.dispatchEvent(new Event('input', { bubbles: true }));
              const send = await wait(() => [...compose.querySelectorAll('button')].find((item) => item.textContent?.includes('Einmal beantworten') && !item.disabled), 'answer button');
              send.click();
              const saved = await wait(async () => {
                const rows = await window.studio.agentQuestions(projectId);
                return firstIds.every((id) => rows.find((item) => item.id === id)?.delivery === 'delivered') ? rows : null;
              }, 'two delivered answers');
              if (saved.find((item) => item.id === thirdId)?.answer !== null || saved.find((item) => item.id === thirdId)?.delivery !== 'open'
                || saved.filter((item) => firstIds.includes(item.id)).some((item) => item.answer !== 'Archived projects are read-only.' || item.answerSource !== 'user')
                || new Set(saved.filter((item) => firstIds.includes(item.id)).map((item) => item.answerId)).size !== 1) {
                throw new Error('F05 answer did not stay scoped to two original questions.');
              }
              await wait(() => firstIds.every((id) => panel.querySelector('[data-agent-question-id="' + id + '"]')?.textContent?.includes('An diese Sitzung zugestellt')), 'visible delivery status');
              return true;
            })()`);
            for (let attempt = 0; attempt < 100 && f05Runs.slice(0, 2).some((run) => smokeStore.session(run.id).state === 'running'); attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            if (f05Runs.slice(0, 2).some((run) => smokeStore.session(run.id).state !== 'exited' || !smokeStore.session(run.id).output.includes('F05_ANSWER_RECEIVED'))) {
              throw new Error('F05 live CLI recipients did not acknowledge the terminal message.');
            }
            runner!.stop(f05Runs[2]!.id);
            await runF03Acceptance(smokeWindow, smokeStore, smokeDataDirectory!);
            process.stdout.write('STUDIO_SMOKE_OK\n');
            app.quit();
          }).catch(failSmoke);
        });
        smokeWindow.webContents.reload();
      }).catch(failSmoke);
    }).catch(failSmoke); });
    window.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(`STUDIO_SMOKE_FAILED (${code}): ${description}`);
      app.exit(1);
    });
  }
  window.on('closed', () => { devAccountBrowser?.closeAll(); designInspector?.dispose(); designInspector = null; browser?.dispose(); browser = null; window = null; });
}

function configureReleaseUpdater(): void {
  // Forge ZIPs and source runs have no NSIS update feed. Only an installed
  // package containing electron-builder's update configuration can update.
  const supported = process.platform === 'win32' && app.isPackaged && !smoke && !devDataDirectory
    && existsSync(join(process.resourcesPath, 'app-update.yml'));
  if (supported) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.disableWebInstaller = true;
  }
  releaseUpdater = new ReleaseUpdateController(supported ? {
    check: async () => { await autoUpdater.checkForUpdates(); },
    download: async () => { await autoUpdater.downloadUpdate(); },
    install: () => autoUpdater.quitAndInstall(false, true),
    onAvailable: (callback) => { autoUpdater.on('update-available', (info) => callback(info.version)); },
    onCurrent: (callback) => { autoUpdater.on('update-not-available', callback); },
    onProgress: (callback) => { autoUpdater.on('download-progress', (info) => callback(info.percent)); },
    onError: (callback) => { autoUpdater.on('error', callback); },
  } : null, app.getVersion(), (state) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:release-update-state', state);
  }, () => {
    if (!store) return false;
    return !store.db.prepare(`SELECT 1 FROM sessions WHERE state = 'running'
      UNION ALL SELECT 1 FROM command_terminals WHERE state = 'running'
      UNION ALL SELECT 1 FROM dev_environment_runs WHERE state IN ('starting','ready')
      UNION ALL SELECT 1 FROM workflows WHERE state = 'running'
      UNION ALL SELECT 1 FROM project_queues WHERE state = 'running' LIMIT 1`).get();
  });
  if (supported) {
    releaseStartTimer = setTimeout(() => { void releaseUpdater.check(); }, 8_000);
    releaseStartTimer.unref();
    releaseCheckTimer = setInterval(() => { void releaseUpdater.check(); }, 6 * 60 * 60 * 1_000);
    releaseCheckTimer.unref();
  }
}

if (ownsSharedProfile) app.whenReady().then(async () => {
  const directory = app.getPath('userData');
  mkdirSync(directory, { recursive: true });
  store = new StudioStore(join(directory, 'studio.sqlite'));
  configureReleaseUpdater();
  agentCardMetadataBridge = new AgentCardMetadataBridge(store, (sessionId, cardId, kind) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:session-event', {
      sessionId, cardId, type: 'state', data: kind === 'question' ? 'Agent question recorded' : 'Card metadata updated', state: 'running',
    } satisfies SessionEvent);
  }, 0, (error) => console.error('[Branchloom] optional agent card metadata bridge unavailable', error));
  void agentCardMetadataBridge.start().catch(() => undefined);
  agentBrowserBridge = new AgentBrowserBridge(store, inspectAgentBrowserPage);
  void agentBrowserBridge.start().catch((error) => console.error('[Branchloom] optional agent browser bridge unavailable', error));
  installIpc();
  createWindow();
  integrationAutoTimer = setInterval(() => {
    if (!store) return;
    try { advanceAutomaticIntegrations(store); }
    catch (error) { console.error('[Branchloom] automatic integration scan failed', error); }
  }, 10_000);
  integrationAutoTimer.unref();
  app.on('activate', () => { if (!window) createWindow(); });
}).catch((error: unknown) => {
  console.error('[Branchloom] startup failed', error);
  app.quit();
});
else app.quit();

app.on('before-quit', () => {
  teamReviewHttp?.close();
  teamReviewHttp = null;
  tailnetReviewHttp?.close();
  tailnetReviewHttp = null;
  tailnetReviewIp = null;
  teamBoardHttp?.close();
  teamBoardHttp = null;
  tailnetBoardHttp?.close();
  tailnetBoardHttp = null;
  tailnetBoardIp = null;
  if (releaseStartTimer) clearTimeout(releaseStartTimer);
  if (releaseCheckTimer) clearInterval(releaseCheckTimer);
  if (integrationAutoTimer) clearInterval(integrationAutoTimer);
  trelloSignIn?.cancel();
  trelloSignIn = null;
  smokeQaServer?.close();
  smokeQaServer = null;
  queueEngine?.dispose();
  recoveryMonitor?.dispose();
  recoveryMonitor = null;
  browser?.dispose();
  browser = null;
  designInspector?.dispose();
  designInspector = null;
  runner?.dispose();
  runner = null;
  agentCardMetadataBridge?.close();
  agentCardMetadataBridge = null;
  agentBrowserBridge?.close();
  agentBrowserBridge = null;
  commandRunner?.dispose();
  commandRunner = null;
  devEnvironmentRunner?.dispose();
  devEnvironmentRunner = null;
  devAccountBrowser?.dispose();
  devAccountBrowser = null;
  apiContractHttp?.dispose();
  apiContractHttp = null;
  store?.close();
  store = null;
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => {
  if (smokeDataDirectory) {
    try { rmSync(smokeDataDirectory, { recursive: true, force: true }); } catch { /* OS may still hold a cache file briefly. */ }
  }
});
