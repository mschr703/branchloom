/** Interpret a short local-time request without granting any agent permission. */
export function parseQueueDeadline(text: string, now = new Date()): string {
  const match = text.trim().match(/^(?:(?:hey[, ]*)?arbeite\s+)?bis\s+(?:(heute|morgen)\s+)?(\d{1,2})(?::(\d{2}))?(?:\s*uhr)?\s*$/i)
    ?? text.trim().match(/^(?:(heute|morgen)\s+)?(\d{1,2})(?::(\d{2}))?(?:\s*uhr)?\s*$/i);
  if (!match) throw new Error('Use a time such as “bis 20 Uhr” or “bis morgen 08:30 Uhr”.');
  const [, day, hourText, minuteText] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText ?? '0');
  if (hour > 23 || minute > 59) throw new Error('Enter a valid time between 00:00 and 23:59.');
  const deadline = new Date(now);
  deadline.setHours(hour, minute, 0, 0);
  if (day?.toLowerCase() === 'morgen') deadline.setDate(deadline.getDate() + 1);
  else if (!day && deadline.getTime() <= now.getTime()) deadline.setDate(deadline.getDate() + 1);
  const remaining = deadline.getTime() - now.getTime();
  if (remaining < 1_000 || remaining > 24 * 60 * 60 * 1_000)
    throw new Error('The deadline must be within the next 24 hours.');
  return deadline.toISOString();
}

export function validateQueueDeadline(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value
    || timestamp - now < 1_000 || timestamp - now > 24 * 60 * 60 * 1_000)
    throw new Error('The reviewed deadline must be within the next 24 hours.');
  return value;
}
