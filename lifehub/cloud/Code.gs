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
function authed_(t) { const k = PropertiesService.getScriptProperties().getProperty('TOKEN'); return k && t === k; }
function rows_(sh) { const n = sh.getLastRow(); return n < 2 ? [] : sh.getRange(2, 1, n - 1, 6).getValues(); }

function doGet(e) {
  if (!authed_(e.parameter.token)) return out_({ error: 'bad token' });
  const since = Number(e.parameter.since || 0), all = rows_(sheet_());
  const cursor = all.reduce((m, r) => Math.max(m, r[5]), 0);
  const changes = all.filter(r => r[5] > since).sort((a, b) => a[5] - b[5]).map(r => (
    { id: r[0], type: r[1], data: JSON.parse(r[2] || '{}'), updated_at: r[3], deleted: r[4] === true || r[4] === 1 || r[4] === 'TRUE' }));
  return out_({ cursor, changes });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');
  if (!authed_(body.token)) return out_({ error: 'bad token' });
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(), all = rows_(sh), index = {};
    all.forEach((r, i) => index[r[0]] = i);
    let seq = all.reduce((m, r) => Math.max(m, r[5]), 0);
    for (const ch of body.changes || []) {
      const i = index[ch.id];
      if (i !== undefined && all[i][3] >= ch.updated_at) continue; // last-write-wins
      const row = [ch.id, ch.type, JSON.stringify(ch.data || {}), ch.updated_at, !!ch.deleted, ++seq];
      if (i !== undefined) { sh.getRange(i + 2, 1, 1, 6).setValues([row]); all[i] = row; }
      else { sh.appendRow(row); index[ch.id] = all.push(row) - 1; }
    }
    return out_({ cursor: seq });
  } finally { lock.releaseLock(); }
}

// ---------- 自動備份 ----------
// 每日備份：複製整份試算表到雲端硬碟「LifeHub 備份」資料夾，保留最近 30 份。由觸發條件呼叫。
function dailyBackup() { const it = DriveApp.getFoldersByName('LifeHub 備份'); const folder = it.hasNext() ? it.next() : DriveApp.createFolder('LifeHub 備份'); const stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HHmm'); DriveApp.getFileById(SpreadsheetApp.getActive().getId()).makeCopy('LifeHub 備份 ' + stamp, folder); const files = [], fi = folder.getFiles(); while (fi.hasNext()) files.push(fi.next()); files.sort((a, b) => b.getDateCreated() - a.getDateCreated()); files.slice(30).forEach(f => f.setTrashed(true)); }

// 只需手動執行一次：建立每天凌晨 3 點的備份觸發條件（重複執行不會重複建立），並立刻備份一次。
function installBackupTrigger() { ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyBackup').forEach(t => ScriptApp.deleteTrigger(t)); ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(3).create(); dailyBackup(); }
