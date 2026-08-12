# 活動布告欄 GAS 更新說明

## 換人接手時要改的設定

程式碼本身不含任何帳號專屬設定，換人使用不需要修改 `Code.gs` 任何一行。完整對照表寫在 `Code.gs` 檔案最上方的註解區塊，摘要如下：

| 項目 | 改法 | 實際存放位置 |
|---|---|---|
| Google 試算表 | 用新 Sheet 開 Apps Script 貼入本檔，執行 `setupProject()` | Script Properties `SPREADSHEET_ID` |
| Google 日曆 | Sheet 選單「活動布告欄 → 設定 Google 日曆」 | Script Properties `GOOGLE_CALENDAR_ID`、`GOOGLE_CALENDAR_NAME` |
| 管理員密碼 | Sheet 選單「活動布告欄 → 設定管理員密碼」 | Script Properties `ADMIN_PASSWORD_SALT` / `ADMIN_PASSWORD_HASH` |
| 專案時區 | Apps Script「專案設定 → 時區」設為 `Asia/Taipei` | Apps Script 專案設定 |
| GAS 連線網址 | 部署後的 `/exec` 網址 | 前端 `index.html` 的 `CONFIG.GAS_API_URL` |
| LINE LIFF | 換官方帳號／Login channel 時一併更換 | 前端 `index.html` 的 `CONFIG.LIFF_ID`、`CONFIG.LIFF_URL` |

沿用舊試算表以外的 Sheet 時要特別注意：Script Properties 會留著舊的 `SPREADSHEET_ID`，必須手動刪除該筆屬性，否則資料仍會寫進舊試算表。

這套 GAS 使用「軟刪除 + 歸檔」兩段式：刪除活動時**當下不移除 Sheet 列**，只把 `status` 改為 `deleted`；之後由每日歸檔流程把該列搬到 `EventsArchive` 再從 `Events` 移除。一般讀取只回傳仍需顯示的活動，所以手機、電腦與其他使用同一支 GAS 的網站都不會再看到已刪除或已過期的活動。

## 安裝步驟

1. 開啟目前存放活動資料的 Google Sheet。
2. 選擇「擴充功能 → Apps Script」。
3. 備份原本的 `Code.gs`。
4. 將本資料夾的 `Code.gs` 完整貼入並儲存。
5. 在 Apps Script 上方函式選單選擇 `setupProject`，執行一次並完成 Sheet、Google Calendar 與觸發器授權。
6. 確認試算表出現 `Events`、`EventsArchive` 與 `AuditLog` 三張工作表，且「觸發條件」頁面出現每日執行的 `archiveRetiredEvents`（凌晨 4 點）與 `cleanupExpiredWishes`（午夜 0 點）。
7. 重新整理 Google Sheet，選擇「活動布告欄 → 設定 Google 日曆」，貼上日曆網址或 Calendar ID。
8. 如需把既有未過期活動補進日曆，選擇「活動布告欄 → 同步現有未過期活動」。
9. 選擇「部署 → 管理部署作業」。
10. 編輯現有網頁應用程式，建立「新版本」後部署：
   - 執行身分：我
   - 誰可以存取：所有人
11. 複製新的 `/exec` 網址。如果 Google 提供的網址與原本不同，請同步更新網頁 `CONFIG.GAS_API_URL`。

`setupProject()` 不會刪除既有資料。如果原本工作表第一列已包含 `id` 與 `title`，它會將該表改名為 `Events`，並在右側補齊缺少欄位。

固定團功能至少需要表格結構版本 `2`；Google 日曆連動新增 `calendarEventId` 欄位（版本 `3`）；許願功能新增 `isWish` 欄位（版本 `4`）；加強推廣新增 `isHighlighted` 欄位，因此目前完整結構版本為 `5`。新版 GAS 貼上後一定要重新執行一次 `setupProject()`。

Google Maps 分享網址會由 GAS 限定在 Google Maps 網域內解析，取得網址中的地點名稱或地址。網頁會以該名稱作為可點擊的地圖連結，不需要 Google Maps API 金鑰。

## 資料量控制與歸檔

為了讓讀取速度長期穩定，系統有三道機制：

| 機制 | 作用 |
|---|---|
| `history` 上限 50 筆 | 活動列只留最近 50 筆操作紀錄（含留言）。固定團永不過期，沒有上限會無限膨脹。完整紀錄仍在 `AuditLog`。 |
| `doGet` 過濾 | 已刪除與過期活動不回傳給前端。 |
| 每日自動歸檔 | 凌晨 4 點把已刪除與過期活動搬到 `EventsArchive`，並從 `Events` 移除。 |
| 許願午夜結算 | 每日 00 點結算許願活動，未達標者整列刪除且**不歸檔**。 |
| 快取保溫 | 每 15 分鐘檢查公開活動快取，不見了才重建（`warmPublicPayloadCache`）。 |

「過期」定義為**活動開始時間 + 2 小時**，所以活動進行中仍看得到，結束後才消失。

**固定團永遠不會被歸檔**（沒有結束時間）。時間欄位無法解析的活動也不會被搬，避免格式問題造成資料誤搬。

觸發器由 `setupProject()` 自動建立，重複執行不會產生多個。也可用選單「立即歸檔過期活動」與「立即結算許願活動」手動執行。

歸檔資料只在 `EventsArchive` 工作表內查看，不經由 Web API 對外提供 —— `includeDeleted` 參數已移除，先前任何拿到 `/exec` 網址的人都能取得已刪除活動的完整成員名單。

## Events 表格設計

| 欄位 | 用途 |
|---|---|
| `id` | 活動唯一 ID，不可重複 |
| `status` | `active` 或 `deleted` |
| `title` | 活動名稱 |
| `datetime` | 活動日期時間 |
| `isFixedGroup` | 是否為固定團，`TRUE` 代表固定團 |
| `isWish` | 是否為許願活動，`TRUE` 代表許願 |
| `isHighlighted` | 是否正在加強推廣，`TRUE` 代表套用粉紅櫻花標題視覺；全站最多同時 3 筆 |
| `fixedTimeText` | 固定團由主揪手寫的時間文字 |
| `location` | 地點 |
| `hostName` | 目前主揪顯示名稱 |
| `hostUser` | 目前主揪的 JSON 資料 |
| `fee` | 費用 |
| `maxAttendees` | 人數上限，0 代表無限制 |
| `description` | 補充說明 |
| `attendees` | 已報名成員 JSON 陣列 |
| `fixedAttendees` | 已停用，保留供舊資料相容，一律寫入空陣列 |
| `weeklyAttendees` | 已停用，保留供舊資料相容，一律寫入空陣列 |
| `history` | 活動完整紀錄 JSON 陣列 |
| `calendarEventId` | 對應的 Google Calendar Event ID，用於更新或刪除同一筆行程 |
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
| `actionType` | `create`、`join`、`leave`、`update`、`handoff`、`delete`、`comment`、`highlight`、`unhighlight`、`admin_remove_attendee` |
| `action` | 可閱讀的操作說明 |
| `details` | 補充 JSON 資料 |

## 同步與權限規則

- `doGet` 命中 Script Cache 就直接回傳（約 1～3 秒）；沒命中才開啟 Sheet 重建（實測 8～30 秒，取決於試算表大小與當下負載）。快取 TTL 一小時。
- 任何成功寫入、歸檔或許願結算都會**當場重建快取**（`refreshPublicPayloadCacheQuietly_`），不是只清除，所以新的報名結果會立刻生效，且下一位讀取者不必幫大家付重建的時間。另有 15 分鐘一次的 `warmPublicPayloadCache` 負責補上快取被系統提早清掉的情形。
- 每個 POST 只開啟一次 Spreadsheet，再取得 `Events` 與 `AuditLog`。mutationId 先查六小時快取，再檢查 AuditLog 最近 500 列，降低長期稽核資料造成的延遲。
- `saveEvent`：建立或更新活動。編輯內容開放給**主揪、管理員與任何已報名成員**；但 `eventAction = handoff`（交棒主揪）另外用 `assertHandoffPermission_` 驗證，仍只有主揪與管理員可執行。
- 許願活動（`isWish = TRUE`）由午夜觸發器 `cleanupExpiredWishes` 結算：建立滿 3 個日曆天時，當下報名人數超過 3 人則轉為一般活動，否則整列硬刪除且不進 `EventsArchive`。刪除前會先移除對應的 Google 日曆行程。
- `addComment`：在活動紀錄新增一則留言，任何已登入成員都可以。內容由 GAS 重新組裝並限制 150 字，不採用前端送來的 history 條目。
- `toggleHighlight`：主揪、管理員或已報名成員可開啟／取消加強推廣。GAS 在 Script Lock 內檢查仍在顯示中的推廣活動，最多同時 3 筆；一般 `saveEvent` 不可直接修改此旗標。
- 編輯活動時，GAS 只更新活動內容並保留雲端最新報名名單，避免舊分頁覆蓋新報名。
- `toggleRSVP`：使用明確的 `join`／`cancel`，不再用模糊的切換操作。固定團與一般活動走同一條路徑。
- 固定團主揪不可直接取消參與，如需退出一樣要先交棒。
- `deleteEvent`：將活動標記為 `deleted`，請求處理當下不刪除 Sheet 列（列的移除只由每日歸檔執行）。
- 主揪不能直接退出，必須先交棒給已報名成員；GAS 也會再次驗證交棒對象。
- `mutationId` 已處理過時會直接回覆成功，不會再執行一次。
- 所有寫入都使用 Script Lock，避免手機與電腦同時操作造成覆蓋。
- 前端普通操作會先保存在本機 pending queue，再依序送出；關閉頁面時使用 keepalive，若仍被 LINE 中斷，下次開啟會沿用同一個 mutationId 重試，所以 GAS 不會重複報名。pending queue 最多 20 筆並保留 24 小時。
- 舊版 LINE WebView 不支援 keepalive 時會自動改用一般請求；只要網站資料未被清除，未確認的普通操作仍會在同一台裝置下次開啟時補送。其他裝置不會共享這份 queue。
- 管理員密碼不會寫入 pending queue，而且前端只有真的要管理別人的活動時才附上密碼。因此含管理員密碼的操作關閉頁面後不能自動重送，只能依靠當次 keepalive，重新開啟後再由雲端資料確認結果。

## Google 日曆連動規則

- 日曆 ID 只保存在 Apps Script `Script Properties` 的 `GOOGLE_CALENDAR_ID`，不寫入程式碼、Sheet 或 GitHub。
- 「設定 Google 日曆」會先建立一筆測試行程再立即刪除，用來確認真的具有寫入權限；唯讀訂閱的日曆會被擋下並顯示錯誤，不會保存設定。
- `calendarEventId` 完全由 GAS 產生與保管，儲存活動時一律忽略前端送來的值，避免舊分頁的空值清掉連結而產生重複行程。
- 日曆「地點」欄使用解析後的地點名稱或地址，不附帶原始 Google Maps 短網址，讓日曆能正確帶出地圖。
- `getEventById` 對已刪除的行程仍會回傳物件，且對它呼叫 `setTitle`／`setTime` 不會讓行程重新出現。因此同步前一律用 `isCalendarEventLive_()` 以 `getEvents()` 反查行程是否還活著，已被刪除就重新建立。少了這道檢查，同步會回報成功但日曆完全沒有變化。
- 「日曆診斷」選單可回報設定狀態、可否寫入、表格與日曆兩側的連結統計，用來快速判斷同步問題。
- `doGet` 會回傳 `calendar: { configured, calendarId, name }`，供前端「日曆」頁面嵌入與訂閱使用。日曆 ID 仍只保存在 Script Properties，不寫進前端程式碼或 GitHub。
- 建立一般活動時自動建立 Google 行程；修改活動名稱、時間或地點時更新同一筆行程。
- 日曆只同步活動名稱、時間與地點，**不寫入活動說明、費用、LINE 帳號或參與名單**。
- 一般活動預設行程長度為 2 小時。
- 同步只在儲存與刪除活動時觸發，報名／退出不會碰日曆。
- 固定團時間是手寫文字，沒有明確日期，因此不自動建立日曆行程。
- 無效時間不建立行程。已過期活動保留日曆歷史，後續編輯或刪除不再修改它。
- 刪除尚未過期的網頁活動時，同步刪除對應 Google 行程。
- Apps Script 專案時區應設為 `Asia/Taipei`，且部署必須以日曆擁有者或具有編輯權限的帳號執行。

## 前端「日曆」頁面與訂閱

前端右下角 FAB 群組最上方的「日曆」按鈕會開啟嵌入式 Google 日曆，並提供「訂閱到我的 Google 日曆」。

成員要能看到內容或成功訂閱，**這本日曆必須開放給他們**。在 Google 日曆的「設定與共用」中擇一：

- 「公開設為可用」→ 任何人都能查看（最方便，但等於公開活動時間地點）
- 「與特定使用者或群組共用」→ 逐一加入成員的 Google 帳號（較嚴謹）

兩者都沒設定時，成員按下訂閱只會看到空白或無權限，前端已在頁面下方標註這個情況。

## 設定可刪除所有活動的管理員密碼

1. 完成新版 GAS 部署後，重新整理 Google Sheet。
2. 點選試算表上方的「活動布告欄 → 設定管理員密碼」。
3. 輸入至少 8 個字元的密碼。
4. 回到網頁，**點擊標題旁的版本號**開啟管理員模式，輸入同一組密碼。管理員入口刻意隱藏在版本號上，沒有顯眼按鈕；啟用中版本號會變成綠底白字。

密碼不會寫入網頁或 GitHub，GAS 只在 Script Properties 保存加鹽雜湊。網頁不會記住密碼；關閉或重新載入後會自動退出管理員模式。因為權限由密碼開啟，LINE 顯示名稱變更不會影響使用。

管理員可以刪除任何活動，也能像該活動的主揪一樣編輯名稱、時間、地點、費用、人數上限、說明與交棒主揪。請不要把管理員密碼分享給不需要此權限的成員。

## 驗證方式

部署完成後，直接開啟 GAS `/exec` 網址，應看到類似：

```json
{"status":"success","schemaVersion":"5","calendar":{"configured":true,"calendarId":"...","name":"..."},"events":[]}
```

看到 `calendar` 欄位才代表部署的是含日曆頁功能的版本。

接著在網頁建立一個測試活動，確認：

1. `Events` 出現一列 `status = active`。
2. 報名或退出時，同一列的 `attendees` 與 `history` 更新。
3. `AuditLog` 每次操作都增加一列。
4. 刪除後原列仍在 `Events` 且 `status = deleted`，`/exec` 回傳已不含該活動；執行「立即歸檔過期活動」後該列移到 `EventsArchive`。
5. 建立固定團後，確認 `isFixedGroup = TRUE`、`fixedTimeText` 有內容，主揪出現在 `attendees`。
6. 固定團按「本週參與／本週取消」，確認 `attendees` 正確增減，且 `fixedAttendees`／`weeklyAttendees` 維持空陣列。
7. 建立一般未過期活動，確認 `calendarEventId` 有值，Google 日曆中出現同名行程，且行程的說明欄是**空的**（不得包含成員名單）。
8. 修改名稱、時間與地點，確認更新原行程而不是新增重複行程。
9. 刪除未過期活動，確認對應行程一併移除。
10. 手動從 Google 日曆刪掉某筆行程，再於網頁編輯該活動，確認會**重新建立**行程而不是靜默無反應。
11. 執行「日曆診斷」，確認「連結有效」筆數與日曆上「【揪團】」開頭的行程數一致。
12. 依序為三個未過期活動開啟加強推廣，確認 `isHighlighted = TRUE`；第四個活動必須被拒絕。取消其中一個後，第四個才能成功開啟。

已刪除與過期活動只能在 `EventsArchive` 工作表內查看。`?includeDeleted=1` 參數已移除，不要重新加回 —— 它會讓任何拿到 `/exec` 網址的人取得已刪除活動的完整成員名單。

## 安全提醒

這一版會在 GAS 端檢查主揪與操作流程，但操作者 ID 仍由 LIFF 網頁送出，主要用途是避免一般使用流程誤操作。如果未來需要防止有人自行呼叫 GAS 網址偽造身分，應再加入 LINE ID Token 驗證；不要把 Channel Secret 或其他憑證寫進公開的網頁或 GitHub。
