import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Folder, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Project, ProjectOrganization } from '../../shared/types';
import { projectSections } from '../project-organization';
import '../project-switcher.css';

interface Props {
  projects: Project[];
  projectId: string | null;
  organization: ProjectOrganization;
  compact?: boolean;
  onSelect(projectId: string): void;
  onOrganizationChange(value: ProjectOrganization): void;
  onError(message: string): void;
}

export function ProjectSwitcher({ projects, projectId, organization, compact = false, onSelect, onOrganizationChange, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [organizing, setOrganizing] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [placement, setPlacement] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = projects.find((project) => project.id === projectId);
  const sections = projectSections(projects, organization, query);
  const visibleSections = organizing && !query.trim()
    ? [...organization.groups.map((group) => sections.find((section) => section.group?.id === group.id) ?? { group, projects: [] }), ...sections.filter((section) => section.group === null)]
    : sections;

  function close(restoreFocus = false) {
    setOpen(false);
    setOrganizing(false);
    setEditingGroup(null);
    setPlacement(null);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function toggle() {
    if (open) { close(true); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.min(rect.left, Math.max(8, window.innerWidth - 360)), top: rect.bottom + 6 });
    setQuery('');
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
    }
    function onPointer(event: PointerEvent) {
      if (panelRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return;
      close();
    }
    function onResize() { close(); }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  async function update(action: () => Promise<ProjectOrganization>): Promise<boolean> {
    try { onOrganizationChange(await action()); onError(''); return true; }
    catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)); return false; }
  }

  async function addGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupName.trim()) return;
    if (await update(() => window.studio.createProjectGroup(groupName))) setGroupName('');
  }

  async function renameGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingGroup || !editName.trim()) return;
    if (await update(() => window.studio.renameProjectGroup({ groupId: editingGroup, name: editName }))) setEditingGroup(null);
  }

  async function removeGroup(groupId: string, name: string) {
    if (!window.confirm(`Gruppe „${name}“ entfernen? Die Projekte bleiben erhalten und erscheinen ohne Gruppe.`)) return;
    await update(() => window.studio.deleteProjectGroup(groupId));
  }

  return <>
    <button ref={triggerRef} type="button" className={`project-switcher-trigger${compact ? ' is-compact' : ''}`} aria-label={`Projekt auswählen: ${selected?.name ?? 'Kein Projekt'}`} aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
      <Folder size={compact ? 16 : 17} aria-hidden="true" /><span>{selected?.name ?? 'Projekt auswählen'}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panelRef} className="project-switcher-panel" role="dialog" aria-label="Projekt auswählen" style={{ left: position.left, top: position.top }}>
      <label className="project-switcher-search"><Search size={16} aria-hidden="true" /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Projekte suchen" aria-label="Projekte suchen" /></label>
      <div className="project-switcher-toolbar">
        <span>{projects.length} {projects.length === 1 ? 'Projekt' : 'Projekte'}</span>
        <button type="button" onClick={() => setOrganizing((value) => !value)} aria-expanded={organizing}>{organizing ? 'Fertig' : 'Organisieren'}</button>
      </div>
      {organizing && <div className="project-switcher-organize">
        <div className="project-switcher-sort"><span>Sortieren</span><button type="button" className={organization.sort === 'name' ? 'is-selected' : ''} onClick={() => void update(() => window.studio.setProjectSort('name'))}>A–Z</button><button type="button" className={organization.sort === 'newest' ? 'is-selected' : ''} onClick={() => void update(() => window.studio.setProjectSort('newest'))}>Neueste</button></div>
        <form onSubmit={(event) => void addGroup(event)}><input value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={60} aria-label="Neue Gruppe" placeholder="Neue Gruppe" /><button type="submit" disabled={!groupName.trim()} aria-label="Gruppe erstellen"><Plus size={17} /></button></form>
      </div>}
      <div className="project-switcher-list">
        {visibleSections.length === 0 && <p className="project-switcher-empty">{projects.length ? 'Keine passenden Projekte.' : 'Noch keine Projekte.'}</p>}
        {visibleSections.map((section) => <section key={section.group?.id ?? 'ungrouped'} aria-label={section.group?.name ?? 'Ohne Gruppe'}>
          <div className="project-switcher-heading">
            {editingGroup === section.group?.id && section.group ? <form onSubmit={(event) => void renameGroup(event)}><input autoFocus aria-label="Gruppenname" value={editName} maxLength={60} onChange={(event) => setEditName(event.target.value)} /><button type="submit" aria-label="Gruppe umbenennen"><Check size={15} /></button></form> : <span>{section.group?.name ?? 'Ohne Gruppe'}</span>}
            {organizing && section.group && editingGroup !== section.group.id && <div className="project-switcher-heading-actions"><button type="button" title="Gruppe umbenennen" aria-label={`${section.group.name} umbenennen`} onClick={() => { setEditingGroup(section.group!.id); setEditName(section.group!.name); }}><Pencil size={14} /></button><button type="button" title="Gruppe entfernen" aria-label={`${section.group.name} entfernen`} onClick={() => void removeGroup(section.group!.id, section.group!.name)}><Trash2 size={14} /></button></div>}
          </div>
          {section.projects.map((project) => <div className="project-switcher-project" key={project.id}>
            <button type="button" className={project.id === projectId ? 'is-active' : ''} onClick={() => { onSelect(project.id); close(true); }} title={project.path} aria-current={project.id === projectId ? 'true' : undefined}><span>{project.name}</span>{project.id === projectId && <Check size={15} aria-hidden="true" />}</button>
            {organizing && <button type="button" className="project-switcher-place-trigger" title="Projekt einer Gruppe zuordnen" aria-label={`${project.name} einer Gruppe zuordnen`} aria-expanded={placement === project.id} onClick={() => setPlacement((value) => value === project.id ? null : project.id)}><Folder size={15} /></button>}
            {organizing && placement === project.id && <div className="project-switcher-place" aria-label={`Gruppe für ${project.name}`}><button type="button" onClick={() => { void update(() => window.studio.assignProjectGroup({ projectId: project.id, groupId: null })); setPlacement(null); }}>Ohne Gruppe</button>{organization.groups.map((group) => <button key={group.id} type="button" onClick={() => { void update(() => window.studio.assignProjectGroup({ projectId: project.id, groupId: group.id })); setPlacement(null); }}>{group.name}</button>)}</div>}
          </div>)}
        </section>)}
      </div>
    </div>, document.body)}
  </>;
}
