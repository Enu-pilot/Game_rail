// 車両運用（仕業）と検査期限
//
// ダイヤの列車を「終着駅＝次の始発駅」でつないで1日の運用（行路）を組み、
// 運用ごとに編成を充当する。編成には走行キロと経過日数が溜まり、
// 仕業検査・交番検査・重要部検査・全般検査の期限が来ると検修線に入れる必要がある。

import { computeSchedule, stationName, nearbyTracks, canRunAround, runAroundSec, isCompanion } from './timetable.js';
import { trackKind } from './catalog.js';
import { formationCars } from './store.js';
import {
  trainRequirement, mergeRequirements, canRun, throughCost, throughChain, selfOperator, operatorOf,
  SAFETY_DEVICES, throughOf,
} from './operators.js';

/** 検査の種類（JRの一般的な周期に準拠） */
export const INSPECTIONS = [
  { id: 'daily',     name: '仕業検査',   days: 3,      km: null,   hours: 3,   trackKinds: ['daily', 'inspection'],           cost: 60000 },
  { id: 'periodic',  name: '交番検査',   days: 90,     km: 30000,  hours: 24,  trackKinds: ['periodic', 'inspection'],        cost: 900000 },
  { id: 'important', name: '重要部検査', days: 4 * 365, km: 600000, hours: 24 * 8, trackKinds: ['inspection', 'special'],    cost: 32000000 },
  { id: 'general',   name: '全般検査',   days: 8 * 365, km: null,   hours: 24 * 16, trackKinds: ['inspection', 'special'],   cost: 78000000 },
];
export const inspectionDef = id => INSPECTIONS.find(i => i.id === id) || INSPECTIONS[0];

/** 編成の検査記録を初期化する */
export function initInspection(f) {
  if (f.inspection && f.inspection.daily) return f.inspection;
  f.inspection = {};
  for (const i of INSPECTIONS) f.inspection[i.id] = { days: 0, km: 0 };
  if (!Number.isFinite(f.odoKm)) f.odoKm = 0;
  return f.inspection;
}

/** 列車の走行キロ[m] */
export function trainDistance(doc, stations, train) {
  const stops = computeSchedule(doc, stations, train);
  if (stops.length < 2) return 0;
  return Math.abs(stops[stops.length - 1].km - stops[0].km);
}

/**
 * 運用（行路）を組む。終着駅で折り返して次の列車になれるものをつなぐ。
 * @returns {{rosters:Array, unassigned:Array}}
 */
export function buildRosters(doc, line, stations, trains, opts = {}) {
  const minTurn = opts.minTurnSec ?? (doc.settings.reversalMinutes ?? 2) * 60 + 180;
  const maxIdle = opts.maxIdleSec ?? 4 * 3600;
  const self = selfOperator(doc);
  const selfId = self ? self.id : null;
  // 発時刻は時刻表から取る（併結する付属編成は相手の列車の時刻で走る）
  const depOf = new Map(trains.map(t => {
    const st0 = computeSchedule(doc, stations, t)[0];
    return [t.id, st0 && st0.dep != null ? st0.dep : t.departSec];
  }));
  const list = trains.slice().sort((a, b) => depOf.get(a.id) - depOf.get(b.id));
  // 環状線の始発駅と終着駅のように、同じ名前の駅は同じ駅とみなす
  const sameStation = (a, b) => a === b || (!!stations[a] && !!stations[b] && stations[a].name === stations[b].name);
  const rosters = [];
  /** 直通に出ている間、編成は戻ってこない（往復＋折返し） */
  const awaySec = t => {
    if (!t.throughId) return 0;
    const c = throughCost(doc, t.throughId);
    return c.chain.length ? c.min * 60 * 2 + minTurn : 0;
  };
  const awayKm = t => (t.throughId ? throughCost(doc, t.throughId).km * 2 : 0);
  for (const t of list) {
    const stops = computeSchedule(doc, stations, t);
    const arr = stops[stops.length - 1];
    const dist = trainDistance(doc, stations, t);
    const op = t.operatorId || selfId;
    let best = null;
    const treq = trainRequirement(doc, line, t);
    let bestRA = false;
    for (const r of rosters) {
      if (!sameStation(r.lastIdx, t.fromIdx)) continue;
      if (r.toDepot) continue;                       // 入庫した運用にはつながない
      if ((r.operatorId || selfId) !== op) continue; // 他社の車両とはつながない
      // 1運用は1編成が通しで担当するので、両数と乗入れ制限が両立しない列車はつなげない
      if (Math.max(r.cars, t.cars || 1) > Math.min(r.reqMaxCars, treq.maxCars)) continue;
      // 両数の違う列車は同じ編成でつながない設定（増解結をしない路線）
      if (doc.settings.rosterSameCars && r.cars !== (t.cars || 1)) continue;
      // 機関車牽引の列車は機関車牽引どうしでつなぐ。折り返すときは機回しが要る
      const prev = r.trains[r.trains.length - 1];
      if (!!prev.loco !== !!t.loco) continue;
      const reverse = Math.sign(prev.toIdx - prev.fromIdx) !== Math.sign(t.toIdx - t.fromIdx);
      const ra = !!t.loco && reverse;
      if (ra && !canRunAround(doc, stations[t.fromIdx])) continue;
      const need = r.needGap + (ra ? runAroundSec(doc) : 0);
      const gap = depOf.get(t.id) - r.lastArr;
      if (gap < need || gap > maxIdle + need) continue;
      // 両数が同じ運用を優先し、その中で先着順（いちばん長く待っている運用から使う）＝必要編成数が最小になる
      const same = r.cars === (t.cars || 1);
      const bestSame = best && best.cars === (t.cars || 1);
      if (!best || (same && !bestSame) || (same === bestSame && r.lastArr < best.lastArr)) { best = r; bestRA = ra; }
    }
    if (best) {
      if (bestRA) best.runArounds.push({ idx: t.fromIdx, name: stations[t.fromIdx] ? stations[t.fromIdx].name : '?', at: depOf.get(t.id) });
      best.trains.push(t);
      best.lastIdx = t.toIdx;
      best.lastArr = arr.arr ?? arr.dep ?? depOf.get(t.id);
      best.distance += dist + awayKm(t) * 1000;
      best.toDepot = !!t.toDepot;
      best.end = best.lastArr + awaySec(t);
      best.needGap = minTurn + awaySec(t);
      const c = t.cars || 1;
      if (c !== best.cars) best.coupling = true;     // 途中で両数が変わる＝増解結が必要
      best.cars = Math.max(best.cars, c);
      if (t.throughId) best.throughIds.add(t.throughId);
      best.reqMaxCars = Math.min(best.reqMaxCars, treq.maxCars);
    } else {
      rosters.push({
        id: `duty${rosters.length + 1}`,
        no: rosters.length + 1,
        trains: [t], cars: t.cars || 1,
        lastIdx: t.toIdx,
        lastArr: arr.arr ?? arr.dep ?? depOf.get(t.id),
        start: depOf.get(t.id), end: (arr.arr ?? depOf.get(t.id)) + awaySec(t),
        startIdx: t.fromIdx,
        distance: dist + awayKm(t) * 1000,
        toDepot: !!t.toDepot,
        operatorId: op,
        needGap: minTurn + awaySec(t),
        throughIds: new Set(t.throughId ? [t.throughId] : []),
        reqMaxCars: treq.maxCars,
        runArounds: [],
        loco: !!t.loco,
      });
    }
  }
  for (const r of rosters) {
    r.name = `${String(r.no).padStart(2, '0')} 運用`;
    r.stayIdx = r.lastIdx;
    r.hours = (r.end - r.start) / 3600;
    r.km = r.distance / 1000;
    r.startName = stations[r.startIdx] ? stations[r.startIdx].name : '?';
    r.endName = stations[r.lastIdx] ? stations[r.lastIdx].name : '?';
    r.req = mergeRequirements(r.trains.map(t => trainRequirement(doc, line, t)));
    r.through = r.req.through;
    r.foreign = (r.operatorId || selfId) !== selfId;
    r.operator = operatorOf(doc, r.operatorId);
    r.coupled = r.trains.filter(t => isCompanion(doc, t)).length;   // 付属編成として併結する列車の数
  }
  return rosters;
}

/** 検査・修繕の線に入っている編成は運用に使えない */
const SHOP_KINDS = ['inspection', 'daily', 'periodic', 'special', 'wheellathe', 'scrap'];
export function inShop(doc, f) {
  const t = doc.tracks.find(x => x.id === f.trackId);
  return !!t && SHOP_KINDS.includes(t.kind);
}

/** 運用に使える編成（旅客用で、検査中でないもの） */
export function availableFormations(doc) {
  return doc.formations.filter(f => ['emu', 'dmu', 'coach'].includes(f.vehicle) && !inShop(doc, f));
}

/** いま検査・修繕に入っている編成 */
export function shopFormations(doc) {
  return doc.formations.filter(f => ['emu', 'dmu', 'coach'].includes(f.vehicle) && inShop(doc, f));
}

/**
 * 運用に編成を割り当てる。
 * 保安装置・最大両数・所属事業者の条件を満たす編成のうち、
 * 「その運用にしか入れない編成」から先に埋める（条件の厳しい運用を取りこぼさない）。
 * @returns {{assign:Object, short:number, used:Array, unmet:Array}}
 */
export function assignFormations(doc, rosters) {
  const selfId = selfOperator(doc) ? selfOperator(doc).id : null;
  const pool = availableFormations(doc).map(f => ({
    f, cars: formationCars(f), km: f.odoKm || 0, op: f.operatorId || selfId,
  })).sort((a, b) => a.km - b.km);
  const assign = {};
  const used = new Set();
  const unmet = [];
  // 運用ごとに入れる編成を数え、候補の少ない運用から割り当てる
  const targets = rosters.filter(r => !r.foreign);
  const fits = new Map();
  for (const r of targets) {
    fits.set(r.id, pool.filter(p => {
      if ((p.op || selfId) !== selfId) return false;          // 自社の運用は自社の車両で
      if (p.cars < r.cars) return false;                      // 両数が足りない
      return canRun(doc, p.f, r.req).ok;
    }));
  }
  for (const r of targets.slice().sort((a, b) =>
    (fits.get(a.id).length - fits.get(b.id).length) || (b.distance - a.distance))) {
    const cand = fits.get(r.id).find(p => !used.has(p.f.id));
    if (cand) { assign[r.id] = cand.f.id; used.add(cand.f.id); }
    else {
      // なぜ入れないのかを集める
      const reasons = new Set();
      for (const p of pool) {
        if (used.has(p.f.id)) continue;
        if (p.cars < r.cars) { reasons.add(`${r.cars}両に足りる編成がない`); continue; }
        const c = canRun(doc, p.f, r.req);
        if (c.overCars) reasons.add(`乗入れ先の最大 ${r.req.maxCars} 両を超える`);
        for (const m of c.missing) reasons.add(`${safetyNameOf(m)} 未搭載`);
      }
      unmet.push({ roster: r, reasons: [...reasons].slice(0, 3) });
    }
  }
  return { assign, short: unmet.length, used: [...used], unmet };
}

const safetyNameOf = id => {
  const d = SAFETY_DEVICES.find(x => x.id === id);
  return d ? d.name : id;
};

/** 検査の状態（残り日数・残りキロ・期限切れ） */
export function inspectionStatus(f, dailyKm = 0) {
  const ins = initInspection(f);
  return INSPECTIONS.map(def => {
    const cur = ins[def.id] || { days: 0, km: 0 };
    const leftDays = def.days - (cur.days || 0);
    const leftKm = def.km != null ? def.km - (cur.km || 0) : null;
    const byKm = leftKm != null && dailyKm > 0 ? leftKm / dailyKm : Infinity;
    const daysLeft = Math.min(leftDays, byKm);
    return {
      id: def.id, name: def.name, def,
      days: cur.days || 0, km: cur.km || 0,
      leftDays, leftKm, daysLeft,
      over: leftDays < 0 || (leftKm != null && leftKm < 0),
      soon: daysLeft <= Math.max(1, def.days * 0.1),
    };
  });
}

/** 検査を実施して記録をリセットする */
export function doInspection(f, id) {
  const ins = initInspection(f);
  ins[id] = { days: 0, km: 0 };
  // 上位の検査は下位の検査を兼ねる
  const order = INSPECTIONS.map(i => i.id);
  const at = order.indexOf(id);
  for (let i = 0; i < at; i++) ins[order[i]] = { days: 0, km: 0 };
  return inspectionDef(id).cost;
}

/** 編成に走行キロと日数を足す */
export function accrue(f, km, days) {
  const ins = initInspection(f);
  f.odoKm = (f.odoKm || 0) + km;
  for (const i of INSPECTIONS) {
    ins[i.id].km = (ins[i.id].km || 0) + km;
    ins[i.id].days = (ins[i.id].days || 0) + days;
  }
}

/** 配線にある検修設備の本数 */
export function depotCapacity(doc) {
  const count = kinds => doc.tracks.filter(t => kinds.includes(t.kind)).length;
  return {
    daily: count(['daily']),
    periodic: count(['periodic']),
    special: count(['special']),
    inspection: count(['inspection']),
    washing: count(['washing']),
    stabling: doc.tracks.filter(t => trackKind(t.kind).stabling).length,
  };
}

/**
 * 1日あたりに必要な検修線の本数。
 * 各検査は「周期ごとに1回・所要時間ぶん線路を占有する」として、同時に使う本数の期待値を出す。
 */
export function inspectionLoad(doc, formations, dailyKmOf) {
  const cap = depotCapacity(doc);
  return INSPECTIONS.map(def => {
    let tracks = 0;
    for (const f of formations) {
      const km = dailyKmOf(f) || 0;
      const byDays = def.days;
      const byKm = def.km != null && km > 0 ? def.km / km : Infinity;
      const interval = Math.max(1, Math.min(byDays, byKm));   // 何日に1回か
      tracks += (def.hours / 24) / interval;                  // 常時占有する線路数
    }
    const have = def.trackKinds.reduce((s, k) => s + (cap[k] || 0), 0);
    return { def, need: tracks, have, short: tracks > have };
  });
}

/** 運用のまとめ */
export function dutySummary(doc, line, stations, trains) {
  const rosters = buildRosters(doc, line, stations, trains);
  const { assign, short, unmet } = assignFormations(doc, rosters);
  const kmByFormation = {};
  for (const r of rosters) {
    const fid = assign[r.id];
    if (fid) kmByFormation[fid] = (kmByFormation[fid] || 0) + r.km;
  }
  const totalKm = rosters.reduce((s, r) => s + r.km, 0);
  // 夜間滞泊（運用の終着駅ごとの本数）
  const stay = {};
  for (const r of rosters) {
    if (r.toDepot) { stay.depot = (stay.depot || 0) + 1; continue; }
    // 最後の列車が直通なら、その編成は相手の基地で滞泊する
    const lastT = r.trains[r.trains.length - 1];
    const chain = throughChain(doc, lastT && lastT.throughId);
    if (chain.length) {
      const nm = `${chain[chain.length - 1].name}（他社）`;
      stay[nm] = (stay[nm] || 0) + 1;
      r.stayAway = true;
      continue;
    }
    const nm = stations[r.stayIdx] ? stations[r.stayIdx].name : '?';
    stay[nm] = (stay[nm] || 0) + 1;
  }
  // 夜間滞泊できるか（駅の番線＋近くの留置線と比べる）
  const stayIssues = [];
  for (const [nm, n] of Object.entries(stay)) {
    if (nm === 'depot' || nm.endsWith('（他社）')) continue;
    const s2 = stations.find(x => x.name === nm);
    if (!s2 || !s2.object) continue;
    const tracks = (s2.object.tracks || []).length || 1;
    const sidings = nearbyTracks(doc, s2.object, 600).filter(r => trackKind(r.track.kind).stabling).length;
    const have = tracks + sidings;
    if (n > have) stayIssues.push({ name: nm, need: n, have, tracks, sidings });
  }
  const own = rosters.filter(r => !r.foreign);
  const foreign = rosters.filter(r => r.foreign);
  // 直通先ごとの走行キロ（他社線を走った自社車両のキロ）
  const throughKmByLine = {};
  for (const r of own) {
    for (const t of r.trains) {
      for (const th of throughChain(doc, t.throughId)) {
        throughKmByLine[th.id] = (throughKmByLine[th.id] || 0) + (th.km || 0) * 2;
      }
    }
  }
  return {
    rosters, assign, short, unmet, kmByFormation, totalKm, stay, stayIssues,
    coupling: rosters.filter(r => r.coupling).length,
    need: own.length,
    foreignNeed: foreign.length,
    have: availableFormations(doc).filter(f => (f.operatorId || (selfOperator(doc) || {}).id) === ((selfOperator(doc) || {}).id ?? null)).length,
    throughKmByLine,
    throughLines: throughOf(doc, line.id),
  };
}

export { stationName };
