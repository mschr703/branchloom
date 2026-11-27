import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  page: boolean;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Keep the chat mounted while its dock is closed so an unfinished draft survives. */
export function ProjectChatHost({ page, open, onClose, children }: Props) {
  useEffect(() => {
    if (page || !open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [page, open, onClose]);

  return <>
    {!page && open ? <button className="project-chat-backdrop" type="button" tabIndex={-1}
      aria-label="Projektgespräch durch Klick außerhalb schließen" onClick={onClose} /> : null}
    <div className={`project-chat-host ${page ? 'page' : 'dock'}`} hidden={!page && !open}>
      {!page && open ? <button type="button" className="project-chat-close icon-button" aria-label="Projektgespräch schließen"
        title="Projektgespräch schließen" onClick={onClose}><X size={17} aria-hidden="true" /></button> : null}
      {children}
    </div>
  </>;
}
