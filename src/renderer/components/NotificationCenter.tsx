import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bell, X } from 'lucide-react';
import type { GlobalInboxItem, GlobalInboxPage } from '../../shared/global-inbox';
import type { ReleaseUpdateState } from '../../shared/release-update';
import type { LanguagePreference } from '../language';
import { INBOX_CHANGED_EVENT } from '../decision-navigation';
import { scheduleVisibleInboxRefresh } from '../inbox-refresh';
import { ReleaseUpdateNotice } from './ReleaseUpdateNotice';
import './notification-center.css';

const STORAGE_KEY = 'branchloom:notification-seen:v1';
const MAX_SEEN = 500;

function availableStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

export function notificationFingerprint(item: Pick<GlobalInboxItem, 'id' | 'recordedAt'>): string {
  return `${item.id}|${item.recordedAt}`;
}

export function readSeenNotifications(storage: Pick<Storage, 'getItem'> | null): string[] {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-MAX_SEEN) : [];
  } catch { return []; }
}

export function recordSeenNotifications(storage: Pick<Storage, 'setItem'> | null, current: string[], items: GlobalInboxItem[]): string[] {
  const next = [...new Set([...current, ...items.map(notificationFingerprint)])].slice(-MAX_SEEN);
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep current-session state when storage is unavailable. */ }
  return next;
}

export function unreadRecentCount(page: GlobalInboxPage | null, seen: string[]): number {
  if (!page) return 0;
  const known = new Set(seen);
  return page.items.filter((item) => !known.has(notificationFingerprint(item))).length;
}

export function hasActionableUpdate(state: ReleaseUpdateState | null): boolean {
  return Boolean(state?.availableVersion && ['available', 'blocked', 'error'].includes(state.phase));
}

const kindLabel: Record<GlobalInboxItem['kind'], string> = {
  workflow: 'Workflow', queue: 'Warteschlange', session: 'Agentenlauf', plan: 'Plan-Review',
  diff: 'Code-Review', qa: 'Browser-QA', guest: 'Gastfeedback',
};

export function NotificationCenter({ onOpenItem, onOpenInbox, language = 'de' }: {
  onOpenItem: (item: GlobalInboxItem) => void;
  onOpenInbox: () => void;
  language?: LanguagePreference;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<GlobalInboxPage | null>(null);
  const [error, setError] = useState('');
  const [seen, setSeen] = useState(() => readSeenNotifications(availableStorage()));
  const [update, setUpdate] = useState<ReleaseUpdateState | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef(0);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (typeof window.studio?.globalInboxItems !== 'function') return;
      const current = ++request.current;
      void window.studio.globalInboxItems({}).then((next) => {
        if (alive && current === request.current) { setPage(next); setError(''); }
      }).catch(() => { if (alive && current === request.current) setError('Hinweise konnten nicht geladen werden.'); });
    };
    refresh();
    const stop = scheduleVisibleInboxRefresh(refresh);
    window.addEventListener(INBOX_CHANGED_EVENT, refresh);
    return () => { alive = false; request.current++; stop(); window.removeEventListener(INBOX_CHANGED_EVENT, refresh); };
  }, []);

  useEffect(() => {
    if (typeof window.studio?.onReleaseUpdateState !== 'function' || typeof window.studio?.releaseUpdateState !== 'function') return;
    let alive = true;
    const unsubscribe = window.studio.onReleaseUpdateState((next) => { if (alive) setUpdate(next); });
    void window.studio.releaseUpdateState().then((next) => { if (alive) setUpdate(next); }).catch(() => undefined);
    return () => { alive = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  function markSeen(items: GlobalInboxItem[]) {
    setSeen((current) => recordSeenNotifications(availableStorage(), current, items));
  }

  const unseen = unreadRecentCount(page, seen);
  const updateCount = hasActionableUpdate(update) ? 1 : 0;
  const badge = unseen + updateCount;
  const label = language === 'en' ? 'Notifications' : 'Mitteilungen';

  return <div className="notification-center" ref={root}>
    <button ref={trigger} className="icon-button notification-trigger" type="button" title={label}
      aria-label={`${label}${badge ? `: ${badge} ${language === 'en' ? 'new' : 'neu'}` : ''}`}
      aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
      <Bell size={17} aria-hidden="true" />{badge ? <span className="notification-count" aria-hidden="true">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
    {open ? <section className="notification-panel" role="dialog" aria-label={label}>
      <header className="notification-heading"><h2>{label}</h2><button type="button" className="icon-button" aria-label={language === 'en' ? 'Close notifications' : 'Mitteilungen schließen'} onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button></header>
      {update && update.phase !== 'unsupported' && update.phase !== 'current' ? <ReleaseUpdateNotice /> : null}
      <div className="notification-list-heading"><strong>{language === 'en' ? 'Open work' : 'Offene Arbeit'}</strong>{unseen > 0 && page ? <button type="button" onClick={() => markSeen(page.items)}>{language === 'en' ? 'Mark recent as read' : 'Letzte als gelesen markieren'}</button> : null}</div>
      {error ? <p className="notification-error" role="alert">{error}</p> : null}
      {!page && !error ? <p className="notification-empty">{language === 'en' ? 'Loading…' : 'Lade Hinweise…'}</p> : null}
      {page && page.items.length === 0 ? <p className="notification-empty">{language === 'en' ? 'No open work.' : 'Keine offenen Vorgänge.'}</p> : null}
      {page?.items.slice(0, 5).map((item) => {
        const fresh = !seen.includes(notificationFingerprint(item));
        return <button key={item.id} type="button" className="notification-item" onClick={() => { markSeen([item]); setOpen(false); onOpenItem(item); }}>
          <span className="notification-item-meta"><span>{kindLabel[item.kind]} · {item.projectName}</span>{fresh ? <span className="notification-new">Neu</span> : null}</span>
          <strong>{item.title}</strong><span className="notification-item-detail">{item.detail}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </button>;
      })}
      {page?.hasMore ? <p className="notification-more">{language === 'en' ? 'The badge covers the latest 100 open items; more are in Decisions.' : 'Die Zahl bezieht sich auf die letzten 100 offenen Einträge. Weitere stehen unter Entscheidungen.'}</p> : null}
      {page?.items.length ? <button type="button" className="notification-all" onClick={() => { setOpen(false); onOpenInbox(); }}>{language === 'en' ? 'All decisions' : 'Alle Entscheidungen'} <ArrowRight size={14} aria-hidden="true" /></button> : null}
    </section> : null}
  </div>;
}
