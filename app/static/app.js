/* ═══════════════════════════════════════════════════════════════════
   WIKANG SENYAS – FSL Detection System
   Single Page Application Logic
   ═══════════════════════════════════════════════════════════════════ */

// ── Dictionary Data ──────────────────────────────────────────────────
const DICTIONARY = [
    { id: '1', phrase: 'Magandang Umaga', description: 'Good Morning. Used to greet someone in the morning.', gif: '/static/images/MagandangUmaga-ezgif.com-video-to-gif-converter.gif' },
    { id: '2', phrase: 'Magandang Hapon', description: 'Good Afternoon. Used to greet someone in the afternoon.', gif: '/static/images/MagandangHapon-ezgif.com-video-to-gif-converter.gif' },
    { id: '3', phrase: 'Magandang Gabi', description: 'Good Evening. Used to greet someone in the evening.', gif: '/static/images/MagandangGabi-ezgif.com-video-to-gif-converter.gif' },
    { id: '4', phrase: 'Ingat', description: 'Take care. Often used when someone is leaving.', gif: '/static/images/Ingat-ezgif.com-video-to-gif-converter.gif' },
    { id: '5', phrase: 'Mahal Kita', description: 'I love you. Expressing affection.', gif: '/static/images/MahalKita-ezgif.com-video-to-gif-converter.gif' },
    { id: '6', phrase: 'Paalam', description: 'Goodbye. Farewell.', gif: '/static/images/Paalam-ezgif.com-video-to-gif-converter.gif' },
];

const SEQUENCE_LENGTH = 30;

// ── State ────────────────────────────────────────────────────────────
let currentScreen = 'home';
let sliderIndex = 0;
let sliderTimer = null;

// Detector state
let videoStream = null;
let isDetecting = false;
let isProcessing = false;
let frameBuffer = [];
let detectedWords = [];
let liveWord = null;
let liveConfidence = 0;
let captureInterval = null;

// Settings (from localStorage)
let settings = {
    autoSpeak: false,
    slowSpeech: true,
    vibrationEnabled: true,
};

// ── Navigation ───────────────────────────────────────────────────────
function navigate(screen) {
    // Clean up detector when leaving
    if (currentScreen === 'detector' && screen !== 'detector') {
        stopDetection();
        stopCamera();
    }

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + screen).classList.add('active');
    currentScreen = screen;

    // Initialize screen-specific content
    if (screen === 'home') initHomeSlider();
    if (screen === 'detector') initDetector();
    if (screen === 'dictionary') renderDictionary();
    if (screen === 'settings') renderSettings();
    if (screen === 'profile') renderProfile();
    if (screen === 'manual') renderManual();

    // Update bottom nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navMap = { home: 0, settings: 1, profile: 2 };
    if (navMap[screen] !== undefined) {
        document.querySelectorAll('.nav-item')[navMap[screen]].classList.add('active');
    }
}

// ── Home Slider ──────────────────────────────────────────────────────
function initHomeSlider() {
    clearInterval(sliderTimer);
    sliderIndex = 0;
    updateSlider();

    const dotsEl = document.getElementById('slider-dots');
    dotsEl.innerHTML = '';
    for (let i = 0; i < 3; i++) {
        const d = document.createElement('button');
        d.className = 'slider-dot' + (i === 0 ? ' active' : '');
        d.onclick = () => { sliderIndex = i; updateSlider(); };
        dotsEl.appendChild(d);
    }

    sliderTimer = setInterval(() => {
        sliderIndex = (sliderIndex + 1) % 3;
        updateSlider();
    }, 3000);
}

function updateSlider() {
    const track = document.getElementById('slider-track');
    if (track) track.style.transform = `translateX(-${sliderIndex * 100}%)`;
    document.querySelectorAll('.slider-dot').forEach((d, i) => {
        d.classList.toggle('active', i === sliderIndex);
    });
}

// ══════════════════════════════════════════════════════════════════════
//  DETECTOR
// ══════════════════════════════════════════════════════════════════════

async function initDetector() {
    renderDetectorControls();
    renderPredictionArea();
    await startCamera();
}

async function startCamera() {
    try {
        const video = document.getElementById('camera-video');
        if (videoStream) {
            videoStream.getTracks().forEach(t => t.stop());
        }
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        video.srcObject = videoStream;
    } catch (e) {
        console.error('Camera error:', e);
    }
}

function stopCamera() {
    if (videoStream) {
        videoStream.getTracks().forEach(t => t.stop());
        videoStream = null;
    }
    const video = document.getElementById('camera-video');
    if (video) video.srcObject = null;
}

function toggleCamera() {
    const wasDetecting = isDetecting;
    if (wasDetecting) stopDetection();

    const video = document.getElementById('camera-video');
    const currentFacing = video?.srcObject?.getVideoTracks()[0]?.getSettings()?.facingMode;
    const newFacing = currentFacing === 'user' ? 'environment' : 'user';

    if (videoStream) videoStream.getTracks().forEach(t => t.stop());

    navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
    }).then(stream => {
        videoStream = stream;
        video.srcObject = stream;
        if (wasDetecting) startDetection();
    }).catch(e => console.error('Camera toggle error:', e));
}

function startDetection() {
    if (!videoStream) return;
    frameBuffer = [];
    liveWord = null;
    liveConfidence = 0;
    isDetecting = true;
    isProcessing = false;

    const recInd = document.getElementById('rec-indicator');
    recInd.classList.remove('hidden');

    renderDetectorControls();
    renderPredictionArea();

    // Capture a frame every ~200ms (5fps) to build buffer of 30 frames
    captureInterval = setInterval(() => {
        if (!isDetecting) return;
        captureFrame();
    }, 200);
}

function stopDetection() {
    isDetecting = false;
    isProcessing = false;
    clearInterval(captureInterval);
    captureInterval = null;
    frameBuffer = [];
    liveWord = null;
    liveConfidence = 0;

    const recInd = document.getElementById('rec-indicator');
    if (recInd) recInd.classList.add('hidden');

    renderDetectorControls();
    renderPredictionArea();
}

function captureFrame() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('capture-canvas');
    if (!video || !canvas || video.readyState < 2) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const jpegBase64 = canvas.toDataURL('image/jpeg', 0.7);
    frameBuffer.push(jpegBase64);

    // Keep only last SEQUENCE_LENGTH frames (sliding window)
    if (frameBuffer.length > SEQUENCE_LENGTH) {
        frameBuffer.shift();
    }

    // Update UI
    const bufferReady = frameBuffer.length >= SEQUENCE_LENGTH;
    const recDot = document.getElementById('rec-dot');
    const recText = document.getElementById('rec-text');
    if (recDot) {
        recDot.className = 'rec-dot ' + (bufferReady ? 'detecting' : 'buffering');
    }
    if (recText) {
        recText.textContent = bufferReady ? 'Detecting...' : `Buffering... ${frameBuffer.length}/${SEQUENCE_LENGTH}`;
    }

    renderPredictionArea();

    // When buffer is full, predict
    if (bufferReady && !isProcessing) {
        predictFromBuffer();
    }
}

async function predictFromBuffer() {
    if (isProcessing || frameBuffer.length < SEQUENCE_LENGTH) return;
    isProcessing = true;

    const frames = frameBuffer.slice(-SEQUENCE_LENGTH).map(b64 => ({ base64_data: b64 }));

    try {
        const resp = await fetch('/predict_web_frames', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frames })
        });

        if (!resp.ok) {
            const err = await resp.json();
            console.error('Prediction error:', err);
            isProcessing = false;
            return;
        }

        const result = await resp.json();
        liveWord = result.label;
        liveConfidence = result.confidence;

        renderPredictionArea();

        if (result.confidence > 0.85) {
            if (detectedWords.length === 0 || detectedWords[detectedWords.length - 1] !== result.label) {
                detectedWords.push(result.label);
                saveToHistory(result.label);
                renderWordsArea();

                if (settings.autoSpeak) speakText(result.label);
                if (settings.vibrationEnabled && navigator.vibrate) navigator.vibrate(100);
            }
        }

        // Reset buffer to collect fresh frames
        frameBuffer = [];
    } catch (e) {
        console.error('Prediction fetch error:', e);
    }

    isProcessing = false;
}

function renderPredictionArea() {
    const el = document.getElementById('prediction-area');
    if (!el) return;

    if (liveWord && frameBuffer.length >= SEQUENCE_LENGTH) {
        el.innerHTML = `
      <div class="section-label">CURRENT PREDICTION</div>
      <div class="prediction-box">
        <span class="prediction-label">${liveWord}</span>
        <span class="prediction-confidence">${Math.round(liveConfidence * 100)}%</span>
      </div>`;
    } else if (isDetecting && frameBuffer.length < SEQUENCE_LENGTH) {
        const pct = (frameBuffer.length / SEQUENCE_LENGTH * 100).toFixed(0);
        el.innerHTML = `
      <div class="section-label">BUFFER STATUS</div>
      <div class="buffer-box">
        <div class="buffer-text">Building detection buffer...</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="buffer-count">${frameBuffer.length}/${SEQUENCE_LENGTH} frames</div>
      </div>`;
    } else {
        el.innerHTML = '';
    }
}

function renderWordsArea() {
    const area = document.getElementById('words-area');
    const countEl = document.getElementById('word-count');
    if (!area) return;

    if (detectedWords.length === 0) {
        area.innerHTML = '<div class="empty-words"><span class="material-icons">back_hand</span><span>No words detected yet</span></div>';
        if (countEl) countEl.classList.add('hidden');
    } else {
        area.innerHTML = '<div class="word-chips">' + detectedWords.map(w => `<span class="word-chip">${w}</span>`).join('') + '</div>';
        if (countEl) {
            countEl.textContent = detectedWords.length;
            countEl.classList.remove('hidden');
        }
    }
}

function renderDetectorControls() {
    const bar = document.getElementById('controls-bar');
    if (!bar) return;

    if (!isDetecting) {
        bar.innerHTML = `
      <button class="ctrl-btn green" onclick="startDetection()">
        <span class="material-icons">play_arrow</span> Start Detection
      </button>
      <button class="ctrl-btn blue-outline" onclick="speakDetectedWords()">
        <span class="material-icons">volume_up</span>
      </button>
      <button class="ctrl-btn blue-outline" onclick="clearDetectedWords()">
        <span class="material-icons">delete_outline</span>
      </button>`;
    } else {
        bar.innerHTML = `
      <button class="ctrl-btn red" onclick="stopDetection()">
        <span class="material-icons">stop</span> Stop
      </button>
      <button class="ctrl-btn blue-outline" onclick="speakDetectedWords()">
        <span class="material-icons">volume_up</span>
      </button>
      <button class="ctrl-btn blue-outline" onclick="clearDetectedWords()">
        <span class="material-icons">delete_outline</span>
      </button>`;
    }
}

function clearDetectedWords() {
    detectedWords = [];
    renderWordsArea();
}

function speakDetectedWords() {
    if (detectedWords.length === 0) return;
    speakText(detectedWords[detectedWords.length - 1]);
}

// ══════════════════════════════════════════════════════════════════════
//  DICTIONARY
// ══════════════════════════════════════════════════════════════════════

function renderDictionary() {
    const query = (document.getElementById('dict-search')?.value || '').toLowerCase();
    const filtered = DICTIONARY.filter(d => d.phrase.toLowerCase().includes(query));

    const countEl = document.getElementById('results-count');
    countEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'phrase' : 'phrases'} found`;

    const listEl = document.getElementById('dict-list');
    listEl.innerHTML = filtered.map((item, i) => `
    <div class="dict-item" onclick="showDictModal('${item.id}')">
      <div class="dict-num">${i + 1}</div>
      <div class="dict-phrase">${item.phrase}</div>
      <span class="material-icons" style="color:var(--blue-primary);font-size:22px;">chevron_right</span>
    </div>`).join('');

    // Show/hide clear button
    const clearBtn = document.getElementById('search-clear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !query);
}

function filterDictionary() { renderDictionary(); }

function clearSearch() {
    document.getElementById('dict-search').value = '';
    renderDictionary();
}

function showDictModal(id) {
    const item = DICTIONARY.find(d => d.id === id);
    if (!item) return;

    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:12px;flex:1;">
          <span class="modal-phrase">${item.phrase}</span>
          <button class="modal-speak-btn" onclick="speakText('${item.phrase}')">
            <span class="material-icons" style="font-size:18px;">volume_up</span>
          </button>
        </div>
        <button class="modal-close-btn" onclick="closeModal()">
          <span class="material-icons">close</span>
        </button>
      </div>
      <div class="modal-gif-container">
        <img src="${item.gif}" alt="${item.phrase}" onerror="this.style.display='none'">
        <div class="modal-gif-label">Animation Guide</div>
      </div>
      <div class="modal-desc">
        <div class="modal-desc-label">DESCRIPTION</div>
        <div class="modal-desc-text">${item.description}</div>
      </div>
      <button class="modal-practice-btn" onclick="closeModal(); navigate('detector');">Practice This Sign</button>
    </div>`;
}

function closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('modal-overlay').classList.add('hidden');
}

// ══════════════════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════════════════

function renderSettings() {
    loadSettings();
    const el = document.getElementById('settings-content');
    el.innerHTML = `
    <div class="settings-section-label">VOICE SETTINGS</div>
    <div class="settings-card">
      <div class="settings-tile">
        <div class="tile-icon" style="background:#22C55E"><span class="material-icons">back_hand</span></div>
        <div class="tile-text">
          <div class="tile-title">Auto Speak</div>
          <div class="tile-sub">Automatically speak detected signs</div>
        </div>
        <label class="toggle">
          <input type="checkbox" ${settings.autoSpeak ? 'checked' : ''} onchange="updateSetting('autoSpeak', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="settings-tile">
        <div class="tile-icon" style="background:#F59E0B"><span class="material-icons">volume_up</span></div>
        <div class="tile-text">
          <div class="tile-title">Slow Speech</div>
          <div class="tile-sub">Speak words more slowly</div>
        </div>
        <label class="toggle">
          <input type="checkbox" ${settings.slowSpeech ? 'checked' : ''} onchange="updateSetting('slowSpeech', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <div class="settings-section-label">DETECTION</div>
    <div class="settings-card">
      <div class="settings-tile" onclick="toggleCamera()">
        <div class="tile-icon" style="background:#0038A8"><span class="material-icons">camera_alt</span></div>
        <div class="tile-text">
          <div class="tile-title">Toggle Camera</div>
          <div class="tile-sub">Switch between front/back camera</div>
        </div>
        <span class="material-icons" style="color:var(--text-muted);font-size:20px;">chevron_right</span>
      </div>
      <div class="settings-tile">
        <div class="tile-icon" style="background:#8B5CF6"><span class="material-icons">notifications</span></div>
        <div class="tile-text">
          <div class="tile-title">Vibration</div>
          <div class="tile-sub">Vibrate when sign detected</div>
        </div>
        <label class="toggle">
          <input type="checkbox" ${settings.vibrationEnabled ? 'checked' : ''} onchange="updateSetting('vibrationEnabled', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <div class="settings-section-label">DATA</div>
    <div class="settings-card">
      <div class="settings-tile" onclick="clearHistory()">
        <div class="tile-icon" style="background:#EF4444"><span class="material-icons">delete</span></div>
        <div class="tile-text">
          <div class="tile-title">Clear History</div>
          <div class="tile-sub">Delete all detection history</div>
        </div>
        <span class="material-icons" style="color:var(--text-muted);font-size:20px;">chevron_right</span>
      </div>
    </div>

    <div class="settings-section-label">ABOUT</div>
    <div class="settings-card">
      <div class="settings-tile">
        <div class="tile-icon" style="background:#64748B"><span class="material-icons">info</span></div>
        <div class="tile-text">
          <div class="tile-title">App Version</div>
          <div class="tile-sub">1.0.0</div>
        </div>
      </div>
      <div class="settings-tile" onclick="alert('Your data is stored locally in your browser.')">
        <div class="tile-icon" style="background:#0EA5E9"><span class="material-icons">shield</span></div>
        <div class="tile-text">
          <div class="tile-title">Privacy Policy</div>
        </div>
        <span class="material-icons" style="color:var(--text-muted);font-size:20px;">chevron_right</span>
      </div>
    </div>

    <div class="footer-text">
      <div class="primary">FSL Detection System v1.0.0</div>
      <div class="secondary">Made with ❤️ for Thesis Project</div>
    </div>`;
}

function updateSetting(key, value) {
    settings[key] = value;
    localStorage.setItem('fsl_settings', JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem('fsl_settings');
    if (saved) {
        try { settings = { ...settings, ...JSON.parse(saved) }; } catch (e) { }
    }
}

function clearHistory() {
    if (confirm('Clear all history and stats? This cannot be undone.')) {
        localStorage.removeItem('fsl_history');
        localStorage.removeItem('fsl_stats');
        alert('History cleared.');
    }
}

// ══════════════════════════════════════════════════════════════════════
//  PROFILE
// ══════════════════════════════════════════════════════════════════════

function renderProfile() {
    const name = localStorage.getItem('fsl_userName') || 'FSL Learner';
    const stats = JSON.parse(localStorage.getItem('fsl_stats') || '{"totalDetections":0,"practiceStreak":0,"signsLearned":0,"totalTime":0}');
    const history = JSON.parse(localStorage.getItem('fsl_history') || '[]');
    const recent = history.slice(-10).reverse();

    const el = document.getElementById('profile-content');
    el.innerHTML = `
    <div class="profile-card">
      <div class="avatar">
        <span class="material-icons">person</span>
        <span class="avatar-badge">Lvl 1</span>
      </div>
      <div class="profile-name" id="profile-name-display">
        <span id="profile-name-text">${name}</span>
        <button class="edit-name-btn" onclick="startEditName()">
          <span class="material-icons" style="font-size:16px;">edit</span>
        </button>
      </div>
      <div id="profile-name-edit" class="name-edit-row hidden">
        <input class="name-edit-input" id="name-input" value="${name}">
        <button class="name-save-btn" onclick="saveName()"><span class="material-icons" style="font-size:18px;">check</span></button>
      </div>
      <div class="profile-role">FSL Learner</div>
      <div class="profile-joined"><span class="material-icons">calendar_today</span> Joined 2024</div>
    </div>

    <div class="section-title">Your Progress</div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background:#3B82F6"><span class="material-icons">gps_fixed</span></div>
        <div class="stat-value">${stats.totalDetections || 0}</div>
        <div class="stat-label">Detections</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#22C55E"><span class="material-icons">trending_up</span></div>
        <div class="stat-value">${stats.practiceStreak || 0}</div>
        <div class="stat-label">Day Streak</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#F59E0B"><span class="material-icons">emoji_events</span></div>
        <div class="stat-value">${stats.signsLearned || 0}</div>
        <div class="stat-label">Signs Learned</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#8B5CF6"><span class="material-icons">access_time</span></div>
        <div class="stat-value">${stats.totalTime || 0}m</div>
        <div class="stat-label">Practice Time</div>
      </div>
    </div>

    <div class="section-title">Achievements</div>
    <div class="card">
      <div class="achievement-item">
        <div class="achievement-emoji" style="background:#FEF3C7">🌟</div>
        <div class="achievement-text">
          <div class="achievement-title">First Steps</div>
          <div class="achievement-desc">Complete your first detection</div>
        </div>
        <span class="achievement-badge">${stats.totalDetections > 0 ? 'Unlocked' : 'Locked'}</span>
      </div>
      <div class="achievement-item">
        <div class="achievement-emoji" style="background:#DBEAFE">📚</div>
        <div class="achievement-text">
          <div class="achievement-title">Scholar</div>
          <div class="achievement-desc">Learn 10 signs from dictionary</div>
        </div>
        <span class="achievement-badge">Locked</span>
      </div>
      <div class="achievement-item">
        <div class="achievement-emoji" style="background:#D1FAE5">🔥</div>
        <div class="achievement-text">
          <div class="achievement-title">On Fire</div>
          <div class="achievement-desc">7 day practice streak</div>
        </div>
        <span class="achievement-badge">Locked</span>
      </div>
    </div>

    <div class="section-title">Recent Detections</div>
    <div class="card">
      ${recent.length === 0 ? `
        <div class="empty-state">
          <span class="material-icons">access_time</span>
          <h3>No recent activity</h3>
          <p>Start detecting signs to see history</p>
          <button class="empty-state-btn" onclick="navigate('detector')">Start Detecting</button>
        </div>` :
            recent.map(s => `
          <div class="recent-item">
            <div class="recent-dot"></div>
            <div class="recent-word">${s.word || ''}</div>
            <div class="recent-time">${s.time || 'Today'}</div>
          </div>`).join('')}
    </div>`;
}

function startEditName() {
    document.getElementById('profile-name-display').classList.add('hidden');
    document.getElementById('profile-name-edit').classList.remove('hidden');
    document.getElementById('name-input').focus();
}

function saveName() {
    const name = document.getElementById('name-input').value.trim() || 'FSL Learner';
    localStorage.setItem('fsl_userName', name);
    document.getElementById('profile-name-text').textContent = name;
    document.getElementById('profile-name-display').classList.remove('hidden');
    document.getElementById('profile-name-edit').classList.add('hidden');
}

// ══════════════════════════════════════════════════════════════════════
//  USER MANUAL
// ══════════════════════════════════════════════════════════════════════

function renderManual() {
    const el = document.getElementById('manual-content');
    el.innerHTML = `
    <div class="manual-welcome">
      <div class="manual-welcome-icon"><span class="material-icons">help_outline</span></div>
      <h2>How to Use This App</h2>
      <p>Learn Filipino Sign Language (FSL) with our detection and dictionary features. Follow the guides below to get started.</p>
    </div>

    <div class="manual-card">
      <div class="manual-card-header">
        <div class="manual-card-icon" style="background:#DC2626"><span class="material-icons">qr_code_scanner</span></div>
        <div>
          <div class="manual-card-title">Hand Sign Detection</div>
          <div class="manual-card-sub">Translate signs to text</div>
        </div>
      </div>
      ${['Tap the Detect button on the home screen', 'Allow camera permissions when prompted', 'Position your hands inside the guide box', 'Tap Start to begin detection', 'Wait for the buffer to fill (30 frames)', 'Detected words appear in the box below', 'Tap the speaker icon to hear pronunciation']
            .map((s, i) => `<div class="manual-step"><div class="step-num">${i + 1}</div><div class="step-text">${s}</div></div>`).join('')}
    </div>

    <div class="manual-card">
      <div class="manual-card-header">
        <div class="manual-card-icon" style="background:#0038A8"><span class="material-icons">menu_book</span></div>
        <div>
          <div class="manual-card-title">FSL Dictionary</div>
          <div class="manual-card-sub">Learn common phrases</div>
        </div>
      </div>
      ${['Tap the Dictionary button', 'Browse the list of FSL phrases', 'Use search to find specific words', 'Tap any phrase to view the animation', 'Practice by going to the detector']
            .map((s, i) => `<div class="manual-step"><div class="step-num">${i + 1}</div><div class="step-text">${s}</div></div>`).join('')}
    </div>

    <div class="manual-card">
      <div class="manual-card-header">
        <div class="manual-card-icon" style="background:#F59E0B"><span class="material-icons">check_circle</span></div>
        <div>
          <div class="manual-card-title">Tips for Best Results</div>
          <div class="manual-card-sub">Improve accuracy</div>
        </div>
      </div>
      ${['Use good lighting for camera detection', 'Keep your hands centered in the frame', 'Perform signs slowly and clearly', 'Use a plain background if possible', 'Practice regularly for better recognition']
            .map(t => `<div class="tip-item"><span class="tip-check">✓</span><span class="tip-text">${t}</span></div>`).join('')}
    </div>

    <div class="section-title">Quick Actions</div>
    <div class="quick-actions">
      <button class="quick-btn" style="background:#DC2626" onclick="navigate('detector')">
        <span class="material-icons">qr_code_scanner</span> Start Detecting
      </button>
      <button class="quick-btn" style="background:#0038A8" onclick="navigate('dictionary')">
        <span class="material-icons">menu_book</span> Open Dictionary
      </button>
    </div>

    <div class="footer-text">
      <div class="primary">© 2024 FSL Detection System</div>
      <div class="secondary">Thesis Project</div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════════════

function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fil-PH';
    u.rate = settings.slowSpeech ? 0.6 : 0.9;
    window.speechSynthesis.speak(u);
}

function saveToHistory(word) {
    const history = JSON.parse(localStorage.getItem('fsl_history') || '[]');
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    history.push({ word, time });
    if (history.length > 50) history.splice(0, history.length - 50);
    localStorage.setItem('fsl_history', JSON.stringify(history));

    // Update stats
    const stats = JSON.parse(localStorage.getItem('fsl_stats') || '{"totalDetections":0,"practiceStreak":0,"signsLearned":0,"totalTime":0}');
    stats.totalDetections = (stats.totalDetections || 0) + 1;
    const uniqueSigns = new Set(history.map(h => h.word));
    stats.signsLearned = uniqueSigns.size;
    localStorage.setItem('fsl_stats', JSON.stringify(stats));
}

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initHomeSlider();
});
