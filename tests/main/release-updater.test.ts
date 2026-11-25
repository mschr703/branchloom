import { describe, expect, it, vi } from 'vitest';
import { ReleaseUpdateController, type ReleaseUpdateBackend } from '../../src/main/release-updater';
import type { ReleaseUpdateState } from '../../src/shared/release-update';

function fixture(canInstall = () => true) {
  const listeners: Record<string, ((value?: unknown) => void) | undefined> = {};
  const backend: ReleaseUpdateBackend = {
    check: vi.fn(async () => undefined),
    download: vi.fn(async () => undefined),
    install: vi.fn(),
    onAvailable: (callback) => { listeners.available = (value) => callback(value as string); },
    onCurrent: (callback) => { listeners.current = callback; },
    onProgress: (callback) => { listeners.progress = (value) => callback(value as number); },
    onError: (callback) => { listeners.error = (value) => callback(value as Error); },
  };
  const states: ReleaseUpdateState[] = [];
  const controller = new ReleaseUpdateController(backend, '0.1.0', (state) => states.push(state), canInstall);
  return { backend, controller, states, emit: (event: string, value?: unknown) => listeners[event]?.(value) };
}

describe('release updates', () => {
  it('does not download or install when an update is merely found', async () => {
    const item = fixture();
    await item.controller.check();
    item.emit('available', '0.2.0');
    expect(item.controller.snapshot()).toMatchObject({ phase: 'available', availableVersion: '0.2.0' });
    expect(item.backend.download).not.toHaveBeenCalled();
    expect(item.backend.install).not.toHaveBeenCalled();
    await item.controller.update();
    expect(item.backend.download).toHaveBeenCalledTimes(1);
    expect(item.backend.install).toHaveBeenCalledTimes(1);
  });

  it('keeps Later passive through a repeated check for the same version', async () => {
    const item = fixture();
    item.emit('available', '0.2.0');
    item.controller.later();
    item.emit('available', '0.2.0');
    expect(item.controller.snapshot().phase).toBe('current');
    await item.controller.update();
    expect(item.backend.download).not.toHaveBeenCalled();
    item.emit('available', '0.3.0');
    expect(item.controller.snapshot()).toMatchObject({ phase: 'available', availableVersion: '0.3.0' });
  });

  it('keeps the downloaded update ready while work is running, then installs on another click', async () => {
    let idle = false;
    const item = fixture(() => idle);
    item.emit('available', '0.2.0');
    await item.controller.update();
    expect(item.controller.snapshot()).toMatchObject({ phase: 'blocked', availableVersion: '0.2.0' });
    expect(item.backend.install).not.toHaveBeenCalled();
    idle = true;
    await item.controller.update();
    expect(item.backend.download).toHaveBeenCalledTimes(1);
    expect(item.backend.install).toHaveBeenCalledTimes(1);
  });

  it('reports download progress and allows retry after a failure', async () => {
    const item = fixture();
    item.emit('available', '0.2.0');
    vi.mocked(item.backend.download).mockImplementationOnce(async () => {
      item.emit('progress', 37.6);
      throw new Error('Offline');
    });
    await item.controller.update();
    expect(item.states).toContainEqual(expect.objectContaining({ phase: 'downloading', percent: 38 }));
    expect(item.controller.snapshot().phase).toBe('error');
    expect(item.backend.install).not.toHaveBeenCalled();
    await item.controller.update();
    expect(item.backend.install).toHaveBeenCalledTimes(1);
  });

  it('hides the update action for portable and source builds', async () => {
    const controller = new ReleaseUpdateController(null, '0.1.0', vi.fn(), () => true);
    await controller.check();
    expect(await controller.update()).toMatchObject({ phase: 'unsupported', availableVersion: null });
  });

  it.each([
    ['ENOTFOUND', 'Keine Verbindung'],
    ['GitHub API returned 429 rate limit', 'GitHub begrenzt'],
    ['404 release asset missing', 'Release-Daten fehlen'],
    ['invalid sha512 manifest', 'Release-Daten fehlen'],
  ])('shows a nonblocking update-check failure for %s and retries only on click', async (failure, message) => {
    const item = fixture();
    vi.mocked(item.backend.check).mockRejectedValueOnce(new Error(failure));
    await item.controller.check();
    expect(item.controller.snapshot()).toMatchObject({ phase: 'error', availableVersion: null, message: expect.stringContaining(message) });
    expect(item.backend.download).not.toHaveBeenCalled();
    expect(item.backend.install).not.toHaveBeenCalled();
    await item.controller.update();
    expect(item.backend.check).toHaveBeenCalledTimes(2);
    expect(item.controller.snapshot()).toMatchObject({ phase: 'current', availableVersion: null });
  });

  it('shows an updater error event during a check without a rejected promise', async () => {
    const item = fixture();
    vi.mocked(item.backend.check).mockImplementationOnce(async () => { item.emit('error', new Error('Offline')); });
    await item.controller.check();
    expect(item.controller.snapshot()).toMatchObject({ phase: 'error', availableVersion: null, message: expect.stringContaining('Keine Verbindung') });
    item.controller.later();
    expect(item.controller.snapshot().phase).toBe('current');
  });
});
