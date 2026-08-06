# LINE 活動布告欄維護指南

本資料夾是個人用的 LINE LIFF 活動布告欄，不屬於 UC Training 品牌網站。其他 AI 在修改前必須先讀完本檔與 `gas/README.md`，只處理本專案所需檔案。

## 專案結構

- `index.html`：單檔前端，包含 HTML、CSS 與所有瀏覽器 JavaScript。
- `version.json`：GitHub Pages 自動更新檢查用的版本清單。
- `gas/Code.gs`：Google Apps Script 後端，處理 Sheet 讀寫、權限、地圖短網址與操作紀錄。
- `gas/README.md`：GAS 表格欄位、安裝、部署與驗證說明。

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

線上 `/exec` 的當前結構應回傳最外層 `"schemaVersion":"2"`。個別舊活動的 `schemaVersion:1` 只代表建立於舊版，不代表整張 Sheet 仍是舊結構。

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

- `setupProject()` 負責新增／修復 `Events` 與 `AuditLog` 表格及欄位。只在 schema 改變或尚未初始化時要求使用者執行。
- `onOpen()` 在電腦版 Google Sheet 頂部建立「活動布告欄」自訂選單，不是底部工作表分頁。手機版 Sheets 可能不顯示自訂選單。
- `setAdminPassword()` 只保存加鹽 SHA-256 雜湊到 Script Properties，密碼不得出現在 Sheet 或程式碼。
- 寫入操作必須保留 Script Lock 與 `mutationId` 幂等檢查，避免手機與電腦同時操作重複寫入。
- 刪除活動必須維持 soft delete：設為 `status = deleted`並寫入 `deletedAt`、`deletedBy`、`deletedByUserId`，不可刪除 Sheet 列。
- `AuditLog` 與活動 `history` 必須記錄建立、編輯、報名、退出、交棒與刪除。
- GAS 是多人同步的最終資料來源。不得讓舊前端快照覆蓋 GAS 中較新的參與名單。

## 權限模型

- 主揪可編輯與刪除自己的活動。
- 管理員模式啟用後，可編輯與刪除任何活動，包含名稱、時間、地點、費用、人數上限、說明與主揪交棒。
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
- 固定團使用 `isFixedGroup`、`fixedTimeText`、`fixedAttendees`、`weeklyAttendees`。
- 固定團在列表置頂，並位於「揪團中」與「已過期」之間的獨立分頁。
- 參與方式為「固定參與」或「本週參與」，兩者互斥。固定團不顯示加到行事曆。
- 固定團主揪必須維持固定參與，要退出一樣必須先交棒。

### 地點

- 預設值是「待定」，不得恢復「線上」內建選項。
- 可輸入地點文字、地址或 Google Maps 分享網址。畫面應以解析後的地點名稱／地址當可點擊文字，不要顯示固定的「點擊開啟地圖」。
- `maps.app.goo.gl` 短網址必須透過 GAS `resolveMapLocation` 解析；前端不能依賴跨網域 redirect fetch。
- GAS 只能追蹤允許的 Google Maps 網域，不可放寬成任意 URL，避免 SSRF。
- 沒有可解析文字時才回退顯示「Google 地圖位置」。

## 同步、更新與快取

- 前端會定期同步 GAS 資料與檢查 `version.json`，並使用 `_ts` 與 `cache: "no-store"` 降低 LINE 內建瀏覽器快取影響。
- 「重新整理」按鈕是資料同步，不等於強制重載 HTML。前端版本變更由 `version.json` 自動偵測。
- 保留 `localMutationRevision`、`pendingMutationCount` 與遠端請求合併邏輯，不可讓較早回應覆蓋使用者剛完成的操作。
- 前端先更新畫面的操作，若 GAS 寫入失敗，必須回滾本機畫面，不可讓使用者誤以為雲端已完成。
- 地圖短網址失敗結果在目前頁面會有記憶體快取；更新 GAS 後要完整關閉並重開 LINE 網頁再檢查。

## 修改與驗證清單

修改前：

1. 檢查 `git status --short`，既有未提交修改一律視為他人工作，不得還原或覆蓋。
2. 讀取相關功能的前端、GAS 與 `gas/README.md`，確認是否需要雙邊修改。
3. 保留現有 UI 文字原則：不加 emoji，不復活群組重要公告功能。

修改後至少完成：

1. 擷取 `index.html` 內嵌 script 並以 JavaScript parser／`new Function` 檢查語法。
2. 以 JavaScript parser／`new Function` 檢查 `gas/Code.gs` 語法。
3. 執行 `git diff --check`。
4. 檢查三處前端版本一致。
5. 權限修改要測試：主揪允許、管理員允許、一般非主揪成員拒絕。
6. 同步修改要測試重複 `mutationId`、快速連點、較舊回應不覆蓋新狀態。
7. 使用手機寬度檢查按鈕尺寸、表單捲動與 LINE 內建瀏覽器可操作性。
8. 若可連線診斷 GAS，先做唯讀 GET；POST 只測試不寫入資料的功能，例如錯誤管理員密碼或地圖解析。不得用正式活動做刪除或編輯測試。

## 常見故障判斷

- 看到「固定團（需更新）」：先檢查網頁目前 `CONFIG.GAS_API_URL` 的 GET 回應最外層是否為 schema 2，再檢查前端是否同步成功。
- 地點只顯示「Google 地圖位置」：測試 GAS 是否支援 `resolveMapLocation`；回覆「不支援的 action」表示前端已新、GAS 仍舊或網頁指向錯誤部署網址。
- GitHub 程式碼已新但 GAS 功能仍舊：檢查 Apps Script 「管理部署作業」的網頁應用程式網址是否與 `CONFIG.GAS_API_URL` 相同。
- 前端版本仍舊：先檢查 GitHub Pages `version.json`，再判斷是 Pages 尚未發布或 LINE WebView 快取，不要把兩者混為 GAS 同步問題。
- 試算表看不到「活動布告欄」：它是電腦版 Sheet 頂部自訂選單，不是工作表分頁；確認 Apps Script 是由該 Sheet 的「擴充功能」開啟並重新整理 Sheet。

## 交付說明

交付時要明確區分：

- GitHub 前端是否已發布，提供版本號與 commit。
- GAS 是否有程式變更；若有，列出使用者必須手動完成的貼上、授權、`setupProject()`（僅需要時）與「新版本」部署步驟。
- 使用者在 LINE 應看到的版本號，以及需要完整關閉重開才能重試的功能。
