// 路線（駅の並び）とダイヤ（列車のスジ）の計算

import { objectDef } from './catalog.js';
import { store } from './store.js';
import { findRoute, segmentExtra, pathExtra } from './topology.js';
import { distToPolyline, pointAt } from './geom.js';
import { runTimeForPath } from './runcurve.js';

export const TRAIN_TYPES = [
  { id: 'local',    name: '普通',     color: '#7fd1ff', speed: 60 },
  { id: 'semi',     name: '準急',     color: '#6ad1a8', speed: 70 },
  { id: 'rapid',    name: '快速',     color: '#8fe06a', speed: 75 },
  { id: 'express',  name: '急行',     color: '#ffb020', speed: 85 },
  { id: 'rapidexp', name: '快速急行', color: '#ff8f3d', speed: 90 },
  { id: 'commltd',  name: '通勤特急', color: '#ff7aa8', speed: 95 },
  { id: 'ltd',      name: '特急',     color: '#ff5f56', speed: 100 },
  { id: 'freight',  name: '貨物',     color: '#b98cff', speed: 50 },
  { id: 'deadhead', name: '回送',     color: '#9aa4bb', speed: 60 },
];
export const trainType = id => TRAIN_TYPES.find(t => t.id === id) || TRAIN_TYPES[0];

export const isStation = o => !!objectDef(o.type).station;

/** 駅オブジェクトの一覧 */
export const stationObjects = doc => doc.objects.filter(isStation);

export const stationName = (doc, id) => {
  const o = doc.objects.find(x => x.id === id);
  return o ? (o.label || '駅') : '（削除された駅）';
};

/** 駅が乗っている線路上の位置 */
export function stationAt(doc, o) {
  const t = doc.tracks.find(x => x.id === o.trackId);
  if (!t || !t.points || t.points.length < 2) return null;
  return distToPolyline(o.x, o.y, t.points).at;
}

/**
 * 路線の各駅のキロ程を求める。
 * 隣り合う駅の距離は、線路の接続をたどった経路長（折返しを含まない最短）で計算する。
 */
const _lineCache = new Map();

export function lineStations(doc, g, line) {
  const sig = `${store.rev}|${(line.stations || []).join(',')}`;
  const hit = _lineCache.get(line.id);
  if (hit && hit.sig === sig) return hit.value;
  const out = [];
  let km = 0;
  const ids = line.stations || [];
  for (let i = 0; i < ids.length; i++) {
    const o = doc.objects.find(x => x.id === ids[i]);
    if (!o) { out.push({ id: ids[i], name: '（削除された駅）', km, missing: true }); continue; }
    let path = null, turnouts = [];
    if (i > 0) {
      const prev = doc.objects.find(x => x.id === ids[i - 1]);
      let d = 0;
      if (prev && prev.trackId && o.trackId) {
        if (prev.trackId === o.trackId) {
          const a = stationAt(doc, prev), b = stationAt(doc, o);
          if (a != null && b != null) {
            d = Math.abs(b - a) + segmentExtra(doc, o.trackId, a, b);
            path = [{ trackId: o.trackId, fromAt: a, toAt: b }];
          }
        } else {
          const r = findRoute(doc, g, { fromTrackId: prev.trackId, toTrackId: o.trackId, trainLength: 0 });
          if (r.found) {
            // 経路は線路の区間単位なので、発駅の位置から着駅の位置までに切りそろえる
            path = trimHopPath(doc, r.path, prev, o);
            d = path.reduce((a, p2) => a + Math.abs(p2.toAt - p2.fromAt), 0) + pathExtra(doc, path);
            turnouts = (r.legs || []).flatMap(lg => lg.turnouts || []);
          }
        }
      }
      km += d;
    }
    out.push({ id: o.id, object: o, name: o.label || '駅', trackId: o.trackId, km, missing: false, path, turnouts });
  }
  _lineCache.set(line.id, { sig, value: out });
  return out;
}

/**
 * 駅間の経路を、発駅の位置から着駅の位置までに切りそろえる。
 * 探索結果は区間（接続点から接続点まで）の並びなので、両端の余分を落とし、
 * 発駅の線路上の区間が含まれていなければ補う。
 */
function trimHopPath(doc, raw, fromObj, toObj) {
  const path = raw.map(p => ({ ...p }));
  if (!path.length) return path;
  const trackOf = id => doc.tracks.find(t => t.id === id);
  const atOn = (trackId, x, y) => { const t = trackOf(trackId); return t ? distToPolyline(x, y, t.points).at : 0; };
  const fromAt = stationAt(doc, fromObj), toAt = stationAt(doc, toObj);
  // 着駅：着駅の線路上の最後の区間を駅の位置で止める
  let li = -1;
  for (let i = path.length - 1; i >= 0; i--) if (path[i].trackId === toObj.trackId) { li = i; break; }
  if (li >= 0) { path.length = li + 1; path[li].toAt = toAt; }
  // 発駅：発駅の線路上の区間があれば駅の位置から始め、なければ接続点まで補う
  const fi = path.findIndex(p => p.trackId === fromObj.trackId);
  if (fi >= 0) {
    path.splice(0, fi);
    path[0].fromAt = fromAt;
  } else {
    const t0 = trackOf(path[0].trackId);
    if (t0) {
      const q = pointAt(t0.points, path[0].fromAt);
      path.unshift({ trackId: fromObj.trackId, fromAt, toAt: atOn(fromObj.trackId, q.x, q.y) });
    }
  }
  return path.filter(p => Math.abs(p.toAt - p.fromAt) > 1e-6 || p === path[0]);
}

const reversePath = path => (path || []).slice().reverse().map(p => ({ trackId: p.trackId, fromAt: p.toAt, toAt: p.fromAt }));

/** 隣り合う駅の間の経路（進行方向に合わせる） */
function hopPath(stations, from, to) {
  if (to > from) {
    const st = stations[to];
    return { path: st && st.path ? st.path : null, turnouts: (st && st.turnouts) || [] };
  }
  const st = stations[from];
  return { path: st && st.path ? reversePath(st.path) : null, turnouts: (st && st.turnouts) || [] };
}

const _schedCache = new Map();
/** 駅間の走行時分（停車駅〜停車駅・最高速度ごと）の使い回し */
const _runCache = new Map();
let _runCacheRev = -1;

/**
 * 列車の時刻を計算する（各駅の着・発）。
 * 駅間は走行計算（線路の最高速度・速度制限・分岐制限＋加減速）で所要時間を求める。
 */
export function computeSchedule(doc, stations, train, _depth = 0) {
  // 併結列車（付属編成）は、相手の列車の時刻に従って走る
  const leader = _depth < 3 ? coupledLeader(doc, train) : null;
  if (leader) {
    const own = companionSchedule(doc, stations, train, leader, _depth);
    if (own) return own;
  }
  const key = train.id;
  const holds = { ...(train.holds || {}) };
  // 途中駅で付属編成を連結・切り離す列車は、その駅で作業時間だけ長く止まる
  const work = coupleWork(doc, train);
  for (const [i, sec] of Object.entries(work)) holds[i] = (+holds[i] || 0) + sec;
  // 駅ごとの停車の延長（スイッチバックでの折返しなど）
  for (const [i, sec] of Object.entries(train.dwellAt || {})) holds[i] = (+holds[i] || 0) + Math.max(0, +sec || 0);
  const stSig = stations.map(s => `${s.id}:${Math.round(s.km)}`).join(',');
  const sig = `${store.rev}|${stSig}|${train.fromIdx},${train.toIdx},${train.departSec},${train.delaySec || 0},${train.speedKmh},${train.dwellSec},${train.skip.join('-')}|${JSON.stringify(holds)}`;
  const hit = _schedCache.get(key);
  if (hit && hit.sig === sig) return hit.stops;

  const from = Math.max(0, Math.min(stations.length - 1, train.fromIdx));
  const to = Math.max(0, Math.min(stations.length - 1, train.toIdx));
  const step = to >= from ? 1 : -1;
  const dwell = Math.max(0, train.dwellSec ?? 30);
  const trainMax = Math.max(10, train.speedKmh || 60);
  const stops = [];
  let t = (train.departSec || 0) + (train.delaySec || 0);

  if (from === to) {
    stops.push({ idx: from, arr: null, dep: t, skip: false, km: stations[from] ? stations[from].km : 0 });
    _schedCache.set(key, { sig, stops });
    return stops;
  }

  const holdAt = i => Math.max(0, +holds[i] || 0);
  t += holdAt(from);
  stops.push({ idx: from, arr: null, dep: t, skip: false, km: stations[from].km, runKmh: null });
  let segPath = [];
  let segTurnouts = [];
  let pendingSkips = [];   // 通過した駅（あとで時刻を按分する）
  for (let i = from + step; ; i += step) {
    const hop = hopPath(stations, i - step, i);
    if (hop.path) { segPath = segPath.concat(hop.path); segTurnouts = segTurnouts.concat(hop.turnouts); }
    const isEnd = i === to;
    const hold = holdAt(i);
    // 待避・行き違いの待ち時間があれば、通過駅でも運転停車になる
    const skipped = !isEnd && train.skip.includes(i) && hold <= 0;
    if (skipped) { pendingSkips.push(i); continue; }

    if (_runCacheRev !== store.rev || _runCache.size > 50000) { _runCache.clear(); _runCacheRev = store.rev; }
    const runKey = `${stSig}|${stops[stops.length - 1].idx}|${i}|${trainMax}`;
    let run = _runCache.get(runKey);
    if (!run) {
      run = runTimeForPath(doc, segPath, { trainMax, turnouts: segTurnouts, startKmh: 0, endKmh: 0 });
      _runCache.set(runKey, run);
    }
    const t0 = t;
    t += run.time;
    // 通過駅は距離で按分した時刻を入れる
    const startKm = stops[stops.length - 1].km;
    for (const sk of pendingSkips) {
      const f = Math.abs(stations[sk].km - startKm) / Math.max(1, Math.abs(stations[i].km - startKm));
      const tt = t0 + run.time * f;
      stops.push({ idx: sk, arr: tt, dep: tt, skip: true, km: stations[sk].km, runKmh: run.vmax });
    }
    pendingSkips = [];
    const arr = t;
    if (isEnd) { stops.push({ idx: i, arr, dep: null, skip: false, km: stations[i].km, runKmh: run.vmax }); break; }
    const oper = train.skip.includes(i);          // 客扱いのない運転停車
    t += (oper ? 0 : dwell) + hold;
    stops.push({ idx: i, arr, dep: t, skip: false, oper, hold, km: stations[i].km, runKmh: run.vmax });
    segPath = []; segTurnouts = [];
  }
  _schedCache.set(key, { sig, stops });
  return stops;
}

/* ---------------- 連結・分離（併結運転） ---------------- */

/** 併結の相手（この列車が付属編成として連結される列車） */
export function coupledLeader(doc, t) {
  const id = t && t.couple && t.couple.withId;
  if (!id || id === t.id) return null;
  return trainById(doc, id);
}

/** 列車IDから列車を引く（列車の配列が変わるまで索引を使い回す） */
let _trainIdx = { arr: null, len: -1, map: new Map() };
export function trainById(doc, id) {
  const arr = doc.trains || [];
  if (_trainIdx.arr !== arr || _trainIdx.len !== arr.length) {
    _trainIdx = { arr, len: arr.length, map: new Map(arr.map(t => [t.id, t])) };
  }
  const t = _trainIdx.map.get(id);
  return t && t.id === id ? t : (arr.find(x => x.id === id) || null);
}

/** 併結して走る付属編成か */
export const isCompanion = (doc, t) => !!coupledLeader(doc, t);

/** 主となる列車 → 併結する付属編成の一覧 */
let _compIndex = { doc: null, rev: -1, n: -1, map: new Map() };
export function companionsOf(doc, leaderId) {
  const trains = doc.trains || [];
  if (_compIndex.doc !== doc || _compIndex.rev !== store.rev || _compIndex.n !== trains.length) {
    const map = new Map();
    for (const t of trains) {
      const id = t.couple && t.couple.withId;
      if (!id) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(t);
    }
    _compIndex = { doc, rev: store.rev, n: trains.length, map };
  }
  return _compIndex.map.get(leaderId) || [];
}

/** 連結・切り離しの作業時分 */
export const coupleSec = doc => Math.max(0, (doc.settings.coupleMinutes ?? 3) * 60);
export const splitSec = doc => Math.max(0, (doc.settings.splitMinutes ?? 2) * 60);

/** 主となる列車が途中駅で連結・切り離しをする駅と作業時間 { 駅番号: 秒 } */
export function coupleWork(doc, train) {
  const out = {};
  for (const c of companionsOf(doc, train.id)) {
    if (c.lineId !== train.lineId) continue;
    if (c.fromIdx !== train.fromIdx) out[c.fromIdx] = Math.max(out[c.fromIdx] || 0, coupleSec(doc));
    if (c.toIdx !== train.toIdx) out[c.toIdx] = Math.max(out[c.toIdx] || 0, splitSec(doc));
  }
  return out;
}

/** 付属編成の時刻：相手の列車の時刻から、併結している区間を切り出す */
function companionSchedule(doc, stations, train, leader, depth) {
  if (leader.lineId !== train.lineId) return null;
  const ls = computeSchedule(doc, stations, leader, depth + 1);
  const a = ls.findIndex(x => x.idx === train.fromIdx);
  const b = ls.findIndex(x => x.idx === train.toIdx);
  if (a < 0 || b < 0 || b <= a) return null;
  const out = ls.slice(a, b + 1).map(x => ({ ...x }));
  const first = out[0], last = out[out.length - 1];
  first.arr = null; first.skip = false;
  last.dep = null; last.skip = false;
  return out;
}

/**
 * 併結の設定の誤り（相手がいない・向きが逆・区間の外・両数超過など）
 * @returns {Array<{level, message, train}>}
 */
export function coupleIssues(doc, line, stations, trains) {
  const out = [];
  const nm = t => t.number || '列車';
  for (const t of trains) {
    if (!t.couple || !t.couple.withId) continue;
    const L = coupledLeader(doc, t);
    const push = (level, message) => out.push({ level, message, train: t });
    if (!L) { push('error', `${nm(t)} の併結相手の列車がありません`); continue; }
    if (L.lineId !== t.lineId) { push('error', `${nm(t)} と ${nm(L)} は別の路線です（併結は同じ路線の列車どうし）`); continue; }
    if (L.couple && L.couple.withId) push('warn', `${nm(L)} 自身も別の列車に併結しています（${nm(t)} は ${nm(L)} の相手に従います）`);
    const dirT = Math.sign(t.toIdx - t.fromIdx), dirL = Math.sign(L.toIdx - L.fromIdx);
    if (dirT !== dirL) { push('error', `${nm(t)} と ${nm(L)} は進行方向が逆です`); continue; }
    const inRange = i => dirL > 0 ? (i >= L.fromIdx && i <= L.toIdx) : (i <= L.fromIdx && i >= L.toIdx);
    if (!inRange(t.fromIdx) || !inRange(t.toIdx)) {
      push('error', `${nm(t)} の併結区間（${stName(stations, t.fromIdx)}〜${stName(stations, t.toIdx)}）が ${nm(L)} の運転区間の外にはみ出しています`);
      continue;
    }
    for (const i of [t.fromIdx, t.toIdx]) {
      if (i !== L.fromIdx && i !== L.toIdx && (L.skip || []).includes(i)) {
        push('warn', `${nm(L)} は ${stName(stations, i)} を通過扱いですが、連結・切り離しのため運転停車します`);
      }
    }
    const cars = (L.cars || 0) + companionsOf(doc, L.id).reduce((s2, c) => s2 + (c.cars || 0), 0);
    if (line && cars > (line.maxCars || 99)) {
      push('error', `${nm(L)}＋付属編成で ${cars} 両になり、ホーム有効長（${line.maxCars} 両）を超えます`);
    }
  }
  return out;
}
const stName = (stations, i) => (stations[i] ? stations[i].name : '?');

/* ---------------- 機回し ---------------- */

/** 駅で機回し（機関車を反対側へ付け替える）ができるか：両端のつながった線が2本以上 */
export function canRunAround(doc, station) {
  if (!station || !station.object) return false;
  const ids = stationTracks(doc, station.object);
  const loops = ids.map(id => doc.tracks.find(t => t.id === id)).filter(t => t && t.ends.a !== 'buffer' && t.ends.b !== 'buffer');
  return loops.length >= 2 || nearbyTracks(doc, station.object, 120).some(n => n.track.kind === 'runaround');
}

/** 駅の近くに転車台があるか（蒸気機関車などの向きを変えられる） */
export function hasTurntable(doc, station, radius = 800) {
  if (!station || !station.object) return false;
  const o = station.object;
  return doc.objects.some(x => x.type === 'turntable' && Math.hypot(x.x - o.x, x.y - o.y) <= radius);
}

export const runAroundSec = doc => Math.max(0, (doc.settings.runAroundMinutes ?? 10) * 60);

/**
 * 機関車牽引の列車が折り返す駅の一覧（機回しできるか・転車台があるか）。
 * 終着後に入庫・直通する列車や、付属編成として切り離される列車は数えない。
 */
export function runAroundPoints(doc, stations, trains) {
  const map = new Map();
  for (const t of trains) {
    if (!t.loco || t.toDepot || t.throughId) continue;
    const st = stations[t.toIdx];
    if (!st) continue;
    if (!map.has(t.toIdx)) {
      map.set(t.toIdx, { idx: t.toIdx, name: st.name, count: 0, ok: canRunAround(doc, st), turntable: hasTurntable(doc, st), trains: [] });
    }
    const m = map.get(t.toIdx);
    m.count++; m.trains.push(t);
  }
  return [...map.values()].sort((a, b) => a.idx - b.idx);
}

/** 列車のスジ（時刻・キロ程の折れ線） */
export function trainPolyline(stops) {
  const pts = [];
  for (const s of stops) {
    if (s.arr != null) pts.push({ t: s.arr, km: s.km });
    if (s.dep != null) pts.push({ t: s.dep, km: s.km });
  }
  return pts;
}

/** 駅マーカーの近くを通る線路（番線の候補） */
export function nearbyTracks(doc, stationObj, radius = 80) {
  const out = [];
  for (const t of doc.tracks) {
    if (!t.points || t.points.length < 2) continue;
    const r = distToPolyline(stationObj.x, stationObj.y, t.points);
    if (r.d <= radius) out.push({ track: t, d: r.d, at: r.at });
  }
  return out.sort((a, b) => a.d - b.d);
}

/** 線路IDの集合（線路の配列が変わるまで使い回す） */
let _trackSet = { arr: null, len: -1, set: new Set() };
export function hasTrack(doc, id) {
  const arr = doc.tracks;
  if (_trackSet.arr !== arr || _trackSet.len !== arr.length) {
    _trackSet = { arr, len: arr.length, set: new Set(arr.map(t => t.id)) };
  }
  return _trackSet.set.has(id);
}

/** 駅の発着線（未設定なら駅マーカーが乗っている線路） */
export function stationTracks(doc, stationObj) {
  const ids = (stationObj.tracks || []).filter(id => hasTrack(doc, id));
  if (ids.length) return ids;
  return stationObj.trackId ? [stationObj.trackId] : [];
}

/** 列車がその駅で使う番線 */
export function trainPlatform(doc, train, stations, idx) {
  const st = stations[idx];
  if (!st) return null;
  const assigned = train.platforms && train.platforms[idx];
  if (assigned && hasTrack(doc, assigned)) return assigned;
  const list = st.object ? stationTracks(doc, st.object) : [];
  return list[0] || st.trackId || null;
}

/**
 * 番線（発着線）の占有を列挙する。
 *
 * 複線区間の途中駅で番線が1本しか割り当てられていない場合は、
 * その1本が上り線・下り線を代表しているとみなし、方向ごとに別の番線として扱う。
 * 折返し（始発・終着）の列車は方向で分けられないため、同じ番線を奪い合う。
 */
function platformUses(doc, line, stations, trains, headwaySec) {
  const dbl = i => !(line && sectionSingleLocal(line, i));
  // 複々線の駅は、本線が緩行線と急行線に分かれている
  const quadAt = i => !!(line && line.secQuad && (line.secQuad[i - 1] || line.secQuad[i]));
  const uses = [];
  for (const tr of trains) {
    if (isCompanion(doc, tr)) continue;          // 付属編成は相手の列車と同じ番線に入る
    const stops = computeSchedule(doc, stations, tr);
    const ends = [tr.fromIdx, tr.toIdx];
    for (const st of stops) {
      const trackId = trainPlatform(doc, tr, stations, st.idx);
      if (!trackId) continue;
      const stObj = stations[st.idx] && stations[st.idx].object;
      const through = !ends.includes(st.idx);
      // 本線（駅マーカーが乗っている線路）は複線を1本で表しているので、
      // 前後が複線なら上下で別の線路とみなす。待避線などの副本線は1本の線路
      const onMain = !stObj || !stObj.trackId || trackId === stObj.trackId;
      // 本線は前後が複線なら上下別の線路（始発・終着の列車も、渡り線で反対側の線へ移るとみなす）
      const sepDir = onMain && dbl(st.idx - 1) && dbl(st.idx);
      const up = tr.toIdx < tr.fromIdx;
      const a = (st.arr ?? st.dep) - headwaySec / 2;
      const b = (st.dep ?? st.arr) + headwaySec / 2;
      uses.push({
        train: tr, idx: st.idx, trackId, from: a, to: b, skip: st.skip, up,
        // 同じ線路でも駅が違えば番線の競合ではない（駅間の支障は運転整理で見る）
        key: `${st.idx}|${trackId}|${sepDir ? (up ? 'up' : 'down') : ''}${onMain && quadAt(st.idx) ? (slowType(tr) ? '|緩' : '|急') : ''}`,
      });
    }
  }
  return uses;
}

/** 複々線で緩行線を走る種別（meets.js の優先度 2.5 以下に合わせる） */
const slowType = t => ['local', 'semi', 'deadhead', 'freight'].includes(t.type) || !t.type;

// timetable.js からは meets.js を読み込まない（循環参照を避ける）ため、同じ判定をここにも置く
function sectionSingleLocal(line, i) {
  const ov = line.secSingle ? line.secSingle[i] : undefined;
  if (ov === true || ov === false) return ov;
  return !line.double;
}

/**
 * 番線の競合を検出する。
 * 同じ番線を、停車時間（＋続行時隔）が重なる複数の列車が使っていれば支障。
 */
export function platformConflicts(doc, line, stations, trains, headwaySec = 60) {
  const uses = platformUses(doc, line, stations, trains, headwaySec);
  const byKey = new Map();
  for (const u of uses) {
    if (!byKey.has(u.key)) byKey.set(u.key, []);
    byKey.get(u.key).push(u);
  }
  const issues = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.from - b.from);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j];
        if (B.from >= A.to) break;
        if (A.train.id === B.train.id) continue;
        const tr = doc.tracks.find(t => t.id === A.trackId);
        issues.push({
          level: 'error',
          message: `${stations[A.idx] ? stations[A.idx].name : ''}「${tr ? tr.name : '番線'}」を ${A.train.number} と ${B.train.number} が同時に使用します（${fmtHM(Math.max(A.from, B.from))}頃）`,
          trackId: A.trackId, idx: A.idx, trains: [A.train, B.train],
        });
      }
    }
  }
  const seen = new Set();
  return issues.filter(i => (seen.has(i.message) ? false : (seen.add(i.message), true)));
}

/** 各駅で同時に必要になる番線数のピーク（方向ごとに数え、多い方をとる） */
export function platformDemand(doc, line, stations, trains, headwaySec = 60) {
  const uses = platformUses(doc, line, stations, trains, headwaySec);
  return stations.map((st, idx) => {
    const here = uses.filter(u => u.idx === idx);
    const groups = new Map();
    for (const u of here) {
      const dir = u.key.endsWith('|up') ? 'up' : u.key.endsWith('|down') ? 'down' : '*';
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(u);
    }
    let peak = 0, peakAt = null;
    for (const list of groups.values()) {
      for (const u of list) {
        const n = list.filter(v => u.from >= v.from && u.from < v.to).length;
        if (n > peak) { peak = n; peakAt = u.from; }
      }
    }
    const available = st.object ? stationTracks(doc, st.object).length : 0;
    return { idx, station: st, peak, peakAt, available, short: peak > available && available > 0 };
  });
}

export const fmtHM = sec => {
  const s = ((sec % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
};
export const fmtHMS = sec => `${fmtHM(sec)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
export const parseHM = str => {
  const m = String(str).match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60;
};
