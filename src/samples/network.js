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
  Object.assign(doc.settings, spec.settings || {});
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
    const shared0 = !!L.attach;       // 先頭駅は接続先の路線と共用
    // 描画上の駅位置（経路の始点からの距離）
    const pos = [];
    let s = L.attach ? 0 : (L.ring ? 20 : MARGIN);
    const connLen = L.attach ? (L.attach.mode === 'branch' ? Math.abs(L.attach.offset ?? 220) : 0) : 0;
    for (let i = 0; i < st.length; i++) {
      if (i === 0) { pos.push(L.attach ? -connLen : s); continue; }
      const real = Math.abs(st[i].km - st[i - 1].km) * 1000;
      const gap = Math.max(Math.min(real, SP), 300);
      s = (i === 1 && L.attach ? 0 : s) + (i === 1 && L.attach ? Math.max(gap, 220) : gap);
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
        const tdeg = L.turns && L.turns[st[i].name];
        if (tdeg != null && i > 0) turnAt.push({ s: pos[i] + 200, h: tdeg * DEG });
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
      const mkLoop = (side, label) => {
        const a0 = path.at(pos[i] - LOOP_HALF), a1 = path.at(pos[i] + LOOP_HALF);
        const b0 = add(path.at(pos[i] - LOOP_HALF + 35), path.nrm(pos[i] - LOOP_HALF + 35), side * LOOP_OFF);
        const b1 = add(path.at(pos[i] + LOOP_HALF - 35), path.nrm(pos[i] + LOOP_HALF - 35), side * LOOP_OFF);
        const t = T(`${S.name}${label}`, 'platform', [a0, b0, b1, a1], {}, { maxSpeedKmh: 45 });
        tracks.push(t); stTracks.push(t.id);
        return t;
      };
      if (S.type === 'p' || S.type === 'pd') loops.down = mkLoop(-1, '下り副本線');
      if (S.type === 'p' || S.type === 'pu') loops.up = mkLoop(+1, '上り副本線');
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
      const side = S.type === 'p' ? LOOP_OFF + 9 : 9;
      const pl = (L.maxCars || 10) * 20 + 10;
      if (S.type !== 't') {
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
      secSingle: L.secSingle || {},
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
    const fromIdx = E.stations.findIndex(x => x.name === fromName);
    const toIdx = E.stations.findIndex(x => x.name === toName);
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
    return {
      id: uid('tr'), lineId: E.line.id, number, name: sv.label || '', type,
      dir: up ? 'up' : 'down', fromIdx, toIdx, departSec: dep,
      speedKmh: sv.speed || E.spec.vmax || 100, dwellSec: sv.dwell ?? 30, skip,
      cars: sv.cars || E.spec.maxCars || 10, platforms, holds: {}, delaySec: 0,
      toDepot: false, depotTrackId: null, throughId: null,
      operatorId: opIds[op] || null, color: null, formationId: null, note: sv.name,
      couple: null,
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
  const runService = (sv, route, dep, n) => {
    const op = pickOp(sv, n);
    const no = (counters[sv.prefix || sv.type] = (counters[sv.prefix || sv.type] || 0) + 1);
    const number = `${sv.prefix || ''}${no}${sv.suffix || ''}`;
    let t = dep;
    const made = [];
    route.forEach((seg, k) => {
      const E = lines[seg[0]];
      const tr = makeTrain(E, seg[1], seg[2], t, sv, op, number);
      if (throughSources.has(seg[0])) tr.throughId = throughFor(route, k);
      const stops = computeSchedule(doc, stsOf[E.key], tr);
      const last = stops[stops.length - 1];
      t = (last.arr ?? t) + (sv.transfer ?? 60);
      made.push(tr);
    });
    return made;
  };
  for (const sv of spec.services || []) {
    let n = 0;
    for (const [from, to, every, offset = 0] of sv.slots) {
      for (let t = hm(from) + offset * 60; t < hm(to); t += every * 60) {
        trains.push(...runService(sv, sv.route, t, n));
        if (sv.both !== false) {
          const rev = sv.route.slice().reverse().map(([k, a, b]) => [k, b, a]);
          trains.push(...runService(sv, rev, t + (sv.revOffset ?? 0) * 60, n));
        }
        n++;
      }
    }
  }
  doc.trains = trains;

  /* ---- 6) 自社の編成をダイヤから逆算し、車両基地に置く ---- */
  const selfMain = spec.lines.find(L => L.op === spec.self);
  let fleetGroups = [];
  if (selfMain) {
    const E = lines[selfMain.key];
    store.rev++;
    const sts = lineStations(doc, buildGraph(doc), E.line);
    const own = trains.filter(t => t.lineId === E.line.id && t.operatorId === opIds[spec.self]);
    const rosters = buildRosters(doc, E.line, sts, own);
    const groups = new Map();
    for (const r of rosters) {
      const key = `${r.cars}|${[...r.req.safety].sort().join(',')}`;
      if (!groups.has(key)) groups.set(key, { cars: r.cars, safety: [...r.req.safety], n: 0 });
      groups.get(key).n++;
    }
    fleetGroups = [...groups.values()].sort((a, b) => b.n - a.n);
  }
  const fleet = spec.fleet || {};
  const allSafety = [...new Set(fleetGroups.flatMap(g => g.safety).concat(fleet.extraSafety || []))];
  const sets = [];
  let serial = 1;
  for (const gp of fleetGroups) {
    const count = gp.n + Math.max(1, Math.ceil(gp.n * 0.15));
    for (let k = 0; k < count; k++) {
      sets.push({
        name: `${fleet.prefix || ''}${String(serial++).padStart(2, '0')}${fleet.suffix || '編成'}`,
        series: fleet.series || '', cars: gp.cars,
        // 予備車は全線対応にしておく（運用の入れ替えがきくように）
        safety: k >= gp.n ? allSafety : gp.safety,
      });
    }
  }

  // 車両基地
  const depotTracks = [];
  for (const dp of spec.depots || []) {
    const E = lines[dp.line];
    const S = E.stations.find(x => x.name === dp.at);
    if (!S) continue;
    const setsHere = dp.own ? (dp.share != null ? Math.ceil(sets.length * dp.share) : sets.length) : 0;
    const lenM = Math.max(220, (dp.cars || 10) * 21 + 30) * 2;   // 1線に2編成
    const nStable = Math.max(dp.min || 4, Math.ceil(setsHere / 2) + 1);
    const yard = buildDepot(E, S, dp, nStable, lenM);
    tracks.push(...yard.tracks);
    objects.push(...yard.objects);
    if (dp.own) {
      depotTracks.push(...yard.stabling.map(t => ({ t, left: 2, depot: dp })));
      if (yard.shop) depotTracks.push({ t: yard.shop, left: 1, depot: dp, shop: true });
    }
  }
  // 編成を留置線へ（最後の1本は交番検査中にする）
  sets.forEach((st, i) => {
    const spot = depotTracks.find(d => !d.shop && d.left > 0);
    const shop = i === sets.length - 1 ? depotTracks.find(d => d.shop && d.left > 0) : null;
    const place = shop || spot;
    if (place) place.left--;
    formations.push({
      id: uid('f'), name: st.name, series: st.series, vehicle: fleet.vehicle || 'emu',
      cars: st.cars, carLengthM: fleet.carLengthM ?? null, loco: null,
      color: FORMATION_COLORS[i % FORMATION_COLORS.length],
      trackId: place ? place.t.id : null, note: shop ? '交番検査中' : '',
      operatorId: opIds[spec.self], safety: st.safety, odoKm: 0, inspection: null,
    });
  });

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

  doc.tracks = tracks; doc.objects = objects; doc.formations = formations;
  initCompany(doc);
  return doc;
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
    const len = kind === 'stabling' ? lenM : lenM / 2;
    const t = T(`${dp.name} ${name}`, kind, [P(du, dv), P(du + len, dv)], { b: 'buffer' }, { maxSpeedKmh: 15 });
    tracks.push(t);
    if (kind === 'stabling') stabling.push(t);
    if (kind === 'periodic') shop = t;
  }
  const lbl = P(120 + lenM / 2, 60);
  objects.push(O('admin_office', lbl.x, lbl.y, { label: dp.name, rot: a, w: 50, h: 22 }));
  return { tracks, objects, stabling, shop };
}
