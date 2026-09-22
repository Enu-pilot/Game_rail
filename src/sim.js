// 運転シミュレーション
//  - 手動計画モード：並べた「編成 → 行先」を順に実行
//  - ダイヤ運転モード：時計をダイヤの時刻に合わせ、発車時刻になった列車から順に走らせる
// いずれも区間ごとに進路を構成し、分岐器の転換・信号現示・進路の競合が連動する

import { store, emit, commit, snapshot, uid, setMessage, formationLength } from './store.js';
import { getGraph, findRoute } from './topology.js';
import { routeFromLeg, findConflicts } from './interlocking.js';
import { lineStations, computeSchedule, trainType, fmtHM, stationAt } from './timetable.js';
import { distToPolyline } from './geom.js';

export const sim = {
  running: false,
  mode: 'plan',            // plan | timetable
  clock: 5 * 3600,         // 時刻[秒]
  startClock: 5 * 3600,
  speed: 8,
  plan: [],                // 手動計画 [{id, formationId, toTrackId}]
  planCursor: 0,
  movements: [],           // 実行中の移動
  dispatched: {},          // 列車ID → 出発済み
  log: [],
  maxConcurrent: 6,
};

const fmtClock = t => {
  const s = ((t % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
export const simClockText = () => fmtClock(sim.clock);

function logLine(text, level = 'info') {
  sim.log.unshift({ t: sim.clock, time: fmtClock(sim.clock).slice(0, 5), text, level });
  if (sim.log.length > 80) sim.log.pop();
}

/* ---------------- 計画 ---------------- */

export function planAdd(formationId, toTrackId) {
  if (!formationId || !toTrackId) return;
  sim.plan.push({ id: uid('m'), formationId, toTrackId });
  emit('sim');
}
export function planRemove(id) { sim.plan = sim.plan.filter(m => m.id !== id); emit('sim'); }
export function planClear() { sim.plan = []; sim.planCursor = 0; emit('sim'); }

/* ---------------- 実行制御 ---------------- */

export function simStart() {
  if (sim.mode === 'plan' && !sim.plan.length) { setMessage('移動の計画がありません'); return; }
  if (!sim.movements.length && !sim.running) {
    snapshot();
    if (sim.mode === 'timetable') {
      sim.clock = sim.startClock;
      sim.dispatched = {};
      logLine(`ダイヤ運転を開始（${fmtHM(sim.clock)}）`);
    } else {
      sim.planCursor = 0;
      logLine('入換シミュレーションを開始しました');
    }
  }
  sim.running = true;
  emit('sim');
}

export function simPause() { sim.running = false; emit('sim'); }

export function simReset() {
  sim.running = false;
  for (const mv of sim.movements) { releaseRoute(mv); restoreTrain(mv); }
  sim.movements = [];
  sim.planCursor = 0;
  sim.dispatched = {};
  sim.clock = sim.startClock;
  store.ui.simTrains = [];
  commit('sim-reset');
  emit('sim');
}

export function setSimMode(mode) {
  simReset();
  sim.mode = mode;
  if (mode === 'timetable') {
    const trains = store.doc.trains || [];
    if (trains.length) sim.startClock = Math.min(...trains.map(t => t.departSec)) - 300;
    sim.clock = sim.startClock;
  }
  emit('sim');
}

function restoreTrain(mv) {
  if (!mv.formationId) return;
  const f = store.doc.formations.find(x => x.id === mv.formationId);
  if (f && !f.trackId) f.trackId = mv.fromTrackId || null;
}

function releaseRoute(mv) {
  if (!mv.routeId) return;
  store.doc.routes = (store.doc.routes || []).filter(r => r.id !== mv.routeId);
  mv.routeId = null;
}

/* ---------------- 移動の生成 ---------------- */

function createMovement({ formationId, fromTrackId, toTrackId, name, color, trainLength, trainId, fromAt, toAt, speedKmh }) {
  const doc = store.doc;
  const g = getGraph(doc, store.rev);

  // 同じ線路の中を移動する場合（本線上の駅間など）は、そのまま1区間として扱う
  if (fromTrackId === toTrackId && Number.isFinite(fromAt) && Number.isFinite(toAt)) {
    const t = doc.tracks.find(x => x.id === fromTrackId);
    const leg = {
      path: [{ trackId: fromTrackId, fromAt, toAt }],
      turnouts: [], originTrackId: fromTrackId,
      originDir: toAt >= fromAt ? 'ab' : 'ba',
      fromName: t ? t.name : '?', toName: t ? t.name : '?',
      length: Math.abs(toAt - fromAt),
    };
    if (leg.length < 1) { logLine(`${name}：発着位置が同じです`, 'warn'); return null; }
    if (formationId) {
      const f = doc.formations.find(x => x.id === formationId);
      if (f) f.trackId = null;
    }
    logLine(`${name}：${t ? t.name : ''} を ${leg.length.toFixed(0)}m 走行`);
    return {
      id: uid('mv'), formationId, fromTrackId, toTrackId, trainId,
      name, color: color || '#4f8cff', trainLength, speedKmh: speedKmh || null,
      legs: [leg], legIndex: 0, dist: 0, phase: 'lining', phaseT: 0, routeId: null,
      startedAt: sim.clock,
    };
  }

  const r = findRoute(doc, g, { fromTrackId, toTrackId, trainLength });
  if (!r.found) {
    logLine(`${name}：経路がありません（${trackName(fromTrackId)} → ${trackName(toTrackId)}）`, 'error');
    return null;
  }
  const mv = {
    id: uid('mv'), formationId, fromTrackId, toTrackId, trainId,
    name, color: color || '#4f8cff', trainLength, speedKmh: speedKmh || null,
    legs: (r.legs || []).map(lg => ({ ...lg, length: lg.path.reduce((s, p) => s + Math.abs(p.toAt - p.fromAt), 0) })).filter(l => l.length > 0.5),
    legIndex: 0, dist: 0, phase: 'lining', phaseT: 0, routeId: null,
    startedAt: sim.clock,
  };
  if (formationId) {
    const f = doc.formations.find(x => x.id === formationId);
    if (f) f.trackId = null;                    // 走行中は在線から外す
  }
  logLine(`${name}：${trackName(fromTrackId)} → ${trackName(toTrackId)}（${mv.legs.length}区間・${r.distance.toFixed(0)}m）`);
  return mv;
}

const trackName = id => (store.doc.tracks.find(t => t.id === id) || {}).name || '?';

function lineRouteFor(mv) {
  const doc = store.doc;
  const leg = mv.legs[mv.legIndex];
  if (!leg) return false;
  const route = routeFromLeg(doc, leg, { name: `${mv.name}: ${leg.fromName} → ${leg.toName}` });
  route.temp = true;
  const conflicts = findConflicts(doc, route);
  if (conflicts.length) {
    if (mv.phase !== 'waiting') logLine(`${mv.name}：進路待ち（${conflicts.map(c => c.route.name).join('・')}）`, 'warn');
    mv.phase = 'waiting';
    return false;
  }
  for (const t of route.turnouts) {
    const o = doc.objects.find(x => x.id === t.objectId);
    if (o) o.position = t.index;
  }
  doc.routes.push(route);
  mv.routeId = route.id;
  return true;
}

/* ---------------- ダイヤからの発車 ---------------- */

/** 駅の位置（指定の線路上での距離）。線路が違う場合は null */
function stationPos(doc, stations, idx, trackId) {
  const st = stations[idx];
  if (!st || !st.object || !trackId) return null;
  const t = doc.tracks.find(x => x.id === trackId);
  if (!t || !t.points || t.points.length < 2) return null;
  return distToPolyline(st.object.x, st.object.y, t.points).at;
}

function stationTrackFor(doc, train, stations, idx) {
  const st = stations[idx];
  if (!st) return null;
  const assigned = train.platforms && train.platforms[idx];
  if (assigned && doc.tracks.some(t => t.id === assigned)) return assigned;
  const o = st.object;
  if (o && o.tracks && o.tracks.length) return o.tracks[0];
  return st.trackId || null;
}

function dispatchTrain(train) {
  const doc = store.doc;
  const line = doc.lines.find(l => l.id === train.lineId);
  if (!line) return;
  let stations;
  try { stations = lineStations(doc, getGraph(doc, store.rev), line); } catch { return; }
  const fromTrackId = stationTrackFor(doc, train, stations, train.fromIdx);
  const toTrackId = (train.toDepot && train.depotTrackId)
    ? train.depotTrackId
    : stationTrackFor(doc, train, stations, train.toIdx);
  if (!fromTrackId || !toTrackId) {
    logLine(`${train.number}：発着番線が決まっていません`, 'error');
    return;
  }
  const tt = trainType(train.type);
  let formationId = train.formationId || null;
  let trainLength = (train.cars || 10) * doc.settings.carLengthM;
  if (!formationId) {
    const f = doc.formations.find(x => x.trackId === fromTrackId);
    if (f) formationId = f.id;
  }
  if (formationId) {
    const f = doc.formations.find(x => x.id === formationId);
    if (f) trainLength = formationLength(doc, f);
  }
  const mv = createMovement({
    formationId, fromTrackId, toTrackId, trainId: train.id,
    name: train.number || tt.name, color: train.color || tt.color, trainLength,
    speedKmh: train.speedKmh || tt.speed,
    fromAt: stationPos(doc, stations, train.fromIdx, fromTrackId),
    toAt: (train.toDepot && train.depotTrackId) ? null : stationPos(doc, stations, train.toIdx, toTrackId),
  });
  if (mv) sim.movements.push(mv);
}

/* ---------------- 時間を進める ---------------- */

export function simTick(dtReal) {
  if (!sim.running) return false;
  const doc = store.doc;
  const dt = Math.min(2, dtReal) * sim.speed;
  sim.clock += dt;

  const shuntMs = ((doc.settings.shuntSpeedKmh ?? 25) * 1000) / 3600;
  const liningSec = doc.settings.liningSeconds ?? 20;
  const reversalSec = (doc.settings.reversalMinutes ?? 2) * 60;

  // 発車判定
  if (sim.mode === 'timetable') {
    const due = (doc.trains || [])
      .filter(t => !sim.dispatched[t.id] && t.departSec <= sim.clock)
      .sort((a, b) => a.departSec - b.departSec);
    for (const t of due) {
      if (sim.movements.length >= sim.maxConcurrent) break;
      sim.dispatched[t.id] = true;
      dispatchTrain(t);
    }
  } else if (!sim.movements.length && sim.planCursor < sim.plan.length) {
    const m = sim.plan[sim.planCursor];
    const f = doc.formations.find(x => x.id === m.formationId);
    const to = doc.tracks.find(t => t.id === m.toTrackId);
    sim.planCursor++;
    if (!f || !to) logLine('編成または行先が見つかりません', 'error');
    else if (!f.trackId) logLine(`${f.name} は在線していません`, 'error');
    else if (f.trackId === to.id) logLine(`${f.name} はすでに ${to.name} にいます`);
    else {
      const mv = createMovement({
        formationId: f.id, fromTrackId: f.trackId, toTrackId: to.id,
        name: f.name, color: f.color, trainLength: formationLength(doc, f),
      });
      if (mv) sim.movements.push(mv);
    }
  }

  // 各列車を進める
  for (const mv of [...sim.movements]) {
    if (mv.phase === 'lining' || mv.phase === 'waiting') {
      if (!mv.routeId) {
        if (!lineRouteFor(mv)) continue;
        if (mv.phase === 'waiting') logLine(`${mv.name}：進路が開通しました`);
        mv.phase = 'lining'; mv.phaseT = 0;
      }
      mv.phaseT += dt;
      if (mv.phaseT >= liningSec) { mv.phase = 'running'; mv.phaseT = 0; }
    } else if (mv.phase === 'running') {
      const leg = mv.legs[mv.legIndex];
      if (!leg) { finishMovement(mv); continue; }
      mv.dist += (mv.speedKmh ? (mv.speedKmh * 1000) / 3600 : shuntMs) * dt;
      if (mv.dist >= leg.length) {
        mv.dist = leg.length;
        releaseRoute(mv);
        if (mv.legIndex < mv.legs.length - 1) {
          mv.phase = 'reversing'; mv.phaseT = 0;
          logLine(`${mv.name}：${leg.toName} で折返し`);
        } else {
          finishMovement(mv);
        }
      }
    } else if (mv.phase === 'reversing') {
      mv.phaseT += dt;
      if (mv.phaseT >= reversalSec) { mv.legIndex++; mv.dist = 0; mv.phase = 'lining'; mv.phaseT = 0; }
    }
  }

  // 完了判定
  if (sim.mode === 'plan' && !sim.movements.length && sim.planCursor >= sim.plan.length) {
    if (sim.running) { sim.running = false; logLine('すべての移動が完了しました', 'ok'); commit('sim-done'); }
  }
  if (sim.mode === 'timetable') {
    const remaining = (doc.trains || []).some(t => !sim.dispatched[t.id]);
    if (!remaining && !sim.movements.length && sim.running) {
      sim.running = false; logLine('ダイヤの全列車が運転を終えました', 'ok'); commit('sim-done');
    }
  }
  updateTrains();
  return true;
}

function finishMovement(mv) {
  const doc = store.doc;
  const f = mv.formationId ? doc.formations.find(x => x.id === mv.formationId) : null;
  const to = doc.tracks.find(t => t.id === mv.toTrackId);
  if (f && to) f.trackId = to.id;
  logLine(`${mv.name} が ${to ? to.name : '?'} に到着`, 'ok');
  releaseRoute(mv);
  sim.movements = sim.movements.filter(x => x.id !== mv.id);
  commit('sim-arrive');
}

/* ---------------- 描画用 ---------------- */

/** 経路（[{trackId,fromAt,toAt}]）の from〜to[m] を線路ごとの区間に切り出す */
export function pathSlice(path, from, to) {
  const out = [];
  let acc = 0;
  for (const p of path) {
    const len = Math.abs(p.toAt - p.fromAt);
    const s = acc, e = acc + len;
    acc = e;
    const a = Math.max(from, s), b = Math.min(to, e);
    if (b - a <= 1e-6) continue;
    const sign = p.toAt >= p.fromAt ? 1 : -1;
    out.push({ trackId: p.trackId, from: p.fromAt + sign * (a - s), to: p.fromAt + sign * (b - s) });
  }
  return out;
}

function updateTrains() {
  const out = [];
  for (const mv of sim.movements) {
    const leg = mv.legs[mv.legIndex];
    if (!leg) continue;
    const nose = mv.dist;
    const tail = Math.max(0, nose - mv.trainLength);
    out.push({
      id: mv.id, name: mv.name, color: mv.color,
      pieces: pathSlice(leg.path, tail, nose),
      phase: mv.phase,
    });
  }
  store.ui.simTrains = out;
}

export function simState() {
  const doc = store.doc;
  const pending = sim.mode === 'timetable'
    ? (doc.trains || []).filter(t => !sim.dispatched[t.id]).sort((a, b) => a.departSec - b.departSec)
    : sim.plan.slice(sim.planCursor);
  return {
    clock: fmtClock(sim.clock),
    running: sim.running,
    mode: sim.mode,
    movements: sim.movements.map(mv => {
      const leg = mv.legs[mv.legIndex];
      return {
        id: mv.id, name: mv.name, color: mv.color, phase: mv.phase,
        progress: leg && leg.length ? Math.min(1, mv.dist / leg.length) : 0,
        remain: leg ? Math.max(0, leg.length - mv.dist) : 0,
        leg: mv.legIndex + 1, legs: mv.legs.length,
        to: trackName(mv.toTrackId),
      };
    }),
    pending,
  };
}

export const PHASE_NAMES = {
  idle: '待機', lining: '進路構成中', waiting: '進路待ち', running: '走行中',
  reversing: '折返し中', done: '完了', error: 'エラー',
};
