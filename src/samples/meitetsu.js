// サンプル15：名古屋鉄道（名古屋本線と支線）
// 配線：配線略図.net（名古屋鉄道 各線）、キロ程：Wikipedia 名鉄各線
// 名古屋本線（豊橋〜名鉄岐阜）を幹に、常滑線・空港線・河和線・知多新線、犬山線・各務原線・広見線・小牧線、
// 津島線・尾西線、竹鼻線・羽島線、三河線（山線・海線）、西尾線・蒲郡線、豊川線、豊田線、瀬戸線。
// 瀬戸線はほかの線とつながっていない。瀬戸線・豊田線は配線略図.netに図がなく、広見線の新可児〜御嵩は図がつながりにくいので、駅の構造から組み立てた。
// 各務原線は名鉄岐阜では名古屋本線と別のホームなので、新鵜沼で犬山線につなぐ。尾西線の名鉄一宮も名古屋本線と別に置く。
// 築港線（大江〜東名古屋港）は配線略図が縦向きで、朝夕だけの線なので省いている。

import diagram from './data/meitetsu.js';
import { P } from './util.js';

const K = (name, km, riders = 1, kind = 'residential', type = 's', extra = {}) => [name, km, type, P(riders, kind, extra)];

export default {
  diagram,
  id: 'meitetsu', no: 15,
  title: '名古屋鉄道（名古屋本線と支線）',
  note: '豊橋〜名鉄名古屋〜名鉄岐阜の名古屋本線と、常滑・空港、犬山、知多、三河の支線。快速特急・特急・急行・普通と、ミュースカイ。',
  self: 'meitetsu',
  spacing: 420,
  settings: {
    defaultMaxSpeedKmh: 110, farePerKm: 20, fareBase: 170, dailyTripRate: 0.12,
    reversalMinutes: 3, targetCashOku: 1500, startCashOku: 250,
  },
  operators: {
    meitetsu: { name: '名古屋鉄道', short: '名', color: '#e4002b' },
  },
  lines: [
    {
      key: 'main', name: '名古屋本線', color: '#e4002b', op: 'meitetsu', vmax: 120,
      safety: ['ats_sn'], maxCars: 8, heading: 225,
      turns: { '東岡崎': 210, '知立': 225, '神宮前': 245, '名鉄一宮': 255 },
      stations: [
        K('豊橋', 0.0, 3, 'mixed', 't', { stubs: 1 }), K('伊奈', 5.0, 0.3), K('小田渕', 6.6, 0.2), K('国府', 9.6, 0.8),
        K('御油', 10.7, 0.2), K('名電赤坂', 12.5, 0.1), K('名電長沢', 15.0, 0.1), K('本宿', 18.7, 0.3), K('名電山中', 20.4, 0.1),
        K('藤川', 23.1, 0.2), K('美合', 25.6, 0.4), K('男川', 27.6, 0.3), K('東岡崎', 29.8, 4, 'mixed'), K('岡崎公園前', 31.1, 0.4),
        K('矢作橋', 32.5, 0.5), K('宇頭', 34.8, 0.3), K('新安城', 38.3, 1.5), K('牛田', 40.9, 0.3), K('知立', 43.1, 3, 'mixed'),
        K('一ツ木', 44.6, 0.3), K('富士松', 46.6, 0.3), K('豊明', 48.1, 0.6), K('前後', 49.8, 1.2), K('中京競馬場前', 51.4, 0.5, 'tourist'),
        K('有松', 52.7, 0.6), K('左京山', 53.8, 0.3), K('鳴海', 55.1, 1.2), K('本星崎', 56.7, 0.4), K('本笠寺', 58.2, 0.4),
        K('桜', 58.9, 0.3), K('呼続', 59.9, 0.3), K('堀田', 61.1, 0.8), K('神宮前', 62.2, 4, 'mixed'), K('金山', 64.4, 15, 'urban'),
        K('山王', 66.0, 0.3), K('名鉄名古屋', 68.0, 28, 'urban'), K('栄生', 69.9, 0.6), K('東枇杷島', 70.7, 0.2),
        K('西枇杷島', 71.6, 0.2), K('二ツ杁', 72.2, 0.3), K('新川橋', 72.8, 0.2), K('須ヶ口', 73.5, 0.6), K('丸ノ内', 74.3, 0.1),
        K('新清洲', 75.2, 0.6), K('大里', 77.5, 0.3), K('奥田', 78.8, 0.2), K('国府宮', 80.9, 1.2), K('島氏永', 82.9, 0.2),
        K('妙興寺', 84.7, 0.2), K('名鉄一宮', 86.4, 4, 'mixed'), K('今伊勢', 88.3, 0.3), K('石刀', 89.2, 0.2), K('新木曽川', 91.2, 0.6),
        K('黒田', 92.1, 0.2), K('木曽川堤', 93.9, 0.1), K('笠松', 95.1, 0.6), K('岐南', 96.9, 0.3), K('茶所', 98.3, 0.2),
        K('加納', 98.7, 0.2), K('名鉄岐阜', 99.8, 4, 'mixed'),
      ],
    },
    {
      key: 'tokoname', name: '常滑線', color: '#e4002b', op: 'meitetsu', vmax: 120,
      safety: ['ats_sn'], maxCars: 8, heading: 100,
      attach: { line: 'main', at: '神宮前', mode: 'branch', exit: '豊田本町' },
      stations: [
        K('神宮前', 0.0), K('豊田本町', 1.4, 0.3), K('道徳', 2.4, 0.3), K('大江', 3.8, 0.3), K('大同町', 5.3, 0.3), K('柴田', 6.1, 0.3),
        K('名和', 7.5, 0.4), K('聚楽園', 9.7, 0.4), K('新日鉄前', 10.6, 0.2), K('太田川', 12.3, 1.5, 'mixed'), K('尾張横須賀', 13.7, 0.4),
        K('寺本', 15.1, 0.3), K('朝倉', 16.4, 0.5), K('古見', 17.3, 0.2), K('長浦', 18.7, 0.2), K('日長', 21.0, 0.1), K('新舞子', 22.5, 0.2),
        K('大野町', 24.1, 0.2), K('西ノ口', 25.4, 0.1), K('蒲池', 26.4, 0.1), K('榎戸', 27.5, 0.1), K('多屋', 28.6, 0.1), K('常滑', 29.3, 0.6),
      ],
    },
    {
      key: 'airport', name: '空港線', color: '#0061b0', op: 'meitetsu', vmax: 120, endEnd: 'buffer',
      safety: ['ats_sn'], maxCars: 8, heading: 150,
      attach: { line: 'tokoname', at: '常滑', mode: 'end' },
      stations: [K('常滑', 0.0), K('りんくう常滑', 1.6, 0.3, 'tourist'), K('中部国際空港', 4.2, 3, 'tourist', 't', { stubs: 2 })],
    },
    {
      key: 'kowa', name: '河和線（太田川〜富貴）', trackName: '河和線', color: '#e4002b', op: 'meitetsu', vmax: 110,
      safety: ['ats_sn'], maxCars: 8, heading: 75,
      attach: { line: 'tokoname', at: '太田川', mode: 'branch', exit: '高横須賀' },
      stations: [
        K('太田川', 0.0), K('高横須賀', 1.3, 0.2), K('加木屋中ノ池', 2.7, 0.2), K('南加木屋', 4.1, 0.3), K('八幡新田', 5.9, 0.2),
        K('巽ヶ丘', 7.1, 0.3), K('白沢', 7.9, 0.1), K('坂部', 9.5, 0.1), K('阿久比', 10.6, 0.3), K('植大', 12.2, 0.1), K('半田口', 13.2, 0.2),
        K('住吉町', 14.0, 0.2), K('知多半田', 14.8, 1.5, 'mixed'), K('成岩', 15.8, 0.3), K('青山', 16.8, 0.4), K('上ゲ', 19.0, 0.1),
        K('知多武豊', 19.8, 0.3), K('富貴', 22.3, 0.2),
      ],
    },
    {
      key: 'kowaS', name: '河和線（富貴〜河和）', trackName: '河和線', color: '#e4002b', op: 'meitetsu', vmax: 100, double: false, endEnd: 'buffer',
      safety: ['ats_sn'], maxCars: 6, heading: 80,
      attach: { line: 'kowa', at: '富貴', mode: 'end' },
      stations: [K('富貴', 0.0), K('河和口', 3.5, 0.1, 'tourist'), K('河和', 6.5, 0.3, 'tourist')],
    },
    {
      key: 'chita', name: '知多新線', color: '#e4002b', op: 'meitetsu', vmax: 100, double: false, endEnd: 'buffer',
      safety: ['ats_sn'], maxCars: 6, heading: 140,
      attach: { line: 'kowa', at: '富貴', mode: 'branch', exit: '別曽池' },
      stations: [
        K('富貴', 0.0), K('上野間', 5.8, 0.1), K('美浜緑苑', 6.7, 0.2), K('知多奥田', 8.1, 0.2, 'school'), K('野間', 9.8, 0.1),
        K('内海', 13.9, 0.2, 'tourist'),
      ],
    },
    {
      key: 'inuyama', name: '犬山線', color: '#e4002b', op: 'meitetsu', vmax: 110,
      safety: ['ats_sn'], maxCars: 8, heading: 290,
      attach: { line: 'main', at: '東枇杷島', mode: 'branch', exit: '下小田井' },
      stations: [
        K('東枇杷島', 0.0), K('下小田井', 1.6, 0.2), K('中小田井', 3.0, 0.3), K('上小田井', 4.1, 1.5), K('西春', 6.5, 1.0),
        K('徳重・名古屋芸大', 7.9, 0.5, 'school'), K('大山寺', 8.7, 0.2), K('岩倉', 10.3, 1.0), K('石仏', 12.4, 0.2), K('布袋', 14.8, 0.5),
        K('江南', 16.8, 1.2), K('柏森', 19.6, 0.4), K('扶桑', 21.8, 0.4), K('木津用水', 23.2, 0.2), K('犬山口', 24.6, 0.2),
        K('犬山', 25.5, 1.2, 'tourist'), K('犬山遊園', 26.7, 0.2, 'tourist'), K('新鵜沼', 27.4, 0.6),
      ],
    },
    {
      // 各務原線：名鉄岐阜では名古屋本線と別のホーム（線路はつながっていない）。新鵜沼で犬山線とつながる
      key: 'kakamigahara', name: '各務原線', color: '#e4002b', op: 'meitetsu', vmax: 100, endEnd: 'buffer',
      safety: ['ats_sn'], maxCars: 6, heading: 200,
      attach: { line: 'inuyama', at: '新鵜沼', mode: 'branch', exit: '鵜沼宿' },
      stations: [
        K('新鵜沼', 0.0), K('鵜沼宿', 1.1, 0.2), K('羽場', 2.1, 0.1), K('苧ヶ瀬', 3.0, 0.2), K('名電各務原', 3.9, 0.2), K('二十軒', 5.2, 0.1),
        K('三柿野', 6.4, 0.3), K('六軒', 7.7, 0.2), K('各務原市役所前', 8.9, 0.3), K('市民公園前', 9.5, 0.2), K('新那加', 10.1, 0.4),
        K('新加納', 11.0, 0.2), K('高田橋', 12.2, 0.1), K('手力', 12.8, 0.1), K('切通', 13.7, 0.2), K('細畑', 14.7, 0.2), K('田神', 16.5, 0.2),
        K('名鉄岐阜（各務原線）', 17.6, 2, 'mixed'),
      ],
    },
    {
      key: 'hiromi', name: '広見線（犬山〜新可児）', trackName: '広見線', color: '#e4002b', op: 'meitetsu', vmax: 100,
      safety: ['ats_sn'], maxCars: 6, heading: 340,
      attach: { line: 'inuyama', at: '犬山', mode: 'branch', exit: '富岡前' },
      stations: [
        K('犬山', 0.0), K('富岡前', 1.9, 0.1), K('善師野', 4.0, 0.1), K('西可児', 7.7, 0.3), K('可児川', 9.7, 0.2),
        K('日本ライン今渡', 12.2, 0.2), K('新可児', 14.9, 0.5),
      ],
    },
    {
      key: 'mitake', name: '広見線（新可児〜御嵩）', trackName: '広見線', color: '#e4002b', op: 'meitetsu', vmax: 85, double: false, endEnd: 'buffer',
      safety: ['ats_sn'], maxCars: 2, heading: 290,
      attach: { line: 'hiromi', at: '新可児', mode: 'branch' },
      stations: [K('新可児', 0.0), K('明智', 3.5, 0.1, 'residential', 'pd'), K('顔戸', 5.1, 0.05), K('御嵩口', 6.8, 0.05), K('御嵩', 7.4, 0.1, 'residential', 't', { stubs: 1 })],
    },
    {
      key: 'komaki', name: '小牧線', color: '#e4002b', op: 'meitetsu', vmax: 100, double: false, endEnd: 'boundary',
      safety: ['ats_sn'], maxCars: 6, heading: 90,
      attach: { line: 'inuyama', at: '犬山', mode: 'branch', exit: '五郎丸' },
      stations: [
        K('犬山', 0.0), K('羽黒', 3.4, 0.2), K('楽田', 5.7, 0.2), K('田県神社前', 7.3, 0.1), K('味岡', 8.2, 0.2), K('小牧原', 9.3, 0.2),
        K('小牧', 10.8, 0.8), K('小牧口', 11.6, 0.2), K('間内', 12.8, 0.2), K('牛山', 13.7, 0.2), K('春日井', 15.2, 0.3),
        K('味美', 16.9, 0.3), K('味鋺', 18.3, 0.2), K('上飯田', 20.6, 0.8),
      ],
    },
    {
      key: 'tsushima', name: '津島線', color: '#e4002b', op: 'meitetsu', vmax: 100,
      safety: ['ats_sn'], maxCars: 6, heading: 175,
      attach: { line: 'main', at: '須ヶ口', mode: 'branch', exit: '甚目寺' },
      stations: [
        K('須ヶ口', 0.0), K('甚目寺', 2.0, 0.3), K('七宝', 3.7, 0.2), K('木田', 5.4, 0.3), K('青塚', 7.3, 0.1), K('勝幡', 9.0, 0.2),
        K('藤浪', 10.2, 0.1), K('津島', 11.8, 0.6, 'mixed'),
      ],
    },
    {
      key: 'bisai', name: '尾西線（津島〜名鉄一宮）', trackName: '尾西線', color: '#e4002b', op: 'meitetsu', vmax: 85, double: false, endEnd: 'boundary',
      safety: ['ats_sn'], maxCars: 4, heading: 268, spacing: 200,
      attach: { line: 'tsushima', at: '津島', mode: 'branch', exit: '町方' },
      stations: [
        K('津島', 0.0), K('町方', 1.4, 0.05), K('六輪', 2.9, 0.1), K('渕高', 4.2, 0.05), K('丸渕', 5.2, 0.05), K('上丸渕', 6.5, 0.05),
        K('森上', 8.0, 0.1), K('山崎', 9.1, 0.05), K('玉野', 10.5, 0.05), K('萩原', 12.0, 0.1), K('二子', 13.1, 0.05),
        K('苅安賀', 14.3, 0.1), K('観音寺', 15.0, 0.1), K('名鉄一宮（尾西線）', 17.1, 0.5),
      ],
    },
    {
      key: 'bisaiS', name: '尾西線（津島〜弥富）', trackName: '尾西線', color: '#e4002b', op: 'meitetsu', vmax: 85, double: false, endEnd: 'boundary',
      safety: ['ats_sn'], maxCars: 4, heading: 90,
      attach: { line: 'tsushima', at: '津島', mode: 'end' },
      stations: [K('津島', 0.0), K('日比野', 1.6, 0.05), K('佐屋', 3.6, 0.1), K('五ノ三', 5.7, 0.05), K('弥富', 8.2, 0.3)],
    },
    {
      key: 'takehana', name: '竹鼻線', color: '#e4002b', op: 'meitetsu', vmax: 85, double: false,
      safety: ['ats_sn'], maxCars: 4, heading: 225, spacing: 250,
      attach: { line: 'main', at: '笠松', mode: 'branch', exit: '西笠松' },
      stations: [
        K('笠松', 0.0), K('西笠松', 0.9, 0.05), K('柳津', 2.9, 0.2), K('南宿', 5.2, 0.05), K('須賀', 6.1, 0.05), K('不破一色', 7.0, 0.05),
        K('竹鼻', 8.6, 0.2), K('羽島市役所前', 9.6, 0.1), K('江吉良', 10.3, 0.05),
      ],
    },
    {
      key: 'hashima', name: '羽島線', color: '#e4002b', op: 'meitetsu', vmax: 85, double: false, endEnd: 'buffer',
      safety: ['ats_sn'], maxCars: 4, heading: 90,
      attach: { line: 'takehana', at: '江吉良', mode: 'end' },
      stations: [K('江吉良', 0.0), K('新羽島', 1.3, 0.2)],
    },
    {
      key: 'mikawaY', name: '三河線（知立〜猿投）', trackName: '三河線', color: '#e4002b', op: 'meitetsu', vmax: 95, double: false, endEnd: 'buffer',
      safety: ['ats_sn'], maxCars: 4, heading: 315,
      attach: { line: 'main', at: '知立', mode: 'branch', exit: '三河知立' },
      stations: [
        K('知立', 0.0), K('三河知立', 1.5, 0.1), K('三河八橋', 3.8, 0.1), K('若林', 6.2, 0.2), K('竹村', 8.5, 0.2), K('土橋', 11.1, 0.3),
        K('上挙母', 13.9, 0.2), K('豊田市', 15.7, 1.5, 'mixed'), K('梅坪', 17.1, 0.3), K('越戸', 19.1, 0.1), K('平戸橋', 20.2, 0.1),
        K('猿投', 21.3, 0.2),
      ],
    },
    {
      key: 'mikawaU', name: '三河線（知立〜碧南）', trackName: '三河線', color: '#e4002b', op: 'meitetsu', vmax: 95, double: false, endEnd: 'buffer',
      safety: ['ats_sn'], maxCars: 4, heading: 110,
      attach: { line: 'main', at: '知立', mode: 'branch', exit: '重原' },
      stations: [
        K('知立', 0.0), K('重原', 2.2, 0.2), K('刈谷', 3.9, 1.0, 'mixed'), K('刈谷市', 5.5, 0.2), K('小垣江', 8.1, 0.2), K('吉浜', 10.1, 0.2),
        K('三河高浜', 12.0, 0.2), K('高浜港', 13.0, 0.1), K('北新川', 14.8, 0.1), K('新川町', 15.8, 0.1), K('碧南中央', 16.9, 0.2),
        K('碧南', 18.5, 0.2),
      ],
    },
    {
      key: 'nishio', name: '西尾線', color: '#e4002b', op: 'meitetsu', vmax: 100, double: false,
      safety: ['ats_sn'], maxCars: 6, heading: 60,
      attach: { line: 'main', at: '新安城', mode: 'branch', exit: '北安城' },
      stations: [
        K('新安城', 0.0), K('北安城', 2.6, 0.2), K('南安城', 4.0, 0.3), K('碧海古井', 5.7, 0.1), K('堀内公園', 6.7, 0.1), K('桜井', 7.9, 0.3),
        K('南桜井', 9.5, 0.1), K('米津', 11.6, 0.1), K('桜町前', 13.0, 0.1), K('西尾口', 14.2, 0.1), K('西尾', 15.0, 0.5, 'mixed'),
        K('福地', 17.4, 0.1), K('上横須賀', 20.5, 0.1), K('吉良吉田', 24.7, 0.2),
      ],
    },
    {
      key: 'gamagori', name: '蒲郡線', color: '#e4002b', op: 'meitetsu', vmax: 85, double: false, endEnd: 'buffer',
      safety: ['ats_sn'], maxCars: 2, heading: 10,
      attach: { line: 'nishio', at: '吉良吉田', mode: 'end' },
      stations: [
        K('吉良吉田', 0.0), K('三河鳥羽', 3.2, 0.05), K('西幡豆', 4.7, 0.05), K('東幡豆', 7.0, 0.05), K('こどもの国', 8.9, 0.05, 'tourist'),
        K('西浦', 10.5, 0.1, 'tourist'), K('形原', 11.7, 0.1), K('三河鹿島', 13.5, 0.05), K('蒲郡競艇場前', 15.3, 0.1), K('蒲郡', 17.6, 0.3),
      ],
    },
    {
      key: 'toyokawa', name: '豊川線', color: '#e4002b', op: 'meitetsu', vmax: 85, double: false, endEnd: 'buffer',
      safety: ['ats_sn'], maxCars: 4, heading: 5,
      attach: { line: 'main', at: '国府', mode: 'branch', exit: '八幡' },
      stations: [K('国府', 0.0), K('八幡', 2.5, 0.1), K('諏訪町', 4.4, 0.1), K('稲荷口', 6.0, 0.1), K('豊川稲荷', 7.2, 0.5, 'tourist')],
    },
    {
      // 豊田線（梅坪〜赤池）：地下鉄鶴舞線と直通
      key: 'toyota', name: '豊田線', color: '#00a0e9', op: 'meitetsu', vmax: 110,
      safety: ['ats_sn'], maxCars: 6, heading: 260,
      attach: { line: 'mikawaY', at: '梅坪', mode: 'branch', offset: -200 },
      stations: [
        K('梅坪', 0.0), K('上豊田', 2.0, 0.2), K('浄水', 3.8, 0.5, 'p'), K('三好ヶ丘', 6.2, 0.3), K('黒笹', 8.1, 0.2),
        K('米野木', 10.4, 0.2), K('日進', 12.2, 0.4), K('赤池', 15.2, 1, 'mixed', 't', { stubs: 2 }),
      ],
    },
    {
      // 瀬戸線（栄町〜尾張瀬戸）：ほかの線とつながっていない
      key: 'seto', name: '瀬戸線', color: '#e4002b', op: 'meitetsu', vmax: 100,
      safety: ['ats_sn'], maxCars: 4, heading: 340, origin: { x: -9800, y: -13300 }, startEnd: 'boundary',
      stations: [
        K('栄町', 0.0, 2, 'business', 't', { stubs: 2 }), K('東大手', 1.5, 0.2, 'school'), K('清水', 2.2, 0.2), K('尼ヶ坂', 2.7, 0.1),
        K('森下', 3.6, 0.2), K('大曽根', 4.6, 1, 'mixed', 'p'), K('矢田', 5.9, 0.2), K('守山自衛隊前', 7.0, 0.2), K('瓢箪山', 7.6, 0.2),
        K('小幡', 8.6, 0.3), K('喜多山', 9.9, 0.3, 'residential', 'p'), K('大森・金城学院前', 10.7, 0.3, 'school'), K('印場', 12.2, 0.3),
        K('旭前', 13.1, 0.2), K('尾張旭', 14.7, 0.5, 'residential', 'p'), K('三郷', 16.1, 0.3), K('水野', 18.0, 0.2),
        K('新瀬戸', 18.7, 0.3), K('瀬戸市役所前', 19.4, 0.1), K('尾張瀬戸', 20.6, 0.5, 'mixed', 't', { stubs: 2 }),
      ],
    },
  ],
  through: [],
  depots: [
    { line: 'main', at: '名電山中', name: '舞木検査場', side: 1, own: true, share: 0.1, cars: 8 },
    { line: 'main', at: '豊明', name: '犬山検車区豊明検車支区', side: 1, own: true, share: 0.3, cars: 8 },
    { line: 'main', at: '須ヶ口', name: '犬山検車区新川検車支区', side: 1, own: true, share: 0.3, cars: 8 },
    { line: 'inuyama', at: '犬山', name: '犬山検車区', side: 1, own: true, share: 0.3, cars: 8 },
    { line: 'seto', at: '喜多山', name: '尾張旭検車区', side: 1, own: true, min: 6, cars: 4 },
  ],
  fleet: { prefix: '', suffix: '編成', series: '9500系・3300系・2200系・1700系・3500系・6000系' },
  fleets: [
    { line: 'seto', prefix: 'S', suffix: '編成', series: '4000系（瀬戸線）', depot: '尾張旭検車区', start: 1 },
  ],
  services: [
    {
      name: '快速特急（豊橋〜名鉄岐阜）', prefix: 'KT', type: 'ltd', cars: 6, speed: 120,
      route: [['main', '豊橋', '名鉄岐阜']],
      stops: { main: ['豊橋', '国府', '東岡崎', '知立', '神宮前', '金山', '名鉄名古屋', '名鉄一宮', '笠松', '名鉄岐阜'] },
      slots: [['06:00', '22:00', 30, 0]], revOffset: 15,
    },
    {
      name: '急行（豊橋〜名鉄岐阜）', prefix: 'E', type: 'express', cars: 6, speed: 110,
      route: [['main', '豊橋', '名鉄岐阜']],
      stops: { main: ['豊橋', '伊奈', '国府', '本宿', '美合', '東岡崎', '新安城', '知立', '前後', '鳴海', '堀田', '神宮前', '金山', '名鉄名古屋',
        '栄生', '須ヶ口', '新清洲', '国府宮', '名鉄一宮', '新木曽川', '笠松', '名鉄岐阜'] },
      slots: [['05:30', '23:00', 30, 15]], revOffset: 0,
    },
    {
      name: '普通（名古屋本線）', prefix: 'L', type: 'local', cars: 4, speed: 100,
      route: [['main', '東岡崎', '名鉄一宮']],
      slots: [['05:30', '23:30', 30, 8]], revOffset: 20,
    },
    {
      name: 'ミュースカイ（名鉄岐阜〜中部国際空港）', prefix: 'MU', type: 'ltd', cars: 4, speed: 120,
      route: [['main', '名鉄岐阜', '神宮前'], ['tokoname', '神宮前', '常滑'], ['airport', '常滑', '中部国際空港']],
      stops: { main: ['名鉄岐阜', '名鉄一宮', '名鉄名古屋', '金山', '神宮前'], tokoname: ['神宮前', '常滑'], airport: ['常滑', '中部国際空港'] },
      slots: [['07:00', '21:00', 60, 20]], revOffset: 20,
    },
    {
      name: '特急（名鉄名古屋〜中部国際空港）', prefix: 'AP', type: 'express', cars: 6, speed: 120,
      route: [['main', '名鉄名古屋', '神宮前'], ['tokoname', '神宮前', '常滑'], ['airport', '常滑', '中部国際空港']],
      stops: { main: ['名鉄名古屋', '金山', '神宮前'], tokoname: ['神宮前', '太田川', '朝倉', '新舞子', '常滑'], airport: ['常滑', 'りんくう常滑', '中部国際空港'] },
      slots: [['06:00', '22:00', 30, 5]], revOffset: 10,
    },
    {
      name: '急行（名鉄名古屋〜河和）', prefix: 'KW', type: 'express', cars: 4, speed: 110,
      route: [['main', '名鉄名古屋', '神宮前'], ['tokoname', '神宮前', '太田川'], ['kowa', '太田川', '富貴'], ['kowaS', '富貴', '河和']],
      stops: {
        main: ['名鉄名古屋', '金山', '神宮前'], tokoname: ['神宮前', '大江', '聚楽園', '太田川'],
        kowa: ['太田川', '南加木屋', '巽ヶ丘', '阿久比', '知多半田', '青山', '知多武豊', '富貴'], kowaS: ['富貴', '河和口', '河和'],
      },
      slots: [['06:00', '22:00', 30, 20]], revOffset: 25,
    },
    {
      name: '普通（富貴〜内海）', prefix: 'UT', type: 'local', cars: 2, speed: 100,
      route: [['chita', '富貴', '内海']],
      slots: [['06:00', '22:00', 30, 0]], revOffset: 10,
    },
    {
      name: '急行（名鉄名古屋〜犬山・新鵜沼）', prefix: 'IN', type: 'express', cars: 6, speed: 110,
      route: [['main', '名鉄名古屋', '東枇杷島'], ['inuyama', '東枇杷島', '新鵜沼']],
      stops: { main: ['名鉄名古屋', '栄生', '東枇杷島'], inuyama: ['東枇杷島', '上小田井', '西春', '岩倉', '布袋', '江南', '柏森', '扶桑', '犬山', '犬山遊園', '新鵜沼'] },
      slots: [['05:30', '23:00', 15, 3]], revOffset: 5,
    },
    {
      name: '普通（名鉄岐阜〜新鵜沼）', prefix: 'KG', type: 'local', cars: 4, speed: 100,
      route: [['kakamigahara', '新鵜沼', '名鉄岐阜（各務原線）']],
      slots: [['05:30', '23:00', 15, 0]], revOffset: 5,
    },
    {
      name: '普通（犬山〜新可児）', prefix: 'HM', type: 'local', cars: 4, speed: 100,
      route: [['hiromi', '犬山', '新可児']],
      slots: [['05:30', '23:00', 30, 10]], revOffset: 10,
    },
    {
      name: '普通（新可児〜御嵩）', prefix: 'MT', type: 'local', cars: 2, speed: 85,
      route: [['mitake', '新可児', '御嵩']],
      slots: [['06:00', '22:00', 30, 5]], revOffset: 15,
    },
    {
      name: '普通（上飯田〜犬山）', prefix: 'KM', type: 'local', cars: 4, speed: 100,
      route: [['komaki', '犬山', '上飯田']],
      slots: [['05:30', '23:30', 15, 0]], revOffset: 5,
    },
    {
      name: '準急（名鉄名古屋〜津島〜佐屋）', prefix: 'TS', type: 'express', cars: 4, speed: 100,
      route: [['main', '名鉄名古屋', '須ヶ口'], ['tsushima', '須ヶ口', '津島'], ['bisaiS', '津島', '佐屋']],
      stops: { main: ['名鉄名古屋', '栄生', '須ヶ口'], tsushima: ['須ヶ口', '甚目寺', '七宝', '木田', '勝幡', '津島'], bisaiS: ['津島', '日比野', '佐屋'] },
      slots: [['06:00', '23:00', 30, 12]], revOffset: 15,
    },
    {
      name: '普通（津島〜名鉄一宮）', prefix: 'BS', type: 'local', cars: 2, speed: 85,
      route: [['bisai', '津島', '名鉄一宮（尾西線）']],
      slots: [['06:00', '22:00', 30, 0]], revOffset: 15,
    },
    {
      name: '普通（佐屋〜弥富）', prefix: 'YT', type: 'local', cars: 2, speed: 85,
      route: [['bisaiS', '津島', '弥富']],
      slots: [['06:00', '22:00', 60, 30]], revOffset: 20,
    },
    {
      name: '普通（笠松〜新羽島）', prefix: 'TH', type: 'local', cars: 2, speed: 85,
      route: [['takehana', '笠松', '江吉良'], ['hashima', '江吉良', '新羽島']],
      slots: [['06:00', '22:00', 30, 0]], revOffset: 15,
    },
    {
      name: '普通（知立〜豊田市・猿投）', prefix: 'MY', type: 'local', cars: 4, speed: 95,
      route: [['mikawaY', '知立', '猿投']],
      slots: [['06:00', '23:00', 30, 0]], revOffset: 15,
    },
    {
      name: '普通（知立〜碧南）', prefix: 'MK', type: 'local', cars: 4, speed: 95,
      route: [['mikawaU', '知立', '碧南']],
      slots: [['06:00', '23:00', 30, 15]], revOffset: 15,
    },
    {
      name: '急行（新安城〜吉良吉田）', prefix: 'NS', type: 'local', cars: 4, speed: 100,
      route: [['nishio', '新安城', '吉良吉田']],
      slots: [['06:00', '23:00', 30, 5]], revOffset: 15,
    },
    {
      name: '普通（吉良吉田〜蒲郡）', prefix: 'GM', type: 'local', cars: 2, speed: 85,
      route: [['gamagori', '吉良吉田', '蒲郡']],
      slots: [['06:00', '22:00', 60, 0]], revOffset: 30,
    },
    {
      name: '普通（国府〜豊川稲荷）', prefix: 'TK', type: 'local', cars: 4, speed: 85,
      route: [['toyokawa', '国府', '豊川稲荷']],
      slots: [['06:00', '23:00', 30, 0]], revOffset: 15,
    },
    {
      name: '普通（梅坪〜赤池）', prefix: 'TY', type: 'local', cars: 6, speed: 100,
      route: [['toyota', '梅坪', '赤池']],
      slots: [['06:00', '23:00', 20, 0]], revOffset: 10,
    },
    {
      name: '急行・普通（栄町〜尾張瀬戸）', prefix: 'SE', type: 'local', cars: 4, speed: 100,
      route: [['seto', '栄町', '尾張瀬戸']],
      slots: [['05:30', '23:30', 15, 0]], revOffset: 5,
    },
  ],
};
