from pathlib import Path
import guitarpro as gp
from guitarpro import models as m
song=m.Song(title='Original fingerings',tempo=120)
track=song.tracks[0]
track.name='Drop D + Capo'
track.offset=2
track.strings[-1].value=38
voice=track.measures[0].voices[0]
voice.beats=[]
for chord in [[(1,0)],[(2,5)],[(1,0),(2,5)],[(6,0),(1,22)]]:
    beat=m.Beat(voice,status=m.BeatStatus.normal,duration=m.Duration(value=4))
    beat.notes=[m.Note(beat,string=s,value=f,type=m.NoteType.normal) for s,f in chord]
    voice.beats.append(beat)
gp.write(song,str(Path(__file__).resolve().parents[1] / 'src/fixtures/positions.gp5'),version=(5,1,0))
