# Windows-Paket und Start

## Aus Quellcode starten

Windows 11, Node.js 24 und Git installieren. Im Repository:

```powershell
npm ci
npm run doctor
npm run build
npm start
```

`npm start` lädt den gebauten Renderer direkt von der lokalen Datei; Vite muss dafür nicht laufen. Für die Entwicklung startet `npm run dev` Vite und Electron zusammen. Die gewählte CLI, beispielsweise Codex, muss separat installiert und angemeldet sein. Branchloom speichert keinen API-Schlüssel.

## Portables ZIP erzeugen

```powershell
npm ci
npm run make:win
```

Forge erzeugt `out/make/zip/win32/x64/*.zip`. Das ZIP entpacken und `Branchloom.exe` starten. Die App-Daten liegen im Electron-Benutzerdatenordner und sind nicht Bestandteil des ZIP. Das ZIP ist derzeit nicht signiert und wird nicht automatisch aktualisiert.

## Installierbare Ausgabe und Updates

`npm run make:installer` erstellt zusätzlich einen NSIS-Installer unter `out/installer/Branchloom-Setup-<version>.exe`. Der grüne `installer-windows`-CI-Job startet den entpackten Installer-Inhalt im isolierten Smoke-Profil, scannt ihn auf lokale Daten und lädt den Installer als `branchloom-windows-installer` hoch. Zum Installieren das GitHub-Artefakt entpacken und die Setup-EXE starten. Der Installer legt die App pro Benutzer an; vorhandene Branchloom/Jarvis-Studio-Projektdaten im Benutzerprofil werden weiterverwendet. Die portable Ausgabe auf dem Desktop bleibt separat und aktualisiert sich nicht selbst.

Nur die **installierte** Windows-Ausgabe mit `app-update.yml` prüft nach dem Start und dann alle sechs Stunden die öffentlichen Releases von `mschr703/branchloom`. Ein fehlendes Release oder ein Netzfehler blockiert den App-Start nicht und zeigt keinen Fehlerdialog. Bei einer neueren stabilen Version erscheint ein kompakter Hinweis mit Versionsnummer. **Später** unterdrückt den Hinweis für diese Version bis zum nächsten App-Start; es lädt nichts herunter. **Aktualisieren** lädt den Installer, zeigt den Fortschritt und startet die Installation nach dem Download. Solange Agenten, Terminals, Workflows oder eine Projektwarteschlange laufen, bleibt das Update bereit und verlangt nach deren Abschluss einen weiteren Klick auf **Jetzt installieren**. Es gibt kein stilles Update beim Beenden.

Der Updater nutzt den GitHub-Release-Feed und die von electron-builder erzeugte `latest.yml` mit SHA-512-Prüfsumme. Aktuelle Builds und Installer sind **nicht code-signiert**; daher ist die Identität des Herausgebers nicht durch ein Windows-Authenticode-Zertifikat bestätigt. Das Installationspaket kann eine Windows-Warnung auslösen. Code-Signierung und signierte Update-Manifeste sind vor einer breiten öffentlichen Verteilung nachzurüsten. Ein CI-Artefakt ist noch kein veröffentlichtes Release: Erst wenn das Repository einen erfolgreich gebauten `v<package.json-version>`-Tag auf `main` erhält, erstellt der Release-Workflow das GitHub-Release mit Installer und `latest.yml`. Ohne einen solchen Release gibt es für installierte Nutzer keine Update-Meldung. Ein echter Installationswechsel zwischen zwei veröffentlichten Versionen ist noch nicht geprüft; Quell- und portable Smoke-Tests ersetzen ihn nicht.

Ohne lokale C++-Build-Tools: Auf der [Branchloom-Actions-Seite](https://github.com/mschr703/branchloom/actions/workflows/ci.yml) einen **grünen** Lauf auf `main` öffnen, unter **Artifacts** `branchloom-windows-portable` herunterladen, das Archiv und anschließend das enthaltene Branchloom-ZIP entpacken. In dessen Ordner `Branchloom.exe` starten. Der erste Start kann wegen der fehlenden Signatur eine Windows-Warnung zeigen. Bei einem fehlgeschlagenen Lauf kein Paket als geprüft betrachten.

Für einen verdeckten Starttest `npm run smoke:source` ausführen; der Befehl baut den aktuellen Quellstand vorher neu, damit kein alter `dist-main`-Stand geprüft wird. `npm run smoke:package` prüft ein lokales Forge-Paket; mit `node scripts/smoke-electron.mjs --executable 'C:\Pfad\zum\entpackten\Branchloom.exe'` lässt sich auch das CI-ZIP prüfen. Der Test verwendet einen temporären, isolierten App-Datenordner, wartet auf die gerenderte Oberfläche und speichert ein Testprojekt und eine Karte über die Preload-/IPC-Schnittstelle in SQLite. Unter Windows startet er außerdem ein lokales cmd-Terminal, gibt einen synthetischen Text aus und stoppt es. Ein lokaler `cmd /C echo`-Agent muss ebenfalls über sein PTY erfolgreich beenden; kein Modell wird aufgerufen. Nach einem Reload müssen die gespeicherte Karte und die per IPC geänderte Spaltenreihenfolge, ein neuer Spaltenname und das Entfernen einer leeren Spalte im Board sichtbar sein. Der Test öffnet den Aufgabenklärungsdialog ohne Modellaufruf, zeigt zwei gespeicherte Whiteboard-Boxen und eine Verbindung und öffnet eine verknüpfte Karte. Die Workflow-Seite muss die freie Karte in der Queue-Vorschau zeigen. Der Test erstellt, bearbeitet und löscht einen synthetischen Workflow-Entwurf über IPC; zusätzlich öffnet er das vorausgefüllte Bearbeitungsformular und löscht einen weiteren Entwurf per sichtbarem Klick mit Bestätigung. Unter Windows öffnet er anschließend den Agentenverlauf, speichert ihn ausdrücklich als Memory-Notiz und prüft SQLite und die Memory-Navigation und öffnet von der Notiz den Quellverlauf. Danach schließt die unsichtbare App. Das Testprojekt berührt keine vorhandenen App-Daten. `node scripts/check-package.mjs` kontrolliert vor dem Upload zusätzlich den gepackten App-Ordner auf lokale Daten, versteckte Quellordner und Symlinks; Vendordateien unter `node_modules` werden auf geheime Dateinamen geprüft; reine `.env.example`-/`.env.sample`-/`.env.template`-Vorlagen sind erlaubt.

Die App verwendet `better-sqlite3` und `node-pty` als native Module. Für einen regulären lokalen Paketbau braucht Windows daher die Visual-Studio-C++-Build-Tools für `node-gyp`; Forge baut diese Module passend zur Electron-Laufzeit neu. Ohne diese Toolchain endet `npm run make:win` mit einem klaren `Could not find any Visual Studio installation to use`. Die Windows-CI baut nach bestandenem `main`-Push das portable ZIP, startet das Paket verdeckt mit `npm run smoke:package`, prüft den gepackten App-Ordner und lädt es erst danach als Workflow-Artefakt hoch. [Der erste Branchloom-Lauf](https://github.com/mschr703/branchloom/actions/runs/45264879402) war einschließlich Paket-Smoke und Artefakt-Upload erfolgreich. Ein lokales Diagnosepaket mit `JARVIS_STUDIO_SKIP_NATIVE_REBUILD=1` ist **kein** veröffentlichbarer Build; es dient nur dazu, bereits auf dem Entwicklungslaptop in Electron funktionierende Module ohne erneute Kompilierung zu prüfen.

Spracheingabe braucht zusätzlich Python 3.13, die Pakete und ein lokales Modell. Im **entpackten, beschreibbaren ZIP-Ordner** liegt das Setup-Skript unter `resources/app/scripts/setup-voice.ps1`, nicht neben `Branchloom.exe`. Starte es dort in PowerShell mit `.\resources\app\scripts\setup-voice.ps1`; [VOICE.md](VOICE.md) erklärt die Einrichtung aus dem Quellcode. Das Skript legt die optionale Python-Umgebung unter `resources/app/.venv` und das Modell unter `%LOCALAPPDATA%\JarvisStudio\voice-models` an. Das Modell gehört nicht ins ZIP oder Git. Der Browser nutzt eine eigene lokale Session; er übernimmt keine Chrome-Logins. Ein CLI-Agent muss sich über seine eigene CLI-Anmeldung authentifizieren.

## Vor einer Veröffentlichung

`npm run typecheck`, `npm test`, `npm run build`, `npm audit --audit-level=critical` und `node scripts/check-public.mjs` ausführen. Der Public-Check prüft gestagte Dateien sowie die erreichbare Git-Historie auf typische Schlüssel, private Dateipfade und Datenbanken. Danach den geplanten Diff und den ZIP-Inhalt prüfen. Ein grüner Quellbuild beweist weder eine erfolgreiche native Paketierung noch, dass fremde Dienste einen Login im eingebetteten Browser erlauben.

Technischer Hintergrund: [Electron-Paketierung](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [native Module](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/) und [Forge-Konfiguration](https://www.electronforge.io/config/configuration).
