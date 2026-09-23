// 実在路線サンプルの組み立て（路線網ビルダー）
//
// 駅の並び・キロ程・駅の配線種別・車両基地・運転系統をデータとして受け取り、
//   配線図（本線・待避線・頭端・車両基地・分岐器）→ 路線 → 系統ごとの列車 → 必要な編成
// までを自動で組み立てる。配線図は駅間を省略して描き、キロ程は「駅間省略」記号で合わせる。
//
// 駅の配線種別
//   's'  2面2線・島式1面2線（本線のみ）
//   'p'  2面4線（上下とも待避線）
//   'pd' 下り側だけ待避線   'pu' 上り側だけ待避線
//   't'  頭端式（stubs 本の行き止まり線）

import { newDoc, uid, store } from '../store.js';
import { objectDef, TURNOUT_TYPE_BY_VARIANT, FORMATION_COLORS } from '../catalog.js';
import { buildGraph, junctionNodes, turnoutSpecAt } from '../topology.js';
import { polylineLength, pointAt } from '../geom.js';
import { lineStations, computeSchedule } from '../timetable.js';
import { buildRosters } from '../duty.js';
import { planMeets } from '../meets.js';
import { initCompany } from '../company.js';

const DEG = Math.PI / 180;
const LOOP_OFF = 30;          // 待避線の線路中心間隔（描画上）
const LOOP_HALF = 130;        // 待避線の半分の長さ
const MARGIN = 160;           // 本線の端の余裕

/* ---------------- 小道具 ---------------- */

const T = (name, kind, points, ends = {}, extra = {}) => ({
  id: uid('t'), name, kind, points: points.map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
  capacityMode: 'auto', capacity: 0, carLengthM: null,
  ends: { a: ends.a || 'open', b: ends.b || 'open' },
  maxSpeedKmh: extra.maxSpeedKmh ?? null,
  note: extra.note || '',
});

const O = (type, x, y, extra = {}) => {
  const d = objectDef(type);
  return {
    id: uid('b'), type, x, y,
    w: extra.w ?? d.w, h: extra.h ?? d.h, rot: extra.rot ?? 0,
    mirror: false, position: 0, dir: 'ab', tracks: extra.tracks || [],
    extraM: extra.extraM ?? 0,
    population: extra.population, jobs: extra.jobs, kindId: extra.kindId,
    label: extra.label ?? '', note: extra.note ?? '', trackId: extra.trackId ?? null,
  };
};

const add = (p, v, k = 1) => ({ x: p.x + v.x * k, y: p.y + v.y * k });
const hm = str => { const [h, m] = str.split(':').map(Number); return h * 3600 + m * 60; };

/** 折れ線の経路（距離 s の位置・向き・法線） */
function makePath(points) {
  const len = polylineLength(points);
  const at = s => pointAt(points, Math.max(0, Math.min(len, s)));
  const nrm = s => { const a = at(s).angle; return { x: -Math.sin(a), y: Math.cos(a) }; };
  return { points, len, at, nrm };
}

/* ---------------- 本体 ---------------- */

export function buildNetwork(spec) {
  const doc = newDoc(spec.title);
  // 実在路線のサンプルは、両数の違う列車を同じ編成で回さない（増解結なし）
  Object.assign(doc.settings, { rosterSameCars: true, networkLayout: true }, spec.settings || {});
  const tracks = [], objects = [], formations = [];
  const SP = spec.spacing || 480;

  // 事業者
  const opIds = {};
  doc.operators = Object.entries(spec.operators).map(([key, o]) => {
    opIds[key] = uid('op');
    return { id: opIds[key], name: o.name, short: o.short || o.name.slice(0, 1), color: o.color, self: key === spec.self };
  });

  const lines = {};           // key → { spec, line, main, path, stations:[{name,km,obj,s,...}] }
  const stationObjByName = {};

  /* ---- 1) 路線ごとに本線・駅・待避線を描く ---- */
  for (const L of spec.lines) {
    const st = L.stations.map(([name, km, type = 's', extra = {}]) => ({ name, km, type, extra }));
    // 先頭駅は接続先の路線と共用。ownStation なら分岐した先に自線のホーム（別の駅標）を置く
    const shared0 = !!L.attach && !L.attach.ownStation;
    const own0 = !!L.attach && !!L.attach.ownStation;
    // 描画上の駅位置（経路の始点からの距離）
    const pos = [];
    // 環状線は始発駅の待避線が継目にかからないよう、少し先から並べる
    let s = L.attach ? 0 : (L.ring ? LOOP_HALF + 60 : MARGIN);
    const connLen = L.attach ? (L.attach.mode === 'branch' ? Math.abs(L.attach.offset ?? 220) : 0) : 0;
    for (let i = 0; i < st.length; i++) {
      if (i === 0) { pos.push(own0 ? (s = LOOP_HALF + 90) : L.attach ? -connLen : s); continue; }
      const real = Math.abs(st[i].km - st[i - 1].km) * 1000;
      const gap = Math.max(Math.min(real, SP), 300);
      s = (i === 1 && shared0 ? 0 : s) + (i === 1 && shared0 ? Math.max(gap, 220) : gap);
      pos.push(s);
    }
    const endLen = pos[pos.length - 1] + (L.ring ? 20 : MARGIN);

    // 経路の始点と向き
    let P0, heading = (L.heading ?? 0) * DEG;
    if (L.attach) {
      const parent = lines[L.attach.line];
      const ps = parent.stations.find(x => x.name === L.attach.at);
      if (!parent || !ps) throw new Error(`${L.name}: 接続先 ${L.attach.line}/${L.attach.at} がありません`);
      if (L.attach.mode === 'branch') {
        P0 = parent.path.at(ps.s + (L.attach.offset ?? 220));
      } else {
        // 端に接続：接続駅に近い方の本線端から延ばす
        const pts = parent.main.points;
        const first = pts[0], last = pts[pts.length - 1];
        const d0 = Math.hypot(first.x - ps.p.x, first.y - ps.p.y), d1 = Math.hypot(last.x - ps.p.x, last.y - ps.p.y);
        P0 = d0 < d1 ? first : last;
        if (L.heading == null) {
          const ang = parent.path.at(d0 < d1 ? 0 : parent.path.len).angle;
          heading = d0 < d1 ? ang + Math.PI : ang;
        }
      }
    } else {
      P0 = L.origin || { x: 0, y: 0 };
    }

    // 経路（途中で向きを変えられる：turns = { 駅名: 向き[度] }）
    let pathPts;
    if (L.ring) {
      // 円周 = 経路長＋継目40m。P0 を円の最下点にする
      const R = (endLen + 40) / (2 * Math.PI);
      const C = add(P0, { x: 0, y: -R });
      pathPts = [];
      const N = 180;
      for (let k = 0; k <= N; k++) {
        const a = Math.PI / 2 - (k / N) * 2 * Math.PI * (endLen / (endLen + 40));
        pathPts.push({ x: C.x + R * Math.cos(a), y: C.y + R * Math.sin(a) });
      }
    } else {
      pathPts = [P0];
      let cur = P0, done = 0, h = heading;
      const turnAt = [];
      for (let i = 0; i < st.length; i++) {
        // turns = { 駅名: 向き } か { 駅名: { h: 向き, at: 駅からの距離 } }（at: 0 でスイッチバック）
        const tv = L.turns && L.turns[st[i].name];
        const tdeg = tv != null && typeof tv === 'object' ? tv.h : tv;
        const tat = tv != null && typeof tv === 'object' && tv.at != null ? tv.at : 200;
        if (tdeg != null && i > 0) turnAt.push({ s: pos[i] + tat, h: tdeg * DEG });
      }
      for (const tr of turnAt) {
        cur = add(cur, { x: Math.cos(h), y: Math.sin(h) }, tr.s - done);
        pathPts.push(cur); done = tr.s; h = tr.h;
      }
      cur = add(cur, { x: Math.cos(h), y: Math.sin(h) }, endLen - done);
      pathPts.push(cur);
    }
    const path = makePath(pathPts);
    const main = T(L.trackName || L.name, 'main', pathPts,
      { a: L.attach ? 'open' : (L.startEnd || 'buffer'), b: L.ring ? 'open' : (L.endEnd || 'buffer') },
      { maxSpeedKmh: L.vmax ?? null });
    tracks.push(main);

    const entry = { spec: L, main, path, stations: [], key: L.key };
    lines[L.key] = entry;

    // 環状線の継目をつなぐ短い線
    if (L.ring) {
      const a = pathPts[pathPts.length - 1], b = pathPts[0];
      tracks.push(T(`${L.name}（継目）`, 'main', [a, b], {}, { maxSpeedKmh: L.vmax ?? null }));
    }

    for (let i = 0; i < st.length; i++) {
      const S = st[i];
      if (i === 0 && shared0) {
        const obj = stationObjByName[S.name];
        entry.stations.push({ ...S, s: pos[i], obj, p: obj ? { x: obj.x, y: obj.y } : P0, shared: true });
        continue;
      }
      const p = path.at(pos[i]);
      const n = path.nrm(pos[i]);
      const stTracks = [main.id];
      const loops = {};
      // 経路が曲がっている駅（スイッチバックなど）でも本線と交わらないよう、副本線は本線に沿って点をとる
      const kinked = L.turns && L.turns[S.name] && typeof L.turns[S.name] === 'object' && L.turns[S.name].at === 0;
      const mkLoop = (side, label) => {
        const a0 = path.at(pos[i] - LOOP_HALF), a1 = path.at(pos[i] + LOOP_HALF);
        const mids = [];
        const s0 = pos[i] - LOOP_HALF + 35, s1 = pos[i] + LOOP_HALF - 35;
        const step = kinked ? 10 : (s1 - s0);
        for (let q = s0; q <= s1 + 1e-6; q += step) mids.push(add(path.at(q), path.nrm(q), side * LOOP_OFF));
        const t = T(`${S.name}${label}`, 'platform', [a0, ...mids, a1], {}, { maxSpeedKmh: 45 });
        tracks.push(t); stTracks.push(t.id);
        return t;
      };
      // 折れ曲がった駅（スイッチバック）は、曲がりの内側に副本線を置けない
      let inner = 0;
      if (kinked) {
        let d = path.at(pos[i] + 50).angle - path.at(pos[i] - 50).angle;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        inner = d > 0 ? 1 : -1;
      }
      if ((S.type === 'p' || S.type === 'pd') && inner !== -1) loops.down = mkLoop(-1, '下り副本線');
      if ((S.type === 'p' || S.type === 'pu') && inner !== 1) loops.up = mkLoop(+1, '上り副本線');
      if (S.type === 't') {
        // 頭端式：本線の先で行き止まり。stubs 本の着発線を並べる
        const k = Math.max(1, (S.extra.stubs || 2) - 1);
        const endS = i === 0 ? pos[i] - 60 : pos[i] + 60;
        for (let j = 1; j <= k; j++) {
          const side = j % 2 ? -1 : 1, off = Math.ceil(j / 2) * 24 * side;
          const from = i === 0 ? pos[i] + 200 : pos[i] - 200;
          const pa = path.at(from), pb = add(path.at((from + endS) / 2), path.nrm((from + endS) / 2), off);
          const pc = add(path.at(endS), path.nrm(endS), off);
          const t = T(`${S.name}${j + 1}番線`, 'platform', [pa, pb, pc], i === 0 ? { a: 'open', b: 'buffer' } : { b: 'buffer' }, { maxSpeedKmh: 35 });
          tracks.push(t); stTracks.push(t.id);
          loops[`stub${j}`] = t;
        }
      }
      if (S.extra.ra) {
        // 機回し線：本線から分かれて駅の外側を回る線（機関車を列車の反対側へ付け替える）
        const side = S.type === 'p' || S.type === 'pd' ? 1 : -1;
        const off = (S.type === 'p' ? 2 : 1) * LOOP_OFF * side;
        const a0 = path.at(pos[i] - LOOP_HALF - 40), a1 = path.at(pos[i] + LOOP_HALF + 20);
        const b0 = add(path.at(pos[i] - LOOP_HALF + 10), path.nrm(pos[i] - LOOP_HALF + 10), off);
        const b1 = add(path.at(pos[i] + LOOP_HALF - 20), path.nrm(pos[i] + LOOP_HALF - 20), off);
        tracks.push(T(`${S.name}機回し線`, 'runaround', [a0, b0, b1, a1], {}, { maxSpeedKmh: 25 }));
      }
      if (S.extra.tt) {
        const q = add(p, n, (S.type === 'p' ? -3 : -2) * LOOP_OFF - 20);
        objects.push(O('turntable', q.x, q.y, { label: `${S.name}転車台` }));
      }
      const loopSeam = L.ring && (i === 0 || i === st.length - 1) && st[0].name === st[st.length - 1].name;
      const half = loopSeam ? 0.5 : 1;
      const obj = O('station_mark', p.x, p.y, {
        label: S.name, trackId: main.id, tracks: stTracks, rot: p.angle,
        population: Math.round((S.extra.pop ?? 20000) * half), jobs: Math.round((S.extra.jobs ?? 5000) * half),
        kindId: S.extra.kind || 'residential',
      });
      objects.push(obj);
      // ホーム（見た目）
      const ang = p.angle;
      // 曲線（環状線）ではホームの弦が線路に寄るぶん離して置く
      const side = (S.type === 'p' ? LOOP_OFF + 9 : 9) + (L.ring ? 5 : 0);
      const pl = (L.maxCars || 10) * 20 + 10;
      const closing = loopSeam && i === st.length - 1;     // 環状線の終点＝始発駅（ホームは始発側に描く）
      if (S.type !== 't' && !closing && !kinked) {
        for (const sg of [-1, 1]) {
          const q = add(p, n, sg * side);
          objects.push(O('platform_side', q.x, q.y, { w: Math.min(pl, 210), h: 5, rot: ang }));
        }
      }
      if (!stationObjByName[S.name]) stationObjByName[S.name] = obj;
      entry.stations.push({ ...S, s: pos[i], obj, p, loops, shared: false });
    }
  }

  // 駅間省略の記号（あとでキロ程に合わせて調整する）
  // 分岐する路線の経路は親路線の本線を少し通るので、その区間には記号を置かない
  const avoid = {};
  for (const L of spec.lines) {
    if (!L.attach || L.attach.mode !== 'branch') continue;
    const ps = lines[L.attach.line].stations.find(x => x.name === L.attach.at);
    const off = L.attach.offset ?? 220;
    (avoid[L.attach.line] = avoid[L.attach.line] || []).push([ps.s + Math.min(0, off) - 40, ps.s + Math.max(0, off) + 40]);
  }
  const gaps = [];
  for (const E of Object.values(lines)) {
    for (let i = 1; i < E.stations.length; i++) {
      const a = E.stations[i - 1], b = E.stations[i];
      const s0 = a.shared ? 0 : a.s;
      let sm = (s0 + b.s) / 2;
      for (const [x0, x1] of avoid[E.key] || []) {
        if (sm < x0 || sm > x1) continue;
        sm = (x1 < b.s - 40) ? (x1 + Math.min(b.s - 40, x1 + 80)) / 2 : (x0 > s0 + 40 ? (x0 + Math.max(s0 + 40, x0 - 80)) / 2 : sm);
      }
      const p = E.path.at(sm);
      const g = O('gap_break', p.x, p.y, { rot: p.angle, trackId: E.main.id, extraM: 0 });
      objects.push(g);
      gaps.push({ line: E, i, obj: g });
    }
  }

  // 駅の線路との対応
  doc.tracks = tracks; doc.objects = objects; doc.formations = formations;

  /* ---- 2) 路線（駅の並び） ---- */
  doc.lines = spec.lines.map(L => {
    const E = lines[L.key];
    E.line = {
      id: uid('l'), name: L.name, color: L.color || '#7fd1ff', double: L.double !== false,
      secSingle: singleMap(L, E),
      secQuad: rangeMap(L.quads, E, L),
      operatorId: opIds[L.op] || null,
      safety: L.safety || [], maxCars: L.maxCars || 10,
      stations: E.stations.map(x => x.obj.id),
    };
    return E.line;
  });

  /* ---- 3) キロ程に合わせて駅間省略の距離を調整 ---- */
  const fit = () => {
    store.rev++;                              // キャッシュを無効化
    const g = buildGraph(doc);
    let worst = 0;
    for (const E of Object.values(lines)) {
      const sts = lineStations(doc, g, E.line);
      for (let i = 1; i < sts.length; i++) {
        const want = Math.abs(E.stations[i].km - E.stations[i - 1].km) * 1000;
        const got = sts[i].km - sts[i - 1].km;
        const diff = want - got;
        const gp = gaps.find(x => x.line === E && x.i === i);
        if (gp && Math.abs(diff) > 5) { gp.obj.extraM = Math.max(0, gp.obj.extraM + diff); worst = Math.max(worst, Math.abs(diff)); }
      }
    }
    return worst;
  };
  for (let k = 0; k < 3 && fit() > 5; k++);

  /* ---- 4) 直通先（抽象）を実際の路線から導く ---- */
  const thIds = {};
  doc.throughLines = [];
  const g0 = buildGraph(doc);
  const lineLenKm = key => {
    const E = lines[key];
    return Math.abs(E.stations[E.stations.length - 1].km - E.stations[0].km);
  };
  const lineMinutes = key => {
    const E = lines[key];
    const sts = lineStations(doc, g0, E.line);
    const tr = dummyTrain(E.line, 0, sts.length - 1, E.spec.vmax || 100);
    const stops = computeSchedule(doc, sts, tr);
    const last = stops[stops.length - 1];
    return Math.round(((last.arr ?? 0) - tr.departSec) / 60);
  };
  for (const th of spec.through || []) {
    thIds[th.key] = uid('th');
  }
  for (const th of spec.through || []) {
    const from = lines[th.from];
    const idx = from.stations.findIndex(x => x.name === th.at);
    const partner = th.line ? lines[th.line] : null;
    doc.throughLines.push({
      id: thIds[th.key], name: th.name, operatorId: opIds[th.op] || null,
      lineId: from.line.id, stationIdx: Math.max(0, idx),
      safety: partner ? (partner.spec.safety || []) : (th.safety || []),
      maxCars: partner ? (partner.spec.maxCars || 10) : (th.maxCars ?? 10),
      km: partner ? lineLenKm(th.line) : (th.km ?? 10),
      runMin: partner ? lineMinutes(th.line) : (th.runMin ?? 20),
      dailyPassengers: th.pax ?? 0,
      viaIds: (th.via || []).map(k => thIds[k]),
      suspended: false, delayMin: 0, note: th.note || '',
      partnerLineId: partner ? partner.line.id : null,
    });
  }

  /* ---- 5) 系統ごとに列車を作る ---- */
  store.rev++;
  const gT = buildGraph(doc);
  const stsOf = {};
  for (const E of Object.values(lines)) stsOf[E.key] = lineStations(doc, gT, E.line);
  const trains = [];
  const RANK = { local: 2, semi: 2.5 };
  const counters = {};
  const opCycle = {};
  const pickOp = (sv, n) => {
    if (sv.op) return sv.op;
    const w = Object.entries(sv.ops || { [spec.self]: 1 });
    const total = w.reduce((a, [, v]) => a + v, 0);
    let r = n % total;
    for (const [k, v] of w) { if (r < v) return k; r -= v; }
    return w[0][0];
  };
  const makeTrain = (E, fromName, toName, dep, sv, op, number) => {
    const sts = stsOf[E.key];
    // 環状線は始終点が同じ駅名なので、「駅名*」で最後の方を指す
    const find = nm => (nm.endsWith('*')
      ? E.stations.map(x => x.name).lastIndexOf(nm.slice(0, -1))
      : E.stations.findIndex(x => x.name === nm));
    const fromIdx = find(fromName);
    const toIdx = find(toName);
    if (fromIdx < 0 || toIdx < 0) throw new Error(`${sv.name}: ${E.spec.name} に ${fromName}/${toName} がありません`);
    const up = toIdx < fromIdx;
    const stopsSpec = sv.stops && sv.stops[E.key];
    const stopSet = stopsSpec && stopsSpec !== 'all' ? new Set(stopsSpec) : null;
    const skip = [];
    const lo = Math.min(fromIdx, toIdx), hi = Math.max(fromIdx, toIdx);
    for (let i = lo + 1; i < hi; i++) if (stopSet && !stopSet.has(E.stations[i].name)) skip.push(i);
    // 番線：待避駅では各停・準急は副本線、それ以外は本線（上下は本線で分かれる）
    const platforms = {};
    for (let i = lo; i <= hi; i++) {
      const S = E.stations[i];
      if (!S.loops) continue;
      const stops = !skip.includes(i);
      const slow = (RANK[(sv.types && sv.types[E.key]) || sv.type] ?? 3) <= 2.5;
      const loop = up ? S.loops.up : S.loops.down;
      if (loop && stops && (slow || i === fromIdx || i === toIdx)) platforms[i] = loop.id;
      if (S.type === 't' && (i === fromIdx || i === toIdx)) {
        const stubs = Object.keys(S.loops).filter(k => k.startsWith('stub')).map(k => S.loops[k].id);
        const pool = [E.main.id, ...stubs];
        platforms[i] = pool[(counters[S.name] = (counters[S.name] || 0) + 1) % pool.length];
      }
    }
    const type = (sv.types && sv.types[E.key]) || sv.type;
    // スイッチバックなど、停車時間を延ばす駅（途中駅だけ）
    const dwellAt = {};
    for (let i = lo + 1; i < hi; i++) {
      const d = E.stations[i].extra && E.stations[i].extra.dwell;
      if (d && !skip.includes(i)) dwellAt[i] = d;
    }
    return {
      id: uid('tr'), lineId: E.line.id, number, name: sv.label || '', type,
      dir: up ? 'up' : 'down', fromIdx, toIdx, departSec: dep,
      speedKmh: sv.speed || E.spec.vmax || 100, dwellSec: sv.dwell ?? 30, skip,
      cars: sv.cars || E.spec.maxCars || 10, platforms, holds: {}, delaySec: 0,
      toDepot: false, depotTrackId: null, throughId: null,
      operatorId: opIds[op] || null, color: null, formationId: null, note: sv.name,
      couple: null, dwellAt,
    };
  };
  const throughSources = new Set((spec.through || []).map(t => t.from));
  const throughFor = (route, k) => {
    // この区間の先に続く他の路線のうち、直通先として登録されている一番遠いもの
    const here = route[k][0];
    let found = null;
    for (let j = k + 1; j < route.length; j++) {
      if (route[j][0] === here) break;
      const th = (spec.through || []).find(x => x.line === route[j][0] && x.from === here);
      if (th) found = th;
    }
    return found ? thIds[found.key] : null;
  };
  // 生成した列車：`${系統}|${回}|${向き}|${路線}` → 列車（併結の相手を探すのに使う）
  const runs = new Map();
  const segDuration = (E, tr) => {
    const stops = computeSchedule(doc, stsOf[E.key], tr);
    const last = stops[stops.length - 1];
    return (last.arr ?? tr.departSec) - tr.departSec;
  };
  const runService = (sv, route, dep, n, dirKey) => {
    const op = pickOp(sv, n);
    const no = (counters[sv.prefix || sv.type] = (counters[sv.prefix || sv.type] || 0) + 1);
    const number = `${sv.prefix || ''}${no}${sv.suffix || ''}`;
    const transfer = sv.transfer ?? 60;
    const occ = {};                   // 同じ路線を何度目に通るか（環状線に入って出る系統など）
    const made = route.map((seg, k) => {
      const key = `${seg[0]}#${(occ[seg[0]] = (occ[seg[0]] ?? -1) + 1)}`;
      const E = lines[seg[0]];
      const tr = makeTrain(E, seg[1], seg[2], dep, sv, op, number);
      if (throughSources.has(seg[0])) tr.throughId = throughFor(route, k);
      if (sv.loco) tr.loco = true;
      // 併結：相手の系統の同じ回・同じ向きの列車に付属編成として連結する
      if (sv.with && sv.with.on.includes(seg[0])) {
        const L = runs.get(`${sv.with.service}|${n}|${dirKey}|${key}`);
        if (L) tr.couple = { withId: L.id };
      }
      runs.set(`${sv.prefix}|${n}|${dirKey}|${key}`, tr);
      return { E, tr };
    });
    // 時刻：併結区間は相手の時刻に合わせ、その前後の区間を前詰め・後詰めでつなぐ
    const anchor = made.findIndex(m => m.tr.couple);
    if (anchor < 0) {
      let t = dep;
      for (const m of made) { m.tr.departSec = t; t += segDuration(m.E, m.tr) + transfer; }
    } else {
      store.rev++;
      doc.trains = trains.concat(made.map(m => m.tr));
      const depAt = m => computeSchedule(doc, stsOf[m.E.key], m.tr)[0].dep;
      let t = depAt(made[anchor]);
      made[anchor].tr.departSec = t;
      for (let k = anchor - 1; k >= 0; k--) {
        made[k].tr.departSec = 0;
        const d = segDuration(made[k].E, made[k].tr);
        made[k].tr.departSec = t - transfer - d;
        t = made[k].tr.departSec;
      }
      t = made[anchor].tr.departSec + segDuration(made[anchor].E, made[anchor].tr) + transfer;
      for (let k = anchor + 1; k < made.length; k++) {
        if (made[k].tr.couple) { made[k].tr.departSec = depAt(made[k]); }
        else made[k].tr.departSec = t;
        t = made[k].tr.departSec + segDuration(made[k].E, made[k].tr) + transfer;
      }
    }
    chains.push({ made, transfer });
    return made.map(m => m.tr);
  };
  const chains = [];
  /** 1本の系統の区間どうしで、次の区間が前の区間の到着より先に出ないようにそろえる */
  const retime = () => {
    doc.trains = trains;
    store.rev++;
    for (const { made, transfer } of chains) {
      for (let k = 1; k < made.length; k++) {
        const cur = made[k].tr;
        if (cur.couple) continue;                       // 付属編成は相手の列車に従う
        const prev = made[k - 1];
        const ps = computeSchedule(doc, stsOf[prev.E.key], prev.tr);
        const arr = ps[ps.length - 1].arr;
        if (arr != null && cur.departSec < arr + transfer) cur.departSec = Math.ceil((arr + transfer) / 30) * 30;
      }
    }
    store.rev++;
  };
  for (const sv of spec.services || []) {
    let n = 0;
    for (const [from, to, every, offset = 0] of sv.slots) {
      for (let t = hm(from) + offset * 60; t < hm(to); t += every * 60) {
        trains.push(...runService(sv, sv.route, t, n, 'f'));
        if (sv.both !== false) {
          const rev = sv.route.slice().reverse().map(([k, a, b]) => [k, b, a]);
          trains.push(...runService(sv, rev, t + (sv.revOffset ?? 0) * 60, n, 'r'));
        }
        n++;
      }
    }
  }
  doc.trains = trains;
  retime();

  /* ---- 5.5) 路線ごとに行き違い・待避を入れておく（編成数はこのダイヤから逆算する） ---- */
  // 待避で遅れると、その先の区間（直通先）の発時刻をずらす。ずらした結果にもう一度待避を入れる
  const syncComps = () => {
    store.rev++;
    for (const E of Object.values(lines)) {
      for (const t of trains) {
        if (t.lineId !== E.line.id || !t.couple) continue;
        const st0 = computeSchedule(doc, stsOf[E.key], t)[0];
        if (st0 && st0.dep != null) t.departSec = st0.dep;
      }
    }
  };
  const dispatchAll = (passes, reset) => {
    for (let pass = 0; pass < passes; pass++) {
      if (pass) retime();
      store.rev++;
      for (const E of Object.values(lines)) {
        const own = trains.filter(t => t.lineId === E.line.id);
        if (!own.length) continue;
        const plan = planMeets(doc, E.line, stsOf[E.key], own, { reset });
        for (const t of own) {
          if (isCompanionIn(t)) continue;
          if (plan.holds[t.id]) t.holds = plan.holds[t.id];
          if (plan.platforms[t.id]) t.platforms = plan.platforms[t.id];
        }
      }
      syncComps();
    }
  };
  const isCompanionIn = t => !!(t.couple && t.couple.withId);
  const multiSeg = chains.some(c => c.made.length > 1);

  /* ---- 6) 自社の編成をダイヤから逆算し、車両基地に置く ---- */
  const selfMain = spec.lines.find(L => L.op === spec.self);
  // 車両の一覧：本線の車両（spec.fleet）と、線区ごとの専用車両（spec.fleets: [{ line, depot, ... }]）
  const fleetDefs = [];
  if (selfMain) fleetDefs.push({ ...(spec.fleet || {}), line: selfMain.key, main: true });
  for (const f of spec.fleets || []) fleetDefs.push({ ...f, main: false });
  const fleetSets = fd => {
    let fleetGroups = [];
    const E = lines[fd.line];
    if (E) {
      store.rev++;
      const sts = lineStations(doc, buildGraph(doc), E.line);
      const own = trains.filter(t => t.lineId === E.line.id && t.operatorId === opIds[spec.self]);
      const rosters = buildRosters(doc, E.line, sts, own);
      const groups = new Map();
      for (const r of rosters) {
        const key = `${r.cars}|${[...r.req.safety].sort().join(',')}|${r.loco ? 'L' : ''}`;
        if (!groups.has(key)) groups.set(key, { cars: r.cars, safety: [...r.req.safety], loco: r.loco, n: 0 });
        groups.get(key).n++;
      }
      fleetGroups = [...groups.values()].sort((a, b) => b.n - a.n);
    }
    const allSafety = [...new Set(fleetGroups.flatMap(g => g.safety).concat(fd.extraSafety || []))];
    const out = [];
    let serial = fd.start || 1;
    for (const gp of fleetGroups) {
      const count = gp.n + Math.max(1, Math.ceil(gp.n * (fd.spare ?? 0.15)));
      for (let k = 0; k < count; k++) {
        out.push({
          name: `${fd.prefix || ''}${String(serial++).padStart(2, '0')}${fd.suffix ?? '編成'}`,
          series: fd.series || '', cars: gp.cars, vehicle: gp.loco ? (fd.locoVehicle || 'coach') : (fd.vehicle || 'emu'),
          fleet: fd,
          // 予備車は全線対応にしておく（運用の入れ替えがきくように）
          safety: k >= gp.n ? allSafety : gp.safety,
        });
      }
    }
    return out;
  };
  // 車両基地の大きさは待避を入れる前のダイヤから見積もる（待避で運用が延びるぶん多めに）
  const est = new Map(fleetDefs.map(fd => [fd, Math.ceil(fleetSets(fd).length * 1.25) + 1]));
  const estMain = fleetDefs.filter(fd => fd.main).reduce((a, fd) => a + est.get(fd), 0);

  // 車両基地
  const depotTracks = [];
  for (const dp of spec.depots || []) {
    const E = lines[dp.line];
    const S = E.stations.find(x => x.name === dp.at);
    if (!S) continue;
    // 本線の車両は share の割合で、線区専用の車両は depot に名前を指定された基地に置く
    const extra = fleetDefs.filter(fd => !fd.main && fd.depot === dp.name).reduce((a, fd) => a + est.get(fd), 0);
    const setsHere = (dp.own && !dp.reserved ? (dp.share != null ? Math.ceil(estMain * dp.share) : estMain) : 0) + extra;
    const carLen = ((spec.fleet && spec.fleet.carLengthM) || 20) + 1;
    const lenM = Math.max(220, (dp.cars || 10) * carLen + 40) * 2;   // 1線に2編成
    const nStable = Math.max(dp.min || 4, Math.ceil(setsHere / 2) + 1);
    const yard = buildDepot(E, S, dp, nStable, lenM);
    tracks.push(...yard.tracks);
    objects.push(...yard.objects);
    if (dp.own || extra) {
      depotTracks.push(...yard.stabling.map(t => ({ t, left: 2, depot: dp })));
      if (yard.shop) depotTracks.push({ t: yard.shop, left: 1, depot: dp, shop: true });
    }
  }
  /* ---- 7) 分岐器を接続点から自動生成 ---- */
  const tmp = { ...doc, tracks, objects, formations: [] };
  const g = buildGraph(tmp);
  let no = 0;
  for (const nd of junctionNodes(g)) {
    const specT = turnoutSpecAt(tmp, g, nd.id);
    if (!specT) continue;
    const type = TURNOUT_TYPE_BY_VARIANT[specT.variant] || 'turnout_single';
    const d = objectDef(type);
    objects.push({
      id: uid('b'), type, x: specT.x, y: specT.y, w: d.w, h: d.h, rot: specT.rot,
      mirror: !!specT.mirror, position: 0, dir: 'ab', tracks: [], label: `${++no}号`, note: '', trackId: null,
    });
  }
  if (spec.extras) spec.extras({ doc, lines, tracks, objects, T, O, add });

  /* ---- 8) 車両基地・分岐器まで入った配線で時刻を計算し直し、支障が出たところに待避を足す ---- */
  doc.tracks = tracks; doc.objects = objects;
  store.rev++;
  const gF = buildGraph(doc);
  for (const E of Object.values(lines)) stsOf[E.key] = lineStations(doc, gF, E.line);
  dispatchAll(multiSeg ? 2 : 1, true);

  /* ---- 9) 待避を入れたダイヤから編成数を決めて、車両基地に置く ---- */
  const sets = fleetDefs.flatMap(fd => fleetSets(fd));
  // 編成を留置線へ（本線の最後の1本は交番検査中にする）
  const mainSets = sets.filter(x => x.fleet.main);
  sets.forEach((st, i) => {
    const fits = d => (st.fleet.main ? (!d.depot.reserved && d.depot.own) : d.depot.name === st.fleet.depot);
    const spot = depotTracks.find(d => !d.shop && d.left > 0 && fits(d));
    const shop = st === mainSets[mainSets.length - 1] ? depotTracks.find(d => d.shop && d.left > 0 && fits(d)) : null;
    const place = shop || spot;
    if (place) place.left--;
    formations.push({
      id: uid('f'), name: st.name, series: st.series, vehicle: st.vehicle,
      cars: st.cars, carLengthM: st.fleet.carLengthM ?? null, loco: null,
      color: FORMATION_COLORS[i % FORMATION_COLORS.length],
      trackId: place ? place.t.id : null, note: shop ? '交番検査中' : '',
      operatorId: opIds[spec.self], safety: st.safety, odoKm: 0, inspection: null,
    });
  });

  /* ---- 10) 1日の最後の列車は車両基地へ入庫させる（終着駅で夜を明かさない） ---- */
  const depotOf = {};
  for (const d of depotTracks) if (!d.shop && !depotOf[d.depot.line]) depotOf[d.depot.line] = d.t.id;
  for (const fd of fleetDefs) {
    if (fd.main || !fd.depot) continue;
    const d = depotTracks.find(x => !x.shop && x.depot.name === fd.depot);
    if (d) depotOf[fd.line] = d.t.id;
  }
  const anyDepot = depotTracks.find(d => !d.shop);
  store.rev++;
  const gE = buildGraph(doc);
  for (const E of Object.values(lines)) {
    if (E.spec.op !== spec.self) continue;
    const trackId = depotOf[E.key] || (anyDepot && anyDepot.t.id);
    if (!trackId) continue;
    const sts = lineStations(doc, gE, E.line);
    const own = trains.filter(t => t.lineId === E.line.id && t.operatorId === opIds[spec.self]);
    for (const r of buildRosters(doc, E.line, sts, own)) {
      const last = r.trains[r.trains.length - 1];
      if (last.throughId || last.toDepot) continue;
      last.toDepot = true; last.depotTrackId = trackId;
    }
  }

  doc.tracks = tracks; doc.objects = objects; doc.formations = formations;
  initCompany(doc);
  return doc;
}

/** 区間の指定 [[駅名, 駅名], ...] → { 駅間番号: true } */
function rangeMap(ranges, E, L) {
  const out = {};
  for (const [a, b] of ranges || []) {
    const i = E.stations.findIndex(x => x.name === a), j = E.stations.findIndex(x => x.name === b);
    if (i < 0 || j < 0) throw new Error(`${L.name}: 区間 ${a}〜${b} の駅がありません`);
    for (let k = Math.min(i, j); k < Math.max(i, j); k++) out[k] = true;
  }
  return out;
}

/** 単線区間 singles: [[駅名, 駅名], ...] → { 駅間番号: true } */
function singleMap(L, E) {
  const out = { ...(L.secSingle || {}) };
  for (const [a, b] of L.singles || []) {
    const i = E.stations.findIndex(x => x.name === a), j = E.stations.findIndex(x => x.name === b);
    if (i < 0 || j < 0) throw new Error(`${L.name}: 単線区間 ${a}〜${b} の駅がありません`);
    for (let k = Math.min(i, j); k < Math.max(i, j); k++) out[k] = true;
  }
  for (const [a, b] of L.doubles || []) {
    const i = E.stations.findIndex(x => x.name === a), j = E.stations.findIndex(x => x.name === b);
    for (let k = Math.min(i, j); k < Math.max(i, j); k++) out[k] = false;
  }
  return out;
}

/** 走行時間を測るための仮の列車 */
function dummyTrain(line, fromIdx, toIdx, vmax) {
  return {
    id: `dummy_${line.id}`, lineId: line.id, number: '', type: 'local', dir: 'down',
    fromIdx, toIdx, departSec: 6 * 3600, speedKmh: vmax, dwellSec: 30, skip: [],
    cars: 8, platforms: {}, holds: {}, delaySec: 0,
  };
}

/**
 * 車両基地：駅の先から入出庫線を出し、はしご状に留置線を並べる。
 * side = +1 / -1 で本線のどちら側に置くか。
 */
function buildDepot(E, S, dp, nStable, lenM) {
  const side = dp.side || 1;
  const s0 = S.s + (dp.offset ?? 200);
  const u = E.path.at(s0), a = u.angle;
  const ux = { x: Math.cos(a), y: Math.sin(a) };
  const nv = { x: -Math.sin(a) * side, y: Math.cos(a) * side };
  const P = (du, dv) => ({ x: u.x + ux.x * du + nv.x * dv, y: u.y + ux.y * du + nv.y * dv });
  const tracks = [], objects = [];
  const inOut = T(`${dp.name} 入出庫線`, 'entryexit', [P(0, 0), P(60, 50), P(120, 90)], {}, { maxSpeedKmh: 25 });
  tracks.push(inOut);
  // はしご（ラダー）
  const pitch = 14;
  const kinds = ['daily', 'periodic', 'washing'];
  const total = nStable + kinds.length;
  const lad = T(`${dp.name} ラダー線`, 'shunting', [P(120, 90), P(120 + pitch * total, 90 + pitch * total)], { b: 'buffer' }, { maxSpeedKmh: 25 });
  tracks.push(lad);
  const stabling = [];
  let shop = null;
  for (let j = 0; j < total; j++) {
    const du = 120 + pitch * (j + 0.5), dv = 90 + pitch * (j + 0.5);
    const kind = j < kinds.length ? kinds[j] : 'stabling';
    const name = kind === 'daily' ? '仕業検査線' : kind === 'periodic' ? '交番検査線' : kind === 'washing' ? '洗浄線' : `${j - kinds.length + 1}番線`;
    const len = kind === 'stabling' ? lenM : lenM / 2 + 20;
    const t = T(`${dp.name} ${name}`, kind, [P(du, dv), P(du + len, dv)], { b: 'buffer' }, { maxSpeedKmh: 15 });
    tracks.push(t);
    if (kind === 'stabling') stabling.push(t);
    if (kind === 'periodic') shop = t;
  }
  const lbl = P(120 + lenM / 2, 60);
  objects.push(O('admin_office', lbl.x, lbl.y, { label: dp.name, rot: a, w: 50, h: 22 }));
  return { tracks, objects, stabling, shop };
}
