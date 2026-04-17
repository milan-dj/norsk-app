/* =========================================================
   NORSK · App Logic
========================================================= */

import { WORDS } from "./words.js";

const STORAGE_KEY = 'norsk_app_v3';

const DEFAULTS = {
    cards: {},
    lastStudy: null,
    streak: 0,
    todayReviews: 0,
    todayDate: null,
    dailyNew: 10,
    direction: 'no-en',
    autoDirection: true
};

let state = loadState();

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        return Object.assign({}, DEFAULTS, saved || {}, { cards: (saved && saved.cards) || {} });
    } catch {
        return { ...DEFAULTS, cards: {} };
    }
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

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

function getCardMode(idx) {
    const modes = ["typing", "multiple", "cloze", "sentence"];
    const c = state.cards[idx] || initCard();

    if (!c.seen) return "typing";
    if ((c.correctCount || 0) < 2) return "multiple";

    return modes[Math.floor(Math.random() * modes.length)];
}
/* --- SRS --- */
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

    document.getElementById('stat-due').textContent = due;
    document.getElementById('stat-learning').textContent = learning;
    document.getElementById('stat-known').textContent = known;
    document.getElementById('stat-streak').textContent = state.streak || 0;
}

/* --- UI --- */
let queue = [];
let currentIdx = null;
let isFlipped = false;
let revealedByGiveUp = false;

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
    return w.cloze_no || w.example.replace(w.no, "____");
}

function renderPromptContent(w, prompt, answer, mode) {
    if (mode === "typing") {
        return `
          <input id="input" placeholder="Type answer..." autocomplete="off" spellcheck="false" />
          <button id="check">Check</button>
          <button id="skip">I don't know</button>
          <div id="feedback"></div>
        `;
    }

    if (mode === "multiple") {
        const options = buildMultipleChoiceOptions(answer, w);
        return `
          <div class="mc-options">
            ${options.map(opt => `<button class="mc-btn" data-answer="${opt}">${opt}</button>`).join("")}
          </div>
          <button id="skip">I don't know</button>
          <div id="feedback"></div>
        `;
    }

    if (mode === "cloze") {
        const sentence = buildClozeSentence(w);
        return `
          <div class="cloze-sentence">${sentence}</div>
          <input id="input" placeholder="Fill the blank..." autocomplete="off" spellcheck="false" />
          <button id="check">Check</button>
          <button id="skip">I don't know</button>
          <div id="feedback"></div>
        `;
    }

    return `
      <div class="sentence-question">${w.example}</div>
      <input id="input" placeholder="Type the target word..." autocomplete="off" spellcheck="false" />
      <button id="check">Check</button>
      <button id="skip">I don't know</button>
      <div id="feedback"></div>
    `;
}

function renderExamples(w) {
    const examples = w.examples || [{ no: w.example, en: w.example_en }];
    return examples.map(ex => `
        <div class="word-example">${ex.no}</div>
        <div class="word-example-en">${ex.en}</div>
    `).join("");
}

function getDirectionForCard(idx) {
    const c = state.cards[idx] || initCard();

    if (!c.seen) return "no-en";
    return Math.random() < 0.5 ? "no-en" : "en-no";
}

function getHardestWords(limit = 10) {
    return WORDS.map((w, i) => {
        const c = state.cards[i] || initCard();
        return { ...w, idx: i, wrongCount: c.wrongCount || 0, lapses: c.lapses || 0 };
    })
        .sort((a, b) => (b.wrongCount + b.lapses) - (a.wrongCount + a.lapses))
        .slice(0, limit);
}

function renderAnswerFeedback(isCorrect, answer, w) {
    const examples = w.examples || [{ no: w.example, en: w.example_en }];
    const first = examples[0];

    return `
        <div class="answer-feedback ${isCorrect ? 'correct' : 'wrong'}">
            <div><strong>${isCorrect ? "Correct" : "Correct answer:"}</strong> ${answer}</div>
            <div class="word-example">${first.no}</div>
            <div class="word-example-en">${first.en}</div>
        </div>
    `;
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

function renderStatsScreen() {
    const { retention } = getRetentionStats();
    const hardest = getHardestWords(5);

    document.getElementById('prog-streak').textContent = `${state.streak || 0} days`;
    document.getElementById('prog-today').textContent = state.todayReviews || 0;

    const hardestHtml = hardest.map(w => `<div>${w.no} — ${w.wrongCount}</div>`).join("");
    const hardestEl = document.getElementById('hardestWords');
    if (hardestEl) hardestEl.innerHTML = hardestHtml;

    const retentionEl = document.getElementById('retentionPct');
    if (retentionEl) retentionEl.textContent = `${retention}%`;
}


/* --- RENDER --- */
function renderCard() {
    queue = getQueue();

    if (queue.length === 0) {
        document.getElementById('card-container').innerHTML = "<p>Done for today</p>";
        document.getElementById('ratings').classList.remove('visible');
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

function flipCard() {
    document.getElementById('card').classList.add('flipped');
    document.getElementById('ratings').classList.add('visible');
    isFlipped = true;
}

/* --- RATINGS --- */
document.querySelectorAll('.rate-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!isFlipped || currentIdx === null) return;

        let rating = parseInt(btn.dataset.rate, 10);

        if (revealedByGiveUp) rating = 1;

        gradeCard(currentIdx, rating);
        renderCard();
    });
});

document.querySelectorAll('.dir-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.dir-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.direction = btn.dataset.dir;
        saveState();
        renderCard();
    });
});

/* --- INIT --- */
checkDayRollover();
renderCard();