"""Download the standard models with pinned revisions and verified hashes."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import sys
import urllib.request

MODELS = [
    ("LoopStudio-runtime/models/htdemucs_6s.onnx", "https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/49df9b6989cf2150840ea65b0bef77a2e471b678/htdemucs_6s.onnx", "48f8e84945579f8ab340e083339e9221e03785dbe733a52c388200b6d3ca779a"),
    ("LoopStudio-runtime/models/tab-labeler-v3-egset.onnx", "https://huggingface.co/cstr/tab-labeler-onnx/resolve/434976baacaf194d99f09c3c784682766bedcf97/tab-labeler-v3-egset.onnx", "93114786c6f4781e7a0b69abd7e93a0d4966873f8e54908f97a1de8e8cf788af"),
    ("LoopStudio-tools-runtime/omr/model/best.pt", "https://huggingface.co/kk9293/guitar-tab-omr/resolve/cf0aa64313e981e3c4337e322df6540958a55e1d/best.pt", "833a45752eb99cf525ec2744c20d93175540b487f162caa38e554fc3c7fb0f7e"),
]
def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file,"sha256").hexdigest()
def main():
    parser=argparse.ArgumentParser()
    default=Path(__file__).resolve().parent if sys.platform=="win32" else Path(os.environ.get("XDG_DATA_HOME",Path.home()/".local/share"))/"local.loopstudio.desktop/runtimes"
    parser.add_argument("--root",type=Path,default=default)
    root=parser.parse_args().root
    for relative,url,sha in MODELS:
        path=root/relative
        if path.is_file() and digest(path)==sha:
            print(f"Verified: {path.name}",flush=True);continue
        path.parent.mkdir(parents=True,exist_ok=True)
        part=path.with_name(path.name+".part")
        print(f"Downloading: {path.name}",flush=True)
        with urllib.request.urlopen(url,timeout=120) as response, part.open("wb") as output:
            shutil.copyfileobj(response,output)
        if digest(part)!=sha:raise ValueError(f"SHA256 mismatch: {path.name}")
        part.replace(path)
    print("Standard models ready. Restart LoopStudio.",flush=True)
if __name__=="__main__":main()
