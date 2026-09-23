// 幾何計算ユーティリティ（単位はすべてメートル）

export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/** ポリラインの総延長 */
export function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
  return s;
}

/** 始点から distance[m] 進んだ位置と進行方向 */
export function pointAt(pts, distance) {
  if (!pts.length) return null;
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, angle: 0 };
  let rest = Math.max(0, distance);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = dist(a.x, a.y, b.x, b.y);
    if (seg <= 1e-9) continue;
    if (rest <= seg) {
      const t = rest / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    rest -= seg;
  }
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  return { x: b.x, y: b.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** from[m]〜to[m] の区間を切り出した部分ポリライン */
export function subPolyline(pts, from, to) {
  const total = polylineLength(pts);
  from = Math.max(0, Math.min(from, total));
  to = Math.max(from, Math.min(to, total));
  const out = [pointAt(pts, from)];
  let acc = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    acc += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    if (acc > from && acc < to) out.push({ x: pts[i].x, y: pts[i].y });
  }
  out.push(pointAt(pts, to));
  return out.filter(Boolean);
}

/** 点と線分の距離 */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return dist(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, ax + dx * t, ay + dy * t);
}

/** 点とポリラインの距離（+ 最寄り区間の始点からの距離） */
export function distToPolyline(px, py, pts) {
  let best = Infinity, bestAt = 0, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = dist(a.x, a.y, b.x, b.y);
    const d = distToSegment(px, py, a.x, a.y, b.x, b.y);
    if (d < best) {
      best = d;
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
      let t = len2 < 1e-12 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      bestAt = acc + seg * t;
    }
    acc += seg;
  }
  if (pts.length === 1) { best = dist(px, py, pts[0].x, pts[0].y); bestAt = 0; }
  return { d: best, at: bestAt };
}

/** 矩形（回転あり）の内外判定 */
export function hitRect(px, py, cx, cy, w, h, rot) {
  const c = Math.cos(-rot), s = Math.sin(-rot);
  const dx = px - cx, dy = py - cy;
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

/** 回転矩形の外接バウンディングボックス */
export function rectBounds(cx, cy, w, h, rot) {
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  const bw = w * c + h * s, bh = w * s + h * c;
  return { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 };
}

export const snap = (v, step) => Math.round(v / step) * step;

/** 45度刻みに角度を丸めた点を返す */
export function snapAngle(fromX, fromY, toX, toY) {
  const dx = toX - fromX, dy = toY - fromY;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: toX, y: toY };
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: fromX + Math.cos(a) * len, y: fromY + Math.sin(a) * len };
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 線分どうしの交点（なければ null） */
export function segIntersect(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
}

/** ポリラインどうしの交点（最初の1点） */
export function polylineIntersect(a, b) {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const x = segIntersect(a[i - 1], a[i], b[j - 1], b[j]);
      if (x) return x;
    }
  }
  return null;
}
