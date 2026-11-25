import { useEffect, useState } from 'react';
import type { CreateDevAccount, DevAccountOverview, DevAccountProbe, DevAccountSeedCheck, DevAccountSeedConfig, DevAccountSeedAttempt } from '../../shared/dev-account';
import './dev-account-panel.css';

const errorText = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
const emptyDraft = (projectId: string): CreateDevAccount => ({ projectId, service: '', environment: 'local', role: '', subject: '', probePath: '/api/me' });

export function DevAccountPanel({ projectId, cardId }: { projectId: string; cardId: string }) {
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState<DevAccountOverview | null>(null);
  const [draft, setDraft] = useState<CreateDevAccount>(() => emptyDraft(projectId));
  const [selectedId, setSelectedId] = useState('');
  const [previewReady, setPreviewReady] = useState(false);
  const [probe, setProbe] = useState<DevAccountProbe | null>(null);
  const [seedConfig, setSeedConfig] = useState<DevAccountSeedConfig | null>(null);
  const [seedPath, setSeedPath] = useState('/__branchloom/accounts');
  const [seedTargetId, setSeedTargetId] = useState('');
  const [seedCheck, setSeedCheck] = useState<DevAccountSeedCheck | null>(null);
  const [seedAttempt, setSeedAttempt] = useState<DevAccountSeedAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setOverview(null); setProbe(null); setSeedCheck(null); setSeedConfig(null); setSeedAttempt(null); setDraft(emptyDraft(projectId)); setSelectedId('');
  }, [projectId, cardId]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.all([window.studio.devAccountOverview({ projectId, cardId }), window.studio.cardDevEnvironment(cardId)])
      .then(async ([next, run]) => { if (live) { setOverview(next); setSelectedId(next.assignment?.accountId ?? next.accounts[0]?.id ?? ''); setPreviewReady(run?.state === 'ready' && run.managed); }
        if (next.assignment) { const config = await window.studio.devAccountSeedConfig(cardId); if (live) { setSeedConfig(config); setSeedPath(config?.path ?? '/__branchloom/accounts'); } }
      })
      .catch((reason: unknown) => { if (live) setError(errorText(reason)); });
    return () => { live = false; };
  }, [open, projectId, cardId]);

  async function refresh() {
    const [next, run] = await Promise.all([window.studio.devAccountOverview({ projectId, cardId }), window.studio.cardDevEnvironment(cardId)]);
    setOverview(next); setPreviewReady(run?.state === 'ready' && run.managed);
    setSelectedId((current) => next.accounts.some((item) => item.id === current) ? current : next.assignment?.accountId ?? next.accounts[0]?.id ?? '');
    if (next.assignment) { const config = await window.studio.devAccountSeedConfig(cardId); setSeedConfig(config); setSeedPath(config?.path ?? '/__branchloom/accounts'); }
    else { setSeedConfig(null); setSeedCheck(null); }
  }

  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (reason) { setError(errorText(reason)); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  }

  const assigned = overview?.accounts.find((item) => item.id === overview.assignment?.accountId) ?? null;
  const seedTargets = overview?.accounts.filter((item) => assigned && item.id !== assigned.id && item.service === assigned.service && item.environment === assigned.environment) ?? [];
  const effectiveTargetId = seedTargets.some((item) => item.id === seedTargetId) ? seedTargetId : seedTargets[0]?.id ?? '';
  const seedTarget = seedTargets.find((item) => item.id === effectiveTargetId);

  useEffect(() => {
    if (!open || !assigned || !effectiveTargetId) return;
    let live = true;
    void window.studio.lastDevAccountSeedAttempt({ cardId, targetId: effectiveTargetId })
      .then((attempt) => { if (live) setSeedAttempt(attempt); })
      .catch(() => { if (live) setSeedAttempt(null); });
    return () => { live = false; };
  }, [open, cardId, assigned?.id, effectiveTargetId]);

  return <section className="dev-account-panel" aria-label="Dev-Konto der Karte">
    <div className="dev-account-heading"><div><h3>Dev-Konto</h3><p>{assigned ? `${assigned.service} · ${assigned.environment} · ${assigned.role}` : 'Kein Konto zugewiesen'}</p></div><button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Schließen' : 'Öffnen'}</button></div>
    {open ? <>
      <p className="dev-account-copy">Eine Karten-Vorschau bekommt ein eigenes, flüchtiges Browserprofil je Konto. Die Anmeldung erfolgt im sichtbaren Fenster. Branchloom speichert hier keine Passwörter und gibt die Sitzung keinem Agenten.</p>
      <div className="dev-account-row"><button type="button" className="text-button" disabled={busy} onClick={() => void action(refresh)}>Status aktualisieren</button><span>{previewReady ? 'Karten-Vorschau bereit' : 'Karten-Vorschau zuerst starten'}</span></div>
      {overview?.accounts.length ? <div className="dev-account-row"><label>Projektkonto<select value={selectedId} disabled={busy} onChange={(event) => { setSelectedId(event.target.value); setProbe(null); setSeedCheck(null); }}>
        {overview.accounts.map((item) => <option value={item.id} key={item.id}>{item.service} · {item.environment} · {item.role} · {item.subject}</option>)}
      </select></label><button type="button" className="secondary-button" disabled={busy || !selectedId || assigned?.id === selectedId} onClick={() => void action(async () => { setOverview(await window.studio.assignDevAccount({ projectId, cardId, accountId: selectedId, expectedCardRevision: overview.cardRevision })); setProbe(null); setSeedCheck(null); await refresh(); })}>Dieser Karte zuweisen</button></div> : null}
      {assigned ? <div className="dev-account-actions"><button type="button" className="secondary-button" disabled={busy || !previewReady} onClick={() => void action(async () => { await window.studio.openDevAccount(cardId); setNotice('Anmeldefenster für dieses Konto geöffnet.'); })}>Anmeldefenster öffnen</button><button type="button" className="secondary-button" disabled={busy || !previewReady} onClick={() => void action(async () => { setProbe(await window.studio.probeDevAccount(cardId)); })}>Zugang prüfen</button><button type="button" className="text-button" disabled={busy} onClick={() => void action(async () => { setOverview(await window.studio.assignDevAccount({ projectId, cardId, accountId: null, expectedCardRevision: overview!.cardRevision })); setProbe(null); })}>Zuweisung entziehen</button><button type="button" className="text-button" disabled={busy} onClick={() => void action(async () => { await window.studio.forgetDevAccountSession({ projectId, accountId: assigned.id }); setProbe(null); setNotice('Diese Anmeldung wurde aus dem flüchtigen Browserprofil entfernt.'); })}>Anmeldung vergessen</button></div> : null}
      {probe ? <p className={probe.state === 'verified' ? 'dev-account-result' : 'inline-error'} role="status">{probe.state === 'verified' ? 'Konto und Rolle bestätigt' : probe.state === 'login-required' ? 'Anmeldung abgelaufen oder fehlt' : probe.state === 'access-denied' ? 'Zugriff entzogen oder nicht erlaubt' : probe.state === 'wrong-account' ? 'Anderes Konto oder andere Rolle angemeldet' : 'Identitätsprüfung nicht erreichbar'} · {new Date(probe.checkedAt).toLocaleTimeString('de-DE')}</p> : null}
      {assigned ? <details className="dev-account-create"><summary>Testkonto in dieser App anlegen</summary>
        <p>Nur für diese lokale Karten-Vorschau. Das angemeldete Konto muss über <code>{assigned.probePath}</code> bestätigt sein. Die Ziel-App muss den Seed-Vertrag selbst anbieten. Es werden weder Passwörter noch Sitzungen an Agenten gegeben.</p>
        <div className="dev-account-fields"><label>Lokaler Seed-Pfad<input value={seedPath} onChange={(event) => { setSeedPath(event.target.value); setSeedCheck(null); }} maxLength={121} /></label>
          <label>Zielkonto<select value={effectiveTargetId} onChange={(event) => { setSeedTargetId(event.target.value); setSeedCheck(null); setSeedAttempt(null); }}>
            {seedTargets.map((item) => <option key={item.id} value={item.id}>{item.role} · {item.subject}</option>)}
          </select></label></div>
        <div className="dev-account-actions"><button type="button" className="secondary-button" disabled={busy || !seedTargets.length || seedPath === seedConfig?.path} onClick={() => void action(async () => { const saved = await window.studio.saveDevAccountSeedConfig({ cardId, path: seedPath }); setSeedConfig(saved); setSeedCheck(null); setNotice('Lokaler Seed-Pfad gespeichert.'); })}>Pfad speichern</button>
          <button type="button" className="secondary-button" disabled={busy || !previewReady || !effectiveTargetId || !seedConfig || seedPath !== seedConfig.path} onClick={() => void action(async () => { setSeedCheck(await window.studio.checkDevAccountSeed({ cardId, targetId: effectiveTargetId })); setSeedAttempt(await window.studio.lastDevAccountSeedAttempt({ cardId, targetId: effectiveTargetId })); })}>Zielkonto prüfen</button></div>
        {seedCheck ? <p className="dev-account-result" role="status">{seedCheck.state === 'missing' ? 'Zielkonto fehlt in der aktuellen Vorschau.' : seedCheck.state === 'exists' ? 'Zielkonto ist bereits vorhanden.' : seedCheck.state === 'login-required' ? 'Anmeldung fehlt.' : seedCheck.state === 'access-denied' ? 'Zugriff verweigert.' : seedCheck.state === 'wrong-account' ? 'Anderes Konto angemeldet.' : 'Seed-API nicht erreichbar oder Antwort ungültig.'}</p> : null}
        {seedCheck?.state === 'missing' && seedCheck.id && seedTarget ? <div className="dev-account-confirm"><p>Jetzt <strong>{seedTarget.subject}</strong> mit Rolle <strong>{seedTarget.role}</strong> über <code>{seedConfig?.path}</code> in dieser Vorschau anlegen?</p><button type="button" className="secondary-button" disabled={busy} onClick={() => void action(async () => { const result = await window.studio.createDevAccountSeed({ cardId, targetId: effectiveTargetId, checkId: seedCheck.id! }); setSeedAttempt(result); setSeedCheck(null); setNotice(result.state === 'created' ? 'Ziel-App hat die Kontoanlage bestätigt.' : 'Zielkonto war inzwischen bereits vorhanden.'); })}>Jetzt anlegen</button></div> : null}
        {seedAttempt ? <p className="dev-account-result" role="status">Letzter Versuch: {seedAttempt.state === 'created' ? 'bestätigt' : seedAttempt.state === 'already-exists' ? 'bereits vorhanden' : seedAttempt.state === 'unknown' || seedAttempt.state === 'requested' ? 'Ausgang unbekannt; vor erneutem Versuch prüfen' : 'abgelehnt'} · {new Date(seedAttempt.at).toLocaleString('de-DE')}</p> : null}
      </details> : null}
      <details className="dev-account-create"><summary>Projektkonto erfassen</summary><form onSubmit={(event) => { event.preventDefault(); void action(async () => { const created = await window.studio.createDevAccount(draft); await refresh(); setSelectedId(created.id); setDraft(emptyDraft(projectId)); setNotice('Konto erfasst. Weise es der Karte zu.'); }); }}>
        <div className="dev-account-fields"><label>App/Dienst<input value={draft.service} maxLength={120} onChange={(event) => setDraft({ ...draft, service: event.target.value })} required /></label><label>Umgebung<input value={draft.environment} maxLength={120} onChange={(event) => setDraft({ ...draft, environment: event.target.value })} required /></label><label>Rolle<input value={draft.role} maxLength={120} onChange={(event) => setDraft({ ...draft, role: event.target.value })} required /></label><label>Konto-ID<input value={draft.subject} maxLength={120} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} required /></label><label>Identitätsprüfpfad<input value={draft.probePath} maxLength={121} onChange={(event) => setDraft({ ...draft, probePath: event.target.value })} required placeholder="/api/me" /></label></div>
        <p>Die lokale App muss dort nach Login JSON mit <code>subject</code> und <code>role</code> liefern. Ein HTTP 401 bedeutet Anmeldung nötig, 403 verweigerten Zugriff. Zugangsdaten werden nicht erfasst.</p><button type="submit" className="secondary-button" disabled={busy}>Konto erfassen</button>
      </form></details>
      {notice ? <p className="dev-account-result" role="status">{notice}</p> : null}{error ? <p className="inline-error" role="alert">{error}</p> : null}
    </> : null}
  </section>;
}
