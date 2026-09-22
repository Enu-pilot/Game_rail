// キャンバスの入力処理（選択・移動・敷設・配置・パン/ズーム）

import { store, emit, snapshot, commit, setMessage, subscribe } from './store.js';
import { objectDef, trackKind } from './catalog.js';
import { render, toWorld, toScreen, contentBounds } from './render.js';
import { snap, snapAngle, distToPolyline, hitRect, dist } from './geom.js';
import { addTrack, addObject, deleteSelected, snapToTrack } from './actions.js';

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

  function frame() {
    if (needsRender) { render(ctx, W, H, store.doc, ui); needsRender = false; }
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

  function hitObject(p) {
    const list = store.doc.objects;
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      const def = objectDef(o.type);
      const w = Math.max(o.w, 10 / ui.camera.zoom);
      const h = Math.max(o.h, 10 / ui.camera.zoom);
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
      const sn = snapWorld(p, e);
      addObject(ui.placeType, sn.x, sn.y, ui.placeRot || 0);
      if (!e.shiftKey) { ui.tool = 'select'; ui.placeType = null; }
      emit('tool'); invalidate(); setCursor(); updateHint();
      return;
    }

    // select ツール
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
    ui.cursor = (ui.tool === 'track' || ui.tool === 'place') ? cur : p;
    if (ui.tool === 'track' || ui.tool === 'place') invalidate();
    emit('cursor');
  });

  canvas.addEventListener('pointerup', e => {
    if (drag) {
      if ((drag.type === 'vertex' || drag.type === 'move' || drag.type === 'moveTrack')) {
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

  function fitAll() {
    const b = contentBounds(store.doc);
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
