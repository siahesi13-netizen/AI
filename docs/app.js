const APP_VERSION = '1.5.0';
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
const IC = p => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
// 外觀：預設淺色，不跟隨系統；右上角按鈕切換（每台裝置各自記住）
const SUN = IC('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'), MOON = IC('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>');
function applyTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem('lh_theme', t); $('#theme').innerHTML = t === 'dark' ? SUN : MOON; document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#1F1B17' : '#FAF8F4'; }
$('#theme').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('h1').title = 'v' + APP_VERSION; $('h1').onclick = () => alert("Eilis' Personal Dashboard v" + APP_VERSION);
setInterval(sync, 15000); addEventListener('online', sync); document.addEventListener('visibilitychange', () => !document.hidden && sync());


// ---------- 導覽 ----------
const ICON = {
  home: IC('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  bujo: IC('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="18" r=".9"/>'),
  habit: IC('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'),
  diet: IC('<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M9 4c0 1.5 1 1.5 1 3M14 4c0 1.5 1 1.5 1 3"/>'),
  fit: IC('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  ffin: IC('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'),
  pfin: IC('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/>'),
  know: IC('<path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2z"/><path d="M12 6v14"/>'),
  goal: IC('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>')
};
// [key, 側邊欄名稱, 英文副標, 手機底部短名]
const TABS = [['home', '今日', 'Today', '今日'], ['bujo', '待辦事項', 'To-do', '待辦'], ['habit', '每週習慣建立', 'Weekly Habits', '習慣'], ['diet', '飲食管理', 'Nutrition', '飲食'], ['fit', '運動管理', 'Movement', '運動'],
  ['ffin', '家庭財務', 'Family Finance', '家庭'], ['pfin', '個人財務', 'Personal Finance', '個人'], ['know', '閱讀', 'Reading', '閱讀'], ['goal', '未來目標', 'Future Goals', '目標']];
let tab = 'home', sub = { know: 'read' }, ui = { date: today(), q: '', tag: '', note: null, dd: today(), wk: 0 };
$('#tabs').innerHTML = TABS.map(([k, n, , sn]) => `<button data-k="${k}">${ICON[k]}<span class="nl">${n}</span><span class="ns">${sn}</span></button>`).join('');
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) { tab = b.dataset.k; render(); scrollTo(0, 0); } };
function render() {
  document.querySelectorAll('#tabs button').forEach(b => { b.classList.toggle('on', b.dataset.k === tab); if (b.dataset.k === tab) b.scrollIntoView({ block: 'nearest', inline: 'center' }); });
  const T = TABS.find(t => t[0] === tab);
  $('#view').innerHTML = (tab === 'home' ? '' : `<div class="ptitle"><div class="eyebrow">${T[2]}</div><h2>${T[1]}</h2></div>`) + VIEWS[tab]();
}
const val = id => $('#' + id)?.value.trim();
const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString();
const month = d => d.slice(0, 7);
const iso = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const weekDates = (off = 0) => { const d0 = new Date(weekStart() + 'T00:00:00'); return [0, 1, 2, 3, 4, 5, 6].map(i => { const d = new Date(d0); d.setDate(d0.getDate() + i + off * 7); return iso(d); }); };
const WD = ['一', '二', '三', '四', '五', '六', '日'];

// ---------- 待辦事項（子彈筆記） ----------
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

// ---------- 財務（家庭／個人兩本帳） ----------
const LEDGER = {
  family: { out: ['房租房貸', '水電瓦斯', '食材日用', '孝親', '保險', '教育', '交通', '其他'], inc: ['家用收入', '其他'], budget: 'budget_family', def: 40000 },
  personal: { out: ['餐飲', '交通', '居住', '購物', '娛樂', '醫療', '學習', '其他'], inc: ['薪資', '獎金', '投資', '其他'], budget: 'budget', def: 20000 }
};
const curLedger = () => tab === 'ffin' ? 'family' : 'personal';
const txns = (L, m) => all('txn').filter(x => (x.ledger || 'personal') === L && month(x.date) === m);
const finSum = (L, m = month(today())) => { const t = txns(L, m); return { inc: t.filter(x => x.type === 'in').reduce((a, x) => a + x.amount, 0), out: t.filter(x => x.type === 'out').reduce((a, x) => a + x.amount, 0), budget: setting(LEDGER[L].budget, LEDGER[L].def) }; };
window.finAdd = () => { const a = +val('ft_a'); if (!a) return; put('txn', { ledger: curLedger(), date: val('ft_d') || today(), type: val('ft_t'), amount: a, cat: val('ft_c'), note: val('ft_n') }); render(); };
window.finType = () => { const C = LEDGER[curLedger()]; $('#ft_c').innerHTML = ($('#ft_t').value === 'out' ? C.out : C.inc).map(c => `<option>${c}</option>`).join(''); };
window.finBudget = () => { const C = LEDGER[curLedger()], g = prompt('每月預算', setting(C.budget, C.def)); if (g) { setSetting(C.budget, +g); render(); } };
window.finMonth = d => { ui.m = d; render(); };
function fin() {
  const L = curLedger(), C = LEDGER[L], m = ui.m || month(today()), t = txns(L, m), { inc, out, budget } = finSum(L, m), by = {};
  t.filter(x => x.type === 'out').forEach(x => by[x.cat] = (by[x.cat] || 0) + x.amount);
  const cats = Object.entries(by).sort((a, b) => b[1] - a[1]);
  return `<div class="card"><input type="month" value="${m}" onchange="finMonth(this.value)">
  <div class="grid" style="margin-top:8px"><div><div class="eyebrow">收入</div><div class="big ok">${money(inc)}</div></div><div><div class="eyebrow">支出</div><div class="big bad">${money(out)}</div></div></div>
  <p style="margin:10px 0 8px">結餘 <b class="${inc - out >= 0 ? 'ok' : 'bad'}">${money(inc - out)}</b></p>
  <div class="mut"><a class="wl" onclick="finBudget()">預算 ${money(budget)}</a>・已用 ${Math.round(out / budget * 100)}%</div><div class="bar" style="margin-top:6px"><i style="width:${Math.min(100, out / budget * 100)}%;background:${out > budget ? 'var(--bad)' : 'var(--bar)'}"></i></div></div>
  <div class="card"><h2>新增帳目</h2><div class="row"><select id="ft_t" onchange="finType()"><option value="out">支出</option><option value="in">收入</option></select><input type="date" id="ft_d" value="${today()}"></div>
  <div class="row"><input id="ft_a" type="number" inputmode="decimal" placeholder="金額"><select id="ft_c">${C.out.map(c => `<option>${c}</option>`).join('')}</select></div><input id="ft_n" placeholder="備註（選填）"><button class="b" onclick="finAdd()">記帳</button></div>
  ${cats.length ? `<div class="card"><h2>支出分類</h2>${cats.map(([c, v]) => `<div class="mut">${esc(c)} ${money(v)}（${Math.round(v / out * 100)}%）</div><div class="bar" style="margin-bottom:6px"><i style="width:${v / out * 100}%"></i></div>`).join('')}</div>` : ''}
  <div class="card"><h2>明細</h2>${t.sort((a, b) => b.date.localeCompare(a.date)).map(x => `<div class="item"><span>${x.date.slice(5)} ${esc(x.cat)} <span class="mut">${esc(x.note)}</span></span><span><b class="${x.type === 'in' ? 'ok' : ''}">${x.type === 'in' ? '+' : '-'}${money(x.amount)}</b><button class="x" onclick="del('${x.id}')">✕</button></span></div>`).join('') || '<p class="empty">本月尚無帳目</p>'}</div>`;
}

// ---------- 每週習慣建立（原子習慣：身分 → 提示 → 兩分鐘版本 → 打勾即投票） ----------
const hlId = (h, d) => `hl_${h}_${d}`, hDone = (h, d) => !!DB[hlId(h, d)] && !DB[hlId(h, d)].deleted;
const habitVotes = h => all('habitlog').filter(l => l.habit === h).length;
function habitStreak(h) { let n = 0, d = new Date(); if (!hDone(h, today())) d.setDate(d.getDate() - 1); while (hDone(h, iso(d))) { n++; d.setDate(d.getDate() - 1); } return n; }
window.habitToggle = (h, d) => { if (d > today()) return; if (hDone(h, d)) del(hlId(h, d)); else { put('habitlog', { habit: h, date: d }, hlId(h, d)); render(); } };
window.habitAdd = () => { const n = val('hn'); if (!n) return; put('habit', { name: n, identity: val('hi'), cue: val('hc'), tiny: val('ht'), created: today() }); render(); };
window.habitWeek = o => { ui.wk = o === 0 ? 0 : ui.wk + o; render(); };
const hChecks = (h, dates) => `<div class="hw">${dates.map((d, i) => `<button class="hc ${hDone(h.id, d) ? 'on' : ''} ${d === today() ? 'td' : ''}" ${d > today() ? 'disabled' : ''} onclick="habitToggle('${h.id}','${d}')" aria-label="${d}"><small>${WD[i]}</small></button>`).join('')}</div>`;
function habit() {
  const hs = all('habit').sort((a, b) => (a.created || '').localeCompare(b.created || '')), dates = weekDates(ui.wk);
  const total = all('habitlog').length, wkDone = hs.reduce((a, h) => a + dates.filter(d => hDone(h.id, d)).length, 0), wkMax = hs.length * 7;
  return `<div class="card"><div class="row" style="align-items:center"><button class="b g" style="flex:0 0 44px" onclick="habitWeek(-1)">‹</button><div style="text-align:center"><b class="serif">${dates[0].slice(5).replace('-', '/')} – ${dates[6].slice(5).replace('-', '/')}</b><div class="mut">${ui.wk === 0 ? '本週' : `<a class="wl" onclick="habitWeek(0)">回到本週</a>`}</div></div><button class="b g" style="flex:0 0 44px" onclick="habitWeek(1)" ${ui.wk >= 0 ? 'disabled' : ''}>›</button></div>
    <div class="grid" style="margin-top:10px"><div><div class="eyebrow">本週完成</div><div class="big">${wkDone}<small class="mut"> / ${wkMax}</small></div></div><div><div class="eyebrow">累計投票</div><div class="big">${total}</div></div></div>
    <div class="bar" style="margin-top:8px"><i style="width:${wkMax ? wkDone / wkMax * 100 : 0}%"></i></div></div>
  ${hs.map(h => { const n = dates.filter(d => hDone(h.id, d)).length; return `<div class="card"><div class="item" style="border:0;padding:0 0 6px"><span><b>${esc(h.name)}</b>${h.identity ? ` <span class="tag">${esc(h.identity)}</span>` : ''}</span><button class="x" onclick="confirm('刪除這個習慣？紀錄會保留在雲端備份')&&del('${h.id}')">✕</button></div>
    ${h.cue || h.tiny ? `<div class="mut" style="margin-bottom:8px">${esc(h.cue)}${h.cue && h.tiny ? ' → ' : ''}${esc(h.tiny)}</div>` : ''}${hChecks(h, dates)}
    <div class="mut" style="margin-top:8px">本週 ${n}/7 · 連續 ${habitStreak(h.id)} 天 · 累計 ${habitVotes(h.id)} 票</div></div>`; }).join('') || '<div class="card"><p class="empty">還沒有習慣。從一個兩分鐘就能做完的小動作開始。</p></div>'}
  <div class="card"><h2>新增習慣</h2><input id="hn" placeholder="習慣名稱（例：晨間伸展）"><input id="hi" placeholder="身分：我是一個…的人（例：重視身體的人）"><input id="hc" placeholder="提示：在什麼之後做（例：起床喝完水之後）"><input id="ht" placeholder="兩分鐘版本（例：鋪開瑜珈墊伸展 2 分鐘）"><button class="b" onclick="habitAdd()">建立</button>
    <p class="mut" style="margin:8px 0 0">每打一個勾，就是為那個身分投一票。漏掉一天沒關係，不要連續漏兩天。</p></div>`;
}

// ---------- 飲食管理 ----------
const SLOTS = ['早餐', '午餐', '晚餐', '點心'], waterId = d => 'water_' + d, cups = d => DB[waterId(d)] && !DB[waterId(d)].deleted ? DB[waterId(d)].data.cups : 0;
window.dietDate = d => { ui.dd = d; render(); };
window.waterSet = n => { put('water', { date: ui.dd, cups: Math.max(0, n) }, waterId(ui.dd)); render(); };
window.waterGoal = () => { const g = prompt('每日喝水目標（杯）', setting('water_goal', 8)); if (g) { setSetting('water_goal', +g); render(); } };
window.mealAdd = () => { const t = val('mt'); if (!t) return; put('meal', { date: ui.dd, slot: val('ms'), text: t, note: val('mn') }); render(); };
function diet() {
  const ms = all('meal').filter(m => m.date === ui.dd), wg = setting('water_goal', 8), c = cups(ui.dd), dates = weekDates(), logged = new Set(all('meal').map(m => m.date));
  return `<div class="card"><div class="row"><input type="date" value="${ui.dd}" onchange="dietDate(this.value)"><button class="b g" onclick="dietDate('${today()}')">今天</button></div>
    <div class="eyebrow" style="margin-top:10px">喝水 <a class="wl" style="letter-spacing:0" onclick="waterGoal()">目標 ${wg} 杯</a></div>
    <div class="hw" style="margin-top:6px">${Array.from({ length: Math.max(wg, c) }, (_, i) => `<button class="hc ${i < c ? 'on' : ''}" onclick="waterSet(${i < c ? i : i + 1})" aria-label="第 ${i + 1} 杯"></button>`).join('')}</div><div class="mut" style="margin-top:6px">${c} / ${wg} 杯</div></div>
  <div class="card"><h2>記錄一餐</h2><div class="row"><select id="ms" style="flex:0 0 96px">${SLOTS.map(x => `<option>${x}</option>`).join('')}</select><input id="mt" placeholder="吃了什麼" onkeydown="event.key==='Enter'&&mealAdd()"></div><input id="mn" placeholder="備註：份量、飽足感、心情（選填）"><button class="b" onclick="mealAdd()">記錄</button></div>
  <div class="card"><h2>${ui.dd === today() ? '今日' : ui.dd} 飲食</h2>${SLOTS.map(sl => { const l = ms.filter(m => m.slot === sl); return l.length ? `<div class="eyebrow" style="margin-top:8px">${sl}</div>` + l.map(m => `<div class="item"><span>${esc(m.text)} <span class="mut">${esc(m.note)}</span></span><button class="x" onclick="del('${m.id}')">✕</button></div>`).join('') : ''; }).join('') || '<p class="empty">這一天還沒有記錄</p>'}</div>
  <div class="card week">${dates.map((d, i) => `<div class="${d === today() ? 'today' : ''}" onclick="dietDate('${d}')" style="cursor:pointer"><small>${WD[i]}</small><b>${+d.slice(8)}</b><i class="${logged.has(d) ? 'on' : ''}"></i></div>`).join('')}</div>`;
}

// ---------- 未來目標 ----------
const AREAS = ['職涯', '健康', '財務', '學習', '關係', '創作', '生活'];
window.goalAdd = () => { const t = val('gt'); if (!t) return; put('goal', { title: t, area: val('ga'), due: val('gd'), why: val('gw'), next: val('gn'), progress: 0, done: false, created: today() }); render(); };
window.goalEdit = (id, k, label) => { const v = prompt(label, DB[id].data[k] ?? ''); if (v === null) return; patch(id, { [k]: k === 'progress' ? Math.max(0, Math.min(100, +v || 0)) : v.trim() }); render(); };
window.goalDone = id => { const g = DB[id].data; patch(id, { done: !g.done, progress: g.done ? g.progress : 100 }); render(); };
const dLeft = due => { if (!due) return ''; const n = Math.round((new Date(due + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5); return n >= 0 ? `還有 ${n} 天` : `已過 ${-n} 天`; };
function goal() {
  const gs = all('goal').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')), act = gs.filter(g => !g.done), dn = gs.filter(g => g.done);
  const card = g => `<div class="card"><div class="item" style="border:0;padding:0 0 4px"><span><i class="dot ${g.done ? 'on' : ''}" onclick="goalDone('${g.id}')"></i><b class="serif" style="font-size:16px;${g.done ? 'text-decoration:line-through;color:var(--mut)' : ''}">${esc(g.title)}</b></span><button class="x" onclick="confirm('刪除這個目標？')&&del('${g.id}')">✕</button></div>
    <div><span class="tag">${esc(g.area)}</span>${g.due ? `<span class="mut">${g.due} · ${dLeft(g.due)}</span>` : ''}</div>
    ${g.why ? `<p style="margin:8px 0 4px"><span class="eyebrow">為什麼</span><br>${esc(g.why)}</p>` : ''}
    <p style="margin:8px 0 6px"><span class="eyebrow">下一步</span><br><a class="wl" onclick="goalEdit('${g.id}','next','下一步行動')">${esc(g.next) || '設定下一步'}</a></p>
    <div class="bar"><i style="width:${g.progress || 0}%"></i></div><div class="mut" style="margin-top:4px"><a class="wl" onclick="goalEdit('${g.id}','progress','進度（0–100）')">進度 ${g.progress || 0}%</a></div></div>`;
  return `${act.map(card).join('') || '<div class="card"><p class="empty">還沒有目標。寫下一個一年內想完成的事。</p></div>'}
  <div class="card"><h2>新增目標</h2><input id="gt" placeholder="目標（例：完成攝影作品集）"><div class="row"><select id="ga">${AREAS.map(a => `<option>${a}</option>`).join('')}</select><input type="date" id="gd"></div><input id="gw" placeholder="為什麼重要（選填）"><input id="gn" placeholder="下一步行動（選填）"><button class="b" onclick="goalAdd()">建立</button></div>
  ${dn.length ? `<div class="ptitle" style="margin-top:18px"><div class="eyebrow">Achieved</div></div>` + dn.map(card).join('') : ''}`;
}

// ---------- 閱讀：書單 + 筆記 ----------
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
  <input placeholder="搜尋筆記" value="${esc(ui.q)}" oninput="ui.q=this.value;clearTimeout(window._t);window._t=setTimeout(()=>{render();const i=$('input[placeholder^=搜尋]');i.focus();i.setSelectionRange(99,99)},250)">
  <div>${tags.map(t => `<span class="tag" style="${ui.tag === t ? 'background:var(--ac);color:var(--btntx)' : ''}" onclick="noteFilter('tag','${ui.tag === t ? '' : esc(t)}')">#${esc(t)}</span>`).join('')}</div>
  ${list.sort((a, b) => b.title.localeCompare(a.title)).map(n => { const back = ns.filter(o => o.id !== n.id && o.body.includes(`[[${n.title}]]`)).length;
    return `<div class="card"><div class="item" style="border:0;padding:0"><b>${esc(n.title)}</b><span><button class="x" onclick="noteEdit('${n.id}')">✎</button><button class="x" onclick="confirm('刪除？')&&del('${n.id}')">✕</button></span></div><pre>${link(n.body)}</pre>${n.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}${back ? `<span class="mut"> ← ${back} 則反向連結</span>` : ''}</div>`; }).join('') || '<p class="mut">沒有符合的筆記</p>'}`;
}
function reading() {
  const bs = all('book'), G = { reading: '閱讀中', want: '想讀', done: '已讀完' };
  return `<div class="card"><h2>加入書單</h2><input id="rt" placeholder="書名"><div class="row"><input id="ra" placeholder="作者"><input id="rp" type="number" placeholder="頁數"></div><button class="b" onclick="readAdd()">加入</button></div>
  ${Object.entries(G).map(([s, label]) => { const l = bs.filter(b => b.status === s); return l.length ? `<div class="card"><h2>${label}（${l.length}）</h2>${l.map(b => `<div class="item" style="display:block"><div class="row" style="align-items:center"><b style="flex:3">${esc(b.title)} <span class="mut">${esc(b.author)}</span></b><button class="x" style="flex:0" onclick="del('${b.id}')">✕</button></div>
    ${b.pages ? `<div class="bar"><i style="width:${Math.min(100, b.cur / b.pages * 100)}%"></i></div><span class="mut">${b.cur}/${b.pages} 頁</span>` : ''}
    <div class="mut"><a class="wl" onclick="readProg('${b.id}')">更新進度</a> · <a class="wl" onclick="readNote('${b.id}')">心得</a>${s !== 'reading' ? ` · <a class="wl" onclick="readSet('${b.id}',{status:'reading'})">開始讀</a>` : ''}${s !== 'done' ? ` · <a class="wl" onclick="readSet('${b.id}',{status:'done'})">讀完</a>` : ''}
    <span style="float:right">${[1, 2, 3, 4, 5].map(r => `<a onclick="readRate('${b.id}',${r})" style="cursor:pointer">${r <= b.rating ? '★' : '☆'}</a>`).join('')}</span></div>${b.note ? `<pre class="mut">${esc(b.note)}</pre>` : ''}</div>`).join('')}</div>` : ''; }).join('') || ''}`;
}
const know = () => `<div class="row" style="margin-bottom:8px"><button class="b ${sub.know === 'read' ? '' : 'g'}" onclick="knowSub('read')">書單</button><button class="b ${sub.know === 'notes' ? '' : 'g'}" onclick="knowSub('notes')">讀書筆記</button></div>` + (sub.know === 'notes' ? notes() : reading());

// ---------- 今日總覽（儀表板） ----------
const DEF_ID = '我是一個有系統、持續精進的人', DEF_QUOTE = '我允許自己既是傑作，也是進行中的作品。';
window.editSetting = (k, label, d) => { const v = prompt(label, setting(k, d)); if (v !== null && v.trim()) { setSetting(k, v.trim()); render(); } };
window.go = t => { tab = t; render(); scrollTo(0, 0); };
// 抽象色塊（非照片）：顏色走 CSS 變數，深色模式自動調整
const CV = b => `<svg class="cv" viewBox="0 0 160 74" preserveAspectRatio="xMidYMid slice">${b}</svg>`;
const COVER = {
  bujo: CV('<rect width="160" height="74" fill="var(--sand)"/><circle cx="40" cy="22" r="4" fill="var(--cocoa)"/><rect x="54" y="19" width="70" height="6" rx="3" fill="var(--clay)"/><circle cx="40" cy="38" r="4" fill="var(--card)"/><rect x="54" y="35" width="50" height="6" rx="3" fill="var(--card)"/><circle cx="40" cy="54" r="4" fill="var(--clay)"/><rect x="54" y="51" width="62" height="6" rx="3" fill="var(--clay)"/>'),
  habit: CV('<rect width="160" height="74" fill="var(--mist)"/>' + [0, 1, 2, 3, 4, 5, 6].map(i => `<circle cx="${26 + i * 18}" cy="37" r="6.5" fill="${[0, 1, 2, 4].includes(i) ? 'var(--cocoa)' : 'var(--card)'}" opacity="${[0, 1, 2, 4].includes(i) ? .75 : .8}"/>`).join('')),
  diet: CV('<rect width="160" height="74" fill="var(--clay)"/><path d="M44 36h72a36 36 0 0 1-72 0z" fill="var(--card)" opacity=".85"/><circle cx="68" cy="30" r="9" fill="var(--sage)"/><circle cx="90" cy="27" r="7" fill="var(--cocoa)" opacity=".7"/>'),
  fit: CV('<rect width="160" height="74" fill="var(--sage)"/><circle cx="116" cy="26" r="13" fill="var(--sand)"/><path d="M0 74V50Q40 22 82 48T160 40V74Z" fill="var(--cocoa)" opacity=".5"/><path d="M0 74V62Q50 42 100 60T160 54V74Z" fill="var(--card)" opacity=".7"/>'),
  ffin: CV('<rect width="160" height="74" fill="var(--sand)"/><path d="M50 74V40l30-22 30 22V74Z" fill="var(--card)" opacity=".85"/><rect x="72" y="50" width="16" height="24" fill="var(--cocoa)" opacity=".7"/><circle cx="124" cy="24" r="9" fill="var(--clay)"/>'),
  pfin: CV('<rect width="160" height="74" fill="var(--clay)"/><rect x="42" y="46" width="15" height="28" rx="3" fill="var(--card)" opacity=".75"/><rect x="63" y="36" width="15" height="38" rx="3" fill="var(--card)" opacity=".75"/><rect x="84" y="26" width="15" height="48" rx="3" fill="var(--card)" opacity=".75"/><rect x="105" y="14" width="15" height="60" rx="3" fill="var(--cocoa)" opacity=".8"/>'),
  know: CV('<rect width="160" height="74" fill="var(--mist)"/><path d="M58 74V36a22 22 0 0 1 44 0V74Z" fill="var(--card)" opacity=".8"/><circle cx="80" cy="38" r="8" fill="var(--cocoa)" opacity=".75"/><rect x="18" y="40" width="9" height="34" fill="var(--sand)"/><rect x="29" y="30" width="9" height="44" fill="var(--card)" opacity=".7"/><rect x="122" y="34" width="9" height="40" fill="var(--sand)"/><rect x="133" y="44" width="9" height="30" fill="var(--card)" opacity=".7"/>'),
  goal: CV('<rect width="160" height="74" fill="var(--sage)"/><circle cx="80" cy="44" r="30" fill="var(--card)" opacity=".6"/><circle cx="80" cy="44" r="19" fill="var(--sand)"/><circle cx="80" cy="44" r="8" fill="var(--cocoa)" opacity=".8"/>')
};
const HERO_ART = '<svg viewBox="0 0 200 150" preserveAspectRatio="xMaxYMid slice"><rect width="200" height="150" fill="var(--sand)"/><circle cx="150" cy="46" r="34" fill="var(--clay)"/><path d="M40 150V92a44 44 0 0 1 88 0V150Z" fill="var(--sage)"/><path d="M104 150a48 48 0 0 1 96 0Z" fill="var(--cocoa)" opacity=".7"/><circle cx="84" cy="92" r="9" fill="var(--card)"/><path d="M0 118h40" stroke="var(--cocoa)" stroke-width="1.2"/></svg>';
function weekStrip(days) {
  return `<div class="card week">${weekDates().map((d, i) => `<div class="${d === today() ? 'today' : ''}"><small>${WD[i]}</small><b>${+d.slice(8)}</b><i class="${days.has(d) ? 'on' : ''}"></i></div>`).join('')}</div>`;
}
function home() {
  const f = fitStats(), P = finSum('personal'), F = finSum('family'), goalMin = setting('goal', 150);
  const todo = all('bullet').filter(b => b.kind === 'task' && b.state === 'open' && b.date <= today());
  const rd = all('book').filter(b => b.status === 'reading'), hs = all('habit'), hToday = hs.filter(h => hDone(h.id, today())).length;
  const meals = all('meal').filter(m => m.date === today()).length, goals = all('goal').filter(g => !g.done);
  const h = new Date().getHours(), greet = h < 5 ? '夜深了' : h < 11 ? '早安' : h < 18 ? '午安' : '晚安';
  const date = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const stat = { bujo: `${todo.length} 項待辦`, habit: hs.length ? `今日 ${hToday} / ${hs.length}` : '尚未建立', diet: `今日 ${meals} 餐 · 水 ${cups(today())} 杯`, fit: `${f.min} / ${goalMin} 分`, ffin: `本月 ${money(F.out)}`, pfin: `本月 ${money(P.out)}`, know: `${rd.length} 本在讀`, goal: `${goals.length} 個進行中` };
  const active = new Set([...f.w.map(x => x.date), ...all('habitlog').map(l => l.date)]);
  return `<div class="card hero"><div class="hero-t"><div class="eyebrow">${date}</div><h2>${greet}，Eilis</h2>
      <q class="idq" onclick="editSetting('identity','身分宣言：我是一個…的人',DEF_ID)">${esc(setting('identity', DEF_ID))}</q>
      ${cfg().token ? '' : `<br><span class="chip" onclick="$('#sync').click()">尚未同步 · 點此設定</span>`}</div><div class="hero-art">${HERO_ART}</div></div>
  ${weekStrip(active)}
  <div class="dash"><div class="dc">
    <div class="card"><h2>今日待辦</h2>${todo.slice(0, 6).map(b => `<div class="item"><span><i class="dot" onclick="bujoCycle('${b.id}')"></i>${esc(b.text)}</span><span class="mut">${b.date === today() ? '' : b.date.slice(5)}</span></div>`).join('') || `<p class="empty">沒有待辦 · <a class="wl" onclick="go('bujo')">記下一件事</a></p>`}</div>
    <div class="card"><h2>今日習慣</h2>${hs.map(x => `<div class="item"><span><i class="dot ${hDone(x.id, today()) ? 'on' : ''}" onclick="habitToggle('${x.id}','${today()}')"></i>${esc(x.name)}</span><span class="mut">${esc(x.tiny || '')}</span></div>`).join('') || `<p class="empty">還沒有習慣 · <a class="wl" onclick="go('habit')">建立第一個</a></p>`}</div>
  </div><aside class="dr">
    <div class="grid" style="margin-bottom:12px"><div class="card" onclick="go('fit')" style="cursor:pointer"><div class="eyebrow">本週運動</div><div class="big">${f.min}<small class="mut"> / ${goalMin}</small></div><div class="bar" style="margin:8px 0 6px"><i style="width:${Math.min(100, f.min / goalMin * 100)}%"></i></div><div class="mut">連續 ${f.streak} 天</div></div>
    <div class="card" onclick="go('pfin')" style="cursor:pointer"><div class="eyebrow">個人支出</div><div class="big">${money(P.out)}</div><div class="bar" style="margin:8px 0 6px"><i style="width:${Math.min(100, P.out / P.budget * 100)}%"></i></div><div class="mut">結餘 ${money(P.inc - P.out)}</div></div></div>
    <div class="card"><h2>目前閱讀</h2>${rd.slice(0, 2).map(b => `<div class="book" style="margin:4px 0 8px"><div class="cover">${esc(b.title.slice(0, 10))}</div><div style="flex:1;min-width:0"><b>${esc(b.title)}</b><div class="mut">${esc(b.author)}</div>${b.pages ? `<div class="bar" style="margin-top:6px"><i style="width:${Math.min(100, b.cur / b.pages * 100)}%"></i></div><div class="mut">${Math.round(b.cur / b.pages * 100)}%</div>` : ''}</div></div>`).join('') || `<p class="empty">還沒有在讀的書 · <a class="wl" onclick="go('know')">加入書單</a></p>`}</div>
  </aside></div>
  <div class="tiles">${TABS.filter(x => x[0] !== 'home').map(([k, n]) => `<div class="tile" onclick="go('${k}')">${COVER[k]}<div class="tl"><div class="tn">${ICON[k]}${n}</div><div class="mut">${stat[k]}</div></div></div>`).join('')}</div>
  <div class="card quote" onclick="editSetting('quote','每日一句',DEF_QUOTE)">${esc(setting('quote', DEF_QUOTE))}</div>`;
}
const VIEWS = { home, bujo, habit, diet, fit, ffin: fin, pfin: fin, know, goal };
applyTheme(localStorage.getItem('lh_theme') || 'light');
render(); sync();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
