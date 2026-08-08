/**
 * LINE 群組活動布告欄 — Google Apps Script 後端
 *
 * ===========================================================================
 * 【換人接手時要改哪些東西】
 * ===========================================================================
 * 本程式碼「不含」任何帳號專屬設定，全部改在下列位置。
 * 換人使用時不需要修改這個檔案的任何一行，照下表逐項設定即可。
 *
 * ── A. 屬於 GAS 這一側（都不寫進程式碼） ──────────────────────────────
 *
 * A1. Google 試算表
 *     改法：用新的 Sheet 開「擴充功能 → Apps Script」，貼入本檔，
 *           執行一次 setupProject()。
 *     存放：Script Properties 的 SPREADSHEET_ID（setupProject 會自動寫入）。
 *     注意：沿用舊 Sheet 的話，Script Properties 會留著舊的 SPREADSHEET_ID，
 *           必須手動刪掉該筆屬性，否則仍會寫到舊試算表。
 *
 * A2. Google 日曆
 *     改法：Sheet 選單「活動布告欄 → 設定 Google 日曆」，貼上日曆網址或 ID。
 *     存放：Script Properties 的 GOOGLE_CALENDAR_ID。
 *     注意：執行部署的 Google 帳號必須對該日曆有「變更活動」權限，
 *           唯讀訂閱的日曆無法寫入。設定完可再跑「同步現有未過期活動」。
 *
 * A3. 管理員密碼
 *     改法：Sheet 選單「活動布告欄 → 設定管理員密碼」。
 *     存放：Script Properties 的 ADMIN_PASSWORD_SALT / ADMIN_PASSWORD_HASH
 *           （只存加鹽 SHA-256 雜湊，明碼不落地）。
 *
 * A4. 專案時區
 *     改法：Apps Script「專案設定 → 時區」設為 Asia/Taipei。
 *     原因：前端送來的時間字串不帶時區，靠這個設定判讀。
 *           設錯會讓所有 Google 日曆行程整批偏移。
 *
 * ── B. 屬於前端 index.html 這一側 ────────────────────────────────────
 *
 * B1. CONFIG.GAS_API_URL
 *     本專案部署後產生的 /exec 網址。
 *     優先「編輯現有部署 → 選新版本」以保持網址不變；
 *     若改用「新增部署」而網址變了，前端這一行必須同步更新。
 *
 * B2. CONFIG.LIFF_ID 與 CONFIG.LIFF_URL
 *     換 LINE 官方帳號／LINE Login channel 時要一起換這兩個值。
 *     與 GAS 無關，純前端設定。
 *
 * ── C. 不需要改的東西 ────────────────────────────────────────────────
 *     本檔所有常數（表格名稱、欄位、SCHEMA_VERSION、鎖定逾時）都是通用邏輯，
 *     換人使用時維持原樣即可。
 *
 * ===========================================================================
 * 【安裝步驟】
 * ===========================================================================
 * 1. 從目標 Google Sheet 開啟「擴充功能 → Apps Script」。
 * 2. 將本檔完整貼入 Code.gs。
 * 3. 確認專案時區為 Asia/Taipei（見 A4）。
 * 4. 手動執行 setupProject() 一次並授權。
 * 5. 回到 Sheet，用「活動布告欄 → 設定 Google 日曆」保存目標日曆（見 A2）。
 * 6. 部署為網頁應用程式：執行身分選「我」，存取權選「所有人」。
 * 7. 將部署網址填入前端 CONFIG.GAS_API_URL（見 B1）。
 */

const APP_CONFIG = Object.freeze({
  EVENTS_SHEET: "Events",
  ARCHIVE_SHEET: "EventsArchive",
  AUDIT_SHEET: "AuditLog",
  // 活動列只保留最近的操作紀錄，避免長期固定團無上限膨脹。
  // AuditLog 仍保存完整紀錄。留言也計入這個上限。
  MAX_EVENT_HISTORY: 50,
  MAX_COMMENT_LENGTH: 150,
  // 活動結束後多久才視為過期並移出前端資料。
  // 給 2 小時緩衝，活動進行中仍看得到。
  EVENT_GRACE_MS: 2 * 60 * 60 * 1000,
  STATUS_ACTIVE: "active",
  STATUS_DELETED: "deleted",
  ADMIN_PASSWORD_HASH_PROPERTY: "ADMIN_PASSWORD_HASH",
  ADMIN_PASSWORD_SALT_PROPERTY: "ADMIN_PASSWORD_SALT",
  CALENDAR_ID_PROPERTY: "GOOGLE_CALENDAR_ID",
  CALENDAR_NAME_PROPERTY: "GOOGLE_CALENDAR_NAME",
  LOCK_TIMEOUT_MS: 15000,
  SCHEMA_VERSION: "3"
});

const EVENT_HEADERS = Object.freeze([
  "id",
  "status",
  "title",
  "datetime",
  "isFixedGroup",
  "fixedTimeText",
  "location",
  "hostName",
  "hostUser",
  "fee",
  "maxAttendees",
  "description",
  "attendees",
  "fixedAttendees",
  "weeklyAttendees",
  "history",
  "calendarEventId",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "deletedBy",
  "deletedByUserId",
  "schemaVersion"
]);

const AUDIT_HEADERS = Object.freeze([
  "mutationId",
  "logId",
  "eventId",
  "timestamp",
  "actorUserId",
  "actorName",
  "actionType",
  "action",
  "details"
]);

const JSON_EVENT_FIELDS = Object.freeze([
  "hostUser",
  "attendees",
  "fixedAttendees",
  "weeklyAttendees",
  "history"
]);

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("活動布告欄")
    .addItem("初始化／修復表格", "setupProject")
    .addItem("設定 Google 日曆", "setGoogleCalendar")
    .addItem("同步現有未過期活動", "syncAllExistingEventsToCalendar")
    .addItem("日曆診斷", "checkCalendarStatus")
    .addItem("立即歸檔過期活動", "archiveRetiredEventsFromMenu")
    .addItem("設定管理員密碼", "setAdminPassword")
    .addItem("顯示表格設計", "showSchemaInfo")
    .addToUi();
}

function setGoogleCalendar() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "設定 Google 日曆",
    "請貼上 Google 日曆網址或 Calendar ID。設定只保存在 Apps Script Properties，不會寫入 GitHub。",
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const calendarId = parseCalendarIdInput_(response.getResponseText());
  if (!calendarId) {
    ui.alert("無法辨識日曆網址或 Calendar ID。");
    return;
  }

  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    ui.alert("無法開啟這本日曆。請確認目前 Google 帳號已加入該日曆並具有編輯權限。");
    return;
  }

  // 唯讀訂閱的日曆一樣讀得到名稱，必須實際試寫一次才知道有沒有編輯權限。
  // 少了這一步，設定當下會顯示成功，之後每次同步卻只在背景失敗，使用者不會察覺。
  const writeCheckError = getCalendarWriteError_(calendar);
  if (writeCheckError) {
    ui.alert(
      "這本日曆無法寫入，尚未保存設定。\n\n" +
      "請確認執行部署的 Google 帳號對「" + calendar.getName() + "」具有「變更活動」權限。\n\n" +
      "錯誤訊息：" + writeCheckError
    );
    return;
  }

  // 一併記下名稱，讓 doGet 不必每次都呼叫 CalendarApp 拖慢同步。
  PropertiesService.getScriptProperties().setProperties({
    [APP_CONFIG.CALENDAR_ID_PROPERTY]: calendarId,
    [APP_CONFIG.CALENDAR_NAME_PROPERTY]: calendar.getName()
  });
  ui.alert("已連結 Google 日曆「" + calendar.getName() + "」，寫入權限測試通過。可再執行「同步現有未過期活動」。");
}

/**
 * 建立一筆測試行程再立刻刪除，用來確認真的具有寫入權限。
 * 回傳空字串代表可寫入，否則回傳錯誤訊息。
 */
function getCalendarWriteError_(calendar) {
  let probeEvent = null;
  try {
    const probeStart = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    probeEvent = calendar.createEvent(
      "【權限測試】活動布告欄，可直接忽略",
      probeStart,
      new Date(probeStart.getTime() + 15 * 60 * 1000)
    );
    if (!probeEvent) return "無法建立測試行程。";
    return "";
  } catch (error) {
    return String(error && error.message ? error.message : error);
  } finally {
    if (probeEvent) {
      try { probeEvent.deleteEvent(); } catch (ignore) {}
    }
  }
}

function parseCalendarIdInput_(inputValue) {
  const input = String(inputValue || "").trim();
  if (!input) return "";
  if (/^[^\s@]+@[^\s@]+$/.test(input)) return input;

  const cidMatch = input.match(/[?&]cid=([^&#]+)/i);
  if (!cidMatch) return "";
  let encoded = cidMatch[1];
  try { encoded = decodeURIComponent(encoded); } catch (ignore) {}
  encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (encoded.length % 4) encoded += "=";
  try {
    const decoded = Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString().trim();
    return /^[^\s@]+@[^\s@]+$/.test(decoded) ? decoded : "";
  } catch (error) {
    return "";
  }
}

/**
 * 提供給前端「日曆」頁面使用的資訊。
 * 只讀 Script Properties，不呼叫 CalendarApp，避免拖慢每 12 秒一次的同步。
 * 日曆 ID 本來就必須送到瀏覽器才能嵌入與訂閱，因此可以回傳；
 * 但仍然不寫進前端程式碼或 GitHub。
 */
function getCalendarPublicInfo_() {
  const properties = PropertiesService.getScriptProperties();
  const calendarId = String(properties.getProperty(APP_CONFIG.CALENDAR_ID_PROPERTY) || "").trim();
  return {
    configured: Boolean(calendarId),
    calendarId: calendarId,
    name: String(properties.getProperty(APP_CONFIG.CALENDAR_NAME_PROPERTY) || "").trim()
  };
}

function getConfiguredCalendarId_() {
  return String(
    PropertiesService.getScriptProperties().getProperty(APP_CONFIG.CALENDAR_ID_PROPERTY) || ""
  ).trim();
}

function syncAllExistingEventsToCalendar() {
  const ui = SpreadsheetApp.getUi();
  const calendarId = getConfiguredCalendarId_();
  if (!calendarId) {
    ui.alert("尚未設定 Google 日曆。請先執行「設定 Google 日曆」。");
    return;
  }

  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    ui.alert("無法存取已設定的 Google 日曆，請重新設定。");
    return;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(APP_CONFIG.LOCK_TIMEOUT_MS);
  try {
    const sheet = getRequiredSheet_(APP_CONFIG.EVENTS_SHEET);
    if (!hasRequiredHeaders_(sheet, EVENT_HEADERS)) {
      ui.alert("請先執行「初始化／修復表格」，新增 calendarEventId 欄位。");
      return;
    }

    let syncedCount = 0;
    let skippedCount = 0;
    readAllEvents_(sheet).forEach(eventItem => {
      if (!shouldSyncCalendarEvent_(eventItem)) {
        skippedCount += 1;
        return;
      }
      const calendarEventId = syncToGoogleCalendar_(eventItem, "save");
      if (calendarEventId === null) {
        skippedCount += 1;
        return;
      }
      eventItem.calendarEventId = calendarEventId;
      eventItem.schemaVersion = APP_CONFIG.SCHEMA_VERSION;
      const found = findEventById_(sheet, eventItem.id);
      if (found) writeEvent_(sheet, found.rowNumber, eventItem);
      syncedCount += 1;
    });
    SpreadsheetApp.flush();
    ui.alert("日曆同步完成：" + syncedCount + " 筆已同步，" + skippedCount + " 筆已跳過。");
  } finally {
    lock.releaseLock();
  }
}

/**
 * 日曆診斷：回報設定狀態、日曆上實際的行程數，以及表格中失效的連結數。
 * 只輸出統計與狀態，不顯示活動內容或成員資料。
 */
function checkCalendarStatus() {
  const ui = SpreadsheetApp.getUi();
  const calendarId = getConfiguredCalendarId_();
  if (!calendarId) {
    ui.alert("日曆診斷", "尚未設定 Google 日曆。請先執行「設定 Google 日曆」。", ui.ButtonSet.OK);
    return;
  }

  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    ui.alert("日曆診斷", "已設定日曆 ID，但目前帳號無法存取這本日曆。", ui.ButtonSet.OK);
    return;
  }

  const sheet = getRequiredSheet_(APP_CONFIG.EVENTS_SHEET);
  const allEvents = readAllEvents_(sheet);
  const shouldSync = allEvents.filter(shouldSyncCalendarEvent_);

  let liveLinks = 0;
  let deadLinks = 0;
  let missingLinks = 0;
  shouldSync.forEach(eventItem => {
    if (!eventItem.calendarEventId) { missingLinks += 1; return; }
    let candidate = null;
    try { candidate = calendar.getEventById(String(eventItem.calendarEventId)); } catch (ignore) {}
    if (candidate && isCalendarEventLive_(calendar, candidate)) liveLinks += 1;
    else deadLinks += 1;
  });

  const now = new Date();
  const upcoming = calendar.getEvents(now, new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000));
  const ourEvents = upcoming.filter(item => String(item.getTitle() || "").indexOf("【揪團】") === 0);

  ui.alert("日曆診斷", [
    "日曆名稱：" + calendar.getName(),
    "可否寫入：" + (getCalendarWriteError_(calendar) ? "否" : "是"),
    "",
    "── 表格這一側 ──",
    "活動總數：" + allEvents.length,
    "應同步（未過期、非固定團）：" + shouldSync.length,
    "  連結有效：" + liveLinks,
    "  連結已失效（行程被刪）：" + deadLinks,
    "  尚未建立連結：" + missingLinks,
    "",
    "── 日曆這一側（未來 90 天）──",
    "行程總數：" + upcoming.length,
    "其中「【揪團】」開頭：" + ourEvents.length,
    "",
    deadLinks + missingLinks > 0
      ? "建議：執行「同步現有未過期活動」重建 " + (deadLinks + missingLinks) + " 筆行程。"
      : "表格與日曆連結一致。"
  ].join("\n"), ui.ButtonSet.OK);
}

function setAdminPassword() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "設定管理員密碼",
    "請輸入至少 8 個字元的密碼。密碼只會以雜湊後的形式保存，不會寫入網頁或 GitHub。",
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const password = String(response.getResponseText() || "");
  if (password.length < 8) {
    ui.alert("密碼至少需要 8 個字元。");
    return;
  }

  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({
    [APP_CONFIG.ADMIN_PASSWORD_SALT_PROPERTY]: salt,
    [APP_CONFIG.ADMIN_PASSWORD_HASH_PROPERTY]: hashAdminPassword_(password, salt)
  });
  ui.alert("管理員密碼已設定。回到網頁點「管理員模式」後輸入此密碼即可啟用。");
}

function setupProject() {
  const lock = LockService.getScriptLock();
  lock.waitLock(APP_CONFIG.LOCK_TIMEOUT_MS);
  try {
    const spreadsheet = getSpreadsheet_();
    const eventsSheet = getOrCreateEventsSheet_(spreadsheet);
    const auditSheet = spreadsheet.getSheetByName(APP_CONFIG.AUDIT_SHEET) ||
      spreadsheet.insertSheet(APP_CONFIG.AUDIT_SHEET);

    ensureHeaders_(eventsSheet, EVENT_HEADERS);
    ensureHeaders_(auditSheet, AUDIT_HEADERS);
    formatEventsSheet_(eventsSheet);
    formatAuditSheet_(auditSheet);
    getOrCreateArchiveSheet_(spreadsheet, EVENT_HEADERS.slice());
    installArchiveTrigger_();

    PropertiesService.getScriptProperties().setProperties({
      SPREADSHEET_ID: spreadsheet.getId(),
      SCHEMA_VERSION: APP_CONFIG.SCHEMA_VERSION
    });
    SpreadsheetApp.flush();
    return {
      status: "success",
      message: "Events、EventsArchive 與 AuditLog 已完成初始化，表格結構版本為 " +
        APP_CONFIG.SCHEMA_VERSION + "。已建立每日自動歸檔觸發器。"
    };
  } finally {
    lock.releaseLock();
  }
}

function showSchemaInfo() {
  const message = [
    "Events：保存活動目前狀態，status 為 active 或 deleted。",
    "固定團：isFixedGroup 為 TRUE，固定時間保存在 fixedTimeText。",
    "固定團與一般活動共用同一份 attendees 名單，沒有分固定／本週參與。",
    "Google 日曆：calendarEventId 保存對應行程 ID，日曆 ID 只保存在 Script Properties。",
    "AuditLog：永久保存建立、報名、退出、編輯、交棒與刪除紀錄。",
    "刪除活動不會移除列，只會寫入 deletedAt 與 deletedBy。"
  ].join("\n");
  SpreadsheetApp.getUi().alert(message);
}

function doGet(e) {
  try {
    const eventsSheet = getRequiredSheet_(APP_CONFIG.EVENTS_SHEET);
    const schemaReady = hasRequiredHeaders_(eventsSheet, EVENT_HEADERS);
    // 只回傳仍需顯示的活動。已過期與已刪除一律不送，
    // 避免資料量隨時間無限累積，也不再對外公開已刪除活動的名單。
    const events = readAllEvents_(eventsSheet)
      .filter(eventItem => !isRetiredEvent_(eventItem));

    return jsonOutput_({
      status: "success",
      schemaVersion: schemaReady ? APP_CONFIG.SCHEMA_VERSION : "1",
      serverTime: new Date().toISOString(),
      calendar: getCalendarPublicInfo_(),
      events: events
    });
  } catch (error) {
    return errorOutput_(error);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const payload = parsePayload_(e);

    if (payload.action === "verifyAdminPassword") {
      return jsonOutput_({
        status: "success",
        canDeleteAnyEvent: verifyAdminPassword_(payload.adminPassword),
        isAdminPasswordConfigured: isAdminPasswordConfigured_(),
        serverTime: new Date().toISOString()
      });
    }

    if (payload.action === "resolveMapLocation") {
      return jsonOutput_(Object.assign({
        status: "success",
        serverTime: new Date().toISOString()
      }, resolveMapLocation_(payload.location)));
    }

    lock.waitLock(APP_CONFIG.LOCK_TIMEOUT_MS);

    const eventsSheet = getRequiredSheet_(APP_CONFIG.EVENTS_SHEET);
    const auditSheet = getRequiredSheet_(APP_CONFIG.AUDIT_SHEET);

    const needsFixedGroupSchema = payload.isFixedGroup === true ||
      String(payload.isFixedGroup || "").toLowerCase() === "true";
    if (needsFixedGroupSchema && !hasRequiredHeaders_(eventsSheet, EVENT_HEADERS)) {
      throw new Error("固定團欄位尚未初始化，請先執行 setupProject()。");
    }

    if (payload.mutationId && hasProcessedMutation_(auditSheet, payload.mutationId)) {
      return jsonOutput_({
        status: "success",
        duplicate: true,
        mutationId: payload.mutationId
      });
    }

    let result;
    switch (payload.action) {
      case "saveEvent":
        result = saveEvent_(eventsSheet, auditSheet, payload);
        break;
      case "toggleRSVP":
        result = updateRsvp_(eventsSheet, auditSheet, payload);
        break;
      case "deleteEvent":
        result = softDeleteEvent_(eventsSheet, auditSheet, payload);
        break;
      case "adminRemoveAttendee":
        result = adminRemoveAttendee_(eventsSheet, auditSheet, payload);
        break;
      case "addComment":
        result = addComment_(eventsSheet, auditSheet, payload);
        break;
      default:
        throw new Error("不支援的 action：" + String(payload.action || "空白"));
    }

    SpreadsheetApp.flush();
    return jsonOutput_(Object.assign({
      status: "success",
      mutationId: payload.mutationId || "",
      serverTime: new Date().toISOString()
    }, result));
  } catch (error) {
    return errorOutput_(error);
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function resolveMapLocation_(locationValue) {
  const location = String(locationValue || "").trim();
  const urlMatch = location.match(/https?:\/\/[^\s]+/i);
  if (!urlMatch) {
    return { location: location || "待定", displayName: location || "待定", mapUrl: "" };
  }

  const mapUrl = String(urlMatch[0]);
  if (!isAllowedGoogleMapsUrl_(mapUrl)) {
    return { location: location, displayName: stripLocationUrl_(location, mapUrl) || "地點連結", mapUrl: mapUrl };
  }

  const existingName = stripLocationUrl_(location, mapUrl);
  if (existingName) {
    return { location: existingName + " " + mapUrl, displayName: existingName, mapUrl: mapUrl };
  }

  const resolvedUrl = followGoogleMapsRedirects_(mapUrl);
  const displayName = extractGoogleMapsLabel_(resolvedUrl) || "Google 地圖位置";
  return {
    location: displayName + " " + mapUrl,
    displayName: displayName,
    mapUrl: mapUrl
  };
}

function stripLocationUrl_(location, mapUrl) {
  return String(location || "")
    .replace(String(mapUrl || ""), " ")
    .replace(/^[\s|,，:：\-]+|[\s|,，:：\-]+$/g, "")
    .trim();
}

function isAllowedGoogleMapsUrl_(urlValue) {
  const match = String(urlValue || "").match(/^https?:\/\/([^\/?#]+)/i);
  if (!match) return false;
  const hostname = String(match[1] || "").toLowerCase().replace(/:\d+$/, "");
  return hostname === "maps.app.goo.gl" ||
    hostname === "goo.gl" ||
    /^(?:www\.|maps\.)?google\.(?:com|com\.tw)$/.test(hostname);
}

function followGoogleMapsRedirects_(initialUrl) {
  let currentUrl = String(initialUrl || "");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!isAllowedGoogleMapsUrl_(currentUrl)) break;
    try {
      const response = UrlFetchApp.fetch(currentUrl, {
        method: "get",
        followRedirects: false,
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code < 300 || code >= 400) break;
      const headers = response.getAllHeaders();
      const nextUrl = String(headers.Location || headers.location || "");
      if (!nextUrl || !/^https?:\/\//i.test(nextUrl) || !isAllowedGoogleMapsUrl_(nextUrl)) break;
      currentUrl = nextUrl;
    } catch (error) {
      console.warn("Google Maps redirect resolution failed", error);
      break;
    }
  }
  return currentUrl;
}

function extractGoogleMapsLabel_(urlValue) {
  const url = String(urlValue || "");
  const queryMatch = url.match(/[?&](?:q|query|destination)=([^&#]+)/i);
  if (queryMatch) return cleanGoogleMapsLabel_(queryMatch[1]);

  const placeMatch = url.match(/\/maps\/(?:place|search)\/([^/?#]+)/i);
  if (placeMatch) return cleanGoogleMapsLabel_(placeMatch[1]);
  return "";
}

function cleanGoogleMapsLabel_(encodedValue) {
  let value = String(encodedValue || "").replace(/\+/g, " ");
  try { value = decodeURIComponent(value); } catch (ignore) {}
  value = value.replace(/\s+/g, " ").trim();
  if (!value || /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(value)) return "";
  return value.slice(0, 160);
}

function saveEvent_(eventsSheet, auditSheet, payload) {
  const eventId = requireText_(payload.id, "缺少活動 id");
  const found = findEventById_(eventsSheet, eventId);
  const existingEvent = found ? found.event : null;
  const actorUserId = String(payload.actorUserId || "");
  const eventAction = String(payload.eventAction || (existingEvent ? "update" : "create"));

  if (existingEvent) {
    assertActiveEvent_(existingEvent);
    assertEditPermission_(existingEvent, payload);
  } else {
    const creatingHostId = getHostUserId_(payload);
    if (!actorUserId || !creatingHostId || actorUserId !== creatingHostId) {
      throw new Error("建立活動者必須與主揪相同。");
    }
  }

  const nowIso = new Date().toISOString();
  const normalizedEvent = normalizeEvent_(payload, existingEvent);

  if (existingEvent) {
    // 編輯活動只改活動內容，名單永遠以 GAS 目前資料為準，避免舊分頁覆蓋新報名。
    // calendarEventId 只由 GAS 產生與保管，一律忽略前端送來的值；
    // 否則舊快照的空字串會清掉連結，下次儲存就會另外建立重複的日曆行程。
    normalizedEvent.calendarEventId = String(existingEvent.calendarEventId || "");
    normalizedEvent.isFixedGroup = existingEvent.isFixedGroup === true;
    normalizedEvent.attendees = normalizeUsers_(existingEvent.attendees);
    normalizedEvent.fixedAttendees = [];
    normalizedEvent.weeklyAttendees = [];
    normalizedEvent.history = mergeHistoryLists_(existingEvent.history, payload.history);

    if (eventAction === "handoff") {
      // 交棒是主揪／管理員限定，一般報名者只能改內容。
      assertHandoffPermission_(existingEvent, payload);
      const newHostUserId = getHostUserId_(normalizedEvent);
      const isRegistered = normalizedEvent.attendees.some(user =>
        String(user.userId) === String(newHostUserId)
      );
      if (!newHostUserId || newHostUserId === getHostUserId_(existingEvent) || !isRegistered) {
        throw new Error("新主揪必須是另一位已報名成員。");
      }
    } else {
      // 一般編輯不可順便手動改主揪；交棒必須使用 handoff 動作。
      normalizedEvent.hostUser = existingEvent.hostUser;
      normalizedEvent.hostName = existingEvent.hostName;
    }
  } else {
    // 新活動一律從沒有日曆行程開始，不接受前端帶進來的 calendarEventId。
    normalizedEvent.calendarEventId = "";
    normalizedEvent.fixedAttendees = [];
    normalizedEvent.weeklyAttendees = [];
    const creatingHost = normalizeUser_(normalizedEvent.hostUser);
    normalizedEvent.attendees = normalizeUsers_([creatingHost].concat(normalizedEvent.attendees || []));
    if (normalizedEvent.isFixedGroup && !normalizedEvent.fixedTimeText) {
      throw new Error("固定團必須填寫固定時間。");
    }
  }

  if (normalizedEvent.isFixedGroup && !normalizedEvent.fixedTimeText) {
    throw new Error("固定團必須填寫固定時間。");
  }

  normalizedEvent.id = eventId;
  normalizedEvent.status = APP_CONFIG.STATUS_ACTIVE;
  normalizedEvent.deleted = false;
  normalizedEvent.createdAt = existingEvent && existingEvent.createdAt
    ? existingEvent.createdAt
    : String(payload.createdAt || nowIso);
  normalizedEvent.updatedAt = nowIso;
  normalizedEvent.deletedAt = "";
  normalizedEvent.deletedBy = "";
  normalizedEvent.deletedByUserId = "";
  normalizedEvent.schemaVersion = APP_CONFIG.SCHEMA_VERSION;

  const changedFields = getChangedFields_(existingEvent, normalizedEvent);

  const calEventId = syncToGoogleCalendar_(normalizedEvent, "save");
  if (calEventId !== null) normalizedEvent.calendarEventId = calEventId;

  writeEvent_(eventsSheet, found && found.rowNumber, normalizedEvent);
  appendAudit_(auditSheet, payload, {
    eventId: eventId,
    actionType: eventAction,
    action: getLatestHistoryAction_(normalizedEvent) || (existingEvent ? "更新活動" : "建立活動"),
    details: {
      eventAction: eventAction,
      changedFields: changedFields
    }
  });

  return { event: normalizedEvent };
}

function updateRsvp_(eventsSheet, auditSheet, payload) {
  const eventId = requireText_(payload.eventId, "缺少 eventId");
  const userId = requireText_(payload.userId, "缺少 userId");
  const actorUserId = String(payload.actorUserId || "");
  if (actorUserId && actorUserId !== userId) {
    throw new Error("只能替自己報名或退出活動。");
  }
  const found = requireEvent_(eventsSheet, eventId);
  const eventItem = found.event;
  assertActiveEvent_(eventItem);

  // 固定團與一般活動的報名邏輯完全相同，只差在沒有日期。
  const attendees = normalizeUsers_(eventItem.attendees);
  const existingIndex = attendees.findIndex(user => String(user.userId) === userId);
  const intent = ["join", "cancel"].includes(String(payload.rsvpAction))
    ? String(payload.rsvpAction)
    : (existingIndex >= 0 ? "cancel" : "join");

  if (intent === "cancel") {
    if (String(getHostUserId_(eventItem)) === userId) {
      throw new Error("主揪必須先交棒，才能退出活動。");
    }
    if (existingIndex >= 0) attendees.splice(existingIndex, 1);
  } else if (existingIndex < 0) {
    const maxAttendees = Number(eventItem.maxAttendees || 0);
    if (maxAttendees > 0 && attendees.length >= maxAttendees) {
      throw new Error("活動人數已滿。");
    }
    attendees.push(normalizeUser_({
      userId: userId,
      displayName: payload.displayName,
      pictureUrl: payload.pictureUrl
    }));
  }

  eventItem.attendees = normalizeUsers_(attendees);
  eventItem.history = mergeHistoryEntries_(eventItem.history, payload.historyEntry);
  eventItem.updatedAt = new Date().toISOString();
  eventItem.schemaVersion = APP_CONFIG.SCHEMA_VERSION;
  writeEvent_(eventsSheet, found.rowNumber, eventItem);

  appendAudit_(auditSheet, payload, {
    eventId: eventId,
    actionType: intent === "join" ? "join" : "leave",
    action: intent === "join" ? "報名參加活動" : "退出活動",
    details: {
      attendeeUserId: userId,
      attendeeName: String(payload.displayName || payload.actorName || ""),
      attendeeCount: eventItem.attendees.length
    }
  });

  return {
    eventId: eventId,
    rsvpAction: intent,
    attendees: eventItem.attendees,
    history: eventItem.history
  };
}

/**
 * 在活動紀錄中新增一則留言。任何已登入成員都可以留言，不限已報名者。
 * 留言內容由 GAS 重新組裝，不直接採用前端送來的 history 條目，
 * 避免前端塞入任意的 action 文字冒充系統紀錄。
 */
function addComment_(eventsSheet, auditSheet, payload) {
  const eventId = requireText_(payload.eventId, "缺少 eventId");
  const userId = requireText_(payload.userId, "缺少 userId");
  const text = String(payload.text || "").replace(/\s+$/g, "").trim();

  if (!text) throw new Error("留言內容不可空白。");
  if (text.length > APP_CONFIG.MAX_COMMENT_LENGTH) {
    throw new Error("留言請控制在 " + APP_CONFIG.MAX_COMMENT_LENGTH + " 字以內。");
  }

  const found = requireEvent_(eventsSheet, eventId);
  const eventItem = found.event;
  assertActiveEvent_(eventItem);

  const sourceEntry = payload.historyEntry || {};
  const entry = {
    id: String(sourceEntry.id || ("log_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8))),
    author: String(payload.displayName || payload.actorName || "未命名成員"),
    authorUserId: userId,
    time: String(sourceEntry.time || ""),
    timestamp: new Date().toISOString(),
    action: text,
    type: "comment"
  };

  eventItem.history = mergeHistoryEntries_(eventItem.history, entry);
  eventItem.updatedAt = new Date().toISOString();
  eventItem.schemaVersion = APP_CONFIG.SCHEMA_VERSION;
  writeEvent_(eventsSheet, found.rowNumber, eventItem);

  appendAudit_(auditSheet, payload, {
    eventId: eventId,
    actionType: "comment",
    action: "留言：" + text,
    details: { commentLength: text.length }
  });

  return { eventId: eventId, history: eventItem.history, entry: entry };
}

function adminRemoveAttendee_(eventsSheet, auditSheet, payload) {
  const eventId = requireText_(payload.eventId, "缺少 eventId");
  const targetUserId = requireText_(payload.targetUserId, "缺少 targetUserId");
  const actorUserId = requireText_(payload.actorUserId, "缺少 actorUserId");

  const found = requireEvent_(eventsSheet, eventId);
  const eventItem = found.event;
  assertActiveEvent_(eventItem);

  const isHost = String(getHostUserId_(eventItem)) === actorUserId;
  const isAdmin = verifyAdminPassword_(payload.adminPassword);

  if (!isHost && !isAdmin) {
    throw new Error("只有主揪或管理員可以移除成員。");
  }

  if (String(getHostUserId_(eventItem)) === targetUserId) {
    throw new Error("主揪無法被移除，請先透過編輯更換主揪。");
  }

  let attendees = normalizeUsers_(eventItem.attendees);
  attendees = attendees.filter(u => String(u.userId) !== targetUserId);
  eventItem.attendees = attendees;

  if (payload.historyEntry) {
    eventItem.history = mergeHistoryEntries_(eventItem.history, payload.historyEntry);
  }
  eventItem.updatedAt = new Date().toISOString();
  writeEvent_(eventsSheet, found.rowNumber, eventItem);

  appendAudit_(auditSheet, payload, {
    eventId: eventId,
    actionType: "admin_remove_attendee",
    action: `管理員移除成員 ${payload.targetUserName || targetUserId}`,
    details: {
      targetUserId: targetUserId,
      targetUserName: String(payload.targetUserName || ""),
      actorUserId: actorUserId
    }
  });

  return {
    eventId: eventId,
    attendees: eventItem.attendees,
    history: eventItem.history
  };
}


function softDeleteEvent_(eventsSheet, auditSheet, payload) {
  const eventId = requireText_(payload.eventId || payload.id, "缺少 eventId");
  const found = requireEvent_(eventsSheet, eventId);
  const eventItem = found.event;
  assertDeletePermission_(eventItem, payload);

  if (isDeletedEvent_(eventItem)) {
    return { eventId: eventId, deleted: true, alreadyDeleted: true };
  }

  const nowIso = new Date().toISOString();
  eventItem.status = APP_CONFIG.STATUS_DELETED;
  eventItem.deleted = true;
  eventItem.deletedAt = String(payload.deletedAt || nowIso);
  eventItem.deletedBy = String(payload.deletedBy || payload.actorName || "");
  eventItem.deletedByUserId = String(payload.deletedByUserId || payload.actorUserId || "");
  eventItem.updatedAt = nowIso;
  eventItem.history = mergeHistoryEntries_(eventItem.history, getFirstHistoryEntry_(payload.history));
  eventItem.schemaVersion = APP_CONFIG.SCHEMA_VERSION;
  const calendarEventId = syncToGoogleCalendar_(eventItem, "delete");
  if (calendarEventId !== null) eventItem.calendarEventId = calendarEventId;
  writeEvent_(eventsSheet, found.rowNumber, eventItem);

  appendAudit_(auditSheet, payload, {
    eventId: eventId,
    actionType: "delete",
    action: "刪除活動",
    details: {
      deletedAt: eventItem.deletedAt,
      deletedBy: eventItem.deletedBy
    }
  });

  return { eventId: eventId, deleted: true };
}

function getSpreadsheet_() {
  const configuredId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (configuredId) return SpreadsheetApp.openById(configuredId);

  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) return activeSpreadsheet;
  throw new Error("找不到試算表。請從目標 Google Sheet 開啟 Apps Script，或設定 SPREADSHEET_ID。\n");
}

function getRequiredSheet_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error("缺少 " + sheetName + " 工作表，請先執行 setupProject()。\n");
  return sheet;
}

function getOrCreateEventsSheet_(spreadsheet) {
  const existing = spreadsheet.getSheetByName(APP_CONFIG.EVENTS_SHEET);
  if (existing) return existing;

  const sheets = spreadsheet.getSheets();
  const candidate = sheets.find(sheet => {
    if (sheet.getLastColumn() < 1 || sheet.getLastRow() < 1) return false;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    return headers.includes("id") && headers.includes("title");
  });
  if (candidate) {
    candidate.setName(APP_CONFIG.EVENTS_SHEET);
    return candidate;
  }

  // 全新空白試算表直接沿用預設分頁，避免留下多餘的「工作表1」。
  if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
    sheets[0].setName(APP_CONFIG.EVENTS_SHEET);
    return sheets[0];
  }
  return spreadsheet.insertSheet(APP_CONFIG.EVENTS_SHEET);
}

function ensureHeaders_(sheet, requiredHeaders) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const existingHeaders = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(String)
    : [];
  const headers = existingHeaders.filter(Boolean);
  requiredHeaders.forEach(header => {
    if (!headers.includes(header)) headers.push(header);
  });
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function formatEventsSheet_(sheet) {
  formatHeader_(sheet, EVENT_HEADERS.length, "#06c755");
  const map = getHeaderMap_(sheet);
  setColumnWidthIfPresent_(sheet, map, "id", 180);
  setColumnWidthIfPresent_(sheet, map, "status", 90);
  setColumnWidthIfPresent_(sheet, map, "title", 220);
  setColumnWidthIfPresent_(sheet, map, "datetime", 150);
  setColumnWidthIfPresent_(sheet, map, "isFixedGroup", 100);
  setColumnWidthIfPresent_(sheet, map, "fixedTimeText", 210);
  setColumnWidthIfPresent_(sheet, map, "location", 220);
  setColumnWidthIfPresent_(sheet, map, "hostName", 130);
  setColumnWidthIfPresent_(sheet, map, "fee", 120);
  setColumnWidthIfPresent_(sheet, map, "description", 280);
  setColumnWidthIfPresent_(sheet, map, "calendarEventId", 240);
  setColumnWidthIfPresent_(sheet, map, "updatedAt", 190);
  setColumnWidthIfPresent_(sheet, map, "deletedAt", 190);

  if (map.status) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([APP_CONFIG.STATUS_ACTIVE, APP_CONFIG.STATUS_DELETED], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, map.status, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  }
}

function formatAuditSheet_(sheet) {
  formatHeader_(sheet, AUDIT_HEADERS.length, "#334155");
  const map = getHeaderMap_(sheet);
  setColumnWidthIfPresent_(sheet, map, "mutationId", 210);
  setColumnWidthIfPresent_(sheet, map, "eventId", 180);
  setColumnWidthIfPresent_(sheet, map, "timestamp", 190);
  setColumnWidthIfPresent_(sheet, map, "actorName", 130);
  setColumnWidthIfPresent_(sheet, map, "actionType", 100);
  setColumnWidthIfPresent_(sheet, map, "action", 300);
  setColumnWidthIfPresent_(sheet, map, "details", 300);
}

function formatHeader_(sheet, minimumColumns, color) {
  const columnCount = Math.max(sheet.getLastColumn(), minimumColumns);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columnCount)
    .setBackground(color)
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
}

function setColumnWidthIfPresent_(sheet, map, header, width) {
  if (map[header]) sheet.setColumnWidth(map[header], width);
}

function getHeaderMap_(sheet) {
  if (sheet.getLastColumn() < 1) return {};
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  return headers.reduce((map, header, index) => {
    if (header) map[String(header)] = index + 1;
    return map;
  }, {});
}

function hasRequiredHeaders_(sheet, requiredHeaders) {
  const map = getHeaderMap_(sheet);
  return requiredHeaders.every(header => Boolean(map[header]));
}

function readAllEvents_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return rows
    .map(row => rowToEvent_(headers, row))
    .filter(eventItem => eventItem.id);
}

function rowToEvent_(headers, row) {
  const eventItem = {};
  headers.forEach((header, index) => {
    if (!header) return;
    let value = row[index];
    if (JSON_EVENT_FIELDS.includes(header)) value = parseJsonField_(value, header === "hostUser" ? null : []);
    if (header === "maxAttendees") value = Number(value || 0);
    if (["deleted", "isFixedGroup"].includes(header)) {
      value = value === true || String(value).toLowerCase() === "true";
    }
    if (typeof value === "string" && /^'[=+\-@]/.test(value)) value = value.slice(1);
    eventItem[header] = value;
  });
  if (!eventItem.status) eventItem.status = APP_CONFIG.STATUS_ACTIVE;
  eventItem.deleted = isDeletedEvent_(eventItem);
  eventItem.isFixedGroup = eventItem.isFixedGroup === true;
  // 舊資料相容：固定團曾經把名單拆成固定參與／本週參與兩份，
  // 現在只用單一 attendees。讀取時併回來，之後一律寫入空陣列。
  const legacyFixed = normalizeUsers_(eventItem.fixedAttendees);
  const legacyWeekly = normalizeUsers_(eventItem.weeklyAttendees);
  eventItem.attendees = normalizeUsers_(
    normalizeUsers_(eventItem.attendees).concat(legacyFixed, legacyWeekly)
  );
  eventItem.fixedAttendees = [];
  eventItem.weeklyAttendees = [];
  eventItem.history = Array.isArray(eventItem.history) ? eventItem.history : [];
  return eventItem;
}

function writeEvent_(sheet, rowNumber, eventItem) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const row = headers.map(header => eventFieldToCell_(header, eventItem[header]));
  const targetRow = rowNumber || sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
}

function eventFieldToCell_(header, value) {
  if (JSON_EVENT_FIELDS.includes(header)) return JSON.stringify(value == null ? (header === "hostUser" ? null : []) : value);
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean" || typeof value === "number") return value;
  const text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function findEventById_(sheet, eventId) {
  const map = getHeaderMap_(sheet);
  if (!map.id || sheet.getLastRow() < 2) return null;
  const match = sheet.getRange(2, map.id, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(eventId))
    .matchEntireCell(true)
    .findNext();
  if (!match) return null;

  const rowNumber = match.getRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  return { rowNumber: rowNumber, event: rowToEvent_(headers, row) };
}

function requireEvent_(sheet, eventId) {
  const found = findEventById_(sheet, eventId);
  if (!found) throw new Error("找不到活動：" + eventId);
  return found;
}

function normalizeEvent_(payload, existingEvent) {
  const source = Object.assign({}, existingEvent || {}, payload);
  return {
    id: String(source.id || ""),
    status: String(source.status || APP_CONFIG.STATUS_ACTIVE),
    title: String(source.title || "").trim(),
    datetime: String(source.datetime || ""),
    isFixedGroup: source.isFixedGroup === true || String(source.isFixedGroup).toLowerCase() === "true",
    fixedTimeText: String(source.fixedTimeText || "").trim(),
    location: String(source.location || "待定"),
    hostName: String(source.hostName || (source.hostUser && source.hostUser.displayName) || ""),
    hostUser: normalizeUser_(source.hostUser),
    fee: String(source.fee || "免費"),
    maxAttendees: Math.max(0, Number(source.maxAttendees || 0)),
    description: String(source.description || ""),
    attendees: normalizeUsers_(source.attendees),
    fixedAttendees: [],
    weeklyAttendees: [],
    history: trimEventHistory_(source.history),
    calendarEventId: String(source.calendarEventId || ""),
    createdAt: String(source.createdAt || ""),
    updatedAt: String(source.updatedAt || ""),
    deletedAt: String(source.deletedAt || ""),
    deletedBy: String(source.deletedBy || ""),
    deletedByUserId: String(source.deletedByUserId || ""),
    schemaVersion: APP_CONFIG.SCHEMA_VERSION
  };
}

function normalizeUsers_(users) {
  const list = Array.isArray(users) ? users : parseJsonField_(users, []);
  const unique = {};
  list.forEach(user => {
    const normalized = normalizeUser_(user);
    if (normalized && normalized.userId) unique[normalized.userId] = normalized;
  });
  return Object.keys(unique).map(userId => unique[userId]);
}

function normalizeUser_(user) {
  if (!user || typeof user !== "object") return null;
  const userId = String(user.userId || "").trim();
  if (!userId) return null;
  return {
    userId: userId,
    displayName: String(user.displayName || "未命名成員"),
    pictureUrl: String(user.pictureUrl || "")
  };
}

/**
 * 活動列的 history 只保留最近 MAX_EVENT_HISTORY 筆（新的在前）。
 * 沒有這道上限，長期固定團的單一列會無上限成長，
 * 而它永遠不會過期、也就永遠不會被歸檔移走。
 * 完整紀錄仍保存在 AuditLog。
 */
function trimEventHistory_(history) {
  const list = Array.isArray(history) ? history : parseJsonField_(history, []);
  return list.length > APP_CONFIG.MAX_EVENT_HISTORY
    ? list.slice(0, APP_CONFIG.MAX_EVENT_HISTORY)
    : list;
}

function mergeHistoryEntries_(history, entry) {
  const list = Array.isArray(history) ? history.slice() : parseJsonField_(history, []);
  if (!entry || !entry.action) return trimEventHistory_(list);
  const entryKey = String(entry.id || "") || [entry.author, entry.time, entry.action].join("|");
  const exists = list.some(item => {
    const itemKey = String(item.id || "") || [item.author, item.time, item.action].join("|");
    return itemKey === entryKey;
  });
  if (!exists) list.unshift(entry);
  return trimEventHistory_(list);
}

function mergeHistoryLists_(currentHistory, incomingHistory) {
  const current = Array.isArray(currentHistory) ? currentHistory : parseJsonField_(currentHistory, []);
  const incoming = Array.isArray(incomingHistory) ? incomingHistory : parseJsonField_(incomingHistory, []);
  return trimEventHistory_(incoming.concat(current).reduce((merged, entry) => {
    if (!entry || !entry.action) return merged;
    const entryKey = String(entry.id || "") || [entry.author, entry.time, entry.action].join("|");
    const exists = merged.some(item => {
      const itemKey = String(item.id || "") || [item.author, item.time, item.action].join("|");
      return itemKey === entryKey;
    });
    if (!exists) merged.push(entry);
    return merged;
  }, []));
}

function getChangedFields_(previousEvent, nextEvent) {
  if (!previousEvent) return ["created"];
  const fields = [
    "title",
    "datetime",
    "fixedTimeText",
    "location",
    "hostName",
    "fee",
    "maxAttendees",
    "description"
  ];
  return fields.filter(field =>
    JSON.stringify(previousEvent[field] == null ? "" : previousEvent[field]) !==
    JSON.stringify(nextEvent[field] == null ? "" : nextEvent[field])
  );
}

function getFirstHistoryEntry_(history) {
  const list = Array.isArray(history) ? history : parseJsonField_(history, []);
  return list.length ? list[0] : null;
}

function getLatestHistoryAction_(eventItem) {
  const entry = getFirstHistoryEntry_(eventItem.history);
  return entry && entry.action ? String(entry.action) : "";
}

function isDeletedEvent_(eventItem) {
  return eventItem && (
    eventItem.deleted === true ||
    String(eventItem.status || "").toLowerCase() === APP_CONFIG.STATUS_DELETED
  );
}

function assertActiveEvent_(eventItem) {
  if (isDeletedEvent_(eventItem)) throw new Error("此活動已刪除，無法再修改。");
}

function getHostUserId_(eventItem) {
  if (eventItem && eventItem.hostUser && eventItem.hostUser.userId) {
    return String(eventItem.hostUser.userId);
  }
  const hostName = String((eventItem && eventItem.hostName) || "");
  const matches = normalizeUsers_((eventItem && eventItem.attendees) || [])
    .filter(user => user.displayName === hostName);
  return matches.length === 1 ? String(matches[0].userId) : "";
}

function assertHostPermission_(eventItem, actorUserId) {
  const hostUserId = getHostUserId_(eventItem);
  if (!actorUserId || !hostUserId || String(actorUserId) !== hostUserId) {
    throw new Error("只有目前主揪可以執行此操作。");
  }
}

function assertDeletePermission_(eventItem, payload) {
  const actorUserId = String(payload.actorUserId || payload.deletedByUserId || "");
  if (verifyAdminPassword_(payload.adminPassword)) return;
  assertHostPermission_(eventItem, actorUserId);
}

function isEventAttendee_(eventItem, actorUserId) {
  const userId = String(actorUserId || "");
  if (!userId) return false;
  return normalizeUsers_((eventItem && eventItem.attendees) || [])
    .some(user => String(user.userId) === userId);
}

/**
 * 編輯活動內容：主揪、管理員，或任何已報名的成員都可以。
 * 報名者共同維護活動細節（改地點、改時間、補說明）是刻意開放的。
 */
function assertEditPermission_(eventItem, payload) {
  const actorUserId = String(payload.actorUserId || "");
  if (verifyAdminPassword_(payload.adminPassword)) return;
  if (actorUserId && String(getHostUserId_(eventItem)) === actorUserId) return;
  if (isEventAttendee_(eventItem, actorUserId)) return;
  throw new Error("只有已報名的成員、主揪或管理員可以編輯活動內容。");
}

/**
 * 交棒主揪只有主揪與管理員可以執行。
 * 不可沿用 assertEditPermission_，否則任何報名者都能把自己設成主揪。
 */
function assertHandoffPermission_(eventItem, payload) {
  const actorUserId = String(payload.actorUserId || "");
  if (verifyAdminPassword_(payload.adminPassword)) return;
  assertHostPermission_(eventItem, actorUserId);
}

function isAdminPasswordConfigured_() {
  const properties = PropertiesService.getScriptProperties();
  return Boolean(
    properties.getProperty(APP_CONFIG.ADMIN_PASSWORD_SALT_PROPERTY) &&
    properties.getProperty(APP_CONFIG.ADMIN_PASSWORD_HASH_PROPERTY)
  );
}

function verifyAdminPassword_(password) {
  const candidate = String(password || "");
  if (!candidate) return false;
  const properties = PropertiesService.getScriptProperties();
  const salt = properties.getProperty(APP_CONFIG.ADMIN_PASSWORD_SALT_PROPERTY) || "";
  const expectedHash = properties.getProperty(APP_CONFIG.ADMIN_PASSWORD_HASH_PROPERTY) || "";
  if (!salt || !expectedHash) return false;
  return constantTimeEquals_(hashAdminPassword_(candidate, salt), expectedHash);
}

function hashAdminPassword_(password, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ":" + String(password),
    Utilities.Charset.UTF_8
  );
  return bytes.map(byte => ((byte + 256) % 256).toString(16).padStart(2, "0")).join("");
}

function constantTimeEquals_(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function appendAudit_(sheet, payload, logData) {
  const timestamp = new Date().toISOString();
  const rowObject = {
    mutationId: String(payload.mutationId || ""),
    logId: "audit_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    eventId: String(logData.eventId || ""),
    timestamp: timestamp,
    actorUserId: String(payload.actorUserId || payload.userId || ""),
    actorName: String(payload.actorName || payload.displayName || ""),
    actionType: String(logData.actionType || "activity"),
    action: String(logData.action || ""),
    details: JSON.stringify(logData.details || {})
  };
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const row = headers.map(header => eventFieldToCell_(header, rowObject[header]));
  sheet.appendRow(row);
}

function hasProcessedMutation_(sheet, mutationId) {
  if (!mutationId || sheet.getLastRow() < 2) return false;
  const map = getHeaderMap_(sheet);
  if (!map.mutationId) return false;
  return Boolean(sheet.getRange(2, map.mutationId, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(mutationId))
    .matchEntireCell(true)
    .findNext());
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error("缺少 POST 資料。");
  const payload = JSON.parse(e.postData.contents);
  if (!payload || typeof payload !== "object") throw new Error("POST 資料格式錯誤。");
  return payload;
}

function parseJsonField_(value, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch (error) { return fallback; }
}

function requireText_(value, message) {
  const text = String(value || "").trim();
  if (!text) throw new Error(message);
  return text;
}

function jsonOutput_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorOutput_(error) {
  console.error(error && error.stack ? error.stack : error);
  return jsonOutput_({
    status: "error",
    message: error && error.message ? error.message : String(error)
  });
}

/**
 * 將活動自動同步到指定 Google 日曆。
 * - 只處理有明確日期時間的一般活動；固定團不登記。
 * - 已過期活動保留原日曆記錄，不再修改。
 * - 只同步活動名稱、時間與地點，不寫入說明或成員資料。
 * - 回傳 null 代表未變更；空字串代表已刪除；其他字串為 Calendar Event ID。
 */
function syncToGoogleCalendar_(eventItem, actionType) {
  const calendarId = getConfiguredCalendarId_();
  if (!calendarId) return null;

  const timeRange = getCalendarTimeRange_(eventItem);
  if (!timeRange) return null;

  // 已過期活動不修改，包含不因網頁刪除而移除歷史日曆記錄。
  if (timeRange.endTime.getTime() < Date.now()) {
    return eventItem.calendarEventId || null;
  }

  try {
    const calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) {
      console.warn("無法存取已設定的 Google 日曆。");
      return null;
    }

    // getEventById 對「已取消／已刪除」的行程仍會回傳物件，
    // 而對取消的行程 setTitle／setTime 不會讓它重新出現在日曆上。
    // 因此必須確認取回的行程是活的，否則要當成不存在、重新建立。
    let calendarEvent = null;
    if (eventItem.calendarEventId) {
      try {
        const candidate = calendar.getEventById(String(eventItem.calendarEventId));
        if (candidate && isCalendarEventLive_(calendar, candidate)) calendarEvent = candidate;
      } catch (ignore) {}
    }

    if (actionType === "delete") {
      if (calendarEvent) calendarEvent.deleteEvent();
      return "";
    }

    const title = `【揪團】${String(eventItem.title || "未命名活動")}`;
    const location = getCalendarLocation_(eventItem.location);

    if (calendarEvent) {
      calendarEvent.setTitle(title);
      calendarEvent.setTime(timeRange.startTime, timeRange.endTime);
      calendarEvent.setLocation(location);
      return calendarEvent.getId();
    }

    const createdEvent = calendar.createEvent(
      title,
      timeRange.startTime,
      timeRange.endTime,
      { location: location }
    );
    return createdEvent ? createdEvent.getId() : null;
  } catch (error) {
    console.warn("Google 日曆同步失敗：" + String(error && error.message ? error.message : error));
    return null;
  }
}

/**
 * 確認行程是否真的還存在於日曆上。
 * getEvents() 只回傳未取消的行程，因此用它反查 ID 是否仍在，
 * 藉此分辨「行程還在」與「行程已被刪除但 ID 仍可取回」。
 */
function isCalendarEventLive_(calendar, calendarEvent) {
  try {
    const eventId = calendarEvent.getId();
    const startTime = calendarEvent.getStartTime();
    if (!eventId || !startTime) return false;
    return calendar
      .getEvents(new Date(startTime.getTime() - 60000), new Date(startTime.getTime() + 60000))
      .some(item => item.getId() === eventId);
  } catch (error) {
    return false;
  }
}

/**
 * 判斷活動是否已「退場」：已刪除，或結束超過緩衝時間。
 * 固定團沒有結束時間，永遠不會退場。
 * 時間無法解析的活動一律保留，避免格式問題造成資料被誤搬。
 */
function isRetiredEvent_(eventItem) {
  if (!eventItem) return false;
  if (isDeletedEvent_(eventItem)) return true;
  if (eventItem.isFixedGroup === true) return false;

  const startTime = parseCalendarStartTime_(eventItem.datetime);
  if (!startTime) return false;
  return startTime.getTime() + APP_CONFIG.EVENT_GRACE_MS < Date.now();
}

/**
 * 將已退場的活動搬到歸檔工作表，並從 Events 移除該列。
 * 由每日觸發器自動執行，也可從選單手動執行。
 * 回傳搬移筆數，不觸碰 UI，以便在觸發器環境下執行。
 */
function archiveRetiredEvents() {
  const lock = LockService.getScriptLock();
  lock.waitLock(APP_CONFIG.LOCK_TIMEOUT_MS);
  try {
    const spreadsheet = getSpreadsheet_();
    const eventsSheet = spreadsheet.getSheetByName(APP_CONFIG.EVENTS_SHEET);
    if (!eventsSheet || eventsSheet.getLastRow() < 2) return { moved: 0, remaining: 0 };

    const headers = eventsSheet.getRange(1, 1, 1, eventsSheet.getLastColumn()).getDisplayValues()[0];
    const rows = eventsSheet.getRange(2, 1, eventsSheet.getLastRow() - 1, headers.length).getValues();

    const retiredRows = [];
    const retiredRowNumbers = [];
    rows.forEach((row, index) => {
      const eventItem = rowToEvent_(headers, row);
      if (!eventItem.id || !isRetiredEvent_(eventItem)) return;
      retiredRows.push(row);
      retiredRowNumbers.push(index + 2);
    });

    if (retiredRows.length === 0) {
      return { moved: 0, remaining: Math.max(eventsSheet.getLastRow() - 1, 0) };
    }

    const archiveSheet = getOrCreateArchiveSheet_(spreadsheet, headers);
    archiveSheet
      .getRange(archiveSheet.getLastRow() + 1, 1, retiredRows.length, headers.length)
      .setValues(retiredRows);

    // 由下往上刪，避免刪除後列號位移。
    retiredRowNumbers.slice().reverse().forEach(rowNumber => eventsSheet.deleteRow(rowNumber));

    SpreadsheetApp.flush();
    return { moved: retiredRows.length, remaining: Math.max(eventsSheet.getLastRow() - 1, 0) };
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateArchiveSheet_(spreadsheet, headers) {
  let sheet = spreadsheet.getSheetByName(APP_CONFIG.ARCHIVE_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(APP_CONFIG.ARCHIVE_SHEET);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    formatHeader_(sheet, headers.length, "#94a3b8");
    return sheet;
  }
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    formatHeader_(sheet, headers.length, "#94a3b8");
  }
  return sheet;
}

/**
 * 建立每日歸檔觸發器，重複執行不會產生多個觸發器。
 */
function installArchiveTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === "archiveRetiredEvents")
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("archiveRetiredEvents")
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();
}

function archiveRetiredEventsFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const result = archiveRetiredEvents();
  ui.alert(
    "歸檔完成",
    "已搬移 " + result.moved + " 筆到「" + APP_CONFIG.ARCHIVE_SHEET + "」。\n" +
    "Events 目前剩下 " + result.remaining + " 筆。\n\n" +
    "搬移對象：已刪除的活動，以及結束超過 2 小時的一般活動。固定團不會被搬移。",
    ui.ButtonSet.OK
  );
}

function shouldSyncCalendarEvent_(eventItem) {
  if (!eventItem || isDeletedEvent_(eventItem) || eventItem.isFixedGroup === true) return false;
  const timeRange = getCalendarTimeRange_(eventItem);
  return Boolean(timeRange && timeRange.endTime.getTime() >= Date.now());
}

function getCalendarTimeRange_(eventItem) {
  if (!eventItem || eventItem.isFixedGroup === true) return null;
  const startTime = parseCalendarStartTime_(eventItem.datetime);
  if (!startTime) return null;
  return {
    startTime: startTime,
    endTime: new Date(startTime.getTime() + 2 * 60 * 60 * 1000)
  };
}

function parseCalendarStartTime_(dateTimeValue) {
  if (dateTimeValue instanceof Date && !isNaN(dateTimeValue.getTime())) {
    return new Date(dateTimeValue.getTime());
  }

  const text = String(dateTimeValue || "").trim();
  if (!text) return null;
  const localMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (localMatch) {
    try {
      const localText = [localMatch[1], localMatch[2], localMatch[3]].join("-") +
        " " + localMatch[4] + ":" + localMatch[5];
      const parsedLocal = Utilities.parseDate(
        localText,
        Session.getScriptTimeZone(),
        "yyyy-MM-dd HH:mm"
      );
      if (!isNaN(parsedLocal.getTime())) return parsedLocal;
    } catch (ignore) {}
  }

  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 取得要寫進日曆「地點」欄的文字。
 * 使用解析後的地點名稱／地址，不附帶原始短網址；
 * 帶著裸網址會讓 Google 日曆無法正確帶出地圖。
 */
function getCalendarLocation_(locationValue) {
  const location = String(locationValue || "待定").trim() || "待定";
  if (!/https?:\/\//i.test(location)) return location;
  const resolved = resolveMapLocation_(location);
  return String(resolved.displayName || resolved.location || location);
}
