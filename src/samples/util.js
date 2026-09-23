// サンプル作成の小道具

const MIX = {
  urban: [0.3, 1.2], business: [0.2, 1.3], mixed: [0.6, 0.6], residential: [1.2, 0.25],
  school: [0.6, 0.7], tourist: [0.4, 0.7], airport: [0.1, 1.0], rural: [1.0, 0.3],
};

/** 1日の乗降人員（千人）と駅の性格から、沿線の人口・従業者数を決める */
export const P = (riders, kind = 'residential', extra = {}) => {
  const [a, b] = MIX[kind] || MIX.residential;
  const k = kind === 'airport' ? 'tourist' : kind === 'rural' ? 'residential' : kind;
  return { pop: Math.round(riders * 1000 * a), jobs: Math.round(riders * 1000 * b), kind: k, ...extra };
};

/** 起点からの累積キロ程をずらす（別の起点の路線をつなぐとき） */
export const shiftKm = (rows, base, sign = 1) => rows.map(([n, km, ...rest]) => [n, Math.round((sign * (km - base)) * 10) / 10, ...rest]);
