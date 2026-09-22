// 入換シミュレーション：計画した移動を時間軸で実行し、進路構成・転てつ・信号現示を連動させる

import { store, emit, commit, snapshot, uid, setMessage, formationLength } from './store.js';
import { getGraph, findRoute } from './topology.js';
import { routeFromLeg, findConflicts } from './interlocking.js';

export const sim = {
  running: false,
  time: 0,              // シミュレーション内の経過秒
  speed: 8,             // 実時間に対する倍率
  plan: [],             // [{id, formationId, toTrackId}]
  cursor: 0,
  phase: 'idle',        // idle | lining | waiting | running | reversing | done | error
  phaseT: 0,
  legs: [], legIndex: 0, dist: 0,
  formationId: null, fromTrackId: null, toTrackId: null, trainLength: 0,
  routeId: null,
  log: [],
  train: null,          // 描画用 { formationId, pieces, color, name }
};

const fmtTime = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function logLine(text, level = 'info') {
  sim.log.unshift({ t: sim.time, text, level, time: fmtTime(sim.time) });
  if (sim.log.length > 60) sim.log.pop();
}

/* ---------------- 計画 ---------------- */

export function planAdd(formationId, toTrackId) {
  if (!formationId || !toTrackId) return;
  sim.plan.push({ id: uid('m'), formationId, toTrackId });
  emit('sim');
}
export function planRemove(id) {
  sim.plan = sim.plan.filter(m => m.id !== id);
  emit('sim');
}
export function planClear() {
  sim.plan = []; sim.cursor = 0; emit('sim');
}

/* ---------------- 実行制御 ---------------- */

export function simStart() {
  if (!sim.plan.length) { setMessage('移動の計画がありません'); return; }
  if (sim.phase === 'idle' || sim.phase === 'done' || sim.phase === 'error') {
    snapshot();                       // シミュレーション開始前の状態を履歴に残す
    sim.time = 0; sim.cursor = 0; sim.log = [];
    logLine('シミュレーションを開始しました');
    beginMove();
  }
  sim.running = true;
  emit('sim');
}

export function simPause() { sim.running = false; emit('sim'); }

export function simReset() {
  sim.running = false;
  releaseRoute();
  restoreTrain();
  sim.phase = 'idle'; sim.cursor = 0; sim.time = 0; sim.dist = 0;
  sim.legs = []; sim.train = null; sim.formationId = null;
  commit('sim-reset');
  emit('sim');
}

function restoreTrain() {
  if (!sim.formationId) return;
  const f = store.doc.formations.find(x => x.id === sim.formationId);
  if (f && !f.trackId) f.trackId = sim.fromTrackId || null;
}

function releaseRoute() {
  if (!sim.routeId) return;
  store.doc.routes = (store.doc.routes || []).filter(r => r.id !== sim.routeId);
  sim.routeId = null;
}

/* ---------------- 移動の開始 ---------------- */

function beginMove() {
  const doc = store.doc;
  const move = sim.plan[sim.cursor];
  if (!move) { sim.phase = 'done'; sim.running = false; logLine('すべての移動が完了しました', 'ok'); commit('sim'); return; }
  const f = doc.formations.find(x => x.id === move.formationId);
  const to = doc.tracks.find(t => t.id === move.toTrackId);
  if (!f || !to) { logLine('編成または行先が見つかりません', 'error'); sim.cursor++; beginMove(); return; }
  if (!f.trackId) { logLine(`${f.name} は在線していません`, 'error'); sim.cursor++; beginMove(); return; }
  if (f.trackId === to.id) { logLine(`${f.name} はすでに ${to.name} にいます`); sim.cursor++; beginMove(); return; }

  const g = getGraph(doc, store.rev);
  const trainLength = formationLength(doc, f);
  const r = findRoute(doc, g, { fromTrackId: f.trackId, toTrackId: to.id, trainLength });
  if (!r.found) {
    logLine(`${f.name}：${to.name} への経路がありません`, 'error');
    sim.cursor++; beginMove(); return;
  }
  sim.formationId = f.id;
  sim.fromTrackId = f.trackId;
  sim.toTrackId = to.id;
  sim.trainLength = trainLength;
  sim.legs = (r.legs || []).map(lg => ({
    ...lg,
    length: lg.path.reduce((s, p) => s + Math.abs(p.toAt - p.fromAt), 0),
  })).filter(lg => lg.length > 0.5);
  sim.legIndex = 0; sim.dist = 0;
  sim.phase = 'lining'; sim.phaseT = 0;
  f.trackId = null;                       // 走行中は在線から外す
  logLine(`${f.name}：${sim.fromTrackId ? (doc.tracks.find(t => t.id === sim.fromTrackId) || {}).name : ''} → ${to.name}（${r.legs.length}区間・${r.distance.toFixed(0)}m）`);
  commit('sim-begin');
}

/** いまの区間の進路を構成する。競合していれば false */
function lineRoute() {
  const doc = store.doc;
  const leg = sim.legs[sim.legIndex];
  if (!leg) return false;
  const route = routeFromLeg(doc, leg, { name: `入換: ${leg.fromName} → ${leg.toName}` });
  route.temp = true;
  const conflicts = findConflicts(doc, route);
  if (conflicts.length) {
    if (sim.phase !== 'waiting') logLine(`進路競合のため待機：${conflicts.map(c => c.route.name).join('・')}`, 'warn');
    sim.phase = 'waiting';
    return false;
  }
  for (const t of route.turnouts) {
    const o = doc.objects.find(x => x.id === t.objectId);
    if (o) o.position = t.index;
  }
  doc.routes.push(route);
  sim.routeId = route.id;
  logLine(`進路構成：${route.name}${route.turnouts.length ? `（転てつ ${route.turnouts.length}）` : ''}`);
  commit('sim-line');
  return true;
}

/* ---------------- 時間を進める ---------------- */

export function simTick(dtReal) {
  if (!sim.running) return false;
  const doc = store.doc;
  const dt = Math.min(2, dtReal) * sim.speed;
  sim.time += dt;

  const speedMs = ((doc.settings.shuntSpeedKmh ?? 25) * 1000) / 3600;
  const liningSec = doc.settings.liningSeconds ?? 20;
  const reversalSec = (doc.settings.reversalMinutes ?? 2) * 60;

  if (sim.phase === 'lining' || sim.phase === 'waiting') {
    if (!sim.routeId) {
      if (!lineRoute()) { updateTrain(); return true; }
      sim.phase = 'lining'; sim.phaseT = 0;
    }
    sim.phaseT += dt;
    if (sim.phaseT >= liningSec) { sim.phase = 'running'; sim.phaseT = 0; }
  } else if (sim.phase === 'running') {
    const leg = sim.legs[sim.legIndex];
    if (!leg) { sim.phase = 'done'; return true; }
    sim.dist += speedMs * dt;
    if (sim.dist >= leg.length) {
      sim.dist = leg.length;
      releaseRoute();
      if (sim.legIndex < sim.legs.length - 1) {
        sim.phase = 'reversing'; sim.phaseT = 0;
        logLine(`${leg.toName} で折返し`);
      } else {
        finishMove();
        return true;
      }
    }
  } else if (sim.phase === 'reversing') {
    sim.phaseT += dt;
    if (sim.phaseT >= reversalSec) {
      sim.legIndex++; sim.dist = 0;
      sim.phase = 'lining'; sim.phaseT = 0;
    }
  }
  updateTrain();
  return true;
}

function finishMove() {
  const doc = store.doc;
  const f = doc.formations.find(x => x.id === sim.formationId);
  const to = doc.tracks.find(t => t.id === sim.toTrackId);
  if (f && to) {
    f.trackId = to.id;
    logLine(`${f.name} が ${to.name} に到着`, 'ok');
  }
  releaseRoute();
  sim.train = null;
  sim.formationId = null;
  sim.cursor++;
  commit('sim-arrive');
  beginMove();
}

/* ---------------- 描画用の位置 ---------------- */

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
    out.push({
      trackId: p.trackId,
      from: p.fromAt + sign * (a - s),
      to: p.fromAt + sign * (b - s),
    });
  }
  return out;
}

function updateTrain() {
  const doc = store.doc;
  const leg = sim.legs[sim.legIndex];
  const f = doc.formations.find(x => x.id === sim.formationId);
  if (!leg || !f) { sim.train = null; return; }
  const nose = sim.dist;
  const tail = Math.max(0, nose - sim.trainLength);
  sim.train = {
    formationId: f.id,
    name: f.name,
    color: f.color,
    pieces: pathSlice(leg.path, tail, nose),
    nose: nose,
    phase: sim.phase,
  };
  store.ui.simTrain = sim.train;
}

export function simState() {
  const doc = store.doc;
  const move = sim.plan[sim.cursor];
  const f = move ? doc.formations.find(x => x.id === move.formationId) : null;
  const to = move ? doc.tracks.find(t => t.id === move.toTrackId) : null;
  const leg = sim.legs[sim.legIndex];
  return {
    time: fmtTime(sim.time),
    phase: sim.phase,
    running: sim.running,
    move: move ? { formation: f, to } : null,
    index: sim.cursor, total: sim.plan.length,
    legIndex: sim.legIndex, legs: sim.legs.length,
    progress: leg && leg.length ? Math.min(1, sim.dist / leg.length) : 0,
    remain: leg ? Math.max(0, leg.length - sim.dist) : 0,
  };
}

export const PHASE_NAMES = {
  idle: '待機', lining: '進路構成中', waiting: '進路待ち', running: '走行中',
  reversing: '折返し中', done: '完了', error: 'エラー',
};
