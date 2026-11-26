import { useEffect, useState } from 'react';
import type { ProjectSnapshot } from '../shared/types';
import { decisionItems } from './decision-inbox';
import { scheduleVisibleInboxRefresh } from './inbox-refresh';

export const INBOX_CHANGED_EVENT = 'branchloom:inbox-changed';
export interface DecisionIndicator {
  projectId: string;
  reviewCount: number;
  questionCount: number;
  hasMore: boolean;
}

export interface DecisionNavigationStatus {
  count: number;
  hasMore: boolean;
}

export function decisionNavigationStatus(
  snapshot: ProjectSnapshot | null,
  projectId: string | null,
  indicator: DecisionIndicator | null,
): DecisionNavigationStatus | null {
  if (!projectId || snapshot?.project.id !== projectId || indicator?.projectId !== projectId) return null;
  return { count: decisionItems(snapshot).length + indicator.reviewCount + indicator.questionCount, hasMore: indicator.hasMore };
}

/** Read persisted review sources and answerable agent questions even when the inbox is closed. */
export function useDecisionInboxIndicator(projectId: string | null): DecisionIndicator | null {
  const [indicator, setIndicator] = useState<DecisionIndicator | null>(null);
  useEffect(() => {
    setIndicator(null);
    if (!projectId) return;
    let active = true;
    let inFlight = false;
    let queued = false;
    const refresh = () => {
      if (!active || inFlight) return;
      inFlight = true;
      void Promise.all([window.studio.reviewInboxItems({ projectId }), window.studio.agentQuestionDecisionCount(projectId)])
        .then(([page, questionCount]) => {
          if (active) setIndicator({ projectId, reviewCount: page.items.length, questionCount, hasMore: page.hasMore });
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
