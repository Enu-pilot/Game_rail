// サンプル2：近鉄奈良線（大阪難波〜近鉄奈良）と阪神なんば線・京都線・橿原線
// 配線：配線略図.net（近鉄奈良線・難波線）、駅の番線数：Wikipedia 各駅記事（docs/sample-stations.md）　キロ程：Wikipedia 各線の駅一覧
// 奈良線は運転系統上の「大阪難波〜近鉄奈良」（難波線・大阪線 上本町〜布施を含む）。
// 大和西大寺では京都線と橿原線が奈良線をまたいで平面交差する。

import { P } from './util.js';

export default {
  id: 'kintetsu', no: 2,
  title: '近鉄奈良線と阪神なんば線・京都線・橿原線',
  note: '大阪難波から阪神なんば線（→阪神本線 神戸三宮）へ直通。大和西大寺で京都線・橿原線と平面交差する。',
  self: 'kintetsu',
  spacing: 460,
  settings: {
    defaultMaxSpeedKmh: 105, farePerKm: 20, fareBase: 180, costPerCarKm: 240, dailyTripRate: 0.2,
    reversalMinutes: 3, targetCashOku: 700, startCashOku: 120,
  },
  operators: {
    kintetsu: { name: '近畿日本鉄道', short: '近', color: '#d7263d' },
    hanshin:  { name: '阪神電気鉄道', short: '阪', color: '#f2a900' },
  },
  lines: [
    {
      key: 'nara', name: '奈良線', color: '#d7263d', op: 'kintetsu', vmax: 105,
      safety: ['ats_kintetsu'], maxCars: 10, heading: 0, startEnd: 'open',
      turns: { '布施': 352, '生駒': 5, '学園前': 0 },
      stations: [
        ['大阪難波', 0.0, 'pd', P(150, 'urban')],
        ['近鉄日本橋', 0.8, 's', P(40, 'business')],
        ['大阪上本町', 2.0, 's', P(60, 'urban')],
        ['鶴橋', 3.1, 's', P(170, 'urban')],
        ['布施', 6.1, 'p', P(42, 'mixed')],
        ['河内永和', 6.9, 's', P(10, 'mixed')],
        ['河内小阪', 7.7, 's', P(30, 'school')],
        ['八戸ノ里', 8.5, 'p', P(24, 'residential')],
        ['若江岩田', 10.2, 's', P(15, 'residential')],
        ['河内花園', 11.1, 's', P(12, 'residential')],
        ['東花園', 11.9, 'p', P(16, 'mixed')],
        ['瓢箪山', 13.1, 'p', P(24, 'residential')],
        ['枚岡', 14.4, 's', P(5, 'residential')],
        ['額田', 15.1, 's', P(4, 'residential')],
        ['石切', 16.2, 'p', P(11, 'residential')],
        ['生駒', 20.3, 'p', P(50, 'mixed')],
        ['東生駒', 21.5, 'p', P(19, 'residential')],
        ['富雄', 23.8, 's', P(29, 'residential')],
        ['学園前', 25.2, 's', P(45, 'residential')],
        ['菖蒲池', 26.2, 's', P(10, 'residential')],
        ['大和西大寺', 28.4, 'p', P(50, 'mixed')],
        ['新大宮', 31.1, 's', P(15, 'mixed')],
        ['近鉄奈良', 32.8, 't', P(50, 'tourist', { stubs: 4 })],
      ],
    },
    {
      key: 'hanshin', name: '阪神なんば線・本線', color: '#f2a900', op: 'hanshin', vmax: 106,
      safety: ['ats_hanshin'], maxCars: 10, heading: 180, endEnd: 'boundary',
      attach: { line: 'nara', at: '大阪難波', mode: 'end' },
      turns: { '西九条': 196, '尼崎': 186 },
      stations: [
        ['大阪難波', 0.0], ['桜川', 1.1, 's', P(8, 'mixed')], ['ドーム前', 1.9, 's', P(10, 'mixed')],
        ['九条', 2.5, 's', P(12, 'mixed')], ['西九条', 3.8, 's', P(20, 'mixed')], ['千鳥橋', 4.6, 's', P(5, 'residential')],
        ['伝法', 5.3, 's', P(4, 'residential')], ['福', 6.8, 's', P(3, 'residential')], ['出来島', 7.8, 's', P(4, 'residential')],
        ['大物', 9.2, 'p', P(3, 'residential')], ['尼崎', 10.1, 'p', P(30, 'mixed')],
        ['出屋敷', 11.3, 's', P(8, 'mixed')], ['尼崎センタープール前', 12.0, 'p', P(3, 'residential')],
        ['武庫川', 13.2, 's', P(8, 'residential')], ['鳴尾・武庫川女子大前', 14.4, 's', P(12, 'school')],
        ['甲子園', 15.3, 'p', P(35, 'tourist')], ['久寿川', 16.0, 's', P(4, 'residential')], ['今津', 16.6, 's', P(15, 'mixed')],
        ['西宮', 17.9, 'p', P(28, 'mixed')], ['香櫨園', 19.0, 's', P(6, 'residential')], ['打出', 20.2, 's', P(6, 'residential')],
        ['芦屋', 21.4, 's', P(15, 'residential')], ['深江', 22.7, 's', P(8, 'residential')], ['青木', 23.8, 'p', P(8, 'residential')],
        ['魚崎', 25.0, 's', P(15, 'residential')], ['住吉', 25.8, 's', P(4, 'residential')], ['御影', 26.3, 'p', P(20, 'residential')],
        ['石屋川', 26.9, 's', P(4, 'residential')], ['新在家', 27.8, 's', P(8, 'residential')], ['大石', 28.8, 'p', P(8, 'residential')],
        ['西灘', 29.4, 's', P(4, 'residential')], ['岩屋', 30.0, 's', P(8, 'mixed')], ['春日野道', 31.1, 's', P(15, 'mixed')],
        ['神戸三宮', 32.4, 'pu', P(90, 'urban')],
      ],
    },
    {
      key: 'kyoto', name: '京都線', color: '#e8708a', op: 'kintetsu', vmax: 105,
      safety: ['ats_kintetsu'], maxCars: 8, heading: 285,
      attach: { line: 'nara', at: '大和西大寺', mode: 'branch', offset: 230 },
      turns: { '新田辺': 275 },
      stations: [
        ['大和西大寺', 0.0], ['平城', 1.1, 's', P(5, 'residential')], ['高の原', 3.8, 'p', P(25, 'residential')],
        ['山田川', 5.4, 's', P(4, 'residential')], ['木津川台', 6.4, 's', P(4, 'residential')], ['新祝園', 7.9, 'p', P(12, 'school')],
        ['狛田', 10.2, 's', P(4, 'residential')], ['近鉄宮津', 11.5, 'p', P(2, 'residential')], ['三山木', 12.2, 's', P(8, 'school')],
        ['興戸', 13.5, 's', P(8, 'school')], ['新田辺', 15.0, 'p', P(22, 'mixed')], ['富野荘', 17.2, 's', P(5, 'residential')],
        ['寺田', 18.7, 's', P(10, 'residential')], ['久津川', 20.0, 's', P(6, 'residential')], ['大久保', 21.0, 'p', P(20, 'mixed')],
        ['伊勢田', 21.9, 's', P(5, 'residential')], ['小倉', 23.2, 's', P(10, 'residential')], ['向島', 26.0, 'p', P(10, 'residential')],
        ['桃山御陵前', 28.1, 's', P(15, 'mixed')], ['近鉄丹波橋', 28.6, 's', P(30, 'mixed')], ['伏見', 29.7, 's', P(4, 'residential')],
        ['竹田', 31.0, 'p', P(25, 'mixed')], ['上鳥羽口', 32.1, 'p', P(4, 'residential')], ['十条', 33.1, 's', P(5, 'residential')],
        ['東寺', 33.7, 's', P(6, 'tourist')], ['京都', 34.6, 't', P(90, 'urban', { stubs: 4 })],
      ],
    },
    {
      key: 'kashihara', name: '橿原線', color: '#f08a4b', op: 'kintetsu', vmax: 105,
      safety: ['ats_kintetsu'], maxCars: 6, heading: 100,
      attach: { line: 'nara', at: '大和西大寺', mode: 'branch', offset: 290 },
      stations: [
        ['大和西大寺', 0.0], ['尼ヶ辻', 1.6, 's', P(5, 'residential')], ['西ノ京', 2.8, 's', P(4, 'tourist')],
        ['九条（奈良）', 4.0, 's', P(3, 'residential')], ['近鉄郡山', 5.5, 's', P(14, 'mixed')], ['筒井', 8.4, 's', P(5, 'residential')],
        ['平端', 9.9, 'p', P(6, 'residential')], ['ファミリー公園前', 10.9, 's', P(2, 'residential')], ['結崎', 12.4, 's', P(4, 'residential')],
        ['石見', 13.8, 's', P(4, 'residential')], ['田原本', 15.9, 's', P(10, 'mixed')], ['笠縫', 17.3, 's', P(3, 'residential')],
        ['新ノ口', 19.1, 's', P(4, 'residential')], ['大和八木', 20.5, 's', P(40, 'mixed')], ['畝傍御陵前', 22.8, 's', P(4, 'residential')],
        ['橿原神宮前', 23.8, 't', P(15, 'tourist', { stubs: 3 })],
      ],
    },
  ],
  through: [
    { key: 'hn', from: 'nara', at: '大阪難波', name: '阪神なんば線・本線', line: 'hanshin', op: 'hanshin', pax: 55000 },
    { key: 'ky', from: 'nara', at: '大和西大寺', name: '京都線', line: 'kyoto', op: 'kintetsu', pax: 22000 },
  ],
  depots: [
    { line: 'nara', at: '東花園', name: '東花園検車区', side: 1, own: true, share: 0.55, cars: 10 },
    { line: 'nara', at: '大和西大寺', name: '西大寺検車区', side: 1, own: true, share: 0.45, cars: 10, offset: -700 },
    { line: 'hanshin', at: '尼崎', name: '尼崎車庫', side: -1, min: 5, offset: -700 },
    { line: 'kyoto', at: '新田辺', name: '新田辺車庫', side: 1, min: 5 },
  ],
  fleet: { prefix: 'VW', suffix: '', series: '9820系' },
  services: [
    {
      name: '快速急行（阪神線直通）', prefix: 'Q', type: 'rapidexp', cars: 8, speed: 105,
      ops: { kintetsu: 2, hanshin: 1 },
      route: [['hanshin', '神戸三宮', '大阪難波'], ['nara', '大阪難波', '近鉄奈良']],
      stops: {
        hanshin: ['神戸三宮', '御影', '魚崎', '芦屋', '西宮', '甲子園', '尼崎', '西九条', '九条', 'ドーム前', '桜川', '大阪難波'],
        nara: ['大阪難波', '近鉄日本橋', '大阪上本町', '鶴橋', '生駒', '学園前', '大和西大寺', '新大宮', '近鉄奈良'],
      },
      slots: [['06:00', '22:30', 20, 0]], revOffset: 5,
    },
    {
      name: '急行', prefix: 'E', type: 'express', cars: 8, speed: 105,
      route: [['nara', '大阪難波', '近鉄奈良']],
      stops: { nara: ['大阪難波', '近鉄日本橋', '大阪上本町', '鶴橋', '布施', '石切', '生駒', '学園前', '大和西大寺', '新大宮', '近鉄奈良'] },
      slots: [['05:40', '23:00', 20, 10]], revOffset: 13,
    },
    {
      name: '準急', prefix: 'S', type: 'semi', cars: 6, speed: 100,
      route: [['nara', '大阪難波', '大和西大寺']],
      stops: {
        nara: ['大阪難波', '近鉄日本橋', '大阪上本町', '鶴橋', '布施', '河内小阪', '東花園', '石切', '生駒', '東生駒',
          '富雄', '学園前', '菖蒲池', '大和西大寺'],
      },
      slots: [['05:30', '23:30', 20, 5]], revOffset: 9,
    },
    {
      name: '普通', prefix: 'L', type: 'local', cars: 6, speed: 95,
      route: [['nara', '大阪難波', '東生駒']],
      slots: [['05:20', '07:00', 20, 0], ['07:00', '09:00', 10, 0], ['09:00', '17:00', 20, 0], ['17:00', '20:00', 10, 0], ['20:00', '23:40', 20, 0]],
      revOffset: 3,
    },
    {
      name: '特急', prefix: 'T', type: 'ltd', cars: 4, speed: 105,
      route: [['nara', '大阪難波', '近鉄奈良']],
      stops: { nara: ['大阪難波', '近鉄日本橋', '大阪上本町', '鶴橋', '生駒', '学園前', '大和西大寺', '近鉄奈良'] },
      slots: [['07:00', '21:00', 60, 15]], revOffset: 30,
    },
    {
      name: '急行（京都線直通）', prefix: 'K', type: 'express', cars: 6, speed: 105,
      route: [['kyoto', '京都', '大和西大寺'], ['nara', '大和西大寺', '近鉄奈良']],
      stops: {
        kyoto: ['京都', '竹田', '近鉄丹波橋', '向島', '大久保', '新田辺', '新祝園', '高の原', '平城', '大和西大寺'],
      },
      slots: [['06:00', '22:00', 30, 0]], revOffset: 15,
    },
    {
      name: '急行（京都〜橿原神宮前）', prefix: 'X', type: 'express', cars: 6, speed: 105,
      route: [['kyoto', '京都', '大和西大寺'], ['kashihara', '大和西大寺', '橿原神宮前']],
      stops: {
        kyoto: ['京都', '竹田', '近鉄丹波橋', '向島', '大久保', '新田辺', '新祝園', '高の原', '大和西大寺'],
        kashihara: ['大和西大寺', '近鉄郡山', '平端', '田原本', '大和八木', '橿原神宮前'],
      },
      slots: [['06:10', '22:10', 30, 0]], revOffset: 15,
    },
  ],
};
