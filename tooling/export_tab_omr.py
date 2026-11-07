"""One-time, offline export of the pinned Guitar Tab OMR checkpoint to ONNX.

Python is a development/setup dependency only. The shipped Rust worker does not
import or execute this file. Verify dynamic decoder lengths and numeric parity
before publishing any model files.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

CHECKPOINT_SHA = "833a45752eb99cf525ec2744c20d93175540b487f162caa38e554fc3c7fb0f7e"
SCRIPTS = {
    "guitar_omr_train.py": "2c268da08bc3c65d448b1ed584967390679de656ea055709eae1a4adf3059e18",
    "guitar_omr_eval.py": "da2bf2e41aa76ecb345f12cc3fc745263eddcee7d78337467fa2800b2b0e7d24",
    "guitar_omr_dataset_smoke.py": "856f269bd545430046339b31a46ce0dc41fb0a8b1624e2287c91d9a76155efeb",
}


def digest(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--scripts", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if digest(args.checkpoint) != CHECKPOINT_SHA:
        raise ValueError("OMR checkpoint checksum mismatch")
    for name, checksum in SCRIPTS.items():
        if digest(args.scripts / name) != checksum:
            raise ValueError(f"OMR source checksum mismatch: {name}")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["ORT_DISABLE_TELEMETRY"] = "1"
    sys.path.insert(0, str(args.scripts.resolve()))
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from guitar_omr_eval import create_model

    torch.set_num_threads(4)
    torch.backends.mha.set_fastpath_enabled(False)
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    config = dict(checkpoint["config"]["args"])
    config["pretrained_encoder"] = False
    vocab = checkpoint["vocab"]
    model = create_model(config, vocab, checkpoint["config"])
    model.load_state_dict(checkpoint["model"])
    model.eval()
    width, height = int(config.get("width", 1200)), int(config.get("height", 224))
    max_length = int(config.get("max_seq_len", 384))

    class Decoder(torch.nn.Module):
        def __init__(self, network):
            super().__init__()
            self.network = network

        def attention(self, query, key, value, layer, mask=None):
            # Explicit dynamic reshapes avoid PyTorch 2.5's fixed-length MHA
            # ONNX trace, while retaining the original projection weights.
            weights = layer.in_proj_weight.chunk(3)
            biases = layer.in_proj_bias.chunk(3)
            heads = layer.num_heads
            width = layer.embed_dim // heads
            q, k, v = [torch.nn.functional.linear(x, w, b).reshape(1, -1, heads, width).transpose(1, 2)
                       for x, w, b in zip((query, key, value), weights, biases)]
            scores = torch.matmul(q, k.transpose(-2, -1)) / width ** 0.5
            if mask is not None:
                scores = scores.masked_fill(mask, float("-inf"))
            attended = torch.matmul(torch.softmax(scores, dim=-1), v)
            attended = attended.transpose(1, 2).reshape(1, -1, layer.embed_dim)
            return layer.out_proj(attended)

        def forward(self, tokens, memory):
            positions = torch.arange(tokens.shape[1], device=tokens.device).unsqueeze(0)
            embedded = self.network.embedding(tokens) + self.network.token_position(positions)
            mask = torch.triu(torch.ones(tokens.shape[1], tokens.shape[1], dtype=torch.bool), diagonal=1)
            decoded = embedded
            for layer in self.network.decoder.layers:
                normalized = layer.norm1(decoded)
                decoded = decoded + self.attention(normalized, normalized, normalized, layer.self_attn, mask)
                normalized = layer.norm2(decoded)
                decoded = decoded + self.attention(normalized, memory, memory, layer.multihead_attn)
                normalized = layer.norm3(decoded)
                decoded = decoded + layer.linear2(layer.activation(layer.linear1(normalized)))
            if self.network.decoder.norm is not None:
                decoded = self.network.decoder.norm(decoded)
            decoded = decoded[:, -1:, :]
            logits = decoded.new_full((1, 1, len(vocab)), -10000.)
            for branch, head in self.network.branch_heads.items():
                logits = logits.index_copy(-1, getattr(self.network, f"{branch}_token_ids"), head(decoded))
            return logits[:, 0, :]

    args.output.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(7)
    image = torch.rand(1, 1, height, width)
    tokens = torch.tensor([[vocab["<BOS>"], vocab["BAR"], vocab["BEAT"]]])
    decoder = Decoder(model).eval()
    with torch.inference_mode():
        memory = model.encoder(image)
        torch.onnx.export(model.encoder, (image,), args.output / "encoder.onnx", input_names=["image"], output_names=["memory"], opset_version=17)
        torch.onnx.export(decoder, (tokens, memory), args.output / "decoder.onnx", input_names=["tokens", "memory"], output_names=["logits"], dynamic_axes={"tokens": {1: "sequence"}}, opset_version=17)
        for filename in ("encoder.onnx", "decoder.onnx"):
            onnx.checker.check_model(str(args.output / filename))
        options = ort.SessionOptions()
        options.enable_mem_pattern = False
        options.intra_op_num_threads = 4
        encoder_session = ort.InferenceSession(str(args.output / "encoder.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
        decoder_session = ort.InferenceSession(str(args.output / "decoder.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
        native_memory = encoder_session.run(None, {"image": image.numpy()})[0]
        np.testing.assert_allclose(native_memory, memory.numpy(), rtol=2e-3, atol=5e-4)
        for length in (1, 3, 17, max_length - 1):
            sequence = torch.randint(0, len(vocab), (1, length))
            expected = decoder(sequence, memory).numpy()
            original = model(image, sequence)["token"][:, -1, :].numpy()
            np.testing.assert_allclose(expected, original, rtol=2e-3, atol=5e-4)
            actual = decoder_session.run(None, {"tokens": sequence.numpy(), "memory": native_memory})[0]
            np.testing.assert_allclose(actual, expected, rtol=2e-3, atol=5e-4)
        # Publish the manifest only after every dynamic-shape/parity check passes.
        manifest = {
            "formatVersion": 1, "width": width, "height": height, "maxLength": max_length,
            "vocab": vocab, "checkpointSha256": CHECKPOINT_SHA,
            "encoderSha256": digest(args.output / "encoder.onnx"),
            "decoderSha256": digest(args.output / "decoder.onnx"),
            "source": "kk9293/guitar-tab-omr", "revision": "cf0aa64313e981e3c4337e322df6540958a55e1d",
            "license": "other; see upstream model card",
        }
        (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("ONNX encoder/decoder verified at sequence lengths 1, 3, 17 and", max_length - 1)


if __name__ == "__main__":
    main()
