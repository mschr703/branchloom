import { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Columns3, GitBranch, ScrollText, Search, X } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import { projectSearchResults, sessionSearchResult, type ProjectSearchResult } from '../project-search';
import './search-inline.css';

interface Props {
  snapshot: ProjectSnapshot;
  onClose: () => void;
  onNavigate: (result: ProjectSearchResult) => void;
}

const iconFor = { card: Columns3, note: BrainCircuit, workflow: GitBranch, session: ScrollText };

export function SearchPalette({ snapshot, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sessionMatches, setSessionMatches] = useState<{ projectId: string; query: string; results: ProjectSearchResult[] }>({ projectId: '', query: '', results: [] });
  const [sessionSearchError, setSessionSearchError] = useState(false);
  const [sessionSearchPending, setSessionSearchPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim();
  const localResults = useMemo(() => projectSearchResults(snapshot, query, normalizedQuery.length >= 2 ? 20 : 30), [snapshot, query, normalizedQuery]);
  const remoteResults = sessionMatches.projectId === snapshot.project.id && sessionMatches.query === normalizedQuery ? sessionMatches.results : [];
  const results = [...localResults, ...remoteResults].slice(0, 30);
  const activeIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (searchRef.current?.parentElement?.contains(event.target as Node)) return;
      onClose();
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [onClose]);
  useEffect(() => {
    setSessionSearchError(false);
    if (normalizedQuery.length < 2) { setSessionSearchPending(false); return; }
    setSessionSearchPending(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.studio.searchSessionTranscripts({ projectId: snapshot.project.id, query: normalizedQuery })
        .then((hits) => { if (!cancelled) setSessionMatches({ projectId: snapshot.project.id, query: normalizedQuery, results: hits.map(sessionSearchResult) }); })
        .catch(() => { if (!cancelled) setSessionSearchError(true); })
        .finally(() => { if (!cancelled) setSessionSearchPending(false); });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [snapshot.project.id, normalizedQuery]);
  useEffect(() => { document.getElementById(`search-result-${activeIndex}`)?.scrollIntoView({ block: 'nearest' }); }, [activeIndex, results]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex((index) => results.length ? (index + 1) % results.length : 0); inputRef.current?.focus(); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex((index) => results.length ? (index - 1 + results.length) % results.length : 0); inputRef.current?.focus(); return; }
    if (event.key === 'Enter' && document.activeElement === inputRef.current && results[activeIndex]) { event.preventDefault(); onNavigate(results[activeIndex]); return; }
  }

  return <div className="search-inline" ref={searchRef} role="search" aria-label={`Suche in ${snapshot.project.name}`} onKeyDown={onKeyDown} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onClose(); }}>
      <div className="search-input-wrap"><Search size={18} aria-hidden="true" /><input ref={inputRef} role="combobox" aria-expanded="true" aria-controls="project-search-results" aria-activedescendant={results.length ? `search-result-${activeIndex}` : undefined} aria-autocomplete="list" aria-label="Suchbegriff" placeholder="Karten, Notizen, Abläufe suchen…" maxLength={160} value={query} onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }} /><button type="button" className="icon-button" onClick={onClose} aria-label="Suche schließen"><X size={16} /></button></div>
      <div className="search-results-panel"><div className="search-results" id="project-search-results" role="listbox" aria-label="Suchergebnisse">
        <div className="search-results-title">{query.trim() ? `${results.length} Treffer in ${snapshot.project.name}` : `Zuletzt geändert in ${snapshot.project.name}`}</div>
        {results.map((result, index) => { const Icon = iconFor[result.kind]; return <button key={`${result.kind}:${result.id}`} id={`search-result-${index}`} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'search-result active' : 'search-result'} onMouseEnter={() => setSelectedIndex(index)} onClick={() => onNavigate(result)}><span className="search-result-icon"><Icon size={17} /></span><span className="search-result-copy"><strong>{result.title}</strong><small>{result.context}{result.snippet ? ` · ${result.snippet}` : ''}</small></span></button>; })}
        {results.length === 0 ? <div className="search-no-results" role="status">{sessionSearchPending ? 'Agentenverläufe werden durchsucht…' : query.trim() ? 'Keine Treffer in diesem Projekt.' : 'Noch keine Karten, Notizen oder Workflows.'}</div> : null}
        {sessionSearchError ? <div className="search-no-results" role="status">Agentenverläufe konnten gerade nicht durchsucht werden.</div> : null}
      </div>
      <div className="search-footer">↑ ↓ auswählen · Enter öffnen · Esc schließen</div></div>
  </div>;
}
