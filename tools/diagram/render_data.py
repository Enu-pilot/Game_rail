# 書き出した配線データ（帯座標）を絵にする： python3 render_data.py <sample> <line> [行の幅]
import sys, json, html as H
sample, line = sys.argv[1], sys.argv[2]
row_w = float(sys.argv[3]) if len(sys.argv) > 3 else 1200
s = open(f'/home/user/Game_rail/src/samples/data/{sample}.js').read()
D = json.loads(s[s.index('export default ') + 15:s.rindex(';')])[line]
xs = [p[0] for m in D['mains'] for p in m['pts']] + [p[0] for t in D['tracks'] for p in t['pts']]
ys = [p[1] for m in D['mains'] for p in m['pts']] + [p[1] for t in D['tracks'] for p in t['pts']]
X0, X1, Y0, Y1 = min(xs), max(xs), min(ys) - 30, max(ys) + 30
if len(sys.argv) > 5: X0, X1 = float(sys.argv[4]), float(sys.argv[5])
rows = max(1, int((X1 - X0) // row_w) + 1); rh = Y1 - Y0
o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {row_w + 20} {rows * rh}" width="{(row_w + 20) * 1.3:.0f}" height="{rows * rh * 1.3:.0f}"><rect width="100%" height="100%" fill="#fff"/>']
def poly(pts, col, w, dash=''):
    return f'<polyline fill="none" stroke="{col}" stroke-width="{w}" {dash} points="%s"/>' % ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)
for r in range(rows):
    ox = X0 + r * row_w
    o.append(f'<svg x="0" y="{r * rh}" width="{row_w + 20}" height="{rh}" viewBox="{ox - 10} {Y0} {row_w + 20} {rh}">')
    for st in D['stations']:
        for b in st.get('plats', []):
            o.append(f'<rect x="{b[0]}" y="{b[1]}" width="{b[2]-b[0]}" height="{b[3]-b[1]}" fill="#cfc" stroke="green" stroke-width=".5"/>')
        if st.get('x') is not None:
            o.append(f'<text x="{st["x"]}" y="{Y1 - 8}" font-size="11" text-anchor="middle">{H.escape(st["name"])}</text>')
            if st.get('ext'): o.append(f'<rect x="{st["ext"][0]}" y="{Y1-25}" width="{st["ext"][1]-st["ext"][0]}" height="3" fill="#fa0"/>')
    for b in D['bldgs']:
        o.append(f'<rect x="{b[0]}" y="{b[1]}" width="{b[2]-b[0]}" height="{b[3]-b[1]}" fill="none" stroke="orange" stroke-width=".6"/>')
    for t in D['tracks']:
        col = '#06f' if t.get('foreign') else ('#0a7' if t.get('stations') else '#888')
        o.append(poly(t['pts'], col, 1.0, 'stroke-dasharray="3 2"' if t.get('under') else ''))
        for w, e in ((0, t['ends'][0]), (-1, t['ends'][1])):
            p = t['pts'][w]
            if e == 'buffer': o.append(f'<circle cx="{p[0]}" cy="{p[1]}" r="1.2" fill="red"/>')
            if e == 'boundary': o.append(f'<circle cx="{p[0]}" cy="{p[1]}" r="1.2" fill="#a0f"/>')
    for k, m in enumerate(D['mains']):
        o.append(poly(m['pts'], '#d00' if k == 0 else '#0b0', 1.6))
    for t in D['texts']:
        o.append(f'<text x="{t["x"]}" y="{t["y"]}" font-size="7" fill="#a0f">{H.escape(t["s"])}</text>')
    o.append('</svg>')
o.append('</svg>')
open(f'/tmp/claude-0/hs/dbg/data_{sample}_{line}.svg', 'w').write('\n'.join(o))
