"""Original two-track GP5 fixture: repeat, tempo change, distinct pitches and track names."""
from pathlib import Path
import guitarpro as gp
from guitarpro import models as m

song = m.Song(title='LoopStudio GP5 Importtest', tempo=120)
song.measureHeaders = [m.MeasureHeader(number=1, isRepeatOpen=True), m.MeasureHeader(number=2, start=4800, repeatClose=1)]
song.tracks = []
for index, (name, instrument, frets) in enumerate([('Leadgitarre', 25, [0, 2, 4, 5]), ('Piano', 0, [7, 9, 11, 12])]):
    track = m.Track(song, number=index + 1, name=name)
    track.channel.channel = index * 2
    track.channel.effectChannel = index * 2 + 1
    track.channel.instrument = instrument
    track.measures = []
    for bar_index, header in enumerate(song.measureHeaders):
        measure = m.Measure(track, header)
        voice = measure.voices[0]
        for step, fret in enumerate(frets):
            beat = m.Beat(voice, status=m.BeatStatus.normal, duration=m.Duration(value=4))
            if step == 0:
                beat.effect.mixTableChange = m.MixTableChange(tempo=m.MixTableItem(120 if bar_index == 0 else 60))
            beat.notes = [m.Note(beat, string=1, value=fret, type=m.NoteType.normal)]
            voice.beats.append(beat)
        track.measures.append(measure)
    song.tracks.append(track)
path = Path(__file__).resolve().parents[1] / 'src/fixtures/two-tracks.gp5'
path.parent.mkdir(parents=True, exist_ok=True)
gp.write(song, str(path), version=(5, 1, 0))
print(path)
