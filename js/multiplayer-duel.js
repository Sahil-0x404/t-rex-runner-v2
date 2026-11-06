/**
 * multiplayer-duel.js - Real-Time 1v1 Synchronized Track Racing (v1.0)
 * 
 * Architecture:
 * 1. DETERMINISTIC TRACK SYNC (Mulberry32 PRNG):
 *    - Both players share an identical seed, generating identical obstacles, gaps, and bird heights.
 * 2. FIREBASE ROOM MANAGEMENT:
 *    - Lightweight /duel_rooms/{code} branch with onDisconnect auto-cleanup.
 * 3. SYNCHRONIZED COUNTDOWN:
 *    - Unified 3-2-1 sprint start.
 * 4. 60 FPS LERP INTERPOLATION:
 *    - Broadcasts telemetry at 16 Hz; canvas smoothly lerps opponent at 60 FPS.
 * 5. DUEL HUD & CLIMAX:
 *    - Top-screen live score gap meter, parallel ghost dino rendering, and victory/defeat modal with rematch loop.
 */
(function () {
    'use strict';

    var DUEL_SEED = null;
    var currentRoomId = null;
    var playerRole = null; // 'host' or 'guest'
    var isDuelActive = false;
    var roomRef = null;
    var telemetryTimer = null;
    var checkRunnerTimer = null;

    // Opponent interpolated state for 60 FPS silky smooth rendering
    var opponent = {
        name: 'Challenger',
        score: 0,
        y: 0,
        targetY: 0,
        isJumping: false,
        isDucking: false,
        crashed: false,
        tumbleAngle: 0,
        tumbleY: 0
    };

    // Mulberry32 Seeded Pseudo-Random Number Generator
    function seededRandom() {
        if (DUEL_SEED == null) {
            return Math.random();
        }
        var t = (DUEL_SEED += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function setSeed(seed) {
        DUEL_SEED = typeof seed === 'number' ? seed : parseInt(seed, 10);
    }

    function resetSeed() {
        DUEL_SEED = null;
    }

    // Helper: Generate clean 5-character room code (e.g., DINO7, REX42)
    function generateRoomCode() {
        var prefixes = ['DINO', 'JUNG', 'REX', 'CLAW', 'ROAR', 'FANG'];
        var prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        var num = Math.floor(Math.random() * 90 + 10);
        return prefix + num;
    }

    function getPlayerName() {
        var saved = localStorage.getItem('jungleRunnerPlayerName_v1');
        return (saved && saved.trim()) ? saved.trim().substring(0, 10) : 'Player_' + Math.floor(Math.random() * 900 + 100);
    }

    function getPlayerId() {
        var id = localStorage.getItem('jungleRunnerPlayerId_v2');
        if (!id) {
            id = 'pid_' + Math.random().toString(36).substring(2, 10);
            localStorage.setItem('jungleRunnerPlayerId_v2', id);
        }
        return id;
    }

    function getFirebaseDb() {
        if (typeof window !== 'undefined' && window.firebase && window.firebase.database) {
            return window.firebase.database();
        }
        return null;
    }

    /* ═══════════════════════════════════════════════════════════
       FIREBASE ROOM LIFECYCLE
       ═══════════════════════════════════════════════════════════ */

    function createRoom() {
        var db = getFirebaseDb();
        if (!db) {
            alert('Cloud connection initializing. Please retry in 2 seconds.');
            return;
        }

        var code = generateRoomCode();
        var seed = Math.floor(Math.random() * 899999 + 100000);
        var hostName = getPlayerName();
        var hostId = getPlayerId();

        currentRoomId = code;
        playerRole = 'host';
        roomRef = db.ref('duel_rooms/' + code);

        var roomData = {
            code: code,
            seed: seed,
            status: 'waiting', // waiting -> ready -> countdown -> racing -> finished
            host: {
                id: hostId,
                name: hostName,
                ready: true,
                score: 0,
                y: 0,
                duck: false,
                crashed: false
            },
            guest: null,
            createdAt: window.firebase.database.ServerValue.TIMESTAMP
        };

        roomRef.set(roomData).then(function () {
            // Auto clean up when host disconnects
            roomRef.onDisconnect().remove();

            // Update UI
            document.getElementById('duel-created-code').textContent = code;
            document.getElementById('duel-view-create').classList.remove('hidden');
            document.getElementById('duel-view-join').classList.add('hidden');
            document.getElementById('duel-view-lobby').classList.add('hidden');

            listenToRoom(roomRef);
        }).catch(function (err) {
            console.error('Create room error:', err);
            alert('Could not create room. Please check your connection.');
        });
    }

    function joinRoom(inputCode) {
        var db = getFirebaseDb();
        if (!db) {
            alert('Cloud connection initializing. Please retry in 2 seconds.');
            return;
        }

        var code = (inputCode || '').trim().toUpperCase();
        if (!code || code.length < 4) {
            showJoinError('Please enter a valid room code (e.g. DINO7)');
            return;
        }

        var targetRef = db.ref('duel_rooms/' + code);
        targetRef.once('value').then(function (snapshot) {
            var data = snapshot.val();
            if (!data) {
                showJoinError('Room "' + code + '" not found. Check the code!');
                return;
            }
            if (data.status === 'racing') {
                showJoinError('Match is already in progress!');
                return;
            }
            if (data.guest && data.guest.id !== getPlayerId()) {
                showJoinError('Room is full (2/2 players already).');
                return;
            }

            currentRoomId = code;
            playerRole = 'guest';
            roomRef = targetRef;

            var guestData = {
                id: getPlayerId(),
                name: getPlayerName(),
                ready: true,
                score: 0,
                y: 0,
                duck: false,
                crashed: false
            };

            // Set guest in room
            roomRef.child('guest').set(guestData).then(function () {
                // Remove guest on disconnect
                roomRef.child('guest').onDisconnect().set(null);

                // Switch UI
                document.getElementById('duel-view-create').classList.add('hidden');
                document.getElementById('duel-view-join').classList.add('hidden');
                document.getElementById('duel-view-lobby').classList.remove('hidden');

                listenToRoom(roomRef);
            });
        }).catch(function (err) {
            showJoinError('Connection error: ' + err.message);
        });
    }

    function listenToRoom(ref) {
        ref.on('value', function (snapshot) {
            var data = snapshot.val();
            if (!data) {
                // Room was closed or deleted
                if (isDuelActive) {
                    endDuel('OPPONENT DISCONNECTED', 'Opponent left the match.', true);
                }
                resetDuelState();
                return;
            }

            handleRoomStateChange(data);
        });
    }

    function handleRoomStateChange(data) {
        var myRole = playerRole;
        var oppRole = myRole === 'host' ? 'guest' : 'host';
        var myData = data[myRole];
        var oppData = data[oppRole];

        // 1. Lobby updates
        if (data.guest) {
            document.getElementById('duel-view-create').classList.add('hidden');
            document.getElementById('duel-view-join').classList.add('hidden');
            document.getElementById('duel-view-lobby').classList.remove('hidden');

            document.getElementById('duel-p1-name').textContent = data.host.name;
            document.getElementById('duel-p1-status').textContent = data.host.ready ? 'READY ✅' : 'WAITING...';

            document.getElementById('duel-p2-name').textContent = data.guest.name;
            document.getElementById('duel-p2-status').textContent = data.guest.ready ? 'READY ✅' : 'WAITING...';

            var startBtn = document.getElementById('duel-ready-btn');
            if (myRole === 'host') {
                startBtn.textContent = '⚡ START RACE';
                startBtn.disabled = !data.guest.ready;
            } else {
                startBtn.textContent = myData.ready ? 'WAITING FOR HOST TO START...' : 'READY UP!';
                startBtn.disabled = myData.ready;
            }
        }

        // 2. Countdown sequence
        if (data.status === 'countdown') {
            closeLobbyModal();
            startCountdown(data.seed);
        }

        // 3. Telemetry tracking during live race
        if (data.status === 'racing' && oppData) {
            opponent.name = oppData.name || 'Opponent';
            opponent.score = oppData.score || 0;
            opponent.targetY = oppData.y || 0;
            opponent.isJumping = oppData.isJumping || false;
            opponent.isDucking = oppData.duck || false;

            updateDuelTopHud(myData ? myData.score : 0, opponent.score, opponent.name);

            // Check if opponent crashed!
            if (oppData.crashed && !opponent.crashed) {
                opponent.crashed = true;
                // Local player wins if still alive!
                if (!myData || !myData.crashed) {
                    setTimeout(function () {
                        endDuel('👑 VICTORY!', 'You outran ' + opponent.name + '!', true);
                    }, 600);
                }
            }
        }

        // 4. Rematch handling
        if (data.status === 'rematch_ready') {
            document.getElementById('duel-result-modal').classList.add('hidden');
            startCountdown(data.seed);
        }
    }

    function showJoinError(msg) {
        var errEl = document.getElementById('duel-join-error');
        if (errEl) {
            errEl.textContent = msg;
            errEl.classList.remove('hidden');
        }
    }

    /* ═══════════════════════════════════════════════════════════
       SYNCHRONIZED SPRINT COUNTDOWN & START
       ═══════════════════════════════════════════════════════════ */

    function startCountdown(seed) {
        var countOverlay = document.getElementById('duel-countdown-overlay');
        var countNum = document.getElementById('duel-countdown-number');
        if (!countOverlay || !countNum) return;

        countOverlay.classList.remove('hidden');
        var val = 3;
        countNum.textContent = String(val);

        var countInterval = setInterval(function () {
            val--;
            if (val > 0) {
                countNum.textContent = String(val);
                countNum.style.transform = 'scale(1.3)';
                setTimeout(function () { countNum.style.transform = 'scale(1)'; }, 150);
            } else if (val === 0) {
                countNum.textContent = 'RACE!';
                countNum.style.color = '#00ffcc';
            } else {
                clearInterval(countInterval);
                countOverlay.classList.add('hidden');
                countNum.style.color = '#ff007f';
                launchDuelRace(seed);
            }
        }, 800);
    }

    function launchDuelRace(seed) {
        isDuelActive = true;
        setSeed(seed);

        // Hide menus
        var startMenu = document.getElementById('jungle-start-menu');
        var goMenu = document.getElementById('jungle-gameover');
        if (startMenu) startMenu.classList.add('hidden');
        if (goMenu) goMenu.classList.add('hidden');

        // Reset opponent state
        opponent.crashed = false;
        opponent.tumbleAngle = 0;
        opponent.tumbleY = 0;
        opponent.y = 0;
        opponent.targetY = 0;

        // Show Top Duel HUD
        showDuelTopHud();

        // Launch game with synchronized obstacle track
        if (window.Runner && Runner.instance_) {
            var r = Runner.instance_;
            if (r.raqId) {
                cancelAnimationFrame(r.raqId);
                r.raqId = 0;
            }
            r.crashed = false;
            r.playingIntro = false;
            r.activated = true;
            r.runningTime = 0;
            r.currentSpeed = r.config.SPEED;
            r.distanceRan = 0;

            if (r.containerEl) {
                r.containerEl.classList.remove(Runner.classes.CRASHED);
                r.containerEl.style.width = r.dimensions.WIDTH + 'px';
            }
            if (r.horizon) {
                r.horizon.obstacles = [];
                r.horizon.reset();
            }
            if (r.distanceMeter) {
                r.distanceMeter.reset(r.highestScore);
            }
            if (r.tRex) {
                r.tRex.reset();
                r.tRex.playingIntro = false;
                r.tRex.status = Trex.status.RUNNING;
            }
            try { r.loadSounds(); } catch (e) {}
            r.playing = true;
            r.clearCanvas();
            r.startGame();
            r.update();
            if (r.tRex && !r.tRex.jumping) {
                r.playSound(r.soundFx ? r.soundFx.BUTTON_PRESS : 'BUTTON_PRESS');
                r.tRex.startJump(r.currentSpeed);
            }
        }

        // Host updates room state to 'racing'
        if (playerRole === 'host' && roomRef) {
            roomRef.update({ status: 'racing' });
        }

        // Start broadcasting local telemetry at ~16 Hz (every 60 ms)
        startTelemetryBroadcast();
    }

    /* ═══════════════════════════════════════════════════════════
       TELEMETRY BROADCAST & 60 FPS INTERPOLATION
       ═══════════════════════════════════════════════════════════ */

    function startTelemetryBroadcast() {
        if (telemetryTimer) clearInterval(telemetryTimer);

        telemetryTimer = setInterval(function () {
            if (!isDuelActive || !roomRef || !playerRole) return;
            if (!window.Runner || !Runner.instance_) return;

            var runner = Runner.instance_;
            var tRex = runner.tRex;
            var currentScore = Math.floor(runner.distanceRan || 0);
            var isJumping = tRex ? tRex.jumping : false;
            var isDucking = tRex ? tRex.ducking : false;
            var yPos = tRex ? (tRex.yPos - tRex.groundYPos) : 0;
            var crashed = runner.crashed || false;

            var localUpdate = {
                score: currentScore,
                y: yPos,
                isJumping: isJumping,
                duck: isDucking,
                crashed: crashed
            };

            roomRef.child(playerRole).update(localUpdate);

            // If local player crashed, trigger local defeat check
            if (crashed) {
                clearInterval(telemetryTimer);
                setTimeout(function () {
                    if (isDuelActive) {
                        endDuel('💀 CRASHED!', opponent.name + ' outran you!', false);
                    }
                }, 400);
            }
        }, 60);
    }

    /* ═══════════════════════════════════════════════════════════
       OPPONENT GHOST RENDERING ON CANVAS
       ═══════════════════════════════════════════════════════════ */

    function renderOpponentGhost(ctx, localTrex) {
        if (!isDuelActive || !ctx || !localTrex) return;

        // Smoothly interpolate (lerp) vertical position for 60 FPS motion
        opponent.y += (opponent.targetY - opponent.y) * 0.35;

        var groundY = localTrex.groundYPos;
        // Position opponent 38 pixels ahead/offset on the parallel track
        var drawX = localTrex.xPos + 38;
        var drawY = groundY + opponent.y;

        ctx.save();

        if (opponent.crashed) {
            // Dramatic tumble wipeout animation
            opponent.tumbleAngle += 0.25;
            opponent.tumbleY += 4;
            ctx.translate(drawX + 20, drawY + opponent.tumbleY);
            ctx.rotate(opponent.tumbleAngle);
            ctx.globalAlpha = Math.max(0, 1 - (opponent.tumbleY / 120));
            drawGhostSprite(ctx, -20, -20, opponent.isDucking);
        } else {
            // Active racing ghost with neon purple aura
            ctx.shadowColor = '#d946ef';
            ctx.shadowBlur = 14;
            ctx.globalAlpha = 0.88;
            drawGhostSprite(ctx, drawX, drawY, opponent.isDucking);

            // Floating Name Badge
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#f5d0fe';
            ctx.font = 'bold 8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(opponent.name.toUpperCase(), drawX + 22, drawY - 8);
        }

        ctx.restore();
    }

    function drawGhostSprite(ctx, x, y, isDuck) {
        var runner = Runner.instance_;
        if (!runner || !Runner.imageSprite) return;

        var sprite = Runner.imageSprite;
        var spriteWidth = isDuck ? 59 : 44;
        var spriteHeight = 47;
        var sourceX = isDuck ? 186 : 76; // Duck vs Run frames in original sprite
        var sourceY = 2;

        // Apply distinct neon tint
        ctx.fillStyle = '#ff007f';
        ctx.drawImage(sprite, sourceX, sourceY, spriteWidth, spriteHeight, x, y, spriteWidth, spriteHeight);
    }

    /* ═══════════════════════════════════════════════════════════
       TOP DUEL HUD (Live Gap & Scores)
       ═══════════════════════════════════════════════════════════ */

    function showDuelTopHud() {
        var hud = document.getElementById('duel-live-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'duel-live-hud';
            hud.className = 'duel-live-hud';
            hud.innerHTML = 
                '<div class="duel-hud-player duel-p1-label"><span class="duel-dot p1-dot"></span> <span id="hud-my-name">YOU</span>: <b id="hud-my-score">0</b></div>' +
                '<div class="duel-hud-gap" id="hud-duel-gap">TIED</div>' +
                '<div class="duel-hud-player duel-p2-label"><span class="duel-dot p2-dot"></span> <span id="hud-opp-name">OPPONENT</span>: <b id="hud-opp-score">0</b></div>';
            document.body.appendChild(hud);
        }
        hud.classList.remove('hidden');
    }

    function updateDuelTopHud(myScore, oppScore, oppName) {
        var myScoreEl = document.getElementById('hud-my-score');
        var oppScoreEl = document.getElementById('hud-opp-score');
        var oppNameEl = document.getElementById('hud-opp-name');
        var gapEl = document.getElementById('hud-duel-gap');

        if (myScoreEl) myScoreEl.textContent = String(myScore);
        if (oppScoreEl) oppScoreEl.textContent = String(oppScore);
        if (oppNameEl) oppNameEl.textContent = oppName.toUpperCase().substring(0, 8);

        if (gapEl) {
            var diff = myScore - oppScore;
            if (diff > 0) {
                gapEl.innerHTML = '<span style="color:#00ffcc;">▲ +' + diff + ' LEAD</span>';
            } else if (diff < 0) {
                gapEl.innerHTML = '<span style="color:#ff007f;">▼ ' + diff + ' BEHIND</span>';
            } else {
                gapEl.innerHTML = '<span style="color:#f9d71c;">TIED</span>';
            }
        }
    }

    function hideDuelTopHud() {
        var hud = document.getElementById('duel-live-hud');
        if (hud) hud.classList.add('hidden');
    }

    /* ═══════════════════════════════════════════════════════════
       VICTORY / DEFEAT CLIMAX & REMATCH
       ═══════════════════════════════════════════════════════════ */

    function endDuel(title, desc, isVictory) {
        if (!isDuelActive) return;
        isDuelActive = false;

        if (telemetryTimer) {
            clearInterval(telemetryTimer);
            telemetryTimer = null;
        }

        hideDuelTopHud();
        resetSeed();

        var modal = document.getElementById('duel-result-modal');
        var titleEl = document.getElementById('duel-result-title');
        var descEl = document.getElementById('duel-result-desc');
        var emojiEl = document.getElementById('duel-result-emoji');
        var statsEl = document.getElementById('duel-result-stats');

        if (modal) {
            titleEl.textContent = title;
            descEl.textContent = desc;
            emojiEl.textContent = isVictory ? '👑' : '💀';

            var runner = Runner.instance_;
            var myScore = runner ? Math.floor(runner.distanceRan || 0) : 0;
            statsEl.innerHTML = 
                '<div class="duel-stat-row"><span>YOUR SCORE:</span> <b>' + myScore + '</b></div>' +
                '<div class="duel-stat-row"><span>RIVAL SCORE:</span> <b>' + opponent.score + '</b></div>';

            modal.classList.remove('hidden');
        }
    }

    function requestRematch() {
        if (!roomRef) return;
        var newSeed = Math.floor(Math.random() * 899999 + 100000);

        // Reset room for rematch
        roomRef.update({
            status: 'rematch_ready',
            seed: newSeed,
            'host/score': 0,
            'host/y': 0,
            'host/crashed': false,
            'guest/score': 0,
            'guest/y': 0,
            'guest/crashed': false
        });
    }

    function leaveDuel() {
        if (roomRef) {
            if (playerRole === 'host') {
                roomRef.remove();
            } else {
                roomRef.child('guest').set(null);
            }
            roomRef.off();
        }
        resetDuelState();

        // Return to start menu
        document.getElementById('duel-result-modal').classList.add('hidden');
        var startMenu = document.getElementById('jungle-start-menu');
        if (startMenu) startMenu.classList.remove('hidden');
    }

    function resetDuelState() {
        isDuelActive = false;
        currentRoomId = null;
        playerRole = null;
        roomRef = null;
        resetSeed();
        hideDuelTopHud();

        if (telemetryTimer) {
            clearInterval(telemetryTimer);
            telemetryTimer = null;
        }
    }

    function openLobbyModal() {
        var modal = document.getElementById('jungle-duel-modal');
        if (modal) modal.classList.remove('hidden');

        // Check if URL has ?duel=CODE
        var urlParams = new URLSearchParams(window.location.search);
        var duelCode = urlParams.get('duel');
        if (duelCode) {
            document.getElementById('duel-tab-join').click();
            document.getElementById('duel-join-code-input').value = duelCode.toUpperCase();
        }
    }

    function closeLobbyModal() {
        var modal = document.getElementById('jungle-duel-modal');
        if (modal) modal.classList.add('hidden');
    }

    /* ═══════════════════════════════════════════════════════════
       SETUP UI EVENT LISTENERS
       ═══════════════════════════════════════════════════════════ */

    function setupUI() {
        // Tab switching
        var tabCreate = document.getElementById('duel-tab-create');
        var tabJoin = document.getElementById('duel-tab-join');
        var viewCreate = document.getElementById('duel-view-create');
        var viewJoin = document.getElementById('duel-view-join');
        var viewLobby = document.getElementById('duel-view-lobby');

        if (tabCreate && tabJoin) {
            tabCreate.addEventListener('click', function () {
                tabCreate.classList.add('active');
                tabJoin.classList.remove('active');
                viewCreate.classList.remove('hidden');
                viewJoin.classList.add('hidden');
                viewLobby.classList.add('hidden');
                createRoom();
            });

            tabJoin.addEventListener('click', function () {
                tabJoin.classList.add('active');
                tabCreate.classList.remove('active');
                viewJoin.classList.remove('hidden');
                viewCreate.classList.add('hidden');
                viewLobby.classList.add('hidden');
            });
        }

        // Join button
        var joinBtn = document.getElementById('duel-join-btn');
        var joinInput = document.getElementById('duel-join-code-input');
        if (joinBtn && joinInput) {
            joinBtn.addEventListener('click', function () {
                joinRoom(joinInput.value);
            });
            joinInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') joinRoom(joinInput.value);
            });
        }

        // Copy direct link button
        var copyBtn = document.getElementById('duel-copy-link-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', function () {
                if (!currentRoomId) return;
                var shareUrl = window.location.origin + window.location.pathname + '?duel=' + currentRoomId;
                navigator.clipboard.writeText(shareUrl).then(function () {
                    copyBtn.textContent = '✅ COPIED!';
                    setTimeout(function () { copyBtn.textContent = '📋 COPY LINK'; }, 2000);
                }).catch(function () {
                    prompt('Share this link with your challenger:', shareUrl);
                });
            });
        }

        // Start / Ready button
        var readyBtn = document.getElementById('duel-ready-btn');
        if (readyBtn) {
            readyBtn.addEventListener('click', function () {
                if (playerRole === 'host' && roomRef) {
                    roomRef.update({ status: 'countdown' });
                } else if (playerRole === 'guest' && roomRef) {
                    roomRef.child('guest/ready').set(true);
                }
            });
        }

        // Close button
        var closeBtn = document.getElementById('duel-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                leaveDuel();
                closeLobbyModal();
            });
        }

        // Rematch & Exit
        var rematchBtn = document.getElementById('duel-rematch-btn');
        var exitBtn = document.getElementById('duel-exit-btn');
        if (rematchBtn) rematchBtn.addEventListener('click', requestRematch);
        if (exitBtn) exitBtn.addEventListener('click', leaveDuel);

        // Menu "1v1 DUEL" button
        var duelBtn = document.getElementById('jg-duel-btn');
        if (duelBtn) {
            duelBtn.addEventListener('click', function () {
                openLobbyModal();
                createRoom();
            });
        }

        // Auto open if URL has ?duel=CODE
        var urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('duel')) {
            openLobbyModal();
        }
    }

    // Hook opponent rendering to game loop
    function hookRunnerLoop() {
        if (checkRunnerTimer) clearInterval(checkRunnerTimer);

        checkRunnerTimer = setInterval(function () {
            if (window.Runner && Runner.instance_) {
                var runner = Runner.instance_;
                var origUpdate = runner.update;

                runner.update = function () {
                    origUpdate.apply(this, arguments);
                    if (isDuelActive && runner.tRex) {
                        renderOpponentGhost(runner.canvasCtx, runner.tRex);
                    }
                };

                clearInterval(checkRunnerTimer);
            }
        }, 50);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setupUI();
            hookRunnerLoop();
        });
    } else {
        setupUI();
        hookRunnerLoop();
    }

    // Public API
    window.DuelRunner = {
        seededRandom: seededRandom,
        setSeed: setSeed,
        resetSeed: resetSeed,
        open: openLobbyModal,
        leave: leaveDuel,
        launch: launchDuelRace,
        isActive: function () { return isDuelActive; }
    };
})();
