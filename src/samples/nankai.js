// サンプル9：南海電鉄（南海本線・空港線・高野線）
// 配線：配線略図.net（南海本線・高野線）、駅の番線数：Wikipedia 各駅記事（docs/sample-stations.md）　キロ程：Wikipedia 各線の駅一覧
// 難波〜岸里玉出は本線と高野線の線路別複々線（ここでは別々の路線として描く）。
// 高野線は橋本から先が単線の山岳区間（各駅で行き違い）。ラピート・空港急行は泉佐野から空港線へ。

import { P } from './util.js';

const S = (name, km, type = 's', riders = 5, kind = 'residential', extra = {}) => [name, km, type, P(riders, kind, extra)];

export default {
  id: 'nankai', no: 9,
  title: '南海電鉄（本線・空港線・高野線）',
  note: '難波から和歌山市・関西空港・極楽橋へ。ラピート・サザン・空港急行、単線の高野線山岳区間。',
  self: 'nankai',
  spacing: 440,
  settings: {
    defaultMaxSpeedKmh: 110, farePerKm: 20, fareBase: 170, dailyTripRate: 0.28,
    reversalMinutes: 3, targetCashOku: 700, startCashOku: 120, costPerCarKm: 200, maxHoldMinutes: 25, accelMs2: 0.9, decelMs2: 1.0,
  },
  operators: {
    nankai: { name: '南海電気鉄道', short: '南', color: '#f0821e' },
  },
  lines: [
    {
      key: 'honsen', name: '南海本線', color: '#f0821e', op: 'nankai', vmax: 110,
      safety: ['ats_sn'], maxCars: 10, heading: 100,
      turns: { '住ノ江': 118, '泉大津': 130, '泉佐野': 140, 'みさき公園': 115 },
      stations: [
        S('難波', 0.0, 't', 140, 'urban', { stubs: 8 }), S('新今宮', 1.4, 's', 40, 'mixed'), S('天下茶屋', 3.0, 's', 25, 'mixed'),
        S('岸里玉出', 3.9, 's', 5), S('粉浜', 5.1, 'p', 4), S('住吉大社', 5.7, 'p', 6, 'tourist'), S('住ノ江', 6.7, 'p', 8),
        S('七道', 8.2, 's', 10), S('堺', 9.8, 'p', 25, 'mixed'), S('湊', 11.2, 's', 6), S('石津川', 12.7, 's', 5),
        S('諏訪ノ森', 13.8, 's', 4), S('浜寺公園', 14.8, 'pu', 5), S('羽衣', 15.6, 's', 12), S('高石', 17.3, 'p', 6),
        S('北助松', 18.5, 's', 5), S('松ノ浜', 19.5, 's', 4), S('泉大津', 20.4, 'p', 12, 'mixed'), S('忠岡', 22.3, 's', 4),
        S('春木', 23.7, 'pu', 6), S('和泉大宮', 25.0, 's', 4), S('岸和田', 26.0, 'p', 18, 'mixed'), S('蛸地蔵', 26.9, 's', 3),
        S('貝塚', 28.6, 'p', 10), S('二色浜', 30.4, 's', 4), S('鶴原', 31.3, 's', 3), S('井原里', 32.4, 's', 3),
        S('泉佐野', 34.0, 'p', 15, 'mixed'), S('羽倉崎', 36.1, 'pu', 3), S('吉見ノ里', 37.4, 's', 2), S('岡田浦', 38.8, 's', 1),
        S('樽井', 40.6, 'pu', 3), S('尾崎', 43.1, 'p', 4), S('鳥取ノ荘', 44.6, 's', 2), S('箱作', 46.6, 's', 3),
        S('淡輪', 50.2, 's', 1), S('みさき公園', 51.9, 'p', 2, 'tourist'), S('孝子', 56.3, 's', 0.2),
        S('和歌山大学前', 58.0, 's', 5, 'school'), S('紀ノ川', 61.6, 's', 1), S('和歌山市', 64.2, 't', 15, 'urban', { stubs: 5 }),
      ],
    },
    {
      key: 'kuko', name: '空港線', color: '#2a6ebb', op: 'nankai', vmax: 120,
      safety: ['ats_sn'], maxCars: 8, heading: 175,
      attach: { line: 'honsen', at: '泉佐野', mode: 'branch', offset: 260 },
      stations: [
        S('泉佐野', 0.0), S('りんくうタウン', 1.9, 'p', 6, 'business'),
        S('関西空港', 8.8, 't', 35, 'airport', { stubs: 2 }),
      ],
    },
    {
      key: 'koya', name: '高野線', color: '#1a9e6f', op: 'nankai', vmax: 110,
      safety: ['ats_sn'], maxCars: 8, heading: 75,
      attach: { line: 'honsen', at: '難波', mode: 'branch', offset: 230, ownStation: true },
      turns: { '岸里玉出': 80, '中百舌鳥': 95, '河内長野': 115, '橋本': 90 },
      singles: [['橋本', '極楽橋']],
      stations: [
        S('難波', 0.0, 't', 60, 'urban', { stubs: 3 }), S('今宮戎', 0.9, 's', 5), S('新今宮', 1.4, 's', 15, 'mixed'),
        S('萩ノ茶屋', 2.0, 's', 3), S('天下茶屋', 3.0, 's', 10, 'mixed'), S('岸里玉出', 3.9, 's', 4),
        S('帝塚山', 5.0, 's', 5), S('住吉東', 5.9, 'p', 5), S('沢ノ町', 6.8, 's', 4), S('我孫子前', 7.4, 's', 5),
        S('浅香山', 8.7, 's', 6), S('堺東', 10.3, 'p', 45, 'mixed'), S('三国ヶ丘', 11.8, 's', 25), S('百舌鳥八幡', 12.7, 's', 4),
        S('中百舌鳥', 13.4, 'p', 25, 'mixed'), S('白鷺', 14.4, 'p', 8), S('初芝', 15.9, 's', 12), S('萩原天神', 16.8, 's', 8),
        S('北野田', 18.6, 'p', 18), S('狭山', 19.5, 's', 5), S('大阪狭山市', 21.1, 's', 8), S('金剛', 22.2, 'p', 22),
        S('滝谷', 23.9, 's', 6), S('千代田', 25.2, 's', 8), S('河内長野', 27.3, 'p', 20, 'mixed'), S('三日市町', 29.0, 's', 8),
        S('美加の台', 30.6, 's', 5), S('千早口', 32.5, 's', 1), S('天見', 34.2, 's', 1), S('紀見峠', 37.9, 's', 1),
        S('林間田園都市', 39.2, 'pd', 10), S('御幸辻', 41.2, 's', 3), S('橋本', 44.0, 'pd', 10, 'mixed'),
        S('紀伊清水', 47.1, 'pd', 0.5), S('学文路', 49.7, 'pd', 0.5), S('九度山', 51.5, 'pd', 1, 'tourist'),
        S('高野下', 53.5, 'pd', 0.5), S('下古沢', 55.2, 'pd', 0.2), S('上古沢', 56.9, 's', 0.2),
        S('紀伊細川', 59.9, 'pd', 0.1), S('紀伊神谷', 62.3, 'pd', 0.1), S('極楽橋', 63.8, 't', 4, 'tourist', { stubs: 4 }),
      ],
    },
  ],
  through: [
    { key: 'ap', from: 'honsen', at: '泉佐野', name: '空港線', line: 'kuko', op: 'nankai', pax: 25000 },
  ],
  depots: [
    { line: 'honsen', at: '住ノ江', name: '住ノ江検車区', side: 1, own: true, share: 0.5, cars: 10 },
    { line: 'honsen', at: '羽倉崎', name: '羽倉崎検車区', side: -1, own: true, share: 0.5, cars: 10 },
    { line: 'koya', at: '千代田', name: '千代田検車区', side: 1, own: true, reserved: true, min: 6, cars: 8 },
  ],
  fleet: { prefix: '', suffix: '編成', series: '50000系・12000系・8300系' },
  fleets: [
    { line: 'koya', prefix: 'K', suffix: '編成', series: '30000系・2000系・6000系', depot: '千代田検車区', start: 61 },
  ],
  services: [
    {
      name: '特急ラピート', prefix: 'R', type: 'ltd', cars: 6, speed: 120,
      route: [['honsen', '難波', '泉佐野'], ['kuko', '泉佐野', '関西空港']],
      stops: { honsen: ['難波', '新今宮', '天下茶屋', '堺', '岸和田', '泉佐野'], kuko: ['泉佐野', 'りんくうタウン', '関西空港'] },
      slots: [['06:00', '22:30', 30, 0]], revOffset: 5,
    },
    {
      name: '特急サザン', prefix: 'Z', type: 'ltd', cars: 8, speed: 110,
      route: [['honsen', '難波', '和歌山市']],
      stops: {
        honsen: ['難波', '新今宮', '天下茶屋', '堺', '羽衣', '泉大津', '岸和田', '泉佐野', '尾崎', 'みさき公園',
          '和歌山大学前', '和歌山市'],
      },
      slots: [['06:10', '22:40', 30, 0]], revOffset: 12,
    },
    {
      name: '空港急行', prefix: 'A', type: 'express', cars: 8, speed: 110,
      route: [['honsen', '難波', '泉佐野'], ['kuko', '泉佐野', '関西空港']],
      stops: { honsen: ['難波', '新今宮', '天下茶屋', '堺', '羽衣', '泉大津', '岸和田', '貝塚', '泉佐野'] },
      slots: [['05:40', '23:00', 30, 16]], revOffset: 18,
    },
    {
      name: '急行（みさき公園）', prefix: 'E', type: 'express', cars: 8, speed: 110,
      route: [['honsen', '難波', 'みさき公園']],
      stops: {
        honsen: ['難波', '新今宮', '天下茶屋', '堺', '羽衣', '泉大津', '岸和田', '貝塚', '泉佐野', '羽倉崎',
          '樽井', '尾崎', '箱作', 'みさき公園'],
      },
      slots: [['05:50', '23:00', 30, 23]], revOffset: 24,
    },
    {
      name: '普通', prefix: 'L', type: 'local', cars: 6, speed: 100,
      route: [['honsen', '難波', '羽倉崎']],
      slots: [['05:15', '23:40', 15, 5]],
      revOffset: 8,
    },
    {
      name: '普通（羽倉崎〜和歌山市）', prefix: 'W', type: 'local', cars: 4, speed: 100,
      route: [['honsen', '羽倉崎', '和歌山市']],
      slots: [['05:40', '23:00', 30, 10]], revOffset: 20,
    },
    {
      name: '特急こうや', prefix: 'KY', type: 'ltd', cars: 4, speed: 100,
      route: [['koya', '難波', '極楽橋']],
      stops: { koya: ['難波', '新今宮', '天下茶屋', '堺東', '金剛', '河内長野', '林間田園都市', '橋本', '九度山', '高野下', '極楽橋'] },
      slots: [['08:00', '16:00', 120, 0]], revOffset: 53,
    },
    {
      name: '急行（橋本）', prefix: 'KE', type: 'express', cars: 8, speed: 110,
      route: [['koya', '難波', '橋本']],
      stops: {
        koya: ['難波', '新今宮', '天下茶屋', '堺東', '中百舌鳥', '北野田', '金剛', '河内長野', '三日市町', '美加の台',
          '千早口', '天見', '紀見峠', '林間田園都市', '御幸辻', '橋本'],
      },
      slots: [['05:40', '23:00', 20, 7]], revOffset: 11,
    },
    {
      name: '各停（高野線）', prefix: 'KL', type: 'local', cars: 8, speed: 100,
      route: [['koya', '難波', '千代田']],
      slots: [['05:20', '07:00', 15, 2], ['07:00', '09:00', 12, 2], ['09:00', '17:00', 15, 2], ['17:00', '20:00', 12, 2], ['20:00', '23:40', 15, 2]],
      revOffset: 5,
    },
    {
      name: '各停（橋本〜極楽橋）', prefix: 'KM', type: 'local', cars: 2, speed: 70,
      route: [['koya', '橋本', '極楽橋']],
      slots: [['06:00', '21:00', 60, 25]], revOffset: 40,
    },
  ],
};
