import sys, struct, glob, os
class R:
    def __init__(s,d): s.d=d; s.p=0
    def b(s): v=s.d[s.p]; s.p+=1; return v
    def n(s,k): v=s.d[s.p:s.p+k]; s.p+=k; return v
    def ss(s): l=s.b(); return s.n(l).decode('cp1252')
    def peek(s): return s.d[s.p]
def val(r,ind):
    t=r.b()
    if t==0: return 'nil?'
    if t==1:
        items=[]
        while r.peek()!=0: items.append(val(r,ind+1))
        r.b(); return '('+' '.join(items)+')'
    if t==2: return str(struct.unpack('<b',r.n(1))[0])
    if t==3: return str(struct.unpack('<h',r.n(2))[0])
    if t==4: return str(struct.unpack('<i',r.n(4))[0])
    if t==5: r.n(10); return '<ext>'
    if t==6: return repr(r.ss())
    if t==7: return r.ss()
    if t==8: return 'False'
    if t==9: return 'True'
    if t==10: l=struct.unpack('<i',r.n(4))[0]; r.n(l); return f'<binary {l}>'
    if t==11:
        it=[]
        while True:
            x=r.ss()
            if not x: break
            it.append(x)
        return '['+', '.join(it)+']'
    if t==12: l=struct.unpack('<i',r.n(4))[0]; return repr(r.n(l).decode('cp1252'))
    if t==13: return 'nil'
    if t==14:
        out=[]
        while r.peek()!=0:
            if r.peek() in (2,3,4): val(r,ind)
            assert r.b()==1
            props=[]
            while r.peek()!=0:
                nm=r.ss(); props.append(f'{nm}={val(r,ind+2)}')
            r.b(); out.append('item{'+'; '.join(props)+'}')
        r.b(); return '<'+' '.join(out)+'>'
    if t==15: r.n(4); return '<single>'
    if t in (16,17,19): r.n(8); return '<8b>'
    if t==18: l=struct.unpack('<i',r.n(4))[0]; return repr(r.n(2*l).decode('utf-16le'))
    if t==20: l=struct.unpack('<i',r.n(4))[0]; return repr(r.n(l).decode('utf8'))
    raise Exception(f'type {t} at {r.p}')
def obj(r,ind,o):
    f=r.peek()
    if f&0xF0==0xF0:
        r.b()
        if f&2: val(r,ind)
    cls=r.ss(); nm=r.ss()
    o.append('  '*ind+f'object {nm}: {cls}')
    while r.peek()!=0:
        pn=r.ss(); v=val(r,ind)
        if pn in ('Caption','Hint','Items.Strings','Lines.Strings','Text','Title','Filter','Tabs.Strings','Strings') or not pn.startswith(('Font.','Explicit','Pixels','TextHeight','Glyph','Picture','Bitmap','Icon','Data','Images')):
            o.append('  '*(ind+1)+f'{pn} = {v}')
    r.b()
    while r.peek()!=0: obj(r,ind+1,o)
    r.b()
    o.append('  '*ind+'end')
for f in sorted(glob.glob(sys.argv[1]+'/*.dfm.bin')):
    d=open(f,'rb').read(); r=R(d); assert r.n(4)==b'TPF0'
    o=[]
    try: obj(r,0,o)
    except Exception as e: o.append(f'!! parse error {e}')
    open(f.replace('.dfm.bin','.dfm.txt'),'w').write('\n'.join(o))
    print(os.path.basename(f), len(o))
