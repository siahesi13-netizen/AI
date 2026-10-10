#!/usr/bin/env python3
"""LifeHub 同步伺服器：純 Python 標準庫，SQLite 儲存。
用法: python3 server.py [--port 8080]
首次啟動會產生 token.txt（同步金鑰），手機第一次開啟時輸入即可。"""
import json, os, secrets, sqlite3, sys, time, mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).parent
STATIC = ROOT.parent / "docs"
DB = ROOT / "lifehub.db"
TOKEN_FILE = ROOT / "token.txt"
if not TOKEN_FILE.exists():
    TOKEN_FILE.write_text(secrets.token_urlsafe(9))
TOKEN = TOKEN_FILE.read_text().strip()
HEALTH_KEYS = ["steps", "exercise_min", "active_kcal", "distance_km", "diet_kcal", "protein_g", "carbs_g", "fat_g", "water_ml", "sleep_h", "weight_kg"]

def db():
    c = sqlite3.connect(DB)
    c.execute("""CREATE TABLE IF NOT EXISTS records(
        id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL,
        updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
        seq INTEGER NOT NULL)""")
    c.execute("CREATE INDEX IF NOT EXISTS i_seq ON records(seq)")
    return c

def apply(changes):
    """Last-write-wins：以客戶端 updated_at 較新者為準；seq 為伺服器單調遞增游標。"""
    c = db()
    seq = c.execute("SELECT COALESCE(MAX(seq),0) FROM records").fetchone()[0]
    for ch in changes:
        row = c.execute("SELECT updated_at FROM records WHERE id=?", (ch["id"],)).fetchone()
        if row and row[0] >= ch["updated_at"]:
            continue
        seq += 1
        c.execute("INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?)",
                  (ch["id"], ch["type"], json.dumps(ch.get("data", {}), ensure_ascii=False),
                   ch["updated_at"], 1 if ch.get("deleted") else 0, seq))
    c.commit()
    return c, seq

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, body, ctype="application/json"):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if "text" in ctype or "json" in ctype else ""))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        return self.headers.get("Authorization", "") == "Bearer " + TOKEN

    def do_GET(self):
        path, _, qs = self.path.partition("?")
        if path == "/api/sync":
            if not self.authed(): return self.send(401, {"error": "bad token"})
            since = int(dict(p.split("=") for p in qs.split("&") if "=" in p).get("since", 0))
            c = db()
            rows = c.execute("SELECT id,type,data,updated_at,deleted,seq FROM records WHERE seq>? ORDER BY seq", (since,)).fetchall()
            cur = c.execute("SELECT COALESCE(MAX(seq),0) FROM records").fetchone()[0]
            return self.send(200, {"cursor": cur, "changes": [
                {"id": r[0], "type": r[1], "data": json.loads(r[2]), "updated_at": r[3], "deleted": bool(r[4])} for r in rows]})
        f = STATIC / ("index.html" if path == "/" else path.lstrip("/"))
        if f.is_file() and STATIC in f.resolve().parents:
            return self.send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "application/octet-stream")
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/sync": return self.send(404, {"error": "not found"})
        if not self.authed(): return self.send(401, {"error": "bad token"})
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        changes = list(body.get("changes", []))
        if body.get("kind") == "health":  # 與 cloud/Code.gs 的 healthChange_ 相同：同一天合併更新
            import re
            m = re.search(r"\d{4}-\d{2}-\d{2}", str(body.get("date", "")))
            date = m.group(0) if m else time.strftime("%Y-%m-%d")
            row = db().execute("SELECT data FROM records WHERE id=?", ("hk_" + date,)).fetchone()
            data = json.loads(row[0]) if row else {}
            data.update(date=date, src="apple-health")
            for k in HEALTH_KEYS:
                if body.get(k) not in (None, ""):
                    nums = re.findall(r"-?\d+(?:\.\d+)?", re.sub(r"(\d),(?=\d{3}(\D|$))", r"\1", str(body[k])))
                    if nums: data[k] = round(sum(float(x) for x in nums), 2)  # 多行值（如 738 與補位的 0）要相加，不可相接
            changes.append({"id": "hk_" + date, "type": "health", "data": data, "updated_at": int(time.time() * 1000)})
        _, seq = apply(changes)
        self.send(200, {"cursor": seq})

if __name__ == "__main__":
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8080
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]
    except Exception: ip = "localhost"
    print(f"LifeHub 啟動\n  電腦: http://localhost:{port}\n  手機(同一 Wi-Fi): http://{ip}:{port}\n  同步金鑰: {TOKEN}")
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
