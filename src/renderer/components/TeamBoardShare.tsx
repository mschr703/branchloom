import { useEffect, useState } from 'react';
import type { TeamBoardInvite } from '../../shared/team-board';
import './team-board-share.css';

type Transport = 'local' | 'tailnet';
type FreshLink = { invite: TeamBoardInvite; secret: string; url: string; transport: Transport };
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function TeamBoardShare({ projectId }: { projectId: string }) {
  const [name, setName] = useState('');
  const [invites, setInvites] = useState<TeamBoardInvite[]>([]);
  const [fresh, setFresh] = useState<FreshLink | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setFresh(null); setError(''); setNotice(''); setInvites([]);
    void window.studio.teamBoardInvites(projectId)
      .then((value) => { if (active) setInvites(value); })
      .catch((reason: unknown) => { if (active) setError(errorText(reason)); });
    return () => { active = false; };
  }, [projectId]);

  async function create(transport: Transport) {
    if (!name.trim() || pending) return;
    setPending(true); setError(''); setNotice('');
    try {
      const created = await window.studio.createTeamBoardInvite({ projectId, displayName: name.trim(), transport });
      setFresh({ ...created, transport });
      setInvites(await window.studio.teamBoardInvites(projectId));
      setName('');
      setNotice('Leselink erstellt. Er wird nur jetzt vollständig angezeigt und läuft spätestens nach 24 Stunden ab.');
    } catch (reason) { setError(errorText(reason)); }
    finally { setPending(false); }
  }

  async function useLink(action: 'copy' | 'open') {
    if (!fresh) return;
    setError(''); setNotice('');
    try {
      const input = { secret: fresh.secret, transport: fresh.transport };
      if (action === 'copy') await window.studio.copyTeamBoardInvite(input);
      else await window.studio.openTeamBoardInvite(input);
      setNotice(action === 'copy' ? 'Link kopiert.' : 'Gastansicht im Browser geöffnet.');
    } catch (reason) { setError(errorText(reason)); }
  }

  async function revoke(inviteId: string) {
    if (pending) return;
    setPending(true); setError(''); setNotice('');
    try {
      const updated = await window.studio.revokeTeamBoardInvite({ projectId, inviteId });
      setInvites((current) => current.map((item) => item.id === inviteId ? updated : item));
      if (fresh?.invite.id === inviteId) setFresh(null);
      setNotice('Gastlink widerrufen.');
    } catch (reason) { setError(errorText(reason)); }
    finally { setPending(false); }
  }

  return <section className="team-board-share" aria-label="Projektboard teilen">
    <div className="team-board-share-heading"><div><h3>Projektboard teilen</h3>
      <p>Ein Gast sieht Spalten, Kartentitel und laufende Sitzungen. Kartenbeschreibungen, Projektpfade und Agentenprotokolle bleiben auf diesem Gerät. Der Link erlaubt keine Änderungen.</p></div><span>Nur lesen</span></div>
    <div className="team-board-share-create"><label htmlFor={`team-board-guest-${projectId}`}>Name für den Gast</label>
      <div className="team-board-share-controls"><input id={`team-board-guest-${projectId}`} value={name} maxLength={80} autoComplete="off" placeholder="z. B. Alex" disabled={pending} onChange={(event) => setName(event.currentTarget.value)} />
        <button type="button" className="secondary-button" disabled={pending || !name.trim()} onClick={() => void create('tailnet')}>Tailscale-Link erstellen</button>
        <button type="button" className="text-button" disabled={pending || !name.trim()} onClick={() => void create('local')}>Auf diesem Gerät testen</button></div></div>
    {fresh && !fresh.invite.revokedAt ? <div className="team-board-share-link" role="status"><label htmlFor={`team-board-link-${projectId}`}>Neuer Link für {fresh.invite.displayName}</label>
      <input id={`team-board-link-${projectId}`} readOnly value={fresh.url} onFocus={(event) => event.currentTarget.select()} />
      <div><button type="button" className="secondary-button" onClick={() => void useLink('copy')}>Link kopieren</button>
        <button type="button" className="text-button" onClick={() => void useLink('open')}>Im Browser prüfen</button></div></div> : null}
    {invites.length ? <div className="team-board-share-invites"><h4>Einladungen</h4>
      <ul>{invites.map((invite) => { const active = !invite.revokedAt && Date.parse(invite.expiresAt) > Date.now();
        return <li key={invite.id}><div><strong>{invite.displayName}</strong><small>{active ? `Leserechte bis ${new Date(invite.expiresAt).toLocaleString('de-DE')}` : 'Beendet'}</small></div>
          {active ? <button type="button" className="text-button" disabled={pending} onClick={() => void revoke(invite.id)}>Widerrufen</button> : null}</li>;
      })}</ul></div> : null}
    <p className="team-board-share-footnote">Der Link gilt nur für dieses Projekt und diese laufende App-Sitzung. Nach einem Neustart braucht der Gast einen neuen Link.</p>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="inline-note" role="status">{notice}</p> : null}
  </section>;
}
