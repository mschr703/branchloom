import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { previewListenerOwnership, windowsLoopbackListenerPid, windowsProcessDescendsFrom } from '../../src/main/preview-listener';

describe('Windows preview listener ownership', () => {
  it('accepts only a unique loopback listening socket for the requested port', () => {
    const output = `TCP 127.0.0.1:43123 0.0.0.0:0 LISTENING 123\nTCP 127.0.0.1:43124 0.0.0.0:0 LISTENING 456\nTCP 127.0.0.1:43123 127.0.0.1:50123 ESTABLISHED 789`;
    expect(windowsLoopbackListenerPid(output, 43123)).toBe(123);
    expect(windowsLoopbackListenerPid(output, 43124)).toBe(456);
    expect(windowsLoopbackListenerPid(output, 43125)).toBeNull();
    expect(windowsLoopbackListenerPid(`${output}\nTCP 127.0.0.1:43123 0.0.0.0:0 LISTENING 999`, 43123)).toBeNull();
  });

  it('accepts a child or grandchild but not unrelated or cyclic process records', () => {
    const processes = '10,1\n20,10\n30,20\n40,1\n50,60\n60,50';
    expect(windowsProcessDescendsFrom(processes, 30, 10)).toBe(true);
    expect(windowsProcessDescendsFrom(processes, 40, 10)).toBe(false);
    expect(windowsProcessDescendsFrom(processes, 50, 10)).toBe(false);
  });

  if (process.platform === 'win32') it('reads the owner of a real local listener', async () => {
    const server = createServer();
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing local port');
      expect(previewListenerOwnership(address.port, process.pid)).toBe('owned');
      expect(previewListenerOwnership(address.port, Number.MAX_SAFE_INTEGER)).toBe('foreign');
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
