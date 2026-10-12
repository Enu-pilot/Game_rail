// サンプル12：大井川鐵道 大井川本線（金谷〜千頭）
// 配線：配線略図.net に掲載がないため、Wikipedia 各駅記事の駅構造（何面何線）から組み立てた。キロ程：Wikipedia 大井川鐵道大井川本線
// 全線単線。行き違いできる駅は 新金谷・合格・神尾・福用・家山・地名・塩郷・下泉・駿河徳山・千頭（島式1面2線など）。
// SL急行（かわね路）は新金谷〜千頭の機関車牽引列車で、千頭・新金谷の転車台で機関車の向きを変え、機回しをする。
// 2022年の台風被害で家山〜千頭は長く運休したが、このサンプルは全線で運転していたときのダイヤを想定している。

import { P } from './util.js';

export default {
  id: 'oigawa', no: 12,
  title: '大井川鐵道 大井川本線（金谷〜千頭）',
  note: '大井川沿いの単線を、SL急行と元大手私鉄の電車が走る。千頭・新金谷の転車台とSLの機回し、島式ホームでの行き違い。',
  self: 'oigawa',
  spacing: 420,
  settings: {
    defaultMaxSpeedKmh: 65, farePerKm: 40, fareBase: 150, dailyTripRate: 0.12,
    reversalMinutes: 4, targetCashOku: 20, startCashOku: 5,
    costPerRouteKmDay: 12000, costPerStationDay: 6000, costPerCarKm: 140, costPerCarDay: 7000,
    runAroundMinutes: 15,
  },
  operators: {
    oigawa: { name: '大井川鐵道', short: '大', color: '#c4161c' },
  },
  lines: [
    {
      key: 'main', name: '大井川本線', color: '#c4161c', op: 'oigawa', vmax: 65, double: false,
      safety: ['ats_sn'], maxCars: 7, heading: 335,
      turns: { '神尾': 350, '家山': 20, '地名': 345, '下泉': 10, '駿河徳山': 330 },
      stations: [
        ['金谷', 0.0, 't', P(1.5, 'mixed', { stubs: 1 })],
        ['新金谷', 2.3, 'pd', P(1.5, 'tourist', { ra: true, tt: true })],
        ['代官町', 3.8, 's', P(0.2, 'residential')],
        ['日切', 4.3, 's', P(0.1, 'residential')],
        ['合格', 5.0, 'pd', P(0.1, 'tourist')],
        ['門出', 5.5, 's', P(0.2, 'tourist')],
        ['神尾', 9.8, 'pd', P(0.05, 'rural')],
        ['福用', 12.3, 'pd', P(0.1, 'rural')],
        ['大和田', 14.8, 's', P(0.05, 'rural')],
        ['家山', 17.1, 'pd', P(0.8, 'tourist')],
        ['抜里', 18.8, 's', P(0.05, 'rural')],
        ['川根温泉笹間渡', 20.0, 's', P(0.6, 'tourist')],
        ['地名', 22.9, 'pd', P(0.05, 'rural')],
        ['塩郷', 24.3, 'pd', P(0.1, 'tourist')],
        ['下泉', 27.4, 'pd', P(0.1, 'rural')],
        ['田野口', 31.0, 's', P(0.1, 'rural')],
        ['駿河徳山', 34.1, 'pd', P(0.2, 'residential')],
        ['青部', 36.1, 's', P(0.05, 'rural')],
        ['崎平', 37.2, 's', P(0.05, 'rural')],
        // 千頭：頭端式2面4線（大井川本線）。転車台つき
        ['千頭', 39.5, 't', P(1.5, 'tourist', { stubs: 4, ra: true, tt: true })],
      ],
    },
  ],
  through: [],
  depots: [
    { line: 'main', at: '新金谷', name: '新金谷車両区', side: 1, own: true, min: 6, cars: 7, offset: 260 },
  ],
  fleet: { prefix: '', suffix: '編成', series: '21000系（元南海）・16000系（元近鉄）・3000系（元京阪）' },
  fleets: [
    { line: 'main', prefix: 'SL', suffix: '', series: 'SL（C10・C11・C56）＋旧型客車', depot: '新金谷車両区', start: 1 },
  ],
  services: [
    {
      name: '普通（金谷〜千頭）', prefix: 'O', type: 'local', cars: 2, speed: 65,
      route: [['main', '金谷', '千頭']],
      slots: [['06:00', '08:00', 60, 0], ['08:00', '17:00', 90, 0], ['17:00', '20:00', 60, 0]],
      revOffset: 40,
    },
    {
      name: '普通（金谷〜家山）', prefix: 'I', type: 'local', cars: 2, speed: 65,
      route: [['main', '金谷', '家山']],
      slots: [['06:30', '08:30', 60, 30], ['16:30', '19:30', 60, 30]],
      revOffset: 10,
    },
    {
      // SL急行：新金谷〜千頭。両端の転車台で機関車の向きを変え、機回しをする
      name: 'SL急行（かわね路）', prefix: 'SL', type: 'express', cars: 7, speed: 50, loco: true, dwell: 60,
      route: [['main', '新金谷', '千頭']],
      stops: { main: ['新金谷', '家山', '川根温泉笹間渡', '下泉', '駿河徳山', '千頭'] },
      slots: [['09:52', '11:52', 120, 0]], revOffset: 120,
    },
  ],
};
