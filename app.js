(function () {
  "use strict";

  // ---------- date helpers ----------
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmt(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function todayStr() { return fmt(new Date()); }
  function addDays(str, n) {
    const d = new Date(str + "T00:00:00");
    d.setDate(d.getDate() + n);
    return fmt(d);
  }
  function weekdayJP(str) {
    const d = new Date(str + "T00:00:00");
    return ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  }
  function dispDate(str) {
    const [, m, day] = str.split("-");
    return `${m}/${day}`;
  }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ---------- storage ----------
  const STORAGE_KEY = "my-habiiiiiit-data-v1";

  function emptyMandala() {
    return {
      main: "",
      subs: Array(8).fill(""),
      actions: Array.from({ length: 8 }, () => Array(8).fill("")),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) throw new Error("no data");
      const parsed = JSON.parse(raw);
      return {
        habits: parsed.habits || [],
        completions: parsed.completions || {},
        goals: parsed.goals || {},
        reflections: parsed.reflections || {},
        mandala: { ...emptyMandala(), ...(parsed.mandala || {}) },
      };
    } catch (e) {
      return {
        habits: [],
        completions: {},
        goals: {},
        reflections: {},
        mandala: emptyMandala(),
      };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("save failed", e);
    }
    pushToCloud();
  }

  let state = loadState();

  // ---------- optional cloud sync (Firebase Realtime Database) ----------
  // Fill these in with your own free Firebase project's config to sync data
  // between iPhone and Mac. Leave apiKey as-is to keep using local-only storage
  // (each device keeps its own separate data, no sync).
  const firebaseConfig = {
    apiKey: "AIzaSyDm8nEtRnHX3SUobS2w_3k4PmMwFQLYAmI",
    authDomain: "my-habiiiiiiiiiit.firebaseapp.com",
    databaseURL: "https://my-habiiiiiiiiiit-default-rtdb.firebaseio.com",
    projectId: "my-habiiiiiiiiiit",
  };
  const SYNC_PATH = "my-habiiiiiit-data";

  let syncEnabled = false;
  let dbRef = null;
  let syncTimer = null;
  let applyingRemoteUpdate = false;
  let localEditCooldownUntil = 0;

  function pushToCloud() {
    localEditCooldownUntil = Date.now() + 2000; // ignore incoming echoes for 2s after a local edit
    if (!syncEnabled || applyingRemoteUpdate) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      dbRef.set(state).catch((e) => console.error("cloud sync failed", e));
    }, 400);
  }

  function initSync() {
    if (typeof firebase === "undefined" || firebaseConfig.apiKey === "YOUR_API_KEY_HERE") return;
    try {
      firebase.initializeApp(firebaseConfig);
      dbRef = firebase.database().ref(SYNC_PATH);
      syncEnabled = true;
      let firstLoad = true;
      dbRef.on("value", (snapshot) => {
        // a local edit is still in flight (or just landed) — don't let this snapshot
        // (which may be stale relative to what the user just typed) stomp on it
        if (!firstLoad && Date.now() < localEditCooldownUntil) return;
        const remote = snapshot.val();
        applyingRemoteUpdate = true;
        if (remote) {
          state = {
            habits: remote.habits || [],
            completions: remote.completions || {},
            goals: remote.goals || {},
            reflections: remote.reflections || {},
            mandala: { ...emptyMandala(), ...(remote.mandala || {}) },
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } else if (firstLoad) {
          // nothing in the cloud yet — seed it with whatever's stored on this device
          dbRef.set(state);
        }
        applyingRemoteUpdate = false;
        firstLoad = false;
        renderActiveTab();
      });
    } catch (e) {
      console.error("Firebase sync init failed", e);
    }
  }

  // ---------- in-memory UI state ----------
  let currentTab = "today";
  let viewDate = todayStr();
  let lastToday = todayStr();
  let selectedCell = { type: "main" };
  const now0 = new Date();
  let calYear = now0.getFullYear();
  let calMonth = now0.getMonth(); // 0-indexed

  const ORDER8 = [0, 1, 2, 3, 5, 6, 7, 8];

  // ---------- goal helpers (works for any date key) ----------
  function getGoalFor(dateKey) {
    const g = state.goals[dateKey];
    return { goal: (g && g.goal) || "", actions: (g && g.actions) || [] };
  }
  function setGoalTextFor(dateKey, text) {
    const current = getGoalFor(dateKey);
    state.goals[dateKey] = { ...current, goal: text };
    saveState();
  }
  function addActionFor(dateKey, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const current = getGoalFor(dateKey);
    const actions = [...current.actions, { id: uid(), text: trimmed, done: false }];
    state.goals[dateKey] = { ...current, actions };
    saveState();
  }
  function toggleActionFor(dateKey, id) {
    const current = getGoalFor(dateKey);
    const actions = current.actions.map((a) => (a.id === id ? { ...a, done: !a.done } : a));
    state.goals[dateKey] = { ...current, actions };
    saveState();
  }
  function removeActionFor(dateKey, id) {
    const current = getGoalFor(dateKey);
    const actions = current.actions.filter((a) => a.id !== id);
    state.goals[dateKey] = { ...current, actions };
    saveState();
  }

  // ---------- habit helpers ----------
  function addHabit(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    state.habits.push({ id: uid(), name: trimmed, createdAt: todayStr() });
    saveState();
  }
  function removeHabit(id) {
    state.habits = state.habits.filter((h) => h.id !== id);
    saveState();
  }
  function toggleHabit(id, dateKey) {
    const list = state.completions[dateKey] ? [...state.completions[dateKey]] : [];
    const idx = list.indexOf(id);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(id);
    state.completions[dateKey] = list;
    saveState();
  }
  function streakFor(habitId) {
    const today = todayStr();
    let streak = 0;
    let checkDate = today;
    if (!(state.completions[today] || []).includes(habitId)) {
      checkDate = addDays(today, -1);
    }
    while ((state.completions[checkDate] || []).includes(habitId)) {
      streak += 1;
      checkDate = addDays(checkDate, -1);
    }
    return streak;
  }

  // ---------- reflection ----------
  function getReflection(dateKey) { return state.reflections[dateKey] || ""; }
  function setReflection(dateKey, text) {
    state.reflections[dateKey] = text;
    saveState();
  }

  // ---------- rate / percentage ----------
  function rateFor(dateKey) {
    const habitTotal = state.habits.length;
    const habitDone = (state.completions[dateKey] || []).filter((id) =>
      state.habits.some((h) => h.id === id)
    ).length;
    const dayActions = (state.goals[dateKey] && state.goals[dateKey].actions) || [];
    const actionTotal = dayActions.length;
    const actionDone = dayActions.filter((a) => a.done).length;
    const total = habitTotal + actionTotal;
    if (total === 0) return 0;
    return (habitDone + actionDone) / total;
  }
  function hasTrackableItemsFor(dateKey) {
    const dayActions = (state.goals[dateKey] && state.goals[dateKey].actions) || [];
    return state.habits.length > 0 || dayActions.length > 0;
  }

  // ---------- navigation ----------
  function goToDate(dateKey) {
    viewDate = dateKey;
    setTab("today");
  }
  function setTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panel !== tab);
    });
    renderActiveTab();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- render: 目標 (today) tab ----------
  function renderToday() {
    const today = todayStr();

    // date banner
    const bannerEl = document.getElementById("date-banner-container");
    if (viewDate !== today) {
      bannerEl.innerHTML = `
        <div class="date-banner">
          <span>${dispDate(viewDate)}（${weekdayJP(viewDate)}）の記録を表示中</span>
          <button class="date-banner-btn" id="back-to-today-btn">今日に戻る</button>
        </div>`;
      document.getElementById("back-to-today-btn").onclick = () => { viewDate = today; renderToday(); };
    } else {
      bannerEl.innerHTML = "";
    }

    // habit list
    const listEl = document.getElementById("habit-list");
    if (state.habits.length === 0) {
      listEl.innerHTML = `<div class="empty-state">まだ習慣が登録されていません。下から追加してください。</div>`;
    } else {
      listEl.innerHTML = state.habits.map((h) => {
        const done = (state.completions[viewDate] || []).includes(h.id);
        const streak = streakFor(h.id);
        return `
          <div class="habit-row ${done ? "done" : ""}">
            <button class="check-btn ${done ? "checked" : ""}" data-habit-toggle="${h.id}">
              ${done ? checkIconSvg() : ""}
            </button>
            <span class="habit-name ${done ? "done-text" : ""}">${escapeHtml(h.name)}</span>
            ${streak > 0 && viewDate === today ? `<span class="streak-badge">${flameIconSvg()} ${streak}</span>` : ""}
            <button class="icon-delete" data-habit-remove="${h.id}">${trashIconSvg()}</button>
          </div>`;
      }).join("");
    }

    // today's goal
    const goalData = getGoalFor(viewDate);
    document.getElementById("today-goal-label").textContent = viewDate === today ? "今日の目標" : `${dispDate(viewDate)}の目標`;
    const goalTextEl = document.getElementById("today-goal-text");
    goalTextEl.value = goalData.goal;

    const actionsEl = document.getElementById("today-goal-actions");
    if (goalData.actions.length === 0) {
      actionsEl.innerHTML = `<div class="empty-state">目標を達成するための具体的な行動を追加しましょう。</div>`;
    } else {
      actionsEl.innerHTML = goalData.actions.map((a) => `
        <div class="action-row">
          <button class="check-btn ${a.done ? "checked" : ""}" data-today-action-toggle="${a.id}">
            ${a.done ? checkIconSvg() : ""}
          </button>
          <span class="${a.done ? "done" : ""}">${escapeHtml(a.text)}</span>
          <button class="icon-delete" data-today-action-remove="${a.id}">${xIconSvg()}</button>
        </div>`).join("");
    }

    // reflection
    document.getElementById("reflection-label").textContent = viewDate === today ? "今日の反省" : `${dispDate(viewDate)}の反省`;
    document.getElementById("reflection-text").value = getReflection(viewDate);

    attachTodayListeners();
  }

  function attachTodayListeners() {
    document.querySelectorAll("[data-habit-toggle]").forEach((btn) => {
      btn.onclick = () => { toggleHabit(btn.dataset.habitToggle, viewDate); renderToday(); };
    });
    document.querySelectorAll("[data-habit-remove]").forEach((btn) => {
      btn.onclick = () => { removeHabit(btn.dataset.habitRemove); renderToday(); };
    });
    document.querySelectorAll("[data-today-action-toggle]").forEach((btn) => {
      btn.onclick = () => { toggleActionFor(viewDate, btn.dataset.todayActionToggle); renderToday(); };
    });
    document.querySelectorAll("[data-today-action-remove]").forEach((btn) => {
      btn.onclick = () => { removeActionFor(viewDate, btn.dataset.todayActionRemove); renderToday(); };
    });
  }

  // ---------- render: 明日の目標 tab ----------
  function renderGoalTab() {
    const today = todayStr();
    const nextDate = addDays(viewDate, 1);

    const hintEl = document.getElementById("goal-hint-container");
    if (viewDate !== today) {
      hintEl.innerHTML = `<div class="mandala-hint">現在「目標」タブで${dispDate(viewDate)}（${weekdayJP(viewDate)}）を表示中のため、その翌日（${dispDate(nextDate)}）分の目標欄です。</div>`;
    } else {
      hintEl.innerHTML = "";
    }

    document.getElementById("goal-tab-label").textContent = `${dispDate(nextDate)}（${weekdayJP(nextDate)}）の目標`;

    const goalData = getGoalFor(nextDate);
    document.getElementById("goal-text").value = goalData.goal;

    const actionsEl = document.getElementById("goal-actions");
    if (goalData.actions.length === 0) {
      actionsEl.innerHTML = `<div class="empty-state">目標を達成するための具体的な行動を追加しましょう。</div>`;
    } else {
      actionsEl.innerHTML = goalData.actions.map((a) => `
        <div class="action-row">
          <button class="check-btn ${a.done ? "checked" : ""}" data-goal-action-toggle="${a.id}">
            ${a.done ? checkIconSvg() : ""}
          </button>
          <span class="${a.done ? "done" : ""}">${escapeHtml(a.text)}</span>
          <button class="icon-delete" data-goal-action-remove="${a.id}">${xIconSvg()}</button>
        </div>`).join("");
    }

    document.getElementById("preview-next-day-label").textContent = `${dispDate(nextDate)}の「目標」タブをプレビュー`;

    document.querySelectorAll("[data-goal-action-toggle]").forEach((btn) => {
      btn.onclick = () => { toggleActionFor(nextDate, btn.dataset.goalActionToggle); renderGoalTab(); };
    });
    document.querySelectorAll("[data-goal-action-remove]").forEach((btn) => {
      btn.onclick = () => { removeActionFor(nextDate, btn.dataset.goalActionRemove); renderGoalTab(); };
    });
  }

  // ---------- render: マンダラ tab ----------
  function getCellValue(cell) {
    if (cell.type === "main") return state.mandala.main;
    if (cell.type === "sub") return state.mandala.subs[cell.index];
    if (cell.type === "action") return state.mandala.actions[cell.subIndex][cell.actionIndex];
    return "";
  }
  function setCellValue(cell, value) {
    if (cell.type === "main") state.mandala.main = value;
    else if (cell.type === "sub") state.mandala.subs[cell.index] = value;
    else if (cell.type === "action") state.mandala.actions[cell.subIndex][cell.actionIndex] = value;
    saveState();
  }
  function cellLabel(cell) {
    if (cell.type === "main") return "中心目標";
    if (cell.type === "sub") return `サブ目標 ${cell.index + 1}`;
    return `サブ目標 ${cell.subIndex + 1} の行動 ${cell.actionIndex + 1}`;
  }
  function isSameCell(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === "sub") return a.index === b.index;
    if (a.type === "action") return a.subIndex === b.subIndex && a.actionIndex === b.actionIndex;
    return true;
  }
  function cellKey(cell) {
    if (cell.type === "main") return "main";
    if (cell.type === "sub") return `sub-${cell.index}`;
    return `action-${cell.subIndex}-${cell.actionIndex}`;
  }

  function renderMiniBlock(centerCell, surroundCells, variant) {
    let html = `<div class="m-block ${variant === "main" ? "main" : ""}">`;
    for (let pos = 0; pos < 9; pos++) {
      const isCenter = pos === 4;
      const cell = isCenter ? centerCell : surroundCells[ORDER8.indexOf(pos)];
      const value = getCellValue(cell);
      const selected = isSameCell(cell, selectedCell);
      const centerClass = isCenter ? (variant === "main" ? "center-main" : "center-sub") : "";
      html += `
        <button class="m-cell ${centerClass} ${selected ? "selected" : ""}" data-cell-key="${cellKey(cell)}" title="${escapeHtml(value || cellLabel(cell))}">
          <span class="m-cell-text">${escapeHtml(value || (isCenter ? "…" : "+"))}</span>
        </button>`;
    }
    html += `</div>`;
    return html;
  }

  // build a lookup so click handlers can find the actual cell object by key
  const mandalaCellRegistry = {};
  function registerCell(cell) {
    mandalaCellRegistry[cellKey(cell)] = cell;
    return cell;
  }

  function renderMandala() {
    let html = "";
    for (let outerPos = 0; outerPos < 9; outerPos++) {
      if (outerPos === 4) {
        const centerCell = registerCell({ type: "main" });
        const subs = Array.from({ length: 8 }, (_, i) => registerCell({ type: "sub", index: i }));
        html += renderMiniBlock(centerCell, subs, "main");
      } else {
        const subIndex = ORDER8.indexOf(outerPos);
        const centerCell = registerCell({ type: "sub", index: subIndex });
        const actions = Array.from({ length: 8 }, (_, i) => registerCell({ type: "action", subIndex, actionIndex: i }));
        html += renderMiniBlock(centerCell, actions, "sub");
      }
    }
    document.getElementById("mandala-grid").innerHTML = html;

    document.getElementById("m-editor-label").textContent = cellLabel(selectedCell);
    document.getElementById("m-editor-text").value = getCellValue(selectedCell);

    document.querySelectorAll("[data-cell-key]").forEach((btn) => {
      btn.onclick = () => {
        selectedCell = mandalaCellRegistry[btn.dataset.cellKey];
        renderMandala();
      };
    });
  }

  // ---------- render: 記録 tab (calendar) ----------
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  function renderHistory() {
    const today = todayStr();
    document.getElementById("cal-month-label").textContent = `${calYear}年${calMonth + 1}月`;

    const firstWeekday = new Date(calYear, calMonth, 1).getDay(); // 0 = Sun
    const totalDays = daysInMonth(calYear, calMonth);
    const prevMonthDays = daysInMonth(calYear, calMonth === 0 ? 11 : calMonth - 1);

    const cells = [];
    for (let i = firstWeekday - 1; i >= 0; i--) {
      cells.push({ day: prevMonthDays - i, outside: true });
    }
    for (let d = 1; d <= totalDays; d++) {
      cells.push({ day: d, outside: false });
    }
    let nextDay = 1;
    while (cells.length % 7 !== 0) {
      cells.push({ day: nextDay, outside: true });
      nextDay++;
    }

    const gridEl = document.getElementById("cal-grid");
    gridEl.innerHTML = cells.map((c) => {
      if (c.outside) {
        return `<div class="cal-cell outside"><span class="cal-daynum">${c.day}</span></div>`;
      }
      const dateKey = `${calYear}-${pad(calMonth + 1)}-${pad(c.day)}`;
      const isToday = dateKey === today;
      const rate = rateFor(dateKey);
      const hasItems = hasTrackableItemsFor(dateKey);
      const dayGoal = state.goals[dateKey];
      const dotColor = (dayGoal && dayGoal.goal) ? "var(--teal)" : "transparent";
      const pctText = hasItems ? `${Math.round(rate * 100)}%` : "";
      const pctColor = rate === 1 ? "var(--teal)" : "var(--amber)";
      return `
        <button class="cal-cell ${isToday ? "today" : ""}" data-goto-date="${dateKey}">
          <span class="cal-dot" style="background:${dotColor}"></span>
          <span class="cal-daynum">${c.day}</span>
          <span class="cal-pct" style="color:${hasItems ? pctColor : "var(--text-dim)"}">${pctText}</span>
        </button>`;
    }).join("");

    document.querySelectorAll("[data-goto-date]").forEach((btn) => {
      btn.onclick = () => goToDate(btn.dataset.gotoDate);
    });
  }

  // ---------- icons (inline svg strings, stroke uses currentColor) ----------
  function checkIconSvg() {
    return `<svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px;stroke-width:3"><polyline points="20 6 9 17 4 12"/></svg>`;
  }
  function xIconSvg() {
    return `<svg class="icon" viewBox="0 0 24 24" style="width:13px;height:13px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  }
  function trashIconSvg() {
    return `<svg class="icon" viewBox="0 0 24 24" style="width:13px;height:13px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
  }
  function flameIconSvg() {
    return `<svg class="icon" viewBox="0 0 24 24" style="width:11px;height:11px;fill:currentColor;stroke:none"><path d="M12 2s-6 6-6 12a6 6 0 0 0 12 0c0-3-2-4-2-4s0 3-2 3-1-3-1-5-1-6-1-6z"/></svg>`;
  }
  function goalSetIconSvg() {
    return `<svg class="icon goal-flag" viewBox="0 0 24 24" style="color:var(--teal)"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`;
  }
  function goalUnsetIconSvg() {
    return `<svg class="icon goal-flag" viewBox="0 0 24 24" style="color:var(--border-light)"><circle cx="12" cy="12" r="10"/></svg>`;
  }

  // ---------- render dispatcher ----------
  function renderActiveTab() {
    if (currentTab === "today") renderToday();
    else if (currentTab === "goal") renderGoalTab();
    else if (currentTab === "mandala") renderMandala();
    else if (currentTab === "history") renderHistory();
  }

  // ---------- clock + midnight rollover ----------
  function updateClock() {
    const now = new Date();
    document.getElementById("timecode").textContent =
      `${todayStr()}  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const nowStr = todayStr();
    if (nowStr !== lastToday) {
      if (viewDate === lastToday) viewDate = nowStr;
      lastToday = nowStr;
      renderActiveTab();
    }
  }

  // ---------- static listeners (attached once) ----------
  function attachStaticListeners() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.tab === "today") viewDate = todayStr();
        setTab(btn.dataset.tab);
      });
    });

    document.getElementById("cal-prev-btn").addEventListener("click", () => {
      calMonth -= 1;
      if (calMonth < 0) { calMonth = 11; calYear -= 1; }
      renderHistory();
    });
    document.getElementById("cal-next-btn").addEventListener("click", () => {
      calMonth += 1;
      if (calMonth > 11) { calMonth = 0; calYear += 1; }
      renderHistory();
    });
    document.getElementById("cal-today-btn").addEventListener("click", () => {
      const n = new Date();
      calYear = n.getFullYear();
      calMonth = n.getMonth();
      renderHistory();
    });

    // 目標 tab inputs
    const newHabitInput = document.getElementById("new-habit-input");
    document.getElementById("add-habit-btn").addEventListener("click", () => {
      addHabit(newHabitInput.value);
      newHabitInput.value = "";
      renderToday();
    });
    newHabitInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        addHabit(newHabitInput.value);
        newHabitInput.value = "";
        renderToday();
      }
    });

    document.getElementById("today-goal-text").addEventListener("input", (e) => {
      setGoalTextFor(viewDate, e.target.value);
    });
    const newTodayActionInput = document.getElementById("new-today-action-input");
    document.getElementById("add-today-action-btn").addEventListener("click", () => {
      addActionFor(viewDate, newTodayActionInput.value);
      newTodayActionInput.value = "";
      renderToday();
    });
    newTodayActionInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        addActionFor(viewDate, newTodayActionInput.value);
        newTodayActionInput.value = "";
        renderToday();
      }
    });

    document.getElementById("reflection-text").addEventListener("input", (e) => {
      setReflection(viewDate, e.target.value);
    });

    // 明日の目標 tab inputs
    document.getElementById("goal-text").addEventListener("input", (e) => {
      setGoalTextFor(addDays(viewDate, 1), e.target.value);
    });
    const newGoalActionInput = document.getElementById("new-goal-action-input");
    document.getElementById("add-goal-action-btn").addEventListener("click", () => {
      addActionFor(addDays(viewDate, 1), newGoalActionInput.value);
      newGoalActionInput.value = "";
      renderGoalTab();
    });
    newGoalActionInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        addActionFor(addDays(viewDate, 1), newGoalActionInput.value);
        newGoalActionInput.value = "";
        renderGoalTab();
      }
    });
    document.getElementById("preview-next-day-btn").addEventListener("click", () => {
      goToDate(addDays(viewDate, 1));
    });

    // マンダラ tab editor
    document.getElementById("m-editor-text").addEventListener("input", (e) => {
      setCellValue(selectedCell, e.target.value);
      // update just the grid cell text + preview title without full re-render (keeps focus in textarea)
      const key = cellKey(selectedCell);
      const btn = document.querySelector(`[data-cell-key="${key}"]`);
      if (btn) {
        const span = btn.querySelector(".m-cell-text");
        const val = e.target.value;
        span.textContent = val || (selectedCell.type === "main" ? "…" : "+");
        btn.title = val || cellLabel(selectedCell);
      }
    });
  }

  // ---------- init ----------
  function init() {
    attachStaticListeners();
    setTab("today");
    updateClock();
    setInterval(updateClock, 1000);
    initSync();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
