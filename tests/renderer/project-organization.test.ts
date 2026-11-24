import { describe, expect, it } from 'vitest';
import type { Project, ProjectOrganization } from '../../src/shared/types';
import { projectSections } from '../../src/renderer/project-organization';

const projects: Project[] = [
  { id: 'older', name: 'Zeta', path: 'C:\\work\\zeta', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'newer', name: 'Alpha', path: 'C:\\work\\alpha', createdAt: '2026-02-01T00:00:00Z' },
  { id: 'loose', name: 'Loose', path: 'C:\\work\\loose', createdAt: '2026-03-01T00:00:00Z' },
];
const organization: ProjectOrganization = { groups: [{ id: 'group', name: 'Work' }], assignments: { older: 'group', newer: 'group' }, sort: 'name' };

describe('project sections', () => {
  it('keeps groups together, sorts names, and leaves other projects visible', () => {
    expect(projectSections(projects, organization).map((section) => [section.group?.name ?? null, section.projects.map((project) => project.id)]))
      .toEqual([['Work', ['newer', 'older']], [null, ['loose']]]);
  });

  it('applies persisted newest sort and searches project names and paths', () => {
    expect(projectSections(projects, { ...organization, sort: 'newest' })[0]?.projects.map((project) => project.id)).toEqual(['newer', 'older']);
    expect(projectSections(projects, organization, 'ZETA')[0]?.projects.map((project) => project.id)).toEqual(['older']);
    expect(projectSections(projects, organization, 'loose')[0]?.group).toBeNull();
    expect(projectSections(projects, organization, 'missing')).toEqual([]);
  });
});
