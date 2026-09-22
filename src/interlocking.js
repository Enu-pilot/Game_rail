// 進路（連動）の構成・競合判定・信号現示

import { objectDef } from './catalog.js';
import { distToPolyline, polylineLength } from './geom.js';
import { formationsOn } from './store.js';
import { nodeRoutes, currentNodeRoute } from './topology.js';

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

/** 2つの進路が同時に構成できるか */
export function conflictsBetween(r1, r2) {
  const reasons = [];
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
export function findConflicts(doc, route) {
  const out = [];
  for (const r of doc.routes || []) {
    if (!r.set || r.id === route.id) continue;
    const reasons = conflictsBetween(route, r);
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

/**
 * 信号現示の算出
 *  stop     停止（赤）
 *  caution  注意（黄） … 進路内に在線あり、または分岐器が未転換
 *  proceed  進行（緑）
 *  shunt    入換進行（入換信号機・入換標識）
 */
export function signalAspects(doc, g) {
  const map = new Map();
  for (const o of doc.objects) if (isSignal(o)) map.set(o.id, 'stop');
  for (const r of doc.routes || []) {
    if (!r.set || !r.signalId || !map.has(r.signalId)) continue;
    const o = doc.objects.find(x => x.id === r.signalId);
    const aligned = routeAligned(doc, g, r);
    const occupied = routeOccupied(doc, r);
    let aspect;
    if (!aligned) aspect = 'stop';
    else if (isShuntSignal(o)) aspect = 'shunt';
    else aspect = occupied.length ? 'caution' : 'proceed';
    map.set(r.signalId, aspect);
  }
  return map;
}

export const ASPECT_COLORS = {
  stop: '#ff4b41',
  caution: '#ffc233',
  proceed: '#3ddc84',
  shunt: '#7fd1ff',
};
export const ASPECT_NAMES = {
  stop: '停止', caution: '注意', proceed: '進行', shunt: '入換進行',
};

/** 進路の状態まとめ（UI表示用） */
export function routeStatus(doc, g, route) {
  const aligned = routeAligned(doc, g, route);
  const occupied = routeOccupied(doc, route);
  const conflicts = route.set ? findConflicts(doc, route) : [];
  const signal = route.signalId ? doc.objects.find(o => o.id === route.signalId) : null;
  let aspect = 'stop';
  if (route.set && aligned) aspect = signal && isShuntSignal(signal) ? 'shunt' : (occupied.length ? 'caution' : 'proceed');
  return { aligned, occupied, conflicts, signal, aspect };
}

export { nodeRoutes, currentNodeRoute, polylineLength };
