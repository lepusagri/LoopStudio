"""Download public model weights once; audio never leaves the computer."""
import json
import os
from pathlib import Path
import sys

runtime = Path(sys.prefix)
os.environ['TORCH_HOME'] = str(runtime / 'models')
import torch
torch.set_num_threads(2)
from demucs.pretrained import get_model
from basic_pitch.inference import Model
from basic_pitch import ICASSP_2022_MODEL_PATH
import imageio_ffmpeg

model = get_model('htdemucs_6s')
assert len(model.sources) == 6
Model(ICASSP_2022_MODEL_PATH)
assert Path(imageio_ffmpeg.get_ffmpeg_exe()).is_file()
(runtime / 'ready.json').write_text(json.dumps({'demucs': 'htdemucs_6s', 'transcription': 'basic-pitch-onnx', 'version': 1}), encoding='utf-8')
print('Die lokale Analyseumgebung ist bereit.')
