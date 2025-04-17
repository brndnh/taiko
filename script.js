const bpmInput = document.getElementById('bpmInput');
const startButton = document.getElementById('startButton');
const gameContainer = document.getElementById('gameContainer');

let bpm = 120; // Default BPM
let beatInterval;
let score = 0;
let activeCircles = []; // Store circles for keypress detection

startButton.addEventListener('click', () => {
    bpm = parseInt(bpmInput.value) || 120;
    startGame();
});

function startGame() {
    clearInterval(beatInterval);
    score = 0;
    updateScore();
    activeCircles = [];

    const interval = 60000 / bpm;
    beatInterval = setInterval(spawnCircle, interval);

    // Create the hitzone if it doesn't exist
    let hitZoneElement = document.getElementById('hitzone');
    if (!hitZoneElement) {
        hitZoneElement = document.createElement('div');
        hitZoneElement.id = 'hitzone';
        gameContainer.appendChild(hitZoneElement);
    }
}

// Spawn a circle from the right and move left
function spawnCircle() {
    const circle = document.createElement('div');
    circle.classList.add('circle');
    gameContainer.appendChild(circle);

    let position = window.innerWidth;
    circle.style.left = position + "px";

    activeCircles.push(circle); // Store active circles for keypress handling

    function animate() {
        if (position < -150) {
            removeCircle(circle);
            return;
        }
        position -= 15;
        circle.style.left = position + "px";
        requestAnimationFrame(animate);
    }
    
    animate();
}

// Remove circle from the game and activeCircles array
function removeCircle(circle) {
    activeCircles = activeCircles.filter(c => c !== circle);
    circle.remove();
}

// Handle keypress events
document.addEventListener('keydown', () => {
    const hitZone = document.getElementById('hitzone').getBoundingClientRect();

    activeCircles.forEach(circle => {
        const circlePos = circle.getBoundingClientRect();
        if (circlePos.left >= hitZone.left && circlePos.left <= hitZone.right) {
            score++;
            updateScore();
            circle.style.backgroundColor = "white";
            setTimeout(() => removeCircle(circle), 100);
        }
    });
});

// Update score display
function updateScore() {
    let scoreDisplay = document.getElementById('score');
    if (!scoreDisplay) {
        scoreDisplay = document.createElement('div');
        scoreDisplay.id = 'score';
        scoreDisplay.style.position = 'absolute';
        scoreDisplay.style.top = '20px';
        scoreDisplay.style.left = '20px';
        scoreDisplay.style.color = 'white';
        scoreDisplay.style.fontSize = '24px';
        document.body.appendChild(scoreDisplay);
    }
    scoreDisplay.innerText = `Score: ${score}`;
}
