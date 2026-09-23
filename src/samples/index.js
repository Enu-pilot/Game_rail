// サンプルの一覧（ツールバーの「サンプル」から選ぶ）

import { sampleDoc } from '../sample.js';
import { buildNetwork } from './network.js';
import toyoko from './toyoko.js';

const net = spec => ({ no: spec.no, id: spec.id, name: spec.title, spec, build: () => buildNetwork(spec) });

export const SAMPLES = [
  { no: 0, id: 'midori', name: 'みどり電鉄（架空・チュートリアル）', build: () => sampleDoc() },
  net(toyoko),
];

export const sampleById = id => SAMPLES.find(s => s.id === id) || SAMPLES[0];
