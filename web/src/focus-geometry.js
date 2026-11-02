const vectors = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Choose from the requested row/direction; horizontal edges never jump to a header. */
export function directionalTarget(current, candidates, key) {
  const direction = vectors[key];
  if (!direction) return null;
  const horizontal = direction[0] !== 0;
  const cx = current.x + current.width / 2, cy = current.y + current.height / 2;
  let best = null, bestScore = Infinity;
  for (const candidate of candidates) {
    const r = candidate.rect;
    const dx = r.x + r.width / 2 - cx, dy = r.y + r.height / 2 - cy;
    const forward = dx * direction[0] + dy * direction[1];
    if (forward <= 1) continue;
    const sameRow = Math.min(current.y + current.height, r.y + r.height) > Math.max(current.y, r.y) + 1;
    const sameColumn = Math.min(current.x + current.width, r.x + r.width) > Math.max(current.x, r.x) + 1;
    if (horizontal && !sameRow) continue;
    if (!horizontal && sameRow && !sameColumn) continue;
    const perpendicular = horizontal ? Math.abs(dy) : Math.abs(dx);
    const score = ((!horizontal && !sameColumn) ? 100000 : 0) + forward + perpendicular * 2;
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}
