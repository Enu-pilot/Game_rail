// ドキュメント編集アクション（すべて snapshot() → 変更 → commit() の順で実行）

import { store, snapshot, commit, uid, select, setMessage, trackCapacity, trackLength } from './store.js';
import { objectDef, trackKind, TRACK_KINDS, FORMATION_COLORS } from './catalog.js';
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
    note: '',
  };
  store.doc.tracks.push(t);
  store.ui.sel = { kind: 'track', id: t.id };
  commit('add-track');
  setMessage(`${t.name} を敷設しました（${Math.round(trackLength(t))}m ／ ${trackCapacity(store.doc, t)}両）`);
  return t;
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
  const f = {
    id: uid('f'),
    name: partial.name || `${String.fromCharCode(65 + (n % 26))}${String(Math.floor(n / 26) + 1).padStart(2, '0')}編成`,
    series: partial.series || '',
    cars: partial.cars || 10,
    carLengthM: partial.carLengthM ?? null,
    color: partial.color || FORMATION_COLORS[n % FORMATION_COLORS.length],
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
