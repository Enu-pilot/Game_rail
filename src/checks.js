// レイアウトの物理的な整合性チェック
//  - 線路中心間隔（最小離隔）の不足
//  - 接続のない線路どうしの交差
//  - 建築限界（線路上空間）を支障する構造物
//  - 構造物どうしの重なり

import { polylineLength, pointAt, distToPolyline, dist, segIntersect } from './geom.js';
import { objectDef } from './catalog.js';
import { crossoverUnits } from './topology.js';

export const DEFAULT_MIN_SPACING = 4.0;   // 線路中心間隔の最小値[m]
export const DEFAULT_CLEARANCE_HALF = 1.9; // 建築限界の片側幅[m]

const SAMPLE_STEP = 8;      // 線路のサンプリング間隔[m]
const JUNCTION_SKIP = 45;   // 分岐部の近傍は離隔チェックから除外する半径[m]

/** 線路に支障してはならない構造物の形状 */
const BLOCKING_SHAPES = new Set(['building', 'yard', 'gate', 'platform']);
/** 互いに重なってはならない構造物の形状 */
const SOLID_SHAPES = new Set(['building', 'shed', 'yard', 'gate', 'platform']);

const bbox = pts => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
};
const bboxFar = (a, b, gap) =>
  a.x0 - gap > b.x1 || b.x0 - gap > a.x1 || a.y0 - gap > b.y1 || b.y0 - gap > a.y1;

/** 回転矩形の4頂点 */
export function rectCorners(o) {
  const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
  const hw = o.w / 2, hh = o.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    .map(([x, y]) => ({ x: o.x + x * c - y * s, y: o.y + x * s + y * c }));
}

/** 分離軸判定による回転矩形どうしの交差 */
function rectsOverlap(a, b, margin = 0) {
  const A = rectCorners({ ...a, w: a.w + margin * 2, h: a.h + margin * 2 });
  const B = rectCorners(b);
  for (const poly of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % 4];
      const ax = -(p2.y - p1.y), ay = p2.x - p1.x;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const p of A) { const v = p.x * ax + p.y * ay; a0 = Math.min(a0, v); a1 = Math.max(a1, v); }
      for (const p of B) { const v = p.x * ax + p.y * ay; b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}

/** 点が回転矩形（margin だけ拡大）の内側か */
function pointInRect(px, py, o, margin = 0) {
  const c = Math.cos(-(o.rot || 0)), s = Math.sin(-(o.rot || 0));
  const dx = px - o.x, dy = py - o.y;
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= o.w / 2 + margin && Math.abs(ly) <= o.h / 2 + margin;
}

/** 線分どうしの交点 */
/** 線路をサンプリングした点列 */
function samples(t) {
  const len = polylineLength(t.points);
  const out = [];
  for (let d = 0; d <= len; d += SAMPLE_STEP) out.push({ ...pointAt(t.points, d), at: d });
  out.push({ ...pointAt(t.points, len), at: len });
  return out;
}

let _crossCache = { rev: -1, doc: null, list: null };

/** 接続点をもたない線路どうしの交差点（分岐器・クロッシング未設置の箇所） */
export function crossingPoints(doc, g, rev) {
  if (_crossCache.list && _crossCache.rev === rev && _crossCache.doc === doc) return _crossCache.list;
  const tracks = doc.tracks.filter(t => t.points && t.points.length >= 2 && polylineLength(t.points) > 0.5);
  const boxes = new Map(tracks.map(t => [t.id, bbox(t.points)]));
  const list = [];
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const A = tracks[i], B = tracks[j];
      if (bboxFar(boxes.get(A.id), boxes.get(B.id), 2)) continue;
      for (let a = 1; a < A.points.length; a++) {
        for (let b = 1; b < B.points.length; b++) {
          const x = segIntersect(A.points[a - 1], A.points[a], B.points[b - 1], B.points[b]);
          if (!x) continue;
          if (g && g.nodes.some(n => dist(n.x, n.y, x.x, x.y) <= (g.tol || 6) + 1)) continue;
          const angA = Math.atan2(A.points[a].y - A.points[a - 1].y, A.points[a].x - A.points[a - 1].x);
          const angB = Math.atan2(B.points[b].y - B.points[b - 1].y, B.points[b].x - B.points[b - 1].x);
          list.push({ x: x.x, y: x.y, a: A.id, b: B.id, aName: A.name, bName: B.name, angA, angB });
        }
      }
    }
  }
  _crossCache = { rev, doc, list };
  return list;
}

let _cache = { rev: -1, doc: null, issues: null };

/** 物理チェックの実行（版数が同じなら再利用） */
export function layoutChecks(doc, g, rev) {
  if (_cache.issues && _cache.rev === rev && _cache.doc === doc) return _cache.issues;
  const issues = runChecks(doc, g, rev);
  _cache = { rev, doc, issues };
  return issues;
}

function runChecks(doc, g, rev) {
  const units = g ? crossoverUnits(doc, g, rev) : [];
  const issues = [];
  const minSp = doc.settings.minTrackSpacingM ?? DEFAULT_MIN_SPACING;
  const half = doc.settings.clearanceHalfM ?? DEFAULT_CLEARANCE_HALF;
  const tracks = doc.tracks.filter(t => t.points && t.points.length >= 2 && polylineLength(t.points) > 0.5);
  const boxes = new Map(tracks.map(t => [t.id, bbox(t.points)]));
  const sampled = new Map(tracks.map(t => [t.id, samples(t)]));
  const crossings = g ? crossingPoints(doc, g, rev) : [];

  // 共有する接続点（分岐部）— 近傍は離隔チェックの対象外
  const sharedNodes = (a, b) => {
    if (!g) return [];
    const na = new Set(g.nodesOfTrack(a.id)), out = [];
    for (const nid of g.nodesOfTrack(b.id)) if (na.has(nid)) out.push(g.nodeById.get(nid));
    return out;
  };

  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const A = tracks[i], B = tracks[j];
      if (bboxFar(boxes.get(A.id), boxes.get(B.id), minSp + 2)) continue;
      const shared = sharedNodes(A, B);

      // --- 交差（接続点なし） ---
      const crossed = crossings.find(c => (c.a === A.id && c.b === B.id) || (c.a === B.id && c.b === A.id));
      // シーサスの渡り線どうしの交差は装置の中のダイヤモンドクロッシングなので支障ではない
      const inScissors = units.some(u => u.kind === 'scissors'
        && u.connectors.some(c => c.id === A.id) && u.connectors.some(c => c.id === B.id));
      if (inScissors) continue;    // 装置の中は離隔・交差の判定から外す
      // 交差部に装置（ダイヤモンドクロッシング／スリップ）が置かれていれば支障ではない
      const hasDevice = crossed && doc.objects.some(o =>
        objectDef(o.type).crossing && dist(o.x, o.y, crossed.x, crossed.y) <= 12);
      if (crossed && hasDevice) continue;
      if (crossed) {
        issues.push({
          level: 'error', trackId: A.id, x: crossed.x, y: crossed.y,
          message: `「${A.name}」と「${B.name}」が接続点なしで交差しています（分岐器・クロッシングを設置するか配置を見直してください）`,
        });
        continue;   // 交差している場合は離隔チェックを省略
      }

      // --- 線路中心間隔 ---
      let worst = null;
      for (const s of sampled.get(A.id)) {
        if (shared.some(n => dist(n.x, n.y, s.x, s.y) <= JUNCTION_SKIP)) continue;
        const r = distToPolyline(s.x, s.y, B.points);
        if (shared.length) {
          const p = pointAt(B.points, r.at);
          if (shared.some(n => dist(n.x, n.y, p.x, p.y) <= JUNCTION_SKIP)) continue;
        }
        if (!worst || r.d < worst.d) worst = { d: r.d, x: s.x, y: s.y };
      }
      if (worst && worst.d < minSp - 1e-6) {
        issues.push({
          level: worst.d < minSp * 0.6 ? 'error' : 'warn', trackId: A.id, x: worst.x, y: worst.y,
          message: `「${A.name}」と「${B.name}」の線路中心間隔が ${worst.d.toFixed(1)}m しかありません（最小 ${minSp}m）`,
        });
      }
    }
  }

  // --- 構造物が線路の建築限界を支障 ---
  for (const o of doc.objects) {
    const def = objectDef(o.type);
    if (!BLOCKING_SHAPES.has(def.shape)) continue;
    const ob = { x0: o.x - Math.max(o.w, o.h), y0: o.y - Math.max(o.w, o.h), x1: o.x + Math.max(o.w, o.h), y1: o.y + Math.max(o.w, o.h) };
    for (const t of tracks) {
      if (bboxFar(ob, boxes.get(t.id), half + 2)) continue;
      const hit = sampled.get(t.id).find(s => pointInRect(s.x, s.y, o, half));
      if (hit) {
        issues.push({
          level: 'error', trackId: t.id, x: hit.x, y: hit.y,
          message: `「${o.label || def.name}」が「${t.name}」の建築限界（片側 ${half}m）を支障しています`,
        });
        break;
      }
    }
  }

  // --- 構造物どうしの重なり ---
  const solids = doc.objects.filter(o => SOLID_SHAPES.has(objectDef(o.type).shape));
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i], b = solids[j];
      const da = objectDef(a.type), db = objectDef(b.type);
      // ホーム上に建つ駅施設などは正常な配置として扱う
      const onPlatform = (x, y) => x.shape === 'platform' && (y.shape === 'building' || y.shape === 'gate');
      if (onPlatform(da, db) || onPlatform(db, da)) continue;
      // 建屋の中に入る小設備などは対象外（SOLID_SHAPES で既に除外済み）
      if (Math.hypot(a.x - b.x, a.y - b.y) > (Math.max(a.w, a.h) + Math.max(b.w, b.h)) / 2 + 1) continue;
      if (rectsOverlap(a, b)) {
        issues.push({
          level: 'warn', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
          objectId: a.id,
          message: `「${a.label || da.name}」と「${b.label || db.name}」が重なっています`,
        });
      }
    }
  }
  return issues;
}
