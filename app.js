/* =========================================================
   NORSK · App Logic (Separated JS)
========================================================= */

/* --- WORD LIST (keep or move later) --- */
const WORDS = [
  { no:"og", en:"and", pos:"conj", example:"Jeg liker kaffe og te.", example_en:"I like coffee and tea." },
  { no:"i", en:"in", pos:"prep", example:"Hun bor i Oslo.", example_en:"She lives in Oslo." },
  { no:"jeg", en:"I", pos:"pron", example:"Jeg er trøtt.", example_en:"I am tired." },
  { no:"det", en:"it / that", pos:"pron", example:"Det er kaldt ute.", example_en:"It is cold outside." }
];

/* --- STATE --- */
const STORAGE_KEY = 'norsk_app_v2';

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
    return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULTS };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayStr() {
  return new Date().toISOString().slice(0,10);
}

/* --- SRS --- */
function initCard() {
  return { ef: 2.5, reps: 0, interval: 0, due: todayStr(), seen: false };
}

function gradeCard(idx, rating) {
  const c = state.cards[idx] || initCard();

  if (rating === 1) {
    c.reps = 0;
    c.interval = 0;
    c.due = todayStr();
  } else {
    c.reps++;
    c.interval = c.reps === 1 ? 1 : Math.round(c.interval * c.ef);
    c.ef = Math.max(1.3, c.ef + 0.1);
    c.due = todayStr();
  }

  c.seen = true;
  state.cards[idx] = c;

  state.todayReviews++;
  if (state.lastStudy !== todayStr()) {
    state.streak++;
    state.lastStudy = todayStr();
  }

  saveState();
}

/* --- QUEUE --- */
function getQueue() {
  const queue = [];

  for (let i = 0; i < WORDS.length; i++) {
    if (!state.cards[i]) queue.push(i);
  }

  return queue.slice(0, state.dailyNew);
}

/* --- UI --- */
let queue = getQueue();
let currentIdx = null;
let isFlipped = false;
let revealedByGiveUp = false;

/* --- RENDER --- */
function renderCard() {
  if (queue.length === 0) {
    document.getElementById('card-container').innerHTML = "<p>Done for today</p>";
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

            <input id="input" placeholder="Type answer..." />
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

  document.getElementById('check').onclick = () => {
    const val = document.getElementById('input').value.toLowerCase().trim();
    if (!val) return;

    if (val === answer.toLowerCase()) {
      document.getElementById('feedback').innerText = "Correct";
    } else {
      document.getElementById('feedback').innerText = "Answer: " + answer;
    }

    flipCard();
  };

  document.getElementById('skip').onclick = () => {
    revealedByGiveUp = true;
    flipCard();
  };
}

function flipCard() {
  document.getElementById('card').classList.add('flipped');
  document.getElementById('ratings').classList.add('visible');
  isFlipped = true;
}

/* --- RATINGS --- */
document.querySelectorAll('.rate-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!isFlipped) return;

    let rating = parseInt(btn.dataset.rate);

    if (revealedByGiveUp) rating = 1;

    gradeCard(currentIdx, rating);

    queue.shift();
    renderCard();
  });
});

/* --- INIT --- */
renderCard();