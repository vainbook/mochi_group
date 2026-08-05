/**
 * LINE 群組活動布告欄 — Google Apps Script 後端
 *
 * 安裝方式：
 * 1. 從目標 Google Sheet 開啟「擴充功能 → Apps Script」。
 * 2. 將本檔完整貼入 Code.gs。
 * 3. 手動執行 setupProject() 一次並授權。
 * 4. 部署為網頁應用程式：執行身分選「我」，存取權選「所有人」。
 * 5. 將部署網址填入前端 CONFIG.GAS_API_URL。
 */

const APP_CONFIG = Object.freeze({
  EVENTS_SHEET: "Events",
  AUDIT_SHEET: "AuditLog",
  STATUS_ACTIVE: "active",
  STATUS_DELETED: "deleted",
  ADMIN_PASSWORD_HASH_PROPERTY: "ADMIN_PASSWORD_HASH",
  ADMIN_PASSWORD_SALT_PROPERTY: "ADMIN_PASSWORD_SALT",
  LOCK_TIMEOUT_MS: 15000,
  SCHEMA_VERSION: "2"
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
    .addItem("設定管理員密碼", "setAdminPassword")
    .addItem("顯示表格設計", "showSchemaInfo")
    .addToUi();
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

    PropertiesService.getScriptProperties().setProperties({
      SPREADSHEET_ID: spreadsheet.getId(),
      SCHEMA_VERSION: APP_CONFIG.SCHEMA_VERSION
    });
    SpreadsheetApp.flush();
    return {
      status: "success",
      message: "Events 與 AuditLog 已完成初始化。"
    };
  } finally {
    lock.releaseLock();
  }
}

function showSchemaInfo() {
  const message = [
    "Events：保存活動目前狀態，status 為 active 或 deleted。",
    "固定團：isFixedGroup 為 TRUE，固定時間保存在 fixedTimeText。",
    "固定參與與本週參與分別保存在 fixedAttendees 與 weeklyAttendees。",
    "AuditLog：永久保存建立、報名、退出、編輯、交棒與刪除紀錄。",
    "刪除活動不會移除列，只會寫入 deletedAt 與 deletedBy。"
  ].join("\n");
  SpreadsheetApp.getUi().alert(message);
}

function doGet(e) {
  try {
    const eventsSheet = getRequiredSheet_(APP_CONFIG.EVENTS_SHEET);
    const includeDeleted = String((e && e.parameter && e.parameter.includeDeleted) || "") === "1";
    const schemaReady = hasRequiredHeaders_(eventsSheet, EVENT_HEADERS);
    const events = readAllEvents_(eventsSheet)
      .filter(eventItem => includeDeleted || !isDeletedEvent_(eventItem));

    return jsonOutput_({
      status: "success",
      schemaVersion: schemaReady ? APP_CONFIG.SCHEMA_VERSION : "1",
      serverTime: new Date().toISOString(),
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

    const needsFixedGroupSchema = payload.participationType || payload.isFixedGroup === true ||
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
    assertHostPermission_(existingEvent, actorUserId);
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
    normalizedEvent.isFixedGroup = existingEvent.isFixedGroup === true;
    normalizedEvent.fixedAttendees = normalizeUsers_(existingEvent.fixedAttendees);
    normalizedEvent.weeklyAttendees = normalizeUsers_(existingEvent.weeklyAttendees);
    normalizedEvent.attendees = normalizedEvent.isFixedGroup
      ? normalizeUsers_(normalizedEvent.fixedAttendees.concat(normalizedEvent.weeklyAttendees))
      : normalizeUsers_(existingEvent.attendees);
    normalizedEvent.history = mergeHistoryLists_(existingEvent.history, payload.history);

    if (eventAction === "handoff") {
      const newHostUserId = getHostUserId_(normalizedEvent);
      const isRegistered = normalizedEvent.attendees.some(user =>
        String(user.userId) === String(newHostUserId)
      );
      if (!newHostUserId || newHostUserId === getHostUserId_(existingEvent) || !isRegistered) {
        throw new Error("新主揪必須是另一位已報名成員。");
      }
      if (normalizedEvent.isFixedGroup) {
        const newHost = normalizedEvent.attendees.find(user => String(user.userId) === String(newHostUserId));
        normalizedEvent.weeklyAttendees = normalizedEvent.weeklyAttendees.filter(user =>
          String(user.userId) !== String(newHostUserId)
        );
        normalizedEvent.fixedAttendees = normalizeUsers_([newHost].concat(normalizedEvent.fixedAttendees));
        normalizedEvent.attendees = normalizeUsers_(normalizedEvent.fixedAttendees.concat(normalizedEvent.weeklyAttendees));
      }
    } else {
      // 一般編輯不可順便手動改主揪；交棒必須使用 handoff 動作。
      normalizedEvent.hostUser = existingEvent.hostUser;
      normalizedEvent.hostName = existingEvent.hostName;
    }
  } else {
    const creatingHost = normalizeUser_(normalizedEvent.hostUser);
    if (normalizedEvent.isFixedGroup) {
      normalizedEvent.fixedAttendees = normalizeUsers_([creatingHost].concat(normalizedEvent.fixedAttendees || []));
      normalizedEvent.weeklyAttendees = normalizeUsers_(normalizedEvent.weeklyAttendees);
      normalizedEvent.attendees = normalizeUsers_(normalizedEvent.fixedAttendees.concat(normalizedEvent.weeklyAttendees));
      if (!normalizedEvent.fixedTimeText) throw new Error("固定團必須填寫固定時間。");
    } else {
      normalizedEvent.fixedAttendees = [];
      normalizedEvent.weeklyAttendees = [];
      normalizedEvent.attendees = normalizeUsers_([creatingHost].concat(normalizedEvent.attendees || []));
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

  if (eventItem.isFixedGroup === true) {
    return updateFixedGroupRsvp_(eventsSheet, auditSheet, found, payload, userId);
  }

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

function updateFixedGroupRsvp_(eventsSheet, auditSheet, found, payload, userId) {
  const eventItem = found.event;
  const participationType = ["fixed", "weekly"].includes(String(payload.participationType))
    ? String(payload.participationType)
    : "weekly";
  const intent = ["join", "cancel"].includes(String(payload.rsvpAction))
    ? String(payload.rsvpAction)
    : "join";
  const hostUserId = getHostUserId_(eventItem);

  let fixedAttendees = normalizeUsers_(eventItem.fixedAttendees);
  let weeklyAttendees = normalizeUsers_(eventItem.weeklyAttendees);
  const wasInFixed = fixedAttendees.some(user => String(user.userId) === userId);
  const wasInWeekly = weeklyAttendees.some(user => String(user.userId) === userId);
  const wasRegistered = wasInFixed || wasInWeekly;

  if (String(hostUserId) === userId && (intent === "cancel" || participationType === "weekly")) {
    throw new Error("固定團主揪必須維持固定參與；如需退出請先交棒。");
  }

  if (intent === "join" && !wasRegistered) {
    const maxAttendees = Number(eventItem.maxAttendees || 0);
    if (maxAttendees > 0 && eventItem.attendees.length >= maxAttendees) {
      throw new Error("活動人數已滿。");
    }
  }

  const joiningUser = normalizeUser_({
    userId: userId,
    displayName: payload.displayName,
    pictureUrl: payload.pictureUrl
  });

  if (intent === "join") {
    fixedAttendees = fixedAttendees.filter(user => String(user.userId) !== userId);
    weeklyAttendees = weeklyAttendees.filter(user => String(user.userId) !== userId);
    if (participationType === "fixed") fixedAttendees.push(joiningUser);
    else weeklyAttendees.push(joiningUser);
  } else if (participationType === "fixed") {
    fixedAttendees = fixedAttendees.filter(user => String(user.userId) !== userId);
  } else {
    weeklyAttendees = weeklyAttendees.filter(user => String(user.userId) !== userId);
  }

  eventItem.fixedAttendees = normalizeUsers_(fixedAttendees);
  eventItem.weeklyAttendees = normalizeUsers_(weeklyAttendees);
  eventItem.attendees = normalizeUsers_(eventItem.fixedAttendees.concat(eventItem.weeklyAttendees));
  eventItem.history = mergeHistoryEntries_(eventItem.history, payload.historyEntry);
  eventItem.updatedAt = new Date().toISOString();
  eventItem.schemaVersion = APP_CONFIG.SCHEMA_VERSION;
  writeEvent_(eventsSheet, found.rowNumber, eventItem);

  const actionMap = {
    fixed_join: "固定參與活動",
    fixed_cancel: "取消固定參與",
    weekly_join: "本週參與活動",
    weekly_cancel: "取消本週參與"
  };
  const actionKey = participationType + "_" + intent;
  appendAudit_(auditSheet, payload, {
    eventId: eventItem.id,
    actionType: actionKey,
    action: actionMap[actionKey],
    details: {
      attendeeUserId: userId,
      attendeeName: String(payload.displayName || payload.actorName || ""),
      participationType: participationType,
      attendeeCount: eventItem.attendees.length
    }
  });

  return {
    eventId: eventItem.id,
    rsvpAction: intent,
    participationType: participationType,
    attendees: eventItem.attendees,
    fixedAttendees: eventItem.fixedAttendees,
    weeklyAttendees: eventItem.weeklyAttendees,
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
  eventItem.fixedAttendees = normalizeUsers_(eventItem.fixedAttendees);
  eventItem.weeklyAttendees = normalizeUsers_(eventItem.weeklyAttendees);
  if (eventItem.isFixedGroup && eventItem.fixedAttendees.length === 0 && eventItem.weeklyAttendees.length === 0) {
    eventItem.fixedAttendees = normalizeUsers_(eventItem.attendees);
  }
  if (eventItem.isFixedGroup) {
    eventItem.attendees = normalizeUsers_(eventItem.fixedAttendees.concat(eventItem.weeklyAttendees));
  }
  eventItem.attendees = normalizeUsers_(eventItem.attendees);
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
    fixedAttendees: normalizeUsers_(source.fixedAttendees),
    weeklyAttendees: normalizeUsers_(source.weeklyAttendees),
    history: Array.isArray(source.history) ? source.history : [],
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

function mergeHistoryEntries_(history, entry) {
  const list = Array.isArray(history) ? history.slice() : parseJsonField_(history, []);
  if (!entry || !entry.action) return list;
  const entryKey = String(entry.id || "") || [entry.author, entry.time, entry.action].join("|");
  const exists = list.some(item => {
    const itemKey = String(item.id || "") || [item.author, item.time, item.action].join("|");
    return itemKey === entryKey;
  });
  if (!exists) list.unshift(entry);
  return list;
}

function mergeHistoryLists_(currentHistory, incomingHistory) {
  const current = Array.isArray(currentHistory) ? currentHistory : parseJsonField_(currentHistory, []);
  const incoming = Array.isArray(incomingHistory) ? incomingHistory : parseJsonField_(incomingHistory, []);
  return incoming.concat(current).reduce((merged, entry) => {
    if (!entry || !entry.action) return merged;
    const entryKey = String(entry.id || "") || [entry.author, entry.time, entry.action].join("|");
    const exists = merged.some(item => {
      const itemKey = String(item.id || "") || [item.author, item.time, item.action].join("|");
      return itemKey === entryKey;
    });
    if (!exists) merged.push(entry);
    return merged;
  }, []);
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
