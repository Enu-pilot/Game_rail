// 需要（駅の人口・時間帯別の流動）・乗車シミュレーション（混雑率・積み残し）・収支

import { computeSchedule, trainType } from './timetable.js';
import { throughChain, selfOperator } from './operators.js';

export const STATION_KINDS = [
  { id: 'residential', name: '住宅地', out: 'morning', attract: 0.25 },
  { id: 'mixed', name: '住宅＋商業', out: 'flat', attract: 0.6 },
  { id: 'urban', name: '都心・ターミナル', out: 'evening', attract: 1.0 },
  { id: 'business', name: 'オフィス街', out: 'evening', attract: 0.95 },
  { id: 'school', name: '学園都市', out: 'morning', attract: 0.7 },
  { id: 'tourist', name: '観光地', out: 'flat', attract: 0.5 },
];
export const stationKind = id => STATION_KINDS.find(k => k.id === id) || STATION_KINDS[0];

/** 駅からの発生の時間帯分布（合計1） */
const OUT_SHAPES = {
  morning: [0, 0, 0, 0, .005, .02, .07, .16, .13, .07, .045, .04, .04, .04, .04, .045, .055, .065, .06, .04, .025, .015, .008, .002],
  evening: [0, 0, 0, 0, .002, .008, .02, .035, .04, .045, .05, .05, .05, .05, .055, .06, .08, .12, .13, .09, .05, .03, .02, .005],
  flat: [0, 0, 0, 0, .004, .015, .045, .09, .08, .06, .055, .055, .055, .055, .055, .06, .07, .085, .085, .06, .04, .02, .01, .001],
};
const outShape = kind => OUT_SHAPES[stationKind(kind).out] || OUT_SHAPES.flat;

/** 時間帯ごとの「通勤先としての強さ」（1=職場が目的地、0=自宅が目的地） */
const commuteWeight = h => {
  if (h >= 5 && h <= 10) return 0.92;
  if (h >= 11 && h <= 14) return 0.6;
  if (h >= 15 && h <= 16) return 0.45;
  if (h >= 17 && h <= 22) return 0.12;
  return 0.5;
};

const stationDemand = (o) => ({
  population: Number.isFinite(o.population) ? o.population : 20000,
  jobs: Number.isFinite(o.jobs) ? o.jobs : 4000,
  kind: o.kindId || o.demandKind || 'residential',
});

/**
 * 時間帯別のOD表（人/時）を作る
 * @returns {Array<Array<Array<number>>>} od[hour][i][j]
 */
export function odMatrix(doc, stations, line = null) {
  const n = stations.length;
  const rate = doc.settings.dailyTripRate ?? 0.55;
  const decayKm = doc.settings.demandDecayKm ?? 12;
  const info = stations.map(s => (s.object ? stationDemand(s.object) : { population: 0, jobs: 0, kind: 'residential' }));
  // 相互直通による境界駅の流出入（直通中止なら消える）
  const ext = new Array(n).fill(0);
  for (const th of (doc.throughLines || [])) {
    if (!line || th.lineId !== line.id || th.suspended) continue;
    const i = Math.max(0, Math.min(n - 1, th.stationIdx || 0));
    ext[i] += th.dailyPassengers || 0;
  }
  const od = [];
  for (let h = 0; h < 24; h++) {
    const w = commuteWeight(h);
    const m = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      const oi = (info[i].population * rate + ext[i]) * outShape(info[i].kind)[h];
      if (oi <= 0) continue;
      // 目的地の魅力度（朝は職場、夜は住宅）
      const attract = [];
      let sum = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) { attract.push(0); continue; }
        const km = Math.abs(stations[j].km - stations[i].km) / 1000;
        const a = (info[j].jobs * w + info[j].population * (1 - w) * 0.35 + ext[j] * 0.7)
          * stationKind(info[j].kind).attract / (1 + km / decayKm);
        attract.push(a); sum += a;
      }
      if (sum <= 0) continue;
      for (let j = 0; j < n; j++) m[i][j] = oi * (attract[j] / sum);
    }
    od.push(m);
  }
  return od;
}

/** 運賃（距離制・10円単位） */
export function fareFor(doc, km) {
  const base = doc.settings.fareBase ?? 150;
  const per = doc.settings.farePerKm ?? 22;
  const cap = doc.settings.fareCap ?? 1200;
  const v = base + per * Math.max(0, km);
  return Math.min(cap, Math.round(v / 10) * 10);
}

/**
 * ダイヤに沿って乗車をシミュレートする。
 * 1分きざみで乗客を発生させ、到着した列車に先着順で乗せる（定員の上限まで）。
 */
export function simulateDemand(doc, line, stations, trains) {
  const n = stations.length;
  if (!n || !trains.length) return null;
  const od = odMatrix(doc, stations, line);
  const capPerCar = doc.settings.capacityPerCar ?? 140;
  const maxLoad = doc.settings.maxLoadFactor ?? 2.0;        // 乗車率の上限（これ以上は積み残し）

  // 駅ごと・行先ごとの待ち行列（到着時刻つき）
  const queues = Array.from({ length: n }, () => Array.from({ length: n }, () => []));
  const stats = {
    byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, demand: 0, carried: 0, capacity: 0, left: 0, wait: 0, waitN: 0 })),
    sections: Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({
      idx: i, name: `${stations[i].name}〜${stations[i + 1].name}`,
      peak: 0, peakHour: null, peakTrain: null, byHour: new Float64Array(24), capHour: new Float64Array(24),
    })),
    totalPassengers: 0, passengerKm: 0, revenue: 0, left: 0,
    trainKm: 0, carKm: 0, trainCount: trains.length,
    foreignCarKm: 0,     // 自社線を走る他社車両
    throughCarKm: 0,     // 他社線を走る自社車両
  };
  const selfId = selfOperator(doc) ? selfOperator(doc).id : null;

  // 直通の列車で行ける駅の組（行けない組は途中駅で乗り換える）
  const served = Array.from({ length: n }, () => new Uint8Array(n));

  // 列車の停車イベントを時刻順に並べる
  const events = [];
  for (const tr of trains) {
    const stops = computeSchedule(doc, stations, tr).filter(s => !s.skip);
    if (stops.length < 2) continue;
    const cars = tr.cars || 10;
    const cap = cars * capPerCar;
    const order = stops.map(s => s.idx);
    const run = { train: tr, cars, cap, stops, order, onboard: new Float64Array(n), load: 0, xfer: new Map() };
    for (let a = 0; a < order.length; a++) for (let b = a + 1; b < order.length; b++) served[order[a]][order[b]] = 1;
    stops.forEach((s, k) => events.push({ t: s.dep ?? s.arr, run, k }));
    // 走行キロ
    const dist = Math.abs(stations[order[order.length - 1]].km - stations[order[0]].km) / 1000;
    stats.trainKm += dist;
    stats.carKm += dist * cars;
    const foreign = (tr.operatorId || selfId) !== selfId;
    if (foreign) stats.foreignCarKm += dist * cars;
    else {
      const chain = throughChain(doc, tr.throughId);
      const thKm = chain.reduce((a, x) => a + (x.km || 0), 0) * 2;   // 往復
      stats.throughCarKm += thKm * cars;
    }
  }
  events.sort((a, b) => a.t - b.t);
  if (!events.length) return null;

  const startT = Math.max(0, events[0].t - 1800);
  const endT = events[events.length - 1].t;
  let gen = startT;

  const generateUntil = (t) => {
    while (gen < t) {
      const h = Math.floor((gen / 3600) % 24);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const per = od[h][i][j] / 60;                    // 1分あたり
          if (per <= 0) continue;
          queues[i][j].push({ c: per, t: gen });
          stats.byHour[h].demand += per;
        }
      }
      gen += 60;
    }
  };

  for (const ev of events) {
    generateUntil(ev.t);
    const { run, k } = ev;
    const idx = run.stops[k].idx;
    const h = Math.floor((ev.t / 3600) % 24);

    // 降車（乗り換える人は、この駅で行先への列車を待つ）
    const off = run.onboard[idx];
    if (off > 0) { run.onboard[idx] = 0; run.load -= off; }
    const xs = run.xfer.get(idx);
    if (xs) {
      for (const x of xs) queues[idx][x.j].push({ c: x.c, t: ev.t, x: true });
      run.xfer.delete(idx);
    }

    // 乗車（この列車がこの先に停まる駅が行先の人）
    const ahead = run.order.slice(k + 1);
    const room = () => Math.max(0, run.cap * maxLoad - run.load);
    for (const j of ahead) {
      const q = queues[idx][j];
      let qi = 0;
      while (qi < q.length && room() > 1e-6) {
        const take = Math.min(q[qi].c, room());
        if (take <= 1e-9) break;
        q[qi].c -= take;
        run.onboard[j] += take; run.load += take;
        const km = Math.abs(stations[j].km - stations[idx].km) / 1000;
        const xf = !!q[qi].x;                     // 乗り換えてきた人（運賃は通しで、人数は数えない）
        if (!xf) stats.totalPassengers += take;
        stats.passengerKm += take * km;
        stats.revenue += take * (fareFor(doc, km) - (xf ? (doc.settings.fareBase ?? 150) : 0));
        if (!xf) stats.byHour[h].carried += take;
        stats.byHour[h].wait += take * (ev.t - q[qi].t);
        stats.byHour[h].waitN += take;
        if (q[qi].c <= 1e-9) qi++;
      }
      if (qi) q.splice(0, qi);
    }
    // 乗換え：直通の列車がない行先へは、この列車で行先にいちばん近い停車駅まで乗る
    if (ahead.length && room() > 1e-6) {
      const up = run.order[run.order.length - 1] < idx;
      for (let j = 0; j < n && room() > 1e-6; j++) {
        if (served[idx][j] || j === idx || (up ? j > idx : j < idx)) continue;
        const q = queues[idx][j];
        if (!q.length) continue;
        let m = -1;
        for (const a of ahead) if (up ? (a >= j && a < idx) : (a <= j && a > idx)) m = a;
        if (m < 0) continue;
        let qi = 0;
        while (qi < q.length && room() > 1e-6) {
          const take = Math.min(q[qi].c, room());
          if (take <= 1e-9) break;
          q[qi].c -= take;
          run.onboard[m] += take; run.load += take;
          if (!run.xfer.has(m)) run.xfer.set(m, []);
          run.xfer.get(m).push({ c: take, j });
          const km = Math.abs(stations[m].km - stations[idx].km) / 1000;
          if (!q[qi].x) stats.totalPassengers += take;
          stats.passengerKm += take * km;
          stats.revenue += take * (fareFor(doc, km) - (q[qi].x ? (doc.settings.fareBase ?? 150) : 0));
          stats.byHour[h].carried += q[qi].x ? 0 : take;
          stats.byHour[h].wait += take * (ev.t - q[qi].t);
          stats.byHour[h].waitN += take;
          if (q[qi].c <= 1e-9) qi++;
        }
        if (qi) q.splice(0, qi);
      }
    }

    // 区間の混雑率（この駅を発車したあとの乗車人員）
    if (k < run.stops.length - 1) {
      const nextIdx = run.stops[k + 1].idx;
      const lo = Math.min(idx, nextIdx), hi = Math.max(idx, nextIdx);
      for (let sIdx = lo; sIdx < hi; sIdx++) {
        const sec = stats.sections[sIdx];
        if (!sec) continue;
        sec.byHour[h] += run.load;
        sec.capHour[h] += run.cap;
        const ratio = run.load / Math.max(1, run.cap);
        if (ratio > sec.peak) { sec.peak = ratio; sec.peakHour = h; sec.peakTrain = run.train.number; }
      }
      stats.byHour[h].capacity += run.cap;
    }
  }
  generateUntil(endT);

  // 積み残し
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (const q of queues[i][j]) {
        if (q.c <= 1e-9) continue;
        stats.left += q.c;
        const h = Math.floor((q.t / 3600) % 24);
        stats.byHour[h].left += q.c;
      }
    }
  }

  stats.peakCongestion = stats.sections.reduce((m, s) => Math.max(m, s.peak), 0);
  const waited = stats.byHour.reduce((s, x) => s + x.waitN, 0);
  stats.avgWait = waited ? stats.byHour.reduce((s, x) => s + x.wait, 0) / waited : 0;
  stats.demandTotal = stats.byHour.reduce((s, x) => s + x.demand, 0);
  return stats;
}

/** 収支（1日あたり） */
export function finance(doc, stats, stations) {
  const s = doc.settings;
  // 他社車両が自社線を走るぶんは相手の費用。自社車両が他社線を走るぶんは自社の費用
  const ownCarKm = stats ? Math.max(0, stats.carKm - (stats.foreignCarKm || 0)) + (stats.throughCarKm || 0) : 0;
  const carKmCost = (s.costPerCarKm ?? 250) * ownCarKm;
  const cars = doc.formations.reduce((a, f) => a + (f.cars || 0) + (f.loco ? f.loco.count : 0), 0);
  const rollingStock = cars * (s.costPerCarDay ?? 12000);
  const routeKm = stations && stations.length ? (stations[stations.length - 1].km / 1000) : 0;
  const trackCost = routeKm * (s.costPerRouteKmDay ?? 90000);
  const stationCost = (stations ? stations.length : 0) * (s.costPerStationDay ?? 70000);
  const depotTracks = doc.tracks.filter(t => ['stabling', 'inspection', 'daily', 'periodic', 'special', 'washing', 'wheellathe'].includes(t.kind)).length;
  const depotCost = depotTracks * (s.costPerDepotTrackDay ?? 9000);
  // 検査費：仕業・全般は日数で、交番・重要部は走行キロで効いてくる
  const inspectCost = cars * (s.inspectCostPerCarDay ?? 4500)
    + ownCarKm * (s.inspectCostPerCarKm ?? 8);
  // 直通のキロ精算：他社車両が自社線を走った分を受け取り、自社車両が他社線を走った分を払う
  const settleRate = s.settlementPerCarKm ?? 60;
  const settlement = settleRate * ((stats ? stats.throughCarKm || 0 : 0) - (stats ? stats.foreignCarKm || 0 : 0));
  const cost = carKmCost + rollingStock + inspectCost + trackCost + stationCost + depotCost + settlement;
  const revenue = stats ? stats.revenue : 0;
  return {
    revenue,
    cost,
    profit: revenue - cost,
    opRatio: revenue > 0 ? (cost / revenue) * 100 : Infinity,
    breakdown: [
      { name: '運行費（車両キロ）', value: carKmCost },
      { name: '車両費', value: rollingStock },
      { name: '検査費', value: inspectCost },
      { name: '直通の車両使用料', value: settlement },
      { name: '線路保守', value: trackCost },
      { name: '駅運営', value: stationCost },
      { name: '車両基地', value: depotCost },
    ],
    cars, routeKm, depotTracks, inspectCost, settlement, ownCarKm,
  };
}

/** 経営の評価（ゲームの達成判定） */
export function evaluate(doc, stats, fin) {
  const targetCong = doc.settings.targetCongestion ?? 180;
  const goals = [
    {
      name: `ピーク混雑率 ${targetCong}% 以下`,
      ok: stats ? stats.peakCongestion * 100 <= targetCong : false,
      value: stats ? `${(stats.peakCongestion * 100).toFixed(0)}%` : '—',
    },
    {
      name: '積み残しゼロ',
      ok: stats ? stats.left < 1 : false,
      value: stats ? `${Math.round(stats.left).toLocaleString('ja-JP')} 人` : '—',
    },
    {
      name: '黒字（営業係数 100 未満）',
      ok: fin.profit > 0,
      value: Number.isFinite(fin.opRatio) ? fin.opRatio.toFixed(0) : '—',
    },
    {
      name: `平均待ち時間 ${doc.settings.targetWaitMin ?? 8} 分以下`,
      ok: stats ? stats.avgWait <= (doc.settings.targetWaitMin ?? 8) * 60 : false,
      value: stats ? `${(stats.avgWait / 60).toFixed(1)} 分` : '—',
    },
  ];
  const score = Math.round((goals.filter(g => g.ok).length / goals.length) * 100);
  return { goals, score };
}

export const CONGESTION_BANDS = [
  { max: 1.0, name: '余裕', color: '#2bd4a4' },
  { max: 1.5, name: 'やや混雑', color: '#ffd23f' },
  { max: 1.8, name: '混雑', color: '#ff7a3d' },
  { max: Infinity, name: '激しい混雑', color: '#e0344a' },
];
export const congestionBand = ratio => CONGESTION_BANDS.find(b => ratio <= b.max) || CONGESTION_BANDS[3];
