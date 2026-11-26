import type { QueueResultItem, QueueResults } from './queue-results';

const line = (value: string) => value.replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ').trim();
const md = (value: string) => line(value).replace(/[\\`*_\[\]<>|]/gu, '\\$&');

function appendCard(lines: string[], item: QueueResultItem): void {
  lines.push(`- **${md(item.cardTitle)}** (Karte \`${md(item.cardId)}\`, Workflow \`${md(item.workflowId)}\`) · ${item.status}`);
  lines.push(`  - Route: ${md(item.workflowName)}; aktualisiert: ${md(item.updatedAt)}.`);
  lines.push(item.lastSession
    ? `  - Sitzung \`${md(item.lastSession.id)}\`: ${item.lastSession.state}; Exit ${item.lastSession.exitCode ?? 'unbekannt'}.`
    : '  - Sitzung: kein gespeicherter Beleg.');
  if (item.test) lines.push(`  - Gespeicherter npm-Test #${item.test.id}: \`npm run ${md(item.test.scriptName)}\` · ${item.test.state}; Quelle \`${md(item.test.sourceHead)}\`, Zielbasis \`${md(item.test.targetHead)}\`; Ende ${item.test.endedAt ? md(item.test.endedAt) : 'nicht gespeichert'}; Queue-Start ${item.test.queueActivationId ? `\`${md(item.test.queueActivationId)}\`` : 'nicht belegt'}.`);
  if (item.review) lines.push(`  - Gespeicherter Diff-Review: Quelle \`${md(item.review.sourceHead)}\`, Zielbasis \`${md(item.review.targetHead)}\`; bestätigt ${md(item.review.reviewedAt)}; ${item.review.matchesSavedIntegration ? 'passt zum gespeicherten Integrationsstand' : 'gehört zu einer früheren vorbereiteten Revision'}.`);
  if (item.qa) lines.push(`  - Gespeicherte Browser-QA \`${md(item.qa.id)}\`: ${item.qa.status}; ${item.qa.viewportWidth > 0 && item.qa.viewportHeight > 0 ? `${item.qa.viewportWidth} × ${item.qa.viewportHeight} px` : 'Prüfgröße unbekannt'}; DOM ${item.qa.pageCheck}; Ende ${md(item.qa.endedAt)}.`);
  if (item.integration) lines.push(`  - Gespeicherte Integration #${item.integration.id}: ${item.integration.state}; Quelle \`${md(item.integration.sourceHead)}\`, Zielbranch ${md(item.integration.targetBranch)}${item.integration.integratedHead ? `, gespeicherter Ziel-Commit \`${md(item.integration.integratedHead)}\`` : ''}; Freigabe ${item.integration.approvalMode ?? 'nicht gespeichert'}.`);
}

/** A bounded copy of the current read model; saved evidence is not revalidated here. */
export function queueResultsMarkdown(results: QueueResults, generatedAt = new Date().toISOString()): string {
  const activation = results.latestActivation;
  const items = activation ? results.latestItems : results.items;
  const counts = activation?.counts ?? results.counts;
  const lines = [activation ? '# Letzter Queue-Start' : '# Queue-Historie', '',
    `Erstellt: ${md(generatedAt)}`, `Projekt-ID: \`${md(results.projectId)}\``];
  if (activation) lines.push(`Start-ID: \`${md(activation.id)}\``, `Beginn: ${md(activation.startedAt)}`,
    `Ende: ${activation.endedAt ? md(activation.endedAt) : 'läuft oder wartet'}`,
    `Laufstatus: ${activation.endState ?? 'aktiv'}${activation.endReason ? ` · ${md(activation.endReason)}` : ''}`,
    `Gewählte Frist: ${activation.runUntil ? md(activation.runUntil) : 'keine'}`);
  lines.push(`Karten: ${activation?.total ?? results.total} · abgeschlossen ${counts.done} · Prüfung nötig ${counts['needs-attention']} · laufend ${counts.running} · zurückgestellt ${counts.skipped} · ausstehend ${counts.pending}`,
    '', '## Karten');
  if (!items.length) lines.push('Keine Karte in diesem Start beansprucht.');
  for (const item of items) appendCard(lines, item);
  if (activation ? results.latestTruncated : results.truncated)
    lines.push('', `Nur die ${items.length} neuesten Karten dieser Auswahl sind enthalten.`);
  lines.push('', 'Eine abgeschlossene Route ist kein Test- oder Merge-Nachweis. Test-, Review-, Browser-QA- und Integrationsangaben sind gespeicherte Kartenbelege; der aktuelle Git-Stand und die vom Dev-Server ausgelieferte Codeversion wurden für diese Zusammenfassung nicht erneut geprüft.');
  return `${lines.join('\n')}\n`;
}
