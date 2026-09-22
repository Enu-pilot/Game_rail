// 路線（駅の並び）とダイヤ（列車のスジ）の計算

import { objectDef } from './catalog.js';
import { findRoute } from './topology.js';
import { distToPolyline } from './geom.js';

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
export function lineStations(doc, g, line) {
  const out = [];
  let km = 0;
  const ids = line.stations || [];
  for (let i = 0; i < ids.length; i++) {
    const o = doc.objects.find(x => x.id === ids[i]);
    if (!o) { out.push({ id: ids[i], name: '（削除された駅）', km, missing: true }); continue; }
    if (i > 0) {
      const prev = doc.objects.find(x => x.id === ids[i - 1]);
      let d = 0;
      if (prev && prev.trackId && o.trackId) {
        if (prev.trackId === o.trackId) {
          const a = stationAt(doc, prev), b = stationAt(doc, o);
          d = (a != null && b != null) ? Math.abs(b - a) : 0;
        } else {
          const r = findRoute(doc, g, { fromTrackId: prev.trackId, toTrackId: o.trackId, trainLength: 0 });
          d = r.found ? r.distance : 0;
        }
      }
      km += d;
    }
    out.push({ id: o.id, object: o, name: o.label || '駅', trackId: o.trackId, km, missing: false });
  }
  return out;
}

/** 列車の時刻を計算する（各駅の着・発） */
export function computeSchedule(doc, stations, train) {
  const from = Math.max(0, Math.min(stations.length - 1, train.fromIdx));
  const to = Math.max(0, Math.min(stations.length - 1, train.toIdx));
  const step = to >= from ? 1 : -1;
  const speed = Math.max(5, train.speedKmh || 60);
  const dwell = Math.max(0, train.dwellSec ?? 30);
  const stops = [];
  let t = train.departSec || 0;
  for (let i = from; ; i += step) {
    const st = stations[i];
    const skipped = train.skip.includes(i) && i !== from && i !== to;
    if (i === from) {
      stops.push({ idx: i, arr: null, dep: t, skip: false, km: st.km });
    } else {
      const prev = stations[i - step];
      const dist = Math.abs(st.km - prev.km);
      t += (dist / 1000) / speed * 3600;
      const arr = t;
      if (i === to) { stops.push({ idx: i, arr, dep: null, skip: false, km: st.km }); break; }
      if (skipped) {
        stops.push({ idx: i, arr, dep: arr, skip: true, km: st.km });
      } else {
        t += dwell;
        stops.push({ idx: i, arr, dep: t, skip: false, km: st.km });
      }
    }
    if (i === to) break;
  }
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
