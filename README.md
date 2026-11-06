# Neu in Version 0.4

- **Guitar Pro:** Originalsaite und Bund statt aller möglichen Tonpositionen; Stimmung, Kapodaster, hohe Bünde, Wiederholungen und Tempowechsel bleiben erhalten. Nicht eindeutig zuordenbare Wiedergabeeffekte werden als fehlende Position gemeldet; es wird keine Ersatzposition erfunden.
- **MIDI und erkannte Noten:** Native Rust-Inferenz mit dem bereits in AutoTab-Rust verwendeten trainierten **tab-labeler v3** und dessen begrenzter Griffsuche. Eine Position pro Note, Berücksichtigung ausklingender Saiten, Lagenwechsel und Griffweite. Für das Griffbrett eine einzelne Notenspur wählen.
- **Zusatzstimmen:** Mehrstimmige Passagen, die eine Gitarre überfordern, erhalten getrennt auswählbare Gitarrenstimmen. Nicht spielbare Noten bleiben hörbar und im Piano sichtbar.
- **Piano:** Originaltonhöhe und Oktave der ausgewählten Spur, keine alternativen Tonpositionen.

Die KI-Griffberechnung läuft in der Desktop-App, benötigt die vorhandene `LoopStudio-runtime` (ONNX Runtime aus `setup-analysis.ps1`) und lädt beim ersten Aufruf nur die Modellgewichte (~1,3 MB). Nach dem Download arbeitet sie lokal; es werden keine Noten hochgeladen. Ein Fehler wird angezeigt und kann erneut versucht werden. Kein stiller Wechsel auf eine rein regelbasierte Zuordnung. Modellberechnung derzeit bis 20.000 Noten pro Spur, Standardstimmung, Bünde 0–19. Griffvorschläge sind keine Garantie für die Originalspielweise.

Modell: [cstr/tab-labeler-onnx](https://huggingface.co/cstr/tab-labeler-onnx), `tab-labeler-v3-egset.onnx`, **CC BY 4.0**, trainiert auf GuitarSet und EGSet12. Revision `434976baacaf194d99f09c3c784682766bedcf97`; SHA-256 `93114786c6f4781e7a0b69abd7e93a0d4966873f8e54908f97a1de8e8cf788af`. Inferenz und Griffsuche wurden aus dem lokalen AutoTab-Rust-Projekt übernommen und an den Notenplayer angepasst. Modellgewichte liegen im lokalen App-Cache und gehören nicht zum Git-Repository.

Validierung: `npm test`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`. Der optionale echte Modelltest benötigt `LOOPSTUDIO_TEST_RUNTIME` mit dem absoluten Pfad zur Analyseumgebung: `cargo test --manifest-path src-tauri/Cargo.toml native_model_assigns -- --ignored`.

# Neu in Version 0.3

MIDI und Guitar Pro laden einen unabhängigen Notenplayer und ersetzen die Aufnahme nicht mehr. Eigene Wiedergabe, Position, Tempo, Lautstärke, Loop und hörbare Spurauswahl; einfacher mehrstimmiger Syntheseklang ohne Fünf-Minuten-Grenze. Die Notenpassage lässt sich über Anfang/Ende mit A/B der Aufnahme verknüpfen. „Aufnahme folgen“ übernimmt anschließend deren Position, Tempo, Pause und Loop. Die Zuordnung gilt für die laufende Sitzung und wird beim Wechsel der Aufnahme gelöst.

alphaTab zeigt originale Guitar-Pro-Noten und Tabulaturen. MIDI hat eine vereinfachte Notenansicht mit 1/16-Quantisierung bei Anfangstempo (maximal 256 Takte), keine Originaltabulatur. Die Wiedergabe verwendet weiterhin die echten MIDI-Zeiten inklusive Tempoänderungen. Das Notenblatt ist derzeit statisch; Griffbrett und Waterfall folgen der Wiedergabe. Die Synthese bildet keine instrumentenspezifischen Soundfonts, Bendings oder Effekte ab.

Browserprüfung: GP5-Noten und TAB sichtbar, MIDI-Noten sichtbar, unabhängige Wiedergabe bei pausierter Aufnahme, Verknüpfung unterschiedlich langer Passagen und Loop-Sprung geprüft. Die benötigte Bravura-Schrift inklusive Lizenz liegt lokal unter public/fonts.

Die folgenden Angaben beschreiben zusätzlich den Stand 0.2; dessen Einschränkungen zur eigenständigen MIDI-Wiedergabe werden durch 0.3 ersetzt.

# LoopStudio 0.2

Lokale Musikübungs-App für Windows mit Rust/Tauri, React und einem lokalen Python-Analyseprozess.

## Start

`../LoopStudio-0.2.exe` öffnen. Die bisherige `LoopStudio.exe` ist Version 0.1. Die neue Version benötigt den danebenliegenden Ordner `LoopStudio-runtime` für die Audioanalyse. Auf diesem Rechner sind die Umgebung und Modelle bereits eingerichtet. WebView2 ist vorhanden.

Die Analyseumgebung ist eine lokale Python-3.12-Umgebung und verweist auf die Python-Installation dieses Rechners. Sie ist kein portables Paket für andere Rechner. Für einen anderen Rechner Python 3.12 (64 Bit) installieren und `setup-analysis.ps1 -Python <Pfad-zur-python.exe>` ausführen. Die Ersteinrichtung lädt öffentliche Pakete und Modelle; danach wird lokal gerechnet. Kein Upload von Musik.

## Passage in Spuren und Noten umwandeln

1. Eine Audio- oder Videodatei über **Datei öffnen** auswählen. Alternativ ins Fenster ziehen.
2. Den Anfang mit **A**, das Ende mit **B** setzen. Die Analyse verarbeitet genau diesen Ausschnitt, maximal drei Minuten. Für den Einstieg 10–30 Sekunden wählen.
3. **Passage analysieren** anklicken. Demucs erzeugt sechs Spuren: Gitarre, Piano, Bass, Schlagzeug, Gesang und weitere Instrumente. Basic Pitch erzeugt Noten für die Tonspuren. Fortschritt und Abbruch sind sichtbar.
4. Ein Instrument im **Spurmixer** anklicken. Seine Noten erscheinen im Griffbrett oder Piano Waterfall. Die Analyse setzt den Notenstart automatisch auf den Anfang der Passage.
5. **Spuren hören** aktiviert den Mix. **M** schaltet stumm, **S** spielt solo. Mehrere Solo-Spuren sind möglich. Jeder Regler steuert die Lautstärke seiner Spur. **Original** wechselt zurück zur Aufnahme. Die Instrumentauswahl für die Anzeige verändert allein noch nicht den Klang.

Video/Originalplayer bleibt die gemeinsame Zeitbasis. Spuren folgen Play/Pause, Sprüngen, Loop und Tempo mit erhaltener Tonhöhe. Außerhalb der analysierten Passage wird der Originalton abgespielt. Die Medienelemente werden laufend synchronisiert; das ist kein samplegenauer DAW-Transport.

Gleiche Datei, Dateistand und Passage verwenden vorhandene Analyseergebnisse erneut. Nach Neustart die Originaldatei öffnen, den gespeicherten Loop auswählen und erneut auf Analyse klicken. Geänderte A/B-Grenzen ändern die bestehende Analyse nicht rückwirkend; ihre tatsächlichen Grenzen stehen im Mixer.

## MIDI und Guitar Pro

Über **MIDI / GP5 laden** oder Drag & Drop lassen sich MIDI sowie Guitar Pro 3–8 (GP3, GP4, GP5, GPX, GP) lesen. **Angezeigte Spur** steht oberhalb der Instrumentenansicht. Tracknamen, Wiederholungen und Tempoänderungen aus GP5 werden berücksichtigt. Die Anzeige verwendet klingende Tonhöhen. Schlagzeug wird beim Notendateiimport nicht als Tonspur angezeigt.

Mit **Notenstart in Aufnahme** die Notendatei zu einer vorhandenen Aufnahme ausrichten. Ein positiver Wert verschiebt die Noten nach hinten. Ohne eigene Aufnahme wird die Notendatei bis fünf Minuten mit einem einfachen Syntheseklang abgespielt. In diesem Modus hört man alle Tonspuren; die Trackauswahl steuert die Anzeige. Es ist kein Guitar-Pro-Soundfont-Player.

Das Griffbrett verwendet seit Version 0.4 die Originalpositionen aus Guitar Pro oder die KI-Griffzuordnung für eine einzelne MIDI-/Analysespur. H bezeichnet das internationale B. Der Piano Waterfall zeigt ausschließlich die vorhandenen Tonhöhen der ausgewählten Spur; sein Bereich erweitert sich bei Bedarf über C2–C7 hinaus.

## Weitere Funktionen

- Lokale Audio-/Videowiedergabe, A/B-Loops, benannte gespeicherte Passagen.
- Tempo 25–200 Prozent, erhaltende Tonhöhe, Lautstärke und Zeitsprünge.
- Rust speichert bis zu 100 Datei-Sessions mit maximal 500 Loops je Datei. Nach Neustart Originaldatei auf demselben Weg öffnen.
- Wellenform für Audiodateien bis 200 MB beim Drag-&-Drop-Import; native Dateiauswahl und Videos verwenden eine Zeitleiste.
- Tastatur: Leertaste Play/Pause, A/B Loop-Grenzen, L Loop an/aus, Pfeile fünf Sekunden springen. Gilt außerhalb von Formularfeldern und fokussierten Buttons.
- Browser-Vorschau mit lokalem Player und GP/MIDI-Import; Demucs benötigt die Desktop-App.

## Grenzen der Erkennung

Demucs `htdemucs_6s` trennt Instrumentklassen, keine einzelnen Gitarristen. Ein Stem kann Übersprechen oder Artefakte enthalten. Insbesondere die Piano-Trennung ist experimentell. Basic Pitch schätzt Anschläge, Tonhöhen und Dauern pro Stem. Leise Instrumente, Verzerrung, Bendings, Gesang und dichte Akkorde können falsche oder fehlende Noten erzeugen. Es gibt keine Garantie für eine vollständige Transkription. Schlagzeug hat absichtlich keine Klavier-/Griffbrettnoten. Fehlschläge einzelner Transkriptionen werden angezeigt; die getrennte Audiospur bleibt verwendbar.

Noch nicht enthalten: Akkord-/Beat-Erkennung, unabhängige Tonhöhenänderung, Notenschrift/Tabulatur, MIDI-Controller, YouTube-/Jellyfin-Anbindung. Medienformate hängen von WebView2 ab. MP3/WAV und MP4 mit H.264/AAC sind geeignete Startformate.

## Lokale Daten

- Sessions: `%APPDATA%/local.loopstudio.desktop/sessions.json`.
- Analysen: lokaler Tauri-App-Cache (unter Windows `%LOCALAPPDATA%/local.loopstudio.desktop/analysis`; bei Start aus einer paketierten Umgebung kann Windows diesen Pfad in deren LocalCache umleiten). Enthält Ausschnitt, sechs WAV-Spuren, erkannte MIDI-Dateien, Ergebnis-JSON und `analysis.log`.
- Dateien aus Drag & Drop/Demo werden für die Analyse in den lokalen `imports`-Cache kopiert; maximal 512 MB über diesen Weg. Größere Dateien über **Datei öffnen** auswählen.
- Native Originaldateien werden nicht verändert. Cachedateien können nach Schließen der App manuell entfernt werden; sie werden bei der nächsten Analyse neu erzeugt.
- Modelle und Python-Pakete: `../LoopStudio-runtime`. Diesen Ordner für die Analyse behalten.

## Entwicklung

Voraussetzungen: Node.js, Rust/MSVC, Visual Studio Build Tools, Windows SDK, WebView2. Für Analyse Python 3.12, CPU-PyTorch, Demucs, Basic Pitch/ONNX und FFmpeg. Es ist keine Grafikkarte erforderlich.

```powershell
npm ci
npm test
npm run build
./setup-analysis.ps1
./build-local.ps1
```

`build-local.ps1` verwendet die vorhandene lokale Rust-Toolchain in `../../work/toolchain`, sonst die systemweite Installation. Ergebnis ist `../LoopStudio-0.2.exe`. `npm run tauri dev` startet den Entwicklungsmodus.

Die ONNX-Ausführung von Basic Pitch braucht kein TensorFlow. Deshalb installiert das Setup seine Inferenzabhängigkeiten explizit und Basic Pitch mit `--no-deps`; dessen Metadaten würden sonst auf Python 3.12 TensorFlow verlangen. `pip check` meldet diese absichtliche Metadatenabweichung. Die verwendeten Paketversionen stehen in `engine/installed-versions.txt`, `package-lock.json` und `src-tauri/Cargo.lock`.

Wichtige Dateien: `src/AnalysisPanel.tsx` (Mixer/Synchronisation), `src/guitarPro.ts` (GP-Import), `src-tauri/src/analysis.rs` (Prozess, Abbruch, Cache), `engine/analyze.py` (Ausschnitt, Demucs, Noten), `src/Instrument.tsx` (Ansichten).

## Prüfungen

- Acht Frontend-Tests: bisheriger Player/MIDI-Kern, Stem-Grenzen und Solo/Stumm sowie echte selbst erzeugte GP5-Datei mit zwei Tracks, Wiederholung und Tempoänderung; beschädigte GP-Datei wird abgelehnt.
- Zwei Rust-Tests: Sessionvalidierung und Analysebereich.
- Echter lokaler Demucs-/Basic-Pitch-Durchlauf einer sechssekündigen WAV-Passage mit sechs Stem-Dateien und begrenzten Notenzeiten erfolgreich. Ein dreisekündiger WebM-Videoausschnitt ebenfalls erfolgreich.
- TypeScript und Produktionsbuild erfolgreich. Weitere manuelle Ergebnisse stehen in `QA.txt`.

## Referenzen und Lizenzen

Der Ablauf wurde mit der öffentlichen [FiveLoop-Vorschau](https://www.fiveloop.io/) abgeglichen. Dies ist eine eigenständige Implementierung; es werden keine FiveLoop-Assets oder Markenoberflächen eingebunden.

- [Demucs](https://github.com/facebookresearch/demucs): MIT, sechs Instrumentklassen.
- [Basic Pitch](https://github.com/spotify/basic-pitch): Apache 2.0, polyphone Notenerkennung mit ONNX.
- [alphaTab](https://github.com/CoderLine/alphaTab): MPL 2.0, Guitar-Pro-Import und Playback-Ereignisse; unverändert als Paket eingebunden.
- [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg): BSD-Python-Wrapper; das mitgelieferte FFmpeg hat eigene Lizenzbedingungen in seinem Paket. Vor Weiterverteilung der Laufzeit diese beachten.

Die Original-Lizenztexte der installierten Komponenten liegen in den jeweiligen npm-/Python-Paketen. Die Laufzeit wird hier lokal installiert, nicht als allgemein portables Installationspaket angeboten.
