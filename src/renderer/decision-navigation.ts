import { useEffect, useState } from 'react';
import type { ProjectSnapshot } from '../shared/types';
import { decisionItems } from './decision-inbox';
import { scheduleVisibleInboxRefresh } from './inbox-refresh';

export const INBOX_CHANGED_EVENT = 'branchloom:inbox-changed';
export interface ReviewIndicator {
  projectId: string;
  count: number;
  hasMore: boolean;
}

export interface DecisionNavigationStatus {
  count: number;
  hasMore: boolean;
}

export function decisionNavigationStatus(
  snapshot: ProjectSnapshot | null,
  projectId: string | null,
  indicator: ReviewIndicator | null,
): DecisionNavigationStatus | null {
  if (!projectId || snapshot?.project.id !== projectId || indicator?.projectId !== projectId) return null;
  return { count: decisionItems(snapshot).length + indicator.count, hasMore: indicator.hasMore };
}

/** Read the first review page even when the inbox is closed; a full page is shown as a lower bound. */
export function useReviewInboxIndicator(projectId: string | null): ReviewIndicator | null {
  const [indicator, setIndicator] = useState<ReviewIndicator | null>(null);
  useEffect(() => {
    setIndicator(null);
    if (!projectId) return;
    let active = true;
    let inFlight = false;
    let queued = false;
    const refresh = () => {
      if (!active || inFlight) return;
      inFlight = true;
      void window.studio.reviewInboxItems({ projectId })
        .then((page) => {
          if (active) setIndicator({ projectId, count: page.items.length, hasMore: page.hasMore });
        })
        .catch(() => { if (active) setIndicator(null); })
        .finally(() => {
          inFlight = false;
          if (active && queued) {
            queued = false;
            refresh();
          }
        });
    };
    const changed = () => {
      if (inFlight) queued = true;
      else refresh();
    };
    refresh();
    const stop = scheduleVisibleInboxRefresh(refresh);
    window.addEventListener(INBOX_CHANGED_EVENT, changed);
    return () => {
      active = false;
      stop();
      window.removeEventListener(INBOX_CHANGED_EVENT, changed);
    };
  }, [projectId]);
  return indicator?.projectId === projectId ? indicator : null;
}

export function notifyInboxChanged(): void {
  window.dispatchEvent(new Event(INBOX_CHANGED_EVENT));
}
