// script.js
//
// The game runs off a precomputed chart: a list of notes, each with an exact
// time in seconds. Every frame, each note is positioned from the song's own
// clock (audio.currentTime), so notes can't drift and tempo changes are just
// different gaps between note times.

// ── DOM references ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const bpmInput = $('bpmInput');
const tempoChangesInput = $('tempoChanges');
const tempoError = $('tempoError');
const startButton = $('startButton');
const stopButton = $('stopButton');
const audioUpload = $('audioUpload');
const fileLabel = $('fileLabel');
const colorToggle = $('colorToggle');
const patternToggle = $('tripletToggle');
const soundToggle = $('soundToggle');
const autoplayToggle = $('autoplayToggle');
const autoBadge = $('autoBadge');
const headphoneToggle = $('headphoneToggle');
const headphoneHelp = $('headphoneHelp');
const gameContainer = $('gameContainer');
const notesLayer = $('notes');
const hitZone = $('hitzone');
const judgementEl = $('judgement');
const resultsEl = $('results');
const progressBar = $('progressBar');
const scoreDisplay = $('score');
const comboDisplay = $('combo');
const accuracyDisplay = $('accuracy');
const songDisplay = $('songName');
const bpmDisplay = $('bpmDisplay');
const audioPlayer = $('audioPlayer');
const hitRedAudio = $('hitRedAudio');
const hitBlueAudio = $('hitBlueAudio');

const volumeSlider = $('volumeSlider');
const volumeDisplay = $('volumeDisplay');
const sfxSlider = $('sfxSlider');
const sfxDisplay = $('sfxDisplay');
const offsetSlider = $('offsetSlider');
const offsetDisplay = $('offsetDisplay');
const speedInput = $('speedInput');
const speedDisplay = $('speedDisplay');

// ── Tuning ─────────────────────────────────────────────────────────────────────
const BASE_SCROLL_PX_PER_SEC = 700; // at 1.0x scroll speed
const GREAT_WINDOW = 0.05;          // seconds either side of the note
const GOOD_WINDOW = 0.11;
const LEAD_IN = 2;                  // seconds of silence before the song starts
const DEMO_LENGTH = 180;            // seconds of notes when no song is loaded
const SCORE_GREAT = 300;
const SCORE_GOOD = 100;
const TYPICAL_BLUETOOTH_DELAY = 0.2; // used when the browser can't report it

// ── Key mappings ───────────────────────────────────────────────────────────────
// D/K hit the rim (blue, "ka"), F/J hit the face (red, "don").
const keyMap = {
    KeyD: { color: 'blue', drum: '.drum-rim-left' },
    KeyF: { color: 'red', drum: '.drum-face-left' },
    KeyJ: { color: 'red', drum: '.drum-face-right' },
    KeyK: { color: 'blue', drum: '.drum-rim-right' },
};

const keyCounters = {};
for (const code of Object.keys(keyMap)) {
    keyCounters[code] = {
        el: document.querySelector(`.key[data-code="${code}"]`),
        countEl: $(`count${code.slice(3)}`),
        count: 0,
    };
}

function resetKeyCounters() {
    for (const kc of Object.values(keyCounters)) {
        kc.count = 0;
        kc.countEl.textContent = '0';
    }
}

// ── Settings (saved between visits) ────────────────────────────────────────────
const SETTINGS_KEY = 'taiko-settings';
const persisted = [bpmInput, colorToggle, patternToggle, soundToggle, autoplayToggle,
    headphoneToggle, volumeSlider, sfxSlider, offsetSlider, speedInput];

function loadSettings() {
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch { /* storage unavailable: use defaults */ }

    for (const el of persisted) {
        if (!(el.id in saved)) continue;
        if (el.type === 'checkbox') el.checked = saved[el.id];
        else el.value = saved[el.id];
    }
}

function saveSettings() {
    const data = {};
    for (const el of persisted) {
        data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    }
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch { /* storage unavailable: settings just won't persist */ }
}

persisted.forEach(el => el.addEventListener('change', saveSettings));
loadSettings();

// ── Slider wiring ──────────────────────────────────────────────────────────────
function applyVolume() {
    const v = parseFloat(volumeSlider.value);
    audioPlayer.volume = v;
    volumeDisplay.textContent = `${Math.round(v * 100)}%`;
}

function applySfxVolume() {
    const v = parseFloat(sfxSlider.value);
    hitRedAudio.volume = v;
    hitBlueAudio.volume = v;
    sfxDisplay.textContent = `${Math.round(v * 100)}%`;
}

function applyOffset() {
    const ms = parseInt(offsetSlider.value, 10);
    offsetDisplay.textContent = `${ms > 0 ? '+' : ''}${ms} ms`;
}

function applySpeed() {
    speedDisplay.textContent = `${parseFloat(speedInput.value).toFixed(1)}x`;
}

volumeSlider.addEventListener('input', applyVolume);
sfxSlider.addEventListener('input', applySfxVolume);
offsetSlider.addEventListener('input', applyOffset);
speedInput.addEventListener('input', applySpeed);
applyVolume();
applySfxVolume();
applyOffset();
applySpeed();

// ── Wireless headphone delay ───────────────────────────────────────────────────
// Bluetooth headphones play everything ~150–250 ms late. Web Audio can report
// the output device's latency; when it doesn't (or reports something too small
// to be Bluetooth), fall back to a typical value. Audio offset fine-tunes it.
let audioCtx = null;
let reportedLatency = 0;

async function measureOutputLatency() {
    audioCtx ??= new AudioContext();
    if (audioCtx.state !== 'running') await audioCtx.resume().catch(() => {});

    // outputLatency reads 0 until the device has actually started, so re-read
    // it a couple of times after resuming
    const read = () => {
        reportedLatency = (audioCtx.outputLatency || 0) + (audioCtx.baseLatency || 0);
        applyHeadphoneDelay();
    };
    read();
    setTimeout(read, 300);
    setTimeout(read, 1000);
}

function headphoneDelay() {
    if (!headphoneToggle.checked) return 0;
    return reportedLatency > 0.05 ? reportedLatency : TYPICAL_BLUETOOTH_DELAY;
}

function applyHeadphoneDelay() {
    const ms = Math.round(headphoneDelay() * 1000);
    if (!headphoneToggle.checked) {
        headphoneHelp.textContent = 'Delays notes to match Bluetooth audio lag.';
    } else if (reportedLatency > 0.05) {
        headphoneHelp.textContent = `Delaying notes ${ms} ms (reported by your audio device).`;
    } else {
        headphoneHelp.textContent = `Delaying notes ${ms} ms (typical for AirPods). Fine-tune with Audio offset.`;
    }
}

headphoneToggle.addEventListener('change', () => {
    applyHeadphoneDelay();
    if (headphoneToggle.checked) measureOutputLatency();
});
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    if (audioCtx) setTimeout(measureOutputLatency, 500);
});
applyHeadphoneDelay();

autoplayToggle.addEventListener('change', () => {
    autoBadge.hidden = !autoplayToggle.checked;
});
autoBadge.hidden = !autoplayToggle.checked;

// Read live so changes apply mid-song.
const manualOffsetSeconds = () => parseInt(offsetSlider.value, 10) / 1000;
const offsetSeconds = () => manualOffsetSeconds() + headphoneDelay();
const pxPerSecond = () => BASE_SCROLL_PX_PER_SEC * parseFloat(speedInput.value);

// ── Song loading ───────────────────────────────────────────────────────────────
let analysedFile = null;  // the File the cached analysis belongs to
let songAnalysis = null;  // Promise<{ firstBeat, duration }>
let currentSong = null;   // File (uploaded, or fetched from sample_songs/)

// Files in sample_songs/. Name them "bpm 174 Song Title.mp3" and the BPM is
// filled in automatically.
const SAMPLE_SONGS = [
    'bpm 135 Driftveil City - Pokémon OST.mp3',
    'bpm 149 ROSÉ & Bruno Mars - APT..mp3',
    'bpm 157 Creepy Nuts Bling-Bang-Bang-Born.mp3',
    'bpm 174 Try This.mp3',
    'bpm 174 Warak - Reanimate.mp3',
    'bpm 185 mesmerizer.mp3',
    'bpm 186 Kingslayer ft. BABYMETAL.mp3',
    "bpm 210 trinadtsat' karat - davay rasskazhem (ily Frenchcore Remix) (Sped Up Ver.).mp3",
    'bpm 240 Everything will freeze.mp3',
];

const bpmFromName = name => name.match(/bpm\s*(\d+(?:\.\d+)?)/i)?.[1];
const songTitle = name => name.replace(/\.[^.]+$/, '').replace(/^bpm\s*[\d.]+\s*/i, '');

function selectSong(file) {
    currentSong = file;
    songDisplay.textContent = songTitle(file.name);

    const bpm = bpmFromName(file.name);
    if (bpm) {
        bpmInput.value = bpm;
        bpmDisplay.textContent = bpm;
        saveSettings();
    }

    // decode in the background so Start is instant
    analyseSong(file).catch(console.error);
}

audioUpload.addEventListener('change', () => {
    const file = audioUpload.files[0];
    if (!file) return;

    fileLabel.textContent = file.name;
    fileLabel.parentElement.classList.add('loaded');
    songPickerLabel.textContent = 'Choose a sample song';
    markCurrentSample(null);
    selectSong(file);
});

// ── Sample song dropdown ───────────────────────────────────────────────────────
const songPickerButton = $('songPickerButton');
const songPickerLabel = $('songPickerLabel');
const songMenu = $('songMenu');

for (const name of SAMPLE_SONGS) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-item';
    button.dataset.name = name;

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = songTitle(name);
    const bpm = document.createElement('span');
    bpm.className = 'bpm';
    bpm.textContent = `${bpmFromName(name) ?? '?'} BPM`;

    button.append(title, bpm);
    button.addEventListener('click', () => loadSample(name));
    item.append(button);
    songMenu.append(item);
}

const menuItems = () => [...songMenu.querySelectorAll('.menu-item')];

function setMenuOpen(open) {
    songMenu.hidden = !open;
    songPickerButton.setAttribute('aria-expanded', String(open));
    if (open) {
        (songMenu.querySelector('[aria-current="true"]') ?? menuItems()[0]).focus();
    }
}

function markCurrentSample(name) {
    for (const item of menuItems()) {
        item.setAttribute('aria-current', String(item.dataset.name === name));
    }
}

songPickerButton.addEventListener('click', () => setMenuOpen(songMenu.hidden));

document.addEventListener('click', e => {
    if (!songMenu.hidden && !e.target.closest('.song-picker')) setMenuOpen(false);
});

songMenu.addEventListener('keydown', e => {
    const items = menuItems();
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') items[Math.min(i + 1, items.length - 1)].focus();
    else if (e.key === 'ArrowUp') items[Math.max(i - 1, 0)].focus();
    else if (e.key === 'Escape') {
        setMenuOpen(false);
        songPickerButton.focus();
    } else return;
    e.preventDefault();
});

async function loadSample(name) {
    setMenuOpen(false);
    songPickerLabel.textContent = 'Loading…';

    try {
        // macOS may store accented filenames decomposed (NFD); servers differ
        // on whether they match the composed (NFC) spelling, so try both.
        let res;
        for (const form of ['NFC', 'NFD']) {
            res = await fetch(`sample_songs/${encodeURIComponent(name.normalize(form))}`);
            if (res.ok) break;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const file = new File([await res.blob()], name, { type: 'audio/mpeg' });
        songPickerLabel.textContent = songTitle(name);
        fileLabel.textContent = 'Upload your own audio file…';
        fileLabel.parentElement.classList.remove('loaded');
        audioUpload.value = '';
        markCurrentSample(name);
        selectSong(file);
    } catch (err) {
        console.error(err);
        songPickerLabel.textContent = "Couldn't load that song";
    }
}

// Cached per file, including while the decode is still running.
function analyseSong(file) {
    if (analysedFile !== file) {
        analysedFile = file;
        songAnalysis = decodeAndAnalyse(file).catch(err => {
            analysedFile = null; // let the next attempt retry
            throw err;
        });
    }
    return songAnalysis;
}

async function decodeAndAnalyse(file) {
    audioCtx ??= new AudioContext();
    const audioBuf = await audioCtx.decodeAudioData(await file.arrayBuffer());
    return {
        firstBeat: detectFirstBeatOffset(audioBuf),
        duration: audioBuf.duration,
    };
}

// First frame whose energy passes 10% of the loudest frame.
function detectFirstBeatOffset(audioBuf) {
    const data = audioBuf.getChannelData(0);
    const frameSize = 2048;
    const energies = [];

    for (let i = 0; i < data.length; i += frameSize) {
        let sum = 0;
        for (let j = 0; j < frameSize && i + j < data.length; j++) {
            sum += data[i + j] * data[i + j];
        }
        energies.push(sum);
    }

    const maxEnergy = Math.max(...energies);
    const idx = energies.findIndex(e => e > maxEnergy * 0.1);
    return (Math.max(idx, 0) * frameSize) / audioBuf.sampleRate;
}

// ── Chart generation ───────────────────────────────────────────────────────────
// Parses "1:32 180, 2:10.5 150" (or "92=180") into [{ time, bpm }].
function parseTempoChanges(text) {
    const changes = [];
    const entry = /^(\d+:\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*[=@]\s*|\s+)(\d+(?:\.\d+)?)(?:\s*bpm)?$/i;

    for (const raw of text.split(/[,;\n]+/)) {
        const part = raw.trim();
        if (!part) continue;

        const m = part.match(entry);
        if (!m) throw new Error(`Couldn't read "${part}". Use a time and a BPM, like "1:32 180".`);

        const [min, sec] = m[1].includes(':') ? m[1].split(':') : ['0', m[1]];
        const time = parseInt(min, 10) * 60 + parseFloat(sec);
        const bpm = parseFloat(m[2]);
        if (bpm < 30 || bpm > 400) throw new Error(`BPM ${bpm} at ${m[1]} is outside 30–400.`);

        changes.push({ time, bpm });
    }
    return changes.sort((a, b) => a.time - b.time);
}

// Each timing point starts a fresh beat grid, like an osu! timing point.
function buildTimingPoints(firstBeat, baseBpm, changes) {
    return [
        { time: firstBeat, bpm: baseBpm },
        ...changes.filter(c => c.time > firstBeat),
    ];
}

function generateBeats(timingPoints, endTime) {
    const beats = [];
    timingPoints.forEach((tp, i) => {
        const segmentEnd = Math.min(timingPoints[i + 1]?.time ?? Infinity, endTime);
        const beatLength = 60 / tp.bpm;
        for (let t = tp.time; t < segmentEnd - 1e-6; t += beatLength) {
            beats.push({ time: t, beatLength, segmentEnd });
        }
    });
    return beats;
}

// Singles on every beat; with patterns on, some beats become doubles.
// Triplets ({ delays: [0, 1/3, 2/3] }) are still disabled for now.
const patterns = [
    { odds: 0.65, delays: [0] },
    { odds: 0.35, delays: [0, 0.5] },
];

function choosePattern() {
    let r = Math.random();
    for (const p of patterns) {
        if (r < p.odds) return p.delays;
        r -= p.odds;
    }
    return patterns[0].delays;
}

function chooseColor() {
    if (!colorToggle.checked) return 'red';
    return Math.random() < 0.65 ? 'red' : 'blue';
}

function generateNotes(beats) {
    const notes = [];
    for (const beat of beats) {
        const delays = patternToggle.checked ? choosePattern() : [0];
        for (const d of delays) {
            const time = beat.time + d * beat.beatLength;
            if (time >= beat.segmentEnd) break;
            notes.push({ time, color: chooseColor(), el: null, judged: null });
        }
    }
    return notes;
}

// ── Game state ─────────────────────────────────────────────────────────────────
let game = null;

function newGame(notes, { hasAudio, duration }) {
    return {
        notes,
        hasAudio,
        duration,
        startPerf: performance.now(),
        audioStarted: false,
        lastAudioTime: -1,
        lastAudioPerf: 0,
        lastTime: -Infinity,
        nextToSpawn: 0,   // index of the next note without an element yet
        firstPending: 0,  // index of the earliest note not yet judged
        nextAutoSound: 0, // autoplay: index of the next note to play a sound for
        usedAutoplay: false,
        score: 0,
        combo: 0,
        maxCombo: 0,
        counts: { great: 0, good: 0, miss: 0 },
        finished: false,
        rafId: 0,
    };
}

// Song time in seconds: negative during the lead-in, then the audio clock.
// audio.currentTime only updates every few ms in some browsers, so we
// interpolate between updates with performance.now() for smooth scrolling.
function songTime() {
    const now = performance.now();

    if (!game.hasAudio || !game.audioStarted) {
        return (now - game.startPerf) / 1000 - LEAD_IN;
    }

    const t = audioPlayer.currentTime;
    if (t !== game.lastAudioTime) {
        game.lastAudioTime = t;
        game.lastAudioPerf = now;
    }
    if (audioPlayer.paused) return t;

    const interpolated = t + (now - game.lastAudioPerf) / 1000;
    // don't let interpolation overshoot and then jump backwards
    return Math.min(interpolated, t + 0.1);
}

// ── Game control ───────────────────────────────────────────────────────────────
startButton.addEventListener('click', () => startGame().catch(err => {
    console.error(err);
    startButton.disabled = false;
    startButton.textContent = 'Start';
}));
stopButton.addEventListener('click', stopGame);
document.addEventListener('keydown', handleKeyDown);

async function startGame() {
    let changes;
    try {
        changes = parseTempoChanges(tempoChangesInput.value);
        tempoError.hidden = true;
    } catch (err) {
        tempoError.textContent = err.message;
        tempoError.hidden = false;
        return;
    }

    stopGame();
    startButton.disabled = true;
    if (headphoneToggle.checked) measureOutputLatency();

    const bpm = parseFloat(bpmInput.value) || 120;
    const file = currentSong;

    let firstBeat = 0;
    let duration = DEMO_LENGTH;
    if (file) {
        startButton.textContent = 'Loading…';
        ({ firstBeat, duration } = await analyseSong(file));
        if (audioPlayer.src) URL.revokeObjectURL(audioPlayer.src);
        audioPlayer.src = URL.createObjectURL(file);
        audioPlayer.currentTime = 0;
    }
    startButton.textContent = 'Start';

    const timingPoints = buildTimingPoints(firstBeat, bpm, changes);
    const notes = generateNotes(generateBeats(timingPoints, duration));

    songDisplay.textContent = file ? songTitle(file.name) : 'Demo mode';
    bpmDisplay.textContent = bpm;

    game = newGame(notes, { hasAudio: Boolean(file), duration });
    game.timingPoints = timingPoints;
    updateStats();
    game.rafId = requestAnimationFrame(frame);
}

function stopGame() {
    if (game) cancelAnimationFrame(game.rafId);
    game = null;

    audioPlayer.pause();
    audioPlayer.currentTime = 0;
    notesLayer.replaceChildren();
    resultsEl.hidden = true;
    progressBar.style.width = '0';
    resetKeyCounters();
    scoreDisplay.textContent = '0';
    comboDisplay.textContent = '0';
    comboDisplay.classList.add('zero');
    accuracyDisplay.textContent = '100%';
    startButton.disabled = false;
}

// ── Frame loop ─────────────────────────────────────────────────────────────────
function frame() {
    const g = game;
    if (!g) return;

    if (g.hasAudio && !g.audioStarted && songTime() >= 0) {
        g.audioStarted = true;
        audioPlayer.play().catch(console.error);
    }

    const t = songTime();
    const offset = offsetSeconds();
    const speed = pxPerSecond();
    const hitX = hitZone.offsetLeft;
    const rightEdge = gameContainer.clientWidth + hitZone.offsetWidth;

    // live BPM readout follows the active timing point
    const tp = g.timingPoints.findLast(p => p.time <= Math.max(t, 0)) ?? g.timingPoints[0];
    if (bpmDisplay.textContent !== String(tp.bpm)) bpmDisplay.textContent = tp.bpm;

    if (autoplayToggle.checked) autoplay(g, t, offset);

    // notes that scrolled past the hit window are misses
    while (g.firstPending < g.notes.length) {
        const note = g.notes[g.firstPending];
        if (note.judged) { g.firstPending++; continue; }
        if (t - (note.time + offset) <= GOOD_WINDOW) break;
        judge(note, 'miss');
        g.firstPending++;
    }

    // create elements for notes about to enter from the right
    while (g.nextToSpawn < g.notes.length) {
        const note = g.notes[g.nextToSpawn];
        const x = hitX + (note.time + offset - t) * speed;
        if (x > rightEdge) break;
        note.el = document.createElement('div');
        note.el.className = `note ${note.color}`;
        // prepend so earlier notes draw on top of later ones
        notesLayer.prepend(note.el);
        g.nextToSpawn++;
    }

    // position every live note from the song clock
    for (let i = g.firstPending - 1; i >= 0 && i >= g.firstPending - 50; i--) {
        placeNote(g.notes[i], t, offset, speed, hitX);
    }
    for (let i = g.firstPending; i < g.nextToSpawn; i++) {
        placeNote(g.notes[i], t, offset, speed, hitX);
    }

    progressBar.style.width = `${Math.min(Math.max(t / g.duration, 0), 1) * 100}%`;

    const songOver = g.hasAudio ? audioPlayer.ended : t > g.duration;
    if (!g.finished && g.firstPending >= g.notes.length && (songOver || t > g.duration - 0.5)) {
        g.finished = true;
        showResults();
    }

    g.rafId = requestAnimationFrame(frame);
}

// Auto play hits each note when it reaches the hit zone. Its hit sound is sent
// earlier, by the headphone delay, so you hear it land with the music.
const autoKeys = { red: ['KeyF', 'KeyJ'], blue: ['KeyD', 'KeyK'] };

function autoplay(g, t, offset) {
    g.usedAutoplay = true;

    const soundOffset = offset - headphoneDelay();
    while (g.nextAutoSound < g.notes.length && g.notes[g.nextAutoSound].time + soundOffset <= t) {
        const note = g.notes[g.nextAutoSound++];
        if (!note.judged) playHitSound(note.color);
    }

    for (let i = g.firstPending; i < g.notes.length; i++) {
        const note = g.notes[i];
        if (note.time + offset > t) break;
        if (note.judged) continue;
        // alternate hands, like a player would
        const keys = autoKeys[note.color];
        keys.reverse();
        pressKey(keys[0], { sound: false });
    }
}

function placeNote(note, t, offset, speed, hitX) {
    if (!note.el) return;
    const x = hitX + (note.time + offset - t) * speed;
    if (x < -hitZone.offsetWidth) {
        note.el.remove();
        note.el = null;
        return;
    }
    if (note.judged !== 'hit') note.el.style.transform = `translateX(${x}px)`;
}

// ── Input & judging ────────────────────────────────────────────────────────────
function handleKeyDown(e) {
    if (!keyMap[e.code] || e.repeat) return;
    if (e.target.matches?.('input[type="number"], textarea')) return;
    // while auto play is on, your presses still flash and sound but don't score
    pressKey(e.code, { judge: !autoplayToggle.checked });
}

function playHitSound(color) {
    if (!soundToggle.checked) return;
    const audio = color === 'red' ? hitRedAudio : hitBlueAudio;
    audio.currentTime = 0;
    audio.play().catch(() => {});
}

function pressKey(code, { sound = true, judge: shouldJudge = true } = {}) {
    const key = keyMap[code];
    const kc = keyCounters[code];
    kc.count++;
    kc.countEl.textContent = kc.count;
    flash(kc.el);
    flash(hitZone.querySelector(key.drum), 'active');
    if (sound) playHitSound(key.color);

    if (!game || game.finished || !shouldJudge) return;

    // earliest unjudged note of this color inside the hit window
    const t = songTime();
    const offset = offsetSeconds();
    for (let i = game.firstPending; i < game.notes.length; i++) {
        const note = game.notes[i];
        const delta = t - (note.time + offset);
        if (delta < -GOOD_WINDOW) break;
        if (note.judged || note.color !== key.color) continue;

        judge(note, Math.abs(delta) <= GREAT_WINDOW ? 'great' : 'good');
        return;
    }
}

function judge(note, result) {
    const g = game;
    g.counts[result]++;

    if (result === 'miss') {
        note.judged = 'miss';
        note.el?.classList.add('missed');
        g.combo = 0;
    } else {
        note.judged = 'hit';
        g.score += result === 'great' ? SCORE_GREAT : SCORE_GOOD;
        g.combo++;
        g.maxCombo = Math.max(g.maxCombo, g.combo);
        if (note.el) {
            const el = note.el;
            el.style.transform = `translateX(${hitZone.offsetLeft}px)`;
            el.classList.add('hit');
            note.el = null;
            setTimeout(() => el.remove(), 160);
        }
    }

    showJudgement(result);
    updateStats();
}

function accuracy() {
    const { great, good, miss } = game.counts;
    const total = great + good + miss;
    return total ? (great + good * 0.5) / total : 1;
}

function updateStats() {
    scoreDisplay.textContent = game.score.toLocaleString();
    if (comboDisplay.textContent !== String(game.combo)) {
        comboDisplay.textContent = game.combo;
        comboDisplay.classList.toggle('zero', game.combo === 0);
        comboDisplay.classList.remove('bump');
        if (game.combo > 0) {
            void comboDisplay.offsetWidth; // restart the animation
            comboDisplay.classList.add('bump');
        }
    }
    accuracyDisplay.textContent = `${(accuracy() * 100).toFixed(1)}%`;
}

function showJudgement(result) {
    judgementEl.textContent = result;
    judgementEl.className = `judgement ${result}`;
    void judgementEl.offsetWidth; // restart the animation
    judgementEl.classList.add('show');
}

function showResults() {
    $('resTitle').textContent = game.usedAutoplay ? 'Results (auto play)' : 'Results';
    $('resScore').textContent = game.score.toLocaleString();
    $('resAccuracy').textContent = `${(accuracy() * 100).toFixed(1)}%`;
    $('resCombo').textContent = game.maxCombo;
    $('resGreat').textContent = game.counts.great;
    $('resGood').textContent = game.counts.good;
    $('resMiss').textContent = game.counts.miss;
    resultsEl.hidden = false;
    startButton.disabled = false;
}

function flash(el, cls = 'flash') {
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 90);
}
