// エントリポイント: キャンバス・UI・ツールバーの結線

import { store, subscribe, emit, undo, redo, loadDoc, newDoc, restoreLocal, setMessage, snapshot, commit } from './store.js';
import { initCanvas } from './canvas.js';
import { initUI } from './ui.js';
import { exportJSON, importJSON, exportPNG } from './io.js';
import { deleteSelected, duplicateSelected } from './actions.js';
import { sampleDoc } from './sample.js';

const canvas = document.getElementById('board');
const stage = document.getElementById('stage');

const api = initCanvas(canvas, stage);
const ui = initUI(api);

/* ---- 初期ドキュメント ---- */
if (!restoreLocal()) {
  loadDoc(sampleDoc());
  setTimeout(() => api.fitAll(), 0);
} else {
  setTimeout(() => api.fitAll(), 0);
}
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
on('btn-zoom-fit', () => api.fitAll());
on('btn-sample', () => {
  if (!confirm('現在のレイアウトを破棄してサンプル（みどりが丘車両センター）を読み込みますか？')) return;
  loadDoc(sampleDoc()); api.fitAll(); setMessage('サンプルレイアウトを読み込みました');
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
