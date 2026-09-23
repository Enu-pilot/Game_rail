// キャンバスの入力処理（選択・移動・敷設・配置・パン/ズーム）

import { store, emit, snapshot, commit, setMessage, subscribe } from './store.js';
import { objectDef, trackKind } from './catalog.js';
import { render, toWorld, toScreen, contentBounds, turnoutSymbolSize } from './render.js';
import { snap, snapAngle, distToPolyline, hitRect, dist } from './geom.js';
import { addTrack, addObject, deleteSelected, snapToTrack, turnoutNear, placeTurnoutFromSpec, placeCrossingFrom } from './actions.js';
import { sim, simTick } from './sim.js';
import { getGraph, junctionNodes, turnoutSpecAt } from './topology.js';
import { crossingPoints } from './checks.js';

export function initCanvas(canvas, stage) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, needsRender = true;
  let drag = null;       // ドラッグ中の状態
  let spaceDown = false;

  const ui = store.ui;

  /* ---------- サイズ・描画ループ ---------- */
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = stage.clientWidth; H = stage.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    needsRender = true;
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  let lastFrame = 0, uiPulse = 0;
  function frame(now) {
    const dt = lastFrame ? Math.min(0.2, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (sim.running && simTick(dt)) {
      needsRender = true;
      uiPulse += dt;
      if (uiPulse > 0.25) { uiPulse = 0; emit('sim-tick'); }
    }
    if (needsRender) { ui.graphRev = store.rev; render(ctx, W, H, store.doc, ui); needsRender = false; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  const invalidate = () => { needsRender = true; };
  subscribe(invalidate);

  /* ---------- 座標変換とスナップ ---------- */
  const evtPos = e => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const world = e => { const p = evtPos(e); return toWorld(ui.camera, p.x, p.y); };
  function snapWorld(p, e) {
    if (!store.doc.settings.snap || (e && e.altKey)) return p;
    const g = store.doc.settings.gridM;
    return { x: snap(p.x, g), y: snap(p.y, g) };
  }
  const tolM = () => 9 / ui.camera.zoom;

  /* ---------- ヒットテスト ---------- */
  function hitVertex(p) {
    const sel = ui.sel;
    if (!sel || sel.kind !== 'track') return null;
    const t = store.doc.tracks.find(x => x.id === sel.id);
    if (!t) return null;
    const tol = tolM();
    for (let i = 0; i < t.points.length; i++) {
      if (dist(p.x, p.y, t.points[i].x, t.points[i].y) <= tol) return { track: t, index: i };
    }
    return null;
  }

  /** 線路が交わる点（接続点・未接続の交差点）の判定 */
  function hitJunction(p) {
    const tol = Math.max(4, 11 / ui.camera.zoom);
    let g;
    try { g = getGraph(store.doc, store.rev); } catch { return null; }
    let best = null;
    for (const n of junctionNodes(g)) {
      if (n.turntable) continue;              // 転車台は分岐器を置く対象外
      const d = dist(p.x, p.y, n.x, n.y);
      if (d <= tol && (!best || d < best.d)) best = { d, x: n.x, y: n.y, type: 'junction', nodeId: n.id };
    }
    for (const c of crossingPoints(store.doc, g, store.rev)) {
      const d = dist(p.x, p.y, c.x, c.y);
      if (d <= tol && (!best || d < best.d)) best = { d, x: c.x, y: c.y, type: 'crossing', cross: c };
    }
    if (!best) return null;
    best.exists = !!turnoutNear(best.x, best.y, Math.max(8, tol));
    return best;
  }

  /** 選択中オブジェクトのリサイズハンドル（画面座標で判定） */
  function hitHandle(e) {
    const sel = ui.sel;
    if (!sel || sel.kind !== 'object') return null;
    const o = store.doc.objects.find(x => x.id === sel.id);
    if (!o) return null;
    if (objectDef(o.type).shape === 'turnout') return null;   // 分岐器は記号なのでサイズ変更しない
    const z = ui.camera.zoom;
    const c = toScreen(ui.camera, o.x, o.y);
    const hw = Math.max(o.w * z, 10) / 2 + 3, hh = Math.max(o.h * z, 10) / 2 + 3;
    const sp = evtPos(e);
    const cos = Math.cos(o.rot || 0), sin = Math.sin(o.rot || 0);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = sx * hw, ly = sy * hh;
      const hx = c.x + lx * cos - ly * sin, hy = c.y + lx * sin + ly * cos;
      if (Math.hypot(sp.x - hx, sp.y - hy) <= 8) return { obj: o, sx, sy };
    }
    return null;
  }

  function hitObject(p) {
    const list = store.doc.objects;
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      const def = objectDef(o.type);
      let w = Math.max(o.w, 10 / ui.camera.zoom);
      let h = Math.max(o.h, 10 / ui.camera.zoom);
      if (def.shape === 'turnout') {          // 記号の見た目どおりに拾う
        const sz = turnoutSymbolSize(ui.camera.zoom);
        w = Math.max(sz.w, 14) / ui.camera.zoom;
        h = Math.max(sz.h, 12) / ui.camera.zoom;
      }
      if (hitRect(p.x, p.y, o.x, o.y, w, h, o.rot || 0)) return o;
      if (def.shape === 'signal' || def.shape === 'marker' || def.shape === 'pointmachine') {
        if (dist(p.x, p.y, o.x, o.y) < tolM()) return o;
      }
    }
    return null;
  }

  function hitTrack(p) {
    let best = null;
    const tol = Math.max(tolM(), 3);
    for (const t of store.doc.tracks) {
      if (!t.points || t.points.length < 2) continue;
      const r = distToPolyline(p.x, p.y, t.points);
      if (r.d <= tol && (!best || r.d < best.d)) best = { track: t, d: r.d, at: r.at };
    }
    return best;
  }

  /* ---------- ツール操作 ---------- */
  function setCursor() {
    let c = 'default';
    if (ui.tool === 'pan' || spaceDown || (drag && drag.type === 'pan')) c = 'grab';
    else if (ui.tool === 'track') c = 'crosshair';
    else if (ui.tool === 'place') c = 'copy';
    else if (drag && (drag.type === 'move' || drag.type === 'vertex' || drag.type === 'moveTrack')) c = 'grabbing';
    canvas.style.cursor = c;
  }

  function finishDraft(commitIt = true) {
    if (!ui.draft) return;
    const pts = ui.draft;
    ui.draft = null;
    if (commitIt && pts.length >= 2) addTrack(pts);
    else emit('draft');
    invalidate();
    updateHint();
  }

  /* ---------- ポインタイベント ---------- */
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const p = world(e);
    const sp = evtPos(e);
    ui.cursor = p;

    // 中ボタン / スペース / パンツール
    if (e.button === 1 || spaceDown || ui.tool === 'pan') {
      drag = { type: 'pan', sx: sp.x, sy: sp.y, cx: ui.camera.x, cy: ui.camera.y };
      setCursor();
      return;
    }
    if (e.button === 2) { // 右クリック: 敷設終了
      if (ui.draft) finishDraft(true);
      return;
    }
    if (e.button !== 0) return;

    if (ui.tool === 'track') {
      const sn = snapWorld(p, e);
      let pt = sn;
      if (ui.draft && ui.draft.length && store.doc.settings.angle45 && !e.shiftKey) {
        const prev = ui.draft[ui.draft.length - 1];
        const a = snapAngle(prev.x, prev.y, sn.x, sn.y);
        pt = snapWorld(a, e);
      }
      ui.draft = ui.draft || [];
      ui.draft.push(pt);
      emit('draft'); invalidate(); updateHint();
      return;
    }

    if (ui.tool === 'place' && ui.placeType) {
      // 交差部に置く装置（ダイヤモンド／スリップ）は、線路の交点に合わせて設置する
      if (objectDef(ui.placeType).crossing) {
        const j2 = hitJunction(p);
        if (j2 && j2.type === 'crossing') {
          placeCrossingFrom(j2.cross, ui.placeType);
          if (!e.shiftKey) { ui.tool = 'select'; ui.placeType = null; }
          emit('tool'); invalidate(); setCursor(); updateHint();
          return;
        }
        setMessage('斜めに交差している線路の交点をクリックしてください');
        return;
      }
      const sn = snapWorld(p, e);
      addObject(ui.placeType, sn.x, sn.y, ui.placeRot || 0);
      if (!e.shiftKey) { ui.tool = 'select'; ui.placeType = null; }
      emit('tool'); invalidate(); setCursor(); updateHint();
      return;
    }

    // select ツール
    const hh = hitHandle(e);
    if (hh) {
      snapshot();
      drag = { type: 'resize', obj: hh.obj, sx: hh.sx, sy: hh.sy, w0: hh.obj.w, h0: hh.obj.h, x0: hh.obj.x, y0: hh.obj.y, moved: false };
      canvas.style.cursor = 'nwse-resize';
      return;
    }
    // 線路の交点をクリック → 分岐器を設置（既にあれば通常の選択に任せる）
    const j = hitJunction(p);
    if (j && !j.exists) {
      if (j.type === 'crossing') placeCrossingFrom(j.cross);
      else {
        const g = getGraph(store.doc, store.rev);
        const spec = turnoutSpecAt(store.doc, g, j.nodeId);
        if (spec) placeTurnoutFromSpec(spec);
        else { setMessage('ここは分岐ではありません（線路どうしの継目です）'); }
      }
      ui.hoverJunction = null;
      invalidate();
      return;
    }
    const v = hitVertex(p);
    if (v) {
      snapshot();
      drag = { type: 'vertex', track: v.track, index: v.index, moved: false };
      setCursor(); return;
    }
    const o = hitObject(p);
    if (o) {
      ui.sel = { kind: 'object', id: o.id };
      snapshot();
      drag = { type: 'move', obj: o, ox: o.x, oy: o.y, px: p.x, py: p.y, moved: false };
      emit('select'); invalidate(); setCursor(); return;
    }
    const t = hitTrack(p);
    if (t) {
      ui.sel = { kind: 'track', id: t.track.id };
      snapshot();
      drag = { type: 'moveTrack', track: t.track, orig: t.track.points.map(q => ({ ...q })), px: p.x, py: p.y, moved: false };
      emit('select'); invalidate(); setCursor(); return;
    }
    // 空白: 選択解除してパン
    if (ui.sel) { ui.sel = null; emit('select'); }
    drag = { type: 'pan', sx: sp.x, sy: sp.y, cx: ui.camera.x, cy: ui.camera.y };
    invalidate(); setCursor();
  });

  canvas.addEventListener('pointermove', e => {
    const p = world(e);
    const sp = evtPos(e);

    if (drag) {
      if (drag.type === 'pan') {
        ui.camera.x = drag.cx - (sp.x - drag.sx) / ui.camera.zoom;
        ui.camera.y = drag.cy - (sp.y - drag.sy) / ui.camera.zoom;
        invalidate();
      } else if (drag.type === 'vertex') {
        const sn = snapWorld(p, e);
        drag.track.points[drag.index] = { x: sn.x, y: sn.y };
        drag.moved = true;
        invalidate(); emit('geometry');
      } else if (drag.type === 'move') {
        const def = objectDef(drag.obj.type);
        let nx = drag.ox + (p.x - drag.px), ny = drag.oy + (p.y - drag.py);
        const sn = snapWorld({ x: nx, y: ny }, e);
        nx = sn.x; ny = sn.y;
        if (def.onTrack && !e.altKey) {
          const s = snapToTrack(nx, ny);
          if (s) { nx = s.x; ny = s.y; drag.obj.rot = s.rot; drag.obj.trackId = s.trackId; }
          else drag.obj.trackId = null;
        }
        drag.obj.x = nx; drag.obj.y = ny;
        drag.moved = true;
        invalidate(); emit('geometry');
      } else if (drag.type === 'resize') {
        const o = drag.obj;
        const cos = Math.cos(o.rot || 0), sin = Math.sin(o.rot || 0);
        // ポインタを回転前のローカル座標（m）へ
        const dx = p.x - drag.x0, dy = p.y - drag.y0;
        const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
        const fx = -drag.sx * drag.w0 / 2, fy = -drag.sy * drag.h0 / 2;   // 固定する対角点
        let nw = Math.abs(lx - fx), nh = Math.abs(ly - fy);
        if (e.shiftKey) { const r = drag.w0 / Math.max(1e-6, drag.h0); if (nw / nh > r) nh = nw / r; else nw = nh * r; }
        const step = (store.doc.settings.snap && !e.altKey) ? 1 : 0.1;
        nw = Math.max(1, Math.round(nw / step) * step);
        nh = Math.max(1, Math.round(nh / step) * step);
        const cxl = fx + drag.sx * nw / 2, cyl = fy + drag.sy * nh / 2;   // 新しい中心（ローカル）
        o.w = nw; o.h = nh;
        o.x = drag.x0 + cxl * cos - cyl * sin;
        o.y = drag.y0 + cxl * sin + cyl * cos;
        drag.moved = true;
        invalidate(); emit('geometry');
      } else if (drag.type === 'moveTrack') {
        const g = store.doc.settings.gridM;
        let dx = p.x - drag.px, dy = p.y - drag.py;
        if (store.doc.settings.snap && !e.altKey) { dx = snap(dx, g); dy = snap(dy, g); }
        drag.track.points = drag.orig.map(q => ({ x: q.x + dx, y: q.y + dy }));
        drag.moved = true;
        invalidate(); emit('geometry');
      }
    }

    // 敷設プレビュー
    let cur = snapWorld(p, e);
    if (ui.tool === 'track' && ui.draft && ui.draft.length && store.doc.settings.angle45 && !e.shiftKey) {
      const prev = ui.draft[ui.draft.length - 1];
      cur = snapWorld(snapAngle(prev.x, prev.y, cur.x, cur.y), e);
    }
    if (!drag && ui.tool === 'select') {
      const j = hitJunction(p);
      const changed = (!!j !== !!ui.hoverJunction) ||
        (j && ui.hoverJunction && (j.x !== ui.hoverJunction.x || j.y !== ui.hoverJunction.y || j.exists !== ui.hoverJunction.exists));
      ui.hoverJunction = j ? { x: j.x, y: j.y, exists: j.exists } : null;
      if (changed) { invalidate(); updateHint(); }
      canvas.style.cursor = hitHandle(e) ? 'nwse-resize' : (j && !j.exists ? 'copy' : 'default');
    }
    ui.cursor = (ui.tool === 'track' || ui.tool === 'place') ? cur : p;
    if (ui.tool === 'track' || ui.tool === 'place') invalidate();
    emit('cursor');
  });

  canvas.addEventListener('pointerup', e => {
    if (drag) {
      if ((drag.type === 'vertex' || drag.type === 'move' || drag.type === 'moveTrack' || drag.type === 'resize')) {
        if (drag.moved) commit('drag');
        else { store._history.pop(); }   // 動かなかった場合は履歴を捨てる
      }
      drag = null;
    }
    setCursor();
  });

  canvas.addEventListener('dblclick', e => {
    const p = world(e);
    if (ui.tool === 'track') { finishDraft(true); return; }
    const v = hitVertex(p);
    if (v && v.track.points.length > 2) {
      snapshot();
      v.track.points.splice(v.index, 1);
      commit('remove-vertex');
      return;
    }
    const t = hitTrack(p);
    if (t && ui.sel && ui.sel.kind === 'track' && ui.sel.id === t.track.id) {
      // 区間の途中に頂点を追加
      let acc = 0, idx = 1;
      for (let i = 1; i < t.track.points.length; i++) {
        const a = t.track.points[i - 1], b = t.track.points[i];
        const seg = dist(a.x, a.y, b.x, b.y);
        if (t.at <= acc + seg) { idx = i; break; }
        acc += seg; idx = i + 1;
      }
      snapshot();
      const sn = snapWorld(p);
      t.track.points.splice(idx, 0, { x: sn.x, y: sn.y });
      commit('add-vertex');
    }
  });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const sp = evtPos(e);
    const before = toWorld(ui.camera, sp.x, sp.y);
    const factor = Math.exp(-e.deltaY * 0.0015);
    setZoom(ui.camera.zoom * factor, before, sp);
  }, { passive: false });

  function setZoom(z, anchorWorld, anchorScreen) {
    const nz = Math.max(0.08, Math.min(8, z));
    const cam = ui.camera;
    if (anchorWorld && anchorScreen) {
      cam.zoom = nz;
      cam.x = anchorWorld.x - anchorScreen.x / nz;
      cam.y = anchorWorld.y - anchorScreen.y / nz;
    } else {
      const cw = toWorld(cam, W / 2, H / 2);
      cam.zoom = nz;
      cam.x = cw.x - (W / 2) / nz;
      cam.y = cw.y - (H / 2) / nz;
    }
    invalidate(); emit('zoom');
  }

  function zoomBy(f) { setZoom(ui.camera.zoom * f); }

  function fitAll(opts) {
    const b = contentBounds(store.doc, opts);
    const pad = 40;
    const bw = Math.max(50, b.x1 - b.x0), bh = Math.max(50, b.y1 - b.y0);
    const z = Math.max(0.08, Math.min(4, Math.min((W - pad * 2) / bw, (H - pad * 2) / bh)));
    ui.camera.zoom = z;
    ui.camera.x = (b.x0 + b.x1) / 2 - W / (2 * z);
    ui.camera.y = (b.y0 + b.y1) / 2 - H / (2 * z);
    invalidate(); emit('zoom');
  }

  function focusOn(target) {
    let cx, cy;
    if (target.points && target.points.length) {
      const xs = target.points.map(p => p.x), ys = target.points.map(p => p.y);
      cx = (Math.min(...xs) + Math.max(...xs)) / 2; cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    } else { cx = target.x; cy = target.y; }
    ui.camera.x = cx - W / (2 * ui.camera.zoom);
    ui.camera.y = cy - H / (2 * ui.camera.zoom);
    invalidate(); emit('zoom');
  }

  /* ---------- キーボード ---------- */
  const hintEl = document.getElementById('hint');
  function updateHint() {
    let h = '';
    if (ui.tool === 'track') {
      const k = trackKind(ui.trackKindId);
      h = ui.draft && ui.draft.length
        ? `<b>${k.name}</b> を敷設中 — クリックで折点追加 / ダブルクリック・Enter・右クリックで確定 / Esc 取消`
        : `<b>${k.name}</b> を敷設 — 起点をクリック（Shiftで角度自由・Altでスナップ解除）`;
    } else if (ui.tool === 'place' && ui.placeType) {
      h = `<b>${objectDef(ui.placeType).name}</b> を配置 — クリックで設置 / R キーで回転 / Shift+クリックで連続設置 / Esc 中止`;
    } else if (ui.tool === 'pan') {
      h = 'ドラッグで画面移動';
    } else if (ui.tool === 'select' && ui.hoverJunction) {
      h = ui.hoverJunction.exists
        ? 'この交点には分岐器が設置済みです'
        : 'クリックすると <b>分岐器</b> を設置します（交差部はパレットでダイヤモンド／スリップを選べます）';
    }
    hintEl.innerHTML = h;
  }

  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.code === 'Space') { spaceDown = true; setCursor(); }
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) return;      // Ctrl系は main.js で処理
    if (k === 'v') { setTool('select'); }
    else if (k === 't') { setTool('track'); }
    else if (k === 'h') { setTool('pan'); }
    else if (k === 'escape') {
      if (ui.draft) finishDraft(false);
      else if (ui.tool === 'place') { ui.tool = 'select'; ui.placeType = null; emit('tool'); updateHint(); }
      else if (ui.sel) { ui.sel = null; emit('select'); }
      invalidate();
    }
    else if (k === 'enter') { if (ui.draft) finishDraft(true); }
    else if (k === 'delete' || k === 'backspace') {
      if (ui.draft && ui.draft.length) { ui.draft.pop(); invalidate(); }
      else deleteSelected();
    }
    else if (k === 'r') {
      if (ui.tool === 'place') { ui.placeRot = ((ui.placeRot || 0) + Math.PI / 4) % (Math.PI * 2); invalidate(); }
      else if (ui.sel && ui.sel.kind === 'object') {
        const o = store.doc.objects.find(x => x.id === ui.sel.id);
        if (o) { snapshot(); o.rot = ((o.rot || 0) + Math.PI / 4) % (Math.PI * 2); commit('rotate'); }
      }
    }
    else if (k === 'f') fitAll();
    else if (k === '+' || k === ';' || k === '=') zoomBy(1.2);
    else if (k === '-') zoomBy(1 / 1.2);
    else if (k === 'g') { store.doc.settings.showGrid = !store.doc.settings.showGrid; commit('settings'); }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; setCursor(); } });

  function setTool(tool, placeType = null) {
    if (ui.draft && tool !== 'track') finishDraft(true);
    ui.tool = tool;
    ui.placeType = placeType;
    if (placeType) ui.placeRot = ui.placeRot || 0;
    emit('tool'); setCursor(); updateHint(); invalidate();
  }

  setCursor(); updateHint();

  return { invalidate, setTool, zoomBy, fitAll, focusOn, updateHint, getViewport: () => ({ W, H }) };
}
