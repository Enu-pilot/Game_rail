// ダイヤグラム（列車運行図表）の描画と操作：横軸=時刻、縦軸=キロ程

import { store, emit, snapshot, commit, setMessage } from './store.js';
import { getGraph } from './topology.js';
import {
  lineStations, computeSchedule, trainPolyline, trainType, fmtHM,
} from './timetable.js';
import { detectConflicts, sectionSingle, canPass } from './meets.js';
import { operatorOf, selfOperator } from './operators.js';

const FONT = '"Noto Sans JP","Hiragino Kaku Gothic ProN",Meiryo,system-ui,sans-serif';
const PAD = { left: 132, top: 30, right: 24, bottom: 26 };

export function defaultView() {
  return { t0: 5 * 3600, sec: 8, km0: 0, mScale: 0.06, lineId: null, selected: null };
}

export function initDiagram(canvas, stage) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, needs = true;
  let drag = null;
  const ui = store.ui;
  if (!ui.diagram) ui.diagram = defaultView();

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = stage.clientWidth; H = stage.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    needs = true;
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  const invalidate = () => { needs = true; };
  function frame() {
    if (needs && !canvas.classList.contains('hidden')) { draw(); needs = false; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- 座標変換 ---------- */
  const d = () => ui.diagram;
  const xOf = t => PAD.left + (t - d().t0) / d().sec;
  const tOf = x => d().t0 + (x - PAD.left) * d().sec;
  const yOf = km => PAD.top + (km - d().km0) * d().mScale;
  const kmOf = y => d().km0 + (y - PAD.top) / d().mScale;

  function currentLine() {
    const doc = store.doc;
    const id = d().lineId || (doc.lines[0] && doc.lines[0].id);
    return doc.lines.find(l => l.id === id) || null;
  }
  function stationsOf(line) {
    if (!line) return [];
    try { return lineStations(store.doc, getGraph(store.doc, store.rev), line); } catch { return []; }
  }
  const trainsOf = line => (line ? store.doc.trains.filter(t => t.lineId === line.id) : []);

  /* ---------- 描画 ---------- */
  function draw() {
    const doc = store.doc;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d1015';
    ctx.fillRect(0, 0, W, H);

    const line = currentLine();
    if (!line) {
      ctx.fillStyle = '#9aa4bb';
      ctx.font = `14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('路線がありません。右の「ダイヤ」タブで路線を作り、駅を追加してください。', W / 2, H / 2);
      return;
    }
    const stations = stationsOf(line);
    const trains = trainsOf(line);

    // 時刻の目盛
    const steps = [60, 300, 600, 900, 1800, 3600, 7200, 10800];
    let step = steps[steps.length - 1];
    for (const s of steps) if (s / d().sec >= 52) { step = s; break; }
    const t1 = tOf(W - PAD.right);
    ctx.font = `11px ${FONT}`;
    ctx.textBaseline = 'middle';
    for (let t = Math.floor(d().t0 / step) * step; t <= t1; t += step) {
      const x = xOf(t);
      if (x < PAD.left - 1) continue;
      const major = t % 3600 === 0;
      ctx.strokeStyle = major ? '#2c3344' : '#1a202b';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, PAD.top); ctx.lineTo(Math.round(x) + .5, H - PAD.bottom); ctx.stroke();
      if (major || step < 3600) {
        ctx.fillStyle = major ? '#c7d0e2' : '#7f8aa3';
        ctx.textAlign = 'center';
        ctx.fillText(fmtHM(t), x, PAD.top - 14);
      }
    }

    // 単線区間の帯
    for (let i = 0; i < stations.length - 1; i++) {
      if (!sectionSingle(line, i)) continue;
      const y1 = yOf(stations[i].km), y2 = yOf(stations[i + 1].km);
      const top = Math.min(y1, y2), bot = Math.max(y1, y2);
      if (bot < PAD.top || top > H - PAD.bottom) continue;
      ctx.fillStyle = 'rgba(255,176,32,.07)';
      ctx.fillRect(PAD.left, Math.max(PAD.top, top), W - PAD.left - PAD.right,
        Math.min(H - PAD.bottom, bot) - Math.max(PAD.top, top));
      ctx.fillStyle = 'rgba(255,176,32,.55)';
      ctx.font = `10px ${FONT}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('単線', PAD.left + 6, (Math.max(PAD.top, top) + Math.min(H - PAD.bottom, bot)) / 2);
    }

    // 駅（横線）
    ctx.textAlign = 'right';
    for (const st of stations) {
      const y = yOf(st.km);
      if (y < PAD.top - 2 || y > H - PAD.bottom + 2) continue;
      ctx.strokeStyle = '#333c4e';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, Math.round(y) + .5); ctx.lineTo(W - PAD.right, Math.round(y) + .5); ctx.stroke();
      ctx.fillStyle = '#dfe6f5';
      ctx.font = `12px ${FONT}`;
      ctx.fillText(st.name, PAD.left - 10, y);
      ctx.fillStyle = '#6c7788';
      ctx.font = `10px ${FONT}`;
      ctx.fillText(`${(st.km / 1000).toFixed(2)} km`, PAD.left - 10, y + 12);
      if (canPass(doc, st)) {   // 行き違い・待避ができる駅
        ctx.fillStyle = '#8fe06a';
        ctx.beginPath(); ctx.arc(PAD.left - 4, y, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }

    // スジ
    for (const tr of trains) {
      const stops = computeSchedule(doc, stations, tr);
      const pts = trainPolyline(stops).map(p => ({ x: xOf(p.t), y: yOf(p.km) }));
      if (pts.length < 2) continue;
      const tt = trainType(tr.type);
      const sel = d().selected === tr.id;
      const selfId = (selfOperator(doc) || {}).id || null;
      const foreign = (tr.operatorId || selfId) !== selfId;
      const stroke = tr.color || (foreign ? operatorOf(doc, tr.operatorId).color : tt.color);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = sel ? 3.2 : 1.8;
      ctx.globalAlpha = sel ? 1 : .92;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      if (sel) {
        ctx.fillStyle = stroke;
        for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
      }
      // 待避・行き違いの待ち（停車が長い駅）に印をつける
      for (const st2 of stops) {
        if (!st2.hold || st2.arr == null || st2.dep == null) continue;
        const x1 = xOf(st2.arr), x2 = xOf(st2.dep), yy = yOf(st2.km);
        if (x2 < PAD.left || x1 > W - PAD.right) continue;
        ctx.strokeStyle = '#e6eaf3';
        ctx.lineWidth = sel ? 5 : 3.4;
        ctx.globalAlpha = .8;
        if (st2.oper) ctx.setLineDash([4, 3]);     // 運転停車（客扱いなし）は破線
        ctx.beginPath(); ctx.moveTo(Math.max(PAD.left, x1), yy); ctx.lineTo(Math.min(W - PAD.right, x2), yy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = sel ? 1 : .92;
        ctx.lineWidth = sel ? 3.2 : 1.8;
        ctx.strokeStyle = stroke;
      }

      // 直通する列車は終端の先に向かう矢印を出す
      if (tr.throughId) {
        const p1 = pts[pts.length - 1];
        ctx.fillStyle = stroke;
        ctx.globalAlpha = .9;
        const up = pts.length > 1 && pts[pts.length - 1].y < pts[pts.length - 2].y ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y + up * 2);
        ctx.lineTo(p1.x - 4, p1.y + up * 9);
        ctx.lineTo(p1.x + 4, p1.y + up * 9);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = sel ? 1 : .92;
      }

      // 列車番号
      const label = `${tr.number || tr.name || ''}`;
      if (label) {
        const p0 = pts[0];
        ctx.save();
        ctx.translate(p0.x, p0.y);
        ctx.font = `600 11px ${FONT}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,11,16,.85)';
        ctx.strokeText(label, 4, -3);
        ctx.fillStyle = stroke;
        ctx.fillText(label, 4, -3);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // 競合の表示
    const issues = detectConflicts(doc, line, stations, trains);
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    if (issues.length) {
      ctx.fillStyle = 'rgba(255,95,86,.9)';
      ctx.fillText(`⚠ ダイヤの支障 ${issues.length} 件（右の「行き違い・待避」で自動調整できます）`, PAD.left + 8, H - PAD.bottom + 6);
    } else {
      const held = trains.reduce((n, t) => n + (Object.values(t.holds || {}).some(v => +v > 0) ? 1 : 0), 0);
      ctx.fillStyle = 'rgba(143,224,106,.85)';
      ctx.fillText(held ? `✓ 支障なし（待避・行き違い ${held} 本）` : '✓ 支障なし', PAD.left + 8, H - PAD.bottom + 6);
    }

    // 枠
    ctx.strokeStyle = '#2c3344';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD.left + .5, PAD.top + .5, W - PAD.left - PAD.right, H - PAD.top - PAD.bottom);
  }

  /* ---------- 当たり判定 ---------- */
  function hitTrain(mx, my) {
    const line = currentLine();
    if (!line) return null;
    const stations = stationsOf(line);
    let best = null;
    for (const tr of trainsOf(line)) {
      const pts = trainPolyline(computeSchedule(store.doc, stations, tr)).map(p => ({ x: xOf(p.t), y: yOf(p.km) }));
      for (let i = 1; i < pts.length; i++) {
        const d2 = distToSeg(mx, my, pts[i - 1], pts[i]);
        if (d2 < 7 && (!best || d2 < best.d)) best = { train: tr, d: d2 };
      }
    }
    return best ? best.train : null;
  }
  function distToSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
  }

  /* ---------- 入力 ---------- */
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    const tr = hitTrain(p.x, p.y);
    if (tr && e.button === 0) {
      d().selected = tr.id;
      snapshot();
      drag = { type: 'train', train: tr, x0: p.x, dep0: tr.departSec, moved: false };
      emit('diagram');
      invalidate();
      return;
    }
    if (e.button === 0 && !tr) { d().selected = null; emit('diagram'); }
    drag = { type: 'pan', x0: p.x, y0: p.y, t0: d().t0, km0: d().km0 };
    invalidate();
  });

  canvas.addEventListener('pointermove', e => {
    const p = pos(e);
    if (!drag) {
      canvas.style.cursor = hitTrain(p.x, p.y) ? 'ew-resize' : 'grab';
      return;
    }
    if (drag.type === 'pan') {
      d().t0 = drag.t0 - (p.x - drag.x0) * d().sec;
      d().km0 = drag.km0 - (p.y - drag.y0) / d().mScale;
      invalidate();
    } else if (drag.type === 'train') {
      const dt = (p.x - drag.x0) * d().sec;
      const snap = e.altKey ? 1 : 60;
      drag.train.departSec = Math.max(0, Math.round((drag.dep0 + dt) / snap) * snap);
      drag.moved = true;
      invalidate();
      emit('diagram-drag');
    }
  });

  canvas.addEventListener('pointerup', () => {
    if (drag && drag.type === 'train') {
      if (drag.moved) { commit('train-time'); setMessage(`${drag.train.number || '列車'} の発時刻を ${fmtHM(drag.train.departSec)} に変更`); }
      else store._history.pop();
    }
    drag = null;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const p = pos(e);
    const f = Math.exp(e.deltaY * 0.0012);
    if (e.shiftKey) {                       // 縦（キロ程）の拡大縮小
      const kmAt = kmOf(p.y);
      d().mScale = Math.max(0.004, Math.min(2, d().mScale / f));
      d().km0 = kmAt - (p.y - PAD.top) / d().mScale;
    } else {                                // 横（時間）の拡大縮小
      const tAt = tOf(p.x);
      d().sec = Math.max(0.5, Math.min(120, d().sec * f));
      d().t0 = tAt - (p.x - PAD.left) * d().sec;
    }
    invalidate(); emit('diagram');
  }, { passive: false });

  /** 全体が入るように表示を合わせる */
  function fit() {
    const line = currentLine();
    if (!line) return;
    const stations = stationsOf(line);
    const trains = trainsOf(line);
    const maxKm = stations.length ? stations[stations.length - 1].km : 1000;
    d().km0 = -maxKm * 0.04;
    d().mScale = Math.max(0.004, (H - PAD.top - PAD.bottom) / Math.max(1, maxKm * 1.08));
    let t0 = 6 * 3600, t1 = 10 * 3600;
    if (trains.length) {
      const all = trains.flatMap(tr => computeSchedule(store.doc, stations, tr).flatMap(s => [s.arr, s.dep].filter(x => x != null)));
      if (all.length) { t0 = Math.min(...all); t1 = Math.max(...all); }
    }
    const span = Math.max(1800, (t1 - t0) * 1.15);
    d().sec = span / Math.max(100, W - PAD.left - PAD.right);
    d().t0 = t0 - span * 0.05;
    invalidate(); emit('diagram');
  }

  return { invalidate, fit, resize, hitTrain };
}
