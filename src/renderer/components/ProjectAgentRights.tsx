import { useEffect, useState } from 'react';
import type { CodexWorkflowAccessMode } from '../../shared/project-agent-rights';
import './project-agent-rights.css';

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function ProjectAgentRights({ projectId }: { projectId: string }) {
  const [savedMode, setSavedMode] = useState<CodexWorkflowAccessMode>('workspace');
  const [mode, setMode] = useState<CodexWorkflowAccessMode>('workspace');
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setNotice(''); setAcknowledged(false);
    void window.studio.projectCodexWorkflowAccess(projectId)
      .then((saved) => { if (active) { setSavedMode(saved.mode); setMode(saved.mode); } })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || saving || mode === savedMode || (mode === 'full' && !acknowledged)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const saved = await window.studio.setProjectCodexWorkflowAccess({ projectId, mode, acknowledgeFullAccess: mode === 'full' && acknowledged });
      setSavedMode(saved.mode);
      setMode(saved.mode);
      setAcknowledged(false);
      setNotice(saved.mode === 'full'
        ? 'Voller Codex-Zugriff ist für neu gestartete Workflow-Schritte dieses Projekts gespeichert.'
        : 'Codex-Workflow-Schritte verwenden wieder die automatische Prüfung im Projektmodus.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setSaving(false); }
  }

  return <section className="project-agent-rights" aria-label="Codex-Rechte für Workflow-Schritte">
    <header><div><h3>Codex-Rechte für Workflow-Schritte</h3><p>Gilt für neu gestartete Codex-Schritte in Workflows und der Projekt-Queue. Andere Agenten behalten ihre eigenen CLI-Einstellungen.</p></div><span>{mode === savedMode ? savedMode === 'full' ? 'Voller Zugriff' : 'Projektmodus' : 'Ungespeichert'}</span></header>
    <form onSubmit={(event) => void save(event)}>
      <label className="project-agent-rights-choice"><input type="radio" name={`codex-access-${projectId}`} checked={mode === 'workspace'} disabled={loading || saving} onChange={() => { setMode('workspace'); setAcknowledged(false); }} /><span><strong>Projektmodus</strong><small>Codex prüft Aktionen automatisch in seiner Workspace-Sandbox.</small></span></label>
      <label className="project-agent-rights-choice"><input type="radio" name={`codex-access-${projectId}`} checked={mode === 'full'} disabled={loading || saving} onChange={() => { setMode('full'); setAcknowledged(false); }} /><span><strong>Voller CLI-Zugriff</strong><small>Codex startet ohne Sandbox und ohne Bestätigungsdialoge.</small></span></label>
      {mode === 'full' ? <div className="project-agent-rights-warning">
        <p>Der Codex-Prozess läuft mit deinen Benutzerrechten. Er kann auch außerhalb des Projektordners Dateien, Netzwerkdienste und angemeldete Konten erreichen. Ein Git-Worktree begrenzt diesen Zugriff nicht.</p>
        {savedMode !== 'full' ? <label><input type="checkbox" checked={acknowledged} disabled={loading || saving} onChange={(event) => setAcknowledged(event.currentTarget.checked)} /><span>Ich möchte diesen Zugriff für neu gestartete Codex-Workflow-Schritte dieses Projekts aktivieren.</span></label> : null}
      </div> : null}
      <div className="project-agent-rights-actions"><button type="submit" className="secondary-button" disabled={loading || saving || mode === savedMode || (mode === 'full' && !acknowledged)}>{saving ? 'Speichere…' : 'Rechte speichern'}</button><small>Eine laufende Queue muss zum Ändern pausiert sein.</small></div>
    </form>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="inline-note" role="status">{notice}</p> : null}
  </section>;
}
