# Karten-Vorschau und geführte Einrichtung (F01)

Eine Karte kann ihren eigenen Git-Worktree als lokalen Dev-Server starten. Die Konfiguration gilt pro Projekt und wird nur in Branchlooms lokaler SQLite-Datenbank gespeichert. Sie wird nicht in das Git-Repository geschrieben. Weder ein Agent noch ein Workflow startet einen Server automatisch.

## Einrichten und benutzen

1. Öffne ein Projekt mit Git-Repository, dann **Board → Karte → Karten-Vorschau**.
2. Speichere ein Projektprofil: ein **direkt ausführbares Programm**, eine Argumentzeile pro Argument, einen HTTP-Prüfpfad und einen Text, der auf der fertigen Seite vorkommt. Mindestens ein Argument muss `{port}` enthalten und ein Argument `127.0.0.1`. Der Server muss tatsächlich an diese Adresse und den eingesetzten Port binden.
3. Wähle **Für diese Karte starten**. Branchloom legt bei Bedarf den Karten-Worktree an, startet das Programm dort und prüft die lokale HTTP-Antwort auf den angegebenen Text. **Bereit** erscheint erst nach dieser Antwort. **Vorschau öffnen** fragt unmittelbar vor dem neuen Browser-Tab den aktuellen Kartenlauf erneut ab und lehnt einen inzwischen gestoppten, ersetzten oder nicht mehr verwalteten Lauf ab.
4. **Stoppen** beendet den von dieser App-Sitzung gestarteten Prozessbaum. Unter Windows nutzt Branchloom dafür einen begrenzten `taskkill /T /F`-Aufruf; unter POSIX eine eigene Prozessgruppe. Erst nach einem erfolgreichen Stopp meldet die Karte **Gestoppt**. Eine zweite Karte kann gleichzeitig mit demselben Profil auf einem anderen Port laufen.

## Geführte Einrichtung und Fehlerprüfung

**Projektstand prüfen** liest ausschließlich `package.json` und `index.html` aus dem Git-HEAD des Projekts. Bei einem direkten Vite-Dev-Skript und einem unterscheidbaren HTML-Titel zeigt Branchloom einen festen Kandidaten: `node` startet Vite im Karten-Worktree mit `--host 127.0.0.1 --port {port}`; der Titel ist der HTTP-Marker. Ungespeicherte Projektdateien erscheinen nicht in einem neuen Worktree und zählen daher nicht als Beleg. Andere Frameworks und generische Titel werden nicht geraten. Prüfe, ob die Abhängigkeiten **im Karten-Worktree** vorhanden sind; Branchloom installiert sie nicht.

**Einrichtung mit Agent besprechen** beziehungsweise **Fehler mit Agent besprechen** startet nach einem eigenen Klick die konfigurierte Codex CLI mit einem kurzlebigen, lesenden Kontext außerhalb des Projektordners. Der Agent sieht nur die belegten Kandidaten, die Quellen-IDs, Profil-Abweichungsarten und eine Fehlerklasse. Die rohe Prozessausgabe, Zugangsdaten und lokale Projektpfade werden ihm nicht übergeben. Er darf lediglich einen vorhandenen Kandidaten auswählen oder keinen; frei erfundene Startbefehle werden abgewiesen. Ohne aktiven Codex-Workflow-Agenten lässt sich ein belegter Kandidat in das noch ungespeicherte Formular übernehmen oder das Profil manuell einrichten.

Der ausgewählte Befehl, Prüfpfad und Marker erscheinen vor **Profil übernehmen**. Erst dieser Klick speichert das Projektprofil; er startet keinen Server. Der Vorschlag verfällt nach 20 Minuten und wird bei geändertem Git-HEAD, Profil oder Kartenlauf zurückgewiesen. **Für diese Karte starten** ist eine weitere bewusste Aktion und verlangt den Fingerprint des gerade angezeigten Profils. Geänderte Profile werden vor dem Start abgewiesen. **Einrichtungsbelege** zeigt die letzten lokalen Profiländerungen und Startfreigaben einschließlich abgewiesener Startversuche; der Beleg speichert Fingerprint und Lauf-ID, keine Befehlsargumente oder Geheimnisse. Frühere Profiländerungen vor dieser Erweiterung haben keinen nachträglichen Beleg.

Bei fehlender Abhängigkeit, belegtem Port oder ausbleibender HTTP-Bereitschaft zeigt die Kartenansicht die Fehlerklasse und die lokale Prozessausgabe getrennt. Der Agent kann eine Erklärung und einen manuellen Prüfhinweis geben. Er installiert nichts, editiert keine Projektdateien und startet den Server nicht. Nach einer bewussten Korrektur muss das Profil erneut bestätigt und die Vorschau erneut gestartet werden. Die gespeicherte Einrichtung bleibt nach einem App-Neustart erhalten; ein Agentenvorschlag im Speicher verfällt, und kein Prozess wird automatisch wiederholt.

Beispiel für ein bereits installiertes Vite-Projekt im Karten-Worktree:

| Feld | Wert |
| --- | --- |
| Programm | `node` |
| Argument 1 | `node_modules/vite/bin/vite.js` |
| Argument 2–5 | `--host`, `127.0.0.1`, `--port`, `{port}` |
| Prüfpfad | `/` |
| Text auf der bereiten Seite | Ein eindeutiger Text im HTML der App |

Abhängigkeiten müssen im jeweiligen Worktree vorhanden sein. Bei einem Node-Projekt kannst du sie dort bewusst mit `npm install` einrichten. Branchloom führt keine Installation aus. Windows-`npm.cmd` wird wegen der direkten Ausführung ohne Shell nicht als Programmprofil unterstützt. Eine kleine projektinterne JavaScript-Startdatei, die mit `node` aufgerufen wird, funktioniert ebenfalls.

Die **Prozessausgabe** im Kartendialog zeigt die letzten 32.000 Zeichen und den Startfehler. Gib keine Schlüssel als Argumente oder in Konsolenausgaben aus. Ein Prozess hat Zugriff auf dieselben lokalen Rechte wie die App; starte nur Code, dem du vertraust. Das Profil begrenzt Argumente, startet ohne Shell und verlangt eine lokale Adresse, ist aber keine Sandbox.

## Zustand und Grenzen

- Portbelegung und gleichzeitige Starts werden geprüft und in SQLite reserviert. Zwischen Portprüfung und tatsächlicher Bindung durch das Projektprogramm bleibt eine Betriebssystem-Rennbedingung; der Server muss einen Bindefehler selbst melden. Branchloom bezeichnet die Vorschau dann nur bei passendem HTTP-Text als bereit.
- Beim regulären App-Ende versucht Branchloom jeden verwalteten Prozessbaum zu stoppen. Scheitert das, bleibt der Lauf ungeklärt und wird nicht als gestoppt ausgegeben. Nach einem Absturz wird nichts automatisch neu gestartet. Ein nicht mehr laufender Elternprozess wird beim nächsten Abruf als **unterbrochen** markiert. Ein noch lebender Prozess aus einer früheren App-Sitzung bleibt sichtbar, kann von dieser Sitzung aber nicht gestoppt oder als geprüfte Vorschau geöffnet werden. Prüfe Programm, Port und angezeigte Start-PID im Task-Manager, beende nur den verifizierten alten Server und wähle **Status erneut prüfen**. Eine PID kann inzwischen einem anderen Prozess gehören; Branchloom beendet fremde PIDs nie automatisch.
- Die Readiness-Prüfung belegt einen antwortenden HTTP-Dienst und den konfigurierten Text, aber keine kryptografische Zuordnung zwischen Antwort und Kindprozess. Auch nach der erneuten Prüfung beim Öffnen bleibt ein kleiner Zeitraum, in dem der Dienst enden und ein anderer denselben Port übernehmen könnte. Branchloom prüft nicht automatisch die visuelle Darstellung, Browserfehler, Abhängigkeiten oder erfolgreiche Agentenarbeit. Dafür bleiben die gesonderten Browser-QA- und Review-Abläufe zuständig.
- Der Stop-Knopf beendet auch normale Kindprozesse im Prozessbaum. Wenn sich ein Kind vor dem Stoppen vollständig vom Elternprozess gelöst hat oder der Elternprozess vorher unerwartet endet, kann Branchloom es nicht mehr sicher diesem Lauf zuordnen. Prüfe in diesem Fall den belegten Port und beende den alten Server manuell.

Die geführte Profilwahl deckt bisher nur belegte Vite-Standardprojekte ab. Agentengeführte Einrichtung anderer Frameworks, automatische Code- oder Abhängigkeitsreparatur, Testdaten-Reset, Port-Forwarding und ein vollständig gekapselter Container bleiben offen.
