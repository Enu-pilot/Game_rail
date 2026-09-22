// サイドパネル UI（パレット / 線路一覧 / プロパティ / 編成 / 設定）

import {
  store, subscribe, emit, snapshot, commit, setMessage,
  trackLength, trackCapacity, trackUsage, trackCarLength, formationLength, formationCars, formationCarLength, summary,
  findTrack, findObject, findFormation,
} from './store.js';
import {
  TRACK_KINDS, OBJECT_GROUPS, objectDef, trackKind, FORMATION_COLORS,
  VEHICLE_TYPES, LOCO_TYPES, vehicleDef,
} from './catalog.js';
import { getGraph, findRoute, validateLayout, END_TYPES, endType, nodeRoutes, currentNodeRoute } from './topology.js';
import { signalAspects, signalDetails, ASPECT_NAMES, ASPECT_SHORT, ASPECT_COLORS, routeStatus, isSignal } from './interlocking.js';
import { layoutChecks } from './checks.js';
import { entryAnalysis, stablingSummary } from './analysis.js';
import { sim, simStart, simPause, simReset, setSimMode, planAdd, planRemove, planClear, simState, simClockText, PHASE_NAMES } from './sim.js';
import {
  TRAIN_TYPES, trainType, isStation, stationObjects, lineStations, computeSchedule,
  timetableConflicts, platformConflicts, platformDemand, stationTracks, trainPlatform,
  nearbyTracks, fmtHM, parseHM,
} from './timetable.js';
import {
  addFormation, deleteSelected, duplicateSelected, assignFormation,
  updateEntity, reverseTrack, setTurnoutPosition, alignTurnouts,
  constructRoute, setRouteState, deleteRoute,
  addLine, updateLine, deleteLine, lineAddStation, lineRemoveStation, lineMoveStation,
  addTrain, updateTrain, deleteTrain, duplicateTrain,
} from './actions.js';

/* ---------------- DOM ヘルパ ---------------- */
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k in e && k !== 'list' && k !== 'type') { try { e[k] = v; } catch { e.setAttribute(k, v); } }
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

const fmtM = m => `${Math.round(m).toLocaleString('ja-JP')} m`;

/** 入力欄: フォーカス時にスナップショット、入力中は履歴なしで即時反映 */
function bindEdit(input, key, apply) {
  input.dataset.key = key;
  input.addEventListener('focus', () => snapshot());
  input.addEventListener('input', () => apply(input, false));
  input.addEventListener('change', () => apply(input, false));
  return input;
}

function field(label, input) { return h('div', { class: 'field' }, h('label', {}, label), input); }

function numberInput(key, value, onApply, opts = {}) {
  const inp = h('input', {
    type: 'number', value: value ?? '', step: opts.step ?? 1,
    min: opts.min ?? undefined, max: opts.max, inputmode: 'decimal',
  });
  return bindEdit(inp, key, i => {
    const raw = i.value.trim();
    if (raw === '-' || raw === '.' || raw === '-.') return;     // 入力途中
    if (raw === '' && !opts.allowEmpty) return;                 // 空欄のまま確定しない
    const v = raw === '' ? null : Number(raw);
    if (v !== null && !Number.isFinite(v)) return;
    onApply(v);
  });
}

function textInput(key, value, onApply, placeholder = '') {
  const inp = h('input', { type: 'text', value: value ?? '', placeholder });
  return bindEdit(inp, key, i => onApply(i.value));
}

function selectInput(key, value, options, onApply) {
  const sel = h('select', {}, ...options.map(o => h('option', { value: o.value, selected: o.value === value }, o.label)));
  sel.dataset.key = key;
  sel.addEventListener('change', () => { snapshot(); onApply(sel.value); });
  return sel;
}

function checkbox(label, checked, onApply) {
  const inp = h('input', { type: 'checkbox', checked });
  inp.addEventListener('change', () => onApply(inp.checked));
  return h('label', { class: 'checkline' }, inp, h('span', {}, label));
}

function meter(ratio, over) {
  const cls = over ? 'meter over' : ratio > 0.85 ? 'meter warn' : 'meter';
  return h('div', { class: cls }, h('i', { style: `width:${Math.min(100, ratio * 100).toFixed(1)}%` }));
}

/* ---------------- 初期化 ---------------- */
export function initUI(api) {
  const els = {
    palette: document.getElementById('panel-palette'),
    tracklist: document.getElementById('panel-tracklist'),
    inspector: document.getElementById('panel-inspector'),
    formations: document.getElementById('panel-formations'),
    route: document.getElementById('panel-route'),
    sim: document.getElementById('panel-sim'),
    timetable: document.getElementById('panel-timetable'),
    settings: document.getElementById('panel-settings'),
    statusPos: document.getElementById('status-pos'),
    statusSummary: document.getElementById('status-summary'),
    statusMsg: document.getElementById('status-msg'),
    zoomLabel: document.getElementById('zoom-label'),
  };

  const graph = () => getGraph(store.doc, store.rev);

  // タブ切替
  for (const nav of document.querySelectorAll('.tabs')) {
    nav.addEventListener('click', e => {
      const btn = e.target.closest('.tab'); if (!btn) return;
      const side = btn.closest('.side');
      side.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
      side.querySelectorAll('.tabpanel').forEach(p => p.classList.toggle('active', p.dataset.panel === btn.dataset.tab));
    });
  }

  function showTab(side, name) {
    const aside = document.querySelector(`.side.${side}`);
    aside.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    aside.querySelectorAll('.tabpanel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
  }

  /* --- フォーカス保持付き再描画（入力中はそのパネルを作り直さない） --- */
  function withFocus(container, build, ctxKey = '') {
    const active = document.activeElement;
    const ctxChanged = container._ctxKey !== ctxKey;
    container._ctxKey = ctxKey;
    const editing = !ctxChanged && active && container.contains(active) &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
      active.type !== 'checkbox' && active.type !== 'range';
    if (editing) {
      // 入力中に value を書き戻すと数値が打てないため、フォーカスが外れるまで待つ
      if (!container._awaitBlur) {
        container._awaitBlur = true;
        active.addEventListener('blur', () => {
          container._awaitBlur = false;
          renderAll('blur');
        }, { once: true });
      }
      return;
    }
    const key = container.contains(active) ? active.dataset.key : null;
    const selStart = key && active.selectionStart !== undefined ? active.selectionStart : null;
    container.replaceChildren(...build());
    if (key) {
      const next = container.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (next) {
        next.focus();
        if (selStart !== null && next.setSelectionRange) {
          try { next.setSelectionRange(selStart, selStart); } catch { }
        }
      }
    }
  }

  /* ---------------- パレット ---------------- */
  const paletteOpen = new Set(['tracks', 'station', 'equipment']);

  function paletteGroup(id, title, count, items) {
    const d = h('details', { open: paletteOpen.has(id) },
      h('summary', {}, title, h('span', { class: 'cnt' }, count)),
      h('div', { class: 'plist' }, ...items));
    d.addEventListener('toggle', () => { d.open ? paletteOpen.add(id) : paletteOpen.delete(id); });
    return d;
  }

  function buildPalette() {
    const out = [];
    out.push(paletteGroup('tracks', '線路（クリックして敷設）', TRACK_KINDS.length, TRACK_KINDS.map(k =>
      h('button', {
        class: 'pitem' + (store.ui.tool === 'track' && store.ui.trackKindId === k.id ? ' active' : ''),
        title: k.desc,
        onclick: () => { store.ui.trackKindId = k.id; api.setTool('track'); },
      },
        h('span', { class: 'swatch', style: `background:${k.color}` }),
        h('span', { class: 'nm' }, k.name, h('small', { class: 'desc' }, k.desc)),
        k.stabling ? h('span', { class: 'sz' }, '留置') : null,
      )
    )));

    for (const g of OBJECT_GROUPS) {
      if (store.ui.tool === 'place' && g.items.some(i => i.id === store.ui.placeType)) paletteOpen.add(g.id);
      out.push(paletteGroup(g.id, g.name, g.items.length, g.items.map(it =>
        h('button', {
          class: 'pitem' + (store.ui.tool === 'place' && store.ui.placeType === it.id ? ' active' : ''),
          title: `${it.name}（${it.w}×${it.h}m）${it.onTrack ? ' / 最寄りの線路にスナップ' : ''}`,
          onclick: () => api.setTool('place', it.id),
        },
          h('span', { class: 'swatch', style: `background:${it.color}` }),
          h('span', { class: 'nm' }, it.name),
          h('span', { class: 'sz' }, `${it.w}×${it.h}`),
        )
      )));
    }
    return out;
  }

  /* ---------------- 線路一覧 ---------------- */
  function buildTrackList() {
    const doc = store.doc;
    const s = summary(doc);
    const out = [];
    out.push(h('div', { class: 'card' },
      h('h4', {}, '基地全体'),
      h('div', { class: 'kv' }, h('span', {}, '線路本数'), h('b', {}, `${s.tracks} 本（留置系 ${s.stablingTracks}）`)),
      h('div', { class: 'kv' }, h('span', {}, '総延長'), h('b', {}, fmtM(s.totalLength))),
      h('div', { class: 'kv' }, h('span', {}, '留置可能両数'), h('b', {}, `${s.capacity} 両`)),
      h('div', { class: 'kv' }, h('span', {}, '留置中'), h('b', {}, `${s.cars} 両`)),
      meter(s.rate, s.cars > s.capacity),
      h('div', { class: 'kv' }, h('span', {}, '使用率'), h('b', {}, `${(s.rate * 100).toFixed(0)} %`)),
      s.unassigned ? h('div', { class: 'warnbox' }, `未留置の編成が ${s.unassigned} 本（${s.unassignedCars} 両）あります`) : null,
    ));

    if (!doc.tracks.length) {
      out.push(h('div', { class: 'empty' }, '線路がまだありません。パレットから線路種別を選んで敷設してください。'));
      return out;
    }

    const byKind = new Map();
    for (const t of doc.tracks) {
      if (!byKind.has(t.kind)) byKind.set(t.kind, []);
      byKind.get(t.kind).push(t);
    }
    for (const kind of TRACK_KINDS) {
      const list = byKind.get(kind.id);
      if (!list) continue;
      out.push(h('div', { class: 'group' },
        h('h3', {}, `${kind.name}（${list.length}）`),
        ...list.map(t => {
          const u = trackUsage(doc, t);
          const sel = store.ui.sel && store.ui.sel.kind === 'track' && store.ui.sel.id === t.id;
          return h('div', {
            class: 'listrow' + (sel ? ' sel' : ''),
            onclick: () => { store.ui.sel = { kind: 'track', id: t.id }; api.focusOn(t); emit('select'); showTab('right', 'inspector'); },
          },
            h('span', { class: 'dot', style: `background:${kind.color}` }),
            h('span', { class: 'nm' }, t.name),
            h('span', { class: 'num' }, `${Math.round(trackLength(t))}m`),
            kind.stabling ? h('span', { class: 'badge' + (u.over ? ' over' : u.cars ? ' ok' : '') }, `${u.cars}/${u.capacity}両`) : null,
          );
        })
      ));
    }
    return out;
  }

  /* ---------------- プロパティ ---------------- */
  function buildInspector() {
    const sel = store.ui.sel;
    if (!sel) {
      return [h('div', { class: 'card' },
        h('h4', {}, '選択なし'),
        h('p', { class: 'note' }, 'キャンバス上の線路・構造物をクリックすると、ここで詳細を編集できます。'),
        h('hr', { class: 'sepline' }),
        h('p', { class: 'note', html: '<b>操作</b><br>' +
          'パレット → 線路種別 → クリックで折線を敷設（ダブルクリックで確定）<br>' +
          '構造物はパレットから選んでキャンバスをクリック<br>' +
          '洗車機・検査台などは最寄りの線路に自動スナップします<br>' +
          '<b>線路が交わる点をクリックすると分岐器を自動設置</b>（向き・開く側は配線から判定。接続のない交差点にはダイヤモンドクロッシング）' }),
      )];
    }
    if (sel.kind === 'track') return buildTrackInspector(findTrack(sel.id));
    if (sel.kind === 'object') return buildObjectInspector(findObject(sel.id));
    if (sel.kind === 'formation') return buildFormationInspector(findFormation(sel.id));
    return [];
  }

  function buildTrackInspector(t) {
    if (!t) return [h('div', { class: 'empty' }, '選択が失われました')];
    const doc = store.doc;
    const kind = trackKind(t.kind);
    const u = trackUsage(doc, t);
    const len = trackLength(t);
    const equipment = doc.objects.filter(o => o.trackId === t.id);
    const free = doc.formations.filter(f => !f.trackId);

    const out = [];
    out.push(h('div', { class: 'card' },
      h('h4', {}, h('span', { class: 'dot', style: `width:10px;height:10px;border-radius:50%;background:${kind.color};display:inline-block` }), '線路', h('span', { class: 'tag' }, kind.name)),
      field('線路名', textInput(`track.${t.id}.name`, t.name, v => updateEntity('track', t.id, { name: v }, { history: false }), '例: 3番留置線')),
      field('種別', selectInput(`track.${t.id}.kind`, t.kind, TRACK_KINDS.map(k => ({ value: k.id, label: k.name })),
        v => updateEntity('track', t.id, { kind: v }, { history: false }))),
      h('div', { class: 'kv' }, h('span', {}, '延長'), h('b', {}, `${len.toFixed(1)} m`)),
      h('div', { class: 'kv' }, h('span', {}, '有効長（端部余裕控除）'), h('b', {}, `${Math.max(0, len - doc.settings.clearanceM).toFixed(1)} m`)),
      h('div', { class: 'kv' }, h('span', {}, '折点数'), h('b', {}, `${t.points.length}`)),
      h('div', { class: 'btn-row', style: 'margin-top:8px' },
        h('button', { class: 'btn sm', onclick: () => reverseTrack(t.id), title: '留置の詰め方向（始端）を入れ替えます' }, '⇄ 向きを反転'),
        h('button', { class: 'btn sm', onclick: () => api.focusOn(t) }, '◎ 表示'),
        h('button', { class: 'btn sm', onclick: () => duplicateSelected() }, '複製'),
        h('button', { class: 'btn sm danger', onclick: () => deleteSelected() }, '削除'),
      ),
    ));

    const g = graph();
    const endNodes = g.endNodesOfTrack(t.id);
    const connCount = which => {
      const nid = which === 'a' ? endNodes[0] : endNodes[endNodes.length - 1];
      const node = nid && g.nodeById.get(nid);
      if (!node) return 0;
      return new Set(node.edges.map(eid => g.edgeById.get(eid).trackId)).size - 1;
    };
    out.push(h('div', { class: 'card' },
      h('h4', {}, '端点'),
      ...['a', 'b'].map(which => h('div', { class: 'field' },
        h('label', {}, which === 'a' ? 'A端（始端）' : 'B端（終端）',
          h('span', { class: 'badge', style: 'margin-left:6px' },
            connCount(which) > 0 ? `${connCount(which)}線と接続` : '接続なし')),
        selectInput(`track.${t.id}.end${which}`, endType(t, which), END_TYPES.map(e => ({ value: e.id, label: e.name })),
          v => updateEntity('track', t.id, { ends: { ...t.ends, [which]: v } }, { history: false })),
      )),
      h('p', { class: 'note' }, 'A端は留置編成を詰める側です。「場外接続」にすると出区経路の探索で基地の出入口として扱われます。'),
    ));

    out.push(h('div', { class: 'card' },
      h('h4', {}, '留置可能両数'),
      field('算出方法', selectInput(`track.${t.id}.capmode`, t.capacityMode,
        [{ value: 'auto', label: '自動（有効長 ÷ 1両長）' }, { value: 'manual', label: '手入力' }],
        v => updateEntity('track', t.id, { capacityMode: v, capacity: v === 'manual' ? trackCapacity(doc, t) : t.capacity }, { history: false }))),
      h('div', { class: 'row' },
        field('留置可能両数', t.capacityMode === 'manual'
          ? numberInput(`track.${t.id}.cap`, t.capacity, v => updateEntity('track', t.id, { capacity: Math.max(0, v || 0) }, { history: false }), { min: 0 })
          : h('input', { type: 'number', value: trackCapacity(doc, t), disabled: true })),
        field('1両長（m）', numberInput(`track.${t.id}.carlen`, t.carLengthM ?? '', v => updateEntity('track', t.id, { carLengthM: v }, { history: false }), { min: 1, step: 0.5, allowEmpty: true })),
      ),
      h('p', { class: 'note' }, `1両長が空欄のときは全体設定（${doc.settings.carLengthM}m）を使用します。`),
      meter(u.capacity ? u.cars / u.capacity : 0, u.over),
      h('div', { class: 'kv' }, h('span', {}, '留置中'), h('b', {}, `${u.cars} / ${u.capacity} 両`)),
      h('div', { class: 'kv' }, h('span', {}, '使用長'), h('b', {}, `${u.lengthUsed.toFixed(0)} / ${u.usable.toFixed(0)} m`)),
      u.over ? h('div', { class: 'warnbox' }, '⚠ 留置両数が有効長を超えています') : null,
    ));

    out.push(h('div', { class: 'card' },
      h('h4', {}, '留置中の編成', h('span', { class: 'tag' }, `${u.list.length} 本`)),
      u.list.length
        ? h('div', {}, ...u.list.map(f => h('span', { class: 'chip' },
          h('span', { class: 'dot', style: `background:${f.color}` }),
          h('span', {
            style: 'cursor:pointer', onclick: () => { store.ui.sel = { kind: 'formation', id: f.id }; emit('select'); },
          }, `${f.name} ${formationCars(f)}両`),
          h('button', { title: '留置解除', onclick: () => assignFormation(f.id, null) }, '×'),
        )))
        : h('p', { class: 'note' }, 'この線路に留置中の編成はありません。'),
      free.length
        ? h('div', { class: 'field', style: 'margin-top:8px' },
          h('label', {}, '未留置の編成を入線させる'),
          (() => {
            const sel = h('select', {}, h('option', { value: '' }, '— 編成を選択 —'),
              ...free.map(f => h('option', { value: f.id }, `${f.name}（${f.cars}両）`)));
            sel.addEventListener('change', () => { if (sel.value) assignFormation(sel.value, t.id); });
            return sel;
          })())
        : null,
      h('button', {
        class: 'btn sm wide', style: 'margin-top:6px',
        onclick: () => { const f = addFormation({ trackId: t.id }); setMessage(`${f.name} を ${t.name} に新規留置`); },
      }, '＋ この線路に編成を新規作成'),
    ));

    out.push(h('div', { class: 'card' },
      h('h4', {}, '線路上の設備', h('span', { class: 'tag' }, `${equipment.length} 件`)),
      equipment.length
        ? h('div', {}, ...equipment.map(o => h('div', {
          class: 'listrow',
          onclick: () => { store.ui.sel = { kind: 'object', id: o.id }; emit('select'); },
        },
          h('span', { class: 'dot', style: `background:${objectDef(o.type).color}` }),
          h('span', { class: 'nm' }, o.label || objectDef(o.type).name),
        )))
        : h('p', { class: 'note' }, '洗車機・検査台・清掃台などを線路上に配置すると、ここに表示されます。'),
    ));

    out.push(h('div', { class: 'card' },
      h('h4', {}, 'メモ'),
      bindEdit(h('textarea', { value: t.note || '', placeholder: '検査周期、入換手順など' }), `track.${t.id}.note`,
        i => updateEntity('track', t.id, { note: i.value }, { history: false })),
    ));
    return out;
  }

  function buildObjectInspector(o) {
    if (!o) return [h('div', { class: 'empty' }, '選択が失われました')];
    const def = objectDef(o.type);
    const track = o.trackId ? findTrack(o.trackId) : null;
    const isTurnout = def.shape === 'turnout';
    const turnoutTypes = OBJECT_GROUPS.flatMap(g => g.items).filter(i => i.shape === 'turnout');
    const out = [];
    out.push(h('div', { class: 'card' },
      h('h4', {}, def.name, h('span', { class: 'tag' }, isTurnout ? '結節点の記号' : (def.groupName || ''))),
      field('表示名', textInput(`obj.${o.id}.label`, o.label, v => updateEntity('object', o.id, { label: v }, { history: false }), def.name)),
      isTurnout ? field('種類', selectInput(`obj.${o.id}.type`, o.type,
        turnoutTypes.map(i => ({ value: i.id, label: i.name })),
        v => updateEntity('object', o.id, { type: v, w: objectDef(v).w, h: objectDef(v).h }, { history: false }))) : null,
      isTurnout ? null : h('div', { class: 'row' },
        field('幅 W（m）', numberInput(`obj.${o.id}.w`, o.w, v => updateEntity('object', o.id, { w: Math.max(0.5, v || 1) }, { history: false }), { min: 0.5, step: 0.5 })),
        field('奥行 D（m）', numberInput(`obj.${o.id}.h`, o.h, v => updateEntity('object', o.id, { h: Math.max(0.5, v || 1) }, { history: false }), { min: 0.5, step: 0.5 })),
      ),
      h('div', { class: 'row' },
        field('X（m）', numberInput(`obj.${o.id}.x`, Math.round(o.x * 10) / 10, v => updateEntity('object', o.id, { x: v || 0 }, { history: false }), { step: 0.5 })),
        field('Y（m）', numberInput(`obj.${o.id}.y`, Math.round(o.y * 10) / 10, v => updateEntity('object', o.id, { y: v || 0 }, { history: false }), { step: 0.5 })),
      ),
      def.shape === 'turntable' ? field('直径（m）', numberInput(`obj.${o.id}.dia`, Math.max(o.w, o.h),
        v => { const d = Math.max(4, v || 25); updateEntity('object', o.id, { w: d, h: d }, { history: false }); }, { min: 4, step: 0.5 })) : null,
      def.shape === 'roundhouse' ? h('p', { class: 'note' }, '幅Wが扇形庫の外径になります。転車台の中心に合わせて配置し、回転で向きを調整してください。') : null,
      def.variant === 'diamond' ? field('交差角（度）', numberInput(`obj.${o.id}.xang`,
        Math.round((o.xang ?? Math.PI / 4) * 180 / Math.PI),
        v => updateEntity('object', o.id, { xang: Math.max(5, Math.min(90, v || 45)) * Math.PI / 180 }, { history: false }),
        { min: 5, max: 90, step: 5 })) : null,
      isTurnout ? h('p', { class: 'note' }, '分岐器は線路の結節点を示す記号です。実寸は持たず、拡大率によらず同じ大きさで表示されます。') : null,
      field('回転（度）', numberInput(`obj.${o.id}.rot`, Math.round((o.rot || 0) * 180 / Math.PI),
        v => updateEntity('object', o.id, { rot: (v || 0) * Math.PI / 180 }, { history: false }), { step: 15 })),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm', onclick: () => { snapshot(); o.rot = ((o.rot || 0) + Math.PI / 4) % (Math.PI * 2); commit('rotate'); } }, '↻ 45°回転'),
        def.shape === 'turnout'
          ? h('button', { class: 'btn sm', title: '分岐の開く向きを左右反転します', onclick: () => updateEntity('object', o.id, { mirror: !o.mirror }) }, '⇅ 開き反転')
          : null,
        h('button', { class: 'btn sm', onclick: () => api.focusOn(o) }, '◎ 表示'),
        h('button', { class: 'btn sm', onclick: () => duplicateSelected() }, '複製'),
        h('button', { class: 'btn sm danger', onclick: () => deleteSelected() }, '削除'),
      ),
      def.onTrack ? h('p', { class: 'note' }, track ? `紐づく線路: ${track.name}` : '線路に紐づいていません（線路の近くへドラッグするとスナップします）') : null,
    ));
    // 分岐器の開通方向
    if (isTurnout) {
      const g = graph();
      const node = g.nodes.find(n => n.turnout === o.id);
      const routes = node ? nodeRoutes(g, node.id, store.doc.settings.maxTurnDeg) : [];
      out.push(h('div', { class: 'card' },
        h('h4', {}, '開通方向', h('span', { class: 'tag' }, node ? `${node.edges.length} 方向` : '接続点に未接続')),
        !node
          ? h('p', { class: 'note' }, '線路の接続点から離れているため、開通方向を持ちません。接続点の上へ移動してください。')
          : def.variant === 'diamond'
            ? h('p', { class: 'note' }, '平面交差は転換しません（両方向とも常時開通）。')
            : h('div', {},
              field('いま開通している進路', selectInput(`obj.${o.id}.pos`, String(o.position || 0),
                routes.map(r => ({ value: String(r.index), label: `${r.name}：${r.label}` })),
                v => setTurnoutPosition(o.id, Number(v)))),
              h('div', { class: 'btn-row' }, ...routes.map(r => h('button', {
                class: 'btn sm' + ((o.position || 0) === r.index ? ' primary' : ''),
                onclick: () => setTurnoutPosition(o.id, r.index),
              }, r.name))),
              h('p', { class: 'note' }, '図上では開通している側が明るく表示されます（定位＝緑、反位＝黄）。'),
            ),
      ));
    }

    // 駅間省略
    if (def.gap) {
      const tr = o.trackId ? findTrack(o.trackId) : null;
      out.push(h('div', { class: 'card' },
        h('h4', {}, '駅間の省略', h('span', { class: 'tag' }, tr ? tr.name : '線路に未接続')),
        field('省略する距離（km）', numberInput(`obj.${o.id}.extra`, (o.extraM || 0) / 1000,
          v => updateEntity('object', o.id, { extraM: Math.max(0, (v || 0) * 1000) }, { history: false }),
          { min: 0, step: 0.1 })),
        h('p', { class: 'note' }, '配線図では短く描いたまま、ダイヤのキロ程・所要時間・経路距離にこの距離が加算されます。運転シミュレーションでは、この記号の位置で省略した距離ぶんの時間だけ走ります。'),
        !o.trackId ? h('div', { class: 'warnbox' }, '線路の上に置いてください（最寄りの線路にスナップします）') : null,
      ));
    }

    // 駅（停車場）
    if (def.station) {
      const assigned = (o.tracks || []).filter(id => store.doc.tracks.some(t => t.id === id));
      const near = nearbyTracks(store.doc, o, 90).filter(x => !assigned.includes(x.track.id));
      out.push(h('div', { class: 'card' },
        h('h4', {}, '駅の番線（発着線）', h('span', { class: 'tag' }, `${assigned.length} 線`)),
        assigned.length
          ? h('div', {}, ...assigned.map((id, i) => {
            const t = findTrack(id);
            return h('div', { class: 'listrow' },
              h('span', { class: 'num' }, `${i + 1}`),
              h('span', { class: 'nm' }, t ? t.name : '?'),
              h('button', {
                class: 'btn sm danger',
                onclick: () => updateEntity('object', o.id, { tracks: assigned.filter(x => x !== id) }),
              }, '×'));
          }))
          : h('p', { class: 'note' }, '番線が未設定です。ダイヤでは駅マーカーが乗っている線路を使います。'),
        near.length
          ? h('div', { class: 'field', style: 'margin-top:8px' }, h('label', {}, '番線を追加'),
            (() => {
              const sel = h('select', {}, h('option', { value: '' }, '— 近くの線路 —'),
                ...near.map(x => h('option', { value: x.track.id }, `${x.track.name}（${x.d.toFixed(0)}m）`)));
              sel.addEventListener('change', () => {
                if (sel.value) updateEntity('object', o.id, { tracks: [...assigned, sel.value] });
              });
              return sel;
            })())
          : null,
        h('button', {
          class: 'btn sm wide', style: 'margin-top:6px',
          onclick: () => {
            const auto = nearbyTracks(store.doc, o, 90)
              .filter(x => ['platform', 'main', 'entryexit', 'entry', 'exit'].includes(x.track.kind))
              .map(x => x.track.id);
            updateEntity('object', o.id, { tracks: [...new Set(auto)] });
            setMessage(`${auto.length} 本の線路を番線に設定しました`);
          },
        }, '近くの線路から自動設定'),
      ));
    }

    // 信号機
    if (isSignal(o)) {
      const g = graph();
      const det = signalDetails(store.doc, g, store.rev).get(o.id) || {};
      const asp = det.aspect || 'stop';
      const blk = det.block;
      const nextSig = blk && blk.nextSignalId ? store.doc.objects.find(x => x.id === blk.nextSignalId) : null;
      const endText = {
        signal: '次の信号機', buffer: '車止め', boundary: '場外', deadend: '線路の終端',
        notlined: '分岐器が開通していない', turntable: '転車台', unknown: '不明',
      };
      const tr = o.trackId ? findTrack(o.trackId) : null;
      const usedBy = (store.doc.routes || []).filter(r => r.signalId === o.id);
      out.push(h('div', { class: 'card' },
        h('h4', {}, '信号現示',
          h('span', { class: 'tag', style: `color:${ASPECT_COLORS[asp]}` }, `${ASPECT_NAMES[asp] || '停止'}（${ASPECT_SHORT[asp] || 'R'}）`)),
        h('div', { class: 'kv' }, h('span', {}, '防護する線路'), h('b', {}, tr ? tr.name : '未設定')),
        field('進行方向', selectInput(`obj.${o.id}.dir`, o.dir || 'ab',
          [{ value: 'ab', label: 'A端 → B端 方向' }, { value: 'ba', label: 'B端 → A端 方向' }],
          v => updateEntity('object', o.id, { dir: v }, { history: false }))),
        blk ? h('div', {},
          h('div', { class: 'kv' }, h('span', {}, '閉塞区間長'), h('b', {}, `${blk.length.toFixed(0)} m`)),
          h('div', { class: 'kv' }, h('span', {}, '区間の終わり'), h('b', {}, endText[blk.endKind] || blk.endKind)),
          h('div', { class: 'kv' }, h('span', {}, '次の信号機'),
            h('b', {}, nextSig ? `${nextSig.label || objectDef(nextSig.type).name}（${ASPECT_NAMES[(signalAspects(store.doc, g, store.rev).get(nextSig.id)) || 'stop']}）` : 'なし')),
          h('div', { class: 'kv' }, h('span', {}, '区間内の在線'), h('b', {}, blk.occupied.length ? blk.occupied.join('・') : 'なし')),
          nextSig ? h('button', {
            class: 'btn sm wide', style: 'margin-top:6px',
            onclick: () => { store.ui.sel = { kind: 'object', id: nextSig.id }; api.focusOn(nextSig); emit('select'); },
          }, '次の信号機を選択') : null,
        ) : null,
        h('p', { class: 'note' }, '選択中は閉塞区間が図上に帯で表示されます。次の信号機の現示が連鎖して、停止→注意→（4灯なら減速）→進行と上がります。'),
        usedBy.length
          ? h('div', {}, ...usedBy.map(r => h('div', { class: 'listrow' },
            h('span', { class: 'dot', style: `background:${r.set ? '#3ddc84' : '#5d6577'}` }),
            h('span', { class: 'nm' }, r.name),
            h('span', { class: 'num' }, r.set ? '構成中' : '解除'))))
          : h('p', { class: 'note' }, 'この信号機を入口とする進路はまだありません。'),
      ));
    }

    out.push(h('div', { class: 'card' },
      h('h4', {}, 'メモ'),
      bindEdit(h('textarea', { value: o.note || '', placeholder: '能力、設置年、補足など' }), `obj.${o.id}.note`,
        i => updateEntity('object', o.id, { note: i.value }, { history: false })),
    ));
    return out;
  }

  function buildFormationInspector(f) {
    if (!f) return [h('div', { class: 'empty' }, '選択が失われました')];
    const doc = store.doc;
    const t = f.trackId ? findTrack(f.trackId) : null;
    const len = formationLength(doc, f);
    const vd = vehicleDef(f.vehicle);
    return [h('div', { class: 'card' },
      h('h4', {}, h('span', { class: 'dot', style: `width:10px;height:10px;border-radius:50%;background:${f.color};display:inline-block` }), '編成'),
      field('編成名', textInput(`f.${f.id}.name`, f.name, v => updateEntity('formation', f.id, { name: v }, { history: false }), '例: 第12編成')),
      field('形式', textInput(`f.${f.id}.series`, f.series, v => updateEntity('formation', f.id, { series: v }, { history: false }), '例: E233系 / キハ40 / 12系 / DD51')),
      field('車種', selectInput(`f.${f.id}.vehicle`, f.vehicle || 'emu',
        VEHICLE_TYPES.map(v => ({ value: v.id, label: `${v.name}（標準 ${v.len}m）` })),
        v => updateEntity('formation', f.id, { vehicle: v }, { history: false }))),
      h('div', { class: 'row' },
        field(vd.loco ? '両数（機関車）' : '両数（本体）', numberInput(`f.${f.id}.cars`, f.cars, v => updateEntity('formation', f.id, { cars: Math.max(1, Math.round(v || 1)) }, { history: false }), { min: 1, max: 30 })),
        field('1両長（m）', numberInput(`f.${f.id}.carlen`, f.carLengthM ?? '', v => updateEntity('formation', f.id, { carLengthM: v }, { history: false }), { min: 1, step: .5, allowEmpty: true })),
      ),
      h('p', { class: 'note' }, `1両長が空欄のときは車種の標準値（${vd.len}m）を使用します。`),
      vd.loco ? null : h('div', { class: 'row' },
        field('牽引機', selectInput(`f.${f.id}.loco`, f.loco ? f.loco.type : '',
          [{ value: '', label: '— なし（自走）—' }, ...LOCO_TYPES.map(v => ({ value: v.id, label: `${v.name} ${v.len}m` }))],
          v => updateEntity('formation', f.id, { loco: v ? { type: v, count: f.loco ? f.loco.count : 1 } : null }, { history: false }))),
        f.loco ? field('機関車両数', numberInput(`f.${f.id}.locon`, f.loco.count,
          v => updateEntity('formation', f.id, { loco: { type: f.loco.type, count: Math.max(1, Math.min(3, Math.round(v || 1))) } }, { history: false }),
          { min: 1, max: 3 })) : null,
      ),
      field('留置線', selectInput(`f.${f.id}.track`, f.trackId || '',
        [{ value: '', label: '— 未留置 —' }, ...doc.tracks.map(tt => ({ value: tt.id, label: `${tt.name}（${trackKind(tt.kind).name}）` }))],
        v => updateEntity('formation', f.id, { trackId: v || null }, { history: false }))),
      field('色', (() => {
        const wrap = h('div', { class: 'btn-row' });
        for (const c of FORMATION_COLORS) {
          wrap.append(h('button', {
            class: 'btn sm', style: `background:${c};border-color:${c};width:22px;height:22px;padding:0` + (f.color === c ? ';outline:2px solid #fff' : ''),
            title: c, onclick: () => updateEntity('formation', f.id, { color: c }),
          }));
        }
        return wrap;
      })()),
      h('div', { class: 'kv' }, h('span', {}, '両数（合計）'), h('b', {}, `${formationCars(f)} 両`)),
      h('div', { class: 'kv' }, h('span', {}, '編成長'), h('b', {}, `${len.toFixed(0)} m`)),
      f.loco ? h('div', { class: 'kv' }, h('span', {}, '構成'),
        h('b', {}, `${vehicleDef(f.loco.type).short}×${f.loco.count} ＋ ${vd.short}×${f.cars}`)) : null,
      t ? h('div', { class: 'kv' }, h('span', {}, '留置先'), h('b', {}, t.name)) : null,
      h('div', { class: 'btn-row', style: 'margin-top:8px' },
        h('button', { class: 'btn sm', onclick: () => duplicateSelected() }, '複製'),
        h('button', { class: 'btn sm danger', onclick: () => deleteSelected() }, '削除'),
      ),
      h('div', { class: 'field', style: 'margin-top:8px' }, h('label', {}, 'メモ'),
        bindEdit(h('textarea', { value: f.note || '' }), `f.${f.id}.note`, i => updateEntity('formation', f.id, { note: i.value }, { history: false }))),
    )];
  }

  /* ---------------- 編成パネル ---------------- */
  function buildFormations() {
    const doc = store.doc;
    const s = summary(doc);
    const out = [];
    out.push(h('div', { class: 'card' },
      h('h4', {}, '編成の管理'),
      h('div', { class: 'kv' }, h('span', {}, '編成数'), h('b', {}, `${s.formations} 本`)),
      h('div', { class: 'kv' }, h('span', {}, '留置中 / 可能'), h('b', {}, `${s.cars} / ${s.capacity} 両`)),
      h('div', { class: 'kv' }, h('span', {}, '未留置'), h('b', {}, `${s.unassigned} 本（${s.unassignedCars} 両）`)),
      meter(s.rate, s.cars > s.capacity),
      h('div', { class: 'field', style: 'margin-top:8px' },
        h('label', {}, '編成を追加'),
        h('div', { class: 'btn-row' },
          ...[['emu', '電車'], ['dmu', '気動車'], ['coach', '客車列車'], ['freight', '貨物列車'], ['el', '機関車'], ['mowcar', '保守用車']]
            .map(([v, label]) => h('button', {
              class: 'btn sm',
              onclick: () => addFormation(v === 'coach' ? { vehicle: 'coach', cars: 6, loco: { type: 'dl', count: 1 } }
                : v === 'freight' ? { vehicle: 'freight', cars: 12, loco: { type: 'el', count: 1 } }
                  : v === 'el' ? { vehicle: 'el', cars: 1 }
                    : { vehicle: v }),
            }, `＋ ${label}`))),
      ),
      h('div', { class: 'btn-row', style: 'margin-top:8px' },
        h('button', { class: 'btn sm', onclick: () => autoAssign() }, '自動で留置線へ割付'),
        h('button', {
          class: 'btn sm', onclick: () => {
            snapshot(); for (const f of doc.formations) f.trackId = null; commit('unassign-all');
          }
        }, '全て留置解除'),
      ),
    ));

    if (!doc.formations.length) {
      out.push(h('div', { class: 'empty' }, '編成がありません。「＋ 編成を追加」から作成してください。'));
      return out;
    }

    for (const f of doc.formations) {
      const sel = store.ui.sel && store.ui.sel.kind === 'formation' && store.ui.sel.id === f.id;
      const t = f.trackId ? findTrack(f.trackId) : null;
      const over = t ? trackUsage(doc, t).over : false;
      out.push(h('div', { class: 'card', style: sel ? 'border-color:#4f8cff' : '' },
        h('div', { class: 'listrow' + (sel ? ' sel' : ''), onclick: () => { store.ui.sel = { kind: 'formation', id: f.id }; emit('select'); } },
          h('span', { class: 'dot', style: `background:${f.color}` }),
          h('span', { class: 'nm' }, f.name,
            h('small', { class: 'desc' },
              [f.loco ? `${vehicleDef(f.loco.type).short}×${f.loco.count}＋` : '', vehicleDef(f.vehicle).short, f.series ? ` ${f.series}` : ''].join(''))),
          h('span', { class: 'num' }, `${formationCars(f)}両 / ${formationLength(doc, f).toFixed(0)}m`),
        ),
        h('div', { class: 'row', style: 'margin-top:6px' },
          h('div', { class: 'field', style: 'margin:0' },
            h('label', {}, '車種'),
            selectInput(`fl.${f.id}.vehicle`, f.vehicle || 'emu',
              VEHICLE_TYPES.map(v => ({ value: v.id, label: v.short })),
              v => updateEntity('formation', f.id, { vehicle: v }, { history: false }))),
          h('div', { class: 'field', style: 'margin:0' },
            h('label', {}, '両数'),
            numberInput(`fl.${f.id}.cars`, f.cars, v => updateEntity('formation', f.id, { cars: Math.max(1, Math.round(v || 1)) }, { history: false }), { min: 1, max: 30 })),
          h('div', { class: 'field', style: 'margin:0' },
            h('label', {}, '留置線'),
            selectInput(`fl.${f.id}.track`, f.trackId || '',
              [{ value: '', label: '— 未留置 —' }, ...doc.tracks.map(tt => ({ value: tt.id, label: tt.name }))],
              v => updateEntity('formation', f.id, { trackId: v || null }, { history: false }))),
        ),
        over ? h('div', { class: 'warnbox' }, `⚠ ${t.name} は容量超過です`) : null,
      ));
    }
    return out;
  }

  /** 未留置の編成を、空きのある留置系の線路へ順に割り付ける */
  function autoAssign() {
    const doc = store.doc;
    snapshot();
    const targets = doc.tracks.filter(t => trackKind(t.kind).stabling);
    let placed = 0;
    for (const f of doc.formations) {
      if (f.trackId) continue;
      for (const t of targets) {
        const u = trackUsage(doc, t);
        const cl = trackCarLength(doc, t);
        const need = formationLength(doc, f) + (u.list.length ? 3 : 0);
        if (u.cars + f.cars <= u.capacity && u.lengthUsed + need <= u.usable + 1e-6) {
          f.trackId = t.id; placed++; break;
        }
      }
    }
    commit('auto-assign');
    setMessage(placed ? `${placed} 本の編成を自動割付しました` : '割付できる空き線路がありません');
  }

  /* ---------------- 入換経路 ---------------- */
  const routeForm = { fromId: '', toId: '', formationId: '', cars: 10, respect: false };
  let routeResult = null;

  function runRouteSearch() {
    const doc = store.doc;
    const g = graph();
    const f = routeForm.formationId ? findFormation(routeForm.formationId) : null;
    const trainLength = f ? formationLength(doc, f) : Math.max(0, routeForm.cars) * doc.settings.carLengthM;
    const base = {
      fromTrackId: routeForm.fromId, toTrackId: routeForm.toId, trainLength,
      respectPositions: routeForm.respect,
    };
    let res = findRoute(doc, g, { ...base, enforceTailFit: true });
    if (!res.found) {
      const lenient = findRoute(doc, g, { ...base, enforceTailFit: false });
      if (lenient.found) {
        lenient.warnings.unshift('引上げ可能な有効長を満たす経路がないため、長さ制約を無視した経路を表示しています');
        res = lenient;
      }
    }
    res.trainLength = trainLength;
    routeResult = res;
    store.ui.route = res.found ? { path: res.path, reversePoints: res.reversePoints } : null;
    setMessage(res.found
      ? `経路を検出: 折返し ${res.reversals} 回 / 走行 ${res.distance.toFixed(0)}m`
      : '経路が見つかりませんでした');
  }

  function buildRoute() {
    const doc = store.doc;
    const g = graph();
    const trackOpts = doc.tracks.map(t => ({ value: t.id, label: `${t.name}（${trackKind(t.kind).name}）` }));
    if (!routeForm.fromId && doc.tracks.length) routeForm.fromId = doc.tracks[0].id;
    const f = routeForm.formationId ? findFormation(routeForm.formationId) : null;
    const trainLength = f ? formationLength(doc, f) : Math.max(0, routeForm.cars) * doc.settings.carLengthM;

    const out = [];
    out.push(h('div', { class: 'card' },
      h('h4', {}, '入換経路の検証'),
      h('div', { class: 'field' }, h('label', {}, '対象編成'),
        selectInput('route.f', routeForm.formationId,
          [{ value: '', label: '— 両数を直接指定 —' }, ...doc.formations.map(x => ({ value: x.id, label: `${x.name}（${x.cars}両）` }))],
          v => {
            routeForm.formationId = v;
            const ff = v ? findFormation(v) : null;
            if (ff && ff.trackId) routeForm.fromId = ff.trackId;
            emit('route');
          })),
      routeForm.formationId ? null : h('div', { class: 'field' }, h('label', {}, '両数'),
        (() => {
          const i = h('input', { type: 'number', value: routeForm.cars, min: 1, max: 30 });
          i.dataset.key = 'route.cars';
          i.addEventListener('input', () => { routeForm.cars = Math.max(1, Number(i.value) || 1); emit('route'); });
          return i;
        })()),
      h('div', { class: 'field' }, h('label', {}, '起点（現在の在線）'),
        selectInput('route.from', routeForm.fromId, trackOpts, v => { routeForm.fromId = v; emit('route'); })),
      h('div', { class: 'field' }, h('label', {}, '着点'),
        selectInput('route.to', routeForm.toId,
          [{ value: '', label: '— 選択してください —' }, { value: '__ext__', label: '◎ 場外へ出区（出入口）' }, ...trackOpts],
          v => { routeForm.toId = v; emit('route'); })),
      h('div', { class: 'kv' }, h('span', {}, '編成長'), h('b', {}, `${trainLength.toFixed(0)} m`)),
      checkbox('現在の分岐器の開通方向に従う', routeForm.respect, v => { routeForm.respect = v; emit('route'); }),
      h('div', { class: 'btn-row', style: 'margin-top:8px' },
        h('button', {
          class: 'btn sm primary',
          onclick: () => { if (!routeForm.toId) { setMessage('着点を選択してください'); return; } runRouteSearch(); emit('route'); },
        }, '経路を探索'),
        h('button', {
          class: 'btn sm', onclick: () => { routeResult = null; store.ui.route = null; emit('route'); },
        }, 'ハイライト解除'),
      ),
    ));

    if (routeResult) {
      if (!routeResult.found) {
        out.push(h('div', { class: 'card' },
          h('h4', {}, '結果'),
          h('div', { class: 'warnbox' }, `⚠ ${routeResult.reason || '経路が見つかりません'}`),
          h('p', { class: 'note' }, '線路どうしが接続しているか（接続点の表示を確認）、転向角の上限（設定タブ）が厳しすぎないかを確認してください。'),
        ));
      } else {
        const origin = findTrack(routeForm.fromId);
        const stepRows = [
          origin ? h('div', { class: 'listrow' },
            h('span', { class: 'dot', style: `background:${trackKind(origin.kind).color}` }),
            h('span', { class: 'nm' }, `起点: ${origin.name}`)) : null,
          ...routeResult.steps.map((st, i) => {
            if (st.type === 'reverse') {
              return h('div', { class: 'listrow' },
                h('span', { class: 'dot', style: 'background:#ffd166' }),
                h('span', { class: 'nm' }, `${st.name} で折返し`),
                h('span', { class: 'num' }, `有効長 ${st.len.toFixed(0)}m`));
            }
            if (st.type === 'turntable') {
              return h('div', { class: 'listrow' },
                h('span', { class: 'dot', style: 'background:#7fd1ff' }),
                h('span', { class: 'nm' }, '転車台で転回'),
                h('span', { class: 'num' }, st.size ? `桁長 ${st.size}m` : ''));
            }
            return h('div', { class: 'listrow', onclick: () => { store.ui.sel = { kind: 'track', id: st.trackId }; emit('select'); } },
              h('span', { class: 'dot', style: `background:${trackKind((store.doc.tracks.find(t => t.id === st.trackId) || {}).kind).color}` }),
              h('span', { class: 'nm' }, `${i + 1}. ${st.name}`),
              h('span', { class: 'num' }, `${st.len.toFixed(0)}m`));
          }),
        ].filter(Boolean);
        out.push(h('div', { class: 'card' },
          h('h4', {}, '経路', h('span', { class: 'tag' }, routeResult.toExt ? '場外へ出区' : '基地内入換')),
          h('div', { class: 'kv' }, h('span', {}, '折返し回数'), h('b', {}, `${routeResult.reversals} 回`)),
          routeResult.turntables ? h('div', { class: 'kv' }, h('span', {}, '転車台の使用'), h('b', {}, `${routeResult.turntables} 回`)) : null,
          h('div', { class: 'kv' }, h('span', {}, '走行距離'), h('b', {}, `${routeResult.distance.toFixed(0)} m`)),
          h('div', { class: 'kv' }, h('span', {}, '編成長'), h('b', {}, `${(routeResult.trainLength || 0).toFixed(0)} m`)),
          h('hr', { class: 'sepline' }),
          ...stepRows,
          ...routeResult.warnings.map(w => h('div', { class: 'warnbox' }, `⚠ ${w}`)),
          !routeResult.warnings.length ? h('p', { class: 'note' }, '✓ 支障となる留置編成・有効長の不足はありません') : null,
        ));

        // 進路（折返しで区切られた区間ごと）
        const legs = routeResult.legs || [];
        out.push(h('div', { class: 'card' },
          h('h4', {}, '進路（連動）', h('span', { class: 'tag' }, `${legs.length} 区間`)),
          legs.length > 1
            ? h('p', { class: 'note' }, '折返しを挟むため、実際の入換と同じように区間ごとの進路になります（同じ分岐器を途中で転換するため同時には構成できません）。')
            : null,
          ...legs.map((lg, i) => {
            const notAligned = lg.turnouts.filter(r => {
              const o = doc.objects.find(x => x.id === r.objectId);
              return o && (o.position || 0) !== r.index;
            });
            return h('div', { style: 'margin-bottom:10px' },
              h('div', { class: 'kv' },
                h('span', {}, legs.length > 1 ? `進路${i + 1}` : '進路'),
                h('b', {}, `${lg.fromName} → ${lg.toName}`)),
              lg.turnouts.length
                ? h('div', {}, ...lg.turnouts.map(r => {
                  const o = doc.objects.find(x => x.id === r.objectId);
                  const ok = o && (o.position || 0) === r.index;
                  return h('div', {
                    class: 'listrow',
                    onclick: () => { if (o) { store.ui.sel = { kind: 'object', id: o.id }; api.focusOn(o); emit('select'); } },
                  },
                    h('span', { class: 'dot', style: `background:${ok ? '#3ddc84' : '#ffb020'}` }),
                    h('span', { class: 'nm' }, `${o && o.label ? o.label : '分岐器'}：${r.name}`),
                    h('span', { class: 'num' }, ok ? '開通済' : '要転換'));
                }))
                : h('p', { class: 'note' }, '転換が必要な分岐器はありません'),
              lg.conflict ? h('div', { class: 'warnbox' }, '⚠ 同じ分岐器に異なる開通方向が必要です（この区間は1つの進路になりません）') : null,
              lg.turnouts.length ? h('button', {
                class: 'btn sm' + (notAligned.length ? ' primary' : ''), style: 'margin-top:4px',
                onclick: () => { alignTurnouts(lg.turnouts); emit('route'); },
              }, `⇄ この区間の分岐器を転換（${notAligned.length}）`) : null,
            );
          }),
          h('div', { class: 'btn-row', style: 'margin-top:6px' },
            h('button', {
              class: 'btn sm primary',
              onclick: () => {
                constructRoute(routeResult, {
                  toExt: routeForm.toId === '__ext__',
                  baseName: '入換',
                });
                emit('route');
              },
            }, legs.length > 1 ? `進路を ${legs.length} 本登録` : '進路を構成'),
          ),
        ));
      }
    }

    // 構成済みの進路
    const routes = doc.routes || [];
    out.push(h('div', { class: 'card' },
      h('h4', {}, '構成済みの進路', h('span', { class: 'tag' }, `${routes.filter(r => r.set).length}/${routes.length}`)),
      routes.length
        ? h('div', {}, ...routes.map(r => {
          const st = routeStatus(doc, g, r);
          return h('div', { style: 'margin-bottom:8px' },
            h('div', { class: 'listrow' },
              h('span', { class: 'dot', style: `background:${r.set ? ASPECT_COLORS[st.aspect] : '#5d6577'}` }),
              h('span', { class: 'nm' }, r.name,
                h('small', { class: 'desc' },
                  `${r.set ? ASPECT_NAMES[st.aspect] : '解除'} ／ 転てつ${r.turnouts.length} ／ ${r.distance.toFixed(0)}m${r.reversals ? ` ／ 折返し${r.reversals}` : ''}`)),
            ),
            r.set && !st.aligned ? h('div', { class: 'warnbox' }, '⚠ 分岐器が進路どおりに開通していません') : null,
            r.set && st.occupied.length ? h('div', { class: 'warnbox' }, `⚠ 進路内に在線: ${st.occupied.join('・')}`) : null,
            st.conflicts.length ? h('div', { class: 'warnbox' }, `⚠ 競合: ${st.conflicts.map(c => `${c.route.name}（${c.reasons.join('・')}）`).join(' / ')}`) : null,
            h('div', { class: 'btn-row' },
              h('button', { class: 'btn sm' + (r.set ? '' : ' primary'), onclick: () => { setRouteState(r.id, !r.set); emit('route'); } },
                r.set ? '解除' : '構成'),
              h('button', {
                class: 'btn sm', onclick: () => {
                  store.ui.route = { path: r.path, reversePoints: [] };
                  const t = findTrack(r.path[0] && r.path[0].trackId); if (t) api.focusOn(t);
                  emit('route');
                },
              }, '図示'),
              st.signal ? h('button', {
                class: 'btn sm', onclick: () => { store.ui.sel = { kind: 'object', id: st.signal.id }; api.focusOn(st.signal); emit('select'); },
              }, '信号') : null,
              h('button', { class: 'btn sm danger', onclick: () => { deleteRoute(r.id); emit('route'); } }, '削除'),
            ),
          );
        }))
        : h('p', { class: 'note' }, '経路を探索して「進路を構成」すると、分岐器が転換され、入口の信号機が進行を現示します。'),
    ));

    // 入線効率の解析
    out.push(buildAnalysisCard(doc, g));

    // レイアウト検証（接続＋物理チェック）
    const issues = [...validateLayout(doc, g), ...layoutChecks(doc, g, store.rev)];
    store.ui.issueMarks = doc.settings.showIssues
      ? issues.filter(i => Number.isFinite(i.x)).map(i => ({ x: i.x, y: i.y, level: i.level }))
      : [];
    const junctions = g.nodes.filter(n => new Set(n.edges.map(e => g.edgeById.get(e).trackId)).size > 1).length;
    out.push(h('div', { class: 'card' },
      h('h4', {}, 'レイアウト検証', h('span', { class: 'tag' }, `${issues.length} 件`)),
      h('div', { class: 'kv' }, h('span', {}, '接続点'), h('b', {}, `${junctions} 箇所`)),
      h('div', { class: 'kv' }, h('span', {}, '線路区間'), h('b', {}, `${g.edges.length} 区間`)),
      h('div', { class: 'kv' }, h('span', {}, '重大な不具合'), h('b', {}, `${issues.filter(i => i.level === 'error').length} 件`)),
      issues.length
        ? h('div', { style: 'margin-top:6px' }, ...issues.map(is => h('div', {
          class: 'listrow',
          onclick: () => {
            if (Number.isFinite(is.x)) api.focusOn({ x: is.x, y: is.y });
            if (is.trackId) store.ui.sel = { kind: 'track', id: is.trackId };
            else if (is.objectId) store.ui.sel = { kind: 'object', id: is.objectId };
            emit('select');
          },
        },
          h('span', { class: 'dot', style: `background:${is.level === 'error' ? '#ff5f56' : '#ffb020'}` }),
          h('span', { class: 'nm', style: 'white-space:normal' }, is.message),
        )))
        : h('p', { class: 'note' }, '✓ 未接続の端点・孤立した線路はありません'),
    ));
    return out;
  }

  /* ---------------- 入線効率 ---------------- */
  const anaForm = { sourceId: '', reverse: false, cars: 10 };
  let anaResult = null;

  function buildAnalysisCard(doc, g) {
    const kids = [
      h('h4', {}, '同時入線の効率', anaResult ? h('span', { class: 'tag' }, `同時 ${anaResult.simultaneous} 本`) : null),
      h('div', { class: 'field' }, h('label', {}, '起点'),
        selectInput('ana.src', anaForm.sourceId,
          [{ value: '', label: '— 場外接続の線路（自動） —' }, ...doc.tracks.map(t => ({ value: t.id, label: t.name }))],
          v => { anaForm.sourceId = v; emit('route'); })),
      h('div', { class: 'row' },
        h('div', { class: 'field', style: 'margin:0' }, h('label', {}, '想定両数'),
          (() => {
            const i = h('input', { type: 'number', value: anaForm.cars, min: 1, max: 30 });
            i.dataset.key = 'ana.cars';
            i.addEventListener('input', () => { anaForm.cars = Math.max(1, Number(i.value) || 1); });
            return i;
          })()),
        h('div', { class: 'field', style: 'margin:0' }, h('label', {}, '方向'),
          selectInput('ana.dir', anaForm.reverse ? 'out' : 'in',
            [{ value: 'in', label: '入区（起点→各線）' }, { value: 'out', label: '出区（各線→起点）' }],
            v => { anaForm.reverse = v === 'out'; emit('route'); })),
      ),
      h('button', {
        class: 'btn sm primary wide', style: 'margin-top:8px',
        onclick: () => {
          anaResult = entryAnalysis(doc, g, {
            sourceTrackId: anaForm.sourceId || null,
            trainLength: anaForm.cars * doc.settings.carLengthM,
            reverse: anaForm.reverse,
          });
          setMessage(anaResult.ok ? `同時入線数 ${anaResult.simultaneous} 本（対象 ${anaResult.routes.length} 線）` : anaResult.reason);
          emit('route');
        },
      }, '効率を解析'),
    ];

    if (anaResult && anaResult.ok) {
      const a = anaResult;
      kids.push(
        h('hr', { class: 'sepline' }),
        h('div', { class: 'kv' }, h('span', {}, '起点'), h('b', {}, a.source.name)),
        h('div', { class: 'kv' }, h('span', {}, '経路のある線'), h('b', {}, `${a.routes.length} / ${a.targets.length} 線`)),
        h('div', { class: 'kv' }, h('span', {}, '同時に動かせる数'), h('b', {}, `${a.simultaneous} 本`)),
        meter(a.parallelism, false),
        h('div', { class: 'kv' }, h('span', {}, '並列度'), h('b', {}, `${(a.parallelism * 100).toFixed(0)} %`)),
        h('div', { class: 'kv' }, h('span', {}, '平均走行'), h('b', {}, `${a.avgDistance.toFixed(0)} m / ${a.avgReversals.toFixed(1)} 回折返し`)),
        h('div', { class: 'kv' }, h('span', {}, '1本あたり所要'), h('b', {}, `約 ${a.avgMinutes.toFixed(1)} 分`)),
        h('div', { class: 'kv' }, h('span', {}, `${a.trains} 本を捌く時間`), h('b', {}, `${a.batches} 回・約 ${a.totalMinutes.toFixed(0)} 分`)),
        a.bestSet.length ? h('p', { class: 'note' }, `同時に構成できる組み合わせ例: ${a.bestSet.map(t => t.name).join('・')}`) : null,
        a.unreachable.length ? h('div', { class: 'warnbox' }, `到達できない線: ${a.unreachable.map(t => t.name).join('・')}`) : null,
        a.bottlenecks.length
          ? h('div', { style: 'margin-top:6px' },
            h('div', { class: 'kv' }, h('span', {}, 'ボトルネック'), h('b', {}, '')),
            ...a.bottlenecks.map(b => h('div', { class: 'listrow' },
              h('span', { class: 'dot', style: `background:${b.share > .8 ? '#ff5f56' : '#ffb020'}` }),
              h('span', { class: 'nm' }, `${b.name}（${b.kind}）`),
              h('span', { class: 'num' }, `${b.count}経路 ${(b.share * 100).toFixed(0)}%`))))
          : null,
        h('p', { class: 'note' }, '同時入線数は、分岐器と線路区間を共用しない進路の最大本数です（＝同時に構成できる進路の数）。'),
      );
    } else if (anaResult && !anaResult.ok) {
      kids.push(h('div', { class: 'warnbox' }, anaResult.reason));
    }
    return h('div', { class: 'card' }, ...kids);
  }

  /* ---------------- 運転（入換シミュレーション） ---------------- */
  const simForm = { formationId: '', toTrackId: '' };

  function buildSim() {
    const doc = store.doc;
    const stt = simState();
    const out = [];

    out.push(h('div', { class: 'card' },
      h('h4', {}, '運転', h('span', { class: 'tag', style: sim.running ? 'color:#3ddc84' : '' }, sim.running ? '運転中' : '停止中')),
      field('モード', selectInput('sim.mode', sim.mode,
        [{ value: 'plan', label: '入換（手動計画）' }, { value: 'timetable', label: 'ダイヤ運転（時刻どおり）' }],
        v => { setSimMode(v); emit('sim'); })),
      h('div', { class: 'kv' }, h('span', {}, '時計'), h('b', { style: 'font-size:15px' }, stt.clock)),
      sim.mode === 'timetable'
        ? field('開始時刻', (() => {
          const i = h('input', { type: 'text', value: fmtHM(sim.startClock), placeholder: '05:30' });
          i.dataset.key = 'sim.start';
          i.addEventListener('change', () => {
            const v = parseHM(i.value);
            if (v != null) { sim.startClock = v; if (!sim.running) sim.clock = v; emit('sim'); }
          });
          return i;
        })())
        : null,
      h('div', { class: 'btn-row', style: 'margin-top:8px' },
        h('button', { class: 'btn sm primary', onclick: () => { simStart(); emit('sim'); } }, sim.running ? '▶ 運転中' : '▶ 開始'),
        h('button', { class: 'btn sm', onclick: () => { simPause(); emit('sim'); } }, '⏸ 一時停止'),
        h('button', { class: 'btn sm danger', onclick: () => { simReset(); emit('sim'); } }, '⏹ リセット'),
      ),
      field('再生速度', selectInput('sim.speed', String(sim.speed),
        [1, 2, 4, 8, 16, 32, 60].map(v => ({ value: String(v), label: `×${v}` })),
        v => { sim.speed = Number(v); emit('sim'); })),
    ));

    // 走行中の列車
    out.push(h('div', { class: 'card' },
      h('h4', {}, '走行中', h('span', { class: 'tag' }, `${stt.movements.length} 本`)),
      stt.movements.length
        ? h('div', {}, ...stt.movements.map(mv => h('div', { style: 'margin-bottom:8px' },
          h('div', { class: 'listrow' },
            h('span', { class: 'dot', style: `background:${mv.color}` }),
            h('span', { class: 'nm' }, mv.name, h('small', { class: 'desc' }, `${PHASE_NAMES[mv.phase] || mv.phase} ／ ${mv.to} へ（区間 ${mv.leg}/${mv.legs}）`)),
            h('span', { class: 'num' }, `${mv.remain.toFixed(0)}m`)),
          meter(mv.progress, mv.phase === 'waiting'),
        )))
        : h('p', { class: 'note' }, '走行中の列車はありません。'),
    ));

    // 次に発車する列車 / 計画
    if (sim.mode === 'timetable') {
      out.push(h('div', { class: 'card' },
        h('h4', {}, '発車待ち', h('span', { class: 'tag' }, `${stt.pending.length} 本`)),
        stt.pending.length
          ? h('div', {}, ...stt.pending.slice(0, 10).map(t => {
            const tt = trainType(t.type);
            return h('div', { class: 'listrow' },
              h('span', { class: 'dot', style: `background:${t.color || tt.color}` }),
              h('span', { class: 'nm' }, `${t.number || tt.name}`, h('small', { class: 'desc' }, tt.name)),
              h('span', { class: 'num' }, fmtHM(t.departSec)));
          }))
          : h('p', { class: 'note' }, 'ダイヤタブで列車を作ると、発車時刻になった順に走り出します。'),
      ));
    } else {
      out.push(h('div', { class: 'card' },
        h('h4', {}, '移動の計画', h('span', { class: 'tag' }, `${sim.plan.length} 件`)),
        h('div', { class: 'row' },
          h('div', { class: 'field', style: 'margin:0' }, h('label', {}, '編成'),
            selectInput('sim.f', simForm.formationId,
              [{ value: '', label: '— 選択 —' }, ...doc.formations.map(f => ({ value: f.id, label: `${f.name}（${f.cars}両）` }))],
              v => { simForm.formationId = v; emit('sim'); })),
          h('div', { class: 'field', style: 'margin:0' }, h('label', {}, '行先'),
            selectInput('sim.t', simForm.toTrackId,
              [{ value: '', label: '— 選択 —' }, ...doc.tracks.map(t => ({ value: t.id, label: t.name }))],
              v => { simForm.toTrackId = v; emit('sim'); })),
        ),
        h('div', { class: 'btn-row', style: 'margin-top:6px' },
          h('button', { class: 'btn sm primary', onclick: () => { planAdd(simForm.formationId, simForm.toTrackId); emit('sim'); } }, '＋ 移動を追加'),
          h('button', { class: 'btn sm', onclick: () => { planClear(); emit('sim'); } }, '計画をクリア'),
        ),
        sim.plan.length
          ? h('div', { style: 'margin-top:6px' }, ...sim.plan.map((m, i) => {
            const f = doc.formations.find(x => x.id === m.formationId);
            const t = doc.tracks.find(x => x.id === m.toTrackId);
            const done = i < sim.planCursor;
            return h('div', { class: 'listrow', style: done ? 'opacity:.5' : '' },
              h('span', { class: 'dot', style: `background:${done ? '#3ddc84' : (f ? f.color : '#5d6577')}` }),
              h('span', { class: 'nm' }, `${i + 1}. ${f ? f.name : '?'} → ${t ? t.name : '?'}`),
              h('button', { class: 'btn sm', onclick: () => { planRemove(m.id); emit('sim'); } }, '×'));
          }))
          : h('p', { class: 'note' }, '編成と行先を選んで「移動を追加」してください。'),
      ));
    }

    out.push(h('div', { class: 'card' },
      h('h4', {}, '実行ログ'),
      sim.log.length
        ? h('div', {}, ...sim.log.slice(0, 20).map(l => h('div', { class: 'kv' },
          h('span', {}, l.time),
          h('b', { style: `font-weight:400;color:${l.level === 'error' ? '#ff8b84' : l.level === 'warn' ? '#ffd48a' : l.level === 'ok' ? '#8fe06a' : ''}` }, l.text))))
        : h('p', { class: 'note' }, 'まだログはありません。'),
    ));

    out.push(h('div', { class: 'card' },
      h('h4', {}, '運転条件'),
      field('入換速度（km/h）', numberInput('sim.spd', doc.settings.shuntSpeedKmh ?? 25,
        v => { snapshot(); doc.settings.shuntSpeedKmh = Math.max(1, v || 25); commit('settings'); }, { min: 1, step: 1 })),
      field('折返し時間（分）', numberInput('sim.rev', doc.settings.reversalMinutes ?? 2,
        v => { snapshot(); doc.settings.reversalMinutes = Math.max(0, v || 0); commit('settings'); }, { min: 0, step: .5 })),
      field('進路構成の所要（秒）', numberInput('sim.line', doc.settings.liningSeconds ?? 20,
        v => { snapshot(); doc.settings.liningSeconds = Math.max(0, v || 0); commit('settings'); }, { min: 0, step: 5 })),
      field('同時運転の上限（本）', numberInput('sim.max', sim.maxConcurrent,
        v => { sim.maxConcurrent = Math.max(1, Math.min(20, v || 6)); emit('sim'); }, { min: 1, max: 20 })),
    ));
    return out;
  }

  /* ---------------- ダイヤ ---------------- */
  function buildTimetable() {
    const doc = store.doc;
    const dg = store.ui.diagram || (store.ui.diagram = { lineId: null, selected: null });
    const line = doc.lines.find(l => l.id === dg.lineId) || doc.lines[0] || null;
    if (line) dg.lineId = line.id;
    const out = [];

    out.push(h('div', { class: 'card' },
      h('h4', {}, '路線', h('span', { class: 'tag' }, `${doc.lines.length} 本`)),
      doc.lines.length
        ? field('編集する路線', selectInput('tt.line', line ? line.id : '',
          doc.lines.map(l => ({ value: l.id, label: l.name })),
          v => { dg.lineId = v; dg.selected = null; emit('diagram'); }))
        : h('p', { class: 'note' }, '路線を作り、配線図に置いた「駅（停車場）」を順に追加するとダイヤを引けます。'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm primary', onclick: () => { addLine(); emit('diagram'); } }, '＋ 路線を作成'),
        line ? h('button', { class: 'btn sm danger', onclick: () => { deleteLine(line.id); emit('diagram'); } }, '削除') : null,
        h('button', { class: 'btn sm', onclick: () => { api.setMode('diagram'); } }, 'ダイヤ表示'),
      ),
      line ? h('div', { style: 'margin-top:8px' },
        field('路線名', textInput(`line.${line.id}.name`, line.name, v => updateLine(line.id, { name: v }))),
        field('線路条件', selectInput(`line.${line.id}.dbl`, line.double ? 'double' : 'single',
          [{ value: 'double', label: '複線（行き違い自由）' }, { value: 'single', label: '単線（行き違い不可）' }],
          v => updateLine(line.id, { double: v === 'double' }))),
      ) : null,
    ));

    if (!line) return out;

    // 駅
    const g = graph();
    const sts = lineStations(doc, g, line);
    const available = stationObjects(doc).filter(o => !line.stations.includes(o.id));
    out.push(h('div', { class: 'card' },
      h('h4', {}, '駅（キロ程は配線から自動計算）', h('span', { class: 'tag' }, `${sts.length} 駅`)),
      sts.length
        ? h('div', {}, ...sts.map((st, i) => h('div', { class: 'listrow' },
          h('span', { class: 'num' }, `${i + 1}`),
          h('span', {
            class: 'nm', style: 'cursor:pointer',
            onclick: () => { if (st.object) { store.ui.sel = { kind: 'object', id: st.object.id }; api.focusOn(st.object); emit('select'); } },
          }, st.name, h('small', { class: 'desc' },
            `${(st.km / 1000).toFixed(2)} km ／ 番線 ${st.object ? stationTracks(doc, st.object).length : 0}`)),
          h('button', { class: 'btn sm', onclick: () => { lineMoveStation(line.id, st.id, -1); emit('diagram'); } }, '↑'),
          h('button', { class: 'btn sm', onclick: () => { lineMoveStation(line.id, st.id, 1); emit('diagram'); } }, '↓'),
          h('button', { class: 'btn sm danger', onclick: () => { lineRemoveStation(line.id, st.id); emit('diagram'); } }, '×'),
        )))
        : h('p', { class: 'note' }, 'まだ駅がありません。'),
      available.length
        ? h('div', { class: 'field', style: 'margin-top:8px' },
          h('label', {}, '駅を追加'),
          (() => {
            const sel = h('select', {}, h('option', { value: '' }, '— 配置済みの駅から選ぶ —'),
              ...available.map(o => h('option', { value: o.id }, o.label || '駅')));
            sel.addEventListener('change', () => { if (sel.value) { lineAddStation(line.id, sel.value); emit('diagram'); } });
            return sel;
          })())
        : h('p', { class: 'note' }, 'パレットの「駅（停車場）」を線路上に置くと、ここから追加できます。'),
    ));

    // 列車
    const trains = doc.trains.filter(t => t.lineId === line.id);
    const sel = trains.find(t => t.id === dg.selected) || null;
    out.push(h('div', { class: 'card' },
      h('h4', {}, '列車', h('span', { class: 'tag' }, `${trains.length} 本`)),
      h('div', { class: 'btn-row' },
        ...TRAIN_TYPES.slice(0, 4).map(tt => h('button', {
          class: 'btn sm',
          onclick: () => { addTrain(line.id, { type: tt.id, speedKmh: tt.speed }); emit('diagram'); },
        }, `＋ ${tt.name}`)),
        h('button', {
          class: 'btn sm',
          onclick: () => { addTrain(line.id, { type: 'deadhead', speedKmh: 45, number: '回送' }); emit('diagram'); },
        }, '＋ 回送'),
      ),
      trains.length
        ? h('div', { style: 'margin-top:6px' }, ...trains
          .slice().sort((a, b) => a.departSec - b.departSec)
          .map(t => {
            const tt = trainType(t.type);
            const stops = computeSchedule(doc, sts, t);
            const last = stops[stops.length - 1];
            return h('div', {
              class: 'listrow' + (sel && sel.id === t.id ? ' sel' : ''),
              onclick: () => { dg.selected = t.id; emit('diagram'); },
            },
              h('span', { class: 'dot', style: `background:${t.color || tt.color}` }),
              h('span', { class: 'nm' }, `${t.number || '列車'}`,
                h('small', { class: 'desc' }, `${tt.name} ／ ${sts[t.fromIdx] ? sts[t.fromIdx].name : '?'} → ${sts[t.toIdx] ? sts[t.toIdx].name : '?'}`)),
              h('span', { class: 'num' }, `${fmtHM(t.departSec)}→${last && last.arr != null ? fmtHM(last.arr) : '--:--'}`));
          }))
        : h('p', { class: 'note' }, '種別を選んで列車を追加すると、スジが引かれます。ダイヤ上でスジを左右にドラッグすると発時刻を変えられます。'),
    ));

    if (sel) {
      const stops = computeSchedule(doc, sts, sel);
      out.push(h('div', { class: 'card' },
        h('h4', {}, `${sel.number || '列車'} の設定`),
        h('div', { class: 'row' },
          field('列車番号', textInput(`tr.${sel.id}.num`, sel.number, v => updateTrain(sel.id, { number: v }))),
          field('種別', selectInput(`tr.${sel.id}.type`, sel.type,
            TRAIN_TYPES.map(t => ({ value: t.id, label: t.name })),
            v => updateTrain(sel.id, { type: v, speedKmh: trainType(v).speed }))),
        ),
        h('div', { class: 'row' },
          field('始発', selectInput(`tr.${sel.id}.from`, String(sel.fromIdx),
            sts.map((s2, i) => ({ value: String(i), label: s2.name })),
            v => updateTrain(sel.id, { fromIdx: Number(v), dir: Number(v) <= sel.toIdx ? 'down' : 'up' }))),
          field('終着', selectInput(`tr.${sel.id}.to`, String(sel.toIdx),
            sts.map((s2, i) => ({ value: String(i), label: s2.name })),
            v => updateTrain(sel.id, { toIdx: Number(v), dir: sel.fromIdx <= Number(v) ? 'down' : 'up' }))),
        ),
        h('div', { class: 'row' },
          field('発時刻', (() => {
            const i = h('input', { type: 'text', value: fmtHM(sel.departSec), placeholder: '06:30' });
            i.dataset.key = `tr.${sel.id}.dep`;
            i.addEventListener('change', () => {
              const v = parseHM(i.value);
              if (v != null) updateTrain(sel.id, { departSec: v });
              else setMessage('時刻は 06:30 の形式で入力してください');
            });
            return i;
          })()),
          field('表定速度（km/h）', numberInput(`tr.${sel.id}.spd`, sel.speedKmh,
            v => updateTrain(sel.id, { speedKmh: Math.max(5, v || 60) }), { min: 5, step: 5 })),
        ),
        h('div', { class: 'row' },
          field('停車時分（秒）', numberInput(`tr.${sel.id}.dwell`, sel.dwellSec,
            v => updateTrain(sel.id, { dwellSec: Math.max(0, v || 0) }), { min: 0, step: 10 })),
          field('両数', numberInput(`tr.${sel.id}.cars`, sel.cars,
            v => updateTrain(sel.id, { cars: Math.max(1, Math.round(v || 1)) }), { min: 1, max: 30 })),
        ),
        field('使用編成', selectInput(`tr.${sel.id}.form`, sel.formationId || '',
          [{ value: '', label: '— 始発番線にいる編成を使う —' }, ...doc.formations.map(f => ({ value: f.id, label: `${f.name}（${f.cars}両）` }))],
          v => updateTrain(sel.id, { formationId: v || null }))),
        h('div', { class: 'checkline' },
          (() => {
            const i = h('input', { type: 'checkbox', checked: !!sel.toDepot });
            i.addEventListener('change', () => updateTrain(sel.id, { toDepot: i.checked }));
            return i;
          })(),
          h('span', {}, '終着後に入庫する（留置線へ）')),
        sel.toDepot
          ? field('入庫先の留置線', selectInput(`tr.${sel.id}.depot`, sel.depotTrackId || '',
            [{ value: '', label: '— 選択 —' }, ...doc.tracks.filter(t => trackKind(t.kind).stabling).map(t => ({ value: t.id, label: `${t.name}（${trackUsage(doc, t).capacity}両）` }))],
            v => updateTrain(sel.id, { depotTrackId: v || null })))
          : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn sm', onclick: () => { duplicateTrain(sel.id); emit('diagram'); } }, '複製'),
          h('button', {
            class: 'btn sm',
            onclick: () => {
              const fromSt = sts[sel.fromIdx], toSt = sts[sel.toIdx];
              const f = sel.formationId ? doc.formations.find(x => x.id === sel.formationId) : doc.formations.find(x => x.trackId === (fromSt && fromSt.trackId));
              if (!f || !toSt || !toSt.trackId) { setMessage('始発駅に在線する編成が見つかりません'); return; }
              planAdd(f.id, toSt.trackId);
              ui_showSim();
              setMessage(`${sel.number || '列車'} を運転の計画に追加しました`);
            },
          }, '▶ 運転に送る'),
          h('button', { class: 'btn sm danger', onclick: () => { deleteTrain(sel.id); emit('diagram'); } }, '削除'),
        ),
        h('hr', { class: 'sepline' }),
        h('div', { class: 'kv' }, h('span', {}, '駅'), h('b', {}, '着 / 発 ・ 番線')),
        ...stops.map(st => {
          const station = sts[st.idx];
          const list = station && station.object ? stationTracks(doc, station.object) : [];
          const cur = trainPlatform(doc, sel, sts, st.idx);
          return h('div', { style: 'margin-bottom:4px' },
            h('div', { class: 'kv' },
              h('span', {}, station ? station.name : '?'),
              h('b', {}, `${st.arr != null ? fmtHM(st.arr) : '　—'} / ${st.dep != null ? fmtHM(st.dep) : '　—'}${st.skip ? '（通過）' : ''}`)),
            list.length > 1
              ? selectInput(`tr.${sel.id}.pf.${st.idx}`, cur || '',
                list.map(id => ({ value: id, label: (doc.tracks.find(t => t.id === id) || {}).name || '?' })),
                v => updateTrain(sel.id, { platforms: { ...sel.platforms, [st.idx]: v } }))
              : h('p', { class: 'note', style: 'margin:0' }, list.length ? `番線: ${(doc.tracks.find(t => t.id === list[0]) || {}).name}` : '番線未設定'),
          );
        }),
      ));
    }

    // 配線との整合（番線数・留置本数）
    const demand = platformDemand(doc, sts, trains);
    const pfIssues = platformConflicts(doc, sts, trains);
    const stabling = doc.tracks.filter(t => trackKind(t.kind).stabling);
    const inbound = trains.filter(t => t.toDepot);
    const inboundCars = inbound.reduce((s2, t) => s2 + (t.cars || 10), 0);
    const freeCars = stabling.reduce((s2, t) => {
      const u = trackUsage(doc, t);
      return s2 + Math.max(0, u.capacity - u.cars);
    }, 0);
    out.push(h('div', { class: 'card' },
      h('h4', {}, '配線との整合'),
      h('div', { class: 'kv' }, h('span', {}, '留置線（配線）'), h('b', {}, `${stabling.length} 本・空き ${freeCars} 両`)),
      h('div', { class: 'kv' }, h('span', {}, '入庫する列車（ダイヤ）'), h('b', {}, `${inbound.length} 本・${inboundCars} 両`)),
      inbound.length > stabling.length || inboundCars > freeCars
        ? h('div', { class: 'warnbox' }, `⚠ 留置能力が不足しています（${inbound.length}本 ${inboundCars}両 ＞ ${stabling.length}本 ${freeCars}両）`)
        : h('p', { class: 'note' }, '✓ 入庫する列車は留置線に収まります'),
      h('hr', { class: 'sepline' }),
      h('div', { class: 'kv' }, h('span', {}, '駅'), h('b', {}, '必要 / 配線の番線')),
      ...demand.map(d2 => h('div', { class: 'listrow' },
        h('span', { class: 'dot', style: `background:${d2.short ? '#ff5f56' : (d2.available ? '#3ddc84' : '#5d6577')}` }),
        h('span', { class: 'nm' }, d2.station.name,
          d2.peakAt != null ? h('small', { class: 'desc' }, `ピーク ${fmtHM(d2.peakAt)}`) : null),
        h('span', { class: 'num' }, `${d2.peak} / ${d2.available || '—'}`))),
      demand.some(d2 => d2.short)
        ? h('div', { class: 'warnbox' }, '⚠ 番線が足りない駅があります。配線で着発線を増やすか、ダイヤの時刻をずらしてください。')
        : null,
      pfIssues.length
        ? h('div', { style: 'margin-top:6px' }, ...pfIssues.slice(0, 8).map(i => h('div', { class: 'listrow' },
          h('span', { class: 'dot', style: 'background:#ff5f56' }),
          h('span', { class: 'nm', style: 'white-space:normal' }, i.message))))
        : h('p', { class: 'note' }, '✓ 同じ番線の二重使用はありません'),
    ));

    const issues = timetableConflicts(doc, line, sts, trains);
    out.push(h('div', { class: 'card' },
      h('h4', {}, 'ダイヤの競合', h('span', { class: 'tag' }, `${issues.length} 件`)),
      issues.length
        ? h('div', {}, ...issues.slice(0, 12).map(is => h('div', { class: 'listrow' },
          h('span', { class: 'dot', style: `background:${is.level === 'error' ? '#ff5f56' : '#ffb020'}` }),
          h('span', { class: 'nm', style: 'white-space:normal' }, is.message))))
        : h('p', { class: 'note' }, '✓ 行き違い・続行の支障はありません'),
    ));
    return out;
  }

  function ui_showSim() { showTab('right', 'sim'); }

  /* ---------------- 設定 ---------------- */
  function buildSettings() {
    const st = store.doc.settings;
    const setS = (k, v) => { snapshot(); st[k] = v; commit('settings'); };
    return [
      h('div', { class: 'card' },
        h('h4', {}, 'プロジェクト'),
        field('名称', textInput('doc.name', store.doc.name, v => { store.doc.name = v; commit('rename'); }, '例: ○○車両センター')),
      ),
      h('div', { class: 'card' },
        h('h4', {}, '寸法・縮尺'),
        field('グリッド間隔（m）', numberInput('set.grid', st.gridM, v => setS('gridM', Math.max(1, v || 1)), { min: 1 })),
        field('標準 1両長（m）', numberInput('set.carlen', st.carLengthM, v => setS('carLengthM', Math.max(1, v || 20)), { min: 1, step: .5 })),
        field('線路端部の余裕長（m）', numberInput('set.clear', st.clearanceM, v => setS('clearanceM', Math.max(0, v || 0)), { min: 0 })),
        h('p', { class: 'note' }, '留置可能両数 =（線路延長 − 余裕長）÷ 1両長 の切り捨て'),
        field('線路中心間隔の最小値（m）', numberInput('set.sp', st.minTrackSpacingM, v => setS('minTrackSpacingM', Math.max(0, v || 0)), { min: 0, step: .1 })),
        field('建築限界の片側幅（m）', numberInput('set.cl', st.clearanceHalfM, v => setS('clearanceHalfM', Math.max(0, v || 0)), { min: 0, step: .1 })),
        h('p', { class: 'note' }, '線路どうしの離隔・構造物の支障の判定に使います（在来線の標準は中心間隔 4.0m 前後）。'),
        field('接続とみなす転向角の上限（度）', numberInput('set.turn', st.maxTurnDeg, v => setS('maxTurnDeg', Math.max(10, Math.min(170, v || 90))), { min: 10, max: 170, step: 5 })),
        h('p', { class: 'note' }, 'この角度を超える向きの変更は、経路探索で「折返し」が必要と判定されます。'),
      ),
      h('div', { class: 'card' },
        h('h4', {}, '表示'),
        checkbox('グリッドを表示', st.showGrid, v => setS('showGrid', v)),
        checkbox('線路名・両数を表示', st.showLabels, v => setS('showLabels', v)),
        checkbox('留置編成を表示', st.showFormations, v => setS('showFormations', v)),
        checkbox('スケールバーを表示', st.showRuler, v => setS('showRuler', v)),
        checkbox('線路の接続点を表示', st.showJunctions, v => setS('showJunctions', v)),
        checkbox('検証結果を図上に表示', st.showIssues, v => setS('showIssues', v)),
        checkbox('構成済みの進路を図上に表示', st.showRoutes !== false, v => setS('showRoutes', v)),
        h('hr', { class: 'sepline' }),
        checkbox('グリッドにスナップ（Altで一時解除）', st.snap, v => setS('snap', v)),
        checkbox('線路を45°刻みで敷設（Shiftで一時解除）', st.angle45, v => setS('angle45', v)),
      ),
      h('div', { class: 'card' },
        h('h4', {}, 'ショートカット'),
        h('p', {
          class: 'note', html:
            '<kbd>V</kbd> 選択 ／ <kbd>T</kbd> 線路 ／ <kbd>H</kbd> 画面移動<br>' +
            '<kbd>スペース</kbd>+ドラッグ / ホイールでズーム<br>' +
            '<kbd>R</kbd> 45°回転 ／ <kbd>F</kbd> 全体表示 ／ <kbd>G</kbd> グリッド<br>' +
            '<kbd>Enter</kbd> 敷設確定 ／ <kbd>Esc</kbd> 取消 ／ <kbd>Delete</kbd> 削除<br>' +
            '<kbd>Ctrl+Z</kbd> 元に戻す ／ <kbd>Ctrl+Shift+Z</kbd> やり直し ／ <kbd>Ctrl+D</kbd> 複製<br>' +
            '選択中の線路をダブルクリックで折点追加、折点をダブルクリックで削除'
        }),
      ),
    ];
  }

  /* ---------------- ステータスバー ---------------- */
  function buildStatus() {
    const s = summary(store.doc);
    const c = store.ui.cursor;
    els.statusPos.textContent = c ? `X ${c.x.toFixed(0)} m / Y ${c.y.toFixed(0)} m` : '— / —';
    els.statusSummary.textContent =
      `線路 ${s.tracks} 本・総延長 ${fmtM(s.totalLength)}／留置 ${s.cars}/${s.capacity} 両（${(s.rate * 100).toFixed(0)}%）／構造物 ${s.objects} 件`;
    els.statusMsg.textContent = store.ui.message || '';
    els.zoomLabel.textContent = `${Math.round(store.ui.camera.zoom * 100)}%`;
  }

  /* ---------------- 再描画 ---------------- */
  let raf = 0;
  function renderAll(reason) {
    if (reason === 'cursor') { buildStatus(); return; }
    if (reason === 'sim-tick') {
      withFocus(els.sim, buildSim, 'sim');
      buildStatus();
      return;
    }
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const sel = store.ui.sel;
      const selKey = sel ? `${sel.kind}:${sel.id}` : 'none';
      withFocus(els.palette, buildPalette, `${store.ui.tool}:${store.ui.placeType || ''}:${store.ui.trackKindId}`);
      withFocus(els.tracklist, buildTrackList, selKey);
      withFocus(els.inspector, buildInspector, selKey);
      withFocus(els.formations, buildFormations, selKey);
      withFocus(els.route, buildRoute, selKey);
      withFocus(els.sim, buildSim, 'sim');
      withFocus(els.timetable, buildTimetable, `tt:${(store.ui.diagram || {}).lineId}:${(store.ui.diagram || {}).selected}`);
      withFocus(els.settings, buildSettings, 'settings');
      buildStatus();
      document.querySelectorAll('#tools .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === store.ui.tool));
    });
  }

  subscribe(renderAll);
  renderAll('init');
  return { renderAll, showTab };
}
