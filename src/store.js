// アプリケーション状態（ドキュメント + UI状態）と派生計算

import { polylineLength } from './geom.js';
import { trackKind } from './catalog.js';

export const STORAGE_KEY = 'game_rail.depot.v1';
export const DOC_VERSION = 1;

let seq = 0;
export const uid = (p = 'o') => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function defaultSettings() {
  return {
    gridM: 5,           // グリッド1マスのメートル数
    carLengthM: 20,     // 1両あたりの標準長（連結面間）
    clearanceM: 10,     // 線路端部の余裕長（車止め等）
    showGrid: true,
    showLabels: true,
    showFormations: true,
    showRuler: true,
    snap: true,
    angle45: true,      // 線路敷設を45度刻みに拘束
    showJunctions: true,// 線路どうしの接続点を表示
    showIssues: true,   // 検証結果を図上に表示
    maxTurnDeg: 90,     // 折返しなしで通過できる最大転向角[度]
    minTrackSpacingM: 4.0,  // 線路中心間隔の最小値[m]
    clearanceHalfM: 1.9,    // 建築限界の片側幅[m]
  };
}

export function newDoc(name = '無題の車両基地') {
  return {
    version: DOC_VERSION,
    name,
    settings: defaultSettings(),
    tracks: [],
    objects: [],
    formations: [],
  };
}

export const store = {
  doc: newDoc(),
  rev: 0,            // ドキュメントの版数（グラフ再構築の判定に使用）
  ui: {
    tool: 'select',          // select | track | place | pan
    trackKindId: 'stabling', // 次に敷設する線路の種別
    placeType: null,         // 配置待ちの構造物ID
    sel: null,               // { kind:'track'|'object'|'formation', id }
    camera: { x: -40, y: -40, zoom: 0.9 }, // x,y = 画面左上のワールド座標[m], zoom = px/m
    draft: null,             // 敷設中のポリライン
    cursor: null,            // ワールド座標
    message: '',
  },
  _subs: new Set(),
  _history: [],
  _future: [],
  _saveTimer: 0,
};

export function subscribe(fn) { store._subs.add(fn); return () => store._subs.delete(fn); }
export function emit(reason = '') { for (const fn of store._subs) fn(reason); }

/** 変更前に呼ぶ: 現在のドキュメントを履歴に積む */
export function snapshot() {
  store._history.push(JSON.stringify(store.doc));
  if (store._history.length > 100) store._history.shift();
  store._future.length = 0;
}

export function commit(reason = 'change') {
  store.rev++;
  scheduleSave();
  emit(reason);
}

export function undo() {
  if (!store._history.length) return false;
  store._future.push(JSON.stringify(store.doc));
  store.doc = JSON.parse(store._history.pop());
  validateSelection();
  commit('undo');
  return true;
}

export function redo() {
  if (!store._future.length) return false;
  store._history.push(JSON.stringify(store.doc));
  store.doc = JSON.parse(store._future.pop());
  validateSelection();
  commit('redo');
  return true;
}

export function canUndo() { return store._history.length > 0; }
export function canRedo() { return store._future.length > 0; }

export function loadDoc(doc, { resetHistory = true } = {}) {
  store.doc = migrate(doc);
  store.rev++;
  if (resetHistory) { store._history.length = 0; store._future.length = 0; }
  store.ui.sel = null;
  store.ui.draft = null;
  store.ui.route = null;
  commit('load');
}

export function migrate(doc) {
  const d = { ...newDoc(), ...doc };
  d.settings = { ...defaultSettings(), ...(doc.settings || {}) };
  d.tracks = (doc.tracks || []).map(t => ({
    id: t.id || uid('t'), name: t.name || '無名線', kind: t.kind || 'other',
    points: (t.points || []).map(p => ({ x: +p.x || 0, y: +p.y || 0 })),
    capacityMode: t.capacityMode === 'manual' ? 'manual' : 'auto',
    capacity: Number.isFinite(t.capacity) ? t.capacity : 0,
    carLengthM: Number.isFinite(t.carLengthM) ? t.carLengthM : null,
    ends: { a: (t.ends && t.ends.a) || 'open', b: (t.ends && t.ends.b) || 'open' },
    note: t.note || '',
  }));
  d.objects = (doc.objects || []).map(o => ({
    id: o.id || uid('b'), type: o.type || 'station_bldg',
    x: +o.x || 0, y: +o.y || 0, w: +o.w || 20, h: +o.h || 10, rot: +o.rot || 0,
    frog: Number.isFinite(o.frog) ? o.frog : null,
    mirror: !!o.mirror,
    xang: Number.isFinite(o.xang) ? o.xang : null,   // 平面交差の交差角[rad]
    label: o.label ?? '', note: o.note || '', trackId: o.trackId || null,
  }));
  d.formations = (doc.formations || []).map(f => ({
    id: f.id || uid('f'), name: f.name || '編成', series: f.series || '',
    cars: Math.max(1, +f.cars || 1),
    carLengthM: Number.isFinite(f.carLengthM) ? f.carLengthM : null,
    color: f.color || '#4f8cff', trackId: f.trackId || null, note: f.note || '',
  }));
  d.version = DOC_VERSION;
  return d;
}

function validateSelection() {
  const s = store.ui.sel;
  if (!s) return;
  const list = s.kind === 'track' ? store.doc.tracks : s.kind === 'object' ? store.doc.objects : store.doc.formations;
  if (!list.some(i => i.id === s.id)) store.ui.sel = null;
}

/* ---------------- 派生計算 ---------------- */

export const trackLength = t => polylineLength(t.points || []);

export function trackCarLength(doc, t) {
  return (t && Number.isFinite(t.carLengthM) && t.carLengthM > 0) ? t.carLengthM : doc.settings.carLengthM;
}

/** 留置可能両数 */
export function trackCapacity(doc, t) {
  if (t.capacityMode === 'manual') return Math.max(0, Math.round(t.capacity || 0));
  const usable = trackLength(t) - (doc.settings.clearanceM || 0);
  const cl = trackCarLength(doc, t);
  return Math.max(0, Math.floor(usable / cl));
}

export const formationsOn = (doc, trackId) => doc.formations.filter(f => f.trackId === trackId);

export function formationLength(doc, f) {
  const cl = Number.isFinite(f.carLengthM) && f.carLengthM > 0 ? f.carLengthM : doc.settings.carLengthM;
  return f.cars * cl;
}

/** 線路の留置状況 */
export function trackUsage(doc, t) {
  const list = formationsOn(doc, t.id);
  const cars = list.reduce((s, f) => s + f.cars, 0);
  const lengthUsed = list.reduce((s, f) => s + formationLength(doc, f), 0);
  const capacity = trackCapacity(doc, t);
  const usable = Math.max(0, trackLength(t) - (doc.settings.clearanceM || 0));
  return { list, cars, capacity, lengthUsed, usable, over: cars > capacity || lengthUsed > usable + 1e-6 };
}

export function summary(doc) {
  let capacity = 0, cars = 0, stablingTracks = 0, totalLength = 0;
  for (const t of doc.tracks) {
    totalLength += trackLength(t);
    if (trackKind(t.kind).stabling) { capacity += trackCapacity(doc, t); stablingTracks++; }
  }
  for (const f of doc.formations) if (f.trackId) cars += f.cars;
  const unassigned = doc.formations.filter(f => !f.trackId);
  return {
    tracks: doc.tracks.length, stablingTracks, capacity, cars,
    formations: doc.formations.length,
    unassignedCars: unassigned.reduce((s, f) => s + f.cars, 0),
    unassigned: unassigned.length,
    objects: doc.objects.length,
    totalLength,
    rate: capacity ? cars / capacity : 0,
  };
}

/* ---------------- 保存 ---------------- */

export function scheduleSave() {
  clearTimeout(store._saveTimer);
  store._saveTimer = setTimeout(saveLocal, 400);
}

export function saveLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store.doc)); } catch (e) { /* 容量超過などは無視 */ }
}

export function restoreLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    store.doc = migrate(JSON.parse(raw));
    return true;
  } catch (e) { return false; }
}

export function setMessage(msg) { store.ui.message = msg; emit('message'); }
export function select(kind, id) { store.ui.sel = id ? { kind, id } : null; emit('select'); }
export function findTrack(id) { return store.doc.tracks.find(t => t.id === id) || null; }
export function findObject(id) { return store.doc.objects.find(o => o.id === id) || null; }
export function findFormation(id) { return store.doc.formations.find(f => f.id === id) || null; }
