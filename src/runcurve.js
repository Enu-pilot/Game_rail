// 走行計算（運転曲線）
//  線路の最高速度・速度制限標・分岐側の制限・車両の最高速度から速度の上限を作り、
//  加速度／減速度の制約をかけて所要時間を求める

import { objectDef } from './catalog.js';
import { distToPolyline } from './geom.js';
import { trackGaps } from './topology.js';

export const DEFAULT_LINE_KMH = 100;
export const DEFAULT_ACCEL = 0.65;   // m/s^2（約2.3km/h/s）
export const DEFAULT_DECEL = 0.9;    // m/s^2（約3.2km/h/s）
export const DEFAULT_DIVERGE_KMH = 35;
export const TURNOUT_LIMIT_SPAN = 40; // 分岐器の前後で制限がかかる距離[m]

const kmh = ms => ms * 3.6;
const ms = kmh_ => kmh_ / 3.6;

/** 線路の最高速度[km/h] */
export function trackMaxSpeed(doc, track) {
  if (track && Number.isFinite(track.maxSpeedKmh) && track.maxSpeedKmh > 0) return track.maxSpeedKmh;
  return doc.settings.defaultMaxSpeedKmh ?? DEFAULT_LINE_KMH;
}

/** 線路上の速度制限標（位置と制限速度・区間長） */
export function speedLimitsOn(doc, trackId) {
  const t = doc.tracks.find(x => x.id === trackId);
  if (!t || !t.points || t.points.length < 2) return [];
  const out = [];
  for (const o of doc.objects || []) {
    if (!objectDef(o.type).speedLimit || o.trackId !== trackId) continue;
    const at = distToPolyline(o.x, o.y, t.points).at;
    const span = Math.max(1, o.lengthM || 100);
    out.push({ object: o, from: at - span / 2, to: at + span / 2, limit: Math.max(5, o.limitKmh || 25) });
  }
  return out;
}

/**
 * 経路（[{trackId,fromAt,toAt}]）から速度の上限プロファイルを作る。
 * 返り値は [{from, to, limit}]（距離は経路始点からのメートル、limit は km/h）
 */
export function profileFromPath(doc, path, opts = {}) {
  const trainMax = opts.trainMax || 120;
  const segs = [];
  let acc = 0;
  for (const p of path || []) {
    const track = doc.tracks.find(t => t.id === p.trackId);
    const base = Math.min(trainMax, trackMaxSpeed(doc, track));
    const lo = Math.min(p.fromAt, p.toAt), hi = Math.max(p.fromAt, p.toAt);
    const len = hi - lo;
    const forward = p.toAt >= p.fromAt;
    const toLocal = at => (forward ? at - p.fromAt : p.fromAt - at);   // 経路上の距離に変換
    const clamp01 = v => Math.max(0, Math.min(len, v));

    const gaps = trackGaps(doc, p.trackId)
      .filter(g => g.at >= lo - 1e-6 && g.at <= hi + 1e-6)
      .map(g => ({ at: clamp01(toLocal(g.at)), extraM: g.extraM }))
      .sort((a, b) => a.at - b.at);

    const limits = speedLimitsOn(doc, p.trackId)
      .filter(l => l.to >= lo && l.from <= hi)
      .map(l => {
        const a = toLocal(l.from), b = toLocal(l.to);
        return { from: clamp01(Math.min(a, b)), to: clamp01(Math.max(a, b)), limit: l.limit };
      })
      .filter(l => l.to - l.from > 1e-6);

    // 制限の境目と省略の位置で区切る
    const bounds = new Set([0, len]);
    for (const l of limits) { bounds.add(l.from); bounds.add(l.to); }
    for (const g of gaps) bounds.add(g.at);
    const sorted = [...bounds].filter(v => v >= -1e-6 && v <= len + 1e-6).sort((a, b) => a - b);

    let extraSoFar = 0;
    const limitAt = x => {
      let lim = base;
      for (const l of limits) if (x >= l.from - 1e-6 && x <= l.to + 1e-6) lim = Math.min(lim, l.limit);
      return lim;
    };
    const insertGaps = (x) => {
      for (const g of gaps) {
        if (Math.abs(g.at - x) > 1e-6) continue;
        const from = acc + x + extraSoFar;
        // 省略区間は、その先の制限（＝周囲の本来の制限）を引き継ぐ
        segs.push({ from, to: from + g.extraM, limit: limitAt(Math.min(len, x + 0.01)), gap: true });
        extraSoFar += g.extraM;
      }
    };
    insertGaps(0);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      if (b - a > 1e-6) {
        segs.push({ from: acc + a + extraSoFar, to: acc + b + extraSoFar, limit: limitAt((a + b) / 2) });
      }
      insertGaps(b);
    }
    acc += len + extraSoFar;
  }

  // 分岐側を通る分岐器の制限
  for (const to of opts.turnouts || []) {
    if (!to || !to.index) continue;                      // index 0 は定位（直進）
    const o = doc.objects.find(x => x.id === to.objectId);
    if (!o) continue;
    const at = positionOnPath(doc, path, o.x, o.y);
    if (at == null) continue;
    const lim = Number.isFinite(o.divergeSpeedKmh) && o.divergeSpeedKmh > 0
      ? o.divergeSpeedKmh
      : (doc.settings.divergeSpeedKmh ?? DEFAULT_DIVERGE_KMH);
    segs.push({ from: at - TURNOUT_LIMIT_SPAN / 2, to: at + TURNOUT_LIMIT_SPAN / 2, limit: lim, turnout: true });
  }
  return segs;
}

/** 経路上のある地点（ワールド座標）の、経路始点からの距離 */
export function positionOnPath(doc, path, x, y) {
  let acc = 0, best = null;
  for (const p of path || []) {
    const t = doc.tracks.find(tt => tt.id === p.trackId);
    const len = Math.abs(p.toAt - p.fromAt);
    if (t && t.points && t.points.length >= 2) {
      const r = distToPolyline(x, y, t.points);
      const lo = Math.min(p.fromAt, p.toAt), hi = Math.max(p.fromAt, p.toAt);
      if (r.d < 25 && r.at >= lo - 5 && r.at <= hi + 5) {
        const local = p.toAt >= p.fromAt ? r.at - p.fromAt : p.fromAt - r.at;
        if (!best || r.d < best.d) best = { d: r.d, at: acc + local };
      }
    }
    acc += len;
  }
  return best ? best.at : null;
}

/**
 * 速度上限プロファイルに加減速の制約をかけ、所要時間と速度曲線を求める
 * @returns {{time, xs, vs, length, vmax}} 距離[m]と速度[m/s]の配列
 */
export function runCurve(length, profile, opts = {}) {
  const accel = opts.accel ?? DEFAULT_ACCEL;
  const decel = opts.decel ?? DEFAULT_DECEL;
  const vStart = ms(opts.startKmh ?? 0);
  const vEnd = ms(opts.endKmh ?? 0);
  const L = Math.max(1, length);
  const n = Math.max(20, Math.min(4000, Math.ceil(L / 5)));
  const dx = L / n;

  // 上限（m/s）
  const ceil = new Float64Array(n + 1);
  const baseMax = ms(opts.maxKmh ?? DEFAULT_LINE_KMH);
  for (let i = 0; i <= n; i++) {
    const x = i * dx;
    let v = baseMax;
    for (const s of profile) {
      if (x >= s.from - 1e-6 && x <= s.to + 1e-6) v = Math.min(v, ms(s.limit));
    }
    ceil[i] = Math.max(ms(5), v);
  }

  const v = new Float64Array(n + 1);
  // 後ろから：制限まで減速できるように
  v[n] = Math.min(ceil[n], vEnd);
  for (let i = n - 1; i >= 0; i--) {
    v[i] = Math.min(ceil[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * decel * dx));
  }
  // 前から：加速の制約
  v[0] = Math.min(v[0], Math.max(vStart, 0));
  for (let i = 1; i <= n; i++) {
    v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * accel * dx));
  }

  let time = 0;
  for (let i = 0; i < n; i++) {
    const vm = Math.max(0.5, (v[i] + v[i + 1]) / 2);
    time += dx / vm;
  }
  let vmax = 0;
  for (let i = 0; i <= n; i++) vmax = Math.max(vmax, v[i]);
  return { time, xs: { dx, n }, vs: v, length: L, vmax: kmh(vmax) };
}

/** 走行曲線上のある地点の速度[m/s] */
export function speedAt(curve, x) {
  if (!curve) return 0;
  const { dx, n } = curve.xs;
  const i = Math.max(0, Math.min(n, Math.floor(x / dx)));
  const j = Math.min(n, i + 1);
  const f = Math.max(0, Math.min(1, (x - i * dx) / dx));
  return curve.vs[i] * (1 - f) + curve.vs[j] * f;
}

/** 経路と列車条件から所要時間[s]と曲線を求める */
export function runTimeForPath(doc, path, opts = {}) {
  const profile = profileFromPath(doc, path, opts);
  const length = (path || []).reduce((s, p) => s + Math.abs(p.toAt - p.fromAt), 0)
    + profile.filter(s => s.gap).reduce((s, g) => s + (g.to - g.from), 0);
  const curve = runCurve(length, profile, {
    accel: doc.settings.accelMs2 ?? DEFAULT_ACCEL,
    decel: doc.settings.decelMs2 ?? DEFAULT_DECEL,
    maxKmh: opts.trainMax ?? 120,
    startKmh: opts.startKmh ?? 0,
    endKmh: opts.endKmh ?? 0,
  });
  return { ...curve, profile };
}
