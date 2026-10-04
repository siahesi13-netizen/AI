# LifeHub 架構

## 目標
個人生活管理平台 + 手機 App（PWA），多裝置同步。模組：今日總覽、子彈筆記、運動、財務、知識管理（筆記 / 閱讀清單）。

## 分層
```
[PWA 前端 static/]  ←離線優先→  localStorage（DB / dirty / cursor）
        │  push dirty、pull since=cursor（last-write-wins）
        ▼
[同步後端]  目前：server.py（Python + SQLite）
            規劃：Google Apps Script + Google Sheet（見下）
        ▲
[外部匯入]  Apple 健康 / OtterLife（規劃中，見下）
```

## 資料模型（通用記錄）
`{id, type, data, updated_at, deleted}`；後端只存不解讀 data，新增模組不需改後端。
type：`bullet` `workout` `txn` `note` `book` `setting`。

## 同步協定（後端可替換，只需實作這兩個）
- `GET  /api/sync?since=<seq>` → `{cursor, changes[]}`
- `POST /api/sync` `{changes[]}` → `{cursor}`
- 驗證：`Authorization: Bearer <token>`
- 衝突：`updated_at` 較新者勝；刪除為軟刪除（tombstone）。

## 待定決策
| 項目 | 選項 | 狀態 |
|---|---|---|
| 後端託管 | A. 本機 Python（現況，限同 Wi-Fi）／B. Apps Script + Sheet，前端放 GitHub Pages（可離家同步） | 傾向 B，待確認 |
| Apple 健康 | A. iOS 捷徑每日 POST／B. Health Auto Export 推送／C. 原生 Swift App | 待選（建議 A 或 B） |
| OtterLife | 未知是否有 API/匯出 | 待使用者確認要拿什麼資料、能否匯出 |

## 外部匯入設計（預留）
新增 `POST /api/ingest/<source>`（同 token）：
- `health`：步數、體重、睡眠、運動 → 轉為 `workout` 與新增 type `metric`（`{date, kind, value}`）。以 `source+外部id` 作為記錄 id，重送不重複（冪等）。
- `otterlife`：待規格確定，優先考慮檔案匯入（CSV/JSON）。

## 路線圖
1. 瀏覽器實測前端、修 bug
2. 決定後端（B 則寫 `Code.gs`）、前端部署
3. `metric` type + 運動頁步數/體重趨勢
4. `ingest/health` + 捷徑說明
5. OtterLife 匯入
