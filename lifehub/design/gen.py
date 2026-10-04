import random, math
def botanical(w, h, cols, seed=3, n=14):
    r = random.Random(seed); out = []
    for i in range(n):
        x = r.uniform(0, w); base = h + 10; top = r.uniform(h*0.05, h*0.6); c = r.choice(cols)
        bend = r.uniform(-60, 60)
        out.append(f'<path d="M{x:.0f} {base} Q{x+bend/2:.0f} {(base+top)/2:.0f} {x+bend:.0f} {top:.0f}" stroke="{c}" stroke-width="1.6" fill="none" opacity=".8"/>')
        for k in range(r.randint(4, 9)):
            t = r.uniform(.2, 1); px = x + bend*t*t*1.0; py = base + (top-base)*t
            ang = r.choice([-1, 1]) * r.uniform(20, 60); L = r.uniform(14, 30)
            out.append(f'<ellipse cx="{px+ang/3:.0f}" cy="{py:.0f}" rx="{L/2:.0f}" ry="{L/5:.0f}" transform="rotate({ang:.0f} {px:.0f} {py:.0f})" fill="{r.choice(cols)}" opacity="{r.uniform(.45,.85):.2f}"/>')
    return f'<svg viewBox="0 0 {w} {h}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">{"".join(out)}</svg>'

BASE = '''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>%(title)s</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@500;700&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
<style>:root{%(vars)s}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.65 "Noto Sans TC",sans-serif}
%(css)s
.tag{font-size:11px;padding:1px 9px;border-radius:99px;background:var(--tagbg);color:var(--mut)}.mut{color:var(--mut);font-size:12.5px}
.chk{width:18px;height:18px;border:1.5px solid var(--mut);border-radius:50%%;display:inline-block;margin-right:10px;vertical-align:-3px}.chk.on{background:var(--sage);border-color:var(--sage)}
.week{display:flex;gap:5px}.week b{width:15px;height:15px;border-radius:4px;background:var(--line)}.week b.on{background:var(--ac)}
.bar{height:6px;background:var(--line);border-radius:3px;margin-top:8px}.bar i{display:block;height:100%%;background:var(--ac);border-radius:3px}
.dom{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;text-align:center;font-size:11px;color:var(--mut)}.dom i{display:block;height:6px;border-radius:3px;margin-bottom:6px}.g{background:var(--sage)}.y{background:var(--sand)}.r{background:var(--rose)}
.row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}.row:last-child{border:0}
</style></head><body>%(body)s</body></html>'''

def appbody(hero_svg, hero_css):
    return f'''<div class="hero" style="{hero_css}">{hero_svg}</div>
<div class="wrap"><div class="side"><div class="logo">LifeHub</div><nav><a class="on">今日</a><a>專案</a><a>習慣</a><a>生活</a><a>知識</a></nav></div>
<main><div class="eyebrow">10月4日 · 週日</div><h1>早安，慢慢來，但不要停</h1>
<div class="id"><q>我是一個有系統、持續精進的人</q><span class="mut">今天已投 2 票 · 本月累計 41 票</span></div>
<div class="grid"><div>
<div class="card"><h2>今日三件最重要的事</h2><div class="row"><span><i class="chk on"></i>晨跑 30 分鐘</span><span class="tag">運動</span></div><div class="row"><span><i class="chk"></i>PMBOK 第 3 章閱讀 30 分</span><span class="tag">學習</span></div><div class="row"><span><i class="chk"></i>更新作品集專案風險登記</span><span class="tag">專案</span></div></div>
<div class="card"><h2>習慣 · 身分投票</h2><div class="row"><span><b>晨間伸展</b><br><span class="mut">看到瑜珈墊 → 伸展 2 分鐘</span></span><span class="week"><b class="on"></b><b class="on"></b><b class="on"></b><b></b><b class="on"></b><b></b><b></b></span></div><div class="row"><span><b>睡前閱讀</b><br><span class="mut">刷牙後 → 翻開書 2 頁</span></span><span class="week"><b class="on"></b><b></b><b class="on"></b><b class="on"></b><b class="on"></b><b></b><b></b></span></div></div>
</div><div>
<div class="card"><h2>專案健康 · 攝影作品集</h2><div class="dom"><div><i class="g"></i>治理</div><div><i class="g"></i>範疇</div><div><i class="y"></i>時程</div><div><i class="g"></i>財務</div><div><i class="g"></i>關係人</div><div><i class="y"></i>資源</div><div><i class="r"></i>風險</div></div><p class="mut" style="margin:12px 0 0">風險：場地授權尚未確認 · 下一里程碑 10/18</p><div class="bar"><i style="width:62%"></i></div></div>
<div class="card"><div class="eyebrow">本週運動</div><div class="num">90 <small class="mut">/ 150 分</small></div><div class="bar"><i style="width:60%"></i></div></div>
<div class="card"><div class="eyebrow">閱讀中</div><b>原子習慣</b> <span class="mut">38%</span><div class="bar"><i style="width:38%"></i></div></div>
</div></div></main></div>'''

APPCSS = '''.hero{height:200px;position:relative;overflow:hidden}.hero svg{position:absolute;inset:0;width:100%%;height:100%%}
.wrap{display:grid;grid-template-columns:170px 1fr;max-width:1040px;margin:-48px auto 0;position:relative;gap:8px;padding:0 20px 40px}
.side{padding:64px 8px 0}.logo{font:700 20px "Noto Serif TC",serif;letter-spacing:.04em}nav{margin-top:22px;display:grid;gap:3px}nav a{padding:7px 12px;border-radius:10px;color:var(--mut)}nav a.on{background:var(--card);color:var(--tx);box-shadow:0 1px 3px var(--shadow)}
main{background:var(--paper);border-radius:22px 22px 0 0;padding:28px 30px;box-shadow:0 -2px 24px var(--shadow)}
.eyebrow{font-size:11px;letter-spacing:.18em;color:var(--ac);text-transform:uppercase}h1{font:700 27px "Noto Serif TC",serif;margin:2px 0 12px}h2{font:700 15.5px "Noto Serif TC",serif;margin:0 0 8px}
.id{border-radius:16px;background:var(--card);padding:16px 20px;margin:14px 0 18px;box-shadow:0 1px 4px var(--shadow)}.id q{font:500 18px "Noto Serif TC",serif;quotes:"「" "」"}.id .mut{display:block;margin-top:4px}
.grid{display:grid;grid-template-columns:1.2fr 1fr;gap:16px}.card{background:var(--card);border-radius:16px;padding:16px 18px;margin-bottom:16px;box-shadow:0 1px 4px var(--shadow)}.num{font:500 28px "Noto Serif TC",serif}
@media(max-width:760px){.wrap{grid-template-columns:1fr}.side{display:none}.grid{grid-template-columns:1fr}main{padding:20px 16px}}'''

# A: 暖米大地
A_vars='--bg:#E9E1D3;--paper:#F4EFE6;--card:#FBF8F2;--tx:#3B2F27;--mut:#8A7B6C;--line:#E4DACB;--ac:#7A5A43;--sage:#8FA58A;--sand:#D1B27A;--rose:#C48B7E;--tagbg:#EFE7DA;--shadow:rgba(90,70,50,.10)'
a_hero=botanical(1200,200,['#8FA58A','#A9B79F','#7A5A43','#C9B79C'],seed=5,n=16)
A=BASE%dict(title='方案 A · 暖米大地',vars=A_vars,css=APPCSS%{} if False else APPCSS.replace('%%','%'),body=appbody(a_hero,'background:linear-gradient(120deg,#E7D9C3,#D9C7A8 55%,#C9B596)'))
# B: 深木炭暖光
B_vars='--bg:#14110F;--paper:#1C1917;--card:#26221F;--tx:#EDE6DA;--mut:#A39A8C;--line:#38322D;--ac:#D9A566;--sage:#9DB09A;--sand:#D9A566;--rose:#C98C84;--tagbg:#2F2A26;--shadow:rgba(0,0,0,.35)'
b_hero=botanical(1200,200,['#9DB09A','#6F8470','#D9A566','#B58A5B'],seed=9,n=16)
B=BASE%dict(title='方案 B · 深木炭暖光',vars=B_vars,css=APPCSS.replace('%%','%'),body=appbody(b_hero,'background:radial-gradient(ellipse at 80% 20%,#6B4A2B 0,#2B211A 55%,#14110F)'))

# C: Notion 植物頁（照使用者範例）
C_vars='--bg:#FCFBF9;--paper:#FCFBF9;--card:#FFFFFF;--tx:#2B2D35;--mut:#8B8E97;--line:#ECEAE4;--ac:#3C3E4A;--sage:#B6B8AB;--sand:#E0DFD2;--rose:#C9A9A6;--tagbg:#EFEEE6;--shadow:rgba(0,0,0,.05);--moss:#B6B8AB;--smoke:#9FA3AD;--garden:#E0DFD2;--ivory:#F3F1EC;--midnight:#3C3E4A'
c_hero=botanical(1200,210,['#8E9279','#B6B8AB','#6B6F5A','#C9C7B5'],seed=2,n=22)
def thumb(seed,cols): return botanical(220,110,cols,seed=seed,n=7)
C_css='''.hero{height:210px;background:linear-gradient(#F3F1EC,#EEEBE2);position:relative;overflow:hidden}.hero svg{position:absolute;inset:0;width:100%;height:100%}
.page{max-width:900px;margin:auto;padding:0 28px 60px}h1{font:700 34px "Noto Sans TC",sans-serif;margin:30px 0 14px;letter-spacing:-.01em}h2{font:700 14px "Noto Sans TC";margin:0 0 10px;text-transform:lowercase;letter-spacing:.02em}
.prop{color:var(--mut);padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
.cols{display:grid;grid-template-columns:150px 1fr;gap:22px;margin-top:20px}.ql b{display:block;font-size:12px;margin-bottom:8px}.ql a{display:block;padding:5px 0;color:var(--tx);font-size:14px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.c{border:1px solid var(--line);border-radius:6px;overflow:hidden;background:#fff}.c .im{height:84px;background:var(--ivory);position:relative}.c .im svg{position:absolute;inset:0;width:100%;height:100%}.c div.t{padding:9px 10px;font-size:13px}.c .mut{font-size:11.5px}
.kan{display:grid;grid-template-columns:repeat(4,1fr) 190px;gap:10px;margin-top:26px}.col{background:#F8F7F3;border-radius:6px;padding:8px}.col h3{font-size:12px;margin:2px 4px 8px;color:var(--mut)}.col h3 span{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.k{background:#fff;border:1px solid var(--line);border-radius:5px;padding:9px 10px;margin-bottom:7px;font-size:13px}.k .mut{font-size:11px;display:block;margin-top:3px}
.today{border-left:1px solid var(--line);padding-left:10px}.btn{display:block;text-align:center;background:var(--moss);color:#2B2D35;border-radius:6px;padding:9px;margin-top:10px;font-size:13px}
.sw{display:flex;gap:8px;margin:26px 0 0}.sw div{flex:1;height:44px;border-radius:8px;font-size:10px;padding:6px 8px;color:#2B2D35}
@media(max-width:760px){.cols{grid-template-columns:1fr}.cards{grid-template-columns:1fr 1fr}.kan{grid-template-columns:1fr 1fr}.today{display:none}}'''
cards=''.join(f'<div class="c"><div class="im">{thumb(s,cols)}</div><div class="t">{n}<br><span class="mut">{m}</span></div></div>' for s,cols,n,m in [(11,['#8E9279','#B6B8AB'],'有系統的人','身分 · 41 票'),(12,['#9FA3AD','#B6B8AB'],'健康活力的人','身分 · 28 票'),(13,['#6B6F5A','#C9C7B5'],'持續閱讀的人','身分 · 19 票'),(14,['#8E9279','#9FA3AD'],'會創作的人','身分 · 12 票')])
C_body=f'''<div class="hero">{c_hero}</div><div class="page"><h1>— LifeHub 個人儀表板</h1>
<div class="prop">＋ 身分宣言 　我是一個有系統、持續精進的人</div><div class="prop">⌁ 今天已投 2 票 · 本月累計 41 票</div>
<div class="cols"><div class="ql"><b>快速連結</b><a>今日</a><a>專案</a><a>習慣</a><a>運動</a><a>財務</a><a>筆記</a><a>閱讀清單</a><a>每週回顧</a></div>
<div><h2>我的身分</h2><div class="cards">{cards}</div>
<h2 style="margin-top:22px">習慣 · 本週</h2><div class="row"><span>晨間伸展 <span class="mut">看到瑜珈墊 → 伸展 2 分鐘</span></span><span class="week"><b class="on"></b><b class="on"></b><b class="on"></b><b></b><b class="on"></b><b></b><b></b></span></div><div class="row"><span>睡前閱讀 <span class="mut">刷牙後 → 翻開書 2 頁</span></span><span class="week"><b class="on"></b><b></b><b class="on"></b><b class="on"></b><b class="on"></b><b></b><b></b></span></div></div></div>
<h2 style="margin-top:28px">專案 · 攝影作品集</h2>
<div class="kan"><div class="col"><h3><span style="background:#9FA3AD"></span>待做 2</h3><div class="k">選定 12 張主圖<span class="mut">22 天 · 攝影</span></div><div class="k">撰寫創作自述<span class="mut">30 天 · 寫作</span></div></div>
<div class="col"><h3><span style="background:#C9A9A6"></span>風險 1</h3><div class="k">場地授權確認<span class="mut">逾期 2 天</span></div></div>
<div class="col"><h3><span style="background:#E0C98A"></span>進行中 2</h3><div class="k">後製調色<span class="mut">10 天</span></div><div class="k">網站排版<span class="mut">16 天</span></div></div>
<div class="col"><h3><span style="background:#8E9279"></span>完成 2</h3><div class="k">拍攝清單<span class="mut">已完成</span></div><div class="k">主題定稿<span class="mut">已完成</span></div></div>
<div class="today"><h2>今日</h2><div class="k"><b>快速筆記</b><span class="mut">· 晨跑 30 分<br>· PMBOK 第 3 章</span></div><div class="k"><b>本週運動</b><span class="mut">90 / 150 分</span><div class="bar"><i style="width:60%"></i></div></div><div class="btn">開始本週回顧</div></div></div>
<div class="sw"><div style="background:#F3F1EC">Ivory #F3F1EC</div><div style="background:#B6B8AB">Moss #B6B8AB</div><div style="background:#9FA3AD">Smoke #9FA3AD</div><div style="background:#E0DFD2">Garden #E0DFD2</div><div style="background:#3C3E4A;color:#fff">Midnight #3C3E4A</div></div></div>'''
C=BASE%dict(title='方案 C · 植物 Notion 頁',vars=C_vars,css=C_css,body=C_body)
for n,h in (('a',A),('b',B),('c',C)): open(f'mockup-{n}.html','w').write(h)
open('index.html','w').write('''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LifeHub 設計方案</title><body style="font:16px/1.7 -apple-system,'PingFang TC',sans-serif;max-width:560px;margin:40px auto;padding:0 20px"><h1>LifeHub 設計方案</h1><p><a href="mockup-a.html">A · 暖米大地系（亮）</a></p><p><a href="mockup-b.html">B · 深木炭暖光（暗）</a></p><p><a href="mockup-c.html">C · 植物 Notion 頁（依你的範例）</a></p></body>''')
print('ok')
