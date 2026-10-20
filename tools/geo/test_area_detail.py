import json
import unittest
from pathlib import Path

from build_area_detail import assemble_rings
from build_city import point_in_poly


class AreaDetailTest(unittest.TestCase):
    def test_member_direction_and_order_do_not_change_ring(self):
        rings = assemble_rings([[2, 1], [4, 3], [1, 4], [2, 3]])
        self.assertEqual(len(rings), 1)
        self.assertEqual(set(rings[0]), {1, 2, 3, 4})

    def test_separate_wings_stay_separate(self):
        self.assertEqual(len(assemble_rings([[1, 2, 3, 1], [4, 5, 6, 4]])), 2)

    def test_incomplete_ring_is_rejected(self):
        with self.assertRaises(ValueError):
            assemble_rings([[1, 2], [2, 3]])

    def test_bundled_2175_geometry_and_provenance(self):
        data = json.loads((Path(__file__).resolve().parents[2] / 'src/data/areas/15th-and-market.generated.json').read_text())
        self.assertEqual(data['source']['osmSha256'], '2a4c97087e7f04bef0a92aec0c702894b7400f2abba8233466e77cecc050cd7a')
        wings = [b for b in data['buildings'] if b['id'] == 'relation/10963754']
        self.assertEqual(len(wings), 2)
        self.assertEqual({b['height'] for b in wings}, {21})
        self.assertEqual({b['heightSource'] for b in wings}, {'osm:height'})
        self.assertEqual({w for b in wings for w in b['memberWayIds']}, {'way/788467764', 'way/247088219'})
        self.assertTrue(any(point_in_poly(-2345.6, 2042.7, b['outer']) for b in wings))
        for b in data['buildings']:
            for hole in b['holes']:
                self.assertTrue(point_in_poly(*hole[0], b['outer']))
        tracks = [f for f in data['features'] if f['tags'].get('railway') == 'tram']
        self.assertGreaterEqual(len(tracks), 2)
        self.assertTrue(all(f['tags'].get('tunnel') != 'yes' for f in data['features']))


if __name__ == '__main__':
    unittest.main()
