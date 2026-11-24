# Branchloom · technische Orientierung

Ursprünglicher Stand: 22.11.2026, vor der Umbenennung von Jarvis Studio zu Branchloom. Diese Codekarte ist eine Momentaufnahme. **Vor jeder Änderung zuerst `git status`, `git log -1`, `AGENTS.md`, [PRODUCT_VISION.md](PRODUCT_VISION.md) und `docs/STATUS.md` lesen.** Der Laufzeitstand kann neuer sein.

## Ziel und Grenze

Branchloom ist eine **eigenständige, öffentlich veröffentlichbare lokale Windows-App** für Projekte, Kanban-Boards, echte CLI-Agenten, Workflows, Terminal, Sprache, Browser und verknüpfte Notizen. Die erweiterte Vision steht in [PRODUCT_VISION.md](PRODUCT_VISION.md). Kangentic ist Produkt- und gegebenenfalls lizenzgeprüfte Code-Referenz; Branchloom ist kein Fork. Der persönliche Jarvis-Assistent und seine privaten Module sind getrennte Projekte.

Die Abnahme ist ausdrücklich **nicht** „Kangentic-Parität“: Die Matrix in [PARITY.md](PARITY.md) nennt implementierte Teilbereiche und fehlende Funktionen. [STATUS.md](STATUS.md) nennt nur geprüfte Resultate und Grenzen. Ein verdeckter Electron-Smoke beweist einen konkreten Laufpfad, ersetzt aber keine vollständige sichtbare Bedienungsabnahme.

## Repository, Start und Daten

- Public GitHub: <https://github.com/mschr703/branchloom>; Branch `main`. Neue Entwicklungs-Commits und Pushes kommen nach der Nutzerentscheidung vom 24.11.2026 von `mschr703`. Keine Zugangsdaten oder persönlichen Daten in Git.
- Voraussetzungen: Windows 11, Node.js 24, Git. Agenten-CLIs müssen separat installiert und angemeldet sein. Für lokales `npm run make:win` braucht `node-gyp` Visual-Studio-C++-Build-Tools; die Windows-CI baut das portable ZIP auf einem passenden Runner.
- Lokal: `npm ci`, `npm run doctor`, `npm run dev`. Produktionsmodus: `npm run build`, `npm start`. Beim ersten Start ein Projekt mit einem bestehenden absoluten Ordner anlegen.
- `npm run dev` startet Vite nur auf `127.0.0.1:5181` und Electron. App-Zustand und SQLite liegen im Electron-`userData`-Ordner außerhalb des Repositories. Lokale Projektdateien, CLI-Anmeldungen und Browserprofile gehören nicht in Git.
- Portables ZIP: GitHub Actions → neuester erfolgreicher `main`-Lauf → Artefakt `branchloom-windows-portable`; entpacken, `Branchloom.exe` starten. Noch kein Installer, keine Signatur und kein automatisches Update. Details: [RELEASE.md](RELEASE.md).

## Aktueller belegter Stand

Vor der Umbenennung war der alte Studio-Stand auf Commit `653c4c6`; [Windows-CI 44878890860 im früheren Repository](https://github.com/mschr703CODEX/jarvis-studio/actions/runs/44878890860) war vollständig grün: Audit, Doctor, Typprüfung, Tests, Build, Public-Scan, nativer Windows-ZIP-Bau, Paket-Smoke und Paket-Scan. Lokal bestanden beim letzten Code-Fix 201 Tests; zwei optionale Live-Modelltests blieben übersprungen. Ein vorheriges frisches CI-ZIP wurde zusätzlich auf dem Entwicklungslaptop entpackt und mit isoliertem App-Datenordner erfolgreich gegen die EXE geprüft. **Das ist kein Nachweis für spätere Branchloom-Commits.**

Nutzbare Teilabläufe:

- Mehrere lokale Projekte, Board mit konfigurierbaren/umordenbaren Spalten und Karten, Drag-and-drop, Tastaturverschiebung, Kartenreihenfolge, Filter, Labels, Prioritäten, Archiv, Sammelaktionen und bewusste Dateiverweise.
- PTY-Sitzungen mit Live-Terminal für Codex, Claude, Gemini, Antigravity und eigene CLI-Kommandos; separates PowerShell-/cmd-Terminal. Agent/Modell/Effort als Spaltenkonfiguration; Diagnose für lokale CLIs. Nur Codex wurde auf diesem Laptop mit echtem Modellaufruf geprüft. Die übrigen CLI-Konfigurationen sind keine belegte Anmeldung.
- Workflow-Planer mit schreibgeschütztem Codex-Vorschlag und ausdrücklicher Übernahme. Persistente Routen, manuelle Schritte, Freigaben, Abschlussmarker, Pause und Prüfung bei Fehler/Neustart. Ungestartete Entwürfe können bearbeitet und gelöscht werden. Ein ausdrücklich manueller Schritt startet auch bei einem Spalten-Standardagenten keinen Prozess.
- Explizit aktivierbare To-Do-Queue, Vorschau der nächsten fünf freien Karten, sichere Zuordnung Karte → Workflow, maximal ein Agentenlauf pro Projekt und bewusste Fortsetzung/Überspringen nach Störung. Eine fehlende To-Do-Spalte blockiert die Aktivierung vor der Statusänderung.
- Memory-Notizen mit Links, Rückverweisen, Graph, Markdown-Vorschau, Vault-Import/Export und bewusster Übernahme gespeicherter Agentenverläufe samt Rücklink. Projektweite Suche einschließlich SQLite-Volltextindex für gespeicherte Transkripte.
- Eingebetteter isolierter Browser, Trello-Board-JSON-Import mit Vorschau und Duplikatschutz, Projektpaket-Import/Export, optionale Git-Worktrees und lokale Whisper-Transkription nach Aufnahmeende.

Die detaillierten Nutzungs- und Sicherheitsgrenzen stehen in den jeweiligen Dateien unter `docs/`. Keine dieser Kurzbeschreibungen ist eine Behauptung vollständiger Kangentic-Parität.

## Codekarte

| Pfad | Verantwortung |
| --- | --- |
| `src/shared/types.ts` | Gemeinsames Datenmodell und typisierte `StudioAPI`-Schnittstelle. |
| `src/main/main.ts` | Electron-Fenster, IPC-Bindings, App-Start und verdeckter End-to-End-Smoke. |
| `src/main/preload.ts` | Isolierte `window.studio`-Bridge. Renderer hat keinen direkten Node-/Dateisystemzugriff. |
| `src/main/store.ts` | SQLite-Schema, Migrationen, Projekte, Karten, Workflows, Queue-Zustand und Memory. Persistenzänderungen nach Möglichkeit transaktional. |
| `src/main/cli.ts`, `antigravity.ts` | CLI-Erkennung, Argumente, PTY-Start, Ausgabe, Stop und Adapterregeln. |
| `src/main/workflows.ts`, `queue.ts` | Workflow-Gates und explizite To-Do-Queue. Nach unklarem Ergebnis anhalten, nicht blind wiederholen. |
| `src/main/workflow-planner.ts`, `workflow-proposal.ts` | Schreibgeschützter Planervorschlag und Schema-Validierung. |
| `src/renderer/App.tsx`, `components/WorkflowView.tsx` | Navigation, Zustand, Workflow-/Queue-Oberfläche. |
| `tests/main`, `tests/renderer` | Persistenz, CLI, Workflow-/Queue-Logik und Renderer-Verhalten. |
| `scripts/smoke-electron.mjs`, `check-public.mjs`, `check-package.mjs` | Isolierter Quell-/Paket-Smoke und Veröffentlichungsprüfungen. |
| `.github/workflows/ci.yml` | Windows-Verify und nativer ZIP-Bau mit Paket-Smoke vor Upload. |

Die [Architekturübersicht](ARCHITECTURE.md) beschreibt Renderer → Preload → Hauptprozess → SQLite/PTY/Whisper.

## Offene Grenzen

- **Nächster konkreter Schritt:** Agent, Modell und Effort **pro Workflow-Schritt** unabhängig vom Spaltenstandard konfigurierbar machen. Derzeit trägt `WorkflowStep` einen Agenten, aber keine eigene Modell-/Effort-Einstellung. Der CLI-Start übernimmt Spaltenwerte nur für bestimmte Fälle. Änderung von Typen, Persistenz, Formular, Queue-Klonen und CLI-Argumenten zusammen prüfen. Ein ausdrücklich manueller Schritt muss manuell bleiben. Dazu synthetische CLI-Argumenttests, Persistenztests und einen echten sichtbaren UI-/CLI-Klickpfad liefern.
- Weitere CLI-Adapter brauchen echte Anmelde-, Modell-, Resume- und Fehlertests. WLAN-Verlust wird nur über den Zustand des CLI-Prozesses erkannt. Ein abgebrochener externer Schritt wird nicht automatisch wiederholt; sichere Fortsetzung derselben Sitzung ist offen.
- Globale Workflow-Planung ist bisher Codex-basiert. Abhängigkeiten, Kapazitätsregeln, verifizierte Übergänge, Retry/Backoff und vollständige Kangentic-Workflow-Parität fehlen.
- Der Browser bietet nutzerseitige Tabs, aber noch keine freigegebene Agenten-Browsersteuerung. Sprache ist noch kein Live-Diktat. Memory ist noch keine automatische, quellenbelegte semantische Indizierung.
- Viele Flächen sind automatisiert und verdeckt im Electron-Smoke geprüft, aber nicht in einem echten **sichtbaren** UI-Durchlauf. Status und [PARITY.md](PARITY.md) nennen die noch offene Abnahme. Rechnersteuerung wurde zuvor auf Nutzerwunsch beendet; für einen sichtbaren Test nur mit aktueller Freigabe handeln.
- Ein CLI-Agent hat die Rechte des angemeldeten Windows-Benutzers. Ein Worktree ist keine OS-Sandbox. Keine unbeaufsichtigte externe Schreibaktion allein wegen einer Modellantwort erlauben.

## Arbeitsweise für die nächste Instanz

1. `git status --short --branch`, Remote, letzte Commits, [AGENTS.md](../AGENTS.md), [STATUS.md](STATUS.md), [PARITY.md](PARITY.md) und die für die Aufgabe passende Fachdoku lesen. Falls Trello zugänglich ist, die aktuelle Projektkarte und Fachkarten zusätzlich lesen; technische Aussagen gegen den aktuellen Code und die CI prüfen.
2. Eine vertikale, überprüfbare Funktion fertigbauen: Datentyp/DB → Hauptprozess/Preload → UI → Verhalten im echten CLI-/Electron-Pfad → passende Tests. Bestehende Nutzerdateien und Datenbankmigrationen berücksichtigen.
3. Vor jedem öffentlichen Push Diff prüfen, `npm audit --audit-level=critical`, `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:source` und `node scripts/check-public.mjs` ausführen. Nach dem Push Windows-CI einschließlich ZIP, Paket-Smoke und `check-package` prüfen. Nicht alle Live-Modelltests sind standardmäßig aktiv.
4. `docs/STATUS.md` mit belegtem Ergebnis und exakt nächstem Schritt aktualisieren. Trello nach echten Fortschritten pflegen. Keine Karte als abgeschlossen markieren, solange ihre Abnahmekriterien fehlen. Keine Schlüssel, Nutzerpfade, persönlichen Board-Daten, Logs oder Profile ins öffentliche Repository schreiben.

Das öffentliche Repository ist die technische Quelle für **Branchloom**. Der persönliche Jarvis und seine privaten Module bleiben getrennt; die aktuelle Produktvision und der aktuelle Teststand haben Vorrang vor dieser historischen Orientierung.
