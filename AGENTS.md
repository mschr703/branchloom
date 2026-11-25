# Branchloom: Arbeitsregeln

Branchloom (früher Jarvis Studio) ist eine eigenständige lokale Agenten-App. Kangentic und andere Open-Source-Projekte dürfen als Produkt- und Code-Referenz untersucht werden. Fremden Code nur nach Prüfung der konkreten Lizenz, mit nötigen Hinweisen und passenden Tests übernehmen. Der persönliche Jarvis-Assistent und seine privaten Module bleiben getrennte Projekte. Der Nutzer entwickelt Branchloom jetzt wieder mit Codex weiter.

- Reale CLI-Agenten, gespeicherte Daten und tatsächliche UI-Abläufe sind wichtiger als Demo-Zustände. Eine Funktion erst als fertig bezeichnen, wenn sie überprüft wurde.
- Das öffentliche Repository enthält nur allgemeine Software, synthetische Tests und Dokumentation. Schlüssel, persönliche Inhalte, Board-Daten, Agentenprotokolle und lokale Profile liegen außerhalb des Repositories.
- Ein Agent darf für schreibende oder externe Aktionen nicht allein wegen einer Modellantwort zusätzliche Berechtigungen erhalten. Automatischer Start ist eine bewusste Projekt-/Spalteneinstellung; Stop/Pause muss zuverlässig sein.
- Änderungen an Karten und Workflows müssen nach einem App-Neustart erhalten bleiben. Fehler und Grenzen bleiben in `docs/STATUS.md` sichtbar.
- Für UI-Arbeit den installierten `anti-slop-design`-Skill und [DESIGN.md](DESIGN.md) anwenden. Branchloom nutzt ruhige, warme und gut lesbare Oberflächen; keine dunkelblauen Grundflächen, Neon-Effekte, dekorativen Gradients oder erfundenen Kennzahlen. Bestehende Bedienlogik und Tastaturzugänglichkeit erhalten.
- Vor einem öffentlichen Push: Diff, `npm audit`, Tests, Typprüfung und Build prüfen. Keine personenbezogenen Pfade oder Secrets committen.

Aktuelle Priorität für **dieses Repository**: [Produktvision](docs/PRODUCT_VISION.md) in überprüfbaren vertikalen Schritten umsetzen. Bestehende Nutzerdaten und interne Formate beim Namenswechsel erhalten. Neue Verhaltenswünsche des Nutzers gehen vor dieser Datei.
