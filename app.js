/* =========================================================
   NORSK · App Logic v7
   New: custom word adding, delete custom words
========================================================= */

import { WORDS as BUILTIN_WORDS } from "./words.js";

const STORAGE_KEY = "norsk_app_v6";
const CUSTOM_WORDS_KEY = "norsk_custom_words";
const LEECH_THRESHOLD = 5;

const DEFAULTS = {
  cards: {},
  lastStudy: null,
  streak: 0,
  todayReviews: 0,
  todayCorrect: 0,
  todayWrong: 0,
  todayDate: null,
  dailyNew: 10,
  direction: "no-en",
  darkMode: false,
  dailyHistory: {}
};

/* --- Custom words stored separately so they survive progress resets --- */
function loadCustomWords() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_WORDS_KEY)) || [];
  } catch { return []; }
}
function saveCustomWords(words) {
  localStorage.setItem(CUSTOM_WORDS_KEY, JSON.stringify(words));
}

let customWords = loadCustomWords();

// Merged word list: built-in + custom. Custom words start after built-in indices.
function getAllWords() {
  return [...BUILTIN_WORDS, ...customWords];
}
// Helper: is index a custom word?
function isCustomIndex(idx) {
  return idx >= BUILTIN_WORDS.length;
}

// Use this everywhere instead of WORDS directly
let WORDS = getAllWords();

function refreshWordList() {
  customWords = loadCustomWords();
  WORDS = getAllWords();
}

let state = loadState();
let queue = [];
let currentIdx = null;
let isFlipped = false;
let revealedByGiveUp = false;
let sessionStartReviews = 0;

/* ==================== STORAGE ==================== */
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Object.assign({}, DEFAULTS, saved || {}, {
      cards: (saved && saved.cards) || {},
      dailyHistory: (saved && saved.dailyHistory) || {}
    });
  } catch {
    return { ...DEFAULTS, cards: {}, dailyHistory: {} };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ==================== DATE ==================== */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
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
    state.todayCorrect = 0;
    state.todayWrong = 0;
    saveState();
  }
  sessionStartReviews = state.todayReviews;
}

function updateDateMeta() {
  const el = document.getElementById("dateMeta");
  if (!el) return;
  const d = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  el.textContent = `${months[d.getMonth()]} ${d.getDate()}`;
}

/* ==================== DARK MODE ==================== */
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.darkMode ? "dark" : "light");
  const icon = document.getElementById("themeIcon");
  if (icon) icon.textContent = state.darkMode ? "☀" : "☽";
  // Update theme-color meta for mobile status bar
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = state.darkMode ? "#1a1e26" : "#f5f1e8";
}

document.getElementById("themeToggle")?.addEventListener("click", () => {
  state.darkMode = !state.darkMode;
  saveState();
  applyTheme();
});

/* ==================== AUDIO ==================== */
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "nb-NO"; // Norwegian Bokmål
  u.rate = 0.85;

  // Try to find a Norwegian voice
  const voices = window.speechSynthesis.getVoices();
  const noVoice = voices.find(v => v.lang.startsWith("nb") || v.lang.startsWith("no"));
  if (noVoice) u.voice = noVoice;

  // Visual feedback
  const btn = document.querySelector(".speak-btn");
  if (btn) {
    btn.classList.add("speaking");
    u.onend = () => btn.classList.remove("speaking");
    u.onerror = () => btn.classList.remove("speaking");
  }

  window.speechSynthesis.speak(u);
}

// Pre-load voices (some browsers need this)
if ("speechSynthesis" in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

/* ==================== CARD STATE ==================== */
function initCard() {
  return {
    ef: 2.5, reps: 0, interval: 0, due: todayStr(),
    seen: false, lapses: 0, correctCount: 0, wrongCount: 0,
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
function isLeech(c) {
  return (c.lapses || 0) >= LEECH_THRESHOLD;
}

/* ==================== SRS ==================== */
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
    state.todayWrong = (state.todayWrong || 0) + 1;
  } else {
    c.correctCount += 1;
    state.todayCorrect = (state.todayCorrect || 0) + 1;
    if (c.reps === 0) c.interval = rating === 2 ? 1 : rating === 3 ? 2 : 4;
    else if (c.reps === 1) c.interval = rating === 2 ? 2 : rating === 3 ? 4 : 7;
    else {
      const mult = rating === 2 ? 1.2 : rating === 3 ? c.ef : c.ef * 1.3;
      c.interval = Math.max(1, Math.round(c.interval * mult));
    }
    c.reps += 1;
    c.ef = Math.max(1.3, c.ef + (rating === 4 ? 0.15 : rating === 3 ? 0.05 : 0));
    c.due = addDays(today, c.interval);
  }

  state.cards[idx] = c;
  state.todayReviews += 1;

  // Record daily history for heatmap
  state.dailyHistory[today] = (state.dailyHistory[today] || 0) + 1;

  if (state.lastStudy !== today) {
    state.streak += 1;
    state.lastStudy = today;
  }

  // Flash the card border
  const cardEl = document.getElementById("card");
  if (cardEl) {
    const cls = rating === 1 ? "flash-wrong" : "flash-correct";
    cardEl.classList.add(cls);
    setTimeout(() => cardEl.classList.remove(cls), 600);
  }

  // Leech notification
  if (isLeech(c) && c.lapses === LEECH_THRESHOLD) {
    showToast(`⚠ "${WORDS[idx].no}" marked as a leech`);
  }

  saveState();
}

/* ==================== QUEUE ==================== */
function getQueue() {
  const today = todayStr();
  const due = [];
  const fresh = [];
  for (let i = 0; i < WORDS.length; i++) {
    const c = state.cards[i];
    if (c && c.seen && c.due <= today) due.push(i);
    else if (!c || !c.seen) fresh.push(i);
  }
  // Prioritize leeches and hard cards
  due.sort((a, b) => {
    const ca = state.cards[a] || initCard();
    const cb = state.cards[b] || initCard();
    return (cb.lapses + cb.wrongCount) - (ca.lapses + ca.wrongCount);
  });
  return [...due, ...fresh.slice(0, state.dailyNew)];
}

/* ==================== STATS ==================== */
function getSeenCount() {
  let n = 0;
  for (let i = 0; i < WORDS.length; i++) {
    const c = state.cards[i];
    if (c && c.seen) n++;
  }
  return n;
}
function getKnownCount() {
  let n = 0;
  for (let i = 0; i < WORDS.length; i++) {
    const c = state.cards[i];
    if (c && isKnownCard(c)) n++;
  }
  return n;
}
function getRetentionStats() {
  let correct = 0, wrong = 0;
  Object.values(state.cards).forEach(c => {
    correct += c.correctCount || 0;
    wrong += c.wrongCount || 0;
  });
  const total = correct + wrong;
  return { correct, wrong, retention: total ? Math.round((correct / total) * 100) : 0 };
}
function getHardestWords(limit = 5) {
  return WORDS.map((w, i) => {
    const c = getCardState(i);
    return { ...w, idx: i, wrongCount: c.wrongCount || 0, lapses: c.lapses || 0 };
  })
    .filter(w => (w.wrongCount + w.lapses) > 0)
    .sort((a, b) => (b.wrongCount + b.lapses) - (a.wrongCount + a.lapses))
    .slice(0, limit);
}

function bumpStat(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("bump");
  setTimeout(() => el.classList.remove("bump"), 300);
}

function refreshStats() {
  const today = todayStr();
  let due = 0, learning = 0, known = 0;
  for (let i = 0; i < WORDS.length; i++) {
    const c = state.cards[i];
    if (!c || !c.seen) continue;
    if (c.due <= today) due++;
    if (isKnownCard(c)) known++;
    else learning++;
  }

  setText("stat-due", due);
  setText("stat-learning", learning);
  setText("stat-known", known);
  setText("stat-streak", state.streak || 0);
}

function renderStatsScreen() {
  const seen = getSeenCount();
  const known = getKnownCount();
  const total = WORDS.length;
  const { retention } = getRetentionStats();
  const hardest = getHardestWords(5);

  setText("prog-seen", seen);
  setText("prog-known", known);
  setText("prog-total", total);
  setText("prog-today", state.todayReviews || 0);
  setText("prog-streak", `${state.streak || 0} days`);
  setText("retentionPct", `${retention}%`);
  setText("daily-new", state.dailyNew);

  // Progress ring
  const pct = total ? seen / total : 0;
  const ring = document.getElementById("progressRing");
  const label = document.getElementById("progressLabel");
  if (ring) {
    const circumference = 2 * Math.PI * 52; // r=52
    ring.style.strokeDashoffset = circumference * (1 - pct);
  }
  if (label) label.textContent = Math.round(pct * 100) + "%";

  // Hardest words
  const hardestEl = document.getElementById("hardestWords");
  if (hardestEl) {
    if (hardest.length === 0) {
      hardestEl.innerHTML = `<div class="stat-row"><span style="color:var(--muted)">No hard words yet</span><span>—</span></div>`;
    } else {
      hardestEl.innerHTML = hardest.map(w => {
        const leechBadge = isLeech(getCardState(w.idx)) ? ' <span style="color:var(--coral);font-size:10px;">LEECH</span>' : '';
        return `<div class="stat-row"><span>${w.no}${leechBadge}</span><span>${w.lapses} lapses</span></div>`;
      }).join("");
    }
  }

  // Heatmap (last 8 weeks)
  renderHeatmap();
}

function renderHeatmap() {
  const el = document.getElementById("heatmap");
  if (!el) return;
  const cells = [];
  for (let i = 55; i >= 0; i--) {
    const d = addDays(todayStr(), -i);
    const count = state.dailyHistory[d] || 0;
    let cls = "heat-cell";
    if (count >= 20) cls += " l3";
    else if (count >= 10) cls += " l2";
    else if (count > 0) cls += " l1";
    const dayName = new Date(d + "T00:00:00").toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
    cells.push(`<div class="${cls}" title="${dayName}: ${count} reviews"></div>`);
  }
  el.innerHTML = cells.join("");
}

/* ==================== HELPERS ==================== */
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function normalizeAnswer(str) {
  return str.toLowerCase().trim().replace(/[.,!?;:()]/g, "").replace(/\s+/g, " ");
}
function acceptedAnswers(answer) {
  return answer.split("/").map(s => normalizeAnswer(s)).filter(Boolean);
}

/* ==================== CARD MODE ==================== */
function getDirectionForCard(idx) {
  const c = state.cards[idx] || initCard();
  if (!c.seen) return "no-en";
  return Math.random() < 0.5 ? "no-en" : "en-no";
}

function getCardMode(idx, dir) {
  const c = state.cards[idx] || initCard();
  if (!c.seen) return "typing";
  if ((c.correctCount || 0) < 2) return "multiple";
  if (dir === "en-no") {
    const modes = ["typing", "multiple", "cloze", "sentence"];
    return modes[Math.floor(Math.random() * modes.length)];
  }
  return Math.random() < 0.5 ? "typing" : "multiple";
}

function buildMultipleChoiceOptions(answer, w, dir) {
  const pool = new Set([answer]);
  if (w.confusions) w.confusions.forEach(c => pool.add(c));
  while (pool.size < 4) {
    const r = WORDS[Math.floor(Math.random() * WORDS.length)];
    pool.add(dir === "no-en" ? r.en : r.no);
  }
  return [...pool].sort(() => Math.random() - 0.5);
}

function buildClozeSentence(w) {
  const base = w.example || (w.examples && w.examples[0] && w.examples[0].no) || "";
  return w.cloze_no || base.replace(new RegExp(w.no.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), "____");
}

function renderExamples(w) {
  const examples = w.examples || [{ no: w.example, en: w.example_en }];
  return examples.map(ex => `
    <div class="word-example">${ex.no || ""}</div>
    <div class="word-example-en">${ex.en || ""}</div>
  `).join("");
}

function renderAnswerFeedback(isCorrect, answer, w) {
  const examples = w.examples || [{ no: w.example, en: w.example_en }];
  const first = examples[0] || { no: "", en: "" };
  return `
    <div class="answer-feedback ${isCorrect ? "correct" : "wrong"}">
      <div><strong>${isCorrect ? "✓ Correct" : "✕ Correct answer:"}</strong> ${answer}</div>
      <div class="word-example" style="border:none;padding-top:8px;margin-top:8px;">${first.no || ""}</div>
      <div class="word-example-en">${first.en || ""}</div>
    </div>
  `;
}

function renderPromptContent(w, prompt, answer, mode, dir) {
  const speakBtn = `<button class="speak-btn" onclick="event.stopPropagation()" id="speakFront" title="Listen">🔊</button>`;

  if (mode === "typing") {
    return `
      ${dir === "no-en" ? speakBtn : ""}
      <input id="input" class="recall-input" placeholder="Type answer..." autocomplete="off" spellcheck="false" />
      <div class="recall-actions">
        <button id="check" class="recall-btn">Check</button>
        <button id="skip" class="recall-btn secondary">I don't know</button>
      </div>
      <div id="feedback" class="answer-feedback"></div>
    `;
  }
  if (mode === "multiple") {
    const options = buildMultipleChoiceOptions(answer, w, dir);
    return `
      ${dir === "no-en" ? speakBtn : ""}
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
      <div class="cloze-sentence">${sentence}</div>
      <input id="input" class="recall-input" placeholder="Fill the blank..." autocomplete="off" spellcheck="false" />
      <div class="recall-actions">
        <button id="check" class="recall-btn">Check</button>
        <button id="skip" class="recall-btn secondary">I don't know</button>
      </div>
      <div id="feedback" class="answer-feedback"></div>
    `;
  }
  // sentence mode
  const sentencePrompt = w.example || (w.examples && w.examples[0] && w.examples[0].no) || "";
  return `
    <div class="cloze-sentence">${sentencePrompt}</div>
    <input id="input" class="recall-input" placeholder="Type the target word..." autocomplete="off" spellcheck="false" />
    <div class="recall-actions">
      <button id="check" class="recall-btn">Check</button>
      <button id="skip" class="recall-btn secondary">I don't know</button>
    </div>
    <div id="feedback" class="answer-feedback"></div>
  `;
}

/* ==================== RENDER CARD ==================== */
function renderCard() {
  queue = getQueue();
  const container = document.getElementById("card-container");
  const ratingsEl = document.getElementById("ratings");

  if (queue.length === 0) {
    // Session summary
    const reviewed = state.todayReviews || 0;
    const correct = state.todayCorrect || 0;
    const pct = reviewed ? Math.round((correct / reviewed) * 100) : 0;

    container.innerHTML = `
      <div class="empty">
        <div class="empty-mark">✓</div>
        <div class="empty-title">All done for today</div>
        <div class="empty-subtitle">Come back tomorrow for your next review.</div>
        <div class="empty-stats">
          <div class="stat">
            <div class="empty-stat-num">${reviewed}</div>
            <div class="empty-stat-label">Reviewed</div>
          </div>
          <div class="stat">
            <div class="empty-stat-num" style="color:var(--sage)">${pct}%</div>
            <div class="empty-stat-label">Accuracy</div>
          </div>
          <div class="stat">
            <div class="empty-stat-num" style="color:var(--coral)">${state.streak}</div>
            <div class="empty-stat-label">Streak</div>
          </div>
        </div>
        <button class="empty-btn" id="review-more">Study extra words</button>
      </div>`;

    ratingsEl.classList.remove("visible");

    document.getElementById("review-more")?.addEventListener("click", () => {
      const extras = [];
      for (let i = 0; i < WORDS.length && extras.length < 5; i++) {
        if (!state.cards[i] || !state.cards[i].seen) extras.push(i);
      }
      if (extras.length === 0) { showToast("You've seen every word!"); return; }
      queue = extras;
      drawNext();
    });
    return;
  }

  currentIdx = queue[0];
  isFlipped = false;
  revealedByGiveUp = false;

  const w = WORDS[currentIdx];
  const dir = state.direction === "auto" ? getDirectionForCard(currentIdx) : state.direction;
  const prompt = dir === "no-en" ? w.no : w.en;
  const answer = dir === "no-en" ? w.en : w.no;
  const mode = getCardMode(currentIdx, dir);
  const targetAnswer = mode === "cloze" ? (w.cloze_answer || w.no) : answer;
  const promptContent = renderPromptContent(w, prompt, answer, mode, dir);
  const cardNum = "№ " + String(currentIdx + 1).padStart(3, "0");
  const leechBadge = isLeech(getCardState(currentIdx)) ? '<span class="word-item-badge">LEECH</span>' : '';

  container.innerHTML = `
    <div class="card-wrap">
      <div class="card" id="card">
        <div class="card-face card-front">
          <div class="card-num">${cardNum} ${leechBadge}</div>
          <div class="card-corner">${w.pos}</div>
          <div class="card-center">
            <div class="${dir === 'no-en' ? 'word-no' : 'word-en'}">${prompt}</div>
            <div class="word-pos">${queue.length} remaining</div>
            ${promptContent}
          </div>
        </div>
        <div class="card-face card-back">
          <div class="card-num">${cardNum}</div>
          <div class="card-corner">${w.pos}</div>
          <div class="card-center">
            <div class="${dir === 'no-en' ? 'word-en' : 'word-no'}">${answer}</div>
            <button class="speak-btn" id="speakBack" title="Listen">🔊</button>
            ${renderExamples(w)}
          </div>
        </div>
      </div>
    </div>`;

  ratingsEl.classList.remove("visible");

  // Wire speak buttons
  document.getElementById("speakFront")?.addEventListener("click", (e) => {
    e.stopPropagation();
    speak(dir === "no-en" ? w.no : w.en);
  });
  document.getElementById("speakBack")?.addEventListener("click", (e) => {
    e.stopPropagation();
    speak(w.no); // Always speak Norwegian on back
  });

  // Wire input modes
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
        if (feedback) feedback.innerHTML = renderAnswerFeedback(correct, answer, w);
        flipCard();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); checkBtn.click(); }
      });
      setTimeout(() => input.focus(), 80);
    }
    if (skipBtn) {
      skipBtn.onclick = () => {
        revealedByGiveUp = true;
        if (feedback) feedback.innerHTML = "";
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
        if (feedback) feedback.innerHTML = renderAnswerFeedback(correct, answer, w);
        flipCard();
      };
    });
    if (skipBtn) {
      skipBtn.onclick = () => {
        revealedByGiveUp = true;
        if (feedback) feedback.innerHTML = "";
        flipCard();
      };
    }
  }

  // Swipe support
  setupSwipe();
  refreshStats();
}

function flipCard() {
  const cardEl = document.getElementById("card");
  if (cardEl) cardEl.classList.add("flipped");
  document.getElementById("ratings").classList.add("visible");
  isFlipped = true;

  // Auto-speak the Norwegian word on flip
  if (currentIdx !== null) {
    const w = WORDS[currentIdx];
    speak(w.no);
  }
}

function drawNext() {
  if (queue.length) queue.shift();
  if (queue.length === 0) queue = getQueue();
  renderCard();
  refreshStats();
}

/* ==================== SWIPE ==================== */
function setupSwipe() {
  const card = document.getElementById("card");
  if (!card) return;
  let startX = 0, startY = 0;

  card.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  card.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return; // too small or vertical

    if (!isFlipped) {
      flipCard();
    } else if (currentIdx !== null) {
      const rating = dx < 0 ? 1 : 3; // swipe left = again, swipe right = good
      gradeCard(currentIdx, rating);
      drawNext();
    }
  }, { passive: true });
}

/* ==================== KEYBOARD SHORTCUTS ==================== */
document.addEventListener("keydown", (e) => {
  // Don't capture if typing in an input
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
    if (e.key === "Escape") e.target.blur();
    return;
  }

  const studyScreen = document.getElementById("screen-study");
  if (!studyScreen || !studyScreen.classList.contains("active")) return;

  if (e.key === " " || e.code === "Space") {
    e.preventDefault();
    if (!isFlipped) flipCard();
  }

  if (isFlipped && currentIdx !== null) {
    const rating = { "1": 1, "2": 2, "3": 3, "4": 4 }[e.key];
    if (rating) {
      let r = rating;
      if (revealedByGiveUp) r = 1;
      gradeCard(currentIdx, r);
      drawNext();
    }
  }
});

/* ==================== RATING BUTTONS ==================== */
document.querySelectorAll(".rate-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!isFlipped || currentIdx === null) return;
    let rating = parseInt(btn.dataset.rate, 10);
    if (revealedByGiveUp) rating = 1;
    gradeCard(currentIdx, rating);
    bumpStat(rating >= 3 ? "stat-known" : "stat-learning");
    drawNext();
  });
});

/* ==================== DIRECTION ==================== */
document.querySelectorAll(".dir-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".dir-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.direction = btn.dataset.dir;
    saveState();
    renderCard();
  });
});

/* ==================== NAV ==================== */
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const screenEl = document.getElementById(`screen-${name}`);
  const navEl = document.querySelector(`.nav-btn[data-screen="${name}"]`);
  if (screenEl) screenEl.classList.add("active");
  if (navEl) navEl.classList.add("active");
  if (name === "browse") renderBrowseList();
  if (name === "stats") renderStatsScreen();
  if (name === "study") renderCard();
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

/* ==================== BROWSE ==================== */
let browseFilter = "all";
let browseQuery = "";

document.querySelectorAll(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    browseFilter = chip.dataset.filter;
    renderBrowseList();
  });
});

document.getElementById("browseSearch")?.addEventListener("input", (e) => {
  browseQuery = e.target.value.toLowerCase().trim();
  renderBrowseList();
});

function renderBrowseList() {
  const listEl = document.getElementById("wordList");
  const countEl = document.getElementById("browseCount");
  if (!listEl || !countEl) return;

  let items = WORDS.map((w, idx) => {
    const c = getCardState(idx);
    return { ...w, idx, card: c, custom: isCustomIndex(idx) };
  });

  // Filter by status
  if (browseFilter === "new") items = items.filter(i => !i.card.seen);
  else if (browseFilter === "learning") items = items.filter(i => isLearningCard(i.card));
  else if (browseFilter === "known") items = items.filter(i => isKnownCard(i.card));
  else if (browseFilter === "leech") items = items.filter(i => isLeech(i.card));
  else if (browseFilter === "custom") items = items.filter(i => i.custom);

  // Filter by search
  if (browseQuery) {
    items = items.filter(i =>
      i.no.toLowerCase().includes(browseQuery) ||
      i.en.toLowerCase().includes(browseQuery)
    );
  }

  countEl.textContent = items.length;

  listEl.innerHTML = items.length === 0
    ? '<div class="word-item"><div style="color:var(--muted);font-size:13px;padding:16px 0;width:100%;text-align:center;">No words match.</div></div>'
    : items.map(item => {
        let dotClass = "";
        if (isLeech(item.card)) dotClass = "leech";
        else if (isKnownCard(item.card)) dotClass = "known";
        else if (isLearningCard(item.card)) dotClass = "learning";
        const leechBadge = isLeech(item.card) ? '<span class="word-item-badge">LEECH</span>' : '';
        const customBadge = item.custom ? '<span class="word-item-custom">MY</span>' : '';
        const deleteBtn = item.custom
          ? `<button class="word-item-delete" data-delete-idx="${item.idx}" title="Delete word">✕</button>`
          : '';
        return `
          <div class="word-item">
            <div>
              <span class="word-item-dot ${dotClass}"></span>
              <span class="word-item-no">${item.no}</span>
              ${leechBadge}${customBadge}
            </div>
            <div style="display:flex;align-items:baseline;">
              <span class="word-item-en">${item.en}</span>
              ${deleteBtn}
            </div>
          </div>`;
      }).join("");

  // Wire delete buttons
  listEl.querySelectorAll(".word-item-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.deleteIdx, 10);
      deleteCustomWord(idx);
    });
  });
}

/* ==================== CUSTOM WORD MANAGEMENT ==================== */
function addCustomWord(word) {
  customWords.push(word);
  saveCustomWords(customWords);
  WORDS = getAllWords();
}

function deleteCustomWord(globalIdx) {
  const localIdx = globalIdx - BUILTIN_WORDS.length;
  if (localIdx < 0 || localIdx >= customWords.length) return;

  const w = customWords[localIdx];
  if (!confirm(`Delete "${w.no}"?`)) return;

  // Remove the word
  customWords.splice(localIdx, 1);
  saveCustomWords(customWords);

  // Clean up card state: remove this card and shift all custom indices above it
  const newCards = {};
  for (const [key, val] of Object.entries(state.cards)) {
    const k = parseInt(key, 10);
    if (k === globalIdx) continue; // skip deleted
    if (k > globalIdx) {
      newCards[k - 1] = val; // shift down
    } else {
      newCards[k] = val;
    }
  }
  state.cards = newCards;
  saveState();

  WORDS = getAllWords();
  renderBrowseList();
  refreshStats();
  setText("customWordCount", customWords.length);
  showToast(`Deleted "${w.no}"`);
}

/* ==================== ADD WORD FORM ==================== */
let addWordPos = "";

document.getElementById("addWordOpen")?.addEventListener("click", () => {
  document.getElementById("addWordOverlay").classList.add("open");
  setTimeout(() => document.getElementById("addNo")?.focus(), 350);
});

document.getElementById("addWordClose")?.addEventListener("click", closeAddWord);

document.getElementById("addWordOverlay")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeAddWord();
});

function closeAddWord() {
  document.getElementById("addWordOverlay").classList.remove("open");
}

// POS chip selection
document.querySelectorAll(".pos-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".pos-chip").forEach(c => c.classList.remove("active"));
    if (addWordPos === chip.dataset.pos) {
      addWordPos = ""; // toggle off
    } else {
      chip.classList.add("active");
      addWordPos = chip.dataset.pos;
    }
  });
});

document.getElementById("addWordSubmit")?.addEventListener("click", () => {
  const no = document.getElementById("addNo").value.trim();
  const en = document.getElementById("addEn").value.trim();
  const exNo = document.getElementById("addExNo").value.trim();
  const exEn = document.getElementById("addExEn").value.trim();
  const feedback = document.getElementById("addWordFeedback");

  if (!no || !en) {
    if (feedback) { feedback.textContent = "Norwegian word and English translation are required."; feedback.style.color = "var(--coral)"; }
    return;
  }

  // Check for duplicates
  const exists = WORDS.some(w => w.no.toLowerCase() === no.toLowerCase());
  if (exists) {
    if (feedback) { feedback.textContent = `"${no}" is already in your word list.`; feedback.style.color = "var(--coral)"; }
    return;
  }

  const word = {
    no: no,
    en: en,
    pos: addWordPos || "noun",
    example: exNo || "",
    example_en: exEn || ""
  };

  // If examples provided, use the examples array format too
  if (exNo || exEn) {
    word.examples = [{ no: exNo, en: exEn }];
  }

  addCustomWord(word);

  // Clear form
  document.getElementById("addNo").value = "";
  document.getElementById("addEn").value = "";
  document.getElementById("addExNo").value = "";
  document.getElementById("addExEn").value = "";
  document.querySelectorAll(".pos-chip").forEach(c => c.classList.remove("active"));
  addWordPos = "";

  if (feedback) {
    feedback.textContent = `✓ Added "${no}" — it will appear in your next study session.`;
    feedback.style.color = "var(--sage)";
  }

  renderBrowseList();
  refreshStats();
  setText("customWordCount", customWords.length);
  showToast(`Added "${no}"`);
});

/* ==================== SETTINGS ==================== */
document.getElementById("adjust-new")?.addEventListener("click", () => {
  const val = prompt("How many new words per day? (5–30 recommended)", state.dailyNew);
  const n = parseInt(val, 10);
  if (!isNaN(n) && n > 0 && n <= 100) {
    state.dailyNew = n;
    saveState();
    renderStatsScreen();
    renderCard();
    showToast(`Daily target: ${n} words`);
  }
});

document.getElementById("reset-progress")?.addEventListener("click", () => {
  if (confirm("Reset ALL progress and streak? This cannot be undone.\n\nNote: your custom words will be kept.")) {
    state = { ...DEFAULTS, cards: {}, dailyHistory: {} };
    saveState();
    refreshStats();
    renderCard();
    renderBrowseList();
    renderStatsScreen();
    showToast("Progress reset (custom words kept)");
  }
});

/* ==================== EXPORT / IMPORT ==================== */

function wordToJS(w) {
  // Format a word object exactly like words.js entries
  const lines = [];
  lines.push(`  {`);
  lines.push(`    no: ${JSON.stringify(w.no)},`);
  lines.push(`    en: ${JSON.stringify(w.en)},`);
  lines.push(`    pos: ${JSON.stringify(w.pos || "noun")},`);

  // Use examples array if present, otherwise fall back to example/example_en
  const examples = w.examples || (w.example ? [{ no: w.example, en: w.example_en || "" }] : []);
  if (examples.length > 0) {
    lines.push(`    examples: [`);
    examples.forEach((ex, i) => {
      const comma = i < examples.length - 1 ? "," : "";
      lines.push(`      { no: ${JSON.stringify(ex.no || "")}, en: ${JSON.stringify(ex.en || "")} }${comma}`);
    });
    lines.push(`    ]`);
  }

  // Include cloze fields if present
  if (w.cloze_no) {
    lines[lines.length - 1] += ",";
    lines.push(`    cloze_no: ${JSON.stringify(w.cloze_no)},`);
    lines.push(`    cloze_answer: ${JSON.stringify(w.cloze_answer || w.no)}`);
  }

  // Include confusions if present
  if (w.confusions && w.confusions.length > 0) {
    lines[lines.length - 1] += ",";
    lines.push(`    confusions: ${JSON.stringify(w.confusions)}`);
  }

  lines.push(`  }`);
  return lines.join("\n");
}

document.getElementById("exportData")?.addEventListener("click", () => {
  if (customWords.length === 0) {
    showToast("No custom words to export");
    return;
  }

  // Build output that can be pasted directly into the WORDS array in words.js
  const header = `// Exported custom words — ${todayStr()}\n// Paste these entries into the WORDS array in words.js\n\n`;
  const entries = customWords.map(w => wordToJS(w)).join(",\n");
  const output = header + entries;

  const blob = new Blob([output], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `my-words-${todayStr()}.js`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Exported ${customWords.length} words`);
});

document.getElementById("importData")?.addEventListener("click", () => {
  document.getElementById("importFile")?.click();
});

document.getElementById("importFile")?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const text = evt.target.result.trim();
      let words;

      // Try parsing as JSON array first (in case they export/re-import)
      try {
        const parsed = JSON.parse(text);
        words = Array.isArray(parsed) ? parsed : (parsed.customWords || null);
      } catch {
        // Try evaluating as JS object literals (the export format)
        // Wrap in array brackets and parse
        let cleaned = text;
        // Strip comment lines
        cleaned = cleaned.split("\n").filter(l => !l.trim().startsWith("//")).join("\n").trim();
        // Remove trailing comma if present
        if (cleaned.endsWith(",")) cleaned = cleaned.slice(0, -1);
        // Wrap in array
        cleaned = `[${cleaned}]`;
        // Convert JS object notation to JSON (unquoted keys → quoted)
        cleaned = cleaned.replace(/(\s)(no|en|pos|examples|example|example_en|cloze_no|cloze_answer|confusions)(\s*:)/g, '$1"$2"$3');
        words = JSON.parse(cleaned);
      }

      if (!Array.isArray(words) || words.length === 0) {
        showToast("No words found in file");
        return;
      }

      // Validate each word has at least no and en
      const valid = words.filter(w => w.no && w.en);
      if (valid.length === 0) {
        showToast("No valid words found (need 'no' and 'en' fields)");
        return;
      }

      // Check for duplicates against existing words
      const existingSet = new Set(WORDS.map(w => w.no.toLowerCase()));
      const newWords = valid.filter(w => !existingSet.has(w.no.toLowerCase()));
      const dupes = valid.length - newWords.length;

      let msg = `Import ${newWords.length} word${newWords.length === 1 ? "" : "s"}?`;
      if (dupes > 0) msg += `\n(${dupes} duplicate${dupes === 1 ? "" : "s"} skipped)`;
      if (newWords.length === 0) {
        showToast("All words already exist in your list");
        return;
      }

      if (!confirm(msg)) return;

      // Add them
      newWords.forEach(w => customWords.push(w));
      saveCustomWords(customWords);
      WORDS = getAllWords();

      refreshStats();
      renderCard();
      renderBrowseList();
      renderStatsScreen();
      setText("customWordCount", customWords.length);
      showToast(`Added ${newWords.length} words`);

    } catch (err) {
      console.error("Import error:", err);
      showToast("Couldn't parse file — check the format");
    }
  };

  reader.readAsText(file);
  e.target.value = "";
});

/* ==================== INIT ==================== */
applyTheme();
document.querySelectorAll(".dir-btn").forEach(b => {
  b.classList.toggle("active", b.dataset.dir === state.direction);
});

checkDayRollover();
updateDateMeta();
refreshStats();
renderStatsScreen();
renderBrowseList();
showScreen("study");

// Show custom word count in stats
setText("customWordCount", customWords.length);