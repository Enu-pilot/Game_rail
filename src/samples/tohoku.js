// サンプル7：東北・上越・北陸・秋田・山形・北海道新幹線（北海道新幹線は札幌延伸を想定）
// 配線：配線略図.net（東北・上越・北陸新幹線、田沢湖線・奥羽本線）　キロ程：Wikipedia 各線の駅一覧（実キロ）
// はやぶさ＋こまちは東京〜盛岡、やまびこ＋つばさは東京〜福島で併結し、盛岡・福島で分割・併合する。
// 秋田新幹線（田沢湖線・奥羽本線）と山形新幹線（奥羽本線）は単線の在来線を走るミニ新幹線。こまちは大曲でスイッチバックする。
// 北海道新幹線 新函館北斗〜札幌は延伸後を想定したキロ程。

import { P } from './util.js';

const S = (name, km, type = 'p', riders = 5, kind = 'mixed', extra = {}) => [name, km, type, P(riders, kind, extra)];

export default {
  id: 'tohoku', no: 7,
  title: '東北・上越・北陸・秋田・山形・北海道新幹線',
  note: 'はやぶさ＋こまち・やまびこ＋つばさの併結と盛岡・福島での分割併合、単線のミニ新幹線、大曲のスイッチバック、札幌延伸。',
  self: 'jre',
  spacing: 560,
  settings: {
    defaultMaxSpeedKmh: 300, farePerKm: 24, fareBase: 400, fareCap: 30000, dailyTripRate: 0.05,
    capacityPerCar: 80, maxLoadFactor: 1.5, reversalMinutes: 12, minHeadwaySec: 180, maxHoldMinutes: 30,
    accelMs2: 0.72, decelMs2: 0.75, targetCashOku: 5000, startCashOku: 700,
    coupleMinutes: 4, splitMinutes: 3,
    costPerCarKm: 200, costPerRouteKmDay: 120000, costPerStationDay: 300000, costPerCarDay: 28000,
  },
  operators: {
    jre: { name: 'JR東日本', short: '東', color: '#008000' },
    jrw: { name: 'JR西日本', short: '西', color: '#0072bc' },
    jrh: { name: 'JR北海道', short: '北', color: '#3aa935' },
  },
  lines: [
    {
      key: 'tohoku', name: '東北新幹線', color: '#008000', op: 'jre', vmax: 320,
      safety: ['ds_atc'], maxCars: 17, heading: 275,
      turns: { '宇都宮': 285, '仙台': 272, '盛岡': 282, '八戸': 250 },
      stations: [
        S('東京', 0.0, 't', 200, 'business', { stubs: 4 }), S('上野', 3.6, 's', 40, 'urban'), S('大宮', 31.3, 'p', 60, 'urban'),
        S('小山', 80.3, 'p', 6), S('宇都宮', 109.0, 'p', 20, 'urban'), S('那須塩原', 152.4, 'p', 5, 'tourist'),
        S('新白河', 178.4, 'p', 2), S('郡山', 213.9, 'p', 12), S('福島', 255.1, 'p', 12),
        S('白石蔵王', 286.2, 'p', 2), S('仙台', 325.4, 'p', 50, 'urban'), S('古川', 363.8, 'p', 3),
        S('くりこま高原', 385.7, 'p', 2), S('一ノ関', 406.3, 'p', 4), S('水沢江刺', 431.3, 'p', 2),
        S('北上', 448.6, 'p', 3), S('新花巻', 463.1, 'p', 2, 'tourist'), S('盛岡', 496.5, 'p', 20, 'urban'),
        S('いわて沼宮内', 527.6, 'p', 1), S('二戸', 562.2, 'p', 1), S('八戸', 593.1, 'p', 6),
        S('七戸十和田', 629.2, 'p', 1), S('新青森', 674.9, 'p', 8),
      ],
    },
    {
      key: 'joetsu', name: '上越新幹線', color: '#ff66b2', op: 'jre', vmax: 275,
      safety: ['ds_atc'], maxCars: 16, heading: 250,
      attach: { line: 'tohoku', at: '大宮', mode: 'branch', offset: 260 },
      turns: { '熊谷': 205, '越後湯沢': 215 },
      stations: [
        S('大宮', 0.0), S('熊谷', 36.6, 'p', 8), S('本庄早稲田', 57.7, 'p', 2), S('高崎', 77.3, 'p', 15, 'urban'),
        S('上毛高原', 119.1, 'p', 1, 'tourist'), S('越後湯沢', 151.4, 'p', 4, 'tourist'), S('浦佐', 181.0, 'p', 1),
        S('長岡', 213.8, 'p', 8), S('燕三条', 237.4, 'p', 3), S('新潟', 269.5, 't', 20, 'urban', { stubs: 4 }),
      ],
    },
    {
      key: 'hokurikuE', name: '北陸新幹線（高崎〜上越妙高）', color: '#8e5bb0', op: 'jre', vmax: 260,
      safety: ['ds_atc'], maxCars: 12, heading: 165,
      attach: { line: 'joetsu', at: '高崎', mode: 'branch', offset: 260 },
      turns: { '長野': 175 },
      stations: [
        S('高崎', 0.0), S('安中榛名', 18.5, 'p', 1), S('軽井沢', 41.8, 'p', 6, 'tourist'), S('佐久平', 59.4, 'p', 3),
        S('上田', 84.2, 'p', 4), S('長野', 117.4, 'p', 15, 'urban'), S('飯山', 147.3, 'p', 1),
        S('上越妙高', 176.9, 'p', 2),
      ],
    },
    {
      key: 'hokurikuW', name: '北陸新幹線（上越妙高〜敦賀）', color: '#1f5ea8', op: 'jrw', vmax: 260,
      safety: ['ds_atc'], maxCars: 12, heading: 175,
      attach: { line: 'hokurikuE', at: '上越妙高', mode: 'end' },
      turns: { '富山': 165, '金沢': 130 },
      stations: [
        S('上越妙高', 0.0), S('糸魚川', 37.0, 'p', 1), S('黒部宇奈月温泉', 76.2, 'p', 1, 'tourist'),
        S('富山', 110.0, 'p', 15, 'urban'), S('新高岡', 128.9, 'p', 2), S('金沢', 168.6, 'p', 25, 'urban'),
        S('小松', 195.7, 'p', 2), S('加賀温泉', 210.2, 'p', 2, 'tourist'), S('芦原温泉', 226.5, 'p', 1, 'tourist'),
        S('福井', 244.5, 'p', 6), S('越前たけふ', 263.5, 'p', 1), S('敦賀', 293.7, 'p', 3),
      ],
    },
    {
      key: 'hokkaido', name: '北海道新幹線', color: '#3aa935', op: 'jrh', vmax: 260,
      safety: ['ds_atc'], maxCars: 10, heading: 265, endEnd: 'buffer',
      attach: { line: 'tohoku', at: '新青森', mode: 'end' },
      turns: { '新函館北斗': 285, '長万部': 300 },
      stations: [
        S('新青森', 0.0), S('奥津軽いまべつ', 38.5, 'p', 0.2), S('木古内', 113.3, 'p', 0.3),
        S('新函館北斗', 148.8, 'p', 3, 'tourist'), S('新八雲', 203.0, 'p', 0.5), S('長万部', 235.9, 'p', 0.5),
        S('倶知安', 290.3, 'p', 1, 'tourist'), S('新小樽', 328.3, 'p', 2), S('札幌', 360.6, 't', 40, 'urban', { stubs: 4 }),
      ],
    },
    {
      // 田沢湖線（盛岡〜大曲）と奥羽本線（大曲〜秋田）。全線単線、大曲で向きを変える
      key: 'akita', name: '秋田新幹線（田沢湖線・奥羽本線）', color: '#d7003a', op: 'jre', vmax: 130, double: false,
      safety: ['ats_p'], maxCars: 7, heading: 250,
      attach: { line: 'tohoku', at: '盛岡', mode: 'branch', offset: 260, ownStation: true },
      turns: { '大釜': 230, '羽後長野': 105, '大曲': { h: 250, at: 0 }, '峰吉川': 225 },
      stations: [
        S('盛岡', 0.0, 's', 3), S('大釜', 6.0, 'pd', 0.3), S('小岩井', 10.5, 'pd', 0.2), S('雫石', 16.0, 'p', 1),
        S('赤渕', 22.0, 'pd', 0.1), S('田沢湖', 40.1, 'p', 1, 'tourist'), S('神代', 52.8, 'pd', 0.2),
        S('角館', 58.8, 'p', 2, 'tourist'), S('羽後長野', 64.6, 'pd', 0.2),
        S('大曲', 75.6, 'p', 3, 'mixed', { dwell: 180 }), S('神宮寺', 81.6, 's', 0.2), S('刈和野', 89.2, 'pd', 0.3),
        S('峰吉川', 94.0, 's', 0.1), S('羽後境', 100.5, 'pd', 0.2), S('大張野', 108.6, 's', 0.1),
        S('和田', 114.0, 'pd', 0.2), S('四ツ小屋', 120.9, 's', 0.2), S('秋田', 127.3, 't', 15, 'urban', { stubs: 3 }),
      ],
    },
    {
      // 奥羽本線（福島〜新庄）。福島〜米沢は複線、米沢から先は単線
      key: 'yamagata', name: '山形新幹線（奥羽本線）', color: '#c9a800', op: 'jre', vmax: 130,
      safety: ['ats_p'], maxCars: 7, heading: 230,
      attach: { line: 'tohoku', at: '福島', mode: 'branch', offset: 260, ownStation: true },
      turns: { '米沢': 245 },
      singles: [['米沢', '新庄']],
      stations: [
        S('福島', 0.0, 's', 3), S('米沢', 40.1, 'p', 3), S('高畠', 49.9, 'pd', 1), S('赤湯', 56.1, 'p', 1),
        S('かみのやま温泉', 75.0, 'p', 1, 'tourist'), S('山形', 87.1, 'p', 12, 'urban'), S('天童', 100.4, 'p', 2),
        S('さくらんぼ東根', 108.1, 'pd', 1), S('村山', 113.5, 'p', 1), S('大石田', 126.9, 'pd', 1),
        S('新庄', 148.6, 't', 2, 'mixed', { stubs: 2 }),
      ],
    },
  ],
  through: [
    { key: 'jo', from: 'tohoku', at: '大宮', name: '上越新幹線', line: 'joetsu', op: 'jre', pax: 40000 },
    { key: 'he', from: 'tohoku', at: '大宮', name: '北陸新幹線（上越妙高まで）', line: 'hokurikuE', op: 'jre', via: ['jo'], pax: 25000 },
    { key: 'hw', from: 'tohoku', at: '大宮', name: '北陸新幹線（敦賀まで）', line: 'hokurikuW', op: 'jrw', via: ['jo', 'he'], pax: 15000 },
    { key: 'hk', from: 'tohoku', at: '新青森', name: '北海道新幹線', line: 'hokkaido', op: 'jrh', pax: 9000 },
    { key: 'ak', from: 'tohoku', at: '盛岡', name: '秋田新幹線', line: 'akita', op: 'jre', pax: 8000 },
    { key: 'ym', from: 'tohoku', at: '福島', name: '山形新幹線', line: 'yamagata', op: 'jre', pax: 10000 },
  ],
  depots: [
    { line: 'tohoku', at: '上野', name: '東京新幹線車両センター', side: 1, own: true, share: 0.5, cars: 17, offset: 260 },
    { line: 'tohoku', at: '仙台', name: '新幹線総合車両センター', side: -1, own: true, share: 0.5, cars: 17, offset: 260 },
    { line: 'joetsu', at: '新潟', name: '新潟新幹線車両センター', side: 1, min: 4, cars: 12, offset: -300 },
    { line: 'hokurikuW', at: '金沢', name: '白山総合車両所', side: 1, min: 4, cars: 12 },
    { line: 'hokkaido', at: '新函館北斗', name: '函館新幹線総合車両所', side: 1, min: 3, cars: 10 },
  ],
  fleet: { prefix: 'U', suffix: '編成', series: 'E5・E6・E7・E8系', carLengthM: 25 },
  services: [
    {
      name: 'はやぶさ（札幌）', prefix: 'H', type: 'ltd', cars: 10, speed: 320, dwell: 60,
      ops: { jre: 3, jrh: 1 },
      route: [['tohoku', '東京', '新青森'], ['hokkaido', '新青森', '札幌']],
      stops: {
        tohoku: ['東京', '上野', '大宮', '仙台', '盛岡', '八戸', '新青森'],
        hokkaido: ['新青森', '新函館北斗', '長万部', '倶知安', '新小樽', '札幌'],
      },
      slots: [['06:20', '19:30', 60, 0]], revOffset: 0,
    },
    {
      // こまち：東京〜盛岡ははやぶさ（札幌行き）の後ろに連結
      name: 'こまち', prefix: 'K', type: 'ltd', cars: 7, speed: 320, dwell: 60, op: 'jre',
      with: { service: 'H', on: ['tohoku'] },
      route: [['tohoku', '東京', '盛岡'], ['akita', '盛岡', '秋田']],
      stops: { akita: ['盛岡', '雫石', '田沢湖', '角館', '大曲', '秋田'] },
      slots: [['06:20', '19:30', 60, 0]], revOffset: 0,
    },
    {
      name: 'はやぶさ（新青森）', prefix: 'B', type: 'ltd', cars: 10, speed: 320, dwell: 60, op: 'jre',
      route: [['tohoku', '東京', '新青森']],
      stops: { tohoku: ['東京', '上野', '大宮', '仙台', '古川', '一ノ関', '北上', '盛岡', '二戸', '八戸', '七戸十和田', '新青森'] },
      slots: [['06:50', '20:00', 60, 0]], revOffset: 10,
    },
    {
      name: 'やまびこ', prefix: 'Y', type: 'express', cars: 10, speed: 275, dwell: 60, op: 'jre',
      route: [['tohoku', '東京', '仙台']],
      slots: [['06:40', '21:00', 60, 0]], revOffset: 5,
    },
    {
      // つばさ：東京〜福島はやまびこの前に連結
      name: 'つばさ', prefix: 'T', type: 'express', cars: 7, speed: 275, dwell: 60, op: 'jre',
      with: { service: 'Y', on: ['tohoku'] },
      route: [['tohoku', '東京', '福島'], ['yamagata', '福島', '新庄']],
      slots: [['06:40', '21:00', 60, 0]], revOffset: 5,
    },
    {
      name: 'とき', prefix: 'E', type: 'ltd', cars: 12, speed: 275, dwell: 60, op: 'jre',
      route: [['tohoku', '東京', '大宮'], ['joetsu', '大宮', '新潟']],
      stops: {
        tohoku: ['東京', '上野', '大宮'],
        joetsu: ['大宮', '熊谷', '高崎', '越後湯沢', '浦佐', '長岡', '燕三条', '新潟'],
      },
      slots: [['06:08', '21:00', 60, 0]], revOffset: 20,
    },
    {
      name: 'かがやき・はくたか', prefix: 'W', type: 'ltd', cars: 12, speed: 260, dwell: 60,
      ops: { jre: 1, jrw: 1 },
      route: [['tohoku', '東京', '大宮'], ['joetsu', '大宮', '高崎'], ['hokurikuE', '高崎', '上越妙高'], ['hokurikuW', '上越妙高', '敦賀']],
      stops: {
        tohoku: ['東京', '上野', '大宮'],
        joetsu: ['大宮', '高崎'],
        hokurikuE: ['高崎', '軽井沢', '佐久平', '上田', '長野', '上越妙高'],
        hokurikuW: ['上越妙高', '糸魚川', '富山', '新高岡', '金沢', '小松', '加賀温泉', '福井', '敦賀'],
      },
      slots: [['06:28', '20:00', 60, 0]], revOffset: 30,
    },
  ],
};
