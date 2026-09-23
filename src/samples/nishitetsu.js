// サンプル4：西鉄電車 全線（天神大牟田線・太宰府線・甘木線・貝塚線）
// 配線：配線略図.net（西鉄天神大牟田線ほか）、駅の番線数：Wikipedia 各駅記事（docs/sample-stations.md）　キロ程：Wikipedia 各線の駅一覧
// 天神大牟田線は 聖マリア病院前〜大善寺・蒲池〜開 が単線。太宰府線・甘木線・貝塚線は全線単線。
// 貝塚線はほかの線とつながっていない（独立した車庫を持つ）。

import { P } from './util.js';

export default {
  id: 'nishitetsu', no: 4,
  title: '西鉄電車 全線（天神大牟田線・太宰府線・甘木線・貝塚線）',
  note: '天神から大牟田まで74.8km。単線区間の行き違い、二日市・宮の陣で分かれる支線、線路のつながっていない貝塚線。',
  self: 'nnr',
  spacing: 420,
  settings: {
    defaultMaxSpeedKmh: 110, farePerKm: 22, fareBase: 180, costPerCarKm: 230, dailyTripRate: 0.4,
    reversalMinutes: 3, targetCashOku: 500, startCashOku: 100,
  },
  operators: {
    nnr: { name: '西日本鉄道', short: '西', color: '#c8161d' },
  },
  lines: [
    {
      key: 'omuta', name: '天神大牟田線', color: '#c8161d', op: 'nnr', vmax: 110,
      safety: ['ats_sn'], maxCars: 7, heading: 80,
      turns: { '西鉄二日市': 95, '西鉄久留米': 118, '西鉄柳川': 95 },
      singles: [['聖マリア病院前', '大善寺'], ['蒲池', '開']],
      stations: [
        ['西鉄福岡（天神）', 0.0, 't', P(130, 'urban', { stubs: 3 })],
        ['薬院', 0.8, 's', P(25, 'mixed')], ['西鉄平尾', 1.8, 's', P(15, 'residential')],
        ['高宮', 2.9, 's', P(12, 'residential')], ['大橋', 4.3, 'p', P(30, 'mixed')],
        ['井尻', 6.1, 's', P(10, 'residential')], ['雑餉隈', 8.0, 's', P(10, 'residential')],
        ['桜並木', 8.5, 's', P(5, 'residential')], ['春日原', 9.5, 'p', P(12, 'residential')],
        ['白木原', 10.8, 's', P(8, 'residential')], ['下大利', 11.6, 's', P(12, 'residential')],
        ['都府楼前', 13.8, 's', P(7, 'residential')], ['西鉄二日市', 15.2, 'p', P(20, 'mixed')],
        ['紫', 16.1, 's', P(8, 'residential')], ['朝倉街道', 17.6, 's', P(10, 'residential')],
        ['桜台', 19.4, 's', P(5, 'residential')], ['筑紫', 20.8, 'p', P(10, 'residential')],
        ['津古', 23.0, 's', P(5, 'residential')], ['三国が丘', 24.1, 's', P(6, 'residential')],
        ['三沢', 25.6, 's', P(4, 'school')], ['大保', 27.0, 's', P(3, 'residential')],
        ['西鉄小郡', 28.7, 'p', P(8, 'mixed')], ['端間', 30.7, 's', P(2, 'residential')],
        ['味坂', 33.7, 's', P(1, 'residential')], ['宮の陣', 36.5, 's', P(3, 'residential')],
        ['櫛原', 37.7, 's', P(3, 'residential')], ['西鉄久留米', 38.6, 'p', P(25, 'urban')],
        ['花畑', 39.5, 'p', P(7, 'mixed')], ['聖マリア病院前', 40.1, 'pd', P(3, 'mixed')],
        ['津福', 41.4, 'pd', P(2, 'residential')], ['安武', 42.8, 'pd', P(2, 'residential')],
        ['大善寺', 45.1, 'p', P(3, 'residential')], ['三潴', 46.9, 's', P(2, 'residential')],
        ['犬塚', 48.0, 's', P(1, 'residential')], ['大溝', 50.6, 's', P(1, 'residential')],
        ['八丁牟田', 52.9, 's', P(1, 'residential')], ['蒲池', 55.5, 'pd', P(1, 'residential')],
        ['矢加部', 57.3, 's', P(1, 'residential')], ['西鉄柳川', 58.4, 'p', P(8, 'tourist')],
        ['徳益', 59.7, 's', P(1, 'residential')], ['塩塚', 61.1, 'pd', P(1, 'residential')],
        ['西鉄中島', 63.5, 's', P(1, 'residential')], ['江の浦', 65.1, 'pd', P(1, 'residential')],
        ['開', 66.6, 'pd', P(1, 'residential')], ['西鉄渡瀬', 67.9, 'p', P(2, 'residential')],
        ['倉永', 69.6, 's', P(1, 'residential')], ['東甘木', 70.8, 's', P(1, 'residential')],
        ['西鉄銀水', 72.1, 's', P(2, 'residential')], ['新栄町', 73.7, 's', P(3, 'mixed')],
        ['大牟田', 74.8, 't', P(8, 'mixed', { stubs: 3 })],
      ],
    },
    {
      key: 'dazaifu', name: '太宰府線', color: '#e8618c', op: 'nnr', vmax: 65, double: false,
      safety: ['ats_sn'], maxCars: 7, heading: 45,
      attach: { line: 'omuta', at: '西鉄二日市', mode: 'branch', offset: 250, ownStation: true },
      turns: { '西鉄五条': 10 },
      stations: [
        ['西鉄二日市', 0.0, 's', P(4, 'mixed')], ['西鉄五条', 1.4, 'pd', P(4, 'residential')],
        ['太宰府', 2.4, 't', P(15, 'tourist', { stubs: 2 })],
      ],
    },
    {
      key: 'amagi', name: '甘木線', color: '#7a9a3a', op: 'nnr', vmax: 85, double: false,
      safety: ['ats_sn'], maxCars: 3, heading: 50,
      attach: { line: 'omuta', at: '宮の陣', mode: 'branch', offset: 250, ownStation: true },
      turns: { '五郎丸': 0 },
      stations: [
        ['宮の陣', 0.0, 's', P(1, 'residential')], ['五郎丸', 0.9, 's', P(1, 'residential')],
        ['学校前', 1.7, 'pd', P(2, 'school')], ['古賀茶屋', 3.9, 's', P(1, 'residential')],
        ['北野', 5.4, 'pd', P(2, 'residential')], ['大城', 8.0, 's', P(1, 'residential')],
        ['金島', 9.4, 'pd', P(1, 'residential')], ['大堰', 11.6, 's', P(1, 'residential')],
        ['本郷', 13.1, 'pd', P(1, 'residential')], ['上浦', 14.9, 's', P(1, 'residential')],
        ['馬田', 16.1, 's', P(1, 'residential')], ['甘木', 17.9, 'pd', P(3, 'mixed')],
      ],
    },
    {
      key: 'kaizuka', name: '貝塚線', color: '#1065ab', op: 'nnr', vmax: 85, double: false,
      safety: ['ats_sn'], maxCars: 2, heading: 315, origin: { x: 5200, y: -2600 },
      stations: [
        ['貝塚', 0.0, 't', P(10, 'mixed', { stubs: 2 })], ['名島', 1.4, 'pd', P(3, 'residential')],
        ['西鉄千早', 2.5, 'pd', P(8, 'mixed')], ['香椎宮前', 3.0, 's', P(3, 'residential')],
        ['西鉄香椎', 3.6, 'pd', P(6, 'mixed')], ['香椎花園前', 5.0, 'pd', P(3, 'residential')],
        ['唐の原', 6.1, 'pd', P(3, 'residential')], ['和白', 7.2, 'pd', P(6, 'residential')],
        ['三苫', 9.0, 'pd', P(3, 'residential')], ['西鉄新宮', 11.0, 'pd', P(4, 'residential')],
      ],
    },
  ],
  through: [
    { key: 'dz', from: 'omuta', at: '西鉄二日市', name: '太宰府線', line: 'dazaifu', op: 'nnr', pax: 8000 },
    { key: 'am', from: 'omuta', at: '宮の陣', name: '甘木線', line: 'amagi', op: 'nnr', pax: 3000 },
  ],
  depots: [
    { line: 'omuta', at: '筑紫', name: '筑紫車両基地', side: 1, own: true, cars: 7 },
    { line: 'kaizuka', at: '貝塚', name: '多々良車庫', side: -1, own: true, reserved: true, min: 3, cars: 2, offset: 250 },
  ],
  fleet: { prefix: '', suffix: '編成', series: '3000形・5000形' },
  fleets: [
    { line: 'dazaifu', prefix: 'D', suffix: '編成', series: '5000形', depot: '筑紫車両基地', start: 51 },
    { line: 'kaizuka', prefix: 'K', suffix: '編成', series: '600形', depot: '多々良車庫', start: 1 },
  ],
  services: [
    {
      name: '特急', prefix: 'T', type: 'ltd', cars: 6, speed: 110,
      route: [['omuta', '西鉄福岡（天神）', '大牟田']],
      stops: { omuta: ['西鉄福岡（天神）', '薬院', '大橋', '西鉄二日市', '西鉄久留米', '花畑', '大善寺', '西鉄柳川', '新栄町', '大牟田'] },
      slots: [['06:30', '22:00', 30, 0]], revOffset: 10,
    },
    {
      name: '急行', prefix: 'E', type: 'express', cars: 7, speed: 110,
      route: [['omuta', '西鉄福岡（天神）', '花畑']],
      stops: {
        omuta: ['西鉄福岡（天神）', '薬院', '大橋', '春日原', '下大利', '西鉄二日市', '朝倉街道', '筑紫', '三国が丘',
          '西鉄小郡', '宮の陣', '櫛原', '西鉄久留米', '花畑'],
      },
      slots: [['06:00', '23:00', 30, 15]], revOffset: 25,
    },
    {
      name: '普通（天神〜花畑）', prefix: 'L', type: 'local', cars: 7, speed: 100,
      route: [['omuta', '西鉄福岡（天神）', '花畑']],
      slots: [['05:30', '07:00', 30, 5], ['07:00', '09:00', 15, 5], ['09:00', '17:00', 30, 5], ['17:00', '20:00', 15, 5], ['20:00', '23:30', 30, 5]],
      revOffset: 7,
    },
    {
      name: '普通（天神〜筑紫）', prefix: 'M', type: 'local', cars: 7, speed: 100,
      route: [['omuta', '西鉄福岡（天神）', '筑紫']],
      slots: [['05:45', '07:00', 30, 0], ['07:00', '09:00', 15, 8], ['09:00', '17:00', 30, 20], ['17:00', '20:00', 15, 8], ['20:00', '23:30', 30, 20]],
      revOffset: 12,
    },
    {
      name: '普通（花畑〜大牟田）', prefix: 'S', type: 'local', cars: 3, speed: 100,
      route: [['omuta', '花畑', '大牟田']],
      slots: [['05:40', '23:00', 30, 8]], revOffset: 20,
    },
    {
      name: '太宰府線 普通', prefix: 'D', type: 'local', cars: 3, speed: 65,
      route: [['dazaifu', '西鉄二日市', '太宰府']],
      slots: [['05:40', '23:30', 10, 2]], revOffset: 5,
    },
    {
      name: '甘木線 普通', prefix: 'A', type: 'local', cars: 2, speed: 85,
      route: [['omuta', '西鉄久留米', '宮の陣'], ['amagi', '宮の陣', '甘木']],
      stops: { omuta: ['西鉄久留米', '宮の陣'] },
      slots: [['06:00', '23:00', 30, 3]], revOffset: 12,
    },
    {
      name: '貝塚線 普通', prefix: 'K', type: 'local', cars: 2, speed: 85,
      route: [['kaizuka', '貝塚', '西鉄新宮']],
      slots: [['05:40', '07:00', 15, 0], ['07:00', '09:00', 12, 0], ['09:00', '17:00', 15, 0], ['17:00', '20:00', 12, 0], ['20:00', '23:30', 15, 0]],
      revOffset: 8,
    },
  ],
};
