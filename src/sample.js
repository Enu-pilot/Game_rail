// サンプル車両基地（初回起動時に読み込まれるデモレイアウト）
// 線路どうしが実際に接続しているため、入換経路の検証をそのまま試せる

import { newDoc, uid } from './store.js';
import { objectDef, FORMATION_COLORS, TURNOUT_TYPE_BY_VARIANT } from './catalog.js';
import { buildGraph, junctionNodes, turnoutSpecAt } from './topology.js';
import { TRACK_KIND_MAP } from './catalog.js';
import { polylineLength, pointAt, distToPolyline } from './geom.js';
import { initCompany } from './company.js';

const T = (name, kind, points, extra = {}) => ({
  id: uid('t'), name, kind, points,
  capacityMode: 'auto', capacity: 0, carLengthM: null,
  ends: { a: extra.a || 'open', b: extra.b || 'open' },
  note: extra.note || '',
});
const O = (type, x, y, extra = {}) => {
  const d = objectDef(type);
  return {
    id: uid('b'), type, x, y,
    w: extra.w ?? d.w, h: extra.h ?? d.h,
    rot: (extra.rot ?? 0) * Math.PI / 180,
    label: extra.label ?? '', note: extra.note ?? '', trackId: null,
  };
};

const trackKindIsDepot = kind => {
  const k = TRACK_KIND_MAP[kind];
  return !!(k && k.stabling);
};

export function sampleDoc() {
  const doc = newDoc('みどりが丘車両センター');
  const t = [], o = [], f = [];

  // 基地を貫くラダー（入換）線。各線はこの線上に取り付く
  const LAD = { x0: 700, y0: 250, x1: 506, y1: 880 };
  const ladderX = y => LAD.x0 + (LAD.x1 - LAD.x0) * (y - LAD.y0) / (LAD.y1 - LAD.y0);
  const ladderDeg = Math.atan2(LAD.y1 - LAD.y0, LAD.x1 - LAD.x0) * 180 / Math.PI;

  /* ---- 駅部（本線から分岐する2面2線） ---- */
  t.push(T('本線', 'main', [{ x: -1100, y: 40 }, { x: 2700, y: 40 }], { a: 'boundary', b: 'boundary' }));
  t.push(T('駅1番線', 'platform', [{ x: 140, y: 40 }, { x: 200, y: 80 }, { x: 520, y: 80 }, { x: 580, y: 40 }]));
  t.push(T('駅2番線', 'platform', [{ x: 200, y: 80 }, { x: 240, y: 110 }, { x: 500, y: 110 }, { x: 520, y: 80 }]));
  o.push(O('platform_island', 370, 95, { w: 250, h: 14, label: '1・2番線ホーム' }));
  o.push(O('platform_roof', 360, 95, { w: 170, h: 18 }));
  o.push(O('station_bldg', 300, 0, { w: 80, h: 32, label: 'みどりが丘駅 駅舎' }));
  o.push(O('ticket_gate', 300, 24, { w: 30, h: 10 }));
  o.push(O('overbridge', 430, 95, { w: 8, h: 56 }));
  o.push(O('elevator', 452, 95));
  o.push(O('stairs', 430, 60, { rot: 90, label: '跨線橋 階段' }));
  o.push(O('stairs', 430, 130, { rot: 90 }));
  o.push(O('escalator', 446, 130, { rot: 90 }));

  /* ---- 入出区線・出区線・引上線 ---- */
  t.push(T('入出区線', 'entryexit', [{ x: 500, y: 110 }, { x: 620, y: 110 }, { x: 720, y: 190 }, { x: 900, y: 190 }]));
  t.push(T('出区線', 'exit', [{ x: 520, y: 80 }, { x: 700, y: 80 }, { x: 760, y: 140 }, { x: 800, y: 190 }]));
  t.push(T('引上線', 'shunting', [{ x: 900, y: 190 }, { x: 1180, y: 190 }], { b: 'buffer', note: '最長編成（10両=200m）が収まる有効長' }));

  /* ---- ラダー線 ---- */
  t.push(T('ラダー線', 'shunting', [{ x: 740, y: 190 }, { x: LAD.x0, y: LAD.y0 }, { x: LAD.x1, y: LAD.y1 }], { b: 'buffer' }));

  /* ---- 留置線群 ---- */
  const y0 = 250, pitch = 26, n = 8;
  for (let i = 0; i < n; i++) {
    const y = y0 + pitch * i, xEnd = Math.round(ladderX(y) * 10) / 10;
    t.push(T(`${i + 1}番線`, 'stabling', [{ x: 340, y }, { x: xEnd, y }], { a: 'buffer' }));
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

  /* ---- 機関区（転車台・扇形庫） ---- */
  const TT = { x: 250, y: 960, d: 24 };
  o.push(O('turntable', TT.x, TT.y, { w: TT.d, h: TT.d, rot: 0, label: '転車台' }));
  o.push(O('roundhouse', TT.x, TT.y, { w: 120, h: 120, rot: 180, label: '扇形庫' }));
  t.push(T('機関区連絡線', 'shunting',
    [{ x: 400, y: 860 }, { x: 400, y: 900 }, { x: 330, y: 960 }, { x: TT.x + TT.d / 2, y: TT.y }]));
  [150, 180, 210].forEach((deg, i) => {
    const a = deg * Math.PI / 180;
    const p0 = { x: Math.round((TT.x + Math.cos(a) * (TT.d / 2)) * 10) / 10, y: Math.round((TT.y + Math.sin(a) * (TT.d / 2)) * 10) / 10 };
    const p1 = { x: Math.round((TT.x + Math.cos(a) * 58) * 10) / 10, y: Math.round((TT.y + Math.sin(a) * 58) * 10) / 10 };
    t.push(T(`扇形庫${i + 1}番線`, 'inspection', [p1, p0], { a: 'buffer' }));
  });

  /* ---- 本線の駅（ダイヤ用） ---- */
  const mainLine = t.find(x => x.name === '本線');
  const station = (name, x, extra = {}) => {
    o.push({
      id: uid('b'), type: 'station_mark', x, y: 40, w: 10, h: 10, rot: 0,
      mirror: false, position: 0, dir: 'ab',
      population: extra.population ?? 20000, jobs: extra.jobs ?? 4000,
      kindId: extra.kindId || 'residential',
      label: name, note: '', trackId: mainLine.id,
    });
    return o[o.length - 1];
  };
  // 東川は交換設備のある中間駅。西山・海岸は折返し用の副本線を持つ
  t.push(T('東川1番線', 'platform', [{ x: 1500, y: 40 }, { x: 1560, y: 75 }, { x: 1780, y: 75 }, { x: 1840, y: 40 }]));
  t.push(T('西山2番線', 'platform', [{ x: -1090, y: 40 }, { x: -1040, y: 75 }, { x: -860, y: 75 }, { x: -810, y: 40 }]));
  // 終端駅の電留線（夜間滞泊用）
  t.push(T('西山電留線', 'stabling', [{ x: -1020, y: 75 }, { x: -975, y: 132 }, { x: -790, y: 132 }], { b: 'buffer' }));
  t.push(T('海岸2番線', 'platform', [{ x: 2340, y: 40 }, { x: 2390, y: 75 }, { x: 2610, y: 75 }, { x: 2660, y: 40 }]));
  o.push(O('platform_side', 1670, 90, { w: 160, h: 8, label: '東川ホーム' }));
  o.push(O('station_bldg', 1670, 130, { w: 50, h: 24, label: '東川駅' }));
  o.push(O('platform_side', 2500, 66, { w: 140, h: 8, label: '海岸ホーム' }));
  o.push(O('station_bldg', 2500, 100, { w: 50, h: 24, label: '海岸駅' }));
  o.push(O('platform_side', -950, 66, { w: 140, h: 8, label: '西山ホーム' }));
  o.push(O('station_bldg', -950, 100, { w: 50, h: 24, label: '西山駅' }));
  o.push(O('platform_side', -350, 66, { w: 120, h: 8, label: '桜台ホーム' }));
  o.push(O('platform_side', 1150, 66, { w: 120, h: 8, label: '中原ホーム' }));
  const stW = station('西山', -950, { population: 52000, jobs: 6000, kindId: 'residential' });
  const stS = station('桜台', -350, { population: 39000, jobs: 4400, kindId: 'residential' });
  const stM = station('みどりが丘', 360, { population: 85000, jobs: 15000, kindId: 'mixed' });
  const stN = station('中原', 1150, { population: 17500, jobs: 32000, kindId: 'business' });
  const stH = station('東川', 1670, { population: 31000, jobs: 11000, kindId: 'school' });
  const stK = station('海岸', 2500, { population: 22500, jobs: 57000, kindId: 'urban' });
  // 駅間は配線図では省略し、キロ程だけ実距離にする
  const gap = (x, km) => o.push({
    id: uid('b'), type: 'gap_break', x, y: 40, w: 12, h: 16, rot: 0,
    mirror: false, position: 0, dir: 'ab', tracks: [], extraM: km * 1000,
    label: '', note: '', trackId: mainLine.id,
  });
  gap(-660, 3.2);   // 西山〜桜台
  gap(-120, 2.8);   // 桜台〜みどりが丘
  gap(760, 4.2);    // みどりが丘〜中原
  gap(1380, 3.2);   // 中原〜東川
  gap(2120, 4.6);   // 東川〜海岸
  // 駅の番線（配線と連携）
  const trackId = nm => (t.find(x => x.name === nm) || {}).id;
  stW.tracks = [mainLine.id, trackId('西山2番線')].filter(Boolean);
  stS.tracks = [mainLine.id];
  stM.tracks = [trackId('駅1番線'), trackId('駅2番線')].filter(Boolean);
  stN.tracks = [mainLine.id];
  stH.tracks = [mainLine.id, trackId('東川1番線')].filter(Boolean);
  stK.tracks = [mainLine.id, trackId('海岸2番線')].filter(Boolean);

  /* ---- 信号機を線路に紐づける ---- */
  const attachSignal = (type, trackName, atFromEnd, dir, label) => {
    const tr = t.find(x => x.name === trackName);
    if (!tr) return;
    const len = polylineLength(tr.points);
    const at = dir === 'ab' ? Math.max(0, len - atFromEnd) : Math.min(len, atFromEnd);
    const p = pointAt(tr.points, at);
    o.push({
      id: uid('b'), type, x: p.x, y: p.y, w: 5, h: 5, rot: p.angle,
      mirror: false, position: 0, dir,
      label: label || '', note: '', trackId: tr.id,
    });
  };
  // 留置線の出発信号機（ラダー側へ出るときに現示する）
  for (let i = 0; i < 3; i++) attachSignal('signal_shunt', `${i + 1}番線`, 25, 'ab', `入換${i + 1}`);
  attachSignal('signal_start', '駅1番線', 30, 'ab', '出発1L');
  attachSignal('signal_start', '駅2番線', 30, 'ab', '出発2L');
  attachSignal('signal_home', '入出区線', 40, 'ba', '場内');
  attachSignal('signal_shunt', '引上線', 30, 'ba', '入換2');
  attachSignal('signal_shunt', '洗浄線', 25, 'ba', '入換3');

  /* ---- 分岐器・転轍機を接続点から自動生成 ---- */
  const tmp = { ...doc, tracks: t, objects: o, formations: [] };
  const g = buildGraph(tmp);
  const junctions = junctionNodes(g).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  let no = 0;
  for (const nd of junctions) {
    const spec = turnoutSpecAt(tmp, g, nd.id);
    if (!spec) continue;
    const type = TURNOUT_TYPE_BY_VARIANT[spec.variant] || 'turnout_single';
    const d = objectDef(type);
    o.push({
      id: uid('b'), type, x: spec.x, y: spec.y, w: d.w, h: d.h, rot: spec.rot,
      mirror: !!spec.mirror, label: `${++no}号`, note: '', trackId: null,
    });
    // 転轍機は基準線の側方に配置
    o.push({
      id: uid('b'), type: 'point_machine',
      x: spec.x + Math.sin(spec.rot) * (spec.mirror ? -7 : 7) * -1,
      y: spec.y + Math.cos(spec.rot) * (spec.mirror ? -7 : 7),
      w: 6, h: 6, rot: spec.rot, mirror: false, label: '', note: '', trackId: null,
    });
  }

  /* ---- 編成 ---- */
  const stabling = t.filter(x => x.kind === 'stabling');
  // 9運用を回せる陣容（10両編成 × 8本を留置線に、1本を洗浄線に、1本は交番検査中）
  const plan = [
    ['H01編成', 'E233系', 8], ['H02編成', 'E233系', 8], ['H03編成', 'E233系', 8],
    ['H04編成', 'E233系', 8], ['H05編成', 'E233系', 8], ['H06編成', 'E233系', 8],
    ['H07編成', 'E233系', 8], ['H08編成', 'E233系', 8],
  ];
  plan.forEach(([name, series, cars], i) => {
    f.push({
      id: uid('f'), name, series, vehicle: 'emu', cars, carLengthM: null, loco: null,
      color: FORMATION_COLORS[i % FORMATION_COLORS.length],
      trackId: stabling[i] ? stabling[i].id : null, note: '',
    });
  });
  // 1〜3番線は2編成ずつ留置（予備車）
  [['H11編成', 0], ['H12編成', 1], ['H13編成', 2], ['H14編成', 3]].forEach(([name, i], k) => {
    f.push({
      id: uid('f'), name, series: 'E233系', vehicle: 'emu', cars: 8, carLengthM: null, loco: null,
      color: FORMATION_COLORS[(8 + k) % FORMATION_COLORS.length],
      trackId: stabling[i] ? stabling[i].id : null, note: '',
    });
  });
  const track = nm => (t.find(x => x.name === nm) || {}).id || null;
  f.push({
    id: uid('f'), name: 'キハ48-1500', series: 'キハ48形', vehicle: 'dmu', cars: 2,
    carLengthM: null, loco: null, color: '#e0894a', trackId: track('8番線'), note: '',
  });
  f.push({
    id: uid('f'), name: '12系客車', series: '12系', vehicle: 'coach', cars: 5,
    carLengthM: null, loco: { type: 'dl', count: 1 }, color: '#b5654a',
    trackId: track('臨時検査線'), note: 'DD51牽引の団体臨時列車',
  });
  f.push({
    id: uid('f'), name: '廃車回送', series: 'ワム80000', vehicle: 'freight', cars: 5,
    carLengthM: null, loco: { type: 'el', count: 1 }, color: '#8b8172',
    trackId: track('解体線'), note: '',
  });
  f.push({
    id: uid('f'), name: 'C57 1', series: 'C57形', vehicle: 'sl', cars: 1,
    carLengthM: null, loco: null, color: '#7a8190',
    trackId: track('扇形庫1番線'), note: '動態保存機',
  });
  f.push({
    id: uid('f'), name: 'EF64 37', series: 'EF64形', vehicle: 'el', cars: 1,
    carLengthM: null, loco: null, color: '#6f90c0',
    trackId: track('扇形庫2番線'), note: '',
  });
  f.push({
    id: uid('f'), name: 'H09編成', series: 'E233系', vehicle: 'emu', cars: 8, carLengthM: null, loco: null,
    color: FORMATION_COLORS[8 % FORMATION_COLORS.length], trackId: track('洗浄線'), note: '洗浄待ち',
  });
  f.push({
    id: uid('f'), name: 'H10編成', series: 'E233系', vehicle: 'emu', cars: 8, carLengthM: null, loco: null,
    color: FORMATION_COLORS[7], trackId: t.find(x => x.name === '検修1番線').id, note: '交番検査中',
  });
  f.push({
    id: uid('f'), name: 'K11編成', series: '209系', vehicle: 'emu', cars: 6, carLengthM: null, loco: null,
    color: FORMATION_COLORS[5], trackId: track('引上線'), note: '',
  });
  f.push({
    id: uid('f'), name: 'K12編成', series: '209系', vehicle: 'emu', cars: 6, carLengthM: null, loco: null,
    color: FORMATION_COLORS[6], trackId: track('試運転線'), note: '',
  });
  f.push({
    id: uid('f'), name: 'W01', series: 'モーターカー', vehicle: 'mowcar', cars: 2, carLengthM: null, loco: null,
    color: '#c8a24a', trackId: t.find(x => x.kind === 'mow').id, note: '',
  });

  /* ---- 車上設備（保安装置）: どの会社の線に入れるかが決まる ---- */
  const FULL = ['atc', 'tasc', 'cs_atc', 'ats_p', 'radio_d'];   // 全社直通対応
  const SUBWAY = ['atc', 'tasc', 'cs_atc', 'radio_d'];          // 地下鉄まで
  const OWN = ['atc', 'tasc'];                                  // 自社線のみ
  const setSafety = (name, list) => { const f2 = f.find(x => x.name === name); if (f2) f2.safety = list.slice(); };
  ['H01編成', 'H02編成', 'H03編成', 'H04編成', 'H05編成', 'H06編成', 'H07編成', 'H08編成'].forEach(n => setSafety(n, FULL));
  ['H14編成'].forEach(n => setSafety(n, FULL));
  ['H09編成', 'H11編成', 'H12編成', 'H13編成'].forEach(n => setSafety(n, SUBWAY));
  ['H10編成'].forEach(n => setSafety(n, OWN));
  ['K11編成', 'K12編成'].forEach(n => setSafety(n, ['atc', 'tasc', 'ats_p']));
  setSafety('キハ48-1500', ['ats_sn']);
  setSafety('12系客車', ['ats_sn']);

  /* ---- 速度条件 ---- */
  const setSpeed = (name, kmh) => { const tr = t.find(x => x.name === name); if (tr) tr.maxSpeedKmh = kmh; };
  setSpeed('本線', 110);
  setSpeed('駅1番線', 85);
  setSpeed('駅2番線', 85);
  setSpeed('東川1番線', 60);
  setSpeed('西山2番線', 60);
  setSpeed('海岸2番線', 60);
  setSpeed('入出区線', 45);
  setSpeed('出区線', 45);
  setSpeed('入区線', 45);
  setSpeed('ラダー線', 25);
  setSpeed('引上線', 25);
  setSpeed('連絡線', 25);
  setSpeed('機関区連絡線', 25);
  for (const tr of t) if (trackKindIsDepot(tr.kind)) tr.maxSpeedKmh = tr.maxSpeedKmh || 25;
  // 曲線の速度制限（東川の前後）
  const speedSign = (x, y, kmh, lenM, trackName2) => o.push({
    id: uid('b'), type: 'speed_limit', x, y, w: 8, h: 8, rot: 0,
    mirror: false, position: 0, dir: 'ab', tracks: [], extraM: 0,
    limitKmh: kmh, lengthM: lenM, divergeSpeedKmh: null,
    label: '', note: '', trackId: (t.find(v => v.name === trackName2) || {}).id || null,
  });
  speedSign(900, 40, 75, 400, '本線');     // 曲線制限
  speedSign(1670, 75, 45, 240, '東川1番線'); // 交換設備の副本線

  /* ---- 路線とダイヤ ---- */
  /* ---- 事業者と相互直通（6社直通） ---- */
  const OP = {
    midori:   { id: uid('op'), name: 'みどり電鉄',     short: 'み', color: '#7fd1ff', self: true },
    sakura:   { id: uid('op'), name: 'さくら地下鉄',   short: 'さ', color: '#c99cff', self: false },
    kaede:    { id: uid('op'), name: 'かえで鉄道',     short: 'か', color: '#ffb020', self: false },
    shirakaba:{ id: uid('op'), name: 'しらかば電鉄',   short: 'し', color: '#6fd6e8', self: false },
    minato:   { id: uid('op'), name: 'みなと高速鉄道', short: 'な', color: '#2bd4a4', self: false },
    aoba:     { id: uid('op'), name: 'あおば急行',     short: 'あ', color: '#ff7a9c', self: false },
  };
  const operators = Object.values(OP);

  const line = {
    id: uid('l'), name: 'みどり本線', color: '#7fd1ff', double: true,
    operatorId: OP.midori.id,
    safety: ['atc', 'tasc'],       // 自社線はATC＋ホームドア対応のTASCが必要
    maxCars: 10,
    stations: [stW.id, stS.id, stM.id, stN.id, stH.id, stK.id],
  };

  // 直通先（西山＝地下鉄方面、海岸＝みなと方面）
  const TH = {
    kaede:     { id: uid('th'), name: 'かえで本線',   operatorId: OP.kaede.id,     lineId: line.id, stationIdx: 0, safety: ['ats_p'], maxCars: 10, km: 18.4, runMin: 30, dailyPassengers: 0, viaIds: [], suspended: false, delayMin: 0, note: 'さくら線の先（森口方面）' },
    shirakaba: { id: uid('th'), name: 'しらかば線',   operatorId: OP.shirakaba.id, lineId: line.id, stationIdx: 0, safety: ['ats_p'], maxCars: 8,  km: 15.2, runMin: 26, dailyPassengers: 0, viaIds: [], suspended: false, delayMin: 0, note: 'さくら線の先（白樺台方面）' },
    sakura:    { id: uid('th'), name: 'さくら線',     operatorId: OP.sakura.id,    lineId: line.id, stationIdx: 0, safety: ['cs_atc'], maxCars: 10, km: 12.5, runMin: 23, dailyPassengers: 9000, viaIds: [], suspended: false, delayMin: 0, note: '西山から都心を貫く地下鉄' },
    minato:    { id: uid('th'), name: 'みなと線',     operatorId: OP.minato.id,    lineId: line.id, stationIdx: 5, safety: ['atc'],    maxCars: 8,  km: 4.1,  runMin: 8,  dailyPassengers: 5200, viaIds: [], suspended: false, delayMin: 0, note: '海岸から臨海部へ' },
    aoba:      { id: uid('th'), name: 'あおば線',     operatorId: OP.aoba.id,      lineId: line.id, stationIdx: 5, safety: ['ats_p', 'atc'], maxCars: 6, km: 9.8, runMin: 17, dailyPassengers: 2600, viaIds: [], suspended: false, delayMin: 0, note: '海岸から内陸の急行線' },
  };
  // かえで線・しらかば線へはさくら線を経由する（東横→副都心→東上/西武 の関係）
  TH.kaede.viaIds = [TH.sakura.id];
  TH.shirakaba.viaIds = [TH.sakura.id];
  const throughLines = [TH.sakura, TH.kaede, TH.shirakaba, TH.minato, TH.aoba];
  const trains = [];
  const last = line.stations.length - 1;
  const addTrain = (number, type, dir, departSec, speedKmh, extra = {}) => {
    const down = dir === 'down';
    trains.push({
      id: uid('tr'), lineId: line.id, number, name: '', type, dir,
      fromIdx: extra.fromIdx ?? (down ? 0 : last),
      toIdx: extra.toIdx ?? (down ? last : 0),
      departSec, speedKmh, dwellSec: extra.dwellSec ?? 30, skip: extra.skip || [],
      cars: extra.cars ?? 10,
      // 終端は発着で番線を分け、東川（交換駅）は下り本線・上り1番線に入る
      platforms: extra.platforms ?? {
        0: down ? trackId('西山2番線') : mainLine.id,
        2: down ? trackId('駅1番線') : trackId('駅2番線'),
        4: down ? mainLine.id : trackId('東川1番線'),
        5: down ? mainLine.id : trackId('海岸2番線'),
      },
      toDepot: !!extra.toDepot, depotTrackId: extra.depotTrackId || null,
      throughId: extra.throughId || null,
      operatorId: extra.operatorId || OP.midori.id,
      color: null, formationId: extra.formationId || null, note: extra.note || '',
    });
  };

  // 平日ダイヤ：ラッシュは普通10両を10分ごと、日中は20分ごとの普通＋その5分後に快速
  // （快速は桜台・中原を通過し、東川で普通を追い越す → 待避と緩急接続が発生する）
  const isRush = sec => {
    const h = sec / 3600;
    return (h >= 7 && h < 9.5) || (h >= 17 && h < 19.5);
  };
  const RAPID_SKIP = [1, 3];
  let noDown = 100, noUp = 101, noR = 3001;
  for (let t2 = 5.5 * 3600; t2 <= 22.5 * 3600; t2 += 60) {
    const rush = isRush(t2);
    const headway = rush ? 600 : 1200;
    if ((t2 - 5.5 * 3600) % headway !== 0) continue;
    const cars = 8;
    const slot = Math.round((t2 - 5.5 * 3600) / headway);
    // 日中の普通は3本に1本がさくら地下鉄の車両（相互直通の乗り入れ分）
    const foreign = !rush && slot % 3 === 1;
    addTrain(`${noDown}M`, 'local', 'down', t2, 60, {
      cars, operatorId: foreign ? OP.sakura.id : undefined, note: foreign ? 'さくら地下鉄の車両' : '',
    });
    addTrain(`${noUp}M`, 'local', 'up', t2 + 300, 60, {
      cars,
      // 上りの普通は一部がさくら線へ直通（ラッシュ時は毎時1本がかえで本線まで）
      throughId: foreign ? null
        : (rush && slot % 6 === 0 ? TH.kaede.id
          : rush && slot % 6 === 3 ? TH.shirakaba.id
            : (!rush && slot % 3 === 0 ? TH.sakura.id : null)),
      operatorId: foreign ? OP.sakura.id : undefined,
    });
    noDown += 2; noUp += 2;
    if (!rush && t2 < 22 * 3600) {
      // 日中の快速：下りは海岸からみなと線へ、上りはさくら線へ直通
      addTrain(`${noR}M`, 'rapid', 'down', t2 + 300, 85, {
        cars, skip: RAPID_SKIP.slice(),
        throughId: slot % 2 === 0 ? TH.minato.id : null,
      });
      addTrain(`${noR + 1}M`, 'rapid', 'up', t2 + 600, 85, { cars, skip: RAPID_SKIP.slice() });
      noR += 2;
    }
  }
  // あおば線直通（6両しか入れない・ATS-P必要）
  for (const [no, dep] of [['2201M', 6.5 * 3600 + 900], ['2203M', 20 * 3600 + 900]]) {
    addTrain(no, 'express', 'down', dep, 85, { cars: 6, skip: [1, 3], throughId: TH.aoba.id });
  }
  // 終電後の入庫回送（終端に残った編成を車両基地へ戻す）
  const depotTracks = ['1番線', '2番線', '3番線', '4番線', '5番線', '6番線', '7番線', '8番線'];
  [
    ['回1', 'down', 23 * 3600 + 300, 0], ['回3', 'down', 23 * 3600 + 1500, 0],
    ['回5', 'down', 23 * 3600 + 2400, 0], ['回7', 'down', 24 * 3600 + 300, 0],
    ['回2', 'up', 23 * 3600 + 600, last], ['回4', 'up', 23 * 3600 + 1800, last],
    ['回6', 'up', 23 * 3600 + 3000, last], ['回9', 'down', 24 * 3600 + 1200, 0],
  ].forEach(([no, dir, dep, fromIdx], i) => {
    addTrain(no, 'deadhead', dir, dep, 60, {
      fromIdx, toIdx: 2, cars: 8, toDepot: true,
      depotTrackId: trackId(depotTracks[i % depotTracks.length]),
    });
  });

  doc.tracks = t; doc.objects = o; doc.formations = f;
  for (const f2 of f) if (!f2.operatorId) f2.operatorId = OP.midori.id;
  doc.operators = operators;
  doc.throughLines = throughLines;
  doc.lines = [line];
  doc.trains = trains;
  initCompany(doc);     // 開業1年目として長期経営を初期化
  return doc;
}
