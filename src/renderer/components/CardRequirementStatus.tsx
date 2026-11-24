import { useEffect, useState } from 'react';
import { cardRequirementView, type RequirementConflictBoard } from '../../shared/requirement-conflicts';
import './requirement-conflicts.css';

export function CardRequirementStatus({ projectId, cardId, onOpenCard }: { projectId: string; cardId: string; onOpenCard: (cardId: string) => void }) {
  const [board, setBoard] = useState<RequirementConflictBoard | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true; setBoard(null); setError('');
    void window.studio.requirementConflictBoard(projectId).then((value) => { if (live) setBoard(value); })
      .catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { live = false; };
  }, [projectId, cardId]);
  const { history, open } = board ? cardRequirementView(board, cardId) : { history: [], open: [] };
  if (!history.length && !open.length && !error) return null;
  return <section className="card-requirement-status" aria-label="Anforderungswidersprüche"><h3>Anforderungswidersprüche</h3>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {open.map((item) => <p key={item.pairKey}>Hinweis zu {item.component} · {item.scope}: <button type="button" onClick={() => onOpenCard(item.left.cardId === cardId ? item.right.cardId : item.left.cardId)}>Andere Karte öffnen</button>{item.current ? '' : ' · Quellenstand veraltet'}</p>)}
    {history.map((item) => <div key={item.id}><small>{item.current ? 'Aktuelle Entscheidung' : 'Historische Entscheidung'} · Kartenstände {item.leftCardRevision}/{item.rightCardRevision}</small><p>„{item.leftStatement}“ / „{item.rightStatement}“</p><p>{item.status === 'chosen' ? `Gewählte Regel: „${item.winnerStatement}“` : 'Hinweis begründet verworfen'}: {item.reason}</p><button type="button" onClick={() => onOpenCard(item.leftCardId === cardId ? item.rightCardId : item.leftCardId)}>Andere Karte öffnen</button></div>)}
  </section>;
}
