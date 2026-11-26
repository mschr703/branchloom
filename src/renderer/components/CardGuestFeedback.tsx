import { useEffect, useState } from 'react';
import type { TeamBoardComment } from '../../shared/team-board';

export function CardGuestFeedback({ projectId, cardId }: { projectId: string; cardId: string }) {
  const [comments, setComments] = useState<TeamBoardComment[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setComments([]); setError('');
    const refresh = () => { void window.studio.teamBoardCardComments({ projectId, cardId })
      .then((items) => { if (active) { setComments(items); setError(''); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }); };
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, [projectId, cardId]);

  if (!comments.length && !error) return null;
  return <section className="card-guest-feedback" aria-label="Gastfeedback zu dieser Karte">
    <h3>Gastfeedback</h3>
    {error ? <p className="inline-error" role="alert">Gastfeedback konnte nicht geladen werden: {error}</p> : null}
    {comments.length ? <ul>{comments.map((comment) => <li key={comment.id}>
      <div className="decision-meta"><strong>{comment.displayName}</strong><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString('de-DE')}</time></div>
      <p>{comment.body}</p>
    </li>)}</ul> : null}
  </section>;
}
