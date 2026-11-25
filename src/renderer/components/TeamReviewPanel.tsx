import { useEffect, useState } from 'react';
import type { Card, CardQaReport } from '../../shared/types';
import type { TeamReviewComment, TeamReviewInvite, TeamReviewRevision, TeamReviewRoom } from '../../shared/team-review';
import './team-review.css';

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const revisionLabel = (status: TeamReviewRevision['status']) => ({
  'same-clean-head': 'Git-Checkout seit QA unverändert',
  'different-head': 'Git-HEAD seit QA geändert',
  'working-tree-dirty': 'Ungespeicherte Änderungen im Checkout',
  'checkout-changed': 'Karte nutzt jetzt einen anderen Checkout',
  unavailable: 'Git-Vergleich nicht möglich',
})[status];

export function TeamReviewPanel({ card, report }: { card: Card; report: CardQaReport }) {
  const [rooms, setRooms] = useState<TeamReviewRoom[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [invites, setInvites] = useState<TeamReviewInvite[]>([]);
  const [comments, setComments] = useState<TeamReviewComment[]>([]);
  const [image, setImage] = useState('');
  const [revision, setRevision] = useState<TeamReviewRevision | null>(null);
  const [scenario, setScenario] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [share, setShare] = useState<{ url: string; secret: string; transport: 'local' | 'tailnet' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const reportRooms = rooms.filter((room) => room.qaReportId === report.id);
  const selected = reportRooms.find((room) => room.id === selectedId) ?? null;

  useEffect(() => {
    let live = true;
    setRooms([]); setSelectedId(''); setInvites([]); setComments([]); setImage(''); setShare(null); setError(''); setOpen(false);
    void window.studio.teamReviewRooms(card.id).then((items) => { if (live) setRooms(items); })
      .catch((reason) => { if (live) setError(messageOf(reason)); });
    return () => { live = false; };
  }, [card.id]);

  useEffect(() => {
    let live = true;
    setInvites([]); setComments([]); setImage('');
    if (!selectedId) return;
    void Promise.all([window.studio.teamReviewInvites(selectedId), window.studio.teamReviewComments(selectedId), window.studio.teamReviewImage(selectedId)])
      .then(([nextInvites, nextComments, nextImage]) => { if (live) { setInvites(nextInvites); setComments(nextComments); setImage(nextImage); } })
      .catch((reason) => { if (live) setError(messageOf(reason)); });
    const timer = setInterval(() => {
      if (document.hidden) return;
      void window.studio.teamReviewComments(selectedId).then((items) => { if (live) setComments(items); }).catch(() => undefined);
    }, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [selectedId]);

  useEffect(() => {
    let live = true;
    setRevision(null);
    if (!selectedId) return;
    const refresh = () => { void window.studio.teamReviewRevision(selectedId)
      .then((value) => { if (live) setRevision(value); })
      .catch(() => { if (live) setRevision({ status: 'unavailable', currentHead: null, checkedAt: new Date().toISOString() }); }); };
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 20_000);
    return () => { live = false; clearInterval(timer); };
  }, [selectedId]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await window.studio.startTeamReviewRoom({ projectId: card.projectId, cardId: card.id, qaReportId: report.id, scenario, reviewerName });
      setRooms((items) => [result.room, ...items]);
      setSelectedId(result.room.id);
      setShare({ url: result.url, secret: result.reviewerSecret, transport: 'local' });
      setScenario(''); setReviewerName('');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function issueInvite(transport: 'local' | 'tailnet') {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const input = { roomId: selected.id, reviewerName };
      const result = transport === 'tailnet' ? await window.studio.newTailnetTeamReviewInvite(input)
        : await window.studio.newTeamReviewInvite(input);
      setInvites((items) => [...items, result.invite]);
      setShare({ url: result.url, secret: result.reviewerSecret, transport });
      setReviewerName('');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function closeRoom() {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const updated = await window.studio.closeTeamReviewRoom(selected.id);
      setRooms((items) => items.map((item) => item.id === updated.id ? updated : item));
      setShare(null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function revoke(inviteId: string) {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const updated = await window.studio.revokeTeamReviewInvite({ roomId: selected.id, inviteId });
      setInvites((items) => items.map((item) => item.id === updated.id ? updated : item));
      setShare(null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function shareAction(action: 'copy' | 'open') {
    if (!share || busy) return;
    setError('');
    try {
      const input = { secret: share.secret, transport: share.transport };
      if (action === 'copy') await window.studio.copyTeamReviewInvite(input);
      else await window.studio.openTeamReviewInvite(input);
    } catch (reason) { setError(messageOf(reason)); }
  }

  return <details className="team-review-panel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Gemeinsamer Bild-Review <span>{reportRooms.length}</span></summary>
    <p>Ein gespeicherter QA-Screenshot wird für markierte Kommentare festgehalten. Der normale Link funktioniert auf diesem Rechner; ein zweiter Link kann bewusst über eine verbundene Tailscale-Umgebung freigegeben werden.</p>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {reportRooms.length ? <label>Reviewstand <select aria-label="Reviewstand wählen" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setShare(null); }}><option value="">Reviewstand wählen</option>{reportRooms.map((room) => <option value={room.id} key={room.id}>{room.scenario} · {new Date(room.createdAt).toLocaleString('de-DE')}{room.closedAt ? ' · geschlossen' : ''}</option>)}</select></label> : null}
    {selected ? <section className="team-review-current" aria-label={`Reviewstand ${selected.scenario}`}>
      <div className="team-review-heading"><strong>{selected.scenario}</strong><span>{selected.closedAt ? 'Geschlossen' : 'Offen'} · Bild {selected.imageSha256.slice(0, 12)}</span></div>
      <p className={`team-review-revision ${revision && ['different-head', 'working-tree-dirty', 'checkout-changed'].includes(revision.status) ? 'team-review-revision-attention' : ''}`}>
        <strong>{revision ? revisionLabel(revision.status) : 'Git-Checkout wird geprüft'}</strong>
        <span>QA {selected.checkoutObservation?.endHead?.slice(0, 12) ?? 'unbekannt'} · jetzt {revision?.currentHead?.slice(0, 12) ?? 'unbekannt'}</span>
      </p>
      <p>Der Git-Vergleich belegt nicht, welche Dateien der Dev-Server ausgeliefert hat.</p>
      {image ? <div className="team-review-image"><img src={image} alt={`Gespeicherter Screenshot für ${selected.scenario}`} />{comments.map((comment, index) => <span key={comment.id} style={{ left: `${comment.x * 100}%`, top: `${comment.y * 100}%` }} title={`${comment.displayName}: ${comment.body}`} aria-hidden="true">{index + 1}</span>)}</div> : null}
      <ol className="team-review-comments">{comments.map((comment, index) => <li key={comment.id}><b>{index + 1} · {comment.displayName}</b><span>{comment.body}</span></li>)}</ol>
      <div className="team-review-invites"><strong>Einladungen</strong>{invites.map((invite) => <div key={invite.id}><span>{invite.displayName} · {invite.revokedAt ? 'widerrufen' : 'Review-Recht'}</span>{!invite.revokedAt && !selected.closedAt ? <button type="button" disabled={busy} onClick={() => void revoke(invite.id)}>Widerrufen</button> : null}</div>)}</div>
      {!selected.closedAt ? <><form className="team-review-form" onSubmit={(event) => { event.preventDefault(); void issueInvite('local'); }}><label>Weitere Person<input value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} maxLength={80} required placeholder="Name" /></label><button type="submit" disabled={busy}>Lokalen Link erstellen</button><button type="button" disabled={busy || !reviewerName.trim()} onClick={() => void issueInvite('tailnet')}>Tailscale-Link erstellen</button></form><button className="team-review-close" type="button" disabled={busy} onClick={() => void closeRoom()}>Review schließen</button></> : null}
    </section> : null}
    {share ? <div className="team-review-share"><label>Einmal angezeigter {share.transport === 'tailnet' ? 'Tailscale-' : 'lokaler '}Link<input readOnly value={share.url} onFocus={(event) => event.currentTarget.select()} /></label><button type="button" onClick={() => void shareAction('copy')}>Link kopieren</button><button type="button" onClick={() => void shareAction('open')}>Im Browser prüfen</button><small>Der Link enthält ein Review-Geheimnis. {share.transport === 'tailnet' ? 'Nur Mitglieder deines Tailnets mit Netzwerkzugriff können ihn öffnen. ' : ''}Nach Schließen der App kannst du für denselben Reviewstand einen neuen Link ausstellen.</small></div> : null}
    {!selected ? <form className="team-review-form" onSubmit={(event) => void create(event)}><label>Szenario<input value={scenario} onChange={(event) => setScenario(event.target.value)} maxLength={120} required placeholder="z. B. Einstellungen ohne Anmeldung" /></label><label>Reviewperson<input value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} maxLength={80} required placeholder="Name" /></label><button type="submit" disabled={busy}>Lokalen Reviewstand erstellen</button></form> : null}
  </details>;
}
