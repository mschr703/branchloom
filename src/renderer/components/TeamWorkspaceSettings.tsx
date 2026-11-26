import { useEffect, useState, type FormEvent } from 'react';
import type { HostedTeamWorkspace } from '../../main/team-local-service';
import type { SavedTeamConnection } from '../../main/team-connection-store';
import './team-workspace-settings.css';

type InviteRole = 'admin' | 'editor' | 'developer' | 'viewer';
type FreshInvitation = { inviteSecret: string; coordinatorUrl: string; expiresAt: string };
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function TeamWorkspaceSettings({ projectId, onConnectionChange }: { projectId?: string; onConnectionChange?: () => void }) {
  const [hosted, setHosted] = useState<HostedTeamWorkspace | null>(null);
  const [connections, setConnections] = useState<SavedTeamConnection[]>([]);
  const [pendingJoin, setPendingJoin] = useState<{ coordinatorUrl: string; displayName: string } | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [role, setRole] = useState<InviteRole>('editor');
  const [invitation, setInvitation] = useState<FreshInvitation | null>(null);
  const [coordinatorUrl, setCoordinatorUrl] = useState('');
  const [inviteSecret, setInviteSecret] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [revokeCandidate, setRevokeCandidate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setNotice(''); setInvitation(null);
    void Promise.all([projectId ? window.studio.hostedTeamProject(projectId) : Promise.resolve(null),
      window.studio.teamConnections(), window.studio.pendingTeamJoin()])
      .then(([nextHosted, nextConnections, nextPending]) => {
        if (active) { setHosted(nextHosted); setConnections(nextConnections); setPendingJoin(nextPending); if (nextHosted) onConnectionChange?.(); }
      })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !projectId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await window.studio.createLocalTeamWorkspace({ projectId,
        workspaceName: workspaceName.trim(), ownerName: ownerName.trim() });
      setHosted(next); setConnections(await window.studio.teamConnections());
      onConnectionChange?.();
      setNotice('Team-Workspace auf diesem Gerät erstellt.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function invite() {
    if (busy || !projectId) return;
    setBusy(true); setError(''); setNotice(''); setInvitation(null);
    try {
      setInvitation(await window.studio.inviteTeamMember({ projectId, role }));
      setNotice('Einladung erstellt. Der Code wird nur jetzt angezeigt.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function revoke(memberId: string) {
    if (busy || !projectId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      setHosted(await window.studio.revokeTeamMember({ projectId, memberId }));
      setNotice('Zugriff widerrufen. Neue Anfragen dieses Mitglieds werden abgewiesen.');
      setRevokeCandidate(null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const joined = await window.studio.joinTeam({ coordinatorUrl: coordinatorUrl.trim(),
        inviteSecret: inviteSecret.trim(), displayName: displayName.trim() });
      setConnections(await window.studio.teamConnections()); setPendingJoin(null); setInviteSecret('');
      onConnectionChange?.();
      setNotice(`Mit ${joined.displayName} als ${joined.role} verbunden. Du kannst jetzt einen gemeinsamen Kartenentwurf öffnen.`);
    } catch (reason) {
      setError(messageOf(reason));
      setPendingJoin(await window.studio.pendingTeamJoin().catch(() => null));
    } finally { setBusy(false); }
  }

  async function resume() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await window.studio.resumeTeamJoin();
      setConnections(await window.studio.teamConnections()); setPendingJoin(null); setInviteSecret('');
      onConnectionChange?.();
      setNotice('Einladung fortgesetzt und Teamzugang gespeichert.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await window.studio.cancelTeamJoin(); setPendingJoin(null); setNotice('Ausstehende Einladung verworfen.'); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <section className="team-workspace-settings" aria-label="Team-Workspace">
    <header><h3>Team-Workspace</h3><p>Ein Projekt gemeinsam verwalten. Dieser erste Koordinator läuft nur auf diesem Gerät.</p></header>
    {loading ? <p className="team-workspace-muted">Teamzugang wird geladen…</p> : null}
    {!loading && !hosted && projectId ? <form className="team-workspace-form" onSubmit={(event) => void create(event)}>
      <label>Workspace-Name<input value={workspaceName} onChange={(event) => setWorkspaceName(event.currentTarget.value)} maxLength={80} required placeholder="Produktteam" /></label>
      <label>Dein Name<input value={ownerName} onChange={(event) => setOwnerName(event.currentTarget.value)} maxLength={80} required placeholder="Max" /></label>
      <button type="submit" className="secondary-button" disabled={busy}>Auf diesem Gerät erstellen</button>
    </form> : null}
    {hosted ? <div className="team-workspace-hosted">
      <div className="team-workspace-title"><strong>{hosted.name}</strong><span>{hosted.members.filter((member) => !member.revokedAt).length} Mitglieder · lokal erreichbar</span></div>
      <ul className="team-workspace-members">{hosted.members.filter((member) => !member.revokedAt).map((member) => <li key={member.id}>
        <span><strong>{member.displayName}</strong><small>{member.role}</small></span>
        {member.role !== 'owner' ? revokeCandidate === member.id ? <span className="team-workspace-confirm">
          <button type="button" disabled={busy} onClick={() => void revoke(member.id)}>Widerruf bestätigen</button>
          <button type="button" disabled={busy} onClick={() => setRevokeCandidate(null)}>Abbrechen</button>
        </span> : <button type="button" className="text-button" disabled={busy} onClick={() => setRevokeCandidate(member.id)}>Zugriff widerrufen</button> : null}
      </li>)}</ul>
      <div className="team-workspace-invite"><label>Rolle<select value={role} disabled={busy} onChange={(event) => setRole(event.currentTarget.value as InviteRole)}>
        <option value="editor">Mitglied · Entwürfe und Vorschläge</option><option value="developer">Entwicklung · Entwürfe</option>
        <option value="viewer">Ansicht · lesen</option><option value="admin">Admin · erweiterte Rechte</option>
      </select></label><button type="button" className="secondary-button" disabled={busy} onClick={() => void invite()}>Einladung erstellen</button></div>
      {invitation ? <div className="team-workspace-invitation" role="status">
        <p>Einmaliger Code, gültig bis {new Date(invitation.expiresAt).toLocaleString('de-DE')}.</p>
        <label>Koordinator<input readOnly value={invitation.coordinatorUrl} onFocus={(event) => event.currentTarget.select()} /></label>
        <label>Einladungscode<input readOnly value={invitation.inviteSecret} onFocus={(event) => event.currentTarget.select()} /></label>
        <small>Beide Werte nur an die eingeladene Person geben. Die lokale Adresse funktioniert ausschließlich auf diesem Rechner.</small>
      </div> : null}
    </div> : null}
    <details className="team-workspace-join"><summary>Einladung auf diesem Gerät annehmen</summary>
      {pendingJoin ? <div className="team-workspace-pending"><p>Eine Einladung von {pendingJoin.coordinatorUrl} für {pendingJoin.displayName} wartet auf Wiederholung.</p>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void resume()}>Erneut verbinden</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => void cancel()}>Verwerfen</button></div>
        : <form className="team-workspace-form" onSubmit={(event) => void join(event)}>
          <label>Koordinator-Adresse<input value={coordinatorUrl} onChange={(event) => setCoordinatorUrl(event.currentTarget.value)} required placeholder="http://127.0.0.1:…" /></label>
          <label>Einladungscode<input value={inviteSecret} onChange={(event) => setInviteSecret(event.currentTarget.value)} required autoComplete="off" /></label>
          <label>Dein Name<input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} maxLength={80} required /></label>
          <button type="submit" className="secondary-button" disabled={busy}>Verbinden</button>
        </form>}
    </details>
    {connections.length ? <p className="team-workspace-muted">Gespeicherte Teamzugänge: {connections.length}. Gemeinsame Kartenentwürfe sind verfügbar; Whiteboard-Bearbeitung folgt.</p> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="inline-note" role="status">{notice}</p> : null}
  </section>;
}
