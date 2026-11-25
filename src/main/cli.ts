import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative as relativePath, resolve } from 'node:path';
import { spawn as spawnPty, type IPty } from 'node-pty';
import type { AgentCapability, AgentDetection, AgentPreset, Column, ColumnEffort, Session, SessionEvent } from '../shared/types';
import { columnSettings } from '../shared/column-settings';
import { StudioStore } from './store';
import { ensureCardWorktree } from './git-worktree';
import { cardRunGate, reserveCardSession } from './parallel-runs';
import { buildAntigravityArgs } from './antigravity';
import { CodexJsonlOutput } from './codex-jsonl';
import { approvedCardWireframeContext } from './card-wireframe';
import { assertCardApiContractResume, cardApiContractContext, recordSessionApiContract } from './api-contract';
import { assertCardWireframeReady } from './card-wireframe-gate';
import { captureRunGit, recordSessionLaunch, recordSessionPromptWrite, recordSessionVersion } from './session-evidence';
import { currentTaskRevisionContext, recordTaskRevisionInLaunch } from './task-revisions';
import type { PromptDelivery, RunSource } from '../shared/session-evidence';
import { assertSafeModelContext } from './sensitive-content';
import type { AgentCardMetadataBridge } from './agent-card-metadata-bridge';
import type { AgentBrowserBridge } from './agent-browser-bridge';

const DONE_MARKER = '[JARVIS_STEP_DONE]';
export { DONE_MARKER };

/** Search PATH, never the untrusted project working directory. */
export function resolveExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (isAbsolute(command)) return existsSync(command) && statSync(command).isFile() ? command : null;
  if (/[\\/]/.test(command) || !/^[\w.-]+$/.test(command)) return null;
  const suffixes = process.platform === 'win32' && !extname(command) ? ['.exe', '.com', '.cmd', '.bat', ''] : [''];
  for (const directory of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${command}${suffix}`);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  // The official Windows installer puts agy here. Electron may retain an old PATH.
  if (process.platform === 'win32' && /^agy(?:\.exe)?$/i.test(command) && env.LOCALAPPDATA) {
    const installed = join(env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe');
    if (existsSync(installed) && statSync(installed).isFile()) return installed;
  }
  if (process.platform !== 'win32' && command === 'agy' && env.HOME) {
    const installed = join(env.HOME, '.local', 'bin', 'agy');
    if (existsSync(installed) && statSync(installed).isFile()) return installed;
  }
  return null;
}

export interface AgentLauncher { executable: string; prefixArgs: string[] }

export function codexPackagedArgs(launcher: AgentLauncher, agent: Pick<AgentPreset, 'kind'>, platform: NodeJS.Platform = process.platform): string[] {
  // The Windows app-bundled Codex binary needs its standalone transport when
  // launched without the desktop app server. Other CLI installations keep
  // their existing launch arguments for compatibility with older versions.
  return agent.kind === 'codex' && platform === 'win32'
    && /[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]app[\\/]resources[\\/]codex\.exe$/i.test(launcher.executable)
    ? ['--no-daemon'] : [];
}

/**
 * Narrowly recognized CMD shims are read as data, never executed.
 * Only their verified native or Node/JS target is used.
 */
export function resolveAgentLauncher(command: string, env: NodeJS.ProcessEnv = process.env): AgentLauncher | null {
  const executable = resolveExecutable(command, env);
  if (!executable) return null;
  if (/\.bat$/i.test(executable)) return null;
  if (!/\.cmd$/i.test(executable)) return { executable, prefixArgs: [] };
  let source: string;
  try { source = readFileSync(executable, 'utf8'); } catch { return null; }
  if (source.length > 32_000 || /\0/.test(source)) return null;
  // The official Codex WinGet installation adds a two-line codex.cmd pointing
  // at its native binary. Accept only that exact wrapper and package layout.
  if (process.platform === 'win32' && env.LOCALAPPDATA && basename(executable).toLowerCase() === 'codex.cmd'
    && resolve(dirname(executable)).toLowerCase() === resolve(env.LOCALAPPDATA, 'CodexCLI', 'bin').toLowerCase()) {
    const wrapper = source.replace(/^\uFEFF/, '').trimEnd().match(/^@echo off\r?\n"([^"\r\n]+)" %\*$/i);
    if (wrapper && isAbsolute(wrapper[1]!)) {
      const target = resolve(wrapper[1]!);
      const packageRoot = resolve(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
      const packagePath = relativePath(packageRoot, target);
      if (/^OpenAI\.Codex_Microsoft\.WinGet\.Source_[^\\/]+[\\/]codex-[a-z0-9_-]+\.exe$/i.test(packagePath)
        && existsSync(target) && statSync(target).isFile()) return { executable: target, prefixArgs: [] };
    }
  }
  const last = source.trimEnd().split(/\r?\n/).at(-1) ?? '';
  // Both npm's %~dp0 and pnpm/Yarn's %dp0% forms are common. The prefix of
  // the last line may contain cmd's endLocal boilerplate; it is never run.
  const match = last.match(/"(?:%_prog%|%NODE_EXE%|%~dp0[\\/]node\.exe)"\s+"((?:%dp0%|%~dp0)[\\/][^"%]+\.(?:js|cjs|mjs))"\s+%\*\s*$/i);
  if (!match) return null;
  const relative = match[1]!.replace(/^%(?:dp0%|~dp0)[\\/]/i, '');
  const script = resolve(dirname(executable), relative);
  if (!existsSync(script) || !statSync(script).isFile()) return null;
  const localNode = join(dirname(executable), 'node.exe');
  const node = existsSync(localNode) ? localNode : resolveExecutable('node', env);
  return node && /\.exe$/i.test(node) ? { executable: node, prefixArgs: [script] } : null;
}

/** Never pass a command through a shell. Timeout and output bounds keep a broken CLI from blocking Electron. */
export function readVersion(launcher: AgentLauncher, timeoutMs = 8_000, env: NodeJS.ProcessEnv = process.env, args = ['--version']): Promise<{ status: 'ready' | 'timeout' | 'error'; version: string | null }> {
  return new Promise((resolveResult) => {
    let settled = false;
    let output = '';
    let child: ReturnType<typeof spawn>;
    const settle = (status: 'ready' | 'timeout' | 'error', version: string | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ status, version });
    };
    try {
      child = spawn(launcher.executable, [...launcher.prefixArgs, ...args], { shell: false, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolveResult({ status: 'error', version: null });
      return;
    }
    const timer = setTimeout(() => { child.kill(); settle('timeout'); }, timeoutMs);
    const collect = (chunk: Buffer) => { if (output.length < 4_096) output += chunk.toString('utf8').slice(0, 4_096 - output.length); };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', () => settle('error'));
    child.on('close', (code) => {
      const firstLine = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
      settle(code === 0 ? 'ready' : 'error', code === 0 ? firstLine.slice(0, 160) || null : null);
    });
  });
}

async function inspectAgent(kind: AgentPreset['kind'], command: string, env: NodeJS.ProcessEnv, profileId?: string): Promise<AgentDetection> {
  const launcher = resolveAgentLauncher(command, env);
  if (!launcher) return { kind, command, profileId, available: false, version: null, status: 'missing' };
  // Custom programs and renamed executables are only resolved. Running arbitrary user-configured code just to draw this screen would be surprising.
  const binary = kind === 'antigravity' ? 'agy' : kind;
  if (kind === 'custom' || !new RegExp(`^${binary}(?:\\.(?:exe|cmd))?$`, 'i').test(basename(command))) return { kind, command, profileId, available: true, version: null, status: 'found' };
  // On Windows, agy 1.5.13 can take over 12 seconds to answer --version.
  const result = await readVersion(launcher, kind === 'antigravity' ? 20_000 : 8_000, env);
  return { kind, command, profileId, available: result.status === 'ready', ...result };
}

export async function detectAgents(profiles: AgentPreset[] = [], env: NodeJS.ProcessEnv = process.env): Promise<AgentDetection[]> {
  const standard = (['codex', 'claude', 'gemini', 'antigravity'] as const).map((kind) => inspectAgent(kind, kind === 'antigravity' ? 'agy' : kind, env));
  const saved = profiles.map((profile) => inspectAgent(profile.kind, profile.command, env, profile.id));
  return Promise.all([...standard, ...saved]);
}

function codexWorkflowProfileArgs(profileArgs: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < profileArgs.length; index += 1) {
    const arg = profileArgs[index]!;
    if (arg === '--dangerously-bypass-approvals-and-sandbox') {
      throw new Error('Unbeaufsichtigte Codex-Workflows erlauben keinen Sandbox-Bypass.');
    }
    if (arg === '--approve-for-me') continue;
    if (arg === '--sandbox' || arg === '-s') {
      const mode = profileArgs[++index];
      if (mode !== 'workspace-write') throw new Error('Codex-Workflows mit automatischer Freigabe benötigen die workspace-write-Sandbox.');
      continue;
    }
    if (arg.startsWith('--sandbox=') || arg.startsWith('-s=')) {
      if (arg.slice(arg.indexOf('=') + 1) !== 'workspace-write') throw new Error('Codex-Workflows mit automatischer Freigabe benötigen die workspace-write-Sandbox.');
      continue;
    }
    // A stored interactive profile may contain --cd, --add-dir or -c options
    // that broaden an unattended run. Only these path-neutral flags carry over;
    // model and effort are supplied by the validated step/column settings.
    if (arg === '--ignore-user-config' || arg === '--skip-git-repo-check') {
      normalized.push(arg);
      continue;
    }
    throw new Error(`Unbeaufsichtigter Codex-Workflow unterstützt Profilargument ${arg} nicht. Modell und Effort in den Schritt-Einstellungen setzen.`);
  }
  return normalized;
}

export function buildAgentArgs(agent: AgentPreset, prompt: string, mode: 'interactive' | 'one-shot', finalMessagePath?: string, column?: { model: string | null; effort: ColumnEffort | null }): string[] {
  if (agent.kind === 'antigravity') return buildAntigravityArgs(agent.args, prompt, mode, column?.model ?? agent.model, column?.effort ?? null);
  const args = mode === 'one-shot' && agent.kind === 'codex'
    ? ['exec', '--json', '--approve-for-me', ...(finalMessagePath ? ['--output-last-message', finalMessagePath] : []), ...codexWorkflowProfileArgs(agent.args)]
    : [...agent.args];
  const model = column?.model ?? agent.model;
  if (model) {
    if (agent.kind === 'codex' || agent.kind === 'gemini') args.push('-m', model);
    else if (agent.kind === 'claude') args.push('--model', model);
  }
  if (column?.effort) {
    if (agent.kind !== 'codex') throw new Error('Spalten-Effort wird derzeit nur für Codex und Antigravity CLI unterstützt.');
    args.push('-c', `model_reasoning_effort=${JSON.stringify(column.effort)}`);
  }
  // These CLIs accept a positional or -p prompt in one-shot mode and exit when
  // the turn ends. A custom adapter can place {prompt} in one of its args.
  if (mode === 'one-shot' && (agent.kind === 'claude' || agent.kind === 'gemini') && prompt) args.push('-p', prompt);
  else if (agent.kind === 'codex' && prompt) args.push(prompt);
  else if (mode === 'one-shot' && agent.kind === 'custom') {
    const index = args.findIndex((arg) => arg.includes('{prompt}'));
    if (index >= 0) args[index] = args[index]!.replace('{prompt}', prompt);
  }
  return args;
}

/** An explicit card/workflow agent only inherits column overrides when it is that column's agent. */
export function columnLaunchOverrides(column: Pick<Column, 'agentId' | 'model' | 'effort'>, agent: AgentPreset) {
  return agent.id === column.agentId ? columnSettings(agent.kind, column.model, column.effort) : { model: null, effort: null };
}

/** A step replaces only the explicitly set field; null inherits the column/profile default. */
export function stepLaunchOverrides(
  column: Pick<Column, 'agentId' | 'model' | 'effort'>,
  agent: AgentPreset,
  step?: { model: string | null; effort: ColumnEffort | null },
) {
  const inherited = columnLaunchOverrides(column, agent);
  return { model: step?.model ?? inherited.model, effort: step?.effort ?? inherited.effort };
}

/** A synchronous PTY spawn exception before a process handle exists. */
export class AgentSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentSpawnError';
  }
}

/** A single explicit user-triggered agent run. No shell string or implicit restart. */
export class SessionRunner {
  private readonly processes = new Map<string, IPty>();
  private readonly pendingFirstTurn = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly finalMessageFiles = new Map<string, { directory: string; path: string }>();
  private readonly stopAwaitingExit = new Set<string>();
  private disposed = false;
  constructor(
    private readonly store: StudioStore,
    private readonly emit: (event: SessionEvent) => void,
    private readonly onFinished: (session: Session, finalMessage: string | null) => void,
    private readonly metadataBridge?: AgentCardMetadataBridge | null,
    private readonly browserBridge?: AgentBrowserBridge | null,
  ) {}

  start(input: { cardId: string; agentId?: string; prompt?: string; mode?: 'interactive' | 'one-shot'; useWorktree?: boolean; overrides?: { model: string | null; effort: ColumnEffort | null } }): Session {
    const card = this.store.card(input.cardId);
    if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    assertCardWireframeReady(this.store, card.id);
    const project = this.store.project(card.projectId);
    const column = this.store.column(card.columnId);
    const agentId = input.agentId ?? column.agentId;
    if (!agentId) throw new Error('Choose an agent for this card or column');
    const agent = this.store.agent(agentId);
    if (!agent.enabled) throw new Error(`${agent.name} is disabled`);
    const launchOverrides = stepLaunchOverrides(column, agent, input.overrides);
    if (this.store.latestSession(card.id)?.state === 'running') throw new Error('An agent is already running for this card');
    if (this.store.projectQueue(project.id).state === 'running' && this.store.activeSessionForProject(project.id)) {
      throw new Error('In der aktiven Projektwarteschlange läuft bereits ein Agent.');
    }
    if (input.useWorktree === true && this.store.activeCommandTerminalForCard(card.id)) throw new Error('Im Karten-Worktree läuft noch ein Befehlsterminal. Zuerst stoppen.');
    const launcher = resolveAgentLauncher(agent.command);
    if (!launcher) throw new Error(`Agent executable or supported Node shim not found: ${agent.command}`);
    const taskPrompt = (input.prompt ?? `Work on this card in the selected project.\n\nTitle: ${card.title}\n\n${card.description}`).trim();
    const wireframeContext = approvedCardWireframeContext(this.store, { projectId: card.projectId, cardId: card.id });
    const apiContractContext = cardApiContractContext(this.store, card.id);
    const taskRevision = currentTaskRevisionContext(this.store, card.id);
    const metadataInstructions = this.metadataBridge?.instructions(card.projectId) ?? '';
    const browserInstructions = this.browserBridge?.instructions(card.projectId) ?? '';
    const prompt = taskPrompt ? taskPrompt + (taskRevision ? `\n\n${taskRevision.text}` : '')
      + (wireframeContext ? `\n\n${wireframeContext}` : '') + (apiContractContext ? `\n\n${apiContractContext}` : '')
      + metadataInstructions + browserInstructions : '';
    if (prompt.length > 30_000) throw new Error('Agent prompt exceeds 30000 characters');
    assertSafeModelContext([
      { field: 'Kartentitel', text: card.title },
      { field: 'Kartenbeschreibung', text: card.description },
      ...(input.prompt === undefined ? [] : [{ field: 'Agentenauftrag', text: input.prompt }]),
      ...(wireframeContext ? [{ field: 'freigegebener Wireframe', text: wireframeContext }] : []),
      ...(apiContractContext ? [{ field: 'API contract', text: apiContractContext }] : []),
    ]);
    const preflight = cardRunGate(this.store, card.id, input.useWorktree === true ? undefined : null);
    if (!preflight.canStart) throw new Error(preflight.blockers[0]!);
    if (input.useWorktree === true && preflight.running.some((row) => !row.worktreePath)) {
      throw new Error('Parallele Kartenläufe brauchen für jede laufende Karte einen eigenen Git-Worktree.');
    }
    const worktree = input.useWorktree === true ? ensureCardWorktree(this.store, card.id) : null;
    const runGit = captureRunGit(worktree?.cwd ?? project.path, worktree ? 'card-worktree' : 'project');
    const row = reserveCardSession(this.store, { cardId: card.id, agentId, worktreePath: worktree?.path });
    if (prompt) recordSessionApiContract(this.store, card.id, row.id);
    let finalFile: { directory: string; path: string } | null = null;
    try {
      if (input.mode === 'one-shot' && agent.kind === 'codex') {
        const directory = mkdtempSync(join(tmpdir(), 'jarvis-studio-final-'));
        finalFile = { directory, path: join(directory, 'last-message.txt') };
      }
    } catch (error) {
      this.store.finishSession(row.id, 'failed', null);
      throw error;
    }
    if (finalFile) this.finalMessageFiles.set(row.id, finalFile);
    let args: string[];
    let metadataEnv: Record<string, string> = {};
    let browserEnv: Record<string, string> = {};
    try {
      metadataEnv = this.metadataBridge?.environment(row.id) ?? {};
      browserEnv = this.browserBridge?.environment(row.id) ?? {};
      args = [...launcher.prefixArgs, ...codexPackagedArgs(launcher, agent), ...buildAgentArgs(agent, prompt, input.mode ?? 'interactive', finalFile?.path, launchOverrides)];
    } catch (error) {
      this.metadataBridge?.revoke(row.id);
      this.browserBridge?.revoke(row.id);
      this.readAndClearFinalMessage(row.id);
      this.store.finishSession(row.id, 'failed', null);
      throw error;
    }
    let child: IPty;
    try {
      child = spawnPty(launcher.executable, args, {
        cwd: worktree?.cwd ?? project.path,
        env: { ...process.env, BRANCHLOOM_CARD_METADATA_URL: '', BRANCHLOOM_CARD_METADATA_TOKEN: '', BRANCHLOOM_AGENT_QUESTION_URL: '', BRANCHLOOM_AGENT_QUESTION_TOKEN: '', BRANCHLOOM_AGENT_BROWSER_URL: '', BRANCHLOOM_AGENT_BROWSER_TOKEN: '', ...metadataEnv, ...browserEnv, TERM: 'xterm-256color' } as Record<string, string>,
        cols: 100, rows: 30,
        name: 'xterm-256color',
      });
    } catch (error) {
      this.metadataBridge?.revoke(row.id);
      this.browserBridge?.revoke(row.id);
      this.readAndClearFinalMessage(row.id);
      const failed = this.store.finishSession(row.id, 'failed', null);
      this.emit({ sessionId: row.id, cardId: row.cardId, type: 'state', data: String(error), state: failed.state });
      // Only this synchronous spawn path proves that no PTY was returned.
      // Missing CLIs, nonzero exits and uncertain outcomes never enter retry.
      throw new AgentSpawnError(error instanceof Error ? error.message : String(error));
    }
    this.attachProcess(row, child, agent.kind === 'codex' && input.mode === 'one-shot');
    const mode = input.mode ?? 'interactive';
    const sources: RunSource[] = input.prompt === undefined ? ['card-text'] : input.prompt.trim() ? ['manual-prompt'] : [];
    if (prompt && wireframeContext) sources.push('approved-wireframe');
    if (prompt && apiContractContext) sources.push('api-contract');
    const promptDelivery: PromptDelivery = !prompt ? 'none' : agent.kind === 'codex' || agent.kind === 'antigravity' || (mode === 'one-shot' && ['claude', 'gemini'].includes(agent.kind))
      || (mode === 'one-shot' && agent.kind === 'custom' && agent.args.some((arg) => arg.includes('{prompt}')))
      ? 'argv' : mode === 'interactive' ? 'pty-delayed' : 'unknown';
    if (taskRevision && promptDelivery === 'argv') {
      try { recordTaskRevisionInLaunch(this.store, { revisionId: taskRevision.id, cardId: card.id, sessionId: row.id }); }
      catch { this.store.appendOutput(row.id, '\n[Task revision launch evidence could not be saved; delivery is unverified.]\n'); }
    }
    try {
      recordSessionLaunch(this.store, { sessionId: row.id, agentName: agent.name, agentKind: agent.kind, mode,
        configuredModel: launchOverrides.model ?? agent.model, configuredEffort: launchOverrides.effort,
        profileArgumentCount: agent.args.length, sources, promptDelivery, git: runGit });
      this.checkVersion(row.id, agent, launcher);
    } catch { this.store.appendOutput(row.id, '\n[Startbeleg konnte nicht gespeichert werden.]\n'); }
    if ((input.mode ?? 'interactive') === 'interactive' && agent.kind !== 'codex' && agent.kind !== 'antigravity' && prompt) {
      // The CLI may show a login/trust prompt. Delay only the initial turn;
      // users can inspect the terminal and send it manually if it did not land.
      this.pendingFirstTurn.set(row.id, setTimeout(() => {
        try {
          if (this.processes.has(row.id)) {
            child.write(`${prompt}\r`);
            recordSessionPromptWrite(this.store, row.id);
            if (taskRevision) {
              try { recordTaskRevisionInLaunch(this.store, { revisionId: taskRevision.id, cardId: card.id, sessionId: row.id }); }
              catch { this.store.appendOutput(row.id, '\n[Task revision PTY evidence could not be saved; delivery is unverified.]\n'); }
            }
          }
        } catch { this.store.appendOutput(row.id, '\n[Verzögerte PTY-Eingabe konnte nicht belegt werden.]\n'); }
        finally { this.pendingFirstTurn.delete(row.id); }
      }, 1_500));
    }
    return row;
  }

  /** Resume a CLI-confirmed conversation ID, or open the cwd-scoped picker. Never replay the old prompt. */
  resumeCodex(input: { sessionId: string; picker?: boolean }): Session {
    const previous = this.store.session(input.sessionId);
    if (previous.state === 'running') throw new Error('Laufende Sitzung kann nicht erneut geöffnet werden.');
    const card = this.store.card(previous.cardId);
    if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    const project = this.store.project(card.projectId);
    const agent = this.store.agent(previous.agentId);
    if (agent.kind !== 'codex' || !agent.enabled) throw new Error('Fortsetzen wird derzeit nur für einen aktivierten Codex-Agenten unterstützt.');
    if (this.store.latestSession(card.id)?.state === 'running') throw new Error('Auf dieser Karte läuft bereits ein Agent.');
    if (this.store.projectQueue(project.id).state === 'running') throw new Error('Die Projektwarteschlange zuerst pausieren, bevor ein Codex-Gespräch manuell fortgesetzt wird.');
    if (previous.worktreePath && this.store.activeCommandTerminalForCard(card.id)) throw new Error('Im Karten-Worktree läuft noch ein Befehlsterminal. Zuerst stoppen.');
    assertCardApiContractResume(this.store, card.id, previous.id);
    const launcher = resolveAgentLauncher(agent.command);
    if (!launcher) throw new Error(`Codex executable or supported Node shim not found: ${agent.command}`);
    if (previous.worktreePath && this.store.cardWorktree(card.id)?.path !== previous.worktreePath) throw new Error('Der ursprüngliche Karten-Worktree ist nicht mehr verknüpft.');
    const preflight = cardRunGate(this.store, card.id, previous.worktreePath ?? null);
    if (!preflight.canStart) throw new Error(preflight.blockers[0]!);
    const worktree = previous.worktreePath ? ensureCardWorktree(this.store, card.id) : null;
    if (previous.worktreePath && worktree?.path !== previous.worktreePath) throw new Error('Der ursprüngliche Karten-Worktree stimmt nicht mehr überein.');
    const runGit = captureRunGit(worktree?.cwd ?? project.path, worktree ? 'card-worktree' : 'project');
    const exactId = input.picker === true ? null : previous.codexThreadId ?? null;
    const row = reserveCardSession(this.store, { cardId: card.id, agentId: agent.id, worktreePath: worktree?.path, codexThreadId: exactId });
    recordSessionApiContract(this.store, card.id, row.id);
    let child: IPty;
    try {
      const metadataEnv = this.metadataBridge?.environment(row.id) ?? {};
      const browserEnv = this.browserBridge?.environment(row.id) ?? {};
      // An exact ID is linked only from Codex's structured thread.started
      // event. The picker remains available when no ID is proven or the user
      // chooses it. Neither path selects --last or sends an old prompt.
      child = spawnPty(launcher.executable, [...launcher.prefixArgs, ...codexPackagedArgs(launcher, agent), 'resume', ...(exactId ? [exactId] : ['--include-non-interactive'])], {
        cwd: worktree?.cwd ?? project.path,
        env: { ...process.env, BRANCHLOOM_CARD_METADATA_URL: '', BRANCHLOOM_CARD_METADATA_TOKEN: '', BRANCHLOOM_AGENT_QUESTION_URL: '', BRANCHLOOM_AGENT_QUESTION_TOKEN: '', BRANCHLOOM_AGENT_BROWSER_URL: '', BRANCHLOOM_AGENT_BROWSER_TOKEN: '', ...metadataEnv, ...browserEnv, TERM: 'xterm-256color' } as Record<string, string>,
        cols: 100, rows: 30,
        name: 'xterm-256color',
      });
    } catch (error) {
      this.metadataBridge?.revoke(row.id);
      this.browserBridge?.revoke(row.id);
      const failed = this.store.finishSession(row.id, 'failed', null);
      this.emit({ sessionId: row.id, cardId: row.cardId, type: 'state', data: String(error), state: failed.state });
      throw error;
    }
    this.attachProcess(row, child);
    this.recordCapability(row.id, 'resume');
    try {
      recordSessionLaunch(this.store, { sessionId: row.id, agentName: agent.name, agentKind: agent.kind, mode: 'resume',
        configuredModel: agent.model, configuredEffort: null, profileArgumentCount: agent.args.length,
        sources: [exactId ? 'codex-resume-id' : 'codex-resume-picker'], promptDelivery: 'resume', git: runGit });
      this.checkVersion(row.id, agent, launcher);
    } catch { this.store.appendOutput(row.id, '\n[Startbeleg konnte nicht gespeichert werden.]\n'); }
    return row;
  }

  private checkVersion(sessionId: string, agent: AgentPreset, launcher: AgentLauncher): void {
    const binary = agent.kind === 'antigravity' ? 'agy' : agent.kind;
    if (agent.kind === 'custom' || !new RegExp(`^${binary}(?:\\.(?:exe|cmd))?$`, 'i').test(basename(agent.command))) return;
    void readVersion(launcher, agent.kind === 'antigravity' ? 20_000 : 8_000).then((result) => {
      try { recordSessionVersion(this.store, sessionId, result.status, result.version); }
      catch { /* A closed profile cannot receive a late diagnostic result. */ }
    });
  }

  private recordCapability(sessionId: string, capability: AgentCapability): void {
    // A diagnostic write must not turn an already started agent into an IPC failure.
    try { this.store.recordAgentCapability(sessionId, capability); } catch { /* The operation remains visible in the session. */ }
  }

  private attachProcess(row: Session, child: IPty, codexJson = false): void {
    const decoder = codexJson ? new CodexJsonlOutput() : null;
    this.processes.set(row.id, child);
    this.emit({ sessionId: row.id, cardId: row.cardId, type: 'state', data: 'Agent started', state: 'running' });
    this.recordCapability(row.id, 'start');
    child.onData((data) => {
      if (this.disposed || this.store.session(row.id).state !== 'running') return;
      const parsed = decoder?.feed(data);
      if (parsed?.threadId) {
        try { this.store.linkCodexThread(row.id, parsed.threadId); }
        catch (reason) { parsed.display += `Codex-Gespräch konnte nicht zugeordnet werden: ${reason instanceof Error ? reason.message : String(reason)}\r\n`; }
      }
      const display = parsed?.display ?? data;
      if (!display) return;
      this.store.appendOutput(row.id, display);
      this.emit({ sessionId: row.id, cardId: row.cardId, type: 'output', data: display });
    });
    child.onExit(({ exitCode }) => {
      const tail = decoder?.flush();
      if (tail && !this.disposed && this.store.session(row.id).state === 'running') {
        if (tail.threadId) {
          try { this.store.linkCodexThread(row.id, tail.threadId); }
          catch { /* The terminal still reports the CLI's event; stale or contradictory IDs are not linked. */ }
        }
        if (tail.display) {
          this.store.appendOutput(row.id, tail.display);
          this.emit({ sessionId: row.id, cardId: row.cardId, type: 'output', data: tail.display });
        }
      }
      const pending = this.pendingFirstTurn.get(row.id);
      if (pending) clearTimeout(pending);
      this.pendingFirstTurn.delete(row.id);
      this.processes.delete(row.id);
      this.metadataBridge?.revoke(row.id);
      this.browserBridge?.revoke(row.id);
      const finalMessage = this.readAndClearFinalMessage(row.id);
      if (this.disposed) return;
      const current = this.store.session(row.id);
      if (this.stopAwaitingExit.delete(row.id) && current.state === 'stopped') this.recordCapability(row.id, 'stop');
      if (current.state !== 'running') return;
      const state = exitCode === 0 ? 'exited' : 'failed';
      const finished = this.store.finishSession(row.id, state, exitCode);
      this.emit({ sessionId: row.id, cardId: row.cardId, type: 'state', data: `Agent exited (${exitCode})`, state });
      this.onFinished(finished, finalMessage);
    });
  }

  writeRaw(input: { sessionId: string; data: string }): void {
    const child = this.processes.get(input.sessionId);
    if (!child || this.store.session(input.sessionId).state !== 'running') throw new Error('Sitzung läuft nicht mehr.');
    if (typeof input.data !== 'string' || !input.data || input.data.length > 4096) throw new Error('Terminaleingabe muss zwischen 1 und 4096 Zeichen lang sein.');
    child.write(input.data);
    this.recordCapability(input.sessionId, 'input');
  }

  send(input: { sessionId: string; text: string }): void {
    const child = this.processes.get(input.sessionId);
    if (!child) throw new Error('Session is not running');
    if (!input.text.trim() || input.text.length > 10_000 || /\0/.test(input.text)) throw new Error('Message must be 1-10000 characters');
    child.write(`${input.text}\r`);
    this.recordCapability(input.sessionId, 'input');
  }

  resize(input: { sessionId: string; cols: number; rows: number }): void {
    if (!Number.isInteger(input.cols) || !Number.isInteger(input.rows) || input.cols < 20 || input.cols > 300 || input.rows < 5 || input.rows > 100) {
      throw new Error('Terminalgröße muss zwischen 20–300 Spalten und 5–100 Zeilen liegen.');
    }
    const child = this.processes.get(input.sessionId);
    if (!child || this.store.session(input.sessionId).state !== 'running') throw new Error('Sitzung läuft nicht mehr.');
    if (child.cols !== input.cols || child.rows !== input.rows) child.resize(input.cols, input.rows);
  }

  /** An in-memory PTY handle proves only that this app still owns the local process. */
  hasLiveProcess(sessionId: string): boolean { return this.processes.has(sessionId); }

  stop(sessionId: string): void {
    const child = this.processes.get(sessionId);
    if (!child) throw new Error('Session is not running');
    const session = this.store.session(sessionId);
    this.store.finishSession(sessionId, 'stopped', null);
    this.metadataBridge?.revoke(sessionId);
    this.browserBridge?.revoke(sessionId);
    this.processes.delete(sessionId);
    const pending = this.pendingFirstTurn.get(sessionId);
    if (pending) clearTimeout(pending);
    this.pendingFirstTurn.delete(sessionId);
    this.stopAwaitingExit.add(sessionId);
    child.kill();
    this.emit({ sessionId, cardId: session.cardId, type: 'state', data: 'Agent stopped', state: 'stopped' });
  }

  dispose(): void {
    this.disposed = true;
    for (const [sessionId, child] of [...this.processes]) {
      const pending = this.pendingFirstTurn.get(sessionId);
      if (pending) clearTimeout(pending);
      this.pendingFirstTurn.delete(sessionId);
      this.processes.delete(sessionId);
      this.metadataBridge?.revoke(sessionId);
      this.browserBridge?.revoke(sessionId);
      this.stopAwaitingExit.delete(sessionId);
      // Closing the app is not an explicit user stop of this card. The child
      // may already have made a change, so require review after the next start.
      try { this.store.interruptSessionOnShutdown(sessionId); }
      finally {
        child.kill();
        this.readAndClearFinalMessage(sessionId);
      }
    }
  }

  private readAndClearFinalMessage(sessionId: string): string | null {
    const record = this.finalMessageFiles.get(sessionId);
    if (!record) return null;
    this.finalMessageFiles.delete(sessionId);
    let message: string | null = null;
    try { message = readFileSync(record.path, 'utf8'); } catch { /* No final response was produced. */ }
    try { rmSync(record.directory, { recursive: true, force: true }); } catch { /* Locked until the child exits. */ }
    return message;
  }
}
