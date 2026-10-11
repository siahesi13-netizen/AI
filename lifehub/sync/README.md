# 個人記帳同步

把個人記帳的 Numbers 檔同步到網站的「個人財務」。Numbers 檔是唯一來源，網站上由本工具匯入的帳目（id 以 `imp_` 開頭）會跟著檔案新增、修改、刪除；在網站手動記的帳不受影響。

- 執行：在 Finder 連按兩下 `同步個人記帳.command`（第一次會自動安裝 numbers-parser）。
- 設定：`local.json`（不進版本控制），內容為 `{ "url": Apps Script 網址, "token": 同步金鑰, "file": Numbers 檔路徑 }`。
- 只想看會變動幾筆：`.venv/bin/python personal_ledger.py --dry-run`
