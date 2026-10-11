/**
 * LifeHub 雲端同步後端（Google Apps Script + Google Sheet）
 * 資料存在綁定的試算表 "records" 工作表。金鑰存在「指令碼屬性」TOKEN。
 * 部署步驟見 cloud/README.md
 */
const HEAD = ['id', 'type', 'data', 'updated_at', 'deleted', 'seq'];

function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('records');
  if (!sh) { sh = ss.insertSheet('records'); sh.appendRow(HEAD); sh.setFrozenRows(1); }
  return sh;
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function authed_(t) { const k = PropertiesService.getScriptProperties().getProperty('TOKEN'); return !!k && String(t === undefined || t === null ? '' : t).trim() === String(k).trim(); }
function rows_(sh) { const n = sh.getLastRow(); return n < 2 ? [] : sh.getRange(2, 1, n - 1, 6).getValues(); }

function doGet(e) {
  if (!authed_(e.parameter.token)) return out_({ error: 'bad token' });
  const since = Number(e.parameter.since || 0), all = rows_(sheet_());
  const cursor = all.reduce((m, r) => Math.max(m, r[5]), 0);
  const changes = all.filter(r => r[5] > since).sort((a, b) => a[5] - b[5]).map(r => (
    { id: r[0], type: r[1], data: JSON.parse(r[2] || '{}'), updated_at: r[3], deleted: r[4] === true || r[4] === 1 || r[4] === 'TRUE' }));
  return out_({ cursor, changes });
}

// Apple 健康每日彙總（由 iOS 捷徑 POST：{ token, kind:"health", date:"yyyy-MM-dd", steps, exercise_min, … }）。同一天重送會合併更新，不會重複。
const HEALTH_KEYS = ['steps', 'exercise_min', 'active_kcal', 'distance_km', 'diet_kcal', 'protein_g', 'carbs_g', 'fat_g', 'water_ml', 'sleep_h', 'weight_kg', 'cycle_km', 'cycle_speed', 'cycle_cadence', 'cycle_power'];
// 捷徑傳來的值可能是多行（例如「738」＋補位的「0」）、帶單位或千分位：逐一取出數字後相加，不可把數字直接接在一起
function numSum_(v) { const m = String(v).replace(/(\d),(?=\d{3}(\D|$))/g, '$1').match(/-?\d+(\.\d+)?/g); return m ? m.reduce((a, x) => a + Number(x), 0) : null; }
function healthChange_(body, all, index) {
  const m = String(body.date || '').match(/\d{4}-\d{2}-\d{2}/), date = m ? m[0] : Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'), id = 'hk_' + date;
  const data = Object.assign(index[id] !== undefined ? JSON.parse(all[index[id]][2] || '{}') : {}, { date: date, src: 'apple-health' });
  HEALTH_KEYS.forEach(k => { if (body[k] === undefined || body[k] === null || body[k] === '') return; const n = numSum_(body[k]); if (n !== null) data[k] = Math.round(n * 100) / 100; });
  return { id: id, type: 'health', data: data, updated_at: Date.now() };
}

// 捷徑手動輸入的鍵名容易大小寫不一或多空白：統一成小寫、去掉空白與底線以外的差異；並支援較好打的別名
const ALIAS = { exercise: 'exercise_min', exercisemin: 'exercise_min', active: 'active_kcal', activekcal: 'active_kcal', distance: 'distance_km', distancekm: 'distance_km', kcal: 'diet_kcal', diet: 'diet_kcal', dietkcal: 'diet_kcal', protein: 'protein_g', proteing: 'protein_g', carbs: 'carbs_g', carbsg: 'carbs_g', fat: 'fat_g', fatg: 'fat_g', water: 'water_ml', waterml: 'water_ml', sleep: 'sleep_h', sleeph: 'sleep_h', weight: 'weight_kg', weightkg: 'weight_kg', cycle: 'cycle_km', cyclekm: 'cycle_km', bike: 'cycle_km', cyclespeed: 'cycle_speed', speed: 'cycle_speed', cyclecadence: 'cycle_cadence', cadence: 'cycle_cadence', cyclepower: 'cycle_power', power: 'cycle_power' };
function normBody_(raw) { const o = {}; Object.keys(raw || {}).forEach(k => { const n = String(k).trim().toLowerCase(); o[ALIAS[n.replace(/_/g, '')] || n] = raw[k]; }); if (typeof o.kind === 'string') o.kind = o.kind.trim().toLowerCase(); return o; }

// ---------- 飲食熱量估算（Claude API） ----------
// 前端 POST { token, kind:"nutrition", text?, image?(base64 JPEG), media_type? }；Anthropic 金鑰只存在「指令碼屬性」ANTHROPIC_API_KEY，不會傳到前端。
// Apps Script 沒有官方 Anthropic SDK，所以用 UrlFetchApp 直接呼叫 Messages API。
const NUTRI_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['name', 'items', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'confidence', 'note'],
  properties: {
    name: { type: 'string', description: '這一餐的簡短名稱（繁體中文）' },
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'portion', 'kcal'],
      properties: { name: { type: 'string' }, portion: { type: 'string', description: '估計份量，例如「一碗約 200 克」' }, kcal: { type: 'number' } } } },
    kcal: { type: 'number', description: '整餐總熱量（大卡）' },
    protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    note: { type: 'string', description: '一句話說明估算依據或最大的不確定因素（繁體中文）' } } };
function nutrition_(body) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { error: 'no api key' };
  const text = String(body.text || '').trim(), content = [];
  if (!text && !body.image) return { error: 'empty' };
  if (body.image) content.push({ type: 'image', source: { type: 'base64', media_type: body.media_type || 'image/jpeg', data: body.image } });
  content.push({ type: 'text', text: text ? '請估算這一餐的熱量與三大營養素。使用者的描述：' + text : '請依照片估算這一餐的熱量與三大營養素。' });
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 16000, fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: NUTRI_SCHEMA } },
      system: '你是營養估算助手，使用者在台灣。根據文字描述與（或）照片，辨識餐點中的每一項食物，估計份量，再估算熱量與蛋白質、碳水化合物、脂肪的克數。台灣常見的小吃、便當、手搖飲請用當地常見的份量與做法來估。照片與描述不一致時，以使用者的描述為準並在 note 說明。看不清楚或資訊不足時仍給出最合理的估計，把 confidence 設為 low，並在 note 說明還需要什麼資訊。所有文字用繁體中文，數字四捨五入到整數。',
      messages: [{ role: 'user', content: content }] }) });
  const code = res.getResponseCode(); let j = {}; try { j = JSON.parse(res.getContentText()); } catch (err) { return { error: 'bad response', status: code }; }
  if (code !== 200) return { error: 'api error', status: code, message: (j.error && j.error.message) || '' };
  if (j.stop_reason === 'refusal') return { error: 'refused' };
  if (j.stop_reason === 'max_tokens') return { error: 'truncated' };
  const t = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  try { return Object.assign({ ok: true }, JSON.parse(t)); } catch (err) { return { error: 'bad json' }; }
}

// ---------- 家庭開支：讀取另一份記帳試算表，只取家庭類別，彙整成每月一筆（type: fam，id: fam_yyyy-MM） ----------
// 來源試算表的 ID 只存在「指令碼屬性」FAMILY_SHEET（由前端貼連結設定），不寫進程式碼。類別可用 FAMILY_CATS 覆寫（逗號分隔）。
// 明細工作表的格式：第一列為 摘要／日期／類型／支出…；只讀最近 14 個月。
// FAMILY_GIVE（正規表示式，選填）：摘要或類型符合、且金額為負的列，視為「我給家庭帳戶的錢」，另外列在 give。
const FAM_CATS = ['外食費-家庭', '貓費用', '日用品費-家庭', '交通費-家庭', '租金水電', '電信費'];
function familyChanges_(all, index) {
  const P = PropertiesService.getScriptProperties(), sid = P.getProperty('FAMILY_SHEET');
  if (!sid) return { error: 'no family sheet' };
  let ss; try { ss = SpreadsheetApp.openById(sid); } catch (err) { return { error: 'cannot open family sheet' }; }
  const cats = (P.getProperty('FAMILY_CATS') || FAM_CATS.join(',')).split(',').map(s => s.trim()).filter(String);
  let giveRe = null; try { const g = P.getProperty('FAMILY_GIVE'); if (g) giveRe = new RegExp(g); } catch (err) {}
  const tz = ss.getSpreadsheetTimeZone(), now = new Date(), cut = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - 13, 1), tz, 'yyyy-MM'), by = {};
  ss.getSheets().forEach(sh => {
    const name = sh.getName(), nm = name.match(/^(\d{4})\.(\d{2})$/), rows = sh.getLastRow();
    if ((nm && nm[1] + '-' + nm[2] < cut) || rows < 2 || sh.getLastColumn() < 4) return;
    const head = sh.getRange(1, 1, 1, 4).getValues()[0];
    if (String(head[0]).trim() !== '摘要' || String(head[2]).trim() !== '類型') return;
    sh.getRange(2, 1, rows - 1, 4).getValues().forEach(r => {
      const c = String(r[2]).trim(), a = Number(r[3]), memo = String(r[0]).trim();
      if (!(r[1] instanceof Date) || !a) return;
      const give = !!giveRe && a < 0 && (giveRe.test(memo) || giveRe.test(c));
      if (!give && cats.indexOf(c) < 0) return;
      const d = Utilities.formatDate(r[1], tz, 'yyyy-MM-dd'), mo = d.slice(0, 7);
      if (mo < cut) return;
      by[mo] = by[mo] || {}; (by[mo][name] = by[mo][name] || []).push(give ? [d, memo, '', Math.round(-a * 100) / 100] : [d, memo, c, Math.round(a * 100) / 100]);
    });
  });
  const out = [];
  Object.keys(by).forEach(mo => {
    // 同一個月若出現在多張工作表（例如當月表與已歸檔的月表），取筆數最多的一張，避免重複計算
    const src = Object.keys(by[mo]).sort((a, b) => by[mo][b].length - by[mo][a].length || (/^\d{4}\.\d{2}$/.test(b) ? 1 : 0) - (/^\d{4}\.\d{2}$/.test(a) ? 1 : 0))[0];
    const rows = by[mo][src].sort((a, b) => a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0), items = rows.filter(x => x[2]), give = rows.filter(x => !x[2]).map(x => [x[0], x[1], x[3]]), sum = {};
    items.forEach(x => sum[x[2]] = Math.round(((sum[x[2]] || 0) + x[3]) * 100) / 100);
    const data = { month: mo, cats: sum, total: Math.round(items.reduce((t, x) => t + x[3], 0) * 100) / 100, items: items, given: Math.round(give.reduce((t, x) => t + x[2], 0) * 100) / 100, give: give }, id = 'fam_' + mo;
    if (index[id] !== undefined && all[index[id]][4] !== true && all[index[id]][2] === JSON.stringify(data)) return; // 沒變就不寫
    out.push({ id: id, type: 'fam', data: data, updated_at: Date.now() });
  });
  const pc = partnerChange_(ss, all, index); if (pc) out.push(pc);
  return out;
}

// 同一份試算表的年度損益彙總與資產負債，整理成一筆（type: partner，id: partner_yyyy），給「伴侶財務分析」分頁用
function partnerChange_(ss, all, index) {
  const y = new Date().getFullYear(), data = { year: y, income: {}, expense: {}, assets: [], liabs: [] }, n = x => Math.round(Number(x) || 0);
  const sh = ss.getSheetByName('年度損益彙總-' + y), bs = ss.getSheetByName('資產負債');
  if (!sh && !bs) return null;
  if (sh) {
    let sec = '';
    sh.getRange(1, 1, Math.min(sh.getLastRow(), 80), 13).getValues().forEach(r => {
      const k = String(r[0]).trim(), v = r.slice(1, 13).map(n);
      if (k === '收入' || k === '支出') { sec = k; return; }
      if (!k || !sec) return;
      if (k === '收入總額') data.incTotal = v; else if (k === '支出總額') data.expTotal = v; else if (/^本期餘/.test(k)) data.net = v;
      else if (v.some(Boolean)) data[sec === '收入' ? 'income' : 'expense'][k] = v;
    });
  }
  if (bs) {
    bs.getRange(1, 1, Math.min(bs.getLastRow(), 60), 11).getValues().forEach((r, i) => {
      if (i === 0) { data.asOf = String(r[1]).replace(/\s+/g, ' ').trim(); return; }
      const a = String(r[1]).trim(), av = n(r[5]), l = String(r[6]).trim(), lv = n(r[10]);
      if (a === '資產總額') data.assetTotal = av; else if (a && a !== '資產' && av) data.assets.push([a, av]);
      if (l === '負債總額') data.liabTotal = lv; else if (l === '淨資產') data.netWorth = lv; else if (l && l !== '負債' && lv) data.liabs.push([l, lv]);
    });
  }
  const id = 'partner_' + y;
  if (index[id] !== undefined && all[index[id]][4] !== true && all[index[id]][2] === JSON.stringify(data)) return null;
  return { id: id, type: 'partner', data: data, updated_at: Date.now() };
}

// 記一筆個人帳（給 iOS 捷徑用：{ token, kind:"txn", amount, cat, type?: 支出|收入, note?, acct?, date? }）
function txnChange_(body) {
  const a = numSum_(body.amount); if (a === null || !a) return null;
  const m = String(body.date || '').match(/\d{4}-\d{2}-\d{2}/), date = m ? m[0] : Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const t = String(body.type || '').trim();
  return { id: 'tx_' + Date.now() + Math.floor(Math.random() * 1000), type: 'txn', updated_at: Date.now(),
    data: { ledger: 'personal', date: date, type: /收入|^in/i.test(t) ? 'in' : 'out', amount: Math.abs(a), cat: String(body.cat || body.category || '其他').trim(), note: String(body.note || '').trim(), acct: String(body.acct || body.account || '').trim(), src: 'shortcut' } };
}

function doPost(e) {
  let raw = {}; try { raw = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ error: 'bad json' }); }
  const body = normBody_(raw);
  // 診斷資訊只含欄位名稱與金鑰長度，不含金鑰內容
  if (!authed_(body.token)) return out_({ error: 'bad token', hint: { keys: Object.keys(raw), tokenType: typeof body.token, tokenLength: body.token === undefined || body.token === null ? 0 : String(body.token).length, expectedLength: String(PropertiesService.getScriptProperties().getProperty('TOKEN') || '').trim().length } });
  if (body.kind === 'nutrition') return out_(nutrition_(raw)); // 不寫入試算表，也不需要鎖
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(), all = rows_(sh), index = {};
    all.forEach((r, i) => index[r[0]] = i);
    let seq = all.reduce((m, r) => Math.max(m, r[5]), 0);
    const changes = (body.changes || []).slice();
    if (body.kind === 'health') changes.push(healthChange_(body, all, index));
    if (body.kind === 'txn') { const t = txnChange_(body); if (!t) return out_({ error: 'bad amount' }); changes.push(t); }
    if (body.kind === 'family') {
      if (body.sheet) { const m = String(body.sheet).match(/[-\w]{25,}/); if (!m) return out_({ error: 'bad sheet link' }); PropertiesService.getScriptProperties().setProperty('FAMILY_SHEET', m[0]); }
      if (typeof raw.give === 'string') { try { new RegExp(raw.give); } catch (err) { return out_({ error: 'bad give pattern' }); } PropertiesService.getScriptProperties().setProperty('FAMILY_GIVE', raw.give); }
      const f = familyChanges_(all, index); if (f.error) return out_(f); f.forEach(c => changes.push(c));
    }
    // 原樣記錄（除金鑰外）：用來查看捷徑實際送出的內容，再決定如何解析
    if (body.kind === 'debug') { const d = {}; Object.keys(raw).forEach(k => { if (String(k).trim().toLowerCase() !== 'token') d[k] = raw[k]; }); changes.push({ id: 'debug_' + Date.now(), type: 'debug', data: d, updated_at: Date.now() }); }
    for (const ch of changes) {
      const i = index[ch.id];
      if (i !== undefined && all[i][3] >= ch.updated_at) continue; // last-write-wins
      const row = [ch.id, ch.type, JSON.stringify(ch.data || {}), ch.updated_at, !!ch.deleted, ++seq];
      if (i !== undefined) { sh.getRange(i + 2, 1, 1, 6).setValues([row]); all[i] = row; }
      else { sh.appendRow(row); index[ch.id] = all.push(row) - 1; }
    }
    return out_({ ok: true, cursor: seq });
  } finally { lock.releaseLock(); }
}

// ---------- 自動備份 ----------
// 每日備份：複製整份試算表到雲端硬碟「LifeHub 備份」資料夾，保留最近 30 份。由觸發條件呼叫。
function dailyBackup() { const it = DriveApp.getFoldersByName('LifeHub 備份'); const folder = it.hasNext() ? it.next() : DriveApp.createFolder('LifeHub 備份'); const stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HHmm'); DriveApp.getFileById(SpreadsheetApp.getActive().getId()).makeCopy('LifeHub 備份 ' + stamp, folder); const files = [], fi = folder.getFiles(); while (fi.hasNext()) files.push(fi.next()); files.sort((a, b) => b.getDateCreated() - a.getDateCreated()); files.slice(30).forEach(f => f.setTrashed(true)); }

// 只需手動執行一次：建立每天凌晨 3 點的備份觸發條件（重複執行不會重複建立），並立刻備份一次。
function installBackupTrigger() { ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyBackup').forEach(t => ScriptApp.deleteTrigger(t)); ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(3).create(); dailyBackup(); }

// 只需手動執行一次：讓 Google 詢問「連線到外部服務」的授權（飲食估算要呼叫 Claude API）。
function authorizeExternal() { const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/models', { muteHttpExceptions: true }); Logger.log('外部連線授權完成，測試回應碼：' + r.getResponseCode() + '；API 金鑰' + (PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') ? '已設定' : '尚未設定')); }
