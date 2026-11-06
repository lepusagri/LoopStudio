# LoopStudio 0.7.2

Lokales Musikstudio für Audio/Video, A/B-Loops, Instrumentenspuren und Noten. Desktop-App mit Rust/Tauri; React und alphaTab für die Bedienoberfläche.

Die Griffberechnung verwendet seit 0.5.1 eine gemeinsame ONNX-Umgebung pro App-Prozess und speichert berechnete Positionen im lokalen Cache. Regressionstests führen mehrere echte Modellaufrufe in demselben Prozess aus.

Version 0.7.2 behebt das Schließen des Fensters nach dem Speichern und lädt die Medienmetadaten beim erneuten Öffnen desselben Projekts neu. Das Löschen des ausgewählten oder letzten Loops deaktiviert die A/B-Wiederholung, ohne Aufnahme oder Noten zu löschen.

## Wellenform und A/B-Markierungen

Die bestehende Wellenform wird nun auch für Videos, über die native Dateiauswahl und beim Öffnen eines Projekts berechnet. Zuvor rief nur der Audio-Import per Drag & Drop den vorhandenen Web-Audio-Decoder auf. Anzeige und Normalisierung bleiben erhalten. Die bisherige Grenze von 200 MB und die vom WebView unterstützten Audioformate gelten weiterhin; ein Fehler wird in der Zeitleiste angezeigt. Beim Wechsel der Aufnahme werden alte Lesevorgänge abgebrochen, damit die Wellenform der vorherigen Datei nicht nachträglich die neue überschreibt.

A und B lassen sich an ihren beschrifteten Griffen in der Wellenform mit Maus oder Touch ziehen. Die Auswahl erscheint als Vorschau und wird beim Loslassen übernommen; ein Abbruch verwirft die Vorschau. Die Grenzen bleiben innerhalb der Aufnahme und mindestens 0,1 Sekunden auseinander. Mit fokussiertem Griff verschieben Pfeiltasten um 0,1 Sekunden, mit Umschalt um 1 Sekunde. Die geänderte Auswahl bleibt im Projekt erhalten. Bereits benannte Loops behalten ihre gespeicherten Grenzen; „Speichern“ legt die neue Passage als Loop ab.

## Übungsprojekte

Beim Start erscheint die Projektübersicht. „Neues Projekt“ legt einen benannten Projektordner mit einer Kopie der gewählten Audio-/Videodatei an. „Projekt öffnen“ öffnet eine `.loopstudio`-Datei, „Zuletzt verwendet“ öffnet bekannte Projekte direkt. Der Projektordner ist frei wählbar; Vorgabe ist `Dokumente/LoopStudio/Projekte`.

```text
Mein Übungsprojekt/
  project.loopstudio      # Projektname, Loop-Liste, Tempo und letzter Arbeitsstand
  media/                 # Kopie der Aufnahme
  materials/             # Gespeicherte Noten und bearbeitete Loop-Fassungen
  assets/audio/          # Aufbewahrte Demucs-Instrumentenspuren
  assets/notation/       # Originale importierte MIDI-/Guitar-Pro-Dateien
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

Für diese beiden zusätzlichen Werkzeuge wird eine **getrennte Python-3.12-Laufzeit** verwendet. Rust verwaltet Auswahl, FFmpeg-Ausschnitte, Aufträge, Abbruch und Exporte; die Original-OCR/OMR-Implementierungen laufen lokal im eigenen Prozess. Die native Rust-Audioanalyse bleibt davon unabhängig. Nach dem einmaligen Download werden die Eingabedateien nicht hochgeladen.

```powershell
./setup-tab-tools.ps1
# Nur PDF-to-GP5, ohne PyTorch/OMR:
./setup-tab-tools.ps1 -SkipOmr
# Eigener Ort / vorhandenes Python 3.12:
./setup-tab-tools.ps1 -Runtime C:/Pfad/LoopStudio-tools-runtime -Python C:/Pfad/python.exe
```

Der Ordner `LoopStudio-tools-runtime` gehört neben die EXE. Alternativ `LOOPSTUDIO_TOOLS_RUNTIME` auf ihn setzen. App nach der Installation neu starten. Python-Installation nur zum Anlegen der Umgebung nötig; sie wird als venv referenziert und darf anschließend nicht entfernt werden. Modell und Inferenzskripte werden anhand festgelegter Revisionen und SHA-256-Prüfsummen geladen. OMR-Gewichte ca. 194 MB, zusätzlich PyTorch-CPU-Pakete. Auftragslimit fünf Minuten; Abbruch beendet den Werkzeugprozess.

Praxistest mit einem lokalen 1080p-Video, Standbild bei 30 s, drei vollständige Takte: PDF-to-GP5 lieferte 3 Takte mit 48 Tab-Einträgen (42 klingende und 6 Dead Notes); Saiten/Bünde und grundlegende Rhythmuswerte stimmten beim Gegenlesen des Ausschnitts. Guitar Tab OMR lieferte 43 Einträge in 4 Takten, mit falschen Bünden, fehlenden/zusätzlichen Noten und falschen Taktgrenzen. Das ist ein einzelner Test, keine allgemeine Genauigkeitsmessung. Bindebögen/Spieltechniken weiter prüfen.

Die Token-zu-GP5-Prüfungen lassen sich mit der Werkzeug-Laufzeit ausführen:

```powershell
../LoopStudio-tools-runtime/Scripts/python.exe -m unittest discover -s tooling -p 'test_*.py'
```

## Native Analyse

Die Audio-/Videoanalyse im Übungsraum benötigt **keinen Python-Prozess und keine Python-Installation**. `native-analysis/` übernimmt das bewährte Rust-Backend aus dem lokalen AutoTab-Rust-Projekt:

- **Demucs htdemucs_6s ONNX:** sechs Stereo-Spuren (Schlagzeug, Bass, Rest, Gesang, Gitarre, Piano), mit gemeinsamem Pegel und überlappenden Analysefenstern.
- **Notenerkennung:** Basic Pitch oder MuScriptor Small/Medium/Large. MuScriptor wird je tonaler Instrumentenspur angewendet, mit Instrumentvorgabe für Gitarre/Piano/Bass und automatischer Erkennung für Rest/Gesang. Schlagzeug erhält keine Tonhöhenanzeige.
- **Gerät:** CPU oder Intel-GPU über OpenVINO; Automatik bevorzugt die installierte OpenVINO-GPU-Umgebung. Falls keine geeignete Intel-GPU vorhanden ist, CPU wählen. Basic Pitch bleibt auf der CPU. MuScriptor nutzt auch für CPU-Betrieb die OpenVINO-Bibliotheken.
- **Griffsuche:** trainierter tab-labeler v3 plus begrenzte Griffsuche aus AutoTab-Rust. Standardstimmung, Bünde 0–19, eine Position pro Note. Belegte Saiten, Lagenwechsel und Griffweite werden berücksichtigt; zusätzliche Gitarrenstimmen sind getrennt auswählbar. Maximal 20.000 Noten pro Griffberechnung.

Die gewählte A/B-Passage muss 0,1–180 Sekunden lang sein. Für den Einstieg 10–30 Sekunden wählen. Bei MuScriptor werden bis zu fünf tonale Spuren analysiert; das kann insbesondere mit großen Modellen dauern. Fehler der gewählten Erkennung werden angezeigt; es gibt keinen stillen Wechsel auf ein anderes Modell.

Fortschritt, Abbruch und Ergebnis-Cache werden von Rust verwaltet. Cache-Schlüssel berücksichtigen Passage, Quelldatei, Modellwahl, Gerät, lokale Modellmetadaten und Analyseprogramm. Abbruch beendet auch FFmpeg-Unterprozesse. Erst ein vollständiges Ergebnis wird veröffentlicht. Die Ausgabe nennt das tatsächlich verwendete Modell und Gerät.

## Starten und einrichten

Die fertige App `LoopStudio-0.7.2.exe` benötigt den danebenliegenden Ordner `LoopStudio-runtime`. Die ältere Python-Umgebung kann daneben bestehen bleiben, wird von Version 0.5 aber nicht mehr verwendet.

Im Source-Verzeichnis:

```powershell
npm ci
./build-local.ps1
./setup-analysis.ps1
```

Voraussetzungen zum Bauen: Node.js, Rust ab 1.92 und die Windows-C++-Buildtools samt Windows SDK. Zum Starten wird WebView2 benötigt. `build-local.ps1` baut die App und `loopstudio-analysis.exe`. Der Analyseprozess wird in die Laufzeitumgebung kopiert.

`setup-analysis.ps1` lädt die überprüften nativen ONNX-/OpenVINO-Bibliotheken und das Demucs-Modell. Es installiert kein Python. `-CpuOnly` überspringt OpenVINO und unterstützt dadurch Basic Pitch, aber kein MuScriptor. Mit `-Runtime <Ordner>` lässt sich ein eigener Laufzeitordner wählen; die App findet ihn über `LOOPSTUDIO_RUNTIME`. `-AutoTabHome <Ordner>` kann vorhandene `runtime/`- und `models/`-Dateien übernehmen; die bekannten Demucs-/Runtime-Downloads werden anschließend geprüft. Ein expliziter Worker lässt sich mit `-Worker <exe>` angeben.

Laufzeitstruktur:

```text
LoopStudio-0.7.2.exe
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
