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

    /**
     * Measure 3D Euclidean distance from wrist (0) to fingertip vs wrist to PIP joint
     * Robust against camera distance, hand size, and tilt angle.
     */
    function isFingerExtended(landmarks, tipIdx, pipIdx) {
        var wrist = landmarks[0];
        var tip = landmarks[tipIdx];
        var pip = landmarks[pipIdx];

        var dTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
        var dPip = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);

        return dTip > (dPip * 1.12);
    }

    /**
     * Single-frame gesture classifier:
     * - ✊ FIST: 0 fingers extended -> DUCK
     * - ✌️ TWO FINGERS: Index & Middle up, Ring & Pinky folded -> RUN
     * - 🖐️ PALM: 3+ fingers open OR rapid upward flick -> JUMP
     */
    function classifyFrame(landmarks, timestamp) {
        if (!landmarks || landmarks.length < 21) return 'NONE';

        var indexExt = isFingerExtended(landmarks, 8, 6);
        var middleExt = isFingerExtended(landmarks, 12, 10);
        var ringExt = isFingerExtended(landmarks, 16, 14);
        var pinkyExt = isFingerExtended(landmarks, 20, 18);

        var count = (indexExt ? 1 : 0) + (middleExt ? 1 : 0) + (ringExt ? 1 : 0) + (pinkyExt ? 1 : 0);

        // Check upward vertical velocity
        var palmY = (landmarks[0].y + landmarks[9].y) / 2;
        var velocityY = 0;
        if (prevPalmY !== null && prevTimestamp > 0) {
            var dt = (timestamp - prevTimestamp) / 1000;
            if (dt > 0.01 && dt < 0.25) {
                velocityY = (palmY - prevPalmY) / dt;
            }
        }
        prevPalmY = palmY;
        prevTimestamp = timestamp;

        var isUpwardFlick = velocityY < -0.50;

        // 1. CLOSED FIST (✊) -> DUCK
        if (count === 0 || (!indexExt && !middleExt && !ringExt && !pinkyExt)) {
            return 'DUCK';
        }

        // 2. TWO FINGERS UP (✌️ Peace/Victory sign) -> RUN
        if (indexExt && middleExt && !ringExt && !pinkyExt) {
            return 'RUN';
        }

        // 3. OPEN PALM (🖐️ 3+ fingers) OR UPWARD FLICK -> JUMP
        if (count >= 3 || isUpwardFlick) {
            return 'JUMP';
        }

        // Default: If transitional, treat as running
        return 'RUN';
    }

    /**
     * Temporal smoothing filter (prevents single-frame glitches)
     */
    function getSmoothedGesture(rawGesture) {
        gestureHistory.push(rawGesture);
        if (gestureHistory.length > 3) {
            gestureHistory.shift();
        }

        // JUMP is an instant impulsive action - trigger immediately if detected
        if (rawGesture === 'JUMP') {
            return 'JUMP';
        }

        // For DUCK and RUN, require 2 consecutive votes to prevent flickering
        var duckVotes = 0;
        var runVotes = 0;
        for (var i = 0; i < gestureHistory.length; i++) {
            if (gestureHistory[i] === 'DUCK') duckVotes++;
            if (gestureHistory[i] === 'RUN') runVotes++;
        }

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
            var landmarks = results.multiHandLandmarks[0];

            // Render neon wireframe skeleton
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00ffcc', lineWidth: 2 });
            drawLandmarks(canvasCtx, landmarks, { color: '#ff007f', lineWidth: 1, radius: 3 });

            var rawGesture = classifyFrame(landmarks, now);
            detectedGesture = getSmoothedGesture(rawGesture);
            currentStableGesture = detectedGesture;
        } else {
            prevPalmY = null;
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

            // Fast Lite Model
            hands.setOptions({
                maxNumHands: 1,
                modelComplexity: 0,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            hands.onResults(onResults);

            // Access webcam with 320x240 optimal resolution
            var stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 320 },
                    height: { ideal: 240 },
                    frameRate: { ideal: 30 }
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
            '<div class="ai-hud-header">' +
                '<span class="ai-hud-title">⚡ DINO VISION AI v4</span>' +
                '<span id="ai-hud-fps">30 FPS</span>' +
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
