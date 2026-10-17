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
import { buildGraph, junctionNodes, turnoutSpecAt, crossoverUnits } from '../topology.js';
import { polylineLength, pointAt, distToPolyline, distToSegment, segIntersect } from '../geom.js';
import { lineStations, computeSchedule } from '../timetable.js';
import { buildRosters } from '../duty.js';
import { planMeets } from '../meets.js';
import { initCompany } from '../company.js';
import { stripMapping, baseline, arcPath, mapPolyline, yAt, KY } from './diagramLine.js';

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
    ...(extra._fit ? { _fit: true } : {}),
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
  const gaps = [], pendingDiamonds = [];
  for (const L of spec.lines) {
    const D = spec.diagram && spec.diagram[L.key];
    if (D) {
      if (L.attach && lines[L.attach.line]) lines[L.attach.line]._siblings = spec.lines.filter(o => o.attach && o.attach.line === L.attach.line);
      drawDiagramLine(L, D, { lines, tracks, objects, stationObjByName, SP, gaps, T, O, pendingDiamonds });
      continue;
    }
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
      const ex = parent.diagram && ps.diag ? junctionTargets(L, parent, ps) : [];
      if (ex.length) {
        // 接続先の配線図に出口があれば、その先から延ばす（はじめは出口の向き、最初の駅間で路線の向きへ）
        const hx = ex.reduce((a, e) => a + Math.cos(e.dir), 0), hy = ex.reduce((a, e) => a + Math.sin(e.dir), 0);
        const h = Math.atan2(hy, hx);
        const c = { x: ex.reduce((a, e) => a + e.p.x, 0) / ex.length, y: ex.reduce((a, e) => a + e.p.y, 0) / ex.length };
        P0 = { x: c.x + Math.cos(h) * 60, y: c.y + Math.sin(h) * 60 };
      } else if (L.attach.mode === 'branch') {
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
      if (S.extra.ra && S.type === 't' && loops.stub1) {
        // 頭端式の駅の機回し：1番線と2番線を車止めの手前の渡り線でつなぐ（2番線を通って機関車を付け替える）
        const endS = i === 0 ? pos[i] - 60 : pos[i] + 60, dir = i === 0 ? 1 : -1;
        const qa = path.at(endS + dir * 30);
        const qb = add(path.at(endS + dir * 55), path.nrm(endS + dir * 55), -24);
        tracks.push(T(`${S.name}機回し線`, 'runaround', [qa, qb], {}, { maxSpeedKmh: 15 }));
      } else if (S.extra.ra) {
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
    // 配線略図で描いた路線から分かれる場合は、その本線へつなぐ
    if (L.attach && lines[L.attach.line] && lines[L.attach.line].diagram) linkAttach(L, entry, lines[L.attach.line], tracks);
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
  for (const E of Object.values(lines)) {
    if (E.diagram) continue;
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
      gaps.push({ line: E, i, objs: [g] });
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
        if (gp && Math.abs(diff) > 5 && sts[i].path && sts[i].path.length) {
          // 経路が省略の記号を通らない（接続の線などで記号を避けて行ける）ときは、経路のいちばん長い線にも記号を置く
          const atOn = (t, o) => {
            let best = 1e18, at = 0, acc = 0;
            for (let j = 1; j < t.points.length; j++) {
              const a = t.points[j - 1], b = t.points[j], L = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
              const u = Math.max(0, Math.min(1, ((o.x - a.x) * (b.x - a.x) + (o.y - a.y) * (b.y - a.y)) / (L * L)));
              const d = Math.hypot(a.x + (b.x - a.x) * u - o.x, a.y + (b.y - a.y) * u - o.y);
              if (d < best) { best = d; at = acc + L * u; }
              acc += L;
            }
            return at;
          };
          const passes = sts[i].path.some(p => gp.objs.some(o => {
            if (o.trackId !== p.trackId) return false;
            const t = doc.tracks.find(x => x.id === p.trackId), at = atOn(t, o);
            return at >= Math.min(p.fromAt, p.toAt) - 1 && at <= Math.max(p.fromAt, p.toAt) + 1;
          }));
          if (!passes) {
            const pc = sts[i].path.reduce((a, p) => (Math.abs(p.toAt - p.fromAt) > Math.abs(a.toAt - a.fromAt) ? p : a));
            const t = doc.tracks.find(x => x.id === pc.trackId);
            if (t) {
              const q = pointAt(t.points, (pc.fromAt + pc.toAt) / 2);
              const g2 = O('gap_break', q.x, q.y, { rot: q.angle, trackId: t.id, extraM: gp.objs[0].extraM });
              doc.objects.push(g2); gp.objs.push(g2);
            }
          }
        }
        if (gp && Math.abs(diff) > 5) {
          const v = Math.max(0, gp.objs[0].extraM + diff);
          for (const o of gp.objs) o.extraM = v;
          worst = Math.max(worst, Math.abs(diff));
        }
      }
    }
    return worst;
  };
  for (let k = 0; k < 4 && fit() > 5; k++);

  // 直通先の起点（共有する駅）で、子路線の下りが親路線の上り本線から出ていくなら向きを読み替える
  {
    store.rev++;
    const gq = buildGraph(doc);
    for (const E of Object.values(lines)) {
      const st0 = E.stations[0];
      if (!E.spec.attach || !st0 || !st0.shared || !st0.obj || !st0.obj.upTrackId) continue;
      const sts = lineStations(doc, gq, E.line);
      if (sts[1] && sts[1].fromTrack && sts[1].fromTrack === st0.obj.upTrackId) E.line.flip = { 0: true };
    }
  }

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
      if (S.diag) {
        // 配線略図の駅：止まる列車は、その向きでホームに面した線へ（通過線しかない本線には止めない）
        const stops = !skip.includes(i);
        const list = up ? S.diag.stop.up : S.diag.stop.down;
        const own = up ? (S.obj.upTrackId || S.obj.trackId) : S.obj.trackId;
        if (i === fromIdx || i === toIdx) {
          const pool = list.length ? list : (S.obj.tracks || [own]);
          platforms[i] = pool[(counters[S.name] = (counters[S.name] || 0) + 1) % pool.length];
        } else if (stops && list.length && !list.includes(own)) {
          platforms[i] = list.find(id => id !== S.obj.trackId && id !== S.obj.upTrackId) || list[0];
        }
        continue;
      }
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
  const depotTracks = [], pendingYards = [];
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
    // 配線略図に描かれた車両基地があればその線路を使い、足りなければ描き足す
    const drawn = E.diagram ? diagramDepot(E, dp, objects) : null;
    const setLen = (dp.cars || 10) * carLen + 10;
    let cap = 0;
    if (drawn) {
      for (const t of drawn.stabling) {
        const left = Math.floor(polylineLength(t.points) / setLen);
        if (!left) continue;
        cap += left;
        if (dp.own || extra) depotTracks.push({ t, left, depot: dp });
      }
      if (drawn.shop && (dp.own || extra) && polylineLength(drawn.shop.points) >= setLen) depotTracks.push({ t: drawn.shop, left: 1, depot: dp, shop: true });
      // 足りなければ、同じ路線の駅の留置線・引上線（夜間の留置）も使う
      if (cap < setsHere + 1 && (dp.own || extra)) {
        for (const t of E.diagram.trackOf) {
          if (!t || (t.kind !== 'stabling' && t.kind !== 'shunting') || depotTracks.some(d => d.t === t)) continue;
          const left = Math.floor(polylineLength(t.points) / setLen);
          if (!left) continue;
          depotTracks.push({ t, left, depot: dp });
          cap += left;
          if (cap >= setsHere + 1) break;
        }
      }
    }
    if (process.env.DEBUG_DEPOT) console.log('DEPOT', dp.name, drawn ? `図${drawn.stabling.length}線` : '図なし', 'cap', cap, 'need', setsHere);
    if (!drawn || cap < setsHere) pendingYards.push({ E, S, dp, drawn, cap, setsHere, extra, nStable, lenM });
  }
  // 足りない車両基地を描き足す。本線の車両はどの基地にも置けるので、会社全体で足りなければ
  // いちばん足りない基地に、線区専用の車両はその基地に足す。
  const ownCap = depotTracks.filter(d => !d.shop && d.depot.own && !d.depot.reserved).reduce((a, d) => a + d.left, 0);
  let mainShort = estMain + 1 - ownCap;
  pendingYards.sort((a, b) => (b.setsHere - b.cap) - (a.setsHere - a.cap));
  for (const pd of pendingYards) {
    const { E, S, dp, drawn, cap, setsHere, extra, nStable, lenM } = pd;
    let need = nStable;
    if (drawn) {
      const short = extra ? setsHere + 1 - cap : (dp.own && !dp.reserved ? mainShort : 0);
      if (short <= 0) continue;
      need = Math.max(2, Math.ceil(short / 2) + 1);
      if (!extra) mainShort = 0;
    }
    const yard = E.diagram ? placeYard(E, S, dp, need, lenM, !!drawn, tracks, objects) : buildDepot(E, S, dp, need, lenM, !!drawn);
    tracks.push(...yard.tracks);
    objects.push(...yard.objects);
    if (dp.own || extra) {
      depotTracks.push(...yard.stabling.map(t => ({ t, left: 2, depot: dp })));
      if (yard.shop && !(drawn && drawn.shop)) depotTracks.push({ t: yard.shop, left: 1, depot: dp, shop: true });
    }
  }
  fitObjects(objects, tracks);
  closeDanglingEnds(tracks);
  /* ---- 7) 分岐器を接続点から自動生成 ---- */
  const tmp = { ...doc, tracks, objects, formations: [] };
  const g = buildGraph(tmp);
  if (pendingDiamonds.length) {
    const units = crossoverUnits(tmp, g, -Math.random());
    for (const pd of pendingDiamonds) {
      const sc = units.some(u => u.kind === 'scissors' && u.connectors.some(c => c.id === pd.a) && u.connectors.some(c => c.id === pd.b));
      if (!sc) objects.push(O('diamond', pd.x, pd.y, { rot: pd.rot, label: 'ダイヤモンドクロッシング' }));
    }
  }
  // ダイヤモンドクロッシングを、線路が実際に交わるところへ寄せる（車両基地の線を描き直したときなどにずれる）
  {
    const xs = [];
    const box = t => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of t.points) { a = Math.min(a, p.x); b = Math.min(b, p.y); c = Math.max(c, p.x); d = Math.max(d, p.y); } return [a, b, c, d]; };
    const bx = tracks.map(box);
    for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
      const A = tracks[i], B = tracks[j], ba = bx[i], bb = bx[j];
      if ((A.level || 0) !== (B.level || 0) || ba[2] < bb[0] || bb[2] < ba[0] || ba[3] < bb[1] || bb[3] < ba[1]) continue;
      for (let a = 1; a < A.points.length; a++) for (let b = 1; b < B.points.length; b++) {
        const x = segIntersect(A.points[a - 1], A.points[a], B.points[b - 1], B.points[b]);
        if (!x || g.nodes.some(n => Math.hypot(n.x - x.x, n.y - x.y) <= (g.tol || 6) + 1)) continue;
        xs.push({ x: x.x, y: x.y, rot: Math.atan2(A.points[a].y - A.points[a - 1].y, A.points[a].x - A.points[a - 1].x), main: A.kind === 'main' || B.kind === 'main' });
      }
    }
    const dia = objects.filter(o => o.type === 'diamond');
    const atX = o => xs.some(x => Math.hypot(x.x - o.x, x.y - o.y) <= 12);
    for (const x of xs) {
      if (dia.some(o => Math.hypot(o.x - x.x, o.y - x.y) <= 12)) continue;
      const cand = dia.filter(o => Math.hypot(o.x - x.x, o.y - x.y) <= 45 && !atX(o)).sort((p, q) => Math.hypot(p.x - x.x, p.y - x.y) - Math.hypot(q.x - x.x, q.y - x.y))[0];
      if (cand) { cand.x = x.x; cand.y = x.y; cand.rot = x.rot; }
      else if (!x.main) {
        // 図では平面で交わっている（破線でない）のに記号がないところにも置く（本線どうしの交わりは配線の誤りとして残す）
        const o = O('diamond', x.x, x.y, { rot: x.rot, label: 'ダイヤモンドクロッシング' });
        objects.push(o); dia.push(o);
      }
    }
  }
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
function buildDepot(E, S, dp, nStable, lenM, annex = false, farM = null) {
  const side = dp.side || 1;
  const s0 = S.s + (dp.offset ?? 200);
  const u = E.path.at(s0), a = u.angle;
  const ux = { x: Math.cos(a), y: Math.sin(a) };
  const nv = { x: -Math.sin(a) * side, y: Math.cos(a) * side };
  // 配線略図で描いた路線では、駅の配線にかからないよう本線から離して置く
  const far = farM ?? (E.diagram ? 150 : 0);
  const P = (du, dv) => { const w = dv ? dv + far : 0; return { x: u.x + ux.x * du + nv.x * w, y: u.y + ux.y * du + nv.y * w }; };
  const tracks = [], objects = [];
  const nm = annex ? `${dp.name}（増設）` : dp.name;
  const inOut = T(`${nm} 入出庫線`, 'entryexit', [P(0, 0), P(60, 50), P(120, 90)], {}, { maxSpeedKmh: 25 });
  tracks.push(inOut);
  // はしご（ラダー）
  const pitch = 14;
  const kinds = ['daily', 'periodic', 'washing'];
  const total = nStable + kinds.length;
  const lad = T(`${nm} ラダー線`, 'shunting', [P(120, 90), P(120 + pitch * total, 90 + pitch * total)], { b: 'buffer' }, { maxSpeedKmh: 25 });
  tracks.push(lad);
  const stabling = [];
  let shop = null;
  for (let j = 0; j < total; j++) {
    const du = 120 + pitch * (j + 0.5), dv = 90 + pitch * (j + 0.5);
    const kind = j < kinds.length ? kinds[j] : 'stabling';
    const name = kind === 'daily' ? '仕業検査線' : kind === 'periodic' ? '交番検査線' : kind === 'washing' ? '洗浄線' : `${j - kinds.length + 1}番線`;
    const len = kind === 'stabling' ? lenM : lenM / 2 + 20;
    const t = T(`${nm} ${name}`, kind, [P(du, dv), P(du + len, dv)], { b: 'buffer' }, { maxSpeedKmh: 15 });
    tracks.push(t);
    if (kind === 'stabling') stabling.push(t);
    if (kind === 'periodic') shop = t;
  }
  const lbl = P(120 + lenM / 2, 60);
  if (!annex) objects.push(O('admin_office', lbl.x, lbl.y, { label: dp.name, rot: a, w: 50, h: 22 }));
  return { tracks, objects, stabling, shop };
}

/**
 * 配線図から置いたホーム・建物が線路の建築限界にかからないように縮める・ずらす
 * （配線図ではホームが線路に接して描かれていたり、駅の両端の渡り線にかかっていたりする）
 */
function fitObjects(objects, tracks) {
  const HALF = 1.9 + 0.15;
  const pts = [];
  for (const t of tracks) {
    const L = polylineLength(t.points);
    for (let d = 0; d <= L; d += 0.75) pts.push(pointAt(t.points, d));
    pts.push(t.points[t.points.length - 1]);
  }
  // 点の索引
  const cell = 50, grid = new Map();
  for (const p of pts) { const k = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  const near = (o, r) => {
    const out = [];
    for (let i = Math.floor((o.x - r) / cell); i <= Math.floor((o.x + r) / cell); i++)
      for (let j = Math.floor((o.y - r) / cell); j <= Math.floor((o.y + r) / cell); j++) for (const p of grid.get(i + ',' + j) || []) out.push(p);
    return out;
  };
  const local = (o, p) => {
    const c = Math.cos(-(o.rot || 0)), sn = Math.sin(-(o.rot || 0)), dx = p.x - o.x, dy = p.y - o.y;
    return { lx: dx * c - dy * sn, ly: dx * sn + dy * c };
  };
  const hits = o => near(o, Math.max(o.w, o.h) / 2 + 4).map(p => local(o, p)).filter(q => Math.abs(q.lx) <= o.w / 2 + HALF && Math.abs(q.ly) <= o.h / 2 + HALF);
  const move = (o, du, dv) => {
    const c = Math.cos(o.rot || 0), sn = Math.sin(o.rot || 0);
    o.x += du * c - dv * sn; o.y += du * sn + dv * c;
  };
  const drop = new Set();
  for (const o of objects) {
    if (!o._fit) continue;
    delete o._fit;
    let hs = hits(o);
    if (!hs.length) continue;
    const isPlat = o.type.startsWith('platform');
    // 長手方向：ホームの中ほどを横切る線（端の渡り線）があれば、そこまで縮める
    const core = hs.filter(q => Math.abs(q.ly) < o.h / 2 - 0.3);
    if (core.length && isPlat) {
      let lo = -o.w / 2, hi = o.w / 2;
      for (const q of core) { if (q.lx >= 0) hi = Math.min(hi, q.lx - HALF); else lo = Math.max(lo, q.lx + HALF); }
      if (hi - lo >= 20) { const w = hi - lo; move(o, (lo + hi) / 2, 0); o.w = w; hs = hits(o); }
    }
    // 幅方向：両側の線から建築限界ぶん離れた帯に収める
    if (hs.length) {
      let lo = -o.h / 2, hi = o.h / 2;
      for (const q of hs) { if (q.ly >= 0) hi = Math.min(hi, q.ly - HALF); else lo = Math.max(lo, q.ly + HALF); }
      if (hi - lo >= (isPlat ? 2.5 : 6)) { const h = hi - lo; move(o, 0, (lo + hi) / 2); o.h = h; hs = hits(o); }
    }
    if (hs.length && isPlat) {
      // 端の角に曲がった線がかかるときは、その端を縮める（もとの長さの6割までなら）
      let lo = -o.w / 2, hi = o.w / 2;
      for (const q of hs) { if (q.lx >= 0) hi = Math.min(hi, q.lx - HALF); else lo = Math.max(lo, q.lx + HALF); }
      if (hi - lo >= o.w * 0.6) { const w = hi - lo; move(o, (lo + hi) / 2, 0); o.w = w; hs = hits(o); }
    }
    if (hs.length && !isPlat) {
      // 建物はずらす
      const w0 = { x: o.x, y: o.y };
      let ok = false;
      for (const dv of [12, -12, 24, -24, 40, -40, 60, -60, 90, -90]) {
        o.x = w0.x; o.y = w0.y; move(o, 0, dv);
        if (!hits(o).length) { ok = true; break; }
      }
      if (!ok) { o.x = w0.x; o.y = w0.y; drop.add(o); }
    }
  }
  if (drop.size) for (let i = objects.length - 1; i >= 0; i--) if (drop.has(objects[i])) objects.splice(i, 1);
}

/** 先頭部分（接続先の配線図の中）でこの路線が使う線：途中駅の、接続先の本線につながらないホームの線 */
function lineTracksOf(L, PD, pre) {
  const set = new Set();
  for (const S of pre) {
    const ex = PD.D.extra && PD.D.extra[S.name];
    PD.D.tracks.forEach((d, k) => {
      const t = PD.trackOf[k];
      if (t && (d.stations || []).includes(S.name) && (ex || d.foreign)) set.add(t);
    });
  }
  return [...set];
}

/**
 * 接続先の路線の配線図の中にある駅（路線の先頭部分）。接続先と同じ駅はその駅を使い、
 * 接続先の列車が止まらない駅（並行する別の線だけのホーム）は、その線路の上に駅を置く。
 */
function prefixStations(L, pre, lines, objects, stationObjByName, all = pre) {
  const parent = lines[L.attach.line];
  const PD = parent && parent.diagram;
  const out = [];
  for (const S of pre) {
    const obj0 = stationObjByName[S.name];
    const ex = PD && PD.D.extra && PD.D.extra[S.name];
    const pi = PD ? parent.spec.stations.findIndex(x => x[0] === S.name) : -1;
    const ds = pi >= 0 ? PD.D.stations[pi] : null;
    const X = ex ? ex.x : (ds && ds.x != null ? ds.x : null);
    // その駅の、接続先の本線につながらない（この路線の）ホームの線
    const own = [];
    if (X != null) {
      PD.D.tracks.forEach((d, k) => {
        const t = PD.trackOf[k];
        if (!t || !(d.stations || []).includes(S.name) || (!ex && !d.foreign)) return;
        const xs = d.pts.map(q => q[0]);
        const Xc = Math.max(Math.min(...xs), Math.min(Math.max(...xs), X));
        const y = yAt(d.pts, Xc);
        if (y != null) own.push({ t, y });
      });
    }
    if (!own.length && X != null) {
      // ホームが見つからなくても、この路線の線（前後の駅の番線）が駅を通っていればその線に
      for (const t of lineTracksOf(L, PD, all)) {
        const k = PD.trackOf.indexOf(t), d = PD.D.tracks[k];
        const xs = d.pts.map(q => q[0]);
        if (Math.min(...xs) <= X && Math.max(...xs) >= X) { const y = yAt(d.pts, X); if (y != null) own.push({ t, y }); }
      }
    }
    if (!own.length) {
      if (obj0) { out.push({ ...S, s: 0, obj: obj0, p: { x: obj0.x, y: obj0.y }, shared: true, loops: {} }); continue; }
      throw new Error(`${L.name}: ${S.name} のホームの線がありません`);
    }
    own.sort((a, b) => a.y - b.y);
    // 左側通行：下り（帯の右へ進む）は上側の線
    const dn = own[0].t, up = own.length > 1 ? own[own.length - 1].t : null;
    const yc = own.reduce((a, o) => a + o.y, 0) / own.length;
    const p = PD.M(X, yc);
    const ang = parent.path.at(PD.map.U(X)).angle;
    const obj = O('station_mark', p.x, p.y, {
      label: S.name, trackId: dn.id, tracks: own.map(o => o.t.id), rot: ang,
      population: S.extra.pop ?? 20000, jobs: S.extra.jobs ?? 5000, kindId: S.extra.kind || 'residential',
    });
    if (up) obj.upTrackId = up.id;
    objects.push(obj);
    for (const b of (ex && ex.plats) || []) {
      const c = PD.M((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
      const w = (b[2] - b[0]) * PD.map.kx * 0.86, h = Math.max(4, (b[3] - b[1]) * KY * 0.7);
      objects.push(O('platform_island', c.x, c.y, { w, h, rot: parent.path.at(PD.map.U((b[0] + b[2]) / 2)).angle, _fit: true }));
    }
    if (!stationObjByName[S.name]) stationObjByName[S.name] = obj;
    out.push({ ...S, s: PD.map.U(X), obj, p, loops: {}, shared: false, diag: { stop: { down: [dn.id], up: [(up || dn).id] }, X } });
  }
  return out;
}

/** どの線路にもつながっていない「つながる」端は車止めにする（配線図の重複線を除いたあとなどに残る） */
function closeDanglingEnds(tracks) {
  const idx = segIndex(tracks, []);
  for (const t of tracks) {
    for (const w of ['a', 'b']) {
      if (t.ends[w] !== 'open') continue;
      const p = w === 'a' ? t.points[0] : t.points[t.points.length - 1];
      let hit = false;
      const i = Math.floor(p.x / idx.cell), j = Math.floor(p.y / idx.cell);
      for (let a = i - 1; a <= i + 1 && !hit; a++) for (let b = j - 1; b <= j + 1 && !hit; b++) {
        for (const [s, e] of idx.m.get(a + ',' + b) || []) {
          if (t.points.includes(s) && t.points.includes(e)) continue;     // 自分の線分
          if (distToSegment(p.x, p.y, s.x, s.y, e.x, e.y) < 3.5) { hit = true; break; }
        }
      }
      if (!hit) t.ends[w] = 'buffer';
    }
  }
}

/** 線路の線分の索引（近くの線路をすばやく探す） */
function segIndex(tracks, objects) {
  const cell = 40, m = new Map();
  const addSeg = (a, b) => {
    const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell);
    const y0 = Math.floor(Math.min(a.y, b.y) / cell), y1 = Math.floor(Math.max(a.y, b.y) / cell);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
      const k = i + ',' + j;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push([a, b]);
    }
  };
  for (const t of tracks) for (let k = 1; k < t.points.length; k++) addSeg(t.points[k - 1], t.points[k]);
  // ホーム・建屋も避ける
  for (const o of objects) {
    if (!/platform|shed|shop|office/.test(o.type) || !o.w || !o.h) continue;
    const c = Math.cos(o.rot || 0), sn = Math.sin(o.rot || 0);
    const P = (u, v) => ({ x: o.x + c * u - sn * v, y: o.y + sn * u + c * v });
    const q = [P(-o.w / 2, -o.h / 2), P(o.w / 2, -o.h / 2), P(o.w / 2, o.h / 2), P(-o.w / 2, o.h / 2)];
    for (let k = 0; k < 4; k++) addSeg(q[k], q[(k + 1) % 4]);
  }
  return { cell, m };
}
function nearTrack(idx, p, r) {
  const i = Math.floor(p.x / idx.cell), j = Math.floor(p.y / idx.cell);
  for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
    for (const [s, e] of idx.m.get(a + ',' + b) || []) if (distToSegment(p.x, p.y, s.x, s.y, e.x, e.y) < r) return true;
  }
  return false;
}
/** 配線略図で描いた路線に車両基地を描き足す：駅の配線や他の線にかからない場所を探す */
function placeYard(E, S, dp, need, lenM, annex, tracks, objects) {
  const idx = segIndex(tracks, objects);
  const base = dp.offset ?? 200;
  const total = E.path.len;
  let first = null;
  const anchor = yard => {
    // 入出庫線の根元を近い方の本線につなぐ
    const io = yard.tracks[0], q = io.points[1];
    let best = null;
    for (const t of E.mains) {
      const r = distToPolyline(q.x, q.y, t.points);
      if (!best || r.d < best.d) best = { d: r.d, t, at: r.at };
    }
    const pp = pointAt(best.t.points, Math.max(15, Math.min(polylineLength(best.t.points) - 15, best.at - 40)));
    io.points[0] = { x: Math.round(pp.x * 10) / 10, y: Math.round(pp.y * 10) / 10 };
  };
  const clash = yard => yard.tracks.some((t, k) => {
    const L = polylineLength(t.points);
    for (let d = k === 0 ? 14 : 0; d <= L; d += 6) if (nearTrack(idx, pointAt(t.points, d), 7)) return true;
    return false;
  });
  for (let n = 0; n <= 16; n++) {
    const dd = (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 300;
    const s0 = S.s + base + dd;
    if (total && (s0 < 0 || s0 + lenM + 300 > total)) continue;
    for (const sd of [dp.side || 1, -(dp.side || 1)]) {
      for (const far of [150, 260, 400]) {
        const yard = buildDepot(E, S, { ...dp, offset: base + dd, side: sd }, need, lenM, annex, far);
        anchor(yard);
        if (!first) first = yard;
        if (!clash(yard)) return yard;
      }
    }
  }
  return first;
}

/* ---------------- 配線略図から描く路線 ---------------- */

/** 帯の上の点から近い文字（「〜方」などの行先表示）を探す */
function labelNear(D, x, y, r = 40) {
  let best = null;
  for (const t of D.texts || []) {
    if (!/方$/.test(t.s)) continue;
    const cx = (t.x + t.x1) / 2;
    const d = Math.hypot(Math.max(0, Math.abs(cx - x) - (t.x1 - t.x) / 2), t.y - y);
    if (d <= r && (!best || d < best.d)) best = { d, s: t.s, t };
  }
  return best ? best.s.replace(/方$/, '') : '';
}
/** labelNear と同じで、表示そのものと距離も返す */
function labelNearInfo(D, x, y, r = 40) {
  let best = null;
  for (const t of D.texts || []) {
    if (!/方$/.test(t.s)) continue;
    const cx = (t.x + t.x1) / 2;
    const d = Math.hypot(Math.max(0, Math.abs(cx - x) - (t.x1 - t.x) / 2), t.y - y);
    if (d <= r && (!best || d < best.d)) best = { d, t };
  }
  return best;
}

/**
 * 配線略図のデータ D から1路線を描く。
 * 本線は上下2本（単線なら1本）の線路、駅の配線（副本線・渡り線・留置線・ホーム）は図のとおり。
 */
function drawDiagramLine(L, D, ctx) {
  const { lines, tracks, objects, stationObjByName, SP, gaps } = ctx;
  let st = L.stations.map(([name, km, type = 's', extra = {}]) => ({ name, km, type, extra }));
  // 先頭の何駅かが接続先の路線の配線図の中にある路線（南海高野線の難波〜岸里玉出など）
  const pre = L.prefix ? st.slice(0, L.prefix) : [];
  if (pre.length) st = st.slice(L.prefix);
  const shared0 = !!L.attach && !L.attach.ownStation;
  // 経路の始点と向き
  let P0 = L.origin || { x: 0, y: 0 }, heading = (L.heading ?? 0) * DEG;
  let headingTurn = null, lead = 0;
  if (L.attach) {
    // 起点側の切り口の数（本線＋切れている線）：接続先の出口をこの数だけ使う
    L._cuts = D.mains.length + D.tracks.reduce((a, d) => a + d.ends.filter((e, w) => e === 'boundary' && Math.abs(d.pts[w === 0 ? 0 : d.pts.length - 1][0] - D.x0) <= 1.5).length, 0);
    const parent = lines[L.attach.line];
    const ps = parent && parent.stations.find(x => x.name === L.attach.at);
    if (!parent || !ps) throw new Error(`${L.name}: 接続先 ${L.attach.line}/${L.attach.at} がありません`);
    const conn = attachPoint(L, parent, ps);
    P0 = conn.p;
    // 接続駅から起点までの距離（最初の駅間の長さから差し引く）
    if (shared0 && ps.p) lead = Math.hypot(P0.x - ps.p.x, P0.y - ps.p.y);
    // 接続点では接続先の線の向きのまま出て、最初の駅間で路線の向きに曲がる
    if (conn.heading != null) {
      if (L.heading != null) headingTurn = L.heading * DEG;
      heading = conn.heading;
    }
  }
  const map = stripMapping(D, st, L.spacing || SP, { shared0, lead });
  const base = baseline(D, map.seps);
  // 曲がり角は、その駅の先の駅間（分岐のない区間）の中ほど
  const turns = [];
  for (const [nm, tv] of Object.entries(L.turns || {})) {
    const i = st.findIndex(s => s.name === nm);
    if (i < 0 || !map.seps.length) continue;
    const tdeg = tv != null && typeof tv === 'object' ? tv.h : tv;
    const sep = map.seps[Math.min(i, map.seps.length - 1)];
    turns.push({ u: map.U((sep[0] + sep[1]) / 2), h: tdeg * DEG });
  }
  if (headingTurn != null && map.seps.length) {
    let u0 = map.U((map.seps[0][0] + map.seps[0][1]) / 2);
    // 接続先の駅の配線（車両基地など）にかからない位置で曲がる
    const idx = segIndex(tracks, []);
    const clearAt = ut => {
      const pts = arcPath(P0, heading, [{ u: ut, h: headingTurn }], ut + 1200);
      const pth = makePath(pts);
      for (let d = 100; d <= pth.len; d += 12) {
        const q = pth.at(d), nv = pth.nrm(d);
        if ([-12, 0, 12].some(v => nearTrack(idx, { x: q.x + nv.x * v, y: q.y + nv.y * v }, 6))) return false;
      }
      return true;
    };
    if (process.env.DEBUG_TURN) console.log("TURN", L.key, "u0", Math.round(u0), "total", Math.round(map.total), "clear0", clearAt(u0));
    for (let ut = u0; ut < Math.min(map.total * 0.6, u0 + 3000); ut += 60) {
      if (clearAt(ut)) { u0 = ut; break; }
    }
    if (process.env.DEBUG_TURN) console.log("TURN ->", Math.round(u0));
    if (!turns.some(t => Math.abs(t.u - u0) < 1)) turns.push({ u: u0, h: headingTurn });
  }
  turns.sort((a, b) => a.u - b.u);
  let pathPts;
  if (L.ring) {
    const R = (map.total + 40) / (2 * Math.PI);
    const C = add(P0, { x: 0, y: -R });
    pathPts = [];
    const N = 240;
    for (let k = 0; k <= N; k++) {
      const a = Math.PI / 2 - (k / N) * 2 * Math.PI * (map.total / (map.total + 40));
      pathPts.push({ x: C.x + R * Math.cos(a), y: C.y + R * Math.sin(a) });
    }
  } else {
    pathPts = arcPath(P0, heading, turns, map.total + 5);
  }
  const path = makePath(pathPts);
  const M = (X, Y) => {
    const u = map.U(X), v = (Y - base(X)) * KY;
    const p = path.at(u), n = path.nrm(u);
    return { x: p.x + n.x * v, y: p.y + n.y * v };
  };

  // 本線
  const dn = D.mains.length > 1;
  const mains = D.mains.map((m, k) => {
    const pts = mapPolyline(m.pts, M);
    // 端：図で車止めなら車止め、他線へ続くなら場外（子路線がつながればあとで 'open' にする）
    const endA = m.ends[0] === 'buffer' ? 'buffer' : (L.attach ? 'open' : (L.startEnd === 'buffer' ? 'buffer' : 'boundary'));
    const endB = m.ends[1] === 'buffer' ? 'buffer' : (L.ring ? 'open' : (L.endEnd === 'buffer' ? 'buffer' : 'boundary'));
    const t = T(`${L.trackName || L.name}${dn ? (k === 0 ? '下り本線' : '上り本線') : ''}`, 'main', pts, { a: endA, b: endB }, { maxSpeedKmh: L.vmax ?? null });
    if (m.under && m.under.length) {
      t.underRanges = m.under.map(([xa, xb]) => {
        const ya = yAt(m.pts, xa), yb = yAt(m.pts, xb);
        const pa = M(xa, ya ?? base(xa)), pb = M(xb, yb ?? base(xb));
        const a = distToPolyline(pa.x, pa.y, pts).at, b = distToPolyline(pb.x, pb.y, pts).at;
        return [Math.min(a, b), Math.max(a, b)];
      });
    }
    tracks.push(t);
    return t;
  });
  const entry = { spec: L, main: mains[0], mains, path, stations: [], key: L.key, diagram: { D, map, M } };
  lines[L.key] = entry;

  // 駅の名前（いちばん近い駅）
  const nearStation = x => {
    let best = null;
    st.forEach((s, i) => { const d = Math.abs((map.cx[i] ?? 1e9) - x); if (!best || d < best.d) best = { d, name: s.name }; });
    return best ? best.name : L.name;
  };
  // 配線（本線以外の線路）
  const count = {};
  const trackOf = D.tracks.map(d => {
    const pts = mapPolyline(d.pts, M);
    if (pts.length < 2 || polylineLength(pts) < 1) return null;
    const xs = d.pts.map(p => p[0]);
    const xm = (Math.min(...xs) + Math.max(...xs)) / 2;
    const lenU = d.pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - d.pts[i - 1][0], p[1] - d.pts[i - 1][1]) : 0, 0);
    const buffer = d.ends.includes('buffer'), boundary = d.ends.includes('boundary');
    let kind = 'other', name;
    if (d.stations && d.stations.length >= 3 && !d.foreign) {
      // いくつもの駅を通る線：複々線の緩行線や、スイッチバックの先の本線
      kind = 'main';
      const ord = st.map(x => x.name).filter(n => d.stations.includes(n));
      const a = ord[0] || d.stations[0], b = ord[ord.length - 1] || d.stations[d.stations.length - 1];
      name = `${L.trackName || L.name}（${a}〜${b}）${d.use === 'down' ? '下り' : d.use === 'up' ? '上り' : ''}線`;
    } else if (d.stations && d.stations.length) {
      kind = 'platform';
      const sn = d.stations[0];
      const k = (count[`${sn}|p`] = (count[`${sn}|p`] || 0) + 1);
      name = `${sn} ${d.use === 'down' ? '下り' : d.use === 'up' ? '上り' : ''}副本線${k > 1 ? k : ''}`;
    } else if (boundary) {
      const ei = d.ends[0] === 'boundary' ? 0 : d.pts.length - 1;
      const lbl = labelNear(D, d.pts[ei][0], d.pts[ei][1]);
      name = lbl ? `${lbl}への線` : `${nearStation(xm)} 他線`;
      kind = 'other';
    } else if (buffer && lenU < 14 && d.ends.includes('open')) {
      kind = 'siding'; name = `${nearStation(xm)} 安全側線`;
    } else if (buffer) {
      kind = lenU > 45 ? 'stabling' : 'shunting';
      const sn = nearStation(xm);
      const k = (count[`${sn}|s`] = (count[`${sn}|s`] || 0) + 1);
      name = `${sn} ${kind === 'stabling' ? '留置線' : '引上線'}${k}`;
    } else {
      const sn = nearStation(xm);
      const k = (count[`${sn}|o`] = (count[`${sn}|o`] || 0) + 1);
      name = `${sn} ${lenU < 40 ? '渡り線' : '側線'}${k}`;
    }
    const t = T(name, kind, pts, { a: d.ends[0], b: d.ends[1] }, { maxSpeedKmh: kind === 'platform' ? 45 : 25 });
    if (d.use) t.use = d.use;
    if (d.under) t.level = -1;
    tracks.push(t);
    return t;
  });
  entry.diagram.trackOf = trackOf;
  if (L.ring) {
    // 環状線の継目：本線の終わりを、起点の駅の手前で切れている線（1周して戻ってくる線）につなぐ。
    // 無ければ本線の始まりへ。
    const h = path.at(map.total).angle;
    const perp = p => -Math.sin(h) * p.x + Math.cos(h) * p.y;
    const firstX = map.cx[0];
    const exits = [];
    D.tracks.forEach((d, k) => {
      const t = trackOf[k];
      if (!t) return;
      d.ends.forEach((e, w) => {
        const q = d.pts[w === 0 ? 0 : d.pts.length - 1];
        if (e !== 'boundary' || q[0] > firstX || Math.abs(q[0] - D.x0) > 3) return;
        exits.push({ t, which: w === 0 ? 'a' : 'b', p: w === 0 ? t.points[0] : t.points[t.points.length - 1] });
      });
    });
    const ends = mains.map(t => ({ t, p: t.points[t.points.length - 1] }));
    let pairs = null;
    if (exits.length >= ends.length) {
      // 幅のいちばん狭いひと続きを、左から順に組にする
      const E2 = exits.slice().sort((a, b) => perp(a.p) - perp(b.p)), M2 = ends.slice().sort((a, b) => perp(a.p) - perp(b.p));
      let best = 0, bw = Infinity;
      for (let i = 0; i + M2.length <= E2.length; i++) {
        const w = perp(E2[i + M2.length - 1].p) - perp(E2[i].p);
        if (w < bw) { bw = w; best = i; }
      }
      pairs = M2.map((m, k) => [m, E2[best + k]]);
    }
    for (const t of mains) {
      const pr = pairs && pairs.find(x => x[0].t === t);
      const a = t.points[t.points.length - 1];
      const b = pr ? pr[1].p : t.points[0];
      if (pr) { pr[1].t.ends[pr[1].which] = 'open'; pr[1].t.kind = 'main'; pr[1].t.name = `${t.name}（${st[0].name}方）`; }
      t.ends.b = 'open';
      if (Math.hypot(a.x - b.x, a.y - b.y) > 1) tracks.push(T(`${t.name}（継目）`, 'main', [a, b], {}, { maxSpeedKmh: L.vmax ?? null }));
    }
  }

  // 交差：平面交差はダイヤモンドクロッシング、立体交差は上を通る線を level=1 に
  const isConnector = k => {
    const d = D.tracks[k];
    if (!d || d.ends[0] !== 'open' || d.ends[1] !== 'open') return false;
    const L2 = d.pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - d.pts[i - 1][0], p[1] - d.pts[i - 1][1]) : 0, 0);
    return L2 < 45;
  };
  for (const c of D.crossings || []) {
    const ta = c.a[0] === 'm' ? mains[c.a[1]] : trackOf[c.a[1]];
    const tb = c.b[0] === 'm' ? mains[c.b[1]] : trackOf[c.b[1]];
    if (!ta || !tb) continue;
    if (c.grade) {
      // 破線（下をくぐる）でない方を上にする（本線は level を変えない）
      if (c.aUnder && c.b[0] === 't' && !c.bUnder) tb.level = Math.max(tb.level || 0, 1);
      if (c.bUnder && c.a[0] === 't' && !c.aUnder) ta.level = Math.max(ta.level || 0, 1);
      if (c.aUnder && c.a[0] === 't') ta.level = -1;
      if (c.bUnder && c.b[0] === 't') tb.level = -1;
      continue;
    }
    // シーサスクロッシング（渡り線どうしの交差）は渡り線の組として扱うので、記号は置かない
    const p = M(c.x, c.y);
    const r = distToPolyline(p.x, p.y, ta.points);
    const ang = pointAt(ta.points, r.at).angle;
    // （同じ2線を結ぶ渡り線どうしでなければ、ふつうのダイヤモンドクロッシング：配線が揃ってから決める）
    if (c.a[0] === 't' && c.b[0] === 't' && isConnector(c.a[1]) && isConnector(c.b[1])) {
      ctx.pendingDiamonds.push({ x: p.x, y: p.y, rot: ang, a: ta.id, b: tb.id });
      continue;
    }
    objects.push(O('diamond', p.x, p.y, { rot: ang, label: 'ダイヤモンドクロッシング' }));
  }

  // 建屋・転車台
  for (const b of D.bldgs || []) {
    let w = (b[2] - b[0]) * map.kx, h = (b[3] - b[1]) * KY;
    if (w < 3 || h < 3) continue;
    const c = M((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    let ang = path.at(map.U((b[0] + b[2]) / 2)).angle;
    if (b.length >= 7) {
      // 斜めに描いた建屋：図の向きと本来の大きさ（[x0, y0, x1, y1, 向き(度), 幅, 奥行き]）
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, a = b[4] * Math.PI / 180;
      const ux = Math.cos(a), uy = Math.sin(a);
      const pa = M(cx - ux * b[5] / 2, cy - uy * b[5] / 2), pb = M(cx + ux * b[5] / 2, cy + uy * b[5] / 2);
      const qa = M(cx + uy * b[6] / 2, cy - ux * b[6] / 2), qb = M(cx - uy * b[6] / 2, cy + ux * b[6] / 2);
      // 図は縦横の縮尺が違うので、長い辺（線路沿い）の向きにそろえ、短い辺はそれに直角な成分をとる
      let L1 = { x: pb.x - pa.x, y: pb.y - pa.y }, L2 = { x: qb.x - qa.x, y: qb.y - qa.y };
      if (Math.hypot(L2.x, L2.y) > Math.hypot(L1.x, L1.y)) [L1, L2] = [L2, L1];
      w = Math.hypot(L1.x, L1.y);
      h = Math.abs(L1.x * L2.y - L1.y * L2.x) / w;
      ang = Math.atan2(L1.y, L1.x);
    }
    // 線路が中を通る建屋は検修庫（車庫）、それ以外は職場などの建物
    const through = D.tracks.concat(D.mains).some(d => d.pts.some((p, j) => {
      const q = d.pts[j - 1];
      if (!q) return false;
      for (let f = 0; f <= 1; f += 0.1) {
        const x = q[0] + (p[0] - q[0]) * f, y = q[1] + (p[1] - q[1]) * f;
        if (b.length >= 7) {
          const a = b[4] * Math.PI / 180, dx = x - (b[0] + b[2]) / 2, dy = y - (b[1] + b[3]) / 2;
          if (Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) < b[5] / 2 && Math.abs(-dx * Math.sin(a) + dy * Math.cos(a)) < b[6] / 2) return true;
        } else if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) return true;
      }
      return false;
    }));
    // 図で接して並ぶ建屋が、曲がった線路に沿わせたときに重ならないよう少し小さく
    w = Math.max(3, w - 1.5); h = Math.max(3, h - 1.5);
    objects.push(O(through ? 'inspection_shed' : 'parts_shop', c.x, c.y, { w, h, rot: ang, label: through ? '検修庫' : '', _fit: !through }));
  }
  for (const t of D.tts || []) {
    const c = M(t.x, t.y);
    objects.push(O('turntable', c.x, c.y, { label: `${nearStation(t.x)}転車台` }));
    // 台の縁で切ってある線の端を、台（直径 25m）の縁に寄せる
    const reach = t.r * Math.max(map.kx, KY) + 3, rim = 12;
    for (const tr of trackOf) {
      if (!tr) continue;
      for (const k of [0, tr.points.length - 1]) {
        const q = tr.points[k], d = Math.hypot(q.x - c.x, q.y - c.y);
        if (d > reach || d < 1e-6) continue;
        const nb = tr.points[k === 0 ? 1 : tr.points.length - 2];
        // 台へ入る向き（隣の点から端へ）のまま、縁まで延ばす／縮める
        const a = Math.atan2(c.y - nb.y, c.x - nb.x), dn = Math.hypot(c.x - nb.x, c.y - nb.y);
        if (dn <= rim + 1) continue;
        tr.points[k] = { x: c.x - Math.cos(a) * rim, y: c.y - Math.sin(a) * rim };
      }
    }
  }

  // 駅
  for (let i = 0; i < st.length; i++) {
    const S = st[i];
    if (i === 0 && shared0) {
      if (pre.length) { entry.stations.push(...prefixStations(L, [S], lines, objects, stationObjByName, pre)); continue; }
      const obj = stationObjByName[S.name];
      entry.stations.push({ ...S, s: 0, obj, p: obj ? { x: obj.x, y: obj.y } : P0, shared: true, loops: {} });
      continue;
    }
    const X = map.cx[i];
    const ds = D.stations[i] || {};
    let yD = yAt(D.mains[0].pts, X);
    // 本線が通らない駅（スイッチバックの先など）：駅を通る線路を駅の線路にする
    let mainHere = mains[0];
    if (yD == null) {
      let best = null;
      D.tracks.forEach((d, k) => {
        const t = trackOf[k];
        if (!t) return;
        const y = yAt(d.pts, X);
        if (y == null) return;
        const score = ((d.stations || []).includes(S.name) ? 1e6 : 0) + polylineLength(t.points);
        if (!best || score > best.score) best = { t, y, score };
      });
      if (best) { mainHere = best.t; yD = best.y; }
    }
    const u = map.U(X);
    const p = M(X, yD ?? base(X));
    const ang = path.at(u).angle;
    const upHere = mains[1] && yAt(D.mains[1].pts, X) != null ? mains[1] : null;
    // 自路線の本線に直接つながるホーム線だけをこの駅の番線にする（他社線・並行線のホームは描くだけ）
    const own = D.tracks.map((d, k) => (d.stations || []).includes(S.name) && (!d.foreign || mainHere !== mains[0]) && trackOf[k] && trackOf[k] !== mainHere ? trackOf[k] : null).filter(Boolean);
    const stTracks = [mainHere.id, ...(upHere ? [upHere.id] : []), ...own.map(t => t.id)];
    const hasPlats = !!(ds.plats && ds.plats.length);
    const mp = ds.mainPlat || [];
    const noStop = hasPlats ? mains.filter((t, k) => !mp.includes(k) && (k === 0 ? mainHere === mains[0] : t === upHere)).map(t => t.id) : [];
    const loopSeam = L.ring && (i === 0 || i === st.length - 1) && st[0].name === st[st.length - 1].name;
    const half = loopSeam ? 0.5 : 1;
    const obj = O('station_mark', p.x, p.y, {
      label: S.name, trackId: mainHere.id, tracks: stTracks, rot: ang,
      population: Math.round((S.extra.pop ?? 20000) * half), jobs: Math.round((S.extra.jobs ?? 5000) * half),
      kindId: S.extra.kind || 'residential',
    });
    if (upHere) obj.upTrackId = upHere.id;
    if (noStop.length) obj.noStop = noStop;
    // 他線のホーム（この駅で分かれる路線が使う番線）
    const alt = D.tracks.map((d, k) => (d.stations || []).includes(S.name) && d.foreign && trackOf[k] ? trackOf[k].id : null).filter(Boolean);
    if (alt.length) obj.altTracks = alt;
    objects.push(obj);
    for (const b of ds.plats || []) {
      const c = M((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
      // ホームは図より少し短く細く（図では端の渡り線に接して描かれていることがある）
      const w = (b[2] - b[0]) * map.kx * 0.86, h = Math.max(4, (b[3] - b[1]) * KY * 0.7);
      objects.push(O('platform_island', c.x, c.y, { w, h, rot: path.at(map.U((b[0] + b[2]) / 2)).angle, _fit: true }));
    }
    // 列車の向きごとに止まれる番線（ホームに面した線）
    const stop = { down: [], up: [] };
    if (!noStop.includes(mainHere.id)) stop.down.push(mainHere.id);
    if (upHere && !noStop.includes(upHere.id)) stop.up.push(upHere.id);
    else if (!upHere && !noStop.includes(mainHere.id)) stop.up.push(mainHere.id);
    // 向きの決まった副本線を先に、上下共用の線をあとに
    for (const t of own.slice().sort((a, b) => (a.use ? 0 : 1) - (b.use ? 0 : 1))) {
      if (t.use !== 'up') stop.down.push(t.id);
      if (t.use !== 'down') stop.up.push(t.id);
    }
    if (!stationObjByName[S.name]) stationObjByName[S.name] = obj;
    entry.stations.push({ ...S, s: u, obj, p, loops: {}, shared: false, diag: { stop, X } });
  }

  if (pre.length) entry.stations.unshift(...prefixStations(L, pre, lines, objects, stationObjByName));

  // 駅間省略の記号：各駅間の分岐のない区間の中ほど、上下の本線それぞれに
  for (let i = 1; i < st.length; i++) {
    const [r, l] = map.seps[i - 1];
    // 駅間でいちばん線の本数が少ないところ（複線から単線になる駅間なら単線の側）の、なるべく中ほど
    const crossN = x => D.mains.concat(D.tracks).filter(d => { const xs = d.pts.map(q => q[0]); return Math.min(...xs) < x && Math.max(...xs) > x; }).length;
    // 接続先から入る最初の駅間は、接続の線が本線に合流したあと（駅間の先の方）に置く
    const aim = shared0 && i === 1 ? r + (l - r) * 0.85 : (r + l) / 2;
    let X = aim, bestN = crossN(X);
    for (let k = 1; k < 20; k++) {
      const x = r + (l - r) * k / 20, n = crossN(x);
      if (n < bestN || (n === bestN && Math.abs(x - aim) < Math.abs(X - aim))) { X = x; bestN = n; }
    }
    const objs = [];
    D.mains.forEach((m, k) => {
      const y = yAt(m.pts, X);
      if (y == null) return;
      const p = M(X, y);
      const g = O('gap_break', p.x, p.y, { rot: path.at(map.U(X)).angle, trackId: mains[k].id, extraM: 0 });
      objects.push(g); objs.push(g);
    });
    // 駅間を並んで走るほかの線（複々線・並行する別の線）にも同じ省略を
    D.tracks.forEach((d, k) => {
      const t = trackOf[k];
      if (!t) return;
      const xs = d.pts.map(q => q[0]);
      if (Math.min(...xs) > r - 1 || Math.max(...xs) < l + 1) return;
      const y = yAt(d.pts, X);
      if (y == null) return;
      const p = M(X, y);
      const g = O('gap_break', p.x, p.y, { rot: path.at(map.U(X)).angle, trackId: t.id, extraM: 0 });
      objects.push(g); objs.push(g);
    });
    if (process.env.DEBUG_GAP && !objs.length) console.log("GAP none", L.key, i, X, D.mains.map(m => [m.pts[0][0], m.pts[m.pts.length - 1][0]]));
    if (objs.length) gaps.push({ line: entry, i: i + pre.length, objs });
  }

  // 接続先の路線とつなぐ
  if (L.attach) linkAttach(L, entry, lines[L.attach.line], tracks);
  return entry;
}

/** 接続点（子路線の経路の始点）と向き */
function attachPoint(L, parent, ps) {
  const ex = junctionTargets(L, parent, ps);
  if (ex.length) {
    const hx = ex.reduce((a, e) => a + Math.cos(e.dir), 0), hy = ex.reduce((a, e) => a + Math.sin(e.dir), 0);
    const h = Math.atan2(hy, hx);
    const c = { x: ex.reduce((a, e) => a + e.p.x, 0) / ex.length, y: ex.reduce((a, e) => a + e.p.y, 0) / ex.length };
    return { p: { x: c.x + Math.cos(h) * 30, y: c.y + Math.sin(h) * 30 }, heading: h };
  }
  if (L.attach.mode === 'end') {
    const ends = parentEnds(parent, ps);
    if (ends.length) {
      const p = { x: ends.reduce((a, e) => a + e.p.x, 0) / ends.length, y: ends.reduce((a, e) => a + e.p.y, 0) / ends.length };
      return { p, heading: ends[0].heading };
    }
  }
  const off = L.attach.offset ?? 220;
  const q = parent.path.at(ps.s + off);
  return { p: { x: q.x, y: q.y }, heading: null };
}

/**
 * 親路線の配線図で、接続駅から子路線の方へ出ていく線の端（「〜方」の行先表示が子路線の駅名・路線名のもの）。
 * 行先表示が合うものが無ければ、接続駅の近くで外へ出ていく線のうち、ほかの子路線が使っていないもの。
 */
function junctionTargets(L, parent, ps) {
  const PD = parent.diagram;
  if (!PD || !ps || !ps.diag || L.attach.ownStation) return [];
  if (!parent._junction) parent._junction = new Map();
  const memo = parent._junction.get(L.key);
  if (memo) return memo;
  const X = ps.diag.X;
  const cands = [];
  PD.D.tracks.forEach((d, k) => {
    const t = PD.trackOf[k];
    if (!t) return;
    d.ends.forEach((e, w) => {
      if (e !== 'boundary') return;
      const q = d.pts[w === 0 ? 0 : d.pts.length - 1];
      const ext = (PD.D.stations[parent.stations.indexOf(ps)] || {}).ext || [X - 60, X + 60];
      const wide = L.attach.exit ? 400 : 100;
      if (q[0] < ext[0] - wide || q[0] > ext[1] + wide) return;
      const pts = t.points, i = w === 0 ? 0 : pts.length - 1, j = w === 0 ? 1 : pts.length - 2;
      const li = labelNearInfo(PD.D, q[0], q[1], 60);
      cands.push({ key: `${k}|${w}`, p: pts[i], dir: Math.atan2(pts[i].y - pts[j].y, pts[i].x - pts[j].x),
        track: t, which: w === 0 ? 'a' : 'b', lbl: li ? li.t.s.replace(/方$/, '') : '', lblT: li && li.t, lblD: li ? li.d : 0 });
    });
  });
  // 終点に続く路線なら、場外へ続く本線の端も出口（本線と並ぶ線が両方とも場外へ続くとき）
  if (L.attach.mode === 'end' && cands.length) {
    PD.D.mains.forEach((d, k) => {
      const t = (parent.mains || [parent.main])[k];
      if (!t || d.ends[1] !== 'boundary') return;
      const q = d.pts[d.pts.length - 1];
      const ext = (PD.D.stations[parent.stations.indexOf(ps)] || {}).ext || [X - 60, X + 60];
      if (q[0] < ext[0] - 100 || q[0] > ext[1] + 100) return;
      const pts = t.points, i = pts.length - 1;
      const li = labelNearInfo(PD.D, q[0], q[1], 60);
      cands.push({ key: `m${k}|1`, p: pts[i], dir: Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x),
        track: t, which: 'b', lbl: li ? li.t.s.replace(/方$/, '') : '', lblT: li && li.t, lblD: li ? li.d : 0 });
    });
  }
  // 1つの行先表示が近くの2組の出口に届くときは、表示にいちばん近い組（複線なら2本）だけをその行先にする
  {
    const byT = new Map();
    for (const c of cands) if (c.lblT) { if (!byT.has(c.lblT)) byT.set(c.lblT, []); byT.get(c.lblT).push(c); }
    for (const list of byT.values()) {
      if (list.length <= 2) continue;
      list.sort((a, b) => a.lblD - b.lblD);
      for (const c of list.slice(2)) { c.lbl = ''; c.weak = true; }
    }
  }
  const used = parent._usedExits || (parent._usedExits = new Set());
  // 行先表示に子路線の駅名があるものを先に、無ければ路線名のもの
  const stKeys = L.stations.slice((L.prefix || 0) + 1, (L.prefix || 0) + 4).map(s => s[0]);
  const lnKeys = L.name.split(/[・（）]/).map(w => w.replace(/線$/, '')).filter(w => w.length >= 2);
  // 行先表示の文字を指定してあればそれ（例：北総線の「新柴又方」）
  let out = L.attach.exit ? cands.filter(c => c.lbl && c.lbl.includes(L.attach.exit)) : [];
  if (!out.length) out = cands.filter(c => c.lbl && stKeys.some(kw => c.lbl.includes(kw)));
  // 直通（接続先の本線の終わりに続く）なら、行先の駅名が合う出口だけ。合わなければ本線の端につなぐ
  // 直通（接続先の本線の終わりに続く）なら路線名では選ばない（「西武有楽町線」と「有楽町線」のような取り違えを避ける）。
  // 行先表示のない出口があればそれ、なければ本線の端につなぐ
  if (!out.length && !L.attach.exit) {
    // 路線名で選ぶ。同じ駅で分かれるほかの路線の駅名が書かれた出口（「西武有楽町線 新桜台方」など）は除く
    const sib = new Set();
    for (const o of parent._siblings || []) if (o !== L && o.attach && o.attach.at === L.attach.at) for (const st of o.stations.slice(1, 4)) sib.add(st[0]);
    out = cands.filter(c => c.lbl && lnKeys.some(kw => c.lbl.includes(kw)) && ![...sib].some(n => c.lbl.includes(n)));
  }
  if (!out.length) {
    // 行先表示の無い出口：近い2本（本線の本数ぶん）
    const free = cands.filter(c => !c.lbl && !used.has(c.key));
    const want = (L.double === false || L.stations.length < 2) ? 1 : 2;
    free.sort((a, b) => Math.hypot(a.p.x - ps.p.x, a.p.y - ps.p.y) - Math.hypot(b.p.x - ps.p.x, b.p.y - ps.p.y));
    out = free.slice(0, Math.max(want, free.filter(c => Math.hypot(c.p.x - free[0].p.x, c.p.y - free[0].p.y) < 80).length));
    if (want === 2 && free.length > 2) {
      // 複線の出口は並んだ2本：いちばん近くに並ぶ組
      let best = null;
      for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
        const d = Math.hypot(free[i].p.x - free[j].p.x, free[i].p.y - free[j].p.y);
        if (!best || d < best.d) best = { d, pair: [free[i], free[j]] };
      }
      if (best && best.d < 120) out = best.pair;
    }
  }
  // 行先表示の合う出口が切り口より少なければ、そのすぐそばの表示のない出口も使う
  if (out.length && L._cuts && out.length < L._cuts) {
    const extra = cands.filter(c => !out.includes(c) && !used.has(c.key) && out.some(o => Math.hypot(o.p.x - c.p.x, o.p.y - c.p.y) < (c.lbl ? 120 : 80)))
      .sort((a, b) => Math.min(...out.map(o => Math.hypot(o.p.x - a.p.x, o.p.y - a.p.y))) - Math.min(...out.map(o => Math.hypot(o.p.x - b.p.x, o.p.y - b.p.y))));
    out = out.concat(extra.slice(0, L._cuts - out.length));
  }
  // 切り口より多ければ、接続先の本線に直接つながる出口を優先して切り口の数だけ
  if (L._cuts && out.length > L._cuts) {
    const onMain = c => {
      const pts = c.track.points, q = c.which === 'a' ? pts[pts.length - 1] : pts[0];
      return (parent.mains || [parent.main]).some(t => distToPolyline(q.x, q.y, t.points).d < 3);
    };
    out = out.slice().sort((a, b) => (onMain(b) ? 1 : 0) - (onMain(a) ? 1 : 0)).slice(0, L._cuts);
  }
  for (const c of out) used.add(c.key);
  parent._junction.set(L.key, out);
  if (typeof process !== 'undefined' && process.env && process.env.DEBUG_JUNCTION) {
    console.log(`[接続] ${L.name} ← ${parent.spec.name}/${L.attach.at}: 候補${cands.length} 採用${out.length}`, cands.map(c => `${c.lbl || "(無表示)"}${out.includes(c) ? "◎" : ""}@${Math.round(c.p.x)},${Math.round(c.p.y)}`).join(" / "));
  }
  return out;
}

/** 親路線の本線の端（接続駅に近い側）と、外向きの向き */
function parentEnds(parent, ps) {
  const out = [];
  for (const t of parent.mains || [parent.main]) {
    const pts = t.points;
    const a = pts[0], b = pts[pts.length - 1];
    const da = Math.hypot(a.x - ps.p.x, a.y - ps.p.y), db = Math.hypot(b.x - ps.p.x, b.y - ps.p.y);
    if (da <= db) out.push({ t, which: 'a', p: a, heading: Math.atan2(a.y - pts[1].y, a.x - pts[1].x) });
    else out.push({ t, which: 'b', p: b, heading: Math.atan2(b.y - pts[pts.length - 2].y, b.x - pts[pts.length - 2].x) });
  }
  return out;
}

/**
 * 子路線の起点側の切り口（本線・切れている線）を、親路線の出口につなぐ。
 * 画像の継ぎ目と同じく、進む向きに対して左から順に組にする。
 */
function linkAttach(L, child, parent, tracks) {
  const ps = parent.stations.find(x => x.name === L.attach.at);
  const mains = child.mains || [child.main];
  // 子路線の切り口
  const src = mains.map(t => ({ t, which: 'a', p: t.points[0], main: true }));
  if (child.diagram) {
    const D = child.diagram.D;
    D.tracks.forEach((d, k) => {
      const t = child.diagram.trackOf[k];
      if (!t) return;
      d.ends.forEach((e, w) => {
        if (e !== 'boundary') return;
        const q = d.pts[w === 0 ? 0 : d.pts.length - 1];
        if (Math.abs(q[0] - D.x0) > 1.5) return;
        src.push({ t, which: w === 0 ? 'a' : 'b', p: w === 0 ? t.points[0] : t.points[t.points.length - 1], main: false });
      });
    });
  }
  const link = (s, p, setEnd) => {
    setEnd();
    s.t.ends[s.which] = 'open';
    if (Math.hypot(p.x - s.p.x, p.y - s.p.y) > 3) tracks.push(T(`${L.name} 連絡線`, s.main ? 'main' : 'other', [p, s.p], {}, { maxSpeedKmh: L.vmax ?? null }));
  };
  const targets = junctionTargets(L, parent, ps);
  if (targets.length) {
    const h = Math.atan2(targets.reduce((a, e) => a + Math.sin(e.dir), 0), targets.reduce((a, e) => a + Math.cos(e.dir), 0));
    const perp = p => -Math.sin(h) * p.x + Math.cos(h) * p.y;
    const T2 = targets.slice().sort((a, b) => perp(a.p) - perp(b.p));
    let S2 = src.slice().sort((a, b) => perp(a.p) - perp(b.p));
    if (T2.length > S2.length && S2.length) {
      // 出口の方が多ければ、並びの中で幅がいちばん狭いひと続きを使う
      let best = 0, bw = Infinity;
      for (let i = 0; i + S2.length <= T2.length; i++) {
        const w = perp(T2[i + S2.length - 1].p) - perp(T2[i].p);
        if (w < bw) { bw = w; best = i; }
      }
      T2.splice(0, T2.length, ...T2.slice(best, best + S2.length));
    }
    if (S2.length !== T2.length) {
      // 数が合わなければ本線を優先して近いものどうし
      S2 = src.filter(x => x.main);
      const used = new Set();
      for (const s of S2) {
        let best = null;
        T2.forEach((tg, k) => { if (!used.has(k)) { const d = Math.hypot(tg.p.x - s.p.x, tg.p.y - s.p.y); if (!best || d < best.d) best = { d, k, tg }; } });
        if (best) { used.add(best.k); link(s, best.tg.p, () => { best.tg.track.ends[best.tg.which] = 'open'; }); }
      }
      return;
    }
    S2.forEach((s, k) => { const tg = T2[k]; link(s, tg.p, () => { tg.track.ends[tg.which] = 'open'; }); });
    return;
  }
  if (L.attach.mode === 'end') {
    // 直通：親の終点で続くなら下り↔下り、親の起点で続くなら下り↔上り
    const ends = parentEnds(parent, ps);
    const atEnd = parent.stations.indexOf(ps) === parent.stations.length - 1;
    const order = ends.length === mains.length && mains.length === 2 ? (atEnd ? [0, 1] : [1, 0]) : null;
    src.filter(x => x.main).forEach((s, k) => {
      let e = order ? ends[order[k]] : null;
      if (!e) e = ends.slice().sort((a, b) => Math.hypot(a.p.x - s.p.x, a.p.y - s.p.y) - Math.hypot(b.p.x - s.p.x, b.p.y - s.p.y))[0];
      if (e) link(s, e.p, () => { e.t.ends[e.which] = 'open'; });
    });
    return;
  }
  // 出口が見つからなければ、親の本線の途中へ分岐でつなぐ
  for (const s of src.filter(x => x.main)) {
    let near = null;
    for (const t of parent.mains || [parent.main]) {
      const r = distToPolyline(s.p.x, s.p.y, t.points);
      if (!near || r.d < near.d) near = { d: r.d, t, at: r.at };
    }
    if (near) {
      const q = pointAt(near.t.points, Math.max(10, Math.min(polylineLength(near.t.points) - 10, near.at)));
      link(s, { x: q.x, y: q.y }, () => {});
    }
  }
}

/** 配線略図に描かれた車両基地（基地名の文字の近くの留置線）を使う */
function diagramDepot(E, dp, objects) {
  const { D, trackOf, M, map } = E.diagram;
  // 車両基地の名前で探す（「住ノ江検車区羽倉崎検車支区」のような所属つきの名前もある）
  const bare = t => t.replace(/^.*?(鉄道|電鉄|地下鉄|交通局|JR東海|JR西日本|JR東日本|JR九州|JR北海道)/, '');
  const stem = dp.name.replace(/(総合車両所|総合車両センター|新幹線車両センター|車両センター|車両基地|車両管区|検車区|検修区|車庫|支所|機関区|工場|車両所)$/, '');
  const score = t => {
    const b = bare(t.s);
    if (b === dp.name) return 4;
    if (b.endsWith(dp.name)) return 3;
    if (b.includes(dp.name)) return 2;
    if (stem && stem.length >= 2 && b.includes(stem)) return 1 + (/検車|車庫|車両/.test(b.slice(b.indexOf(stem))) ? 0.2 : 0);
    return 0;
  };
  let lbl = null, box = null;
  for (const t of D.depots || []) { const v = score(t); if (v > 0 && (!lbl || v > lbl.v)) lbl = { ...t, v }; }
  if (lbl) box = [lbl.x - 220, lbl.y - 140, lbl.x1 + 260, lbl.y + 140];
  else {
    // 名前がなければ、基地のある駅の近くの、線路が中を通る建屋（車庫）のまわり
    const i = E.stations.findIndex(x => x.name === dp.at);
    const ds = D.stations[i];
    if (!ds || ds.x == null) return null;
    const [e0, e1] = ds.ext || [ds.x - 30, ds.x + 30];
    const sheds = (D.bldgs || []).filter(b => b[2] - b[0] > 8 && b[2] >= e0 - 200 && b[0] <= e1 + 200 &&
      D.tracks.some(d => d.pts.some(p => p[0] > b[0] && p[0] < b[2] + 2 && p[1] > b[1] - 2 && p[1] < b[3] + 2)));
    if (!sheds.length) return null;
    box = [Math.min(...sheds.map(b => b[0])) - 160, Math.min(...sheds.map(b => b[1])) - 60, Math.max(...sheds.map(b => b[2])) + 160, Math.max(...sheds.map(b => b[3])) + 60];
    lbl = { x: (box[0] + box[2]) / 2 - 20, x1: (box[0] + box[2]) / 2 + 20, y: (box[1] + box[3]) / 2 };
  }
  const [x0, y0, x1, y1] = box;
  const inBox = d => d.pts.some(p => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1);
  const stabling = [];
  let shop = null, k = 0;
  D.tracks.forEach((d, i) => {
    const t = trackOf[i];
    if (!t || t.kind === 'platform' || t.kind === 'siding' || !inBox(d)) return;
    if (d.ends.includes('boundary')) return;
    const lenU = d.pts.reduce((a, p, j) => j ? a + Math.hypot(p[0] - d.pts[j - 1][0], p[1] - d.pts[j - 1][1]) : 0, 0);
    // 車止めで終わる線か、両側がつながった長い線（通り抜けの留置線）
    if (lenU < 35 || (!d.ends.includes('buffer') && lenU < 60)) return;
    // 建屋の中を通る線は検修線
    const inside = (D.bldgs || []).some(b => (b[2] - b[0]) > 8 && d.pts.some((p, j) => {
      // 線分が建屋の中を通るか（端点だけでなく途中も見る）
      const q = d.pts[j - 1];
      if (!q) return false;
      for (let f = 0; f <= 1; f += 0.1) {
        const x = q[0] + (p[0] - q[0]) * f, y = q[1] + (p[1] - q[1]) * f;
        if (x >= b[0] && x <= b[2] && y >= b[1] - 2 && y <= b[3] + 2) return true;
      }
      return false;
    }));
    if (inside && !shop) { t.kind = 'inspection'; t.name = `${dp.name} 検修線`; shop = t; return; }
    t.kind = 'stabling'; t.name = `${dp.name} ${++k}番線`;
    stabling.push(t);
  });
  if (!stabling.length) return null;
  const c = M((lbl.x + lbl.x1) / 2, lbl.y);
  objects.push(O('admin_office', c.x, c.y, { label: dp.name, rot: E.path.at(map.U(lbl.x)).angle, w: 50, h: 22, _fit: true }));
  return { stabling, shop };
}
