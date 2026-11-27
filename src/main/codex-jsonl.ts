const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PENDING = 64 * 1024;

/** Decode the Codex CLI's JSONL event stream without trusting agent text as a thread identifier. */
export class CodexJsonlOutput {
  private pending = '';
  private threadId: string | null = null;

  feed(chunk: string): { display: string; threadId: string | null } {
    this.pending += chunk;
    let display = '';
    let discovered: string | null = null;
    let newline = this.pending.indexOf('\n');
    while (newline !== -1) {
      const line = this.pending.slice(0, newline).replace(/\r$/, '');
      this.pending = this.pending.slice(newline + 1);
      const result = this.line(line);
      display += result.display;
      if (result.threadId) discovered = result.threadId;
      newline = this.pending.indexOf('\n');
    }
    if (this.pending.length > MAX_PENDING) {
      display += '[Codex-Ausgabezeile ohne Zeilenende wurde gekürzt.]\r\n';
      this.pending = '';
    }
    return { display, threadId: discovered };
  }

  flush(): { display: string; threadId: string | null } {
    if (!this.pending) return { display: '', threadId: null };
    const value = this.line(this.pending.replace(/\r$/, ''));
    this.pending = '';
    return value;
  }

  private line(line: string): { display: string; threadId: string | null } {
    if (!line) return { display: '', threadId: null };
    let event: unknown;
    // node-pty may prepend terminal initialization and OSC window-title
    // sequences to the first JSONL event. Strip those only for decoding; raw
    // CLI diagnostics still pass through when the line is not an event.
    const normalized = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').trimStart();
    try { event = JSON.parse(normalized); }
    catch { return { display: `${line}\r\n`, threadId: null }; }
    if (!event || typeof event !== 'object' || !('type' in event)) return { display: `${line}\r\n`, threadId: null };
    const record = event as Record<string, unknown>;
    if (record.type === 'thread.started' && typeof record.thread_id === 'string' && UUID.test(record.thread_id)) {
      if (this.threadId && this.threadId !== record.thread_id) return { display: '[Codex meldete eine weitere Gesprächs-ID; Zuordnung bleibt unverändert.]\r\n', threadId: null };
      if (this.threadId) return { display: '', threadId: null };
      this.threadId = record.thread_id;
      return { display: `Codex-Gespräch: ${record.thread_id}\r\n`, threadId: record.thread_id };
    }
    if (record.type === 'turn.started') return { display: 'Codex bearbeitet den Auftrag.\r\n', threadId: null };
    if (record.type === 'turn.completed') return { display: 'Codex-Durchlauf beendet.\r\n', threadId: null };
    if (record.type === 'item.started' && record.item && typeof record.item === 'object') {
      const item = record.item as Record<string, unknown>;
      if (item.type === 'command_execution' && typeof item.command === 'string') return { display: `> ${item.command.slice(0, 2_000)}\r\n`, threadId: null };
      if (item.type === 'file_change') return { display: 'Codex meldet eine Dateiänderung.\r\n', threadId: null };
    }
    if (record.type === 'item.completed' && record.item && typeof record.item === 'object') {
      const item = record.item as Record<string, unknown>;
      if (item.type === 'agent_message' && typeof item.text === 'string') return { display: `${item.text}\r\n`, threadId: null };
      if (item.type === 'command_execution') {
        const output = typeof item.aggregated_output === 'string' ? item.aggregated_output.slice(0, 20_000) : '';
        return { display: `${output}${output.endsWith('\n') ? '' : '\r\n'}${typeof item.exit_code === 'number' ? `Exit ${item.exit_code}\r\n` : ''}`, threadId: null };
      }
      if (item.type === 'file_change') {
        const changes = Array.isArray(item.changes) ? item.changes : [];
        const paths = changes.flatMap((change) => change && typeof change === 'object' && 'path' in change && typeof change.path === 'string' ? [change.path.slice(0, 160)] : []).slice(0, 3);
        return { display: `Dateiänderung gemeldet${paths.length ? `: ${paths.join(', ')}${changes.length > paths.length ? ' …' : ''}` : ''}.\r\n`, threadId: null };
      }
    }
    if (record.type === 'error' || record.type === 'turn.failed') {
      const message = typeof record.message === 'string' ? record.message : record.error && typeof record.error === 'object' && 'message' in record.error && typeof record.error.message === 'string' ? record.error.message : line;
      return { display: `Codex-Fehler: ${message.slice(0, 4_000)}\r\n`, threadId: null };
    }
    // Codex emits many machine-readable bookkeeping events. Never dump their
    // raw JSON into the interactive transcript when no human rendering exists.
    return { display: '', threadId: null };
  }
}
