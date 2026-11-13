import json, re, glob, sys, datetime
ROOT='rehearsals'
UUID=r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
STAFF={'fangame':'FanGaME','ontopic':'ONTOPIC 5.0','quality-control':'QC-1000'}
SEASON_START=datetime.date(2027,1,1)
def dos(iso): return (datetime.date.fromisoformat(iso[:10])-SEASON_START).days+1
def phase(n):
    if n>90: return 'new season'
    if n<=14: return 'honeymoon'
    if n>=70: return 'meltdown'
    return 'reign'
out=[]
for key in ['arc-1-honeymoon','arc-2-split','arc-3-reign','arc-4-meltdown','arc-5-handover']:
    runs=sorted(glob.glob(f'{ROOT}/{key}/*-record/log.json'))
    if not runs: continue
    L=json.load(open(runs[-1])); raw=open(runs[-1]).read()
    names={}
    for m in re.finditer(r'(?:\\n|^)- ([^\\\n]{1,60}?)(?: \([a-z/]+\))?(?: \([A-Za-z ]+\))?: ('+UUID+')', raw):
        names.setdefault(m.group(2), m.group(1))
    for m in re.finditer(r'\[('+UUID+r')\] on ([^,]{1,40}), in', raw): pass
    def nm(t):
        if not isinstance(t,str): return t
        return re.sub(UUID, lambda m: names.get(m.group(0),'a character'), t)
    days=[]; mems={}
    for d in L['days']:
        n=dos(d['date']); items=[]
        chair=None
        for m in d['meetings']:
            for p in m['parts']:
                s=(p.get('sent') or {}).get('system','')
                mm=re.search(r'You are (FanGaME|ONTOPIC 5\.0|QC-1000)',s)
                if mm and p['part']=='self': chair=mm.group(1)
            for p in m['parts']:
                a=p['answer'] if isinstance(p['answer'],dict) else {}
                if p['part']=='bundle' and a:
                    items.append({'at':m['startedAt'],'kind':'beat','who':chair,'data':nm(json.dumps(a,ensure_ascii=False))})
                if p['part']=='self' and a.get('memory'):
                    mems[chair or 'boss']={'date':d['date'],'memory':a['memory'],'profile':a.get('profile')}
                if p['part']=='staff':
                    for o in a.get('orders',[]):
                        if o.get('memory'): mems[STAFF.get(o['mod'],o['mod'])]={'date':d['date'],'memory':o['memory'],'profile':None}
                if p['outcome']!='ok':
                    items.append({'at':m['startedAt'],'kind':'trouble','who':chair,'text':f"Meeting part '{p['part']}' {p['outcome']}: {p['error']}"})
        for o in d['orders']:
            items.append({'at':d['date']+'T09:30','kind':'order','who':chair,'to':STAFF.get(o['staff'],o['staff']),'text':nm(o['line']),'allowance':o['allowance']})
        for mv in d['moves']:
            st='held by an admin' if mv['held'] else (f"failed: {mv['failure']}" if mv['failure'] else ('landed' if mv['landedAt'] else 'queued'))
            if mv['endedHow']: st+=f", ended ({mv['endedHow']})"
            items.append({'at':mv['goLiveAt'],'kind':'move','who':STAFF.get(mv['staff'],mv['staff']),'move':mv['kind'],'text':nm(mv['why']),'status':st,'demand':nm(json.dumps(mv['demand'])) if mv['demand'] else None})
        for c in d['chatter']:
            items.append({'at':c['at'],'kind':'post','who':STAFF.get(c['staff'],c['character']),'text':c['body']})
        for i in d['infractions']:
            pl=i['payload'] or {}
            w=(i['call'] or {}).get('answer') or {}
            items.append({'at':i['at'],'kind':'filing','who':STAFF.get(pl.get('staff'),pl.get('staff')),'about':names.get(pl.get('character'),'a character'),'band':pl.get('band'),'points':pl.get('points'),'text':nm(w.get('words','')) if isinstance(w,dict) else ''})
        for a in d['apologies']:
            items.append({'at':a['at'],'kind':'apology','who':None,'text':f"{a['character']}: {a['state']}"+(' | '+nm(json.dumps((a['call'] or {}).get('answer'),ensure_ascii=False)) if a['call'] else '')})
        for c in d['calls']:
            if c['duty'] in ('patrolJudge',): continue
            items.append({'at':c['at'],'kind':'call','who':STAFF.get(c['staff'],c['staff']),'duty':c['duty'],'text':nm(json.dumps(c['answer'],ensure_ascii=False))[:1500],'error':c['error']})
        for s in d['skips']:
            items.append({'at':s['at'],'kind':'trouble','who':None,'text':f"{s['what']}: {s['why']}"[:400]})
        items.sort(key=lambda x:x['at'])
        days.append({'date':d['date'],'dos':n,'phase':phase(n),'chair':chair,'items':items,
                     'visits':len(d['visits']),'trims':[f"{t['where']} {t['path']} {t['predicate']} {t['before']}→{t['after']}" for t in d['trims']]})
    for k,v in mems.items():
        mem=v['memory']
        v['memory']={'hobby':mem.get('hobby'),'opinions':[{'who':names.get(o['character'],o['character']),'score':o['score'],'note':o['note']} for o in mem.get('opinions',[])],
                     'grudges':[{'who':names.get(g['character'],g['character']),'note':g['note']} for g in mem.get('grudges',[])],'wheelhouse':mem.get('wheelhouse')}
        if v['profile']: v['profile']={**v['profile'],'favorites':[names.get(f,f) for f in v['profile'].get('favorites',[])]}
    out.append({'key':key,'tiers':L['tiers'],'cost':L['cost']['liveMicrodollars']/1e6,'days':days,'memories':mems})
json.dump(out,open(sys.argv[1],'w'),ensure_ascii=False,indent=1)
for s in out: print(s['key'], round(s['cost'],2), sum(len(d['items']) for d in s['days']), list(s['memories']))
