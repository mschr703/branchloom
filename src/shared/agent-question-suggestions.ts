import type { AgentQuestion, AgentQuestionSuggestion } from './agent-questions';

const COMMON_WORDS = new Set([
  'a', 'an', 'and', 'are', 'be', 'by', 'can', 'could', 'do', 'does', 'for', 'how', 'in', 'is', 'it',
  'may', 'of', 'on', 'or', 'our', 'should', 'the', 'their', 'these', 'this', 'to', 'we', 'what', 'when',
  'which', 'who', 'would', 'you', 'allowed', 'allow',
  'als', 'auch', 'bei', 'das', 'dem', 'den', 'der', 'die', 'dürfen', 'darf', 'ein', 'eine', 'einen',
  'einer', 'erlaubt', 'für', 'haben', 'hat', 'im', 'ist', 'kann', 'können', 'mit', 'muss', 'müssen',
  'oder', 'sind', 'soll', 'sollen', 'und', 'unsere', 'unser', 'von', 'wann', 'was', 'welche', 'welcher',
  'werden', 'wie', 'wir', 'wird', 'zu', 'zum', 'zur',
].map((word) => word.normalize('NFKD').replace(/\p{M}/gu, '')));
const NEGATION = /\b(?:not|never|no|without|cannot|can't|won't|shouldn't|mustn't|don't|doesn't|isn't|aren't|nicht|nie|kein(?:e|en|em|er|es)?|ohne|verboten)\b/iu;
const OBLIGATION = /\b(?:must|required|should|muss|müssen|soll|sollen|erforderlich)\b/iu;
const ABILITY = /\b(?:can|could|may|allowed|allow|kann|können|darf|dürfen|erlaubt)\b/iu;

function terms(question: string): string[] {
  return [...new Set((question.toLocaleLowerCase('de-DE').normalize('NFKD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((term) => term.length >= 3 && !COMMON_WORDS.has(term)))];
}

function intent(question: string): 'obligation' | 'ability' | 'other' {
  if (OBLIGATION.test(question)) return 'obligation';
  if (ABILITY.test(question)) return 'ability';
  return 'other';
}

function numbers(question: string): string {
  return (question.match(/\b\d+\b/g) ?? []).sort().join(',');
}

function sharedTerms(left: AgentQuestion, right: AgentQuestion): string[] {
  if (left.projectId !== right.projectId || left.cardId === right.cardId ||
    NEGATION.test(left.question) !== NEGATION.test(right.question) ||
    intent(left.question) !== intent(right.question) || numbers(left.question) !== numbers(right.question)) return [];
  const a = terms(left.question); const b = terms(right.question);
  const common = a.filter((term) => b.includes(term));
  const union = new Set([...a, ...b]).size;
  return common.length >= 3 && common.length / union >= 0.75 ? common : [];
}

/** Conservative suggestions only; answer delivery still validates the exact live sessions. */
export function suggestAgentQuestionGroups(questions: AgentQuestion[]): AgentQuestionSuggestion[] {
  const eligible = questions.filter((item) => item.receivable && item.delivery === 'open' && !item.answerId)
    .sort((a, b) => b.askedAt.localeCompare(a.askedAt)).slice(0, 100);
  const pairs: Array<{ a: AgentQuestion; b: AgentQuestion; common: string[]; score: number }> = [];
  for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
    const a = eligible[i]!; const b = eligible[j]!;
    const common = sharedTerms(a, b);
    if (common.length) pairs.push({ a, b, common, score: common.length / new Set([...terms(a.question), ...terms(b.question)]).size });
  }
  pairs.sort((a, b) => b.score - a.score || b.common.length - a.common.length);
  const used = new Set<string>();
  const suggestions: AgentQuestionSuggestion[] = [];
  for (const pair of pairs) {
    if (used.has(pair.a.id) || used.has(pair.b.id)) continue;
    const group = [pair.a, pair.b];
    for (const candidate of eligible) {
      if (group.length >= 4) break;
      if (used.has(candidate.id) || group.some((item) => item.id === candidate.id)) continue;
      if (group.some((item) => item.cardId === candidate.cardId)) continue;
      if (group.every((item) => sharedTerms(item, candidate).length)) group.push(candidate);
    }
    const commonTerms = terms(group[0]!.question).filter((term) => group.every((item) => terms(item.question).includes(term)));
    if (commonTerms.length < 3) continue;
    group.forEach((item) => used.add(item.id));
    suggestions.push({ questionIds: group.map((item) => item.id), commonTerms: commonTerms.slice(0, 6) });
    if (suggestions.length >= 3) break;
  }
  return suggestions;
}
