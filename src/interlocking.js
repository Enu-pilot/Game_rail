// 進路（連動）の構成・競合判定・信号現示

import { objectDef } from './catalog.js';
import { distToPolyline, polylineLength } from './geom.js';
import { formationsOn, formationRangesOn } from './store.js';
import { nodeRoutes, currentNodeRoute, endType, DEFAULT_MAX_TURN, crossoverUnits } from './topology.js';

/** 信号機・入換標識のオブジェクトか */
export const isSignal = o => !!objectDef(o.type).signal;
export const isShuntSignal = o => !!objectDef(o.type).shunt;

/** 線路上での信号機の位置（始端からの距離[m]） */
export function signalAt(doc, o) {
  const t = doc.tracks.find(x => x.id === o.trackId);
  if (!t || !t.points || t.points.length < 2) return null;
  return distToPolyline(o.x, o.y, t.points).at;
}

/** 経路の最初の区間から、進行方向（'ab' = 始端→終端）を求める */
export function travelDirOf(seg) {
  return seg.toAt >= seg.fromAt ? 'ab' : 'ba';
}

/** 進路（leg）の入口となる信号機を探す */
export function findEntranceSignal(doc, leg) {
  const seg = leg.path && leg.path[0];
  if (!seg) return null;
  const trackId = leg.originTrackId || seg.trackId;
  const dir = leg.originDir || travelDirOf(seg);
  const startAt = leg.originTrackId && leg.originTrackId !== seg.trackId
    ? (dir === 'ab' ? Infinity : -Infinity)   // 起点線路の出口側
    : seg.fromAt;
  const cands = doc.objects.filter(o => isSignal(o) && o.trackId === trackId && (o.dir || 'ab') === dir);
  if (!cands.length) return null;
  let best = null;
  for (const o of cands) {
    const at = signalAt(doc, o);
    if (at == null) continue;
    // 進行方向の出口側にあるものを優先
    const d = Number.isFinite(startAt) ? (dir === 'ab' ? startAt - at : at - startAt) : 0;
    const score = Number.isFinite(startAt) ? (d >= -20 ? Math.abs(d) : 1e6 + Math.abs(d)) : (dir === 'ab' ? -at : at);
    if (!best || score < best.score) best = { o, score };
  }
  return best ? best.o : null;
}

/** 探索結果の1区間（折返しで区切られた leg）から進路レコードを作る */
export function routeFromLeg(doc, leg, { name, toExt } = {}) {
  const sig = findEntranceSignal(doc, leg);
  const distance = leg.path.reduce((s, p) => s + Math.abs(p.toAt - p.fromAt), 0);
  const last = leg.path[leg.path.length - 1];
  return {
    id: `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name || `${leg.fromName} → ${toExt ? '場外' : leg.toName}`,
    fromTrackId: leg.originTrackId || (leg.path[0] && leg.path[0].trackId) || null,
    toTrackId: toExt ? null : (last ? last.trackId : null),
    toExt: !!toExt,
    path: leg.path.map(p => ({ trackId: p.trackId, fromAt: p.fromAt, toAt: p.toAt })),
    turnouts: (leg.turnouts || []).map(r => ({ objectId: r.objectId, index: r.index, name: r.name })),
    signalId: sig ? sig.id : null,
    reversals: 0,
    distance,
    set: true,
  };
}

const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 1e-6;

/**
 * 2つの進路が同時に構成できるか。
 * シーサスクロッシングは2本の渡り線がダイヤモンドで交差するため、
 * 別々の渡り線を使う進路どうしも同時には構成できない。
 */
export function conflictsBetween(r1, r2, units = null) {
  const reasons = [];
  if (units) {
    for (const u of units) {
      if (u.kind !== 'scissors') continue;
      const ids = u.connectors.map(c => c.id);
      const a = r1.path.find(p => ids.includes(p.trackId));
      const b = r2.path.find(p => ids.includes(p.trackId));
      if (a && b && a.trackId !== b.trackId) reasons.push('シーサスのダイヤモンドを共用');
    }
  }
  for (const t1 of r1.turnouts) {
    const t2 = r2.turnouts.find(x => x.objectId === t1.objectId);
    if (t2 && t2.index !== t1.index) reasons.push('転てつ器の開通方向が競合');
  }
  for (const p1 of r1.path) {
    for (const p2 of r2.path) {
      if (p1.trackId !== p2.trackId) continue;
      const a0 = Math.min(p1.fromAt, p1.toAt), a1 = Math.max(p1.fromAt, p1.toAt);
      const b0 = Math.min(p2.fromAt, p2.toAt), b1 = Math.max(p2.fromAt, p2.toAt);
      if (overlap(a0, a1, b0, b1)) { reasons.push('線路区間が重複'); break; }
    }
    if (reasons.includes('線路区間が重複')) break;
  }
  return [...new Set(reasons)];
}

/** 構成済みの進路のうち、与えた進路と競合するもの */
export function findConflicts(doc, route, units = null) {
  const out = [];
  for (const r of doc.routes || []) {
    if (!r.set || r.id === route.id) continue;
    const reasons = conflictsBetween(route, r, units);
    if (reasons.length) out.push({ route: r, reasons });
  }
  return out;
}

/** 進路上に在線（留置編成）があるか */
export function routeOccupied(doc, route) {
  const names = [];
  for (const p of route.path) {
    if (p.trackId === route.fromTrackId) continue;      // 出発線自身は除く
    for (const f of formationsOn(doc, p.trackId)) names.push(f.name);
  }
  return [...new Set(names)];
}

/** 進路どおりに分岐器が開通しているか */
export function routeAligned(doc, g, route) {
  for (const t of route.turnouts) {
    const o = doc.objects.find(x => x.id === t.objectId);
    if (!o) return false;
    if ((o.position || 0) !== t.index) return false;
  }
  return true;
}

/* ---------------- 閉塞区間（ブロック）の追跡 ---------------- */

const normAng = a => { let v = a % (Math.PI * 2); if (v > Math.PI) v -= Math.PI * 2; if (v < -Math.PI) v += Math.PI * 2; return v; };
const angleDiff = (a, b) => Math.abs(normAng(a - b));

/** 線路上の距離 at を含む区間を返す */
function edgeAt(g, trackId, at) {
  const edges = g.trackEdges(trackId);
  for (const e of edges) if (at >= e.fromAt - 1e-6 && at <= e.toAt + 1e-6) return e;
  return edges[0] || null;
}

/** 区間を走る向き（'ab' = 始端→終端）で見た、進入ノードと退出ノード */
function edgeEnds(e, dir) {
  return dir === 'ab' ? { from: e.a, to: e.b } : { from: e.b, to: e.a };
}

/**
 * 信号機の内方（front）の閉塞区間を追跡する。
 * 分岐は「構成中の進路」→「分岐器の開通方向」→（分岐器がなければ）最も直進に近い方向 の順で決める。
 */
export function traceBlock(doc, g, signal, { maxEdges = 60, maxLength = 8000 } = {}) {
  const track = doc.tracks.find(t => t.id === signal.trackId);
  if (!track) return null;
  const at0 = signalAt(doc, signal);
  if (at0 == null) return null;
  const maxTurn = (doc.settings.maxTurnDeg ?? DEFAULT_MAX_TURN) * Math.PI / 180;

  let edge = edgeAt(g, track.id, at0);
  if (!edge) return null;
  let dir = signal.dir === 'ba' ? 'ba' : 'ab';
  let cursor = at0;
  const segments = [];
  let nextSignalId = null;
  let endKind = 'unknown';
  let endTrackId = track.id;
  let length = 0;

  for (let step = 0; step < maxEdges && length < maxLength; step++) {
    const t = g.trackById.get(edge.trackId);
    const ends = edgeEnds(edge, dir);
    const spanFrom = step === 0 ? cursor : (dir === 'ab' ? edge.fromAt : edge.toAt);
    const spanTo = dir === 'ab' ? edge.toAt : edge.fromAt;

    // 区間内で同じ向きの次の信号機を探す
    let stopAt = null;
    for (const o of doc.objects) {
      if (!isSignal(o) || o.id === signal.id || o.trackId !== edge.trackId) continue;
      if ((o.dir || 'ab') !== dir) continue;
      const a = signalAt(doc, o);
      if (a == null) continue;
      const ahead = dir === 'ab' ? (a > spanFrom + 1e-6 && a <= spanTo + 1e-6) : (a < spanFrom - 1e-6 && a >= spanTo - 1e-6);
      if (!ahead) continue;
      if (!stopAt || (dir === 'ab' ? a < stopAt.at : a > stopAt.at)) stopAt = { at: a, id: o.id };
    }
    const segEnd = stopAt ? stopAt.at : spanTo;
    segments.push({ trackId: edge.trackId, from: spanFrom, to: segEnd });
    length += Math.abs(segEnd - spanFrom);
    endTrackId = edge.trackId;
    if (stopAt) { nextSignalId = stopAt.id; endKind = 'signal'; break; }

    // 区間の終わり = ノード。次の区間を決める
    const node = g.nodeById.get(ends.to);
    if (!node) { endKind = 'deadend'; break; }
    if (node.turntable) { endKind = 'turntable'; break; }
    const others = node.edges.filter(id => id !== edge.id).map(id => g.edgeById.get(id));
    if (!others.length) {
      // 線路の端。端点種別を見る
      const which = (Math.abs(edge.toAt - (dir === 'ab' ? edge.toAt : edge.fromAt)) < 1e-6 && dir === 'ab') ? 'b' : (dir === 'ab' ? 'b' : 'a');
      endKind = endType(t, which) === 'boundary' ? 'boundary' : (endType(t, which) === 'buffer' ? 'buffer' : 'deadend');
      break;
    }
    const arrive = g.headingOut(edge, ends.to) + Math.PI;
    let nextEdge = null;
    if (node.turnout && !node.turnoutFixed) {
      const cur = currentNodeRoute(doc, g, node.id);
      const r = cur && cur.route;
      if (!r || (r.a !== edge.id && r.b !== edge.id)) { endKind = 'notlined'; break; }
      nextEdge = g.edgeById.get(r.a === edge.id ? r.b : r.a);
    } else {
      let best = null;
      for (const e2 of others) {
        const turn = angleDiff(arrive, g.headingOut(e2, node.id));
        if (turn > maxTurn) continue;
        if (!best || turn < best.turn) best = { e: e2, turn };
      }
      if (!best) { endKind = 'deadend'; break; }
      nextEdge = best.e;
    }
    if (!nextEdge) { endKind = 'deadend'; break; }
    dir = nextEdge.a === node.id ? 'ab' : 'ba';
    edge = nextEdge;
    cursor = dir === 'ab' ? edge.fromAt : edge.toAt;
  }

  // 在線の判定
  const occupied = [];
  for (const seg of segments) {
    const lo = Math.min(seg.from, seg.to), hi = Math.max(seg.from, seg.to);
    for (const r of formationRangesOn(doc, seg.trackId)) {
      if (Math.min(hi, r.end) - Math.max(lo, r.start) > 1e-6) occupied.push(r.formation.name);
    }
  }
  return { segments, nextSignalId, endKind, endTrackId, length, occupied: [...new Set(occupied)] };
}

/**
 * 信号現示の算出
 *  stop     停止（赤）
 *  caution  注意（黄） … 進路内に在線あり、または分岐器が未転換
 *  proceed  進行（緑）
 *  shunt    入換進行（入換信号機・入換標識）
 */
export function computeSignals(doc, g) {
  const signals = doc.objects.filter(isSignal);
  const byId = new Map(signals.map(o => [o.id, o]));
  const blocks = new Map();
  for (const o of signals) blocks.set(o.id, o.trackId ? traceBlock(doc, g, o) : null);

  const routeBySignal = new Map();
  for (const r of doc.routes || []) {
    if (r.set && r.signalId) routeBySignal.set(r.signalId, r);
  }

  const memo = new Map();
  const visiting = new Set();
  const aspectOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 'caution';      // 環状配線での自己参照は安全側に倒す
    visiting.add(id);
    const o = byId.get(id);
    const def = objectDef(o.type);
    const block = blocks.get(id);
    const route = routeBySignal.get(id);
    const lined = route ? routeAligned(doc, g, route) : false;
    let aspect;
    if (!block || !o.trackId) aspect = 'stop';
    else if (block.endKind === 'notlined') aspect = 'stop';
    else if (!def.auto && (!route || !lined)) aspect = 'stop';   // 閉塞信号機以外は進路が必要
    else if (block.occupied.length) aspect = 'stop';
    else if (def.shunt) aspect = 'shunt';
    else {
      const lamps = def.lamps || 3;
      const nx = block.nextSignalId ? aspectOf(block.nextSignalId) : null;
      if (!nx) aspect = block.endKind === 'boundary' ? 'proceed' : 'caution';
      else if (nx === 'stop') aspect = 'caution';
      else if (nx === 'caution') aspect = lamps >= 4 ? 'reduced' : 'proceed';
      else aspect = 'proceed';
    }
    visiting.delete(id);
    memo.set(id, aspect);
    return aspect;
  };

  const out = new Map();
  for (const o of signals) {
    out.set(o.id, {
      aspect: aspectOf(o.id),
      block: blocks.get(o.id),
      route: routeBySignal.get(o.id) || null,
    });
  }
  return out;
}

let _sigCache = { rev: -1, doc: null, map: null };

/** 信号ID → 現示（描画・UI用。版数が同じなら再利用） */
export function signalAspects(doc, g, rev) {
  if (_sigCache.map && _sigCache.rev === rev && _sigCache.doc === doc) return _sigCache.simple;
  const detail = computeSignals(doc, g);
  const simple = new Map([...detail].map(([id, v]) => [id, v.aspect]));
  _sigCache = { rev, doc, map: detail, simple };
  return simple;
}

/** 信号ID → { aspect, block, route } */
export function signalDetails(doc, g, rev) {
  signalAspects(doc, g, rev);
  return _sigCache.map;
}

export const ASPECT_COLORS = {
  stop: '#ff4b41',
  caution: '#ffc233',
  reduced: '#c8d94a',
  proceed: '#3ddc84',
  shunt: '#7fd1ff',
};
export const ASPECT_NAMES = {
  stop: '停止', caution: '注意', reduced: '減速', proceed: '進行', shunt: '入換進行',
};
export const ASPECT_SHORT = {
  stop: 'R', caution: 'Y', reduced: 'YG', proceed: 'G', shunt: '入換',
};

/** 進路の状態まとめ（UI表示用） */
export function routeStatus(doc, g, route) {
  const aligned = routeAligned(doc, g, route);
  const occupied = routeOccupied(doc, route);
  const conflicts = route.set ? findConflicts(doc, route, crossoverUnits(doc, g, g.rev ?? 0)) : [];
  const signal = route.signalId ? doc.objects.find(o => o.id === route.signalId) : null;
  let aspect = 'stop';
  if (route.set && aligned) aspect = signal && isShuntSignal(signal) ? 'shunt' : (occupied.length ? 'caution' : 'proceed');
  return { aligned, occupied, conflicts, signal, aspect };
}

export { nodeRoutes, currentNodeRoute, polylineLength };
