import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectImportChoice } from '../../src/renderer/components/ProjectImportChoice';

describe('project import choice', () => {
  it('explains folder versus Branchloom JSON package before opening a file picker', () => {
    const html = renderToStaticMarkup(<ProjectImportChoice onFolder={() => undefined} onPackage={() => undefined} onClose={() => undefined} />);
    expect(html).toContain('Was möchtest du übernehmen?');
    expect(html).toContain('Vorhandener Codeordner');
    expect(html).toContain('Ordnerpfad eingeben');
    expect(html).toContain('Projekt sichern');
    expect(html).toContain('Projektpaket auswählen');
    expect(html).toContain('keinen Codeordner');
    expect(html).toContain('role="dialog"');
  });
});
