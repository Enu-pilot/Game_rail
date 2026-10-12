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
        # 前の帯の終点の先（本線を切り離した部分）は、次の帯の本線と重なるので除く
        # 前の帯の終点の先（本線から切り離した部分）は本線に戻して、そこから次の帯へつなぐ
        drop, to_main = set(), {}
        for mi, m in enumerate(out['mains']):
            e = m['pts'][-1]
            for k, t in enumerate(out['tracks']):
                if k in drop or not t.get('tail'): continue
                if abs(t['pts'][0][0] - e[0]) < 0.6 and abs(t['pts'][0][1] - e[1]) < 0.6:
                    m['pts'] = m['pts'] + t['pts'][1:]
                    drop.add(k); to_main[k] = mi
                    break
        parts_tail_pts = {k: out['tracks'][k]['pts'] for k in drop}
        if drop:
            remap, keep = {}, []
            for k, t in enumerate(out['tracks']):
                if k in drop: continue
                remap[k] = len(keep); keep.append(t)
            out['tracks'] = keep
            cr = []
            for c in out['crossings']:
                ok = True
                for key in ('a', 'b'):
                    if c[key][0] != 't': continue
                    if c[key][1] in to_main: c[key] = ['m', to_main[c[key][1]]]
                    elif c[key][1] in drop: ok = False
                    else: c[key][1] = remap[c[key][1]]
                if ok: cr.append(c)
            out['crossings'] = cr
            # 除いた線にだけつながっていた端は、場外へ続く端にする
            def near_poly(e, pts):
                return any(dist_seg(e, pts[j - 1], pts[j])[0] < 0.6 for j in range(1, len(pts)))
            others = [t['pts'] for t in out['tracks']] + [m['pts'] for m in out['mains']]
            for t in out['tracks']:
                for w in (0, -1):
                    e = t['pts'][w]
                    if t['ends'][w] != 'open' or not any(near_poly(e, parts_tail_pts[k]) for k in drop): continue
                    if any(o is not t['pts'] and near_poly(e, o) for o in others): continue
                    t['ends'][w] = 'boundary'
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
        for n, e in p.get('extra', {}).items():
            out.setdefault('extra', {})[n] = dict(x=e['x'] + dx, plats=[[q[0] + dx, q[1] + dy, q[2] + dx, q[3] + dy] for q in e['plats']])
    # つないだ部分も含めて交差を数え直す
    out['crossings'] = compute_crossings(out['mains'], out['tracks'])
    return out

def slim(d):
    keep = ('x0', 'x1', 'mains', 'tracks', 'stations', 'bldgs', 'tts', 'texts', 'depots', 'crossings', 'extra')
    d = {k: d[k] for k in keep}
    d['texts'] = [t for t in d['texts'] if t['s'].endswith('方')]
    for t in d['tracks']:
        t.pop('reach', None)
        if not t.get('foreign'): t.pop('foreign', None)
    return d


def synth_part(names, types):
    """配線図のない区間（計画中の延伸区間など）を、標準的な駅配線で作る。
    types: 駅ごとの 's'（相対式2面2線）/ 'p'（2面4線・通過線つき）/ 't'（終端・島式2面4線）"""
    Y0, Y1 = 50.0, 68.0          # 下り・上り本線
    x = 0.0
    mains = [dict(pts=[[0.0, Y0]], under=[], ends=['boundary', 'boundary']), dict(pts=[[0.0, Y1]], under=[], ends=['boundary', 'boundary'])]
    tracks, stations = [], []
    for n, ty in zip(names, types):
        x += 120.0
        cx = x + 40.0
        st = dict(name=n, x=cx, plats=[], ext=[x, x + 80.0], mainPlat=[])
        if ty == 't':
            # 終端：本線がそのまま島式ホームの番線になり、外側にもう1線ずつ
            for m in mains: m['pts'].append([x + 70.0, m['pts'][-1][1]]); m['ends'][1] = 'buffer'
            st['plats'] = [[x + 20, Y0 + 3, x + 70, Y1 - 3]]
            st['mainPlat'] = [0, 1]
            for yy, ym, use in ((Y0 - 12, Y0, 'down'), (Y1 + 12, Y1, 'up')):
                tracks.append(dict(pts=[[x, ym], [x + 8, yy], [x + 70, yy]], ends=['open', 'buffer'], under=False, stations=[n], use=use))
                st['plats'].append([x + 20, min(yy, ym) + 3 if yy > ym else yy + 3, x + 70, max(yy, ym) - 3 if yy > ym else ym - 3])
            stations.append(st)
            x += 80
            break
        if ty == 'p':
            # 2面4線：外側の副本線にホーム、本線は通過線
            for yy, ym, use in ((Y0 - 12, Y0, 'down'), (Y1 + 12, Y1, 'up')):
                tracks.append(dict(pts=[[x, ym], [x + 10, yy], [x + 70, yy], [x + 80, ym]], ends=['open', 'open'], under=False, stations=[n], use=use))
            st['plats'] = [[x + 15, Y0 - 21, x + 65, Y0 - 15], [x + 15, Y1 + 15, x + 65, Y1 + 21]]
        else:
            st['plats'] = [[x + 15, Y0 - 9, x + 65, Y0 - 3], [x + 15, Y1 + 3, x + 65, Y1 + 9]]
            st['mainPlat'] = [0, 1]
        stations.append(st)
        x += 80.0
    for m in mains:
        if m['ends'][1] != 'buffer': m['pts'].append([x + 40.0, m['pts'][-1][1]])
    x1 = max(m['pts'][-1][0] for m in mains)
    return dict(page='synth', rot=False, keys=[], missing=[], x0=0.0, x1=x1, mains=mains, tracks=tracks, stations=stations,
                bldgs=[], tts=[], texts=[], depots=[], crossings=[], plains=[], extra={})

def build_line(sample, line, parts, shared0=False, ring=False):
    names = names_of(sample, line)
    out = []
    pos = 0
    for k, pt in enumerate(parts):
        page, a, b = pt['page'], pt['from'], pt['to']
        i, j = names.index(a), names.index(b)
        seg = names[i:j + 1]
        if page == 'synth':
            # 前の帯に続く区間：最初の駅（接続駅）は前の帯の方にあるので、その次から
            out.append(synth_part(seg[1:], list(pt['types'])))
            out[-1]['stations'] = [dict(name=a, x=None)] + out[-1]['stations']
            continue
        first = (not shared0) if k == 0 else False
        p = export_part(page, seg, n_mains=pt.get('n', 2), first_complex=first,
                        last_complex=True, seed=pt.get('seed'), prefer=pt.get('prefer', (1, -1)),
                        pick=pt.get('pick'), seed_between=pt.get('between'), keys=pt.get('keys'), flip=pt.get('flip', ()), extra_names=pt.get('extra', ()), color=pt.get('color'))
        out.append(p)
    d = merge_parts(out)
    if ring and names[-1] == names[0] and d['stations'][-1]['name'] != names[-1]:
        d['stations'].append(dict(name=names[-1], x=None))   # 環状線の継目の駅（起点と同じ駅）
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
    'kintetsu': {
        'nara': dict(parts=[part('pr/kinki/namba', '大阪難波', '大阪上本町'), part('pr/kinki/osaka', '大阪上本町', '布施', pick=[0, 2], between=('鶴橋', '布施', 0.5)),
                            part('pr/kinki/nara', '布施', '近鉄奈良')]),
        'hanshin': dict(shared0=True, parts=[part('pr/hanshin/namba', '大阪難波', '尼崎'), part('pr/hanshin/main', '尼崎', '神戸三宮')]),
        'kyoto': dict(shared0=True, parts=[part('pr/kinki/kyoto', '大和西大寺', '京都')]),
        'kashihara': dict(shared0=True, parts=[part('pr/kinki/kashihara', '大和西大寺', '橿原神宮前')]),
    },
    'osaka': {
        'kanjo': dict(ring=True, parts=[part('jr/west/osakakanjo', '天王寺', '新今宮', flip=('jr_west_osakakanjo__020_01.svg',))]),
        'hanwa': dict(shared0=True, parts=[part('jr/west/hanwa', '天王寺', '和歌山')]),
        'kanku': dict(shared0=True, parts=[part('jr/west/kansai-airport', '日根野', '関西空港')]),
        'yamatoji': dict(shared0=True, parts=[part('jr/west/kansai', '天王寺', '加茂')]),
        'yumesaki': dict(shared0=True, parts=[part('jr/west/sakurajima', '西九条', '桜島')]),
    },
    'ichibata': {
        'kitamatsue': dict(parts=[part('pr/ichibata/kitamatsue', '電鉄出雲市', '松江しんじ湖温泉', n=1)]),
        'taisha': dict(parts=[part('pr/ichibata/taisha', '川跡', '出雲大社前', n=1)]),
    },
    'tokaido': {
        'tokaido': dict(parts=[part('jr/shinkansen/tokaido', '東京', '新大阪')]),
        'sanyo': dict(shared0=True, parts=[part('jr/shinkansen/sanyo', '新大阪', '博多')]),
        'kyushu': dict(shared0=True, parts=[part('jr/shinkansen/kyushu', '博多', '鹿児島中央')]),
    },
    'tohoku': {
        'tohoku': dict(parts=[part('jr/shinkansen/tohoku', '東京', '新青森')]),
        'joetsu': dict(shared0=True, parts=[part('jr/shinkansen/joetsu', '大宮', '新潟')]),
        'hokurikuE': dict(shared0=True, parts=[part('jr/shinkansen/hokuriku', '高崎', '上越妙高')]),
        'hokurikuW': dict(shared0=True, parts=[part('jr/shinkansen/hokuriku', '上越妙高', '敦賀')]),
        'akita': dict(shared0=True, parts=[part('jr/east/tazawako', '盛岡', '大曲', n=1), part('jr/east/ou_1', '大曲', '秋田', n=1, color='#0070c0')]),
        'yamagata': dict(shared0=True, parts=[part('jr/east/ou_1', '福島', '新庄', n=1)]),
        'hokkaido': dict(shared0=True, parts=[part('jr/shinkansen/hokkaido', '新青森', '新函館北斗'), part('synth', '新函館北斗', '札幌', types='ppppt')]),
    },
    'tobu': {
        'isesaki': dict(parts=[part('pr/tobu/isesaki', '浅草', '東武動物公園')]),
        'nikko': dict(shared0=True, parts=[part('pr/tobu/nikko', '東武動物公園', '東武日光')]),
        'kinugawa': dict(shared0=True, parts=[part('pr/tobu/kinugawa', '下今市', '新藤原', n=1)]),
    },
    'nankai': {
        'honsen': dict(parts=[part('pr/nankai/main', '難波', '和歌山市', extra=('今宮戎', '萩ノ茶屋'))]),
        'kuko': dict(shared0=True, parts=[part('pr/nankai/airport', '泉佐野', '関西空港')]),
        'koya': dict(shared0=True, parts=[part('pr/nankai/koya', '岸里玉出', '極楽橋')]),
    },
    'asakusa': {
        'asakusa': dict(parts=[part('metro/tokyotoei/asakusa', '西馬込', '押上')]),
        'keikyu': dict(shared0=True, parts=[part('pr/keikyu/main', '泉岳寺', '堀ノ内'), part('pr/keikyu/kurihama', '堀ノ内', '三崎口')]),
        'haneda': dict(shared0=True, parts=[part('pr/keikyu/kuko', '京急蒲田', '羽田空港第1・第2ターミナル')]),
        'keisei': dict(shared0=True, parts=[part('pr/keisei/oshiage', '押上', '青砥'), part('pr/keisei/main', '青砥', '成田空港')]),
        'ueno': dict(shared0=True, parts=[part('pr/keisei/main', '青砥', '京成上野')]),
        'access': dict(shared0=True, parts=[part('pr/keisei/naritakuko', '京成高砂', '成田空港（アクセス線）')]),
    },
}

def fix_ichibataguchi(d):
    """一畑口（スイッチバック駅）：園からの線は図では駅の東端（松江方と同じ側）に入るが、
    折り返し線がないと入線できないので、駅の西端からホームの線に入る形にする（停車時間で折り返しを見込む）"""
    st = next(s for s in d['stations'] if s['name'] == '一畑口')
    x0 = st['ext'][0]
    m = d['mains'][0]
    # 駅の手前まで本線、その先は西端（車止め）の線へ
    k = next(i for i, p in enumerate(m['pts']) if p[0] >= x0 - 1)
    tail = m['pts'][k:]
    for t in d['tracks']:
        if '一畑口' in t['stations'] and t['ends'][1] == 'buffer' and abs(t['pts'][0][0] - tail[-1][0]) < 1 and abs(t['pts'][0][1] - tail[-1][1]) < 1:
            west = t['pts'][-1]
            m['pts'] = m['pts'][:k] + [[west[0] - 12, m['pts'][k - 1][1]], west]
            m['ends'][1] = 'open'
            t['ends'][1] = 'open'
            t['ends'][0] = 'buffer'      # 東端は、園からの線が入っていたところ
            break
    return d

FIXES = {('ichibata', 'kitamatsue'): fix_ichibataguchi}

if __name__ == '__main__':
    only = sys.argv[1:]
    for sample, lines in CONFIG.items():
        if only and sample not in only: continue
        data = {}
        for line, cfg in lines.items():
            print(sample, line)
            try:
                data[line] = build_line(sample, line, cfg['parts'], cfg.get('shared0', False), cfg.get('ring', False))
                if (sample, line) in FIXES: data[line] = FIXES[(sample, line)](data[line])
            except Exception as e:
                print('  !! 失敗', sample, line, e)
        js = '// 配線略図.net（https://www.haisenryakuzu.net/、CC BY 4.0）の配線図から読み取った駅の配線\n' \
             '// 自動生成：手で編集しない\nexport default ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
        open(f'/home/user/Game_rail/src/samples/data/{sample}.js', 'w').write(js)
        print('  ->', len(js) // 1024, 'KB')
