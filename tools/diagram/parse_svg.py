# 配線略図.net の配線図SVGを要素に分解する
#   tracks:   線路（太線 1.2px 以上）。dashed=立体交差の下をくぐる線
#   plats:    旅客ホーム（太線の長方形）
#   bldgs:    建屋（細線の白い長方形）
#   tts:      転車台・トラバーサー
#   thin:     細線（車止め・建屋の枠・引出線など）
#   texts:    文字（size, x, y, 文字列）
import re, sys, json, math
import xml.etree.ElementTree as ET

NS = '{http://www.w3.org/2000/svg}'

def parse_css(txt):
    rules = {}
    txt = re.sub(r'/\*.*?\*/', '', txt, flags=re.S)
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', txt):
        props = {}
        for p in body.split(';'):
            if ':' in p:
                k, v = p.split(':', 1)
                props[k.strip()] = v.strip()
        for s in sel.split(','):
            s = s.strip()
            if s.startswith('.'):
                rules.setdefault(s[1:], {}).update(props)
    return rules

def mat_mul(a, b):
    # 2x3 行列 [a b c d e f] （SVG と同じ）
    return [a[0]*b[0] + a[2]*b[1], a[1]*b[0] + a[3]*b[1],
            a[0]*b[2] + a[2]*b[3], a[1]*b[2] + a[3]*b[3],
            a[0]*b[4] + a[2]*b[5] + a[4], a[1]*b[4] + a[3]*b[5] + a[5]]

def parse_transform(s):
    m = [1, 0, 0, 1, 0, 0]
    if not s: return m
    for name, args in re.findall(r'(\w+)\s*\(([^)]*)\)', s):
        v = [float(x) for x in re.findall(r'-?[\d.]+(?:e-?\d+)?', args)]
        if name == 'translate': t = [1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0]
        elif name == 'scale': t = [v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0]
        elif name == 'rotate':
            a = math.radians(v[0]); c, s_ = math.cos(a), math.sin(a)
            t = [c, s_, -s_, c, 0, 0]
            if len(v) == 3:
                t = mat_mul(mat_mul([1, 0, 0, 1, v[1], v[2]], t), [1, 0, 0, 1, -v[1], -v[2]])
        elif name == 'matrix': t = v[:6]
        else: continue
        m = mat_mul(m, t)
    return m

def ap(m, x, y):
    return (m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5])

def path_polys(d):
    """パスを折れ線の並びに（曲線は端点と中間点で近似）"""
    toks = re.findall(r'[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e-?\d+)?', d)
    polys, cur, i = [], [], 0
    x = y = sx = sy = 0
    cmd = None
    def num():
        nonlocal i
        v = float(toks[i]); i += 1; return v
    while i < len(toks):
        if re.match(r'[A-Za-z]', toks[i]):
            cmd = toks[i]; i += 1
            if cmd in 'Zz':
                if cur: cur.append((sx, sy)); polys.append(cur); cur = []
                x, y = sx, sy
                continue
        if cmd is None: i += 1; continue
        rel = cmd.islower(); c = cmd.upper()
        if c == 'M':
            nx, ny = num(), num()
            if rel: nx += x; ny += y
            if cur: polys.append(cur)
            cur = [(nx, ny)]; x, y = nx, ny; sx, sy = x, y
            cmd = 'l' if rel else 'L'
        elif c == 'L':
            nx, ny = num(), num()
            if rel: nx += x; ny += y
            cur.append((nx, ny)); x, y = nx, ny
        elif c == 'H':
            nx = num(); x = nx + x if rel else nx; cur.append((x, y))
        elif c == 'V':
            ny = num(); y = ny + y if rel else ny; cur.append((x, y))
        elif c in 'CSQT':
            n = {'C': 6, 'S': 4, 'Q': 4, 'T': 2}[c]
            vals = [num() for _ in range(n)]
            ex, ey = vals[-2], vals[-1]
            if rel: ex += x; ey += y
            if n >= 4:
                mx, my = vals[-4], vals[-3]
                if rel: mx += x; my += y
                # 制御点と端点の中点で近似
                cur.append(((x + 2 * mx + ex) / 4, (y + 2 * my + ey) / 4))
            cur.append((ex, ey)); x, y = ex, ey
        elif c == 'A':
            vals = [num() for _ in range(7)]
            ex, ey = vals[5], vals[6]
            if rel: ex += x; ey += y
            cur.append((ex, ey)); x, y = ex, ey
        else:
            i += 1
    if cur: polys.append(cur)
    return [p for p in polys if len(p) >= 2]

def fnum(s, d=0.0):
    try: return float(re.sub(r'px$', '', str(s)))
    except Exception: return d

def parse(path):
    tree = ET.parse(path)
    root = tree.getroot()
    css = {}
    for st in root.iter(NS + 'style'):
        css.update(parse_css(st.text or ''))
    vb = [float(x) for x in (root.get('viewBox') or '0 0 0 0').split()]
    out = {'w': vb[2], 'h': vb[3], 'tracks': [], 'plats': [], 'bldgs': [], 'tts': [], 'thin': [], 'texts': [], 'fills': []}

    def style_of(el, inherited):
        st = dict(inherited)
        for c in (el.get('class') or '').split():
            st.update(css.get(c, {}))
        for k in ('stroke', 'stroke-width', 'fill', 'stroke-dasharray', 'font-size'):
            if el.get(k) is not None: st[k] = el.get(k)
        if el.get('style'):
            for p in el.get('style').split(';'):
                if ':' in p:
                    k, v = p.split(':', 1); st[k.strip()] = v.strip()
        return st

    def walk(el, m, inh):
        tag = el.tag.replace(NS, '')
        if tag in ('defs', 'style', 'clipPath', 'mask', 'symbol'): return
        m2 = mat_mul(m, parse_transform(el.get('transform')))
        st = style_of(el, inh)
        inh2 = {k: v for k, v in st.items() if k in ('stroke', 'stroke-width', 'fill', 'stroke-dasharray', 'font-size')}
        stroke = st.get('stroke', 'none')
        sw = fnum(st.get('stroke-width', 1 if stroke not in ('none', None) else 0))
        sc = math.sqrt(abs(m2[0] * m2[3] - m2[1] * m2[2])) or 1
        sw *= sc
        dashed = st.get('stroke-dasharray', 'none') not in ('none', '', '0')
        fill = st.get('fill', '#000')
        polys = []
        if tag == 'line':
            polys = [[(fnum(el.get('x1')), fnum(el.get('y1'))), (fnum(el.get('x2')), fnum(el.get('y2')))]]
        elif tag in ('polyline', 'polygon'):
            v = [float(x) for x in re.findall(r'-?\d*\.?\d+(?:e-?\d+)?', el.get('points') or '')]
            pts = list(zip(v[0::2], v[1::2]))
            if tag == 'polygon' and pts: pts.append(pts[0])
            polys = [pts]
        elif tag == 'path':
            polys = path_polys(el.get('d') or '')
        elif tag == 'rect':
            x, y, w, h = (fnum(el.get(k)) for k in ('x', 'y', 'width', 'height'))
            corners = [ap(m2, x, y), ap(m2, x + w, y), ap(m2, x + w, y + h), ap(m2, x, y + h)]
            xs = [c[0] for c in corners]; ys = [c[1] for c in corners]
            box = [min(xs), min(ys), max(xs), max(ys)]
            if stroke not in ('none', None) and sw >= 1.2:
                out['plats'].append({'box': box, 'color': stroke})
            elif stroke not in ('none', None) and sw > 0:
                bd = {'box': box, 'fill': fill}
                # 斜めに置いた建屋：向き（度）と本来の幅・奥行きも残す
                ex, ey = corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]
                ang = math.degrees(math.atan2(ey, ex)) % 180
                if min(ang % 90, 90 - ang % 90) > 3:
                    bd['rot'] = [ang, math.hypot(ex, ey), math.hypot(corners[3][0] - corners[0][0], corners[3][1] - corners[0][1])]
                out['bldgs'].append(bd)
            elif fill not in ('none',):
                out['fills'].append({'box': box, 'fill': fill})
            return
        elif tag in ('circle', 'ellipse'):
            cx, cy = ap(m2, fnum(el.get('cx')), fnum(el.get('cy')))
            r = fnum(el.get('r') or el.get('rx')) * sc
            out['tts'].append({'x': cx, 'y': cy, 'r': r})
            return
        elif tag == 'text':
            size = fnum(st.get('font-size', 12)) * sc
            items = []
            if (el.text or '').strip():
                items.append((ap(m2, fnum(el.get('x')), fnum(el.get('y'))), el.text))
            for ts in el.iter(NS + 'tspan'):
                sst = style_of(ts, st)
                p = ap(m2, fnum(ts.get('x')), fnum(ts.get('y')))
                if ts.text: items.append((p, ts.text))
                size = max(size, fnum(sst.get('font-size', size)) * sc)
            if items:
                txt = ''.join(t for _, t in items)
                x0 = items[0][0][0]; y0 = items[0][0][1]
                out['texts'].append({'s': txt, 'x': x0, 'y': y0, 'size': size,
                                     'x1': items[-1][0][0] + size * len(items[-1][1]) * (1 if re.search(r'[^\x00-\x7f]', items[-1][1]) else 0.55)})
            return
        if polys:
            for pl in polys:
                pts = [ap(m2, x, y) for x, y in pl]
                if stroke in ('none', None) or sw == 0:
                    # 塗りだけのパス：転車台（灰色の円）など
                    if fill and fill.lower() in ('#bfbfbf',):
                        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                        out['tts'].append({'x': (min(xs) + max(xs)) / 2, 'y': (min(ys) + max(ys)) / 2, 'r': (max(xs) - min(xs)) / 2})
                    continue
                if fill and fill.lower() == '#bfbfbf':
                    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                    out['tts'].append({'x': (min(xs) + max(xs)) / 2, 'y': (min(ys) + max(ys)) / 2, 'r': (max(xs) - min(xs)) / 2})
                    continue
                rec = {'pts': [[round(a, 2), round(b, 2)] for a, b in pts], 'color': stroke, 'sw': round(sw, 2)}
                # 線路：電化線は 1〜1.5px、非電化線は 0.5px（色は電化方式・軌間）。
                # 0.75〜0.8px の線は車止め・ホーム柵などの記号
                is_track = (sw >= 0.95 or 0.3 <= sw <= 0.6) and stroke.lower() not in ('#fff', '#ffffff', 'white', 'none')
                if is_track:
                    rec['dashed'] = dashed
                    out['tracks'].append(rec)
                else:
                    out['thin'].append(rec)
        for ch in el:
            walk(ch, m2, inh2)

    for ch in root:
        walk(ch, [1, 0, 0, 1, 0, 0], {})
    return out

if __name__ == '__main__':
    import glob, os
    res = {}
    for f in sorted(glob.glob('/tmp/claude-0/hs/svg/*.svg')):
        try:
            res[os.path.basename(f)] = parse(f)
        except Exception as e:
            print('ERR', f, e)
    json.dump(res, open('/tmp/claude-0/hs/parsed.json', 'w'), ensure_ascii=False)
    for k, v in list(res.items())[:60]:
        print(k, 'tracks', len(v['tracks']), 'plats', len(v['plats']), 'bldg', len(v['bldgs']), 'tt', len(v['tts']), 'texts', len(v['texts']))
