# Projektweit sicher anhalten

Mit **Sicher anhalten** in der oberen Leiste sperrst du neue Agentenstarts für das ausgewählte Projekt. Das gilt für manuelle Kartenstarts und Codex-Fortsetzungen, Spalten-Autostart, Übergaben, Workflow-Folgeschritte und neue Karten aus der To-Do-Queue. Ein Start wird auch unmittelbar vor der dauerhaften Sitzungsreservierung erneut geprüft. Ausstehende automatische CLI-Startwiederholungen werden verworfen.

Bereits laufende Agenten werden nicht beendet. Ihre Ausgabe, der Exit-Code und der Workflow-Fortschritt werden weiter gespeichert. Solange Agenten, Integrationstests oder eine Integrationsübernahme laufen, steht **Anhalten angefordert** über der Arbeitsfläche. Die aufklappbare Liste nennt die tatsächlich noch laufende Arbeit und führt zur Karte. Erst wenn keine dieser Arbeiten mehr läuft, erscheint **Projekt angehalten**. Die Anzeige aktualisiert sich bei Agentenereignissen und regelmäßig aus SQLite.

Eine aktive Queue wird sofort pausiert. Ihre bereits beanspruchte Karte und ihre Workflow-Historie bleiben erhalten. Ein laufender Workflow beendet den aktuellen Agentenschritt, startet aber keinen Nachfolger. Nach dem Ende bleibt der Workflow pausiert; der abgeschlossene Schritt ist weiterhin als Ergebnis sichtbar. Auch eine manuell bestätigte Integrationsübernahme oder ein neuer Integrationstest kann während der Projektsperre nicht beginnen. Eine bereits reservierte Übernahme bzw. ein laufender Test wird fertig verarbeitet und nicht zurückgerollt.

**Projekt fortsetzen** ist erst nach Ende der angezeigten Arbeit möglich. Der Klick entfernt die Projektsperre, startet jedoch weder Queue noch Workflow automatisch. Prüfe die Ergebnisse und setze den gewünschten Workflow und danach gegebenenfalls die Queue ausdrücklich fort. Eine einzelne Workflow- oder Queue-Pause bleibt ein eigener Bedienpfad; das Pausieren eines laufenden Workflows über dessen bestehende Schaltfläche stoppt weiterhin dessen Agenten.

Die Anforderung wird pro Projekt in der lokalen SQLite-Datenbank gespeichert. Nach einem App-Neustart werden zuvor laufende Agenten wie bisher als unterbrochen und zu prüfen markiert; es gibt keinen Replay. Verwaiste Integrationstests werden als unterbrochen markiert. Eine unklare Integrationsübernahme bleibt gesperrt, bis der echte Git-Zielstand überprüft werden kann. Die Projektsperre bleibt bis zum bewussten Fortsetzen aktiv. Andere Projekte bleiben bedienbar.

## Grenzen

Der Schalter ist ein Start-Gate für Branchloom und nimmt einem bereits laufenden CLI-Prozess keine Rechte weg. Er stoppt keine externen Prozesse, die außerhalb von Branchloom gestartet wurden, und ersetzt keine Prüfung möglicher Datei- oder Netzänderungen. Einzeln wählbare Haltepunkte nach Workflow-Schritten aus der ursprünglichen F07-Idee sind noch nicht umgesetzt. Automatische Integration existiert noch nicht; die Sperre ist bereits am heutigen manuellen G02-Startpfad gesetzt.
