"""Stage a self-contained x64 runtime and generate the Tauri installer config.

The original Python PDF converter is retained. Python is bundled privately and
does not change the machine's Python installation. --models adds standard models.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / ".installer"
RES = STAGE / "resources"
ANALYSIS = RES / "LoopStudio-runtime"
TOOLS = RES / "LoopStudio-tools-runtime"
CACHE = ROOT / ".runtime-downloads" / "installer"
WINDOWS = platform.system() == "Windows"
PYTHON = {
    True: ("x86_64-pc-windows-msvc", "1f2ab53880fc67ea323398c6388e05af28addc99a8e389209f08a51fdff4b149"),
    False: ("x86_64-unknown-linux-gnu", "ce4f6d0a6cfdb3bed6e44c2f9affd85943c76a42e25ad3a259002f31d6fb8a20"),
}

def download(url, destination, checksum):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and digest(destination) == checksum.lower():
        return destination
    part = destination.with_name(destination.name + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "LoopStudio-installer-build"})
    with urllib.request.urlopen(request, timeout=120) as response, part.open("wb") as target:
        shutil.copyfileobj(response, target)
    if digest(part) != checksum.lower():
        raise ValueError(f"SHA256 mismatch: {destination.name}")
    part.replace(destination)
    return destination

def digest(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()

def extract(archive, destination):
    destination.mkdir(parents=True, exist_ok=True)
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                if not (destination / member.filename).resolve().is_relative_to(destination.resolve()):
                    raise ValueError("Unsafe ZIP entry")
            source.extractall(destination)
    else:
        with tarfile.open(archive) as source:
            source.extractall(destination, filter="data")

def copy(source, destination):
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination, follow_symlinks=True)

def run(*args):
    subprocess.run([str(value) for value in args], check=True, cwd=ROOT)

def prepare(models):
    for directory in (CACHE, ANALYSIS / "runtime", ANALYSIS / "models", TOOLS / "runtime", TOOLS / "omr/scripts", TOOLS / "omr/model"):
        directory.mkdir(parents=True, exist_ok=True)
    target = Path(os.environ.get("CARGO_TARGET_DIR", ROOT / "src-tauri/target")) / "release"
    suffix = ".exe" if WINDOWS else ""
    copy(target / f"loopstudio-analysis{suffix}", ANALYSIS / f"loopstudio-analysis{suffix}")
    copy(target / f"loopstudio-tab-tools{suffix}", TOOLS / f"loopstudio-tab-tools{suffix}")
    triple, checksum = PYTHON[WINDOWS]
    archive = download(f"https://github.com/astral-sh/python-build-standalone/releases/download/20261026/cpython-3.12.16%2B20261026-{triple}-install_only_stripped.tar.gz", CACHE / "python.tar.gz", checksum)
    if not (TOOLS / "python").exists():
        extract(archive, TOOLS)
    python = TOOLS / ("python/python.exe" if WINDOWS else "python/bin/python3")
    marker = TOOLS / "python" / ".loopstudio-dependencies-v2"
    if not marker.exists():
        run(python, "-m", "pip", "install", "--disable-pip-version-check", "numpy==1.26.4", "Pillow==13.0.0", "pdfplumber==0.11.10", "PyGuitarPro==0.9.3", "onnxruntime==1.31.1", "opencv-python==4.11.0.86", "rapidocr-onnxruntime==1.4.4", "pyclipper==1.4.0", "Shapely==2.1.2", "PyYAML==6.0.3", "openvino==2026.4.1")
        run(python, "-m", "pip", "install", "--disable-pip-version-check", "torch==2.5.1+cpu", "torchvision==0.20.1+cpu", "--index-url", "https://download.pytorch.org/whl/cpu")
        run(python, "-m", "pip", "install", "--disable-pip-version-check", "timm==1.0.20")
        marker.write_text("1", encoding="ascii")
    print("Portable Python and original OCR dependencies ready", flush=True)
    revision = "652653d64ddb4ccc88c56a3bf65946f44e6a6fbb"
    pdf = download(f"https://codeload.github.com/F100Pilot/PDF-to-GP5/zip/{revision}", CACHE / "pdf.zip", "fbaa6c96a88382f869a4bcc02e7069b1d04d6739e9483e7fc5c05627412b96d7")
    extract(pdf, CACHE / "pdf")
    source = CACHE / "pdf" / f"PDF-to-GP5-{revision}"
    shutil.copytree(source / "app", TOOLS / "pdf-to-gp5/app", dirs_exist_ok=True)
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        copy(source / name, TOOLS / "pdf-to-gp5" / name)
    scripts = {
        "guitar_omr_dataset_smoke.py": "856f269bd545430046339b31a46ce0dc41fb0a8b1624e2287c91d9a76155efeb",
        "guitar_omr_eval.py": "da2bf2e41aa76ecb345f12cc3fc745263eddcee7d78337467fa2800b2b0e7d24",
        "guitar_omr_train.py": "2c268da08bc3c65d448b1ed584967390679de656ea055709eae1a4adf3059e18",
        "guitar_omr_infer.py": "f3fb679bbef3a634a02566b7cc7b36746237f7eca71a4f78c6c91c935b234aed",
    }
    for name, sha in scripts.items():
        download(f"https://huggingface.co/spaces/kk9293/guitar-tab-omr/resolve/db9d40b3c5a686f875cbc0e4e48af63f4ac75187/scripts/{name}", TOOLS / "omr/scripts" / name, sha)
    system = "win-x64" if WINDOWS else "linux-x64"
    ort_hash = "0b38df9af21834e41e73d602d90db5cb06dbd1ca618948b8f1d66d607ac9f3cd" if WINDOWS else "1fa4dcaef22f6f7d5cd81b28c2800414350c10116f5fdd46a2160082551c5f9b"
    extension = "zip" if WINDOWS else "tgz"
    ort_archive = download(f"https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-{system}-1.23.2.{extension}", CACHE / f"ort.{extension}", ort_hash)
    extract(ort_archive, CACHE / "ort")
    ort = CACHE / "ort" / f"onnxruntime-{system}-1.23.2"
    for directory in (ANALYSIS, TOOLS):
        for file in (ort / "lib").iterdir():
            if (WINDOWS and file.suffix == ".dll") or (not WINDOWS and ".so" in file.name):
                copy(file, directory / "runtime" / file.name)
        for file in ort.glob("*LICENSE*"):
            copy(file, directory / "runtime/licenses/onnxruntime" / file.name)
        for file in ort.glob("*Notices*"):
            copy(file, directory / "runtime/licenses/onnxruntime" / file.name)
    pdfium_sha = "8d48973e3eb472dda0f5f2435e595ac043f9f2219dd71883392f549445afa8a5" if WINDOWS else "d6b1e28950a0392590d79bbdbb7eb19686872b688f8a36f170acb19e41473113"
    archive = download(f"https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/8138/pdfium-{system}.tgz", CACHE / "pdfium.tgz", pdfium_sha)
    extract(archive, CACHE / "pdfium")
    copy(CACHE / "pdfium" / ("bin/pdfium.dll" if WINDOWS else "lib/libpdfium.so"), TOOLS / "runtime" / ("pdfium.dll" if WINDOWS else "libpdfium.so"))
    shutil.copytree(CACHE / "pdfium/licenses", TOOLS / "runtime/licenses/pdfium", dirs_exist_ok=True)
    site = TOOLS / ("python/Lib/site-packages" if WINDOWS else "python/lib/python3.12/site-packages")
    for file in (site / "openvino/libs").iterdir():
        if file.is_file():
            copy(file, ANALYSIS / "runtime/openvino-2026.4.1" / file.name)
    if WINDOWS:
        archive = download("https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip", CACHE / "ffmpeg.zip", "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba")
        extract(archive, CACHE / "ffmpeg")
        ffmpeg = next((CACHE / "ffmpeg").rglob("ffmpeg.exe"))
    else:
        archive = download("https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-07-12-47/ffmpeg-N-128560-g967f0ffb10-linux64-gpl.tar.xz", CACHE / "ffmpeg.tar.xz", "650f1b00378c218681be952108a57df23ffc7f397c4a048c22ff1e0587ac8020")
        extract(archive, CACHE / "ffmpeg")
        ffmpeg = next(p for p in (CACHE / "ffmpeg").rglob("ffmpeg") if p.is_file())
    copy(ffmpeg, ANALYSIS / "runtime" / f"ffmpeg{suffix}")
    for license_file in ffmpeg.parent.parent.rglob("*LICENSE*"):
        if license_file.is_file():
            copy(license_file, ANALYSIS / "runtime/licenses/ffmpeg" / license_file.name)
    # A standard-library-only downloader is also shipped for the light package.
    copy(ROOT / "scripts/install-models.py", RES / "install-models.py")
    (RES / "MODELS.txt").write_text("Standard models: Demucs htdemucs_6s, Guitar Tab OMR, tab-labeler.\nMuScriptor models remain an optional separate download.\nGuitar Tab OMR model license: other; see https://huggingface.co/kk9293/guitar-tab-omr\n", encoding="utf-8")
    if models:
        run(python, ROOT / "scripts/install-models.py", "--root", RES)
    else:
        for path in (ANALYSIS / "models/htdemucs_6s.onnx", ANALYSIS / "models/tab-labeler-v3-egset.onnx", TOOLS / "omr/model/best.pt"):
            path.unlink(missing_ok=True)
    # Smoke-check the actual portable interpreter and the original OCR pipeline.
    run(python, "-c", "import torch, torchvision, timm, rapidocr_onnxruntime, pdfplumber, guitarpro; print('Portable OCR/OMR imports verified')")
    run(python, ROOT / "tooling/tab_worker.py", "--engine", "pdf", "--source", ROOT / "native-tab-tools/tests/fixtures/tab.png", "--runtime", TOOLS, "--output", STAGE / "smoke")
    flavor = "offline" if models else "light"
    config = {"bundle": {"active": True, "targets": ["nsis"] if WINDOWS else ["deb", "appimage"], "resources": {"../.installer/resources/": ""}, "category": "Music", "shortDescription": "Lokales Musikstudio mit Loops und Guitar-Pro-Bearbeitung", "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.ico"]}}
    if WINDOWS:
        config["bundle"]["windows"] = {"bundleVCRuntime": True, "nsis": {"installMode": "currentUser", "languages": ["German", "English"], "displayLanguageSelector": True}}
    else:
        config["bundle"]["linux"] = {"appimage": {"bundleMediaFramework": True}, "deb": {"depends": ["libwebkit2gtk-4.1-0", "libgtk-3-0t64", "libgomp1", "libstdc++6", "libasound2t64", "libgl1"]}}
    (STAGE / f"tauri-{flavor}.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(f"Installer resources staged ({flavor})", flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", action="store_true")
    prepare(parser.parse_args().models)
