// Canvas 2D レンダラ（ワールド単位 = メートル）

import { trackKind, objectDef, vehicleDef } from './catalog.js';
import { trackLength, trackCapacity, trackUsage, trackCarLength, formationsOn, formationLength, formationVehicles, formationCars, formationRangesOn } from './store.js';
import { pointAt, subPolyline, polylineLength } from './geom.js';
import { getGraph, endType, currentNodeRoute } from './topology.js';
import { signalAspects, signalDetails, ASPECT_COLORS } from './interlocking.js';

const FONT = '"Noto Sans JP","Hiragino Kaku Gothic ProN",Meiryo,system-ui,sans-serif';
const GAUGE = 1.435;      // 軌間[m]
const BALLAST_W = 4.2;    // 道床幅[m]
const CAR_W = 2.95;       // 車体幅[m]

/** 分岐器記号の画面上の大きさ（実寸ではなく結節点のマーク） */
export function turnoutSymbolSize(zoom) {
  const L = Math.max(15, Math.min(30, 17 * Math.sqrt(Math.max(0.05, zoom))));
  return { w: L, h: L * 0.42 };
}

/** ワールド→スクリーン */
export const toScreen = (cam, x, y) => ({ x: (x - cam.x) * cam.zoom, y: (y - cam.y) * cam.zoom });
export const toWorld = (cam, sx, sy) => ({ x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y });

const LAYER = {
  yard: 0, fence: 0, building: 0, shed: 0, roof: 0,
  platform: 2, pit: 2, deck: 2, washer: 2, machine: 2, gate: 2,
  turnout: 2, pointmachine: 2, signal: 3, marker: 3, buffer: 2,
  bridge: 3, label: 3, stairs: 3, station: 3, gapbreak: 3,
};
const layerOf = o => LAYER[objectDef(o.type).shape] ?? 0;

export function render(ctx, W, H, doc, ui) {
  const cam = ui.camera;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d1015';
  ctx.fillRect(0, 0, W, H);

  if (doc.settings.showGrid) drawGrid(ctx, W, H, cam, doc.settings.gridM);

  try {
    const g = getGraph(doc, ui.graphRev ?? 0);
    ui._aspects = signalAspects(doc, g, ui.graphRev ?? 0);
    ui._graph = g;
  } catch { ui._aspects = new Map(); ui._graph = null; }

  const objs = [...doc.objects];
  const below = objs.filter(o => layerOf(o) === 0);
  const above = objs.filter(o => layerOf(o) === 2);
  const top = objs.filter(o => layerOf(o) === 3);

  for (const o of below) drawObject(ctx, cam, doc, o, ui);
  for (const t of doc.tracks) drawTrack(ctx, cam, doc, t, ui);
  if (doc.settings.showRoutes !== false) drawSetRoutes(ctx, cam, doc);
  if (ui._graph && ui.sel && ui.sel.kind === 'object') drawSelectedBlock(ctx, cam, doc, ui);
  if (ui.route && ui.route.path) drawRoute(ctx, cam, doc, ui.route);
  for (const t of doc.tracks) drawTrackEnds(ctx, cam, doc, t);
  if (doc.settings.showJunctions && ui.graphRev !== false) drawJunctions(ctx, cam, doc, ui);
  if (doc.settings.showFormations) for (const t of doc.tracks) drawFormations(ctx, cam, doc, t, ui);
  for (const tr of (ui.simTrains || [])) drawMovingTrain(ctx, cam, doc, tr);
  for (const o of above) drawObject(ctx, cam, doc, o, ui);
  if (ui._graph) drawTurnoutPositions(ctx, cam, doc, ui._graph);
  if (doc.settings.showLabels) for (const t of doc.tracks) drawTrackLabel(ctx, cam, doc, t);
  for (const o of top) drawObject(ctx, cam, doc, o, ui);

  if (ui.issueMarks && ui.issueMarks.length && doc.settings.showIssues) drawIssueMarks(ctx, cam, ui.issueMarks);
  if (ui.hoverJunction) drawHoverJunction(ctx, cam, ui.hoverJunction);
  drawSelection(ctx, cam, doc, ui);
  if (ui.draft) drawDraft(ctx, cam, doc, ui);
  if (ui.tool === 'place' && ui.placeType && ui.cursor) drawGhost(ctx, cam, ui);
  if (doc.settings.showRuler) drawScaleBar(ctx, W, H, cam);

  ctx.restore();
}

/* ---------------- grid ---------------- */

function drawGrid(ctx, W, H, cam, gridM) {
  let step = gridM;
  while (step * cam.zoom < 7) step *= 2;          // 詰まりすぎたら間引く
  const major = step * (gridM === step ? 10 : 5);
  const x0 = Math.floor(cam.x / step) * step;
  const y0 = Math.floor(cam.y / step) * step;
  const x1 = cam.x + W / cam.zoom, y1 = cam.y + H / cam.zoom;

  ctx.lineWidth = 1;
  for (let x = x0; x <= x1; x += step) {
    const isMajor = Math.abs(x % major) < 1e-6;
    ctx.strokeStyle = isMajor ? '#222a38' : '#171c26';
    const sx = Math.round((x - cam.x) * cam.zoom) + .5;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
  }
  for (let y = y0; y <= y1; y += step) {
    const isMajor = Math.abs(y % major) < 1e-6;
    ctx.strokeStyle = isMajor ? '#222a38' : '#171c26';
    const sy = Math.round((y - cam.y) * cam.zoom) + .5;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
  }
}

/* ---------------- tracks ---------------- */

function screenPts(cam, pts) { return pts.map(p => toScreen(cam, p.x, p.y)); }

function strokePts(ctx, sp) {
  ctx.beginPath();
  ctx.moveTo(sp[0].x, sp[0].y);
  for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
  ctx.stroke();
}

function drawTrack(ctx, cam, doc, t, ui) {
  if (!t.points || t.points.length < 2) return;
  const sp = screenPts(cam, t.points);
  const kind = trackKind(t.kind);
  const z = cam.zoom;
  const selected = ui.sel && ui.sel.kind === 'track' && ui.sel.id === t.id;

  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // 道床
  ctx.strokeStyle = '#1b2029';
  ctx.lineWidth = Math.max(3, BALLAST_W * z);
  strokePts(ctx, sp);

  if (z > 0.55) {
    // まくらぎ
    ctx.strokeStyle = '#2a3140';
    ctx.lineWidth = Math.max(1, 0.5 * z);
    const step = 6;
    const total = polylineLength(t.points);
    for (let d = 2; d < total; d += step) {
      const p = pointAt(t.points, d);
      const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
      const a = toScreen(cam, p.x - nx * 1.4, p.y - ny * 1.4);
      const b = toScreen(cam, p.x + nx * 1.4, p.y + ny * 1.4);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // レール（左右2条）
    ctx.strokeStyle = kind.color;
    ctx.lineWidth = Math.max(1, 0.34 * z);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1], b = t.points[i];
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const ox = -Math.sin(ang) * (GAUGE / 2) * side, oy = Math.cos(ang) * (GAUGE / 2) * side;
        const s1 = toScreen(cam, a.x + ox, a.y + oy), s2 = toScreen(cam, b.x + ox, b.y + oy);
        ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y);
      }
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = kind.color;
    ctx.lineWidth = 2;
    strokePts(ctx, sp);
  }

  // 端部マーク（始端 A / 終端 B）
  if (z > 0.5) {
    ctx.fillStyle = kind.color;
    for (const p of [t.points[0], t.points[t.points.length - 1]]) {
      const s = toScreen(cam, p.x, p.y);
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(2, 0.8 * z), 0, Math.PI * 2); ctx.fill();
    }
  }

  if (selected) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = .85;
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = Math.max(2, BALLAST_W * z + 3);
    ctx.globalAlpha = .25;
    strokePts(ctx, sp);
    ctx.restore();
  }
}

function drawTrackLabel(ctx, cam, doc, t) {
  if (!t.points || t.points.length < 2 || cam.zoom < 0.3) return;
  const kind = trackKind(t.kind);
  const u = trackUsage(doc, t);
  const cap = kind.stabling ? `${u.cars}/${u.capacity}両` : `${Math.round(trackLength(t))}m`;
  const text = t.name;
  // 始端の少し手前に左詰めで表示（並行線でも重なりにくい）
  const s = toScreen(cam, t.points[0].x, t.points[0].y);
  ctx.save();
  ctx.font = `600 12px ${FONT}`;
  const w1 = ctx.measureText(text).width;
  ctx.font = `11px ${FONT}`;
  const w2 = ctx.measureText(cap).width;
  const pad = 6, gap = 6;
  const w = w1 + w2 + pad * 2 + gap, h = 18;
  const x = s.x + 4, y = s.y - h - Math.max(4, 2.6 * cam.zoom);
  ctx.fillStyle = 'rgba(14,18,26,.88)';
  ctx.strokeStyle = kind.color;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e6eaf3';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText(text, x + pad, y + h / 2 + .5);
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = u.over ? '#ff8b84' : '#9aa4bb';
  ctx.fillText(cap, x + pad + w1 + gap, y + h / 2 + .5);
  ctx.restore();
}

/* ---------------- formations ---------------- */

function drawFormations(ctx, cam, doc, t, ui) {
  const list = formationsOn(doc, t.id);
  if (!list.length || !t.points || t.points.length < 2) return;
  const total = polylineLength(t.points);
  const usable = Math.max(0, total - (doc.settings.clearanceM || 0));

  for (const range of formationRangesOn(doc, t.id)) {
    const f = range.formation;
    const len = range.end - range.start;
    const start = range.start, end = range.end;
    if (start >= total) break;
    const over = end > usable + 1e-6;
    const selected = ui.sel && ui.sel.kind === 'formation' && ui.sel.id === f.id;
    const vehicles = formationVehicles(doc, f);
    const unit = vehicles.length ? vehicles[0].len : 20;
    const detailed = unit * cam.zoom > 9;   // 1両ずつ描けるだけの拡大率か

    ctx.save();
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, CAR_W * cam.zoom);

    if (!detailed) {
      const seg = subPolyline(t.points, start, Math.min(end, total));
      if (seg.length >= 2) {
        ctx.globalAlpha = .92;
        ctx.strokeStyle = over ? '#ff5f56' : (f.color || '#4f8cff');
        strokePts(ctx, screenPts(cam, seg));
      }
    } else {
      let d = start;
      for (const v of vehicles) {
        const a = d, b = Math.min(d + v.len, total);
        d += v.len;
        if (a >= total) break;
        const seg = subPolyline(t.points, a + 0.35, Math.max(a + 0.7, b - 0.35));
        if (seg.length < 2) continue;
        ctx.globalAlpha = over ? .85 : .95;
        ctx.strokeStyle = over ? '#ff5f56' : v.color;
        strokePts(ctx, screenPts(cam, seg));
        if (cam.zoom > 1.6) drawVehicleMark(ctx, cam, t, v, a, Math.min(v.len, b - a));
      }
    }

    // 選択中の縁取り
    if (selected) {
      const seg = subPolyline(t.points, start, Math.min(end, total));
      if (seg.length >= 2) {
        ctx.globalAlpha = 1;
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.5, 0.5 * cam.zoom);
        strokePts(ctx, screenPts(cam, seg));
        ctx.setLineDash([]);
      }
    }

    // 編成名
    if (cam.zoom > 0.5 && len * cam.zoom > 46) {
      const mid = pointAt(t.points, (start + Math.min(end, total)) / 2);
      const s = toScreen(cam, mid.x, mid.y);
      let ang = mid.angle;
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      const label = `${f.name} ${formationCars(f)}両`;
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(s.x, s.y); ctx.rotate(ang);
      ctx.font = `600 ${Math.min(13, Math.max(9, CAR_W * cam.zoom * 0.5))}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

/** シミュレーション中の走行列車 */
function drawMovingTrain(ctx, cam, doc, train) {
  if (!train.pieces || !train.pieces.length) return;
  const byId = new Map(doc.tracks.map(t => [t.id, t]));
  ctx.save();
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  let head = null;
  for (const p of train.pieces) {
    const t = byId.get(p.trackId);
    if (!t) continue;
    const from = Math.min(p.from, p.to), to = Math.max(p.from, p.to);
    const pts = subPolyline(t.points, from, to);
    if (pts.length < 2) continue;
    const sp = screenPts(cam, pts);
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = Math.max(4, CAR_W * cam.zoom + 4);
    strokePts(ctx, sp);
    ctx.strokeStyle = train.color || '#4f8cff';
    ctx.lineWidth = Math.max(2, CAR_W * cam.zoom);
    strokePts(ctx, sp);
    head = { t, at: p.to };
  }
  if (head) {
    const p = pointAt(head.t.points, head.at);
    const s = toScreen(cam, p.x, p.y);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(3, 1.2 * cam.zoom), 0, Math.PI * 2); ctx.fill();
    if (cam.zoom > 0.35) {
      ctx.font = `600 12px ${FONT}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const label = `${train.name}`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,11,16,.85)';
      ctx.strokeText(label, s.x + 10, s.y - 10);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, s.x + 10, s.y - 10);
    }
  }
  ctx.restore();
}

/** 車両ごとの動力表現（パンタ・排気・煙突）と機関車の記号 */
function drawVehicleMark(ctx, cam, t, v, at, len) {
  const def = vehicleDef(v.type);
  const z = cam.zoom;
  const put = (frac, fn) => {
    const p = pointAt(t.points, at + len * frac);
    const s = toScreen(cam, p.x, p.y);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(p.angle);
    fn();
    ctx.restore();
  };
  ctx.globalAlpha = 1;
  if (def.power === 'electric') {            // パンタグラフ（横棒）
    const bar = CAR_W * z * .4;
    const marks = def.loco ? [0.25, 0.75] : [0.72];
    for (const m of marks) {
      put(m, () => {
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = Math.max(1, .3 * z);
        ctx.beginPath(); ctx.moveTo(0, -bar); ctx.lineTo(0, bar); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-Math.max(2, .8 * z), -bar * .5); ctx.lineTo(0, 0); ctx.lineTo(-Math.max(2, .8 * z), bar * .5);
        ctx.stroke();
      });
    }
  } else if (def.power === 'steam') {        // 煙突
    put(0.18, () => {
      ctx.fillStyle = '#12161f';
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, Math.max(2, .7 * z), 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    });
  } else if (def.power === 'diesel') {       // 排気
    put(0.25, () => {
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      const r = Math.max(1.5, .45 * z);
      ctx.fillRect(-r, -r, r * 2, r * 2);
    });
  }
  // 機関車の種別記号
  if (def.loco && len * z > 34) {
    put(0.5, () => {
      ctx.font = `700 ${Math.min(11, Math.max(8, CAR_W * z * .42))}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.strokeText(def.short, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText(def.short, 0, 0);
    });
  }
}

/* ---------------- objects ---------------- */

function drawObject(ctx, cam, doc, o, ui) {
  const def = objectDef(o.type);
  const s = toScreen(cam, o.x, o.y);
  const z = cam.zoom;
  let w = o.w * z, h = o.h * z;
  if (def.shape === 'turnout') {           // 分岐器はズームによらず一定サイズの記号
    const sz = turnoutSymbolSize(z);
    w = sz.w; h = sz.h;
  }
  if (s.x + Math.max(w, h) < -50 || s.y + Math.max(w, h) < -50) { /* 粗いカリング */ }
  const selected = ui.sel && ui.sel.kind === 'object' && ui.sel.id === o.id;

  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(o.rot || 0);
  const shape = def.shape || 'building';
  const color = def.color;
  const label = o.label || (def.shape === 'gapbreak'
    ? `≈ ${((o.extraM || 0) / 1000).toFixed(1)} km 省略`
    : def.name);

  ctx.save();
  if (o.mirror) ctx.scale(1, -1);
  switch (shape) {
    case 'building': case 'shed': {
      ctx.fillStyle = hexA(color, shape === 'shed' ? .3 : .38);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(5, w / 6)); ctx.fill(); ctx.stroke();
      if (shape === 'shed' && z > 0.4) { // 屋根の稜線
        ctx.strokeStyle = hexA(color, .55); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
      }
      break;
    }
    case 'yard': {
      ctx.fillStyle = hexA(color, .22);
      ctx.strokeStyle = hexA(color, .8); ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.setLineDash([]);
      break;
    }
    case 'fence': {
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, h);
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case 'platform': {
      ctx.fillStyle = hexA(color, .5);
      ctx.strokeStyle = '#cfd6e6'; ctx.lineWidth = 1;
      roundRect(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill(); ctx.stroke();
      // 点字ブロック（黄線）
      ctx.strokeStyle = '#ffcf4d'; ctx.lineWidth = Math.max(1, 0.6 * z);
      const inset = Math.min(h * .25, Math.max(2, 1.2 * z));
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 2, -h / 2 + inset); ctx.lineTo(w / 2 - 2, -h / 2 + inset);
      ctx.moveTo(-w / 2 + 2, h / 2 - inset); ctx.lineTo(w / 2 - 2, h / 2 - inset);
      ctx.stroke();
      break;
    }
    case 'roof': {
      ctx.fillStyle = hexA(color, .18);
      ctx.strokeStyle = hexA(color, .8); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.setLineDash([]);
      break;
    }
    case 'bridge': {
      ctx.fillStyle = hexA(color, .35);
      ctx.strokeStyle = '#dfe6f5'; ctx.lineWidth = 1.5;
      ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = hexA('#ffffff', .35); ctx.lineWidth = 1;
      const stepN = Math.max(2, Math.floor(h / 8));
      for (let i = 1; i < stepN; i++) {
        const y = -h / 2 + (h / stepN) * i;
        ctx.beginPath(); ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); ctx.stroke();
      }
      break;
    }
    case 'gate': {
      ctx.fillStyle = hexA(color, .35);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      roundRect(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      const lanes = Math.max(2, Math.round(o.w / 8));
      for (let i = 1; i < lanes; i++) {
        const x = -w / 2 + (w / lanes) * i;
        ctx.beginPath(); ctx.moveTo(x, -h / 2 + 2); ctx.lineTo(x, h / 2 - 2); ctx.stroke();
      }
      break;
    }
    case 'washer': {
      ctx.fillStyle = hexA(color, .3);
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      roundRect(ctx, -w / 2, -h / 2, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 1.2;
      for (const sgn of [-1, 1]) { // ブラシ表現
        ctx.beginPath(); ctx.arc(sgn * w * .22, 0, Math.min(h, w) * .22, 0, Math.PI * 2); ctx.stroke();
      }
      break;
    }
    case 'pit': case 'deck': {
      ctx.fillStyle = hexA(color, .22);
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
      ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.setLineDash([]);
      break;
    }
    case 'machine': {
      ctx.fillStyle = hexA(color, .35);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      roundRect(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.strokeStyle = hexA(color, .6); ctx.stroke();
      break;
    }
    case 'gapbreak': {
      const hh = Math.max(7, 3.2 * z);
      ctx.strokeStyle = '#0d1015';
      ctx.lineWidth = Math.max(5, 5.2 * z);
      ctx.beginPath(); ctx.moveTo(0, -hh); ctx.lineTo(0, hh); ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.6, .5 * z);
      for (const dx of [-Math.max(3, 1.4 * z), Math.max(3, 1.4 * z)]) {
        ctx.beginPath();
        ctx.moveTo(dx - hh * .35, -hh); ctx.lineTo(dx + hh * .35, 0); ctx.lineTo(dx - hh * .35, hh);
        ctx.stroke();
      }
      break;
    }
    case 'station': {
      const r = Math.max(5, 2.2 * z);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, .5 * z);
      ctx.beginPath(); ctx.moveTo(0, -r * 1.6); ctx.lineTo(0, r * 1.6); ctx.stroke();
      ctx.fillStyle = '#10141c';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(0, 0, r * .4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'stairs': {
      ctx.fillStyle = hexA(color, .3);
      ctx.strokeStyle = color; ctx.lineWidth = 1.4;
      ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h);
      // 踏面（登り方向 = ローカル +X）
      const steps = Math.max(3, Math.min(14, Math.round(o.w / 1.2)));
      ctx.lineWidth = 1;
      ctx.strokeStyle = hexA(color, .85);
      for (let i = 1; i < steps; i++) {
        const x = -w / 2 + (w / steps) * i;
        ctx.beginPath(); ctx.moveTo(x, -h / 2 + 1); ctx.lineTo(x, h / 2 - 1); ctx.stroke();
      }
      if (z > 0.8) {   // 上り方向の矢印
        ctx.strokeStyle = '#cfd6e6'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(w / 2 - Math.min(10, w * .3), 0); ctx.lineTo(w / 2 - 2, 0);
        ctx.moveTo(w / 2 - 6, -3); ctx.lineTo(w / 2 - 2, 0); ctx.lineTo(w / 2 - 6, 3);
        ctx.stroke();
      }
      break;
    }
    case 'turntable': {
      const r = Math.min(w, h) / 2;
      ctx.fillStyle = 'rgba(16,21,30,.92)';
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = hexA(color, .45); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, r * .88, 0, Math.PI * 2); ctx.stroke();
      // 桁の位置を示す目盛（15度ごと）
      if (z > 0.7) {
        ctx.strokeStyle = hexA(color, .35);
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r * .88, Math.sin(a) * r * .88);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          ctx.stroke();
        }
      }
      // 転車台桁（軌道）
      ctx.strokeStyle = '#2a3140'; ctx.lineWidth = Math.max(3, 4.2 * z);
      ctx.beginPath(); ctx.moveTo(-r * .95, 0); ctx.lineTo(r * .95, 0); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, .34 * z);
      for (const side of [-1, 1]) {
        const off = side * (1.435 / 2) * z;
        ctx.beginPath(); ctx.moveTo(-r * .95, off); ctx.lineTo(r * .95, off); ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(0, 0, Math.max(2, 1.2 * z), 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'traverser': {
      ctx.fillStyle = hexA(color, .18);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = '#2a3140'; ctx.lineWidth = Math.max(3, 4.2 * z);
      ctx.beginPath(); ctx.moveTo(-w / 2 + 2, 0); ctx.lineTo(w / 2 - 2, 0); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(-w / 2, h / 2);
      ctx.moveTo(w / 2, -h / 2); ctx.lineTo(w / 2, h / 2);
      ctx.stroke();
      break;
    }
    case 'roundhouse': {
      const r1 = Math.max(w, h) / 2, r0 = r1 * .2, span = Math.PI * 55 / 180;
      ctx.beginPath();
      ctx.arc(0, 0, r0, -span, span);
      ctx.arc(0, 0, r1, span, -span, true);
      ctx.closePath();
      ctx.fillStyle = hexA(color, .28);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.fill(); ctx.stroke();
      if (z > 0.4) {   // 庫の仕切り
        ctx.strokeStyle = hexA(color, .5); ctx.lineWidth = 1;
        for (let i = 1; i < 6; i++) {
          const a = -span + (span * 2 / 6) * i;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
          ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.stroke();
        }
      }
      break;
    }
    case 'turnout': {
      drawTurnout(ctx, w, h, color, def.variant, o.xang);
      break;
    }
    case 'pointmachine': {
      ctx.fillStyle = color; ctx.strokeStyle = '#0d1015'; ctx.lineWidth = 1;
      const r = Math.max(3, Math.min(w, h) / 2);
      ctx.beginPath(); ctx.rect(-r, -r, r * 2, r * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case 'signal': {
      drawSignal(ctx, z, def, (ui._aspects && ui._aspects.get(o.id)) || 'stop', o);
      break;
    }
    case 'marker': {
      const asp = (ui._aspects && ui._aspects.get(o.id)) || 'stop';
      ctx.fillStyle = ASPECT_COLORS[asp] || color; ctx.strokeStyle = '#0d1015'; ctx.lineWidth = 1;
      const r = Math.max(4, 2.5 * z);
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'buffer': {
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, 0.6 * z);
      const hh = Math.max(5, h / 2);
      ctx.beginPath(); ctx.moveTo(0, -hh); ctx.lineTo(0, hh); ctx.stroke();
      ctx.lineWidth = Math.max(1.5, 0.4 * z);
      ctx.beginPath(); ctx.moveTo(-Math.max(4, w / 2), 0); ctx.lineTo(0, 0); ctx.stroke();
      break;
    }
    case 'label': default: {
      break;
    }
  }
  ctx.restore();

  // ラベル（小さな記号類は既定名を表示しない）
  const minM = Math.min(o.w, o.h);
  const labelMin = shape === 'turnout' ? 18 : 26;     // 分岐器の番号は小さくても表示する
  const showText = (shape === 'label') || selected ||
    (shape === 'gapbreak' ? z > 0.2
      : o.label ? Math.max(w, h) > labelMin
        : (minM >= 10 && z > 0.35 && Math.min(w, h) > 12));
  if (showText && label) {
    let ang = 0;
    const rot = normRot(o.rot || 0);
    if (h > w * 1.6 && shape !== 'label') ang = -Math.PI / 2;      // 縦長は縦書き風に回転
    ctx.save();
    ctx.rotate(ang);
    if (Math.abs(normRot((o.rot || 0) + ang)) > Math.PI / 2 + 1e-6) ctx.rotate(Math.PI);
    const fs = shape === 'label' ? Math.max(11, o.h * z * .8)
      : (shape === 'turnout' || shape === 'gapbreak') ? 10.5
        : shape === 'station' ? Math.min(15, Math.max(11, 3 * z))
        : Math.min(14, Math.max(9, Math.min(w, h) * .45));
    const dy = shape === 'turnout' ? -(h / 2 + 7)
      : shape === 'station' ? -(Math.max(10, 4.5 * z))
        : shape === 'gapbreak' ? -(Math.max(12, 4.5 * z)) : 0;
    ctx.font = `600 ${fs}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,11,16,.8)';
    ctx.strokeText(label, 0, dy);
    ctx.fillStyle = shape === 'label' ? (o.color || '#e6eaf3') : '#eef2fa';
    ctx.fillText(label, 0, dy);
    ctx.restore();
  }

  if (selected) {
    ctx.strokeStyle = '#4f8cff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    const bw = Math.max(w, 10), bh = Math.max(h, 10);
    ctx.strokeRect(-bw / 2 - 3, -bh / 2 - 3, bw + 6, bh + 6);
    ctx.setLineDash([]);
    ctx.fillStyle = '#4f8cff';
    for (const [hx, hy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.fillRect(hx * (bw / 2 + 3) - 3, hy * (bh / 2 + 3) - 3, 6, 6);
    }
  }
  ctx.restore();
}

function turnoutPath(ctx, w, h, variant, xang) {
  const x0 = -w / 2, x1 = w / 2;
  ctx.beginPath();
  ctx.moveTo(x0, 0); ctx.lineTo(x1, 0);                      // 基準線
  if (variant === 'double') { ctx.moveTo(x0 + w * .15, 0); ctx.lineTo(x1, -h / 2); ctx.moveTo(x0 + w * .15, 0); ctx.lineTo(x1, h / 2); }
  else if (variant === 'three') { ctx.moveTo(x0 + w * .15, 0); ctx.lineTo(x1, -h / 2); ctx.moveTo(x0 + w * .15, 0); ctx.lineTo(x1, h / 2); }
  else if (variant === 'scissors') {
    ctx.moveTo(x0, -h / 2); ctx.lineTo(x1, h / 2);
    ctx.moveTo(x0, h / 2); ctx.lineTo(x1, -h / 2);
    ctx.moveTo(x0, -h / 2); ctx.lineTo(x1, -h / 2);
    ctx.moveTo(x0, h / 2); ctx.lineTo(x1, h / 2);
  } else if (variant === 'crossover') {
    ctx.moveTo(x0, -h / 2); ctx.lineTo(x1, -h / 2);
    ctx.moveTo(x0, h / 2); ctx.lineTo(x1, h / 2);
    ctx.moveTo(x0 + w * .15, -h / 2); ctx.lineTo(x1 - w * .15, h / 2);
  } else if (variant === 'diamond') {
    const a = Number.isFinite(xang) ? xang : Math.atan2(h, w);
    const L = Math.max(w, h) / 2;
    ctx.moveTo(x0, 0); ctx.lineTo(x1, 0);
    ctx.moveTo(-Math.cos(a) * L, -Math.sin(a) * L); ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L);
  } else { ctx.moveTo(x0 + w * .15, 0); ctx.lineTo(x1, -h / 2); }  // 片開き
}

function drawTurnout(ctx, w, h, color, variant, xang) {
  const lw = Math.max(1.8, Math.min(4, h * .35));
  ctx.lineCap = 'round';
  // 背景の縁取りで軌道上でも見えるように
  ctx.strokeStyle = 'rgba(8,11,16,.75)';
  ctx.lineWidth = lw + 2.5;
  turnoutPath(ctx, w, h, variant, xang);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  turnoutPath(ctx, w, h, variant, xang);
  ctx.stroke();
  // トングレール位置の目印
  if (variant === 'single' || variant === 'double' || variant === 'three') {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(-w / 2 + w * .15, 0, Math.max(1.6, lw * .8), 0, Math.PI * 2); ctx.fill();
  }
}

const ASPECT_LAMP = { stop: '#ff4b41', caution: '#ffc233', proceed: '#3ddc84', shunt: '#7fd1ff' };
/** 減速は黄＋緑の2灯を現示する */
const LIT_LAMPS = a => (a === 'reduced' ? ['caution', 'proceed'] : [a]);

function drawSignal(ctx, z, def, aspect, o) {
  const lamps = def.lamps || 3;
  const shunt = !!def.shunt;
  const r = Math.max(2.4, 1.1 * z);
  const poleH = Math.max(10, 5 * z);
  ctx.strokeStyle = '#9aa4bb'; ctx.lineWidth = Math.max(1, .35 * z);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, poleH); ctx.stroke();
  const bh = r * 2 * lamps + 3;
  ctx.fillStyle = '#10141c'; ctx.strokeStyle = '#3a4357'; ctx.lineWidth = 1;
  roundRect(ctx, -r - 1.5, -bh, r * 2 + 3, bh, 2); ctx.fill(); ctx.stroke();
  // 上から 停止/注意/進行（入換信号機は 停止/入換進行）
  const order = shunt ? ['stop', 'shunt'] : (lamps >= 4 ? ['stop', 'caution', 'proceed', 'shunt'] : ['stop', 'caution', 'proceed']);
  for (let i = 0; i < lamps; i++) {
    const kind = order[i % order.length];
    const lit = LIT_LAMPS(aspect).includes(kind);
    const cy = -bh + 2 + r + i * r * 2;
    ctx.fillStyle = lit ? ASPECT_LAMP[kind] : 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.arc(0, cy, r * .78, 0, Math.PI * 2); ctx.fill();
    if (lit) {
      ctx.strokeStyle = ASPECT_LAMP[kind];
      ctx.globalAlpha = .45; ctx.lineWidth = Math.max(1.5, r * .6);
      ctx.beginPath(); ctx.arc(0, cy, r * 1.15, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // 防護する進行方向
  const sgn = (o && o.dir === 'ba') ? -1 : 1;
  const a = Math.max(4, 2 * z);
  ctx.fillStyle = 'rgba(214,222,238,.8)';
  ctx.beginPath();
  ctx.moveTo(sgn * a * 1.5, poleH); ctx.lineTo(sgn * a * .4, poleH - a * .45); ctx.lineTo(sgn * a * .4, poleH + a * .45);
  ctx.closePath(); ctx.fill();
}

/* ---------------- ends / junctions / route ---------------- */

/** 端点の記号（車止め・場外接続・開放） */
function drawTrackEnds(ctx, cam, doc, t) {
  if (!t.points || t.points.length < 2) return;
  const z = cam.zoom;
  const total = polylineLength(t.points);
  const ends = [
    { p: t.points[0], ang: pointAt(t.points, 0).angle + Math.PI, type: endType(t, 'a') },
    { p: t.points[t.points.length - 1], ang: pointAt(t.points, total).angle, type: endType(t, 'b') },
  ];
  for (const e of ends) {
    const s = toScreen(cam, e.p.x, e.p.y);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(e.ang);
    if (e.type === 'buffer') {
      const bar = Math.max(5, 2.6 * z);          // 車止め: 直角の梁＋斜材
      ctx.strokeStyle = '#ff7a6b';
      ctx.lineWidth = Math.max(2, 0.6 * z);
      ctx.beginPath(); ctx.moveTo(0, -bar); ctx.lineTo(0, bar); ctx.stroke();
      ctx.lineWidth = Math.max(1, 0.35 * z);
      ctx.beginPath();
      ctx.moveTo(-bar * 0.9, -bar * .7); ctx.lineTo(0, 0); ctx.lineTo(-bar * 0.9, bar * .7);
      ctx.stroke();
    } else if (e.type === 'boundary') {
      const a = Math.max(6, 3 * z);              // 場外接続: 外向きの矢印
      ctx.strokeStyle = '#8fe06a';
      ctx.lineWidth = Math.max(1.5, 0.4 * z);
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(a * 1.6, 0); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(a * 1.6, 0); ctx.lineTo(a * 0.9, -a * .45); ctx.lineTo(a * 0.9, a * .45); ctx.closePath();
      ctx.fillStyle = '#8fe06a'; ctx.fill();
      if (z > 0.7) {
        ctx.rotate(Math.abs(normRot(e.ang)) > Math.PI / 2 ? Math.PI : 0);
        ctx.font = `10px ${FONT}`; ctx.fillStyle = '#8fe06a';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('場外', 0, -a * .7);
      }
    } else if (z > 0.45) {
      ctx.strokeStyle = '#6c7788';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, Math.max(2.5, 1 * z), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}

/** 線路どうしの接続点 */
function drawJunctions(ctx, cam, doc, ui) {
  if (cam.zoom < 0.3) return;
  let g;
  try { g = getGraph(doc, ui.graphRev ?? 0); } catch { return; }
  ctx.save();
  for (const n of g.nodes) {
    const tracks = new Set(n.edges.map(eid => g.edgeById.get(eid).trackId));
    if (tracks.size < 2) continue;
    const s = toScreen(cam, n.x, n.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(2.5, 1.1 * cam.zoom), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14,18,26,.9)';
    ctx.fill();
    ctx.strokeStyle = '#7fd1ff';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.restore();
}

/** 検証した入換経路のハイライト */
function drawRoute(ctx, cam, doc, route) {
  const byId = new Map(doc.tracks.map(t => [t.id, t]));
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const seg of route.path) {
    const t = byId.get(seg.trackId);
    if (!t) continue;
    const from = Math.min(seg.fromAt, seg.toAt), to = Math.max(seg.fromAt, seg.toAt);
    const pts = subPolyline(t.points, from, to);
    if (pts.length < 2) continue;
    const sp = pts.map(p => toScreen(cam, p.x, p.y));
    ctx.strokeStyle = 'rgba(127,209,255,.28)';
    ctx.lineWidth = Math.max(8, 9 * cam.zoom);
    strokePts(ctx, sp);
    ctx.strokeStyle = '#7fd1ff';
    ctx.lineWidth = Math.max(2, 1.2 * cam.zoom);
    ctx.setLineDash([Math.max(8, 6 * cam.zoom), Math.max(5, 4 * cam.zoom)]);
    strokePts(ctx, sp);
    ctx.setLineDash([]);
  }
  // 折返し地点
  for (const r of route.reversePoints || []) {
    const t = byId.get(r.trackId);
    if (!t) continue;
    const p = pointAt(t.points, r.at);
    const s = toScreen(cam, p.x, p.y);
    ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(5, 2 * cam.zoom), 0, Math.PI * 2);
    ctx.fillStyle = '#ffd166'; ctx.fill();
    ctx.strokeStyle = '#0d1015'; ctx.lineWidth = 1.5; ctx.stroke();
    if (cam.zoom > 0.5) {
      ctx.font = `600 11px ${FONT}`; ctx.fillStyle = '#ffd166';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('折返し', s.x, s.y - 8);
    }
  }
  ctx.restore();
}

/** クリックで分岐器を置ける接続点のハイライト */
function drawHoverJunction(ctx, cam, hj) {
  const s = toScreen(cam, hj.x, hj.y);
  const r = Math.max(10, 6 * cam.zoom);
  ctx.save();
  ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,224,138,.18)';
  ctx.fill();
  ctx.strokeStyle = hj.exists ? '#7fd1ff' : '#ffe08a';
  ctx.lineWidth = 2;
  ctx.setLineDash(hj.exists ? [] : [4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!hj.exists) {
    ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x - r * .45, s.y); ctx.lineTo(s.x + r * .45, s.y);
    ctx.moveTo(s.x, s.y - r * .45); ctx.lineTo(s.x, s.y + r * .45);
    ctx.stroke();
  }
  ctx.restore();
}

/** 分岐器の開通方向（いま開通している側を明るく描く） */
function drawTurnoutPositions(ctx, cam, doc, g) {
  const L = turnoutSymbolSize(cam.zoom).w * 0.75;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const n of g.nodes) {
    if (!n.turnout) continue;
    const cur = currentNodeRoute(doc, g, n.id);
    if (!cur || !cur.route) continue;
    const s = toScreen(cam, n.x, n.y);
    const legs = [cur.route.a, cur.route.b].map(eid => g.headingOut(g.edgeById.get(eid), n.id));
    const pts = [
      { x: s.x + Math.cos(legs[0]) * L, y: s.y + Math.sin(legs[0]) * L },
      { x: s.x, y: s.y },
      { x: s.x + Math.cos(legs[1]) * L, y: s.y + Math.sin(legs[1]) * L },
    ];
    ctx.strokeStyle = 'rgba(8,11,16,.85)';
    ctx.lineWidth = 5;
    strokePts(ctx, pts);
    ctx.strokeStyle = cur.fixed ? '#ffc04d' : (cur.index === 0 ? '#8fe06a' : '#ffd166');
    ctx.lineWidth = 2.4;
    strokePts(ctx, pts);
  }
  ctx.restore();
}

/** 選択中の信号機の閉塞区間 */
function drawSelectedBlock(ctx, cam, doc, ui) {
  const o = doc.objects.find(x => x.id === ui.sel.id);
  if (!o || !objectDef(o.type).signal || !o.trackId) return;
  let det;
  try { det = signalDetails(doc, ui._graph, ui.graphRev ?? 0).get(o.id); } catch { return; }
  if (!det || !det.block) return;
  const byId = new Map(doc.tracks.map(t => [t.id, t]));
  const col = ASPECT_COLORS[det.aspect] || '#7fd1ff';
  ctx.save();
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  for (const seg of det.block.segments) {
    const t = byId.get(seg.trackId);
    if (!t) continue;
    const from = Math.min(seg.from, seg.to), to = Math.max(seg.from, seg.to);
    const pts = subPolyline(t.points, from, to);
    if (pts.length < 2) continue;
    ctx.strokeStyle = hexA(col, .3);
    ctx.lineWidth = Math.max(10, 11 * cam.zoom);
    strokePts(ctx, screenPts(cam, pts));
  }
  ctx.restore();
}

/** 構成済みの進路 */
function drawSetRoutes(ctx, cam, doc) {
  const byId = new Map(doc.tracks.map(t => [t.id, t]));
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const r of doc.routes || []) {
    if (!r.set) continue;
    for (const seg of r.path) {
      const t = byId.get(seg.trackId);
      if (!t) continue;
      const from = Math.min(seg.fromAt, seg.toAt), to = Math.max(seg.fromAt, seg.toAt);
      const pts = subPolyline(t.points, from, to);
      if (pts.length < 2) continue;
      ctx.strokeStyle = 'rgba(61,220,132,.22)';
      ctx.lineWidth = Math.max(6, 7 * cam.zoom);
      strokePts(ctx, screenPts(cam, pts));
    }
  }
  ctx.restore();
}

/** 検証で見つかった不具合の位置 */
function drawIssueMarks(ctx, cam, marks) {
  ctx.save();
  for (const m of marks) {
    const s = toScreen(cam, m.x, m.y);
    const r = Math.max(7, 4 * cam.zoom);
    const col = m.level === 'error' ? '#ff5f56' : '#ffb020';
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(s.x, s.y, r * .35, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
  }
  ctx.restore();
}

/* ---------------- overlays ---------------- */

function drawSelection(ctx, cam, doc, ui) {
  const sel = ui.sel;
  if (!sel || sel.kind !== 'track') return;
  const t = doc.tracks.find(x => x.id === sel.id);
  if (!t) return;
  ctx.save();
  for (let i = 0; i < t.points.length; i++) {
    const s = toScreen(cam, t.points[i].x, t.points[i].y);
    ctx.fillStyle = i === 0 ? '#2bd4a4' : (i === t.points.length - 1 ? '#ff8fd0' : '#ffffff');
    ctx.strokeStyle = '#0d1015'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function drawDraft(ctx, cam, doc, ui) {
  const pts = ui.cursor ? [...ui.draft, ui.cursor] : ui.draft;
  if (pts.length < 1) return;
  const kind = trackKind(ui.trackKindId);
  const sp = screenPts(cam, pts);
  ctx.save();
  ctx.strokeStyle = kind.color; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
  if (sp.length > 1) strokePts(ctx, sp);
  ctx.setLineDash([]);
  ctx.fillStyle = kind.color;
  for (const s of sp) { ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill(); }
  const len = polylineLength(pts);
  if (len > 0) {
    const last = sp[sp.length - 1];
    const cl = doc.settings.carLengthM;
    const cars = Math.max(0, Math.floor((len - doc.settings.clearanceM) / cl));
    const txt = `${len.toFixed(0)} m ／ 約${cars}両`;
    ctx.font = `12px ${FONT}`;
    const w = ctx.measureText(txt).width + 12;
    ctx.fillStyle = 'rgba(14,18,26,.9)'; ctx.strokeStyle = kind.color; ctx.lineWidth = 1;
    roundRect(ctx, last.x + 12, last.y - 26, w, 20, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e6eaf3'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, last.x + 18, last.y - 15.5);
  }
  ctx.restore();
}

function drawGhost(ctx, cam, ui) {
  const def = objectDef(ui.placeType);
  const s = toScreen(cam, ui.cursor.x, ui.cursor.y);
  ctx.save();
  ctx.globalAlpha = .6;
  ctx.translate(s.x, s.y);
  ctx.rotate(ui.placeRot || 0);
  const w = def.w * cam.zoom, h = def.h * cam.zoom;
  ctx.fillStyle = hexA(def.color, .3); ctx.strokeStyle = def.color; ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.fillRect(-w / 2, -h / 2, Math.max(w, 6), Math.max(h, 6));
  ctx.strokeRect(-w / 2, -h / 2, Math.max(w, 6), Math.max(h, 6));
  ctx.restore();
}

function drawScaleBar(ctx, W, H, cam) {
  const targetPx = 120;
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  let m = nice[nice.length - 1];
  for (const n of nice) if (n * cam.zoom >= targetPx * .6) { m = n; break; }
  const px = m * cam.zoom;
  const x = W - px - 24, y = H - 24;
  ctx.save();
  ctx.strokeStyle = '#9aa4bb'; ctx.fillStyle = '#9aa4bb'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5);
  ctx.stroke();
  ctx.font = `11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(`${m} m`, x + px / 2, y - 3);
  ctx.restore();
}

/* ---------------- helpers ---------------- */

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function hexA(hex, a) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function normRot(r) {
  let a = r % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * 図形全体のバウンディングボックス（全体表示・PNG出力用）
 * excludeKinds を渡すと、その種別の線路（例: 本線）を除いた範囲を返す
 */
export function contentBounds(doc, { excludeKinds = [] } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const t of doc.tracks) {
    if (excludeKinds.includes(t.kind)) continue;
    for (const p of t.points) add(p.x, p.y);
  }
  const inside = (x, y) => x >= x0 - 300 && x <= x1 + 300 && y >= y0 - 300 && y <= y1 + 300;
  const objs = doc.objects.filter(o => !excludeKinds.length || inside(o.x, o.y));
  for (const o of objs) {
    const r = Math.max(o.w, o.h) / 2;
    add(o.x - r, o.y - r); add(o.x + r, o.y + r);
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 400, y1: 300 };
  return { x0, y0, x1, y1 };
}
