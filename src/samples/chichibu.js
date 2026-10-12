// サンプル11：秩父鉄道 秩父本線（羽生〜三峰口）
// 配線：配線略図.net（秩父鉄道秩父本線）、キロ程：Wikipedia 秩父鉄道秩父本線
// 全線単線。熊谷〜広瀬川原に車両基地（広瀬川原車両基地）。広瀬川原・武州原谷は貨物駅（旅客列車は通過）。
// SLパレオエクスプレスは熊谷〜三峰口の機関車牽引列車で、三峰口で機回し（転車台つき）をする。

import diagram from './data/chichibu.js';
import { P } from './util.js';

export default {
  diagram,
  id: 'chichibu', no: 11,
  title: '秩父鉄道 秩父本線（羽生〜三峰口）',
  note: '荒川沿いを走る単線のローカル線。熊谷〜寄居の区間運転、急行秩父路、SLパレオエクスプレスと三峰口の転車台。',
  self: 'chichibu',
  spacing: 420,
  settings: {
    defaultMaxSpeedKmh: 85, farePerKm: 30, fareBase: 170, dailyTripRate: 0.16,
    reversalMinutes: 3, targetCashOku: 40, startCashOku: 10,
    costPerRouteKmDay: 15000, costPerStationDay: 8000, costPerCarKm: 150, costPerCarDay: 8000,
    runAroundMinutes: 15,
  },
  operators: {
    chichibu: { name: '秩父鉄道', short: '秩', color: '#0b5aa8' },
  },
  lines: [
    {
      key: 'main', name: '秩父本線', color: '#0b5aa8', op: 'chichibu', vmax: 85, double: false,
      safety: ['ats_sn'], maxCars: 4, heading: 230,
      turns: { '熊谷': 250, '寄居': 225, '長瀞': 200, '秩父': 225 },
      stations: [
        ['羽生', 0.0, 't', P(2.5, 'mixed', { stubs: 1 })],
        ['西羽生', 1.2, 's', P(0.2, 'residential')],
        ['新郷', 2.6, 's', P(0.3, 'residential')],
        ['武州荒木', 4.8, 's', P(0.3, 'residential')],
        ['東行田', 7.3, 's', P(0.4, 'residential')],
        ['行田市', 8.3, 'p', P(1.5, 'mixed')],
        ['持田', 10.1, 's', P(0.6, 'residential')],
        ['ソシオ流通センター', 11.6, 's', P(0.4, 'business')],
        ['熊谷', 14.9, 'p', P(9, 'urban')],
        ['上熊谷', 15.8, 's', P(0.5, 'residential')],
        ['石原', 17.0, 'p', P(0.6, 'residential')],
        ['ひろせ野鳥の森', 18.5, 's', P(0.3, 'residential')],
        ['大麻生', 20.3, 'p', P(0.4, 'residential')],
        ['明戸', 22.9, 's', P(0.2, 'residential')],
        ['武川', 24.8, 'p', P(0.5, 'residential')],
        ['永田', 27.1, 's', P(0.3, 'residential')],
        ['ふかや花園', 28.2, 's', P(0.6, 'tourist')],
        ['小前田', 30.5, 'p', P(0.4, 'residential')],
        ['桜沢', 31.9, 's', P(0.3, 'residential')],
        ['寄居', 33.8, 'p', P(2, 'mixed')],
        ['波久礼', 37.7, 's', P(0.2, 'tourist')],
        ['樋口', 42.1, 'p', P(0.2, 'residential')],
        ['野上', 44.7, 'p', P(0.3, 'residential')],
        ['長瀞', 46.5, 'p', P(1.5, 'tourist')],
        ['上長瀞', 47.6, 's', P(0.4, 'tourist')],
        ['親鼻', 49.2, 's', P(0.2, 'residential')],
        ['皆野', 50.8, 'p', P(0.8, 'residential')],
        ['和銅黒谷', 53.4, 's', P(0.3, 'tourist')],
        ['大野原', 56.6, 's', P(0.5, 'residential')],
        ['秩父', 59.0, 'p', P(2, 'mixed')],
        ['御花畑', 59.7, 'p', P(1.5, 'mixed')],
        ['影森', 62.4, 'p', P(0.4, 'residential')],
        ['浦山口', 63.8, 's', P(0.2, 'tourist')],
        ['武州中川', 66.2, 's', P(0.2, 'residential')],
        ['武州日野', 67.7, 's', P(0.2, 'residential')],
        ['白久', 70.4, 's', P(0.2, 'residential')],
        ['三峰口', 71.7, 't', P(0.5, 'tourist', { stubs: 2 })],
      ],
    },
  ],
  through: [],
  depots: [
    { line: 'main', at: 'ひろせ野鳥の森', name: '広瀬川原車両基地', side: 1, own: true, min: 6, cars: 3 },
  ],
  fleet: { prefix: '', suffix: '編成', series: '7500系・7800系・5000系・6000系' },
  fleets: [
    { line: 'main', prefix: 'SL', suffix: '', series: 'SLパレオエクスプレス（C58＋12系）', depot: '広瀬川原車両基地', start: 1 },
  ],
  services: [
    {
      name: '普通（羽生〜影森・三峰口）', prefix: 'C', type: 'local', cars: 3, speed: 85,
      route: [['main', '羽生', '三峰口']],
      slots: [['05:30', '07:00', 60, 0], ['07:00', '09:00', 40, 0], ['09:00', '17:00', 60, 0], ['17:00', '20:00', 40, 0], ['20:00', '22:00', 60, 0]],
      revOffset: 30,
    },
    {
      name: '普通（熊谷〜寄居）', prefix: 'K', type: 'local', cars: 3, speed: 85,
      route: [['main', '熊谷', '寄居']],
      slots: [['06:20', '09:00', 40, 20], ['16:30', '20:00', 40, 20]],
      revOffset: 10,
    },
    {
      name: '急行秩父路', prefix: 'E', type: 'express', cars: 3, speed: 85,
      route: [['main', '羽生', '三峰口']],
      stops: { main: ['羽生', '行田市', '熊谷', '石原', '大麻生', '武川', '永田', '小前田', '寄居', '樋口', '野上', '長瀞', '上長瀞', '親鼻', '皆野', '秩父', '御花畑', '影森', '三峰口'] },
      slots: [['08:10', '17:00', 180, 0]], revOffset: 90,
    },
    {
      // SLパレオエクスプレス：熊谷〜三峰口。三峰口で機回しと転車台での転向
      name: 'SLパレオエクスプレス', prefix: 'SL', type: 'express', cars: 4, speed: 60, loco: true, dwell: 60,
      route: [['main', '熊谷', '三峰口']],
      stops: { main: ['熊谷', '寄居', '長瀞', '皆野', '秩父', '御花畑', '三峰口'] },
      slots: [['10:10', '10:20', 60, 0]], revOffset: 140,
    },
  ],
};
