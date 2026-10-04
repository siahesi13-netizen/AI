// LifeHub：離線優先 + 與伺服器雙向同步（last-write-wins）
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const LS = (k, v) => v === undefined ? JSON.parse(localStorage.getItem(k) || 'null') : localStorage.setItem(k, JSON.stringify(v));

// ---------- 資料層 ----------
let DB = LS('lh_db') || {}, dirty = LS('lh_dirty') || [], cursor = LS('lh_cursor') || 0;
const persist = () => { LS('lh_db', DB); LS('lh_dirty', dirty); LS('lh_cursor', cursor); };
const all = type => Object.values(DB).filter(r => r.type === type && !r.deleted).map(r => ({ id: r.id, ...r.data }));
function put(type, data, id = uid()) {
  DB[id] = { id, type, data, updated_at: Date.now(), deleted: false };
  if (!dirty.includes(id)) dirty.push(id);
  persist(); sync(); return id;
}
const patch = (id, p) => put(DB[id].type, { ...DB[id].data, ...p }, id);
function del(id) { DB[id] = { ...DB[id], deleted: true, updated_at: Date.now() }; if (!dirty.includes(id)) dirty.push(id); persist(); sync(); render(); }
const setting = (k, d) => DB['set_' + k]?.data.v ?? d;
const setSetting = (k, v) => { put('setting', { v }, 'set_' + k); };

// ---------- 同步 ----------
// 雲端模式：cfg.url 指向 Apps Script 網頁應用程式；未設定則使用同源的 Python 伺服器。
const cfg = () => LS('lh_cfg') || {};
async function api(method, body) {
  const { url, token } = cfg();
  if (url) { // Apps Script 不能讀 header、也不接受 preflight：金鑰放參數、POST 用 text/plain
    if (method === 'GET') return fetch(`${url}?token=${encodeURIComponent(token)}&since=${cursor}`);
    return fetch(url, { method: 'POST', body: JSON.stringify({ token, ...body }) });
  }
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  return method === 'GET' ? fetch('/api/sync?since=' + cursor, { headers: H }) : fetch('/api/sync', { method: 'POST', headers: H, body: JSON.stringify(body) });
}
let syncing = false;
async function sync() {
  if (!cfg().token || syncing) return;
  syncing = true; const dot = $('#sync');
  try {
    const out = dirty.map(id => DB[id]);
    if (out.length) {
      const r = await api('POST', { changes: out }); const j = await r.json();
      if (j.error === 'bad token') throw 401; if (!r.ok || j.error) throw j.error || r.status;
      dirty = dirty.filter(id => !out.includes(DB[id]) || DB[id].updated_at !== out.find(o => o.id === id).updated_at);
    }
    const r = await api('GET'); const j = await r.json(); let changed = false;
    if (j.error === 'bad token') throw 401; if (!r.ok || j.error) throw j.error || r.status;
    for (const c of j.changes) if (!DB[c.id] || DB[c.id].updated_at < c.updated_at) { DB[c.id] = c; changed = true; }
    cursor = j.cursor; persist();
    dot.className = 'ok'; dot.title = '已同步 ' + new Date().toLocaleTimeString();
    if (changed && !document.activeElement?.matches('input,textarea,select')) render();
  } catch (e) {
    dot.className = 'err'; dot.title = e === 401 ? '金鑰錯誤，點擊重設' : '離線，稍後自動重試';
  } finally { syncing = false; }
}
$('#sync').onclick = () => {
  const c = cfg();
  const url = prompt('雲端同步網址（Apps Script 部署網址；用本機伺服器請留空）', c.url || ''); if (url === null) return;
  const token = prompt('同步金鑰', c.token || ''); if (token === null) return;
  if (url.trim() !== (c.url || '')) { cursor = 0; } // 換後端要重新拉取全部
  LS('lh_cfg', { url: url.trim(), token: token.trim() }); persist(); sync();
};
setInterval(sync, 15000); addEventListener('online', sync); document.addEventListener('visibilitychange', () => !document.hidden && sync());

// ---------- 導覽 ----------
const TABS = [['home', '📊', '今日'], ['bujo', '📓', '子彈'], ['fit', '🏃', '運動'], ['fin', '💰', '財務'], ['know', '🧠', '知識']];
let tab = 'home', sub = { know: 'notes' }, ui = { date: today(), q: '', tag: '', note: null };
$('#tabs').innerHTML = TABS.map(([k, i, n]) => `<button data-k="${k}"><span>${i}</span>${n}</button>`).join('');
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) { tab = b.dataset.k; render(); scrollTo(0, 0); } };
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.k === tab));
  $('#view').innerHTML = VIEWS[tab]();
}
const val = id => $('#' + id)?.value.trim();
const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString();
const month = d => d.slice(0, 7);
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

// ---------- 子彈筆記 ----------
const SYM = { task: '•', event: '○', note: '–' }, ST = { open: '', done: '×', moved: '>' };
const bSym = b => b.kind === 'task' ? (b.state === 'done' ? '×' : b.state === 'moved' ? '>' : '•') : SYM[b.kind];
window.bujoAdd = () => { const t = val('bt'); if (!t) return; put('bullet', { text: t, kind: val('bk'), state: 'open', date: ui.date }); render(); };
window.bujoCycle = id => { const b = DB[id].data; if (b.kind !== 'task') return; patch(id, { state: { open: 'done', done: 'moved', moved: 'open' }[b.state] }); render(); };
window.bujoMigrate = id => { patch(id, { state: 'moved' }); put('bullet', { ...DB[id].data, state: 'open', date: today() }); render(); };
window.bujoDate = d => { ui.date = d; render(); };
const bujoItem = b => `<div class="item"><span><a class="wl" onclick="bujoCycle('${b.id}')" style="text-decoration:none;font-size:20px;margin-right:8px">${bSym(b)}</a><span style="${b.state === 'done' ? 'text-decoration:line-through;color:var(--mut)' : ''}">${esc(b.text)}</span></span><button class="x" onclick="del('${b.id}')">✕</button></div>`;
window.del = del;
function bujo() {
  const all_ = all('bullet'), day = all_.filter(b => b.date === ui.date);
  const stale = all_.filter(b => b.kind === 'task' && b.state === 'open' && b.date < today());
  return `<div class="card"><div class="row"><input type="date" value="${ui.date}" onchange="bujoDate(this.value)"><button class="b g" onclick="bujoDate('${today()}')">今天</button></div>
  <div class="row"><select id="bk" style="flex:0 0 90px"><option value="task">• 任務</option><option value="event">○ 事件</option><option value="note">– 筆記</option></select><input id="bt" placeholder="快速記錄…" onkeydown="event.key==='Enter'&&bujoAdd()"></div>
  <button class="b" onclick="bujoAdd()">新增</button><p class="mut">點符號切換：• 待辦 → × 完成 → &gt; 已移轉</p></div>
  <div class="card"><h2>${ui.date === today() ? '今日' : ui.date} 日誌</h2>${day.map(bujoItem).join('') || '<p class="mut">尚無記錄</p>'}</div>
  ${stale.length ? `<div class="card"><h2>未完成（可移轉到今天）</h2>${stale.map(b => `<div class="item"><span>• ${esc(b.text)} <span class="mut">${b.date}</span></span><button class="x" onclick="bujoMigrate('${b.id}')">&gt;</button></div>`).join('')}</div>` : ''}`;
}

// ---------- 運動 ----------
window.fitAdd = () => { const m = +val('fm'); if (!m) return; put('workout', { date: val('fd') || today(), kind: val('fk'), min: m, km: +val('fkm') || 0, note: val('fn') }); render(); };
window.fitGoal = () => { const g = prompt('每週運動目標（分鐘）', setting('goal', 150)); if (g) { setSetting('goal', +g); render(); } };
function fitStats() {
  const w = all('workout'), ws = weekStart(), wk = w.filter(x => x.date >= ws);
  const days = new Set(w.map(x => x.date)); let streak = 0, d = new Date();
  if (!days.has(today())) d.setDate(d.getDate() - 1);
  while (days.has(new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10))) { streak++; d.setDate(d.getDate() - 1); }
  return { w, min: wk.reduce((a, x) => a + x.min, 0), km: wk.reduce((a, x) => a + x.km, 0), n: wk.length, streak };
}
function fit() {
  const s = fitStats(), goal = setting('goal', 150), pct = Math.min(100, s.min / goal * 100);
  return `<div class="card"><h2>本週 <a class="wl" onclick="fitGoal()">目標 ${goal} 分</a></h2><div class="bar"><i style="width:${pct}%"></i></div>
  <div class="grid" style="margin-top:12px"><div><div class="big">${s.min}</div><div class="mut">分鐘</div></div><div><div class="big">${s.n}</div><div class="mut">次</div></div><div><div class="big">${s.km.toFixed(1)}</div><div class="mut">公里</div></div><div><div class="big">${s.streak}</div><div class="mut">連續天數</div></div></div></div>
  <div class="card"><h2>新增運動</h2><div class="row"><input type="date" id="fd" value="${today()}"><select id="fk">${['跑步', '重訓', '游泳', '單車', '瑜珈', '走路', '球類', '其他'].map(k => `<option>${k}</option>`).join('')}</select></div>
  <div class="row"><input id="fm" type="number" inputmode="numeric" placeholder="分鐘"><input id="fkm" type="number" inputmode="decimal" placeholder="公里（選填）"></div><input id="fn" placeholder="備註（選填）"><button class="b" onclick="fitAdd()">記錄</button></div>
  <div class="card"><h2>最近紀錄</h2>${s.w.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map(x => `<div class="item"><span>${x.date.slice(5)} <b>${esc(x.kind)}</b> ${x.min}分${x.km ? ' · ' + x.km + 'km' : ''} <span class="mut">${esc(x.note)}</span></span><button class="x" onclick="del('${x.id}')">✕</button></div>`).join('') || '<p class="mut">尚無記錄</p>'}</div>`;
}

// ---------- 財務 ----------
const CAT_OUT = ['餐飲', '交通', '居住', '購物', '娛樂', '醫療', '學習', '其他'], CAT_IN = ['薪資', '獎金', '投資', '其他'];
window.finAdd = () => { const a = +val('ft_a'); if (!a) return; put('txn', { date: val('ft_d') || today(), type: val('ft_t'), amount: a, cat: val('ft_c'), note: val('ft_n') }); render(); };
window.finType = () => { $('#ft_c').innerHTML = ($('#ft_t').value === 'out' ? CAT_OUT : CAT_IN).map(c => `<option>${c}</option>`).join(''); };
window.finBudget = () => { const g = prompt('每月預算', setting('budget', 20000)); if (g) { setSetting('budget', +g); render(); } };
window.finMonth = d => { ui.m = d; render(); };
function fin() {
  const m = ui.m || month(today()), t = all('txn').filter(x => month(x.date) === m);
  const inc = t.filter(x => x.type === 'in').reduce((a, x) => a + x.amount, 0), out = t.filter(x => x.type === 'out').reduce((a, x) => a + x.amount, 0);
  const budget = setting('budget', 20000), by = {};
  t.filter(x => x.type === 'out').forEach(x => by[x.cat] = (by[x.cat] || 0) + x.amount);
  const cats = Object.entries(by).sort((a, b) => b[1] - a[1]);
  return `<div class="card"><input type="month" value="${m}" onchange="finMonth(this.value)">
  <div class="grid"><div><div class="mut">收入</div><div class="big ok">${money(inc)}</div></div><div><div class="mut">支出</div><div class="big bad">${money(out)}</div></div></div>
  <p>結餘 <b class="${inc - out >= 0 ? 'ok' : 'bad'}">${money(inc - out)}</b></p>
  <div class="mut"><a class="wl" onclick="finBudget()">預算 ${money(budget)}</a>・已用 ${Math.round(out / budget * 100)}%</div><div class="bar"><i style="width:${Math.min(100, out / budget * 100)}%;background:${out > budget ? 'var(--bad)' : 'var(--ac)'}"></i></div></div>
  <div class="card"><h2>新增帳目</h2><div class="row"><select id="ft_t" onchange="finType()"><option value="out">支出</option><option value="in">收入</option></select><input type="date" id="ft_d" value="${today()}"></div>
  <div class="row"><input id="ft_a" type="number" inputmode="decimal" placeholder="金額"><select id="ft_c">${CAT_OUT.map(c => `<option>${c}</option>`).join('')}</select></div><input id="ft_n" placeholder="備註（選填）"><button class="b" onclick="finAdd()">記帳</button></div>
  ${cats.length ? `<div class="card"><h2>支出分類</h2>${cats.map(([c, v]) => `<div class="mut">${c} ${money(v)}（${Math.round(v / out * 100)}%）</div><div class="bar"><i style="width:${v / out * 100}%"></i></div>`).join('')}</div>` : ''}
  <div class="card"><h2>明細</h2>${t.sort((a, b) => b.date.localeCompare(a.date)).map(x => `<div class="item"><span>${x.date.slice(5)} ${esc(x.cat)} <span class="mut">${esc(x.note)}</span></span><span><b class="${x.type === 'in' ? 'ok' : ''}">${x.type === 'in' ? '+' : '-'}${money(x.amount)}</b><button class="x" onclick="del('${x.id}')">✕</button></span></div>`).join('') || '<p class="mut">本月尚無帳目</p>'}</div>`;
}

// ---------- 知識：筆記 + 閱讀清單 ----------
window.knowSub = s => { sub.know = s; render(); };
window.noteSave = () => { const title = val('nt'); if (!title) return; const d = { title, body: $('#nb').value, tags: val('ng').split(/[,，\s]+/).filter(Boolean) }; ui.note ? patch(ui.note, d) : put('note', d); ui.note = null; render(); };
window.noteEdit = id => { ui.note = id; render(); scrollTo(0, 0); };
window.noteOpen = t => { const n = all('note').find(x => x.title === t); if (n) noteEdit(n.id); else if (confirm(`建立筆記「${t}」？`)) { ui.note = put('note', { title: t, body: '', tags: [] }); render(); } };
window.noteFilter = (k, v) => { ui[k] = v; render(); };
window.readAdd = () => { const t = val('rt'); if (!t) return; put('book', { title: t, author: val('ra'), status: 'want', pages: +val('rp') || 0, cur: 0, rating: 0, note: '' }); render(); };
window.readSet = (id, p) => { patch(id, p); render(); };
window.readProg = id => { const b = DB[id].data, c = prompt('目前讀到第幾頁？' + (b.pages ? `（共 ${b.pages} 頁）` : ''), b.cur); if (c === null) return; const cur = +c; patch(id, { cur, status: b.pages && cur >= b.pages ? 'done' : 'reading' }); render(); };
window.readNote = id => { const n = prompt('心得 / 摘要', DB[id].data.note); if (n !== null) { patch(id, { note: n }); render(); } };
window.readRate = (id, r) => readSet(id, { rating: r });
function notes() {
  const ns = all('note'), q = ui.q.toLowerCase(), tags = [...new Set(ns.flatMap(n => n.tags))];
  const cur = ui.note ? DB[ui.note].data : { title: '', body: '', tags: [] };
  const list = ns.filter(n => (!ui.tag || n.tags.includes(ui.tag)) && (!q || (n.title + n.body).toLowerCase().includes(q)));
  const link = s => esc(s).replace(/\[\[(.+?)\]\]/g, (_, t) => `<a class="wl" onclick="noteOpen(this.dataset.t)" data-t="${t}">${t}</a>`);
  return `<div class="card"><h2>${ui.note ? '編輯筆記' : '新筆記'}</h2><input id="nt" placeholder="標題" value="${esc(cur.title)}"><textarea id="nb" placeholder="內容，用 [[標題]] 連結其他筆記">${esc(cur.body)}</textarea><input id="ng" placeholder="標籤（逗號分隔）" value="${esc(cur.tags.join(', '))}">
  <div class="row"><button class="b" onclick="noteSave()">儲存</button>${ui.note ? '<button class="b g" onclick="ui.note=null;render()">取消</button>' : ''}</div></div>
  <input placeholder="🔍 搜尋筆記" value="${esc(ui.q)}" oninput="ui.q=this.value;clearTimeout(window._t);window._t=setTimeout(()=>{render();const i=$('input[placeholder^=🔍]');i.focus();i.setSelectionRange(99,99)},250)">
  <div>${tags.map(t => `<span class="tag" style="${ui.tag === t ? 'background:var(--ac);color:#fff' : ''}" onclick="noteFilter('tag','${ui.tag === t ? '' : esc(t)}')">#${esc(t)}</span>`).join('')}</div>
  ${list.sort((a, b) => b.title.localeCompare(a.title)).map(n => { const back = ns.filter(o => o.id !== n.id && o.body.includes(`[[${n.title}]]`)).length;
    return `<div class="card"><div class="item" style="border:0;padding:0"><b>${esc(n.title)}</b><span><button class="x" onclick="noteEdit('${n.id}')">✎</button><button class="x" onclick="confirm('刪除？')&&del('${n.id}')">✕</button></span></div><pre>${link(n.body)}</pre>${n.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}${back ? `<span class="mut"> ← ${back} 則反向連結</span>` : ''}</div>`; }).join('') || '<p class="mut">沒有符合的筆記</p>'}`;
}
function reading() {
  const bs = all('book'), G = { reading: '📖 閱讀中', want: '📚 想讀', done: '✅ 已讀完' };
  return `<div class="card"><h2>加入書單</h2><input id="rt" placeholder="書名"><div class="row"><input id="ra" placeholder="作者"><input id="rp" type="number" placeholder="頁數"></div><button class="b" onclick="readAdd()">加入</button></div>
  ${Object.entries(G).map(([s, label]) => { const l = bs.filter(b => b.status === s); return l.length ? `<div class="card"><h2>${label}（${l.length}）</h2>${l.map(b => `<div class="item" style="display:block"><div class="row" style="align-items:center"><b style="flex:3">${esc(b.title)} <span class="mut">${esc(b.author)}</span></b><button class="x" style="flex:0" onclick="del('${b.id}')">✕</button></div>
    ${b.pages ? `<div class="bar"><i style="width:${Math.min(100, b.cur / b.pages * 100)}%"></i></div><span class="mut">${b.cur}/${b.pages} 頁</span>` : ''}
    <div class="mut"><a class="wl" onclick="readProg('${b.id}')">更新進度</a> · <a class="wl" onclick="readNote('${b.id}')">心得</a>${s !== 'reading' ? ` · <a class="wl" onclick="readSet('${b.id}',{status:'reading'})">開始讀</a>` : ''}${s !== 'done' ? ` · <a class="wl" onclick="readSet('${b.id}',{status:'done'})">讀完</a>` : ''}
    <span style="float:right">${[1, 2, 3, 4, 5].map(r => `<a onclick="readRate('${b.id}',${r})" style="cursor:pointer">${r <= b.rating ? '★' : '☆'}</a>`).join('')}</span></div>${b.note ? `<pre class="mut">${esc(b.note)}</pre>` : ''}</div>`).join('')}</div>` : ''; }).join('') || ''}`;
}
const know = () => `<div class="row"><button class="b ${sub.know === 'notes' ? '' : 'g'}" onclick="knowSub('notes')">🗒 筆記</button><button class="b ${sub.know === 'read' ? '' : 'g'}" onclick="knowSub('read')">📚 閱讀清單</button></div>` + (sub.know === 'notes' ? notes() : reading());

// ---------- 今日總覽 ----------
function home() {
  const f = fitStats(), m = month(today()), t = all('txn').filter(x => month(x.date) === m);
  const out = t.filter(x => x.type === 'out').reduce((a, x) => a + x.amount, 0), inc = t.filter(x => x.type === 'in').reduce((a, x) => a + x.amount, 0);
  const todo = all('bullet').filter(b => b.kind === 'task' && b.state === 'open' && b.date <= today());
  const rd = all('book').filter(b => b.status === 'reading');
  const goal = setting('goal', 150);
  return `<div class="card"><h2>${new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' })}</h2>${cfg().token ? '' : '<p class="bad">尚未設定同步金鑰，點右上角 ● 輸入（目前僅存在本機）</p>'}</div>
  <div class="grid"><div class="card" onclick="tab='fit';render()"><div class="mut">本週運動</div><div class="big">${f.min}<small class="mut">/${goal}分</small></div><div class="mut">🔥 連續 ${f.streak} 天</div></div>
  <div class="card" onclick="tab='fin';render()"><div class="mut">本月支出</div><div class="big bad">${money(out)}</div><div class="mut">結餘 ${money(inc - out)}</div></div></div>
  <div class="card"><h2>待辦（${todo.length}）</h2>${todo.slice(0, 8).map(b => `<div class="item"><span><a class="wl" onclick="bujoCycle('${b.id}')" style="text-decoration:none;font-size:20px;margin-right:8px">•</a>${esc(b.text)}</span></div>`).join('') || '<p class="mut">全部完成 🎉</p>'}</div>
  <div class="card" onclick="tab='know';sub.know='read';render()"><h2>閱讀中</h2>${rd.map(b => `<div class="mut">${esc(b.title)} ${b.pages ? Math.round(b.cur / b.pages * 100) + '%' : ''}</div>`).join('') || '<p class="mut">尚無</p>'}</div>
  <div class="card"><h2>筆記</h2><div class="mut">共 ${all('note').length} 則</div></div>`;
}
const VIEWS = { home, bujo, fit, fin, know };
render(); sync();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
