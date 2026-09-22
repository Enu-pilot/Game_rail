// 路線（駅の並び）とダイヤ（列車のスジ）の計算

import { objectDef } from './catalog.js';
import { store } from './store.js';
import { findRoute, segmentExtra, pathExtra } from './topology.js';
import { distToPolyline } from './geom.js';
import { runTimeForPath } from './runcurve.js';

export const TRAIN_TYPES = [
  { id: 'local',   name: '普通',   color: '#7fd1ff', speed: 60 },
  { id: 'rapid',   name: '快速',   color: '#8fe06a', speed: 75 },
  { id: 'express', name: '急行',   color: '#ffb020', speed: 85 },
  { id: 'ltd',     name: '特急',   color: '#ff5f56', speed: 100 },
  { id: 'freight', name: '貨物',   color: '#b98cff', speed: 50 },
  { id: 'deadhead', name: '回送',  color: '#9aa4bb', speed: 60 },
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
            d = r.distance + pathExtra(doc, r.path);   // 省略した駅間の距離を加える
            path = r.path;
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

/**
 * 列車の時刻を計算する（各駅の着・発）。
 * 駅間は走行計算（線路の最高速度・速度制限・分岐制限＋加減速）で所要時間を求める。
 */
export function computeSchedule(doc, stations, train) {
  const key = train.id;
  const sig = `${store.rev}|${stations.map(s => `${s.id}:${Math.round(s.km)}`).join(',')}|${train.fromIdx},${train.toIdx},${train.departSec},${train.speedKmh},${train.dwellSec},${train.skip.join('-')}`;
  const hit = _schedCache.get(key);
  if (hit && hit.sig === sig) return hit.stops;

  const from = Math.max(0, Math.min(stations.length - 1, train.fromIdx));
  const to = Math.max(0, Math.min(stations.length - 1, train.toIdx));
  const step = to >= from ? 1 : -1;
  const dwell = Math.max(0, train.dwellSec ?? 30);
  const trainMax = Math.max(10, train.speedKmh || 60);
  const stops = [];
  let t = train.departSec || 0;

  if (from === to) {
    stops.push({ idx: from, arr: null, dep: t, skip: false, km: stations[from] ? stations[from].km : 0 });
    _schedCache.set(key, { sig, stops });
    return stops;
  }

  stops.push({ idx: from, arr: null, dep: t, skip: false, km: stations[from].km, runKmh: null });
  let segPath = [];
  let segTurnouts = [];
  let pendingSkips = [];   // 通過した駅（あとで時刻を按分する）
  for (let i = from + step; ; i += step) {
    const hop = hopPath(stations, i - step, i);
    if (hop.path) { segPath = segPath.concat(hop.path); segTurnouts = segTurnouts.concat(hop.turnouts); }
    const isEnd = i === to;
    const skipped = !isEnd && train.skip.includes(i);
    if (skipped) { pendingSkips.push(i); continue; }

    const run = runTimeForPath(doc, segPath, { trainMax, turnouts: segTurnouts, startKmh: 0, endKmh: 0 });
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
    t += dwell;
    stops.push({ idx: i, arr, dep: t, skip: false, km: stations[i].km, runKmh: run.vmax });
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

/** 駅間で列車が占有する時間帯 */
function sectionRuns(stops) {
  const runs = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    const lo = Math.min(a.idx, b.idx), hi = Math.max(a.idx, b.idx);
    runs.push({ sec: lo, from: a.idx, to: b.idx, start: a.dep ?? a.arr, end: b.arr ?? b.dep, up: b.idx < a.idx });
  }
  return runs;
}

/** ダイヤの競合（単線での行き違い不可・同方向の追い越し）を検出 */
export function timetableConflicts(doc, line, stations, trains) {
  const issues = [];
  const scheds = trains.map(t => ({ train: t, runs: sectionRuns(computeSchedule(doc, stations, t)) }));
  for (let i = 0; i < scheds.length; i++) {
    for (let j = i + 1; j < scheds.length; j++) {
      const A = scheds[i], B = scheds[j];
      for (const ra of A.runs) {
        for (const rb of B.runs) {
          if (ra.sec !== rb.sec) continue;
          const overlap = Math.min(ra.end, rb.end) - Math.max(ra.start, rb.start);
          if (overlap <= 0) continue;
          const opposing = ra.up !== rb.up;
          if (opposing && !line.double) {
            issues.push({
              level: 'error', trains: [A.train, B.train], sec: ra.sec,
              message: `単線区間「${stations[ra.sec].name}〜${stations[ra.sec + 1] ? stations[ra.sec + 1].name : ''}」で ${A.train.number || A.train.name} と ${B.train.number || B.train.name} が行き違いできません`,
            });
          } else if (!opposing) {
            issues.push({
              level: 'warn', trains: [A.train, B.train], sec: ra.sec,
              message: `「${stations[ra.sec].name}〜${stations[ra.sec + 1] ? stations[ra.sec + 1].name : ''}」で ${A.train.number || A.train.name} と ${B.train.number || B.train.name} が同一方向で接近しています（追い越し・続行）`,
            });
          }
        }
      }
    }
  }
  // 同じ内容の重複をまとめる
  const seen = new Set();
  return issues.filter(i => (seen.has(i.message) ? false : (seen.add(i.message), true)));
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
 * 番線（発着線）の競合を検出する。
 * 同じ番線を、停車時間（＋続行時隔）が重なる複数の列車が使っていれば支障。
 */
export function platformConflicts(doc, stations, trains, headwaySec = 60) {
  const uses = [];
  for (const tr of trains) {
    const stops = computeSchedule(doc, stations, tr);
    for (const st of stops) {
      const trackId = trainPlatform(doc, tr, stations, st.idx);
      if (!trackId) continue;
      const a = (st.arr ?? st.dep) - headwaySec / 2;
      const b = (st.dep ?? st.arr) + headwaySec / 2;
      uses.push({ train: tr, idx: st.idx, trackId, from: a, to: b, skip: st.skip });
    }
  }
  const issues = [];
  for (let i = 0; i < uses.length; i++) {
    for (let j = i + 1; j < uses.length; j++) {
      const A = uses[i], B = uses[j];
      if (A.trackId !== B.trackId || A.train.id === B.train.id) continue;
      if (Math.min(A.to, B.to) - Math.max(A.from, B.from) <= 0) continue;
      const tr = doc.tracks.find(t => t.id === A.trackId);
      issues.push({
        level: 'error',
        message: `${stations[A.idx] ? stations[A.idx].name : ''}「${tr ? tr.name : '番線'}」を ${A.train.number} と ${B.train.number} が同時に使用します（${fmtHM(Math.max(A.from, B.from))}頃）`,
        trackId: A.trackId, trains: [A.train, B.train],
      });
    }
  }
  const seen = new Set();
  return issues.filter(i => (seen.has(i.message) ? false : (seen.add(i.message), true)));
}

/** 各駅で同時に必要になる番線数のピーク */
export function platformDemand(doc, stations, trains, headwaySec = 60) {
  return stations.map((st, idx) => {
    const spans = [];
    for (const tr of trains) {
      const stops = computeSchedule(doc, stations, tr);
      const s2 = stops.find(x => x.idx === idx);
      if (!s2) continue;
      spans.push([(s2.arr ?? s2.dep) - headwaySec / 2, (s2.dep ?? s2.arr) + headwaySec / 2]);
    }
    let peak = 0, peakAt = null;
    for (const [a] of spans) {
      const n = spans.filter(([x, y]) => a >= x && a < y).length;
      if (n > peak) { peak = n; peakAt = a; }
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
