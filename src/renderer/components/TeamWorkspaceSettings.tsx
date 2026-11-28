import { useEffect, useState, type FormEvent } from 'react';
import type { HostedTeamWorkspace, OwnedTeamWorkspace, TeamTailnetStatus } from '../../main/team-local-service';
import type { SavedTeamConnection } from '../../main/team-connection-store';
import './team-workspace-settings.css';

type InviteRole = 'admin' | 'editor' | 'developer' | 'viewer';
type FreshInvitation = { inviteSecret: string; coordinatorUrl: string; expiresAt: string };
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function TeamWorkspaceSettings({ projectId, onConnectionChange }: { projectId?: string; onConnectionChange?: () => void }) {
  const [hosted, setHosted] = useState<HostedTeamWorkspace | null>(null);
  const [owned, setOwned] = useState<OwnedTeamWorkspace[]>([]);
  const [workspaceChoice, setWorkspaceChoice] = useState('');
  const [attachCandidate, setAttachCandidate] = useState<string | null>(null);
  const [connections, setConnections] = useState<SavedTeamConnection[]>([]);
  const [pendingJoin, setPendingJoin] = useState<{ coordinatorUrl: string; displayName: string } | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [role, setRole] = useState<InviteRole>('editor');
  const [invitation, setInvitation] = useState<FreshInvitation | null>(null);
  const [tailnet, setTailnet] = useState<TeamTailnetStatus>({ enabled: false, coordinatorUrl: null });
  const [inviteTransport, setInviteTransport] = useState<'local' | 'tailnet'>('local');
  const [coordinatorUrl, setCoordinatorUrl] = useState('');
  const [inviteSecret, setInviteSecret] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [revokeCandidate, setRevokeCandidate] = useState<string | null>(null);
  const [grantCandidate, setGrantCandidate] = useState<string | null>(null);
  const [startCandidate, setStartCandidate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setNotice(''); setInvitation(null);
    void Promise.all([projectId ? window.studio.hostedTeamProject(projectId) : Promise.resolve(null),
      window.studio.teamConnections(), window.studio.pendingTeamJoin(), window.studio.ownedTeamWorkspaces()])
      .then(([nextHosted, nextConnections, nextPending, nextOwned]) => {
        if (active) { setHosted(nextHosted); setConnections(nextConnections); setPendingJoin(nextPending);
          setOwned(nextOwned); setWorkspaceChoice(nextOwned[0]?.workspaceId ?? ''); if (nextHosted && projectId) {
            onConnectionChange?.();
            void window.studio.teamTailnetStatus(projectId).then((state) => { if (active) setTailnet(state); })
              .catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
          } else setTailnet({ enabled: false, coordinatorUrl: null }); }
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

  async function addToWorkspace() {
    if (busy || !projectId || !owned.some((item) => item.workspaceId === workspaceChoice)) return;
    if (attachCandidate !== workspaceChoice) { setAttachCandidate(workspaceChoice); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      setHosted(await window.studio.addProjectToTeamWorkspace({ projectId, workspaceId: workspaceChoice }));
      setAttachCandidate(null);
      onConnectionChange?.();
      setNotice('Projekt verknüpft. Mitglieder erhalten erst nach ausdrücklicher Projektfreigabe Zugang.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function invite() {
    if (busy || !projectId) return;
    setBusy(true); setError(''); setNotice(''); setInvitation(null);
    try {
      setInvitation(await window.studio.inviteTeamMember({ projectId, role, transport: inviteTransport }));
      setNotice('Einladung erstellt. Der Code wird nur jetzt angezeigt.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function toggleTailnet() {
    if (busy || !projectId) return;
    setBusy(true); setError(''); setNotice(''); setInvitation(null);
    try {
      const next = tailnet.enabled ? await window.studio.disableTeamTailnet(projectId)
        : await window.studio.enableTeamTailnet(projectId);
      setTailnet(next);
      if (!next.enabled) setInviteTransport('local');
      setNotice(next.enabled ? 'Tailscale-Teamzugang ist auf diesem Gerät aktiv.' : 'Tailscale-Teamzugang beendet.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function refreshMembers() {
    if (busy || !projectId) return;
    setBusy(true); setError('');
    try { setHosted(await window.studio.hostedTeamProject(projectId)); }
    catch (reason) { setError(messageOf(reason)); }
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

  async function setProjectAccess(memberId: string, access: 'none' | 'read' | 'edit' | null) {
    if (busy || !projectId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      setHosted(await window.studio.setTeamProjectAccess({ projectId, memberId, access }));
      setNotice('Projektzugang aktualisiert. Neue Team-Anfragen verwenden die aktuellen Rechte.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function setExtraGrant(memberId: string, capability: 'manage_task' | 'start_agent', grant: boolean) {
    if (busy || !projectId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      setHosted(await window.studio.setTeamCapabilityGrant({ projectId, memberId, capability, grant }));
      setGrantCandidate(null); setStartCandidate(null);
      setNotice(`${capability === 'start_agent' ? 'Agentenstart' : 'Aufgabensteuerung'} ${grant ? 'freigegeben' : 'entfernt'}.`);
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
    <header><h3>Team-Workspace</h3><p>Projekte gemeinsam verwalten. Verbunden über dieses Gerät oder bewusst über Tailscale.</p></header>
    {loading ? <p className="team-workspace-muted">Teamzugang wird geladen…</p> : null}
    {!loading && !hosted && projectId ? <form className="team-workspace-form" onSubmit={(event) => void create(event)}>
      <label>Workspace-Name<input value={workspaceName} onChange={(event) => setWorkspaceName(event.currentTarget.value)} maxLength={80} required placeholder="Produktteam" /></label>
      <label>Dein Name<input value={ownerName} onChange={(event) => setOwnerName(event.currentTarget.value)} maxLength={80} required placeholder="Max" /></label>
      <button type="submit" className="secondary-button" disabled={busy}>Auf diesem Gerät erstellen</button>
    </form> : null}
    {!loading && !hosted && projectId && owned.length ? <div className="team-workspace-attach">
      <p>Dieses Projekt einem vorhandenen Workspace hinzufügen. Bestehende und spätere Mitglieder sehen es erst nach einer eigenen Projektfreigabe.</p>
      <label>Team-Workspace<select value={workspaceChoice} disabled={busy} onChange={(event) => {
        setWorkspaceChoice(event.currentTarget.value); setAttachCandidate(null);
      }}>{owned.map((item) => <option key={item.workspaceId} value={item.workspaceId}>
        {item.name} · {item.projectCount} Projekte · {item.memberCount} Mitglieder</option>)}</select></label>
      {attachCandidate === workspaceChoice ? <span className="team-workspace-confirm">
        <button type="button" disabled={busy} onClick={() => void addToWorkspace()}>Projekt hinzufügen bestätigen</button>
        <button type="button" disabled={busy} onClick={() => setAttachCandidate(null)}>Abbrechen</button>
      </span> : <button type="button" className="secondary-button" disabled={busy} onClick={() => void addToWorkspace()}>Projekt hinzufügen</button>}
    </div> : null}
    {hosted ? <div className="team-workspace-hosted">
      <div className="team-workspace-title"><strong>{hosted.name}</strong><span>{hosted.members.filter((member) => !member.revokedAt).length} Mitglieder · lokal erreichbar</span>
        <button type="button" className="text-button" disabled={busy} onClick={() => void refreshMembers()}>Mitglieder aktualisieren</button></div>
      <ul className="team-workspace-members">{hosted.members.filter((member) => !member.revokedAt).map((member) => <li key={member.id}>
        <div className="team-workspace-member-line"><span><strong>{member.displayName}</strong><small>{member.role}</small></span>
        {member.role !== 'owner' ? revokeCandidate === member.id ? <span className="team-workspace-confirm">
          <button type="button" disabled={busy} onClick={() => void revoke(member.id)}>Widerruf bestätigen</button>
          <button type="button" disabled={busy} onClick={() => setRevokeCandidate(null)}>Abbrechen</button>
        </span> : <button type="button" className="text-button" disabled={busy} onClick={() => setRevokeCandidate(member.id)}>Zugriff widerrufen</button> : null}</div>
        {member.role !== 'owner' ? <details className="team-workspace-member-rights"><summary>Projektrechte</summary>
          <label>Projektzugang<select value={member.projectAccess ?? 'inherit'} disabled={busy} onChange={(event) => void setProjectAccess(member.id,
            event.currentTarget.value === 'inherit' ? null : event.currentTarget.value as 'none' | 'read' | 'edit')}>
            <option value="inherit">{hosted.defaultMemberAccess === 'none' ? 'Projektstandard: kein Zugang' : 'Teamrolle übernehmen'}</option><option value="read">Nur lesen</option>
            {member.role !== 'viewer' ? <option value="edit">Teamrolle im Projekt nutzen</option> : null}
            <option value="none">Kein Zugang</option>
          </select></label>
          <div className="team-workspace-extra-right"><strong>Aufgabensteuerung</strong>
            <p>Erlaubt Priorität und Spaltenwechsel auf dem gemeinsamen Board. Agentenstart, Planfreigabe und Merge sind getrennte Rechte.</p>
            {member.role === 'admin' ? <small>Bereits durch die Admin-Rolle erlaubt.</small>
              : member.extraCapabilities.includes('manage_task')
                ? <button type="button" className="text-button" disabled={busy} onClick={() => void setExtraGrant(member.id, 'manage_task', false)}>Zusatzrecht entfernen</button>
                : grantCandidate === member.id ? <span className="team-workspace-confirm">
                  <button type="button" disabled={busy} onClick={() => void setExtraGrant(member.id, 'manage_task', true)}>Aufgabensteuerung bestätigen</button>
                  <button type="button" disabled={busy} onClick={() => setGrantCandidate(null)}>Abbrechen</button>
                </span> : <button type="button" className="text-button" disabled={busy} onClick={() => setGrantCandidate(member.id)}>Aufgabensteuerung erlauben</button>}
            {member.projectAccess === 'none' || member.projectAccess === 'read' ? <small>Dieses Zusatzrecht wirkt erst bei vollem Projektzugang.</small> : null}
          </div>
          <div className="team-workspace-extra-right"><strong>Agentenstart auf dem Host</strong>
            <p>Erlaubt dem Mitglied, durch Verschieben in eine Auto-Start-Spalte deine lokale CLI in einem eigenen Git-Worktree zu starten. Zusätzlich sind Aufgabensteuerung und voller Projektzugang nötig.</p>
            {member.role === 'admin' ? <small>Bereits durch die Admin-Rolle erlaubt.</small>
              : member.extraCapabilities.includes('start_agent')
                ? <button type="button" className="text-button" disabled={busy} onClick={() => void setExtraGrant(member.id, 'start_agent', false)}>Agentenstartrecht entfernen</button>
                : startCandidate === member.id ? <span className="team-workspace-confirm">
                  <button type="button" disabled={busy} onClick={() => void setExtraGrant(member.id, 'start_agent', true)}>Agentenstart bestätigen</button>
                  <button type="button" disabled={busy} onClick={() => setStartCandidate(null)}>Abbrechen</button>
                </span> : <button type="button" className="text-button" disabled={busy} onClick={() => setStartCandidate(member.id)}>Agentenstart erlauben</button>}
            {member.projectAccess === 'none' || member.projectAccess === 'read' ? <small>Dieses Zusatzrecht wirkt erst bei vollem Projektzugang.</small> : null}
          </div>
        </details> : null}
      </li>)}</ul>
      <div className="team-workspace-tailnet"><strong>Tailscale-Zugang</strong>
        <p>{tailnet.enabled ? `Aktiv auf ${tailnet.coordinatorUrl}. Nur Geräte in deinem Tailnet erreichen diesen Koordinator.`
          : 'Aus. Für ein zweites Gerät im selben Tailnet bewusst aktivieren. Die Freigabe endet beim Schließen von Branchloom.'}</p>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void toggleTailnet()}>
          {tailnet.enabled ? 'Tailscale-Zugang beenden' : 'Tailscale-Zugang aktivieren'}</button>
      </div>
      <div className="team-workspace-invite"><label>Rolle<select value={role} disabled={busy} onChange={(event) => setRole(event.currentTarget.value as InviteRole)}>
        <option value="editor">Mitglied · Entwürfe und Vorschläge</option><option value="developer">Entwicklung · Entwürfe</option>
        <option value="viewer">Ansicht · lesen</option><option value="admin">Admin · erweiterte Rechte</option>
      </select></label><label>Verbindung<select value={inviteTransport} disabled={busy} onChange={(event) => {
        setInviteTransport(event.currentTarget.value as 'local' | 'tailnet'); setInvitation(null);
      }}><option value="local">Dieser Rechner</option><option value="tailnet" disabled={!tailnet.enabled}>Anderes Gerät über Tailscale</option>
      </select></label><button type="button" className="secondary-button" disabled={busy} onClick={() => void invite()}>Einladung erstellen</button></div>
      {invitation ? <div className="team-workspace-invitation" role="status">
        <p>Einmaliger Code, gültig bis {new Date(invitation.expiresAt).toLocaleString('de-DE')}.</p>
        <label>Koordinator<input readOnly value={invitation.coordinatorUrl} onFocus={(event) => event.currentTarget.select()} /></label>
        <label>Einladungscode<input readOnly value={invitation.inviteSecret} onFocus={(event) => event.currentTarget.select()} /></label>
        <small>Beide Werte nur an die eingeladene Person geben. Der Tailscale-Link funktioniert nur bei aktivem Zugang und wenn beide Geräte mit demselben Tailnet verbunden sind.</small>
      </div> : null}
    </div> : null}
    <details className="team-workspace-join"><summary>Einladung annehmen</summary>
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
