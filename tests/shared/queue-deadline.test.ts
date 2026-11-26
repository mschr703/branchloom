import { describe, expect, it } from 'vitest';
import { parseQueueDeadline, validateQueueDeadline } from '../../src/shared/queue-deadline';

describe('queue deadline commands', () => {
  const now = new Date(2026, 10, 26, 15, 30);

  it('reads a plain work-until request and a tomorrow request as local time', () => {
    const today = new Date(parseQueueDeadline('hey arbeite bis 20 Uhr', now));
    expect([today.getDate(), today.getHours(), today.getMinutes()]).toEqual([26, 20, 0]);
    const tomorrow = new Date(parseQueueDeadline('bis morgen 08:30 Uhr', now));
    expect([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([27, 8, 30]);
  });

  it('selects the next occurrence of a bare time and rejects ambiguous or oversized windows', () => {
    const next = new Date(parseQueueDeadline('bis 08:00', now));
    expect([next.getDate(), next.getHours()]).toEqual([27, 8]);
    expect(() => parseQueueDeadline('bis irgendwann', now)).toThrow();
    expect(() => parseQueueDeadline('bis 25 Uhr', now)).toThrow();
    expect(() => parseQueueDeadline('bis heute 08 Uhr', now)).toThrow();
    expect(() => parseQueueDeadline('bis morgen 20 Uhr', now)).toThrow();
  });

  it('requires a canonical deadline within 24 hours', () => {
    const valid = new Date(now.getTime() + 60_000).toISOString();
    expect(validateQueueDeadline(valid, now.getTime())).toBe(valid);
    expect(() => validateQueueDeadline(valid.replace('.000Z', 'Z'), now.getTime())).toThrow();
    expect(() => validateQueueDeadline(new Date(now.getTime() + 25 * 3_600_000).toISOString(), now.getTime())).toThrow();
  });
});
