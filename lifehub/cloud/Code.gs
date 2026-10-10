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
const HEALTH_KEYS = ['steps', 'exercise_min', 'active_kcal', 'distance_km', 'diet_kcal', 'protein_g', 'carbs_g', 'fat_g', 'water_ml', 'sleep_h', 'weight_kg'];
// 捷徑傳來的值可能是多行（例如「738」＋補位的「0」）、帶單位或千分位：逐一取出數字後相加，不可把數字直接接在一起
function numSum_(v) { const m = String(v).replace(/(\d),(?=\d{3}(\D|$))/g, '$1').match(/-?\d+(\.\d+)?/g); return m ? m.reduce((a, x) => a + Number(x), 0) : null; }
function healthChange_(body, all, index) {
  const m = String(body.date || '').match(/\d{4}-\d{2}-\d{2}/), date = m ? m[0] : Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'), id = 'hk_' + date;
  const data = Object.assign(index[id] !== undefined ? JSON.parse(all[index[id]][2] || '{}') : {}, { date: date, src: 'apple-health' });
  HEALTH_KEYS.forEach(k => { if (body[k] === undefined || body[k] === null || body[k] === '') return; const n = numSum_(body[k]); if (n !== null) data[k] = Math.round(n * 100) / 100; });
  return { id: id, type: 'health', data: data, updated_at: Date.now() };
}

// 捷徑手動輸入的鍵名容易大小寫不一或多空白：統一成小寫、去掉空白與底線以外的差異；並支援較好打的別名
const ALIAS = { exercise: 'exercise_min', exercisemin: 'exercise_min', active: 'active_kcal', activekcal: 'active_kcal', distance: 'distance_km', distancekm: 'distance_km', kcal: 'diet_kcal', diet: 'diet_kcal', dietkcal: 'diet_kcal', protein: 'protein_g', proteing: 'protein_g', carbs: 'carbs_g', carbsg: 'carbs_g', fat: 'fat_g', fatg: 'fat_g', water: 'water_ml', waterml: 'water_ml', sleep: 'sleep_h', sleeph: 'sleep_h', weight: 'weight_kg', weightkg: 'weight_kg' };
function normBody_(raw) { const o = {}; Object.keys(raw || {}).forEach(k => { const n = String(k).trim().toLowerCase(); o[ALIAS[n.replace(/_/g, '')] || n] = raw[k]; }); if (typeof o.kind === 'string') o.kind = o.kind.trim().toLowerCase(); return o; }

function doPost(e) {
  let raw = {}; try { raw = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ error: 'bad json' }); }
  const body = normBody_(raw);
  // 診斷資訊只含欄位名稱與金鑰長度，不含金鑰內容
  if (!authed_(body.token)) return out_({ error: 'bad token', hint: { keys: Object.keys(raw), tokenType: typeof body.token, tokenLength: body.token === undefined || body.token === null ? 0 : String(body.token).length, expectedLength: String(PropertiesService.getScriptProperties().getProperty('TOKEN') || '').trim().length } });
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(), all = rows_(sh), index = {};
    all.forEach((r, i) => index[r[0]] = i);
    let seq = all.reduce((m, r) => Math.max(m, r[5]), 0);
    const changes = (body.changes || []).slice();
    if (body.kind === 'health') changes.push(healthChange_(body, all, index));
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
