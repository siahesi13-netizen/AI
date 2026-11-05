# -*- coding: utf-8 -*-
"""回顧頁的資料整理與評論上傳（給排程的 Claude 用）。

  .venv/bin/python review.py data week 2026-10-26   印出該週的彙整 JSON（月：2026-10；年：2026）
  .venv/bin/python review.py due                    列出已結束、但還沒有評論的最近一週／一月／一年
  .venv/bin/python review.py post <key> <文字檔>     把評論寫成 rvc_<key>（網站「Claude 的回顧與評論」）

計算方式與網站回顧頁相同（docs/app.js 的 rvStats）。設定讀同資料夾的 local.json。
"""
import calendar, datetime as dt, json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, 'local.json'), encoding='utf-8'))


def load():
    req = CFG['url'] + '?token=' + CFG['token'] + '&since=0'
    for i in range(3):
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=300).read().decode())
            return {c['id']: c for c in d['changes'] if not c['deleted']}
        except Exception:  # noqa: BLE001
            if i == 2:
                raise
            time.sleep(3)


def rng(kind, key):
    if kind == 'week':
        a = dt.date.fromisoformat(key)
        return a, a + dt.timedelta(days=6)
    if kind == 'month':
        y, m = map(int, key.split('-'))
        return dt.date(y, m, 1), dt.date(y, m, calendar.monthrange(y, m)[1])
    return dt.date(int(key), 1, 1), dt.date(int(key), 12, 31)


def prev(kind, key):
    if kind == 'week':
        return (dt.date.fromisoformat(key) - dt.timedelta(days=7)).isoformat()
    if kind == 'month':
        y, m = map(int, key.split('-'))
        return f'{y - (m == 1)}-{12 if m == 1 else m - 1:02d}'
    return str(int(key) - 1)


def stats(db, kind, key):
    a, b = rng(kind, key)
    b = min(b, dt.date.today())
    A, B = a.isoformat(), b.isoformat()
    inr = lambda d: bool(d) and A <= d <= B  # noqa: E731
    of = lambda t: [r['data'] for r in db.values() if r['type'] == t]  # noqa: E731
    days = [(a + dt.timedelta(n)).isoformat() for n in range((b - a).days + 1)]
    hk = lambda d, k: (db.get('hk_' + d) or {}).get('data', {}).get(k) or 0  # noqa: E731
    habits = {r['id']: r['data'].get('name') for r in db.values() if r['type'] == 'habit'}
    logs = [x for x in of('habitlog') if inr(x.get('date'))]
    hab = {}
    for x in logs:
        n = habits.get(x.get('habit'), x.get('habit'))
        hab[n] = hab.get(n, 0) + 1
    man = {}
    for x in of('workout'):
        if inr(x.get('date')):
            man[x['date']] = man.get(x['date'], 0) + (x.get('min') or 0)
    mins = [max(man.get(d, 0), hk(d, 'exercise_min')) for d in days]
    steps = [hk(d, 'steps') for d in days if hk(d, 'steps')]
    tx = [x for x in of('txn') if not x.get('exported') and (x.get('ledger') or 'personal') == 'personal' and inr(x.get('date'))]
    out = [x for x in tx if x.get('type') == 'out' and '代墊' not in (x.get('cat') or '')]
    cats = {}
    for x in out:
        cats[x.get('cat')] = cats.get(x.get('cat'), 0) + x['amount']
    w = sorted([x for x in of('weight') if inr(x.get('date')) and (x.get('kg') or 0) > 0], key=lambda x: x['date'])
    fam = [x for x in of('fam') if A[:7] <= x.get('month', '') <= B[:7]]
    rev = (db.get(('wr_' if kind == 'week' else 'rv_') + key) or {}).get('data', {})
    return {
        'period': f'{A}~{B}', 'days': len(days),
        'habit_rate_%': round(len(logs) / (len(habits) * len(days)) * 100) if habits and days else None,
        'habit_checkins': hab, 'habits': list(habits.values()),
        'exercise_min': round(sum(mins)), 'exercise_days': sum(1 for m in mins if m),
        'workouts': [f"{x['date']} {x.get('kind')} {x.get('min')}分" for x in of('workout') if inr(x.get('date'))],
        'avg_steps': round(sum(steps) / len(steps)) if steps else None,
        'weights': [f"{x['date']}:{x['kg']}" for x in w],
        'personal_out': sum(x['amount'] for x in out), 'personal_in': sum(x['amount'] for x in tx if x.get('type') == 'in' and '代墊' not in (x.get('cat') or '')),
        'top_categories': sorted(cats.items(), key=lambda c: -c[1])[:8],
        'last_ledger_date': max([x.get('date', '') for x in of('txn')] or ['']),
        'family_out': sum(x.get('total') or 0 for x in fam) if kind != 'week' and fam else None,
        'todos_done': [x.get('text') for x in of('todo') if x.get('done') and inr(x.get('doneAt'))],
        'books_finished': [x.get('title') for x in of('book') if x.get('status') == 'done' and inr(x.get('statusAt'))],
        'gratitude': {x['date']: x.get('items') for x in of('gratitude') if inr(x.get('date')) and any(x.get('items') or [])},
        'my_reflection': {k: rev.get(k) for k in ('good', 'adjust', 'next') if rev.get(k)},
        'goals': [f"{x.get('hz')}:{x.get('title')}" for x in of('goal') if not x.get('done')],
    }


def due(db):
    t = dt.date.today()
    # 週日晚上執行時回顧剛結束的這一週，其他日子回顧上一週
    wk = (t - dt.timedelta(days=t.weekday() + (0 if t.weekday() == 6 else 7))).isoformat()
    mo = (t.replace(day=1) - dt.timedelta(days=1)).strftime('%Y-%m')
    yr = str(t.year - 1)
    out = [('week', wk), ('month', mo)] + ([('year', yr)] if t.month == 1 else [])
    return [(k, v) for k, v in out if 'rvc_' + v not in db]


def main():
    cmd = sys.argv[1]
    if cmd == 'post':
        key, text = sys.argv[2], open(sys.argv[3], encoding='utf-8').read().strip()
        rec = {'id': 'rvc_' + key, 'type': 'reviewc', 'data': {'text': text, 'at': dt.date.today().isoformat()}, 'updated_at': int(time.time() * 1000), 'deleted': False}
        try:
            urllib.request.urlopen(urllib.request.Request(CFG['url'], data=json.dumps({'token': CFG['token'], 'changes': [rec]}).encode(), headers={'Content-Type': 'text/plain'}), timeout=120).read()
        except Exception as e:  # noqa: BLE001
            print('上傳回應異常，改以重新讀取確認：', e)
        print('已寫入' if 'rvc_' + key in load() else '寫入失敗')
        return
    db = load()
    if cmd == 'due':
        print(json.dumps(due(db), ensure_ascii=False))
    elif cmd == 'data':
        kind, key = sys.argv[2], sys.argv[3]
        print(json.dumps({'this': stats(db, kind, key), 'previous': stats(db, kind, prev(kind, key))}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
