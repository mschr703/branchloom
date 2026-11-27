import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandTerminalView } from '../../src/renderer/components/CommandTerminalView';
import { viewName } from '../../src/renderer/components/WorkspaceNavigation';

describe('command terminal UI', () => {
  it('shows explicit shell choice and start action', () => {
    const html = renderToStaticMarkup(<CommandTerminalView projectId="project" projectPath={'C:\\fixture\\project'} columns={[]} onOpenCard={() => undefined} />);
    expect(viewName('terminal', 'de')).toBe('Projekt-Terminal');
    expect(viewName('terminal', 'en')).toBe('Project terminal');
    expect(html).toContain('Manuelles Projekt-Terminal');
    expect(html).toContain('Agentenläufe und ihre Ausgaben findest du auf der jeweiligen Karte');
    expect(html).toContain('C:\\fixture\\project');
    expect(html).toContain('Shell auswählen');
    expect(html).toContain('Terminal-Arbeitsordner auswählen');
    expect(html).toContain('Projektordner');
    expect(html).toContain('Windows PowerShell');
    expect(html).toContain('Eingabeaufforderung (cmd)');
    expect(html).toContain('Terminal starten');
    expect(html).toContain('nicht von selbst erneut');
  });
});
