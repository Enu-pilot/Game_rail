import re, os, time, subprocess
base='https://www.haisenryakuzu.net/documents/'
def get(url, out):
    if os.path.exists(out) and os.path.getsize(out)>500: return True
    for i in range(4):
        r=subprocess.run(['curl','-sS','-f','-o',out,url])
        if r.returncode==0: time.sleep(1.0); return True
        time.sleep(3*(i+1))
    print('FAIL',url); return False
idx=[]
for p in open('/tmp/claude-0/hs/pages.txt').read().split():
    key=p.replace('/','_')
    out=f'/tmp/claude-0/hs/pages/{key}.html'
    get(base+p+'/', out)
    s=open(out).read()
    for fn,title in re.findall(r'<object type="image/svg\+xml" data="\./figures/([^"]+\.svg)" title="([^"]*)"',s):
        so=f'/tmp/claude-0/hs/svg/{key}__{fn}'
        get(base+p+'/figures/'+fn, so)
        idx.append((p,fn,title))
open('/tmp/claude-0/hs/figs.tsv','w').write('\n'.join('\t'.join(x) for x in idx))
print(len(idx))
