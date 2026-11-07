# LoopStudio 0.8.0

Lokales Musikstudio für Audio/Video, A/B-Loops, Instrumentenspuren und Noten. Desktop-App mit Rust/Tauri; React und alphaTab für die Bedienoberfläche.

Die Griffberechnung verwendet seit 0.5.1 eine gemeinsame ONNX-Umgebung pro App-Prozess und speichert berechnete Positionen im lokalen Cache. Regressionstests führen mehrere echte Modellaufrufe in demselben Prozess aus.

Version 0.7.2 behebt das Schließen des Fensters nach dem Speichern und lädt die Medienmetadaten beim erneuten Öffnen desselben Projekts neu. Das Löschen des ausgewählten oder letzten Loops deaktiviert die A/B-Wiederholung, ohne Aufnahme oder Noten zu löschen.

## GP7-Partituren und Fretwork

Jeder bearbeitete Loop verwendet jetzt ein GP7-Dokument (`.gp`) als verbindliche Notenfassung.
„Noten bearbeiten“ öffnet den lokal eingebetteten Fretwork-Editor: Note anklicken, Bund/Saite
oder Tonhöhe und Notenwert ändern, rückgängig machen und anhören. Spieltechniken und Taktwerkzeuge
sind eingeklappt. „Übernehmen & schließen“ exportiert GP7, erneuert die Wiedergabenoten und
Griffpositionen und wartet auf die Speicherung im Projekt bzw. ausgewählten Loop. Bei einem
Speicherfehler bleibt der Editor offen. Das normale Schließen des App-Fensters übernimmt offene
Editoränderungen und wartet auf ihre Speicherung; „Verwerfen“ verwirft sie ausdrücklich.

GP5-Dateien werden über das vollständige AlphaTab-Partiturmodell nach `.gp` übernommen. MIDI und
Analysen werden einmalig auf das bisherige 1/16-Raster übertragen (maximal 256 Takte; derzeit
120 BPM für Analysen). Die ursprünglichen Analyse-/MIDI-Zeitdaten bleiben zusätzlich erhalten.
Gitarrenspuren nutzen die native Griffzuordnung; fehlt diese, bleiben die Noten ohne erfundene
Griffe erhalten. Piano-Spuren behalten ihre Tonhöhen auch beim GP7-Export. Weitere Bearbeitungen
verwenden das vollständige GP7-Modell, nicht die vereinfachte Notenliste.

Der unabhängige Notenplayer und die Aufnahme-begleitenden Ansichten erhalten nach dem Übernehmen
dieselben aus GP7 abgeleiteten Noten. Der Notenplayer verwendet weiterhin den einfachen Syntheseklang;
Fretworks eigene Vorschau verwendet den mitgelieferten Sonivox-Soundfont. Änderungen an Rhythmus oder
Notenlänge lösen eine bestehende Synchronisationszuordnung, damit sie bewusst neu gesetzt werden kann.
Die A/B-Grenzen der Originalaufnahme bleiben erhalten. Importierte vollständige Partituren bleiben
vollständig; die im Notenplayer ausgewählte Notenpassage wird separat im Loop gespeichert.

Im Projekt stehen aktuelle GP7-Fassungen unter `assets/notation/*.gp`. Frühere Materialien werden
nicht überschrieben. Ohne Projekt oder ausgewählten gespeicherten Loop muss die übernommene Partitur
anschließend einer gespeicherten A/B-Passage zugeordnet werden.

Fretwork ist als abgegrenztes Quellmodul unter `vendor/fretwork` integriert (MIT, Revision und
Änderungen in `vendor/fretwork/UPSTREAM.md`). Der eigene Fretwork-Klon wird nicht verändert und muss
zum Bauen nicht danebenliegen. `npm run dev` und `npm run build` erstellen zuerst das lokale
Editormodul; Internet wird im Betrieb nicht benötigt. Die Rust-Analyse bleibt unverändert.

## Extern mit Guitar Pro bearbeiten

Neben „Noten bearbeiten“ steht „In Guitar Pro bearbeiten“. Die gesamte aktuelle Partitur mit allen Spuren wird als GP7-Arbeitskopie exportiert und direkt mit Guitar Pro geöffnet. Die Anwendung wird über die Windows-App-Registrierung bzw. übliche Installationsordner gefunden; über „Guitar Pro auswählen …“ kann die installierte `GuitarPro.exe` angegeben werden. Der interne Editor bleibt verfügbar.

1. „In Guitar Pro bearbeiten“ wählen.
2. In Guitar Pro bearbeiten und mit **Strg+S in derselben Datei** speichern.
3. In LoopStudio „Änderungen aus Guitar Pro übernehmen“ wählen. Bei „Speichern unter“ stattdessen die neue Datei über „MIDI / Guitar Pro laden“ importieren.

Arbeitskopien liegen im Projekt unter `assets/external-editor/<Sitzung>/Loop-Partitur.gp`; ohne Projekt im lokalen App-Datenordner unter `external-scores/`. Die Zuordnung wird mit der Partitur gespeichert und funktioniert bei gespeicherten Loops bzw. Projekten nach einem Neustart. Im Projekt werden ausschließlich Sitzungs-ID und Prüfsumme hinterlegt, keine absoluten Dateipfade. Der gesamte Projektordner kann einschließlich der Arbeitskopien verschoben werden.

Die Ausgangsfassung und jede vor einer Übernahme bestehende Fassung werden unter `history/<SHA-256>.gp` gesichert. Die externe Datei wird beim Übernehmen nicht verändert. Ungültige, zu große oder noch veränderte Dateien ersetzen die aktuelle Partitur nicht. Änderungen in LoopStudio seit dem Export führen zu einer Konfliktmeldung; „Neue Arbeitskopie“ exportiert den aktuellen Stand in einen neuen Ordner, ohne die bisherige externe Datei zu überschreiben. Fehlgeschlagene Projektspeicherungen können über „Übernahme erneut speichern“ wiederholt werden.

Aufnahme und A/B-Grenzen bleiben erhalten. Ändern sich Rhythmus oder Dauer, wird die bisherige Synchronisierung gelöst und muss neu zugeordnet werden. Änderungen werden bewusst nur per Knopfdruck eingelesen; es gibt keine automatische Übernahme beim Fensterwechsel oder Schließen der App.

Die Guitar-Pro-Erweiterung ist in beiden OCR-Varianten enthalten. Der bisherige Python-Konverter bleibt über das Build-Feature `python-tab-tools` verfügbar:

```powershell
# Bisherigen PDF-/OMR-Konverter separat einrichten (Python 3.12):
./setup-tab-tools-python.ps1 -Python C:/Pfad/python.exe
# App mit bisherigem Konverter und neuer Guitar-Pro-Anbindung bauen:
./build-local.ps1 -PythonTabTools
```

Die Rust-Variante wird weiterhin ohne dieses Feature gebaut. Der externe Noteneditor selbst benötigt in beiden Varianten kein Python. Die alte Python-Laufzeit wird durch den Build nicht automatisch installiert.

## Wellenform und A/B-Markierungen

Die bestehende Wellenform wird nun auch für Videos, über die native Dateiauswahl und beim Öffnen eines Projekts berechnet. Zuvor rief nur der Audio-Import per Drag & Drop den vorhandenen Web-Audio-Decoder auf. Anzeige und Normalisierung bleiben erhalten. Die bisherige Grenze von 200 MB und die vom WebView unterstützten Audioformate gelten weiterhin; ein Fehler wird in der Zeitleiste angezeigt. Beim Wechsel der Aufnahme werden alte Lesevorgänge abgebrochen, damit die Wellenform der vorherigen Datei nicht nachträglich die neue überschreibt.

Die Wellenform ist ausschließlich innerhalb der gewählten A/B-Passage hellgrün, unabhängig vom Abspielcursor und vom Loop-Schalter. Während des Ziehens folgt die Färbung direkt der Vorschau. Ohne vollständige A/B-Auswahl bleibt sie gedämpft.

A und B lassen sich an ihren beschrifteten Griffen in der Wellenform mit Maus oder Touch ziehen. Die Auswahl erscheint als Vorschau und wird beim Loslassen übernommen; ein Abbruch verwirft die Vorschau. Die Grenzen bleiben innerhalb der Aufnahme und mindestens 0,1 Sekunden auseinander. Mit fokussiertem Griff verschieben Pfeiltasten um 0,1 Sekunden, mit Umschalt um 1 Sekunde. Die geänderte Auswahl bleibt im Projekt erhalten. Bereits benannte Loops behalten ihre gespeicherten Grenzen; „Speichern“ legt die neue Passage als Loop ab.

## Übungsprojekte

Beim Start erscheint die Projektübersicht. „Neues Projekt“ legt einen benannten Projektordner mit einer Kopie der gewählten Audio-/Videodatei an. „Projekt öffnen“ öffnet eine `.loopstudio`-Datei, „Zuletzt verwendet“ öffnet bekannte Projekte direkt. Der Projektordner ist frei wählbar; Vorgabe ist `Dokumente/LoopStudio/Projekte`.

```text
Mein Übungsprojekt/
  project.loopstudio      # Projektname, Loop-Liste, Tempo und letzter Arbeitsstand
  media/                 # Kopie der Aufnahme
  materials/             # Gespeicherte Noten und bearbeitete Loop-Fassungen
  assets/audio/          # Aufbewahrte Demucs-Instrumentenspuren
  assets/notation/       # GP7-Loop-Partituren und aufbewahrte MIDI-Dateien
```

Das Projekt speichert alle Loops samt Noten, Originalvorlage, manuellen Saitenpositionen, Notenspur, Notenpassage und Synchronisationszuordnung. Auch der aktuelle Notenstand ohne gespeicherten Loop, A/B-Auswahl, Notenansicht, Tempo und Lautstärke bleiben erhalten. Nach dem Öffnen bleibt die Wiedergabe angehalten. Die Verknüpfung mit der Aufnahme lässt sich im Notenplayer wieder aktivieren.

Änderungen werden automatisch gespeichert; der Status steht oberhalb des Players. „Jetzt speichern“ wiederholt einen fehlgeschlagenen Speicherversuch. Vor dem Projektwechsel und beim normalen Schließen wartet die App auf die Speicherung. Ein Fehler verhindert das Schließen über diesen Weg und wird angezeigt. Wie bei anderen Apps können ein erzwungenes Prozessende oder Stromausfall noch laufende Speichervorgänge unterbrechen; die letzte vollständig geschriebene Projektdatei bleibt durch atomisches Ersetzen erhalten.

Ein Projekt ist unabhängig vom ursprünglichen Aufnahmeort und vom App-Cache. Zum Sichern oder Verschieben den **gesamten Projektordner** kopieren und anschließend dessen `project.loopstudio` öffnen. Interne Verweise sind relativ. Analysen und Noten müssen nach dem Umzug nicht neu berechnet werden. Die optionale Modell-/Programm-Laufzeit gehört zur App und wird nicht in jedes Projekt kopiert.

„Bisherige Übungen übernehmen“ bietet alte, dateibezogene Sessions mit Loops an. Beim Anlegen werden ihre vorhandenen Notendaten und Instrumentenspuren mitkopiert. Die ursprünglichen Sessions bleiben bestehen. Im bisherigen Übungsraum lässt sich eine offene Session über „Als Projekt speichern“ übernehmen, einschließlich noch nicht einem Loop zugeordneter Noten. Bereits vorhandene, beschädigte oder unvollständige Daten werden gemeldet; ein bestehender Projektordner wird nicht überschrieben. Zum Wechsel auf eine andere Aufnahme ein neues Projekt anlegen. MIDI-/Guitar-Pro-Dateien können im bestehenden Projekt weiterhin geladen und bearbeitet werden.

Früher importierte MIDI-Dateien wurden nur als Wiedergabenoten gespeichert. Diese Noten werden übernommen, die ursprünglichen MIDI-Dateibytes stehen in alten Snapshots noch nicht zur Verfügung. Neu importierte MIDI- und GP-Dateien werden einschließlich Originaldatei im Projekt aufbewahrt. Der Editor bearbeitet weiterhin die LoopStudio-Fassung; eine Originaldatei wird durch diese Änderungen nicht umgeschrieben.

Die Projektverwaltung und Dateikopien laufen in Rust. Tests prüfen einen Neustart nach dem Verschieben des Projektordners, entfernte Originale/Analyse-Caches, GP-/MIDI-Dateien, bearbeitete Noten, mehrere Loops und fehlgeschlagene Schreibvorgänge. Ein verzögerter Notenspeichervorgang darf beim schnellen Wechsel auf einen anderen Loop nicht durch eine ältere Fassung ersetzt werden.

## Separate Tab-Werkzeuge

„Tab-Werkzeuge“ in der Seitenleiste öffnet einen eigenen Bereich mit zwei lokalen Verfahren. Der Übungsraum und seine Aufnahme bleiben erhalten. Beim Wechsel wird die Wiedergabe angehalten. Erkennungsergebnisse bleiben beim Bereichswechsel in der Sitzung erhalten; zum dauerhaften Aufbewahren GP5/Prüfbericht exportieren oder ausdrücklich in den Übungsraum übernehmen und beim Loop speichern.

- **[PDF-to-GP5](https://github.com/F100Pilot/PDF-to-GP5)**: PDF, PNG, JPEG oder WebP einlesen und als GP5 ausgeben. Die OCR liest auch klare Tabulaturbilder. Maximal 40 MB, 15 PDF-Seiten, 8 OCR-Seiten und 20 Megapixel pro Bild.
- **[Guitar Tab OMR](https://huggingface.co/kk9293/guitar-tab-omr)**: eine einzelne ausgeschnittene Tabulaturzeile mit dem veröffentlichten PyTorch-Modell lesen (CPU). Rohsymbole und Prüfbericht werden erhalten. Standardstimmung mit sechs Saiten; grundlegende Noten, Pausen, Punktierungen, Tuplets und Kapodaster werden nach GP5 übertragen. Techniken/Wiederholungen sind noch unvollständig; Hinweise erscheinen beim Ergebnis. Unvollständige Takte werden gemeldet. Modelllizenz ist „other“, daher experimentelle lokale Einbindung, keine Modellgewichte im Repository.

Unter „Tabulatur aus einem lokalen Video ausschneiden“ ein eigenes Video wählen, Zeitstelle eingeben, Standbild laden und mit der Maus eine vollständige Tabulaturzeile markieren. „Ausschnitt übernehmen“ liefert die Eingabe für das gewählte Werkzeug. Das ist ein manueller Standbildtest, noch keine automatische Erkennung und Zusammenführung sämtlicher Tab-Einblendungen eines Videos.

Ergebnisse haben einen eigenen Notenplayer mit scrollender Noten-/Tabulaturzeile, Griffbrett, Waterfall und Notenbearbeitung. „Erkanntes GP5 speichern“ exportiert die **ursprüngliche Erkennung**. Bearbeitungen sind LoopStudio-Arbeitsfassungen; „Bearbeitete Fassung im Übungsraum öffnen“ übernimmt diese samt GP-Vorlage. Der vorhandene Editor exportiert noch keine bearbeiteten GP5-Dateien. Das Tempo ist eine Eingabevorgabe, wenn es im Bild fehlt; Videosynchronisierung erfolgt anschließend im Übungsraum.

### Optionale Laufzeit installieren

Die Tab-Werkzeuge laufen in **`native-tab-tools/` als eigenständiger Rust-Prozess ohne Python-Laufzeit**. PDFium liest und schreibt PDFs, das lokale PP-OCRv4-ONNX-Modell liest Bundzahlen, und Guitar Tab OMR verwendet einen ONNX-Bildencoder und einen ONNX-Notendecoder. Auswahl, FFmpeg-Ausschnitte, Fortschritt, Abbruch und Exporte bleiben in der App. Eingabedateien werden nicht hochgeladen.

**Stand der PDF-Portierung:** Sechszeilige Text-Tabulaturen sowie Bild-/Vektor-PDFs werden gelesen. Saiten, Taktstriche, Akkorde und zweistellige Bundzahlen werden erkannt. Im nativen PDF-Verfahren werden Notenwerte derzeit gleichmäßig pro erkanntem Takt geschätzt. Die umfangreichere Rhythmus-, Pausen-, Technik-, Stimmungs- und Wiederholungserkennung des bisherigen Python-PDF-Konverters ist noch nicht vollständig portiert. Die Prüfung gegen die Vorlage und die entsprechenden Hinweise im Ergebnis sind deshalb erforderlich. Die früher dokumentierten Praxisergebnisse des Python-PDF-Verfahrens gelten nicht als Genauigkeitsnachweis für Rust. Text-PDFs: maximal 15 Seiten; gerasterte PDFs: maximal 8 Seiten; Bilder: maximal 20 Megapixel.

```powershell
# Nur PDF/OCR; vollständig ohne Python einzurichten:
./setup-tab-tools.ps1 -SkipOmr
# OMR einmalig in einer Entwicklungsumgebung konvertieren:
python -m venv .runtime-downloads/tab-export
./.runtime-downloads/tab-export/Scripts/python.exe -m pip install -r tooling/requirements-tab-export.txt
./setup-tab-tools.ps1 -Python ./.runtime-downloads/tab-export/Scripts/python.exe
# Bereits konvertierte ONNX-Dateien übernehmen; kein Python erforderlich:
./setup-tab-tools.ps1 -OmrOnnx C:/Pfad/omr-onnx
```

Der Ordner `LoopStudio-tools-runtime` gehört neben die EXE. Alternativ `LOOPSTUDIO_TOOLS_RUNTIME` auf ihn setzen. `build-local.ps1` baut den Rust-Worker und kopiert die Laufzeit neben die App. Bibliotheken, OCR-Modell und OMR-Quellen sind mit Revisionen und SHA-256-Prüfsummen festgeschrieben. Der einmalige OMR-Export vergleicht Encoder und Decoder numerisch mit dem unveränderten PyTorch-Modell bei Sequenzlängen 1, 3, 17 und 383. Danach kann die Python-Exportumgebung entfernt werden. Im Betrieb werden weder Python noch PyTorch noch die Originalskripte benötigt. Auftragslimit fünf Minuten; Abbruch beendet den Werkzeugprozess. Die Modelllizenz von Guitar Tab OMR bleibt „other“; die Konvertierung ändert sie nicht.

Praxistest mit einem lokalen 1080p-Video, Standbild bei 30 s, drei vollständige Takte: PDF-to-GP5 lieferte 3 Takte mit 48 Tab-Einträgen (42 klingende und 6 Dead Notes); Saiten/Bünde und grundlegende Rhythmuswerte stimmten beim Gegenlesen des Ausschnitts. Guitar Tab OMR lieferte 43 Einträge in 4 Takten, mit falschen Bünden, fehlenden/zusätzlichen Noten und falschen Taktgrenzen. Das ist ein einzelner Test, keine allgemeine Genauigkeitsmessung. Bindebögen/Spieltechniken weiter prüfen.

Prüfungen der nativen Tab-Werkzeuge:

```powershell
cargo test --manifest-path native-tab-tools/Cargo.toml --locked
$env:LOOPSTUDIO_TOOLS_RUNTIME = "$PWD/LoopStudio-tools-runtime"
cargo test --manifest-path native-tab-tools/Cargo.toml --locked --test pipeline -- --ignored
$env:LOOPSTUDIO_TAB_TOOLS_EXE = "$PWD/src-tauri/target/release/loopstudio-tab-tools.exe"
npm test
```

Die PNG-/PDF-Integration prüft genaue Saiten/Bünde einschließlich 10 und 12, mehrere Systeme und die native PDF-Zusammenstellung. Der JavaScript-Test liest die aktuelle Rust-GP5-Ausgabe unabhängig mit alphaTab ein. `tooling/verify_native_tab_tools.py` ist eine optionale Entwicklungsprüfung gegen das bisherige PyTorch-Modell und PyGuitarPro. `tooling/tab_worker.py` und dessen Python-Tests bleiben ausschließlich als Migrationsreferenz erhalten und werden nicht mehr in die App eingebettet oder gestartet.

## Native Analyse

Die Audio-/Videoanalyse im Übungsraum benötigt **keinen Python-Prozess und keine Python-Installation**. `native-analysis/` übernimmt das bewährte Rust-Backend aus dem lokalen AutoTab-Rust-Projekt:

- **Demucs htdemucs_6s ONNX:** sechs Stereo-Spuren (Schlagzeug, Bass, Rest, Gesang, Gitarre, Piano), mit gemeinsamem Pegel und überlappenden Analysefenstern.
- **Notenerkennung:** Basic Pitch oder MuScriptor Small/Medium/Large. MuScriptor wird je tonaler Instrumentenspur angewendet, mit Instrumentvorgabe für Gitarre/Piano/Bass und automatischer Erkennung für Rest/Gesang. Schlagzeug erhält keine Tonhöhenanzeige.
- **Gerät:** CPU oder Intel-GPU über OpenVINO; Automatik bevorzugt die installierte OpenVINO-GPU-Umgebung. Falls keine geeignete Intel-GPU vorhanden ist, CPU wählen. Basic Pitch bleibt auf der CPU. MuScriptor nutzt auch für CPU-Betrieb die OpenVINO-Bibliotheken.
- **Griffsuche:** trainierter tab-labeler v3 plus begrenzte Griffsuche aus AutoTab-Rust. Standardstimmung, Bünde 0–19, eine Position pro Note. Belegte Saiten, Lagenwechsel und Griffweite werden berücksichtigt; zusätzliche Gitarrenstimmen sind getrennt auswählbar. Maximal 20.000 Noten pro Griffberechnung.

Die gewählte A/B-Passage muss 0,1–180 Sekunden lang sein. Für den Einstieg 10–30 Sekunden wählen. Bei MuScriptor werden bis zu fünf tonale Spuren analysiert; das kann insbesondere mit großen Modellen dauern. Fehler der gewählten Erkennung werden angezeigt; es gibt keinen stillen Wechsel auf ein anderes Modell.

Fortschritt, Abbruch und Ergebnis-Cache werden von Rust verwaltet. Cache-Schlüssel berücksichtigen Passage, Quelldatei, Modellwahl, Gerät, lokale Modellmetadaten und Analyseprogramm. Abbruch beendet auch FFmpeg-Unterprozesse. Erst ein vollständiges Ergebnis wird veröffentlicht. Die Ausgabe nennt das tatsächlich verwendete Modell und Gerät.

## Starten und einrichten

Die fertige App `LoopStudio-0.8.0.exe` liegt nach dem Build unter `src-tauri/target/LoopStudio-0.8.0`. Der danebenliegende Ordner `LoopStudio-runtime` enthält die Audioanalyse, `LoopStudio-tools-runtime` die nativen Tab-Werkzeuge. Die App benötigt keine Python-Laufzeit.

Im Source-Verzeichnis:

```powershell
npm ci
./build-local.ps1
./setup-analysis.ps1
```

Voraussetzungen zum Bauen: Node.js, Rust ab 1.92 und die Windows-C++-Buildtools samt Windows SDK. Zum Starten wird WebView2 benötigt. `build-local.ps1` baut die App, `loopstudio-analysis.exe` und `loopstudio-tab-tools.exe` und kopiert vorhandene Laufzeitdateien in den Ausgabeordner. Nach einer erstmaligen Einrichtung der Modelle den Build erneut ausführen oder die Laufzeitordner neben die EXE kopieren.

`setup-analysis.ps1` lädt die überprüften nativen ONNX-/OpenVINO-Bibliotheken und das Demucs-Modell. Es installiert kein Python. `-CpuOnly` überspringt OpenVINO und unterstützt dadurch Basic Pitch, aber kein MuScriptor. Mit `-Runtime <Ordner>` lässt sich ein eigener Laufzeitordner wählen; die App findet ihn über `LOOPSTUDIO_RUNTIME`. `-AutoTabHome <Ordner>` kann vorhandene `runtime/`- und `models/`-Dateien übernehmen; die bekannten Demucs-/Runtime-Downloads werden anschließend geprüft. Ein expliziter Worker lässt sich mit `-Worker <exe>` angeben.

Laufzeitstruktur:

```text
LoopStudio-0.8.0.exe
LoopStudio-tools-runtime/
  loopstudio-tab-tools.exe
  runtime/pdfium.dll
  runtime/onnxruntime.dll
  models/ocr/recognizer.onnx
  models/omr/encoder.onnx
  models/omr/decoder.onnx
  models/omr/manifest.json
LoopStudio-runtime/
  loopstudio-analysis.exe
  runtime/ffmpeg.exe
  runtime/onnxruntime.dll
  runtime/openvino-2026.4.1/*.dll
  models/htdemucs_6s.onnx
  models/muscriptor-*/...
  .cache/...
```

Native Gewichte und Laufzeitbibliotheken werden nicht ins Git-Repository aufgenommen. Basic Pitchs offizielles ONNX-Modell ist über `basic-pitch-rs` eingebettet. Die Griffsuche lädt beim ersten Einsatz das kleine tab-labeler-Modell in den lokalen App-Cache.

## MuScriptor-Zugang

In der Analyseansicht ein Modell und das Gerät wählen. Vorhandene Gewichte im Laufzeitordner oder Hugging-Face-Cache werden wiederverwendet. Alternativ eine passende lokale `.safetensors`-Datei wählen. Modell und gewählte Größe müssen übereinstimmen.

Downloads erfordern freigeschalteten Zugang zum jeweiligen Modell bei Hugging Face: [Small](https://huggingface.co/MuScriptor/muscriptor-small), [Medium](https://huggingface.co/MuScriptor/muscriptor-medium), [Large](https://huggingface.co/MuScriptor/muscriptor-large). Größen: etwa 0,41 / 1,23 / 5,47 GB. Gewichte: **CC BY-NC 4.0**. Die native OpenVINO-Umsetzung verwendet den MuScriptor-Code unter MIT; der Hinweis bleibt unter `native-analysis/docs/licenses/muscriptor-MIT.txt` erhalten.

Ein optionaler Hugging-Face-Token wird nur für die Sitzung gehalten und als Umgebungsvariable an den Rust-Prozess übergeben. Er wird nicht in Befehlszeilen, Ergebnisdateien oder Einstellungen gespeichert. Bestehende Anmeldung über `HF_TOKEN` oder den Hugging-Face-Token-Cache funktioniert ebenfalls. Audio und Noten werden nicht hochgeladen.

## Noten bearbeiten

Die Analyseansicht bietet nun auch „Noten & Tabulatur“ mit einer einzelnen scrollenden Zeile und synchronem Cursor. Unter „Noten bearbeiten“ lassen sich Noten auswählen, hinzufügen und löschen, Tonhöhe, Anfang, Dauer, Anschlag sowie Saite/Bund korrigieren. Rückgängig/Wiederholen hält bis zu 30 Änderungen innerhalb der aktuellen Editoransicht bereit. Eine einzelne Spur wählen.

Die Bearbeitung ist auch im MIDI-/Guitar-Pro-Notenplayer verfügbar. Änderungen aktualisieren die Wiedergabenoten und alle Ansichten. Manuelle Saitenpositionen haben Vorrang vor berechneten Vorschlägen. In der Tabulatur lassen sich zusätzliche Gitarrenstimmen getrennt anzeigen. Gespeicherte Loops übernehmen die bearbeitete Fassung automatisch; falls noch kein Loop existiert, die Passage speichern.

GP-Dateien werden als Vorlage im Loop aufbewahrt; der Editor bearbeitet die daraus importierten Wiedergabenoten. Nach einer Änderung zeichnet alphaTab die bearbeitete Fassung mit vereinfachter 1/16-Notation bei Anfangstempo, maximal 256 Takte. Rhythmische Schreibweisen, Wiederholungszeichen und Spezialeffekte der ursprünglichen GP-Partitur werden dabei nicht vollständig rekonstruiert. Es handelt sich um eine bearbeitete Loop-Fassung, nicht um einen vollständigen Guitar-Pro-Dateieditor oder GP5-Export. Notenzeitwerte und Originalvorlage bleiben im gespeicherten Loop erhalten. Die Audiospur der Aufnahme wird durch Notenkorrekturen nicht neu synthetisiert.

## Player und Noten

Audio/Video lokal öffnen oder ablegen. Anfang mit A, Ende mit B setzen; L schaltet den Loop, Leertaste die Aufnahme. Tempo 25–200 % bei erhaltener Tonhöhe. Die Analyse erzeugt einen Mixer mit Lautstärke, Stumm/Solo und Notenspurauswahl. Außerhalb der analysierten Passage läuft das Original.

MIDI und Guitar Pro (einschließlich GP5) haben einen eigenen Notenplayer. Seine Wiedergabe funktioniert unabhängig von der Aufnahme. Zum Synchronisieren in beiden Playern eine Passage wählen, verknüpfen und „Aufnahme folgen“ aktivieren. Notendatei, gewählte Notenspur, Notenpassage und Synchronisationszuordnung werden mit dem gespeicherten Aufnahme-Loop abgelegt. Nach dem Laden „Aufnahme folgen“ zum Aktivieren wählen.

alphaTab zeigt eine **einzelne horizontal scrollende Zeile** mit Wiedergabecursor. Für Guitar Pro zwischen Originaltabulatur und Noten umschalten; eine einzelne Spur wählen. Guitar-Pro-Saiten/Bünde, Stimmung, Kapodaster, Wiederholungen und Tempowechsel bleiben erhalten. Nicht zuordenbare Wiedergabeeffekte werden als fehlende Position gemeldet.

MIDI-Notation ist auf 1/16 bei Anfangstempo vereinfacht und auf 256 Takte begrenzt. Die Wiedergabe und Instrumentanzeigen verwenden die tatsächlichen MIDI-Zeiten. Der einfache Syntheseklang bildet keine Soundfonts oder Spieltechniken nach. Griffvorschläge sind keine Garantie für die Originalspielweise. Der Piano-Waterfall zeigt ausschließlich tatsächliche Tonhöhen und Oktaven der gewählten Spur mit fünf Sekunden Vorschau. H bezeichnet das internationale B.

Analysen liegen zunächst im lokalen App-Cache. Gespeicherte Loops behalten Notendaten, MIDI-/GP-Datei und die zugehörigen Audiospuren dauerhaft im App-Datenordner (`loop-materials/` und `loop-audio/`). Die Loop-Liste enthält nur Verweise auf diese Daten. Analyseergebnisse werden auch zugeordnet, wenn der Loop bereits vor der Analyse gespeichert wurde. Ältere native Analysen ohne Zuordnung werden bei passenden Standardoptionen aus dem vorhandenen Cache übernommen. Datei nach Neustart erneut öffnen und den Loop auswählen. Fehlende oder beschädigte Notendaten werden gemeldet und nicht automatisch überschrieben. Erkannte Spuren und Noten sind Schätzungen und können Fehler enthalten.

## Entwicklung und Tests

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path native-analysis/Cargo.toml --locked
```

Der native Pipeline-Test erzeugt eine eigene kurze Gitarrenaufnahme, schneidet eine Passage aus und prüft alle sechs WAV-Dateien sowie die zeitlichen Notengrenzen. Er benötigt die eingerichtete Laufzeit:

```powershell
$env:LOOPSTUDIO_TEST_RUNTIME = 'C:/Pfad/LoopStudio-runtime'
$env:LOOPSTUDIO_TEST_DEVICE = 'cpu' # oder openvino
$env:LOOPSTUDIO_TEST_TRANSCRIBER = 'basic-pitch' # oder muscriptor-small
cargo test --manifest-path native-analysis/Cargo.toml --test pipeline -- --ignored --nocapture
```

Der Griffmodell-Test lässt sich separat aktivieren: `cargo test --manifest-path src-tauri/Cargo.toml native_model_assigns -- --ignored`.

## Quellen und Modellstände

- [Demucs](https://github.com/facebookresearch/demucs), MIT. [Sechs-Spur-ONNX-Export](https://huggingface.co/StemSplitio/htdemucs-6s-onnx), Revision `49df9b6989cf2150840ea65b0bef77a2e471b678`, SHA-256 `48f8e84945579f8ab340e083339e9221e03785dbE733a52c388200b6d3ca779a`.
- [basic-pitch-rs](https://github.com/AThevon/basic-pitch-rs), Apache-2.0, mit dem offiziellen Spotify-Modell und Rust-Nachverarbeitung.
- [MuScriptor](https://github.com/muscriptor/muscriptor), MIT-Code; getrennte Modelllizenz CC BY-NC 4.0. Gepinnte Revisionen stehen in `native-analysis/src/muscriptor/mod.rs`.
- [tab-labeler v3](https://huggingface.co/cstr/tab-labeler-onnx): cstr, CC BY 4.0, GuitarSet + EGSet12. Datei `tab-labeler-v3-egset.onnx`, Revision `434976baacaf194d99f09c3c784682766bedcf97`, SHA-256 `93114786c6f4781e7a0b69abd7e93a0d4966873f8e54908f97a1de8e8cf788af`.
- [ONNX Runtime](https://github.com/microsoft/onnxruntime), MIT; [OpenVINO](https://github.com/openvinotoolkit/openvino), Apache-2.0; [FFmpeg-Build](https://www.gyan.dev/ffmpeg/builds/), enthält GPL-Komponenten.
- [alphaTab](https://github.com/CoderLine/alphaTab), MPL-2.0. Bravura-Schriften samt OFL-Hinweisen unter `public/fonts/`.
- [RapidOCR / PP-OCRv4](https://github.com/RapidAI/RapidOCR), Apache-2.0, Modell aus `rapidocr-onnxruntime==1.4.4`. Es werden nur ONNX-Gewichte übernommen.
- [PDFium-Builds](https://github.com/bblanchon/pdfium-binaries), Chromium-Build 8138; Lizenzhinweise werden zusammen mit der DLL eingerichtet.
- [Guitar Tab OMR](https://huggingface.co/kk9293/guitar-tab-omr), Modellrevision `cf0aa64313e981e3c4337e322df6540958a55e1d`; Modelllizenz „other“. Die ONNX-Dateien entstehen ausschließlich durch den verifizierten lokalen Export.
