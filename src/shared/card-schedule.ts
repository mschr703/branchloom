export interface CardScheduleEvent {
  id: string;
  cardId: string;
  kind: 'planned-date' | 'completion';
  before: string | null;
  after: string | null;
  recordedAt: string;
}

/** A calendar date is intentionally independent of the viewer's timezone. */
export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
