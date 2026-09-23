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
export function computeSchedule(doc, stations, train) {
  const key = train.id;
  const holds = train.holds || {};
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

/** 駅の発着線（未設定なら駅マーカーが乗っている線路） */
export function stationTracks(doc, stationObj) {
  const ids = (stationObj.tracks || []).filter(id => doc.tracks.some(t => t.id === id));
  if (ids.length) return ids;
  return stationObj.trackId ? [stationObj.trackId] : [];
}

/** 列車がその駅で使う番線 */
export function trainPlatform(doc, train, stations, idx) {
  const st = stations[idx];
  if (!st) return null;
  const assigned = train.platforms && train.platforms[idx];
  if (assigned && doc.tracks.some(t => t.id === assigned)) return assigned;
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
  const uses = [];
  for (const tr of trains) {
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
      const sepDir = through && onMain && dbl(st.idx - 1) && dbl(st.idx);
      const up = tr.toIdx < tr.fromIdx;
      const a = (st.arr ?? st.dep) - headwaySec / 2;
      const b = (st.dep ?? st.arr) + headwaySec / 2;
      uses.push({
        train: tr, idx: st.idx, trackId, from: a, to: b, skip: st.skip, up,
        // 同じ線路でも駅が違えば番線の競合ではない（駅間の支障は運転整理で見る）
        key: `${st.idx}|${trackId}|${sepDir ? (up ? 'up' : 'down') : ''}`,
      });
    }
  }
  return uses;
}

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
