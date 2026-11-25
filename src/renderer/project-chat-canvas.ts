import type { ProjectChatReply, ProjectChatSuggestion } from '../shared/project-chat';
import type { StudioAPI, WhiteboardNode } from '../shared/types';

/** Prepare a bounded, explicitly saved whiteboard note from an edited chat outline. */
export function prepareChatCanvasNode(projectId: string, reply: ProjectChatReply | null, draft: ProjectChatSuggestion | null) {
  if (!reply || !draft || draft.kind !== 'canvas' || reply.index.projectId !== projectId || !reply.sources.length) {
    throw new Error('Der Canvas-Entwurf hat keine gültigen Projektbelege. Stelle die Frage erneut.');
  }
  const title = draft.title.trim();
  const body = draft.body.trim();
  if (!title || title.length > 120) throw new Error('Der Whiteboard-Titel muss 1 bis 120 Zeichen enthalten.');
  if (!body) throw new Error('Der Whiteboard-Text darf nicht leer sein.');
  if (!reply.index.indexedAt || !Number.isFinite(Date.parse(reply.index.indexedAt))) {
    throw new Error('Der Indexstand dieser Antwort ist nicht belegt. Stelle die Frage erneut.');
  }
  const steps = draft.steps.map((step) => step.trim()).filter(Boolean);
  const citations = reply.sources.map((source) => JSON.stringify(`${source.kind}:${source.sourceId}`));
  const description = [
    body,
    steps.length ? `Schritte:\n${steps.map((step) => `- ${step}`).join('\n')}` : '',
    `Im Gespräch angezeigte Belege (Index ${reply.index.indexedAt}):\n${citations.map((id) => `- ${id}`).join('\n')}`,
    'Diese Quellen belegen den später bearbeiteten Entwurf nicht automatisch.',
  ].filter(Boolean).join('\n\n');
  if (description.length > 2000) throw new Error(`Der Whiteboard-Text ist zu lang (${description.length}/2000 Zeichen). Kürze Beschreibung oder Schritte.`);
  return { title, description };
}

/** Place a new note in the first unoccupied part of the saved board. */
export function nextChatCanvasPosition(nodes: Pick<WhiteboardNode, 'x' | 'y'>[]): { x: number; y: number } {
  for (let slot = 0; slot <= nodes.length; slot++) {
    const x = 40 + (slot % 4) * 320;
    const y = 40 + Math.floor(slot / 4) * 210;
    if (nodes.every((node) => Math.abs(node.x - x) >= 180 || Math.abs(node.y - y) >= 120)) return { x, y };
  }
  return { x: 40, y: 40 + (nodes.length + 1) * 210 };
}

/** Recheck the active project after the read, immediately before the only write. */
export async function savePreparedChatCanvasNode(
  api: Pick<StudioAPI, 'whiteboard' | 'createWhiteboardNode'>, projectId: string,
  title: string, description: string, isActiveProject: () => boolean,
): Promise<WhiteboardNode> {
  const board = await api.whiteboard(projectId);
  if (!isActiveProject()) throw new Error('Das Projekt wurde gewechselt. Die Skizze wurde nicht gespeichert.');
  return api.createWhiteboardNode({ projectId, title, description, ...nextChatCanvasPosition(board.nodes) });
}
