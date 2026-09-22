// サンプル車両基地（初回起動時に読み込まれるデモレイアウト）

import { newDoc, uid } from './store.js';
import { objectDef, FORMATION_COLORS } from './catalog.js';

const T = (name, kind, points, extra = {}) => ({
  id: uid('t'), name, kind, points, capacityMode: 'auto', capacity: 0, carLengthM: null, note: '', ...extra,
});
const O = (type, x, y, extra = {}) => {
  const d = objectDef(type);
  return { id: uid('b'), type, x, y, w: extra.w ?? d.w, h: extra.h ?? d.h, rot: (extra.rot ?? 0) * Math.PI / 180, label: extra.label ?? '', note: extra.note ?? '', trackId: null };
};

export function sampleDoc() {
  const doc = newDoc('みどりが丘車両センター');
  const t = [], o = [], f = [];

  /* ---- 駅部 ---- */
  t.push(T('下り本線', 'main', [{ x: 0, y: 40 }, { x: 1040, y: 40 }]));
  t.push(T('駅1番線', 'platform', [{ x: 60, y: 80 }, { x: 560, y: 80 }]));
  t.push(T('駅2番線', 'platform', [{ x: 60, y: 110 }, { x: 560, y: 110 }]));
  o.push(O('platform_island', 310, 95, { w: 300, h: 14, label: '1・2番線ホーム' }));
  o.push(O('platform_roof', 300, 95, { w: 200, h: 18 }));
  o.push(O('station_bldg', 180, 0, { w: 80, h: 34, label: 'みどりが丘駅 駅舎' }));
  o.push(O('ticket_gate', 180, 22, { w: 30, h: 10 }));
  o.push(O('overbridge', 420, 95, { w: 8, h: 70 }));
  o.push(O('elevator', 445, 95));
  o.push(O('signal_start', 545, 72, { label: '出発1L' }));
  o.push(O('signal_start', 545, 102, { label: '出発2L' }));

  /* ---- 入出区・引上 ---- */
  t.push(T('入出区線', 'entryexit', [{ x: 560, y: 110 }, { x: 640, y: 110 }, { x: 720, y: 190 }, { x: 900, y: 190 }]));
  t.push(T('入区線', 'entry', [{ x: 560, y: 80 }, { x: 660, y: 80 }, { x: 760, y: 180 }]));
  t.push(T('出区線', 'exit', [{ x: 900, y: 215 }, { x: 700, y: 215 }, { x: 600, y: 115 }]));
  t.push(T('引上線', 'shunting', [{ x: 900, y: 190 }, { x: 1040, y: 190 }]));
  o.push(O('buffer_stop', 1042, 190, { rot: 180 }));
  o.push(O('signal_shunt', 660, 176, { label: '入換1' }));
  o.push(O('signal_home', 890, 176, { label: '場内' }));
  o.push(O('turnout_single', 700, 190, { label: '11号' }));
  o.push(O('turnout_double', 760, 190, { label: '12号' }));
  o.push(O('point_machine', 700, 200));
  o.push(O('point_machine', 760, 200));
  o.push(O('crossover', 820, 202, { label: '13/14号' }));

  /* ---- 留置線群（ラダー配線） ---- */
  const stablingY0 = 250, pitch = 26, nTracks = 8;
  for (let i = 0; i < nTracks; i++) {
    const y = stablingY0 + pitch * i;
    const xEnd = 700 - i * 8;
    t.push(T(`${i + 1}番線`, 'stabling', [{ x: 340, y }, { x: xEnd, y }]));
    o.push(O('buffer_stop', 336, y, { rot: 0 }));
    o.push(O('turnout_single', xEnd + 6, y, { rot: 0, label: `${20 + i}号` }));
    o.push(O('point_machine', xEnd + 6, y + 9));
  }
  // 留置線群をまとめるラダー（入換）線
  t.push(T('ラダー線', 'shunting', [{ x: 740, y: 190 }, { x: 700, y: 250 }, { x: 700 - 7 * 8, y: 250 + 7 * 26 }]));
  o.push(O('clean_deck', 520, stablingY0, { w: 100, h: 8, label: '清掃台' }));
  o.push(O('shore_power', 370, stablingY0 + pitch, { label: '地上給電' }));

  /* ---- 検修庫 ---- */
  o.push(O('inspection_shed', 520, 500, { w: 360, h: 78, label: '検修庫' }));
  t.push(T('検修1番線', 'inspection', [{ x: 300, y: 480 }, { x: 760, y: 480 }]));
  t.push(T('検修2番線', 'inspection', [{ x: 300, y: 520 }, { x: 760, y: 520 }]));
  o.push(O('inspect_pit', 520, 480, { w: 200, h: 8, label: '検査台（ピット）' }));
  o.push(O('inspect_pit', 520, 520, { w: 200, h: 8, label: '検査台（ピット）' }));
  o.push(O('lifting_jack', 700, 520, { label: '車体ジャッキ' }));

  t.push(T('仕業検査線', 'daily', [{ x: 300, y: 570 }, { x: 800, y: 570 }]));
  o.push(O('inspect_pit', 560, 570, { w: 240, h: 8, label: '仕業検査ピット' }));
  t.push(T('交番検査線', 'periodic', [{ x: 300, y: 600 }, { x: 780, y: 600 }]));
  t.push(T('臨時検査線', 'special', [{ x: 300, y: 630 }, { x: 700, y: 630 }]));
  t.push(T('転削線', 'wheellathe', [{ x: 360, y: 665 }, { x: 700, y: 665 }]));
  o.push(O('wheel_lathe', 520, 665, { label: '車輪転削盤' }));

  /* ---- 洗浄線 ---- */
  t.push(T('洗浄線', 'washing', [{ x: 260, y: 710 }, { x: 860, y: 710 }]));
  o.push(O('car_washer', 520, 710, { label: '洗車機' }));
  o.push(O('water_waste', 640, 710, { label: '汚物抜取' }));

  /* ---- 試運転・解体・保守用車 ---- */
  t.push(T('試運転線', 'testrun', [{ x: 200, y: 760 }, { x: 1000, y: 760 }]));
  t.push(T('解体線', 'scrap', [{ x: 200, y: 800 }, { x: 420, y: 800 }]));
  t.push(T('保守用車基地', 'mow', [{ x: 200, y: 840 }, { x: 480, y: 840 }]));
  o.push(O('mow_base', 300, 870, { w: 80, h: 30, label: '保守用車庫' }));
  o.push(O('material', 560, 840, { w: 90, h: 36, label: '資材置場' }));

  /* ---- 事務所・職場 ---- */
  o.push(O('admin_office', 120, 300, { w: 70, h: 36, label: '管理事務所' }));
  o.push(O('crew_depot', 120, 360, { w: 70, h: 30, label: '乗務員区' }));
  o.push(O('driver_depot', 120, 400, { label: '運転区' }));
  o.push(O('conductor_depot', 120, 435, { label: '車掌区' }));
  o.push(O('training', 120, 480, { w: 70, h: 32, label: '研修センター' }));
  o.push(O('parts_shop', 130, 540, { label: '部品職場' }));
  o.push(O('electric_shop', 130, 575, { label: '電機職場' }));
  o.push(O('bogie_shop', 130, 610, { label: '台車職場' }));
  o.push(O('inspect_shop', 130, 645, { label: '検査職場' }));
  o.push(O('warehouse', 130, 690, { label: '資材倉庫' }));
  o.push(O('substation', 950, 300, { label: '変電所' }));
  o.push(O('parking', 120, 180, { w: 90, h: 44, label: '駐車場' }));
  o.push(O('gatehouse', 60, 230, { label: '守衛所' }));
  o.push(O('label', 780, 300, { w: 60, h: 14, label: '留置線群（1〜8番線）' }));

  /* ---- 編成 ---- */
  const stabling = t.filter(x => x.kind === 'stabling');
  const plan = [
    ['H01編成', 'E233系', 10], ['H02編成', 'E233系', 10], ['H03編成', 'E233系', 10],
    ['H04編成', 'E233系', 10], ['H05編成', 'E233系', 8], ['K11編成', '209系', 6],
    ['K12編成', '209系', 6], ['M21編成', 'E231系', 10],
  ];
  plan.forEach(([name, series, cars], i) => {
    f.push({
      id: uid('f'), name, series, cars, carLengthM: null,
      color: FORMATION_COLORS[i % FORMATION_COLORS.length],
      trackId: i < stabling.length ? stabling[i].id : null, note: '',
    });
  });
  const insp = t.find(x => x.name === '検修1番線');
  f.push({ id: uid('f'), name: 'H06編成', series: 'E233系', cars: 10, carLengthM: null, color: FORMATION_COLORS[8], trackId: insp.id, note: '交番検査中' });
  f.push({ id: uid('f'), name: 'W01', series: '保守用車', cars: 2, carLengthM: 12, color: '#c8a24a', trackId: t.find(x => x.kind === 'mow').id, note: 'モーターカー' });

  doc.tracks = t; doc.objects = o; doc.formations = f;
  return doc;
}
