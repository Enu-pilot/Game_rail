// サンプル5：一畑電車（北松江線・大社線）
// 配線：配線略図.net（一畑電車）、駅の番線数：Wikipedia 各駅記事（docs/sample-stations.md）　キロ程：Wikipedia 各線の駅一覧
// 全線単線。行き違いできる駅は 電鉄出雲市・大津町・川跡・雲州平田・津ノ森・秋鹿町・
// 松江イングリッシュガーデン前・松江しんじ湖温泉・出雲大社前。一畑口はスイッチバック駅。

import { P } from './util.js';

export default {
  id: 'ichibata', no: 5,
  title: '一畑電車（北松江線・大社線）',
  note: '宍道湖の北岸を走る単線のローカル線。一畑口のスイッチバック、川跡での大社線との接続。',
  self: 'ichibata',
  spacing: 420,
  settings: {
    defaultMaxSpeedKmh: 85, farePerKm: 28, fareBase: 170, dailyTripRate: 0.16,
    reversalMinutes: 3, targetCashOku: 30, startCashOku: 8,
    costPerRouteKmDay: 15000, costPerStationDay: 8000, costPerCarKm: 150, costPerCarDay: 8000,
  },
  operators: {
    ichibata: { name: '一畑電車', short: '畑', color: '#e7792b' },
  },
  lines: [
    {
      key: 'kitamatsue', name: '北松江線', color: '#e7792b', op: 'ichibata', vmax: 85, double: false,
      safety: ['ats_sn'], maxCars: 3, heading: 320,
      // 一畑口で向きを変えて（スイッチバック）松江へ向かう
      turns: { '川跡': 330, '雲州平田': 345, '一畑口': { h: 55, at: 0 }, '伊野灘': 10, '松江イングリッシュガーデン前': 20 },
      stations: [
        ['電鉄出雲市', 0.0, 't', P(3, 'mixed', { stubs: 2 })],
        ['出雲科学館パークタウン前', 0.8, 's', P(1, 'school')],
        ['大津町', 2.0, 'pd', P(1, 'residential')],
        ['武志', 4.1, 's', P(0.5, 'residential')],
        ['川跡', 4.9, 'p', P(1, 'residential')],
        ['大寺', 6.4, 's', P(0.3, 'residential')],
        ['美談', 7.7, 's', P(0.3, 'residential')],
        ['旅伏', 9.0, 's', P(0.3, 'residential')],
        ['雲州平田', 10.9, 'p', P(1.5, 'mixed')],
        ['布崎', 14.5, 's', P(0.2, 'residential')],
        ['湖遊館新駅', 15.2, 's', P(0.3, 'tourist')],
        ['園', 15.9, 's', P(0.2, 'residential')],
        ['一畑口', 17.5, 'p', P(0.3, 'residential', { dwell: 150 })],
        ['伊野灘', 19.4, 's', P(0.2, 'residential')],
        ['津ノ森', 21.2, 'pd', P(0.2, 'residential')],
        ['高ノ宮', 22.5, 's', P(0.2, 'residential')],
        ['松江フォーゲルパーク', 23.8, 's', P(0.5, 'tourist')],
        ['秋鹿町', 25.0, 'pd', P(0.3, 'residential')],
        ['長江', 26.7, 's', P(0.3, 'residential')],
        ['朝日ヶ丘', 28.0, 's', P(0.3, 'residential')],
        ['松江イングリッシュガーデン前', 29.6, 'pd', P(0.5, 'tourist')],
        ['松江しんじ湖温泉', 33.9, 't', P(2, 'tourist', { stubs: 2 })],
      ],
    },
    {
      key: 'taisha', name: '大社線', color: '#b5471b', op: 'ichibata', vmax: 85, double: false,
      safety: ['ats_sn'], maxCars: 3, heading: 280,
      attach: { line: 'kitamatsue', at: '川跡', mode: 'branch', offset: 230, ownStation: true },
      turns: { '高浜': 235 },
      stations: [
        ['川跡', 0.0, 's', P(0.5, 'residential')], ['高浜', 2.8, 's', P(0.3, 'residential')],
        ['遙堪', 4.8, 's', P(0.3, 'residential')], ['浜山公園北口', 6.4, 's', P(0.5, 'tourist')],
        ['出雲大社前', 8.3, 't', P(3, 'tourist', { stubs: 2 })],
      ],
    },
  ],
  through: [
    { key: 'ts', from: 'kitamatsue', at: '川跡', name: '大社線', line: 'taisha', op: 'ichibata', pax: 1500 },
  ],
  depots: [
    { line: 'kitamatsue', at: '雲州平田', name: '雲州平田車庫', side: 1, own: true, min: 4, cars: 3 },
  ],
  fleet: { prefix: '', suffix: '編成', series: '7000系・5000系' },
  fleets: [
    { line: 'taisha', prefix: 'T', suffix: '編成', series: '1000系', depot: '雲州平田車庫', start: 21 },
  ],
  services: [
    {
      name: '普通（電鉄出雲市〜松江しんじ湖温泉）', prefix: 'M', type: 'local', cars: 2, speed: 85,
      route: [['kitamatsue', '電鉄出雲市', '松江しんじ湖温泉']],
      slots: [['05:50', '07:00', 60, 0], ['07:00', '09:00', 30, 0], ['09:00', '17:00', 60, 0], ['17:00', '19:00', 30, 0], ['19:00', '22:00', 60, 0]],
      revOffset: 5,
    },
    {
      name: '特急・急行（出雲大社前〜松江しんじ湖温泉）', prefix: 'S', type: 'express', cars: 2, speed: 85,
      route: [['taisha', '出雲大社前', '川跡'], ['kitamatsue', '川跡', '松江しんじ湖温泉']],
      stops: {
        taisha: ['出雲大社前', '川跡'],
        kitamatsue: ['川跡', '雲州平田', '一畑口', '松江フォーゲルパーク', '松江しんじ湖温泉'],
      },
      slots: [['09:30', '16:00', 180, 0]], revOffset: 60,
    },
    {
      name: '大社線 普通', prefix: 'T', type: 'local', cars: 2, speed: 85,
      route: [['taisha', '川跡', '出雲大社前']],
      slots: [['06:10', '21:30', 60, 20]], revOffset: 32,
    },
    {
      name: '普通（電鉄出雲市〜出雲大社前）', prefix: 'D', type: 'local', cars: 2, speed: 85,
      route: [['kitamatsue', '電鉄出雲市', '川跡'], ['taisha', '川跡', '出雲大社前']],
      slots: [['06:40', '08:40', 60, 0], ['16:40', '18:40', 60, 0]], revOffset: 40,
    },
  ],
};
