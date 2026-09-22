// ドキュメント編集アクション（すべて snapshot() → 変更 → commit() の順で実行）

import { store, snapshot, commit, uid, select, setMessage, trackCapacity, trackLength } from './store.js';
import { objectDef, trackKind, TRACK_KINDS, FORMATION_COLORS, turnoutSize, TURNOUT_TYPE_BY_VARIANT, vehicleDef } from './catalog.js';
import { distToPolyline, pointAt } from './geom.js';

/** 同一種別の連番から線路名を作る */
export function suggestTrackName(kindId) {
  const kind = trackKind(kindId);
  const n = store.doc.tracks.filter(t => t.kind === kindId).length + 1;
  if (kindId === 'stabling') return `${n}番線`;
  return `${kind.name}${n}`;
}

export function addTrack(points, kindId = store.ui.trackKindId, name) {
  snapshot();
  const t = {
    id: uid('t'),
    name: name || suggestTrackName(kindId),
    kind: kindId,
    points: points.map(p => ({ x: p.x, y: p.y })),
    capacityMode: 'auto',
    capacity: 0,
    carLengthM: null,
    ends: { a: 'open', b: 'open' },
    note: '',
  };
  store.doc.tracks.push(t);
  store.ui.sel = { kind: 'track', id: t.id };
  commit('add-track');
  setMessage(`${t.name} を敷設しました（${Math.round(trackLength(t))}m ／ ${trackCapacity(store.doc, t)}両）`);
  return t;
}

/* ---------------- 分岐器の設置 ---------------- */

const VARIANT_TYPE = TURNOUT_TYPE_BY_VARIANT;
const normAng = a => { let v = a % (Math.PI * 2); if (v > Math.PI) v -= Math.PI * 2; if (v < -Math.PI) v += Math.PI * 2; return v; };

/** 指定位置付近に既に置かれている分岐器 */
export function turnoutNear(x, y, maxDist = 14) {
  let best = null;
  for (const o of store.doc.objects) {
    if (objectDef(o.type).shape !== 'turnout') continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d <= maxDist && (!best || d < best.d)) best = { o, d };
  }
  return best ? best.o : null;
}

/** 接続点に分岐器を設置する（topology.turnoutSpecAt の結果を渡す） */
export function placeTurnoutFromSpec(spec, frog = 10) {
  const type = VARIANT_TYPE[spec.variant] || 'turnout_single';
  const def = objectDef(type);
  const sz = def.frog ? turnoutSize(def.variant, frog) : { w: def.w, h: def.h };
  snapshot();
  const o = {
    id: uid('b'), type, x: spec.x, y: spec.y,
    w: sz.w, h: sz.h, rot: spec.rot,
    frog: def.frog ? frog : null, mirror: !!spec.mirror,
    label: '', note: '', trackId: null,
  };
  store.doc.objects.push(o);
  store.ui.sel = { kind: 'object', id: o.id };
  commit('add-turnout');
  setMessage(`${def.name} を接続点に設置しました`);
  return o;
}

/** 接続のない交差点にダイヤモンドクロッシングを設置する */
export function placeCrossingFrom(cross) {
  const def = objectDef('diamond');
  let d = normAng(cross.angB - cross.angA);
  if (d > Math.PI / 2) d -= Math.PI;
  if (d < -Math.PI / 2) d += Math.PI;
  const w = def.w;
  const h = Math.max(4, Math.round(Math.abs(w * Math.sin(d)) * 10) / 10);
  snapshot();
  const o = {
    id: uid('b'), type: 'diamond', x: cross.x, y: cross.y,
    w, h, rot: cross.angA, xang: Math.abs(d),
    frog: null, mirror: d < 0, label: '', note: '', trackId: null,
  };
  store.doc.objects.push(o);
  store.ui.sel = { kind: 'object', id: o.id };
  commit('add-crossing');
  setMessage(`ダイヤモンドクロッシングを設置しました（交差角 ${(Math.abs(d) * 180 / Math.PI).toFixed(0)}°）`);
  return o;
}

/** 最寄りの線路にスナップする（線路上設備用） */
export function snapToTrack(x, y, maxDist = 14) {
  let best = null;
  for (const t of store.doc.tracks) {
    if (!t.points || t.points.length < 2) continue;
    const r = distToPolyline(x, y, t.points);
    if (r.d < maxDist && (!best || r.d < best.d)) best = { track: t, ...r };
  }
  if (!best) return null;
  const p = pointAt(best.track.points, best.at);
  return { x: p.x, y: p.y, rot: p.angle, trackId: best.track.id, name: best.track.name };
}

export function addObject(type, x, y, rot = 0) {
  const def = objectDef(type);
  snapshot();
  const o = {
    id: uid('b'), type,
    x, y, w: def.w, h: def.h, rot,
    frog: def.frog ?? null,
    label: '', note: '', trackId: null,
  };
  if (def.onTrack) {
    const s = snapToTrack(x, y);
    if (s) { o.x = s.x; o.y = s.y; o.rot = s.rot; o.trackId = s.trackId; }
  }
  store.doc.objects.push(o);
  store.ui.sel = { kind: 'object', id: o.id };
  commit('add-object');
  setMessage(`${def.name} を配置しました`);
  return o;
}

export function addFormation(partial = {}) {
  snapshot();
  const n = store.doc.formations.length;
  const vehicle = partial.vehicle || 'emu';
  const vd = vehicleDef(vehicle);
  const defaultCars = { el: 1, dl: 1, sl: 1, mowcar: 1, freight: 12, coach: 6 }[vehicle] ?? 10;
  const f = {
    id: uid('f'),
    name: partial.name || `${String.fromCharCode(65 + (n % 26))}${String(Math.floor(n / 26) + 1).padStart(2, '0')}編成`,
    series: partial.series || '',
    vehicle,
    cars: partial.cars || defaultCars,
    carLengthM: partial.carLengthM ?? null,
    loco: partial.loco || null,
    color: partial.color || (vd.loco ? vd.color : FORMATION_COLORS[n % FORMATION_COLORS.length]),
    trackId: partial.trackId ?? null,
    note: partial.note || '',
  };
  store.doc.formations.push(f);
  store.ui.sel = { kind: 'formation', id: f.id };
  commit('add-formation');
  return f;
}

export function duplicateSelected() {
  const sel = store.ui.sel;
  if (!sel) return;
  snapshot();
  if (sel.kind === 'track') {
    const t = store.doc.tracks.find(i => i.id === sel.id); if (!t) return;
    const copy = JSON.parse(JSON.stringify(t));
    copy.id = uid('t');
    copy.name = `${t.name}のコピー`;
    copy.points = copy.points.map(p => ({ x: p.x, y: p.y + 20 }));
    store.doc.tracks.push(copy);
    store.ui.sel = { kind: 'track', id: copy.id };
  } else if (sel.kind === 'object') {
    const o = store.doc.objects.find(i => i.id === sel.id); if (!o) return;
    const copy = { ...o, id: uid('b'), x: o.x + 20, y: o.y + 20 };
    store.doc.objects.push(copy);
    store.ui.sel = { kind: 'object', id: copy.id };
  } else if (sel.kind === 'formation') {
    const f = store.doc.formations.find(i => i.id === sel.id); if (!f) return;
    const copy = { ...f, id: uid('f'), name: `${f.name}'`, trackId: null };
    store.doc.formations.push(copy);
    store.ui.sel = { kind: 'formation', id: copy.id };
  }
  commit('duplicate');
}

export function deleteSelected() {
  const sel = store.ui.sel;
  if (!sel) return;
  snapshot();
  if (sel.kind === 'track') {
    store.doc.tracks = store.doc.tracks.filter(t => t.id !== sel.id);
    for (const f of store.doc.formations) if (f.trackId === sel.id) f.trackId = null;
    for (const o of store.doc.objects) if (o.trackId === sel.id) o.trackId = null;
  } else if (sel.kind === 'object') {
    store.doc.objects = store.doc.objects.filter(o => o.id !== sel.id);
  } else if (sel.kind === 'formation') {
    store.doc.formations = store.doc.formations.filter(f => f.id !== sel.id);
  }
  store.ui.sel = null;
  commit('delete');
}

/** 編成を線路へ割り当て（容量超過時も許可し警告表示） */
export function assignFormation(formationId, trackId) {
  const f = store.doc.formations.find(i => i.id === formationId);
  if (!f) return;
  snapshot();
  f.trackId = trackId || null;
  commit('assign');
  if (trackId) {
    const t = store.doc.tracks.find(i => i.id === trackId);
    if (t) setMessage(`${f.name}（${f.cars}両）を ${t.name} に留置`);
  } else {
    setMessage(`${f.name} の留置を解除`);
  }
}

export function updateEntity(kind, id, patch, { history = true } = {}) {
  const list = kind === 'track' ? store.doc.tracks : kind === 'object' ? store.doc.objects : store.doc.formations;
  const item = list.find(i => i.id === id);
  if (!item) return;
  if (history) snapshot();
  Object.assign(item, patch);
  commit('update');
}

/** 線路の向き（留置の詰め方向）を反転 */
export function reverseTrack(id) {
  const t = store.doc.tracks.find(i => i.id === id);
  if (!t) return;
  snapshot();
  t.points.reverse();
  commit('reverse');
}

export const TRACK_KIND_OPTIONS = TRACK_KINDS;
export { select };
