// 入区・出区の効率解析（同時に構成できる進路の数＝同時入線数、ボトルネック、所要時間の見積もり）

import { trackKind } from './catalog.js';
import { findRoute, pathExtra } from './topology.js';
import { formationLength, trackUsage } from './store.js';

/** 2つの経路が同時に成立しないか（分岐器の共用・線路区間の重複） */
function conflict(a, b) {
  for (const id of a.turnoutIds) if (b.turnoutIds.has(id)) return true;
  for (const p of a.path) {
    for (const q of b.path) {
      if (p.trackId !== q.trackId) continue;
      const a0 = Math.min(p.fromAt, p.toAt), a1 = Math.max(p.fromAt, p.toAt);
      const b0 = Math.min(q.fromAt, q.toAt), b1 = Math.max(q.fromAt, q.toAt);
      if (Math.min(a1, b1) - Math.max(a0, b0) > 1e-6) return true;
    }
  }
  return false;
}

/** 最大の「同時に成立する経路の組」を求める（n が大きいときは貪欲法） */
function maxIndependentSet(n, adj) {
  if (n === 0) return [];
  if (n <= 26) {
    let best = 0, bestMask = 0;
    const order = [...Array(n).keys()].sort((a, b) => popcount(adj[a]) - popcount(adj[b]));
    const rec = (i, mask, count) => {
      if (count + (n - i) <= best) return;          // 枝刈り
      if (i === n) { if (count > best) { best = count; bestMask = mask; } return; }
      const v = order[i];
      if (!(mask & adj[v])) rec(i + 1, mask | (1 << v), count + 1);  // 採用
      rec(i + 1, mask, count);                                       // 不採用
    };
    rec(0, 0, 0);
    return [...Array(n).keys()].filter(i => bestMask & (1 << i));
  }
  const order = [...Array(n).keys()].sort((a, b) => popcount(adj[a]) - popcount(adj[b]));
  const chosen = [];
  let mask = 0;
  for (const v of order) {
    if (mask & adj[v]) continue;
    chosen.push(v); mask |= (1 << v) | adj[v];
  }
  return chosen;
}

const popcount = x => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

/**
 * 入線（または出線）の効率解析
 * @param {object} opts
 *   sourceTrackId : 起点の線路（未指定なら場外接続を持つ線路）
 *   targetIds     : 対象の線路ID（未指定なら留置可能な線路すべて）
 *   trainLength   : 想定編成長[m]
 *   reverse       : true なら「対象 → 起点」（出区）で評価する
 */
export function entryAnalysis(doc, g, opts = {}) {
  const settings = doc.settings;
  const trainLength = opts.trainLength ?? (10 * settings.carLengthM);
  const speedKmh = opts.speedKmh ?? settings.shuntSpeedKmh ?? 25;
  const reversalMin = opts.reversalMinutes ?? settings.reversalMinutes ?? 2;
  const reverse = !!opts.reverse;

  let source = opts.sourceTrackId ? doc.tracks.find(t => t.id === opts.sourceTrackId) : null;
  if (!source) source = doc.tracks.find(t => (t.ends && (t.ends.a === 'boundary' || t.ends.b === 'boundary')));
  if (!source) return { ok: false, reason: '起点となる線路（場外接続）がありません' };

  const targets = (opts.targetIds
    ? doc.tracks.filter(t => opts.targetIds.includes(t.id))
    : doc.tracks.filter(t => trackKind(t.kind).stabling && t.id !== source.id));

  const routes = [];
  const unreachable = [];
  for (const t of targets) {
    const r = reverse
      ? findRoute(doc, g, { fromTrackId: t.id, toTrackId: source.id, trainLength })
      : findRoute(doc, g, { fromTrackId: source.id, toTrackId: t.id, trainLength });
    if (!r.found) { unreachable.push(t); continue; }
    const turnoutIds = new Set();
    for (const lg of r.legs || []) for (const to of lg.turnouts) turnoutIds.add(to.objectId);
    const dist = r.distance + pathExtra(doc, r.path);
    routes.push({
      track: t, path: r.path, turnoutIds,
      distance: dist, reversals: r.reversals,
      minutes: (dist / 1000) / speedKmh * 60 + r.reversals * reversalMin,
      warnings: r.warnings,
    });
  }

  // 競合グラフ → 同時に成立する最大の組み合わせ
  const n = routes.length;
  const adj = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (conflict(routes[i], routes[j])) { adj[i] |= (1 << j); adj[j] |= (1 << i); }
    }
  }
  const best = maxIndependentSet(n, adj);
  const simultaneous = best.length;

  // ボトルネック（多くの経路が共用する分岐器・線路）
  const useCount = new Map();
  for (const r of routes) {
    for (const id of r.turnoutIds) useCount.set(`b:${id}`, (useCount.get(`b:${id}`) || 0) + 1);
    for (const p of new Set(r.path.map(x => x.trackId))) useCount.set(`t:${p}`, (useCount.get(`t:${p}`) || 0) + 1);
  }
  const bottlenecks = [...useCount.entries()]
    .map(([k, count]) => {
      const [kind, id] = [k.slice(0, 1), k.slice(2)];
      const name = kind === 'b'
        ? ((doc.objects.find(o => o.id === id) || {}).label || '分岐器')
        : ((doc.tracks.find(t => t.id === id) || {}).name || '線路');
      return { kind: kind === 'b' ? '分岐器' : '線路', id, name, count, share: n ? count / n : 0 };
    })
    .filter(x => x.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const avgMinutes = routes.length ? routes.reduce((s, r) => s + r.minutes, 0) / routes.length : 0;
  const avgDistance = routes.length ? routes.reduce((s, r) => s + r.distance, 0) / routes.length : 0;
  const avgReversals = routes.length ? routes.reduce((s, r) => s + r.reversals, 0) / routes.length : 0;

  // 全編成を捌くのに必要な回数と時間の目安
  const trains = opts.trains ?? doc.formations.length;
  const batches = simultaneous ? Math.ceil(trains / simultaneous) : 0;
  const totalMinutes = batches * avgMinutes;

  return {
    ok: true,
    reverse,
    source, targets,
    routes: routes.sort((a, b) => a.minutes - b.minutes),
    unreachable,
    simultaneous,
    bottlenecks,
    bestSet: best.map(i => routes[i].track),
    parallelism: routes.length ? simultaneous / routes.length : 0,
    avgMinutes, avgDistance, avgReversals,
    trains, batches, totalMinutes,
    speedKmh, reversalMin, trainLength,
  };
}

/** 留置線の使用状況サマリ（入線余力） */
export function stablingSummary(doc) {
  const rows = doc.tracks.filter(t => trackKind(t.kind).stabling).map(t => {
    const u = trackUsage(doc, t);
    return { track: t, ...u, free: Math.max(0, u.capacity - u.cars) };
  });
  return {
    rows,
    freeCars: rows.reduce((s, r) => s + r.free, 0),
    emptyTracks: rows.filter(r => !r.cars).length,
  };
}

export { formationLength };
