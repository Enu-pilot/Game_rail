// エントリポイント: キャンバス・UI・ツールバーの結線

import { store, subscribe, emit, undo, redo, loadDoc, newDoc, restoreLocal, setMessage, snapshot, commit } from './store.js';
import { initCanvas } from './canvas.js';
import { initDiagram } from './diagram.js';
import { initUI } from './ui.js';
import { exportJSON, importJSON, exportPNG } from './io.js';
import { deleteSelected, duplicateSelected, autoDispatch } from './actions.js';
import { SAMPLES, sampleById } from './samples/index.js';

const canvas = document.getElementById('board');
const stage = document.getElementById('stage');

const diagramCanvas = document.getElementById('diagram');
const api = initCanvas(canvas, stage);
const diagram = initDiagram(diagramCanvas, stage);
api.diagram = diagram;
const ui = initUI(api);

/* ---- 配線図 / ダイヤ の切替 ---- */
let diagramFitted = false;
function setMode(mode) {
  store.ui.mode = mode;
  canvas.classList.toggle('hidden', mode !== 'layout');
  diagramCanvas.classList.toggle('hidden', mode !== 'diagram');
  document.querySelectorAll('#modes .tool').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('tools').style.opacity = mode === 'layout' ? '1' : '.4';
  if (mode === 'diagram') {
    diagram.resize();
    if (!diagramFitted) { diagram.fit(); diagramFitted = true; }
    diagram.invalidate();
    ui.showTab('right', 'timetable');
  }
  emit('mode');
}
api.setMode = setMode;
document.getElementById('modes').addEventListener('click', e => {
  const b = e.target.closest('.tool');
  if (b) setMode(b.dataset.mode);
});
store.ui.mode = 'layout';

/* ---- 初期ドキュメント ---- */
// 起動時は本線を除いた範囲（＝車両基地まわり）に合わせる
const initialFit = () => api.fitAll({ excludeKinds: ['main', 'platform'] });
/** サンプルは待避・行き違いを入れた状態で読み込む */
function loadSample(id = 'midori') {
  const s = sampleById(id);
  loadDoc(s.build());
  if (!s.dispatched) for (const l of store.doc.lines) autoDispatch(l.id, { silent: true });
}
if (!restoreLocal()) loadSample();
setTimeout(initialFit, 0);
emit('init');

/* ---- ツールバー ---- */
document.getElementById('tools').addEventListener('click', e => {
  const b = e.target.closest('.tool');
  if (b) api.setTool(b.dataset.tool);
});

const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
on('btn-undo', () => undo());
on('btn-redo', () => redo());
on('btn-delete', () => deleteSelected());
on('btn-zoom-in', () => api.zoomBy(1.25));
on('btn-zoom-out', () => api.zoomBy(1 / 1.25));
on('btn-zoom-fit', () => (store.ui.mode === 'diagram' ? diagram.fit() : api.fitAll()));
const sampleSel = document.getElementById('sample-select');
sampleSel.innerHTML = '<option value="">サンプル…</option>' + SAMPLES.map(s =>
  `<option value="${s.id}">${s.no ? `${s.no}. ` : ''}${s.name}</option>`).join('');
sampleSel.addEventListener('change', () => {
  const s = sampleById(sampleSel.value);
  sampleSel.value = '';
  if (!s || !confirm(`現在のレイアウトを破棄して「${s.name}」を読み込みますか？`)) return;
  setMessage(`「${s.name}」を作成しています…`);
  setTimeout(() => {
    const t0 = performance.now();
    loadSample(s.id); diagramFitted = false; api.fitAll();
    setMessage(`サンプル「${s.name}」を読み込みました（${Math.round(performance.now() - t0)} ms）`);
  }, 30);
});
on('btn-new', () => {
  if (!confirm('現在のレイアウトを破棄して新規作成しますか？')) return;
  loadDoc(newDoc()); api.fitAll(); setMessage('新規レイアウトを作成しました');
});
on('btn-export', () => exportJSON());
on('btn-png', () => exportPNG(2));

const fileInput = document.getElementById('file-input');
on('btn-import', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) importJSON(fileInput.files[0]);
  fileInput.value = '';
});

/* ---- Ctrl 系ショートカット ---- */
window.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (k === 'y') { e.preventDefault(); redo(); }
  else if (k === 's') { e.preventDefault(); exportJSON(); }
  else if (k === 'o') { e.preventDefault(); fileInput.click(); }
  else if (k === 'd') { e.preventDefault(); duplicateSelected(); }
});

/* ---- 離脱前に保存 ---- */
window.addEventListener('beforeunload', () => {
  try { localStorage.setItem('game_rail.depot.v1', JSON.stringify(store.doc)); } catch { }
});

/* ---- 選択に応じて右パネルを切り替え ---- */
let lastSel = null;
subscribe(reason => {
  const sel = store.ui.sel;
  const key = sel ? `${sel.kind}:${sel.id}` : null;
  if (key !== lastSel && sel && reason === 'select') ui.showTab('right', 'inspector');
  lastSel = key;
});

window.depot = { store, api, snapshot, commit };   // デバッグ用
