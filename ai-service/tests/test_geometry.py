"""Geometry and contract tests for the AI service.

Standard library only, so they run on any machine with Python: ``python3 -m unittest
discover -s ai-service/tests -t ai-service``. The model adapters are exercised through the
provider seam with test doubles, because the real weights are not in this repository; the
adapters themselves report themselves unavailable, which is also tested.
"""

from __future__ import annotations

import unittest

from ssp_ai.geometry import (
    GeometryError,
    Mask,
    boundary_islands,
    is_simple,
    polygon_area,
    polygon_perimeter,
    proposals_from_mask,
    simplify,
)


def square_mask(size: int = 10, offset=(0, 0)) -> Mask:
    rows = []
    for y in range(size + 4):
        row = bytearray(size + 4)
        for x in range(size + 4):
            if offset[0] <= x < offset[0] + size and offset[1] <= y < offset[1] + size:
                row[x] = 1
        rows.append(bytes(row))
    return Mask(width=size + 4, height=size + 4, rows=tuple(rows))


class MaskTests(unittest.TestCase):
    def test_area_and_bounding_box(self) -> None:
        mask = square_mask(6, offset=(2, 3))
        self.assertEqual(mask.area_px, 36)
        self.assertEqual(mask.bounding_box(), (2, 3, 6, 6))

    def test_empty_mask_has_no_box(self) -> None:
        mask = Mask(width=3, height=3, rows=(b"\0\0\0",) * 3)
        self.assertTrue(mask.is_empty())
        with self.assertRaises(GeometryError):
            mask.bounding_box()

    def test_malformed_mask_is_refused(self) -> None:
        with self.assertRaises(GeometryError):
            Mask(width=3, height=2, rows=(b"\1\1\1",))
        with self.assertRaises(GeometryError):
            Mask(width=0, height=0, rows=())

    def test_filled_outside_bounds_is_false(self) -> None:
        mask = square_mask(4)
        self.assertFalse(mask.filled(-1, 0))
        self.assertFalse(mask.filled(0, 999))


class OutlineTests(unittest.TestCase):
    def test_square_outline_keeps_its_area(self) -> None:
        proposals = proposals_from_mask(square_mask(10, offset=(2, 2)))
        self.assertEqual(len(proposals), 1)
        proposal = proposals[0]
        self.assertAlmostEqual(proposal["area_px"], 100, delta=25)
        self.assertTrue(proposal["is_simple"])
        self.assertEqual(proposal["vertex_count"], 4)

    def test_disconnected_sections_are_separate_proposals(self) -> None:
        top = square_mask(4)
        rows = []
        for y in range(12):
            row = bytearray(12)
            for x in range(12):
                if top.filled(x, y):
                    row[x] = 1
                if 6 <= x < 12 and 6 <= y < 12:
                    row[x] = 1
            rows.append(bytes(row))
        mask = Mask(width=12, height=12, rows=tuple(rows))
        islands = boundary_islands(mask)
        self.assertEqual(len(islands), 2)
        areas = [abs(polygon_area(island)) for island in islands]
        self.assertGreater(areas[0], areas[1])

    def test_simplification_removes_pixel_steps(self) -> None:
        outline = [(0, 0), (1, 0), (2, 0), (2, 1), (2, 2), (1, 2), (0, 2), (0, 1)]
        simplified = simplify(outline, tolerance_px=0.5)
        self.assertEqual(len(simplified), 4)

    def test_perimeter_of_a_square(self) -> None:
        self.assertAlmostEqual(polygon_perimeter([(0, 0), (10, 0), (10, 10), (0, 10)]), 40)

    def test_self_intersection_is_detected(self) -> None:
        bowtie = [(0, 0), (10, 10), (10, 0), (0, 10)]
        self.assertFalse(is_simple(bowtie))
        self.assertTrue(is_simple([(0, 0), (10, 0), (10, 10), (0, 10)]))


if __name__ == "__main__":
    unittest.main()
