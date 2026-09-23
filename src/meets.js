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
  const maxHold = Math.max(60, opts.maxHoldSec ?? 20 * 60);
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
  // 駅ごとに、そこを通る列車（停車・通過とも）
  const atStation = new Map();
  /** 待避・交換する列車を、対向（通過）列車と別の番線に入れる */
  const sidePlatform = (yTrain, oTrain, idx, from, to) => {
    const stn = stations[idx];
    const listT = stn && stn.object ? stationTracks(doc, stn.object) : [];
    if (listT.length < 2) return null;
    const used = trainPlatform(doc, { ...oTrain, platforms: plats[oTrain.id] }, stations, idx);
    // ほかの列車が使っていない番線を選ぶ。いま割り当てている副本線（向きに合ったもの）を先に、本線は最後に
    const upOf = t => t.toIdx < t.fromIdx;
    const mainId = stn && stn.object ? stn.object.trackId : null;
    const mine = plats[yTrain.id] && plats[yTrain.id][idx];
    // 左側通行：進行方向の左にある副本線を先に選ぶ
    const up = upOf(yTrain);
    const pa = stations[up ? idx + 1 : idx - 1], pb = stations[up ? idx - 1 : idx + 1];
    const o = stn.object;
    const leftOf = id => {
      if (!pa || !pb || !pa.object || !pb.object) return false;
      const t = doc.tracks.find(k => k.id === id);
      if (!t || !t.points.length) return false;
      const m = t.points[Math.floor(t.points.length / 2)];
      const tx = pb.object.x - pa.object.x, ty = pb.object.y - pa.object.y;
      return tx * (m.y - o.y) - ty * (m.x - o.x) < 0;
    };
    const rank = id => (id === mine && id !== mainId ? 0 : id === mainId ? 3 : leftOf(id) ? 1 : 2);
    const cands = listT.filter(id => id !== used).sort((a, b) => rank(a) - rank(b));
    for (const id of cands) {
      let free = true;
      for (const t of atStation.get(idx) || []) {
        if (t.id === yTrain.id || t.id === oTrain.id) continue;
        const stop = sched(t).byIdx.get(idx);
        if (!stop) continue;
        const a0 = (stop.arr ?? stop.dep) - headway / 2, b0 = (stop.dep ?? stop.arr) + headway / 2;
        if (b0 <= from || a0 >= to) continue;           // 時間が重ならない列車は番線を見ない
        if (trainPlatform(doc, { ...t, platforms: plats[t.id] }, stations, idx) !== id) continue;
        if (id === mainId && upOf(t) !== upOf(yTrain)) continue;   // 本線は上下別
        const a = (stop.arr ?? stop.dep) - headway / 2, b = (stop.dep ?? stop.arr) + headway / 2;
        if (Math.min(b, to) - Math.max(a, from) > 0) { free = false; break; }
      }
      if (free) return id;
    }
    return cands[0] || null;
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
  for (const t of list) {
    insertRuns(t);
    for (const st of sched(t)) {
      if (!atStation.has(st.idx)) atStation.set(st.idx, []);
      atStation.get(st.idx).push(t);
    }
  }
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
    const yielder = slowFirst ? q : r;
    const other = slowFirst ? r : q;
    const yTrain = byId.get(yielder.trainId);
    const oTrain = byId.get(other.trainId);
    const yStops = sched(yTrain);
    if (!yTrain || !oTrain) { gaveUp.add(key); continue; }
    const hs = holdStation(doc, stations, yTrain, yStops, yielder.from);
    // 単線は「対向が抜けるまで」、複線は「前後の間隔を確保できるまで」待つ
    const raw = worst.single
      ? other.end + headway - yielder.start
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
    const hStop = yStops.find(x => x.idx === hs.idx);
    const hFrom = hStop ? (hStop.arr ?? hStop.dep) : yielder.start;
    const side = sidePlatform(yTrain, oTrain, hs.idx, hFrom - headway / 2, hFrom + cur + need + headway);
    if (side) plats[yielder.trainId][hs.idx] = side;
    const ev = events.find(e => e.trainId === yielder.trainId && e.idx === hs.idx && e.otherId === other.trainId);
    if (ev) { ev.wait += need; }
    else {
      events.push({
        kind, idx: hs.idx, sec, trainId: yielder.trainId, otherId: other.trainId,
        train: yTrain, other: oTrain, wait: need, atOrigin: !!hs.atOrigin,
      });
    }
  }

  // 収束後に、待避する列車の番線をもう一度選び直す（他の列車の最終時刻で判定する）
  for (const e of events) {
    const yTrain = byId.get(e.trainId), oTrain = byId.get(e.otherId);
    if (!yTrain || !oTrain) continue;
    const stop = sched(yTrain).find(x => x.idx === e.idx);
    if (!stop) continue;
    const from = (stop.arr ?? stop.dep) - headway / 2;
    const to = (stop.dep ?? stop.arr) + headway / 2;
    const side = sidePlatform(yTrain, oTrain, e.idx, from, to);
    if (side) plats[e.trainId][e.idx] = side;
  }

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
