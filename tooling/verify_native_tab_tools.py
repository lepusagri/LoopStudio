"""Optional migration check against independent PyGuitarPro and original OMR.

Run in the one-time export environment. This is never shipped or called by the app.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", required=True, type=Path)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--sources", required=True, type=Path)
    parser.add_argument("--smoke", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HUB_OFFLINE"] = "1"
    sys.path.insert(0, str(args.sources.resolve()))
    import guitarpro
    import torch
    from PIL import Image
    from guitar_omr_eval import create_model, greedy_decode, decode_ids, build_token_groups
    from guitar_omr_dataset_smoke import load_image_tensor

    # Exactly the model's canvas size keeps the input identical across runtimes.
    image = Image.open(args.smoke).convert("L")
    canvas = Image.new("L", (1200, 224), 255)
    canvas.paste(image.crop((110, 180, 1200, 320)), (0, 0))
    source = args.output / "omr-input.png"
    canvas.save(source)
    torch.set_num_threads(4)
    checkpoint = torch.load(args.sources / "best.pt", map_location="cpu", weights_only=True)
    config = dict(checkpoint["config"]["args"])
    config["pretrained_encoder"] = False
    vocab = checkpoint["vocab"]
    model = create_model(config, vocab, checkpoint["config"])
    model.load_state_dict(checkpoint["model"])
    model.eval()
    ids = {int(i): t for t, i in vocab.items()}
    with torch.inference_mode():
        predicted, ended = greedy_decode(model, load_image_tensor(source, 1200, 224), vocab["<BOS>"], vocab["<EOS>"], 384, torch.device("cpu"), ids, build_token_groups(vocab))
    expected = decode_ids(predicted, ids)
    expected = [t for t in expected if not t.startswith("<")]
    native = args.output / "native-omr"
    subprocess.run([str(args.worker.resolve()), "--runtime", str(args.runtime.resolve()), "--output", str(native), "--source", str(source), "--engine", "omr"], check=True)
    result = json.loads((native / "result.json").read_text(encoding="utf-8"))
    actual = result["tokens"].split()
    if actual != expected or result["report"]["sawEos"] != ended:
        (args.output / "python-tokens.txt").write_text(" ".join(expected), encoding="utf-8")
        raise AssertionError("Native OMR tokens differ from original PyTorch; see saved token streams")
    song = guitarpro.parse(native / "result.gp5")
    assert song.tracks and len(song.measureHeaders) == result["report"]["bars"]
    print(f"Original PyTorch and native Rust: identical {len(actual)} tokens; GP5 independently parsed")


if __name__ == "__main__":
    main()
