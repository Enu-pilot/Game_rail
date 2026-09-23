// 長期経営：資金・年度決算・設備投資・沿線人口の成長・イベント

import { stationKind, fareFor } from './demand.js';
import { objectDef } from './catalog.js';

export const OKU = 1e8;   // 億円

/** 建物としてカウントする描画形状 */
const BUILDING_SHAPES = new Set(['building', 'shed', 'roundhouse', 'platform', 'roof', 'gate', 'bridge']);

export function initCompany(doc) {
  if (doc.company && doc.company.history) return doc.company;
  doc.company = {
    year: 1,
    cash: (doc.settings.startCashOku ?? 60) * OKU,
    debt: 0,
    economy: 0,
    seed: 12345,
    assets: assetSnapshot(doc),
    history: [],
    events: [],
  };
  return doc.company;
}

/** いまの設備の規模 */
export function assetSnapshot(doc) {
  const trackM = doc.tracks.reduce((s, t) => {
    const pts = t.points || [];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return s + len;
  }, 0);
  const gapM = doc.objects.reduce((s, o) => s + (o.type === 'gap_break' ? (o.extraM || 0) : 0), 0);
  const stations = doc.objects.filter(o => o.type === 'station_mark').length;
  const cars = doc.formations.reduce((s, f) => s + (f.cars || 0) + (f.loco ? f.loco.count : 0), 0);
  const depotTracks = doc.tracks.filter(t => ['stabling', 'inspection', 'daily', 'periodic', 'special', 'washing', 'wheellathe', 'shunting'].includes(t.kind)).length;
  const buildings = doc.objects.filter(o => BUILDING_SHAPES.has(objectDef(o.type).shape)).length;
  return { trackKm: (trackM + gapM) / 1000, stations, cars, depotTracks, buildings };
}

/** 前年度からの増加分にかかる設備投資 */
export function capexBetween(doc, prev, cur) {
  const s = doc.settings;
  const up = (a, b) => Math.max(0, b - a);
  const items = [
    { name: '線路の新設', qty: up(prev.trackKm, cur.trackKm), unit: (s.capexPerTrackKmOku ?? 18) * OKU, fmt: v => `${v.toFixed(2)} km` },
    { name: '駅の新設', qty: up(prev.stations, cur.stations), unit: (s.capexPerStationOku ?? 25) * OKU, fmt: v => `${v} 駅` },
    { name: '車両の増備', qty: up(prev.cars, cur.cars), unit: (s.capexPerCarOku ?? 1.6) * OKU, fmt: v => `${v} 両` },
    { name: '基地・側線の増設', qty: up(prev.depotTracks, cur.depotTracks), unit: (s.capexPerDepotTrackOku ?? 2.5) * OKU, fmt: v => `${v} 線` },
    { name: '建物の新設', qty: up(prev.buildings, cur.buildings), unit: (s.capexPerBuildingOku ?? 1.2) * OKU, fmt: v => `${v} 棟` },
  ].filter(i => i.qty > 1e-6);
  const total = items.reduce((a, i) => a + i.qty * i.unit, 0);
  return { items, total };
}

/* ---------------- 乱数（年度で再現できるように） ---------------- */
function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

export const EVENTS = [
  { id: 'boom', name: '好景気', weight: 14, text: '景気が上向き、沿線の利用が増えています', apply: c => { c.economy = 0.6; } },
  { id: 'slump', name: '景気後退', weight: 12, text: '景気後退で利用が伸び悩んでいます', apply: c => { c.economy = -0.6; } },
  { id: 'housing', name: '沿線で住宅開発', weight: 14, text: '住宅地の人口が増えました', apply: (c, doc, st) => bumpStation(doc, 'population', 0.08, 'residential') },
  { id: 'office', name: 'オフィス進出', weight: 10, text: '都心側の就業人口が増えました', apply: (c, doc) => bumpStation(doc, 'jobs', 0.12, 'urban') },
  { id: 'univ', name: '大学が開校', weight: 7, text: '学園都市の集客が増えました', apply: (c, doc) => bumpStation(doc, 'jobs', 0.25, 'school') },
  { id: 'typhoon', name: '台風被害', weight: 10, text: '設備の復旧費がかかりました', cost: () => 4 * OKU },
  { id: 'rival', name: '競合路線の開業', weight: 8, text: '並行するバス路線に利用が流れました', apply: (c, doc) => bumpAll(doc, 'population', -0.02) },
  { id: 'quiet', name: '平穏な1年', weight: 25, text: '特筆すべき出来事はありませんでした', apply: c => { c.economy = 0; } },
];

function bumpStation(doc, field, rate, kindId) {
  const list = doc.objects.filter(o => o.type === 'station_mark' && (o.kindId || 'residential') === kindId);
  const targets = list.length ? list : doc.objects.filter(o => o.type === 'station_mark');
  for (const o of targets) o[field] = Math.round((o[field] || 0) * (1 + rate));
}
function bumpAll(doc, field, rate) {
  for (const o of doc.objects) if (o.type === 'station_mark') o[field] = Math.round((o[field] || 0) * (1 + rate));
}

function rollEvent(doc, c) {
  const r = rng(c.seed + c.year * 7919);
  const total = EVENTS.reduce((a, e) => a + e.weight, 0);
  let v = r() * total;
  for (const e of EVENTS) {
    v -= e.weight;
    if (v <= 0) {
      if (e.apply) e.apply(c, doc);
      return { event: e, cost: e.cost ? e.cost() : 0 };
    }
  }
  return { event: EVENTS[EVENTS.length - 1], cost: 0 };
}

/* ---------------- 沿線人口の成長 ---------------- */

/** サービス水準から年間の人口成長率[%]を求める */
export function growthRate(doc, stats, fin) {
  const s = doc.settings;
  let g = s.baseGrowthPct ?? 0.4;
  const reasons = [];
  const cong = stats ? stats.peakCongestion * 100 : 100;
  if (cong <= 150) { g += 0.5; reasons.push('混雑に余裕がある +0.5'); }
  else if (cong <= 180) { reasons.push('混雑はやや厳しい ±0'); }
  else if (cong <= 200) { g -= 0.6; reasons.push('混雑が激しい −0.6'); }
  else { g -= 1.5; reasons.push('極度の混雑で敬遠 −1.5'); }

  const wait = stats ? stats.avgWait / 60 : 10;
  if (wait <= 6) { g += 0.5; reasons.push('待ち時間が短い +0.5'); }
  else if (wait <= 10) { reasons.push('待ち時間は普通 ±0'); }
  else { g -= 0.5; reasons.push('待ち時間が長い −0.5'); }

  const f5 = fareFor(doc, 5);
  if (f5 <= 190) { g += 0.4; reasons.push('運賃が割安 +0.4'); }
  else if (f5 >= 260) { g -= 0.4; reasons.push('運賃が割高 −0.4'); }
  else reasons.push('運賃は標準 ±0');

  if (stats && stats.left > stats.totalPassengers * 0.01) { g -= 0.5; reasons.push('積み残しが多い −0.5'); }

  const eco = (doc.company && doc.company.economy) || 0;
  if (eco) { g += eco; reasons.push(`景気 ${eco > 0 ? '+' : ''}${eco.toFixed(1)}`); }
  return { rate: g, reasons };
}

function applyGrowth(doc, rate) {
  for (const o of doc.objects) {
    if (o.type !== 'station_mark') continue;
    const kind = stationKind(o.kindId);
    const sens = kind.id === 'residential' ? 1.3 : kind.id === 'urban' ? 0.6 : 1.0;
    o.population = Math.max(0, Math.round((o.population || 0) * (1 + (rate * sens) / 100)));
    const jobSens = (kind.id === 'urban' || kind.id === 'business') ? 1.2 : 0.6;
    o.jobs = Math.max(0, Math.round((o.jobs || 0) * (1 + (rate * jobSens) / 100)));
  }
}

/* ---------------- 年度の決算 ---------------- */

/**
 * 1年度を進める
 * @param {object} daily simulateDemand の結果
 * @param {object} fin   finance の結果
 */
export function advanceYear(doc, daily, fin) {
  const c = initCompany(doc);
  const s = doc.settings;
  const days = s.operatingDaysFactor ?? 340;
  const revenue = fin.revenue * days;
  const opCost = fin.cost * days;
  const interest = c.debt * (s.interestRate ?? 0.02);

  const cur = assetSnapshot(doc);
  const capex = capexBetween(doc, c.assets, cur);
  c.economy *= 0.5;           // 景気の影響は年々薄れる
  const ev = rollEvent(doc, c);
  const profit = revenue - opCost - interest - ev.cost;
  c.cash += profit - capex.total;

  const g = growthRate(doc, daily, fin);
  applyGrowth(doc, g.rate);

  const pop = doc.objects.reduce((a, o) => a + (o.type === 'station_mark' ? (o.population || 0) : 0), 0);
  const rec = {
    year: c.year,
    revenue, opCost, interest, eventCost: ev.cost, capex: capex.total,
    profit, cash: c.cash, debt: c.debt,
    passengers: daily ? daily.totalPassengers * days : 0,
    peakCongestion: daily ? daily.peakCongestion : 0,
    opRatio: fin.opRatio,
    population: pop,
    growth: g.rate,
    event: ev.event.name,
    eventText: ev.event.text,
    trains: (doc.trains || []).length,
    cars: cur.cars,
    trackKm: cur.trackKm,
  };
  c.history.push(rec);
  c.events.unshift({ year: c.year, name: ev.event.name, text: ev.event.text, cost: ev.cost });
  if (c.events.length > 30) c.events.pop();
  c.assets = cur;
  c.year += 1;
  return rec;
}

export function borrow(doc, amount) {
  const c = initCompany(doc);
  const limit = (doc.settings.debtLimitOku ?? 300) * OKU;
  const amt = Math.max(0, Math.min(amount, limit - c.debt));
  c.debt += amt; c.cash += amt;
  return amt;
}

export function repay(doc, amount) {
  const c = initCompany(doc);
  const amt = Math.max(0, Math.min(amount, c.debt, c.cash));
  c.debt -= amt; c.cash -= amt;
  return amt;
}

/** 長期の到達状況 */
export function longTermStatus(doc) {
  const c = initCompany(doc);
  const s = doc.settings;
  const targetCash = (s.targetCashOku ?? 200) * OKU;
  const targetYears = s.targetYears ?? 10;
  const pop = doc.objects.reduce((a, o) => a + (o.type === 'station_mark' ? (o.population || 0) : 0), 0);
  const startPop = c.history.length ? c.history[0].population : pop;
  return {
    year: c.year, cash: c.cash, debt: c.debt,
    netWorth: c.cash - c.debt,
    targetCash, targetYears,
    achieved: c.cash - c.debt >= targetCash,
    population: pop,
    popGrowth: startPop ? (pop / startPop - 1) * 100 : 0,
    bankrupt: c.cash < 0,
  };
}

export const oku = v => `${(v / OKU).toFixed(1)} 億円`;
