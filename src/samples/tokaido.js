// サンプル6：東海道・山陽・九州新幹線（東京〜新大阪〜博多〜鹿児島中央）
// 配線：配線略図.net（東海道・山陽・九州新幹線）、駅の番線数：Wikipedia 各駅記事（docs/sample-stations.md）　キロ程：Wikipedia 各線の駅一覧（実キロ）
// 東海道・山陽は16両・ATC-NS、九州新幹線は8両・DS-ATC。
// 16両ののぞみは博多まで、九州へは8両のみずほ・さくら（山陽・九州の車両）が直通する。

import { P } from './util.js';

const TK = (name, km, type = 'p', riders = 20, kind = 'mixed', extra = {}) => [name, km, type, P(riders, kind, extra)];

export default {
  id: 'tokaido', no: 6,
  title: '東海道・山陽・九州新幹線',
  note: '東京から鹿児島中央まで1325.9km。16両ののぞみは博多まで、九州へは8両のみずほ・さくらが直通する。',
  self: 'jrc',
  spacing: 560,
  settings: {
    defaultMaxSpeedKmh: 285, farePerKm: 24, fareBase: 400, fareCap: 30000, dailyTripRate: 0.06,
    capacityPerCar: 85, maxLoadFactor: 1.5, reversalMinutes: 12, minHeadwaySec: 180, maxHoldMinutes: 30,
    accelMs2: 0.72, decelMs2: 0.75, targetCashOku: 6000, startCashOku: 800,
    costPerCarKm: 200, costPerRouteKmDay: 150000, costPerStationDay: 400000, costPerCarDay: 30000,
  },
  operators: {
    jrc: { name: 'JR東海', short: '海', color: '#f08300' },
    jrw: { name: 'JR西日本', short: '西', color: '#0072bc' },
    jrk: { name: 'JR九州', short: '九', color: '#e60012' },
  },
  lines: [
    {
      key: 'tokaido', name: '東海道新幹線', color: '#f08300', op: 'jrc', vmax: 285,
      safety: ['atc_ns'], maxCars: 16, heading: 195, endEnd: 'open',
      turns: { '名古屋': 172, '京都': 205 },
      stations: [
        TK('東京', 0.0, 't', 220, 'business', { stubs: 6 }), TK('品川', 6.8, 'p', 80, 'business'),
        TK('新横浜', 25.5, 'p', 60), TK('小田原', 76.7, 'p', 12), TK('熱海', 95.4, 's', 8, 'tourist'),
        TK('三島', 111.3, 'p', 12), TK('新富士', 135.0, 'p', 5), TK('静岡', 167.4, 'p', 25, 'urban'),
        TK('掛川', 211.3, 'p', 5), TK('浜松', 238.9, 'p', 20, 'urban'), TK('豊橋', 274.2, 'p', 15),
        TK('三河安城', 312.8, 'p', 6), TK('名古屋', 342.0, 'p', 120, 'urban'), TK('岐阜羽島', 367.1, 'p', 6),
        TK('米原', 408.2, 'p', 8), TK('京都', 476.3, 'p', 100, 'tourist'), TK('新大阪', 515.4, 'p', 130, 'urban'),
      ],
    },
    {
      key: 'sanyo', name: '山陽新幹線', color: '#0072bc', op: 'jrw', vmax: 300,
      safety: ['atc_ns'], maxCars: 16, heading: 185,
      attach: { line: 'tokaido', at: '新大阪', mode: 'end' },
      turns: { '岡山': 178, '広島': 195, '小倉': 170 },
      stations: [
        TK('新大阪', 0.0), TK('新神戸', 32.6, 's', 30, 'urban'), TK('西明石', 54.8, 'p', 6),
        TK('姫路', 85.9, 'p', 25), TK('相生', 105.9, 'p', 3), TK('岡山', 160.9, 'p', 45, 'urban'),
        TK('新倉敷', 186.7, 'p', 4), TK('福山', 217.7, 'p', 15), TK('新尾道', 235.1, 'p', 2),
        TK('三原', 245.6, 'p', 4), TK('東広島', 276.5, 'p', 3), TK('広島', 305.8, 'p', 50, 'urban'),
        TK('新岩国', 350.0, 'p', 2), TK('徳山', 388.1, 'p', 6), TK('新山口', 429.2, 'p', 10),
        TK('厚狭', 453.3, 'p', 1), TK('新下関', 477.1, 'p', 3), TK('小倉', 497.8, 'p', 30, 'urban'),
        TK('博多', 553.7, 'p', 80, 'urban'),
      ],
    },
    {
      key: 'kyushu', name: '九州新幹線', color: '#e60012', op: 'jrk', vmax: 260,
      safety: ['ds_atc'], maxCars: 8, heading: 100, endEnd: 'buffer',
      attach: { line: 'sanyo', at: '博多', mode: 'end' },
      turns: { '熊本': 115, '新八代': 95 },
      stations: [
        TK('博多', 0.0), TK('新鳥栖', 26.3, 'p', 3), TK('久留米', 32.0, 's', 6), TK('筑後船小屋', 47.9, 'pd', 2),
        TK('新大牟田', 59.7, 's', 2), TK('新玉名', 76.3, 's', 2), TK('熊本', 98.2, 'p', 20, 'urban'),
        TK('新八代', 130.0, 's', 3), TK('新水俣', 172.8, 'pu', 1), TK('出水', 188.8, 's', 2),
        TK('川内', 221.5, 's', 3), TK('鹿児島中央', 256.8, 't', 25, 'urban', { stubs: 4 }),
      ],
    },
  ],
  through: [
    { key: 'sy', from: 'tokaido', at: '新大阪', name: '山陽新幹線', line: 'sanyo', op: 'jrw', pax: 90000 },
    { key: 'ks', from: 'tokaido', at: '新大阪', name: '九州新幹線', line: 'kyushu', op: 'jrk', via: ['sy'], pax: 8000 },
  ],
  depots: [
    { line: 'tokaido', at: '品川', name: '大井車両基地', side: 1, own: true, share: 0.6, cars: 16, offset: 260 },
    { line: 'tokaido', at: '米原', name: '鳥飼車両基地', side: -1, own: true, share: 0.4, cars: 16, offset: 220 },
    { line: 'sanyo', at: '博多', name: '博多総合車両所', side: 1, min: 6, cars: 16, offset: 260 },
    { line: 'kyushu', at: '熊本', name: '熊本総合車両所', side: -1, min: 4, cars: 8 },
  ],
  fleet: { prefix: 'G', suffix: '編成', series: 'N700S', carLengthM: 25 },
  services: [
    {
      name: 'のぞみ（博多）', prefix: 'NB', type: 'ltd', cars: 16, speed: 300, dwell: 60,
      ops: { jrc: 1, jrw: 1 },
      route: [['tokaido', '東京', '新大阪'], ['sanyo', '新大阪', '博多']],
      stops: {
        tokaido: ['東京', '品川', '新横浜', '名古屋', '京都', '新大阪'],
        sanyo: ['新大阪', '新神戸', '岡山', '広島', '小倉', '博多'],
      },
      slots: [['06:00', '19:30', 30, 0]], revOffset: 0,
    },
    {
      name: 'のぞみ（新大阪）', prefix: 'N', type: 'ltd', cars: 16, speed: 285, dwell: 60,
      route: [['tokaido', '東京', '新大阪']],
      stops: { tokaido: ['東京', '品川', '新横浜', '名古屋', '京都', '新大阪'] },
      slots: [['06:10', '22:00', 30, 0]], revOffset: 5,
    },
    {
      name: 'ひかり（岡山）', prefix: 'H', type: 'express', cars: 16, speed: 285, dwell: 60,
      route: [['tokaido', '東京', '新大阪'], ['sanyo', '新大阪', '岡山']],
      stops: {
        tokaido: ['東京', '品川', '新横浜', '小田原', '静岡', '浜松', '名古屋', '米原', '京都', '新大阪'],
        sanyo: ['新大阪', '新神戸', '西明石', '姫路', '相生', '岡山'],
      },
      slots: [['06:30', '20:30', 60, 3]], revOffset: 10,
    },
    {
      name: 'こだま', prefix: 'K', type: 'local', cars: 16, speed: 285, dwell: 60,
      route: [['tokaido', '東京', '新大阪']],
      slots: [['06:00', '21:00', 60, 33]], revOffset: 15,
    },
    {
      name: 'みずほ・さくら', prefix: 'S', type: 'ltd', cars: 8, speed: 300, dwell: 60,
      ops: { jrw: 1, jrk: 1 },
      route: [['sanyo', '新大阪', '博多'], ['kyushu', '博多', '鹿児島中央']],
      stops: {
        sanyo: ['新大阪', '新神戸', '姫路', '岡山', '福山', '広島', '新山口', '小倉', '博多'],
        kyushu: ['博多', '新鳥栖', '久留米', '熊本', '川内', '鹿児島中央'],
      },
      slots: [['06:30', '19:00', 30, 12]], revOffset: 18,
    },
    {
      name: '山陽こだま', prefix: 'W', type: 'local', cars: 8, speed: 285, dwell: 60, op: 'jrw',
      route: [['sanyo', '新大阪', '博多']],
      slots: [['06:00', '20:00', 60, 40]], revOffset: 25,
    },
    {
      name: 'つばめ', prefix: 'T', type: 'local', cars: 8, speed: 260, dwell: 45, op: 'jrk',
      route: [['kyushu', '博多', '鹿児島中央']],
      slots: [['06:00', '22:00', 60, 20]], revOffset: 30,
    },
  ],
};
