// サンプルの一覧（ツールバーの「サンプル」から選ぶ）

import { sampleDoc } from '../sample.js';
import { buildNetwork } from './network.js';
import toyoko from './toyoko.js';
import kintetsu from './kintetsu.js';
import osaka from './osaka.js';

// 路線網のサンプルは組み立てのときに行き違い・待避まで入れてある（dispatched）
const net = spec => ({ no: spec.no, id: spec.id, name: spec.title, spec, dispatched: true, build: () => buildNetwork(spec) });

export const SAMPLES = [
  { no: 0, id: 'midori', name: 'みどり電鉄（架空・チュートリアル）', build: () => sampleDoc() },
  net(toyoko),
  net(kintetsu),
  net(osaka),
];

export const sampleById = id => SAMPLES.find(s => s.id === id) || SAMPLES[0];
