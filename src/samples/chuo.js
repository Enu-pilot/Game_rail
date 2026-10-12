// サンプル14：中央本線（東京〜塩尻〜名古屋）と篠ノ井線・信越本線（塩尻〜長野）
// 配線：配線略図.net（中央本線 東京〜塩尻・塩尻〜名古屋、篠ノ井線、信越本線 篠ノ井〜長野）、キロ程：Wikipedia 中央本線・中央線快速・中央線 (名古屋地区)・篠ノ井線
// 東京〜茅野は複線（御茶ノ水〜三鷹は緩行線と並ぶ複々線、ここでは快速線）。普門寺信号場〜岡谷は単線、塩嶺トンネル経由で塩尻へ。
// 塩尻は島式3面6線。東線と篠ノ井線、西線と篠ノ井線がそれぞれ直通でき（あずさ・しなの）、東線と西線の行き来は向きを変える。
// 配線略図では塩尻駅は縦向きに描かれているので、そこだけ横向きに描き直している。
// 塩尻〜中津川（木曽谷）は複線と単線がまじる。ここでは1本の本線と、複線区間のもう1本の線で表す。

import diagram from './data/chuo.js';
import { P } from './util.js';

const K = (name, km, riders = 1, kind = 'residential', type = 's', extra = {}) => [name, km, type, P(riders, kind, extra)];

export default {
  diagram,
  id: 'chuo', no: 14,
  title: '中央本線（東京〜松本・長野、名古屋〜塩尻）',
  note: '中央線快速と中央特快、特急あずさ・かいじ・しなの、単線の岡谷付近、塩尻での東線・西線・篠ノ井線の分かれ、名古屋近郊の快速。',
  self: 'jre',
  spacing: 460,
  settings: {
    defaultMaxSpeedKmh: 120, farePerKm: 17, fareBase: 150, dailyTripRate: 0.1,
    reversalMinutes: 4, targetCashOku: 1500, startCashOku: 250,
  },
  operators: {
    jre: { name: 'JR東日本', short: '東', color: '#008000' },
    jrc: { name: 'JR東海', short: '海', color: '#f08300' },
  },
  lines: [
    {
      key: 'east', name: '中央本線（東京〜茅野）', trackName: '中央本線', color: '#f15a22', op: 'jre', vmax: 130,
      safety: ['ats_p'], maxCars: 12, heading: 190,
      turns: { '新宿': 175, '八王子': 165, '大月': 185, '甲府': 225 },
      stations: [
        K('東京', 0.0, 100, 'business', 't', { stubs: 2 }), K('神田', 1.3, 15, 'business'), K('御茶ノ水', 2.6, 20, 'school'),
        K('四ツ谷', 6.6, 18, 'business'), K('新宿', 10.3, 150, 'urban'), K('中野', 14.7, 15, 'mixed'),
        K('高円寺', 16.1, 5), K('阿佐ケ谷', 17.3, 5), K('荻窪', 18.7, 9, 'mixed'), K('西荻窪', 20.6, 4),
        K('吉祥寺', 22.5, 14, 'mixed'), K('三鷹', 24.1, 9, 'mixed'), K('武蔵境', 25.7, 6), K('東小金井', 27.4, 3),
        K('武蔵小金井', 29.1, 6), K('国分寺', 31.4, 11, 'mixed'), K('西国分寺', 32.8, 3), K('国立', 34.5, 5),
        K('立川', 37.5, 16, 'urban'), K('日野', 40.8, 3), K('豊田', 43.1, 3), K('八王子', 47.4, 8, 'mixed'),
        K('西八王子', 49.8, 3), K('高尾', 53.1, 3, 'tourist'), K('相模湖', 62.6, 0.2, 'tourist'), K('藤野', 66.3, 0.2),
        K('上野原', 69.8, 0.4), K('四方津', 74.0, 0.2), K('梁川', 77.6, 0.05), K('鳥沢', 81.2, 0.1), K('猿橋', 85.3, 0.2),
        K('大月', 87.8, 0.6, 'mixed'), K('初狩', 93.9, 0.05), K('笹子', 100.4, 0.05), K('甲斐大和', 106.5, 0.05),
        K('勝沼ぶどう郷', 112.5, 0.1, 'tourist'), K('塩山', 116.9, 0.3), K('東山梨', 120.1, 0.05), K('山梨市', 122.2, 0.2),
        K('春日居町', 125.0, 0.05), K('石和温泉', 127.8, 0.3, 'tourist'), K('酒折', 131.2, 0.2, 'school'),
        K('甲府', 134.1, 1.5, 'mixed'), K('竜王', 138.6, 0.3), K('塩崎', 142.7, 0.05), K('韮崎', 147.0, 0.2),
        K('新府', 151.2, 0.02), K('穴山', 154.7, 0.03), K('日野春', 160.1, 0.03), K('長坂', 166.3, 0.08),
        K('小淵沢', 173.7, 0.1, 'tourist'), K('信濃境', 178.2, 0.03), K('富士見', 182.9, 0.1), K('すずらんの里', 186.1, 0.03),
        K('青柳', 188.0, 0.05), K('茅野', 195.2, 0.4, 'tourist'),
      ],
    },
    {
      key: 'suwa', name: '中央本線（茅野〜塩尻）', trackName: '中央本線', color: '#d9480f', op: 'jre', vmax: 120, double: false,
      safety: ['ats_p'], maxCars: 12, heading: 230, endEnd: 'boundary',
      attach: { line: 'east', at: '茅野', mode: 'end' },
      turns: { '上諏訪': 205, '岡谷': 210 },
      stations: [
        K('茅野', 0.0), K('上諏訪', 6.7, 0.6, 'tourist'), K('下諏訪', 11.1, 0.3, 'tourist'), K('岡谷', 15.2, 0.4, 'mixed'),
        K('みどり湖', 23.0, 0.03), K('塩尻', 26.9, 0.3, 'mixed'),
      ],
    },
    {
      key: 'shinonoi', name: '篠ノ井線・信越本線（塩尻〜長野）', color: '#2e8b57', op: 'jre', vmax: 120, double: false,
      safety: ['ats_p'], maxCars: 12, heading: 275, endEnd: 'boundary',
      attach: { line: 'suwa', at: '塩尻', mode: 'end' },
      turns: { '松本': 295, '篠ノ井': 310 },
      stations: [
        K('塩尻', 0.0), K('広丘', 3.8, 0.3), K('村井', 6.8, 0.3), K('平田', 8.8, 0.2), K('南松本', 10.9, 0.2),
        K('松本', 13.3, 1.7, 'mixed'), K('田沢', 21.6, 0.05), K('明科', 28.2, 0.1), K('西条', 37.2, 0.03),
        K('坂北', 40.9, 0.03), K('聖高原', 45.0, 0.03), K('冠着', 48.3, 0.01), K('姨捨', 54.2, 0.02, 'tourist'),
        K('稲荷山', 62.9, 0.05), K('篠ノ井', 66.7, 0.6, 'mixed'), K('今井', 68.8, 0.3), K('川中島', 71.0, 0.3),
        K('安茂里', 73.1, 0.3), K('長野', 76.0, 2, 'urban'),
      ],
    },
    {
      key: 'kiso', name: '中央本線（塩尻〜中津川）', trackName: '中央本線', color: '#e67700', op: 'jrc', vmax: 120, double: false,
      safety: ['ats_p'], maxCars: 10, heading: 120,
      attach: { line: 'suwa', at: '塩尻', mode: 'branch', exit: '洗馬' },
      stations: [
        K('塩尻', 0.0), K('洗馬', 4.2, 0.05), K('日出塩', 8.9, 0.01), K('贄川', 14.1, 0.02), K('木曽平沢', 19.3, 0.03),
        K('奈良井', 21.1, 0.05, 'tourist'), K('藪原', 27.7, 0.03), K('宮ノ越', 33.4, 0.02), K('原野', 36.2, 0.01),
        K('木曽福島', 41.7, 0.2, 'tourist'), K('上松', 49.0, 0.05), K('倉本', 55.6, 0.01), K('須原', 60.4, 0.02),
        K('大桑', 63.7, 0.02), K('野尻', 66.7, 0.02), K('十二兼', 70.4, 0.01), K('南木曽', 75.9, 0.05, 'tourist'),
        K('田立', 82.2, 0.01), K('坂下', 85.0, 0.05), K('落合川', 91.1, 0.03), K('中津川', 94.9, 0.5, 'mixed'),
      ],
    },
    {
      key: 'nagoya', name: '中央本線（中津川〜名古屋）', trackName: '中央本線', color: '#ff8c00', op: 'jrc', vmax: 120,
      safety: ['ats_p'], maxCars: 10, heading: 155, endEnd: 'buffer',
      attach: { line: 'kiso', at: '中津川', mode: 'end' },
      turns: { '高蔵寺': 160 },
      stations: [
        K('中津川', 0.0), K('美乃坂本', 6.4, 0.1), K('恵那', 11.6, 0.4, 'mixed'), K('武並', 17.0, 0.05),
        K('釜戸', 22.4, 0.05), K('瑞浪', 29.8, 0.4), K('土岐市', 36.7, 0.4), K('多治見', 43.7, 1.2, 'mixed'),
        K('古虎渓', 48.3, 0.05), K('定光寺', 51.8, 0.01, 'tourist'), K('高蔵寺', 55.9, 1.4, 'mixed'), K('神領', 59.1, 0.5),
        K('春日井', 61.8, 1.2), K('勝川', 64.9, 1.3), K('新守山', 67.6, 0.4), K('大曽根', 70.1, 2.5, 'mixed'),
        K('千種', 72.8, 3, 'business'), K('鶴舞', 74.3, 2, 'school'), K('金山', 76.6, 7, 'urban'), K('名古屋', 79.9, 20, 'urban'),
      ],
    },
  ],
  through: [
    { key: 'sw', from: 'east', at: '茅野', name: '中央本線（茅野〜塩尻）', line: 'suwa', op: 'jre', pax: 6000 },
    { key: 'sn', from: 'east', at: '茅野', name: '篠ノ井線・信越本線', line: 'shinonoi', op: 'jre', via: ['sw'], pax: 6000 },
    { key: 'ks', from: 'east', at: '茅野', name: '中央本線（塩尻〜中津川）', line: 'kiso', op: 'jrc', via: ['sw'], pax: 1000 },
    { key: 'ng', from: 'east', at: '茅野', name: '中央本線（中津川〜名古屋）', line: 'nagoya', op: 'jrc', via: ['sw', 'ks'], pax: 2000 },
  ],
  depots: [
    { line: 'east', at: '豊田', name: '豊田車両センター', side: 1, own: true, share: 0.6, cars: 10 },
    { line: 'east', at: '武蔵小金井', name: '豊田車両センター武蔵小金井派出', side: 1, own: true, share: 0.2, cars: 10 },
    { line: 'east', at: '三鷹', name: '三鷹車両センター', side: 1, own: true, share: 0.2, cars: 10 },
    { line: 'shinonoi', at: '松本', name: '松本車両センター', side: 1, own: true, min: 8, cars: 12 },
    { line: 'shinonoi', at: '長野', name: '長野総合車両センター', side: 1, own: true, min: 4, cars: 6 },
    { line: 'nagoya', at: '神領', name: '神領車両区', side: 1, own: true, min: 10, cars: 8 },
  ],
  fleet: { prefix: 'T', suffix: '編成', series: 'E233系0番台（中央線快速）' },
  fleets: [
    { line: 'shinonoi', prefix: 'S', suffix: '編成', series: 'E353系・211系（松本車両センター）', depot: '松本車両センター', start: 101 },
    { line: 'nagoya', prefix: 'B', suffix: '編成', series: '313系・315系・383系（神領車両区）', depot: '神領車両区', start: 1 },
  ],
  services: [
    {
      name: '特急あずさ', prefix: 'AZ', type: 'ltd', cars: 12, speed: 130, dwell: 60,
      route: [['east', '新宿', '茅野'], ['suwa', '茅野', '塩尻'], ['shinonoi', '塩尻', '松本']],
      stops: {
        east: ['新宿', '立川', '八王子', '大月', '甲府', '小淵沢', '茅野'],
        suwa: ['茅野', '上諏訪', '下諏訪', '岡谷', '塩尻'],
        shinonoi: ['塩尻', '松本'],
      },
      slots: [['07:00', '21:00', 60, 0]], revOffset: 30,
    },
    {
      name: '特急かいじ', prefix: 'KJ', type: 'ltd', cars: 9, speed: 130, dwell: 60,
      route: [['east', '新宿', '甲府']],
      stops: { east: ['新宿', '三鷹', '立川', '八王子', '大月', '塩山', '山梨市', '石和温泉', '甲府'] },
      slots: [['07:30', '21:30', 60, 0]], revOffset: 0,
    },
    {
      name: '中央特快', prefix: 'TK', type: 'express', cars: 10, speed: 120,
      route: [['east', '東京', '高尾']],
      stops: { east: ['東京', '神田', '御茶ノ水', '四ツ谷', '新宿', '中野', '三鷹', '国分寺', '立川', '日野', '豊田', '八王子', '西八王子', '高尾'] },
      slots: [['06:00', '23:00', 20, 8]], revOffset: 18,
    },
    {
      name: '快速（東京〜高尾）', prefix: 'R', type: 'local', cars: 10, speed: 100,
      route: [['east', '東京', '高尾']],
      slots: [['05:00', '24:00', 10, 0]],
      revOffset: 0,
    },
    {
      name: '普通（高尾〜大月）', prefix: 'O', type: 'local', cars: 6, speed: 100,
      route: [['east', '高尾', '大月']],
      slots: [['05:30', '23:00', 30, 15]], revOffset: 15,
    },
    {
      name: '普通（大月〜甲府〜小淵沢）', prefix: 'K', type: 'local', cars: 3, speed: 110,
      route: [['east', '大月', '小淵沢']],
      slots: [['05:30', '22:00', 60, 20]], revOffset: 25,
    },
    {
      name: '普通（小淵沢〜上諏訪〜松本）', prefix: 'M', type: 'local', cars: 3, speed: 110,
      route: [['east', '小淵沢', '茅野'], ['suwa', '茅野', '塩尻'], ['shinonoi', '塩尻', '松本']],
      slots: [['05:30', '22:00', 60, 40]], revOffset: 35,
    },
    {
      name: '普通（松本〜長野）', prefix: 'N', type: 'local', cars: 3, speed: 110,
      route: [['shinonoi', '松本', '長野']],
      slots: [['05:30', '23:00', 60, 10]], revOffset: 20,
    },
    {
      name: '特急しなの', prefix: 'SN', type: 'ltd', cars: 6, speed: 120, dwell: 60, op: 'jrc',
      route: [['nagoya', '名古屋', '中津川'], ['kiso', '中津川', '塩尻'], ['shinonoi', '塩尻', '長野']],
      stops: {
        nagoya: ['名古屋', '千種', '多治見', '中津川'],
        kiso: ['中津川', '南木曽', '木曽福島', '塩尻'],
        shinonoi: ['塩尻', '松本', '篠ノ井', '長野'],
      },
      slots: [['07:00', '20:00', 60, 0]], revOffset: 0,
    },
    {
      name: '快速（名古屋〜中津川）', prefix: 'C', type: 'express', cars: 8, speed: 120, op: 'jrc',
      route: [['nagoya', '名古屋', '中津川']],
      stops: { nagoya: ['名古屋', '金山', '鶴舞', '千種', '大曽根', '勝川', '春日井', '神領', '高蔵寺', '多治見', '土岐市', '瑞浪', '釜戸', '武並', '恵那', '美乃坂本', '中津川'] },
      slots: [['06:00', '23:00', 30, 0]], revOffset: 10,
    },
    {
      name: '普通（名古屋〜高蔵寺・多治見）', prefix: 'L', type: 'local', cars: 6, speed: 110, op: 'jrc',
      route: [['nagoya', '名古屋', '多治見']],
      slots: [['05:30', '24:00', 15, 5]], revOffset: 5,
    },
    {
      name: '普通（中津川〜松本）', prefix: 'KS', type: 'local', cars: 2, speed: 110, op: 'jrc',
      route: [['kiso', '中津川', '塩尻'], ['shinonoi', '塩尻', '松本']],
      slots: [['05:30', '21:00', 120, 30]], revOffset: 60,
    },
  ],
};
