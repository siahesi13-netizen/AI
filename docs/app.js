const APP_VERSION = '1.8.0';
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
let tab = 'home', sub = { know: 'read', todo: 'all', goal: 'list', tpage: 'todo' }, ui = { date: today(), q: '', tag: '', note: null, dd: today(), wk: 0, mb: 4, cq: '' };
$('#tabs').innerHTML = TABS.map(([k, n, , sn]) => `<button data-k="${k}">${ICON[k]}<span class="nl">${n}</span><span class="ns">${sn}</span></button>`).join('');
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) { tab = b.dataset.k; render(); scrollTo(0, 0); } };
function render() {
  document.querySelectorAll('#tabs button').forEach(b => { b.classList.toggle('on', b.dataset.k === tab); if (b.dataset.k === tab) b.scrollIntoView({ block: 'nearest', inline: 'center' }); });
  const T = TABS.find(t => t[0] === tab);
  $('#view').innerHTML = (tab === 'home' ? '' : `<div class="ptitle"><div class="eyebrow">${T[2]}</div><h2>${T[1]}</h2></div>`) + VIEWS[tab]();
  applyLayout();
}

// ---------- 版面配置：每個區塊都可拖曳重排，順序依頁面記住並同步 ----------
const pageKey = () => tab + (tab === 'bujo' ? ':' + sub.tpage : tab === 'know' ? ':' + sub.know : tab === 'goal' ? ':' + sub.goal : '');
const GRIP = '<div class="grip"><button onclick="blkMove(this,-1)" aria-label="往前移">↑</button><span class="grip-h" title="按住拖曳">⠿ 拖曳</span><button onclick="blkMove(this,1)" aria-label="往後移">↓</button></div>';
function applyLayout() {
  const v = $('#view'), seen = {}, blocks = []; v.classList.toggle('two', tab === 'home'); document.body.classList.toggle('editing', !!ui.edit); $('#layoutBtn').classList.toggle('on', !!ui.edit);
  [...v.children].forEach((el, i) => {
    if (!el.dataset.b && ((i === 0 && el.matches('.ptitle')) || el.matches('.seg') || (!blocks.length && el.matches('p.mut')))) return; // 頁面標題、分頁切換、頂端說明固定在上方
    let k = el.dataset.b || ((el.querySelector('h2, summary, .eyebrow') || {}).textContent || (el.querySelector('input') || {}).placeholder || el.className || el.tagName).replace(/[\d\s（）()／/·\-–:：]/g, '').slice(0, 16) || 'blk';
    if (seen[k]) k += '#' + seen[k]; seen[k.split('#')[0]] = (seen[k.split('#')[0]] || 0) + 1;
    const w = document.createElement('div'); w.className = 'blk' + (el.classList.contains('full') ? ' full' : ''); w.dataset.b = k; el.removeAttribute('data-b');
    v.insertBefore(w, el); w.appendChild(el); if (ui.edit) w.insertAdjacentHTML('afterbegin', GRIP); blocks.push(w);
  });
  const order = setting('layout_' + pageKey(), []);
  if (order.length) blocks.map((b, i) => [order.indexOf(b.dataset.b) < 0 ? 1e3 + i : order.indexOf(b.dataset.b), b]).sort((a, b) => a[0] - b[0]).forEach(([, b]) => v.appendChild(b));
  if (ui.edit) v.insertAdjacentHTML('afterbegin', `<div class="editbar full"><span>版面編輯中：按住「⠿ 拖曳」移動區塊，或用 ↑ ↓</span><span><button onclick="layoutReset()">恢復預設</button><button onclick="layoutEdit()">完成</button></span></div>`);
}
const saveLayout = () => setSetting('layout_' + pageKey(), [...document.querySelectorAll('#view > .blk')].map(b => b.dataset.b));
window.layoutEdit = () => { ui.edit = !ui.edit; render(); };
window.layoutReset = () => { setSetting('layout_' + pageKey(), []); render(); };
window.blkMove = (btn, dir) => { const b = btn.closest('.blk'), sib = dir < 0 ? b.previousElementSibling : b.nextElementSibling; if (!sib || !sib.classList.contains('blk')) return; b.parentNode.insertBefore(b, dir < 0 ? sib : sib.nextSibling); saveLayout(); b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
let dragging = null;
document.addEventListener('pointerdown', e => { const h = e.target.closest('.grip-h'); if (!h) return; e.preventDefault(); dragging = h.closest('.blk'); dragging.classList.add('dragging'); h.setPointerCapture(e.pointerId); });
document.addEventListener('pointermove', e => {
  if (!dragging) return; e.preventDefault();
  if (e.clientY < 90) scrollBy(0, -14); else if (e.clientY > innerHeight - 120) scrollBy(0, 14);
  const hit = document.elementFromPoint(e.clientX, e.clientY), t = hit && hit.closest('#view > .blk'); if (!t || t === dragging) return;
  const r = t.getBoundingClientRect(), d = dragging.getBoundingClientRect(), sameRow = Math.abs(r.top - d.top) < 12 && r.left !== d.left;
  const after = sameRow ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
  t.parentNode.insertBefore(dragging, after ? t.nextSibling : t);
}, { passive: false });
const dragEnd = () => { if (!dragging) return; dragging.classList.remove('dragging'); dragging = null; saveLayout(); };
document.addEventListener('pointerup', dragEnd); document.addEventListener('pointercancel', dragEnd);
$('#layoutBtn').innerHTML = IC('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>');
$('#layoutBtn').onclick = () => layoutEdit();
const val = id => $('#' + id)?.value.trim();
const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString();
const month = d => d.slice(0, 7);
const iso = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const weekDates = (off = 0) => { const d0 = new Date(weekStart() + 'T00:00:00'); return [0, 1, 2, 3, 4, 5, 6].map(i => { const d = new Date(d0); d.setDate(d0.getDate() + i + off * 7); return iso(d); }); };
const WD = ['一', '二', '三', '四', '五', '六', '日'];

// ---------- 共用：分段切換 ----------
window.setSub = (k, v) => { sub[k] = v; render(); };
const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${sub[key] === v ? 'on' : ''}" data-v="${esc(v)}" onclick="setSub('${key}',this.dataset.v)">${esc(l)}</button>`).join('')}</div>`;
window.del = del;

// ---------- 待辦事項（雜事清單：記下來、做了沒） ----------
const TODO_LISTS = ['雜事', '採買', '家務', '行政'];
window.todoAdd = () => { const t = val('tt'); if (!t) return; put('todo', { text: t, list: val('tl') || '雜事', due: val('td'), star: false, done: false, created: Date.now() }); render(); setTimeout(() => $('#tt') && $('#tt').focus()); };
window.todoToggle = id => { const d = DB[id].data; patch(id, { done: !d.done, doneAt: d.done ? null : today() }); render(); };
window.todoStar = id => { patch(id, { star: !DB[id].data.star }); render(); };
const todoSort = (a, b) => (b.star - a.star) || (a.due || '9999').localeCompare(b.due || '9999') || (a.created - b.created);
const todosOpen = () => all('todo').filter(t => !t.done).sort(todoSort);
const todoRow = t => `<div class="item"><span style="display:flex;align-items:flex-start;min-width:0"><i class="dot ${t.done ? 'on' : ''}" style="flex:none;margin-top:3px" onclick="todoToggle('${t.id}')"></i><span style="${t.done ? 'text-decoration:line-through;color:var(--mut)' : ''}">${esc(t.text)}${t.due ? ` <span class="mut ${t.due < today() && !t.done ? 'bad' : ''}">${t.due === today() ? '今天' : t.due.slice(5)}</span>` : ''}</span></span><span style="flex:none;white-space:nowrap"><button class="x" style="${t.star ? 'color:var(--bar)' : ''}" onclick="todoStar('${t.id}')" aria-label="重要">${t.star ? '★' : '☆'}</button><button class="x" onclick="del('${t.id}')" aria-label="刪除">✕</button></span></div>`;
function todoList() {
  const ts = all('todo'), open = todosOpen(), f = sub.todo, lists = [...new Set([...TODO_LISTS, ...ts.map(t => t.list)])];
  const shown = open.filter(t => f === 'all' ? true : f === 'today' ? (t.due && t.due <= today()) : f === 'star' ? t.star : t.list === f);
  const done = ts.filter(t => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 30);
  const groups = f === 'all' ? lists.filter(l => shown.some(t => t.list === l)) : [null];
  return `<div class="card"><input id="tt" placeholder="記下一件雜事，按 Enter 新增" onkeydown="event.key==='Enter'&&todoAdd()">
    <div class="row"><input id="tl" list="tls" placeholder="清單（預設：雜事）"><datalist id="tls">${lists.map(l => `<option value="${esc(l)}">`).join('')}</datalist><input id="td" type="date" aria-label="期限"></div><button class="b" onclick="todoAdd()">新增</button></div>
  ${seg('todo', [['all', `全部 ${open.length}`], ['today', '今天／逾期'], ['star', '重要'], ...lists.filter(l => open.some(t => t.list === l)).map(l => [l, l])])}
  ${groups.map(g => { const l = g === null ? shown : shown.filter(t => t.list === g); return l.length ? `<div class="card">${g ? `<div class="eyebrow">${esc(g)}</div>` : ''}${l.map(todoRow).join('')}</div>` : ''; }).join('') || '<div class="card"><p class="empty">這裡沒有待辦，很好。</p></div>'}
  ${done.length ? `<details class="card"><summary class="mut" style="cursor:pointer">已完成（最近 ${done.length} 筆）</summary>${done.map(todoRow).join('')}</details>` : ''}`;
}

// ---------- 購物清單（必要／想要 × 緊急／不緊急） ----------
const QUAD = [['need', true, '必要 · 緊急', '先買'], ['need', false, '必要 · 不緊急', '排進採買'], ['want', true, '想要 · 緊急', '先想一想'], ['want', false, '想要 · 不緊急', '放進願望清單']];
window.shopAdd = () => { const n = val('sn'); if (!n) return; put('shop', { name: n, need: val('sk'), urgent: val('su') === '1', price: +val('sp') || 0, bought: false, created: Date.now() }); render(); setTimeout(() => $('#sn') && $('#sn').focus()); };
window.shopFlip = (id, k) => { const d = DB[id].data; patch(id, k === 'need' ? { need: d.need === 'need' ? 'want' : 'need' } : { urgent: !d.urgent }); render(); };
window.shopBuy = id => { const d = DB[id].data; patch(id, { bought: !d.bought, boughtAt: d.bought ? null : today() }); render(); };
const shopRow = x => `<div class="item"><span style="display:flex;align-items:flex-start;min-width:0"><i class="dot ${x.bought ? 'on' : ''}" style="flex:none;margin-top:3px" onclick="shopBuy('${x.id}')"></i><span style="${x.bought ? 'text-decoration:line-through;color:var(--mut)' : ''}">${esc(x.name)}${x.price ? ` <span class="mut">${money(x.price)}</span>` : ''}</span></span>
  <span style="flex:none;white-space:nowrap">${x.bought ? '' : `<span class="tag" onclick="shopFlip('${x.id}','need')" title="點一下切換">${x.need === 'need' ? '必要' : '想要'}</span><span class="tag" onclick="shopFlip('${x.id}','urgent')" title="點一下切換">${x.urgent ? '緊急' : '不急'}</span>`}<button class="x" onclick="del('${x.id}')" aria-label="刪除">✕</button></span></div>`;
function shopList() {
  const xs = all('shop'), open = xs.filter(x => !x.bought).sort((a, b) => a.created - b.created), bought = xs.filter(x => x.bought).sort((a, b) => (b.boughtAt || '').localeCompare(a.boughtAt || '')).slice(0, 30);
  const sum = l => l.reduce((a, x) => a + (x.price || 0), 0);
  return `<div class="card"><input id="sn" placeholder="想買什麼，按 Enter 新增" onkeydown="event.key==='Enter'&&shopAdd()">
    <div class="row"><select id="sk" aria-label="必要或想要"><option value="need">必要</option><option value="want">想要</option></select><select id="su" aria-label="緊急程度"><option value="0">不緊急</option><option value="1">緊急</option></select><input id="sp" type="number" inputmode="decimal" placeholder="預估金額"></div><button class="b" onclick="shopAdd()">加入清單</button></div>
  <div class="quad">${QUAD.map(([k, u, title, hint]) => { const l = open.filter(x => x.need === k && !!x.urgent === u); return `<div class="card q-${k}${u ? ' q-u' : ''}"><div class="item" style="border:0;padding:0 0 4px"><span><b class="serif">${title}</b><div class="mut">${hint}</div></span><span class="mut">${l.length} 項${sum(l) ? ' · ' + money(sum(l)) : ''}</span></div>${l.map(shopRow).join('') || '<p class="empty">沒有項目</p>'}</div>`; }).join('')}</div>
  <p class="mut" style="margin:0 2px 12px">未買合計 ${money(sum(open))}（必要 ${money(sum(open.filter(x => x.need === 'need')))}、想要 ${money(sum(open.filter(x => x.need === 'want')))}）。點「必要／想要」「緊急／不急」的小標籤可以直接換格子。</p>
  ${bought.length ? `<details class="card"><summary class="mut" style="cursor:pointer">已購買（最近 ${bought.length} 筆）</summary>${bought.map(shopRow).join('')}</details>` : ''}`;
}
const bujo = () => seg('tpage', [['todo', `待辦 ${todosOpen().length}`], ['shop', `購物清單 ${all('shop').filter(x => !x.bought).length}`]]) + (sub.tpage === 'shop' ? shopList() : todoList());

// ---------- 每週記錄（子彈筆記：• 任務 ○ 事件 – 筆記），顯示在「每週習慣建立」頁 ----------
const SYM = { task: '•', event: '○', note: '–' };
const bSym = b => b.kind === 'task' ? (b.state === 'done' ? '×' : b.state === 'moved' ? '>' : '•') : SYM[b.kind];
window.bujoAdd = () => { const t = val('bt'); if (!t) return; put('bullet', { text: t, kind: val('bk'), state: 'open', date: val('bd') || today() }); render(); };
window.bujoCycle = id => { const b = DB[id].data; if (b.kind !== 'task') return; patch(id, { state: { open: 'done', done: 'moved', moved: 'open' }[b.state] }); render(); };
window.bujoMigrate = id => { patch(id, { state: 'moved' }); put('bullet', { ...DB[id].data, state: 'open', date: today() }); render(); };
const bujoItem = b => `<div class="item"><span><a class="wl" onclick="bujoCycle('${b.id}')" style="text-decoration:none;font-size:19px;margin-right:8px;display:inline-block;width:14px;text-align:center">${bSym(b)}</a><span style="${b.state === 'done' ? 'text-decoration:line-through;color:var(--mut)' : ''}">${esc(b.text)}</span></span><button class="x" onclick="del('${b.id}')">✕</button></div>`;
const wrId = d0 => 'wr_' + d0, wr = d0 => DB[wrId(d0)] && !DB[wrId(d0)].deleted ? DB[wrId(d0)].data : {};
window.wrSave = (d0, k, v) => { put('weekreview', { ...wr(d0), week: d0, [k]: v }, wrId(d0)); };
function weekLog(dates) {
  const bs = all('bullet'), inWk = bs.filter(b => b.date >= dates[0] && b.date <= dates[6]), stale = bs.filter(b => b.kind === 'task' && b.state === 'open' && b.date < weekStart());
  const defDay = dates.includes(today()) ? today() : dates[0], R = wr(dates[0]);
  return `<div data-b="weeklog"><div class="ptitle" style="margin-top:8px"><div class="eyebrow">Weekly Log</div><h2 style="font-size:19px">本週記錄</h2></div>
  <div class="card"><div class="row"><select id="bd" style="flex:0 0 92px">${dates.map((d, i) => `<option value="${d}" ${d === defDay ? 'selected' : ''}>週${WD[i]} ${+d.slice(8)}</option>`).join('')}</select><select id="bk" style="flex:0 0 92px"><option value="task">• 任務</option><option value="event">○ 事件</option><option value="note">– 筆記</option></select></div>
    <input id="bt" placeholder="快速記錄…" onkeydown="event.key==='Enter'&&bujoAdd()"><button class="b" onclick="bujoAdd()">記下</button><p class="mut" style="margin:8px 0 0">點符號切換：• 待辦 → × 完成 → &gt; 已移轉</p></div>
  ${dates.map((d, i) => { const l = inWk.filter(b => b.date === d); return l.length ? `<div class="card"><div class="eyebrow">週${WD[i]} · ${d.slice(5).replace('-', '/')}</div>${l.map(bujoItem).join('')}</div>` : ''; }).join('') || '<div class="card"><p class="empty">這週還沒有記錄</p></div>'}
  ${stale.length && ui.wk === 0 ? `<div class="card"><div class="eyebrow">之前未完成 · 可移轉到今天</div>${stale.map(b => `<div class="item"><span>• ${esc(b.text)} <span class="mut">${b.date.slice(5)}</span></span><button class="x" onclick="bujoMigrate('${b.id}')" aria-label="移轉">&gt;</button></div>`).join('')}</div>` : ''}
  </div><div data-b="weekreview"><div class="ptitle" style="margin-top:8px"><div class="eyebrow">Weekly Review</div><h2 style="font-size:19px">每週回顧</h2></div>
  <div class="card">${[['good', '這週做得好的'], ['adjust', '可以調整的'], ['next', '下週一個小改變']].map(([k, l]) => `<div class="eyebrow" style="margin-top:6px">${l}</div><textarea style="min-height:64px" onchange="wrSave('${dates[0]}','${k}',this.value)">${esc(R[k] || '')}</textarea>`).join('')}<p class="mut" style="margin:6px 0 0">離開輸入框時自動儲存</p></div></div>`;
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
  return LATER('之後會串接手機 App（Apple 健康等）自動帶入，這裡先保留手動記錄。') + `<div class="card"><h2>本週 <a class="wl" onclick="fitGoal()">目標 ${goal} 分</a></h2><div class="bar"><i style="width:${pct}%"></i></div>
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
  return (L === 'family' ? LATER('家庭開支彙整的表格確定後，這頁會改成對應的欄位與彙總。') : '') + `<div class="card"><input type="month" value="${m}" onchange="finMonth(this.value)">
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
  <div data-b="habits">${hs.map(h => { const n = dates.filter(d => hDone(h.id, d)).length; return `<div class="card"><div class="item" style="border:0;padding:0 0 6px"><span><b>${esc(h.name)}</b>${h.identity ? ` <span class="tag">${esc(h.identity)}</span>` : ''}</span><button class="x" onclick="confirm('刪除這個習慣？紀錄會保留在雲端備份')&&del('${h.id}')">✕</button></div>
    ${h.cue || h.tiny ? `<div class="mut" style="margin-bottom:8px">${esc(h.cue)}${h.cue && h.tiny ? ' → ' : ''}${esc(h.tiny)}</div>` : ''}${hChecks(h, dates)}
    <div class="mut" style="margin-top:8px">本週 ${n}/7 · 連續 ${habitStreak(h.id)} 天 · 累計 ${habitVotes(h.id)} 票</div></div>`; }).join('') || '<div class="card"><p class="empty">還沒有習慣。從一個兩分鐘就能做完的小動作開始。</p></div>'}</div>
  <details class="card"${hs.length ? '' : ' open'}><summary style="cursor:pointer"><b class="serif">新增習慣</b></summary><input id="hn" style="margin-top:10px" placeholder="習慣名稱（例：晨間伸展）"><input id="hi" placeholder="身分：我是一個…的人（例：重視身體的人）"><input id="hc" placeholder="提示：在什麼之後做（例：起床喝完水之後）"><input id="ht" placeholder="兩分鐘版本（例：鋪開瑜珈墊伸展 2 分鐘）"><button class="b" onclick="habitAdd()">建立</button>
    <p class="mut" style="margin:8px 0 0">每打一個勾，就是為那個身分投一票。漏掉一天沒關係，不要連續漏兩天。</p></details>
  ${weekLog(dates)}`;
}

// ---------- 飲食管理 ----------
const SLOTS = ['早餐', '午餐', '晚餐', '點心'], waterId = d => 'water_' + d, cups = d => DB[waterId(d)] && !DB[waterId(d)].deleted ? DB[waterId(d)].data.cups : 0;
window.dietDate = d => { ui.dd = d; render(); };
window.waterSet = n => { put('water', { date: ui.dd, cups: Math.max(0, n) }, waterId(ui.dd)); render(); };
window.waterGoal = () => { const g = prompt('每日喝水目標（杯）', setting('water_goal', 8)); if (g) { setSetting('water_goal', +g); render(); } };
window.mealAdd = () => { const t = val('mt'); if (!t) return; put('meal', { date: ui.dd, slot: val('ms'), text: t, note: val('mn') }); render(); };
const LATER = t => `<p class="mut" style="margin:0 2px 12px">${t}</p>`;
function diet() {
  const ms = all('meal').filter(m => m.date === ui.dd), wg = setting('water_goal', 8), c = cups(ui.dd), dates = weekDates(), logged = new Set(all('meal').map(m => m.date));
  return LATER('之後會串接手機 App 自動帶入，這裡先保留手動記錄。') + `<div class="card"><div class="row"><input type="date" value="${ui.dd}" onchange="dietDate(this.value)"><button class="b g" onclick="dietDate('${today()}')">今天</button></div>
    <div class="eyebrow" style="margin-top:10px">喝水 <a class="wl" style="letter-spacing:0" onclick="waterGoal()">目標 ${wg} 杯</a></div>
    <div class="hw" style="margin-top:6px">${Array.from({ length: Math.max(wg, c) }, (_, i) => `<button class="hc ${i < c ? 'on' : ''}" onclick="waterSet(${i < c ? i : i + 1})" aria-label="第 ${i + 1} 杯"></button>`).join('')}</div><div class="mut" style="margin-top:6px">${c} / ${wg} 杯</div></div>
  <div class="card"><h2>記錄一餐</h2><div class="row"><select id="ms" style="flex:0 0 96px">${SLOTS.map(x => `<option>${x}</option>`).join('')}</select><input id="mt" placeholder="吃了什麼" onkeydown="event.key==='Enter'&&mealAdd()"></div><input id="mn" placeholder="備註：份量、飽足感、心情（選填）"><button class="b" onclick="mealAdd()">記錄</button></div>
  <div class="card"><h2>${ui.dd === today() ? '今日' : ui.dd} 飲食</h2>${SLOTS.map(sl => { const l = ms.filter(m => m.slot === sl); return l.length ? `<div class="eyebrow" style="margin-top:8px">${sl}</div>` + l.map(m => `<div class="item"><span>${esc(m.text)} <span class="mut">${esc(m.note)}</span></span><button class="x" onclick="del('${m.id}')">✕</button></div>`).join('') : ''; }).join('') || '<p class="empty">這一天還沒有記錄</p>'}</div>
  <div class="card week">${dates.map((d, i) => `<div class="${d === today() ? 'today' : ''}" onclick="dietDate('${d}')" style="cursor:pointer"><small>${WD[i]}</small><b>${+d.slice(8)}</b><i class="${logged.has(d) ? 'on' : ''}"></i></div>`).join('')}</div>`;
}

// ---------- 未來目標（人生／5・3・1 年／今年 ＋ 曼陀羅九宮格） ----------
const AREAS = ['職涯', '健康', '財務', '學習', '關係', '創作', '生活'];
const HZ = [['life', '人生目標', 'Life'], ['y5', '5 年目標', 'Five years'], ['y3', '3 年目標', 'Three years'], ['y1', '1 年目標', 'One year'], ['year', '今年目標', 'This year']];
window.goalAdd = () => { const t = val('gt'); if (!t) return; put('goal', { title: t, hz: val('gh'), area: val('ga'), due: val('gd'), why: val('gw'), next: val('gn'), progress: 0, done: false, created: today() }); render(); };
window.goalEdit = (id, k, label) => { const v = prompt(label, DB[id].data[k] ?? ''); if (v === null) return; patch(id, { [k]: k === 'progress' ? Math.max(0, Math.min(100, +v || 0)) : v.trim() }); render(); };
window.goalDone = id => { const g = DB[id].data; patch(id, { done: !g.done, progress: g.done ? g.progress : 100 }); render(); };
const dLeft = due => { if (!due) return ''; const n = Math.round((new Date(due + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5); return n >= 0 ? `還有 ${n} 天` : `已過 ${-n} 天`; };
const goalCard = g => `<div class="card"><div class="item" style="border:0;padding:0 0 4px"><span><i class="dot ${g.done ? 'on' : ''}" onclick="goalDone('${g.id}')"></i><b class="serif" style="font-size:16px;${g.done ? 'text-decoration:line-through;color:var(--mut)' : ''}">${esc(g.title)}</b></span><button class="x" onclick="confirm('刪除這個目標？')&&del('${g.id}')">✕</button></div>
    <div><span class="tag">${esc(g.area)}</span>${g.due ? `<span class="mut">${g.due} · ${dLeft(g.due)}</span>` : ''}</div>
    ${g.why ? `<p style="margin:8px 0 4px"><span class="eyebrow">為什麼</span><br>${esc(g.why)}</p>` : ''}
    <p style="margin:8px 0 6px"><span class="eyebrow">下一步</span><br><a class="wl" onclick="goalEdit('${g.id}','next','下一步行動')">${esc(g.next) || '設定下一步'}</a></p>
    <div class="bar"><i style="width:${g.progress || 0}%"></i></div><div class="mut" style="margin-top:4px"><a class="wl" onclick="goalEdit('${g.id}','progress','進度（0–100）')">進度 ${g.progress || 0}%</a></div></div>`;
function goalList() {
  const gs = all('goal').map(g => ({ ...g, hz: g.hz || 'year' })).sort((a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999'));
  return HZ.map(([k, n, en]) => { const l = gs.filter(g => g.hz === k); return `<div data-b="hz_${k}"><div class="ptitle" style="margin-top:8px"><div class="eyebrow">${en}</div><h2 style="font-size:19px">${n}</h2></div>${l.map(goalCard).join('') || '<div class="card"><p class="empty">尚未設定</p></div>'}</div>`; }).join('') +
  `<div class="card"><h2>新增目標</h2><input id="gt" placeholder="目標"><div class="row"><select id="gh">${HZ.map(([k, n]) => `<option value="${k}" ${k === 'year' ? 'selected' : ''}>${n}</option>`).join('')}</select><select id="ga">${AREAS.map(a => `<option>${a}</option>`).join('')}</select></div><input type="date" id="gd" aria-label="期限"><input id="gw" placeholder="為什麼重要（選填）"><input id="gn" placeholder="下一步行動（選填）"><button class="b" onclick="goalAdd()">建立</button></div>`;
}
// 曼陀羅：中心九宮格＝核心目標＋八個面向；每個面向再展開八個行動。格子鍵值 `${區塊}_${格}`，面向文字存在中心區塊（4_k）
const MID = () => 'mandala_' + new Date().getFullYear();
const mcells = () => DB[MID()] && !DB[MID()].deleted ? DB[MID()].data.cells || {} : {};
const mkey = (b, i) => b === 4 ? `4_${i}` : i === 4 ? `4_${b}` : `${b}_${i}`;
window.mSet = (k, label) => { const v = prompt(label, mcells()[k] || ''); if (v === null) return; put('mandala', { year: new Date().getFullYear(), cells: { ...mcells(), [k]: v.trim() } }, MID()); render(); };
window.mOpen = b => { ui.mb = b; render(); };
window.mTap = (b, i) => { const c = mcells(); if (b === 4) { if (i === 4) return mSet('4_4', '今年的核心目標'); return c[`4_${i}`] ? mOpen(i) : mSet(`4_${i}`, '面向（例：健康、財務、創作）'); } if (i === 4) return mSet(`4_${b}`, '面向名稱'); mSet(`${b}_${i}`, '具體行動'); };
const mBlock = (b, mini) => `<div class="mand ${mini ? 'mini' : ''}">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => { const t = mcells()[mkey(b, i)] || ''; return `<div class="mc ${i === 4 ? (b === 4 ? 'core' : 'ctr') : ''} ${b === 4 && i !== 4 ? 'sub' : ''}" onclick="${mini ? `mOpen(${b})` : `mTap(${b},${i})`}">${esc(t) || (mini ? '' : '<span class="mut">＋</span>')}</div>`; }).join('')}</div>`;
function mandala() {
  const c = mcells(), b = ui.mb, filled = Object.keys(c).filter(k => !k.startsWith('4_') && c[k]).length;
  return `<div class="card"><div class="item" style="border:0;padding:0 0 10px"><span><b class="serif" style="font-size:16px">${b === 4 ? `${new Date().getFullYear()} 曼陀羅` : esc(c[`4_${b}`] || '面向')}</b><div class="mut">${b === 4 ? '中心是核心目標，周圍是八個面向。點已填的面向可展開它的八個行動。' : '中心是這個面向，周圍寫八個具體行動。'}</div></span>${b === 4 ? '' : `<button class="b g" style="width:auto;flex:none" onclick="mOpen(4)">‹ 回中心</button>`}</div>
    ${mBlock(b, false)}<div class="mut" style="margin-top:10px">已填行動 ${filled} / 64</div><div class="bar" style="margin-top:6px"><i style="width:${filled / 64 * 100}%"></i></div></div>
  <div class="card m9"><h2>全貌</h2><div class="mand9">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(x => mBlock(x, true)).join('')}</div></div>`;
}
const goal = () => seg('goal', [['list', '人生・5／3／1 年・今年'], ['mandala', '曼陀羅九宮格']]) + (sub.goal === 'mandala' ? mandala() : goalList());

// ---------- 閱讀：書單 + 筆記 ----------
window.knowSub = s => { sub.know = s; render(); };
window.noteEdit = id => { ui.note = id; render(); scrollTo(0, 0); };
window.noteOpen = t => { const n = all('note').find(x => x.title === t); if (n) noteEdit(n.id); else if (confirm(`建立小卡「${t}」？`)) { ui.note = put('note', { title: t, body: '', tags: [] }); render(); } };
window.noteFilter = (k, v) => { ui[k] = v; render(); };
window.readAdd = () => { const t = val('rt'); if (!t) return; put('book', { title: t, author: val('ra'), status: 'want', pages: +val('rp') || 0, cur: 0, rating: 0, note: '' }); render(); };
window.readSet = (id, p) => { patch(id, p); render(); };
window.readProg = id => { const b = DB[id].data, c = prompt('目前讀到第幾頁？' + (b.pages ? `（共 ${b.pages} 頁）` : ''), b.cur); if (c === null) return; const cur = +c; patch(id, { cur, status: b.pages && cur >= b.pages ? 'done' : 'reading' }); render(); };
window.readNote = id => { const n = prompt('心得 / 摘要', DB[id].data.note); if (n !== null) { patch(id, { note: n }); render(); } };
window.readRate = (id, r) => readSet(id, { rating: r });
// 知識小卡：依梅棹忠夫《知的生產技術》的卡片法——一卡一事、標題＋完整句子＋日期、不急著分類、常翻閱並重新排列組合
window.noteSave = () => { const title = val('nt'); if (!title) return; const d = { title, body: $('#nb').value, src: val('ns'), tags: val('ng').split(/[,，\s]+/).filter(Boolean) }; ui.note ? patch(ui.note, d) : put('note', { ...d, date: today(), created: Date.now() }); ui.note = null; ui.draft = null; ui.draftSrc = null; render(); };
window.deskToggle = id => { ui.desk = ui.desk || []; ui.desk = ui.desk.includes(id) ? ui.desk.filter(x => x !== id) : [...ui.desk, id]; render(); };
window.cardShuffle = () => { const ids = all('note').map(n => n.id).sort(() => Math.random() - .5).slice(0, 3); ui.flip = ids; render(); };
window.deskCombine = () => { ui.note = null; ui.draft = (ui.desk || []).map(id => `[[${DB[id].data.title}]]`).join('\n') + '\n\n把這幾張放在一起，我發現：'; render(); scrollTo(0, 0); };
function notes() {
  const ns = all('note').sort((a, b) => (b.created || 0) - (a.created || 0)), q = ui.q.toLowerCase(), tags = [...new Set(ns.flatMap(n => n.tags || []))], desk = (ui.desk || []).filter(id => DB[id] && !DB[id].deleted);
  const cur = ui.note ? DB[ui.note].data : { title: '', body: ui.draft || '', src: ui.draftSrc || '', tags: [] };
  const list = ns.filter(n => (!ui.tag || (n.tags || []).includes(ui.tag)) && (!q || (n.title + n.body).toLowerCase().includes(q)));
  const link = t => esc(t).replace(/\[\[(.+?)\]\]/g, (_, x) => `<a class="wl" onclick="noteOpen(this.dataset.t)" data-t="${x}">${x}</a>`);
  const card = n => { const back = ns.filter(o => o.id !== n.id && o.body.includes(`[[${n.title}]]`)).length, on = desk.includes(n.id);
    return `<div class="kcard"><div class="kh"><b>${esc(n.title)}</b><span><button class="x" style="${on ? 'color:var(--bar)' : ''}" onclick="deskToggle('${n.id}')" aria-label="放上桌面" title="放上桌面並排">${on ? '◆' : '◇'}</button><button class="x" onclick="noteEdit('${n.id}')" aria-label="編輯">✎</button><button class="x" onclick="confirm('刪除這張小卡？')&&del('${n.id}')" aria-label="刪除">✕</button></span></div>
      <pre>${link(n.body)}</pre><div class="kf"><span>${n.date || ''}${n.src ? ' · ' + esc(n.src) : ''}${back ? ` · ← ${back}` : ''}</span><span>${(n.tags || []).map(t => `#${esc(t)}`).join(' ')}</span></div></div>`; };
  const flip = (ui.flip || []).map(id => ns.find(n => n.id === id)).filter(Boolean);
  return `<div class="card"><h2>${ui.note ? '編輯小卡' : '寫一張小卡'}</h2><input id="nt" placeholder="標題：一張卡只寫一件事" value="${esc(cur.title)}"><textarea id="nb" placeholder="用完整的句子寫，寫給未來已經忘記的自己。可用 [[標題]] 連到其他小卡">${esc(cur.body)}</textarea>
    <div class="row"><input id="ns" list="bks2" placeholder="出處（選填）" value="${esc(cur.src || '')}"><datalist id="bks2">${all('book').map(b => `<option value="${esc(b.title)}">`).join('')}</datalist><input id="ng" placeholder="標籤（選填，不急著分類）" value="${esc((cur.tags || []).join(', '))}"></div>
    <div class="row"><button class="b" onclick="noteSave()">存成小卡</button>${ui.note || ui.draft ? '<button class="b g" onclick="ui.note=null;ui.draft=null;ui.draftSrc=null;render()">取消</button>' : ''}</div></div>
  ${desk.length ? `<div class="card" style="background:var(--soft)"><div class="item" style="border:0;padding:0 0 8px"><b class="serif">桌面 · 並排 ${desk.length} 張</b><span><button class="b" style="width:auto;padding:6px 12px;margin:0" onclick="deskCombine()">由此寫新卡</button> <button class="x" onclick="ui.desk=[];render()" aria-label="清空桌面">✕</button></span></div><div class="kgrid">${desk.map(id => card({ id, ...DB[id].data })).join('')}</div></div>` : ''}
  <div class="row" style="align-items:center;margin-bottom:4px"><input placeholder="搜尋小卡" value="${esc(ui.q)}" onchange="ui.q=this.value;render()"><button class="b g" style="flex:0 0 96px" onclick="cardShuffle()">翻一翻</button></div>
  ${tags.length ? `<div style="margin-bottom:8px">${tags.map(t => `<span class="tag" style="${ui.tag === t ? 'background:var(--ac);color:var(--btntx)' : ''}" data-t="${esc(t)}" onclick="noteFilter('tag',ui.tag===this.dataset.t?'':this.dataset.t)">#${esc(t)}</span>`).join('')}</div>` : ''}
  ${flip.length ? `<div class="eyebrow" style="margin:6px 2px">隨手翻到</div><div class="kgrid">${flip.map(card).join('')}</div><div class="eyebrow" style="margin:14px 2px 6px">全部小卡 ${ns.length}</div>` : ''}
  <div class="kgrid">${list.map(card).join('')}</div>${list.length ? '' : '<div class="card"><p class="empty">還沒有小卡。讀到、想到一件事，就寫一張。</p></div>'}
  <p class="mut" style="margin:12px 2px">卡片法：一卡一事、寫完整句子、標上日期；不急著分類，常常翻、把不相干的卡片並排，新的想法會從組合裡出來。</p>`;
}
function reading() {
  const bs = all('book'), G = { reading: '閱讀中', want: '想讀', done: '已讀完' };
  return `<div class="card"><h2>加入書單</h2><input id="rt" placeholder="書名"><div class="row"><input id="ra" placeholder="作者"><input id="rp" type="number" placeholder="頁數"></div><button class="b" onclick="readAdd()">加入</button></div>
  ${Object.entries(G).map(([s, label]) => { const l = bs.filter(b => b.status === s); return l.length ? `<div class="card"><h2>${label}（${l.length}）</h2>${l.map(b => `<div class="item" style="display:block"><div class="row" style="align-items:center"><b style="flex:3">${esc(b.title)} <span class="mut">${esc(b.author)}</span></b><button class="x" style="flex:0" onclick="del('${b.id}')">✕</button></div>
    ${b.pages ? `<div class="bar"><i style="width:${Math.min(100, b.cur / b.pages * 100)}%"></i></div><span class="mut">${b.cur}/${b.pages} 頁</span>` : ''}
    <div class="mut"><a class="wl" onclick="readProg('${b.id}')">更新進度</a> · <a class="wl" onclick="readNote('${b.id}')">心得</a>${s !== 'reading' ? ` · <a class="wl" onclick="readSet('${b.id}',{status:'reading'})">開始讀</a>` : ''}${s !== 'done' ? ` · <a class="wl" onclick="readSet('${b.id}',{status:'done'})">讀完</a>` : ''}
    <span style="float:right">${[1, 2, 3, 4, 5].map(r => `<a onclick="readRate('${b.id}',${r})" style="cursor:pointer">${r <= b.rating ? '★' : '☆'}</a>`).join('')}</span></div>${b.note ? `<pre class="mut">${esc(b.note)}</pre>` : ''}</div>`).join('')}</div>` : ''; }).join('') || ''}`;
}
// Commonplace book＋第二大腦（Tiago Forte）：擷取 Capture → 整理 Organize（PARA）→ 萃取 Distill（一句話重點）→ 表達 Express（轉成小卡）
const PARA = [['P', '專案'], ['A', '領域'], ['R', '資源'], ['X', '封存']];
window.cpAdd = () => { const t = $('#ct').value.trim(); if (!t) return; put('quote', { text: t, src: val('cs'), page: val('cpg'), thought: $('#cth').value.trim(), para: val('cpa'), gist: '', date: today(), created: Date.now() }); render(); };
window.cpEdit = (id, k, label) => { const v = prompt(label, DB[id].data[k] || ''); if (v === null) return; patch(id, { [k]: v.trim() }); render(); };
window.cpPara = (id, v) => { patch(id, { para: v }); render(); };
window.cpToCard = id => { const x = DB[id].data; sub.know = 'notes'; ui.note = null; ui.draft = `${x.gist || ''}\n\n「${x.text}」${x.thought ? '\n\n' + x.thought : ''}`.trim(); ui.draftSrc = x.src + (x.page ? ` p.${x.page}` : ''); render(); scrollTo(0, 0); };
function commonplace() {
  const q = ui.cq.toLowerCase(), f = ui.cpf || '', qs = all('quote').sort((a, b) => (b.created || 0) - (a.created || 0)).filter(x => (!f || (x.para || 'R') === f) && (!q || (x.text + x.src + x.thought + (x.gist || '')).toLowerCase().includes(q)));
  return `<div class="card"><h2>擷取</h2><textarea id="ct" style="min-height:84px" placeholder="抄下打動你的一段話"></textarea><div class="row"><input id="cs" list="bks" placeholder="出處（書名／作者）" style="flex:3"><datalist id="bks">${all('book').map(b => `<option value="${esc(b.title)}">`).join('')}</datalist><input id="cpg" placeholder="頁碼" style="flex:1"></div>
    <textarea id="cth" style="min-height:60px" placeholder="我的想法：為什麼留下它、可以怎麼用"></textarea>
    <div class="row"><select id="cpa" aria-label="PARA 歸屬">${PARA.map(([k, n]) => `<option value="${k}" ${k === 'R' ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="b" style="flex:2" onclick="cpAdd()">收進 Commonplace</button></div></div>
  <div class="row" style="align-items:center"><input placeholder="搜尋摘錄" value="${esc(ui.cq)}" onchange="ui.cq=this.value;render()"></div>
  <div class="seg" style="margin-top:6px">${[['', '全部'], ...PARA].map(([k, n]) => `<button class="${f === k ? 'on' : ''}" onclick="ui.cpf='${k}';render()">${n}</button>`).join('')}</div>
  <div data-b="quotes">${qs.map(x => `<div class="card"><blockquote class="qt">${esc(x.text)}</blockquote><div class="mut" style="display:flex;justify-content:space-between"><span>— ${esc(x.src) || '未註明出處'}${x.page ? `，p.${esc(x.page)}` : ''}</span><button class="x" onclick="confirm('刪除這則摘錄？')&&del('${x.id}')">✕</button></div>${x.thought ? `<p style="margin:8px 0 0">${esc(x.thought)}</p>` : ''}
    <p style="margin:10px 0 6px"><span class="eyebrow">一句話重點</span><br><a class="wl" onclick="cpEdit('${x.id}','gist','用自己的話，一句話說出重點')">${esc(x.gist) || '還沒萃取，點這裡寫一句'}</a></p>
    <div class="row" style="align-items:center"><select style="flex:0 0 96px;margin:0" onchange="cpPara('${x.id}',this.value)" aria-label="PARA 歸屬">${PARA.map(([k, n]) => `<option value="${k}" ${(x.para || 'R') === k ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="b g" style="margin:0" onclick="cpToCard('${x.id}')">轉成知識小卡</button></div></div>`).join('') || '<div class="card"><p class="empty">還沒有摘錄</p></div>'}</div>
  <p class="mut" style="margin:12px 2px">第二大腦的流程：擷取 → 整理（專案／領域／資源／封存）→ 萃取成一句話 → 轉成小卡，變成自己的東西。</p>`;
}
const know = () => seg('know', [['read', '目前閱讀・書單'], ['cp', 'Commonplace Book'], ['notes', '知識小卡']]) + (sub.know === 'notes' ? notes() : sub.know === 'cp' ? commonplace() : reading());

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
  return `<div class="card week full" data-b="week">${weekDates().map((d, i) => `<div class="${d === today() ? 'today' : ''}"><small>${WD[i]}</small><b>${+d.slice(8)}</b><i class="${days.has(d) ? 'on' : ''}"></i></div>`).join('')}</div>`;
}
function home() {
  const f = fitStats(), P = finSum('personal'), F = finSum('family'), goalMin = setting('goal', 150);
  const todo = todosOpen();
  const rd = all('book').filter(b => b.status === 'reading'), hs = all('habit'), hToday = hs.filter(h => hDone(h.id, today())).length;
  const meals = all('meal').filter(m => m.date === today()).length, goals = all('goal').filter(g => !g.done);
  const h = new Date().getHours(), greet = h < 5 ? '夜深了' : h < 11 ? '早安' : h < 18 ? '午安' : '晚安';
  const date = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const stat = { bujo: `${todo.length} 項待辦 · ${all('shop').filter(x => !x.bought).length} 項待買`, habit: hs.length ? `今日 ${hToday} / ${hs.length}` : '尚未建立', diet: `今日 ${meals} 餐 · 水 ${cups(today())} 杯`, fit: `${f.min} / ${goalMin} 分`, ffin: `本月 ${money(F.out)}`, pfin: `本月 ${money(P.out)}`, know: `${rd.length} 本在讀`, goal: `${goals.length} 個進行中` };
  const active = new Set([...f.w.map(x => x.date), ...all('habitlog').map(l => l.date)]);
  return `<div class="card hero full" data-b="hero"><div class="hero-t"><div class="eyebrow">${date}</div><h2>${greet}，Eilis</h2>
      <q class="idq" onclick="editSetting('identity','身分宣言：我是一個…的人',DEF_ID)">${esc(setting('identity', DEF_ID))}</q>
      ${cfg().token ? '' : `<br><span class="chip" onclick="$('#sync').click()">尚未同步 · 點此設定</span>`}</div><div class="hero-art">${HERO_ART}</div></div>
  ${weekStrip(active)}
    <div class="card"><h2>待辦事項</h2>${todo.slice(0, 6).map(todoRow).join('') || `<p class="empty">沒有待辦 · <a class="wl" onclick="go('bujo')">記下一件事</a></p>`}${todo.length > 6 ? `<p class="mut" style="margin:8px 0 0"><a class="wl" onclick="go('bujo')">還有 ${todo.length - 6} 項</a></p>` : ''}</div>
    <div class="card"><h2>今日習慣</h2>${hs.map(x => `<div class="item"><span><i class="dot ${hDone(x.id, today()) ? 'on' : ''}" onclick="habitToggle('${x.id}','${today()}')"></i>${esc(x.name)}</span><span class="mut">${esc(x.tiny || '')}</span></div>`).join('') || `<p class="empty">還沒有習慣 · <a class="wl" onclick="go('habit')">建立第一個</a></p>`}</div>
    <div class="grid" style="margin-bottom:12px" data-b="stats"><div class="card" onclick="go('fit')" style="cursor:pointer"><div class="eyebrow">本週運動</div><div class="big">${f.min}<small class="mut"> / ${goalMin}</small></div><div class="bar" style="margin:8px 0 6px"><i style="width:${Math.min(100, f.min / goalMin * 100)}%"></i></div><div class="mut">連續 ${f.streak} 天</div></div>
    <div class="card" onclick="go('pfin')" style="cursor:pointer"><div class="eyebrow">個人支出</div><div class="big">${money(P.out)}</div><div class="bar" style="margin:8px 0 6px"><i style="width:${Math.min(100, P.out / P.budget * 100)}%"></i></div><div class="mut">結餘 ${money(P.inc - P.out)}</div></div></div>
    <div class="card"><h2>目前閱讀</h2>${rd.slice(0, 2).map(b => `<div class="book" style="margin:4px 0 8px"><div class="cover">${esc(b.title.slice(0, 10))}</div><div style="flex:1;min-width:0"><b>${esc(b.title)}</b><div class="mut">${esc(b.author)}</div>${b.pages ? `<div class="bar" style="margin-top:6px"><i style="width:${Math.min(100, b.cur / b.pages * 100)}%"></i></div><div class="mut">${Math.round(b.cur / b.pages * 100)}%</div>` : ''}</div></div>`).join('') || `<p class="empty">還沒有在讀的書 · <a class="wl" onclick="go('know')">加入書單</a></p>`}</div>
  <div class="tiles full" data-b="tiles">${TABS.filter(x => x[0] !== 'home').map(([k, n]) => `<div class="tile" onclick="go('${k}')">${COVER[k]}<div class="tl"><div class="tn">${ICON[k]}${n}</div><div class="mut">${stat[k]}</div></div></div>`).join('')}</div>
  <div class="card quote full" data-b="quote" onclick="editSetting('quote','每日一句',DEF_QUOTE)">${esc(setting('quote', DEF_QUOTE))}</div>`;
}
const VIEWS = { home, bujo, habit, diet, fit, ffin: fin, pfin: fin, know, goal };
applyTheme(localStorage.getItem('lh_theme') || 'light');
render(); sync();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
