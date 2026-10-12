// サンプル13：鹿児島本線（門司港〜八代・川内〜鹿児島）と肥薩おれんじ鉄道（八代〜川内）
// 配線：配線略図.net（鹿児島本線 門司港〜八代・川内〜鹿児島、肥薩おれんじ鉄道）、キロ程：Wikipedia 鹿児島本線・肥薩おれんじ鉄道線
// 九州新幹線の開業で八代〜川内は肥薩おれんじ鉄道に移った。北九州・福岡・熊本の都市圏輸送と、おれんじ鉄道の単線区間。
// 北九州貨物ターミナル・鳥栖貨物ターミナル・東小倉は貨物駅（旅客列車は通過）。

import diagram from './data/kagoshima.js';
import { P } from './util.js';

const K = (name, km, riders = 1, kind = 'residential', type = 's', extra = {}) => [name, km, type, P(riders, kind, extra)];

export default {
  diagram,
  id: 'kagoshima', no: 13,
  title: '鹿児島本線と肥薩おれんじ鉄道',
  note: '門司港〜博多〜熊本〜八代の都市圏輸送、単線の肥薩おれんじ鉄道、川内〜鹿児島中央。特急きらめき、快速と各駅停車。',
  self: 'jrk',
  spacing: 460,
  settings: {
    defaultMaxSpeedKmh: 120, farePerKm: 17, fareBase: 170, dailyTripRate: 0.1,
    reversalMinutes: 4, targetCashOku: 800, startCashOku: 150,
  },
  operators: {
    jrk: { name: 'JR九州', short: '九', color: '#e60012' },
    orange: { name: '肥薩おれんじ鉄道', short: 'お', color: '#f08300' },
  },
  lines: [
    {
      key: 'main', name: '鹿児島本線（門司港〜八代）', trackName: '鹿児島本線', color: '#e60012', op: 'jrk', vmax: 130,
      safety: ['ats_sn'], maxCars: 9, heading: 250,
      turns: { '小倉': 230, '折尾': 220, '福間': 240, '博多': 180, '鳥栖': 200, '大牟田': 170, '熊本': 190, '宇土': 200 },
      stations: [
        K('門司港', 0.0, 5, 'tourist', 't', { stubs: 4 }), K('小森江', 4.0, 1.5), K('門司', 5.5, 9, 'mixed'),
        K('小倉', 11.0, 37, 'urban'), K('西小倉', 11.8, 5, 'mixed'), K('九州工大前', 15.3, 5, 'school'), K('戸畑', 17.2, 12, 'mixed'),
        K('枝光', 20.0, 2), K('スペースワールド', 21.1, 2, 'tourist'), K('八幡', 22.2, 6, 'mixed'), K('黒崎', 24.9, 13, 'mixed'),
        K('陣原', 27.1, 3), K('折尾', 30.1, 16, 'mixed'), K('水巻', 32.2, 3), K('遠賀川', 34.3, 3), K('海老津', 39.4, 2.5),
        K('教育大前', 44.6, 2.5, 'school'), K('赤間', 46.5, 8), K('東郷', 50.7, 4), K('東福間', 53.9, 3), K('福間', 56.6, 6),
        K('千鳥', 58.5, 2), K('古賀', 60.6, 6), K('ししぶ', 62.0, 2), K('新宮中央', 63.4, 3), K('福工大前', 65.1, 5, 'school'),
        K('九産大前', 68.1, 5, 'school'), K('香椎', 69.8, 9, 'mixed'), K('千早', 71.0, 9, 'mixed'), K('箱崎', 75.0, 3),
        K('吉塚', 76.4, 9, 'mixed'), K('博多', 78.2, 120, 'urban'), K('竹下', 80.9, 4), K('笹原', 83.3, 4), K('南福岡', 84.9, 9),
        K('春日', 86.1, 3), K('大野城', 87.4, 5), K('水城', 88.8, 3), K('都府楼南', 91.0, 3), K('二日市', 92.4, 10, 'mixed'),
        K('天拝山', 94.3, 5), K('原田', 97.9, 3), K('けやき台', 99.9, 2), K('基山', 101.4, 3), K('弥生が丘', 103.5, 2),
        K('田代', 105.6, 2), K('鳥栖', 106.8, 8, 'mixed'), K('肥前旭', 110.4, 1), K('久留米', 113.9, 9, 'mixed'),
        K('荒木', 118.8, 2), K('西牟田', 122.6, 0.6), K('羽犬塚', 126.1, 3), K('筑後船小屋', 129.7, 1), K('瀬高', 132.2, 2),
        K('南瀬高', 135.2, 0.3), K('渡瀬', 139.1, 0.6), K('吉野', 141.9, 0.6), K('銀水', 144.3, 0.5), K('大牟田', 147.5, 5, 'mixed'),
        K('荒尾', 151.6, 2), K('南荒尾', 154.8, 0.3), K('長洲', 159.4, 1.5), K('大野下', 164.1, 0.4), K('玉名', 168.6, 3),
        K('肥後伊倉', 172.8, 0.3), K('木葉', 176.7, 0.3), K('田原坂', 180.2, 0.2, 'tourist'), K('植木', 184.6, 1.5),
        K('西里', 188.8, 0.6), K('崇城大学前', 191.7, 1.2, 'school'), K('上熊本', 193.3, 3), K('熊本', 196.6, 18, 'urban'),
        K('西熊本', 199.8, 1.5), K('川尻', 201.9, 1.5), K('富合', 205.3, 0.8), K('宇土', 207.5, 3), K('松橋', 212.3, 2),
        K('小川', 218.5, 0.8), K('有佐', 223.5, 0.3), K('千丁', 227.6, 0.4), K('新八代', 229.5, 1), K('八代', 232.3, 2, 'mixed'),
      ],
    },
    {
      key: 'orange', name: '肥薩おれんじ鉄道線', color: '#f08300', op: 'orange', vmax: 85, double: false,
      safety: ['ats_sn'], maxCars: 2, heading: 200, endEnd: 'boundary',
      attach: { line: 'main', at: '八代', mode: 'end' },
      turns: { '佐敷': 180, '水俣': 215, '阿久根': 180 },
      stations: [
        K('八代', 0.0), K('肥後高田', 4.8, 0.3), K('日奈久温泉', 10.1, 0.2, 'tourist'), K('肥後二見', 13.7, 0.1),
        K('上田浦', 18.0, 0.1), K('たのうら御立岬公園', 22.1, 0.1, 'tourist'), K('肥後田浦', 23.6, 0.1), K('海浦', 26.7, 0.05),
        K('佐敷', 29.8, 0.2), K('湯浦', 33.7, 0.1), K('津奈木', 42.4, 0.1), K('新水俣', 45.8, 0.3), K('水俣', 49.6, 0.5, 'mixed'),
        K('袋', 55.4, 0.1), K('米ノ津', 61.3, 0.3), K('出水', 65.6, 1, 'mixed'), K('西出水', 68.3, 0.2), K('高尾野', 72.1, 0.3),
        K('野田郷', 75.3, 0.1), K('折口', 80.7, 0.1), K('阿久根', 86.2, 0.5, 'mixed'), K('牛ノ浜', 92.2, 0.05, 'tourist'),
        K('薩摩大川', 95.7, 0.05), K('西方', 99.6, 0.05), K('薩摩高城', 102.3, 0.05), K('草道', 107.3, 0.1),
        K('上川内', 113.7, 0.3), K('川内', 116.9, 3, 'mixed'),
      ],
    },
    {
      key: 'south', name: '鹿児島本線（川内〜鹿児島）', trackName: '鹿児島本線', color: '#c8102e', op: 'jrk', vmax: 110,
      safety: ['ats_sn'], maxCars: 6, heading: 160, endEnd: 'boundary',
      attach: { line: 'orange', at: '川内', mode: 'end' },
      turns: { '串木野': 130, '伊集院': 120 },
      stations: [
        K('川内', 0.0), K('隈之城', 2.6, 1), K('木場茶屋', 5.7, 0.3), K('串木野', 12.0, 1, 'mixed'), K('神村学園前', 14.2, 1, 'school'),
        K('市来', 16.6, 0.6), K('湯之元', 20.4, 0.4, 'tourist'), K('東市来', 22.9, 0.3), K('伊集院', 28.8, 3, 'mixed'),
        K('薩摩松元', 34.1, 0.6), K('上伊集院', 36.5, 1), K('広木', 41.5, 1), K('鹿児島中央', 46.1, 20, 'urban'),
        K('鹿児島', 49.3, 3, 'mixed'),
      ],
    },
  ],
  through: [
    { key: 'or', from: 'main', at: '八代', name: '肥薩おれんじ鉄道線', line: 'orange', op: 'orange', pax: 3000 },
    { key: 'so', from: 'main', at: '八代', name: '鹿児島本線（川内〜鹿児島）', line: 'south', op: 'jrk', via: ['or'], pax: 8000 },
  ],
  depots: [
    { line: 'main', at: '南福岡', name: '南福岡車両区', side: 1, own: true, share: 0.5, cars: 9 },
    { line: 'main', at: '門司港', name: '小倉総合車両センター門司港車両派出', side: 1, own: true, share: 0.25, cars: 9 },
    { line: 'main', at: '熊本', name: '熊本車両センター', side: 1, own: true, share: 0.25, cars: 6 },
    { line: 'south', at: '鹿児島中央', name: '鹿児島車両センター', side: 1, own: true, min: 6, cars: 6 },
    { line: 'orange', at: '出水', name: '出水車両基地', side: 1, min: 4, cars: 2 },
  ],
  fleet: { prefix: '', suffix: '編成', series: '811・813・817・821系、787系' },
  fleets: [
    { line: 'south', prefix: 'K', suffix: '編成', series: '817系（鹿児島車両センター）', depot: '鹿児島車両センター', start: 101 },
    { line: 'orange', prefix: 'HSOR-', suffix: '', series: 'HSOR-100形', depot: '出水車両基地', start: 101, vehicle: 'dmu' },
  ],
  services: [
    {
      name: '特急きらめき', prefix: 'KR', type: 'ltd', cars: 4, speed: 130,
      route: [['main', '門司港', '博多']],
      stops: { main: ['門司港', '門司', '小倉', '戸畑', '八幡', '黒崎', '折尾', '赤間', '福間', '香椎', '博多'] },
      slots: [['06:30', '09:00', 60, 0], ['17:00', '22:00', 60, 0]], revOffset: 30,
    },
    {
      name: '快速（門司港〜荒木）', prefix: 'R', type: 'express', cars: 6, speed: 120,
      route: [['main', '門司港', '荒木']],
      stops: { main: ['門司港', '門司', '小倉', '戸畑', '八幡', '黒崎', '折尾', '赤間', '東郷', '福間', '古賀', '香椎', '千早', '吉塚', '博多',
        '竹下', '南福岡', '大野城', '二日市', '天拝山', '原田', '基山', '鳥栖', '久留米', '荒木'] },
      slots: [['06:00', '22:00', 30, 0]], revOffset: 15,
    },
    {
      name: '普通（門司港〜福間）', prefix: 'L', type: 'local', cars: 4, speed: 110,
      route: [['main', '門司港', '福間']],
      slots: [['05:30', '23:00', 30, 10]], revOffset: 20,
    },
    {
      name: '普通（福間〜博多〜鳥栖）', prefix: 'F', type: 'local', cars: 4, speed: 110,
      route: [['main', '福間', '鳥栖']],
      slots: [['05:30', '23:30', 30, 20]], revOffset: 5,
    },
    {
      name: '普通（鳥栖〜大牟田）', prefix: 'O', type: 'local', cars: 3, speed: 110,
      route: [['main', '鳥栖', '大牟田']],
      slots: [['05:40', '23:00', 30, 5]], revOffset: 25,
    },
    {
      name: '普通（大牟田〜熊本〜八代）', prefix: 'M', type: 'local', cars: 3, speed: 110,
      route: [['main', '大牟田', '八代']],
      slots: [['05:30', '22:30', 30, 15]], revOffset: 10,
    },
    {
      name: '肥薩おれんじ鉄道 普通', prefix: 'H', type: 'local', cars: 1, speed: 85, op: 'orange',
      route: [['orange', '八代', '川内']],
      slots: [['05:30', '21:00', 120, 0]], revOffset: 60,
    },
    {
      name: '肥薩おれんじ鉄道 普通（出水〜川内）', prefix: 'HI', type: 'local', cars: 1, speed: 85, op: 'orange',
      route: [['orange', '出水', '川内']],
      slots: [['06:00', '20:00', 120, 60]], revOffset: 0,
    },
    {
      name: '普通（川内〜鹿児島中央）', prefix: 'S', type: 'local', cars: 2, speed: 100,
      route: [['south', '川内', '鹿児島中央']],
      slots: [['05:30', '23:00', 30, 0]], revOffset: 15,
    },
  ],
};
