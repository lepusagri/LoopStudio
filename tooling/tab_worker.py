"""Optional local tab tools. stdout is JSON progress; no web service or uploads."""
import argparse
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import re
import sys

def progress(message, percent):
    print(json.dumps({'message':message,'percent':percent},ensure_ascii=False),flush=True)

def tokens_to_gp(tokens, bpm, title):
    import guitarpro as gp
    from guitarpro import models as m
    song=m.Song(title=title,tempo=bpm)
    song.tracks=song.tracks[:1]
    track=song.tracks[0];track.name='Guitar Tab OMR';track.channel.instrument=25
    song.measureHeaders=[];track.measures=[]
    numerator,denominator=4,4
    measure=None;beat_tokens=[];unknown=set();count=0
    def begin_bar():
        nonlocal measure
        header=m.MeasureHeader(number=len(song.measureHeaders)+1)
        header.timeSignature.numerator=numerator;header.timeSignature.denominator.value=denominator
        song.measureHeaders.append(header);measure=m.Measure(track,header);track.measures.append(measure)
    def flush():
        nonlocal beat_tokens,count
        if not beat_tokens:return
        if measure is None:begin_bar()
        value=4;dots=0;tuplet=m.Tuplet()
        for token in beat_tokens:
            if token.startswith('DUR_'):value=int(token[4:])
            elif token.startswith('DOTS_'):dots=int(token[5:])
            elif token.startswith('TUPLET_'):
                enters,times=map(int,token[7:].split('_'));tuplet=m.Tuplet(enters=enters,times=times)
        if value not in (1,2,4,8,16,32,64) or dots>1:
            raise ValueError('Das OMR-Ergebnis enthält einen noch nicht unterstützten Notenwert. Rohdaten prüfen.')
        voice=measure.voices[0]
        beat=m.Beat(voice,status=m.BeatStatus.rest if 'REST' in beat_tokens else m.BeatStatus.normal,duration=m.Duration(value=value,isDotted=dots==1,tuplet=tuplet))
        used=set()
        for token in beat_tokens:
            match=re.fullmatch(r'N_S([1-8])_F(\d+|X)',token)
            if match:
                # Tabbox uses 1 = lowest string; GP5 uses 1 = highest.
                string=7-int(match[1]);fret=0 if match[2]=='X' else int(match[2])
                if not 1<=string<=6 or string in used or fret>36:raise ValueError('Ungültige oder doppelte Saitenposition im OMR-Ergebnis.')
                used.add(string);beat.notes.append(m.Note(beat,string=string,value=fret,type=m.NoteType.dead if match[2]=='X' else m.NoteType.normal));count+=1
            elif token not in ('BEAT','REST') and not token.startswith(('DUR_','DOTS_','TUPLET_')):unknown.add(token)
        if not beat.notes:beat.status=m.BeatStatus.rest
        voice.beats.append(beat);beat_tokens=[]
    for token in tokens:
        if token=='<UNK>':raise ValueError('Das OMR-Modell hat ein unbekanntes Symbol erkannt. Rohdaten prüfen.')
        if token.startswith('<'):continue
        if token=='BEAT':flush();beat_tokens=['BEAT']
        elif token=='BAR':flush();begin_bar()
        elif token=='END_BAR':flush();measure=None
        elif token.startswith('TS_'):
            flush();numerator,denominator=map(int,token[3:].split('_'))
            if not(1<=numerator<=32 and denominator in (1,2,4,8,16,32)):raise ValueError('Ungültige Taktart im OMR-Ergebnis.')
        elif token.startswith('CAPO_'):track.offset=int(token[5:])
        elif token.startswith('TEMPO_') and token[6:].isdigit():song.tempo=int(token[6:])
        elif token.startswith(('REPEAT_','ALT_ENDING_','SIMILE_','ANACRUSIS','DOUBLE_BAR')):unknown.add(token)
        else:beat_tokens.append(token)
    flush()
    if not count:raise ValueError('Das Modell hat keine spielbaren Tabulaturzahlen erkannt.')
    data=io.BytesIO();gp.write(song,data,version=(5,1,0))
    warnings=['Experimentelle Bilderkennung: Ergebnis vor Verwendung prüfen. Stimmung ist hier Standardstimmung, sofern kein Kapodaster erkannt wurde.']
    bad_bars=[m.header.number for m in track.measures if sum(b.duration.time for b in m.voices[0].beats)!=int(m.header.timeSignature.numerator*960*4/m.header.timeSignature.denominator.value)]
    if bad_bars:warnings.append('Abweichende Taktfüllung in Takten '+', '.join(map(str,bad_bars))+': Modell-Ausgabe gegen das Bild prüfen.')
    if unknown:warnings.append('Nicht vollständig übernommene Spieltechniken/Wiederholungen: '+', '.join(sorted(unknown)))
    return data.getvalue(),{'notes':count,'bars':len(track.measures),'warnings':warnings}

def run(args):
    os.environ['ORT_DISABLE_TELEMETRY']='1';os.environ['HF_HUB_OFFLINE']='1'
    runtime=Path(args.runtime);output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    path=Path(args.source)
    if not path.is_file() or path.stat().st_size>40*1024*1024:raise ValueError('Datei fehlt oder ist größer als 40 MB.')
    progress('Tab-Werkzeug wird geladen …',5)
    if not 20<=args.bpm<=400:raise ValueError('Tempo muss zwischen 20 und 400 BPM liegen.')
    if path.suffix.lower()!='.pdf':
        from PIL import Image
        with Image.open(path) as image:
            if image.width*image.height>20_000_000:raise ValueError('Das Bild überschreitet 20 Megapixel. Bitte kleiner ausschneiden.')
    raw='';meta={}
    if args.engine=='pdf':
        sys.path.insert(0,str(runtime/'pdf-to-gp5'))
        from app.converter import convert_many, ConversionOptions, TrackOptions, ConversionError
        from app.i18n import use
        use("en")
        progress('PDF / Bild wird lokal gelesen …',15)
        options=ConversionOptions(tempo=args.bpm,numerator=args.numerator,denominator=args.denominator,tracks=(TrackOptions(name=path.stem,filename=path.name),),max_pages=15,max_image_pages=8,max_image_pixels=20_000_000,max_events=10000,max_measures=500)
        padded=False
        with contextlib.redirect_stdout(sys.stderr):
            try:
                result=convert_many([path.read_bytes()],options)
            except ConversionError as exc:
                if path.suffix.lower()=='.pdf' or 'No tablature was found' not in str(exc):
                    raise
                # Tight video crops can cut off the white margin needed to detect string lines.
                from PIL import ImageOps
                with Image.open(path) as image:
                    margin=max(24,min(64,round(image.height/8)))
                    expanded=ImageOps.expand(image.convert('RGB'),border=(0,margin,0,margin),fill='white')
                    if expanded.width*expanded.height>20_000_000:
                        raise
                    buffer=io.BytesIO()
                    expanded.save(buffer,format='PNG')
                progress('Tabulatur mit Bildrand erneut lesen …',45)
                try:
                    result=convert_many([buffer.getvalue()],options)
                    padded=True
                except ConversionError as retry_exc:
                    if 'No tablature was found' in str(retry_exc):
                        raise ValueError('Keine Tabulatur erkannt. Bitte die vollständigen sechs Linien einschließlich Zahlen und etwas freien Randes ausschneiden.') from retry_exc
                    raise
        gp5=result.gp5;meta=result.report
        if padded:
            meta.setdefault('warnings',[]).append('Der Bildausschnitt wurde für die Erkennung automatisch mit einem weißen Rand erweitert. Ergebnis bitte prüfen.')
    else:
        if path.suffix.lower() not in ('.png','.jpg','.jpeg','.webp'):raise ValueError('Guitar Tab OMR benötigt eine ausgeschnittene Bilddatei, kein PDF.')
        sys.path.insert(0,str(runtime/'omr/scripts'))
        import torch
        from guitar_omr_dataset_smoke import load_image_tensor
        from guitar_omr_eval import create_model, build_token_groups, greedy_decode, decode_ids
        from guitar_omr_infer import tokens_to_token_text
        torch.set_num_threads(4)
        progress('Guitar Tab OMR: Modell laden …',15)
        # Only tensor/primitive checkpoints are accepted; no arbitrary pickle code.
        checkpoint=torch.load(runtime/'omr/model/best.pt',map_location='cpu',weights_only=True)
        config=dict(checkpoint['config']['args']);config['pretrained_encoder']=False
        vocab=checkpoint['vocab'];ids={int(i):t for t,i in vocab.items()}
        with contextlib.redirect_stdout(sys.stderr):
            model=create_model(config,vocab,checkpoint['config']);model.load_state_dict(checkpoint['model']);model.eval()
        image=load_image_tensor(path,width=int(config.get('width',1200)),height=int(config.get('height',224)))
        progress('Guitar Tab OMR: Tabulatur lesen …',35)
        with torch.inference_mode(),contextlib.redirect_stdout(sys.stderr):
            predicted,ended=greedy_decode(model,image,int(vocab['<BOS>']),int(vocab['<EOS>']),int(config.get('max_seq_len',384)),torch.device('cpu'),ids,build_token_groups(vocab),initial_time_signature=None)
        tokens=decode_ids(predicted,ids);raw=tokens_to_token_text(tokens)
        (output/'tokens.txt').write_text(raw,encoding='utf-8')
        progress('Erkannte Noten werden geprüft …',90)
        gp5,meta=tokens_to_gp(tokens,args.bpm,path.stem)
        meta.update({'model':'kk9293/guitar-tab-omr','device':'cpu','sawEos':ended,'tokenCount':len(tokens)})
        if not ended:meta['warnings'].append('Die Ausgabe hat die maximale Länge erreicht und kann unvollständig sein.')
    import hashlib
    meta['inputSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    meta['tempoInput']=args.bpm
    meta['engineRevision']='652653d64ddb4ccc88c56a3bf65946f44e6a6fbb' if args.engine=='pdf' else 'cf0aa64313e981e3c4337e322df6540958a55e1d'
    (output/'result.gp5').write_bytes(gp5)
    value={'engine':args.engine,'filename':path.stem+'.gp5','gp5':base64.b64encode(gp5).decode('ascii'),'report':meta,'tokens':raw}
    (output/'result.json').write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')
    progress('Ergebnis bereit. Bitte die Vorschau prüfen.',100)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--engine',choices=['pdf','omr'],required=True);parser.add_argument('--source',required=True);parser.add_argument('--runtime',required=True);parser.add_argument('--output',required=True);parser.add_argument('--bpm',type=int,default=120)
    parser.add_argument('--numerator',type=int);parser.add_argument('--denominator',type=int)
    try:run(parser.parse_args())
    except Exception as e:
        import traceback;traceback.print_exc(file=sys.stderr);print(str(e),file=sys.stderr);sys.exit(1)
