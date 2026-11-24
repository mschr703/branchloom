import type { Project, ProjectGroup, ProjectOrganization } from '../shared/types';

export interface ProjectSection { group: ProjectGroup | null; projects: Project[] }

export function projectSections(projects: Project[], organization: ProjectOrganization, query = ''): ProjectSection[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const shown = projects.filter((project) => `${project.name} ${project.path}`.toLocaleLowerCase().includes(normalizedQuery));
  const sorted = [...shown].sort((left, right) => organization.sort === 'newest'
    ? right.createdAt.localeCompare(left.createdAt) || left.name.localeCompare(right.name)
    : left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id));
  const sections = organization.groups.map((group) => ({ group, projects: sorted.filter((project) => organization.assignments[project.id] === group.id) }));
  const assignedGroups = new Set(organization.groups.map((group) => group.id));
  const ungrouped = sorted.filter((project) => !assignedGroups.has(organization.assignments[project.id] ?? ''));
  return [...sections.filter((section) => section.projects.length > 0), { group: null, projects: ungrouped }]
    .filter((section) => section.projects.length > 0);
}
