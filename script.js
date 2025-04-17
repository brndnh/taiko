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

const difficultyToggle = document.getElementById('tripletToggle');

// Hitsound
const hitRedAudio = document.getElementById('hitRedAudio');
const hitBlueAudio = document.getElementById('hitBlueAudio');
const soundToggle = document.getElementById('soundToggle');
hitRedAudio.volume = 0.3;
hitBlueAudio.volume = 0.3;


// Speed adjustments ─────────────────────────────────────────────────────────────
const speedInput = document.getElementById('speedInput');
const speedDisplay = document.getElementById('speedDisplay');
let circleSpeed = parseInt(speedInput.value, 10) || 10;

speedInput.addEventListener('input', () => {
    circleSpeed = parseInt(speedInput.value, 10);
    speedDisplay.textContent = circleSpeed;
});

// ── Key‐to‐color mappings ─────────────────────────────────────────────────────
const redKeys = new Set(['KeyF', 'KeyJ']);  // F or J = red
const blueKeys = new Set(['KeyD', 'KeyK']);  // D or K = blue

// Key counter connecting ─────────────────────────────────────────────────────────
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

// ── Game state ─────────────────────────────────────────────────────────────────
let bpm = 120;
let score = 0;
let activeCircles = [];
let beatInterval = null;
let songName = '';

// ── Event listeners ────────────────────────────────────────────────────────────
startButton.addEventListener('click', startGame);
stopButton.addEventListener('click', stopGame);

// Prevent holding a key from auto‑scoring
document.addEventListener('keydown', handleKeyDown);

// ── Game control functions ─────────────────────────────────────────────────────
function startGame() {
    resetKeyCounters();
    document.getElementById('gameplayDesktop').style.display = 'block';

    bpm = parseInt(bpmInput.value) || 120;
    songName = audioUpload.files[0]?.name || 'No Song';
    score = 0;
    updateScore();

    activeCircles.forEach(c => c.remove());
    activeCircles = [];

    bpmDisplay.textContent = bpm;
    songDisplay.textContent = songName;

    if (audioUpload.files[0]) {
        audioPlayer.src = URL.createObjectURL(audioUpload.files[0]);
        audioPlayer.play();
    }

    // stop spawning when the song ends:
    audioPlayer.addEventListener('ended', () => {
        clearInterval(beatInterval);
    });


    // spawn at steady BPM interval
    const tripletChance = 0.2;            // 20% of beats become triplets
    const interval = 60000 / bpm;

    const patterns = [
        { odds: 0.60, delays: [0] }, // single
        { odds: 0.35, delays: [0, interval / 2] }, // doubles
        { odds: 0.05, delays: [0, interval / 3, (2 * interval) / 3] } // triplets
    ];

    // helper to pick one
    function choosePattern() {
        const r = Math.random();
        let cum = 0;
        for (const p of patterns) {
            cum += p.odds;
            if (r < cum) return p.delays;
        }
        return patterns[0].delays;
    }

    beatInterval = setInterval(() => {
        if (!difficultyToggle.checked) {
            spawnCircle();
            return;
        }

        // pick 1,2 or 3 spawns
        const delays = choosePattern();
        for (const d of delays) {
            setTimeout(spawnCircle, d);
        }
    }, interval);

    startButton.disabled = true;
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

    if (colorToggle.checked) {
        // 60% red / 40% blue
        const color = (Math.random() < 0.60) ? 'red' : 'blue';
        circle.dataset.color = color;
        circle.style.backgroundColor = color;
    } else {
        // toggle is off → treat every circle as red
        circle.dataset.color = 'red';
        circle.style.backgroundColor = 'red';
    }

    gameContainer.appendChild(circle);
    activeCircles.push(circle);

    let position = window.innerWidth;
    circle.style.left = position + 'px';

    function animate() {
        position -= circleSpeed;
        circle.style.left = position + 'px';

        if (position < -150) {
            return removeCircle(circle);
        }
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

    let desiredColor = null;
    if (redKeys.has(e.code)) desiredColor = 'red';
    else if (blueKeys.has(e.code)) desiredColor = 'blue';
    else return;

    const zone = hitZone.getBoundingClientRect();
    for (const circle of activeCircles) {
        if (circle.dataset.color !== desiredColor) continue;
        const rect = circle.getBoundingClientRect();
        if (rect.left >= zone.left && rect.left <= zone.right) {
            // play the correct sound
            if (desiredColor === 'red') {
                if (soundToggle.checked) {
                    hitRedAudio.currentTime = 0;
                    hitRedAudio.play();
                }
            } else {
                if (soundToggle.checked) {
                    hitBlueAudio.currentTime = 0;
                    hitBlueAudio.play();
                }
            }

            // visual feedback + removal
            circle.classList.add('hit');
            setTimeout(() => removeCircle(circle), 100);

            // scoring
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
