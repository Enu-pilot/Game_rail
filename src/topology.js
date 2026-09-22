// 線路の接続関係（トポロジー）の構築・入換経路探索・レイアウト検証

import { polylineLength, pointAt, distToPolyline, dist } from './geom.js';
import { trackKind, objectDef } from './catalog.js';
import { trackCapacity, trackUsage, formationLength } from './store.js';

export const JOIN_TOL = 6;        // 接続とみなす距離[m]
export const DEFAULT_MAX_TURN = 90; // 折返しなしで通過できる最大転向角[度]

/** 端点種別 */
export const END_TYPES = [
  { id: 'open', name: '開放（未処理）' },
  { id: 'buffer', name: '車止め' },
  { id: 'boundary', name: '場外接続（出入口）' },
];

export const endType = (t, which) => (t.ends && t.ends[which]) || 'open';

const norm = a => { let v = a % (Math.PI * 2); if (v > Math.PI) v -= Math.PI * 2; if (v < -Math.PI) v += Math.PI * 2; return v; };
const angleDiff = (a, b) => Math.abs(norm(a - b));

/**
 * 接続グラフを構築する。
 * ノード = 線路端点および他線の端点が接する線路内の点
 * エッジ = ノード間の線路区間
 */
export function buildGraph(doc, tol = JOIN_TOL) {
  const nodes = [];
  const nodeById = new Map();
  const addNode = (x, y) => {
    for (const n of nodes) if (dist(n.x, n.y, x, y) <= tol) return n;
    const n = { id: `n${nodes.length}`, x, y, edges: [], ext: false, endOf: [] };
    nodes.push(n); nodeById.set(n.id, n);
    return n;
  };

  const tracks = doc.tracks.filter(t => t.points && t.points.length >= 2 && polylineLength(t.points) > 0.5);
  const trackById = new Map(tracks.map(t => [t.id, t]));
  const attach = new Map();

  // 1) 端点をノード化
  for (const t of tracks) {
    const len = polylineLength(t.points);
    const p0 = t.points[0], p1 = t.points[t.points.length - 1];
    const a = addNode(p0.x, p0.y), b = addNode(p1.x, p1.y);
    a.endOf.push({ trackId: t.id, which: 'a' });
    b.endOf.push({ trackId: t.id, which: 'b' });
    if (endType(t, 'a') === 'boundary') a.ext = true;
    if (endType(t, 'b') === 'boundary') b.ext = true;
    attach.set(t.id, [{ at: 0, node: a.id }, { at: len, node: b.id }]);
  }

  // 2) 他線の端点が線路の途中に接する場合（分岐）
  for (const t of tracks) {
    const len = polylineLength(t.points);
    for (const other of tracks) {
      if (other.id === t.id) continue;
      for (const p of [other.points[0], other.points[other.points.length - 1]]) {
        const r = distToPolyline(p.x, p.y, t.points);
        if (r.d > tol) continue;
        if (r.at <= tol || r.at >= len - tol) continue;   // 端点同士は 1) で処理済み
        const node = addNode(p.x, p.y);
        const list = attach.get(t.id);
        if (!list.some(a => Math.abs(a.at - r.at) < tol)) list.push({ at: r.at, node: node.id });
      }
    }
  }

  // 2.5) 転車台: 放射状に集まる線路の端点を1つのハブにまとめる
  const merged = new Map();
  for (const o of (doc.objects || [])) {
    if (objectDef(o.type).shape !== 'turntable') continue;
    const R = Math.max(o.w, o.h) / 2 + tol * 1.5;
    const hub = addNode(o.x, o.y);
    hub.turntable = o.id;
    hub.turntableSize = Math.max(o.w, o.h);
    for (const n of nodes) {
      if (n === hub || !n.endOf.length) continue;
      if (dist(n.x, n.y, o.x, o.y) <= R) {
        merged.set(n.id, hub.id);
        hub.endOf.push(...n.endOf);
        if (n.ext) hub.ext = true;
      }
    }
  }
  if (merged.size) {
    for (const list of attach.values()) {
      for (const a of list) if (merged.has(a.node)) a.node = merged.get(a.node);
    }
  }

  // 3) 区間（エッジ）を生成
  const edges = [];
  for (const t of tracks) {
    const list = attach.get(t.id).sort((a, b) => a.at - b.at);
    const clean = [];
    for (const a of list) {
      if (!clean.length || a.at - clean[clean.length - 1].at > 0.5) clean.push(a);
    }
    for (let i = 1; i < clean.length; i++) {
      const A = clean[i - 1], B = clean[i];
      const e = {
        id: `e${edges.length}`, trackId: t.id,
        a: A.node, b: B.node, fromAt: A.at, toAt: B.at, len: B.at - A.at,
      };
      edges.push(e);
      nodeById.get(A.node).edges.push(e.id);
      nodeById.get(B.node).edges.push(e.id);
    }
  }

  const edgeById = new Map(edges.map(e => [e.id, e]));
  const g = { nodes, edges, nodeById, edgeById, trackById, tol };

  /** ノードから当該エッジへ進み出すときの進行方位 */
  g.headingOut = (edge, nodeId) => {
    const t = trackById.get(edge.trackId);
    if (nodeId === edge.a) return pointAt(t.points, Math.min(edge.toAt, edge.fromAt + 0.5)).angle;
    return pointAt(t.points, Math.max(edge.fromAt, edge.toAt - 0.5)).angle + Math.PI;
  };
  g.other = (edge, nodeId) => (nodeId === edge.a ? edge.b : edge.a);
  g.trackEdges = trackId => edges.filter(e => e.trackId === trackId);
  g.nodesOfTrack = trackId => {
    const list = attach.get(trackId) || [];
    return [...new Set(list.map(a => a.node))];
  };
  g.endNodesOfTrack = trackId => {
    const list = (attach.get(trackId) || []).slice().sort((a, b) => a.at - b.at);
    return list.length ? [list[0].node, list[list.length - 1].node] : [];
  };
  /** 他の線路とつながっているか */
  g.isConnected = trackId => g.nodesOfTrack(trackId).some(nid =>
    nodeById.get(nid).edges.some(eid => edgeById.get(eid).trackId !== trackId));
  return g;
}

let _cache = { rev: -1, doc: null, graph: null };

/** 版数つきのグラフ取得（変更がなければ再利用） */
export function getGraph(doc, rev) {
  if (_cache.graph && _cache.rev === rev && _cache.doc === doc) return _cache.graph;
  _cache = { rev, doc, graph: buildGraph(doc) };
  return _cache.graph;
}

/**
 * 入換経路の探索（折返し回数を最小化し、次に走行距離を最小化）
 * @param {object} opts {fromTrackId, toTrackId|'__ext__', trainLength, maxTurnDeg, enforceTailFit}
 */
export function findRoute(doc, g, opts) {
  const {
    fromTrackId, toTrackId, trainLength = 0,
    maxTurnDeg = doc.settings.maxTurnDeg ?? DEFAULT_MAX_TURN,
    enforceTailFit = true,
  } = opts;
  const from = g.trackById.get(fromTrackId);
  if (!from) return { found: false, reason: '起点の線路が見つかりません' };
  const toExt = toTrackId === '__ext__';
  if (!toExt && !g.trackById.get(toTrackId)) return { found: false, reason: '着点の線路が見つかりません' };
  if (!toExt && toTrackId === fromTrackId) return { found: false, reason: '起点と着点が同じ線路です' };
  const maxTurn = maxTurnDeg * Math.PI / 180;

  const key = (edgeId, nodeId) => `${edgeId}>${nodeId}`;
  const best = new Map();       // state -> {cost, dist, rev, prev, via}
  const heap = [];              // 単純な配列を優先度つきで使用（規模が小さいため）
  const push = st => { heap.push(st); };
  const pop = () => {
    let bi = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i].cost < heap[bi].cost) bi = i;
    return heap.splice(bi, 1)[0];
  };
  const costOf = (rev, turns, d) => rev * 1e6 + turns * 4e5 + d;

  // 起点: 在線中の線路上のどこからでも、どちら向きにも発車できるものとする
  for (const e of g.trackEdges(fromTrackId)) {
    for (const nid of [e.a, e.b]) {
  const st = { edgeId: e.id, nodeId: nid, rev: 0, turns: 0, dist: 0, cost: 0, prev: null, kind: 'start' };
      const k = key(e.id, nid);
      if (!best.has(k) || best.get(k).cost > st.cost) { best.set(k, st); push(st); }
    }
  }

  const tailIssues = [];
  let goal = null;

  while (heap.length) {
    const cur = pop();
    const k = key(cur.edgeId, cur.nodeId);
    if (best.get(k) !== cur) continue;
    const curEdge = g.edgeById.get(cur.edgeId);

    // 到達判定
    if (cur.kind !== 'start') {
      if (toExt ? g.nodeById.get(cur.nodeId).ext : curEdge.trackId === toTrackId) { goal = cur; break; }
    }

    const node = g.nodeById.get(cur.nodeId);
    const arrive = g.headingOut(curEdge, cur.nodeId) + Math.PI;   // 到着時の進行方位

    for (const eid of node.edges) {
      const e = g.edgeById.get(eid);
      if (eid === cur.edgeId) continue;
      const out = g.headingOut(e, cur.nodeId);
      const viaTable = !!node.turntable;                          // 転車台はどの向きへも転回できる
      if (!viaTable && angleDiff(arrive, out) > maxTurn) continue;// 急すぎる転向は折返しが必要
      const nid = g.other(e, cur.nodeId);
      const turns = cur.turns + (viaTable && angleDiff(arrive, out) > 1e-3 ? 1 : 0);
      const st = {
        edgeId: eid, nodeId: nid, rev: cur.rev, turns, dist: cur.dist + e.len,
        cost: costOf(cur.rev, turns, cur.dist + e.len), prev: cur, kind: 'run',
        turntable: viaTable ? node.turntable : null,
        turntableSize: viaTable ? node.turntableSize : 0,
      };
      const kk = key(eid, nid);
      if (!best.has(kk) || best.get(kk).cost > st.cost) { best.set(kk, st); push(st); }
    }

    // 折返し（いま走ってきた区間に収まる必要がある）
    if (cur.kind !== 'start' || true) {
      const fits = curEdge.len + 1e-6 >= trainLength;
      if (fits || !enforceTailFit) {
        const nid = g.other(curEdge, cur.nodeId);
        const st = {
          edgeId: cur.edgeId, nodeId: nid, rev: cur.rev + 1, turns: cur.turns, dist: cur.dist + curEdge.len,
          cost: costOf(cur.rev + 1, cur.turns, cur.dist + curEdge.len), prev: cur, kind: 'reverse',
          shortTail: !fits,
        };
        const kk = key(cur.edgeId, nid);
        if (!best.has(kk) || best.get(kk).cost > st.cost) { best.set(kk, st); push(st); }
      } else if (trainLength > 0) {
        tailIssues.push({ trackId: curEdge.trackId, len: curEdge.len });
      }
    }
  }

  if (!goal) {
    return {
      found: false,
      reason: '経路が見つかりません',
      tailIssues,
    };
  }

  // 経路の復元
  const chain = [];
  for (let s = goal; s; s = s.prev) chain.unshift(s);
  const path = [];   // {trackId, fromAt, toAt}
  const steps = [];  // 表示用
  const reversePoints = [];
  const shortTails = [];
  const tableIssues = [];
  for (let i = 0; i < chain.length; i++) {
    const s = chain[i];
    const e = g.edgeById.get(s.edgeId);
    const t = g.trackById.get(e.trackId);
    if (s.kind === 'start') continue;
    const forward = s.nodeId === e.b;
    path.push({ trackId: e.trackId, fromAt: forward ? e.fromAt : e.toAt, toAt: forward ? e.toAt : e.fromAt });
    if (s.kind === 'reverse') {
      reversePoints.push({ trackId: e.trackId, at: forward ? e.fromAt : e.toAt });
      steps.push({ type: 'reverse', trackId: e.trackId, name: t.name, len: e.len, short: s.shortTail });
      if (s.shortTail) shortTails.push({ name: t.name, len: e.len });
    } else if (s.turntable) {
      steps.push({ type: 'turntable', name: '転車台で転回', size: s.turntableSize });
      if (s.turntableSize && trainLength > s.turntableSize) {
        tableIssues.push({ size: s.turntableSize });
      }
      steps.push({ type: 'run', trackId: e.trackId, name: t.name, len: e.len });
    } else {
      const last = steps[steps.length - 1];
      if (last && last.type === 'run' && last.trackId === e.trackId) last.len += e.len;
      else steps.push({ type: 'run', trackId: e.trackId, name: t.name, len: e.len });
    }
  }

  // 支障・容量の確認
  const warnings = [];
  for (const ti of tableIssues) {
    warnings.push(`転車台（桁長 ${ti.size}m）に編成長 ${trainLength.toFixed(0)}m は載りません（機関車単体などに限られます）`);
  }
  for (const st of shortTails) {
    warnings.push(`引上げに使う「${st.name}」の有効長が不足しています（区間 ${st.len.toFixed(0)}m ＜ 編成長 ${trainLength.toFixed(0)}m）`);
  }
  const usedTracks = [...new Set(steps.map(s => s.trackId))]
    .filter(id => id && id !== fromTrackId && id !== toTrackId);
  for (const id of usedTracks) {
    const t = g.trackById.get(id);
    if (!t) continue;
    const u = trackUsage(doc, t);
    if (u.list.length) warnings.push(`経由する「${t.name}」に ${u.list.map(f => f.name).join('・')} が留置中です（支障）`);
  }
  if (!toExt) {
    const dest = g.trackById.get(toTrackId);
    const u = trackUsage(doc, dest);
    const addCars = trainLength && doc.settings.carLengthM ? Math.ceil(trainLength / doc.settings.carLengthM) : 0;
    if (addCars && u.cars + addCars > u.capacity) {
      warnings.push(`着点「${dest.name}」の留置可能両数を超えます（${u.cars}+${addCars} ＞ ${u.capacity}両）`);
    }
  }

  return {
    found: true,
    steps, path, warnings, reversePoints,
    distance: goal.dist,
    reversals: goal.rev,
    turntables: goal.turns || 0,
    toExt,
  };
}

/** レイアウトの整合性チェック */
export function validateLayout(doc, g) {
  const issues = [];
  const boundaryNodes = g.nodes.filter(n => n.ext);
  if (!boundaryNodes.length) {
    issues.push({ level: 'warn', message: '場外接続（基地の出入口）の端点が設定されていません。線路のプロパティで端点種別を「場外接続」にしてください。' });
  }

  for (const t of doc.tracks) {
    if (!t.points || t.points.length < 2) continue;
    if (!g.isConnected(t.id)) {
      issues.push({ level: 'error', trackId: t.id, message: `「${t.name}」はどの線路にも接続していません` });
      continue;
    }
    for (const which of ['a', 'b']) {
      const type = endType(t, which);
      if (type !== 'open') continue;
      const nodes = g.endNodesOfTrack(t.id);
      const nid = which === 'a' ? nodes[0] : nodes[nodes.length - 1];
      const node = g.nodeById.get(nid);
      if (!node) continue;
      const connected = node.edges.some(eid => g.edgeById.get(eid).trackId !== t.id);
      if (!connected) {
        issues.push({
          level: 'warn', trackId: t.id,
          message: `「${t.name}」の${which === 'a' ? 'A端（始端）' : 'B端（終端）'}が未処理です（車止め・場外接続を設定するか他線に接続してください）`,
        });
      }
    }
  }

  // 場外から到達できない線路
  if (boundaryNodes.length) {
    const seen = new Set();
    const stack = boundaryNodes.map(n => n.id);
    const seenNodes = new Set(stack);
    while (stack.length) {
      const nid = stack.pop();
      for (const eid of g.nodeById.get(nid).edges) {
        const e = g.edgeById.get(eid);
        seen.add(e.trackId);
        const o = g.other(e, nid);
        if (!seenNodes.has(o)) { seenNodes.add(o); stack.push(o); }
      }
    }
    for (const t of doc.tracks) {
      if (!t.points || t.points.length < 2) continue;
      if (!seen.has(t.id) && g.isConnected(t.id)) {
        issues.push({ level: 'warn', trackId: t.id, message: `「${t.name}」は場外（出入口）から線路がつながっていません` });
      }
    }
  }

  // 容量超過
  for (const t of doc.tracks) {
    const u = trackUsage(doc, t);
    if (u.over) issues.push({ level: 'error', trackId: t.id, message: `「${t.name}」は留置両数が有効長を超えています（${u.cars}/${u.capacity}両）` });
  }
  return issues;
}

/* ---------------- 分岐器の自動生成 ---------------- */

/**
 * 接続点に置くべき分岐器の仕様を求める。
 * 通過方向（最も直線に近い2方向）を基準線とし、分かれていく側へ開くように向きを決める。
 * @returns {null|{variant,rot,mirror,x,y,branches}}
 */
export function turnoutSpecAt(doc, g, nodeId) {
  const node = g.nodeById.get(nodeId);
  if (!node || node.turntable) return null;   // 転車台は分岐器ではない
  const list = node.edges.map(eid => {
    const e = g.edgeById.get(eid);
    return { e, ang: g.headingOut(e, nodeId) };
  });
  const tracks = new Set(list.map(x => x.e.trackId));
  if (list.length < 3 || tracks.size < 2) return null;   // 単なる継目は分岐器ではない

  // 最も向かい合う2方向 = 基準線
  let pair = [0, 1], bestScore = Infinity;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const score = Math.abs(Math.PI - angleDiff(list[i].ang, list[j].ang));
      if (score < bestScore) { bestScore = score; pair = [i, j]; }
    }
  }
  const branches = list.filter((_, i) => i !== pair[0] && i !== pair[1]);
  if (!branches.length) return null;
  const div = branches[0];

  // 分岐が出ていく側の基準方向を採る
  const cand = [list[pair[0]], list[pair[1]]];
  let base = cand[0];
  if (Math.cos(div.ang - cand[1].ang) > Math.cos(div.ang - cand[0].ang)) base = cand[1];

  const delta = norm(div.ang - base.ang);
  const variant = list.length >= 4 ? 'scissors' : (branches.length >= 2 ? 'three' : 'single');
  return {
    variant, rot: base.ang, mirror: delta > 0,
    x: node.x, y: node.y, branches: branches.length, nodeId,
  };
}

/** 接続点（2線以上が集まる点）の一覧 */
export function junctionNodes(g) {
  return g.nodes.filter(n => new Set(n.edges.map(eid => g.edgeById.get(eid).trackId)).size > 1);
}

/** 編成が使う長さ（留置編成が指定されていればその長さ） */
export function trainLengthOf(doc, formationId) {
  const f = doc.formations.find(x => x.id === formationId);
  return f ? formationLength(doc, f) : 0;
}

export { trackCapacity, trackKind };
