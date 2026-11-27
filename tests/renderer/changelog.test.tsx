import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChangelogReport, ChangelogView, changelogMarkdown, changelogOverview } from '../../src/renderer/components/ChangelogView';
import { changelogDigest } from '../../src/renderer/changelog-digest';
import type { ProjectChangelog } from '../../src/shared/changelog';

const result: ProjectChangelog = {
  projectId: 'synthetic', period: 'day', since: '2026-01-02T12:00:00.000Z', until: '2026-01-03T12:00:00.000Z',
  checkedAt: '2026-01-03T12:00:00.000Z', state: 'ready', head: 'a'.repeat(40), moreAvailable: false,
  scope: 'head', issues: [], checkedWorktrees: 0,
  qaObservations: [], qaTotal: 0, reviewActivity: [], reviewTotal: 0, integrationReceipts: [], integrationTotal: 0,
  commits: [{ hash: 'a'.repeat(40), committedAt: '2026-01-03T10:00:00Z', subject: 'Fix <script>unsafe</script>' }],
};

describe('changelog presentation', () => {
  it('renders a labelled period control and refresh without fabricated commit data during loading', () => {
    const html = renderToStaticMarkup(createElement(ChangelogView, { projectId: 'synthetic' }));
    expect(html).toContain('Git-Historie wird gelesen');
    expect(html).toContain('Letzte 24 Stunden');
    expect(html).toContain('Projekt-HEAD + Karten-Worktrees');
    expect(html).toContain('Gesamten Bericht kopieren');
    expect(html).toContain('Ereignisse');
    expect(html).not.toContain('Fix &lt;script&gt;');
  });

  it('names actual card and branch sources and exposes incomplete reads in copied Markdown', () => {
    const report = changelogMarkdown({ ...result, scope: 'saved-worktrees', checkedWorktrees: 1,
      commits: [{ ...result.commits[0]!, sources: [{ kind: 'project-head' }, { kind: 'card-worktree', cardId: 'card-1', cardTitle: 'UI <fix>', branch: 'cards/ui' }] }],
      issues: [{ cardId: 'card-2', cardTitle: 'Missing checkout', reason: 'Gespeicherter Karten-Worktree fehlt.' }], moreAvailable: true });
    expect(report).toContain('1 verifizierte gespeicherte Karten-Worktrees');
    expect(report).toContain('Quellen: Projekt-HEAD; UI &lt;fix&gt; · cards/ui');
    expect(report).toContain('Unvollständige Quellen:');
    expect(report).toContain('Missing checkout: Gespeicherter Karten-Worktree fehlt.');
  });

  it('copies a deterministic Markdown report with full Git hashes and an explicit evidence limit', () => {
    const markdown = changelogMarkdown(result);
    expect(markdown).toContain('Fix &lt;script&gt;unsafe&lt;/script&gt;');
    expect(markdown).toContain(`(${result.head}, 2026-01-03T10:00:00Z)`);
    expect(markdown).toContain('Ein gespeicherter Integrations-Test-/Reviewbeleg gilt nur für die oben ausdrücklich als passend markierte Quell-/Ziel-/Kartenrevision.');
    expect(changelogMarkdown({ ...result, commits: [], state: 'no-repository' })).toContain('kein Git-Repository');
  });

  it('separates project HEAD from card-only work and names saved QA/review activity without inventing approval', () => {
    const head = { ...result.commits[0]!, sources: [{ kind: 'project-head' as const }] };
    const cardOnly = { hash: 'b'.repeat(40), committedAt: '2026-01-03T09:00:00Z', subject: 'Build card preview',
      sources: [{ kind: 'card-worktree' as const, cardId: 'card-1', cardTitle: 'Preview card', branch: 'cards/preview' }] };
    const report: ProjectChangelog = { ...result, scope: 'saved-worktrees', commits: [head, cardOnly], checkedWorktrees: 1,
      qaObservations: [{ id: 'qa-1', cardId: 'card-1', cardTitle: 'Preview card', endedAt: '2026-01-03T11:00:00Z', status: 'failed', checkoutState: 'clean', checkoutHead: cardOnly.hash }], qaTotal: 1,
      reviewActivity: [{ cardId: 'card-1', cardTitle: 'Preview card', count: 2, lastAt: '2026-01-03T11:30:00Z' }], reviewTotal: 2 };
    const overview = changelogOverview(report);
    expect(overview.head.map((item) => item.hash)).toEqual([head.hash]);
    expect(overview.worktreeOnly.map((item) => item.hash)).toEqual([cardOnly.hash]);
    expect(overview.cards.map((item) => [item.title, item.commits.length])).toEqual([['Preview card', 1]]);
    const html = renderToStaticMarkup(createElement(ChangelogReport, { result: report }));
    expect(html).toContain('Die letzten 24 Stunden');
    expect(html).toContain('Karten-Branch');
    expect(html).toContain('Preview card');
    expect(html).toContain('mit Fehlern');
    expect(html).toContain('Diff-Kommentare sind keine Review-Freigabe');
    expect(html).toContain('1 gespeicherte Karten-Worktrees geprüft.');
    expect(html).toContain('<details class="changelog-detail">');
    const digest = changelogDigest(report);
    expect(digest.days[0]?.entries.map((entry) => entry.kind)).toEqual(['review', 'qa', 'head', 'worktree']);
    expect(digest.days[0]?.entries.find((entry) => entry.kind === 'qa')?.source).toContain('nicht an Commit gebunden');
    const markdown = changelogMarkdown(report);
    expect(markdown).toContain('## Zeitlicher Verlauf');
    expect(markdown).toContain('1 sichtbare Commits nur in geprüften Karten-Worktrees');
    expect(markdown).toContain('Bericht qa-1');
    expect(markdown).toContain('2 Kommentare');
  });

  it('marks truncated source activity without converting QA or comments into a release claim', () => {
    const report: ProjectChangelog = { ...result, scope: 'saved-worktrees', qaTotal: 3, reviewTotal: 2,
      qaObservations: [{ id: 'qa-1', cardId: 'card-1', cardTitle: 'Login', endedAt: '2026-01-03T11:00:00Z', status: 'failed', checkoutState: 'dirty', checkoutHead: null }],
      reviewActivity: [{ cardId: 'card-1', cardTitle: 'Login', lastAt: '2026-01-03T09:00:00Z', count: 1 }] };
    const digest = changelogDigest(report, 1);
    expect(digest.visible).toBe(1);
    expect(digest.hidden).toBe(2);
    const html = renderToStaticMarkup(createElement(ChangelogReport, { result: report }));
    expect(html).toContain('Weitere QA- oder Review-Einträge liegen außerhalb');
    expect(html).toContain('QA beobachtet eine lokale Vorschau');
    expect(html).not.toContain('freigegeben');
  });

  it('leads with verified card delivery and opens exact local evidence without claiming QA proved the shipped page', () => {
    const report: ProjectChangelog = { ...result, integrationTotal: 2, integrationReceipts: [
      { cardId: 'card-1', cardTitle: 'Login flow', integratedAt: '2026-01-03T11:00:00Z', integratedHead: 'b'.repeat(40),
        targetBranch: 'main', approvalMode: 'manual', headPresence: 'present',
        review: { reviewedAt: '2026-01-03T10:00:00Z', matchesSnapshot: true },
        test: { scriptName: 'test:integration', state: 'passed', exitCode: 0, matchesSnapshot: true } },
      { cardId: 'card-2', cardTitle: 'Stale work', integratedAt: '2026-01-03T09:00:00Z', integratedHead: 'c'.repeat(40),
        targetBranch: 'main', approvalMode: 'automatic', headPresence: 'missing',
        review: { reviewedAt: '2026-01-03T08:00:00Z', matchesSnapshot: false }, test: null },
    ], qaTotal: 1, qaObservations: [{ id: 'qa-1', cardId: 'card-1', cardTitle: 'Login flow',
      endedAt: '2026-01-03T11:30:00Z', status: 'failed', checkoutState: 'clean', checkoutHead: 'b'.repeat(40) }],
      reviewTotal: 1, reviewActivity: [{ cardId: 'card-1', cardTitle: 'Login flow', count: 1, lastAt: '2026-01-03T11:40:00Z' }] };
    const html = renderToStaticMarkup(createElement(ChangelogReport, { result: report, onOpenCard: () => {}, onOpenQaReport: () => {} }));
    expect(html).toContain('Was übernommen wurde');
    expect(html).toContain('Im aktuellen Projekt-HEAD nachweisbar');
    expect(html).toContain('Nicht mehr im aktuellen Projekt-HEAD');
    expect(html).toContain('test:integration: passed, Exit 0');
    expect(html).toContain('Was geprüft wurde');
    expect(html).toContain('Login flow');
    expect(html).not.toContain('disabled=""');
    const markdown = changelogMarkdown(report);
    expect(markdown).toContain('## Karten-Übernahmen');
    expect(markdown).toContain('Nicht mehr im aktuellen Projekt-HEAD');
    expect(markdown).toContain('QA beobachtet eine lokale Vorschau');
    expect(markdown).toContain('Karten-Übernahme');
    expect(html).toContain('Karten-Übernahme');
    expect(html).toContain('Karte öffnen');
    expect(html).toContain('QA-Bericht öffnen');
  });

  it('filters the timeline by recorded event kind or Git author without assigning team identity', () => {
    const authored = { ...result.commits[0]!, authorName: 'Alex Git', sources: [{ kind: 'project-head' as const }] };
    const other = { hash: 'b'.repeat(40), committedAt: '2026-01-03T09:00:00Z', subject: 'Other work', authorName: 'Jo Git',
      sources: [{ kind: 'project-head' as const }] };
    const report: ProjectChangelog = { ...result, commits: [authored, other],
      qaObservations: [{ id: 'qa-1', cardId: 'card-1', cardTitle: 'Browser check', endedAt: '2026-01-03T11:00:00Z',
        status: 'passed', checkoutState: 'clean', checkoutHead: authored.hash }], qaTotal: 1 };
    const code = changelogDigest(report, 18, { kind: 'code', gitAuthor: 'Alex Git' });
    expect(code.days.flatMap((day) => day.entries).map((entry) => [entry.kind, entry.title])).toEqual([['head', authored.subject]]);
    const qa = changelogDigest(report, 18, { kind: 'qa' });
    expect(qa.days.flatMap((day) => day.entries).map((entry) => entry.title)).toEqual(['Browser check']);
    const html = renderToStaticMarkup(createElement(ChangelogReport, { result: report, gitAuthor: 'Alex Git', eventFilter: 'code' }));
    expect(html).toContain('Git-Autor: Alex Git');
    expect(html).toContain('keine belegte Personenzuordnung');
    expect(html).toContain('Commit unten ansehen');
    expect(html).not.toContain('changelog-event-qa');
    expect(html).not.toContain('changelog-event-head"><time dateTime="2026-01-03T09:00:00Z"');
  });
});
