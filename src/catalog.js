// 車両基地・駅レイアウトのカタログ定義
// 線路種別・構造物・設備・信号/分岐器の各マスタ

/** 線路種別（用途）: stabling=留置可能としてカウントする線 */
export const TRACK_KINDS = [
  { id: 'main',        name: '本線',                color: '#dfe6f5', stabling: false, desc: '基地外へつながる営業線' },
  { id: 'platform',    name: 'ホーム着発線',        color: '#7fd1ff', stabling: false, desc: '旅客ホームに接する発着線' },
  { id: 'entry',       name: '入区線',              color: '#5ec6ff', stabling: false, desc: '車両基地へ入区するための線路' },
  { id: 'exit',        name: '出区線',              color: '#ffa65e', stabling: false, desc: '車両基地から出区するための線路' },
  { id: 'entryexit',   name: '入出区線',            color: '#b98cff', stabling: false, desc: '入出区兼用の線路' },
  { id: 'stabling',    name: '留置線',              color: '#4f8cff', stabling: true,  desc: '車両を留置するための線路' },
  { id: 'shunting',    name: '引上線（入換線）',    color: '#9aa4bb', stabling: true,  desc: '入換のために引上げる線路' },
  { id: 'runaround',   name: '機回し線',            color: '#8fd0a0', stabling: false, desc: '機関車を列車の反対側へ付け替えるための線路' },
  { id: 'washing',     name: '洗浄線',              color: '#2bd4a4', stabling: true,  desc: '車両を洗浄するための線路' },
  { id: 'mow',         name: '保守用車基地',        color: '#c8a24a', stabling: true,  desc: '各種保守用車のための線路' },
  { id: 'testrun',     name: '試運転線',            color: '#ff8fd0', stabling: true,  desc: '車両の試運転に用いる線路' },
  { id: 'scrap',       name: '解体線',              color: '#8c7b6b', stabling: true,  desc: '車両を解体する際に留置する線路' },
  { id: 'inspection',  name: '検修線',              color: '#ffd166', stabling: true,  desc: '車両検査や修繕（検修）をおこなう線路' },
  { id: 'daily',       name: '仕業検査線',          color: '#ffc04d', stabling: true,  desc: '仕業検査をするための線路' },
  { id: 'periodic',    name: '交番検査線（交検線）',color: '#f0a63c', stabling: true,  desc: '交番検査をするための線路' },
  { id: 'special',     name: '臨時検査線（臨検線）',color: '#e08a2e', stabling: true,  desc: '臨時検査をするための線路' },
  { id: 'wheellathe',  name: '転削線',              color: '#d2762a', stabling: true,  desc: '車輪の転削をするための線路' },
  { id: 'siding',      name: '安全側線',            color: '#ff7a6b', stabling: false, desc: '過走防止のための側線' },
  { id: 'other',       name: 'その他の側線',        color: '#7f8aa3', stabling: true,  desc: '用途未設定の側線' },
];

export const TRACK_KIND_MAP = Object.fromEntries(TRACK_KINDS.map(k => [k.id, k]));
export const trackKind = id => TRACK_KIND_MAP[id] || TRACK_KIND_MAP.other;

/**
 * 構造物・設備カタログ
 *  w,h  : 既定サイズ（m）
 *  shape: 描画スタイル
 *  onTrack: 線路上に設置する設備（最寄り線路に紐づけ）
 */
export const OBJECT_GROUPS = [
  {
    id: 'station', name: '駅設備', items: [
      { id: 'platform_island', name: 'ホーム（島式）', w: 160, h: 10, color: '#8d99b4', shape: 'platform' },
      { id: 'platform_side',   name: 'ホーム（相対式）', w: 160, h: 6, color: '#8d99b4', shape: 'platform' },
      { id: 'platform_roof',   name: 'ホーム上屋',     w: 100, h: 12, color: '#66718c', shape: 'roof' },
      { id: 'overbridge',      name: '跨線橋',         w: 8,   h: 70, color: '#a7b2c9', shape: 'bridge' },
      { id: 'underpass',       name: '地下通路',       w: 8,   h: 70, color: '#66718c', shape: 'bridge' },
      { id: 'station_mark',    name: '駅（停車場）',   w: 10,  h: 10, color: '#7fd1ff', shape: 'station', onTrack: true, station: true },
      { id: 'station_bldg',    name: '駅舎',           w: 60,  h: 30, color: '#c9a36b', shape: 'building' },
      { id: 'ticket_gate',     name: '改札',           w: 24,  h: 12, color: '#6ad1a8', shape: 'gate' },
      { id: 'waiting_room',    name: '待合室',         w: 20,  h: 12, color: '#b0a07a', shape: 'building' },
      { id: 'elevator',        name: 'エレベーター',   w: 8,   h: 8,  color: '#9aa4bb', shape: 'building' },
      { id: 'stairs',          name: '階段',           w: 12,  h: 6,  color: '#a7b2c9', shape: 'stairs' },
      { id: 'stairs_wide',     name: '階段（幅広）',   w: 14,  h: 10, color: '#a7b2c9', shape: 'stairs' },
      { id: 'escalator',       name: 'エスカレーター', w: 14,  h: 4,  color: '#8d99b4', shape: 'stairs' },
    ]
  },
  {
    id: 'office', name: '事務所・現業機関', items: [
      { id: 'admin_office',  name: '管理事務所',       w: 60, h: 30, color: '#7aa2e3', shape: 'building' },
      { id: 'crew_depot',    name: '乗務員区',         w: 50, h: 26, color: '#6f96d6', shape: 'building' },
      { id: 'driver_depot',  name: '運転区',           w: 44, h: 24, color: '#6f96d6', shape: 'building' },
      { id: 'conductor_depot', name: '車掌区',         w: 44, h: 24, color: '#6f96d6', shape: 'building' },
      { id: 'training',      name: '研修センター',     w: 50, h: 28, color: '#86b0f0', shape: 'building' },
      { id: 'restroom_bldg', name: '詰所',             w: 24, h: 16, color: '#7d88a3', shape: 'building' },
    ]
  },
  {
    id: 'works', name: '検修部門・工場', items: [
      { id: 'inspection_shed', name: '検修庫',       w: 200, h: 40, color: '#d8a23c', shape: 'shed' },
      { id: 'body_shop',       name: '車体工場',     w: 120, h: 40, color: '#cf9b52', shape: 'shed' },
      { id: 'paint_shop',      name: '塗装場',       w: 60,  h: 30, color: '#c58a5e', shape: 'shed' },
      { id: 'parts_shop',      name: '部品職場',     w: 44,  h: 24, color: '#bf9a4e', shape: 'building' },
      { id: 'electric_shop',   name: '電機職場',     w: 44,  h: 24, color: '#b99b6a', shape: 'building' },
      { id: 'bogie_shop',      name: '台車職場',     w: 44,  h: 24, color: '#ae8f5d', shape: 'building' },
      { id: 'inspect_shop',    name: '検査職場',     w: 44,  h: 24, color: '#c0a066', shape: 'building' },
      { id: 'warehouse',       name: '資材倉庫',     w: 40,  h: 22, color: '#8b8172', shape: 'building' },
      { id: 'mow_base',        name: '保守用車基地建屋', w: 60, h: 26, color: '#c8a24a', shape: 'shed' },
      { id: 'roundhouse',      name: '扇形庫',       w: 120, h: 120, color: '#d8a23c', shape: 'roundhouse' },
    ]
  },
  {
    id: 'equipment', name: '線路まわりの設備', items: [
      { id: 'turntable',    name: '転車台',         w: 25, h: 25, color: '#7fd1ff', shape: 'turntable' },
      { id: 'traverser',    name: '遷車台（トラバーサー）', w: 30, h: 12, color: '#7fd1ff', shape: 'traverser' },
      { id: 'car_washer',   name: '洗車機',         w: 24, h: 14, color: '#2bd4a4', shape: 'washer',  onTrack: true },
      { id: 'inspect_pit',  name: '検査台（ピット）', w: 120, h: 8, color: '#ffd166', shape: 'pit',    onTrack: true },
      { id: 'clean_deck',   name: '清掃台',         w: 80,  h: 8,  color: '#7fd1ff', shape: 'deck',   onTrack: true },
      { id: 'wheel_lathe',  name: '車輪転削盤',     w: 30,  h: 14, color: '#d2762a', shape: 'machine',onTrack: true },
      { id: 'lifting_jack', name: '車体ジャッキ',   w: 26,  h: 14, color: '#e0894a', shape: 'machine',onTrack: true },
      { id: 'sanding',      name: '砂撒き装置',     w: 14,  h: 10, color: '#c7b07a', shape: 'machine',onTrack: true },
      { id: 'refuel',       name: '給油設備',       w: 18,  h: 12, color: '#e05f5f', shape: 'machine',onTrack: true },
      { id: 'water_waste',  name: '給水・汚物抜取', w: 18,  h: 12, color: '#5ec6ff', shape: 'machine',onTrack: true },
      { id: 'shore_power',  name: '地上給電設備',   w: 14,  h: 10, color: '#8fe06a', shape: 'machine',onTrack: true },
    ]
  },
  {
    id: 'signal', name: '分岐器・信号', items: [
      // 分岐器は「結節点の記号」として扱い、画面上は一定の大きさで描画する（w/h は当たり判定の目安）
      { id: 'turnout_single', name: 'ポイント（片開き）', w: 12, h: 5, color: '#ffe08a', shape: 'turnout', variant: 'single' },
      { id: 'turnout_double', name: 'ポイント（両開き）', w: 12, h: 6, color: '#ffe08a', shape: 'turnout', variant: 'double' },
      { id: 'turnout_three',  name: 'ポイント（三枝）',   w: 12, h: 6, color: '#ffe08a', shape: 'turnout', variant: 'three' },
      { id: 'diamond',        name: 'ダイヤモンドクロッシング', w: 12, h: 8, color: '#ffc04d', shape: 'turnout', variant: 'diamond', crossing: true, desc: '交差するだけで渡れない平面交差' },
      { id: 'slip_single',    name: 'シングルスリップ',   w: 18, h: 12, color: '#ffd166', shape: 'turnout', variant: 'slip_single', crossing: true, slip: 1, desc: '片側にトングをもつ交差分岐器（3方向）' },
      { id: 'slip_double',    name: 'ダブルスリップ',     w: 20, h: 13, color: '#ffd166', shape: 'turnout', variant: 'slip_double', crossing: true, slip: 2, desc: '両側にトングをもつ交差分岐器（4方向）' },
      // 渡り線・シーサスは2線にまたがる装置なので、点としては置かず線路のつながりから判定する
      { id: 'scissors',       name: 'シーサスクロッシング', w: 14, h: 8, color: '#ffe08a', shape: 'turnout', variant: 'scissors', derived: true },
      { id: 'crossover',      name: '渡り線',            w: 14, h: 8, color: '#ffe08a', shape: 'turnout', variant: 'crossover', derived: true },
      { id: 'point_machine',  name: '転轍機',            w: 6,  h: 6,  color: '#ff9f43', shape: 'pointmachine' },
      { id: 'signal_start',   name: '出発信号機',        w: 5,  h: 5,  color: '#ff5f56', shape: 'signal', lamps: 4, onTrack: true, signal: true },
      { id: 'signal_home',    name: '場内信号機',        w: 5,  h: 5,  color: '#ff5f56', shape: 'signal', lamps: 4, onTrack: true, signal: true },
      { id: 'signal_block',   name: '閉塞信号機',        w: 5,  h: 5,  color: '#ffb020', shape: 'signal', lamps: 3, onTrack: true, signal: true },
      { id: 'signal_shunt',   name: '入換信号機',        w: 5,  h: 5,  color: '#8fe06a', shape: 'signal', lamps: 2, onTrack: true, signal: true, shunt: true },
      { id: 'shunt_marker',   name: '入換標識',          w: 5,  h: 5,  color: '#8fe06a', shape: 'marker', onTrack: true, signal: true, shunt: true },
      { id: 'speed_limit',    name: '速度制限標',        w: 8,  h: 8,  color: '#ff9f43', shape: 'speedlimit', onTrack: true, speedLimit: true },
      { id: 'buffer_stop',    name: '車止め',            w: 6,  h: 8,  color: '#ff7a6b', shape: 'buffer' },
      { id: 'derailer',       name: '脱線転轍器',        w: 8,  h: 6,  color: '#ff7a6b', shape: 'pointmachine' },
    ]
  },
  {
    id: 'misc', name: 'その他', items: [
      { id: 'substation', name: '変電所',     w: 30, h: 24, color: '#9d7ad6', shape: 'building' },
      { id: 'parking',    name: '駐車場',     w: 60, h: 30, color: '#5d6577', shape: 'yard' },
      { id: 'material',   name: '資材置場',   w: 50, h: 26, color: '#6b6a58', shape: 'yard' },
      { id: 'fence',      name: 'フェンス',   w: 120, h: 2, color: '#7f8aa3', shape: 'fence' },
      { id: 'gatehouse',  name: '守衛所・門', w: 16, h: 12, color: '#8d99b4', shape: 'building' },
      { id: 'label',      name: 'テキスト',   w: 40, h: 10, color: '#e6eaf3', shape: 'label' },
      { id: 'gap_break',  name: '駅間省略（キロ程補正）', w: 12, h: 16, color: '#ffd166', shape: 'gapbreak', onTrack: true, gap: true },
    ]
  },
];

export const OBJECT_MAP = {};
for (const g of OBJECT_GROUPS) for (const it of g.items) OBJECT_MAP[it.id] = { ...it, group: g.id, groupName: g.name };
export const objectDef = id => OBJECT_MAP[id] || { id, name: id, w: 20, h: 20, color: '#9aa4bb', shape: 'building' };

/** 分岐器の形状 → カタログID（分岐器は結節点の記号として扱う） */
export const TURNOUT_TYPE_BY_VARIANT = {
  single: 'turnout_single', double: 'turnout_double', three: 'turnout_three',
  scissors: 'scissors', crossover: 'crossover', diamond: 'diamond',
  slip_single: 'slip_single', slip_double: 'slip_double',
};

/**
 * 車種マスタ
 *  len   : 1両あたりの標準長（連結面間）[m]
 *  power : 描画用の動力表現（electric=パンタ, diesel=排気, steam=煙突, none=付随）
 *  loco  : 機関車（牽引機として選べる）
 */
export const VEHICLE_TYPES = [
  { id: 'emu',     name: '電車（EMU）',            short: '電車',   len: 20, color: '#4f8cff', power: 'electric' },
  { id: 'dmu',     name: '気動車（DC）',           short: '気動車', len: 20, color: '#e0894a', power: 'diesel' },
  { id: 'coach',   name: '客車',                   short: '客車',   len: 20, color: '#b5654a', power: 'none' },
  { id: 'freight', name: '貨車',                   short: '貨車',   len: 14, color: '#8b8172', power: 'none' },
  { id: 'el',      name: '電気機関車（EL）',       short: 'EL',     len: 18, color: '#6f90c0', power: 'electric', loco: true },
  { id: 'dl',      name: 'ディーゼル機関車（DL）', short: 'DL',     len: 16, color: '#d2762a', power: 'diesel',   loco: true },
  { id: 'sl',      name: '蒸気機関車（SL）',       short: 'SL',     len: 20, color: '#7a8190', power: 'steam',    loco: true },
  { id: 'mowcar',  name: '保守用車',               short: '保守',   len: 12, color: '#c8a24a', power: 'diesel' },
];

export const VEHICLE_MAP = Object.fromEntries(VEHICLE_TYPES.map(v => [v.id, v]));
export const vehicleDef = id => VEHICLE_MAP[id] || VEHICLE_MAP.emu;
export const LOCO_TYPES = VEHICLE_TYPES.filter(v => v.loco);

/** 編成に使う既定色 */
export const FORMATION_COLORS = [
  '#4f8cff', '#2bd4a4', '#ffd166', '#ff8fd0', '#b98cff',
  '#ff9f43', '#7fd1ff', '#8fe06a', '#e05f5f', '#c8a24a',
];
