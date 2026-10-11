# -*- coding: utf-8 -*-
"""把個人記帳的 Numbers 檔（表頭為 日期／收支類型／類別／金額… 的交易明細表）同步到雲端的個人財務。

Numbers 檔是唯一來源：檔案裡有的帳目會出現在網站，從檔案刪掉或改過的帳目會跟著更新。
只影響由本工具匯入的紀錄（id 以 imp_ 開頭），在網站上手動記的帳不會被動到。

設定放在同資料夾的 local.json（不進版本控制）：
  { "url": "<Apps Script 網址>", "token": "<同步金鑰>", "file": "<Numbers 檔路徑>" }

用法：.venv/bin/python personal_ledger.py [--dry-run]
"""
import hashlib, json, os, re, sys, time, urllib.request, warnings

warnings.simplefilter('ignore')
from numbers_parser import Document  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
HEAD, PREFIX = ['日期', '收支類型', '類別', '金額'], 'imp_'


def read_rows(path):
    """回傳 [{date, type, amount, cat, acct, note}]，略過沒有日期或金額的列。"""
    out = []
    for sheet in Document(path).sheets:
        for table in sheet.tables:
            rows = table.rows(values_only=True)
            # 以表頭辨識交易明細表（不用工作表名稱：部分 Numbers 版本讀不到名稱）
            if not rows or [str(c or '').strip() for c in rows[0][:4]] != HEAD:
                continue
            for r in rows[1:]:
                if len(r) < 6 or r[0] is None or r[3] is None or not hasattr(r[0], 'strftime'):
                    continue
                a = r[3]
                if isinstance(a, str):  # 例如「NT$3,390元」
                    m = re.sub(r'[^\d.\-]', '', a)
                    a = float(m) if m not in ('', '-', '.') else 0
                if not a:
                    continue
                a = round(abs(float(a)), 2)
                out.append({'date': r[0].strftime('%Y-%m-%d'), 'type': 'in' if str(r[1]).strip() == '收入' else 'out',
                            'amount': int(a) if a == int(a) else a, 'cat': str(r[2] or '其他').strip(),
                            'acct': str(r[4] or '').strip(), 'note': str(r[5] or '').strip()})
    return out


def to_records(rows):
    """內容相同的列用出現次序區分，讓同一筆帳每次都得到同一個 id。"""
    seen, recs = {}, {}
    for x in rows:
        key = '|'.join(str(x[k]) for k in ('date', 'type', 'cat', 'amount', 'acct', 'note'))
        seen[key] = seen.get(key, 0) + 1
        rid = PREFIX + hashlib.md5(f'{key}|{seen[key]}'.encode()).hexdigest()[:12]
        recs[rid] = dict(x, ledger='personal', src='numbers')
    return recs


def call(cfg, body=None):
    if body is None:
        req = cfg['url'] + '?token=' + cfg['token'] + '&since=0'
    else:
        req = urllib.request.Request(cfg['url'], data=json.dumps(dict(body, token=cfg['token'])).encode(), headers={'Content-Type': 'text/plain'})
    for attempt in range(3):  # 讀取偶爾會遇到暫時性的錯誤，重試；寫入不重試，由呼叫端重新讀取確認
        try:
            return json.loads(urllib.request.urlopen(req, timeout=300).read().decode())
        except Exception:  # noqa: BLE001
            if body is not None or attempt == 2:
                raise
            time.sleep(3)


def main():
    dry = '--dry-run' in sys.argv
    cfg = json.load(open(os.path.join(HERE, 'local.json'), encoding='utf-8'))
    want = to_records(read_rows(os.path.expanduser(cfg['file'])))
    if not want:
        sys.exit('檔案裡讀不到任何帳目，為避免誤刪已停止。')
    cur = call(cfg)
    if cur.get('error'):
        sys.exit('讀取雲端失敗：' + str(cur['error']))
    have = {c['id'] for c in cur['changes'] if c['id'].startswith(PREFIX) and c['type'] == 'txn' and not c['deleted']}
    now = int(time.time() * 1000)
    add = [{'id': i, 'type': 'txn', 'data': d, 'updated_at': now, 'deleted': False} for i, d in want.items() if i not in have]
    gone = [{'id': i, 'type': 'txn', 'data': {}, 'updated_at': now, 'deleted': True} for i in have if i not in want]
    last = max(d['date'] for d in want.values())
    print(f'檔案 {len(want)} 筆（最新 {last}）；雲端已有 {len(have)} 筆；新增 {len(add)}、移除 {len(gone)}')
    if dry or not (add or gone):
        return
    # 伺服器偶爾會對大批次回傳非預期內容，寫入後以重新讀取的結果為準
    try:
        call(cfg, {'changes': add + gone})
    except Exception as e:  # noqa: BLE001
        print('上傳回應異常，改以重新讀取確認：', e)
    after = {c['id'] for c in call(cfg)['changes'] if c['id'].startswith(PREFIX) and c['type'] == 'txn' and not c['deleted']}
    print('同步完成' if after == set(want) else f'同步後不一致：雲端 {len(after)} 筆，檔案 {len(want)} 筆')


if __name__ == '__main__':
    main()
