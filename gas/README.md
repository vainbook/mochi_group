# 活動布告欄 GAS 更新說明

這套 GAS 使用「軟刪除」：刪除活動時不移除 Sheet 列，而是把 `status` 改為 `deleted`。一般讀取只回傳 `active` 活動，所以手機、電腦與其他使用同一支 GAS 的網站都不會再看到已刪除活動。

## 安裝步驟

1. 開啟目前存放活動資料的 Google Sheet。
2. 選擇「擴充功能 → Apps Script」。
3. 備份原本的 `Code.gs`。
4. 將本資料夾的 `Code.gs` 完整貼入並儲存。
5. 在 Apps Script 上方函式選單選擇 `setupProject`，執行一次並完成授權。
6. 確認試算表出現 `Events` 與 `AuditLog` 兩張工作表。
7. 選擇「部署 → 管理部署作業」。
8. 編輯現有網頁應用程式，建立「新版本」後部署：
   - 執行身分：我
   - 誰可以存取：所有人
9. 複製新的 `/exec` 網址。如果 Google 提供的網址與原本不同，請同步更新網頁 `CONFIG.GAS_API_URL`。

`setupProject()` 不會刪除既有資料。如果原本工作表第一列已包含 `id` 與 `title`，它會將該表改名為 `Events`，並在右側補齊缺少欄位。

固定團功能需要表格結構版本 `2`。新版 GAS 貼上後一定要重新執行一次 `setupProject()`；網頁確認四個固定團欄位都存在後，才會顯示「固定團」勾選，避免資料寫進舊表格後遺失。

## Events 表格設計

| 欄位 | 用途 |
|---|---|
| `id` | 活動唯一 ID，不可重複 |
| `status` | `active` 或 `deleted` |
| `title` | 活動名稱 |
| `datetime` | 活動日期時間 |
| `isFixedGroup` | 是否為固定團，`TRUE` 代表固定團 |
| `fixedTimeText` | 固定團由主揪手寫的時間文字 |
| `location` | 地點 |
| `hostName` | 目前主揪顯示名稱 |
| `hostUser` | 目前主揪的 JSON 資料 |
| `fee` | 費用 |
| `maxAttendees` | 人數上限，0 代表無限制 |
| `description` | 補充說明 |
| `attendees` | 已報名成員 JSON 陣列 |
| `fixedAttendees` | 固定參與成員 JSON 陣列 |
| `weeklyAttendees` | 本週參與成員 JSON 陣列 |
| `history` | 活動完整紀錄 JSON 陣列 |
| `createdAt` | 建立時間 |
| `updatedAt` | 最後更新時間 |
| `deletedAt` | 軟刪除時間 |
| `deletedBy` | 刪除者名稱 |
| `deletedByUserId` | 刪除者 LINE userId |
| `schemaVersion` | 表格結構版本 |

## AuditLog 表格設計

| 欄位 | 用途 |
|---|---|
| `mutationId` | 每次前端操作的唯一 ID，用來避免重複處理 |
| `logId` | 稽核紀錄唯一 ID |
| `eventId` | 對應活動 ID |
| `timestamp` | 伺服器紀錄時間 |
| `actorUserId` | 操作者 LINE userId |
| `actorName` | 操作者名稱 |
| `actionType` | `create`、`join`、`leave`、`fixed_join`、`weekly_join`、`fixed_cancel`、`weekly_cancel`、`update`、`handoff`、`delete` |
| `action` | 可閱讀的操作說明 |
| `details` | 補充 JSON 資料 |

## 同步與權限規則

- `saveEvent`：建立或更新活動；既有活動只有目前主揪可修改。
- 編輯活動時，GAS 只更新活動內容並保留雲端最新報名名單，避免舊分頁覆蓋新報名。
- `toggleRSVP`：使用明確的 `join`／`cancel`，不再用模糊的切換操作。
- 固定團的 `toggleRSVP` 會另外接收 `participationType = fixed` 或 `weekly`；兩種參與方式互斥。
- 固定團主揪必須保持固定參與，如需退出一樣要先交棒。
- `deleteEvent`：將活動標記為 `deleted`，不刪除 Sheet 列。
- 主揪不能直接退出，必須先交棒給已報名成員；GAS 也會再次驗證交棒對象。
- `mutationId` 已處理過時會直接回覆成功，不會再執行一次。
- 所有寫入都使用 Script Lock，避免手機與電腦同時操作造成覆蓋。

## 驗證方式

部署完成後，直接開啟 GAS `/exec` 網址，應看到類似：

```json
{"status":"success","schemaVersion":"2","events":[]}
```

接著在網頁建立一個測試活動，確認：

1. `Events` 出現一列 `status = active`。
2. 報名或退出時，同一列的 `attendees` 與 `history` 更新。
3. `AuditLog` 每次操作都增加一列。
4. 刪除後原列仍存在，但 `status = deleted`，一般 `/exec` 回傳不再包含該活動。
5. 建立固定團後，確認 `isFixedGroup = TRUE`、`fixedTimeText` 有內容，主揪出現在 `fixedAttendees`。
6. 分別測試固定參與與本週參與，確認兩個欄位不會同時包含同一位成員。

如需查閱已刪除活動，可在 GAS 網址後加入 `?includeDeleted=1`。

## 安全提醒

這一版會在 GAS 端檢查主揪與操作流程，但操作者 ID 仍由 LIFF 網頁送出，主要用途是避免一般使用流程誤操作。如果未來需要防止有人自行呼叫 GAS 網址偽造身分，應再加入 LINE ID Token 驗證；不要把 Channel Secret 或其他憑證寫進公開的網頁或 GitHub。
