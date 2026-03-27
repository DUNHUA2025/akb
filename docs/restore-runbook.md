# AKB 預約數據備份與還原手冊

## 1. 目的
本手冊用於處理 AKB 預約系統的日常備份、異常監控與資料還原。系統目前以 `bookings` 為核心主資料，`customers` 屬於由 `bookings` 推導出的衍生資料，因此優先保護與還原 `bookings`。 [Source](https://raw.githubusercontent.com/DUNHUA2025/akb/main/server_app.js)

## 2. 現行機制總覽
- **每日備份**：由 GitHub Actions `Daily Backup` 每日排程執行，輸出 JSON 快照、checksum 與 manifest。
- **異常監控**：由 GitHub Actions `Health Monitor` 每 15 分鐘巡檢 `/api/health` 與 `/api/bookings`，若偵測異常則自動建立或更新 GitHub Issue。
- **平台層備份**：Supabase 官方提供每日備份；若啟用 PITR，可將還原點精細到近秒級。 [Source](https://supabase.com/docs/guides/platform/backups) [Source](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery)

## 3. 必要 Secrets / Variables
### GitHub Actions Secrets
- `SUPABASE_URL`：Supabase 專案 URL
- `SUPABASE_SERVICE_ROLE_KEY`：用於完整備份/還原（含 accounts 完整欄位）

### GitHub Actions Variables
- `AKB_API_BASE`：例如 `https://akb-salon-server.onrender.com`

## 4. 每日備份產物
每日備份會產出一個資料夾，例如：

```text
backup-output/
  akb-backup-2026-03-27T18-17-00Z/
    health.json
    bookings.json
    designers.json
    services.json
    customers.json   # 僅 API 模式存在
    accounts.json
    manifest.json
    sha256.txt
```

- `manifest.json`：記錄備份模式、筆數、來源、工作流資訊
- `sha256.txt`：每個檔案的 SHA-256 校驗碼
- `.ops/state/latest-backup-manifest.json`：最近一次成功備份的狀態快照，供監控流程比對使用

## 5. 異常監控規則
監控程式會檢查：
1. `/api/health.status` 是否為 `ok`
2. `/api/health.storage` 是否為 `supabase`
3. 當最新 baseline 的 `bookings > 0` 時，當前 `/api/bookings` 是否掉到 `0`
4. `bookings` 是否較 baseline 下降超過預設 50%
5. 最近一次備份 manifest 是否超過 30 小時未更新

如果觸發上述任一項，系統會將工作流標記失敗，並自動建立或更新標題為 **「🚨 AKB 預約數據異常監控」** 的 GitHub Issue。

## 6. 還原等級
### Level A：單筆 / 少量預約誤刪
適合單筆資料不見，但系統整體正常。
1. 從最近一份 `bookings.json` 找到該筆資料
2. 使用 `restore-from-backup.js` 只回寫 `bookings`
3. 驗證後台與 `/api/bookings/:id`

### Level B：大量預約消失，但其他服務正常
適合 `bookings` 異常下降或變成 0。
1. 暫停人工修改預約
2. 比對 `/api/health` 與 `.ops/state/latest-backup-manifest.json`
3. 以最近備份回寫 `bookings`
4. 驗證 `/api/bookings` 與後台顯示

### Level C：整個資料庫被誤改 / 誤刪
適合多表受損，或需要回復到某個時間點。
1. 優先評估 Supabase 平台還原
2. 使用 Supabase Daily Backups 或 PITR 恢復專案到事故前時間點
3. 必要時再用應用層 JSON 快照做補回
4. 驗證所有 API 與前後台流程 [Source](https://supabase.com/docs/guides/platform/backups)

## 7. 使用 restore-from-backup.js
### 7.1 乾跑（建議先做）
```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/restore-from-backup.js --dir=/path/to/akb-backup-2026-03-27T18-17-00Z --dry-run
```

### 7.2 只還原 bookings
```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/restore-from-backup.js --dir=/path/to/akb-backup-2026-03-27T18-17-00Z --tables=bookings
```

### 7.3 清空後重灌（高風險）
只在 staging 驗證成功後、且明確知道要完整覆蓋時才用。
```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
RESTORE_CONFIRM=YES_I_UNDERSTAND \
node scripts/restore-from-backup.js --dir=/path/to/akb-backup-2026-03-27T18-17-00Z --tables=bookings,designers,services,accounts --clear-target
```

## 8. 還原後驗證清單
還原完成後，至少驗證以下項目：
1. `/api/health` 回傳 `storage: \"supabase\"`
2. `/api/bookings` 筆數與備份 manifest 相符
3. `/api/customers` 可正常由 bookings 推導顯示
4. 後台管理頁能看到預約資料
5. 前台可正常建立新預約

## 9. 建議的每月演練
每月固定挑一份備份，在 staging 環境做一次完整演練：
- 匯入 `bookings`
- 驗證預約頁 / 後台 / 客戶統計
- 記錄演練時間、版本、恢復時間（RTO）

## 10. 注意事項
- 若未提供 `SUPABASE_SERVICE_ROLE_KEY`，每日備份會退回 API 模式，`accounts` 只會保存安全欄位，不含密碼雜湊。
- `customers` 不是主資料來源，不建議單獨作為還原來源。
- 正式環境 SQL 變更應使用 migration，避免再次出現誤刪資料風險。 [Source](https://raw.githubusercontent.com/DUNHUA2025/akb/main/supabase_schema.sql)
