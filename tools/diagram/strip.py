# 配線略図の画像を路線ごとに1本の帯（strip）につなぎ、線路のグラフを作る
import json, math, re
from collections import defaultdict

P = json.load(open('/tmp/claude-0/hs/parsed.json'))
FIGS = [l.split('\t') for l in open('/tmp/claude-0/hs/figs.tsv').read().strip().split('\n')]
TOL = 0.9

def norm_name(s):
    s = s.replace('ヶ', 'ケ').replace('ｹ', 'ケ').replace('箪', '簞').replace('（', '(').replace('）', ')')
    return re.sub(r'\s', '', s)

def page_images(page):
    out = []
    for p, fn, title in FIGS:
        if p != page: continue
        key = p.replace('/', '_') + '__' + fn
        if key in P: out.append((key, title))
    return out

def seglen(a, b): return math.hypot(b[0] - a[0], b[1] - a[1])

def plen(pts): return sum(seglen(pts[i - 1], pts[i]) for i in range(1, len(pts)))

def dist_seg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    t = 0 if l2 < 1e-12 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    q = (a[0] + dx * t, a[1] + dy * t)
    return seglen(p, q), t

def is_station_label(t):
    s = t['s']
    return t['size'] >= 13 and re.search(r'[぀-ヿ一-鿿]', s) and not s.endswith('方') and len(s) <= 14

class Img:
    """1枚の画像の要素（座標は変換済み）"""
    def __init__(self, key, dx=0.0, dy=0.0, rot=False):
        d = P[key]
        self.key, self.w, self.h = key, d['w'], d['h']
        W, H = d['w'], d['h']
        def tf(x, y):
            if rot: x, y = W - x, H - y
            return (x + dx, y + dy)
        def tb(b):
            x0, y0 = tf(b[0], b[1]); x1, y1 = tf(b[2], b[3])
            return [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]
        self.tracks = [{'pts': [tf(*p) for p in t['pts']], 'dashed': t.get('dashed', False), 'color': t['color'], 'img': key} for t in d['tracks']]
        self.thin = [[tf(*p) for p in t['pts']] for t in d['thin']]
        self.plats = [tb(p['box']) for p in d['plats']]
        self.bldgs = [tb(b['box']) + list(b.get('rot', [])) for b in d['bldgs']]   # 斜めの建屋は [x0, y0, x1, y1, 向き, 幅, 奥行き]
        self.tts = [dict(x=tf(t['x'], t['y'])[0], y=tf(t['x'], t['y'])[1], r=t['r']) for t in d['tts']]
        self.texts = []
        for t in d['texts']:
            x0, y0 = tf(t['x'], t['y']); x1, _ = tf(t['x1'], t['y'])
            self.texts.append(dict(s=t['s'], x=min(x0, x1), x1=max(x0, x1), y=y0, size=t['size']))
        self.drop_legend_boxes()
        self.fix_platform_outlines()
        self.merge_platforms()
        # 線路の続きを示す記号（A, B …）
        self.letters = [t for t in self.texts if re.fullmatch(r'[A-Z]', t['s'].strip())]

    def drop_legend_boxes(self):
        """凡例（「交流25kV電化、軌間1067mm」など）を囲む四角の枠は線路ではないので除く"""
        hz = [t for t in self.tracks if len(t['pts']) == 2 and abs(t['pts'][0][1] - t['pts'][1][1]) < 0.5]
        vt = [t for t in self.tracks if len(t['pts']) == 2 and abs(t['pts'][0][0] - t['pts'][1][0]) < 0.5]
        drop = set()
        for a in hz:
            for b in hz:
                if a is b: continue
                ax0, ax1 = sorted(p[0] for p in a['pts']); bx0, bx1 = sorted(p[0] for p in b['pts'])
                ya, yb = a['pts'][0][1], b['pts'][0][1]
                if not (yb > ya + 5 and abs(ax0 - bx0) < 2.5 and abs(ax1 - bx1) < 2.5): continue
                sides = [v for v in vt if min(abs(v['pts'][0][0] - ax0), abs(v['pts'][0][0] - ax1)) < 2.5
                         and abs(min(p[1] for p in v['pts']) - ya) < 2.5 and abs(max(p[1] for p in v['pts']) - yb) < 2.5]
                if len(sides) < 2: continue
                inside = [t for t in self.texts if ax0 <= t['x'] and t['x1'] <= ax1 + 40 and ya < t['y'] < yb]
                if inside and all(re.search(r'(電化|軌間|凡例|Gauge|Electric)', t['s']) for t in inside):
                    drop.update(id(t) for t in [a, b] + sides)
                    # 枠の中の線（凡例の線の見本）も除く
                    drop.update(id(t) for t in self.tracks if all(ax0 - 1 <= p[0] <= ax1 + 1 and ya - 1 <= p[1] <= yb + 1 for p in t['pts']))
        if drop: self.tracks = [t for t in self.tracks if id(t) not in drop]

    def merge_platforms(self):
        """仕切り線で2つに分けて描いたホーム（同じ高さで接している四角）で、両側に面する線が同じものは1つのホームにする
        （頭端式ホームと通りぬけのホームの突き合わせなど、面する線が違うものはそのまま）"""
        hs = [(min(a[0], b[0]), max(a[0], b[0]), a[1]) for t in self.tracks for a, b in zip(t['pts'], t['pts'][1:]) if abs(a[1] - b[1]) < 0.3]
        def faces(p):
            out = set()
            for x0, x1, y in hs:
                if x0 <= p[0] + 1 and x1 >= p[2] - 1 and (0 < p[1] - y < 14 or 0 < y - p[3] < 14): out.add(round(y, 1))
            return out
        ps = sorted([list(b) for b in self.plats], key=lambda b: b[0])
        lens = sorted(b[2] - b[0] for b in ps)
        cap = 1.6 * lens[len(lens) // 2] if lens else 0     # この図のふつうのホームの長さの1.6倍まで
        out = []
        for b in ps:
            m = next((o for o in out if abs(o[1] - b[1]) < 0.8 and abs(o[3] - b[3]) < 0.8 and b[0] <= o[2] + 1.5 and b[2] >= o[0] - 1.5), None)
            # 合わせて長くなりすぎるもの（隣の駅のホームと接して描かれたものなど）は合わせない
            if m and faces(m) and faces(m) == faces(b) and max(m[2], b[2]) - min(m[0], b[0]) <= cap:
                m[0], m[2] = min(m[0], b[0]), max(m[2], b[2])
            else:
                out.append(b)
        self.plats = out

    def fix_platform_outlines(self):
        """太線で描いたホームの枠（短い縦線＋横線）を線路から外してホームにする"""
        tr = self.tracks
        # 折れ線を線分に分解しておく（コの字のホームは1本の折れ線のことがある）
        segs = []
        for i, t in enumerate(tr):
            for j in range(1, len(t['pts'])):
                segs.append((i, t['pts'][j - 1], t['pts'][j]))
        vert = [(i, a, b) for i, a, b in segs if abs(a[0] - b[0]) < 0.3 and 4 <= abs(a[1] - b[1]) <= 16]
        used = set()
        boxes = []
        for i1, a1, b1 in vert:
            y0, y1 = sorted([a1[1], b1[1]])
            x = a1[0]
            cands = []
            for i2, a2, b2 in vert:
                if a2[0] <= x + 8: continue
                z0, z1 = sorted([a2[1], b2[1]])
                if abs(z0 - y0) > 0.6 or abs(z1 - y1) > 0.6: continue
                cands.append((a2[0], i2))
            for x2, i2 in sorted(cands):
                # 両端の縦線をつなぐ横線（上か下）が全長の6割以上あるもののうち、いちばん近い組
                hz = [(i, a, b) for i, a, b in segs if abs(a[1] - b[1]) < 0.3 and (abs(a[1] - y0) < 0.6 or abs(a[1] - y1) < 0.6)
                      and min(a[0], b[0]) >= x - 0.6 and max(a[0], b[0]) <= x2 + 0.6 and max(a[0], b[0]) - min(a[0], b[0]) > 3]
                cover = sum(abs(b[0] - a[0]) for i, a, b in hz)
                if cover >= (x2 - x) * 0.6:
                    boxes.append((x, y0, x2, y1, {i1, i2, *[h[0] for h in hz]}))
                    break
        drop = set()
        for x0, y0, x1, y1, ids in boxes:
            # 同じ線路番号の折れ線が全部ホーム枠の中にあるときだけ落とす
            for i in ids:
                pts = tr[i]['pts']
                if all(x0 - 0.7 <= p[0] <= x1 + 0.7 and y0 - 0.7 <= p[1] <= y1 + 0.7 for p in pts):
                    drop.add(i)
            self.plats.append([x0, y0, x1, y1])
        self.tracks = [t for i, t in enumerate(tr) if i not in drop]
        # 重複したホームを除く
        uniq = []
        for b in self.plats:
            if not any(abs(b[0] - c[0]) < 1 and abs(b[1] - c[1]) < 1 and abs(b[2] - c[2]) < 1 and abs(b[3] - c[3]) < 1 for c in uniq):
                uniq.append(b)
        self.plats = uniq

    def bounds(self):
        xs = [p[0] for t in self.tracks for p in t['pts']]
        ys = [p[1] for t in self.tracks for p in t['pts']]
        return min(xs), min(ys), max(xs), max(ys)

    def labels(self):
        return [t for t in self.texts if is_station_label(t)]

def endpoints_degree(tracks):
    """端点ごとの接続数（他の線路の端点・途中に接していれば 2 以上）"""
    ends = []
    for i, t in enumerate(tracks):
        for w in (0, -1):
            ends.append((i, w, t['pts'][w]))
    deg = {}
    for i, w, p in ends:
        n = 1
        for j, t in enumerate(tracks):
            if j == i: continue
            for k in range(1, len(t['pts'])):
                d, _ = dist_seg(p, t['pts'][k - 1], t['pts'][k])
                if d <= TOL: n += 1; break
        deg[(i, w)] = n
    return deg

def has_buffer(p, direction, thin):
    """端点 p に車止め（細い横棒）があるか"""
    for pts in thin:
        for k in range(1, len(pts)):
            a, b = pts[k - 1], pts[k]
            d, _ = dist_seg(p, a, b)
            if d > 1.3: continue
            L = seglen(a, b)
            if L < 1.5: continue
            ang = math.atan2(b[1] - a[1], b[0] - a[0])
            diff = abs(math.sin(ang - direction))
            if diff > 0.7: return True
    return False

def dangling(img):
    """画像の端で切れている線路の端（車止めでない・他とつながらない）"""
    deg = endpoints_degree(img.tracks)
    out = []
    for (i, w), n in deg.items():
        if n > 1: continue
        t = img.tracks[i]
        p = t['pts'][w]; q = t['pts'][1] if w == 0 else t['pts'][-2]
        direction = math.atan2(p[1] - q[1], p[0] - q[0])
        if has_buffer(p, direction, img.thin): continue
        out.append(dict(i=i, w=w, p=p, dir=direction))
    return out

def letter_ends(img, letter, dg=None):
    """記号（A など）の近くで切れている線路の端"""
    dg = dg if dg is not None else dangling(img)
    cx, cy = (letter['x'] + letter['x1']) / 2, letter['y'] - letter['size'] * 0.35
    out = [d for d in dg if math.hypot(d['p'][0] - cx, d['p'][1] - cy) <= 26]
    return out

def edge_stubs(img):
    x0, y0, x1, y1 = img.bounds()
    dg = dangling(img)
    near = set()
    for lt in img.letters:
        for d in letter_ends(img, lt, dg): near.add((d['i'], d['w']))
    dg = [d for d in dg if (d['i'], d['w']) not in near]
    # 行先表示（「〜方」）の近くで切れている線は、他線への出口なので画像どうしの継ぎ目にしない
    exits = [t for t in img.texts if t['s'].strip().endswith('方')]
    def near_exit(d):
        for t in exits:
            cx = (t['x'] + t['x1']) / 2
            if abs(d['p'][1] - (t['y'] - 4)) < 18 and (min(abs(d['p'][0] - t['x']), abs(d['p'][0] - t['x1'])) < 25 or t['x'] - 5 <= d['p'][0] <= t['x1'] + 5):
                return True
        return False
    dg = [d for d in dg if not near_exit(d)]
    L = sorted([d for d in dg if d['p'][0] <= x0 + 3 and math.cos(d['dir']) < -0.5], key=lambda d: d['p'][1])
    R = sorted([d for d in dg if d['p'][0] >= x1 - 3 and math.cos(d['dir']) > 0.5], key=lambda d: d['p'][1])
    return L, R

GAP = 12.0

def assemble(keys, rot=False, flip=()):
    """画像を左から順に並べ、境界で切れている線路どうしをつなぐ。rot=True なら全体を180度回す"""
    order = list(reversed(keys)) if rot else list(keys)
    imgs, links = [], []
    offx = 0.0
    prev = None
    insets = []
    for key in order:
        raw = Img(key, rot=rot != (key in flip))
        if not raw.tracks:
            continue
        if is_inset(raw):
            # 補足の図は、ほかの画像と重ならない遠くに置いておき、あとで記号の相手の脇へ移す
            insets.append(Img(key, dx=0.0, dy=-100000.0 * (len(insets) + 1), rot=rot != (key in flip)))
            continue
        bx0, by0, bx1, by1 = raw.bounds()
        if prev is None:
            dx, dy = -bx0, 0.0
        else:
            L, _ = edge_stubs(raw)
            _, R = edge_stubs(prev)
            # 縦位置：対応する線の平均をそろえる（数が違えば中心どうし）
            if L and R and len(L) == len(R):
                dy = sum(r['p'][1] for r in R) / len(R) - sum(l['p'][1] for l in L) / len(L)
            elif L and R:
                # 数が違うとき：中心どうしをそろえる。ほかに、より多くの線の高さがそろう ずらし量があればそちら
                dc = (R[0]['p'][1] + R[-1]['p'][1]) / 2 - (L[0]['p'][1] + L[-1]['p'][1]) / 2
                hits = lambda d0: sum(1 for r2 in R if any(abs(r2['p'][1] - (l2['p'][1] + d0)) < 1.5 for l2 in L))
                dy, bh = dc, hits(dc)
                for r in R:
                    for l in L:
                        d0 = r['p'][1] - l['p'][1]
                        h = hits(d0)
                        if h > bh or (h == bh and h > 0 and abs(d0 - dc) < abs(dy - dc)): dy, bh = d0, h
            else:
                dy = (prev.bounds()[1] + prev.bounds()[3]) / 2 - (by0 + by1) / 2
            dx = prev.bounds()[2] + GAP - bx0
        im = Img(key, dx=dx, dy=dy, rot=rot != (key in flip))
        if prev is not None:
            L, _ = edge_stubs(im)
            _, R = edge_stubs(prev)
            if L and R and len(L) == len(R):
                for r, l in zip(R, L):
                    links.append([r['p'], l['p']])
            elif L and R:
                # 数が違うときは近いものどうしを1対1で
                pairs = sorted(((abs(l['p'][1] - r['p'][1]), i, j) for i, r in enumerate(R) for j, l in enumerate(L)))
                ur, ul = set(), set()
                for d, i, j in pairs:
                    if d >= 12 or i in ur or j in ul: continue
                    ur.add(i); ul.add(j)
                    links.append([R[i]['p'], L[j]['p']])
        imgs.append(im)
        prev = im
    # 記号（A など）どうしをつなぐ：別の画像なら線でつなぎ、同じ画像の中なら記号側のまとまり（車庫など）を寄せる
    occ = defaultdict(list)
    for im in imgs:
        dg = dangling(im)
        for lt in im.letters:
            ends = letter_ends(im, lt, dg)
            if ends: occ[lt['s'].strip()].append((im, ends))
    moves = []
    for ch, lst in occ.items():
        if len(lst) != 2: continue
        (ia, ea), (ib, eb) = lst
        if len(ea) != len(eb): continue
        if ia is ib:
            moves.append((ia, ea, eb))
        else:
            for a_, b_ in pair_ends(ea, eb):
                links.append([a_['p'], b_['p']])
    for im, ea, eb in moves:
        if not relocate_block(im, ea, eb, links):
            for a_, b_ in pair_ends(ea, eb):
                links.append([a_['p'], b_['p']])
    # 補足の図（記号でつながる続きだけを描いた画像）：記号ごとのまとまりを、相手の記号の脇へ移す
    for ins in insets:
        place_inset(ins, imgs, links)
    return imgs, links

def is_inset(im):
    """駅名がかっこ書き（「（新下関）」）か記号だけの、補足の図"""
    labels = [t['s'].strip() for t in im.texts if t['size'] >= 13 and not t['s'].strip().endswith('方')]
    labels = [x for x in labels if re.search(r'[぀-ヿ一-鿿A-Z]', x)]
    if not labels or not im.letters: return False
    depot = re.compile(r'(検車区|車両基地|車両センター|電車区|車両所|工場|検修区|車庫|運転所|車両区|基地|支所|凡例)')
    return all(re.fullmatch(r'[A-Z]', x) or x[0] in '（(' or depot.search(x) for x in labels) and any(re.fullmatch(r'[A-Z]', x) for x in labels)

def place_inset(ins, imgs, links):
    comps = components(ins.tracks)
    dg = dangling(ins)
    for lt in ins.letters:
        ch = lt['s'].strip()
        eb = letter_ends(ins, lt, dg)
        if not eb: continue
        partner = None
        for im in imgs:
            for lt2 in im.letters:
                if lt2['s'].strip() != ch: continue
                ea = letter_ends(im, lt2)
                if len(ea) == len(eb): partner = (im, ea)
        if not partner: continue
        im, ea = partner
        cb = next((c for c in comps if eb[0]['i'] in c), None)
        if not cb: continue
        # まとまりの線路・建屋・文字を相手の画像へ移してから、相手の画像の中で記号の先へ寄せる
        xs = [p[0] for i in cb for p in ins.tracks[i]['pts']]; ys = [p[1] for i in cb for p in ins.tracks[i]['pts']]
        bx0, bx1, by0, by1 = min(xs) - 3, max(xs) + 3, min(ys) - 3, max(ys) + 3
        inb = lambda b: b[0] >= bx0 and b[2] <= bx1 and b[1] >= by0 and b[3] <= by1
        base = len(im.tracks)
        idx = {}
        for i in sorted(cb):
            idx[i] = len(im.tracks); im.tracks.append(ins.tracks[i])
        im.bldgs += [b for b in ins.bldgs if inb(b)]
        im.plats += [b for b in ins.plats if inb(b)]
        im.tts += [t for t in ins.tts if bx0 <= t['x'] <= bx1 and by0 <= t['y'] <= by1]
        im.thin += [t for t in ins.thin if all(bx0 <= p[0] <= bx1 and by0 <= p[1] <= by1 for p in t)]
        im.texts += [t for t in ins.texts if bx0 <= t['x'] <= bx1 and by0 <= t['y'] <= by1 and not re.fullmatch(r'[A-Z]', t['s'].strip()) and t['s'].strip()[:1] not in '（('] 
        eb2 = [dict(e, i=idx[e['i']]) for e in eb if e['i'] in idx]
        relocate_block(im, ea, eb2, links, force=True)

def pair_ends(ea, eb):
    """2組の端を、外向きの向きに直交する並びの順に組にする"""
    def order(es):
        h = math.atan2(sum(math.sin(e['dir']) for e in es), sum(math.cos(e['dir']) for e in es))
        nx, ny = -math.sin(h), math.cos(h)
        return sorted(es, key=lambda e: e['p'][0] * nx + e['p'][1] * ny), h
    oa, ha = order(ea); ob, hb = order(eb)
    # 向かい合わせにつなぐので、片方は逆順
    return list(zip(oa, list(reversed(ob))))

def components(tracks):
    """端点・途中でつながる線路のまとまり（線路番号の集合のリスト）"""
    n = len(tracks)
    parent = list(range(n))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i in range(n):
        for j in range(i + 1, n):
            a, b = tracks[i]['pts'], tracks[j]['pts']
            hit = False
            for q in (a[0], a[-1]):
                for k in range(1, len(b)):
                    if dist_seg(q, b[k - 1], b[k])[0] <= TOL: hit = True; break
                if hit: break
            if not hit:
                for q in (b[0], b[-1]):
                    for k in range(1, len(a)):
                        if dist_seg(q, a[k - 1], a[k])[0] <= TOL: hit = True; break
                    if hit: break
            if hit: parent[find(i)] = find(j)
    groups = defaultdict(set)
    for i in range(n): groups[find(i)].add(i)
    return list(groups.values())

def relocate_block(im, ea, eb, links, force=False):
    """同じ画像の中で記号でつながる2か所のうち、本線のない方のまとまりを、もう一方の記号の先へ回して置く"""
    comps = components(im.tracks)
    ca = next((c for c in comps if ea[0]['i'] in c), set())
    cb = next((c for c in comps if eb[0]['i'] in c), set())
    if ca == cb: return False
    # 小さい方（車庫など）を動かす（補足の図から移すときは、補足の図の側を動かす）
    if len(ca) < len(cb) and not force:
        ea, eb, ca, cb = eb, ea, cb, ca
    # 動かすのは駅（ホーム）を含まない行き止まりのまとまり（車両基地など）だけ。駅を含むなら線でつなぐ
    xs0 = [p[0] for i in cb for p in im.tracks[i]['pts']]; ys0 = [p[1] for i in cb for p in im.tracks[i]['pts']]
    if not force and any(min(xs0) - 2 <= (b[0] + b[2]) / 2 <= max(xs0) + 2 and min(ys0) - 12 <= (b[1] + b[3]) / 2 <= max(ys0) + 12 for b in im.plats):
        return False
    # eb 側のまとまり cb を ea の先へ置く（回すのは 0° か 180° だけ：図の水平・垂直を保つ）
    ha = math.atan2(sum(math.sin(e['dir']) for e in ea), sum(math.cos(e['dir']) for e in ea))
    hb = math.atan2(sum(math.sin(e['dir']) for e in eb), sum(math.cos(e['dir']) for e in eb))
    raw = (ha + math.pi) - hb
    rot = 0.0 if math.cos(raw) >= 0 else math.pi
    ca_x = sum(e['p'][0] for e in ea) / len(ea); ca_y = sum(e['p'][1] for e in ea) / len(ea)
    cb_x = sum(e['p'][0] for e in eb) / len(eb); cb_y = sum(e['p'][1] for e in eb) / len(eb)
    others = [p for i, t in enumerate(im.tracks) if i not in cb for p in t['pts']]
    rel = []
    for i in cb:
        for p in im.tracks[i]['pts']:
            x, y = p[0] - cb_x, p[1] - cb_y
            rel.append((x * math.cos(rot) - y * math.sin(rot), x * math.sin(rot) + y * math.cos(rot)))
    tx = ca_x + math.cos(ha) * 30
    if math.sin(ha) > 0.3:          # 記号が下向き：ほかの線路より下へ
        ty = max(p[1] for p in others) + 25 - min(r[1] for r in rel)
    elif math.sin(ha) < -0.3:       # 上向き：ほかの線路より上へ
        ty = min(p[1] for p in others) - 25 - max(r[1] for r in rel)
    else:
        # 横向き：その先は路線が続くので、ほかの線路の上か下の近い方へ寄せる
        ys_o = [p[1] for p in others] or [ca_y]
        if ca_y - min(ys_o) <= max(ys_o) - ca_y:
            ty = min(ys_o) - 25 - max(r[1] for r in rel)
        else:
            ty = max(ys_o) + 25 - min(r[1] for r in rel)
    c, s_ = math.cos(rot), math.sin(rot)
    def tf(p):
        x, y = p[0] - cb_x, p[1] - cb_y
        return (tx + x * c - y * s_, ty + x * s_ + y * c)
    # まとまりの範囲（建屋・ホームも一緒に動かす）
    xs = [p[0] for i in cb for p in im.tracks[i]['pts']]; ys = [p[1] for i in cb for p in im.tracks[i]['pts']]
    bx0, bx1, by0, by1 = min(xs) - 3, max(xs) + 3, min(ys) - 3, max(ys) + 3
    for i in cb:
        im.tracks[i]['pts'] = [tf(p) for p in im.tracks[i]['pts']]
    def tbox(b):
        q = [tf((b[0], b[1])), tf((b[2], b[3])), tf((b[0], b[3])), tf((b[2], b[1]))]
        return [min(p[0] for p in q), min(p[1] for p in q), max(p[0] for p in q), max(p[1] for p in q)] + list(b[4:])
    inside = lambda b: b[0] >= bx0 and b[2] <= bx1 and b[1] >= by0 and b[3] <= by1
    im.bldgs = [tbox(b) if inside(b) else b for b in im.bldgs]
    im.plats = [tbox(b) if inside(b) else b for b in im.plats]
    im.tts = [dict(t, **dict(zip(('x', 'y'), tf((t['x'], t['y']))))) if bx0 <= t['x'] <= bx1 and by0 <= t['y'] <= by1 else t for t in im.tts]
    im.thin = [[tf(p) for p in t] if all(bx0 <= p[0] <= bx1 and by0 <= p[1] <= by1 for p in t) else t for t in im.thin]
    new_t = []
    for t in im.texts:
        if bx0 <= t['x'] <= bx1 and by0 <= t['y'] <= by1:
            q = tf((t['x'], t['y']))
            t = dict(t, x=q[0], x1=q[0] + (t['x1'] - t['x']), y=q[1])
        new_t.append(t)
    im.texts = new_t
    eb2 = [dict(e, p=tf(e['p']), dir=e['dir'] + rot) for e in eb]
    for a_, b_ in pair_ends(ea, eb2):
        links.append([a_['p'], b_['p']])
    return True

class Strip:
    def __init__(self, imgs, links):
        self.imgs = imgs
        self.tracks = []
        for im in imgs: self.tracks += im.tracks
        for a, b in links:
            self.tracks.append({'pts': [a, b], 'dashed': False, 'color': '#000', 'img': 'link'})
        self.thin = [t for im in imgs for t in im.thin]
        self.plats = [p for im in imgs for p in im.plats]
        self.bldgs = [b for im in imgs for b in im.bldgs]
        self.tts = [t for im in imgs for t in im.tts]
        self.texts = [t for im in imgs for t in im.texts]
        self.drop_duplicates()
        self.bridge_gaps()
        self.build_graph()

    def drop_duplicates(self):
        """同じところに重ねて描かれた線（二重線）を1本にする"""
        # 四線軌条（軌間の違う線を並べて描いた二重線）もまとめる
        tol = 1.8
        def inside(a, b):
            # a の点がすべて b の上（すぐそば）にある
            pa = a['pts']
            pb = b['pts']
            for k in range(len(pa)):
                p = pa[k]
                if min(dist_seg(p, pb[j - 1], pb[j])[0] for j in range(1, len(pb))) > tol: return False
                if k:
                    m = ((pa[k - 1][0] + p[0]) / 2, (pa[k - 1][1] + p[1]) / 2)
                    if min(dist_seg(m, pb[j - 1], pb[j])[0] for j in range(1, len(pb))) > tol: return False
            return True
        tr = self.tracks
        drop = set()
        boxes = []
        for t in tr:
            xs = [p[0] for p in t['pts']]; ys = [p[1] for p in t['pts']]
            boxes.append((min(xs), min(ys), max(xs), max(ys)))
        for i in range(len(tr)):
            if i in drop or len(tr[i]['pts']) < 2: continue
            for j in range(len(tr)):
                if j == i or j in drop or len(tr[j]['pts']) < 2: continue
                bi, bj = boxes[i], boxes[j]
                if bi[0] < bj[0] - tol or bi[2] > bj[2] + tol or bi[1] < bj[1] - tol or bi[3] > bj[3] + tol: continue
                if tr[i].get('dashed') != tr[j].get('dashed'): continue
                if inside(tr[i], tr[j]):
                    drop.add(i); break
        if drop:
            self.tracks = [t for k, t in enumerate(tr) if k not in drop]

    def bridge_gaps(self):
        """一直線に並んだ線路の端どうしが、描画上わずかに離れているところをつなぐ"""
        ends = []
        for i, t in enumerate(self.tracks):
            pts = t['pts']
            if len(pts) < 2: continue
            for w in (0, -1):
                p = pts[w]; q = pts[1] if w == 0 else pts[-2]
                if seglen(p, q) < 1e-6: continue
                ends.append((i, p, math.atan2(p[1] - q[1], p[0] - q[0])))
        def free(i, p):
            for j, o in enumerate(self.tracks):
                if j == i: continue
                op = o['pts']
                for k in range(1, len(op)):
                    if dist_seg(p, op[k - 1], op[k])[0] <= TOL: return False
            return True
        add = []
        for a in range(len(ends)):
            i, p, ha = ends[a]
            for b in range(a + 1, len(ends)):
                j, q, hb = ends[b]
                if i == j: continue
                d = seglen(p, q)
                if not (TOL < d <= 2.0): continue
                # 向き合っていて、すき間もその向き
                if math.cos(ha - hb) > -0.97: continue
                g = math.atan2(q[1] - p[1], q[0] - p[0])
                if math.cos(g - ha) < 0.97: continue
                if has_buffer(p, ha, self.thin) or has_buffer(q, hb, self.thin): continue
                if not free(i, p) or not free(j, q): continue
                add.append([p, q])
        for p, q in add:
            self.tracks.append({'pts': [p, q], 'dashed': False, 'color': '#000', 'img': 'gap'})

    def build_graph(self):
        """節点（端点・T字の接点）で線路を区切った辺のグラフ"""
        nodes = []
        def node(p):
            for i, q in enumerate(nodes):
                if seglen(p, q) <= TOL: return i
            nodes.append(p); return len(nodes) - 1
        # 端点
        cuts = defaultdict(list)          # 線路番号 → [(位置, 節点)]
        for i, t in enumerate(self.tracks):
            pts = t['pts']
            cuts[i].append((0.0, node(pts[0])))
            cuts[i].append((plen(pts), node(pts[-1])))
        # T字：他線の端点が線路の途中にある
        for i, t in enumerate(self.tracks):
            pts = t['pts']
            acc = 0.0
            segs = []
            for k in range(1, len(pts)):
                segs.append((acc, pts[k - 1], pts[k])); acc += seglen(pts[k - 1], pts[k])
            total = acc
            for j, o in enumerate(self.tracks):
                if j == i: continue
                for q in (o['pts'][0], o['pts'][-1]):
                    for a0, a, b in segs:
                        d, u = dist_seg(q, a, b)
                        if d <= TOL:
                            at = a0 + seglen(a, b) * u
                            if TOL < at < total - TOL:
                                cuts[i].append((at, node(q)))
                            break
        self.nodes = nodes
        self.edges = []
        self.adj = defaultdict(list)
        for i, t in enumerate(self.tracks):
            cs = sorted(set((round(a, 3), n) for a, n in cuts[i]))
            clean = []
            for a, n in cs:
                if clean and (abs(a - clean[-1][0]) < 0.3 or n == clean[-1][1]): continue
                clean.append((a, n))
            for k in range(1, len(clean)):
                a, na = clean[k - 1]; b, nb = clean[k]
                if na == nb: continue
                pts = sub_poly(t['pts'], a, b)
                pts[0] = nodes[na]; pts[-1] = nodes[nb]
                e = dict(id=len(self.edges), a=na, b=nb, pts=pts, track=i, dashed=t['dashed'], color=t['color'], len=b - a, link=t.get('img') == 'link')
                self.edges.append(e)
                self.adj[na].append(e['id']); self.adj[nb].append(e['id'])

    def heading_out(self, eid, n):
        """節点 n から辺 eid へ出ていく向き"""
        e = self.edges[eid]
        pts = e['pts'] if e['a'] == n else list(reversed(e['pts']))
        a = pts[0]
        for q in pts[1:]:
            if seglen(a, q) > 0.5:
                return math.atan2(q[1] - a[1], q[0] - a[0])
        return math.atan2(pts[-1][1] - a[1], pts[-1][0] - a[0])

    def other(self, eid, n):
        e = self.edges[eid]
        return e['b'] if e['a'] == n else e['a']

    def straight_next(self, eid, n, maxdev=0.6, prefer=0):
        """辺 eid から節点 n に入り、いちばんまっすぐ抜ける辺（折り返す向きの辺は除く）。
        両開き分岐のように甲乙つけがたいときは prefer（+1 下側 / -1 上側）を選ぶ"""
        hin = self.heading_out(eid, n) + math.pi      # 入ってきた向き
        devs = []
        for x in self.adj[n]:
            if x == eid: continue
            h = self.heading_out(x, n)
            d = abs(math.atan2(math.sin(h - hin), math.cos(h - hin)))
            if d < math.radians(80): devs.append((d, x, math.sin(h)))
        if not devs: return None
        devs.sort()
        if len(devs) == 1: return devs[0][1]
        if devs[1][0] - devs[0][0] > 0.15: return devs[0][1]
        if prefer:
            close = [d for d in devs if d[0] - devs[0][0] <= 0.15]
            close.sort(key=lambda d: -d[2] * prefer)
            return close[0][1]
        return None

def sub_poly(pts, a, b):
    out = []
    acc = 0.0
    def at(s):
        r = 0.0
        for k in range(1, len(pts)):
            L = seglen(pts[k - 1], pts[k])
            if r + L >= s - 1e-9:
                u = 0 if L < 1e-9 else (s - r) / L
                return (pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * u, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * u)
            r += L
        return pts[-1]
    out.append(at(a))
    r = 0.0
    for k in range(1, len(pts)):
        r += seglen(pts[k - 1], pts[k])
        if a + 1e-6 < r < b - 1e-6: out.append(pts[k])
    out.append(at(b))
    return out

def render(S, path, hl=None, row_w=1500, extra=None):
    """帯を何段かに折り返して SVG に描く（hl: 辺ID→色）"""
    import html as H
    hl = hl or {}
    xs = [p[0] for e in S.edges for p in e['pts']]; ys = [p[1] for e in S.edges for p in e['pts']]
    X0, X1, Y0, Y1 = min(xs), max(xs), min(ys) - 20, max(ys) + 30
    rows = max(1, math.ceil((X1 - X0) / row_w))
    rh = Y1 - Y0
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {row_w + 20} {rows * rh}" width="{row_w + 20}" height="{rows * rh}"><rect width="100%" height="100%" fill="#fff"/>']
    for r in range(rows):
        ox = X0 + r * row_w
        g = f'<g transform="translate({10 - ox} {r * rh - Y0})">'
        o.append(f'<g><clipPath id="c{r}"><rect x="0" y="{r * rh}" width="{row_w + 20}" height="{rh}"/></clipPath></g>')
        o.append(f'<g clip-path="url(#c{r})">' + g)
        for b in S.plats:
            o.append(f'<rect x="{b[0]}" y="{b[1]}" width="{b[2]-b[0]}" height="{b[3]-b[1]}" fill="#cfc" stroke="green" stroke-width=".6"/>')
        for b in S.bldgs:
            o.append(f'<rect x="{b[0]}" y="{b[1]}" width="{b[2]-b[0]}" height="{b[3]-b[1]}" fill="none" stroke="orange" stroke-width=".6"/>')
        for e in S.edges:
            col = hl.get(e['id'], '#06f' if e['dashed'] else '#999')
            w = 1.6 if e['id'] in hl else 0.9
            o.append(f'<polyline fill="none" stroke="{col}" stroke-width="{w}" points="%s"/>' % ' '.join(f'{x:.1f},{y:.1f}' for x, y in e['pts']))
        for t in S.texts:
            if t['size'] >= 13:
                o.append(f'<text x="{t["x"]}" y="{t["y"]}" font-size="{t["size"]*0.8}" fill="#000">{H.escape(t["s"])}</text>')
        for x in (extra or []):
            o.append(x)
        o.append('</g></g>')
    o.append('</svg>')
    open(path, 'w').write('\n'.join(o))

def all_labels(S):
    """帯の中の駅名ラベル（サンプルにない駅も）"""
    out = []
    for t in S.texts:
        if is_station_label(t) and not re.search(r'(検車区|車両基地|車両センター|電車区|車両所|工場|検修区|車庫|運転所|車両区|基地|信号場|信号所|（信）|保線)', t['s']):
            out.append(((t['x'] + t['x1']) / 2, norm_name(t['s'])))
    return out

def station_labels(S, names):
    """駅名ラベルの中心 x（同じ駅名が複数あれば全部）。「九条（奈良）」のような括弧書きは外して照合"""
    want = {}
    for n in names:
        want[norm_name(n)] = n
        base = re.sub(r'[（(].*?[）)]$', '', n)
        if base != n: want.setdefault(norm_name(base), n)
    out = defaultdict(list)
    # 「西方」のように「方」で終わる駅名は、方向の書き込み（「博多方」）と区別するため駅名の一覧にあるときだけ
    labs = [t for t in S.texts if is_station_label(t) or (t['size'] >= 13 and norm_name(t['s']) in want)]
    for t in labs:
        k = norm_name(t['s'])
        # 「（東京）」のように、かっこでくくった駅名（図の外の駅の位置を示すもの）
        if k not in want:
            k2 = norm_name(re.sub(r'^[（(](.*)[）)]$', r'\1', t['s'].strip()))
            if k2 in want: k = k2
        if k in want:
            out[want[k]].append(((t['x'] + t['x1']) / 2, t['y']))
            continue
        # 1文字ずつ別に書いた駅名（横に並ぶ・縦に並ぶ）
        if len(t['s'].strip()) == 1:
            singles = [u for u in S.texts if len(u['s'].strip()) == 1 and u['size'] >= 13]
            for horiz in (True, False):
                seq = [t]
                while True:
                    p = seq[-1]
                    if horiz:
                        nx = [u for u in singles if u not in seq and abs(u['y'] - p['y']) < 2 and 0 <= u['x'] - p['x'] <= p['size'] * 1.3]
                        nx.sort(key=lambda u: u['x'])
                    else:
                        nx = [u for u in singles if u not in seq and abs(u['x'] - p['x']) < 3 and 0 < u['y'] - p['y'] <= p['size'] * 1.6]
                        nx.sort(key=lambda u: u['y'])
                    if not nx: break
                    seq.append(nx[0])
                if len(seq) < 2: continue
                k2 = norm_name(''.join(u['s'].strip() for u in seq))
                if k2 in want:
                    xs = [u['x'] for u in seq] + [u['x1'] for u in seq]
                    out[want[k2]].append(((min(xs) + max(xs)) / 2, seq[-1]['y']))
            continue
        # 2行に分けて書いた駅名（「羽田空港」＋「第3ターミナル」）
        for u in labs:
            if u is t or not (8 <= u['y'] - t['y'] <= 26): continue
            if min(t['x1'], u['x1']) - max(t['x'], u['x']) < -4: continue
            k2 = norm_name(t['s'] + u['s'])
            if k2 in want:
                out[want[k2]].append(((t['x'] + t['x1'] + u['x'] + u['x1']) / 4, t['y']))
    return out

def crossing_edges(S, x):
    """縦線 x と交わる辺（交点の y つき）"""
    out = []
    for e in S.edges:
        pts = e['pts']
        for k in range(1, len(pts)):
            a, b = pts[k - 1], pts[k]
            if (a[0] - x) * (b[0] - x) < 0 or (abs(a[0] - x) < 1e-6 and abs(b[0] - x) > 1e-6):
                u = (x - a[0]) / (b[0] - a[0]) if b[0] != a[0] else 0
                out.append((a[1] + (b[1] - a[1]) * u, e['id']))
                break
    return sorted(out)

def forward_cands(S, eid, n):
    """節点 n で、辺 eid から折り返さずに進める辺と、その曲がり具合"""
    hin = S.heading_out(eid, n) + math.pi
    out = []
    others = [x for x in S.adj[n] if x != eid]
    for x in others:
        h = S.heading_out(x, n)
        d = abs(math.atan2(math.sin(h - hin), math.cos(h - hin)))
        # 記号（A など）どうしを結んだ線のつなぎ目は、1本しか続かなければ大きく曲がっていてもよい
        lim = 150 if len(others) == 1 and (S.edges[eid].get('link') or S.edges[x].get('link')) else 80
        if d < math.radians(lim):
            # 色（軌間・電化方式）を指定してたどるときは、違う色の線を後回しに
            if TRACE_COLOR['c'] and S.edges[x]['color'].lower() != TRACE_COLOR['c'] and not S.edges[x].get('link'): d += 1.0
            out.append((d, x, math.sin(h)))
    return sorted(out)

def greedy_reach(S, eid, n, sign, steps=300, avoid=frozenset()):
    """辺 eid に入って節点 n から、折り返さずに行ける x の最遠（sign の向き）。分岐はどちらへも探す"""
    best = S.nodes[n][0] * sign
    seen = set()
    stack = [(eid, n)]
    visits = 0
    while stack and visits < 4000:
        cur, frm = stack.pop()
        if (cur, frm) in seen: continue
        seen.add((cur, frm)); visits += 1
        nx = S.other(cur, frm)
        best = max(best, S.nodes[nx][0] * sign)
        for d, x, sy in forward_cands(S, cur, nx):
            if d > math.radians(70): continue
            # 後戻りする（進む向きと逆へ行く）線はたどらない
            if (S.nodes[S.other(x, nx)][0] - S.nodes[nx][0]) * sign < -1: continue
            if x in avoid: continue          # ほかの本線へ入ったら、その先は数えない
            stack.append((x, nx))
    return best

TRACE_TARGET = {'lo': None, 'hi': None}     # 路線の端の駅の x（先読みで「そこまで届けば十分」とする）
TRACE_COLOR = {'c': None}           # たどる線の色（指定があれば）

def trace(S, eid, start_node, prefer=0, avoid=frozenset()):
    """辺 eid から start_node と反対の向きへ、まっすぐ進めるところまでたどる。
    分岐では、先へ（路線の続く方へ）遠くまで続く側を選び、同じくらいならまっすぐな側"""
    path = [eid]
    n = S.other(eid, start_node)
    sign = 1 if S.nodes[n][0] >= S.nodes[start_node][0] else -1
    cur = eid
    seen = {eid}
    while True:
        c = forward_cands(S, cur, n)
        # 後戻りする（進む向きと逆へ行く）線は候補にしない（行き違い駅の分岐の先で反対側の線へ折り返さない）
        c = [cc for cc in c if (S.nodes[S.other(cc[1], n)][0] - S.nodes[n][0]) * sign >= -1 or S.edges[cc[1]].get('link')]
        # ほかの本線がすでに通った線は、ほかに進める線があれば避ける
        if avoid and any(cc[1] not in avoid for cc in c): c = [cc for cc in c if cc[1] not in avoid]
        # その先でほかの本線に合流してしまう線（渡り線）も、ほかに進める線があれば避ける
        if avoid:
            into = lambda x: any(y in avoid for y in S.adj[S.other(x, n)])
            if any(not into(cc[1]) for cc in c) and any(into(cc[1]) for cc in c):
                c = [cc for cc in c if not into(cc[1])]
        if not c: break
        if len(c) == 1:
            nx = c[0][1]
        else:
            reach = [(greedy_reach(S, x, n, sign, avoid=avoid), d, x, sy) for d, x, sy in c]
            far = max(r[0] for r in reach)
            tgt = TRACE_TARGET['hi'] if sign > 0 else TRACE_TARGET['lo']
            if tgt is not None: far = min(far, tgt * sign)
            good = [r for r in reach if r[0] >= far - 8]
            good.sort(key=lambda r: r[1])
            if len(good) >= 2 and good[1][1] - good[0][1] <= 0.15:
                if prefer:
                    close = [r for r in good if r[1] - good[0][1] <= 0.15]
                    close.sort(key=lambda r: -r[3] * prefer)
                    nx = close[0][2]
                else:
                    break
            else:
                nx = good[0][2]
        if nx in seen: break
        path.append(nx); seen.add(nx)
        n = S.other(nx, n); cur = nx
    return path, n

def trace_both(S, eid, prefer=0, avoid=frozenset()):
    e = S.edges[eid]
    # 左向き（a,b のうち x の小さい側へ）
    left_node = e['a'] if S.nodes[e['a']][0] <= S.nodes[e['b']][0] else e['b']
    right_node = e['b'] if left_node == e['a'] else e['a']
    fw, end_r = trace(S, eid, left_node, prefer, avoid)        # 右へ
    bw, end_l = trace(S, eid, right_node, prefer, avoid)       # 左へ
    return list(reversed(bw[1:])) + fw, end_l, end_r

def render_zoom(S, path, x0, x1, hl=None, scale=4):
    import html as H
    hl = hl or {}
    ys = [p[1] for e in S.edges for p in e['pts'] if x0 <= p[0] <= x1] or [0, 100]
    y0, y1 = min(ys) - 15, max(ys) + 25
    W, Hh = (x1 - x0) * scale, (y1 - y0) * scale
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {x1-x0} {y1-y0}" width="{W}" height="{Hh}"><rect x="{x0}" y="{y0}" width="100%" height="100%" fill="#fff"/>']
    for b in S.plats:
        o.append(f'<rect x="{b[0]}" y="{b[1]}" width="{b[2]-b[0]}" height="{b[3]-b[1]}" fill="#cfc" stroke="green" stroke-width=".3"/>')
    for e in S.edges:
        col = hl.get(e['id'], '#06f' if e['dashed'] else '#999')
        o.append(f'<polyline fill="none" stroke="{col}" stroke-width=".7" points="%s"/>' % ' '.join(f'{x:.1f},{y:.1f}' for x, y in e['pts']))
        m = e['pts'][len(e['pts']) // 2]
        if x0 <= m[0] <= x1: o.append(f'<text x="{m[0]}" y="{m[1]-0.8}" font-size="2.2" fill="#a0a">{e["id"]}</text>')
    for i, p in enumerate(S.nodes):
        if x0 <= p[0] <= x1:
            o.append(f'<circle cx="{p[0]}" cy="{p[1]}" r=".6" fill="#000"/><text x="{p[0]+0.8}" y="{p[1]+2.5}" font-size="2" fill="#06a">n{i}</text>')
    for t in S.texts:
        if x0 <= t['x'] <= x1 and t['size'] >= 13:
            o.append(f'<text x="{t["x"]}" y="{t["y"]}" font-size="6">{H.escape(t["s"])}</text>')
    o.append('</svg>')
    open(path, 'w').write('\n'.join(o))

# ---------------- 書き出し ----------------

def poly_of_edges(S, eids, start_node):
    """辺の列を、start_node から順に1本の折れ線にする"""
    pts = []
    n = start_node
    for eid in eids:
        e = S.edges[eid]
        seg = e['pts'] if e['a'] == n else list(reversed(e['pts']))
        if pts: seg = seg[1:]
        pts += seg
        n = S.other(eid, n)
    return pts

def ordered_path(S, eids):
    """trace_both の辺の列を左端から並べた折れ線"""
    if not eids: return []
    first = S.edges[eids[0]]
    if len(eids) == 1:
        a = first['a'] if S.nodes[first['a']][0] <= S.nodes[first['b']][0] else first['b']
        return poly_of_edges(S, eids, a)
    second = S.edges[eids[1]]
    shared = first['a'] if first['a'] in (second['a'], second['b']) else first['b']
    start = first['b'] if shared == first['a'] else first['a']
    return poly_of_edges(S, eids, start)

def y_at(pts, x):
    for k in range(1, len(pts)):
        a, b = pts[k - 1], pts[k]
        if min(a[0], b[0]) - 1e-6 <= x <= max(a[0], b[0]) + 1e-6 and abs(b[0] - a[0]) > 1e-9:
            return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
    return None

def chains(S, skip):
    """本線以外の辺を、折れ点・直進でつながる限り1本にまとめる"""
    used = set(skip)
    out = []
    def deg_nonmain(n): return [x for x in S.adj[n] if x not in skip]
    def can_join(cur, n, nxt):
        if S.edges[cur]['dashed'] != S.edges[nxt]['dashed']: return False   # 立体交差の下とは分ける
        if len(S.adj[n]) == 2: return True
        # 分岐点では直進側どうしだけつなぐ
        return S.straight_next(cur, n) == nxt
    for e0 in range(len(S.edges)):
        if e0 in used: continue
        used.add(e0)
        seq = [e0]
        # 右（b）へ
        n = S.edges[e0]['b']; cur = e0
        while True:
            cand = [x for x in deg_nonmain(n) if x != cur and x not in used]
            nxt = None
            for x in cand:
                if can_join(cur, n, x): nxt = x; break
            if nxt is None: break
            used.add(nxt); seq.append(nxt); n = S.other(nxt, n); cur = nxt
        endb = n
        n = S.edges[e0]['a']; cur = e0; pre = []
        while True:
            cand = [x for x in deg_nonmain(n) if x != cur and x not in used]
            nxt = None
            for x in cand:
                if can_join(cur, n, x): nxt = x; break
            if nxt is None: break
            used.add(nxt); pre.append(nxt); n = S.other(nxt, n); cur = nxt
        enda = n
        full = list(reversed(pre)) + seq
        pts = poly_of_edges(S, full, enda)
        out.append(dict(edges=full, pts=pts, na=enda, nb=endb, under=under_ranges(S, full, enda)))
    return out

def under_ranges(S, eids, start):
    """辺の列のうち破線（立体交差の下）の区間を、始点からの距離の範囲で返す"""
    out = []
    acc = 0.0
    n = start
    for eid in eids:
        e = S.edges[eid]
        L = plen(e['pts'])
        if e['dashed']:
            if out and abs(out[-1][1] - acc) < 1e-6: out[-1][1] = acc + L
            else: out.append([acc, acc + L])
        acc += L
        n = S.other(eid, n)
    return [[round(a, 2), round(b, 2)] for a, b in out]
