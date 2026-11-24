# Prioritäten und Labels auf Karten

Öffne eine Karte im Board. Im oberen Formular wählst du **Priorität** (Keine, Niedrig, Mittel, Hoch, Dringend) und kannst bis zu zwölf frei benannte **Labels** einzeln hinzufügen oder entfernen. Bereits auf anderen Projektkarten verwendete Labels werden vorgeschlagen. Ein Label darf höchstens 32 Zeichen und kein Komma enthalten; gleiche Namen werden ohne Beachtung der Groß- und Kleinschreibung nur einmal gespeichert. Titel, Beschreibung, Priorität und Labels werden gemeinsam mit **Karte speichern** übernommen. Ein noch im Eingabefeld stehender gültiger Labelname wird beim Speichern berücksichtigt. Archivierte Karten bleiben lesbar, aber nicht bearbeitbar.

Die geöffnete Karte ist ein Tastaturdialog: Der Fokus beginnt auf **Karte schließen**, Tab bleibt innerhalb des Dialogs, Escape schließt ihn und setzt den Fokus auf den Auslöser zurück, sofern er noch vorhanden ist. Fehlt der Auslöser nach dem Anlegen oder Archivieren, führt der Fokus zur Karte im Board oder zur Kartensuche.

Auf der Karte werden Priorität und bis zu drei Labels angezeigt; bei weiteren Labels erscheint eine Anzahl. Suche, Priorität und Label stehen direkt oberhalb des Boards; Spalte und Archivstatus liegen unter **Weitere Filter**. Diese Filter lassen sich kombinieren. Die Textsuche berücksichtigt auch Labelnamen. Filter ändern keine gespeicherten Karten.

Die Metadaten liegen in der lokalen SQLite-Datenbank im App-Datenordner. Bestehende Karten erhalten beim Öffnen einer älteren Datenbank automatisch „Keine“ und eine leere Labelliste; Titel, Beschreibung, Position und Archivstatus bleiben erhalten. Die To-Do-Warteschlange verarbeitet Karten weiterhin nach Board-Position, nicht nach Priorität. Der [Trello-JSON-Import](IMPORT.md) übernimmt benannte Labels nach Vorschau; aus Trello-Farben wird keine Priorität abgeleitet.

Für mehrere aktive Karten kann die Priorität über die [Board-Sammelaktion](BULK_BOARD.md) nach Vorschau und Bestätigung zusammen geändert werden. Auch diese Änderung sortiert die To-Do-Warteschlange nicht neu und startet keinen Agenten.

Im Agentenbereich kann ein Projekt ausdrücklich erlauben, dass seine laufenden Kartenagenten Priorität und Labels über einen begrenzten lokalen Werkzeugaufruf ändern. Die Einstellung ist standardmäßig aus. Herkunft und Werte stehen im Agenten-Änderungsverlauf; der Ablauf und seine Grenzen sind in [Agent card metadata](AGENT_CARD_METADATA.md) beschrieben.

Gezielte synthetische Prüfung: `npx vitest run tests/main/card-metadata.test.ts tests/renderer/board-filters.test.tsx tests/renderer/memory-board.test.tsx`.
