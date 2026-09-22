// サイドパネル UI（パレット / 線路一覧 / プロパティ / 編成 / 設定）

import {
  store, subscribe, emit, snapshot, commit, setMessage,
  trackLength, trackCapacity, trackUsage, trackCarLength, formationLength, formationCars, formationCarLength, summary,
  findTrack, findObject, findFormation,
} from './store.js';
import {
  TRACK_KINDS, OBJECT_GROUPS, objectDef, trackKind, FORMATION_COLORS,
  TURNOUT_NUMBERS, turnoutSize, VEHICLE_TYPES, LOCO_TYPES, vehicleDef,
} from './catalog.js';
import { getGraph, findRoute, validateLayout, END_TYPES, endType } from './topology.js';
import { layoutChecks } from './checks.js';
import {
  addFormation, deleteSelected, duplicateSelected, assignFormation,
  updateEntity, reverseTrack,
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
    const out = [];
    out.push(h('div', { class: 'card' },
      h('h4', {}, def.name, h('span', { class: 'tag' }, def.groupName || '')),
      field('表示名', textInput(`obj.${o.id}.label`, o.label, v => updateEntity('object', o.id, { label: v }, { history: false }), def.name)),
      h('div', { class: 'row' },
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
        Math.round((o.xang ?? Math.atan2(o.h, o.w)) * 180 / Math.PI),
        v => {
          const a = Math.max(5, Math.min(90, v || 45)) * Math.PI / 180;
          updateEntity('object', o.id, { xang: a, h: Math.max(4, Math.round(Math.abs(o.w * Math.sin(a)) * 10) / 10) }, { history: false });
        }, { min: 5, max: 90, step: 5 })) : null,
      def.shape === 'turnout' && def.variant !== 'diamond' ? h('div', { class: 'field' },
        h('label', {}, '分岐器の番数'),
        selectInput(`obj.${o.id}.frog`, String(o.frog ?? ''),
          [{ value: '', label: '手動サイズ' }, ...TURNOUT_NUMBERS.map(n => ({ value: String(n), label: `#${n}（全長 ${turnoutSize(def.variant, n).w}m）` }))],
          v => {
            if (!v) { updateEntity('object', o.id, { frog: null }, { history: false }); return; }
            const n = Number(v);
            const sz = turnoutSize(def.variant, n);
            updateEntity('object', o.id, { frog: n, w: sz.w, h: sz.h }, { history: false });
          }),
        h('p', { class: 'note' }, o.frog
          ? `#${o.frog}：全長 ${o.w}m・開き ${o.h}m（分岐角 約${(180 / Math.PI * Math.atan(1 / o.frog)).toFixed(1)}°）`
          : '幅・奥行を直接編集するか、キャンバス上の四隅をドラッグして変形できます'),
      ) : null,
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
  const routeForm = { fromId: '', toId: '', formationId: '', cars: 10 };
  let routeResult = null;

  function runRouteSearch() {
    const doc = store.doc;
    const g = graph();
    const f = routeForm.formationId ? findFormation(routeForm.formationId) : null;
    const trainLength = f ? formationLength(doc, f) : Math.max(0, routeForm.cars) * doc.settings.carLengthM;
    const base = { fromTrackId: routeForm.fromId, toTrackId: routeForm.toId, trainLength };
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
      }
    }

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
      withFocus(els.settings, buildSettings, 'settings');
      buildStatus();
      document.querySelectorAll('#tools .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === store.ui.tool));
    });
  }

  subscribe(renderAll);
  renderAll('init');
  return { renderAll, showTab };
}
