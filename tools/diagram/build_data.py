# サンプルごとの配線データ（src/samples/data/<sample>.js）を書き出す
import sys, json
sys.path.insert(0, '/tmp/claude-0/hs')
from export import *

SPECS = json.load(open('/tmp/claude-0/ref/specs.json'))

def names_of(sample, line):
    return [s['name'] for s in SPECS if s['sample'] == sample and s['line'] == line]

def merge_parts(parts):
    """複数ページの帯を横につなぐ（前の帯の本線の終わりと、次の帯の本線の始まりをつなぐ）"""
    if len(parts) == 1: return parts[0]
    out = json.loads(json.dumps(parts[0]))
    for p in parts[1:]:
        p = json.loads(json.dumps(p))
        dx = out['x1'] + 30 - p['x0']
        # 縦：本線の中心をそろえる
        def ends_y(part, last):
            ys = [(m['pts'][-1] if last else m['pts'][0])[1] for m in part['mains']]
            return sum(ys) / len(ys)
        dy = ends_y(out, True) - ends_y(p, False)
        sh = lambda q: [q[0] + dx, q[1] + dy]
        for m in p['mains']: m['pts'] = [sh(q) for q in m['pts']]; m['under'] = [[a + dx, b + dx] for a, b in m['under']]
        for t in p['tracks']: t['pts'] = [sh(q) for q in t['pts']]
        for s in p['stations']:
            if s.get('x') is not None:
                s['x'] += dx; s['ext'] = [s['ext'][0] + dx, s['ext'][1] + dx]
                s['plats'] = [[b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy] for b in s['plats']]
        # 本線どうしをつなぐ（数が同じなら順に、違えば近いものへ）
        A = out['mains']; B = p['mains']
        for k, m in enumerate(B):
            src = A[k] if len(A) == len(B) else min(A, key=lambda a: abs(a['pts'][-1][1] - m['pts'][0][1]))
            src['pts'] = src['pts'] + m['pts']
            src['under'] += m['under']
            src['ends'][1] = m['ends'][1]
        out['mains'] = A
        nt = len(out['tracks'])
        out['tracks'] += p['tracks']
        for c in p['crossings']:
            c['x'] += dx; c['y'] += dy
            for key in ('a', 'b'):
                if c[key][0] == 't': c[key][1] += nt
        out['crossings'] += p['crossings']
        out['stations'] = out['stations'] + p['stations'][1:]   # 接続駅は前の帯の方
        out['bldgs'] += [[b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy] for b in p['bldgs']]
        out['tts'] += [dict(x=t['x'] + dx, y=t['y'] + dy, r=t['r']) for t in p['tts']]
        out['texts'] += [dict(t, x=t['x'] + dx, x1=t['x1'] + dx, y=t['y'] + dy) for t in p['texts']]
        out['depots'] += [dict(t, x=t['x'] + dx, x1=t['x1'] + dx, y=t['y'] + dy) for t in p['depots']]
        out['plains'] += [[a + dx, b + dx] for a, b in p['plains']]
        out['x1'] = p['x1'] + dx
        out['missing'] += p['missing']
    return out

def slim(d):
    keep = ('x0', 'x1', 'mains', 'tracks', 'stations', 'bldgs', 'tts', 'texts', 'depots', 'crossings')
    d = {k: d[k] for k in keep}
    d['texts'] = [t for t in d['texts'] if t['s'].endswith('方')]
    for t in d['tracks']:
        t.pop('reach', None)
        if not t.get('foreign'): t.pop('foreign', None)
    return d

def build_line(sample, line, parts, shared0=False):
    names = names_of(sample, line)
    out = []
    pos = 0
    for k, pt in enumerate(parts):
        page, a, b = pt['page'], pt['from'], pt['to']
        i, j = names.index(a), names.index(b)
        seg = names[i:j + 1]
        first = (not shared0) if k == 0 else False
        p = export_part(page, seg, n_mains=pt.get('n', 2), first_complex=first,
                        last_complex=True, seed=pt.get('seed'), prefer=pt.get('prefer', (1, -1)),
                        pick=pt.get('pick'), seed_between=pt.get('between'), keys=pt.get('keys'))
        out.append(p)
    d = merge_parts(out)
    if d['missing']: print('  !! 駅名が見つからない', sample, line, d['missing'])
    return slim(d)

def part(page, a, b, **kw):
    d = dict(page=page, **kw); d['from'] = a; d['to'] = b
    return d

CONFIG = {
    'toyoko': {
        'toyoko': dict(parts=[part('pr/tokyu/toyoko', '渋谷', '横浜')]),
        'fukutoshin': dict(shared0=True, parts=[part('metro/tokyometro/fukutoshin', '渋谷', '池袋'),
                                                 part('metro/tokyometro/yurakucho', '池袋', '小竹向原', pick=[0, 1], between=('池袋', '要町', 0.5))]),
        'yurakucho': dict(shared0=True, parts=[part('metro/tokyometro/yurakucho', '小竹向原', '和光市')]),
        'tojo': dict(shared0=True, parts=[part('pr/tobu/tojo', '和光市', '森林公園', pick=[1, 2], between=('朝霞', '朝霞台', 0.5))]),
        'seibu': dict(shared0=True, parts=[part('pr/seibu/yurakucho', '小竹向原', '練馬'),
                                            part('pr/seibu/ikebukuro', '練馬', '小手指')]),
        'minatomirai': dict(shared0=True, parts=[part('pr/yokohamakosoku/minatomirai', '横浜', '元町・中華街')]),
        'shinyoko': dict(shared0=True, parts=[part('pr/tokyu/shinyokohama', '日吉', '新横浜')]),
        'sotetsu': dict(shared0=True, parts=[part('pr/sagami/shinyokohama', '新横浜', '西谷', pick=[-2, -1], between=('新横浜', '羽沢横浜国大', 0.5)),
                                              part('pr/sagami/main', '西谷', '海老名')]),
    },
}

if __name__ == '__main__':
    for sample, lines in CONFIG.items():
        data = {}
        for line, cfg in lines.items():
            print(sample, line)
            try:
                data[line] = build_line(sample, line, cfg['parts'], cfg.get('shared0', False))
            except Exception as e:
                print('  !! 失敗', sample, line, e)
        js = '// 配線略図.net（https://www.haisenryakuzu.net/、CC BY 4.0）の配線図から読み取った駅の配線\n' \
             '// 自動生成：手で編集しない\nexport default ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
        open(f'/home/user/Game_rail/src/samples/data/{sample}.js', 'w').write(js)
        print('  ->', len(js) // 1024, 'KB')
