"""Run with the optional tools runtime: python -m unittest discover -s tooling -p test_*.py."""
import io
import unittest
import guitarpro
from tab_worker import tokens_to_gp

class TabWorkerTests(unittest.TestCase):
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
