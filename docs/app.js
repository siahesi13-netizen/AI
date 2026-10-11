const APP_VERSION = '1.20.0';
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
const setting = (k, d) => { const r = DB['set_' + k]; return r && !r.deleted ? r.data.v ?? d : d; };
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
// ---------- 同步設定：網址＋金鑰可合成一組「設定碼」，方便用捷徑或貼上一次完成 ----------
const b64e = t => btoa(unescape(encodeURIComponent(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = t => decodeURIComponent(escape(atob(t.replace(/-/g, '+').replace(/_/g, '/'))));
const setupCode = () => 'lh1:' + b64e(JSON.stringify({ u: cfg().url || '', t: cfg().token || '' }));
function parseSetup(code) { try { const m = String(code).trim().match(/lh1:([A-Za-z0-9_-]+)/); if (!m) return null; const o = JSON.parse(b64d(m[1])); return typeof o.t === 'string' && o.t ? { url: o.u || '', token: o.t } : null; } catch (e) { return null; } }
function saveCfg(n) { if (n.url !== (cfg().url || '')) cursor = 0; LS('lh_cfg', n); persist(); sync(); } // 換後端要重新拉取全部
document.body.insertAdjacentHTML('beforeend', `<dialog id="cfgDlg"><form id="cfgForm" method="dialog" autocomplete="on"><h2>同步設定</h2>
  <div class="eyebrow">同步網址</div><input id="cfgUrl" name="username" autocomplete="username" placeholder="Apps Script 部署網址（用本機伺服器請留空）" autocapitalize="off" autocorrect="off">
  <div class="eyebrow" style="margin-top:6px">金鑰</div><input id="cfgTok" name="password" type="password" autocomplete="current-password">
  <div class="row"><button class="b" id="cfgSave" type="submit">儲存</button><button class="b g" id="cfgClose" type="button">關閉</button></div>
  <div class="eyebrow" style="margin-top:14px">設定碼</div><p class="mut" style="margin:2px 0 6px">把網址和金鑰合成一串。在已設定好的裝置按「複製」，到新裝置按「貼上」。設定碼等同金鑰，請勿外流。</p>
  <div class="row"><button class="b g" id="cfgPaste" type="button">貼上設定碼</button><button class="b g" id="cfgCopy" type="button">複製設定碼</button></div><p class="mut" id="cfgMsg" style="margin:8px 0 0;min-height:1.4em"></p>
  <div class="eyebrow" style="margin-top:10px">版面</div><p class="mut" style="margin:2px 0 6px">每個區塊都可以拖曳：按住區塊最上緣再移動。</p><button class="b g" id="cfgLayout" type="button">把目前這一頁恢復成預設排列</button></form></dialog>`);
const cfgMsg = t => { $('#cfgMsg').textContent = t; };
const openCfg = msg => { $('#cfgUrl').value = cfg().url || ''; $('#cfgTok').value = cfg().token || ''; cfgMsg(msg || ''); $('#cfgDlg').showModal(); };
// 點圓點：這台裝置還沒設定時，先看剪貼簿有沒有設定碼（例如剛在 iPhone 複製，透過通用剪貼簿帶到 iPad），有就直接套用
$('#sync').onclick = async () => {
  if (!cfg().token) { let t = ''; try { t = await navigator.clipboard.readText(); } catch (e) { } const n = parseSetup(t); if (n) { saveCfg(n); render(); return alert('已從剪貼簿套用同步設定'); } return openCfg('還沒設定。在另一台裝置按「複製設定碼」，再回來點一次圓點就會自動套用。'); }
  openCfg();
};
$('#cfgClose').onclick = () => $('#cfgDlg').close();
$('#cfgLayout').onclick = () => { layoutReset(); cfgMsg('已恢復這一頁的預設排列'); };
$('#cfgForm').onsubmit = () => { saveCfg({ url: $('#cfgUrl').value.trim(), token: $('#cfgTok').value.trim() }); render(); }; // method=dialog 會自行關閉對話框；表單送出讓 Safari 有機會把網址＋金鑰存進 iCloud 鑰匙圈
$('#cfgCopy').onclick = async () => { if (!cfg().token) return cfgMsg('這台裝置還沒設定，無法產生設定碼'); const c = setupCode(); try { await navigator.clipboard.writeText(c); cfgMsg('已複製設定碼'); } catch (e) { prompt('複製這串設定碼', c); } };
$('#cfgPaste').onclick = async () => { let t = ''; try { t = await navigator.clipboard.readText(); } catch (e) { } if (!parseSetup(t)) t = prompt('貼上設定碼（lh1: 開頭）') || ''; const n = parseSetup(t); if (!n) return cfgMsg('這不是有效的設定碼'); saveCfg(n); $('#cfgDlg').close(); render(); };
// 設定連結：網址後面加 #setup=設定碼（# 之後的內容不會送到伺服器），開啟時自動套用並從網址列移除
(() => { const m = location.hash.match(/^#setup=(.+)$/); if (!m) return; history.replaceState(null, '', location.pathname + location.search); const n = parseSetup(decodeURIComponent(m[1])); if (n) { LS('lh_cfg', n); cursor = 0; persist(); setTimeout(() => { sync(); alert('已套用同步設定'); }, 300); } })();
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
let tab = 'home', sub = { know: 'read', todo: 'all', goal: 'list', tpage: 'todo', ffin: 'fam', pfin: 'led' }, ui = { date: today(), q: '', tag: '', note: null, dd: today(), wk: 0, mb: 4, cq: '' };
$('#tabs').innerHTML = TABS.map(([k, n, , sn]) => `<button data-k="${k}">${ICON[k]}<span class="nl">${n}</span><span class="ns">${sn}</span></button>`).join('');
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) { tab = b.dataset.k; render(); scrollTo(0, 0); } };
function render() {
  document.querySelectorAll('#tabs button').forEach(b => { b.classList.toggle('on', b.dataset.k === tab); if (b.dataset.k === tab) b.scrollIntoView({ block: 'nearest', inline: 'center' }); });
  const T = TABS.find(t => t[0] === tab);
  $('#view').innerHTML = (tab === 'home' ? '' : `<div class="ptitle"><div class="eyebrow">${T[2]}</div><h2>${T[1]}</h2></div>`) + VIEWS[tab]();
  applyLayout();
}

// ---------- 版面配置：每個區塊都可拖曳重排，順序依頁面記住並同步 ----------
const pageKey = () => tab + (tab === 'bujo' ? ':' + sub.tpage : tab === 'know' ? ':' + sub.know : tab === 'goal' ? ':' + sub.goal : tab === 'ffin' ? ':' + sub.ffin : tab === 'pfin' ? ':' + sub.pfin : '');
// 每個區塊的上緣有一條看不見的拖曳區：按住區塊最上緣即可拖曳重排（沒有圖示，也沒有編輯模式）
const GRIP = '<div class="grip grip-h" title="按住區塊上緣可拖曳移動"></div>';
function applyLayout() {
  const v = $('#view'), seen = {}, blocks = []; v.classList.toggle('two', tab === 'home');
  [...v.children].forEach((el, i) => {
    if (!el.dataset.b && ((i === 0 && el.matches('.ptitle')) || el.matches('.seg') || (!blocks.length && el.matches('p.mut')))) return; // 頁面標題、分頁切換、頂端說明固定在上方
    let k = el.dataset.b || ((el.querySelector('h2, summary, .eyebrow') || {}).textContent || (el.querySelector('input') || {}).placeholder || el.className || el.tagName).replace(/[\d\s（）()／/·\-–:：]/g, '').slice(0, 16) || 'blk';
    if (seen[k]) k += '#' + seen[k]; seen[k.split('#')[0]] = (seen[k.split('#')[0]] || 0) + 1;
    const w = document.createElement('div'); w.className = 'blk' + (el.classList.contains('full') ? ' full' : ''); w.dataset.b = k; el.removeAttribute('data-b');
    v.insertBefore(w, el); w.appendChild(el); w.insertAdjacentHTML('afterbegin', GRIP); blocks.push(w);
  });
  const order = setting('layout_' + pageKey(), []);
  if (order.length) blocks.map((b, i) => [order.indexOf(b.dataset.b) < 0 ? 1e3 + i : order.indexOf(b.dataset.b), b]).sort((a, b) => a[0] - b[0]).forEach(([, b]) => v.appendChild(b));
}
const saveLayout = () => setSetting('layout_' + pageKey(), [...document.querySelectorAll('#view > .blk')].map(b => b.dataset.b));
window.layoutReset = () => { setSetting('layout_' + pageKey(), []); render(); };
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
const val = id => $('#' + id)?.value.trim();
const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString();
const month = d => d.slice(0, 7);
const iso = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const weekDates = (off = 0) => { const d0 = new Date(weekStart() + 'T00:00:00'); return [0, 1, 2, 3, 4, 5, 6].map(i => { const d = new Date(d0); d.setDate(d0.getDate() + i + off * 7); return iso(d); }); };
const WD = ['一', '二', '三', '四', '五', '六', '日'];
// Apple 健康每日彙總（type 'health'，id hk_<日期>；由手機捷徑上傳到雲端，這裡只讀）
const hk = d => { const r = DB['hk_' + d]; return r && !r.deleted ? r.data : null; };
const hv = (d, k) => (hk(d) || {})[k] || 0;
function hkNote() { const t = Math.max(0, ...Object.values(DB).filter(r => r.type === 'health' && !r.deleted).map(r => r.updated_at)); return `<p class="mut" style="margin:0 2px 12px">${t ? 'Apple 健康資料更新於 ' + new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '尚未收到 Apple 健康資料。在手機執行「上傳健康資料」捷徑後，數字會出現在這裡。'}</p>`; }
const bars = (dates, vals) => { const mx = Math.max(1, ...vals); return `<div class="bars">${dates.map((d, i) => `<div class="${d === today() ? 'td' : ''}"><span>${vals[i] ? Math.round(vals[i]).toLocaleString() : ''}</span><i style="height:${vals[i] / mx * 72}%"></i><small>${WD[i]}</small></div>`).join('')}</div>`; };
const num = (v, unit) => `<div class="big">${v ? (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString() : '–'}<small class="mut"> ${unit}</small></div>`;

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
window.todoEdit = id => { ui.editTodo = id; render(); setTimeout(() => $('#te_t') && $('#te_t').focus()); };
window.todoSave = id => { const t = val('te_t'); if (!t) return; patch(id, { text: t, list: val('te_l') || '雜事', due: val('te_d') }); ui.editTodo = null; render(); };
const todoRow = t => ui.editTodo === t.id
  ? `<div class="item" style="display:block"><input id="te_t" value="${esc(t.text)}" onkeydown="event.key==='Enter'&&todoSave('${t.id}')"><div class="row"><input id="te_l" list="tls" placeholder="清單" value="${esc(t.list || '')}"><input id="te_d" type="date" value="${t.due || ''}" aria-label="期限"></div><div class="row"><button class="b" onclick="todoSave('${t.id}')">儲存</button><button class="b g" onclick="ui.editTodo=null;render()">取消</button></div></div>`
  : `<div class="item"><span style="display:flex;align-items:flex-start;min-width:0"><i class="dot ${t.done ? 'on' : ''}" style="flex:none;margin-top:3px" onclick="todoToggle('${t.id}')"></i><span style="cursor:text;${t.done ? 'text-decoration:line-through;color:var(--mut)' : ''}" onclick="todoEdit('${t.id}')" title="點一下編輯">${esc(t.text)}${t.due ? ` <span class="mut ${t.due < today() && !t.done ? 'bad' : ''}">${t.due === today() ? '今天' : t.due.slice(5)}</span>` : ''}</span></span><span style="flex:none;white-space:nowrap"><button class="x" onclick="todoEdit('${t.id}')" aria-label="編輯">✎</button><button class="x" style="${t.star ? 'color:var(--bar)' : ''}" onclick="todoStar('${t.id}')" aria-label="重要">${t.star ? '★' : '☆'}</button><button class="x" onclick="del('${t.id}')" aria-label="刪除">✕</button></span></div>`;
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
window.shopEdit = id => { ui.editShop = id; render(); setTimeout(() => $('#se_n') && $('#se_n').focus()); };
window.shopSave = id => { const n = val('se_n'); if (!n) return; patch(id, { name: n, price: +val('se_p') || 0 }); ui.editShop = null; render(); };
const shopRow = x => ui.editShop === x.id
  ? `<div class="item" style="display:block"><div class="row"><input id="se_n" style="flex:2" value="${esc(x.name)}" onkeydown="event.key==='Enter'&&shopSave('${x.id}')"><input id="se_p" type="number" inputmode="decimal" placeholder="預估金額" value="${x.price || ''}"></div><div class="row"><button class="b" onclick="shopSave('${x.id}')">儲存</button><button class="b g" onclick="ui.editShop=null;render()">取消</button></div></div>`
  : `<div class="item"><span style="display:flex;align-items:flex-start;min-width:0"><i class="dot ${x.bought ? 'on' : ''}" style="flex:none;margin-top:3px" onclick="shopBuy('${x.id}')"></i><span style="cursor:text;${x.bought ? 'text-decoration:line-through;color:var(--mut)' : ''}" onclick="shopEdit('${x.id}')" title="點一下編輯">${esc(x.name)}${x.price ? ` <span class="mut">${money(x.price)}</span>` : ''}</span></span>
  <span style="flex:none;white-space:nowrap">${x.bought ? '' : `<span class="tag" onclick="shopFlip('${x.id}','need')" title="點一下切換">${x.need === 'need' ? '必要' : '想要'}</span><span class="tag" onclick="shopFlip('${x.id}','urgent')" title="點一下切換">${x.urgent ? '緊急' : '不急'}</span>`}<button class="x" onclick="shopEdit('${x.id}')" aria-label="編輯">✎</button><button class="x" onclick="del('${x.id}')" aria-label="刪除">✕</button></span></div>`;
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
// 運動消耗估算：MET × 體重(kg) × 小時。MET 取自常見活動的代謝當量概略值，強度再乘上係數；只是估計值
const MET = { '居家徒手': 3.8, '瑜珈': 3, '重訓': 5, '飛輪': 8.5, '跑步': 9.8, '走路': 3.5, '游泳': 7, '單車': 7.5, '球類': 6.5, '其他': 4 }, INTENS = { low: ['輕鬆', .8], mid: ['中等', 1], high: ['激烈', 1.25] };
// 體重：每天一筆（type 'weight'，id wt_<日期>）；估算運動消耗時用最新的一筆
const weights = () => all('weight').filter(w => w.kg > 0).sort((a, b) => a.date.localeCompare(b.date));
const bodyKg = () => { const w = weights(); return w.length ? w[w.length - 1].kg : (+setting('weight_kg', 0) || 0); };
window.weightSave = pre => { const kg = Math.round((+val(pre + 'kg') || 0) * 100) / 100, d = val(pre + 'd') || today(); if (!(kg > 0)) return; put('weight', { date: d, kg }, 'wt_' + d); render(); };
function spark(vals) { if (vals.length < 2) return ''; const mn = Math.min(...vals), mx = Math.max(...vals), sp = (mx - mn) || 1, W = 300, H = 70, pt = (v, i) => `${(i / (vals.length - 1) * (W - 8) + 4).toFixed(1)},${(H - 6 - (v - mn) / sp * (H - 12)).toFixed(1)}`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="體重趨勢" style="width:100%;height:70px;display:block;margin:8px 0 2px"><polyline points="${vals.map(pt).join(' ')}" fill="none" stroke="var(--bar)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${pt(vals[vals.length - 1], vals.length - 1).split(',')[0]}" cy="${pt(vals[vals.length - 1], vals.length - 1).split(',')[1]}" r="3" fill="var(--cocoa)"/></svg>`; }
function weightCard(pre, full) {
  const w = weights(), last = w[w.length - 1], prev = w[w.length - 2], td = w.find(x => x.date === today()), diff = last && prev ? Math.round((last.kg - prev.kg) * 100) / 100 : 0, recent = w.slice(-30);
  return `<div class="card" data-b="weight"><h2>體重</h2><div class="row" style="align-items:center">${full ? `<input type="date" id="${pre}d" value="${today()}" aria-label="日期">` : ''}<input id="${pre}kg" type="number" inputmode="decimal" step="0.01" placeholder="${td ? '今天已記 ' + td.kg : '今天的體重'}（公斤）" onkeydown="event.key==='Enter'&&weightSave('${pre}')"><button class="b" style="flex:0 0 76px" onclick="weightSave('${pre}')">記錄</button></div>
    ${last ? `<div style="margin-top:8px"><span class="big">${last.kg}</span><small class="mut"> kg · ${last.date.slice(5).replace('-', '/')}${prev ? ` · 較前一次 ${diff > 0 ? '+' : ''}${diff}` : ''}</small></div>` : '<p class="empty" style="margin-top:8px">還沒有紀錄</p>'}
    ${full ? spark(recent.map(x => x.kg)) + (recent.length > 1 ? `<div class="mut" style="display:flex;justify-content:space-between"><span>${recent[0].date.slice(5).replace('-', '/')}</span><span>最低 ${Math.min(...recent.map(x => x.kg))} · 最高 ${Math.max(...recent.map(x => x.kg))}</span><span>${last.date.slice(5).replace('-', '/')}</span></div>` : '') + (w.length ? `<details style="margin-top:8px"><summary class="mut" style="cursor:pointer">所有紀錄（${w.length}）</summary>${w.slice().reverse().slice(0, 60).map(x => `<div class="item"><span>${x.date}</span><span><b>${x.kg}</b> kg<button class="x" onclick="del('${x.id}')" aria-label="刪除">✕</button></span></div>`).join('')}</details>` : '') : ''}</div>`;
}
const wkKcal = x => { const kg = bodyKg(); return kg && x.min ? Math.round((MET[x.kind] || 4) * (INTENS[x.intensity] || INTENS.mid)[1] * kg * x.min / 60) : 0; };
const linkify = t => esc(t || '').replace(/https?:\/\/[^\s<]+/g, u => `<a class="wl" href="${u}" target="_blank" rel="noopener noreferrer">影片／連結</a>`);
const fitForm = (x, pre) => `<div class="row"><input type="date" id="${pre}d" value="${x.date || today()}"><select id="${pre}k">${Object.keys(MET).map(k => `<option ${k === x.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
  <div class="row"><input id="${pre}m" type="number" inputmode="numeric" placeholder="分鐘" value="${x.min || ''}"><select id="${pre}i" aria-label="強度">${Object.entries(INTENS).map(([k, [n]]) => `<option value="${k}" ${k === (x.intensity || 'mid') ? 'selected' : ''}>${n}</option>`).join('')}</select><input id="${pre}km" type="number" inputmode="decimal" placeholder="公里（選填）" value="${x.km || ''}"></div><input id="${pre}n" placeholder="備註或影片連結（選填）" value="${esc(x.note || '')}">`;
const fitRead = pre => ({ date: val(pre + 'd') || today(), kind: val(pre + 'k'), min: +val(pre + 'm') || 0, intensity: val(pre + 'i'), km: +val(pre + 'km') || 0, note: val(pre + 'n') });
window.fitAdd = () => { const d = fitRead('f'); if (!d.min) return; put('workout', d); render(); };
window.fitEdit = id => { ui.editFit = id; render(); };
window.fitSave = id => { const d = fitRead('e'); if (!d.min) return; patch(id, d); ui.editFit = null; render(); };
window.fitGoal = () => { const g = prompt('每週運動目標（分鐘）', setting('goal', 150)); if (g) { setSetting('goal', +g); render(); } };
function fitStats() {
  const w = all('workout'), dates = weekDates(), man = {}; w.forEach(x => man[x.date] = (man[x.date] || 0) + x.min);
  const dayMin = d => Math.max(man[d] || 0, hv(d, 'exercise_min')); // 同一天手動與健康取較大者，避免重複計算
  let streak = 0, d = new Date(); if (!dayMin(today())) d.setDate(d.getDate() - 1); while (dayMin(iso(d)) > 0) { streak++; d.setDate(d.getDate() - 1); }
  const wk = w.filter(x => x.date >= dates[0] && x.date <= dates[6]);
  return { w, dates, dayMin, min: Math.round(dates.reduce((a, x) => a + dayMin(x), 0)), km: wk.reduce((a, x) => a + x.km, 0), n: wk.length, streak };
}
function fit() {
  const s = fitStats(), goal = setting('goal', 150), D = s.dates, t = today(), kg = bodyKg(), hasHk = D.some(d => hk(d));
  const wk = s.w.filter(x => x.date >= D[0] && x.date <= D[6]), kcal = wk.reduce((a, x) => a + wkKcal(x), 0);
  const row = x => ui.editFit === x.id
    ? `<div class="item" style="display:block">${fitForm(x, 'e')}<div class="row"><button class="b" onclick="fitSave('${x.id}')">儲存</button><button class="b g" onclick="ui.editFit=null;render()">取消</button></div></div>`
    : `<div class="item"><span>${x.date.slice(5)} <b>${esc(x.kind)}</b> ${x.min} 分${x.km ? ' · ' + x.km + ' km' : ''}${wkKcal(x) ? ` · 約 ${wkKcal(x)} kcal` : ''} <span class="mut">${(INTENS[x.intensity] || INTENS.mid)[0]}${x.note ? ' · ' + linkify(x.note) : ''}</span></span><span style="flex:none;white-space:nowrap"><button class="x" onclick="fitEdit('${x.id}')" aria-label="編輯">✎</button><button class="x" onclick="del('${x.id}')" aria-label="刪除">✕</button></span></div>`;
  return `<div class="card"><h2>本週 <a class="wl" onclick="fitGoal()">目標 ${goal} 分</a></h2><div class="bar"><i style="width:${Math.min(100, s.min / goal * 100)}%"></i></div>
    <div class="grid" style="margin-top:12px"><div>${num(s.min, '分鐘')}<div class="mut">運動時間</div></div><div>${num(kcal, 'kcal')}<div class="mut">運動消耗（估算）</div></div><div>${num(wk.length, '次')}<div class="mut">運動次數</div></div><div>${num(s.streak, '天')}<div class="mut">連續運動</div></div></div>
    <p class="mut" style="margin:10px 0 0">${kg ? `以最新體重 ${kg} kg 估算` : '在下方記錄體重後，才能估算消耗的熱量'}，數字是依運動種類、強度、時間推估的概略值。</p></div>
  ${weightCard('fw', true)}
  <div class="card"><h2>記錄運動</h2>${fitForm({}, 'f')}<button class="b" onclick="fitAdd()">記錄</button></div>
  <div class="card"><h2>每日運動分鐘</h2>${bars(D, D.map(s.dayMin))}</div>
  <div class="card"><h2>運動紀錄</h2>${s.w.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40).map(row).join('') || '<p class="empty">還沒有紀錄</p>'}</div>
  ${hasHk ? hkNote() + `<div class="card"><h2>Apple 健康 · 今日</h2><div class="grid"><div>${num(hv(t, 'steps'), '步')}<div class="mut">步數</div></div><div>${num(hv(t, 'distance_km'), 'km')}<div class="mut">步行＋跑步距離</div></div></div></div><div class="card"><h2>每日步數</h2>${bars(D, D.map(d => hv(d, 'steps')))}</div>` : ''}`;
}

// ---------- 財務分析共用：成對長條圖、自動觀察、建議 ----------
// 成對長條（例如收入／支出）：labels 為每組的標籤，A、B 為兩組數值，cur 為要強調的索引
const pairBars = (labels, A, B, cur, on) => { const mx = Math.max(1, ...A, ...B); return `<div class="bars" style="grid-template-columns:repeat(${labels.length},1fr)">${labels.map((l, i) => `<div class="${i === cur ? 'td' : ''}" ${on ? `onclick="${on(i)}" style="cursor:pointer"` : ''}><div class="pr"><i class="b2" style="height:${Math.max(0, A[i]) / mx * 100}%"></i><i style="height:${Math.max(0, B[i]) / mx * 100}%"></i></div><small>${l}</small></div>`).join('')}</div>`; };
const legend = (a, b) => `<p class="mut" style="margin:8px 0 0"><i class="lg b2"></i>${a}　<i class="lg"></i>${b}</p>`;
const tips = (list, title = '觀察') => { const t = list.filter(Boolean); return t.length ? `<div class="card" data-b="tips"><h2>${title}</h2>${t.map(x => `<div class="item"><span>${x}</span></div>`).join('')}</div>` : ''; };
// 建議由 Claude 在對話中依當時的資料撰寫後存成一筆紀錄（type: advice），網站本身不呼叫任何付費 API
const advice = k => { const r = DB['advice_' + k]; return r && !r.deleted && r.data.text ? `<div class="card" data-b="advice"><h2>建議</h2><div style="white-space:pre-wrap;line-height:1.75">${esc(r.data.text)}</div><p class="mut" style="margin:10px 0 0">由 Claude 依 ${esc(r.data.at || '')} 的資料撰寫。資料更新後，在對話裡說「更新財務建議」即可重寫。</p></div>` : ''; };
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const prevMonth = m => { const d = new Date(m + '-01T00:00:00'); d.setMonth(d.getMonth() - 1); return iso(d).slice(0, 7); };

// ---------- 個人財務（手動記帳；分類沿用自己的記帳表，各分類可設預算） ----------
const PFIN = {
  out: ['個人-外食', '個人-日用品', '個人-保養品', '個人-化妝品', '個人-髮衣鞋包帽', '個人交通-大眾交通', '個人交通-機車', '個人交通-計程車', '交際-送禮請客', '交際-家庭送禮', '家庭開支-食材費', '家庭開支-家庭用品', '家庭開支-貓咪費用', '醫療', '學習', '保險通訊訂閱', '投資', '儲蓄', '公司代墊款', '其他'],
  inc: ['薪水', '公司代墊回款', '其他'], def: 20000
};
const txns = m => all('txn').filter(x => (x.ledger || 'personal') === 'personal' && x.date.startsWith(m)); // m 為 'yyyy-MM' 或 'yyyy'（整年）
const finSum = (m = month(today())) => { const t = txns(m); return { inc: t.filter(x => x.type === 'in').reduce((a, x) => a + x.amount, 0), out: t.filter(x => x.type === 'out').reduce((a, x) => a + x.amount, 0), budget: setting('budget', PFIN.def) }; };
window.finAdd = () => { const a = +val('ft_a'); if (!a) return; put('txn', { ledger: 'personal', date: val('ft_d') || today(), type: val('ft_t'), amount: a, cat: val('ft_c'), acct: val('ft_k'), note: val('ft_n') }); render(); };
window.finType = () => { $('#ft_c').innerHTML = ($('#ft_t').value === 'out' ? PFIN.out : PFIN.inc).map(c => `<option>${c}</option>`).join(''); };
window.finBudget = () => { const g = prompt('每月總預算', setting('budget', PFIN.def)); if (g) { setSetting('budget', +g); render(); } };
window.finCatBudget = c => { const B = setting('catbudget', {}), g = prompt(`「${c}」每月預算（留空表示不設）`, B[c] ?? ''); if (g === null) return; const n = { ...B }; if (g.trim() && +g > 0) n[c] = +g; else delete n[c]; setSetting('catbudget', n); render(); };
window.finMonth = d => { ui.m = d; render(); };
const pfinSeg = () => seg('pfin', [['led', '收支'], ['inv', '投資']]);
function fin() {
  if (sub.pfin === 'inv') return pfinSeg() + invest();
  const m = ui.m || month(today()), isY = /^\d{4}$/.test(m), t = txns(m), { inc, out, budget: bud } = finSum(m), by = {}, B1 = setting('catbudget', {});
  // 整年檢視：預算乘上該年有記帳的月數
  const yms = [...new Set(t.map(x => month(x.date)))].sort(), nM = isY ? Math.max(1, yms.length) : 1, budget = bud * nM, B = {}; Object.keys(B1).forEach(c => B[c] = B1[c] * nM);
  const years = [...new Set(all('txn').map(x => x.date.slice(0, 4)))].sort().reverse();
  t.filter(x => x.type === 'out').forEach(x => by[x.cat] = (by[x.cat] || 0) + x.amount);
  const cats = [...new Set([...Object.keys(by), ...Object.keys(B)])].map(c => [c, by[c] || 0]).sort((a, b) => b[1] - a[1]);
  const accts = [...new Set(all('txn').map(x => x.acct).filter(Boolean))];
  // 分析：公司代墊款是先墊後還，計算實際收支與儲蓄率時排除
  const isAdv = x => /代墊/.test(x.cat), rOut = t.filter(x => x.type === 'out' && !isAdv(x)).reduce((a, x) => a + x.amount, 0), rInc = t.filter(x => x.type === 'in' && !isAdv(x)).reduce((a, x) => a + x.amount, 0);
  const ms = isY ? yms.slice() : []; if (!isY) for (let k = m, i = 0; i < 6; i++, k = prevMonth(k)) ms.unshift(k);
  const sums = ms.map(k => { const q = txns(k).filter(x => !isAdv(x)); return [q.filter(x => x.type === 'in').reduce((a, x) => a + x.amount, 0), q.filter(x => x.type === 'out').reduce((a, x) => a + x.amount, 0)]; });
  const pb = {}; txns(isY ? String(+m - 1) : prevMonth(m)).filter(x => x.type === 'out').forEach(x => pb[x.cat] = (pb[x.cat] || 0) + x.amount);
  const up = Object.keys(by).filter(c => !/代墊/.test(c)).map(c => [c, by[c] - (pb[c] || 0)]).sort((a, b) => b[1] - a[1])[0];
  const over = Object.keys(B).filter(c => (by[c] || 0) > B[c]).sort((a, b) => (by[b] - B[b]) - (by[a] - B[a]));
  const days = isY ? yms.reduce((a, k) => a + (k === month(today()) ? +today().slice(8) : new Date(+k.slice(0, 4), +k.slice(5), 0).getDate()), 0) || 1 : m === month(today()) ? +today().slice(8) : new Date(+m.slice(0, 4), +m.slice(5), 0).getDate(), top = cats.filter(([c]) => !/代墊/.test(c))[0];
  const analysis = t.length ? `<div class="card" data-b="trend"><h2>${isY ? `${m} 年各月收支` : '近 6 個月收支'}</h2>${pairBars(ms.map(k => +k.slice(5) + (ms.length > 8 ? '' : ' 月')), sums.map(x => x[0]), sums.map(x => x[1]), isY ? -1 : 5, i => `finMonth('${ms[i]}')`)}${legend('收入', '支出（皆不含公司代墊）')}</div>` + tips([
    `扣除公司代墊後：收入 <b>${money(rInc)}</b>、支出 <b>${money(rOut)}</b>、結餘 <b class="${rInc - rOut >= 0 ? 'ok' : 'bad'}">${money(rInc - rOut)}</b>${rInc ? `，儲蓄率 ${pct(rInc - rOut, rInc)}%` : ''}`,
    rOut ? `平均每天支出 <b>${money(rOut / days)}</b>${isY ? `，平均每月 <b>${money(rOut / nM)}</b>` : budget ? `；照總預算每天可用 ${money(budget / new Date(+m.slice(0, 4), +m.slice(5), 0).getDate())}` : ''}` : '',
    top && rOut ? `花最多的是「${esc(top[0])}」<b>${money(top[1])}</b>，佔實際支出 ${pct(top[1], rOut)}%` : '',
    over.length ? `超出預算 ${over.length} 類：${over.slice(0, 4).map(c => `${esc(c)}（+${money(by[c] - B[c])}）`).join('、')}` : (Object.keys(B).length && rOut ? '所有分類都在預算內' : ''),
    up && up[1] > 0 && Object.keys(pb).length ? `比${isY ? '前一年' : '上個月'}增加最多的是「${esc(up[0])}」，多了 ${money(up[1])}` : ''
  ]) + advice('pfin') : '';
  return pfinSeg() + `<div class="card" data-b="sum">${isY ? `<select onchange="finMonth(this.value)">${years.map(v => `<option value="${v}" ${v === m ? 'selected' : ''}>${v} 整年</option>`).join('')}</select><p class="mut" style="margin:6px 0 0">${nM} 個月有記帳・<a class="wl" onclick="finMonth('${m === today().slice(0, 4) ? month(today()) : yms[yms.length - 1] || month(today())}')">回到單月</a></p>` : `<input type="month" value="${m}" onchange="finMonth(this.value)"><p class="mut" style="margin:6px 0 0">${years.map(v => `<a class="wl" onclick="finMonth('${v}')">看 ${v} 整年</a>`).join('・')}</p>`}
  <div class="grid" style="margin-top:8px"><div><div class="eyebrow">收入</div><div class="big ok">${money(inc)}</div></div><div><div class="eyebrow">支出</div><div class="big bad">${money(out)}</div></div></div>
  <p style="margin:10px 0 8px">結餘 <b class="${inc - out >= 0 ? 'ok' : 'bad'}">${money(inc - out)}</b></p>
  <div class="mut"><a class="wl" onclick="finBudget()">${isY ? `${nM} 個月總預算` : '總預算'} ${money(budget)}</a>・已用 ${Math.round(out / budget * 100)}%</div><div class="bar" style="margin-top:6px"><i style="width:${Math.min(100, out / budget * 100)}%;background:${out > budget ? 'var(--bad)' : 'var(--bar)'}"></i></div></div>
  <div class="card" data-b="add"><h2>新增帳目</h2><div class="row"><select id="ft_t" onchange="finType()"><option value="out">支出</option><option value="in">收入</option></select><input type="date" id="ft_d" value="${today()}"></div>
  <div class="row"><input id="ft_a" type="number" inputmode="decimal" placeholder="金額"><select id="ft_c">${PFIN.out.map(c => `<option>${c}</option>`).join('')}</select></div>
  <div class="row"><input id="ft_k" list="ft_kl" placeholder="帳戶（選填）"><datalist id="ft_kl">${accts.map(a => `<option value="${esc(a)}">`).join('')}</datalist><input id="ft_n" placeholder="備註（選填）"></div><button class="b" onclick="finAdd()">記帳</button></div>
  ${cats.length ? `<div class="card" data-b="cats"><h2>支出分類</h2>${cats.map(([c, v]) => { const g = B[c]; return `<div class="mut" style="display:flex;justify-content:space-between;gap:8px"><span>${esc(c)} ${money(v)}${g ? '' : `（${out ? Math.round(v / out * 100) : 0}%）`}</span><a class="wl" onclick="finCatBudget('${esc(c)}')">${g ? `預算 ${money(g)}${v > g ? '・超出 ' + money(v - g) : ''}` : '設預算'}</a></div><div class="bar" style="margin:3px 0 8px"><i style="width:${Math.min(100, g ? v / g * 100 : out ? v / out * 100 : 0)}%;${g && v > g ? 'background:var(--bad)' : ''}"></i></div>`; }).join('')}</div>` : ''}
  <div class="card" data-b="list"><h2>明細</h2>${t.sort((a, b) => b.date.localeCompare(a.date)).map(x => `<div class="item"><span>${x.date.slice(5)} ${esc(x.cat)} <span class="mut">${esc([x.note, x.acct].filter(Boolean).join('・'))}</span></span><span><b class="${x.type === 'in' ? 'ok' : ''}">${x.type === 'in' ? '+' : '-'}${money(x.amount)}</b><button class="x" onclick="del('${x.id}')">✕</button></span></div>`).join('') || '<p class="empty">尚無帳目</p>'}</div>` + analysis;
}

// ---------- 投資（個人財務的分頁）：投入金額來自記帳裡「投資」分類；持有部位與市值手動維護 ----------
window.invAdd = () => { const n = val('iv_n'); if (!n) return; put('holding', { name: n, kind: val('iv_k'), cost: +val('iv_c') || 0, value: +val('iv_v') || 0, at: today() }); render(); };
window.invEdit = (id, k, label) => { const v = prompt(label, DB[id].data[k] ?? ''); if (v === null) return; patch(id, k === 'name' || k === 'kind' ? { [k]: v.trim() } : { [k]: +v || 0, at: today() }); render(); };
// 觀察清單：想研究或考慮買的標的，記下理由與消息來源，之後回頭對照
const W_SRC = ['自己研究', '朋友或聽到的消息', '新聞媒體', '書或課程', '其他'], W_ST = [['watch', '觀察中'], ['bought', '已買'], ['drop', '放棄']];
window.watchAdd = () => { const n = val('wt_n'); if (!n) return; put('watch', { name: n, kind: val('wt_k'), reason: val('wt_r'), source: val('wt_s'), status: 'watch', date: today() }); render(); };
window.watchEdit = (id, k, label) => { const v = prompt(label, DB[id].data[k] ?? ''); if (v === null) return; patch(id, { [k]: v.trim() }); render(); };
window.watchSet = (id, st) => { patch(id, { status: st, statusAt: today() }); render(); };
function watchCard() {
  const W = all('watch').sort((a, b) => (a.status === 'watch' ? 0 : 1) - (b.status === 'watch' ? 0 : 1) || (b.date || '').localeCompare(a.date || '')), n = W.filter(x => x.status === 'watch').length;
  const bySrc = {}; W.forEach(x => { if (x.source) bySrc[x.source] = (bySrc[x.source] || 0) + 1; });
  return `<div class="card" data-b="watch"><h2>觀察清單${W.length ? `（觀察中 ${n}）` : ''}</h2>${W.map(x => `<div class="item" style="display:block;${x.status === 'watch' ? '' : 'opacity:.6'}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span><a class="wl" onclick="watchEdit('${x.id}','name','名稱')"><b>${esc(x.name)}</b></a> <a class="wl mut" onclick="watchEdit('${x.id}','kind','類型')">${esc(x.kind || '類型')}</a></span><span><select style="margin:0;padding:4px 8px;width:auto" onchange="watchSet('${x.id}',this.value)" aria-label="狀態">${W_ST.map(([k, l]) => `<option value="${k}" ${x.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="x" onclick="del('${x.id}')">✕</button></span></div>
    <div class="mut" style="margin-top:4px">理由：<a class="wl" onclick="watchEdit('${x.id}','reason','想買的理由')">${esc(x.reason) || '尚未填寫'}</a></div><div class="mut">來源：<a class="wl" onclick="watchEdit('${x.id}','source','消息來源')">${esc(x.source) || '尚未填寫'}</a>・${esc(x.date || '')} 加入${x.statusAt && x.status !== 'watch' ? `・${esc(x.statusAt)} ${x.status === 'bought' ? '買進' : '放棄'}` : ''}</div></div>`).join('') || '<p class="empty">還沒有觀察中的標的</p>'}
  ${Object.keys(bySrc).length > 1 ? `<p class="mut" style="margin:10px 0 0">來源分布：${Object.entries(bySrc).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v}`).join('、')}</p>` : ''}</div>
  <div class="card" data-b="watchadd"><h2>加入觀察</h2><div class="row"><input id="wt_n" placeholder="名稱或代號"><input id="wt_k" placeholder="類型（例：主動型 ETF、美股、基金）"></div><input id="wt_r" placeholder="想買的理由"><select id="wt_s"><option value="">消息來源</option>${W_SRC.map(v => `<option>${v}</option>`).join('')}</select><button class="b" onclick="watchAdd()">加入</button></div>`;
}
function invest() {
  const T = all('txn').filter(x => x.type === 'out' && x.cat === '投資').sort((a, b) => b.date.localeCompare(a.date)), H = all('holding').sort((a, b) => b.value - a.value);
  const put_ = T.reduce((a, x) => a + x.amount, 0), cost = H.reduce((a, x) => a + x.cost, 0), value = H.reduce((a, x) => a + x.value, 0);
  const ms = []; for (let k = month(today()), i = 0; i < 12; i++, k = prevMonth(k)) ms.unshift(k);
  const per = ms.map(k => T.filter(x => month(x.date) === k).reduce((a, x) => a + x.amount, 0)), mx = Math.max(1, ...per), n = per.filter(Boolean).length;
  return `<div class="card" data-b="sum"><div class="grid"><div><div class="eyebrow">記帳裡累計投入</div><div class="big">${money(put_)}</div></div><div><div class="eyebrow">持有部位市值</div><div class="big">${H.length ? money(value) : '—'}</div></div></div>
  ${H.length ? `<p style="margin:10px 0 0">成本 <b>${money(cost)}</b>・未實現損益 <b class="${value - cost >= 0 ? 'ok' : 'bad'}">${value - cost >= 0 ? '+' : ''}${money(value - cost)}</b>${cost ? `（${((value - cost) / cost * 100).toFixed(1)}%）` : ''}</p>` : ''}
  <p class="mut" style="margin:6px 0 0">近 12 個月有 ${n} 個月投入${n ? `，平均每次 ${money(per.reduce((a, x) => a + x, 0) / n)}` : ''}。投入金額取自「收支」裡分類為「投資」的帳目。</p></div>
  <div class="card" data-b="trend"><h2>每月投入</h2><div class="bars" style="grid-template-columns:repeat(12,1fr)">${ms.map((k, i) => `<div class="${k === month(today()) ? 'td' : ''}"><span>${per[i] ? Math.round(per[i] / 1000) + 'k' : ''}</span><i style="height:${per[i] / mx * 72}%"></i><small>${+k.slice(5)}</small></div>`).join('')}</div></div>
  <div class="card" data-b="hold"><h2>持有部位</h2>${H.map(x => `<div class="item"><span><a class="wl" onclick="invEdit('${x.id}','name','名稱')">${esc(x.name)}</a> <span class="mut">${esc(x.kind || '')}・成本 <a class="wl" onclick="invEdit('${x.id}','cost','成本')">${money(x.cost)}</a>・${esc(x.at || '')}</span></span><span><a class="wl" onclick="invEdit('${x.id}','value','目前市值')"><b>${money(x.value)}</b></a> <span class="${x.value - x.cost >= 0 ? 'ok' : 'bad'}" style="font-size:12.5px">${x.cost ? ((x.value - x.cost) / x.cost * 100).toFixed(1) + '%' : ''}</span><button class="x" onclick="del('${x.id}')">✕</button></span></div>`).join('') || '<p class="empty">還沒有持有部位。在下面新增（例如某檔 ETF、基金、存股），之後點市值就能更新。</p>'}
  ${H.length && value > 0 ? `<div style="margin-top:10px">${H.map(x => `<div class="mut">${esc(x.name)}（${pct(x.value, value)}%）</div><div class="bar" style="margin:3px 0 8px"><i style="width:${Math.min(100, x.value / value * 100)}%"></i></div>`).join('')}</div>` : ''}</div>
  <div class="card" data-b="add"><h2>新增持有部位</h2><div class="row"><input id="iv_n" placeholder="名稱（例：0050）"><input id="iv_k" placeholder="類型（例：ETF、基金、股票）"></div><div class="row"><input id="iv_c" type="number" inputmode="decimal" placeholder="累計成本"><input id="iv_v" type="number" inputmode="decimal" placeholder="目前市值"></div><button class="b" onclick="invAdd()">新增</button></div>
  ${watchCard()}
  <div class="card" data-b="list"><h2>投入紀錄</h2>${T.map(x => `<div class="item"><span>${x.date} <span class="mut">${esc([x.note, x.acct].filter(Boolean).join('・'))}</span></span><b>${money(x.amount)}</b></div>`).join('') || '<p class="empty">記帳裡還沒有「投資」分類的帳目</p>'}</div>
  <p class="mut" style="margin:0 2px 12px">這頁只做整理與計算，不提供投資建議。</p>`;
}

// ---------- 家庭財務（唯讀：後端從伴侶的記帳試算表讀出家庭類別，每月彙整成一筆 fam 紀錄） ----------
const famAll = () => all('fam').sort((a, b) => a.month.localeCompare(b.month));
// 結算用：把我自己記帳裡「家庭開支-」的支出併進來。
// 與伴侶帳上「我給家庭」日期相近（±4 天）且金額相近（±25%）的那筆是轉帳，不算支出（錢已由伴侶花在家庭開支上）；其餘是我直接付的家庭開支。
const famFull = () => famAll().map(f => {
  const gv = (f.give || []).slice(), direct = [];
  all('txn').filter(x => x.type === 'out' && /^家庭開支/.test(x.cat || '') && month(x.date) === f.month).forEach(x => {
    const j = gv.findIndex(g => Math.abs(new Date(g[0]) - new Date(x.date)) <= 4 * 864e5 && Math.abs(g[2] - x.amount) <= g[2] * 0.25);
    if (j >= 0) gv.splice(j, 1); else direct.push(x);
  });
  const mine = direct.reduce((a, x) => a + x.amount, 0), cats = { ...f.cats }; direct.forEach(x => cats[x.cat] = (cats[x.cat] || 0) + x.amount);
  return { ...f, pTotal: f.total, mine, total: f.total + mine, cats, items: [...f.items.map(x => [...x, '伴侶']), ...direct.map(x => [x.date, x.note || x.cat.replace('家庭開支-', ''), x.cat, x.amount, '我'])].sort((a, b) => b[0].localeCompare(a[0])) };
});
const famYear = (F, y) => { const M = F.filter(x => x.month.startsWith(y)), cats = {}; if (!M.length) return null; M.forEach(x => Object.entries(x.cats).forEach(([c, v]) => cats[c] = (cats[c] || 0) + v)); const sum = k => M.reduce((a, x) => a + (x[k] || 0), 0); return { month: y, year: true, n: M.length, cats, total: sum('total'), pTotal: sum('pTotal'), mine: sum('mine'), given: sum('given'), items: M.flatMap(x => x.items).sort((a, b) => b[0].localeCompare(a[0])) }; };
const famTotal = (m = month(today())) => (famFull().find(x => x.month === m) || {}).total || 0;
let famBusy = false;
window.famRefresh = async link => {
  if (famBusy || !cfg().token) return; famBusy = true; ui.famMsg = '讀取中…'; if (tab === 'ffin') render();
  try {
    const r = await api('POST', link ? { kind: 'family', sheet: link } : { kind: 'family' }), j = await r.json();
    ui.famMsg = j.error === 'no family sheet' ? '' : j.error === 'bad sheet link' ? '這不像是 Google 試算表的連結。' : j.error === 'cannot open family sheet' ? '打不開這份試算表，請確認已與你的 Google 帳號共用，或開啟「知道連結的人可檢視」。' : j.error ? '讀取失敗，稍後再試。' : '';
    if (!j.error) { LS('lh_famAt', Date.now()); await sync(); }
  } catch (e) { ui.famMsg = '離線中，連上網路後再試。'; }
  famBusy = false; if (tab === 'ffin') render();
};
window.famLink = () => { const v = val('fam_l') || prompt('貼上記帳試算表的連結'); if (v) famRefresh(v); };
window.famMonth = m => { ui.fm = m; render(); };
window.famShare = () => { const v = prompt('我應負擔家庭支出的比例（%）', setting('famshare', 50)); if (v === null) return; setSetting('famshare', Math.max(0, Math.min(100, +v || 0))); render(); };
// 沒有轉帳、以其他花費抵扣的月份：{ 'yyyy-MM': 金額 }，金額 0 表示只標記不計金額
window.famOffset = m => { const O = setting('famoffset', {}), v = prompt(`${+m.slice(5)} 月以其他花費抵扣的金額（不確定填 0；清空表示取消標記）`, O[m] ?? 0); if (v === null) return; const n = { ...O }; if (v.trim() === '') delete n[m]; else n[m] = Math.max(0, +v || 0); setSetting('famoffset', n); render(); };
function ffin() {
  const head = seg('ffin', [['fam', '家庭開支'], ['partner', '伴侶財務分析']]);
  if (sub.ffin === 'partner') return head + partnerView();
  return head + famView();
}
function famView() {
  const F = famFull(), msg = ui.famMsg ? `<p class="mut" style="margin:0 2px 12px">${esc(ui.famMsg)}</p>` : '';
  if (cfg().token && !famBusy && Date.now() - (LS('lh_famAt') || 0) > 30 * 6e4) { LS('lh_famAt', Date.now()); setTimeout(() => famRefresh(), 0); } // 每 30 分鐘最多向來源試算表重讀一次
  if (!F.length) return msg + `<div class="card" data-b="setup"><h2>連結家庭記帳表</h2><p class="mut" style="margin:0 0 8px">貼上伴侶記帳試算表的連結，這頁會顯示其中的家庭類別彙總。連結只存在你自己的後端，不會出現在公開的程式碼裡。</p><input id="fam_l" placeholder="https://docs.google.com/spreadsheets/d/…"><button class="b" onclick="famLink()">連結並讀取</button></div>`;
  const years = [...new Set(F.map(x => x.month.slice(0, 4)))].sort().reverse(), isY = /^\d{4}$/.test(ui.fm || '') && years.includes(ui.fm);
  const cur = isY ? famYear(F, ui.fm) : F.find(x => x.month === ui.fm) || F.find(x => x.month === month(today())) || F[F.length - 1], i = F.indexOf(cur), prev = isY ? famYear(F, String(+ui.fm - 1)) : F[i - 1];
  const cats = Object.entries(cur.cats).sort((a, b) => b[1] - a[1]), y = cur.month.slice(0, 4), yr = F.filter(x => x.month.startsWith(y)), last = isY ? yr : F.slice(-6), mx = Math.max(1, ...last.map(x => x.total)), at = LS('lh_famAt'), OFF = setting('famoffset', {});
  const avg = last.reduce((a, x) => a + x.total, 0) / last.length, ytotal = yr.reduce((a, x) => a + x.total, 0), paid = x => (x.given || 0) + (x.mine || 0) + (OFF[x.month] || 0), ygiven = yr.reduce((a, x) => a + paid(x), 0), share = setting('famshare', 50), due = ytotal * share / 100, big = cur.items.slice().sort((a, b) => b[3] - a[3])[0];
  return msg + `<div class="card" data-b="sum"><select onchange="famMonth(this.value)">${years.map(v => `<option value="${v}" ${isY && cur.month === v ? 'selected' : ''}>${v} 整年</option>`).join('')}${F.slice().reverse().map(x => `<option value="${x.month}" ${x === cur ? 'selected' : ''}>${x.month.replace('-', ' 年 ')} 月</option>`).join('')}</select>
  <div style="margin-top:10px"><div class="eyebrow">${isY ? `${y} 年家庭支出（${cur.n} 個月）` : '家庭支出'}</div><div class="big">${money(cur.total)}</div></div>
  <div style="margin:10px 0 0;padding:10px 12px;border-radius:10px;background:var(--tagbg)"><div class="eyebrow">${y} 年結算（我 ${share}%）</div><div class="big ${Math.abs(ygiven - due) < 1 ? '' : ygiven > due ? 'ok' : 'bad'}" style="font-size:21px">${Math.abs(ygiven - due) < 1 ? '剛好打平' : ygiven > due ? '我多給 ' + money(ygiven - due) : '我少給 ' + money(due - ygiven)}</div><div class="mut">應負擔 ${money(due)}・已負擔 ${money(ygiven)}${yr.some(x => OFF[x.month] === 0) ? `・另有 ${yr.filter(x => OFF[x.month] === 0).length} 個月抵扣未填金額` : ''}</div></div>
  <p style="margin:8px 0 0">伴侶付 <b>${money(cur.pTotal)}</b>・我直接付 <b>${money(cur.mine)}</b>${cur.given ? `・我轉給家庭 <b>${money(cur.given)}</b>` : ''}</p><p class="mut" style="margin:6px 0 0">${isY ? `平均每月 ${money(cur.total / cur.n)}・` : ''}${prev ? `${isY ? `前一年（${prev.n} 個月）` : '上月'} ${money(prev.total)}，${cur.total >= prev.total ? '增加' : '減少'} ${money(Math.abs(cur.total - prev.total))}・` : ''}${cur.items.length} 筆</p></div>
  <div class="card" data-b="cats"><h2>分類</h2>${cats.map(([c, v]) => `<div class="mut">${esc(c)} ${money(v)}（${cur.total > 0 ? Math.round(v / cur.total * 100) : 0}%）</div><div class="bar" style="margin:3px 0 8px"><i style="width:${Math.max(0, Math.min(100, cur.total > 0 ? v / cur.total * 100 : 0))}%"></i></div>`).join('')}</div>
  <div class="card" data-b="trend"><h2>${isY ? `${y} 年各月` : `近 ${last.length} 個月`}</h2><div class="bars" style="grid-template-columns:repeat(${last.length},1fr)">${last.map(x => `<div class="${x === cur ? 'td' : ''}" onclick="famMonth('${x.month}')" style="cursor:pointer"><span>${last.length > 8 ? Math.round(x.total / 1000) + 'k' : Math.round(x.total).toLocaleString()}</span><i style="height:${Math.max(0, x.total) / mx * 72}%"></i><small>${+x.month.slice(5)}${last.length > 8 ? '' : ' 月'}</small></div>`).join('')}</div></div>
  <div class="card" data-b="give"><h2>${y} 年結算</h2>
  <div class="item mut"><span>月份・家庭支出</span><span>我負擔（轉帳＋直接付）</span></div>
  ${yr.map(x => { const o = OFF[x.month]; return `<div class="item"><span>${+x.month.slice(5)} 月 <span class="mut">${money(x.total)}</span></span><span>${paid(x) ? `<b>${money(paid(x))}</b> <span class="mut">${[x.given ? '轉 ' + money(x.given) : '', x.mine ? '付 ' + money(x.mine) : '', o ? '抵 ' + money(o) : ''].filter(Boolean).join('＋')}</span>` : ''} ${o !== undefined ? `<a class="wl mut" onclick="famOffset('${x.month}')">${o ? '改抵扣' : '以其他花費抵扣'}</a>` : x.given ? '' : `<a class="wl mut" onclick="famOffset('${x.month}')">${paid(x) ? '加抵扣' : '未記錄'}</a>`}</span></div>`; }).join('')}
  <div class="item"><span><b>合計</b> <span class="mut">${money(ytotal)}</span></span><b>${money(ygiven)}</b></div>
  <p style="margin:10px 0 0">依 <a class="wl" onclick="famShare()">我 ${share}%／伴侶 ${100 - share}%</a> 分攤：我應負擔 <b>${money(due)}</b>，實際負擔 <b>${money(ygiven)}</b>，${Math.abs(ygiven - due) < 1 ? '剛好打平' : ygiven > due ? `<b class="ok">我多付 ${money(ygiven - due)}</b>` : `<b class="bad">我少付 ${money(due - ygiven)}</b>`}</p>
  <p class="mut" style="margin:8px 0 0">家庭支出＝伴侶帳上的家庭類別＋我記帳裡「家庭開支-」的支出（轉給家庭帳戶的那筆不重複計算）。${yr.some(x => OFF[x.month] === 0) ? `另有 ${yr.filter(x => OFF[x.month] === 0).length} 個月標記為以其他花費抵扣但沒填金額，尚未算進我負擔的部分；` : ''}點月份右邊可標記或修改抵扣金額，點比例可調整分攤方式。</p></div>
  ${tips([
    isY ? (() => { const hi = yr.slice().sort((a, b) => b.total - a.total)[0], lo = yr.slice().sort((a, b) => a.total - b.total)[0]; return `最高是 ${+hi.month.slice(5)} 月 <b>${money(hi.total)}</b>，最低是 ${+lo.month.slice(5)} 月 <b>${money(lo.total)}</b>`; })() : last.length > 1 ? `近 ${last.length} 個月平均 <b>${money(avg)}</b>，本月${cur.total >= avg ? '高於' : '低於'}平均 ${money(Math.abs(cur.total - avg))}` : '',
    cats[0] && cur.total > 0 ? `最大宗是「${esc(cats[0][0])}」<b>${money(cats[0][1])}</b>，佔 ${pct(cats[0][1], cur.total)}%` : '',
    ygiven && ytotal > 0 ? `${y} 年至今家庭支出 <b>${money(ytotal)}</b>，我負擔 <b>${money(ygiven)}</b>，相當於 ${pct(ygiven, ytotal)}%` : '',
    big ? `單筆最高：${big[0].slice(5)} ${esc(big[1])} ${money(big[3])}` : ''
  ])}${advice('ffin')}
  <div class="card" data-b="list"><h2>明細</h2>${cur.items.map(x => `<div class="item"><span>${x[0].slice(5)} ${esc(x[1])} <span class="mut">${esc(x[2])}・${x[4]}付</span></span><b>${money(x[3])}</b></div>`).join('')}</div>
  <p class="mut" style="margin:0 2px 12px">資料來自伴侶的記帳試算表（唯讀）與我的個人記帳${at ? '・上次讀取 ' + new Date(at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}・<a class="wl" onclick="famRefresh()">重新讀取</a>・<a class="wl" onclick="famLink()">更換來源</a></p>`;
}

// 伴侶財務分析：資料來自同一份試算表的年度損益彙總與資產負債（唯讀），後端整理成 partner_yyyy
function partnerView() {
  const P = all('partner').sort((a, b) => b.year - a.year)[0];
  if (cfg().token && !famBusy && Date.now() - (LS('lh_famAt') || 0) > 30 * 6e4) { LS('lh_famAt', Date.now()); setTimeout(() => famRefresh(), 0); }
  if (!P) return `<div class="card"><p class="empty">還沒有資料。先在「家庭開支」連結記帳試算表，或<a class="wl" onclick="famRefresh()">重新讀取</a>。</p></div>`;
  const inc = P.incTotal || [], exp = P.expTotal || [], idx = inc.map((v, i) => i).filter(i => inc[i] || exp[i]), n = idx.length || 1;
  const sum = a => idx.reduce((t, i) => t + (a[i] || 0), 0), tInc = sum(inc), tExp = sum(exp);
  const cats = Object.entries(P.expense || {}).map(([c, v]) => [c, sum(v)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const incs = Object.entries(P.income || {}).map(([c, v]) => [c, sum(v)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const deficit = idx.filter(i => exp[i] > inc[i]), interest = sum((P.expense || {})['利息費用'] || []);
  const cash = (P.assets || []).filter(x => /現金|存款|悠遊卡|支付/.test(x[0])).reduce((t, x) => t + x[1], 0), loans = (P.liabs || []).filter(x => /借款|貸款/.test(x[0])).reduce((t, x) => t + x[1], 0), cards = (P.liabs || []).filter(x => /信用卡/.test(x[0])).reduce((t, x) => t + x[1], 0);
  const once = cats.filter(([c]) => /裝潢/.test(c)).reduce((t, x) => t + x[1], 0), list = (rows, tot) => rows.slice().sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="mut">${esc(k)} ${money(v)}（${pct(v, tot)}%）</div><div class="bar" style="margin:3px 0 8px"><i style="width:${Math.max(0, Math.min(100, tot ? v / tot * 100 : 0))}%"></i></div>`).join('');
  return `<div class="card" data-b="net"><div class="eyebrow">淨資產${P.asOf ? '・' + esc(P.asOf.replace(/資產負債.*/, '').trim()) : ''}</div><div class="big ${P.netWorth < 0 ? 'bad' : 'ok'}">${money(P.netWorth || 0)}</div>
  <div class="grid" style="margin-top:10px"><div><div class="eyebrow">資產</div><div class="big">${money(P.assetTotal || 0)}</div></div><div><div class="eyebrow">負債</div><div class="big">${money(P.liabTotal || 0)}</div></div></div></div>
  <div class="card" data-b="ytd"><h2>${P.year} 年每月收支</h2>${pairBars(idx.map(i => (i + 1) + ' 月'), idx.map(i => inc[i]), idx.map(i => exp[i]), -1)}${legend('收入', '支出')}
  <p style="margin:10px 0 0">累計收入 <b>${money(tInc)}</b>、支出 <b>${money(tExp)}</b>、餘絀 <b class="${tInc - tExp >= 0 ? 'ok' : 'bad'}">${money(tInc - tExp)}</b></p></div>
  ${tips([
    `平均每月收入 <b>${money(tInc / n)}</b>、支出 <b>${money(tExp / n)}</b>；${n} 個月裡有 ${deficit.length} 個月入不敷出`,
    once ? `其中一次性的裝潢費用 ${money(once)}；扣除後平均每月支出 <b>${money((tExp - once) / n)}</b>，${(tExp - once) <= tInc ? '低於' : '仍高於'}平均收入` : '',
    interest ? `利息費用累計 ${money(interest)}，平均每月 <b>${money(interest / n)}</b>，佔收入 ${pct(interest, tInc)}%` : '',
    loans ? `借款餘額 <b>${money(loans)}</b>，是年收入（以目前月均推估 ${money(tInc / n * 12)}）的 ${(loans / (tInc / n * 12 || 1)).toFixed(1)} 倍` : '',
    cash || cards ? `可動用現金與存款 <b>${money(cash)}</b>，約可支應 ${((cash) / ((tExp - once) / n || 1)).toFixed(1)} 個月的日常支出；信用卡未繳 ${money(cards)}` : '',
    cats[0] ? `支出前三名：${cats.filter(([c]) => !/裝潢/.test(c)).slice(0, 3).map(([c, v]) => `${esc(c)} ${money(v)}`).join('、')}` : ''
  ])}${advice('partner')}
  <div class="card" data-b="exp"><h2>支出分類（累計）</h2>${list(cats.slice(0, 12), tExp)}</div>
  ${incs.length ? `<div class="card" data-b="inc"><h2>收入來源（累計）</h2>${list(incs, tInc)}</div>` : ''}
  <div class="card" data-b="assets"><h2>資產</h2>${list(P.assets || [], P.assetTotal || 0)}</div>
  <div class="card" data-b="liabs"><h2>負債</h2>${list(P.liabs || [], P.liabTotal || 0)}</div>
  <p class="mut" style="margin:0 2px 12px">資料來自伴侶的記帳試算表（唯讀），只存在你自己的後端與裝置・<a class="wl" onclick="famRefresh()">重新讀取</a></p>`;
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

// ---------- 飲食管理：熱量與營養素來自 Apple 健康（OtterLife 寫入，由手機捷徑上傳）；也可以手動記一餐 ----------
const SLOTS = ['早餐', '午餐', '晚餐', '點心'], waterId = d => 'water_' + d, cups = d => DB[waterId(d)] && !DB[waterId(d)].deleted ? DB[waterId(d)].data.cups : 0;
window.dietDate = d => { ui.dd = d; render(); };
window.waterSet = n => { put('water', { date: ui.dd, cups: Math.max(0, n) }, waterId(ui.dd)); render(); };
window.waterGoal = () => { const g = prompt('每日喝水目標（杯）', setting('water_goal', 8)); if (g) { setSetting('water_goal', +g); render(); } };
window.kcalGoal = () => { const g = prompt('每日攝取熱量目標（kcal）', setting('kcal_goal', 1800)); if (g) { setSetting('kcal_goal', +g); render(); } };
const mealsOf = d => all('meal').filter(m => m.date === d), mealSum = (d, k) => mealsOf(d).reduce((a, m) => a + (+m[k] || 0), 0);
const dayKcal = d => mealSum(d, 'kcal') || hv(d, 'diet_kcal');
const mealMsg = t => { const e = $('#mst'); if (e) e.textContent = t; };
window.mealAdd = () => { const t = val('mt'); if (!t) return mealMsg('請先輸入這一餐的名稱'); const n = k => +val(k) || 0;
  put('meal', { date: ui.dd, slot: val('ms'), text: t, note: val('mn'), kcal: n('mk'), protein_g: n('mp'), carbs_g: n('mc'), fat_g: n('mf'), });
  render(); };
window.mealEdit = id => { ui.editMeal = id; render(); };
window.mealSave = id => { const t = val('me_t'); if (!t) return; const n = k => +val(k) || 0; patch(id, { text: t, slot: val('me_s'), kcal: n('me_k'), protein_g: n('me_p'), carbs_g: n('me_c'), fat_g: n('me_f') }); ui.editMeal = null; render(); };
const macroIn = (pre, m) => `<div class="row"><input id="${pre}k" type="number" inputmode="numeric" placeholder="熱量 kcal" value="${m.kcal || ''}"><input id="${pre}p" type="number" inputmode="numeric" placeholder="蛋白質 g" value="${m.protein_g || ''}"><input id="${pre}c" type="number" inputmode="numeric" placeholder="碳水 g" value="${m.carbs_g || ''}"><input id="${pre}f" type="number" inputmode="numeric" placeholder="脂肪 g" value="${m.fat_g || ''}"></div>`;
function diet() {
  const d = ui.dd, ms = mealsOf(d), wg = setting('water_goal', 8), c = cups(d), dates = weekDates(), ml = hv(d, 'water_ml'), fromHk = !mealSum(d, 'kcal') && hv(d, 'diet_kcal');
  const kg = setting('kcal_goal', 1800), kcal = dayKcal(d), P = mealSum(d, 'protein_g') || hv(d, 'protein_g'), C = mealSum(d, 'carbs_g') || hv(d, 'carbs_g'), F = mealSum(d, 'fat_g') || hv(d, 'fat_g'), mk = P * 4 + C * 4 + F * 9;
  const macro = (n, g, k) => `<div style="display:flex;justify-content:space-between;margin-top:8px"><span>${n}</span><span class="mut">${g ? Math.round(g) + ' g · ' + Math.round(g * k / (mk || 1) * 100) + '%' : '–'}</span></div><div class="bar"><i style="width:${mk ? g * k / mk * 100 : 0}%"></i></div>`;
  const row = m => ui.editMeal === m.id
    ? `<div class="item" style="display:block"><div class="row"><select id="me_s" style="flex:0 0 96px">${SLOTS.map(x => `<option ${x === m.slot ? 'selected' : ''}>${x}</option>`).join('')}</select><input id="me_t" value="${esc(m.text)}"></div>${macroIn('me_', m)}<div class="row"><button class="b" onclick="mealSave('${m.id}')">儲存</button><button class="b g" onclick="ui.editMeal=null;render()">取消</button></div></div>`
    : `<div class="item"><span>${esc(m.text)}${m.kcal ? ` <b>${Math.round(m.kcal)}</b> <span class="mut">kcal</span>` : ''} <span class="mut">${esc(m.note || '')}</span></span><span style="flex:none;white-space:nowrap"><button class="x" onclick="mealEdit('${m.id}')" aria-label="編輯">✎</button><button class="x" onclick="del('${m.id}')" aria-label="刪除">✕</button></span></div>`;
  return hkNote() + `<div class="card"><div class="row"><input type="date" value="${d}" onchange="dietDate(this.value)"><button class="b g" onclick="dietDate('${today()}')">今天</button></div></div>
  <div class="card"><h2>攝取熱量 <a class="wl" onclick="kcalGoal()">目標 ${kg} kcal</a></h2>${num(kcal, 'kcal')}<div class="bar" style="margin:8px 0 4px"><i style="width:${Math.min(100, kcal / kg * 100)}%;background:${kcal > kg ? 'var(--bad)' : 'var(--bar)'}"></i></div><div class="mut">${kcal ? (kcal > kg ? `超過目標 ${Math.round(kcal - kg)} kcal` : `還可以吃 ${Math.round(kg - kcal)} kcal`) + (fromHk ? ' · 來自 Apple 健康' : '') : '這一天還沒有資料'}</div></div>
  <div class="card"><h2>${d === today() ? '今日' : d} 餐點</h2>${SLOTS.map(sl => { const l = ms.filter(m => m.slot === sl); return l.length ? `<div class="eyebrow" style="margin-top:8px">${sl} · ${Math.round(l.reduce((a, m) => a + (+m.kcal || 0), 0))} kcal</div>` + l.map(row).join('') : ''; }).join('') || '<p class="empty">這一天還沒有記錄</p>'}</div>
  <details class="card" data-b="mealform"${ms.length ? ' open' : ''}><summary style="cursor:pointer"><b class="serif">手動記一餐</b></summary><div class="row" style="margin-top:10px"><select id="ms" style="flex:0 0 96px">${SLOTS.map(x => `<option>${x}</option>`).join('')}</select><input id="mt" placeholder="吃了什麼" onkeydown="event.key==='Enter'&&mealAdd()"></div>
    ${macroIn('m', {})}<input id="mn" placeholder="備註：飽足感、心情（選填）"><button class="b" onclick="mealAdd()">存入</button><p class="mut" id="mst" style="margin:4px 0 0;min-height:1.2em"></p></details>
  <div class="card"><h2>三大營養素</h2>${macro('蛋白質', P, 4)}${macro('碳水化合物', C, 4)}${macro('脂肪', F, 9)}</div>
  <div class="card"><h2>本週攝取熱量</h2>${bars(dates, dates.map(dayKcal))}</div>
  <div class="card"><h2>喝水 <a class="wl" onclick="waterGoal()">目標 ${wg} 杯</a></h2>${ml ? `<div class="mut" style="margin-bottom:6px">Apple 健康：${Math.round(ml).toLocaleString()} ml</div>` : ''}<div class="hw">${Array.from({ length: Math.max(wg, c) }, (_, i) => `<button class="hc ${i < c ? 'on' : ''}" onclick="waterSet(${i < c ? i : i + 1})" aria-label="第 ${i + 1} 杯"></button>`).join('')}</div><div class="mut" style="margin-top:6px">${c} / ${wg} 杯</div></div>`;
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
// 每年一張九宮格：ui.my 是目前檢視的年份（預設今年）
const mYear = () => ui.my || new Date().getFullYear();
const MID = () => 'mandala_' + mYear();
window.mSetYear = y => { ui.my = +y; ui.mb = 4; render(); };
const mcells = () => DB[MID()] && !DB[MID()].deleted ? DB[MID()].data.cells || {} : {};
const mkey = (b, i) => b === 4 ? `4_${i}` : i === 4 ? `4_${b}` : `${b}_${i}`;
window.mSet = (k, label) => { const v = prompt(label, mcells()[k] || ''); if (v === null) return; put('mandala', { year: mYear(), cells: { ...mcells(), [k]: v.trim() } }, MID()); render(); };
window.mOpen = b => { ui.mb = b; render(); };
window.mTap = (b, i) => { const c = mcells(); if (b === 4) { if (i === 4) return mSet('4_4', '今年的核心目標'); return c[`4_${i}`] ? mOpen(i) : mSet(`4_${i}`, '面向（例：健康、財務、創作）'); } if (i === 4) return mSet(`4_${b}`, '面向名稱'); mSet(`${b}_${i}`, '具體行動'); };
const mBlock = (b, mini) => `<div class="mand ${mini ? 'mini' : ''}">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => { const t = mcells()[mkey(b, i)] || ''; return `<div class="mc ${i === 4 ? (b === 4 ? 'core' : 'ctr') : ''} ${b === 4 && i !== 4 ? 'sub' : ''}" onclick="${mini ? `mOpen(${b})` : `mTap(${b},${i})`}">${esc(t) || (mini ? '' : '<span class="mut">＋</span>')}</div>`; }).join('')}</div>`;
function mandala() {
  const c = mcells(), b = ui.mb, filled = Object.keys(c).filter(k => !k.startsWith('4_') && c[k]).length, ny = new Date().getFullYear();
  const ys = [...new Set([...all('mandala').map(x => +x.year).filter(Boolean), ny, ny + 1, mYear()])].sort((a, b) => b - a);
  return `<div class="seg">${ys.map(y => `<button class="${y === mYear() ? 'on' : ''}" onclick="mSetYear(${y})">${y}${y === ny ? '・今年' : ''}</button>`).join('')}</div><div class="card"><div class="item" style="border:0;padding:0 0 10px"><span><b class="serif" style="font-size:16px">${b === 4 ? `${mYear()} 曼陀羅` : esc(c[`4_${b}`] || '面向')}</b><div class="mut">${b === 4 ? '中心是核心目標，周圍是八個面向。點已填的面向可展開它的八個行動。' : '中心是這個面向，周圍寫八個具體行動。'}</div></span>${b === 4 ? '' : `<button class="b g" style="width:auto;flex:none" onclick="mOpen(4)">‹ 回中心</button>`}</div>
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
window.cpAdd = () => { const t = $('#ct').value.trim(); if (!t) return; const d = { text: t, src: val('cs'), page: val('cpg'), thought: $('#cth').value.trim(), para: val('cpa') }; if (ui.cpEd && DB[ui.cpEd]) patch(ui.cpEd, d); else put('quote', { ...d, gist: '', date: today(), created: Date.now() }); ui.cpEd = null; render(); };
window.cpOpen = id => { ui.cpEd = id; render(); scrollTo(0, 0); setTimeout(() => $('#ct') && $('#ct').focus()); };
window.cpEdit = (id, k, label) => { const v = prompt(label, DB[id].data[k] || ''); if (v === null) return; patch(id, { [k]: v.trim() }); render(); };
window.cpPara = (id, v) => { patch(id, { para: v }); render(); };
// 把一則靈感放進今年曼陀羅九宮格：跳出九宮格樣子的面向選單，點一個面向就填進該面向第一個空格；九宮格本來就會同步
const M_OUT = [0, 1, 2, 3, 5, 6, 7, 8];
window.cpToMandala = id => {
  const x = DB[id].data, c = mcells();
  if (!M_OUT.some(b => c['4_' + b])) return alert('九宮格還沒有設定面向，請先到「未來目標 → 曼陀羅九宮格」填中間的八個面向。');
  let d = $('#mDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'mDlg'; document.body.appendChild(d); }
  d.innerHTML = `<h2 style="margin-top:0">放進 ${mYear()} 九宮格</h2><input id="mTxt" maxlength="30" value="${esc((x.gist || x.text || '').slice(0, 20))}" aria-label="要寫進格子的內容"><p class="mut" style="margin:6px 0 10px">先改成想寫進格子的短句，再點要放的面向。</p>
  <div class="mand">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(b => { if (b === 4) return `<div class="mc core">${esc(c['4_4'] || mYear())}</div>`; const name = c['4_' + b], free = M_OUT.filter(i => !c[`${b}_${i}`]).length; return name && free ? `<div class="mc ctr" style="cursor:pointer;flex-direction:column" onclick="cpMandPick('${id}',${b})">${esc(name)}<small class="mut" style="display:block">空 ${free} 格</small></div>` : `<div class="mc" style="opacity:.45;flex-direction:column">${esc(name || '')}${name ? '<small class="mut" style="display:block">已滿</small>' : ''}</div>`; }).join('')}</div>
  <button class="b g" style="margin-top:12px" onclick="$('#mDlg').close()">取消</button>`;
  d.showModal();
};
window.cpMandPick = (id, b) => {
  const c = mcells(), text = ($('#mTxt').value || '').trim(); if (!text) return $('#mTxt').focus();
  const slot = M_OUT.find(i => !c[`${b}_${i}`]); if (slot === undefined) return;
  const k = `${b}_${slot}`; put('mandala', { year: mYear(), cells: { ...c, [k]: text } }, MID()); patch(id, { mand: { b, k } }); $('#mDlg').close(); render();
};
window.cpToCard = id => { const x = DB[id].data; sub.know = 'notes'; ui.note = null; ui.draft = `${x.gist || ''}\n\n「${x.text}」${x.thought ? '\n\n' + x.thought : ''}`.trim(); ui.draftSrc = x.src + (x.page ? ` p.${x.page}` : ''); render(); scrollTo(0, 0); };
function commonplace() {
  const q = ui.cq.toLowerCase(), f = ui.cpf || '', qs = all('quote').sort((a, b) => (b.created || 0) - (a.created || 0)).filter(x => (!f || (x.para || 'R') === f) && (!q || (x.text + x.src + x.thought + (x.gist || '')).toLowerCase().includes(q)));
  const E = ui.cpEd && DB[ui.cpEd] && !DB[ui.cpEd].deleted ? DB[ui.cpEd].data : null;
  return `<div class="card"><h2>${E ? '編輯摘錄' : '擷取'}</h2><textarea id="ct" style="min-height:84px" placeholder="抄下打動你的一段話">${E ? esc(E.text) : ''}</textarea><div class="row"><input id="cs" list="bks" placeholder="出處（書名／作者）" style="flex:3" value="${E ? esc(E.src || '') : ''}"><datalist id="bks">${all('book').map(b => `<option value="${esc(b.title)}">`).join('')}</datalist><input id="cpg" placeholder="頁碼" style="flex:1" value="${E ? esc(E.page || '') : ''}"></div>
    <textarea id="cth" style="min-height:60px" placeholder="我的想法：為什麼留下它、可以怎麼用">${E ? esc(E.thought || '') : ''}</textarea>
    <div class="row"><select id="cpa" aria-label="PARA 歸屬">${PARA.map(([k, n]) => `<option value="${k}" ${k === (E ? E.para || 'R' : 'R') ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="b" style="flex:2" onclick="cpAdd()">${E ? '儲存修改' : '收進靈感'}</button>${E ? `<button class="b g" onclick="ui.cpEd=null;render()">取消</button>` : ''}</div></div>
  <div class="row" style="align-items:center"><input placeholder="搜尋摘錄" value="${esc(ui.cq)}" onchange="ui.cq=this.value;render()"></div>
  <div class="seg" style="margin-top:6px">${[['', '全部'], ...PARA].map(([k, n]) => `<button class="${f === k ? 'on' : ''}" onclick="ui.cpf='${k}';render()">${n}</button>`).join('')}</div>
  <div data-b="quotes">${qs.map(x => `<div class="card"><blockquote class="qt">${esc(x.text)}</blockquote><div class="mut" style="display:flex;justify-content:space-between"><span>— ${esc(x.src) || '未註明出處'}${x.page ? `，p.${esc(x.page)}` : ''}</span><span style="flex:none;white-space:nowrap"><button class="x" onclick="cpOpen('${x.id}')" aria-label="編輯">✎</button><button class="x" onclick="confirm('刪除這則摘錄？')&&del('${x.id}')" aria-label="刪除">✕</button></span></div>${x.thought ? `<p style="margin:8px 0 0">${esc(x.thought)}</p>` : ''}
    <p style="margin:10px 0 6px"><span class="eyebrow">一句話重點</span><br><a class="wl" onclick="cpEdit('${x.id}','gist','用自己的話，一句話說出重點')">${esc(x.gist) || '還沒萃取，點這裡寫一句'}</a></p>
    <div class="row" style="align-items:center"><select style="flex:0 0 96px;margin:0" onchange="cpPara('${x.id}',this.value)" aria-label="PARA 歸屬">${PARA.map(([k, n]) => `<option value="${k}" ${(x.para || 'R') === k ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="b g" style="margin:0" onclick="cpToCard('${x.id}')">轉成知識小卡</button><button class="b g" style="margin:0" onclick="cpToMandala('${x.id}')">放進九宮格</button></div>${x.mand && mcells()[x.mand.k] ? `<p class="mut" style="margin:8px 0 0">已放進九宮格「${esc(mcells()['4_' + x.mand.b] || '')}」：${esc(mcells()[x.mand.k])}</p>` : ''}</div>`).join('') || '<div class="card"><p class="empty">還沒有摘錄</p></div>'}</div>
  <p class="mut" style="margin:12px 2px">第二大腦的流程：擷取 → 整理（專案／領域／資源／封存）→ 萃取成一句話 → 轉成小卡，變成自己的東西。</p>`;
}
const know = () => seg('know', [['read', '目前閱讀・書單'], ['cp', '靈感／小想法'], ['notes', '知識小卡']]) + (sub.know === 'notes' ? notes() : sub.know === 'cp' ? commonplace() : reading());

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
  const f = fitStats(), P = finSum(), goalMin = setting('goal', 150);
  const todo = todosOpen();
  const rd = all('book').filter(b => b.status === 'reading'), hs = all('habit'), hToday = hs.filter(h => hDone(h.id, today())).length;
  const meals = all('meal').filter(m => m.date === today()).length, goals = all('goal').filter(g => !g.done);
  const h = new Date().getHours(), greet = h < 5 ? '夜深了' : h < 11 ? '早安' : h < 18 ? '午安' : '晚安';
  const date = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const stat = { bujo: `${todo.length} 項待辦 · ${all('shop').filter(x => !x.bought).length} 項待買`, habit: hs.length ? `今日 ${hToday} / ${hs.length}` : '尚未建立', diet: dayKcal(today()) ? `今日 ${Math.round(dayKcal(today()))} kcal` : `今日 ${meals} 餐 · 水 ${cups(today())} 杯`, fit: `${f.min} / ${goalMin} 分`, ffin: `本月 ${money(famTotal())}`, pfin: `本月 ${money(P.out)}`, know: `${rd.length} 本在讀`, goal: `${goals.length} 個進行中` };
  const active = new Set([...f.w.map(x => x.date), ...all('habitlog').map(l => l.date), ...all('health').filter(x => x.exercise_min > 0).map(x => x.date)]);
  return `<div class="card hero full" data-b="hero"><div class="hero-t"><div class="eyebrow">${date}</div><h2>${greet}，Eilis</h2>
      <q class="idq" onclick="editSetting('identity','身分宣言：我是一個…的人',DEF_ID)">${esc(setting('identity', DEF_ID))}</q>
      ${cfg().token ? '' : `<br><span class="chip" onclick="$('#sync').click()">尚未同步 · 點此設定</span>`}</div><div class="hero-art">${HERO_ART}</div></div>
  ${weekStrip(active)}
    <div class="card"><h2>待辦事項</h2>${todo.slice(0, 6).map(todoRow).join('') || `<p class="empty">沒有待辦 · <a class="wl" onclick="go('bujo')">記下一件事</a></p>`}${todo.length > 6 ? `<p class="mut" style="margin:8px 0 0"><a class="wl" onclick="go('bujo')">還有 ${todo.length - 6} 項</a></p>` : ''}</div>
    <div class="card"><h2>今日習慣</h2>${hs.map(x => `<div class="item"><span><i class="dot ${hDone(x.id, today()) ? 'on' : ''}" onclick="habitToggle('${x.id}','${today()}')"></i>${esc(x.name)}</span><span class="mut">${esc(x.tiny || '')}</span></div>`).join('') || `<p class="empty">還沒有習慣 · <a class="wl" onclick="go('habit')">建立第一個</a></p>`}</div>
    ${weightCard('hw', false)}
    <div class="grid" style="margin-bottom:12px" data-b="stats"><div class="card" onclick="go('fit')" style="cursor:pointer"><div class="eyebrow">本週運動</div><div class="big">${f.min}<small class="mut"> / ${goalMin}</small></div><div class="bar" style="margin:8px 0 6px"><i style="width:${Math.min(100, f.min / goalMin * 100)}%"></i></div><div class="mut">連續 ${f.streak} 天</div></div>
    <div class="card" onclick="go('pfin')" style="cursor:pointer"><div class="eyebrow">個人支出</div><div class="big">${money(P.out)}</div><div class="bar" style="margin:8px 0 6px"><i style="width:${Math.min(100, P.out / P.budget * 100)}%"></i></div><div class="mut">結餘 ${money(P.inc - P.out)}</div></div></div>
    <div class="card"><h2>目前閱讀</h2>${rd.slice(0, 2).map(b => `<div class="book" style="margin:4px 0 8px"><div class="cover">${esc(b.title.slice(0, 10))}</div><div style="flex:1;min-width:0"><b>${esc(b.title)}</b><div class="mut">${esc(b.author)}</div>${b.pages ? `<div class="bar" style="margin-top:6px"><i style="width:${Math.min(100, b.cur / b.pages * 100)}%"></i></div><div class="mut">${Math.round(b.cur / b.pages * 100)}%</div>` : ''}</div></div>`).join('') || `<p class="empty">還沒有在讀的書 · <a class="wl" onclick="go('know')">加入書單</a></p>`}</div>
  <div class="tiles full" data-b="tiles">${TABS.filter(x => x[0] !== 'home').map(([k, n]) => `<div class="tile" onclick="go('${k}')">${COVER[k]}<div class="tl"><div class="tn">${ICON[k]}${n}</div><div class="mut">${stat[k]}</div></div></div>`).join('')}</div>
  <div class="card quote full" data-b="quote" onclick="editSetting('quote','每日一句',DEF_QUOTE)">${esc(setting('quote', DEF_QUOTE))}</div>`;
}
const VIEWS = { home, bujo, habit, diet, fit, ffin, pfin: fin, know, goal };
applyTheme(localStorage.getItem('lh_theme') || 'light');
render(); sync();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
