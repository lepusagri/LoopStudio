# LoopStudio-Installer

Es gibt zwei Varianten für Windows x64 und Linux x64:

| Variante | Inhalt |
| --- | --- |
| Light | Anwendung und ursprüngliche PDF/OCR-Werkzeuge. Die großen Standardmodelle werden bei Bedarf nachgeladen. Windows und AppImage enthalten die portable Laufzeit; DEB verwendet ab 0.8.1 Systempakete. |
| Offline | Zusätzlich Demucs `htdemucs_6s`, Guitar Tab OMR und das Tab-Labeler-Modell. |

MuScriptor-Modelle sind in beiden Varianten ein separater, optionaler Download. Guitar Pro wird nicht mitgeliefert. Unter Linux benötigt die Guitar-Pro-Anbindung eine vorhandene Wine-Installation und Guitar Pro.

## Installation

Windows: die jeweilige `Setup.exe` starten. Die Installation erfolgt für den aktuellen Benutzer. Die mitgelieferte Python-Laufzeit ist privat; eine systemweite Python-Installation ist nicht nötig.

Linux: Das Debian-Paket richtet die Anwendung samt Desktop-Eintrag ein. Auf Ubuntu 24.04 beispielsweise `sudo apt install ./LoopStudio-0.8.1-Linux-x64-Light.deb` verwenden. Alternativ das AppImage ausführbar machen und starten (`chmod +x LoopStudio*.AppImage`). AppImages benötigen FUSE 2 oder können mit `--appimage-extract-and-run` gestartet werden. Die Pakete werden auf Ubuntu 24.04 gebaut; andere Python-Versionen und ältere Distributionen sind nicht zugesichert.

Ab 0.8.1 verwendet das DEB `/usr/bin/python3` (3.12), NumPy, Pillow, OpenCV, YAML, Shapely, Pyclipper, weitere kompatible Python-Bibliotheken und FFmpeg aus Ubuntu-Paketen. `apt` installiert diese Abhängigkeiten automatisch. Es gibt keinen Pip-Aufruf oder Netzwerk-Download in einem Paket-Installationsskript. Die passenden PyTorch-/Torchvision-Versionen und nicht im Noble-Archiv verfügbare OCR-Bibliotheken bleiben privat in der Anwendung. Die ursprünglichen OCR-/OMR-Verfahren werden weiter verwendet.

Die neue Light-DEB-Datei ist etwa 316 MiB groß (bisher 679 MiB), Offline etwa 657 MiB (bisher 1.021 MiB). Auf der frischen Ubuntu-Testinstallation lud apt zusätzlich rund 256 MB Systempakete. Ein kleineres DEB bedeutet daher nicht, dass diese Bibliotheken auf einem frischen Rechner keinen Platz benötigen. Auf bestehenden Systemen werden bereits installierte Pakete gemeinsam genutzt.

**Offline bezeichnet die enthaltenen Modelle.** Für die Erstinstallation des DEBs müssen auch seine apt-Abhängigkeiten verfügbar sein, über Internet, einen lokalen Paketspiegel oder einen Paketcache. Nach ihrer Installation liefen OMR und Audioanalyse im Test mit gesperrten Download-Proxys. Das AppImage behält seine portable Laufzeit.

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

Linux: Den Workflow **Build installers** unter GitHub Actions manuell starten. Er erstellt portable AppImages und separat DEBs mit apt-Abhängigkeiten, jeweils als Light und Offline. Die genaue Systempaketliste steht in `.github/workflows/installers.yml` und `scripts/prepare-debian.py`.

Nach `python scripts/prepare-installer.py` baut `tauri-light.json` unter Linux nur das AppImage. Für das DEB anschließend `python scripts/prepare-debian.py` und `npm run tauri build -- --config .installer/debian/tauri-deb-light.json -- --locked` ausführen. Für die Modellvariante erst `prepare-installer.py --models`, danach `prepare-debian.py --models` und die entsprechende `tauri-deb-offline.json` verwenden. Auf dem Build-System müssen die in `DEPENDS` genannten Python-Module für `/usr/bin/python3` installiert sein; der Staging-Test prüft ihre Herkunft aus `/usr/lib/python3/dist-packages`.

Die Installation von Light und Offline wurde lokal in einer frischen Ubuntu-24.04-WSL-Umgebung mit apt getestet. Die installierte Anwendung wurde zusätzlich als normaler Benutzer über WebDriver geprüft: Startseite, Demo, PDF/OCR und Offline-OMR. Weitere Integrationstests prüften CPU-Audioanalyse und native Griffzuordnung. Android-Build und verbleibende Portierungsarbeiten sind in `ANDROID.md` beschrieben.

Die Installer verwenden das Cargo-Feature `python-tab-tools`, damit der ursprüngliche PDF/OCR-Konverter erhalten bleibt. Native Rust-Hilfsprogramme sind ebenfalls enthalten. Der Paketbau prüft Imports und einen tatsächlichen OCR-Durchlauf; diese Prüfungen ersetzen keinen Installationstest auf einem frischen Zielsystem.
