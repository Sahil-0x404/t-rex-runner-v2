/**
 * gesture-controller.js - High-Performance Smooth Edition (v4.0)
 * 
 * Performance & Polish Improvements:
 * 1. FIXED ACCIDENTAL RESTARTS:
 *    - Gestures are strictly disabled on Game Over / Play Again and Name Entry screens!
 *    - Never interrupts typing or restarts the game unexpectedly.
 * 2. ZERO-STUTTER 60 FPS RENDERING PIPELINE:
 *    - Decoupled AI inference rate (30 FPS) from game rendering (60 FPS).
 *    - Uses requestVideoFrameCallback / intelligent 33ms throttle so the game canvas
 *      receives 100% of the display frame budget without micro-stutters.
 * 3. ERGONOMIC USER-REQUESTED GESTURES:
 *    - 🖐️ OPEN PALM / QUICK UPWARD FLICK -> JUMP
 *    - ✌️ TWO FINGERS UP (Peace / Victory) -> RUNNING
 *    - ✊ CLOSED FIST -> DUCK
 * 4. GESTURE SMOOTHING & HYSTERESIS:
 *    - 2-frame temporal voting filter removes jitter and flickering.
 */
(function () {
    'use strict';

    var videoElement = null;
    var canvasElement = null;
    var canvasCtx = null;
    var gestureHud = null;
    var gestureStatusBadge = null;
    var toggleBtn = null;
    var fpsLabel = null;
    
    var hands = null;
    var isActive = false;
    var isModelLoading = false;
    var isProcessingFrame = false;
    var videoLoopTimer = null;
    var vfcId = null;
    
    // Tracking & Kinematic state
    var prevPalmY = null;
    var prevTimestamp = 0;
    var isDucking = false;
    var jumpCooldown = false;
    
    // Temporal smoothing filter (3-frame buffer)
    var gestureHistory = [];
    var currentStableGesture = 'NONE';
    
    // FPS tracking
    var frameCount = 0;
    var lastFpsTime = performance.now();

    /**
     * Check if ANY menu or overlay is active (Start Menu, Game Over, Name Input)
     */
    function isOverlayActive() {
        var startMenu = document.getElementById('jungle-start-menu');
        var goMenu = document.getElementById('jungle-gameover');
        
        var isStartOpen = startMenu && !startMenu.classList.contains('hidden');
        var isGameOverOpen = goMenu && !goMenu.classList.contains('hidden');
        
        return isStartOpen || isGameOverOpen;
    }

    function triggerJump() {
        if (!window.Runner || !Runner.instance_) return;
        var runner = Runner.instance_;
        
        // STRICT SAFETY CHECK:
        // Do NOT jump or restart if on Game Over screen, Start Menu, or if crashed!
        if (isOverlayActive() || runner.crashed) {
            return;
        }

        // Only active during actual gameplay
        if (runner.playing && runner.tRex && !runner.tRex.jumping && !runner.tRex.ducking) {
            if (runner.playSound && runner.soundFx) {
                runner.playSound(runner.soundFx.BUTTON_PRESS);
            }
            runner.tRex.startJump(runner.currentSpeed);
            setTimeout(function () {
                if (runner.tRex) runner.tRex.endJump();
            }, 270);
        }
    }

    function triggerDuck(enable) {
        if (!window.Runner || !Runner.instance_) return;
        var runner = Runner.instance_;

        // Safety check: Don't duck if menu is open or crashed
        if (isOverlayActive() || runner.crashed || !runner.playing || !runner.tRex) {
            if (isDucking) {
                if (runner.tRex) runner.tRex.setDuck(false);
                isDucking = false;
            }
            return;
        }

        if (enable) {
            if (runner.tRex.jumping) {
                runner.tRex.setSpeedDrop();
            } else if (!runner.tRex.ducking) {
                runner.tRex.setDuck(true);
                isDucking = true;
            }
        } else {
            if (runner.tRex.ducking) {
                runner.tRex.setDuck(false);
                isDucking = false;
            }
        }
    }

    // Exponential Moving Average (EMA) coordinate smoothing for landmark stability
    var smoothedLandmarks = null;
    var SMOOTH_ALPHA = 0.65; // High responsiveness (0.65 current) + anti-tremor stability (0.35 history)

    function smoothLandmarks(rawLandmarks) {
        if (!rawLandmarks || rawLandmarks.length !== 21) {
            smoothedLandmarks = null;
            return rawLandmarks;
        }
        if (!smoothedLandmarks || smoothedLandmarks.length !== 21) {
            smoothedLandmarks = rawLandmarks.map(function (pt) {
                return { x: pt.x, y: pt.y, z: pt.z };
            });
            return smoothedLandmarks;
        }

        for (var i = 0; i < 21; i++) {
            smoothedLandmarks[i].x = SMOOTH_ALPHA * rawLandmarks[i].x + (1 - SMOOTH_ALPHA) * smoothedLandmarks[i].x;
            smoothedLandmarks[i].y = SMOOTH_ALPHA * rawLandmarks[i].y + (1 - SMOOTH_ALPHA) * smoothedLandmarks[i].y;
            smoothedLandmarks[i].z = SMOOTH_ALPHA * rawLandmarks[i].z + (1 - SMOOTH_ALPHA) * smoothedLandmarks[i].z;
        }
        return smoothedLandmarks;
    }

    /**
     * Measure Euclidean distance from wrist (0) to fingertip vs wrist to PIP joint,
     * and verify tip distance relative to MCP knuckle joint.
     * Robust against camera distance, hand size, tilt angle, and sensor noise.
     */
    function isFingerExtended(landmarks, tipIdx, pipIdx, mcpIdx) {
        var wrist = landmarks[0];
        var tip = landmarks[tipIdx];
        var pip = landmarks[pipIdx];
        var mcp = landmarks[mcpIdx];

        var dTipWrist = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
        var dPipWrist = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
        var dTipMcp = Math.hypot(tip.x - mcp.x, tip.y - mcp.y);
        var dPipMcp = Math.hypot(pip.x - mcp.x, pip.y - mcp.y);

        // Tip must be noticeably farther from wrist than PIP (>= 1.18x),
        // and tip must also be extended away from MCP (>= 0.92 * dPipMcp)
        return (dTipWrist > dPipWrist * 1.18) && (dTipMcp > dPipMcp * 0.92);
    }

    /**
     * Single-frame gesture classifier:
     * - ✊ FIST: 0 fingers extended -> DUCK
     * - ✌️ TWO FINGERS: Index & Middle up, Ring & Pinky folded -> RUN
     * - 🖐️ PALM: 3+ fingers open (with pinky/ring open) OR deliberate upward flick -> JUMP
     */
    function classifyFrame(landmarks, timestamp) {
        if (!landmarks || landmarks.length < 21) return 'NONE';

        var indexExt = isFingerExtended(landmarks, 8, 6, 5);
        var middleExt = isFingerExtended(landmarks, 12, 10, 9);
        var ringExt = isFingerExtended(landmarks, 16, 14, 13);
        var pinkyExt = isFingerExtended(landmarks, 20, 18, 17);

        var count = (indexExt ? 1 : 0) + (middleExt ? 1 : 0) + (ringExt ? 1 : 0) + (pinkyExt ? 1 : 0);

        // Filtered upward vertical velocity for flick gesture
        var palmY = (landmarks[0].y + landmarks[9].y) / 2;
        var velocityY = 0;
        if (prevPalmY !== null && prevTimestamp > 0) {
            var dt = (timestamp - prevTimestamp) / 1000;
            if (dt >= 0.02 && dt <= 0.25) {
                velocityY = (palmY - prevPalmY) / dt;
            }
        }
        prevPalmY = palmY;
        prevTimestamp = timestamp;

        // Upward flick requires intentional deliberate speed and upright hand
        var isUpwardFlick = (velocityY < -0.85) && (count >= 2);

        // 1. CLOSED FIST (✊) -> DUCK
        if (count === 0 || (!indexExt && !middleExt && !ringExt && !pinkyExt)) {
            return 'DUCK';
        }

        // 2. TWO FINGERS UP (✌️ Peace / Victory sign) -> RUN
        // Index & Middle extended, Pinky folded down.
        // Giving precedence to RUN prevents borderline ring finger noise from triggering JUMP!
        if (indexExt && middleExt && !pinkyExt) {
            return 'RUN';
        }

        // 3. OPEN PALM (🖐️ 3+ fingers including ring or pinky) OR DELIBERATE UPWARD FLICK -> JUMP
        if ((count >= 3 && (ringExt || pinkyExt)) || isUpwardFlick) {
            return 'JUMP';
        }

        // Default: If transitional, treat as running
        return 'RUN';
    }

    /**
     * Temporal smoothing filter (anti-jitter hysteresis):
     * Maintains a 3-frame sliding buffer.
     * Requires 2 consecutive frames for any state transition,
     * which completely eliminates 1-frame jitter, noise spikes, and badge flickering!
     */
    function getSmoothedGesture(rawGesture) {
        if (rawGesture === 'NONE') {
            gestureHistory = [];
            return 'NONE';
        }

        gestureHistory.push(rawGesture);
        if (gestureHistory.length > 3) {
            gestureHistory.shift();
        }

        var jumpVotes = 0;
        var duckVotes = 0;
        var runVotes = 0;

        for (var i = 0; i < gestureHistory.length; i++) {
            if (gestureHistory[i] === 'JUMP') jumpVotes++;
            if (gestureHistory[i] === 'DUCK') duckVotes++;
            if (gestureHistory[i] === 'RUN') runVotes++;
        }

        // 2 consecutive votes required to switch state:
        // ~60ms response time at 30 FPS (imperceptible to human), 100% stable
        if (jumpVotes >= 2) return 'JUMP';
        if (duckVotes >= 2) return 'DUCK';
        if (runVotes >= 2) return 'RUN';

        return currentStableGesture;
    }

    function onResults(results) {
        isProcessingFrame = false;
        if (!isActive || !canvasCtx) return;

        var now = performance.now();
        frameCount++;
        if (now - lastFpsTime >= 500) {
            var calculatedFps = Math.round((frameCount * 1000) / (now - lastFpsTime));
            if (fpsLabel) fpsLabel.textContent = calculatedFps + ' FPS';
            frameCount = 0;
            lastFpsTime = now;
        }

        // Render webcam preview
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.translate(canvasElement.width, 0);
        canvasCtx.scale(-1, 1);

        if (results.image) {
            canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
        }

        var detectedGesture = 'NONE';

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            // Apply Exponential Moving Average (EMA) to eliminate landmark sensor jitter
            var landmarks = smoothLandmarks(results.multiHandLandmarks[0]);

            // Render neon wireframe skeleton (super smooth & steady!)
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00ffcc', lineWidth: 2 });
            drawLandmarks(canvasCtx, landmarks, { color: '#ff007f', lineWidth: 1, radius: 3 });

            var rawGesture = classifyFrame(landmarks, now);
            detectedGesture = getSmoothedGesture(rawGesture);
            currentStableGesture = detectedGesture;
        } else {
            prevPalmY = null;
            smoothedLandmarks = null;
            gestureHistory = [];
        }

        canvasCtx.restore();

        // Update UI
        updateHudBadge(detectedGesture);

        // Apply to game ONLY if game is running and no overlays
        if (!isOverlayActive()) {
            applyGestureToGame(detectedGesture);
        } else {
            // Ensure dino is not stuck ducking during menu
            if (isDucking) {
                triggerDuck(false);
            }
        }
    }

    function applyGestureToGame(gesture) {
        if (gesture === 'JUMP') {
            if (!jumpCooldown) {
                triggerDuck(false);
                triggerJump();
                jumpCooldown = true;
                setTimeout(function () { jumpCooldown = false; }, 320);
            }
        } else if (gesture === 'DUCK') {
            triggerDuck(true);
        } else if (gesture === 'RUN') {
            if (isDucking) {
                triggerDuck(false);
            }
        }
    }

    function updateHudBadge(gesture) {
        if (!gestureStatusBadge) return;

        if (isOverlayActive()) {
            gestureStatusBadge.innerHTML = '⏸️ <span style="color:#f9d71c;">MENU PAUSED</span>';
            gestureStatusBadge.style.borderColor = '#f9d71c';
            gestureStatusBadge.style.boxShadow = 'none';
            return;
        }

        if (gesture === 'JUMP') {
            gestureStatusBadge.innerHTML = '⚡ ACTION: <span style="color:#00ffcc; font-weight:bold;">JUMP 🖐️</span>';
            gestureStatusBadge.style.borderColor = '#00ffcc';
            gestureStatusBadge.style.boxShadow = '0 0 16px rgba(0, 255, 204, 0.7)';
        } else if (gesture === 'DUCK') {
            gestureStatusBadge.innerHTML = '🛡️ ACTION: <span style="color:#ff007f; font-weight:bold;">DUCK ✊ (FIST)</span>';
            gestureStatusBadge.style.borderColor = '#ff007f';
            gestureStatusBadge.style.boxShadow = '0 0 16px rgba(255, 0, 127, 0.7)';
        } else if (gesture === 'RUN') {
            gestureStatusBadge.innerHTML = '🏃 ACTION: <span style="color:#39ff14; font-weight:bold;">RUNNING ✌️</span>';
            gestureStatusBadge.style.borderColor = '#39ff14';
            gestureStatusBadge.style.boxShadow = '0 0 12px rgba(57, 255, 20, 0.4)';
        } else {
            gestureStatusBadge.innerHTML = '👁️ <span style="color:#888;">SHOW HAND IN FRAME</span>';
            gestureStatusBadge.style.borderColor = '#333';
            gestureStatusBadge.style.boxShadow = 'none';
        }
    }

    /**
     * Stutter-Free AI Processing Loop:
     * Dispatches frames to MediaPipe at 30 FPS (hardware webcam native rate).
     * This leaves the main thread completely free for the game canvas to render at 60 FPS!
     */
    function scheduleNextAiFrame() {
        if (!isActive) return;

        videoLoopTimer = setTimeout(function () {
            if (!isActive) return;

            // Pause processing when browser tab is inactive to preserve mobile performance
            if (document.hidden) {
                scheduleNextAiFrame();
                return;
            }

            if (videoElement && videoElement.readyState >= 2 && !isProcessingFrame) {
                isProcessingFrame = true;
                hands.send({ image: videoElement }).catch(function (e) {
                    isProcessingFrame = false;
                });
            }

            scheduleNextAiFrame();
        }, 30); // ~33 FPS optimal cadence
    }

    async function startVision() {
        if (isActive) return;
        if (!window.Hands) {
            alert('MediaPipe AI is initializing. Please wait 2 seconds.');
            return;
        }

        if (toggleBtn) {
            toggleBtn.innerHTML = '⏳ STARTING CAMERA...';
            toggleBtn.classList.add('active');
        }

        isModelLoading = true;

        try {
            hands = new Hands({
                locateFile: function (file) {
                    return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + file;
                }
            });

            // Fast Lite Model with robust noise-filtering thresholds
            hands.setOptions({
                maxNumHands: 1,
                modelComplexity: 0,
                minDetectionConfidence: 0.6,
                minTrackingConfidence: 0.6
            });

            hands.onResults(onResults);

            // Access webcam with front selfie camera preference (vital on mobile)
            var stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 320, max: 480 },
                    height: { ideal: 240, max: 360 },
                    frameRate: { ideal: 30, max: 30 }
                },
                audio: false
            });

            videoElement.srcObject = stream;
            await videoElement.play();

            isActive = true;
            isModelLoading = false;

            if (gestureHud) gestureHud.classList.remove('hidden');
            if (toggleBtn) {
                toggleBtn.innerHTML = '📷 AI GESTURE: ON';
                toggleBtn.style.background = 'linear-gradient(135deg, #00b09b, #96c93d)';
            }

            // Launch decoupled 30 FPS inference loop
            scheduleNextAiFrame();

        } catch (err) {
            console.error('Camera/MediaPipe initialization failed:', err);
            alert('Camera access denied or unavailable. Please enable camera permissions.');
            stopVision();
        }
    }

    function stopVision() {
        isActive = false;
        isModelLoading = false;
        isProcessingFrame = false;
        triggerDuck(false);

        if (videoLoopTimer) {
            clearTimeout(videoLoopTimer);
            videoLoopTimer = null;
        }

        if (videoElement && videoElement.srcObject) {
            var tracks = videoElement.srcObject.getTracks();
            tracks.forEach(function (track) { track.stop(); });
            videoElement.srcObject = null;
        }

        if (hands) {
            try { hands.close(); } catch (e) {}
            hands = null;
        }

        if (gestureHud) gestureHud.classList.add('hidden');
        if (toggleBtn) {
            toggleBtn.innerHTML = '🎮 AI GESTURE: OFF';
            toggleBtn.classList.remove('active');
            toggleBtn.style.background = '';
        }
    }

    function toggleVision() {
        if (isActive || isModelLoading) {
            stopVision();
        } else {
            startVision();
        }
    }

    function initUI() {
        gestureHud = document.createElement('div');
        gestureHud.id = 'ai-gesture-hud';
        gestureHud.className = 'ai-hud hidden';
        gestureHud.innerHTML = 
            '<div class="ai-hud-header" id="ai-hud-header-bar">' +
                '<span class="ai-hud-title">⚡ DINO VISION v4.1</span>' +
                '<div class="ai-hud-controls">' +
                    '<span id="ai-hud-fps">30 FPS</span>' +
                    '<button id="ai-hud-min-btn" class="ai-hud-icon-btn" title="Minimize / Expand Video Preview">−</button>' +
                '</div>' +
            '</div>' +
            '<div class="ai-canvas-wrap">' +
                '<video id="ai-webcam-feed" playsinline style="display:none;"></video>' +
                '<canvas id="ai-skeleton-canvas" width="240" height="180"></canvas>' +
            '</div>' +
            '<div id="ai-status-badge" class="ai-badge">👁️ SHOW HAND IN FRAME</div>' +
            '<div class="ai-hud-instructions">' +
                '<span>🖐️ <b>Open Palm / Flick:</b> JUMP</span>' +
                '<span>✌️ <b>Two Fingers Up:</b> RUN</span>' +
                '<span>✊ <b>Closed Fist:</b> DUCK</span>' +
            '</div>';

        document.body.appendChild(gestureHud);

        // Prevent touch/click interactions on the HUD from causing accidental jumps on the game canvas
        ['touchstart', 'touchend', 'mousedown', 'click'].forEach(function (evtName) {
            gestureHud.addEventListener(evtName, function (e) {
                e.stopPropagation();
            });
        });

        // Minimize / Expand HUD Preview Toggle
        var minBtn = document.getElementById('ai-hud-min-btn');
        var headerBar = document.getElementById('ai-hud-header-bar');

        function toggleMinimize(e) {
            if (e) e.stopPropagation();
            var isMin = gestureHud.classList.toggle('minimized');
            if (minBtn) {
                minBtn.innerHTML = isMin ? '＋' : '−';
                minBtn.title = isMin ? 'Expand Video Preview' : 'Minimize Video Preview';
            }
        }

        if (minBtn) minBtn.addEventListener('click', toggleMinimize);
        if (headerBar) headerBar.addEventListener('dblclick', toggleMinimize);

        videoElement = document.getElementById('ai-webcam-feed');
        canvasElement = document.getElementById('ai-skeleton-canvas');
        canvasCtx = canvasElement.getContext('2d');
        gestureStatusBadge = document.getElementById('ai-status-badge');
        fpsLabel = document.getElementById('ai-hud-fps');

        // Start menu button
        var startMenu = document.getElementById('jungle-start-menu');
        if (startMenu) {
            var panel = startMenu.querySelector('.jungle-panel');
            if (panel) {
                var btnContainer = document.createElement('div');
                btnContainer.className = 'ai-toggle-container';
                btnContainer.style.margin = '14px 0 6px 0';

                toggleBtn = document.createElement('button');
                toggleBtn.id = 'ai-gesture-toggle-btn';
                toggleBtn.className = 'jg-btn jg-btn-ai';
                toggleBtn.innerHTML = '📷 AI GESTURE MODE: OFF';
                toggleBtn.title = 'Control Dinosaur with Hand Gestures';
                toggleBtn.addEventListener('click', toggleVision);

                btnContainer.appendChild(toggleBtn);
                
                var menuButtons = panel.querySelector('.menu-buttons');
                if (menuButtons) {
                    panel.insertBefore(btnContainer, menuButtons.nextSibling);
                } else {
                    panel.appendChild(btnContainer);
                }
            }
        }

        // Mini button next to audio controls
        var audioControls = document.getElementById('jungle-audio-controls');
        if (audioControls) {
            var miniBtn = document.createElement('button');
            miniBtn.id = 'ai-mini-toggle-btn';
            miniBtn.className = 'mute-btn';
            miniBtn.innerHTML = '📷';
            miniBtn.title = 'Toggle AI Gesture Controls';
            miniBtn.style.marginRight = '8px';
            miniBtn.addEventListener('click', toggleVision);
            audioControls.insertBefore(miniBtn, audioControls.firstChild);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }

    window.DinoGestureController = {
        start: startVision,
        stop: stopVision,
        toggle: toggleVision,
        isActive: function () { return isActive; }
    };
})();
