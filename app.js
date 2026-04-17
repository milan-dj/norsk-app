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
    direction: 'no-en'
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

/* --- SRS --- */
function initCard() {
    return {
        ef: 2.5,
        reps: 0,
        interval: 0,
        due: todayStr(),
        seen: false,
        lapses: 0
    };
}

function gradeCard(idx, rating) {
    const c = state.cards[idx] || initCard();

    c.seen = true;

    if (rating === 1) {
        c.reps = 0;
        c.interval = 0;
        c.lapses += 1;
        c.ef = Math.max(1.3, c.ef - 0.2);
        c.due = todayStr();
    } else {
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
        c.due = addDays(todayStr(), c.interval);
    }

    state.cards[idx] = c;
    state.todayReviews += 1;

    if (state.lastStudy !== todayStr()) {
        state.streak += 1;
        state.lastStudy = todayStr();
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

        if (c.due <= today) {
            due++;
        }

        if (c.reps > 0 && c.interval < 21) {
            learning++;
        }

        if (c.reps > 0 && c.interval >= 21) {
            known++;
        }
    }

    const dueEl = document.getElementById('stat-due');
    const learningEl = document.getElementById('stat-learning');
    const knownEl = document.getElementById('stat-known');
    const streakEl = document.getElementById('stat-streak');
    const dateMetaEl = document.getElementById('dateMeta');

    if (dueEl) dueEl.textContent = due;
    if (learningEl) learningEl.textContent = learning;
    if (knownEl) knownEl.textContent = known;
    if (streakEl) streakEl.textContent = state.streak || 0;

    if (dateMetaEl) {
        const d = new Date();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        dateMetaEl.textContent = `${months[d.getMonth()]} ${d.getDate()}`;
    }
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

/* --- RENDER --- */
function renderCard() {
    queue = getQueue();

    if (queue.length === 0) {
        document.getElementById('card-container').innerHTML = "<p>Done for today</p>";
        document.getElementById('ratings').classList.remove('visible');
        refreshStats();
        return;
    }

    currentIdx = queue[0];
    isFlipped = false;
    revealedByGiveUp = false;

    const w = WORDS[currentIdx];
    const dir = state.direction;
    const prompt = dir === 'no-en' ? w.no : w.en;
    const answer = dir === 'no-en' ? w.en : w.no;

    document.getElementById('card-container').innerHTML = `
    <div class="card-wrap">
      <div class="card" id="card">
        <div class="card-face card-front">
          <div class="card-center">
            <h1>${prompt}</h1>

            <input id="input" placeholder="Type answer..." autocomplete="off" spellcheck="false" />
            <button id="check">Check</button>
            <button id="skip">I don't know</button>

            <div id="feedback"></div>
          </div>
        </div>

        <div class="card-face card-back">
          <div class="card-center">
            <h1>${answer}</h1>
            <p>${w.example}</p>
            <small>${w.example_en}</small>
          </div>
        </div>
      </div>
    </div>
  `;

    const input = document.getElementById('input');
    const feedback = document.getElementById('feedback');

    document.getElementById('check').onclick = () => {
        const val = normalizeAnswer(input.value);
        if (!val) return;

        const possible = acceptedAnswers(answer);
        const correct = possible.includes(val);

        feedback.innerText = correct ? "Correct" : "Answer: " + answer;
        flipCard();
    };

    document.getElementById('skip').onclick = () => {
        revealedByGiveUp = true;
        feedback.innerText = "";
        flipCard();
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('check').click();
        }
    });

    setTimeout(() => input.focus(), 50);
    refreshStats();
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