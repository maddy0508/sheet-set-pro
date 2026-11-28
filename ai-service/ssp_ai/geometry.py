"""Geometry helpers for turning segmentation masks into editable roof outlines.

Standard library only: this module is the part of the AI service that must be testable on
any machine, so it cannot depend on numpy, OpenCV, torch or the model weights.

All pixel work happens on a boolean grid. Coordinates are ``(x, y)`` with the origin at the
top left, matching image space. Nothing here invents a scale: a polygon stays in pixels
until a verified georeferencing transform converts it.
"""

from __future__ import annotations

from dataclasses import dataclass

Point = tuple[float, float]

# Neighbour offsets used by the boundary walk, clockwise from east.
_DIRECTIONS = ((1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1))


class GeometryError(ValueError):
    """A mask or polygon that cannot be used as roof geometry."""


@dataclass(frozen=True)
class Mask:
    """A binary segmentation mask, one row per pixel."""

    width: int
    height: int
    rows: tuple[bytes, ...]

    def __post_init__(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise GeometryError("mask must have a positive size")
        if len(self.rows) != self.height:
            raise GeometryError("mask row count does not match its height")
        for row in self.rows:
            if len(row) != self.width:
                raise GeometryError("mask row length does not match its width")

    def filled(self, x: int, y: int) -> bool:
        if x < 0 or y < 0 or y >= self.height or x >= self.width:
            return False
        return self.rows[y][x] != 0

    @property
    def area_px(self) -> int:
        return sum(1 for row in self.rows for value in row if value)

    def is_empty(self) -> bool:
        return self.area_px == 0

    def bounding_box(self) -> tuple[int, int, int, int]:
        xs = [x for y in range(self.height) for x in range(self.width) if self.rows[y][x]]
        if not xs:
            raise GeometryError("an empty mask has no bounding box")
        ys = [y for y in range(self.height) for x in range(self.width) if self.rows[y][x]]
        return min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1


def mask_from_png_bytes(data: bytes, threshold: int = 128) -> Mask:
    """Decode a single channel PNG (or the alpha of an RGBA one) into a mask.

    Pillow is imported here rather than at module scope so the geometry tests run on a
    bare Python install.
    """

    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as error:  # pragma: no cover - exercised only without Pillow
        raise GeometryError("Pillow is required to decode a mask image") from error

    import io

    with Image.open(io.BytesIO(data)) as image:
        if image.mode == "RGBA":
            grey = image.getchannel("A")
        else:
            grey = image.convert("L")
        width, height = grey.size
        pixels = grey.tobytes()
    rows = tuple(
        bytes(1 if pixels[y * width + x] >= threshold else 0 for x in range(width)) for y in range(height)
    )
    return Mask(width=width, height=height, rows=rows)


def boundary_islands(mask: Mask) -> list[list[Point]]:
    """Trace the outlines of every filled region, largest first.

    A roof can be split into disconnected sections, and a single segmentation can contain
    a shed next to the house. Each island becomes its own polygon so the operator can accept
    one and reject another instead of receiving one merged blob.
    """

    seen = [[False] * mask.width for _ in range(mask.height)]
    islands: list[list[Point]] = []
    for y in range(mask.height):
        for x in range(mask.width):
            if not mask.filled(x, y) or seen[y][x]:
                continue
            region = _flood(mask, x, y, seen)
            outline = _trace_region(mask, region)
            if len(outline) >= 3:
                islands.append(outline)
    islands.sort(key=lambda poly: abs(polygon_area(poly)), reverse=True)
    return islands


def _flood(mask: Mask, start_x: int, start_y: int, seen: list[list[bool]]) -> set[tuple[int, int]]:
    region: set[tuple[int, int]] = set()
    stack = [(start_x, start_y)]
    seen[start_y][start_x] = True
    while stack:
        x, y = stack.pop()
        region.add((x, y))
        for dx, dy in _DIRECTIONS:
            nx, ny = x + dx, y + dy
            if mask.filled(nx, ny) and not seen[ny][nx]:
                seen[ny][nx] = True
                stack.append((nx, ny))
    return region


def _trace_region(mask: Mask, region: set[tuple[int, int]]) -> list[Point]:
    """Walk the outer edge of a region and return its corner pixels.

    Uses the region's own filled pixels, not a marching-squares outline, so a 1 px wide
    mask still produces a polygon rather than nothing.
    """

    start = min(region, key=lambda cell: (cell[1], cell[0]))
    outline: list[Point] = [start]
    current = start
    previous_direction = 0
    for _ in range(len(region) * 8 + 8):
        for step in range(8):
            direction = (previous_direction + step) % 8
            dx, dy = _DIRECTIONS[direction]
            candidate = (current[0] + dx, current[1] + dy)
            if candidate in region:
                if candidate == start and len(outline) > 2:
                    return _corner_pixels(outline)
                outline.append(candidate)
                current = candidate
                previous_direction = (direction + 5) % 8
                break
        else:
            break
    return _corner_pixels(outline) if len(outline) >= 3 else []


def _corner_pixels(points: list[Point]) -> list[Point]:
    """Drop pixel steps that continue in the same direction, keeping the corners."""

    if len(points) < 3:
        return points
    kept = [points[0]]
    for index in range(1, len(points)):
        previous = points[index - 1]
        current = points[index]
        following = points[(index + 1) % len(points)]
        if _cross(previous, current, following) != 0:
            kept.append(current)
    return kept


def _cross(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def simplify(points: list[Point], tolerance_px: float) -> list[Point]:
    """Douglas-Peucker: an outline with one vertex per pixel is unusable in an editor."""

    if len(points) < 3:
        return list(points)
    closed = points + [points[0]]
    return _douglas_peucker(closed, tolerance_px)[:-1]


def _douglas_peucker(points: list[Point], tolerance: float) -> list[Point]:
    if len(points) < 3:
        return list(points)
    start, end = points[0], points[-1]
    index = 0
    distance = -1.0
    for i in range(1, len(points) - 1):
        candidate = _point_line_distance(points[i], start, end)
        if candidate > distance:
            index, distance = i, candidate
    if distance <= tolerance:
        return [start, end]
    left = _douglas_peucker(points[: index + 1], tolerance)
    right = _douglas_peucker(points[index:], tolerance)
    return left[:-1] + right


def _point_line_distance(point: Point, start: Point, end: Point) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dx == 0 and dy == 0:
        return ((point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2) ** 0.5
    return abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / (
        (dx * dx + dy * dy) ** 0.5
    )


def polygon_area(points: list[Point]) -> float:
    """Signed shoelace area in square pixels; positive when the points run clockwise on screen."""

    total = 0.0
    for index, point in enumerate(points):
        following = points[(index + 1) % len(points)]
        total += point[0] * following[1] - following[0] * point[1]
    return total / 2


def polygon_perimeter(points: list[Point]) -> float:
    return sum(
        ((points[(i + 1) % len(points)][0] - points[i][0]) ** 2 + (points[(i + 1) % len(points)][1] - points[i][1]) ** 2)
        ** 0.5
        for i in range(len(points))
    )


def is_simple(points: list[Point]) -> bool:
    """True when no two non-adjacent edges cross: a self-intersecting roof polygon is invalid."""

    count = len(points)
    if count < 3:
        return False
    for i in range(count):
        a1, a2 = points[i], points[(i + 1) % count]
        for j in range(i + 2, count):
            if i == 0 and j == count - 1:
                continue
            b1, b2 = points[j], points[(j + 1) % count]
            if _segments_intersect(a1, a2, b1, b2):
                return False
    return True


def _segments_intersect(a1: Point, a2: Point, b1: Point, b2: Point) -> bool:
    d1, d2 = _cross(b1, b2, a1), _cross(b1, b2, a2)
    d3, d4 = _cross(a1, a2, b1), _cross(a1, a2, b2)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def proposals_from_mask(mask: Mask, tolerance_px: float = 1.5) -> list[dict]:
    """Every island in a mask as an image-space polygon proposal.

    The output is deliberately plain data: this is a proposal for an operator to review,
    never a measurement. ``closed`` is set when the walk returned to its start, so the
    caller can tell a complete outline from a truncated one.
    """

    proposals = []
    for outline in boundary_islands(mask):
        simplified = simplify(outline, tolerance_px)
        area = abs(polygon_area(simplified))
        proposals.append(
            {
                "points": [[round(x, 2), round(y, 2)] for x, y in simplified],
                "area_px": round(area, 2),
                "perimeter_px": round(polygon_perimeter(simplified), 2),
                "is_simple": is_simple(simplified),
                "vertex_count": len(simplified),
            }
        )
    return proposals
