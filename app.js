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
        study: parsed.study || {},
        studyItems: parsed.studyItems || [],
        studyItemsMigrated: !!parsed.studyItemsMigrated,
        mandala: { ...emptyMandala(), ...(parsed.mandala || {}) },
      };
    } catch (e) {
      return {
        habits: [],
        completions: {},
        goals: {},
        reflections: {},
        study: {},
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
  {
    const needsMigrationSave = !state.studyItemsMigrated;
    deriveStudyItems(state);
    if (needsMigrationSave) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    }
  }

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
            const loginButton = document.createElement("button");
      loginButton.textContent = "Googleでログイン";
      loginButton.style.cssText =
        "display:block;margin:12px auto;padding:12px 20px;cursor:pointer;";
      document.querySelector(".header").after(loginButton);

      loginButton.onclick = async () => {
        loginButton.disabled = true;
        try {
          const provider = new firebase.auth.GoogleAuthProvider();
          provider.setCustomParameters({ prompt: "select_account" });
          await firebase.auth().signInWithPopup(provider);
        } catch (e) {
          console.error("Google sign-in failed", e);
          alert("ログインできませんでした: " + e.code);
        } finally {
          loginButton.disabled = false;
        }
      };
      firebase.auth().onAuthStateChanged((user) => {
                const needsLogin = !user || user.isAnonymous;
        loginButton.style.display = needsLogin ? "block" : "none";
        if (needsLogin) return;
        if (syncEnabled) return; // already wired up, don't attach a second listener
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
              study: remote.study || {},
              studyItems: remote.studyItems || [],
              studyItemsMigrated: !!remote.studyItemsMigrated,
              mandala: { ...emptyMandala(), ...(remote.mandala || {}) },
            };
            deriveStudyItems(state);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          } else if (firstLoad) {
            // nothing in the cloud yet — seed it with whatever's stored on this device
            dbRef.set(state);
          }
          applyingRemoteUpdate = false;
          firstLoad = false;
          renderActiveTab();
        });
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
  let editingHabitId = null;
  let studyEditorMode = null; // null | "add" | "edit"
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
  function moveHabit(id, direction) {
    const idx = state.habits.findIndex((h) => h.id === id);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= state.habits.length) return;
    const arr = [...state.habits];
    const tmp = arr[idx];
    arr[idx] = arr[newIdx];
    arr[newIdx] = tmp;
    state.habits = arr;
    saveState();
  }
  function renameHabit(id, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    state.habits = state.habits.map((h) => (h.id === id ? { ...h, name: trimmed } : h));
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

  // ---------- study time (24h horizontal bar) ----------
  const STUDY_COLORS = ["#22D3EE", "#E8A33D", "#3FC1AE", "#A78BFA", "#F472B6", "#A3E635", "#FB923C", "#60A5FA"];
  function studyColor(label) {
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
    return STUDY_COLORS[h % STUDY_COLORS.length];
  }
  function timeToMin(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  function studyDuration(it) {
    const s = timeToMin(it.start);
    const e = timeToMin(it.end);
    if (s === null || e === null || s === e) return 0;
    return e > s ? e - s : e + 1440 - s; // end earlier than start = crosses midnight
  }
  function fmtDuration(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}分`;
    return m === 0 ? `${h}時間` : `${h}時間${m}分`;
  }
  function getStudy(dateKey) { return (state.study && state.study[dateKey]) || []; }
  function addStudy(dateKey, label, start, end) {
    const s = timeToMin(start);
    const e = timeToMin(end);
    if (s === null || e === null || s === e) return false;
    if (!state.study) state.study = {};
    state.study[dateKey] = [...getStudy(dateKey), { id: uid(), label: label.trim() || "勉強", start, end }];
    saveState();
    return true;
  }
  function removeStudy(dateKey, id) {
    if (!state.study) state.study = {};
    state.study[dateKey] = getStudy(dateKey).filter((it) => it.id !== id);
    saveState();
  }
  // study items (the pull-down choices). Sessions keep the item's name in `label`.
  function deriveStudyItems(st) {
    if (st.studyItemsMigrated) {
      if (!st.studyItems) st.studyItems = [];
      return;
    }
    // first run with this feature: build the list from labels already used in past sessions
    const seen = {};
    const list = [];
    Object.keys(st.study || {}).forEach((d) => {
      (st.study[d] || []).forEach((it) => {
        if (it && it.label && !seen[it.label]) {
          seen[it.label] = true;
          list.push({ id: uid(), name: it.label });
        }
      });
    });
    st.studyItems = list;
    st.studyItemsMigrated = true;
  }
  function getStudyItems() { return state.studyItems || []; }
  function addStudyItem(name) {
    const n = name.trim();
    if (!n) return { error: "項目名を入力してください" };
    if (getStudyItems().some((it) => it.name === n)) return { error: "同じ名前の項目がすでにあります" };
    const id = uid();
    state.studyItems = [...getStudyItems(), { id, name: n }];
    saveState();
    return { id };
  }
  function renameStudyItem(id, name) {
    const n = name.trim();
    const cur = getStudyItems().find((it) => it.id === id);
    if (!cur) return { error: "項目が見つかりません" };
    if (!n) return { error: "項目名を入力してください" };
    if (n !== cur.name && getStudyItems().some((it) => it.name === n)) return { error: "同じ名前の項目がすでにあります" };
    const old = cur.name;
    state.studyItems = getStudyItems().map((it) => (it.id === id ? { ...it, name: n } : it));
    if (n !== old) {
      // keep past records attached to the renamed item
      Object.keys(state.study || {}).forEach((d) => {
        state.study[d] = getStudy(d).map((x) => (x.label === old ? { ...x, label: n } : x));
      });
    }
    saveState();
    return { id };
  }
  function removeStudyItem(id) {
    state.studyItems = getStudyItems().filter((it) => it.id !== id);
    saveState();
  }

  function renderStudy() {
    const today = todayStr();
    const items = [...getStudy(viewDate)].sort((a, b) => (timeToMin(a.start) || 0) - (timeToMin(b.start) || 0));
    document.getElementById("study-section-label").textContent =
      viewDate === today ? "今日の学習時間" : `${dispDate(viewDate)}の学習時間`;

    // one horizontal bar = 24 hours (0:00 at the left edge)
    let total = 0;
    let segs = "";
    items.forEach((it) => {
      const s = timeToMin(it.start);
      const e = timeToMin(it.end);
      const dur = studyDuration(it);
      if (!dur) return;
      total += dur;
      const color = studyColor(it.label);
      const ranges = e > s ? [[s, e]] : [[s, 1440]].concat(e > 0 ? [[0, e]] : []);
      const tip = `${escapeHtml(it.label)} ${it.start}〜${it.end}（${fmtDuration(dur)}）`;
      ranges.forEach((r) => {
        const left = r[0] / 14.4;
        const width = Math.max((r[1] - r[0]) / 14.4, 0.7);
        segs += `<div class="study-bar-seg" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;background:${color}" title="${tip}"></div>`;
      });
    });
    const axis = [0, 6, 12, 18, 24]
      .map((h) => `<span class="study-axis-lbl${h === 0 ? " first" : h === 24 ? " last" : ""}" style="left:${(h / 24) * 100}%">${h}</span>`)
      .join("");
    document.getElementById("study-chart").innerHTML =
      `<div class="study-total"><span>合計</span><b>${total ? fmtDuration(total) : "未記録"}</b></div>` +
      `<div class="study-bar"><i class="study-bar-grid" style="left:25%"></i><i class="study-bar-grid" style="left:50%"></i><i class="study-bar-grid" style="left:75%"></i>${segs}</div>` +
      `<div class="study-axis">${axis}</div>`;

    // per-label totals
    const byLabel = {};
    items.forEach((it) => {
      const d = studyDuration(it);
      if (d) byLabel[it.label] = (byLabel[it.label] || 0) + d;
    });
    document.getElementById("study-chips").innerHTML = Object.keys(byLabel)
      .sort((a, b) => byLabel[b] - byLabel[a])
      .map((label) => `<span class="study-chip"><i style="background:${studyColor(label)}"></i>${escapeHtml(label)} <b>${fmtDuration(byLabel[label])}</b></span>`)
      .join("");

    // session list
    const listEl = document.getElementById("study-list");
    if (items.length === 0) {
      listEl.innerHTML = `<div class="empty-state">勉強した時間帯を追加すると、バーに色が付きます。</div>`;
    } else {
      listEl.innerHTML = items.map((it) => `
        <div class="study-row">
          <i class="study-dot" style="background:${studyColor(it.label)}"></i>
          <span class="study-row-label">${escapeHtml(it.label)}</span>
          <span class="study-row-time">${it.start}〜${it.end}</span>
          <span class="study-row-dur">${fmtDuration(studyDuration(it))}</span>
          <button class="icon-delete" data-study-remove="${it.id}" aria-label="削除">${xIconSvg()}</button>
        </div>`).join("");
    }
    document.querySelectorAll("[data-study-remove]").forEach((btn) => {
      btn.onclick = () => { removeStudy(viewDate, btn.dataset.studyRemove); renderStudy(); };
    });

    // item pull-down (keeps the current choice across re-renders)
    const sel = document.getElementById("study-item-select");
    const prev = sel.value;
    const itemList = getStudyItems();
    sel.innerHTML = `<option value="">${itemList.length ? "項目を選択" : "＋で項目を追加"}</option>` +
      itemList.map((it) => `<option value="${escapeHtml(it.id)}">${escapeHtml(it.name)}</option>`).join("");
    if (prev && itemList.some((it) => it.id === prev)) sel.value = prev;
    document.getElementById("study-item-editor").style.display = studyEditorMode ? "flex" : "none";
  }

  function autoGrow(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
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
      listEl.innerHTML = state.habits.map((h, idx) => {
        const done = (state.completions[viewDate] || []).includes(h.id);
        const streak = streakFor(h.id);
        const isFirst = idx === 0;
        const isLast = idx === state.habits.length - 1;
        const isEditing = editingHabitId === h.id;
        const nameHtml = isEditing
          ? `<input type="text" class="habit-name-input" data-habit-edit-input="${h.id}" value="${escapeHtml(h.name)}" />`
          : `<span class="habit-name ${done ? "done-text" : ""}">${escapeHtml(h.name)}</span>`;
        return `
          <div class="habit-row ${done ? "done" : ""}">
            <div class="reorder-col">
              <button class="reorder-btn" data-move-up="${h.id}" ${isFirst ? "disabled" : ""}>${chevronUpSvg()}</button>
              <button class="reorder-btn" data-move-down="${h.id}" ${isLast ? "disabled" : ""}>${chevronDownSvg()}</button>
            </div>
            <button class="check-btn ${done ? "checked" : ""}" data-habit-toggle="${h.id}">
              ${done ? checkIconSvg() : ""}
            </button>
            ${nameHtml}
            ${streak > 0 && viewDate === today ? `<span class="streak-badge">${flameIconSvg()} ${streak}</span>` : ""}
            ${isEditing ? "" : `<button class="icon-edit" data-habit-edit="${h.id}" aria-label="名前を編集">${pencilIconSvg()}</button>`}
            <button class="icon-delete" data-habit-remove="${h.id}">${trashIconSvg()}</button>
          </div>`;
      }).join("");
    }

    // today's goal
    const goalData = getGoalFor(viewDate);
    document.getElementById("today-goal-label").textContent = viewDate === today ? "今日の目標" : `${dispDate(viewDate)}の目標`;
    const goalTextEl = document.getElementById("today-goal-text");
    goalTextEl.value = goalData.goal;
    autoGrow(goalTextEl);

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
    const reflectionEl = document.getElementById("reflection-text");
    reflectionEl.value = getReflection(viewDate);
    autoGrow(reflectionEl);

    renderStudy();
    attachTodayListeners();
  }

  function attachTodayListeners() {
    document.querySelectorAll("[data-habit-toggle]").forEach((btn) => {
      btn.onclick = () => { toggleHabit(btn.dataset.habitToggle, viewDate); renderToday(); };
    });
    document.querySelectorAll("[data-habit-remove]").forEach((btn) => {
      btn.onclick = () => { removeHabit(btn.dataset.habitRemove); renderToday(); };
    });
    document.querySelectorAll("[data-move-up]").forEach((btn) => {
      btn.onclick = () => { moveHabit(btn.dataset.moveUp, -1); renderToday(); };
    });
    document.querySelectorAll("[data-move-down]").forEach((btn) => {
      btn.onclick = () => { moveHabit(btn.dataset.moveDown, 1); renderToday(); };
    });
    document.querySelectorAll("[data-habit-edit]").forEach((btn) => {
      btn.onclick = () => { editingHabitId = btn.dataset.habitEdit; renderToday(); };
    });
    document.querySelectorAll("[data-habit-edit-input]").forEach((input) => {
      input.focus();
      input.select();
      const commit = () => {
        renameHabit(input.dataset.habitEditInput, input.value);
        editingHabitId = null;
        renderToday();
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { editingHabitId = null; renderToday(); }
      });
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
    const goalTextEl2 = document.getElementById("goal-text");
    goalTextEl2.value = goalData.goal;
    autoGrow(goalTextEl2);

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
    const mEditorText = document.getElementById("m-editor-text");
    mEditorText.value = getCellValue(selectedCell);
    autoGrow(mEditorText);

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
  function pencilIconSvg() {
    return `<svg class="icon" viewBox="0 0 24 24" style="width:13px;height:13px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
  }
  function chevronUpSvg() {
    return `<svg class="icon" viewBox="0 0 24 24" style="width:11px;height:11px"><polyline points="18 15 12 9 6 15"/></svg>`;
  }
  function chevronDownSvg() {
    return `<svg class="icon" viewBox="0 0 24 24" style="width:11px;height:11px"><polyline points="6 9 12 15 18 9"/></svg>`;
  }
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
      `${todayStr()}  ${pad(now.getHours())}:${pad(now.getMinutes())}`;
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
      autoGrow(e.target);
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

    // 学習時間
    const hourOpts = '<option value="">時</option>' +
      Array.from({ length: 24 }, (_, i) => `<option value="${pad(i)}">${pad(i)}</option>`).join("");
    const minOpts = Array.from({ length: 12 }, (_, i) => `<option value="${pad(i * 5)}">${pad(i * 5)}</option>`).join("");
    ["study-start-h", "study-end-h"].forEach((id) => { document.getElementById(id).innerHTML = hourOpts; });
    ["study-start-m", "study-end-m"].forEach((id) => { document.getElementById(id).innerHTML = minOpts; });
    const itemSel = document.getElementById("study-item-select");
    const itemNameInput = document.getElementById("study-item-name");
    const studyMsg = document.getElementById("study-msg");
    const selectedItem = () => getStudyItems().find((it) => it.id === itemSel.value);

    const openItemEditor = (mode) => {
      studyMsg.textContent = "";
      if (mode === "edit") {
        const cur = selectedItem();
        if (!cur) { studyMsg.textContent = "名前を変える項目を選んでください"; return; }
        itemNameInput.value = cur.name;
      } else {
        itemNameInput.value = "";
      }
      studyEditorMode = mode;
      renderStudy();
      itemNameInput.focus();
    };
    const closeItemEditor = () => {
      studyEditorMode = null;
      itemNameInput.value = "";
      renderStudy();
    };
    const saveItemEditor = () => {
      const res = studyEditorMode === "edit"
        ? renameStudyItem(itemSel.value, itemNameInput.value)
        : addStudyItem(itemNameInput.value);
      if (res.error) { studyMsg.textContent = res.error; return; }
      studyMsg.textContent = "";
      studyEditorMode = null;
      itemNameInput.value = "";
      renderStudy();
      itemSel.value = res.id;
    };
    document.getElementById("study-item-add").addEventListener("click", () => openItemEditor("add"));
    document.getElementById("study-item-edit").addEventListener("click", () => openItemEditor("edit"));
    document.getElementById("study-item-save").addEventListener("click", saveItemEditor);
    document.getElementById("study-item-cancel").addEventListener("click", closeItemEditor);
    itemNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); saveItemEditor(); }
      if (e.key === "Escape") closeItemEditor();
    });
    document.getElementById("study-item-del").addEventListener("click", () => {
      const cur = selectedItem();
      if (!cur) { studyMsg.textContent = "削除する項目を選んでください"; return; }
      if (!window.confirm(`「${cur.name}」を消しますか？\n（これまでの学習記録は残ります）`)) return;
      removeStudyItem(cur.id);
      studyMsg.textContent = "";
      studyEditorMode = null;
      renderStudy();
    });

    const readStudyTime = (prefix) => {
      const h = document.getElementById(`study-${prefix}-h`).value;
      const m = document.getElementById(`study-${prefix}-m`).value;
      return h === "" ? "" : `${h}:${m}`;
    };
    document.getElementById("add-study-btn").addEventListener("click", () => {
      const cur = selectedItem();
      if (!cur) {
        studyMsg.textContent = getStudyItems().length ? "項目を選んでください" : "まず「＋」で項目を追加してください";
        return;
      }
      if (!addStudy(viewDate, cur.name, readStudyTime("start"), readStudyTime("end"))) {
        studyMsg.textContent = "開始と終了の時刻を選んでください（同じ時刻にはできません）";
        return;
      }
      studyMsg.textContent = "";
      ["study-start-h", "study-end-h"].forEach((id) => { document.getElementById(id).value = ""; });
      ["study-start-m", "study-end-m"].forEach((id) => { document.getElementById(id).value = "00"; });
      renderStudy();
    });

    document.getElementById("reflection-text").addEventListener("input", (e) => {
      setReflection(viewDate, e.target.value);
      autoGrow(e.target);
    });

    // 明日の目標 tab inputs
    document.getElementById("goal-text").addEventListener("input", (e) => {
      setGoalTextFor(addDays(viewDate, 1), e.target.value);
      autoGrow(e.target);
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
      autoGrow(e.target);
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
