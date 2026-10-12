# 配線略図の帯から、サンプル路線ごとの配線データ（帯座標）を書き出す
import sys, json, math, re, os
sys.path.insert(0, '/tmp/claude-0/hs')
from strip import *
import strip as _strip
TRACE_TARGET = _strip.TRACE_TARGET

def images_for(page, names):
    ims = page_images(page)
    want = [norm_name(n) for n in names]
    want = want + [norm_name(re.sub(r'[（(].*?[）)]$', '', n)) for n in names]
    idx = [i for i, (k, t) in enumerate(ims) if any(w + '駅' in norm_name(t) or w in norm_name(t).split('_')[-1] for w in want)]
    if not idx: return []
    return [k for k, t in ims[min(idx):max(idx) + 1]]

def plain_mask(S, main_ids, n_mains, x0, x1, step=1.0):
    """x ごとに「分岐も斜めの線もない（線が平行に通るだけ）」か"""
    xs = []
    x = x0
    while x <= x1:
        ok = True
        cnt = 0
        for e in S.edges:
            pts = e['pts']
            for k in range(1, len(pts)):
                a, b = pts[k - 1], pts[k]
                if min(a[0], b[0]) - 0.5 <= x <= max(a[0], b[0]) + 0.5:
                    if abs(b[0] - a[0]) < 1e-6 or abs(b[1] - a[1]) / abs(b[0] - a[0]) > 0.08:
                        ok = False
                    elif not (min(a[0], b[0]) + 0.5 < x < max(a[0], b[0]) - 0.5):
                        # 線の端の近く：分岐点・終端なら平坦でない（ただの継ぎ目は平坦）
                        for q in (a, b):
                            if abs(q[0] - x) <= 0.5:
                                n = min(range(len(S.nodes)), key=lambda i: seglen(S.nodes[i], q))
                                if seglen(S.nodes[n], q) < 0.5 and len(S.adj[n]) != 2: ok = False
                    cnt += 1
                    break
            if not ok: break
        xs.append((x, ok and cnt >= 1))
        x += step
    return xs

def intervals(mask, val):
    out = []
    for x, ok in mask:
        if ok == val:
            if out and abs(out[-1][1] - (x - 1.0)) < 1.01: out[-1][1] = x
            else: out.append([x, x])
    return out

def clip_poly(pts, x0, x1):
    """x0〜x1 の範囲に切り詰めた折れ線の断片の並び [(点列, 始点が切れたか, 終点が切れたか)]"""
    def inside(p): return x0 - 1e-6 <= p[0] <= x1 + 1e-6
    def cut(a, b, xx):
        u = (xx - a[0]) / (b[0] - a[0])
        return (xx, a[1] + (b[1] - a[1]) * u)
    out = []
    cur, cur_cut = ([pts[0]], False) if inside(pts[0]) else (None, False)
    for k in range(1, len(pts)):
        a, p = pts[k - 1], pts[k]
        if cur is not None:
            if inside(p): cur.append(p); continue
            xx = x1 if p[0] > x1 else x0
            cur.append(cut(a, p, xx)); out.append((cur, cur_cut, True)); cur = None
        else:
            if inside(p):
                xx = x0 if a[0] < x0 else x1
                cur, cur_cut = [cut(a, p, xx), p], True
            elif (a[0] - x0) * (p[0] - x0) < 0 and (a[0] - x1) * (p[0] - x1) < 0:
                q0, q1 = cut(a, p, x0), cut(a, p, x1)
                if a[0] > p[0]: q0, q1 = q1, q0
                out.append(([q0, q1], True, True))
    if cur is not None: out.append((cur, cur_cut, False))
    return [(q, sa, sb) for q, sa, sb in out if len(q) >= 2 and plen(q) > 0.3]

def compute_crossings(out_mains, tracks):
    """接続点のない交わり：ダイヤモンドクロッシングか立体交差か（破線＝下をくぐる線）"""
    polys = [(('m', k), m['pts'], m['under']) for k, m in enumerate(out_mains)] + \
            [(('t', k), t['pts'], t['under']) for k, t in enumerate(tracks)]
    crossings = []
    def seg_x(a, b, c, d):
        r = (b[0] - a[0], b[1] - a[1]); s_ = (d[0] - c[0], d[1] - c[1])
        den = r[0] * s_[1] - r[1] * s_[0]
        if abs(den) < 1e-9: return None
        t = ((c[0] - a[0]) * s_[1] - (c[1] - a[1]) * s_[0]) / den
        u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
        if 0.02 < t < 0.98 and 0.02 < u < 0.98: return (a[0] + r[0] * t, a[1] + r[1] * t)
        return None
    def under_at(u, x, pts):
        if isinstance(u, bool): return u
        return any(a <= x <= b for a, b in u)
    for i in range(len(polys)):
        for j in range(i + 1, len(polys)):
            (ki, pi, ui), (kj, pj, uj) = polys[i], polys[j]
            if max(p[0] for p in pi) < min(p[0] for p in pj) or max(p[0] for p in pj) < min(p[0] for p in pi): continue
            for a in range(1, len(pi)):
                for b in range(1, len(pj)):
                    x = seg_x(pi[a - 1], pi[a], pj[b - 1], pj[b])
                    if not x: continue
                    if any(seglen(x, nn) < 1.0 for nn in (pi[0], pi[-1], pj[0], pj[-1])): continue
                    ua, ub = under_at(ui, x[0], pi), under_at(uj, x[0], pj)
                    crossings.append(dict(x=round(x[0], 2), y=round(x[1], 2), a=list(ki), b=list(kj),
                                          grade=bool(ua or ub), aUnder=bool(ua), bUnder=bool(ub)))
    return crossings

def yAt_py(pts, x):
    for k in range(1, len(pts)):
        a, b = pts[k - 1], pts[k]
        if min(a[0], b[0]) - 1e-6 <= x <= max(a[0], b[0]) + 1e-6 and abs(b[0] - a[0]) > 1e-9:
            return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
    return None

def in_bldg(S, p, m=1.5):
    """端点が建屋（車庫）の中か縁にある：建屋の中で終わる線"""
    return any(b[0] - m <= p[0] <= b[2] + m and b[1] - m <= p[1] <= b[3] + m and (b[2] - b[0]) > 6 for b in S.bldgs)

def paths_cross(S, pa, pb):
    """2本の本線（辺の列）が、共有する節点以外のところで交わるか"""
    def segs(p):
        out = []
        for x in p:
            q = S.edges[x]['pts']
            out += list(zip(q, q[1:]))
        return out
    A, B = segs(pa), segs(pb)
    def inter(s, t):
        (x1, y1), (x2, y2) = s; (x3, y3), (x4, y4) = t
        d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
        if abs(d) < 1e-9: return False
        u = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
        v = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
        return 0.02 < u < 0.98 and 0.02 < v < 0.98
    for s in A:
        sx0, sx1 = sorted((s[0][0], s[1][0]))
        for t in B:
            if max(t[0][0], t[1][0]) < sx0 or min(t[0][0], t[1][0]) > sx1: continue
            if inter(s, t): return True
    return False

def export_part(page, names, n_mains=2, first_complex=True, last_complex=True, seed=None, prefer=(1, -1), pick=None, seed_between=None, keys=None, flip=(), extra_names=(), color=None):
    keys = keys or images_for(page, names)
    if not keys: raise RuntimeError(f'{page}: {names[0]}〜{names[-1]} の画像がありません')
    S0 = Strip(*assemble(keys, flip=flip))
    lab = station_labels(S0, names)
    rot = False
    if names[0] in lab and names[-1] in lab and lab[names[0]][0][0] > lab[names[-1]][0][0]:
        rot = True
    S = Strip(*assemble(keys, rot=rot, flip=flip)) if rot else S0
    lab = station_labels(S, names)
    missing = [n for n in names if n not in lab]
    # 本線をたどる：最初の2駅の間（なければ seed）で本線の本数だけ線が通る位置
    xs = sorted(x for n in names if n in lab for x, _ in lab[n][:1])
    mains = []
    tries = []
    if seed is not None: tries.append(seed)
    for i in range(len(names) - 1):
        a, b = names[i], names[i + 1]
        if a in lab and b in lab:
            xa, xb = lab[a][0][0], lab[b][0][0]
            for f in (0.5, 0.35, 0.65, 0.2, 0.8):
                tries.append(xa + (xb - xa) * f)
    if seed_between:
        a, b, f = seed_between
        xa, xb = lab[a][0][0], lab[b][0][0]
        tries.insert(0, xa + (xb - xa) * f)
    ce = None
    _strip.TRACE_COLOR['c'] = color.lower() if color else None
    for x in tries:
        c = crossing_edges(S, x)
        if color: c = [ye for ye in c if S.edges[ye[1]]['color'].lower() == color.lower()]
        if pick is not None:
            if len(c) > max(pick): ce = [c[i] for i in pick]; break
        elif len(c) == n_mains: ce = c; break
    if ce is None: raise RuntimeError(f'{page}: 本線の本数 {n_mains} の位置が見つかりません')
    xs_lab = [lab[n][0][0] for n in names if n in lab]
    TRACE_TARGET['lo'] = min(xs_lab) if xs_lab else None
    TRACE_TARGET['hi'] = max(xs_lab) if xs_lab else None
    paths = []
    for k, (y, eid) in enumerate(ce):
        pref = prefer[k] if k < len(prefer) else 0
        path, l, r = trace_both(S, eid, pref)
        # ほかの本線と同じ線路をたどってしまった部分は切る（合流した先は相手の本線）
        used = set(e for p in paths for e in p)
        def cut(p):
            # 始めの辺から、ほかの本線の線に入る手前まで
            i0 = p.index(eid)
            a = i0
            while a > 0 and p[a - 1] not in used: a -= 1
            b = i0
            while b < len(p) - 1 and p[b + 1] not in used: b += 1
            return p[a:b + 1]
        span = lambda p: max(q[0] for x in p for q in S.edges[x]['pts']) - min(q[0] for x in p for q in S.edges[x]['pts'])
        if any(e in used for e in path):
            # ほかの本線の線を避けてたどり直し（渡り線で隣の線へ移らずに続く線）、長く続くほうを使う
            p2, l2, r2 = trace_both(S, eid, pref, frozenset(used))
            if os.environ.get('DEBUG_TRACE'):
                print('  retrace', k, S.nodes[l], S.nodes[r], '->', S.nodes[l2], S.nodes[r2], any(e in used for e in p2))
                for x in p2:
                    if x in used: print('    used', x, S.edges[x]['pts'][0], S.edges[x]['pts'][-1])
                    xs = [q[0] for q in S.edges[x]['pts']]
                    if os.environ.get('DBG_X0') and float(os.environ['DBG_X0']) <= min(xs) <= float(os.environ['DBG_X1']):
                        print('    p2', x, [tuple(round(v,1) for v in q) for q in S.edges[x]['pts']], 'used' if x in used else '')
            path = cut(path)
            p2 = cut(p2)
            # たどり直した線が、ほかの本線と交差する（立体交差・平面交差で向こう側へ渡る）なら使わない
            if span(p2) > span(path) and not any(paths_cross(S, p2, q) for q in paths): path = p2
        if os.environ.get('DEBUG_TRACE'):
            for nn in (l, r):
                print('  main', k, 'end node', nn, S.nodes[nn], 'adj', [(x, [round(v,1) for v in S.edges[x]['pts'][0]], [round(v,1) for v in S.edges[x]['pts'][-1]]) for x in S.adj[nn]])
                for x in S.adj[nn]:
                    if x in path: print('     from', x, 'cands', forward_cands(S, x, nn))
        paths.append(path)
    # 2本の本線が途中で同じ線に入ってしまうとき（先にたどった本線が渡り線で隣の線へ移ったとき）は、
    # 互いに相手の線を避けてたどり直し、両方が長く続く組み合わせにする
    if len(paths) == 2:
        def cut2(p, eid, used):
            if eid not in p or eid in used: return p
            i0 = p.index(eid); a = i0
            while a > 0 and p[a - 1] not in used: a -= 1
            b = i0
            while b < len(p) - 1 and p[b + 1] not in used: b += 1
            return p[a:b + 1]
        sp = lambda p: max(q[0] for x in p for q in S.edges[x]['pts']) - min(q[0] for x in p for q in S.edges[x]['pts'])
        best = (sp(paths[0]) + sp(paths[1]), list(paths))
        prf = lambda k: prefer[k] if k < len(prefer) else 0
        raw = [trace_both(S, ce[0][1], prf(0))[0], None]
        raw[1] = trace_both(S, ce[1][1], prf(1), frozenset(raw[0]))[0]
        for it in range(4):
            shared = set(raw[0]) & set(raw[1])
            c0 = cut2(raw[0], ce[0][1], set(raw[1]) if it % 2 else shared - set(raw[0]))
            c1 = cut2(raw[1], ce[1][1], set(raw[0]))
            if it % 2 == 0: c0 = cut2(raw[0], ce[0][1], set(c1))
            tot = sp(c0) + sp(c1)
            if paths_cross(S, c0, c1): tot = -1
            if os.environ.get('DEBUG_TRACE'): print('  alt', it, round(sp(c0)), round(sp(c1)), len(shared))
            if tot > best[0] + 1: best = (tot, [c0, c1])
            if not shared: break
            k = it % 2
            raw[k] = trace_both(S, ce[k][1], prf(k), frozenset(set(raw[1 - k]) - shared))[0]
        paths = best[1]
    main_ids = set(e for p in paths for e in p)
    main_pts = [ordered_path(S, p) for p in paths]
    allx = [p[0] for e in S.edges for p in e['pts']]
    X0, X1 = min(allx), max(allx)
    mask = plain_mask(S, main_ids, n_mains, X0, X1)
    plains = [p for p in intervals(mask, True) if p[1] - p[0] >= 12]
    # 駅ごとのホーム
    # ホームは、サンプルにない駅も含めていちばん近い駅名のもの（サンプルの駅のものだけ使う）
    alll = all_labels(S)
    want = {}
    for n in names:
        want[norm_name(n)] = n
        base = re.sub(r'[（(].*?[）)]$', '', n)
        if base != n: want.setdefault(norm_name(base), n)
    plat_of = defaultdict(list)
    for b in S.plats:
        cx = (b[0] + b[2]) / 2
        if not alll: continue
        d, nm = min((abs(x - cx), nm) for x, nm in alll)
        if nm in want and want[nm] in lab and d < 120: plat_of[want[nm]].append(b)
    # 駅の範囲：ホームとラベルを含む、本線だけでない区間
    # 駅と駅の間の「区切り」：その駅間で線の本数がいちばん少ない、分岐のない区間
    cnt_at = lambda x: len(crossing_edges(S, x))
    plains_c = [(a, b, cnt_at((a + b) / 2)) for a, b in plains]
    seps = []
    order = [n for n in names if n in lab]
    for i in range(len(order) - 1):
        xa, xb = lab[order[i]][0][0], lab[order[i + 1]][0][0]
        inside = [(a, b, c) for a, b, c in plains_c if b > xa and a < xb]
        if inside:
            m = min(c for a, b, c in inside)
            cand = [(max(a, xa), min(b, xb)) for a, b, c in inside if c == m]
            # いちばん長い区間（間にサンプルにない駅があっても、その駅は縮めない）
            seps.append(max(cand, key=lambda ab: ab[1] - ab[0]))
        else:
            mid = (xa + xb) / 2; seps.append((mid, mid))
    sep_of = {}
    for i, n in enumerate(order):
        left = seps[i - 1][1] if i > 0 else None
        right = seps[i][0] if i < len(seps) else None
        sep_of[n] = (left, right)
    def extent(n):
        left, right = sep_of[n]
        xs_ = [lab[n][0][0]] + [v for b in plat_of[n] for v in (b[0], b[2])]
        lo, hi = min(xs_) - 3, max(xs_) + 3
        # 路線の端の駅：図の中で隣にある駅（サンプルにない駅も）との区切りまで。隣が無ければ図の端まで
        def sep_between(xa, xb):
            inside = [(a, b, c) for a, b, c in plains_c if b > xa and a < xb]
            if not inside: return None
            m = min(c for a, b, c in inside)
            cand = [(max(a, xa), min(b, xb)) for a, b, c in inside if c == m]
            return max(cand, key=lambda ab: ab[1] - ab[0])
        x_me = lab[n][0][0]
        if left is None:
            prev = [x for x, nm in alll if x < x_me - 5]
            sp = sep_between(max(prev), x_me) if prev else None
            left = sp[1] if sp else X0
        if right is None:
            nxt = [x for x, nm in alll if x > x_me + 5]
            sp = sep_between(x_me, min(nxt)) if nxt else None
            right = sp[0] if sp else X1
        return min(left, lo), max(right, hi)
    e_first = extent(names[0]) if names[0] in lab else (X0, X0)
    e_last = extent(names[-1]) if names[-1] in lab else (X1, X1)
    cx0 = e_first[0] - 2 if first_complex else e_first[1] + 2
    cx1 = e_last[1] + 2 if last_complex else e_last[0] - 2
    if not first_complex and cx0 > X1: cx0 = X0
    # ---- 線路を書き出す ----
    R = lambda pts: [[round(x, 2), round(y, 2)] for x, y in pts]
    out_mains = []
    for k, (path, pts) in enumerate(zip(paths, main_pts)):
        pcs = clip_poly(pts, cx0, cx1)
        if not pcs: raise RuntimeError(f'{page}: 本線が切り出し範囲にありません')
        pcs.sort(key=lambda p: -plen(p[0]))
        q, sa, sb = pcs[0]
        # 破線（立体交差の下）の x 範囲
        under = []
        for eid in path:
            e = S.edges[eid]
            if e['dashed']:
                xs_ = [p[0] for p in e['pts']]
                under.append([round(min(xs_), 2), round(max(xs_), 2)])
        # 端：切り出しで切れた側は境界、そうでなければ車止めかどうか
        ends = []
        for w, cutflag in ((0, sa), (-1, sb)):
            if cutflag: ends.append('boundary'); continue
            p0 = q[w]; q1 = q[1] if w == 0 else q[-2]
            ends.append('buffer' if has_buffer(p0, math.atan2(p0[1] - q1[1], p0[0] - q1[0]), S.thin) or in_bldg(S, p0) else 'boundary')
        out_mains.append(dict(pts=R(q), under=under, ends=ends))
    # 上下2本の本線の切り口が同じ点（渡り線の交点など）に重なったら、2本が離れたところまで切り詰める
    if len(out_mains) == 2:
        def ys_at(x):
            return [yAt_py(m['pts'], x) for m in out_mains]
        for side in (0, -1):
            a, b = out_mains[0]['pts'][side], out_mains[1]['pts'][side]
            if seglen(a, b) >= 3: continue
            x = a[0]
            step = 1 if side == 0 else -1
            for _ in range(200):
                x += step
                ya, yb = ys_at(x)
                if ya is None or yb is None: break
                if abs(ya - yb) >= 6:
                    for m in out_mains:
                        pcs = clip_poly(m['pts'], x, 1e9) if side == 0 else clip_poly(m['pts'], -1e9, x)
                        if pcs:
                            pcs.sort(key=lambda p: -plen(p[0]))
                            m['pts'] = R(pcs[0][0])
                    break
    # 路線の両端の駅より先の本線（車両基地や他線へ続く部分）は、本線から外して普通の線路にする
    tails = []
    def plat_range(n):
        bs = plat_of.get(n) or []
        if not bs: return None
        return min(b[0] for b in bs), max(b[2] for b in bs)
    lo_cut = hi_cut = None
    if first_complex and names[0] in lab and plat_range(names[0]): lo_cut = plat_range(names[0])[0] - 15
    if names[-1] in lab and plat_range(names[-1]): hi_cut = plat_range(names[-1])[1] + 15
    for m in out_mains:
        pts = m['pts']
        if hi_cut is not None and pts[-1][0] > hi_cut + 1:
            for q, sa, sb in clip_poly(pts, hi_cut, max(p[0] for p in pts) + 1):
                tails.append(dict(pts=R(q), ends=['open', m['ends'][1]], under=False, stations=[], use=None, foreign=True, tail=True))
                break
            keep = clip_poly(pts, min(p[0] for p in pts) - 1, hi_cut)
            if keep: pts = keep[0][0]; m['ends'][1] = 'open'
        if lo_cut is not None and pts[0][0] < lo_cut - 1:
            for q, sa, sb in clip_poly(pts, min(p[0] for p in pts) - 1, lo_cut):
                tails.append(dict(pts=R(q), ends=[m['ends'][0], 'open'], under=False, stations=[], use=None, foreign=True, tail=True))
                break
            keep = clip_poly(pts, lo_cut, max(p[0] for p in pts) + 1)
            if keep: pts = keep[-1][0]; m['ends'][0] = 'open'
        m['pts'] = R(pts)
    ch = chains(S, main_ids)
    main_of_edge = {}
    for k, path in enumerate(paths):
        for eid in path: main_of_edge[eid] = k
    def reach_mains(c, lo, hi):
        """副本線などから、駅の範囲の中で分岐をたどって行ける本線（番号の集合）"""
        found = set()
        seen_n = set()
        stack = [c['na'], c['nb']]
        own = set(c['edges'])
        while stack:
            n = stack.pop()
            if n in seen_n: continue
            seen_n.add(n)
            for eid in S.adj[n]:
                if eid in main_of_edge: found.add(main_of_edge[eid]); continue
                if eid in own: continue
                e = S.edges[eid]
                xs_ = [p[0] for p in e['pts']]
                if max(xs_) < lo or min(xs_) > hi: continue
                stack.append(S.other(eid, n))
        return found
    def side_dist(pts, b, side):
        """折れ線とホーム b の上辺(side=-1)・下辺(+1)との距離（ホームの長さの半分以上沿っている部分）"""
        best = None
        L = 0.0
        edge_y = b[1] if side < 0 else b[3]
        for k in range(1, len(pts)):
            a_, c_ = pts[k - 1], pts[k]
            if abs(c_[1] - a_[1]) > max(0.3, 0.012 * abs(c_[0] - a_[0])): continue
            xm = min(max((b[0] + b[2]) / 2, min(a_[0], c_[0])), max(a_[0], c_[0]))
            ym = a_[1] if abs(c_[0] - a_[0]) < 1e-9 else a_[1] + (c_[1] - a_[1]) * (xm - a_[0]) / (c_[0] - a_[0])
            d = (edge_y - ym) if side < 0 else (ym - edge_y)
            if d < -0.5 or d > 11: continue
            x0_, x1_ = max(min(a_[0], c_[0]), b[0]), min(max(a_[0], c_[0]), b[2])
            if x1_ > x0_:
                L += x1_ - x0_
                best = d if best is None else min(best, d)
        return best if L >= (b[2] - b[0]) * 0.5 else None
    # ホームの上辺・下辺それぞれに、いちばん近い線路を割り当てる
    all_polys = [('m', k, pts) for k, pts in enumerate(main_pts)] + [('c', k, c['pts']) for k, c in enumerate(ch)]
    plat_tracks = defaultdict(set)      # 駅名 → {('m',k) / ('c',k)}
    for n in lab:
        for b in plat_of[n]:
            for side in (-1, 1):
                cands = [(side_dist(pts, b, side), kind, k) for kind, k, pts in all_polys]
                cands = [c for c in cands if c[0] is not None]
                if cands:
                    d, kind, k = min(cands)
                    plat_tracks[n].add((kind, k))
    stn_ext = {n: extent(n) for n in lab}
    # 切り出し範囲の中で本線とつながっている線だけを残す（並行する他社線の重複を除く）
    reached = set(main_ids)
    seen_n = set()
    stack = [n for eid in main_ids for n in (S.edges[eid]['a'], S.edges[eid]['b'])]
    while stack:
        n = stack.pop()
        if n in seen_n: continue
        seen_n.add(n)
        if not (cx0 - 1 <= S.nodes[n][0] <= cx1 + 1): continue
        for eid in S.adj[n]:
            reached.add(eid)
            stack.append(S.other(eid, n))
    tracks = []
    for c in ch:
        if not any(e in reached for e in c['edges']): continue
        mid_x = sum(p[0] for p in c['pts']) / len(c['pts'])
        # どの駅の番線か
        ci = ch.index(c)
        sts = [n for n in names if n in lab and ('c', ci) in plat_tracks[n]]
        st = sts[0] if sts else None
        near_st = st or min(lab, key=lambda n: abs(lab[n][0][0] - mid_x)) if lab else None
        lo, hi = stn_ext.get(near_st, (mid_x - 80, mid_x + 80))
        reach = reach_mains(c, lo - 5, hi + 5)
        # 両端で直接取り付く本線（他社線のホーム線などは本線に直接つながらない）
        direct = set()
        for n in (c['na'], c['nb']):
            for eid in S.adj[n]:
                if eid in main_of_edge: direct.add(main_of_edge[eid])
        use = None
        if len(paths) >= 2 and direct == {0}: use = 'down'
        elif len(paths) >= 2 and direct == {1}: use = 'up'
        elif len(paths) >= 2 and not direct and reach == {0}: use = 'down'
        elif len(paths) >= 2 and not direct and reach == {1}: use = 'up'
        dashed = all(S.edges[x]['dashed'] for x in c['edges'])
        for pts, sa, sb in clip_poly(c['pts'], cx0, cx1):
            ends = []
            for w, cutflag in ((0, sa), (-1, sb)):
                p0 = pts[w]
                if cutflag: ends.append('boundary'); continue
                n = c['na'] if w == 0 else c['nb']
                if len(S.adj[n]) > 1: ends.append('open'); continue
                q1 = pts[1] if w == 0 else pts[-2]
                ends.append('buffer' if has_buffer(p0, math.atan2(p0[1] - q1[1], p0[0] - q1[0]), S.thin) or in_bldg(S, p0) else 'boundary')
            tracks.append(dict(pts=R(pts), ends=ends, under=dashed, stations=[n for n in sts if any(b[2] >= min(p[0] for p in pts) and b[0] <= max(p[0] for p in pts) for b in plat_of[n])], use=use,
                               foreign=not direct,
                               reach=sorted(reach)))
    tracks += tails
    # 駅ごとの、ホームに面した本線
    main_plat = {}
    for n in lab:
        main_plat[n] = sorted(k for kind, k in plat_tracks[n] if kind == 'm')
    stations = []
    for n in names:
        if n not in lab: stations.append(dict(name=n, x=None)); continue
        stations.append(dict(name=n, x=round(lab[n][0][0], 2), plats=[[round(v, 2) for v in b] for b in plat_of[n]],
                             ext=[round(v, 2) for v in extent(n)], mainPlat=main_plat[n]))
    inr = lambda b: b[2] >= cx0 and b[0] <= cx1
    texts = [dict(s=t['s'], x=round(t['x'], 1), x1=round(t['x1'], 1), y=round(t['y'], 1), size=round(t['size'], 1)) for t in S.texts
             if (cx0 <= t['x'] <= cx1 or (t['s'].strip().endswith('方') and t['x1'] >= cx0 - 40 and t['x'] <= cx1 + 40))   # 図の端の外に書いた行先も
             and not is_station_label(t)]
    # この路線にない駅（並行する他線だけが止まる駅）：位置とホーム、ホームに面した線
    extra = {}
    if extra_names:
        elab = station_labels(S, list(extra_names))
        for n in extra_names:
            if n not in elab: continue
            x = elab[n][0][0]
            if not (cx0 <= x <= cx1): continue
            bs = [b for b in S.plats if alll and min((abs(xx - (b[0] + b[2]) / 2), nm) for xx, nm in alll)[1] == norm_name(n)
                  and abs((b[0] + b[2]) / 2 - x) < 120]
            extra[n] = dict(x=round(x, 2), plats=[[round(v, 2) for v in b] for b in bs])
            for t in tracks:
                for b in bs:
                    if any(side_dist(t['pts'], b, sd) is not None and side_dist(t['pts'], b, sd) < 8 for sd in (-1, 1)):
                        if n not in t['stations']: t['stations'].append(n)
                        break
    # 転車台：重なって描かれた同じものを1つにし、台を通り抜ける線は台の縁で切る（台に放射状に集まる線にする）
    tts = []
    for t in S.tts:
        if cx0 <= t['x'] <= cx1 and t['r'] > 2 and not any(seglen((t['x'], t['y']), (u['x'], u['y'])) < 1 for u in tts): tts.append(t)
    def cut_circle(pts, c, r):
        def inside(p): return seglen(p, c) < r - 1e-6
        pieces, cur = [], []
        for k in range(len(pts)):
            p = pts[k]
            if k == 0:
                if not inside(p): cur = [p]
                continue
            a = pts[k - 1]
            dx, dy = p[0] - a[0], p[1] - a[1]
            fx, fy = a[0] - c[0], a[1] - c[1]
            A = dx * dx + dy * dy; Bq = 2 * (fx * dx + fy * dy); C = fx * fx + fy * fy - r * r
            disc = Bq * Bq - 4 * A * C
            ts = []
            if A > 1e-12 and disc > 0:
                sq = math.sqrt(disc)
                ts = sorted(x for x in ((-Bq - sq) / (2 * A), (-Bq + sq) / (2 * A)) if 0 < x < 1)
            for x in ts:
                q = (a[0] + dx * x, a[1] + dy * x)
                if cur:
                    cur.append(q); pieces.append(cur); cur = []
                else:
                    cur = [q]
            if not inside(p): cur.append(p)
        if cur: pieces.append(cur)
        return [pc for pc in pieces if len(pc) >= 2 and sum(seglen(pc[i - 1], pc[i]) for i in range(1, len(pc))) > 0.5]
    for tt in tts:
        c, r = (tt['x'], tt['y']), tt['r']
        new = []
        for t in tracks:
            if min(seglen(p, c) for p in t['pts']) > r + 30 or not any(seglen(p, c) < r for p in t['pts']) and all(
                    dist_seg(c, t['pts'][k - 1], t['pts'][k])[0] >= r for k in range(1, len(t['pts']))):
                new.append(t); continue
            pcs = cut_circle([tuple(p) for p in t['pts']], c, r)
            for pc in pcs:
                e0 = t['ends'][0] if seglen(pc[0], t['pts'][0]) < 0.01 else 'open'
                e1 = t['ends'][1] if seglen(pc[-1], t['pts'][-1]) < 0.01 else 'open'
                nt = dict(t); nt['pts'] = R(pc); nt['ends'] = [e0, e1]
                new.append(nt)
        tracks = new
    crossings = compute_crossings(out_mains, tracks)
    # 車両基地の名前（ラベル）
    DEPOT = re.compile(r'(検車区|車両基地|車両センター|電車区|車両所|工場|検修区|車庫|運転所|車両区|基地|留置線|検修庫|研究所)')
    depots = [dict(s=t['s'], x=t['x'], x1=t['x1'], y=t['y']) for t in texts if DEPOT.search(t['s'])]
    return dict(page=page, rot=rot, keys=keys, missing=missing, x0=round(cx0, 2), x1=round(cx1, 2),
                mains=out_mains, tracks=tracks, stations=stations,
                bldgs=[[round(v, 2) for v in b] for b in S.bldgs if inr(b)],
                tts=[dict(x=round(t['x'], 2), y=round(t['y'], 2), r=round(t['r'], 2)) for t in tts],
                texts=texts, depots=depots, crossings=crossings, extra=extra,
                plains=[[round(a, 1), round(b, 1)] for a, b in plains if b >= cx0 and a <= cx1])

if __name__ == '__main__':
    names = '渋谷 代官山 中目黒 祐天寺 学芸大学 都立大学 自由が丘 田園調布 多摩川 新丸子 武蔵小杉 元住吉 日吉 綱島 大倉山 菊名 妙蓮寺 白楽 東白楽 反町 横浜'.split()
    part = export_part('pr/tokyu/toyoko', names)
    print(part['missing'], len(part['tracks']), part['x0'], part['x1'])
    for s in part['stations']: print(s['name'], s['x'], len(s.get('plats', [])), s.get('ext'))
    json.dump(part, open('/tmp/claude-0/hs/out_toyoko.json', 'w'), ensure_ascii=False)
