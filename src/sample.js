// サンプル車両基地（初回起動時に読み込まれるデモレイアウト）
// 線路どうしが実際に接続しているため、入換経路の検証をそのまま試せる

import { newDoc, uid } from './store.js';
import { objectDef, FORMATION_COLORS, turnoutSize } from './catalog.js';

const T = (name, kind, points, extra = {}) => ({
  id: uid('t'), name, kind, points,
  capacityMode: 'auto', capacity: 0, carLengthM: null,
  ends: { a: extra.a || 'open', b: extra.b || 'open' },
  note: extra.note || '',
});
const O = (type, x, y, extra = {}) => {
  const d = objectDef(type);
  const frog = extra.frog ?? d.frog ?? null;
  const sz = (d.shape === 'turnout' && frog) ? turnoutSize(d.variant, frog) : null;
  return {
    id: uid('b'), type, x, y,
    w: extra.w ?? (sz ? sz.w : d.w), h: extra.h ?? (sz ? sz.h : d.h),
    rot: (extra.rot ?? 0) * Math.PI / 180,
    frog: extra.frog ?? d.frog ?? null,
    label: extra.label ?? '', note: extra.note ?? '', trackId: null,
  };
};

export function sampleDoc() {
  const doc = newDoc('みどりが丘車両センター');
  const t = [], o = [], f = [];

  // 基地を貫くラダー（入換）線。各線はこの線上に取り付く
  const LAD = { x0: 700, y0: 250, x1: 506, y1: 880 };
  const ladderX = y => LAD.x0 + (LAD.x1 - LAD.x0) * (y - LAD.y0) / (LAD.y1 - LAD.y0);
  const ladderDeg = Math.atan2(LAD.y1 - LAD.y0, LAD.x1 - LAD.x0) * 180 / Math.PI;

  /* ---- 駅部（本線から分岐する2面2線） ---- */
  t.push(T('本線', 'main', [{ x: 0, y: 40 }, { x: 1180, y: 40 }], { a: 'boundary', b: 'boundary' }));
  t.push(T('駅1番線', 'platform', [{ x: 140, y: 40 }, { x: 200, y: 80 }, { x: 520, y: 80 }, { x: 580, y: 40 }]));
  t.push(T('駅2番線', 'platform', [{ x: 200, y: 80 }, { x: 240, y: 110 }, { x: 500, y: 110 }, { x: 520, y: 80 }]));
  o.push(O('platform_island', 370, 95, { w: 250, h: 14, label: '1・2番線ホーム' }));
  o.push(O('platform_roof', 360, 95, { w: 170, h: 18 }));
  o.push(O('station_bldg', 300, 0, { w: 80, h: 32, label: 'みどりが丘駅 駅舎' }));
  o.push(O('ticket_gate', 300, 24, { w: 30, h: 10 }));
  o.push(O('overbridge', 430, 95, { w: 8, h: 56 }));
  o.push(O('elevator', 452, 95));
  o.push(O('turnout_single', 140, 40, { frog: 12, rot: 34 }));
  o.push(O('turnout_single', 580, 40, { frog: 12, rot: 214 }));
  o.push(O('signal_start', 505, 72, { label: '出発1L' }));
  o.push(O('signal_start', 487, 102, { label: '出発2L' }));

  /* ---- 入出区線・出区線・引上線 ---- */
  t.push(T('入出区線', 'entryexit', [{ x: 500, y: 110 }, { x: 620, y: 110 }, { x: 720, y: 190 }, { x: 900, y: 190 }]));
  t.push(T('出区線', 'exit', [{ x: 520, y: 80 }, { x: 700, y: 80 }, { x: 760, y: 140 }, { x: 800, y: 190 }]));
  t.push(T('引上線', 'shunting', [{ x: 900, y: 190 }, { x: 1180, y: 190 }], { b: 'buffer', note: '最長編成（10両=200m）が収まる有効長' }));
  o.push(O('signal_home', 640, 176, { label: '場内' }));
  o.push(O('signal_shunt', 900, 176, { label: '入換2' }));
  o.push(O('turnout_single', 800, 190, { frog: 10, rot: 231 }));
  o.push(O('point_machine', 800, 199));

  /* ---- ラダー線 ---- */
  t.push(T('ラダー線', 'shunting', [{ x: 740, y: 190 }, { x: LAD.x0, y: LAD.y0 }, { x: LAD.x1, y: LAD.y1 }], { b: 'buffer' }));
  o.push(O('signal_shunt', 726, 206, { label: '入換1' }));

  /* ---- 留置線群 ---- */
  const y0 = 250, pitch = 26, n = 8;
  for (let i = 0; i < n; i++) {
    const y = y0 + pitch * i, xEnd = Math.round(ladderX(y) * 10) / 10;
    t.push(T(`${i + 1}番線`, 'stabling', [{ x: 340, y }, { x: xEnd, y }], { a: 'buffer' }));
    o.push(O('turnout_single', xEnd, y, { frog: 8, rot: ladderDeg, label: `${20 + i}号` }));
    o.push(O('point_machine', xEnd + 5, y + 7));
  }
  o.push(O('clean_deck', 520, y0, { w: 100, h: 8, label: '清掃台' }));
  o.push(O('shore_power', 380, y0 + pitch, { label: '地上給電' }));
  o.push(O('label', 830, 330, { w: 60, h: 14, label: '留置線群（1〜8番線）' }));

  /* ---- 検修・洗浄・その他エリア ---- */
  const lower = [
    ['検修1番線', 'inspection', 330, 480, 'buffer'],
    ['検修2番線', 'inspection', 330, 520, 'buffer'],
    ['仕業検査線', 'daily', 300, 570, 'buffer'],
    ['交番検査線', 'periodic', 300, 610, 'buffer'],
    ['臨時検査線', 'special', 320, 650, 'buffer'],
    ['転削線', 'wheellathe', 360, 690, 'buffer'],
    ['洗浄線', 'washing', 240, 730, 'buffer'],
    ['試運転線', 'testrun', 0, 780, 'boundary'],
    ['解体線', 'scrap', 340, 820, 'buffer'],
    ['保守用車基地', 'mow', 300, 860, 'buffer'],
  ];
  for (const [name, kind, xLeft, y, endA] of lower) {
    const xr = Math.round(ladderX(y) * 10) / 10;
    t.push(T(name, kind, [{ x: xLeft, y }, { x: xr, y }], { a: endA }));
    o.push(O('turnout_single', xr, y, { frog: 10, rot: ladderDeg }));
  }

  o.push(O('inspection_shed', 480, 500, { w: 290, h: 84, label: '検修庫' }));
  o.push(O('inspect_pit', 480, 480, { w: 220, h: 8, label: '検査台（ピット）' }));
  o.push(O('inspect_pit', 480, 520, { w: 220, h: 8, label: '検査台（ピット）' }));
  o.push(O('lifting_jack', 600, 520, { label: '車体ジャッキ' }));
  o.push(O('inspect_pit', 450, 570, { w: 240, h: 8, label: '仕業検査ピット' }));
  o.push(O('wheel_lathe', 480, 690, { label: '車輪転削盤' }));
  o.push(O('car_washer', 400, 730, { label: '洗車機' }));
  o.push(O('water_waste', 480, 730, { label: '汚物抜取' }));
  o.push(O('mow_base', 380, 900, { w: 80, h: 30, label: '保守用車庫' }));
  o.push(O('material', 620, 900, { w: 90, h: 36, label: '資材置場' }));

  /* ---- 事務所・職場 ---- */
  o.push(O('admin_office', 100, 300, { w: 70, h: 36, label: '管理事務所' }));
  o.push(O('crew_depot', 100, 360, { w: 70, h: 30, label: '乗務員区' }));
  o.push(O('driver_depot', 100, 400, { label: '運転区' }));
  o.push(O('conductor_depot', 100, 435, { label: '車掌区' }));
  o.push(O('training', 100, 480, { w: 70, h: 32, label: '研修センター' }));
  o.push(O('parts_shop', 110, 540, { label: '部品職場' }));
  o.push(O('electric_shop', 110, 575, { label: '電機職場' }));
  o.push(O('bogie_shop', 110, 610, { label: '台車職場' }));
  o.push(O('inspect_shop', 110, 645, { label: '検査職場' }));
  o.push(O('warehouse', 110, 690, { label: '資材倉庫' }));
  o.push(O('substation', 1000, 300, { label: '変電所' }));
  o.push(O('parking', 110, 180, { w: 90, h: 44, label: '駐車場' }));
  o.push(O('gatehouse', 50, 230, { label: '守衛所' }));

  /* ---- 編成 ---- */
  const stabling = t.filter(x => x.kind === 'stabling');
  const plan = [
    ['H01編成', 'E233系', 10], ['H02編成', 'E233系', 10], ['H03編成', 'E233系', 10],
    ['H04編成', 'E233系', 10], ['H05編成', 'E233系', 8], ['K11編成', '209系', 6],
    ['K12編成', '209系', 6],
  ];
  plan.forEach(([name, series, cars], i) => {
    f.push({
      id: uid('f'), name, series, cars, carLengthM: null,
      color: FORMATION_COLORS[i % FORMATION_COLORS.length],
      trackId: stabling[i] ? stabling[i].id : null, note: '',
    });
  });
  f.push({
    id: uid('f'), name: 'H06編成', series: 'E233系', cars: 10, carLengthM: null,
    color: FORMATION_COLORS[7], trackId: t.find(x => x.name === '検修1番線').id, note: '交番検査中',
  });
  f.push({
    id: uid('f'), name: 'W01', series: '保守用車', cars: 2, carLengthM: 12,
    color: '#c8a24a', trackId: t.find(x => x.kind === 'mow').id, note: 'モーターカー',
  });

  doc.tracks = t; doc.objects = o; doc.formations = f;
  return doc;
}
