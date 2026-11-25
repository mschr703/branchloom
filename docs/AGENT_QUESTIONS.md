# Gemeinsame Agentenfragen (F05, erster Teil)

Ein laufender Kartenagent kann eine konkrete Rückfrage über ein lokales Loopback-Werkzeug speichern. Branchloom bindet sie an **genau die aktive Sitzung, Karte und Inhaltsrevision**. Das Werkzeug ist nur über einen kurzlebigen Token dieser Sitzung erreichbar; Browser-Origin-Anfragen und andere Karten-IDs werden nicht akzeptiert. Es sendet keine Daten an einen externen Dienst. Der Agent erhält die URL und den Token über Umgebungsvariablen. Der Token gehört weder in den Kartenauftrag noch in ein Git-Repository.

Unter **Entscheidungen → Dieses Projekt → Agentenfragen** stehen die Originalfragen mit Karte, Agent, Auftragsrevision und Zustellstatus. Die sichtbare Ansicht liest neue Fragen alle 15 Sekunden erneut; **Aktualisieren** prüft sie sofort. Es lassen sich mindestens zwei noch offene Fragen verschiedener Karten auswählen. Vor dem Antworten bleiben alle Empfänger und Originalfragen sichtbar. **Einmal beantworten** speichert dieselbe Antwort mit einem gemeinsamen Beleg in der lokalen Datenbank und schreibt sie in die beiden ursprünglichen, noch laufenden Terminals. Eine dritte, nicht ausgewählte Frage bleibt unverändert.

Der Hauptprozess prüft beim Speichern und unmittelbar vor jeder Terminaleingabe, ob Sitzung, aktuelle Karte und Revision noch passen. Eine geänderte oder beendete Sitzung sperrt die gemeinsame Antwort vorab. Wenn sich eine Sitzung erst nach der Speicherung ändert, sieht der Nutzer den getrennten Status **veraltet** oder **fehlgeschlagen**. Ein Neustart wiederholt keine vorbereitete oder möglicherweise schon geschriebene Antwort. Die Zustände **gespeichert**, **zugestellt** und **inhaltlich übernommen** sind verschieden: Eine erfolgreiche PTY-Schreiboperation belegt nur Zustellung, nicht das Verständnis oder die Anwendung durch den Agenten. Die Übernahme bleibt in diesem ersten Teil ausdrücklich **nicht belegt**.

## Grenzen

- Die erste Stufe gruppiert Fragen nur durch bewusste Auswahl; sie erkennt Ähnlichkeit nicht automatisch.
- Nur Fragen, die der Agent tatsächlich über das lokale Werkzeug meldet, erscheinen. Freier Terminaltext wird nicht als Frage interpretiert.
- Neue Kartenläufe erhalten die Werkzeuganleitung im Auftrag. Beim gezielten Codex-Fortsetzen wird der Sitzungstoken neu vergeben, die Anleitung aber nicht automatisch als neue Nachricht wiederholt.
- Die projektweite Inbox enthält die Fragen des aktiven Projekts. Die Sammelansicht aller Projekte und eine automatische Benachrichtigung bei neuen Fragen sind noch offen.
- Der Agent bestätigt noch keine inhaltliche Übernahme mit einem überprüfbaren Folgebeleg. Ein späterer Adapter kann dies ergänzen, ohne PTY-Zustellung fälschlich als Übernahme zu behandeln.
- Die Ansicht zeigt höchstens 100 aktuelle Fragen je Projekt; ältere Fragen bleiben in SQLite erhalten.
