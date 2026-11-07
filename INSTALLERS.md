# LoopStudio-Installer

Es gibt zwei Varianten für Windows x64 und Linux x64:

| Variante | Inhalt |
| --- | --- |
| Light | Anwendung, FFmpeg, private Python-Laufzeit, ursprüngliche PDF/OCR-Werkzeuge und Bibliotheken. Die großen Standardmodelle werden bei Bedarf nachgeladen. |
| Offline | Zusätzlich Demucs `htdemucs_6s`, Guitar Tab OMR und das Tab-Labeler-Modell. |

MuScriptor-Modelle sind in beiden Varianten ein separater, optionaler Download. Guitar Pro wird nicht mitgeliefert. Unter Linux benötigt die Guitar-Pro-Anbindung eine vorhandene Wine-Installation und Guitar Pro.

## Installation

Windows: die jeweilige `Setup.exe` starten. Die Installation erfolgt für den aktuellen Benutzer. Die mitgelieferte Python-Laufzeit ist privat; eine systemweite Python-Installation ist nicht nötig.

Linux: Das Debian-Paket richtet die Anwendung samt Desktop-Eintrag ein. Auf Ubuntu 24.04 beispielsweise `sudo apt install ./LoopStudio_0.8.0_amd64.deb` verwenden. Alternativ das AppImage ausführbar machen und starten (`chmod +x LoopStudio*.AppImage`). AppImages benötigen FUSE 2 oder können mit `--appimage-extract-and-run` gestartet werden. Die Pakete werden auf Ubuntu 24.04 gebaut; ältere Distributionen sind nicht zugesichert.

Bei Light in den globalen Einstellungen **Standardmodelle einrichten** wählen und die Anwendung anschließend neu starten. Das lädt ungefähr 450 MB. Offline enthält diese Modelle bereits. Unter Linux liegen nachgeladene Modelle im beschreibbaren Anwendungsdatenverzeichnis; die Ressourcen des Installationspakets werden darüber eingebunden.

Die Installer sind nicht mit einem Herausgeberzertifikat signiert. Prüfsummen befinden sich neben den Paketen in `SHA256SUMS.txt`.

## Reproduzierbarer Build

Voraussetzungen: Node.js 22, Rust stable, Python 3.12 oder neuer zum Vorbereiten der Pakete; unter Windows zusätzlich die MSVC-Buildwerkzeuge. Die Laufzeitversionen und Downloads sind in `scripts/prepare-installer.py` festgelegt und mit SHA-256 geprüft.

PowerShell unter Windows:

```powershell
npm ci
$env:CARGO_TARGET_DIR = Join-Path $PWD 'src-tauri/target'
cargo build --manifest-path native-analysis/Cargo.toml --release --locked
cargo build --manifest-path native-tab-tools/Cargo.toml --release --locked
python scripts/prepare-installer.py
npm run tauri build -- --config .installer/tauri-light.json --features python-tab-tools -- --locked
# Ausgabe vor dem nächsten Build separat sichern.
python scripts/prepare-installer.py --models
npm run tauri build -- --config .installer/tauri-offline.json --features python-tab-tools -- --locked
```

Die Windows-Ausgabe liegt in `src-tauri/target/release/bundle/nsis/`. Beide Builds verwenden denselben Ausgabedateinamen.

Linux: Den Workflow **Build installers** unter GitHub Actions manuell starten. Er erstellt Light und Offline jeweils als `.deb` und `.AppImage`, testet die private Python-Laufzeit und den ursprünglichen PDF/OCR-Konverter und lädt alle Pakete mit Prüfsummen als Workflow-Artefakt hoch. Die genaue Systempaketliste steht in `.github/workflows/installers.yml`.

Die Installer verwenden das Cargo-Feature `python-tab-tools`, damit der ursprüngliche PDF/OCR-Konverter erhalten bleibt. Native Rust-Hilfsprogramme sind ebenfalls enthalten. Der Paketbau prüft Imports und einen tatsächlichen OCR-Durchlauf; diese Prüfungen ersetzen keinen Installationstest auf einem frischen Zielsystem.
