// 配線略図（配線略図.net の配線図を読み取ったデータ）から、1路線ぶんの線路・駅・ホームを組み立てる
//
// データの座標は配線図の「帯」（左から右へ路線の順に並べたもの）で、
//   x … 路線に沿った位置、y … 下向きが正（左側通行なので、右へ進む下り列車は上側の線）
// これを路線の経路（向きを変えながら伸びる折れ線）に沿って置き直す。
//   ・駅の配線のまとまり（駅の範囲）は縮尺 KX[m/単位] でそのまま
//   ・駅と駅の間（分岐のない区間）は、実際の駅間に合わせて縮めたり延ばしたりする
//   ・縦方向は本線の中心からの距離を KY 倍して、経路の左右に振り分ける

import { polylineLength, pointAt, distToPolyline } from '../geom.js';

const KX = 4.0;            // 駅の中の縮尺 [m/単位]（ホーム 50 単位 ≒ 10両 200m）
const KY = 2.6;            // 横方向の縮尺 [m/単位]
const TURN_R = 160;        // 経路の曲がり角の半径 [m]

/** 折れ線上の x に対する y（範囲外なら端の値） */
function yAt(pts, x) {
  if (!pts || !pts.length) return null;
  if (x <= Math.min(pts[0][0], pts[pts.length - 1][0]) - 1e-6 || x >= Math.max(pts[0][0], pts[pts.length - 1][0]) + 1e-6) {
    // 範囲外：x が近い方の端
    const a = pts[0], b = pts[pts.length - 1];
    if (x < Math.min(a[0], b[0]) - 0.5 || x > Math.max(a[0], b[0]) + 0.5) return null;
  }
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    if (Math.min(a[0], b[0]) - 1e-6 <= x && x <= Math.max(a[0], b[0]) + 1e-6 && Math.abs(b[0] - a[0]) > 1e-9) {
      return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
  }
  return null;
}

/** 区分線形の補間（xs は昇順） */
function interp(xs, ys, x) {
  if (!xs.length) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const t = (x - xs[lo]) / Math.max(1e-9, xs[hi] - xs[lo]);
  return ys[lo] + (ys[hi] - ys[lo]) * t;
}

/** 曲がり角を円弧でなめらかにした経路の点列 */
export function arcPath(P0, heading, turns, totalLen) {
  // turns: [{ u, h }]（u: 経路上の位置、h: その先の向き[rad]）を u の昇順で
  const pts = [{ x: P0.x, y: P0.y }];
  let cur = { x: P0.x, y: P0.y }, h = heading, done = 0;
  const go = d => { cur = { x: cur.x + Math.cos(h) * d, y: cur.y + Math.sin(h) * d }; pts.push(cur); done += d; };
  for (let k = 0; k < turns.length; k++) {
    const tr = turns[k];
    let dth = tr.h - h;
    while (dth > Math.PI) dth -= 2 * Math.PI;
    while (dth < -Math.PI) dth += 2 * Math.PI;
    if (Math.abs(dth) < 1e-4) continue;
    const room = Math.min(tr.u - done, ((turns[k + 1] ? turns[k + 1].u : totalLen) - tr.u)) * 0.9;
    const R = Math.max(10, Math.min(TURN_R, room / Math.max(1e-3, Math.tan(Math.abs(dth) / 2))));
    const tLen = R * Math.tan(Math.abs(dth) / 2);
    if (tr.u - tLen > done) go(tr.u - tLen - done);
    // 円弧
    const n = Math.max(2, Math.ceil(Math.abs(dth) / (6 * Math.PI / 180)));
    const sgn = Math.sign(dth);
    const cx = cur.x + Math.cos(h + sgn * Math.PI / 2) * R, cy = cur.y + Math.sin(h + sgn * Math.PI / 2) * R;
    const a0 = h - sgn * Math.PI / 2;
    for (let j = 1; j <= n; j++) {
      const a = a0 + dth * j / n;
      const q = { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
      done += Math.hypot(q.x - cur.x, q.y - cur.y);
      cur = q; pts.push(q);
    }
    h = tr.h;
  }
  if (totalLen > done) go(totalLen - done);
  return pts;
}

/**
 * 帯の x → 経路上の位置 u の対応を作る。
 * 駅の範囲は KX 倍、駅間は実際の距離（とサンプルの描画間隔 SP）に合わせて伸縮する。
 */
export function stripMapping(D, specStations, SP, opts = {}) {
  const n = specStations.length;
  const ds = D.stations;
  // 駅の中心 x：ホームの中心（なければ駅名の位置）
  const cx = ds.map(s => {
    if (s.x == null) return null;
    if (s.plats && s.plats.length) return s.plats.reduce((a, b) => a + (b[0] + b[2]) / 2, 0) / s.plats.length;
    return s.x;
  });
  const shared0 = !!opts.shared0;
  // 欠けている駅の位置はキロ程で補間
  for (let i = 0; i < n; i++) {
    if (cx[i] != null || (i === 0 && shared0)) continue;
    let a = i - 1; while (a >= 0 && cx[a] == null) a--;
    let b = i + 1; while (b < n && cx[b] == null) b++;
    if (a >= 0 && b < n) {
      const t = (specStations[i].km - specStations[a].km) / ((specStations[b].km - specStations[a].km) || 1);
      cx[i] = cx[a] + (cx[b] - cx[a]) * t;
    } else cx[i] = a >= 0 ? cx[a] + 40 : (b < n ? cx[b] - 40 : D.x0);
  }
  if (shared0) cx[0] = D.x0;
  const ext = ds.map((s, i) => (i === 0 && shared0) ? [D.x0, D.x0] : (s.ext ? [Math.min(s.ext[0], cx[i]), Math.max(s.ext[1], cx[i])] : [cx[i] - 15, cx[i] + 15]));
  // 駅間の区切り（隣の駅の範囲と重なっていれば中点で分ける）
  const seps = [];
  for (let i = 0; i < n - 1; i++) {
    let r = ext[i][1], l = ext[i + 1][0];
    if (r > l - 2) { const m = (Math.max(r, cx[i]) + Math.min(l, cx[i + 1])) / 2; r = m - 1; l = m + 1; }
    r = Math.max(r, cx[i] + 0.5); l = Math.min(l, cx[i + 1] - 0.5);
    if (l <= r) { const m = (cx[i] + cx[i + 1]) / 2; r = m - 0.5; l = m + 0.5; }
    seps.push([r, l]);
  }
  // 路線全体の駅の中の縮尺：実際の駅間に収まるように
  let kx = KX;
  for (let i = 0; i < n - 1; i++) {
    const real = Math.abs(specStations[i + 1].km - specStations[i].km) * 1000;
    const fixed = (seps[i][0] - cx[i]) + (cx[i + 1] - seps[i][1]);
    if (fixed > 0 && fixed * kx + 30 > real) kx = Math.max(0.8, (real - 30) / fixed);
  }
  // 区切りごとの縮尺
  const bx = [D.x0], bu = [0];
  let u = 0, x = D.x0;
  const push = (nx, nu) => { if (nx > bx[bx.length - 1] + 1e-6) { bx.push(nx); bu.push(nu); } };
  for (let i = 0; i < n - 1; i++) {
    const [r, l] = seps[i];
    u += (r - x) * kx; x = r; push(x, u);
    // 接続駅から起点までのぶん（opts.lead）は最初の駅間から差し引く
    const real = Math.max(30, Math.abs(specStations[i + 1].km - specStations[i].km) * 1000 - (i === 0 ? (opts.lead || 0) : 0));
    const fixed = ((r - cx[i]) + (cx[i + 1] - l)) * kx;
    const target = Math.min(real, Math.max(SP, fixed + 120));
    const gapU = Math.max(20, Math.min(real - fixed - 5, target - fixed));
    u += Math.max(10, gapU); x = l; push(x, u);
  }
  u += Math.max(0, D.x1 - x) * kx; push(D.x1, u);
  const U = X => interp(bx, bu, X);
  return { U, cx, ext, seps, kx, total: u };
}

/** 本線の中心（左右に振り分ける基準）：駅間の区切りでの本線の中心を結んだ線 */
export function baseline(D, seps) {
  const xs = [], ys = [];
  const mid = x => {
    const ys2 = D.mains.map(m => yAt(m.pts, x)).filter(v => v != null);
    return ys2.length ? (Math.min(...ys2) + Math.max(...ys2)) / 2 : null;
  };
  for (const [r, l] of seps) {
    const m = (r + l) / 2, y = mid(m);
    if (y != null) { xs.push(m); ys.push(y); }
  }
  if (!xs.length) {
    const y = mid((D.x0 + D.x1) / 2) ?? 0;
    xs.push(D.x0); ys.push(y);
  }
  return X => interp(xs, ys, X);
}

/** 帯の折れ線を、細かく分けて写像し、ほぼ一直線の点を間引く */
export function mapPolyline(pts, M, step = 3) {
  const out = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    if (k > 0) {
      const a = pts[k - 1];
      const L = Math.hypot(p[0] - a[0], p[1] - a[1]);
      const n = Math.max(1, Math.ceil(L / step));
      for (let j = 1; j < n; j++) out.push(M(a[0] + (p[0] - a[0]) * j / n, a[1] + (p[1] - a[1]) * j / n));
    }
    out.push(M(p[0], p[1]));
  }
  // 間引き：前後の向きがほとんど変わらない点を落とす
  const keep = [out[0]];
  for (let k = 1; k < out.length - 1; k++) {
    const a = keep[keep.length - 1], b = out[k], c = out[k + 1];
    const a1 = Math.atan2(b.y - a.y, b.x - a.x), a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 0.004 || Math.hypot(b.x - a.x, b.y - a.y) > 400) keep.push(b);
  }
  keep.push(out[out.length - 1]);
  return keep.filter((p, i) => i === 0 || Math.hypot(p.x - keep[i - 1].x, p.y - keep[i - 1].y) > 0.05);
}

export { KX, KY, yAt, interp, polylineLength, pointAt, distToPolyline };
