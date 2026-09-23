// 事業者（鉄道会社）・保安装置・相互直通運転
//
// 相互直通では「どの会社の線に、どの編成が入れるか」が保安装置と両数で決まる。
// 路線と直通先に必要な保安装置を持たせ、編成の搭載装置と突き合わせて乗入れ可否を判定する。

import { formationCars } from './store.js';

/** 保安装置・車上設備のマスタ */
export const SAFETY_DEVICES = [
  { id: 'ats_sn', name: 'ATS-S形',  short: 'S',   note: '地上子照査式の基本形' },
  { id: 'ats_p',  name: 'ATS-P',    short: 'P',   note: 'パターン照査式。多くの民鉄・JRで採用' },
  { id: 'atc',    name: 'ATC',      short: 'ATC', note: '連続速度照査。高頻度運転の路線' },
  { id: 'cs_atc', name: 'CS-ATC',   short: 'CS',  note: '地下鉄の車内信号式ATC' },
  { id: 'd_atc',  name: 'D-ATC',    short: 'D',   note: 'デジタルATC。一段ブレーキ制御' },
  { id: 'atacs',  name: 'ATACS/CBTC', short: 'C', note: '無線式列車制御' },
  { id: 'tdatc',  name: 'T-DATC',   short: 'TD',  note: '東武のデジタルATC' },
  { id: 'ats_seibu', name: '西武形ATS', short: 'SB', note: '西武鉄道の車上速度照査式ATS' },
  { id: 'ats_kintetsu', name: '近鉄形ATS', short: 'KT', note: '近畿日本鉄道の連続照査式ATS' },
  { id: 'ats_hanshin', name: '阪神形ATS', short: 'HS', note: '阪神電気鉄道の車上速度照査式ATS' },
  { id: 'c_ats',  name: 'C-ATS',    short: 'CA',  note: '京成・都営浅草線・京急・北総などの1号線型ATS' },
  { id: 'atc_ns', name: 'ATC-NS',   short: 'NS',  note: '東海道・山陽新幹線のデジタルATC' },
  { id: 'ds_atc', name: 'DS-ATC',   short: 'DS',  note: '東北・上越・北陸・北海道・九州新幹線のデジタルATC' },
  { id: 'tasc',   name: 'TASC',     short: 'T',   note: '定位置停止装置。ホームドア対応に必要' },
  { id: 'radio_d', name: 'デジタル列車無線', short: '無', note: '会社ごとに周波数・方式が異なる' },
];
export const safetyDef = id => SAFETY_DEVICES.find(d => d.id === id) || { id, name: id, short: '?' };
export const safetyNames = ids => (ids || []).map(id => safetyDef(id).name).join('・');
export const safetyShorts = ids => (ids || []).map(id => safetyDef(id).short).join('·');

/** 既定の事業者（自社） */
export const selfOperator = doc => (doc.operators || []).find(o => o.self) || (doc.operators || [])[0] || null;
export const operatorOf = (doc, id) =>
  (doc.operators || []).find(o => o.id === id) || selfOperator(doc) || { id: null, name: '自社', color: '#7fd1ff', short: '自' };

/** 直通先（他社線）の一覧 */
export const throughLines = doc => doc.throughLines || [];
export const throughLine = (doc, id) => throughLines(doc).find(t => t.id === id) || null;

/** その路線から出ていく直通先 */
export const throughOf = (doc, lineId) => throughLines(doc).filter(t => t.lineId === lineId);

/**
 * 直通先までにたどる他社線の並び（経由 → 目的の線）。
 * 途中のどこかが直通中止なら、その直通は成立しない（空配列）。
 */
export function throughChain(doc, throughId) {
  const th = throughLine(doc, throughId);
  if (!th) return [];
  const via = (th.viaIds || []).map(id => throughLine(doc, id)).filter(Boolean);
  const chain = [...via, th];
  if (chain.some(x => x.suspended)) return [];
  return chain;
}

/** 直通に出ている時間[分]と距離[km]（片道） */
export function throughCost(doc, throughId) {
  const chain = throughChain(doc, throughId);
  return {
    min: chain.reduce((a, x) => a + (x.runMin || 0), 0),
    km: chain.reduce((a, x) => a + (x.km || 0), 0),
    chain,
  };
}

/**
 * 列車が使う区間の条件（保安装置・最大両数・走る会社）をまとめる
 */
export function trainRequirement(doc, line, train) {
  const req = {
    safety: new Set(line.safety || []),
    maxCars: Number.isFinite(line.maxCars) ? line.maxCars : 99,
    operators: new Set([line.operatorId].filter(Boolean)),
    through: [],
  };
  for (const th of throughChain(doc, train.throughId)) {
    for (const s of th.safety || []) req.safety.add(s);
    if (Number.isFinite(th.maxCars)) req.maxCars = Math.min(req.maxCars, th.maxCars);
    if (th.operatorId) req.operators.add(th.operatorId);
    req.through.push(th);
  }
  return req;
}

/** 複数の条件を合成する（1運用ぶん） */
export function mergeRequirements(reqs) {
  const out = { safety: new Set(), maxCars: 99, operators: new Set(), through: [] };
  for (const r of reqs) {
    for (const s of r.safety) out.safety.add(s);
    out.maxCars = Math.min(out.maxCars, r.maxCars);
    for (const o of r.operators) out.operators.add(o);
    for (const t of r.through) if (!out.through.some(x => x.id === t.id)) out.through.push(t);
  }
  return out;
}

/**
 * 編成がその条件で走れるか
 * @returns {{ok:boolean, missing:string[], overCars:boolean}}
 */
export function canRun(doc, f, req) {
  const have = new Set(f.safety || []);
  const missing = [...req.safety].filter(s => !have.has(s));
  const overCars = formationCars(f) > req.maxCars;
  return { ok: missing.length === 0 && !overCars, missing, overCars };
}

/** 直通先ごとの走行キロ（キロ精算の材料） */
export function throughKm(doc, trains) {
  const byLine = {};
  for (const t of trains) {
    for (const th of throughChain(doc, t.throughId)) {
      byLine[th.id] = (byLine[th.id] || 0) + (th.km || 0) * 2;   // 往復
    }
  }
  return byLine;
}

/** 直通による1日の乗り入れ乗客（境界駅での流出入） */
export function throughDemand(doc, lineId) {
  return throughOf(doc, lineId)
    .filter(t => !t.suspended)
    .reduce((s, t) => s + (t.dailyPassengers || 0), 0);
}
