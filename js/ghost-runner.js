/**
 * ghost-runner.js - Rival Challenger HUD & Mini-Ghost Engine (v2.0)
 * 
 * Concept:
 * - Moves the ghost completely OFF the player's main running track.
 * - Places an unobtrusive, stylish "Rival Challenger Box" at Top-Center of the screen.
 * - Displays #1 Leaderboard Champion's name, target score, and a live progress track.
 * - Inside the mini-box, the rival's miniature dinosaur runs along.
 * - THE MOMENT OF TRIUMPH: When the player surpasses the champion's score:
 *     * The rival mini-dino does a dramatic cartoon tumble/flip off the stage!
 *     * A glowing "💥 DEFEATED!" stamp slams down.
 *     * The box border flashes gold/cyan celebrating the player as the new #1!
 */
(function () {
    'use strict';

    var isEnabled = true;
    var rivalName = 'CYCAD_34';
    var targetScore = 685;
    var isDefeated = false;
    var defeatTriggered = false;

    // Mini-stage dino state
    var miniCanvas = null;
    var miniCtx = null;
    var miniAnim = {
        frameIdx: 0,
        lastTick: 0,
        x: 14,
        y: 18,
        vy: 0,
        angle: 0,
        spinSpeed: 0,
        falling: false,
        sparks: []
    };

    var rivalHudEl = null;
    var nameEl = null;
    var targetScoreEl = null;
    var progressFillEl = null;
    var playerMarkerEl = null;
    var gapLabelEl = null;
    var statusMsgEl = null;
    var koStampEl = null;

    var animLoopId = null;

    function initRivalTarget() {
        isDefeated = false;
        defeatTriggered = false;
        miniAnim.x = 14;
        miniAnim.y = 18;
        miniAnim.vy = 0;
        miniAnim.angle = 0;
        miniAnim.spinSpeed = 0;
        miniAnim.falling = false;
        miniAnim.sparks = [];

        if (koStampEl) {
            koStampEl.classList.add('hidden');
            koStampEl.classList.remove('stamp-active');
        }
        if (rivalHudEl) {
            rivalHudEl.classList.remove('defeated-mode');
        }

        // Fetch Top Player from LocalStorage / Firebase Cache
        try {
            var raw = localStorage.getItem('jungleRunnerLeaderboard_v1');
            if (raw) {
                var list = JSON.parse(raw);
                if (Array.isArray(list) && list.length > 0 && list[0].score > 0) {
                    rivalName = String(list[0].name).toUpperCase().substring(0, 10);
                    targetScore = parseInt(list[0].score, 10);
                    updateHudStaticData();
                    return;
                }
            }
        } catch (e) {}

        // Fallback to high score or default
        if (window.Runner && Runner.instance_ && Runner.instance_.highestScore > 0) {
            rivalName = 'PERSONAL BEST';
            targetScore = parseInt(Runner.instance_.highestScore, 10);
        } else {
            rivalName = 'APEX SHADOW';
            targetScore = 350;
        }

        updateHudStaticData();
    }

    function updateHudStaticData() {
        if (nameEl) nameEl.textContent = rivalName;
        if (targetScoreEl) {
            var s = String(targetScore);
            while (s.length < 5) s = '0' + s;
            targetScoreEl.textContent = s;
        }
    }

    function createMiniSparks(x, y) {
        for (var i = 0; i < 20; i++) {
            var a = Math.random() * Math.PI * 2;
            var spd = 1 + Math.random() * 3.5;
            miniAnim.sparks.push({
                x: x,
                y: y,
                vx: Math.cos(a) * spd,
                vy: Math.sin(a) * spd - 1,
                radius: 1 + Math.random() * 2,
                alpha: 1.0,
                color: Math.random() > 0.4 ? '#ff007f' : '#00ffcc'
            });
        }
    }

    function triggerDefeat() {
        if (defeatTriggered) return;
        defeatTriggered = true;
        isDefeated = true;

        // Start dramatic cartoon tumble physics!
        miniAnim.falling = true;
        miniAnim.vy = -4.5;       // Hop up first
        miniAnim.spinSpeed = 0.28; // Rapid spin

        createMiniSparks(28, 20);

        if (koStampEl) {
            koStampEl.classList.remove('hidden');
            setTimeout(function () {
                koStampEl.classList.add('stamp-active');
            }, 20);
        }

        if (rivalHudEl) {
            rivalHudEl.classList.add('defeated-mode');
        }

        if (statusMsgEl) {
            statusMsgEl.innerHTML = '🏆 <span style="color:#00ffcc; font-weight:bold;">NEW #1 RECORD!</span>';
        }

        // Trigger celebratory Web Audio chord
        if (window.Runner && Runner.instance_ && Runner.instance_.playSound && Runner.instance_.soundFx) {
            Runner.instance_.playSound(Runner.instance_.soundFx.SCORE);
        }
    }

    /**
     * Render the mini running dino inside the small stage canvas
     */
    function renderMiniStage() {
        if (!miniCtx || !miniCanvas) return;

        miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);

        // Get sprite frame
        var frame = null;
        if (window.JungleTheme && typeof JungleTheme.getDinoFrame === 'function') {
            frame = JungleTheme.getDinoFrame(miniAnim.falling ? 'CRASHED' : 'RUNNING');
        }

        // Mini Dino Physics (Running vs Falling)
        if (miniAnim.falling) {
            miniAnim.y += miniAnim.vy;
            miniAnim.vy += 0.35; // Gravity
            miniAnim.angle += miniAnim.spinSpeed;
        }

        // Render Dinosaur
        miniCtx.save();
        miniCtx.translate(miniAnim.x + 14, miniAnim.y + 12);
        if (miniAnim.angle !== 0) {
            miniCtx.rotate(miniAnim.angle);
        }

        // Holographic purple glow tint
        miniCtx.shadowColor = isDefeated ? '#ff007f' : '#d946ef';
        miniCtx.shadowBlur = 8;

        if (frame) {
            // Draw scaled down mini sprite (28x24)
            miniCtx.drawImage(frame, -14, -12, 28, 24);
        } else {
            // Fallback simple pixel dino shape
            miniCtx.fillStyle = isDefeated ? '#ff007f' : '#d946ef';
            miniCtx.fillRect(-12, -10, 24, 20);
        }

        miniCtx.restore();

        // Render mini sparks if falling
        if (miniAnim.sparks.length > 0) {
            miniCtx.save();
            for (var i = miniAnim.sparks.length - 1; i >= 0; i--) {
                var p = miniAnim.sparks[i];
                p.x += p.vx;
                p.y += p.vy;
                p.alpha -= 0.035;
                if (p.alpha <= 0) {
                    miniAnim.sparks.splice(i, 1);
                } else {
                    miniCtx.globalAlpha = p.alpha;
                    miniCtx.fillStyle = p.color;
                    miniCtx.beginPath();
                    miniCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                    miniCtx.fill();
                }
            }
            miniCtx.restore();
        }

        animLoopId = requestAnimationFrame(renderMiniStage);
    }

    /**
     * Called on every game update to update distance gap and progress bar
     */
    function updateTelemetry(curScore) {
        if (!isEnabled || !rivalHudEl) return;

        // Hide during start menu; show during game
        var startMenu = document.getElementById('jungle-start-menu');
        if (startMenu && !startMenu.classList.contains('hidden')) {
            rivalHudEl.classList.add('hidden');
            return;
        } else {
            rivalHudEl.classList.remove('hidden');
        }

        var tScore = Math.max(targetScore, 1);
        var progress = Math.min((curScore / tScore) * 100, 100);

        if (progressFillEl) {
            progressFillEl.style.width = progress + '%';
        }
        if (playerMarkerEl) {
            playerMarkerEl.style.left = progress + '%';
        }

        var gap = tScore - curScore;

        if (gap > 0) {
            if (gapLabelEl) {
                gapLabelEl.textContent = 'GAP: -' + gap + ' PTS';
            }
            if (statusMsgEl && !isDefeated) {
                statusMsgEl.textContent = 'CHASING #1';
            }
        } else {
            // Player has overtaken the record!
            var lead = Math.abs(gap);
            if (gapLabelEl) {
                gapLabelEl.innerHTML = '<span style="color:#00ffcc;">LEAD: +' + lead + ' PTS</span>';
            }
            if (!isDefeated) {
                triggerDefeat();
            }
        }
    }

    function toggleRivalHud() {
        isEnabled = !isEnabled;
        if (rivalHudEl) {
            if (isEnabled) {
                rivalHudEl.style.display = 'flex';
            } else {
                rivalHudEl.style.display = 'none';
            }
        }
        showToast(isEnabled ? '👑 RIVAL TRACKER: ON' : '👑 RIVAL TRACKER: OFF');
        updateButtons();
    }

    function showToast(msg) {
        var existing = document.getElementById('rival-toast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.id = 'rival-toast';
        toast.className = 'rival-toast';
        toast.innerText = msg;
        document.body.appendChild(toast);
        setTimeout(function () {
            toast.style.opacity = '0';
            setTimeout(function () { toast.remove(); }, 300);
        }, 1200);
    }

    function updateButtons() {
        var menuBtn = document.getElementById('jg-ghost-toggle-btn');
        if (menuBtn) {
            menuBtn.innerHTML = isEnabled ? '👑 RIVAL RACER: ON' : '👑 RIVAL RACER: OFF';
            if (isEnabled) {
                menuBtn.classList.add('active');
            } else {
                menuBtn.classList.remove('active');
            }
        }
        var miniBtn = document.getElementById('ghost-mini-toggle-btn');
        if (miniBtn) {
            miniBtn.style.opacity = isEnabled ? '1.0' : '0.45';
        }
    }

    function buildUI() {
        // Create the Rival Challenger Box at Top Center
        rivalHudEl = document.createElement('div');
        rivalHudEl.id = 'rival-hud';
        rivalHudEl.className = 'rival-hud hidden';
        rivalHudEl.innerHTML = 
            '<div class="rival-header">' +
                '<div class="rival-badge">' +
                    '<span class="rival-crown">👑</span>' +
                    '<span id="rival-name" class="rival-name">CYCAD_34</span>' +
                '</div>' +
                '<div class="rival-score-tag">' +
                    '<span class="rival-label">TARGET:</span>' +
                    '<span id="rival-target-score" class="rival-target-val">00685</span>' +
                '</div>' +
            '</div>' +
            '<div class="rival-track-row">' +
                '<div class="rival-stage">' +
                    '<canvas id="rival-dino-canvas" width="56" height="42"></canvas>' +
                    '<div id="rival-ko-stamp" class="rival-ko-stamp hidden">💥 KO!</div>' +
                '</div>' +
                '<div class="rival-progress-wrap">' +
                    '<div class="rival-progress-bar">' +
                        '<div id="rival-progress-fill" class="rival-progress-fill" style="width: 0%;"></div>' +
                        '<div id="rival-player-marker" class="rival-player-marker">🦖</div>' +
                    '</div>' +
                    '<div class="rival-gap-info">' +
                        '<span id="rival-gap-label" class="rival-gap-val">GAP: -685 PTS</span>' +
                        '<span id="rival-status-text" class="rival-status-msg">CHASING #1</span>' +
                    '</div>' +
                '</div>' +
            '</div>';

        document.body.appendChild(rivalHudEl);

        nameEl = document.getElementById('rival-name');
        targetScoreEl = document.getElementById('rival-target-score');
        progressFillEl = document.getElementById('rival-progress-fill');
        playerMarkerEl = document.getElementById('rival-player-marker');
        gapLabelEl = document.getElementById('rival-gap-label');
        statusMsgEl = document.getElementById('rival-status-text');
        koStampEl = document.getElementById('rival-ko-stamp');

        miniCanvas = document.getElementById('rival-dino-canvas');
        miniCtx = miniCanvas.getContext('2d');

        // Toggle on 'G' key
        window.addEventListener('keydown', function (e) {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            if (e.key === 'g' || e.key === 'G') {
                toggleRivalHud();
            }
        });

        // Add menu button
        var startMenu = document.getElementById('jungle-start-menu');
        if (startMenu) {
            var panel = startMenu.querySelector('.jungle-panel');
            if (panel) {
                var btnContainer = document.createElement('div');
                btnContainer.style.margin = '4px 0 10px 0';

                var ghostBtn = document.createElement('button');
                ghostBtn.id = 'jg-ghost-toggle-btn';
                ghostBtn.className = 'jg-btn jg-btn-ghost active';
                ghostBtn.innerHTML = '👑 RIVAL RACER: ON';
                ghostBtn.title = 'Race against #1 Champion HUD (Press G)';
                ghostBtn.addEventListener('click', toggleRivalHud);

                btnContainer.appendChild(ghostBtn);

                var aiContainer = panel.querySelector('.ai-toggle-container');
                if (aiContainer) {
                    panel.insertBefore(btnContainer, aiContainer.nextSibling);
                } else {
                    panel.appendChild(btnContainer);
                }
            }
        }

        // Mini button in audio controls
        var audioControls = document.getElementById('jungle-audio-controls');
        if (audioControls) {
            var miniGhost = document.createElement('button');
            miniGhost.id = 'ghost-mini-toggle-btn';
            miniGhost.className = 'mute-btn';
            miniGhost.innerHTML = '👑';
            miniGhost.title = 'Toggle Rival Challenger HUD (G)';
            miniGhost.style.marginRight = '8px';
            miniGhost.addEventListener('click', toggleRivalHud);
            audioControls.insertBefore(miniGhost, audioControls.firstChild);
        }

        // Start mini canvas render loop
        renderMiniStage();
        updateButtons();
    }

    // Hook cleanly into Runner's restart/start events
    var hookInterval = setInterval(function () {
        if (window.Runner && Runner.instance_) {
            var r = Runner.instance_;
            
            var origRestart = r.restart;
            r.restart = function () {
                initRivalTarget();
                if (origRestart) origRestart.call(this);
            };

            var origStart = r.startGame;
            r.startGame = function () {
                initRivalTarget();
                if (origStart) origStart.call(this);
            };

            // Hook live score telemetry update
            var origUpdate = r.update;
            r.update = function () {
                origUpdate.call(this);
                if (this.playing && !this.crashed) {
                    var curScore = this.distanceMeter
                        ? this.distanceMeter.getActualDistance(Math.ceil(this.distanceRan))
                        : Math.ceil(this.distanceRan);
                    updateTelemetry(curScore);
                }
            };

            initRivalTarget();
            clearInterval(hookInterval);
        }
    }, 50);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildUI);
    } else {
        buildUI();
    }

    window.RivalRunner = {
        toggle: toggleRivalHud,
        initTarget: initRivalTarget,
        isEnabled: function () { return isEnabled; }
    };
})();
