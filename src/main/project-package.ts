import type { CardPriority, ColumnTint } from '../shared/types';
import { cardLabels, cardPriority } from '../shared/card-metadata';

export const PROJECT_PACKAGE_LIMIT = 8 * 1024 * 1024;

export interface ProjectPackage {
  format: 'jarvis-studio-project';
  version: 1 | 2;
  name: string;
  columns: Array<{ id: string; name: string; position: number; tint?: ColumnTint }>;
  cards: Array<{ id: string; columnId: string; title: string; description: string; priority: CardPriority; labels: string[]; position: number; archived: boolean; criteria?: string[] }>;
  notes: Array<{ title: string; body: string; tags: string[]; links: string[] }>;
  workflows: Array<{ name: string; cardIds: string[]; steps: Array<{ columnId: string; requireApproval: boolean }> }>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} ist kein Objekt.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /\0/.test(value)) throw new Error(`${label} ist ungültig.`);
  return value;
}

function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} enthält zu viele oder ungültige Einträge.`);
  return value;
}

function index(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) throw new Error(`${label} ist ungültig.`);
  return value as number;
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} enthält doppelte IDs.`);
}

/** Parse a user-selected, untrusted JSON package. No path or executable setting is accepted. */
export function parseProjectPackage(json: string): ProjectPackage {
  if (Buffer.byteLength(json, 'utf8') > PROJECT_PACKAGE_LIMIT) throw new Error('Projektpaket ist größer als 8 MiB.');
  let raw: unknown;
  try { raw = JSON.parse(json) as unknown; } catch { throw new Error('Projektpaket enthält kein gültiges JSON.'); }
  const root = object(raw, 'Projektpaket');
  if (root.format !== 'jarvis-studio-project' || (root.version !== 1 && root.version !== 2)) throw new Error('Unbekanntes Projektpaket-Format oder Version.');
  const version = root.version;
  const name = string(root.name, 'Projektname', 200).trim();
  const columns = list(root.columns, 'Spalten', 100).map((item) => {
    const row = object(item, 'Spalte');
    if (row.tint !== undefined && !['default', 'lilac', 'blue', 'sand', 'coral'].includes(String(row.tint))) throw new Error('Spaltenfarbe ist ungültig.');
    return { id: string(row.id, 'Spalten-ID', 100), name: string(row.name, 'Spaltenname', 200).trim(), position: index(row.position, 'Spaltenposition'), tint: row.tint as ColumnTint | undefined };
  });
  if (!columns.length) throw new Error('Projektpaket enthält keine Spalten.');
  unique(columns.map((item) => item.id), 'Spalten');
  const columnIds = new Set(columns.map((item) => item.id));
  const cards = list(root.cards, 'Karten', 10_000).map((item) => {
    const row = object(item, 'Karte');
    const columnId = string(row.columnId, 'Karten-Spalte', 100);
    if (!columnIds.has(columnId)) throw new Error('Karte verweist auf eine fehlende Spalte.');
    if (typeof row.archived !== 'boolean') throw new Error('Kartenarchivstatus ist ungültig.');
    const criteria = version === 1 ? [] : list(row.criteria, 'Abnahmekriterien', 30).map((value) => string(value, 'Abnahmekriterium', 500).trim());
    return { id: string(row.id, 'Karten-ID', 100), columnId, title: string(row.title, 'Kartentitel', 200).trim(), description: string(row.description, 'Kartenbeschreibung', 30_000, true), priority: cardPriority(row.priority), labels: cardLabels(row.labels), position: index(row.position, 'Kartenposition'), archived: row.archived, criteria };
  });
  unique(cards.map((item) => item.id), 'Karten');
  const cardIds = new Set(cards.map((item) => item.id));
  const notes = list(root.notes, 'Notizen', 5_000).map((item) => {
    const row = object(item, 'Notiz');
    const tags = list(row.tags, 'Tags', 50).map((value) => string(value, 'Tag', 80).trim());
    const links = list(row.links, 'Links', 100).map((value) => string(value, 'Link', 200).trim());
    return { title: string(row.title, 'Notiztitel', 200).trim(), body: string(row.body, 'Notiztext', 200_000, true), tags, links };
  });
  const workflows = list(root.workflows, 'Workflows', 2_000).map((item) => {
    const row = object(item, 'Workflow');
    const ids = list(row.cardIds, 'Workflow-Karten', 10_000).map((value) => string(value, 'Workflow-Karten-ID', 100));
    if (!ids.length || ids.some((id) => !cardIds.has(id))) throw new Error('Workflow verweist auf eine fehlende Karte.');
    unique(ids, 'Workflow-Karten');
    const steps = list(row.steps, 'Workflow-Schritte', 30).map((value) => {
      const step = object(value, 'Workflow-Schritt');
      const columnId = string(step.columnId, 'Workflow-Spalte', 100);
      if (!columnIds.has(columnId)) throw new Error('Workflow verweist auf eine fehlende Spalte.');
      if (typeof step.requireApproval !== 'boolean') throw new Error('Workflow-Freigabe ist ungültig.');
      return { columnId, requireApproval: step.requireApproval };
    });
    if (!steps.length) throw new Error('Workflow enthält keine Schritte.');
    return { name: string(row.name, 'Workflow-Name', 200).trim(), cardIds: ids, steps };
  });
  return { format: 'jarvis-studio-project', version, name, columns, cards, notes, workflows };
}
