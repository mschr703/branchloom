import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { projectChangelog } from './changelog';
import { worktreeRepositoryKey } from './git-worktree';
import type { StudioStore } from './store';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function commit(cwd: string, contents: string): string {
  writeFileSync(join(cwd, 'flow.txt'), contents);
  git(cwd, ['add', '--', 'flow.txt']);
  git(cwd, ['-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic changelog flow']);
  return git(cwd, ['rev-parse', 'HEAD']);
}

/** An isolated renderer/IPC/Git acceptance for persisted changelog receipts. */
export async function runChangelogVisibleSmoke(window: BrowserWindow, store: StudioStore, root: string): Promise<void> {
  const repo = join(root, 'changelog-repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  const base = commit(repo, 'base\n');
  const landed = commit(repo, 'landed\n');
  const project = store.createProject({ name: 'Changelog Smoke', path: repo });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Changelog evidence card' });
  const fingerprint = 'f'.repeat(64);
  const now = new Date().toISOString();
  const item = store.db.prepare(`INSERT INTO integration_items
    (project_id,card_id,repository_key,target_branch,source_head,target_head,card_fingerprint,preview_token,state,reason,created_at,updated_at,integrated_head,approval_mode)
    VALUES (?,?,?,?,?,?,?,NULL,'integrated',NULL,?,?,?,'manual')`)
    .run(project.id, card.id, worktreeRepositoryKey(repo), git(repo, ['branch', '--show-current']), landed, base, fingerprint, now, now, landed);
  store.db.prepare(`INSERT INTO integration_reviews (item_id,card_id,source_head,target_head,card_fingerprint,reviewed_at)
    VALUES (?,?,?,?,?,?)`).run(item.lastInsertRowid, card.id, landed, base, fingerprint, now);
  store.db.prepare(`INSERT INTO integration_test_runs
    (item_id,card_id,source_head,target_head,card_fingerprint,script_name,script_hash,state,exit_code,output_tail,started_at,ended_at)
    VALUES (?,?,?,?,?,'test:smoke','synthetic-script','passed',0,'synthetic',?,?)`)
    .run(item.lastInsertRowid, card.id, landed, base, fingerprint, now, now);

  const first = await projectChangelog(store, project.id, 'week');
  if (first.integrationReceipts[0]?.headPresence !== 'present' || !first.integrationReceipts[0]?.review?.matchesSnapshot
    || !first.integrationReceipts[0]?.test?.matchesSnapshot) throw new Error('Saved receipt was not bound to the current Git HEAD and matching checks.');

  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (condition, label) => {
      for (let i = 0; i < 160; i++) {
        const value = await condition();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Changelog UI timeout: ' + label + ' / ' + document.body.textContent?.slice(-600));
    };
    const select = await wait(() => document.querySelector('#project-select'), 'project selector');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(project.id)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => document.querySelector('.sidebar')?.textContent?.includes('Changelog Smoke'), 'selected project');
    const nav = await wait(() => [...document.querySelectorAll('.sidebar button')].find((button) => button.textContent?.trim() === 'Changelog'), 'changelog navigation');
    nav.click();
    const deliveries = await wait(() => document.querySelector('.changelog-deliveries')?.textContent?.includes('Changelog evidence card')
      ? document.querySelector('.changelog-deliveries') : null, 'saved receipt');
    if (!deliveries.textContent.includes('Im aktuellen Projekt-HEAD nachweisbar')
      || !deliveries.textContent.includes('Diff: für diesen Stand geprüft')
      || !deliveries.textContent.includes('test:smoke: passed, Exit 0')) throw new Error('Changelog lost current or matching evidence.');
    deliveries.querySelector('button.changelog-source-link')?.click();
    await wait(() => document.querySelector('.card-drawer')?.textContent?.includes('Changelog evidence card'), 'linked card');
    return true;
  })()`);

  git(repo, ['reset', '--hard', base]);
  const afterReset = await projectChangelog(store, project.id, 'week');
  if (afterReset.integrationReceipts[0]?.headPresence !== 'missing') throw new Error('Rewound HEAD was still reported as integrated.');
}
