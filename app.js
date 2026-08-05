/* ==========================================================================
   NATIVE LINE CHAT UI EVENT BULLETIN BOARD (CORE LOGIC)
   ========================================================================== */

// --- 1. CONFIG & STATE ---
const CONFIG = {
  LIFF_ID: "YOUR_LIFF_ID_HERE",
  STORAGE_KEY: "line_events_v6",
  NOTICE_STORAGE_KEY: "line_top_notice_v1"
};

// DEV Mock Profiles
const DEV_PROFILES = [
  { userId: "dev_01", displayName: "小明", pictureUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=XiaoMing" },
  { userId: "dev_02", displayName: "阿傑", pictureUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=AhJie" },
  { userId: "dev_03", displayName: "小美", pictureUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=NeonGirl" },
  { userId: "dev_04", displayName: "老王", pictureUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=HackerSam" }
];

let currentUser = DEV_PROFILES[0];
let eventsData = [];
let noticeData = {
  currentContent: "📌 歡迎使用群組活動布告欄！最新注意事項與群組規則將在此公開提醒。",
  lastAuthor: "小明",
  lastTime: getFormattedNow(),
  history: [
    { author: "小明", time: getFormattedNow(), content: "📌 歡迎使用群組活動布告欄！最新注意事項與群組規則將在此公開提醒。" }
  ]
};

let currentFilter = "open"; // 預設顯示「報名中」
let activeEventId = null;

// --- 2. INITIALIZATION ---
document.addEventListener("DOMContentLoaded", async () => {
  loadEvents();
  loadNotice();
  setupEventListeners();
  renderDevProfiles();
  await initLIFF();
  renderNoticeBoard();
  renderEvents();
});

// --- 3. LIFF AUTH & USER SETUP ---
async function initLIFF() {
  const statusEl = document.getElementById("liff-status");
  
  if (CONFIG.LIFF_ID && CONFIG.LIFF_ID !== "YOUR_LIFF_ID_HERE" && typeof liff !== "undefined") {
    try {
      await liff.init({ liffId: CONFIG.LIFF_ID });
      if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        currentUser = {
          userId: profile.userId,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl || "https://api.dicebear.com/7.x/pixel-art/svg?seed=Default"
        };
        statusEl.innerText = "[LIFF: OK]";
        statusEl.style.color = "var(--line-green)";
      } else {
        liff.login();
      }
    } catch (err) {
      console.warn("LIFF init failed, using DEV mode:", err);
      statusEl.innerText = "[DEV MODE]";
      statusEl.style.color = "#64748b";
    }
  } else {
    statusEl.innerText = "[DEV MODE]";
    statusEl.style.color = "#64748b";
  }
  
  updateUserUI();
}

function updateUserUI() {
  document.getElementById("current-name").innerText = currentUser.displayName;
}

// --- 4. DATA PERSISTENCE (NOTICE & EVENTS) ---
function loadNotice() {
  const stored = localStorage.getItem(CONFIG.NOTICE_STORAGE_KEY);
  if (stored) {
    try {
      noticeData = JSON.parse(stored);
    } catch (e) {
      console.error("Failed to parse notice", e);
    }
  }
}

function saveNotice() {
  localStorage.setItem(CONFIG.NOTICE_STORAGE_KEY, JSON.stringify(noticeData));
}

function renderNoticeBoard() {
  document.getElementById("notice-text-content").innerText = noticeData.currentContent || "目前尚無公告。";
  document.getElementById("notice-author-info").innerText = `由 ${noticeData.lastAuthor || '管理員'} 發布`;
  document.getElementById("notice-time-info").innerText = noticeData.lastTime || "--";
}

function loadEvents() {
  const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
  if (stored) {
    try {
      eventsData = JSON.parse(stored);
      return;
    } catch (e) {
      console.error("Failed to parse events", e);
    }
  }

  // Initial Seed Data with History Logs
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const pastDay = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  eventsData = [
    {
      id: "evt_1",
      title: "週末羽球夜戰",
      datetime: formatDateForInput(tomorrow, "19:30"),
      location: "https://maps.google.com/?q=台北市立羽球館",
      fee: "$200 / 人",
      maxAttendees: 8,
      description: "請自備球拍與運動鞋，程度不限！集合後直接分組打歡樂場。",
      hostName: "小明",
      hostUser: DEV_PROFILES[0],
      createdAt: new Date().toISOString(),
      attendees: [DEV_PROFILES[0], DEV_PROFILES[1], DEV_PROFILES[2]],
      history: [
        { author: "小明", time: getFormattedNow(), action: "創立了此活動" }
      ]
    },
    {
      id: "evt_2",
      title: "懷舊電玩酒吧聚會",
      datetime: formatDateForInput(nextWeek, "20:00"),
      location: "Continue Gaming Bar (西門町)",
      fee: "$350 (含一杯飲品)",
      maxAttendees: 6,
      description: "切磋快打旋風與瑪利歐賽車，暢聊 retro 遊戲經驗！",
      hostName: "阿傑",
      hostUser: DEV_PROFILES[1],
      createdAt: new Date().toISOString(),
      attendees: [DEV_PROFILES[1], DEV_PROFILES[3]],
      history: [
        { author: "阿傑", time: getFormattedNow(), action: "創立了此活動" }
      ]
    },
    {
      id: "evt_3",
      title: "上週桌遊團 (已過期範例)",
      datetime: formatDateForInput(pastDay, "14:00"),
      location: "瘋桌遊 (松江店)",
      fee: "$150",
      maxAttendees: 6,
      description: "體驗阿瓦隆與璀璨寶石！",
      hostName: "小美",
      hostUser: DEV_PROFILES[2],
      createdAt: new Date().toISOString(),
      attendees: [DEV_PROFILES[2], DEV_PROFILES[0]],
      history: [
        { author: "小美", time: getFormattedNow(), action: "創立了此活動" }
      ]
    }
  ];

  saveEvents();
}

function saveEvents() {
  localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(eventsData));
}

function formatDateForInput(dateObj, timeStr) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${timeStr}`;
}

function getFormattedNow() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${month}/${date} ${hour}:${min}`;
}

// --- 5. LOCATION URL AUTO-LINK FORMATTER ---
function formatLocationHtml(locationStr) {
  if (!locationStr) return "未指定";
  
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  if (urlRegex.test(locationStr)) {
    return locationStr.replace(urlRegex, function(url) {
      return `<a href="${url}" target="_blank" class="location-link" onclick="event.stopPropagation();">📍 點擊開啟地圖連結</a>`;
    });
  }
  
  return escapeHtml(locationStr);
}

// --- 6. RENDER EVENTS & CARDS ---
function renderEvents() {
  const listEl = document.getElementById("event-list");
  listEl.innerHTML = "";

  const exportBtn = document.getElementById("btn-export-ended");
  if (currentFilter === "ended") {
    exportBtn.style.display = "block";
  } else {
    exportBtn.style.display = "none";
  }

  // 依時間由近到遠 (Nearest First)
  const sortedEvents = [...eventsData].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  
  // Filter logic
  const filteredEvents = sortedEvents.filter(evt => {
    const isEnded = new Date(evt.datetime) < new Date();
    const isFull = evt.maxAttendees > 0 && evt.attendees.length >= evt.maxAttendees;

    if (currentFilter === "open") {
      return !isEnded && !isFull;
    }
    if (currentFilter === "ended") {
      return isEnded;
    }
    if (currentFilter === "my") {
      return evt.attendees.some(u => u.userId === currentUser.userId);
    }
    return true; // "all"
  });

  if (filteredEvents.length === 0) {
    listEl.innerHTML = `
      <div style="background:#ffffff; border-radius:16px; padding:30px; text-align:center; color:#64748b; box-shadow:0 4px 14px rgba(0,0,0,0.08);">
        <p style="font-size:16px; font-weight:bold;">💬 目前沒有相關活動記錄</p>
      </div>
    `;
    return;
  }

  filteredEvents.forEach(evt => {
    const isEnded = new Date(evt.datetime) < new Date();
    const isFull = evt.maxAttendees > 0 && evt.attendees.length >= evt.maxAttendees;
    const isAttending = evt.attendees.some(u => u.userId === currentUser.userId);
    
    let tagClass = "tag-open";
    let tagText = "報名中";
    
    if (isEnded) {
      tagClass = "tag-ended";
      tagText = "已過期";
    } else if (isFull) {
      tagClass = "tag-full";
      tagText = "已額滿";
    }

    const formattedTime = new Date(evt.datetime).toLocaleString("zh-TW", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", weekday: "short"
    });

    const cardEl = document.createElement("div");
    cardEl.className = `event-card ${isEnded ? 'ended' : ''}`;

    let rsvpBtnHtml = "";
    if (isEnded) {
      rsvpBtnHtml = `<button class="line-btn" style="background:#e2e8f0; color:#94a3b8;" disabled>已過期</button>`;
    } else if (isAttending) {
      rsvpBtnHtml = `<button class="line-btn btn-cancel" onclick="toggleRSVP('${evt.id}')">💔 取消參加</button>`;
    } else if (isFull) {
      rsvpBtnHtml = `<button class="line-btn" style="background:#e2e8f0; color:#94a3b8;" disabled>已額滿</button>`;
    } else {
      rsvpBtnHtml = `<button class="line-btn btn-join" onclick="toggleRSVP('${evt.id}')">⚡ 參加</button>`;
    }

    const gcalUrl = generateGoogleCalendarUrl(evt);
    const locationHtml = formatLocationHtml(evt.location);

    cardEl.innerHTML = `
      <div class="card-header">
        <div class="card-title">${escapeHtml(evt.title)}</div>
        <div class="tag-badge ${tagClass}">${tagText}</div>
      </div>
      
      <div class="card-info">
        <div class="info-row"><span class="info-label">⏰ 時間：</span><span>${formattedTime}</span></div>
        <div class="info-row"><span class="info-label">📍 地點：</span><span>${locationHtml}</span></div>
        <div class="info-row"><span class="info-label">💰 費用：</span><span>${escapeHtml(evt.fee || "免費")}</span></div>
        <div class="info-row"><span class="info-label">👑 主揪：</span><span>${escapeHtml(evt.hostName || evt.hostUser?.displayName || "無")}</span></div>
        <div class="info-row">
          <span class="info-label">👥 人數：</span>
          <span style="color:var(--line-green-dark); font-weight:bold;">${evt.attendees.length}${evt.maxAttendees > 0 ? '/' + evt.maxAttendees : ''} 人</span>
        </div>
      </div>

      <div class="card-actions">
        ${rsvpBtnHtml}
        <button class="line-btn btn-detail" onclick="openDetailModal('${evt.id}')">📖 查看詳情</button>
        <a class="line-btn btn-calendar" href="${gcalUrl}" target="_blank">📅 加到行事曆</a>
      </div>
    `;

    listEl.appendChild(cardEl);
  });
}

// --- 7. NOTICE BOARD HANDLERS ---
document.getElementById("form-edit-notice").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = document.getElementById("input-notice-text").value.trim();
  if (!text) return;

  const nowStr = getFormattedNow();
  noticeData.currentContent = text;
  noticeData.lastAuthor = currentUser.displayName;
  noticeData.lastTime = nowStr;

  noticeData.history = noticeData.history || [];
  noticeData.history.unshift({
    author: currentUser.displayName,
    time: nowStr,
    content: text
  });

  saveNotice();
  renderNoticeBoard();
  closeModal("modal-edit-notice");

  // Auto Copy Notice to share in group
  const noticeShareText = `📌【群組最新重要公告】📌\n----------------------------------\n${text}\n----------------------------------\n由 ${currentUser.displayName} 發布於 ${nowStr}`;
  navigator.clipboard.writeText(noticeShareText).catch(err => console.warn(err));

  document.getElementById("alert-copied-text").innerText = noticeShareText;
  openModal("modal-copy-alert");

  document.getElementById("btn-line-share").onclick = () => {
    const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(noticeShareText)}`;
    window.open(lineShareUrl, "_blank");
  };
});

// --- 8. BROADCAST ALL OPEN EVENTS ---
function broadcastOpenEvents() {
  const openEvents = eventsData
    .filter(evt => {
      const isEnded = new Date(evt.datetime) < new Date();
      const isFull = evt.maxAttendees > 0 && evt.attendees.length >= evt.maxAttendees;
      return !isEnded && !isFull;
    })
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

  if (openEvents.length === 0) {
    alert("目前沒有開放報名中的活動可宣傳！");
    return;
  }

  const pageUrl = window.location.href;

  const eventBlocks = openEvents.map((evt, idx) => {
    const formattedTime = new Date(evt.datetime).toLocaleString("zh-TW", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", weekday: "short"
    });
    const capacityStr = `${evt.attendees.length}${evt.maxAttendees > 0 ? '/' + evt.maxAttendees : ''} 人`;
    
    return `${idx + 1}️⃣【${evt.title}】
⏰ 時間：${formattedTime}
📍 地點：${evt.location}
👥 目前人數：${capacityStr} (🔥熱烈報名中)`;
  }).join("\n\n");

  const broadcastText = 
`📢【群組熱門活動總通報】📢
小夥伴們！以下是目前開放報名中的活動，歡迎點擊連結線上報名唷👇

=============================
${eventBlocks}
=============================

👉 點此線上報名 / 檢視即時名冊：
${pageUrl}`;

  navigator.clipboard.writeText(broadcastText).then(() => {
    console.log("Broadcast copied!");
  }).catch(err => console.warn(err));

  document.getElementById("alert-copied-text").innerText = broadcastText;
  openModal("modal-copy-alert");

  document.getElementById("btn-line-share").onclick = () => {
    const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(broadcastText)}`;
    window.open(lineShareUrl, "_blank");
  };
}

// --- 9. EXPORT ENDED EVENTS FUNCTION ---
function exportEndedEvents() {
  const endedEvents = eventsData
    .filter(evt => new Date(evt.datetime) < new Date())
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

  if (endedEvents.length === 0) {
    alert("目前沒有已過期的活動！");
    return;
  }

  const exportLines = endedEvents.map(evt => {
    const dt = new Date(evt.datetime);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `[${yyyy}-${mm}-${dd}] ${evt.title} (${evt.location})`;
  });

  const exportText = `📋【已過期活動歷史紀錄】\n=============================\n` + exportLines.join("\n");

  navigator.clipboard.writeText(exportText).then(() => {
    document.getElementById("alert-copied-text").innerText = exportText;
    openModal("modal-copy-alert");
  }).catch(err => {
    alert("匯出內容：\n\n" + exportText);
  });
}

// --- 10. RSVP TOGGLE & COPIED NOTIFICATION ---
function toggleRSVP(eventId) {
  const evt = eventsData.find(e => e.id === eventId);
  if (!evt) return;

  const isEnded = new Date(evt.datetime) < new Date();
  if (isEnded) return;

  const existingIdx = evt.attendees.findIndex(u => u.userId === currentUser.userId);
  let actionText = "";

  if (existingIdx >= 0) {
    evt.attendees.splice(existingIdx, 1);
    actionText = "已取消參加";
    evt.history = evt.history || [];
    evt.history.unshift({ author: currentUser.displayName, time: getFormattedNow(), action: "取消了參加報名" });
  } else {
    if (evt.maxAttendees > 0 && evt.attendees.length >= evt.maxAttendees) {
      alert("此活動人數已額滿！");
      return;
    }
    evt.attendees.push(currentUser);
    actionText = "已成功報名參加";
    evt.history = evt.history || [];
    evt.history.unshift({ author: currentUser.displayName, time: getFormattedNow(), action: "報名參加了活動" });
  }

  saveEvents();
  renderEvents();

  triggerAutoCopyAndAlert(evt, actionText);
}

// --- 11. AUTO-COPY SINGLE EVENT TRIGGER ---
function triggerAutoCopyAndAlert(evt, actionHeadline) {
  const formattedTime = new Date(evt.datetime).toLocaleString("zh-TW", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", weekday: "short"
  });

  const pageUrl = window.location.href;
  const attendeeNames = evt.attendees.map(u => u.displayName).join(", ");
  
  const textToCopy = 
`💬【群組活動通報：${evt.title}】 (${actionHeadline})
----------------------------------
⏰ 時間：${formattedTime}
📍 地點：${evt.location}
💰 費用：${evt.fee}
👑 主揪：${evt.hostName || evt.hostUser?.displayName || '無'}
👥 已報名名冊：${attendeeNames || '尚無'} (${evt.attendees.length}${evt.maxAttendees > 0 ? '/' + evt.maxAttendees : ''}人)

👉 點此線上報名：
${pageUrl}`;

  navigator.clipboard.writeText(textToCopy).catch(err => console.warn(err));

  document.getElementById("alert-copied-text").innerText = textToCopy;
  openModal("modal-copy-alert");

  document.getElementById("btn-line-share").onclick = () => {
    const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(textToCopy)}`;
    window.open(lineShareUrl, "_blank");
  };
}

// --- 12. EVENT CREATION ---
document.getElementById("form-create-event").addEventListener("submit", (e) => {
  e.preventDefault();

  const customHostName = document.getElementById("input-host-name").value.trim();

  const newEvent = {
    id: "evt_" + Date.now(),
    title: document.getElementById("input-title").value.trim(),
    datetime: document.getElementById("input-datetime").value,
    location: document.getElementById("input-location").value.trim(),
    fee: document.getElementById("input-fee").value.trim() || "免費",
    maxAttendees: parseInt(document.getElementById("input-max").value) || 0,
    description: document.getElementById("input-desc").value.trim(),
    hostName: customHostName || currentUser.displayName,
    hostUser: currentUser,
    createdAt: new Date().toISOString(),
    attendees: [currentUser],
    history: [
      { author: currentUser.displayName, time: getFormattedNow(), action: "創立了此活動" }
    ]
  };

  eventsData.push(newEvent);
  saveEvents();
  renderEvents();
  closeModal("modal-create");
  document.getElementById("form-create-event").reset();

  triggerAutoCopyAndAlert(newEvent, "創立新活動！");
});

// --- 13. GOOGLE CALENDAR GENERATOR ---
function generateGoogleCalendarUrl(evt) {
  const startDt = new Date(evt.datetime);
  const endDt = new Date(startDt.getTime() + 2 * 60 * 60 * 1000);

  const formatGCalDate = (dt) => {
    return dt.toISOString().replace(/-|:|\.\d\d\d/g, "");
  };

  const title = encodeURIComponent(`[活動] ${evt.title}`);
  const details = encodeURIComponent(`主揪: ${evt.hostName || evt.hostUser?.displayName}\n費用: ${evt.fee}\n說明: ${evt.description}`);
  const location = encodeURIComponent(evt.location);
  const dates = `${formatGCalDate(startDt)}/${formatGCalDate(endDt)}`;

  return `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=${location}`;
}

// --- 14. EDIT EVENT SUBMISSION LOGIC ---
document.getElementById("form-edit-event").addEventListener("submit", (e) => {
  e.preventDefault();
  
  if (!activeEventId) return;
  const evt = eventsData.find(e => e.id === activeEventId);
  if (!evt) return;

  const newTitle = document.getElementById("edit-title").value.trim();
  const newDatetime = document.getElementById("edit-datetime").value;
  const newLocation = document.getElementById("edit-location").value.trim();
  const newHostName = document.getElementById("edit-host-name").value.trim();
  const newFee = document.getElementById("edit-fee").value.trim() || "免費";
  const newMax = parseInt(document.getElementById("edit-max").value) || 0;
  const newDesc = document.getElementById("edit-desc").value.trim();

  let changes = [];
  if (evt.title !== newTitle) changes.push(`名稱(${newTitle})`);
  if (evt.datetime !== newDatetime) changes.push("時間");
  if (evt.location !== newLocation) changes.push("地點");
  if (evt.hostName !== newHostName) changes.push(`主揪(${newHostName})`);
  if (evt.fee !== newFee) changes.push("費用");
  if (evt.maxAttendees !== newMax) changes.push("人數");
  if (evt.description !== newDesc) changes.push("補充說明");

  if (changes.length === 0) {
    closeModal("modal-edit");
    return;
  }

  evt.title = newTitle;
  evt.datetime = newDatetime;
  evt.location = newLocation;
  evt.hostName = newHostName;
  evt.fee = newFee;
  evt.maxAttendees = newMax;
  evt.description = newDesc;

  evt.history = evt.history || [];
  evt.history.unshift({
    author: currentUser.displayName,
    time: getFormattedNow(),
    action: `更新了：${changes.join("、")}`
  });

  saveEvents();
  renderEvents();
  closeModal("modal-edit");

  openDetailModal(evt.id);

  triggerAutoCopyAndAlert(evt, "編輯更新了活動內容！");
});

// --- 15. DETAIL MODAL & @MENTION & EDIT / DELETE ---
function openDetailModal(eventId) {
  activeEventId = eventId;
  const evt = eventsData.find(e => e.id === eventId);
  if (!evt) return;

  const formattedTime = new Date(evt.datetime).toLocaleString("zh-TW", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", weekday: "short"
  });

  document.getElementById("detail-title").innerText = `📖 ${evt.title}`;
  document.getElementById("detail-time").innerText = formattedTime;
  document.getElementById("detail-location").innerHTML = formatLocationHtml(evt.location);
  document.getElementById("detail-fee").innerText = evt.fee || "免費";
  
  document.getElementById("detail-host-input").value = evt.hostName || evt.hostUser?.displayName || "";
  document.getElementById("detail-desc").innerText = evt.description || "尚無補充說明。";
  document.getElementById("detail-capacity-text").innerText = 
    `${evt.attendees.length}${evt.maxAttendees > 0 ? '/' + evt.maxAttendees : ''}`;

  const attendeesEl = document.getElementById("detail-attendees");
  if (evt.attendees.length === 0) {
    attendeesEl.innerHTML = `<span style="color:#64748b;">目前尚無成員報名</span>`;
  } else {
    attendeesEl.innerHTML = evt.attendees.map(u => `
      <div class="attendee-pill" style="padding:4px 10px 4px 6px;">
        <img src="${u.pictureUrl || 'https://api.dicebear.com/7.x/pixel-art/svg?seed=' + u.displayName}" alt="Avatar">
        <span>${escapeHtml(u.displayName)}</span>
      </div>
    `).join("");
  }

  const historyEl = document.getElementById("detail-history-list");
  if (!evt.history || evt.history.length === 0) {
    historyEl.innerHTML = `<div style="color:#94a3b8; font-size:12px;">尚無編修紀錄</div>`;
  } else {
    historyEl.innerHTML = evt.history.map(log => `
      <div class="history-item">
        <span class="history-meta">👤 ${escapeHtml(log.author)} (${log.time})</span>：${escapeHtml(log.action)}
      </div>
    `).join("");
  }

  document.getElementById("btn-trigger-edit").onclick = () => {
    closeModal("modal-detail");
    
    document.getElementById("edit-title").value = evt.title;
    document.getElementById("edit-datetime").value = evt.datetime;
    document.getElementById("edit-location").value = evt.location;
    document.getElementById("edit-host-name").value = evt.hostName || "";
    document.getElementById("edit-fee").value = evt.fee || "";
    document.getElementById("edit-max").value = evt.maxAttendees || 0;
    document.getElementById("edit-desc").value = evt.description || "";

    openModal("modal-edit");
  };

  document.getElementById("btn-mention-attendees").onclick = () => {
    if (evt.attendees.length === 0) {
      alert("目前沒有已報名的成員可標記！");
      return;
    }

    const mentionsText = evt.attendees.map(u => `@${u.displayName}`).join(" ");
    const mentionNoticeText = 
`🏷️【活動成員提醒：${evt.title}】🏷️
----------------------------------
⏰ 時間：${formattedTime}
📍 地點：${evt.location}

成員小夥伴看過來👇
${mentionsText}

各位記得準時出席活動唷！`;

    navigator.clipboard.writeText(mentionNoticeText).then(() => {
      document.getElementById("alert-copied-text").innerText = mentionNoticeText;
      openModal("modal-copy-alert");
    }).catch(err => {
      alert("已產生標記文字：\n\n" + mentionNoticeText);
    });
  };

  document.getElementById("btn-save-host").onclick = () => {
    const newHostName = document.getElementById("detail-host-input").value.trim();
    if (newHostName && newHostName !== evt.hostName) {
      evt.hostName = newHostName;
      evt.history = evt.history || [];
      evt.history.unshift({
        author: currentUser.displayName,
        time: getFormattedNow(),
        action: `修改主揪為「${newHostName}」`
      });
      saveEvents();
      renderEvents();
      openDetailModal(evt.id);
      alert("✅ 已更新主揪名稱！");
    }
  };

  document.getElementById("btn-delete-event").onclick = () => {
    if (confirm(`⚠️ 確定要刪除活動「${evt.title}」嗎？此操作不可復原。`)) {
      eventsData = eventsData.filter(e => e.id !== eventId);
      saveEvents();
      renderEvents();
      closeModal("modal-detail");
      alert("已成功刪除活動！");
    }
  };

  openModal("modal-detail");
}

function openModal(id) {
  document.getElementById(id).classList.add("active");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

// --- 16. DEV PROFILES ---
function renderDevProfiles() {
  const container = document.getElementById("dev-profiles-container");
  container.innerHTML = DEV_PROFILES.map(prof => `
    <div class="dev-card ${prof.userId === currentUser.userId ? 'active' : ''}" onclick="switchDevProfile('${prof.userId}')">
      <img src="${prof.pictureUrl}" width="20" height="20" style="border-radius:50%; vertical-align:middle; margin-right:4px;">
      ${escapeHtml(prof.displayName)}
    </div>
  `).join("");
}

function switchDevProfile(userId) {
  const target = DEV_PROFILES.find(p => p.userId === userId);
  if (target) {
    currentUser = target;
    updateUserUI();
    renderDevProfiles();
    renderEvents();
    closeModal("modal-dev-profile");
  }
}

// --- 17. EVENT LISTENERS ---
function setupEventListeners() {
  document.getElementById("fab-add-event").onclick = () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    document.getElementById("input-datetime").value = formatDateForInput(tomorrow, "19:00");
    document.getElementById("input-host-name").value = currentUser.displayName;
    openModal("modal-create");
  };

  document.getElementById("btn-broadcast-all").onclick = () => {
    broadcastOpenEvents();
  };

  document.getElementById("btn-edit-notice").onclick = () => {
    document.getElementById("input-notice-text").value = noticeData.currentContent || "";
    openModal("modal-edit-notice");
  };

  document.getElementById("btn-notice-history").onclick = () => {
    const historyContainer = document.getElementById("notice-history-container");
    if (!noticeData.history || noticeData.history.length === 0) {
      historyContainer.innerHTML = `<div style="color:#94a3b8; font-size:12px;">尚無公告留言紀錄</div>`;
    } else {
      historyContainer.innerHTML = noticeData.history.map(item => `
        <div class="history-item">
          <div class="history-meta">👤 ${escapeHtml(item.author)} (${item.time})</div>
          <div style="margin-top:2px;">${escapeHtml(item.content)}</div>
        </div>
      `).join("");
    }
    openModal("modal-notice-history");
  };

  document.getElementById("btn-dev-toggle").onclick = () => {
    openModal("modal-dev-profile");
  };

  document.getElementById("btn-export-ended").onclick = () => {
    exportEndedEvents();
  };

  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.onclick = () => closeModal(btn.getAttribute("data-close"));
  });

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.getAttribute("data-filter");
      renderEvents();
    };
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}
