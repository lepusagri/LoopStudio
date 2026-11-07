"""Stage Ubuntu 24.04 DEB resources using distro Python, OpenCV and FFmpeg.

Run after prepare-installer.py. The AppImage keeps its portable resources.
No pip installation or model download runs in a Debian maintainer script.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DEPENDS = [
    "python3 (>= 3.12)", "python3 (<< 3.13)", "python3-numpy (>= 1.26)",
    "python3-pil (>= 10)", "python3-opencv (>= 4.6)", "python3-yaml (>= 6)",
    "python3-shapely (>= 2)", "python3-pyclipper (>= 1.3)", "python3-packaging",
    "python3-networkx", "python3-jinja2", "python3-filelock (>= 3.10)",
    "python3-fsspec (>= 2023.8)", "python3-requests", "python3-charset-normalizer (>= 3)", "python3-tqdm",
    "python3-typing-extensions (>= 4.10)", "ffmpeg (>= 6)",
    "libwebkit2gtk-4.1-0", "libgtk-3-0t64", "libgomp1", "libstdc++6",
    "libasound2t64", "libgl1", "ocl-icd-libopencl1",
]
APT_ENTRIES = {
    "numpy", "numpy.libs", "PIL", "pillow.libs", "cv2", "opencv_python.libs",
    "yaml", "_yaml", "shapely", "shapely.libs", "pyclipper", "packaging",
    "networkx", "jinja2", "markupsafe", "filelock", "fsspec", "requests",
    "urllib3", "idna", "certifi", "charset_normalizer", "tqdm", "typing_extensions.py",
    "openvino", "openvino.libs", "openvino_telemetry", "pip", "bin",
}
APT_DISTS = {
    "numpy", "pillow", "opencv_python", "pyyaml", "shapely", "pyclipper",
    "packaging", "networkx", "jinja2", "markupsafe", "filelock", "fsspec",
    "requests", "urllib3", "idna", "certifi", "charset_normalizer", "tqdm",
    "typing_extensions", "openvino", "openvino_telemetry", "pip",
}


def bundled(entry):
    if entry.name in APT_ENTRIES or entry.name == "__pycache__":
        return False
    if entry.name.endswith((".dist-info", ".egg-info")):
        distribution = entry.name.split("-")[0].lower().replace("-", "_")
        return distribution not in APT_DISTS
    return True


def copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, destination, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"))
    else:
        shutil.copy2(source, destination)


def prepare(source, stage, models, binaries=None):
    source, stage = source.resolve(), stage.resolve()
    if stage == source or stage.is_relative_to(source) or source.is_relative_to(stage):
        raise ValueError("DEB and portable staging directories must be separate")
    resources = stage / ("offline" if models else "light") / "resources"
    if resources.exists():
        # Only this flavor's generated directory may be replaced.
        if resources.is_symlink() or not resources.resolve().is_relative_to(stage):
            raise ValueError("Unsafe DEB staging cleanup")
        shutil.rmtree(resources)
    analysis = resources / "LoopStudio-runtime"
    tools = resources / "LoopStudio-tools-runtime"
    for name in ("LoopStudio-runtime", "LoopStudio-tools-runtime"):
        original, target = source / name, resources / name
        for binary in ("loopstudio-analysis", "loopstudio-tab-tools"):
            if (original / binary).is_file():
                copy((binaries / binary) if binaries else (original / binary), target / binary)
        for library in ("libonnxruntime.so", "libonnxruntime_providers_shared.so", "libpdfium.so"):
            if (original / "runtime" / library).is_file():
                copy(original / "runtime" / library, target / "runtime" / library)
        if (original / "runtime/licenses").exists():
            copy(original / "runtime/licenses", target / "runtime/licenses")
    copy(source / "LoopStudio-runtime/runtime/openvino-2026.4.1", analysis / "runtime/openvino-2026.4.1")
    copy(source / "LoopStudio-tools-runtime/pdf-to-gp5", tools / "pdf-to-gp5")
    copy(source / "LoopStudio-tools-runtime/omr/scripts", tools / "omr/scripts")
    site = source / "LoopStudio-tools-runtime/python/lib/python3.12/site-packages"
    if not site.is_dir():
        raise ValueError("Expected a Linux CPython 3.12 portable runtime")
    for distribution in site.glob("openvino-*.dist-info"):
        if (distribution / "licenses").is_dir():
            copy(distribution / "licenses", analysis / "runtime/licenses/openvino")
    for entry in site.iterdir():
        if bundled(entry):
            copy(entry, tools / "site-packages" / entry.name)
    # PyTorch and the original OCR libraries are unavailable in Noble's archive.
    # Keep their pinned wheels private; use apt for their compatible dependencies.
    wrapper = tools / "bin/python3"
    wrapper.parent.mkdir(parents=True, exist_ok=True)
    wrapper.write_text('''#!/bin/sh
set -eu
runtime=$(dirname "$(dirname "$(readlink -f "$0")")")
unset PYTHONHOME
export PYTHONPATH="$runtime/site-packages"
export PYTHONNOUSERSITE=1
export PYTHONDONTWRITEBYTECODE=1
exec /usr/bin/python3 -s "$@"
''', encoding="utf-8", newline="\n")
    wrapper.chmod(0o755)
    for name in ("install-models.py", "MODELS.txt"):
        copy(source / name, resources / name)
    if models:
        for relative in (
            "LoopStudio-runtime/models/htdemucs_6s.onnx",
            "LoopStudio-runtime/models/tab-labeler-v3-egset.onnx",
            "LoopStudio-tools-runtime/omr/model/best.pt",
        ):
            copy(source / relative, resources / relative)
    # Verify which interpreter and modules the actual installed launcher uses.
    probe = """import sys, json, importlib
system = ['numpy', 'PIL', 'cv2', 'yaml', 'shapely', 'pyclipper', 'packaging', 'networkx', 'jinja2', 'filelock', 'fsspec', 'requests', 'tqdm', 'typing_extensions']
paths = {name: importlib.import_module(name).__file__ for name in system}
assert sys.executable == '/usr/bin/python3', sys.executable
assert all(path.startswith('/usr/lib/python3/dist-packages/') for path in paths.values()), paths
import torch, torchvision, timm, rapidocr_onnxruntime, pdfplumber, guitarpro
print(json.dumps({'python': sys.executable, 'systemModules': paths, 'torch': torch.__version__, 'opencv': importlib.import_module('cv2').__version__}, indent=2))
"""
    subprocess.run([str(wrapper), "-c", probe], check=True)
    subprocess.run([str(wrapper), str(ROOT / "tooling/tab_worker.py"), "--engine", "pdf",
                    "--source", str(ROOT / "native-tab-tools/tests/fixtures/tab.png"),
                    "--runtime", str(tools), "--output", str(stage / "smoke")], check=True)
    config = {"bundle": {"active": True, "targets": ["deb"],
              "resources": {resources.as_posix() + "/": ""}, "category": "Music",
              "shortDescription": "Lokales Musikstudio mit paketverwalteten Linux-Abhängigkeiten",
              "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png"],
              "linux": {"deb": {"depends": DEPENDS}}}}
    stage.mkdir(parents=True, exist_ok=True)
    flavor = "offline" if models else "light"
    (stage / f"tauri-deb-{flavor}.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    report = {"flavor": flavor, "depends": DEPENDS, "bundledPythonInterpreter": False,
              "bundledFFmpeg": False, "bundledOpenCV": False,
              "bytes": sum(p.stat().st_size for p in resources.rglob("*") if p.is_file())}
    (stage / f"report-{flavor}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / ".installer/resources")
    parser.add_argument("--stage", type=Path, default=ROOT / ".installer/debian")
    parser.add_argument("--models", action="store_true")
    parser.add_argument("--binaries", type=Path, help="Use freshly built native workers from this release directory")
    args = parser.parse_args()
    prepare(args.source, args.stage, args.models, args.binaries)
