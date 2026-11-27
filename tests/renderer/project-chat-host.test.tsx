// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { ProjectChatHost } from '../../src/renderer/components/ProjectChatHost';

afterEach(() => { document.body.replaceChildren(); });

it('closes a dock only from its backdrop, close button or Escape and keeps an unfinished draft', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  function Harness() {
    const [open, setOpen] = useState(true);
    return <><button type="button" onClick={() => setOpen(true)}>Open chat</button>
      <ProjectChatHost page={false} open={open} onClose={() => setOpen(false)}>
        <input aria-label="Unfinished question" defaultValue="First thought" />
      </ProjectChatHost></>;
  }
  try {
    await act(async () => { root.render(<Harness />); });
    const input = mount.querySelector<HTMLInputElement>('.project-chat-host input')!;
    input.value = 'Unfinished question';
    await act(async () => { input.click(); });
    expect(mount.querySelector('.project-chat-host')?.hasAttribute('hidden')).toBe(false);
    await act(async () => { mount.querySelector<HTMLButtonElement>('.project-chat-backdrop')!.click(); });
    expect(mount.querySelector('.project-chat-host')?.hasAttribute('hidden')).toBe(true);
    await act(async () => { mount.querySelector<HTMLButtonElement>('button')!.click(); });
    expect(mount.querySelector<HTMLInputElement>('.project-chat-host input')).toBe(input);
    expect(input.value).toBe('Unfinished question');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(mount.querySelector('.project-chat-host')?.hasAttribute('hidden')).toBe(true);
    await act(async () => { mount.querySelector<HTMLButtonElement>('button')!.click(); });
    await act(async () => { mount.querySelector<HTMLButtonElement>('.project-chat-close')!.click(); });
    expect(mount.querySelector('.project-chat-host')?.hasAttribute('hidden')).toBe(true);
  } finally {
    await act(async () => { root.unmount(); });
  }
});
