// 単線の行き違い・待避（緩急接続）の計画：ダイヤに待ち時間を挿入する運転整理
//
// 列車には「駅ごとの待ち時間 holds[駅番号]」を持たせ、
//   ・単線区間で対向列車と正面衝突する → 手前の交換可能駅で行き違い待ち
//   ・後続の速い列車が追いつく         → 手前の待避可能駅で待避
// となるよう、発時刻の早い順に貪欲に待ち時間を決める。

import { computeSchedule, stationTracks, trainPlatform, fmtHM, isCompanion } from './timetable.js';

/** 種別の優先度（大きいほど優等） */
const RANK = { ltd: 7, commltd: 6, rapidexp: 5, express: 4, rapid: 3, semi: 2.5, local: 2, deadhead: 1, freight: 0 };
export const trainRank = t => RANK[t.type] ?? 2;

/** 駅 i と i+1 の間が単線か */
export function sectionSingle(line, i) {
  const ov = line.secSingle ? line.secSingle[i] : undefined;
  if (ov === true || ov === false) return ov;
  return !line.double;
}

/** 駅の発着線の本数 */
export function stationTrackCount(doc, st) {
  return st && st.object ? stationTracks(doc, st.object).length : 0;
}

/** 行き違い・待避ができる駅（発着線が2本以上） */
export const canPass = (doc, st) => stationTrackCount(doc, st) >= 2;

/**
 * 列車が各駅間を占有する時間帯。
 * noPass（待避線のない駅の番号の集合）を渡すと、その駅での停車・通過も
 * 「駅」の区間（sec = 's'+駅番号）として加える（駅の中での追い越し・続行を見つけるため）。
 */
export function sectionRuns(stops, trainId, noPass = null) {
  const runs = [];
  if (noPass) {
    const up = stops.length > 1 && stops[stops.length - 1].idx < stops[0].idx;
    for (const st of stops) {
      if (!noPass.has(st.idx)) continue;
      const a = st.arr ?? st.dep, b = st.dep ?? st.arr;
      if (a == null) continue;
      runs.push({ trainId, sec: `s${st.idx}`, station: true, from: st.idx, to: st.idx, start: a, end: b, up });
    }
  }
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    const start = a.dep ?? a.arr, end = b.arr ?? b.dep;
    if (start == null || end == null) continue;
    runs.push({
      trainId, sec: Math.min(a.idx, b.idx), from: a.idx, to: b.idx,
      start, end, up: b.idx < a.idx,
    });
  }
  return runs;
}

/** 2本の占有の関係：'meet' 行き違い / 'overtake' 追い越し / 'follow' 続行（時隔不足）/ null */
function classify(q, r, single, headway) {
  const opposing = q.up !== r.up;
  if (q.station) {
    // 待避線のない駅：同じ向きの列車は同じ番線に入るので、前の列車が出るまで次は入れない
    if (opposing) return null;
    if ((r.end - q.end) * (r.start - q.start) < 0) return 'overtake';
    return r.start < q.end + headway * 2 / 3 ? 'follow' : null;
  }
  if (opposing) return single ? 'meet' : null;
  if (single) return 'follow';
  if ((r.end - q.end) * (r.start - q.start) < 0) return 'overtake';
  if (r.start - q.start < headway || r.end - q.end < headway) return 'follow';
  return null;
}

/** 待避線のない複線の駅（駅の中で追い越せない） */
function noPassStations(doc, line, stations) {
  const set = new Set();
  stations.forEach((st, i) => {
    const dbl = !sectionSingle(line, i) || !sectionSingle(line, i - 1);
    if (dbl && !canPass(doc, st)) set.add(i);
  });
  return set;
}

/** 待ちを入れられる駅（進行方向の手前側で、いちばん近い交換可能駅）を探す */
function holdStation(doc, stations, train, stops, enterIdx) {
  const order = stops.map(s => s.idx);
  const pos = order.indexOf(enterIdx);
  if (pos < 0) return null;
  for (let k = pos; k >= 0; k--) {
    const idx = order[k];
    if (canPass(doc, stations[idx]) || k === 0) return { idx, atOrigin: k === 0 };
  }
  return null;
}

/**
 * 行き違い・待避を計画する。
 * @returns {{holds:Object, events:Array, conflicts:Array, iterations:number}}
 */
export function planMeets(doc, line, stations, trains, opts = {}) {
  const headway = Math.max(30, opts.headwaySec ?? doc.settings.minHeadwaySec ?? 90);
  const maxHold = Math.max(60, opts.maxHoldSec ?? (doc.settings.maxHoldMinutes ?? 20) * 60);
  const reset = opts.reset !== false;
  // 併結している付属編成は相手の列車と一体で走るので、計画の対象から外す
  const list = trains.filter(t => !isCompanion(doc, t)).sort((a, b) => a.departSec - b.departSec);
  const holds = {};
  const plats = {};
  for (const t of list) {
    holds[t.id] = reset ? {} : { ...(t.holds || {}) };
    plats[t.id] = { ...(t.platforms || {}) };
  }

  // 時刻は待ち時間を変えた列車だけ計算し直す
  const schedCache = new Map();
  const sched = t => {
    let s = schedCache.get(t.id);
    if (!s) {
      s = computeSchedule(doc, stations, { ...t, holds: holds[t.id] });
      s.byIdx = new Map(s.map(x => [x.idx, x]));
      schedCache.set(t.id, s);
    }
    return s;
  };

  const byId = new Map(list.map(t => [t.id, t]));
  const events = [];
  const conflicts = [];
  const gaveUp = new Set();
  let iterations = 0;

  const maxSteps = Math.min(3000, Math.max(200, list.length * 12));
  // 全列車の占有を駅間ごとに並べておき、待ち時間を変えた列車の分だけ差し替える
  const bySec = new Map();
  const runsOf = new Map();
  let maxSpan = headway;          // 駅間の占有のいちばん長いもの（探索の起点を決める）
  const noPass = noPassStations(doc, line, stations);
  const insertRuns = t => {
    const rs = sectionRuns(sched(t), t.id, noPass);
    runsOf.set(t.id, rs);
    for (const r of rs) {
      maxSpan = Math.max(maxSpan, r.end - r.start + headway);
      let arr = bySec.get(r.sec);
      if (!arr) { arr = []; bySec.set(r.sec, arr); }
      let lo = 0, hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].start <= r.start) lo = m + 1; else hi = m; }
      arr.splice(lo, 0, r);
    }
  };
  const removeRuns = id => {
    for (const r of runsOf.get(id) || []) {
      const arr = bySec.get(r.sec);
      const k = arr ? arr.indexOf(r) : -1;
      if (k >= 0) arr.splice(k, 1);
    }
    runsOf.delete(id);
  };
  for (const t of list) insertRuns(t);
  // 待ち時間は増やす一方なので、支障が新たに生じるのは「前回の最早の支障」か
  // 「待ちを入れた駅に着く時刻」のどちらか早いほう以降に限られる
  let lowBound = -Infinity;

  for (let guard = 0; guard < maxSteps; guard++) {
    iterations = guard;
    // いちばん早い支障を1件だけ解く
    let worst = null;
    for (const [sec, runs] of bySec) {
      const single = typeof sec === 'number' && sectionSingle(line, sec);
      let i0 = 0;
      if (lowBound > -Infinity) {
        let lo = 0, hi = runs.length;
        const from = lowBound - maxSpan;
        while (lo < hi) { const m = (lo + hi) >> 1; if (runs[m].start < from) lo = m + 1; else hi = m; }
        i0 = lo;
      }
      for (let i = i0; i < runs.length; i++) {
        const q = runs[i];
        if (worst && q.start > worst.at) break;           // これより後は最早の支障になりえない
        for (let j = i + 1; j < runs.length; j++) {
          const r = runs[j];
          if (r.start > q.end + headway) break;          // 以降は時間が離れている
          if (worst && r.start >= worst.at) break;
          if (q.trainId === r.trainId) continue;
          const key = q.trainId < r.trainId ? `${q.trainId}|${r.trainId}|${sec}` : `${r.trainId}|${q.trainId}|${sec}`;
          if (gaveUp.has(key)) continue;
          const opposing = q.up !== r.up;
          let kind = classify(q, r, single, headway);
          if (!kind) continue;
          // 同一方向で、あとから来る列車のほうが優等なら、先行の遅い列車が待避する
          const qT = byId.get(q.trainId), rT = byId.get(r.trainId);
          if (!opposing && trainRank(rT) > trainRank(qT)) kind = 'overtake';
          else if (kind === 'overtake') kind = trainRank(rT) > trainRank(qT) ? 'overtake' : 'follow';
          const at = Math.max(q.start, r.start);
          if (!worst || at < worst.at) worst = { kind, sec, q, r, at, key, single };
        }
      }
    }
    if (!worst) break;
    lowBound = worst.at;
    if (conflicts.length > list.length) break;    // 解けない支障が多すぎる（計画不能）

    // 待つ列車を決める：追い越しは遅い方（先に入った方）、それ以外は後から入る方
    const { kind, q, r, sec, key } = worst;
    const slowFirst = kind === 'overtake';
    let yielder = slowFirst ? q : r;
    let other = slowFirst ? r : q;
    // 単線の行き違いは、どちらを待たせるか短く済むほうを選ぶ（優等列車はなるべく待たせない）
    // 行き違いは、待つ駅に対向列車が着くまで待つ（間の単線区間をまとめて明け渡す）
    const meetNeed = (y, o, h) => {
      const ot = byId.get(o.trainId), yt = byId.get(y.trainId);
      const oa = h && ot ? sched(ot).byIdx.get(h.idx) : null;
      const yd = h && yt ? sched(yt).byIdx.get(h.idx) : null;
      const until = oa ? (oa.arr ?? oa.dep) : o.end;
      const from = yd ? (yd.dep ?? yd.arr) : y.start;
      return Math.max(o.end + headway - y.start, until + headway - from);
    };
    if (kind === 'meet') {
      const opt = (y, o) => {
        const yt = byId.get(y.trainId);
        const h = yt ? holdStation(doc, stations, yt, sched(yt), y.from) : null;
        const need = meetNeed(y, o, h);
        const cur = h ? (holds[y.trainId][h.idx] || 0) : 0;
        const ok = !!h && need > 0 && cur + need <= maxHold;
        return { y, o, ok, cost: need * (1 + 0.35 * trainRank(yt || {})) };
      };
      const a = opt(r, q), b = opt(q, r);
      const pick = (b.ok && (!a.ok || b.cost < a.cost)) ? b : a;
      yielder = pick.y; other = pick.o;
    }
    const yTrain = byId.get(yielder.trainId);
    const oTrain = byId.get(other.trainId);
    if (!yTrain || !oTrain) { gaveUp.add(key); continue; }
    const yStops = sched(yTrain);
    const hs = holdStation(doc, stations, yTrain, yStops, yielder.from);
    // 単線は「対向が抜けるまで」、複線は「前後の間隔を確保できるまで」待つ
    const raw = worst.single
      ? (kind === 'meet' ? meetNeed(yielder, other, hs) : other.end + headway - yielder.start)
      : yielder.station
        ? other.end + headway * 2 / 3 - yielder.start  // 駅：前の列車が出て（通過して）から入る
        : Math.max(headway - (yielder.start - other.start), headway - (yielder.end - other.end));
    const need = Math.ceil(raw / 30) * 30;
    const cur = hs ? (holds[yielder.trainId][hs.idx] || 0) : 0;

    if (!hs || need <= 0 || cur + need > maxHold) {
      gaveUp.add(key);
      conflicts.push({
        kind, sec, trains: [yTrain, oTrain],
        message: kind === 'meet'
          ? `単線区間「${secName(stations, sec)}」で ${num(yTrain)} と ${num(oTrain)} が行き違えません（手前に交換できる駅がありません）`
          : kind === 'overtake'
            ? `「${secName(stations, sec)}」で ${num(oTrain)} が ${num(yTrain)} に追いつきますが、待避できる駅がありません`
            : `「${secName(stations, sec)}」で ${num(yTrain)} と ${num(oTrain)} の間隔が確保できません`,
      });
      continue;
    }

    holds[yielder.trainId][hs.idx] = cur + need;
    {
      const hs0 = yStops.find(x => x.idx === hs.idx);
      if (hs0) lowBound = Math.min(lowBound, (hs0.arr ?? hs0.dep) - headway);
    }
    removeRuns(yTrain.id);
    schedCache.delete(yTrain.id);
    insertRuns(yTrain);
    const ev = events.find(e => e.trainId === yielder.trainId && e.idx === hs.idx && e.otherId === other.trainId);
    if (ev) { ev.wait += need; }
    else {
      events.push({
        kind, idx: hs.idx, sec, trainId: yielder.trainId, otherId: other.trainId,
        train: yTrain, other: oTrain, wait: need, atOrigin: !!hs.atOrigin,
      });
    }
  }

  // 収束後に、駅ごとに全列車の番線を時刻順に割り当て直す（待つ列車は副本線、通過する列車は本線）
  assignPlatforms(doc, line, stations, list, sched, holds, plats);

  // 待ち時間の合計・時刻を添える
  for (const e of events) {
    const stops = sched(e.train);
    const st = stops.find(s => s.idx === e.idx);
    e.wait = holds[e.trainId][e.idx] || e.wait;
    e.arr = st ? st.arr : null;
    e.dep = st ? st.dep : null;
    e.station = stations[e.idx] ? stations[e.idx].name : '?';
    e.oper = st ? !!st.oper : false;
  }
  events.sort((a, b) => (a.arr ?? a.dep ?? 0) - (b.arr ?? b.dep ?? 0));
  const exhausted = iterations >= maxSteps - 1;
  return { holds, platforms: plats, events, conflicts, iterations, exhausted };
}

/**
 * 駅ごとに番線を割り当てる（区間スケジューリング）。
 * 列車を着時刻順に見て、空いている番線のうち好ましい順に入れる：
 *   待ち（待避・行き違い）のある列車 … 進行方向左の副本線 → ほかの副本線 → 本線
 *   待たない列車                     … これまでの割り当て → 本線 → 副本線
 * 本線は、前後が複線なら上下で別の線路とみなす（1本の線で複線を表しているため）。
 */
export function assignPlatforms(doc, line, stations, trains, sched, holds, plats, gapSec = 60) {
  const byStation = new Map();
  for (const t of trains) {
    for (const st of sched(t)) {
      if (!byStation.has(st.idx)) byStation.set(st.idx, []);
      byStation.get(st.idx).push({ t, st });
    }
  }
  const dbl = i => !sectionSingle(line, i);
  for (const [idx, list] of byStation) {
    const stn = stations[idx];
    if (!stn || !stn.object) continue;
    const ids = stationTracks(doc, stn.object);
    if (ids.length < 2) continue;                      // 番線が1本なら選びようがない
    const mainId = stn.object.trackId;
    const splitMain = dbl(idx - 1) && dbl(idx);
    const trackPts = new Map(ids.map(id => [id, (doc.tracks.find(k => k.id === id) || {}).points || []]));
    const leftOf = (t, id) => {
      const up = t.toIdx < t.fromIdx;
      const pa = stations[up ? idx + 1 : idx - 1], pb = stations[up ? idx - 1 : idx + 1];
      const pts = trackPts.get(id);
      if (!pa || !pb || !pa.object || !pb.object || !pts.length) return false;
      const m = pts[Math.floor(pts.length / 2)], o = stn.object;
      return (pb.object.x - pa.object.x) * (m.y - o.y) - (pb.object.y - pa.object.y) * (m.x - o.x) < 0;
    };
    const busy = new Map();                            // key → [[from, to], ...]
    const keyOf = (t, id) => (id === mainId && splitMain ? `${id}|${t.toIdx < t.fromIdx ? 'u' : 'd'}` : id);
    const free = (k, a, b) => !(busy.get(k) || []).some(([x, y]) => a < y && x < b);
    list.sort((p, q) => (p.st.arr ?? p.st.dep) - (q.st.arr ?? q.st.dep));
    for (const { t, st } of list) {
      const a = (st.arr ?? st.dep) - gapSec / 2, b = (st.dep ?? st.arr) + gapSec / 2;
      const waits = (+((holds[t.id] || {})[idx]) || 0) > 0;
      const ends = idx === t.fromIdx || idx === t.toIdx;
      const hint = (t.platforms || {})[idx] || (plats[t.id] || {})[idx];
      const score = id => {
        if (id === hint && (!waits || id !== mainId)) return 0;
        if (waits) return id === mainId ? 4 : leftOf(t, id) ? 1 : 2;
        if (ends) return id === mainId ? 2 : leftOf(t, id) ? 1 : 3;
        return id === mainId ? 1 : leftOf(t, id) ? 2 : 3;
      };
      const order = ids.slice().sort((x, y) => score(x) - score(y));
      const pick = order.find(id => free(keyOf(t, id), a, b)) || order[0];
      const k = keyOf(t, pick);
      if (!busy.has(k)) busy.set(k, []);
      busy.get(k).push([a, b]);
      if (!plats[t.id]) plats[t.id] = {};
      if (pick === mainId && !(t.platforms || {})[idx]) delete plats[t.id][idx];
      else plats[t.id][idx] = pick;
    }
  }
}

const num = t => t.number || t.name || '列車';
const secName = (stations, sec) => (typeof sec === 'string'
  ? `${stations[+sec.slice(1)] ? stations[+sec.slice(1)].name : '?'}駅`
  : `${stations[sec] ? stations[sec].name : '?'}〜${stations[sec + 1] ? stations[sec + 1].name : '?'}`);

/**
 * いまのダイヤの支障を検出する（単線の行き違い不可・追い越し・時隔不足）。
 * planMeets と同じ判定なので、「自動調整」で消えるものと一致する。
 */
export function detectConflicts(doc, line, stations, trains, opts = {}) {
  const headway = Math.max(30, opts.headwaySec ?? doc.settings.minHeadwaySec ?? 90);
  const bySec = new Map();
  const noPass = noPassStations(doc, line, stations);
  for (const t of trains) {
    if (isCompanion(doc, t)) continue;
    for (const r of sectionRuns(computeSchedule(doc, stations, t), t.id, noPass)) {
      if (!bySec.has(r.sec)) bySec.set(r.sec, []);
      bySec.get(r.sec).push({ ...r, train: t });
    }
  }
  const issues = [];
  for (const [sec, runs] of bySec) {
    runs.sort((a, b) => a.start - b.start);
    const single = typeof sec === 'number' && sectionSingle(line, sec);
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const q = runs[i], r = runs[j];
        if (r.start > q.end + headway) break;
        const kind = classify(q, r, single, headway);
        if (!kind) continue;
        issues.push({
          level: kind === 'follow' ? 'warn' : 'error', kind, sec,
          at: Math.max(q.start, r.start), trains: [q.train, r.train],
          message: kind === 'meet'
            ? `単線区間「${secName(stations, sec)}」で ${num(q.train)} と ${num(r.train)} が行き違えません（${fmtHM(Math.max(q.start, r.start))}頃）`
            : kind === 'overtake'
              ? `「${secName(stations, sec)}」で ${num(r.train)} が ${num(q.train)} に追いつきます（待避が必要・${fmtHM(Math.max(q.start, r.start))}頃）`
              : `「${secName(stations, sec)}」で ${num(q.train)} と ${num(r.train)} の運転時隔が足りません（${fmtHM(Math.max(q.start, r.start))}頃）`,
        });
      }
    }
  }
  issues.sort((a, b) => a.at - b.at);
  return issues;
}

/** 計画した待ち時間が今のダイヤと違うか */
export function holdsDiffer(trains, holds) {
  for (const t of trains) {
    const a = t.holds || {}, b = holds[t.id] || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if ((+a[k] || 0) !== (+b[k] || 0)) return true;
  }
  return false;
}

/** 待ち時間の合計[秒]と本数 */
export function holdsSummary(trains) {
  let total = 0, n = 0;
  for (const t of trains) {
    const v = Object.values(t.holds || {}).reduce((s, x) => s + (+x || 0), 0);
    if (v > 0) { total += v; n++; }
  }
  return { total, trains: n };
}

/**
 * 緩急接続：ある駅で先に着いた列車から、あとから出る優等列車に乗り換えられる組。
 * 乗換時間と「終着までの短縮時分」を出す。
 */
export function connections(doc, stations, trains, opts = {}) {
  const minTransfer = opts.minTransferSec ?? 60;
  const maxWait = opts.maxWaitSec ?? 20 * 60;
  const out = [];
  const cache = new Map();
  const stopsOf = t => {
    if (!cache.has(t.id)) cache.set(t.id, computeSchedule(doc, stations, t));
    return cache.get(t.id);
  };
  // 駅ごと・方向ごとにまとめる
  const at = new Map();   // key: `${idx}|${up}` → [{train, stop}]
  for (const t of trains) {
    if (isCompanion(doc, t)) continue;
    for (const st of stopsOf(t)) {
      if (st.skip) continue;
      const key = `${st.idx}|${t.toIdx < t.fromIdx ? 'up' : 'down'}`;
      if (!at.has(key)) at.set(key, []);
      at.get(key).push({ train: t, stop: st });
    }
  }
  for (const [key, arr] of at) {
    const idx = +key.split('|')[0];
    arr.sort((a, b) => (a.stop.arr ?? a.stop.dep) - (b.stop.arr ?? b.stop.dep));
    for (let i = 0; i < arr.length; i++) {
      const A = arr[i];
      const ta = A.stop.arr;
      if (ta == null || A.stop.dep == null) continue;   // その駅に到着する列車だけが乗り換え元になる
      let best = null;
      for (let j = 0; j < arr.length; j++) {
        if (i === j) continue;
        const B = arr[j];
        if (B.stop.dep == null) continue;
        const wait = B.stop.dep - ta;
        if (wait < minTransfer || wait > maxWait) continue;
        if (trainRank(B.train) <= trainRank(A.train)) continue;
        // 乗り換えると終着までどれだけ早いか
        const aStops = stopsOf(A.train), bStops = stopsOf(B.train);
        const up = B.train.toIdx < B.train.fromIdx;
        let saved = 0, atStation = null;
        for (const bs of bStops) {
          if (bs.idx === idx || bs.skip) continue;
          if (up ? bs.idx > idx : bs.idx < idx) continue;    // 乗り換えた先（進行方向の前方）だけを見る
          const as = aStops.find(x => x.idx === bs.idx && !x.skip);
          if (!as) continue;
          const d = (as.arr ?? as.dep) - (bs.arr ?? bs.dep);
          if (d > saved) { saved = d; atStation = stations[bs.idx] ? stations[bs.idx].name : null; }
        }
        if (saved <= 0) continue;
        // いちばん早く乗れる優等列車を「接続」とする
        if (!best || B.stop.dep < best.time) {
          best = {
            idx, station: stations[idx] ? stations[idx].name : '?',
            from: A.train, to: B.train, wait: Math.round(wait), saved: Math.round(saved), toStation: atStation,
            time: B.stop.dep, held: (A.stop.hold || 0) > 0,
          };
        }
      }
      if (best) out.push(best);
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

export { fmtHM };
