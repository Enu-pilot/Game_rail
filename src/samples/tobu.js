// サンプル8：東武鉄道 浅草〜日光・鬼怒川温泉（スカイツリーライン・日光線・鬼怒川線）
// 配線：配線略図.net（東武伊勢崎線・日光線・鬼怒川線）　キロ程：Wikipedia 各線の駅一覧
// リバティけごん＋リバティ会津は浅草〜下今市で併結し、下今市で分割・併合する。
// SL大樹は下今市〜鬼怒川温泉の機関車牽引列車で、両端の駅で機回し（転車台つき）をする。
// 鬼怒川線は単線（大桑・新高徳・鬼怒川温泉・鬼怒川公園で行き違い）。新藤原から先は野岩鉄道・会津鉄道。

import { P } from './util.js';

const S = (name, km, type = 's', riders = 5, kind = 'residential', extra = {}) => [name, km, type, P(riders, kind, extra)];

export default {
  id: 'tobu', no: 8,
  title: '東武 浅草〜日光・鬼怒川温泉',
  note: '特急スペーシアX・リバティ（下今市で分割・併合）、SL大樹の機回しと転車台、単線の鬼怒川線。',
  self: 'tobu',
  spacing: 440,
  settings: {
    defaultMaxSpeedKmh: 110, farePerKm: 22, fareBase: 170, dailyTripRate: 0.2, costPerCarKm: 180,
    reversalMinutes: 3, targetCashOku: 900, startCashOku: 150,
    coupleMinutes: 4, splitMinutes: 3, runAroundMinutes: 15,
  },
  operators: {
    tobu: { name: '東武鉄道', short: '武', color: '#0f4d9c' },
  },
  lines: [
    {
      key: 'isesaki', name: '東武スカイツリーライン', color: '#0f6cc0', op: 'tobu', vmax: 120,
      safety: ['tdatc'], maxCars: 10, heading: 275,
      turns: { '北千住': 280, '北越谷': 290 },
      quads: [['北千住', '北越谷']],   // 複々線（緩行線・急行線）
      stations: [
        S('浅草', 0.0, 't', 55, 'tourist', { stubs: 3 }), S('とうきょうスカイツリー', 1.1, 's', 30, 'tourist'),
        S('曳舟', 2.4, 'p', 15, 'mixed'), S('東向島', 3.2, 's', 8), S('鐘ヶ淵', 4.2, 's', 8), S('堀切', 5.3, 's', 4),
        S('牛田', 6.0, 's', 10), S('北千住', 7.1, 'p', 90, 'urban'), S('小菅', 8.2, 's', 5), S('五反野', 9.3, 's', 10),
        S('梅島', 10.5, 's', 12), S('西新井', 11.3, 'p', 25, 'mixed'), S('竹ノ塚', 13.4, 'p', 35), S('谷塚', 15.9, 's', 15),
        S('草加', 17.5, 'p', 40, 'mixed'), S('獨協大学前', 19.2, 's', 20, 'school'), S('新田', 20.5, 's', 20), S('蒲生', 21.9, 's', 10),
        S('新越谷', 22.9, 'p', 70, 'mixed'), S('越谷', 24.4, 'p', 25), S('北越谷', 26.0, 'p', 25), S('大袋', 28.5, 's', 10),
        S('せんげん台', 29.8, 'p', 25), S('武里', 31.1, 's', 8), S('一ノ割', 33.0, 's', 8), S('春日部', 35.3, 'p', 30, 'mixed'),
        S('北春日部', 36.8, 's', 5), S('姫宮', 38.4, 's', 5), S('東武動物公園', 41.0, 'p', 15, 'mixed'),
      ],
    },
    {
      key: 'nikko', name: '日光線', color: '#e5a100', op: 'tobu', vmax: 120,
      safety: ['tdatc'], maxCars: 10, heading: 290,
      attach: { line: 'isesaki', at: '東武動物公園', mode: 'end' },
      turns: { '栃木': 300, '新鹿沼': 285, '下今市': 215 },
      stations: [
        S('東武動物公園', 0.0), S('杉戸高野台', 3.2, 's', 8), S('幸手', 5.8, 's', 8), S('南栗橋', 10.4, 'p', 6),
        S('栗橋', 13.9, 's', 5), S('新古河', 20.6, 's', 1), S('柳生', 23.6, 's', 0.5), S('板倉東洋大前', 25.6, 'p', 3, 'school'),
        S('藤岡', 29.5, 's', 1), S('静和', 37.3, 's', 0.5), S('新大平下', 40.1, 's', 1), S('栃木', 44.9, 'p', 6, 'mixed'),
        S('新栃木', 47.9, 'p', 3), S('合戦場', 50.0, 's', 1), S('家中', 52.4, 's', 1), S('東武金崎', 56.6, 's', 1),
        S('楡木', 61.2, 's', 0.5), S('樅山', 64.2, 's', 0.5), S('新鹿沼', 66.8, 'p', 3, 'mixed'), S('北鹿沼', 69.8, 's', 0.5),
        S('板荷', 74.9, 's', 0.3), S('下小代', 78.5, 's', 0.3), S('明神', 81.3, 's', 0.3), S('下今市', 87.4, 'p', 2, 'tourist'),
        S('上今市', 88.4, 's', 0.5), S('東武日光', 94.5, 't', 8, 'tourist', { stubs: 3 }),
      ],
    },
    {
      key: 'kinugawa', name: '鬼怒川線', color: '#7fb13a', op: 'tobu', vmax: 85, double: false,
      safety: ['tdatc'], maxCars: 6, heading: 255, endEnd: 'boundary',
      attach: { line: 'nikko', at: '下今市', mode: 'branch', offset: 250, ownStation: true },
      turns: { '大谷向': 285 },
      stations: [
        // 下今市・鬼怒川温泉には機回し線と転車台がある（SL大樹）
        S('下今市', 0.0, 'pd', 1, 'tourist', { ra: true, tt: true }), S('大谷向', 0.8, 's', 0.3),
        S('大桑', 4.8, 'pd', 0.3), S('新高徳', 7.1, 'pd', 0.3), S('小佐越', 9.9, 's', 0.2),
        S('東武ワールドスクウェア', 10.6, 's', 1, 'tourist'), S('鬼怒川温泉', 12.4, 'p', 4, 'tourist', { ra: true, tt: true }),
        S('鬼怒川公園', 14.5, 'pd', 1, 'tourist'), S('新藤原', 16.2, 's', 0.5),
      ],
    },
  ],
  through: [
    { key: 'nk', from: 'isesaki', at: '東武動物公園', name: '日光線', line: 'nikko', op: 'tobu', pax: 20000 },
    { key: 'kg', from: 'isesaki', at: '東武動物公園', name: '鬼怒川線', line: 'kinugawa', op: 'tobu', via: ['nk'], pax: 5000 },
  ],
  depots: [
    { line: 'nikko', at: '南栗橋', name: '南栗橋車両管区', side: 1, own: true, share: 0.6, cars: 10 },
    { line: 'isesaki', at: '北春日部', name: '春日部支所', side: -1, own: true, share: 0.4, cars: 10 },
    { line: 'kinugawa', at: '下今市', name: '下今市機関区', side: -1, own: true, reserved: true, min: 3, cars: 6, offset: 300 },
  ],
  fleet: { prefix: '', suffix: '編成', series: 'N100系・500系・50050型' },
  fleets: [
    { line: 'nikko', prefix: 'N', suffix: '編成', series: '20400型', depot: '南栗橋車両管区', start: 61 },
    { line: 'kinugawa', prefix: 'K', suffix: '編成', series: '6050型・SL大樹（C11＋14系）', depot: '下今市機関区', start: 81 },
  ],
  services: [
    {
      name: '特急スペーシアX', prefix: 'X', type: 'ltd', cars: 6, speed: 120,
      route: [['isesaki', '浅草', '東武動物公園'], ['nikko', '東武動物公園', '東武日光']],
      stops: {
        isesaki: ['浅草', 'とうきょうスカイツリー', '北千住', '春日部', '東武動物公園'],
        nikko: ['東武動物公園', '栃木', '新鹿沼', '下今市', '東武日光'],
      },
      slots: [['07:00', '19:00', 120, 0]], revOffset: 60,
    },
    {
      // リバティけごん：浅草〜下今市はリバティ会津を連結
      name: '特急リバティけごん', prefix: 'LK', type: 'ltd', cars: 3, speed: 120,
      route: [['isesaki', '浅草', '東武動物公園'], ['nikko', '東武動物公園', '東武日光']],
      stops: {
        isesaki: ['浅草', 'とうきょうスカイツリー', '北千住', '春日部', '東武動物公園'],
        nikko: ['東武動物公園', '栃木', '新鹿沼', '下今市', '東武日光'],
      },
      slots: [['06:30', '20:00', 120, 0]], revOffset: 40,
    },
    {
      name: '特急リバティ会津', prefix: 'LA', type: 'ltd', cars: 3, speed: 120,
      with: { service: 'LK', on: ['isesaki', 'nikko'] },
      route: [['isesaki', '浅草', '東武動物公園'], ['nikko', '東武動物公園', '下今市'], ['kinugawa', '下今市', '新藤原']],
      stops: { kinugawa: ['下今市', '新高徳', '鬼怒川温泉', '鬼怒川公園', '新藤原'] },
      slots: [['06:30', '20:00', 120, 0]], revOffset: 40,
    },
    {
      name: '特急きぬ', prefix: 'KN', type: 'ltd', cars: 6, speed: 120,
      route: [['isesaki', '浅草', '東武動物公園'], ['nikko', '東武動物公園', '下今市'], ['kinugawa', '下今市', '鬼怒川温泉']],
      stops: {
        isesaki: ['浅草', 'とうきょうスカイツリー', '北千住', '春日部', '東武動物公園'],
        nikko: ['東武動物公園', '栃木', '新鹿沼', '下今市'],
        kinugawa: ['下今市', '東武ワールドスクウェア', '鬼怒川温泉'],
      },
      slots: [['08:00', '18:00', 120, 0]], revOffset: 60,
    },
    {
      name: '急行（半蔵門線直通・南栗橋）', prefix: 'E', type: 'express', cars: 10, speed: 110,
      route: [['isesaki', '北千住', '東武動物公園'], ['nikko', '東武動物公園', '南栗橋']],
      stops: {
        isesaki: ['北千住', '新越谷', '越谷', '北越谷', 'せんげん台', '春日部', '東武動物公園'],
      },
      slots: [['05:30', '07:00', 20, 0], ['07:00', '09:00', 10, 0], ['09:00', '17:00', 20, 0], ['17:00', '20:00', 10, 0], ['20:00', '23:30', 20, 0]],
      revOffset: 8,
    },
    {
      name: '普通', prefix: 'L', type: 'local', cars: 6, speed: 100,
      route: [['isesaki', '浅草', '東武動物公園']],
      slots: [['05:20', '23:40', 20, 5]], revOffset: 12,
    },
    {
      name: '普通（日比谷線直通）', prefix: 'H', type: 'local', cars: 7, speed: 100,
      route: [['isesaki', '北千住', '北越谷']],
      slots: [['05:30', '07:00', 15, 3], ['07:00', '09:30', 8, 3], ['09:30', '17:00', 15, 3], ['17:00', '20:00', 10, 3], ['20:00', '23:30', 15, 3]],
      revOffset: 6,
    },
    {
      name: '日光線 普通', prefix: 'N', type: 'local', cars: 4, speed: 110,
      route: [['nikko', '南栗橋', '東武日光']],
      slots: [['05:30', '22:30', 60, 10]], revOffset: 35,
    },
    {
      name: '鬼怒川線 普通', prefix: 'G', type: 'local', cars: 2, speed: 85,
      route: [['kinugawa', '下今市', '新藤原']],
      slots: [['06:00', '22:00', 60, 5]], revOffset: 30,
    },
    {
      // SL大樹：下今市〜鬼怒川温泉。両端で機回し（転車台で機関車の向きも変える）
      name: 'SL大樹', prefix: 'SL', type: 'express', cars: 4, speed: 60, loco: true, dwell: 60,
      route: [['kinugawa', '下今市', '鬼怒川温泉']],
      stops: { kinugawa: ['下今市', '大桑', '新高徳', '鬼怒川温泉'] },
      slots: [['09:42', '16:30', 180, 0]], revOffset: 95,
    },
  ],
};
