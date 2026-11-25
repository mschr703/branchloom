import { execFileSync } from 'node:child_process';

export type PreviewListenerOwnership = 'owned' | 'foreign' | 'unverified' | 'unsupported';

/** netstat's zero remote endpoint identifies a listening IPv4 socket independent of UI language. */
export function windowsLoopbackListenerPid(output: string, port: number): number | null {
  const owners = new Set<number>();
  for (const line of output.split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u);
    if (columns.length !== 5 || columns[0] !== 'TCP' || columns[1] !== `127.0.0.1:${port}`
      || columns[2] !== '0.0.0.0:0') continue;
    const pid = Number(columns[4]);
    if (Number.isSafeInteger(pid) && pid > 0) owners.add(pid);
  }
  return owners.size === 1 ? [...owners][0]! : null;
}

export function windowsProcessDescendsFrom(output: string, listenerPid: number, rootPid: number): boolean {
  const parents = new Map<number, number>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^(\d+),(\d+)$/u.exec(line.trim());
    if (match) parents.set(Number(match[1]), Number(match[2]));
  }
  const seen = new Set<number>();
  let current = listenerPid;
  for (let depth = 0; depth < 32 && !seen.has(current); depth++) {
    if (current === rootPid) return true;
    seen.add(current);
    current = parents.get(current) ?? 0;
    if (current < 1) break;
  }
  return false;
}

/** Fail closed on Windows when the socket owner or ancestry cannot be determined. */
export function previewListenerOwnership(port: number, rootPid: number): PreviewListenerOwnership {
  if (process.platform !== 'win32') return 'unsupported';
  try {
    const sockets = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], {
      encoding: 'utf8', timeout: 2500, windowsHide: true, maxBuffer: 2_000_000,
    });
    const listenerPid = windowsLoopbackListenerPid(sockets, port);
    if (!listenerPid) return 'unverified';
    if (listenerPid === rootPid) return 'owned';
    const processes = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process | ForEach-Object { '{0},{1}' -f $_.ProcessId,$_.ParentProcessId }"], {
      encoding: 'utf8', timeout: 6000, windowsHide: true, maxBuffer: 2_000_000,
    });
    return windowsProcessDescendsFrom(processes, listenerPid, rootPid) ? 'owned' : 'foreign';
  } catch { return 'unverified'; }
}
