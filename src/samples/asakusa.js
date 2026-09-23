// サンプル10：京成線〜都営浅草線〜京急線（羽田空港〜成田空港）
// 配線：配線略図.net（都営浅草線・京成押上線・京成本線・京急本線・空港線）、駅の番線数：Wikipedia 各駅記事（docs/sample-stations.md）　キロ程：Wikipedia 各線の駅一覧
// 都営浅草線を中心に、押上で京成、泉岳寺で京急とつながる4社直通。浅草線は8両まで、京急本線は12両が走る。
// エアポート快特は羽田空港から京急・浅草線・京成・成田スカイアクセス線を通って成田空港まで。
// 京成の上野方（京成上野〜青砥）とスカイアクセス線（京成高砂〜成田空港）は分岐線として描く。

import { P } from './util.js';

const S = (name, km, type = 's', riders = 5, kind = 'residential', extra = {}) => [name, km, type, P(riders, kind, extra)];

export default {
  id: 'asakusa', no: 10,
  title: '京成線〜都営浅草線〜京急線',
  note: '羽田空港から成田空港まで、京急・都営浅草線・京成（スカイアクセス線）の相互直通。12両の京急は浅草線に入れない。',
  self: 'toei',
  spacing: 420,
  settings: {
    defaultMaxSpeedKmh: 110, farePerKm: 20, fareBase: 180, dailyTripRate: 0.25,
    reversalMinutes: 3, targetCashOku: 600, startCashOku: 100, costPerCarKm: 200,
    accelMs2: 0.9, decelMs2: 1.0, maxHoldMinutes: 25,
  },
  operators: {
    toei:   { name: '東京都交通局', short: '都', color: '#e85298' },
    keikyu: { name: '京浜急行電鉄', short: '急', color: '#e5171f' },
    keisei: { name: '京成電鉄',     short: '成', color: '#0068b7' },
  },
  lines: [
    {
      key: 'asakusa', name: '都営浅草線', color: '#e85298', op: 'toei', vmax: 70,
      safety: ['c_ats'], maxCars: 8, heading: 0,
      turns: { '泉岳寺': 305, '日本橋': 285, '浅草': 350 },
      stations: [
        S('西馬込', 0.0, 't', 15, 'residential', { stubs: 2 }), S('馬込', 1.2, 's', 15), S('中延', 2.1, 's', 15),
        S('戸越', 3.2, 's', 15), S('五反田', 4.8, 's', 40, 'business'), S('高輪台', 5.5, 's', 10),
        S('泉岳寺', 6.9, 'p', 30, 'business'), S('三田', 8.0, 's', 60, 'business'), S('大門', 9.5, 's', 70, 'business'),
        S('新橋', 10.5, 's', 90, 'business'), S('東銀座', 11.4, 's', 50, 'business'), S('宝町', 12.2, 's', 25, 'business'),
        S('日本橋', 13.0, 's', 60, 'business'), S('人形町', 13.8, 's', 30, 'business'), S('東日本橋', 14.5, 's', 25, 'mixed'),
        S('浅草橋', 15.2, 's', 30, 'mixed'), S('蔵前', 15.9, 's', 20, 'mixed'), S('浅草', 16.8, 's', 50, 'tourist'),
        S('本所吾妻橋', 17.5, 's', 10), S('押上', 18.3, 'p', 60, 'tourist'),
      ],
    },
    {
      key: 'keikyu', name: '京急本線・久里浜線', color: '#e5171f', op: 'keikyu', vmax: 120,
      safety: ['c_ats'], maxCars: 12, heading: 140,
      attach: { line: 'asakusa', at: '泉岳寺', mode: 'branch', offset: -250 },
      turns: { '品川': 110, '京急川崎': 125, '横浜': 105, '金沢八景': 95 },
      stations: [
        S('泉岳寺', 0.0), S('品川', 1.2, 'pd', 120, 'business'), S('北品川', 1.9, 's', 5), S('新馬場', 2.6, 's', 12),
        S('青物横丁', 3.4, 's', 20), S('鮫洲', 3.9, 'p', 5), S('立会川', 4.7, 's', 10), S('大森海岸', 6.0, 's', 8),
        S('平和島', 6.9, 'p', 25), S('大森町', 7.7, 's', 10), S('梅屋敷', 8.4, 's', 8), S('京急蒲田', 9.2, 'p', 30, 'mixed'),
        S('雑色', 10.6, 's', 15), S('六郷土手', 11.8, 's', 8), S('京急川崎', 13.0, 'p', 60, 'urban'), S('八丁畷', 14.3, 's', 5),
        S('鶴見市場', 15.0, 's', 8), S('京急鶴見', 16.5, 'pu', 15), S('花月総持寺', 17.3, 's', 8), S('生麦', 18.1, 'pd', 10),
        S('京急新子安', 19.5, 's', 5), S('子安', 20.5, 'p', 4), S('神奈川新町', 21.2, 'p', 12), S('京急東神奈川', 21.7, 's', 8),
        S('神奈川', 22.7, 's', 3), S('横浜', 23.4, 's', 150, 'urban'), S('戸部', 24.6, 's', 8), S('日ノ出町', 26.0, 's', 12),
        S('黄金町', 26.8, 's', 10), S('南太田', 27.7, 'p', 8), S('井土ヶ谷', 28.9, 's', 10), S('弘明寺', 30.3, 's', 12),
        S('上大岡', 32.0, 'p', 50, 'mixed'), S('屏風浦', 34.2, 's', 8), S('杉田', 35.5, 's', 12), S('京急富岡', 37.9, 'pu', 10),
        S('能見台', 38.6, 's', 10), S('金沢文庫', 40.7, 'p', 25), S('金沢八景', 42.1, 'p', 25), S('追浜', 44.0, 's', 15),
        S('京急田浦', 45.7, 's', 5), S('安針塚', 48.3, 's', 3), S('逸見', 49.3, 'p', 4), S('汐入', 50.4, 's', 12),
        S('横須賀中央', 51.1, 's', 30, 'mixed'), S('県立大学', 52.3, 's', 8, 'school'), S('堀ノ内', 53.5, 'p', 6),
        S('新大津', 54.3, 's', 5), S('北久里浜', 55.2, 's', 10), S('京急久里浜', 58.0, 'p', 18), S('YRP野比', 60.7, 's', 8),
        S('京急長沢', 62.0, 's', 4), S('津久井浜', 63.2, 's', 3), S('三浦海岸', 64.7, 's', 6, 'tourist'),
        S('三崎口', 66.9, 't', 8, 'tourist', { stubs: 2 }),
      ],
    },
    {
      key: 'haneda', name: '京急空港線', color: '#e5171f', op: 'keikyu', vmax: 110,
      safety: ['c_ats'], maxCars: 8, heading: 60,
      attach: { line: 'keikyu', at: '京急蒲田', mode: 'branch', offset: 250 },
      turns: { '糀谷': 10 },
      stations: [
        S('京急蒲田', 0.0), S('糀谷', 0.9, 's', 10), S('大鳥居', 1.9, 's', 12), S('穴守稲荷', 2.6, 's', 5),
        S('天空橋', 3.3, 's', 5), S('羽田空港第3ターミナル', 4.5, 's', 10, 'airport'),
        S('羽田空港第1・第2ターミナル', 6.5, 't', 50, 'airport', { stubs: 2 }),
      ],
    },
    {
      key: 'keisei', name: '京成押上線・本線', color: '#0068b7', op: 'keisei', vmax: 110,
      safety: ['c_ats'], maxCars: 8, heading: 0,
      attach: { line: 'asakusa', at: '押上', mode: 'end' },
      turns: { '京成高砂': 25, '京成津田沼': 5, '京成佐倉': 15 },
      stations: [
        S('押上', 0.0), S('京成曳舟', 1.1, 's', 10), S('八広', 2.3, 'p', 5), S('四ツ木', 3.1, 's', 8),
        S('京成立石', 4.6, 's', 15), S('青砥', 5.7, 'p', 30, 'mixed'), S('京成高砂', 6.9, 'p', 25, 'mixed'),
        S('京成小岩', 8.7, 'p', 12), S('江戸川', 9.9, 's', 5), S('国府台', 10.6, 's', 6, 'school'), S('市川真間', 11.5, 'p', 8),
        S('菅野', 12.4, 's', 4), S('京成八幡', 13.3, 's', 20), S('鬼越', 14.3, 's', 5), S('京成中山', 15.0, 's', 4),
        S('東中山', 15.8, 'p', 6), S('京成西船', 16.4, 's', 8), S('海神', 17.8, 's', 4), S('京成船橋', 19.3, 's', 45, 'mixed'),
        S('大神宮下', 20.6, 's', 5), S('船橋競馬場', 21.4, 'p', 12), S('谷津', 22.4, 's', 8), S('京成津田沼', 23.9, 'p', 20, 'mixed'),
        S('京成大久保', 26.3, 's', 15, 'school'), S('実籾', 28.2, 's', 10), S('八千代台', 30.8, 'p', 25), S('京成大和田', 32.9, 's', 8),
        S('勝田台', 34.5, 's', 25), S('志津', 36.3, 's', 12), S('ユーカリが丘', 37.4, 'pu', 15), S('京成臼井', 39.9, 's', 10),
        S('京成佐倉', 45.2, 'p', 10, 'mixed'), S('大佐倉', 47.2, 's', 1), S('京成酒々井', 49.2, 's', 3), S('宗吾参道', 51.2, 'pu', 3),
        S('公津の杜', 52.8, 's', 6), S('京成成田', 55.4, 'pu', 15, 'tourist'), S('空港第2ビル', 62.5, 's', 15, 'airport'),
        S('成田空港', 63.5, 't', 25, 'airport', { stubs: 3 }),
      ],
    },
    {
      key: 'ueno', name: '京成本線（上野方）', color: '#0068b7', op: 'keisei', vmax: 110,
      safety: ['c_ats'], maxCars: 8, heading: 225,
      attach: { line: 'keisei', at: '青砥', mode: 'branch', offset: -250 },
      turns: { 'お花茶屋': 250, '京成関屋': 200 },
      stations: [
        S('青砥', 0.0), S('お花茶屋', 1.6, 's', 8), S('堀切菖蒲園', 2.7, 's', 8), S('京成関屋', 4.2, 's', 10),
        S('千住大橋', 5.6, 'p', 5), S('町屋', 7.2, 's', 12), S('新三河島', 8.1, 's', 3), S('日暮里', 9.4, 's', 50, 'mixed'),
        S('京成上野', 11.5, 't', 30, 'tourist', { stubs: 4 }),
      ],
    },
    {
      key: 'access', name: '成田スカイアクセス線', color: '#ff8c00', op: 'keisei', vmax: 160,
      safety: ['c_ats'], maxCars: 8, heading: 345,
      attach: { line: 'keisei', at: '京成高砂', mode: 'branch', offset: 250 },
      turns: { '東松戸': 355, '千葉ニュータウン中央': 10 },
      singles: [['成田湯川', '成田空港（アクセス線）']],
      stations: [
        S('京成高砂', 0.0), S('東松戸', 7.5, 'p', 8), S('新鎌ヶ谷', 12.7, 'p', 15), S('千葉ニュータウン中央', 23.8, 's', 10),
        S('印旛日本医大', 32.3, 's', 3), S('成田湯川', 40.7, 'p', 1), S('空港第2ビル（アクセス線）', 50.4, 'pd', 10, 'airport'),
        S('成田空港（アクセス線）', 51.4, 't', 15, 'airport', { stubs: 3 }),
      ],
    },
  ],
  through: [
    { key: 'kk', from: 'asakusa', at: '泉岳寺', name: '京急本線・久里浜線', line: 'keikyu', op: 'keikyu', pax: 60000 },
    { key: 'hn', from: 'asakusa', at: '泉岳寺', name: '京急空港線', line: 'haneda', op: 'keikyu', via: ['kk'], pax: 25000 },
    { key: 'ks', from: 'asakusa', at: '押上', name: '京成押上線・本線', line: 'keisei', op: 'keisei', pax: 70000 },
    { key: 'ac', from: 'asakusa', at: '押上', name: '成田スカイアクセス線', line: 'access', op: 'keisei', via: ['ks'], pax: 15000 },
  ],
  depots: [
    { line: 'asakusa', at: '西馬込', name: '馬込車両検修場', side: 1, own: true, cars: 8, offset: 260 },
    { line: 'keikyu', at: '金沢文庫', name: '金沢検車区', side: -1, min: 6, cars: 12 },
    { line: 'keisei', at: '宗吾参道', name: '宗吾車両基地', side: 1, min: 6, cars: 8 },
    { line: 'keisei', at: '京成高砂', name: '高砂検車区', side: -1, min: 4, cars: 8, offset: -600 },
  ],
  fleet: { prefix: '', suffix: '編成', series: '5500形' },
  services: [
    {
      name: 'エアポート快特（羽田空港〜成田空港）', prefix: 'AK', type: 'ltd', cars: 8, speed: 120,
      types: { keisei: 'ltd', access: 'ltd' },
      ops: { keikyu: 1, toei: 1, keisei: 1 },
      route: [['haneda', '羽田空港第1・第2ターミナル', '京急蒲田'], ['keikyu', '京急蒲田', '泉岳寺'], ['asakusa', '泉岳寺', '押上'],
        ['keisei', '押上', '京成高砂'], ['access', '京成高砂', '成田空港（アクセス線）']],
      stops: {
        haneda: ['羽田空港第1・第2ターミナル', '羽田空港第3ターミナル', '京急蒲田'],
        keikyu: ['京急蒲田', '品川', '泉岳寺'],
        asakusa: ['泉岳寺', '三田', '大門', '新橋', '東銀座', '日本橋', '浅草', '押上'],
        keisei: ['押上', '青砥', '京成高砂'],
        access: ['京成高砂', '東松戸', '新鎌ヶ谷', '千葉ニュータウン中央', '印旛日本医大', '成田湯川', '空港第2ビル（アクセス線）', '成田空港（アクセス線）'],
      },
      slots: [['06:30', '21:30', 40, 0]], revOffset: 20,
    },
    {
      // 京急線内は快特、浅草線内は各駅、京成線内は快速
      name: '快特・快速（三崎口〜京成佐倉）', prefix: 'K', type: 'ltd', cars: 8, speed: 120,
      types: { asakusa: 'local', keisei: 'rapid' },
      ops: { keikyu: 2, toei: 1, keisei: 1 },
      route: [['keikyu', '三崎口', '泉岳寺'], ['asakusa', '泉岳寺', '押上'], ['keisei', '押上', '京成佐倉']],
      stops: {
        keikyu: ['三崎口', '三浦海岸', '京急久里浜', '堀ノ内', '横須賀中央', '金沢八景', '金沢文庫', '上大岡', '横浜', '京急川崎', '品川', '泉岳寺'],
        keisei: ['押上', '京成曳舟', '青砥', '京成高砂', '京成小岩', '市川真間', '京成八幡', '東中山', '京成船橋', '京成津田沼',
          '八千代台', '勝田台', 'ユーカリが丘', '京成臼井', '京成佐倉'],
      },
      slots: [['06:00', '22:00', 20, 10]], revOffset: 5,
    },
    {
      name: '浅草線 各停', prefix: 'T', type: 'local', cars: 8, speed: 70,
      ops: { toei: 3, keisei: 1 },
      route: [['asakusa', '西馬込', '押上'], ['keisei', '押上', '青砥']],
      slots: [['05:20', '07:00', 10, 3], ['07:00', '09:30', 6, 3], ['09:30', '17:00', 10, 3], ['17:00', '20:00', 8, 3], ['20:00', '23:40', 10, 3]],
      revOffset: 4,
    },
    {
      name: '京急 普通', prefix: 'L', type: 'local', cars: 6, speed: 100, op: 'keikyu',
      route: [['keikyu', '品川', '金沢文庫']],
      slots: [['05:20', '23:30', 20, 8]], revOffset: 6,
    },
    {
      name: 'エアポート急行（羽田空港〜金沢文庫）', prefix: 'AE', type: 'express', cars: 8, speed: 110, op: 'keikyu',
      route: [['haneda', '羽田空港第1・第2ターミナル', '京急蒲田'], ['keikyu', '京急蒲田', '金沢文庫']],
      stops: {
        keikyu: ['京急蒲田', '京急川崎', '京急鶴見', '神奈川新町', '横浜', '日ノ出町', '上大岡', '京急富岡', '金沢文庫'],
      },
      slots: [['06:00', '22:00', 20, 7]], revOffset: 7,
    },
    {
      name: '京急 快特（泉岳寺〜品川〜三崎口 12両）', prefix: 'KT', type: 'ltd', cars: 12, speed: 120, op: 'keikyu',
      route: [['keikyu', '品川', '三崎口']],
      stops: { keikyu: ['品川', '京急川崎', '横浜', '上大岡', '金沢文庫', '金沢八景', '堀ノ内', '京急久里浜', '三浦海岸', '三崎口'] },
      slots: [['07:00', '20:00', 20, 0]], revOffset: 15,
    },
    {
      name: 'スカイライナー', prefix: 'SL', type: 'ltd', cars: 8, speed: 160, op: 'keisei',
      route: [['ueno', '京成上野', '青砥'], ['keisei', '青砥', '京成高砂'], ['access', '京成高砂', '成田空港（アクセス線）']],
      stops: {
        ueno: ['京成上野', '日暮里', '青砥'], keisei: ['青砥', '京成高砂'],
        access: ['京成高砂', '空港第2ビル（アクセス線）', '成田空港（アクセス線）'],
      },
      slots: [['06:40', '22:00', 30, 7]], revOffset: 10,
    },
    {
      name: '京成 特急（京成上野〜成田空港）', prefix: 'KS', type: 'express', cars: 8, speed: 110, op: 'keisei',
      route: [['ueno', '京成上野', '青砥'], ['keisei', '青砥', '成田空港']],
      stops: {
        ueno: ['京成上野', '日暮里', '青砥'],
        keisei: ['青砥', '京成高砂', '京成八幡', '京成船橋', '京成津田沼', '八千代台', '勝田台', 'ユーカリが丘', '京成佐倉',
          '京成酒々井', '宗吾参道', '公津の杜', '京成成田', '空港第2ビル', '成田空港'],
      },
      slots: [['06:00', '22:00', 20, 5]], revOffset: 15,
    },
    {
      name: '京成 普通（京成上野〜京成津田沼）', prefix: 'KL', type: 'local', cars: 6, speed: 100, op: 'keisei',
      route: [['ueno', '京成上野', '青砥'], ['keisei', '青砥', '京成津田沼']],
      slots: [['05:30', '23:30', 20, 12]], revOffset: 8,
    },
  ],
};
