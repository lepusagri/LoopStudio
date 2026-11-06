"""Local, one-job worker. JSON lines on stdout; diagnostics on stderr."""
import argparse
import contextlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys


def progress(message, percent):
    print(json.dumps({"message": message, "percent": percent}, ensure_ascii=False), flush=True)


def analyze(source, start, end, output, model_home):
    if not (math.isfinite(start) and math.isfinite(end) and start >= 0 and 0.1 <= end - start <= 180):
        raise ValueError("Die Passage muss zwischen 0,1 und 180 Sekunden lang sein.")
    os.environ["TORCH_HOME"] = str(model_home)
    os.environ["NUMBA_CACHE_DIR"] = str(output / "numba-cache")
    progress("Analyseumgebung wird geladen …", 2)
    import numpy as np
    import soundfile as sf
    import torch
    import imageio_ffmpeg
    from demucs.pretrained import get_model
    from demucs.apply import apply_model

    torch.set_num_threads(min(6, max(1, (os.cpu_count() or 4) // 2)))
    torch.manual_seed(0)
    output.mkdir(parents=True, exist_ok=True)
    crop = output / "passage.wav"
    progress("Gewählte Passage wird aus der Aufnahme geschnitten …", 5)
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-v", "error", "-y", "-ss", str(start),
                    "-i", str(source), "-t", str(end - start), "-map", "0:a:0", "-vn", "-ac", "2",
                    "-ar", "44100", "-c:a", "pcm_f32le", str(crop)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120,
                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    audio, rate = sf.read(crop, dtype="float32", always_2d=True)
    actual_duration = len(audio) / rate
    if actual_duration < 0.05:
        raise ValueError("In dieser Passage wurde keine Audiospur gefunden.")
    progress("Demucs trennt Gitarre, Piano, Bass, Schlagzeug, Gesang und Rest …", 10)
    model = get_model("htdemucs_6s")
    model.eval()
    wave = torch.from_numpy(audio.T.copy())
    reference = wave.mean(0)
    mean = reference.mean()
    std = reference.std().clamp_min(1e-8)
    # The same gain is retained across all stems. Individual normalization would break the mix.
    with torch.inference_mode():
        separated = apply_model(model, ((wave - mean) / std)[None], device="cpu", shifts=0,
                                split=True, overlap=0.25, segment=6, progress=True)[0]
        separated = separated * std + mean
    names = {"guitar": "Gitarre", "piano": "Piano", "bass": "Bass", "drums": "Schlagzeug", "vocals": "Gesang", "other": "Weitere Instrumente"}
    stems = []
    for index, source_name in enumerate(model.sources):
        path = output / (source_name + ".wav")
        samples = separated[index].cpu().numpy().T
        sf.write(path, samples, rate, subtype="FLOAT")
        stems.append({"id": index, "name": names[source_name], "source": source_name,
                      "path": str(path.resolve()), "notes": [], "rms": float(np.sqrt(np.mean(samples ** 2))), "warning": None})
    del model, separated, wave
    progress("Instrumente getrennt. Notenerkennung wird vorbereitet …", 50)
    with contextlib.redirect_stdout(sys.stderr):
        from basic_pitch.inference import Model, predict
        from basic_pitch import ICASSP_2022_MODEL_PATH
        pitch_model = Model(ICASSP_2022_MODEL_PATH)
    for order, stem in enumerate(stems):
        progress(f"Noten erkennen: {stem['name']} …", 52 + order * 7)
        if stem["source"] == "drums":
            stem["warning"] = "Schlagzeug enthält keine Tonhöhen für Griffbrett oder Klavier."
            continue
        if stem["rms"] < 0.00005:
            stem["warning"] = "Diese Spur ist nahezu still; keine Noten erkannt."
            continue
        try:
            with contextlib.redirect_stdout(sys.stderr):
                _, midi, events = predict(stem["path"], pitch_model, minimum_note_length=100,
                                          onset_threshold=0.55, frame_threshold=0.35,
                                          melodia_trick=False)
            midi.write(str(output / (stem["source"] + ".mid")))
            for begin, finish, pitch, velocity, _ in events:
                begin, finish = max(0., float(begin)), min(actual_duration, float(finish))
                if finish > begin:
                    stem["notes"].append({"midi": int(pitch), "time": begin, "duration": finish - begin,
                                          "velocity": float(velocity), "track": stem["id"]})
            if not stem["notes"]:
                stem["warning"] = "Keine sicheren Noten erkannt. Die Audiospur ist trotzdem abspielbar."
        except Exception as error:
            print(f"Transcription failed for {stem['source']}: {error}", file=sys.stderr)
            stem["warning"] = "Notenerkennung fehlgeschlagen. Die Audiospur ist trotzdem abspielbar."
    result = {"version": 1, "start": start, "end": start + actual_duration, "stems": stems}
    temporary = output / "result.tmp"
    temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    temporary.replace(output / "result.json")
    progress("Spuren und Noten sind bereit.", 100)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--end", type=float, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--models", type=Path, required=True)
    args = parser.parse_args()
    try:
        analyze(args.source, args.start, args.end, args.output, args.models)
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        progress(f"Analyse fehlgeschlagen: {error}", -1)
        sys.exit(1)
