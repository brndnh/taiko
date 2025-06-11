// script.js

// ── DOM references ─────────────────────────────────────────────────────────────
const bpmInput = document.getElementById('bpmInput');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const audioUpload = document.getElementById('audioUpload');
const colorToggle = document.getElementById('colorToggle');
const gameContainer = document.getElementById('gameContainer');
const hitZone = document.getElementById('hitzone');
const scoreDisplay = document.getElementById('score');
const songDisplay = document.getElementById('songName');
const bpmDisplay = document.getElementById('bpmDisplay');
const audioPlayer = document.getElementById('audioPlayer');

// set music volume
const volumeSlider = document.getElementById('volumeSlider');
const volumeDisplay = document.getElementById('volumeDisplay');

// initialize
audioPlayer.volume = parseFloat(volumeSlider.value);
volumeDisplay.textContent = `${Math.round(audioPlayer.volume * 100)}%`;

// update on slider move
volumeSlider.addEventListener('input', () => {
    const v = parseFloat(volumeSlider.value);
    audioPlayer.volume = v;
    volumeDisplay.textContent = `${Math.round(v * 100)}%`;
});

const offsetSlider = document.getElementById('offsetSlider');
const offsetDisplay = document.getElementById('offsetDisplay');

let circleOffset = parseInt(offsetSlider.value, 10);
let prevCircleOffset = circleOffset;

offsetSlider.addEventListener('input', () => {
    const newOffset = parseInt(offsetSlider.value, 10);
    const delta = newOffset - prevCircleOffset;

    // shift every currently active circle by that delta
    activeCircles.forEach(circle => {
        // parse out the current `left` (in px), add delta, and re‑apply
        const curLeft = parseFloat(circle.style.left);
        circle.style.left = (curLeft + delta) + 'px';
    });

    // update our trackers and UI
    circleOffset = newOffset;
    prevCircleOffset = newOffset;
    offsetDisplay.textContent = newOffset;
});

const difficultyToggle = document.getElementById('tripletToggle');
const hitRedAudio = document.getElementById('hitRedAudio');
const hitBlueAudio = document.getElementById('hitBlueAudio');
const soundToggle = document.getElementById('soundToggle');

// set hit‑sound volumes
const sfxSlider = document.getElementById('sfxSlider');
const sfxDisplay = document.getElementById('sfxDisplay');

// initialize both hit sounds
hitRedAudio.volume = parseFloat(sfxSlider.value);
hitBlueAudio.volume = parseFloat(sfxSlider.value);
sfxDisplay.textContent = `${Math.round(sfxSlider.value * 100)}%`;

// update on slider change
sfxSlider.addEventListener('input', () => {
    const v = parseFloat(sfxSlider.value);
    hitRedAudio.volume = v;
    hitBlueAudio.volume = v;
    sfxDisplay.textContent = `${Math.round(v * 100)}%`;
});


// Speed adjustments ─────────────────────────────────────────────────────────────
const speedInput = document.getElementById('speedInput');
const speedDisplay = document.getElementById('speedDisplay');
let circleSpeed = parseInt(speedInput.value, 10) || 10;
speedInput.addEventListener('input', () => {
    circleSpeed = parseInt(speedInput.value, 10);
    speedDisplay.textContent = circleSpeed;
});

// Key‑to‑color mappings ────────────────────────────────────────────────────────
const redKeys = new Set(['KeyF', 'KeyJ']);
const blueKeys = new Set(['KeyD', 'KeyK']);

// Key counters ─────────────────────────────────────────────────────────────────
const keyCounters = {
    KeyD: { el: document.getElementById('countD'), count: 0 },
    KeyF: { el: document.getElementById('countF'), count: 0 },
    KeyJ: { el: document.getElementById('countJ'), count: 0 },
    KeyK: { el: document.getElementById('countK'), count: 0 },
};
function resetKeyCounters() {
    for (const kc of Object.values(keyCounters)) {
        kc.count = 0;
        kc.el.textContent = '0';
    }
}

// Game state ───────────────────────────────────────────────────────────────────
let bpm = 120;
let score = 0;
let activeCircles = [];
let beatInterval = null;
let songName = '';

// spawn‑patterns (singles, doubles, triplets)
const patterns = () => {
    const interval = 60000 / bpm;
    return [
        { odds: 0.65, delays: [0] },
        { odds: 0.35, delays: [0, interval / 2] },
        { odds: 0.00, delays: [0, interval / 3, 2 * interval / 3] }
        // disabled triplets for now^^
    ];
};
function choosePattern() {
    const ps = patterns();
    const r = Math.random(), cum = { v: 0 };
    for (const p of ps) {
        cum.v += p.odds;
        if (r < cum.v) return p.delays;
    }
    return ps[0].delays;
}

// ── Beat‑offset detection ──────────────────────────────────────────────────────
async function detectFirstBeatOffset(file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new AudioContext();
    const audioBuf = await audioCtx.decodeAudioData(arrayBuffer);
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
    const threshold = maxEnergy * 0.1;
    const idx = energies.findIndex(e => e > threshold);
    return (idx * frameSize) / audioBuf.sampleRate;
}

// ── Event listeners ────────────────────────────────────────────────────────────
startButton.addEventListener('click', () => startGame().catch(console.error));
stopButton.addEventListener('click', stopGame);
document.addEventListener('keydown', handleKeyDown);

// ── Game control functions ─────────────────────────────────────────────────────
async function startGame() {
    resetKeyCounters();
    document.getElementById('gameplayDesktop').style.display = 'block';

    // Read BPM and reset score/UI
    bpm = parseInt(bpmInput.value) || 120;
    songName = audioUpload.files[0]?.name || 'Demo Mode';
    score = 0;
    updateScore();

    activeCircles.forEach(c => c.remove());
    activeCircles = [];

    bpmDisplay.textContent = bpm;
    songDisplay.textContent = songName;

    clearInterval(beatInterval);

    // audio file provided → do offset detection ----
    const file = audioUpload.files[0];
    if (file) {
        audioPlayer.src = URL.createObjectURL(file);
        await audioPlayer.play();                   // wait for playback start
        const offset = await detectFirstBeatOffset(file);

        // once currentTime hits that first‑beat offset, start spawns
        function onTimeUpdate() {
            if (audioPlayer.currentTime >= offset) {
                audioPlayer.removeEventListener('timeupdate', onTimeUpdate);

                // first beat
                spawnCircle();
                // then steady‑state
                const interval = 60000 / bpm;
                beatInterval = setInterval(spawnLoop, interval);
            }
        }
        audioPlayer.addEventListener('timeupdate', onTimeUpdate);
        audioPlayer.addEventListener('ended', () => clearInterval(beatInterval), { once: true });
    }

    // no audio → immediate demo mode ----
    else {
        spawnCircle();
        const interval = 60000 / bpm;
        beatInterval = setInterval(spawnLoop, interval);
    }

    startButton.disabled = true;
}

// helper to spawn with your patterns (singles/doubles/triplets)
function spawnLoop() {
    if (!difficultyToggle.checked) {
        spawnCircle();
    } else {
        choosePattern().forEach(d => setTimeout(spawnCircle, d));
    }
}

function stopGame() {
    resetKeyCounters();
    clearInterval(beatInterval);
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
    activeCircles.forEach(c => c.remove());
    activeCircles = [];
    score = 0;
    updateScore();
    startButton.disabled = false;
}

// ── Circle spawning & removal ─────────────────────────────────────────────────
function spawnCircle() {
    const circle = document.createElement('div');
    circle.classList.add('circle');

    // color logic
    const key = colorToggle.checked
        ? (Math.random() < 0.65 ? 'red' : 'blue')
        : 'red';
    circle.dataset.color = key;
    circle.style.backgroundColor = (key === 'red' ? '#f82f23' : '#56b4b2');

    gameContainer.appendChild(circle);
    activeCircles.push(circle);

    let x = window.innerWidth + circleOffset;
    circle.style.left = x + 'px';

    function animate() {
        x -= circleSpeed;
        circle.style.left = x + 'px';
        if (x < -150) return removeCircle(circle);
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
}

function removeCircle(circle) {
    activeCircles = activeCircles.filter(c => c !== circle);
    circle.remove();
}

// ── Hit detection ──────────────────────────────────────────────────────────────
function handleKeyDown(e) {
    if (e.repeat) return;
    const kc = keyCounters[e.code];
    if (kc) {
        kc.count++;
        kc.el.textContent = kc.count;
        kc.el.classList.add('flash');
        setTimeout(() => kc.el.classList.remove('flash'), 100);
    }

    let desired = null;
    if (redKeys.has(e.code)) desired = 'red';
    else if (blueKeys.has(e.code)) desired = 'blue';
    else return;

    const zone = hitZone.getBoundingClientRect();
    for (const circle of activeCircles) {
        if (circle.dataset.color !== desired) continue;
        const rect = circle.getBoundingClientRect();
        if (rect.left >= zone.left && rect.left <= zone.right) {
            // play sound
            if (soundToggle.checked) {
                const audio = (desired === 'red' ? hitRedAudio : hitBlueAudio);
                audio.currentTime = 0;
                audio.play();
            }
            // feedback + remove
            circle.classList.add('hit');
            setTimeout(() => removeCircle(circle), 100);
            score++;
            updateScore();
            break;
        }
    }
}

// ── UI updates ─────────────────────────────────────────────────────────────────
function updateScore() {
    scoreDisplay.innerText = `Score: ${score}`;
}
