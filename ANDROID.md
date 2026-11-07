# Android-Prüfung und Vorschau

Stand: 7. November 2026. Eine Android-Version lässt sich mit dem vorhandenen Tauri-/Rust-Kern bauen. Es wurden APKs für ARM64 (`aarch64`, typische aktuelle Telefone) und x86_64 (Emulator) erzeugt. Diese Dateien sind ausdrücklich eine **Android-Vorschau**, kein Ersatz für die vollständige Desktop-Anwendung.

Die Vorschau hat die separate Anwendungs-ID `local.loopstudio.preview` und Versionsbezeichnung `0.8.1-preview.1`. Sie verwendet einen Debug-Schlüssel. Für eine reguläre Veröffentlichung wären ein verwalteter Release-Schlüssel, weitere Geräteprüfungen und die folgenden Portierungsarbeiten nötig.

## Tatsächlich auf diesem Rechner geprüft

Android-16-Emulator, x86_64, Google-APIs-Systemimage, WHPX-Hardwarebeschleunigung. Kein physisches Android-Gerät war über ADB verbunden; die ARM64-Datei wurde gebaut, nicht auf einem echten ARM64-Telefon ausgeführt.

Der Test `scripts/smoke-android.mjs` prüft in der installierten App:

- Start und sichtbare Vorschaukennzeichnung bei 412 CSS-Pixeln ohne horizontalen Seitenüberlauf.
- Demo laden, Notenansicht aufbauen und Audiowiedergabe mit fortschreitender Medienzeit.
- Eine erzeugte WAV-Datei über den Dateiinput importieren und abspielen.
- A/B-Marken bei 0,2 und 1,5 Sekunden setzen und die tatsächliche Wiederholung prüfen.
- Einen Loop speichern und über den nativen Befehl aus den gespeicherten Sessions zurücklesen.
- Eine erzeugte MIDI-Datei importieren, nach GP7 übertragen und die Note E4 anzeigen.

Die Dateitests verwenden DevTools zum Setzen des Dateiinputs und ausschließlich erzeugte Dateien im privaten Testverzeichnis der Vorschau. Der vollständige Ablauf durch verschiedene Android-Dokumentanbieter und Cloud-Dateiauswahlen ist damit noch nicht nachgewiesen. Hintergrundwiedergabe, Energiesparverhalten, Telefonunterbrechungen, ältere Android-Versionen und reale ARM64-Geräte sind ebenfalls nicht geprüft.

## Noch nicht portierte Funktionen

| Bereich | Aktueller Stand und nötige Arbeit |
| --- | --- |
| Demucs, Basic Pitch, MuScriptor, Rhythmusanalyse | Die Desktop-App startet externe Programme und benutzt Desktop-Laufzeitbibliotheken. Für Android sind passende NDK-Bibliotheken und eine mobile Ausführung innerhalb der App sowie Speicher-/Leistungstests nötig. |
| PDF/OCR und Guitar Tab OMR | Die Desktop-Python-Laufzeit wird nicht in das APK gepackt. Der bisherige Python-Konverter und seine Bibliotheken können nicht unverändert übernommen werden. Eine Android-Laufzeit oder eine nachgewiesen gleichwertige native/ONNX-Pipeline müsste eigens integriert werden. |
| Automatische Griffzuordnung | Die passende Android-ONNX-Laufzeit ist noch nicht eingebunden. MIDI-Tonhöhen bleiben als Noten erhalten; fehlende Griffzuordnungen werden angezeigt. |
| Projektordner und externe Dateien | Android liefert über seine Dateiauswahl Content-URIs. Projektimport/-export benötigt eine Behandlung über den Storage Access Framework statt normaler Desktop-Dateipfade. Die Vorschau sperrt Projektaktionen. |
| Externer Guitar-Pro-Editor | Die Desktop-Integration startet Guitar Pro beziehungsweise Wine. Android benötigt eine eigene Intent-/Dokumentübergabe und ein abgestimmtes Verfahren für den Rückimport. |
| Benutzeroberfläche | Grundansicht und Wiedergabe funktionieren. Eine vollständige Prüfung von Touch-Bedienung, Tablets, Tastatur, Drehung und allen Notenbearbeitungsfunktionen steht aus. |

Die Desktop-Werkzeuge sind in der Android-Vorschau gesperrt; sie bleiben auf Windows und Linux verfügbar. Ein Hinweis in der App nennt die Einschränkungen. Die Android-Prüfung ersetzt keine der vorhandenen Desktop-Versionen.

## Nachbauen unter Windows

Benötigt werden Node.js 22+, Rust mit Android-Targets, Java 17+, Android SDK Platform 37/37.0, Build Tools, NDK `28.2.13676358` und für Tests ein Emulator mit Systemimage. Die auf diesem Rechner installierten Werkzeuge liegen isoliert unter `.installer/android/`; die vorhandene Java-Installation und Windows Developer Mode wurden nicht verändert.

```powershell
npm ci
./scripts/build-android-preview.ps1
# Alternativ vorhandene SDK-/JDK-Verzeichnisse angeben:
./scripts/build-android-preview.ps1 -SdkPath C:/Android/Sdk -JavaPath C:/Java/jdk-17
```

Ausgabe: `installers/android-preview/`, einschließlich SHA-256-Prüfsummen. Das Android-Projekt in `src-tauri/gen/android` wird erzeugt und nicht ins Repository aufgenommen. Wer die Anwendungs-ID ändert, muss ein bestehendes generiertes Android-Projekt vorher separat sichern und neu erzeugen.

Auf diesem Windows-System kann der offizielle Tauri-Build keine Symlinks anlegen. Das Skript lässt den Rust-Build laufen, prüft auf genau diesen Fehler, kopiert danach die fertige Bibliothek nach `jniLibs` und führt die passende Gradle-Aufgabe aus. Die bereits erledigte Rust-Aufgabe wird dabei übersprungen. Andere Buildfehler werden nicht übergangen. Debug-Symbole werden nur aus der kopierten APK-Bibliothek entfernt.

Beispieltest auf dem Emulator:

```powershell
.installer/android/sdk/platform-tools/adb.exe -s emulator-5554 install -r installers/android-preview/LoopStudio-0.8.1-Android-x86_64-Preview.apk
node scripts/smoke-android.mjs --adb .installer/android/sdk/platform-tools/adb.exe --serial emulator-5554 --output .installer/evidence/android
```

Das Skript erstellt Testdateien und Loops ausschließlich in der angegebenen Vorschau-App. Für weitere Entwicklung sind die AVD `LoopStudio-Test` und die SDK-Werkzeuge vorhanden. Die Linux-Pakettests liegen in den separaten WSL-Distributionen `LoopStudio-Packaging` und `LoopStudio-DebTest`.

## Primärquellen

- [Tauri: Android-Voraussetzungen](https://v2.tauri.app/start/prerequisites/#android).
- [Tauri: mobiler Bibliothekseinstieg](https://docs.rs/tauri-macros/latest/tauri_macros/attr.mobile_entry_point.html).
- [Tauri: Android-Dateiauswahl liefert Content-URIs](https://v2.tauri.app/plugin/dialog/).
- [Android: Einschränkungen für ausführbare Dateien im beschreibbaren App-Verzeichnis](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission).
