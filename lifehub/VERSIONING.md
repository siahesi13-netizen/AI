# 版本控制與備份

## 程式碼（GitHub）
- `main` = 正式版，GitHub Pages 由 `main:/docs` 發布，**不直接在 main 上改**。
- 改動流程：開分支（`feature/...`、`fix/...`）→ 推上去 → 開 PR → 合併 → 打 tag `vX.Y.Z`。
- 版本號：修 bug → patch（1.0.1）；新功能 → minor（1.1.0）；資料格式不相容 → major（2.0.0）。
- 回滾前端：`git revert <commit>` 開 PR 合併，或把 Pages 指到舊 tag 的內容。
- 後端 `lifehub/cloud/Code.gs` 與 Apps Script 內程式必須一致；改完後在 Apps Script「部署 → 管理部署作業 → 編輯 → 新版本」（Apps Script 也會保留每個部署版本，可切回）。

## 資料（Google Sheet）
- 每筆記錄為軟刪除（`deleted` 旗標），誤刪可從 Sheet 把該列 `deleted` 改回 FALSE，並把 `seq` 設為目前最大值+1、`updated_at` 設為更新的時間讓各裝置重新同步。
- **每日自動備份**：`dailyBackup()` 每天凌晨 3 點（台北）把整份試算表複製到雲端硬碟「LifeHub 備份」資料夾，保留最近 30 份。
- 啟用：在 Apps Script 手動執行一次 `installBackupTrigger`（需授權雲端硬碟權限）。
- 還原：開啟備份試算表，複製 `records` 工作表的資料貼回正式試算表（先備份現況）；各裝置下次同步時，若本機較新則會覆蓋雲端，必要時在裝置上清除網站資料後重新同步。
