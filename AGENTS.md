# LINE 活動布告欄維護指南

本資料夾是個人用的 LINE LIFF 活動布告欄，不屬於 UC Training 品牌網站。其他 AI 在修改前必須先讀完本檔與 `gas/README.md`，只處理本專案所需檔案。

## 專案結構

- `index.html`：單檔前端，包含 HTML、CSS 與所有瀏覽器 JavaScript（約 3600 行，JS 2200 行、89 個函式）。已接近單檔可維護的上限，新增大型功能前先評估是否要拆檔。
- `version.json`：GitHub Pages 自動更新檢查用的版本清單。
- `gas/Code.gs`：Google Apps Script 後端，處理 Sheet 讀寫、權限、地圖短網址、Google 日曆同步、歸檔與操作紀錄。
- `gas/README.md`：GAS 表格欄位、安裝、部署、日曆與歸檔說明。

Google Sheet 內有三張工作表：`Events`（目前顯示中的活動）、`EventsArchive`（已退場活動，平常不讀取）、`AuditLog`（永久操作紀錄）。

## 資料與隱私邊界

- 這是公開 GitHub 專案。不得將 LINE `userId`、完整 `/exec` 回應、頭像網址、Google Sheet ID，或未公開應用設定新增進檔案、提交訊息或回覆。
- 不得將管理員明碼、Token、Channel Secret 或其他憑證寫入前端或 GitHub。
- LINE 顯示名稱可變更，不得當成權限依據。普通主揪權限使用 LINE `userId`；管理員模式由 GAS 驗證密碼。
- 診斷線上 GAS 時，只輸出 `status`、`schemaVersion`、功能旗標或錯誤訊息，不得顯示整包活動與成員資料。

## 雙重部署架構

本專案有兩個彼此獨立的發布目標，不可把「GitHub 已更新」視為「GAS 已更新」。

1. 前端：`index.html` 與 `version.json` 由 GitHub Pages 發布。
2. 後端：`gas/Code.gs` 必須貼入綁定 Google Sheet 的 Apps Script，並將現有網頁應用程式部署編輯為「新版本」。

若使用「新增部署」而產生新 `/exec` 網址，必須同步更新 `index.html` 的 `CONFIG.GAS_API_URL`。優先編輯原部署並選「新版本」，以保持網址不變。

線上 `/exec` 的當前結構應回傳最外層 `"schemaVersion":"4"`，並包含 `calendar` 欄位。個別舊活動的 `schemaVersion:1` 只代表建立於舊版，不代表整張 Sheet 仍是舊結構。

判斷「部署到底更新了沒」時，注意 Sheet 選單功能（設定日曆、歸檔、診斷）跑的是**編輯器裡儲存的程式碼**，不需要部署；只有 `/exec`（LINE 網頁連的端點）用的是部署版本。兩者可能不同步，這是最常見的排查陷阱。

## 版本與發布規則

- 每次更新任何 LINE 功能都必須建立新版本，不論改動是前端、GAS、按鈕、文字、權限、同步、地圖、表格欄位或錯誤修正，都不得沿用上一版版本號。
- 新版本必須使用這次修改完成時的當下台北時間戳，不得使用開始工作時間、上次版本時間或人工猜測時間。產生版本前應先讀取系統當下時間。
- 版本格式為台北時間 `vYYMMDD.HHMM`，例如 `v260806.0128`。
- 每次前端行為或 GAS 連線變更都要同步更新：
  - `index.html` 頁首 `.version-label` 文字與 `datetime`。
  - `index.html` 的 `CONFIG.APP_VERSION`。
  - `version.json` 的 `version` 與 `releasedAt`。
- 三處版本必須完全一致，且新版本必須顯示在網頁標題旁，讓 LINE 使用者可直接確認當前頁面版本。
- 除非使用者明確要求，不得自行 push GitHub 或部署 GAS。即使允許 push GitHub，GAS 仍需要使用者於 Apps Script 完成授權與部署。
- 推送後要直接讀取 GitHub Pages 的 `version.json`，確認它已發布新版，不只檢查 `git push` 成功。

## Google Sheet 與 GAS 規則

- `setupProject()` 負責新增／修復 `Events`、`EventsArchive` 與 `AuditLog` 表格及欄位，並註冊每日歸檔觸發器。只在 schema 改變或尚未初始化時要求使用者執行。
- `onOpen()` 在電腦版 Google Sheet 頂部建立「活動布告欄」自訂選單，不是底部工作表分頁。手機版 Sheets 可能不顯示自訂選單。選單中結尾為底線的私有函式不會出現在編輯器的執行下拉選單，要驗證程式碼版本請直接搜尋原始碼字串。
- `setAdminPassword()` 只保存加鹽 SHA-256 雜湊到 Script Properties，密碼不得出現在 Sheet 或程式碼。
- 寫入操作必須保留 Script Lock 與 `mutationId` 幂等檢查，避免手機與電腦同時操作重複寫入。
- 刪除活動必須維持 soft delete：`deleteEvent` 只設 `status = deleted` 並寫入 `deletedAt`、`deletedBy`、`deletedByUserId`，**不可在請求處理中刪除 Sheet 列**。列的移除只由每日歸檔流程執行，且必須先複製到 `EventsArchive` 才刪除，刪列時要由下往上避免列號位移。
- `AuditLog` 與活動 `history` 必須記錄建立、編輯、報名、退出、交棒與刪除。
- GAS 是多人同步的最終資料來源。不得讓舊前端快照覆蓋 GAS 中較新的參與名單。

## 權限模型

權限分成三級，不可混為一談：

| 動作 | 主揪 | 管理員 | 已報名成員 | 未報名者 |
|---|---|---|---|---|
| 編輯內容（名稱／時間／地點／費用／人數／說明） | ✓ | ✓ | **✓** | ✗ |
| 交棒主揪 | ✓ | ✓ | ✗ | ✗ |
| 刪除活動 | ✓ | ✓ | ✗ | ✗ |
| 移除成員 | ✓ | ✓ | ✗ | ✗ |
| 活動留言 | ✓ | ✓ | ✓ | ✓ |

- 已報名成員可共同維護活動細節，這是刻意開放的。GAS 用 `assertEditPermission_()`（含 `isEventAttendee_()`）驗證。
- **交棒必須用 `assertHandoffPermission_()`，不可沿用 `assertEditPermission_()`** —— 否則任何報名者都能把自己設成主揪。前端也要同步用 `canCurrentUserHandoffHost()` 鎖住主揪下拉選單。
- 留言不限已報名者，任何已登入成員都可以留言。
- 管理員入口隱藏在頁首版本號上：點擊 `.version-label` 開啟／退出管理員模式，仍必須輸入密碼。不得改回顯眼的「管理員模式」按鈕。
- 管理員密碼只能在 `saveEvent` 與 `deleteEvent` 等需要權限的請求中透過 HTTPS 傳給 GAS，不得寫進 localStorage、活動紀錄或 AuditLog。重新載入後要自動退出管理員模式。
- 權限變更必須同時修改前端的按鈕顯示／送出 payload，以及 GAS 的 `assert...Permission_` 驗證；只修改一邊不算完成。
- 主揪不可直接退出自己的活動；必須先在編輯頁把主揪交棒給另一位已報名成員。
- 交棒候選人必須來自已報名名單，不得手動輸入名稱。

## 功能不變條件

### 時間

- 一般活動使用「日期、小時、分鐘」三個選擇欄。
- 分鐘只提供 `00`、`15`、`30`、`45`，不可改回難以在 LINE 內建瀏覽器操作的原生 `datetime-local` 自由輸入。
- 固定團時間是主揪手寫文字，不使用一般活動的時間選擇器。

### 固定團

- schema 版本低於 2 時，顯示但停用「固定團（需更新）」，不可允許寫入缺欄位的舊表格。
- 固定團使用 `isFixedGroup` 與 `fixedTimeText`，時間是主揪手寫文字。
- 固定團在列表置頂，並有「固定團」獨立分頁。分頁只有「揪團中」與「固定團」兩個。
- **報名邏輯與一般活動完全相同**，共用單一 `attendees` 名單、共用 `toggleRSVP`。唯一差別是按鈕文字為「本週參與／本週取消」。
- 主揪不可直接取消參與，要退出一樣必須先交棒 —— 與一般活動同一條規則。
- `fixedAttendees`／`weeklyAttendees` 欄位已停用，只保留在表頭做舊資料相容。讀取時併回 `attendees`，寫入一律為空陣列。**不要重新啟用「固定參與／本週參與」兩段式名單** —— 它沒有每週重置機制，兩份名單行為完全相同，只是徒增複雜度而看不出差別。
- 固定團沒有結束時間，**永遠不會過期、不會被歸檔、也不會同步到 Google 日曆**。它是唯一會長期停留在 `Events` 的資料，因此 `history` 上限對它特別重要。

### 地點

- 預設值是「待定」，不得恢復「線上」內建選項。
- 可輸入地點文字、地址或 Google Maps 分享網址。畫面應以解析後的地點名稱／地址當可點擊文字，不要顯示固定的「點擊開啟地圖」。
- `maps.app.goo.gl` 短網址必須透過 GAS `resolveMapLocation` 解析；前端不能依賴跨網域 redirect fetch。
- GAS 只能追蹤允許的 Google Maps 網域，不可放寬成任意 URL，避免 SSRF。
- 沒有可解析文字時才回退顯示「Google 地圖位置」。

### 許願活動

- 許願是一般活動上的旗標 `isWish`，使用正常的日期時間，**與固定團互斥**（固定團沒有明確日期，無法做三天結算）。
- 需要表格結構版本 `4`。schema 低於 4 時顯示但停用「許願（需更新）」。
- 結算由午夜觸發器 `cleanupExpiredWishes()` 執行，判定用**日曆天**（`getCalendarDayDiff_()`，以專案時區的日期為準），不看時分秒：
  - 建立滿 `WISH_LIFESPAN_DAYS`（3）天，且當下 `attendees` 人數**超過** `WISH_MIN_ATTENDEES`（3，亦即需 4 人以上）→ 許願成立，`isWish` 設為 false 轉為一般活動。
  - 否則 → **整列硬刪除**。
- **硬刪除是本專案唯一不走軟刪除與歸檔的路徑**，這是使用者明確要求的「不留檔」。刪除前必須先移除對應的 Google 日曆行程，否則會留下無主行程。`AuditLog` 的建立紀錄仍保留，那是稽核軌跡。
- 人數只看當下 `attendees`，不看 `history`。曾經報名又退出的人不算數。
- 結算後必須把 `isWish` 關掉，否則之後有人退出會讓已成立的活動再次被判定刪除。
- 星空效果**只套在摺疊標題列**（`.card-summary-bar`），展開後的內容維持一般白底樣式。標題列原本有白底，套用時要改成漸層並把子元素墊到 `z-index: 1`，否則會蓋掉星空。
- 標籤固定顯示「許願中」，粉紅色系（`.tag-wish`）。倒數與人數狀態放在展開內容的 `.wish-status`，是獨立的粗體粉紅字，不要放回 `.card-info` 的資訊列 —— 混在時間／地點裡看不出來。
- `.wish-status` 是純顯示，由 `getWishStatusText()` 即時計算，不存進 Sheet，也不影響 GAS 的結算判定。

### 活動留言

- 留言透過 GAS `addComment` action 寫入，會成為活動 `history` 的一筆 `type: "comment"` 紀錄，顯示在活動紀錄中並與系統紀錄有視覺區隔。
- 留言內容由 GAS 重新組裝，**不直接採用前端送來的 `historyEntry`**，避免前端塞入任意 `action` 文字冒充系統紀錄。
- 長度上限 `MAX_COMMENT_LENGTH`（150 字），前後端都要驗證。空白留言一律擋下。
- 留言計入 `MAX_EVENT_HISTORY`（50 筆）上限。調高上限會等比放大每次同步的傳輸量，改動前先估算。
- 卡片上的「活動留言」按鈕取代了原本的「加到行事曆」。固定團也顯示留言按鈕。

### Google 日曆

- 日曆 ID 只存在 Script Properties 的 `GOOGLE_CALENDAR_ID`／`GOOGLE_CALENDAR_NAME`，**不得寫進 `Code.gs`、`index.html` 或 GitHub**。前端透過 `doGet` 的 `calendar` 欄位取得。
- 同步只在「儲存活動」與「刪除活動」時觸發，報名／退出一律不碰日曆。這是刻意的，不要為了即時性把同步加回 RSVP 流程。
- 只同步活動名稱、時間與地點。**不得寫入說明、費用、主揪或參與名單** —— 曾經有版本把成員名單寫進行程說明欄，那會讓所有看得到日曆的人取得名單。
- `calendarEventId` 完全由 GAS 產生與保管，`saveEvent_` 一律忽略前端送來的值。否則舊分頁快照的空字串會清掉連結，下次儲存就重複建立行程並留下孤兒。
- 取回既有行程後必須用 `isCalendarEventLive_()` 確認它還存在。`getEventById` 對**已刪除**的行程仍會回傳物件，而對已取消的行程呼叫 `setTitle`／`setTime` 不會讓它重新出現 —— 少了這道檢查，同步會回報成功但日曆完全沒有變化。
- `setGoogleCalendar` 必須實際試寫一筆再刪除來驗證權限。唯讀訂閱的日曆一樣讀得到名稱，只檢查 `getCalendarById` 會讓設定看似成功、之後每次同步卻靜默失敗。
- 已過期活動的行程保留為歷史，不再修改也不隨網頁刪除而移除。
- 前端「日曆」按鈕位於 FAB 群組最上方（日曆 → 宣傳 → 揪團），開啟嵌入式日曆與訂閱連結，關閉時要卸載 iframe。
- 時間解析依賴 Apps Script 專案時區為 `Asia/Taipei`。設錯會讓所有行程整批偏移。

## 資料量控制

系統中不得存在任何會無限成長的資料。以下三道機制必須同時保留：

- 活動列的 `history` 上限為 `APP_CONFIG.MAX_EVENT_HISTORY`（50 筆，含留言），由 `trimEventHistory_()` 強制。固定團永遠不會過期也不會被歸檔，沒有這道上限它會無限膨脹。完整紀錄保存在 `AuditLog`。
- 許願活動未達標時整列硬刪除，是唯一不進 `EventsArchive` 的例外，見〈許願活動〉。
- `doGet` 只回傳仍需顯示的活動，已刪除與已過期一律不送（`isRetiredEvent_()`）。不得恢復 `includeDeleted` 參數，那會讓任何拿到 `/exec` 網址的人取得已刪除活動的成員名單。
- 已刪除與過期活動由每日觸發器 `archiveRetiredEvents()` 搬到 `EventsArchive`，並從 `Events` 移除該列。固定團與時間無法解析的活動一律不搬。

過期定義為活動開始時間加 `EVENT_GRACE_MS`（2 小時），前後端必須一致，活動進行中仍要看得到。

「已過期」分頁與匯出歷史紀錄功能已刻意移除，不要重新加回。歸檔資料只在 Sheet 內查看。

## 同步、更新與快取

- 前端會定期同步 GAS 資料與檢查 `version.json`，並使用 `_ts` 與 `cache: "no-store"` 降低 LINE 內建瀏覽器快取影響。
- 「重新整理」按鈕是資料同步，不等於強制重載 HTML。前端版本變更由 `version.json` 自動偵測。
- 保留 `localMutationRevision`、`pendingMutationCount` 與遠端請求合併邏輯，不可讓較早回應覆蓋使用者剛完成的操作。
- 前端先更新畫面的操作，若 GAS 寫入失敗，必須回滾本機畫面，不可讓使用者誤以為雲端已完成。
- `sendPostToGAS` 回傳 `{ ok, message }`。**每一個呼叫點都必須處理 `ok === false`**：用 `snapshotEventState()` 事前存檔、失敗時呼叫 `rollbackEventState()` 還原並顯示 GAS 的錯誤訊息。射後不理會讓使用者看到假成功，重新整理後才發現變更消失。
- 寫入逾時使用 `CONFIG.WRITE_TIMEOUT_MS`。GAS 儲存活動時要同步 Google 日曆，逾時設太短會把已成功的寫入誤判為失敗而回滾。
- 地圖短網址失敗結果在目前頁面會有記憶體快取；更新 GAS 後要完整關閉並重開 LINE 網頁再檢查。

## 修改與驗證清單

修改前：

1. 檢查 `git status --short`，既有未提交修改一律視為他人工作，不得還原或覆蓋。
2. 讀取相關功能的前端、GAS 與 `gas/README.md`，確認是否需要雙邊修改。
3. 保留現有 UI 文字原則：不加 emoji，不復活群組重要公告功能。

修改後至少完成：

1. 擷取 `index.html` 內嵌 script 並以 JavaScript parser／`new Function` 檢查語法。
2. 以 JavaScript parser／`new Function` 檢查 `gas/Code.gs` 語法。
3. **掃描是否呼叫了未定義的函式**：比對所有 `name(` 呼叫與已定義的 `function name`／`const name =`。語法檢查抓不到這種錯，但它會在執行時中斷整個函式 —— 曾經有一次 `openEventDetailModal()` 根本不存在，導致管理員移除成員的請求從未送出，畫面卻顯示成功。
4. 執行 `git diff --check`。
5. 檢查三處前端版本一致。
6. 權限修改要測試：主揪允許、管理員允許、一般非主揪成員拒絕。
7. 同步修改要測試重複 `mutationId`、快速連點、較舊回應不覆蓋新狀態。
8. 寫入流程修改要確認每個 `sendPostToGAS` 呼叫點都處理了失敗並回滾。
9. 使用手機寬度檢查按鈕尺寸、表單捲動與 LINE 內建瀏覽器可操作性。
10. 若可連線診斷 GAS，先做唯讀 GET；POST 只測試不寫入資料的功能，例如錯誤管理員密碼或地圖解析。不得用正式活動做刪除或編輯測試。
11. 純邏輯的 GAS 函式可從 `Code.gs` 抽出、以 stub 補上 `SpreadsheetApp`／`CalendarApp` 後在本機執行驗證，比只讀程式碼可靠得多。

## 常見故障判斷

- 看到「固定團（需更新）」：先檢查網頁目前 `CONFIG.GAS_API_URL` 的 GET 回應最外層是否為 schema 4（固定團門檻 `>= 2`、許願門檻 `>= 4`），再檢查前端是否同步成功。
- 日曆完全沒有新增行程：依序確認 `GOOGLE_CALENDAR_ID` 是否存在、「設定 Google 日曆」是否顯示「寫入權限測試通過」、以及部署版本是否包含 `isCalendarEventLive_()`。若同步回報成功但日曆空白，通常是行程曾被手動刪除、而舊版程式碼對已取消的行程做了無效更新 —— 用「日曆診斷」看「連結已失效」的筆數即可確認。
- 操作看似成功、重新整理後卻復原：代表 GAS 寫入失敗但前端沒有回滾。檢查該操作的 `sendPostToGAS` 呼叫點有沒有處理 `ok === false`，以及是否有未定義函式在送出前就中斷了流程。
- 地點只顯示「Google 地圖位置」：測試 GAS 是否支援 `resolveMapLocation`；回覆「不支援的 action」表示前端已新、GAS 仍舊或網頁指向錯誤部署網址。
- GitHub 程式碼已新但 GAS 功能仍舊：檢查 Apps Script 「管理部署作業」的網頁應用程式網址是否與 `CONFIG.GAS_API_URL` 相同。
- 前端版本仍舊：先檢查 GitHub Pages `version.json`，再判斷是 Pages 尚未發布或 LINE WebView 快取，不要把兩者混為 GAS 同步問題。
- 試算表看不到「活動布告欄」：它是電腦版 Sheet 頂部自訂選單，不是工作表分頁；確認 Apps Script 是由該 Sheet 的「擴充功能」開啟並重新整理 Sheet。

## 交付說明

交付時要明確區分：

- GitHub 前端是否已發布，提供版本號與 commit。
- GAS 是否有程式變更；若有，列出使用者必須手動完成的貼上、授權、`setupProject()`（僅需要時）與「新版本」部署步驟。
- 使用者在 LINE 應看到的版本號，以及需要完整關閉重開才能重試的功能。
