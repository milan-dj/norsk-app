/* =========================================================
   NORSK · App Logic
========================================================= */

import { WORDS } from "./words.js";

const STORAGE_KEY = "norsk_app_v4";

const DEFAULTS = {
  cards: {},
  lastStudy: null,
  streak: 0,
  todayReviews: 0,
  todayDate: null,
  dailyNew: 10,
  direction: "no-en",
  autoDirection: true
};

let state = loadState();
let queue = [];
let currentIdx = null;
let isFlipped = false;
let revealedByGiveUp = false;

/* --- STORAGE --- */
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Object.assign({}, DEFAULTS, saved || {}, {
      cards: (saved && saved.cards) || {}
    });
  } catch {
    return { ...DEFAULTS, cards: {} };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* --- DATE HELPERS --- */
function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function checkDayRollover() {
  const today = todayStr();

  if (state.todayDate !== today) {
    if (state.lastStudy) {
      const yesterday = addDays(today, -1);
      if (state.lastStudy !== today && state.lastStudy !== yesterday) {
        state.streak = 0;
      }
    }

    state.todayDate = today;
    state.todayReviews = 0;
    saveState();
  }
}

function updateDateMeta() {
  const el = document.getElementById("dateMeta");
  if (!el) return;

  const d = new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  el.textContent = `${months[d.getMonth()]} ${d.getDate()}`;
}

/* --- CARD STATE --- */
function initCard() {
  return {
    ef: 2.5,
    reps: 0,
    interval: 0,
    due: todayStr(),
    seen: false,
    lapses: 0,
    correctCount: 0,
    wrongCount: 0,
    history: []
  };
}

function getCardState(idx) {
  return state.cards[idx] || initCard();
}

function isKnownCard(c) {
  return c.seen && (c.correctCount || 0) >= 5 && c.interval >= 21;
}

function isLearningCard(c) {
  return c.seen && !isKnownCard(c);
}

/* --- SRS --- */
function gradeCard(idx, rating) {
  const c = state.cards[idx] || initCard();
  const today = todayStr();

  c.seen = true;
  c.history.push({ date: today, rating });

  if (rating === 1) {
    c.reps = 0;
    c.interval = 0;
    c.lapses += 1;
    c.wrongCount += 1;
    c.ef = Math.max(1.3, c.ef - 0.2);
    c.due = today;
  } else {
    c.correctCount += 1;

    if (c.reps === 0) {
      c.interval = rating === 2 ? 1 : rating === 3 ? 2 : 4;
    } else if (c.reps === 1) {
      c.interval = rating === 2 ? 2 : rating === 3 ? 4 : 7;
    } else {
      const mult = rating === 2 ? 1.2 : rating === 3 ? c.ef : c.ef * 1.3;
      c.interval = Math.max(1, Math.round(c.interval * mult));
    }

    c.reps += 1;
    c.ef = Math.max(1.3, c.ef + (rating === 4 ? 0.15 : rating === 3 ? 0.05 : 0));
    c.due = addDays(today, c.interval);
  }

  state.cards[idx] = c;
  state.todayReviews += 1;

  if (state.lastStudy !== today) {
    state.streak += 1;
    state.lastStudy = today;
  }

  saveState();
}

/* --- QUEUE --- */
function getQueue() {
  const today = todayStr();
  const due = [];
  const fresh = [];

  for (let i = 0; i < WORDS.length; i++) {
    const c = state.cards[i];

    if (c && c.seen && c.due <= today) {
      due.push(i);
    } else if (!c || !c.seen) {
      fresh.push(i);
    }
  }

  due.sort((a, b) => {
    const ca = state.cards[a] || initCard();
    const cb = state.cards[b] || initCard();
    return (cb.wrongCount + cb.lapses) - (ca.wrongCount + ca.lapses);
  });

  return [...due, ...fresh.slice(0, state.dailyNew)];
}

/* --- STATS --- */
function getSeenCount() {
  let seen = 0;
  for (let i = 0; i < WORDS.length; i++) {
    const c = state.cards[i];
    if (c && c.seen) seen++;
  }
  return seen;
}

function getKnownCount() {
  let known = 0;
  for (let i = 0; i < WORDS.length; i++) {
    const c = state.cards[i];
    if (c && isKnownCard(c)) known++;
  }
  return known;
}

function getRetentionStats() {
  let correct = 0;
  let wrong = 0;

  Object.values(state.cards).forEach(c => {
    correct += c.correctCount || 0;
    wrong += c.wrongCount || 0;
  });

  const total = correct + wrong;
  const retention = total ? Math.round((correct / total) * 100) : 0;

  return { correct, wrong, retention };
}

function getHardestWords(limit = 5) {
  return WORDS.map((w, i) => {
    const c = getCardState(i);
    return {
      ...w,
      idx: i,
      wrongCount: c.wrongCount || 0,
      lapses: c.lapses || 0
    };
  })
    .filter(w => (w.wrongCount + w.lapses) > 0)
    .sort((a, b) => (b.wrongCount + b.lapses) - (a.wrongCount + a.lapses))
    .slice(0, limit);
}

function refreshStats() {
  const today = todayStr();

  let due = 0;
  let learning = 0;
  let known = 0;

  for (let i = 0; i < WORDS.length; i++) {
    const c = state.cards[i];
    if (!c || !c.seen) continue;

    if (c.due <= today) due++;

    if ((c.correctCount || 0) >= 5 && c.interval >= 21) {
      known++;
    } else {
      learning++;
    }
  }

  const dueEl = document.getElementById("stat-due");
  const learningEl = document.getElementById("stat-learning");
  const knownEl = document.getElementById("stat-known");
  const streakEl = document.getElementById("stat-streak");

  if (dueEl) dueEl.textContent = due;
  if (learningEl) learningEl.textContent = learning;
  if (knownEl) knownEl.textContent = known;
  if (streakEl) streakEl.textContent = state.streak || 0;
}

function renderStatsScreen() {
  const seen = getSeenCount();
  const known = getKnownCount();
  const total = WORDS.length;
  const { retention } = getRetentionStats();
  const hardest = getHardestWords(5);

  const progSeen = document.getElementById("prog-seen");
  const progKnown = document.getElementById("prog-known");
  const progTotal = document.getElementById("prog-total");
  const progToday = document.getElementById("prog-today");
  const progStreak = document.getElementById("prog-streak");
  const progressFill = document.getElementById("progressFill");
  const retentionEl = document.getElementById("retentionPct");
  const hardestEl = document.getElementById("hardestWords");
  const dailyNewEl = document.getElementById("daily-new");

  if (progSeen) progSeen.textContent = seen;
  if (progKnown) progKnown.textContent = known;
  if (progTotal) progTotal.textContent = total;
  if (progToday) progToday.textContent = state.todayReviews || 0;
  if (progStreak) progStreak.textContent = `${state.streak || 0} days`;
  if (retentionEl) retentionEl.textContent = `${retention}%`;
  if (dailyNewEl) dailyNewEl.textContent = state.dailyNew;

  if (progressFill) {
    const pct = total ? Math.round((seen / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
  }

  if (hardestEl) {
    if (hardest.length === 0) {
      hardestEl.innerHTML = `<div class="stat-row"><span>No hard words yet</span><span>—</span></div>`;
    } else {
      hardestEl.innerHTML = hardest.map(w => `
        <div class="stat-row">
          <span>${w.no}</span>
          <span>${w.wrongCount + w.lapses}</span>
        </div>
      `).join("");
    }
  }
}

/* --- ANSWER HELPERS --- */
function normalizeAnswer(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:()]/g, "")
    .replace(/\s+/g, " ");
}

function acceptedAnswers(answer) {
  return answer
    .split("/")
    .map(s => normalizeAnswer(s))
    .filter(Boolean);
}

/* --- TEST MODES --- */
function getDirectionForCard(idx) {
  const c = state.cards[idx] || initCard();

  if (!c.seen) return "no-en";
  return Math.random() < 0.5 ? "no-en" : "en-no";
}

function getCardMode(idx) {
  const modes = ["typing", "multiple", "cloze", "sentence"];
  const c = state.cards[idx] || initCard();

  if (!c.seen) return "typing";
  if ((c.correctCount || 0) < 2) return "multiple";

  return modes[Math.floor(Math.random() * modes.length)];
}

function buildMultipleChoiceOptions(answer, w) {
  const pool = new Set([answer]);

  if (w.confusions) {
    w.confusions.forEach(conf => pool.add(conf));
  }

  while (pool.size < 4) {
    const random = WORDS[Math.floor(Math.random() * WORDS.length)];
    pool.add(random.en);
  }

  return [...pool].sort(() => Math.random() - 0.5);
}

function buildClozeSentence(w) {
  const baseExample = w.example || (w.examples && w.examples[0] && w.examples[0].no) || "";
  return w.cloze_no || baseExample.replace(w.no, "____");
}

/* --- RENDER HELPERS --- */
function renderExamples(w) {
  const examples = w.examples || [{ no: w.example, en: w.example_en }];
  return examples.map(ex => `
    <div class="word-example">${ex.no}</div>
    <div class="word-example-en">${ex.en}</div>
  `).join("");
}

function renderAnswerFeedback(isCorrect, answer, w) {
  const examples = w.examples || [{ no: w.example, en: w.example_en }];
  const first = examples[0] || { no: "", en: "" };

  return `
    <div class="answer-feedback ${isCorrect ? "correct" : "wrong"}">
      <div><strong>${isCorrect ? "Correct" : "Correct answer:"}</strong> ${answer}</div>
      <div class="word-example">${first.no || ""}</div>
      <div class="word-example-en">${first.en || ""}</div>
    </div>
  `;
}

function renderPromptContent(w, prompt, answer, mode) {
  if (mode === "typing") {
    return `
      <input id="input" class="recall-input" placeholder="Type answer..." autocomplete="off" spellcheck="false" />
      <div class="recall-actions">
        <button id="check" class="recall-btn">Check</button>
        <button id="skip" class="recall-btn secondary">I don't know</button>
      </div>
      <div id="feedback" class="answer-feedback"></div>
    `;
  }

  if (mode === "multiple") {
    const options = buildMultipleChoiceOptions(answer, w);
    return `
      <div class="mc-options recall-actions">
        ${options.map(opt => `<button class="mc-btn recall-btn secondary" data-answer="${opt}">${opt}</button>`).join("")}
      </div>
      <div class="recall-actions">
        <button id="skip" class="recall-btn secondary">I don't know</button>
      </div>
      <div id="feedback" class="answer-feedback"></div>
    `;
  }

  if (mode === "cloze") {
    const sentence = buildClozeSentence(w);
    return `
      <div class="cloze-sentence word-example">${sentence}</div>
      <input id="input" class="recall-input" placeholder="Fill the blank..." autocomplete="off" spellcheck="false" />
      <div class="recall-actions">
        <button id="check" class="recall-btn">Check</button>
        <button id="skip" class="recall-btn secondary">I don't know</button>
      </div>
      <div id="feedback" class="answer-feedback"></div>
    `;
  }

  const sentencePrompt = w.example || (w.examples && w.examples[0] && w.examples[0].no) || "";
  return `
    <div class="sentence-question word-example">${sentencePrompt}</div>
    <input id="input" class="recall-input" placeholder="Type the target word..." autocomplete="off" spellcheck="false" />
    <div class="recall-actions">
      <button id="check" class="recall-btn">Check</button>
      <button id="skip" class="recall-btn secondary">I don't know</button>
    </div>
    <div id="feedback" class="answer-feedback"></div>
  `;
}

/* --- BROWSE --- */
function renderBrowseList(filter = "all") {
  const listEl = document.getElementById("wordList");
  const countEl = document.getElementById("browseCount");

  if (!listEl || !countEl) return;

  let items = WORDS.map((w, idx) => {
    const c = getCardState(idx);
    return { ...w, idx, card: c };
  });

  if (filter === "new") {
    items = items.filter(item => !item.card.seen);
  }

  if (filter === "learning") {
    items = items.filter(item => isLearningCard(item.card));
  }

  if (filter === "known") {
    items = items.filter(item => isKnownCard(item.card));
  }

  countEl.textContent = items.length;

  listEl.innerHTML = items.map(item => {
    let dotClass = "";
    if (isKnownCard(item.card)) dotClass = "known";
    else if (isLearningCard(item.card)) dotClass = "learning";

    return `
      <div class="word-item">
        <div>
          <span class="word-item-dot ${dotClass}"></span>
          <span class="word-item-no">${item.no}</span>
        </div>
        <div class="word-item-en">${item.en}</div>
      </div>
    `;
  }).join("");
}

/* --- SCREEN NAVIGATION --- */
function showScreen(screenName) {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.remove("active");
  });

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.remove("active");
  });

  const screenEl = document.getElementById(`screen-${screenName}`);
  const navEl = document.querySelector(`.nav-btn[data-screen="${screenName}"]`);

  if (screenEl) screenEl.classList.add("active");
  if (navEl) navEl.classList.add("active");

  if (screenName === "browse") {
    const activeFilter = document.querySelector(".chip.active")?.dataset.filter || "all";
    renderBrowseList(activeFilter);
  }

  if (screenName === "stats") {
    renderStatsScreen();
  }

  if (screenName === "study") {
    renderCard();
  }
}

/* --- MAIN CARD RENDER --- */
function renderCard() {
  queue = getQueue();

  if (queue.length === 0) {
    document.getElementById("card-container").innerHTML = "<p>Done for today</p>";
    document.getElementById("ratings").classList.remove("visible");
    refreshStats();
    renderStatsScreen();
    return;
  }

  currentIdx = queue[0];
  isFlipped = false;
  revealedByGiveUp = false;

  const w = WORDS[currentIdx];
  const dir = state.autoDirection ? getDirectionForCard(currentIdx) : state.direction;
  const prompt = dir === "no-en" ? w.no : w.en;
  const answer = dir === "no-en" ? w.en : w.no;
  const mode = getCardMode(currentIdx);
  const targetAnswer = mode === "cloze"
    ? (w.cloze_answer || w.no)
    : answer;
  const promptContent = renderPromptContent(w, prompt, answer, mode);

  document.getElementById("card-container").innerHTML = `
    <div class="card-wrap">
      <div class="card" id="card">
        <div class="card-face card-front">
          <div class="card-center">
            <h1>${prompt}</h1>
            ${promptContent}
          </div>
        </div>

        <div class="card-face card-back">
          <div class="card-center">
            <h1>${answer}</h1>
            ${renderExamples(w)}
          </div>
        </div>
      </div>
    </div>
  `;

  const feedback = document.getElementById("feedback");

  if (mode === "typing" || mode === "cloze" || mode === "sentence") {
    const input = document.getElementById("input");
    const checkBtn = document.getElementById("check");
    const skipBtn = document.getElementById("skip");

    if (checkBtn && input) {
      checkBtn.onclick = () => {
        const val = normalizeAnswer(input.value);
        if (!val) return;

        const possible = acceptedAnswers(targetAnswer);
        const correct = possible.includes(val);

        feedback.innerHTML = renderAnswerFeedback(correct, answer, w);
        flipCard();
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          checkBtn.click();
        }
      });

      setTimeout(() => input.focus(), 50);
    }

    if (skipBtn) {
      skipBtn.onclick = () => {
        revealedByGiveUp = true;
        feedback.innerHTML = "";
        flipCard();
      };
    }
  }

  if (mode === "multiple") {
    const skipBtn = document.getElementById("skip");

    document.querySelectorAll(".mc-btn").forEach(btn => {
      btn.onclick = () => {
        const selected = normalizeAnswer(btn.dataset.answer);
        const possible = acceptedAnswers(answer);
        const correct = possible.includes(selected);

        feedback.innerHTML = renderAnswerFeedback(correct, answer, w);
        flipCard();
      };
    });

    if (skipBtn) {
      skipBtn.onclick = () => {
        revealedByGiveUp = true;
        feedback.innerHTML = "";
        flipCard();
      };
    }
  }

  refreshStats();
  renderStatsScreen();
}

/* --- CARD FLIP --- */
function flipCard() {
  document.getElementById("card").classList.add("flipped");
  document.getElementById("ratings").classList.add("visible");
  isFlipped = true;
}

/* --- EVENT WIRING --- */
document.querySelectorAll(".rate-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!isFlipped || currentIdx === null) return;

    let rating = parseInt(btn.dataset.rate, 10);

    if (revealedByGiveUp) rating = 1;

    gradeCard(currentIdx, rating);
    renderCard();
  });
});

document.querySelectorAll(".dir-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".dir-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.direction = btn.dataset.dir;
    saveState();
    renderCard();
  });
});

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    showScreen(btn.dataset.screen);
  });
});

document.querySelectorAll(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    renderBrowseList(chip.dataset.filter);
  });
});

document.getElementById("adjust-new")?.addEventListener("click", () => {
  const nextValue = prompt("How many new words per day?", state.dailyNew);
  if (!nextValue) return;

  const parsed = parseInt(nextValue, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 100) return;

  state.dailyNew = parsed;
  saveState();
  renderStatsScreen();
  renderCard();
});

document.getElementById("reset-progress")?.addEventListener("click", () => {
  const ok = confirm("Reset all progress?");
  if (!ok) return;

  state = {
    ...DEFAULTS,
    cards: {}
  };

  saveState();
  refreshStats();
  renderCard();
  renderBrowseList("all");
  renderStatsScreen();
});

/* --- INIT --- */
checkDayRollover();
updateDateMeta();
refreshStats();
renderStatsScreen();
renderBrowseList("all");
showScreen("study");