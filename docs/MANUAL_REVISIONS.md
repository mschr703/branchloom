# Manuelle Zwischenänderungen · erster F03-Teilablauf

Der Kartendialog kann eine ausdrücklich ausgewählte, geänderte Zieldatei als **manuelle Revision** in der lokalen Branchloom-Datenbank festhalten. Das ist eine bewusste Zuordnung durch den Nutzer, keine aus Zeitstempeln abgeleitete Urheberschaft. Grundlage, manuelle Fassung und committierte Fassung des Karten-Worktrees werden mit Git dreifach verglichen.

## Ablauf

1. Öffne eine Karte mit gespeichertem Git-Worktree. Ändere eine bereits versionierte Textdatei im Ziel-Checkout, während der Karten-Worktree getrennt bleibt. Das Festhalten ist auch während eines laufenden Agenten möglich; für die spätere Übernahme muss dessen Dateifassung committiert und der Worktree sauber sein.
2. Unter **Manuelle Zwischenänderungen** wähle die Datei und **Änderung festhalten**. Branchloom speichert die Fassung, ihren SHA-256-Wert, den Zielbranch samt HEAD und die gemeinsame Git-Basis lokal. Die Auswahl beweist nicht, wer die Datei bearbeitet hat.
3. Öffne den Dreifachvergleich. Die Ansicht zeigt die gemeinsame Basis, die festgehaltene manuelle Fassung, den aktuellen **committierten** Agentenstand und das Ergebnis von `git merge-file --diff3`. Überlappende Stellen zeigen die drei Fassungen und Konfliktmarkierungen; Branchloom schreibt dann nichts.
4. Prüfe ein konfliktfreies Ergebnis und wähle **Diese Datei zusammengeführt schreiben**. Der Hauptprozess vergleicht unmittelbar davor Zielbranch und -HEAD, Agenten-HEAD, Basis, ursprünglichen Datei-Hash und Vorschautoken erneut. Nur die gewählte Zieldatei wird ersetzt. Ändert sie sich zwischen Vorschau und Klick, wird die Übernahme abgewiesen und ein neuer Vergleich nötig.

Der Ziel-Checkout ist nach dem Schreiben **absichtlich uncommittet**. Die G02-Integrationswarteschlange bleibt dadurch gesperrt; Branchloom führt keinen Git-Branch-Merge, Commit oder Rebase aus. Diese Stufe schützt und kombiniert eine Datei, sie integriert noch keine ganze Karte. Für eine spätere Branch-Übernahme sind getrennte Git-Prüfung, Commit/Abgleich und erneute Tests nötig.

## Grenzen

- Zugelassen sind bestehende, geänderte, versionierte UTF-8-Dateien bis 128 KiB ohne BOM. Gelöschte, unversionierte, binäre und symbolisch verlinkte Dateien bleiben ausgenommen. Änderungen im Karten-Worktree müssen vor dem Vergleich committiert sein.
- Bei Konflikten gibt es noch keine Auswahl einzelner Zeilen oder Eigenschaften. Die drei Varianten stehen lesbar bereit; die Datei bleibt erhalten, bis der Nutzer den Konflikt in einem getrennten Arbeitsablauf löst.
- Der Vergleich ist eine Momentaufnahme. Auch nach der zweiten Hash-Prüfung kann eine externe Anwendung theoretisch im kurzen Fenster vor dem atomaren Ersetzen schreiben. Branchloom hält seine eigenen Schreibaktionen über eine SQLite-Sperre auseinander, kann aber fremde Editoren nicht sperren. Bei gleichzeitiger Bearbeitung die Änderung zuerst im Editor abschließen und danach frisch vergleichen.
- Die Revision und der Textinhalt liegen nur in der lokalen SQLite-Datei, nicht im öffentlichen Repository. Sie enthalten möglicherweise Projektinhalte und gehören nicht in einen öffentlichen Export oder Commit.
