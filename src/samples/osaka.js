// サンプル3：大阪環状線と阪和線・関西空港線・大和路線・JRゆめ咲線
// 配線：配線略図.net（大阪環状線・阪和線・関西本線）　キロ程：Wikipedia 各線の駅一覧
// 環状線は天王寺起点（寺田町・鶴橋・京橋・大阪・西九条・新今宮まわり）で1周21.7km。
// 大和路快速・関空/紀州路快速は環状線を1周して元の線へ戻る。
// 関空快速と紀州路快速は天王寺〜日根野（と環状線内）で併結し、日根野で分割・併合する。

import { P } from './util.js';

export default {
  id: 'osaka', no: 3,
  title: '大阪環状線と阪和線・大和路線',
  note: '環状線を1周して戻る大和路快速・関空/紀州路快速、日根野での分割・併合、西九条からのJRゆめ咲線。',
  self: 'jrw',
  spacing: 440,
  settings: {
    defaultMaxSpeedKmh: 110, farePerKm: 18, fareBase: 150, dailyTripRate: 0.14,
    reversalMinutes: 3, targetCashOku: 800, startCashOku: 150,
  },
  operators: {
    jrw: { name: 'JR西日本', short: 'J', color: '#0072bc' },
  },
  lines: [
    {
      key: 'kanjo', name: '大阪環状線', color: '#e8474c', op: 'jrw', vmax: 95, ring: true,
      safety: ['ats_p'], maxCars: 8,
      stations: [
        ['天王寺', 0.0, 'p', P(140, 'urban')],
        ['寺田町', 1.0, 's', P(18, 'residential')],
        ['桃谷', 2.2, 's', P(22, 'residential')],
        ['鶴橋', 3.0, 's', P(95, 'urban')],
        ['玉造', 3.9, 's', P(20, 'residential')],
        ['森ノ宮', 4.8, 's', P(35, 'mixed')],
        ['大阪城公園', 5.7, 's', P(30, 'tourist')],
        ['京橋', 6.5, 'p', P(130, 'urban')],
        ['桜ノ宮', 8.3, 's', P(20, 'mixed')],
        ['天満', 9.1, 's', P(30, 'mixed')],
        ['大阪', 10.7, 'p', P(260, 'business')],
        ['福島', 11.7, 's', P(30, 'business')],
        ['野田', 13.1, 's', P(20, 'mixed')],
        ['西九条', 14.3, 'p', P(40, 'mixed')],
        ['弁天町', 15.9, 's', P(40, 'mixed')],
        ['大正', 17.7, 's', P(30, 'mixed')],
        ['芦原橋', 18.9, 's', P(8, 'residential')],
        ['今宮', 19.5, 's', P(6, 'residential')],
        ['新今宮', 20.7, 's', P(60, 'mixed')],
        ['天王寺', 21.7, 's'],
      ],
    },
    {
      key: 'hanwa', name: '阪和線', color: '#f39800', op: 'jrw', vmax: 120,
      safety: ['ats_p'], maxCars: 8, heading: 45, endEnd: 'boundary',
      attach: { line: 'kanjo', at: '天王寺', mode: 'branch', offset: 150, ownStation: true },
      turns: { '美章園': 100, '日根野': 125 },
      stations: [
        ['天王寺', 0.0, 't', P(60, 'urban', { stubs: 4 })], ['美章園', 1.5, 's', P(8, 'residential')], ['南田辺', 3.0, 's', P(10, 'residential')],
        ['鶴ケ丘', 3.9, 'p', P(10, 'residential')], ['長居', 4.7, 's', P(20, 'mixed')], ['我孫子町', 5.9, 's', P(15, 'residential')],
        ['杉本町', 6.9, 'p', P(18, 'school')], ['浅香', 7.9, 's', P(6, 'residential')], ['堺市', 8.8, 's', P(18, 'residential')],
        ['三国ケ丘', 10.2, 's', P(30, 'mixed')], ['百舌鳥', 11.1, 's', P(6, 'residential')], ['上野芝', 12.4, 'p', P(12, 'residential')],
        ['津久野', 13.7, 's', P(12, 'residential')], ['鳳', 15.1, 'p', P(25, 'mixed')], ['富木', 16.3, 's', P(8, 'residential')],
        ['北信太', 18.0, 's', P(8, 'residential')], ['信太山', 19.4, 's', P(8, 'residential')], ['和泉府中', 20.9, 'p', P(30, 'mixed')],
        ['久米田', 23.9, 's', P(10, 'residential')], ['下松', 25.1, 's', P(6, 'residential')], ['東岸和田', 26.5, 'p', P(25, 'mixed')],
        ['東貝塚', 28.1, 'p', P(8, 'residential')], ['和泉橋本', 30.0, 's', P(6, 'residential')], ['東佐野', 31.5, 's', P(6, 'residential')],
        ['熊取', 33.0, 'p', P(18, 'school')], ['日根野', 34.9, 'p', P(20, 'mixed')], ['長滝', 36.3, 'p', P(4, 'residential')],
        ['新家', 38.6, 's', P(6, 'residential')], ['和泉砂川', 40.5, 'p', P(10, 'residential')], ['和泉鳥取', 43.3, 's', P(4, 'residential')],
        ['山中渓', 45.2, 's', P(2, 'tourist')], ['紀伊', 53.3, 'p', P(6, 'residential')], ['六十谷', 57.2, 's', P(6, 'residential')],
        ['紀伊中ノ島', 60.2, 's', P(4, 'residential')], ['和歌山', 61.3, 'p', P(40, 'urban')],
      ],
    },
    {
      key: 'kanku', name: '関西空港線', color: '#00a0e9', op: 'jrw', vmax: 130,
      safety: ['ats_p'], maxCars: 8, heading: 175,
      attach: { line: 'hanwa', at: '日根野', mode: 'branch', offset: 260 },
      stations: [
        ['日根野', 0.0], ['りんくうタウン', 4.2, 'p', P(10, 'business')],
        ['関西空港', 11.1, 't', P(60, 'airport', { stubs: 2 })],
      ],
    },
    {
      key: 'yamatoji', name: '大和路線', color: '#00a95f', op: 'jrw', vmax: 120,
      safety: ['ats_p'], maxCars: 8, heading: 25,
      attach: { line: 'kanjo', at: '天王寺', mode: 'branch', offset: 300, ownStation: true },
      turns: { '東部市場前': 0, '王寺': 340, '奈良': 300 },
      stations: [
        ['天王寺', 0.0, 'p', P(40, 'urban')], ['東部市場前', 2.4, 's', P(10, 'mixed')], ['平野', 3.9, 'p', P(12, 'residential')],
        ['加美', 5.4, 's', P(12, 'residential')], ['久宝寺', 7.1, 'p', P(20, 'mixed')], ['八尾', 8.3, 's', P(15, 'residential')],
        ['志紀', 10.9, 's', P(8, 'residential')], ['柏原', 12.6, 'p', P(12, 'residential')], ['高井田', 15.0, 's', P(5, 'residential')],
        ['河内堅上', 17.4, 's', P(1, 'residential')], ['三郷', 20.3, 's', P(6, 'residential')], ['王寺', 22.1, 'p', P(40, 'mixed')],
        ['法隆寺', 25.7, 's', P(10, 'tourist')], ['大和小泉', 28.9, 's', P(10, 'residential')], ['郡山', 32.7, 's', P(10, 'residential')],
        ['奈良', 37.5, 'p', P(40, 'tourist')], ['平城山', 41.3, 's', P(6, 'residential')], ['木津', 44.5, 'p', P(8, 'mixed')],
        ['加茂', 50.5, 't', P(5, 'residential', { stubs: 2 })],
      ],
    },
    {
      key: 'yumesaki', name: 'JRゆめ咲線', color: '#e4007f', op: 'jrw', vmax: 85,
      safety: ['ats_p'], maxCars: 8, heading: 145,
      attach: { line: 'kanjo', at: '西九条', mode: 'branch', offset: 200, ownStation: true },
      turns: { '安治川口': 180 },
      stations: [
        ['西九条', 0.0, 's', P(10, 'mixed')], ['安治川口', 2.4, 'p', P(8, 'business')], ['ユニバーサルシティ', 3.2, 's', P(45, 'tourist')],
        ['桜島', 4.1, 't', P(5, 'business', { stubs: 2 })],
      ],
    },
  ],
  through: [
    { key: 'hw', from: 'kanjo', at: '天王寺', name: '阪和線', line: 'hanwa', op: 'jrw', pax: 60000 },
    { key: 'ku', from: 'kanjo', at: '天王寺', name: '関西空港線', line: 'kanku', op: 'jrw', via: ['hw'], pax: 15000 },
    { key: 'ym', from: 'kanjo', at: '天王寺', name: '大和路線', line: 'yamatoji', op: 'jrw', pax: 50000 },
    { key: 'ys', from: 'kanjo', at: '西九条', name: 'JRゆめ咲線', line: 'yumesaki', op: 'jrw', pax: 20000 },
  ],
  depots: [
    { line: 'kanjo', at: '森ノ宮', name: '森ノ宮支所', side: 1, own: true, share: 0.45, cars: 8 },
    { line: 'hanwa', at: '日根野', name: '日根野支所', side: -1, own: true, share: 0.35, cars: 8, offset: -700 },
    { line: 'yamatoji', at: '奈良', name: '奈良支所', side: 1, own: true, share: 0.2, cars: 8, offset: 300 },
  ],
  fleet: { prefix: 'LA', suffix: '', series: '323系' },
  services: [
    {
      name: '環状線 普通', prefix: 'O', type: 'local', cars: 8, speed: 95,
      route: [['kanjo', '天王寺', '天王寺*']],
      slots: [['05:20', '07:00', 10, 0], ['07:00', '09:30', 6, 0], ['09:30', '17:00', 10, 0], ['17:00', '20:00', 6, 0], ['20:00', '23:40', 10, 0]],
      revOffset: 5,
    },
    {
      // 紀州路快速：和歌山〜天王寺〜環状線1周〜天王寺〜和歌山。天王寺〜日根野では関空快速を併結
      name: '紀州路快速', prefix: 'W', type: 'rapid', cars: 4, speed: 120,
      route: [['hanwa', '和歌山', '天王寺'], ['kanjo', '天王寺', '天王寺*'], ['hanwa', '天王寺', '和歌山']],
      stops: {
        hanwa: ['和歌山', '紀伊中ノ島', '六十谷', '紀伊', '山中渓', '和泉鳥取', '和泉砂川', '新家', '長滝', '日根野',
          '熊取', '東岸和田', '和泉府中', '鳳', '三国ケ丘', '堺市', '天王寺'],
        kanjo: ['天王寺', '鶴橋', '京橋', '大阪', '福島', '西九条', '弁天町', '新今宮', '天王寺'],
      },
      slots: [['06:00', '22:00', 15, 0]], both: false,
    },
    {
      name: '関空快速', prefix: 'A', type: 'rapid', cars: 4, speed: 120,
      with: { service: 'W', on: ['hanwa', 'kanjo'] },
      route: [['kanku', '関西空港', '日根野'], ['hanwa', '日根野', '天王寺'], ['kanjo', '天王寺', '天王寺*'],
        ['hanwa', '天王寺', '日根野'], ['kanku', '日根野', '関西空港']],
      slots: [['06:00', '22:00', 15, 0]], both: false,
    },
    {
      name: '大和路快速', prefix: 'Y', type: 'rapid', cars: 8, speed: 120,
      route: [['yamatoji', '加茂', '天王寺'], ['kanjo', '天王寺*', '天王寺'], ['yamatoji', '天王寺', '加茂']],
      stops: {
        yamatoji: ['加茂', '木津', '平城山', '奈良', '郡山', '大和小泉', '法隆寺', '王寺', '久宝寺', '天王寺'],
        kanjo: ['天王寺', '新今宮', '弁天町', '西九条', '福島', '大阪', '天満', '京橋', '大阪城公園', '森ノ宮', '玉造', '鶴橋', '桃谷', '寺田町', '天王寺'],
      },
      slots: [['06:10', '22:10', 15, 0]], both: false,
    },
    {
      name: '特急はるか', prefix: 'H', type: 'ltd', cars: 6, speed: 130,
      route: [['hanwa', '天王寺', '日根野'], ['kanku', '日根野', '関西空港']],
      stops: { hanwa: ['天王寺', '日根野'] },
      slots: [['06:30', '21:30', 30, 0]], revOffset: 20,
    },
    {
      name: '阪和線 普通', prefix: 'R', type: 'local', cars: 4, speed: 110,
      route: [['hanwa', '天王寺', '日根野']],
      slots: [['05:30', '07:00', 15, 5], ['07:00', '09:00', 10, 5], ['09:00', '17:00', 15, 5], ['17:00', '20:00', 10, 5], ['20:00', '23:30', 15, 5]],
      revOffset: 6,
    },
    {
      name: '大和路線 普通', prefix: 'N', type: 'local', cars: 6, speed: 110,
      route: [['yamatoji', '天王寺', '奈良']],
      slots: [['05:30', '23:30', 15, 7]], revOffset: 9,
    },
    {
      name: 'ゆめ咲線 普通', prefix: 'U', type: 'local', cars: 8, speed: 85,
      route: [['yumesaki', '西九条', '桜島']],
      slots: [['05:30', '23:30', 12, 3]], revOffset: 6,
    },
  ],
};
