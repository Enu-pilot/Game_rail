// アプリケーション状態（ドキュメント + UI状態）と派生計算

import { polylineLength } from './geom.js';
import { trackKind, vehicleDef, objectDef } from './catalog.js';

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
    showRoutes: true,   // 構成済みの進路を図上に表示
    maxTurnDeg: 90,     // 折返しなしで通過できる最大転向角[度]
    shuntSpeedKmh: 25,      // 入換の想定速度[km/h]
    defaultMaxSpeedKmh: 100,// 線路の既定の最高速度[km/h]
    divergeSpeedKmh: 35,    // 分岐器の分岐側の制限[km/h]
    accelMs2: 0.65,         // 加速度[m/s^2]
    // --- 経営 ---
    capacityPerCar: 140,    // 1両あたりの定員[人]
    maxLoadFactor: 2.0,     // 乗車率の上限（超える分は積み残し）
    dailyTripRate: 0.4,     // 人口あたりの1日利用回数
    demandDecayKm: 12,      // 距離による需要の減衰
    fareBase: 140,          // 初乗り運賃[円]
    farePerKm: 14,          // 距離加算[円/km]
    fareCap: 1200,          // 運賃の上限[円]
    costPerCarKm: 450,      // 運行費（電力・乗務員・検査）[円/車両km]
    costPerCarDay: 15000,   // 車両費（償却・保有）[円/両・日]
    settlementPerCarKm: 60,     // 直通の車両使用料[円/車両km]
    inspectCostPerCarKm: 8,      // 検査費（走行に比例）[円/車両km]
    inspectCostPerCarDay: 4500,  // 検査費（時間で来る分）[円/両日]
    costPerRouteKmDay: 200000,  // 線路・電路の保守[円/km・日]
    costPerStationDay: 250000,  // 駅運営[円/駅・日]
    costPerDepotTrackDay: 20000,// 車両基地[円/線・日]
    targetCongestion: 180,  // 目標のピーク混雑率[%]
    targetWaitMin: 8,       // 目標の平均待ち時間[分]
    // --- 長期経営 ---
    startCashOku: 60,       // 初期資金[億円]
    debtLimitOku: 300,      // 借入枠[億円]
    interestRate: 0.02,     // 金利[/年]
    operatingDaysFactor: 340,   // 年間の営業日換算
    capexPerTrackKmOku: 18,     // 線路の建設費[億円/km]
    capexPerStationOku: 25,     // 駅の建設費[億円/駅]
    capexPerCarOku: 1.6,        // 車両の価格[億円/両]
    capexPerDepotTrackOku: 2.5, // 基地・側線[億円/線]
    capexPerBuildingOku: 1.2,   // 建物[億円/棟]
    baseGrowthPct: 0.4,     // 沿線人口の基礎成長率[%/年]
    targetCashOku: 400,     // 目標の純資産[億円]
    targetYears: 10,        // 目標年数
    decelMs2: 0.9,          // 減速度[m/s^2]
    reversalMinutes: 2,     // 折返し1回あたりの所要時間[分]
    liningSeconds: 20,      // 進路構成（転てつ・鎖錠）の所要時間[秒]
    minHeadwaySec: 90,      // 同一方向の最小運転時隔[秒]
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
    routes: [],        // 構成済みの進路（連動）
    operators: [],     // 事業者（相互直通の相手を含む）
    throughLines: [],  // 直通先（他社線）
    lines: [],         // 路線（駅の並び）
    trains: [],        // ダイヤの列車（スジ）
    company: null,     // 長期経営（資金・決算履歴）
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
    maxSpeedKmh: Number.isFinite(t.maxSpeedKmh) ? t.maxSpeedKmh : null,
    note: t.note || '',
  }));
  d.objects = (doc.objects || []).map(o => {
    const type = o.type || 'station_bldg';
    const def = objectDef(type);
    const isTurnout = def.shape === 'turnout';
    return {
      id: o.id || uid('b'), type,
      x: +o.x || 0, y: +o.y || 0,
      // 分岐器は結節点の記号なので寸法はカタログの公称値に統一する
      w: isTurnout ? def.w : (+o.w || 20),
      h: isTurnout ? def.h : (+o.h || 10),
      rot: +o.rot || 0,
      mirror: !!o.mirror,
      position: Number.isFinite(o.position) ? o.position : 0,   // 分岐器の開通方向（0=定位）
      dir: o.dir === 'ba' ? 'ba' : 'ab',                        // 信号機が防護する進行方向
      tracks: Array.isArray(o.tracks) ? o.tracks.slice() : [],  // 駅の発着線（番線）
      extraM: Number.isFinite(o.extraM) ? o.extraM : 2000,      // 駅間省略で足す距離[m]
      population: Number.isFinite(o.population) ? o.population : 20000,  // 駅勢圏人口
      jobs: Number.isFinite(o.jobs) ? o.jobs : 4000,                     // 就業・集客力
      kindId: o.kindId || 'residential',                                 // 駅の性格
      limitKmh: Number.isFinite(o.limitKmh) ? o.limitKmh : 45,  // 速度制限標
      lengthM: Number.isFinite(o.lengthM) ? o.lengthM : 200,
      divergeSpeedKmh: Number.isFinite(o.divergeSpeedKmh) ? o.divergeSpeedKmh : null,
      xang: Number.isFinite(o.xang) ? o.xang : null,   // 平面交差の交差角[rad]
      label: o.label ?? '', note: o.note || '', trackId: o.trackId || null,
    };
  });
  d.formations = (doc.formations || []).map(f => ({
    id: f.id || uid('f'), name: f.name || '編成', series: f.series || '',
    vehicle: f.vehicle || 'emu',
    cars: Math.max(1, +f.cars || 1),
    carLengthM: Number.isFinite(f.carLengthM) ? f.carLengthM : null,
    loco: f.loco && f.loco.type
      ? { type: f.loco.type, count: Math.max(1, Math.min(3, +f.loco.count || 1)) }
      : null,
    color: f.color || '#4f8cff', trackId: f.trackId || null, note: f.note || '',
    operatorId: f.operatorId || null,                             // 所属事業者
    safety: Array.isArray(f.safety) ? f.safety.slice() : [],      // 搭載する保安装置
    odoKm: Number.isFinite(f.odoKm) ? f.odoKm : 0,                // 累計走行キロ
    inspection: (f.inspection && typeof f.inspection === 'object') ? f.inspection : null,
  }));
  d.routes = (doc.routes || []).map(r => ({
    id: r.id || uid('r'),
    name: r.name || '進路',
    fromTrackId: r.fromTrackId || null,
    toTrackId: r.toTrackId || null,
    toExt: !!r.toExt,
    path: (r.path || []).map(p => ({ trackId: p.trackId, fromAt: +p.fromAt || 0, toAt: +p.toAt || 0 })),
    turnouts: (r.turnouts || []).map(t => ({ objectId: t.objectId, index: +t.index || 0, name: t.name || '' })),
    signalId: r.signalId || null,
    reversals: +r.reversals || 0,
    distance: +r.distance || 0,
    set: r.set !== false,
  }));
  d.operators = (doc.operators || []).map(o => ({
    id: o.id || uid('op'),
    name: o.name || '事業者',
    short: o.short || (o.name || '社').slice(0, 1),
    color: o.color || '#7fd1ff',
    self: !!o.self,
  }));
  d.throughLines = (doc.throughLines || []).map(t => ({
    id: t.id || uid('th'),
    name: t.name || '直通先',
    operatorId: t.operatorId || null,
    lineId: t.lineId || null,            // 自社のどの路線から出ていくか
    stationIdx: Number.isFinite(t.stationIdx) ? t.stationIdx : 0,  // 境界駅（路線内の駅番号）
    safety: Array.isArray(t.safety) ? t.safety.slice() : [],
    maxCars: Number.isFinite(t.maxCars) ? t.maxCars : 10,
    km: Number.isFinite(t.km) ? t.km : 10,
    runMin: Number.isFinite(t.runMin) ? t.runMin : 20,
    dailyPassengers: Number.isFinite(t.dailyPassengers) ? t.dailyPassengers : 0,
    viaIds: Array.isArray(t.viaIds) ? t.viaIds.slice() : [],     // ここへ行くまでに経由する他社線
    suspended: !!t.suspended,            // 直通中止
    delayMin: Number.isFinite(t.delayMin) ? t.delayMin : 0,       // 直通先の遅れ
    note: t.note || '',
  }));
  d.lines = (doc.lines || []).map(l => ({
    id: l.id || uid('l'),
    name: l.name || '路線',
    color: l.color || '#7fd1ff',
    double: l.double !== false,          // 既定の線路条件（複線かどうか）
    secSingle: (l.secSingle && typeof l.secSingle === 'object') ? { ...l.secSingle } : {},  // 駅間ごとの単線指定
    operatorId: l.operatorId || null,
    safety: Array.isArray(l.safety) ? l.safety.slice() : [],     // 走るのに必要な保安装置
    maxCars: Number.isFinite(l.maxCars) ? l.maxCars : 10,        // ホーム有効長（両数）
    stations: (l.stations || []).map(s2 => (typeof s2 === 'string' ? s2 : s2.objectId)).filter(Boolean),
  }));
  d.trains = (doc.trains || []).map(t => ({
    id: t.id || uid('tr'),
    lineId: t.lineId || null,
    number: t.number || '',
    name: t.name || '',
    type: t.type || 'local',
    dir: t.dir === 'up' ? 'up' : 'down',
    fromIdx: Number.isFinite(t.fromIdx) ? t.fromIdx : 0,
    toIdx: Number.isFinite(t.toIdx) ? t.toIdx : 1,
    departSec: Number.isFinite(t.departSec) ? t.departSec : 6 * 3600,
    speedKmh: Number.isFinite(t.speedKmh) ? t.speedKmh : 60,
    dwellSec: Number.isFinite(t.dwellSec) ? t.dwellSec : 30,
    skip: Array.isArray(t.skip) ? t.skip.slice() : [],
    cars: Number.isFinite(t.cars) ? t.cars : 10,
    platforms: (t.platforms && typeof t.platforms === 'object') ? { ...t.platforms } : {},
    holds: (t.holds && typeof t.holds === 'object') ? { ...t.holds } : {},   // 駅での運転停車・待避の延長[秒]
    toDepot: !!t.toDepot,
    depotTrackId: t.depotTrackId || null,
    throughId: t.throughId || null,        // 直通先（終端から他社線へ乗り入れる）
    delaySec: Number.isFinite(t.delaySec) ? t.delaySec : 0,   // 遅延（運転整理）
    operatorId: t.operatorId || null,      // 担当する事業者（他社車両の列車）
    color: t.color || null,
    formationId: t.formationId || null,
    note: t.note || '',
  }));
  d.company = doc.company && typeof doc.company === 'object' ? {
    year: Math.max(1, +doc.company.year || 1),
    cash: +doc.company.cash || 0,
    debt: +doc.company.debt || 0,
    economy: +doc.company.economy || 0,
    seed: +doc.company.seed || 12345,
    assets: doc.company.assets || null,
    history: Array.isArray(doc.company.history) ? doc.company.history : [],
    events: Array.isArray(doc.company.events) ? doc.company.events : [],
  } : null;
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

/** 編成中の1両（本体側）の長さ */
export function formationCarLength(doc, f) {
  if (Number.isFinite(f.carLengthM) && f.carLengthM > 0) return f.carLengthM;
  const v = vehicleDef(f.vehicle);
  return v.len || doc.settings.carLengthM;
}

/** 牽引機を含む車両数 */
export function formationCars(f) {
  return (f.cars || 0) + (f.loco ? f.loco.count : 0);
}

/** 牽引機を含む編成長 */
export function formationLength(doc, f) {
  const body = f.cars * formationCarLength(doc, f);
  const loco = f.loco ? vehicleDef(f.loco.type).len * f.loco.count : 0;
  return body + loco;
}

/** 編成を構成する車両を先頭から並べる（描画・明細用） */
export function formationVehicles(doc, f) {
  const out = [];
  if (f.loco) {
    const lv = vehicleDef(f.loco.type);
    for (let i = 0; i < f.loco.count; i++) out.push({ type: f.loco.type, len: lv.len, color: lv.color, loco: true });
  }
  const cl = formationCarLength(doc, f);
  const v = vehicleDef(f.vehicle);
  for (let i = 0; i < f.cars; i++) out.push({ type: f.vehicle, len: cl, color: f.color || v.color, loco: false });
  return out;
}

/** 線路上での各編成の占有範囲（始端からの距離[m]） */
export function formationRangesOn(doc, trackId) {
  const list = formationsOn(doc, trackId);
  const out = [];
  let cursor = (doc.settings.clearanceM || 0) / 2;
  for (const f of list) {
    const len = formationLength(doc, f);
    out.push({ formation: f, start: cursor, end: cursor + len });
    cursor += len + 3;
  }
  return out;
}

/** 線路の留置状況 */
export function trackUsage(doc, t) {
  const list = formationsOn(doc, t.id);
  const cars = list.reduce((s, f) => s + formationCars(f), 0);
  const lengthUsed = list.reduce((s, f) => s + formationLength(doc, f), 0);
  const capacity = trackCapacity(doc, t);
  const usable = Math.max(0, trackLength(t) - (doc.settings.clearanceM || 0));
  // 実長で判定する（車種により1両長が異なるため）。手入力の上限両数を超えた場合も超過とする。
  const over = lengthUsed > usable + 1e-6 || (t.capacityMode === 'manual' && cars > capacity);
  return { list, cars, capacity, lengthUsed, usable, over };
}

export function summary(doc) {
  let capacity = 0, cars = 0, stablingTracks = 0, totalLength = 0;
  for (const t of doc.tracks) {
    totalLength += trackLength(t);
    if (trackKind(t.kind).stabling) { capacity += trackCapacity(doc, t); stablingTracks++; }
  }
  for (const f of doc.formations) if (f.trackId) cars += formationCars(f);
  const unassigned = doc.formations.filter(f => !f.trackId);
  return {
    tracks: doc.tracks.length, stablingTracks, capacity, cars,
    formations: doc.formations.length,
    unassignedCars: unassigned.reduce((s, f) => s + formationCars(f), 0),
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
