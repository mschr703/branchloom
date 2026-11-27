import { describe, expect, it } from 'vitest';
import { CodexJsonlOutput } from '../../src/main/codex-jsonl';

describe('Codex JSONL output', () => {
  it('links only a structured thread.started event across PTY chunks', () => {
    const output = new CodexJsonlOutput();
    const id = '01a20afb-b90e-7e43-aabe-7d0a76dc3b63';
    expect(output.feed('{"type":"thread.st')).toEqual({ display: '', threadId: null });
    expect(output.feed(`arted","thread_id":"${id}"}\r\n`)).toEqual({ display: `Codex-Gespräch: ${id}\r\n`, threadId: id });
    expect(output.feed('{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}\n').display).toBe('OK\r\n');
    expect(output.feed('{"type":"thread.started","thread_id":"00000000-0000-0000-0000-000000000000"}\n').threadId).toBeNull();
  });

  it('recognizes a PTY-prefixed first event without showing raw JSON', () => {
    const output = new CodexJsonlOutput();
    const id = '01a20afb-b90e-7e43-aabe-7d0a76dc3b63';
    expect(output.feed(`\x1b[?25h\x1b]0;Synthetic terminal\x07{"type":"thread.started","thread_id":"${id}"}\r\n`))
      .toEqual({ display: `Codex-Gespräch: ${id}\r\n`, threadId: id });
  });

  it('never links malformed IDs or a thread.started string inside an agent message', () => {
    const output = new CodexJsonlOutput();
    const text = '{"type":"thread.started","thread_id":"00000000-0000-0000-0000-000000000000"}';
    expect(output.feed(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) + '\n').threadId).toBeNull();
    expect(output.feed('{"type":"thread.started","thread_id":"not-a-uuid"}\n').threadId).toBeNull();
    expect(output.feed('A CLI warning\n').display).toBe('A CLI warning\r\n');
  });

  it('shows observed command and file events while hiding machine-only JSON', () => {
    const output = new CodexJsonlOutput();
    expect(output.feed('{"type":"item.updated","item":{"type":"reasoning","text":"private scratch"}}\n').display).toBe('');
    expect(output.feed('{"type":"item.started","item":{"type":"command_execution","command":"npm test"}}\n').display).toBe('> npm test\r\n');
    expect(output.feed('{"type":"item.completed","item":{"type":"file_change","changes":[{"path":"src/app.ts"}]}}\n').display).toBe('Dateiänderung gemeldet: src/app.ts.\r\n');
    expect(output.feed('{"type":"unknown.future.event","private":"data"}\n').display).toBe('');
    expect(output.feed('{"type":"turn.completed","usage":{"input_tokens":20}}\n').display).toBe('Codex-Durchlauf beendet.\r\n');
  });

  it('does not expose a huge unfinished machine event', () => {
    const output = new CodexJsonlOutput();
    const result = output.feed('{"type":"item.updated","private":"' + 'secret'.repeat(11_000));
    expect(result.display).toContain('ohne Zeilenende wurde gekürzt');
    expect(result.display).not.toContain('secret');
  });
});
