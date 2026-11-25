import { useEffect, useState } from 'react';
import type { AgentBrowserPolicy } from '../../shared/agent-browser';
import './agent-browser-settings.css';

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function AgentBrowserSettings({ projectId }: { projectId: string }) {
  const [policy, setPolicy] = useState<AgentBrowserPolicy>({ projectId, enabled: false, origin: '' });
  const [savedPolicy, setSavedPolicy] = useState<AgentBrowserPolicy>({ projectId, enabled: false, origin: '' });
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setNotice('');
    Promise.all([window.studio.agentBrowserPolicy(projectId), window.studio.agentBrowserAvailable()])
      .then(([saved, serviceAvailable]) => { if (active) { setPolicy(saved); setSavedPolicy(saved); setAvailable(serviceAvailable); } })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loading || policy.projectId !== projectId) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const saved = await window.studio.setAgentBrowserPolicy(policy);
      setPolicy(saved);
      setSavedPolicy(saved);
      setNotice(saved.enabled ? `Nur lesende Agentenprüfung für ${saved.origin} freigegeben. Die Änderung gilt für neu gestartete Kartenläufe.` : 'Agentenprüfung für dieses Projekt gesperrt.');
      setAvailable(await window.studio.agentBrowserAvailable());
    } catch (reason) { setError(messageOf(reason)); }
    finally { setSaving(false); }
  }

  return <section className="agent-browser-settings" aria-label="Browser-Automation für Agenten">
    <div className="agent-browser-settings-head"><div><h3>Browser-Automation</h3><p>Verfügbar: isolierter Branchloom-Browser für lesende Prüfungen einer lokalen Dev-Seite. Chrome, Edge und persönliche Profile sind nicht verbunden. Die Webvorschau mit deinen Tabs und Anmeldungen bleibt allein unter deiner Kontrolle.</p></div><span>{policy.enabled !== savedPolicy.enabled || policy.origin !== savedPolicy.origin ? 'Ungespeichert' : savedPolicy.enabled ? 'Freigegeben' : 'Gesperrt'}</span></div>
    <form onSubmit={(event) => void save(event)}>
      <label>Erlaubte lokale Adresse<input type="url" value={policy.origin} disabled={loading || saving || policy.projectId !== projectId} onChange={(event) => setPolicy((old) => ({ ...old, origin: event.target.value }))} placeholder="http://127.0.0.1:5173" spellCheck={false} aria-describedby="agent-browser-origin-help" /></label>
      <p id="agent-browser-origin-help">Nur genau dieser Ursprung. Der Agent kann Pfade darauf öffnen; andere Domains, Downloads und Schreibanfragen werden gesperrt.</p>
      <label className="agent-browser-choice"><input type="checkbox" checked={policy.enabled} disabled={loading || saving || policy.projectId !== projectId} onChange={(event) => setPolicy((old) => ({ ...old, enabled: event.target.checked }))} /><span>Lesenden Browserzugriff für neu gestartete Kartenagenten erlauben</span></label>
      <div className="agent-browser-actions"><button type="submit" className="secondary-button" disabled={loading || saving || policy.projectId !== projectId}>{saving ? 'Speichere…' : 'Freigabe speichern'}</button><small>Kein Klick, Formular, Login oder Submit durch Agenten.</small></div>
    </form>
    {available === false ? <p className="agent-browser-unavailable" role="status">Der lokale Agenten-Browserdienst ist nicht erreichbar. Eine gespeicherte Freigabe gibt derzeit keinen Zugriff.</p> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="agent-browser-notice" role="status">{notice}</p> : null}
  </section>;
}
