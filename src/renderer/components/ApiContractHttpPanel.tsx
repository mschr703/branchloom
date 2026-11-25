import { useEffect, useState } from 'react';
import type { ApiContractLiveCheck, ApiContractMockState, ApiContractVersion } from '../../shared/api-contract';

interface Props { projectId: string; contract: ApiContractVersion }
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function ApiContractHttpPanel({ projectId, contract }: Props) {
  const [mock, setMock] = useState<ApiContractMockState | null>(null);
  const [checks, setChecks] = useState<ApiContractLiveCheck[]>([]);
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:3000');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setMock(null); setChecks([]); setError('');
    void Promise.all([window.studio.apiContractMockState(projectId), window.studio.apiContractLiveChecks(projectId)])
      .then(([state, history]) => { if (live) { setMock(state); setChecks(history); } })
      .catch((reason: unknown) => { if (live) setError(errorMessage(reason)); });
    return () => { live = false; };
  }, [projectId, contract.revision]);

  async function start() {
    setPending(true); setError('');
    try { setMock(await window.studio.startApiContractMock({ projectId, revision: contract.revision })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setPending(false); }
  }
  async function stop() {
    setPending(true); setError('');
    try { setMock(await window.studio.stopApiContractMock(projectId)); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setPending(false); }
  }
  async function check() {
    setPending(true); setError('');
    try {
      await window.studio.checkApiContractEndpoint({ projectId, revision: contract.revision, baseUrl: baseUrl.trim() });
      setChecks(await window.studio.apiContractLiveChecks(projectId));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setPending(false); }
  }
  const newest = checks[0];
  return <div className="api-contract__section api-contract__http" aria-label="Lokaler API-Mock und Endpoint-Prüfung">
    <h4>Lokaler Mock und Endpoint-Prüfung</h4>
    <p>Der Mock liefert synthetische Beispiele dieser Revision auf 127.0.0.1. Die Live-Prüfung ruft nach deinem Klick nur eine lokale Adresse ab. Antwortinhalte werden nicht gespeichert.</p>
    <div className="api-contract__http-row"><div><strong>Beispielserver</strong><small>{mock?.running ? mock.current ? `Läuft · Revision ${mock.revision}` : 'Veraltete Mock-Revision' : 'Aus'}</small></div>
      {mock?.running ? <button type="button" disabled={pending} onClick={() => void stop()}>Mock stoppen</button>
        : <button type="button" disabled={pending} onClick={() => void start()}>Mock starten</button>}
    </div>
    {mock?.running && mock.url ? <p className="api-contract__http-address">GET <code>{mock.url}</code> · Fehlerbeispiel <code>{mock.errorUrl}</code> <button type="button" disabled={pending} onClick={() => setBaseUrl(new URL(mock.url!).origin)}>Adresse für Check übernehmen</button></p> : null}
    <div className="api-contract__http-check"><label>Lokaler Server (Port)
      <input aria-label="Lokaler API-Server" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:3000" />
    </label><button type="button" disabled={pending || !baseUrl.trim()} onClick={() => void check()}>Endpoint jetzt prüfen</button></div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {newest ? <div className="api-contract__http-result" role="status"><strong>{newest.current ? newest.valid ? 'Lokale Antwort erfüllt Revision ' + newest.revision : 'Abweichung bei Revision ' + newest.revision : 'Alter Prüfstand · Revision ' + newest.revision}</strong>
      <small>{new Date(newest.checkedAt).toLocaleString('de-DE')} · {newest.status === null ? 'Keine HTTP-Antwort' : `HTTP ${newest.status}`} · {newest.url}</small>
      {newest.mismatches.map((item, index) => <p key={`${item.path}-${index}`}><code>{item.path}</code>: erwartet {item.expected}, gefunden {item.actual}</p>)}
    </div> : null}
    {checks.length > 1 ? <details className="api-contract__history"><summary>Frühere Endpoint-Prüfungen · {checks.length - 1}</summary>{checks.slice(1).map((item) => <p key={item.id}>Revision {item.revision}{item.current ? '' : ' · veraltet'} · {new Date(item.checkedAt).toLocaleString('de-DE')} · {item.status === null ? 'keine Antwort' : `HTTP ${item.status}`} · {item.valid ? 'Antwort passend' : `${item.mismatches.length} Abweichung(en)`}</p>)}</details> : null}
  </div>;
}
