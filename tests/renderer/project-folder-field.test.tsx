// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ProjectFolderField } from '../../src/renderer/components/ProjectFolderField';
import type { StudioAPI } from '../../src/shared/types';

it('uses a native folder choice without changing the path on cancel or error', async () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const chooseProjectFolder = vi.fn<StudioAPI['chooseProjectFolder']>();
  chooseProjectFolder.mockResolvedValueOnce(null).mockResolvedValueOnce('C:\\Projects\\atlas').mockRejectedValueOnce(new Error('Picker unavailable'));
  Object.defineProperty(window, 'studio', { configurable: true, value: { chooseProjectFolder } });
  const onError = vi.fn();
  const onSelected = vi.fn();
  function Harness() {
    const [path, setPath] = useState('C:\\Existing');
    return <ProjectFolderField id="project-folder" value={path} onChange={setPath} onSelected={onSelected} onError={onError} />;
  }
  try {
    await act(async () => { root.render(<Harness />); });
    const input = mount.querySelector<HTMLInputElement>('#project-folder')!;
    const choose = mount.querySelector<HTMLButtonElement>('button')!;
    expect(choose.textContent).toContain('Ordner auswählen');
    await act(async () => { choose.click(); });
    expect(input.value).toBe('C:\\Existing');
    expect(onSelected).not.toHaveBeenCalled();
    await act(async () => { choose.click(); });
    expect(input.value).toBe('C:\\Projects\\atlas');
    expect(onSelected).toHaveBeenCalledWith('C:\\Projects\\atlas');
    await act(async () => { choose.click(); });
    expect(input.value).toBe('C:\\Projects\\atlas');
    expect(onError).toHaveBeenCalledWith('Picker unavailable');
    expect(mount.querySelector('[role="alert"]')?.textContent).toContain('Picker unavailable');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousActEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    mount.remove();
  }
});
