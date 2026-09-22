// 保存 / 読込 / 画像書き出し

import { store, migrate, loadDoc, setMessage } from './store.js';
import { render, contentBounds } from './render.js';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJSON() {
  const data = JSON.stringify(store.doc, null, 2);
  download(new Blob([data], { type: 'application/json' }), `${store.doc.name || 'depot'}_${stamp()}.json`);
  setMessage('JSONファイルを書き出しました');
}

export function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const doc = migrate(JSON.parse(String(reader.result)));
      loadDoc(doc);
      setMessage(`${doc.name} を読み込みました`);
    } catch (e) {
      setMessage('読み込みに失敗しました: ' + e.message);
    }
  };
  reader.readAsText(file);
}

export function exportPNG(scale = 2) {
  const doc = store.doc;
  const b = contentBounds(doc);
  const pad = 40;
  const w = Math.max(200, b.x1 - b.x0) + pad * 2;
  const h = Math.max(200, b.y1 - b.y0) + pad * 2;
  const zoom = Math.min(scale, 8000 / Math.max(w, h));
  const cw = Math.round(w * zoom), ch = Math.round(h * zoom);
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  const ui = {
    camera: { x: b.x0 - pad, y: b.y0 - pad, zoom },
    sel: null, draft: null, tool: 'select', cursor: null,
  };
  render(ctx, cw, ch, doc, ui);
  // タイトル
  ctx.save();
  ctx.font = '600 20px "Noto Sans JP",system-ui,sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(12, 12, ctx.measureText(doc.name).width + 24, 34);
  ctx.fillStyle = '#e6eaf3';
  ctx.textBaseline = 'middle';
  ctx.fillText(doc.name, 24, 30);
  ctx.restore();
  cv.toBlob(blob => {
    download(blob, `${doc.name || 'depot'}_${stamp()}.png`);
    setMessage('PNG画像を書き出しました');
  }, 'image/png');
}
