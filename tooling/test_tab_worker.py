"""Run with the optional tools runtime: python -m unittest discover -s tooling -p test_*.py."""
import io
import unittest
import guitarpro
from tab_worker import tokens_to_gp, pdf_string_count
from dataclasses import dataclass
from types import SimpleNamespace

@dataclass
class ParsedSystems:
    systems: list
    warnings: list

class TabWorkerTests(unittest.TestCase):
    def test_six_string_selection_excludes_standard_notation_and_keeps_all_tab_events(self):
        notation=SimpleNamespace(string_count=5,events=[1,2,3])
        tab=SimpleNamespace(string_count=6,events=list(range(30)))
        parsed=ParsedSystems([notation,tab,notation,tab],['OCR'])
        original=lambda *args,**kwargs:parsed
        converter=SimpleNamespace(_parse_pdf=original,ConversionError=ValueError)
        with pdf_string_count(converter,6):
            result=converter._parse_pdf(b'pdf',None)
            self.assertEqual(result.systems,[tab,tab])
            self.assertEqual(sum(len(s.events) for s in result.systems),60)
            self.assertTrue(any('2 Systeme' in w for w in result.warnings))
        self.assertIs(converter._parse_pdf,original)
        self.assertEqual(len(parsed.systems),4)

    def test_string_selection_never_invents_missing_strings_and_restores_parser_on_error(self):
        original=lambda *args,**kwargs:ParsedSystems([SimpleNamespace(string_count=5,events=[1])],[])
        converter=SimpleNamespace(_parse_pdf=original,ConversionError=ValueError)
        with self.assertRaisesRegex(ValueError,'Keine Tabulatur mit 6 Saiten'):
            with pdf_string_count(converter,6):
                converter._parse_pdf(b'pdf',None)
        self.assertIs(converter._parse_pdf,original)
        with pdf_string_count(converter,0):
            self.assertIs(converter._parse_pdf,original)

    def test_low_to_high_string_mapping_and_dead_notes(self):
        data, report = tokens_to_gp('BAR BEAT DUR_1 N_S1_F3 N_S2_FX N_S6_F2 END_BAR'.split(), 120, 'Test')
        song = guitarpro.parse(io.BytesIO(data))
        notes = song.tracks[0].measures[0].voices[0].beats[0].notes
        self.assertEqual([(n.string,n.value,n.type.name) for n in notes], [(1,2,'normal'),(5,0,'dead'),(6,3,'normal')])
        self.assertEqual(report['notes'], 3)
        self.assertFalse(any('Taktfüllung' in w for w in report['warnings']))

    def test_incomplete_bars_and_techniques_are_reported(self):
        data, report = tokens_to_gp('BAR BEAT DUR_4 DOTS_1 N_S1_F3 NTECH_SLIDE END_BAR'.split(), 90, 'Test')
        self.assertEqual(guitarpro.parse(io.BytesIO(data)).tempo, 90)
        self.assertTrue(any('Taktfüllung' in w for w in report['warnings']))
        self.assertTrue(any('NTECH_SLIDE' in w for w in report['warnings']))

    def test_bad_model_output_is_rejected(self):
        for bad in ['BAR BEAT DUR_4 N_S7_F0', 'BAR BEAT DUR_4 N_S1_F40', 'BAR BEAT DUR_4 N_S1_F2 N_S1_F3', 'BAR BEAT DUR_4 DOTS_2 N_S1_F0', 'BAR BEAT DUR_4 REST', '<UNK>']:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                tokens_to_gp(bad.split(), 120, 'Test')

if __name__ == '__main__':
    unittest.main()
