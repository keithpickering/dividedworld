"""The comparison's numbers: one row per finding of the first rehearsal, each counted the same way in both runs.
Usage: python3 metrics.py <run1 data.json> <run1 log dir> <run2 data.json> <run2 log dir> <out.json>"""
import json, re, sys, collections

KEYS = ['arc-1-honeymoon', 'arc-2-split', 'arc-3-reign', 'arc-4-meltdown', 'arc-5-handover']

def items(data, kind=None, who=None):
    for s in data:
        for d in s['days']:
            for i in d['items']:
                if (kind is None or i['kind'] == kind) and (who is None or i.get('who') == who):
                    yield s['key'], d, i

def staff_text(data):
    """Everything a player could read that the staff wrote: posts, orders, move reasons, filings."""
    return [str(i.get('text') or '') for _, _, i in items(data) if i['kind'] in ('post', 'order', 'move', 'filing')]

def count(data, logdir):
    m = {}
    qc = [i['text'] for _, _, i in items(data, 'post', 'QC-1000')]
    fg = [i['text'] for _, _, i in items(data, 'post', 'FanGaME')]
    ot = [i['text'] for _, _, i in items(data, 'post', 'ONTOPIC 5.0')]
    m['qc_998'] = (sum('998' in t for t in qc), len(qc))
    m['qc_demo'] = (sum(bool(re.search(r'demo or (the )?full game', t, re.I)) for t in qc), len(qc))
    m['qc_exists'] = (sum('already exists' in t for t in qc), len(qc))
    m['fg_fine'] = (sum(('I am fine' in t or 'This is fine' in t) for t in fg), len(fg))
    m['fg_circling'] = (sum(('circling back' in t.lower() or 'circle back' in t.lower()) for t in fg), len(fg))
    stars = collections.Counter(re.findall(r'\((\d)/5\)', ' '.join(ot)))
    m['ot_stars'] = {k: stars.get(k, 0) for k in '12345'}
    m['ot_posts'] = len(ot)
    txt = staff_text(data)
    m['robo'] = sum('robo-mcmahon' in t.lower() or 'mcmahon' in t.lower() for t in txt)
    m['system_word'] = sum(bool(re.search(r'\bthe System\b', t, re.I)) for t in txt)
    m['lower_move'] = sum(bool(re.search(r'[.!?:] [a-z][^.]{0,60} is over\.', t)) for t in txt)
    succ = [(k, d['dos']) for k, d, i in items(data, 'move') if i.get('move') == 'nameSuccessor']
    m['succ'] = len(succ)
    # Moves by FanGaME that landed on or after day 91, when he no longer holds the chair.
    late = 0
    for k, d, i in items(data, 'move', 'FanGaME'):
        if d['dos'] >= 91 and 'landed' in (i.get('status') or ''):
            late += 1
    m['late_moves'] = late
    # Filings against Pointless Post Palace posts, and how many of those argue pointlessness is a fault.
    palace = 0; pointless = 0; mood = 0; dropped = 0; itits = 0; boss_board_posts = None
    for key in KEYS:
        try:
            L = json.load(open(f'{logdir}/{key}.json'))
        except FileNotFoundError:
            continue
        raw = json.dumps(L)
        itits += len(re.findall(r'\(it/its\)', raw))
        for d in L['days']:
            for inf in d['infractions']:
                c = inf.get('call') or {}
                if 'the premise of Pointless Post Palace' in (c.get('prompt') or ''):
                    palace += 1
                    words = json.dumps(c.get('answer') or '')
                    if re.search(r'pointless', words, re.I):
                        pointless += 1
            for t in d['trims']:
                if 'profile.mood' in t['path']:
                    mood += 1
            for s in d['skips']:
                if 'token cap' in s['why'] or 'cut off' in s['why']:
                    dropped += 1
    m['palace_filings'] = palace
    m['palace_pointless'] = pointless
    m['mood_trims'] = mood
    m['meetings'] = sum(1 for s in data for d in s['days'] if d['chair'])
    m['dropped'] = dropped
    m['itits'] = itits
    m['cost'] = round(sum(s['cost'] for s in data), 2)
    return m

if __name__ == '__main__':
    d1, l1, d2, l2, out = sys.argv[1:6]
    a = count(json.load(open(d1)), l1)
    b = count(json.load(open(d2)), l2)
    json.dump({'run1': a, 'run2': b}, open(out, 'w'), indent=1)
    for k in a:
        print(f'{k:16} {a[k]!s:28} {b[k]!s}')
