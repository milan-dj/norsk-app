# Norsk · Daily Words

A single-file Norwegian vocabulary learning app with spaced repetition,
designed to be hosted free on GitHub Pages and installed as an app on your phone.

## What's inside

- **`index.html`** – the whole app (HTML + CSS + JavaScript + starter word list)
- **`manifest.json`** – lets your phone install it as an app with a proper name and icon
- **`sw.js`** – service worker so it works offline once loaded
- **`icon-192.png`, `icon-512.png`** – app icons

## Features

- **Spaced repetition** (simplified SM-2 algorithm, same family Anki uses)
- **Active recall** with tap-to-flip flashcards
- **Both directions** — Norwegian → English and English → Norwegian
- **Example sentences** with translations on every card
- **Daily new-word target** (default 10/day — adjustable in Stats)
- **Streak tracking** to keep you consistent
- **Browse mode** to see all words and their status (new / learning / known)
- **Progress saved locally** on your phone — no login, no server, no tracking
- **Works offline** after first load

## How it teaches (research-backed)

1. **Frequency-first** – the starter list is from the top ~1000 most-used Bokmål words. These ~170 starter words alone cover a huge share of everyday speech.
2. **Active recall** – you produce the answer before flipping the card.
3. **Spaced repetition** – words you find easy come back less often; words you struggle with come back sooner. Over weeks, this is dramatically more efficient than re-reading.
4. **Context** – every word comes with a short Norwegian sentence so you don't just memorize translations in a vacuum.
5. **Small sessions, daily** – the "streak" and daily new-word cap are designed to nudge short, frequent sessions (the biggest predictor of long-term retention).

## Setting it up on GitHub Pages (free)

1. **Create a GitHub repo.** Name it whatever you like — e.g. `norsk` — and make it **Public**.
2. **Upload all five files** to the root of the repo: `index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`.
3. In the repo, go to **Settings → Pages**.
4. Under **"Build and deployment" → "Source"**, choose **"Deploy from a branch"**.
5. Pick your branch (usually `main`) and folder `/ (root)`. Click **Save**.
6. Wait ~1 minute. GitHub will show a URL like `https://YOUR-USERNAME.github.io/norsk/` — that's your live app.

## Installing it as an app on your phone

### iPhone / iPad (Safari)
1. Open your GitHub Pages URL in **Safari** (not Chrome — iOS requires Safari for this).
2. Tap the **Share** button.
3. Scroll down and tap **"Add to Home Screen"**.
4. Confirm. The app appears on your home screen with its own icon — tapping it opens a full-screen experience with no browser chrome, exactly like a native app.

### Android (Chrome)
1. Open your GitHub Pages URL in **Chrome**.
2. Tap the **⋮ menu**.
3. Tap **"Install app"** (or "Add to Home screen").
4. Confirm. Same deal — standalone app on your home screen.

## Growing the word list

The word list lives inside `index.html` in the `WORDS` array (search for `/* --- WORD LIST ---`). Each entry looks like:

```js
{ no: "kaffe", en: "coffee", pos: "noun",
  example: "En kopp kaffe.", example_en: "A cup of coffee." },
```

To add words, just append more entries. The app handles any size list automatically. Good sources for a full top-1000 frequency list:

- The "5000 most common Norwegian words" frequency lists on sites like Wiktionary
- NoTeS (Norwegian Text Spelling) frequency corpora
- Anki community decks you can export as CSV and convert

## Updating after first install

After you push changes to GitHub, the service worker will serve the **old cached version** until it refreshes. To see updates:

- On iPhone: remove the home-screen icon and re-add it, OR bump the `CACHE` version string in `sw.js` (e.g. `'norsk-v1'` → `'norsk-v2'`) before pushing.
- On Android: usually updates within a day, or clear Chrome's site data for your URL.

Bumping the cache version in `sw.js` is the cleanest habit when you push a meaningful update.

## Privacy

Everything stays on your device. No accounts, no analytics, no servers. Your progress is saved in your browser's `localStorage` and never leaves your phone.