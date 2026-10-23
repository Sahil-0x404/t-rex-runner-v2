/**
 * jungle-theme.js
 * Prehistoric Jungle theme engine.
 * - Full-color green Dino animated frames (Idle, Run, Jump, Dead, Walk/Duck)
 * - Bioluminescent Emerald Cacti with neon pink spore tips
 * - Midnight Indigo Pterodactyls with glowing cyan wings
 * - Mint-green ground line
 * - High-visibility neon arcade score HUD (HI and SCORE counters)
 * - Web Audio procedural sound design (jump chirp, duck swoosh, crash roar, milestone chime)
 * - Persistent Top 5 Leaderboard (localStorage)
 * - Full navigation: Play Again and Main Menu return
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════
     1. AUDIO ENGINE (Web Audio API - Zero dependencies)
  ═══════════════════════════════════════════════════════ */
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  var audioCtx = null;
  var masterGain = null;
  var muted = false;
  var volume = 0.45;

  function ensureAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return;
    }
    try {
      audioCtx = new AudioCtx();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(audioCtx.destination);
    } catch (e) {
      audioCtx = null;
    }
  }

  function playTone(freq, type, attack, sustain, decay, delay, detune) {
    if (!audioCtx || muted) return;
    delay = delay || 0;
    detune = detune || 0;
    var t = audioCtx.currentTime + delay;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (detune) osc.detune.setValueAtTime(detune, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.4, t + attack);
    gain.gain.setValueAtTime(0.4, t + attack + sustain);
    gain.gain.exponentialRampToValueAtTime(0.001, t + attack + sustain + decay);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + attack + sustain + decay + 0.01);
  }

  function playNoise(cutoff, duration, delay) {
    if (!audioCtx || muted) return;
    delay = delay || 0;
    var bufSize = Math.floor(audioCtx.sampleRate * duration);
    var buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    var src = audioCtx.createBufferSource();
    src.buffer = buf;
    var filt = audioCtx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = cutoff;
    filt.Q.value = 1.5;
    var g = audioCtx.createGain();
    g.gain.setValueAtTime(0.2, audioCtx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + duration);
    src.connect(filt);
    filt.connect(g);
    g.connect(masterGain);
    src.start(audioCtx.currentTime + delay);
    src.stop(audioCtx.currentTime + delay + duration);
  }

  var JungleAudio = {
    jump: function () {
      ensureAudio();
      playTone(240, 'sine', 0.01, 0.0, 0.12, 0);
      playTone(420, 'sine', 0.01, 0.0, 0.09, 0.04);
      playTone(560, 'triangle', 0.01, 0.0, 0.07, 0.08);
    },
    hit: function () {
      ensureAudio();
      playTone(85, 'sawtooth', 0.005, 0.08, 0.55, 0);
      playTone(60, 'sawtooth', 0.005, 0.1, 0.65, 0, -25);
      playNoise(220, 0.5, 0);
      playTone(150, 'square', 0.01, 0.05, 0.35, 0.08);
    },
    score: function () {
      ensureAudio();
      playTone(523, 'sine', 0.01, 0.04, 0.18, 0);
      playTone(659, 'sine', 0.01, 0.04, 0.18, 0.10);
      playTone(784, 'sine', 0.01, 0.06, 0.25, 0.20);
    },
    duck: function () {
      ensureAudio();
      playTone(320, 'sawtooth', 0.005, 0, 0.12, 0);
      playNoise(850, 0.12, 0);
    }
  };

  /* ═══════════════════════════════════════════════════════
     2. DINO ANIMATION FRAMES PRELOADER
  ═══════════════════════════════════════════════════════ */
  var frames = { IDLE: [], RUN: [], JUMP: [], DEAD: [], WALK: [] };
  var loadedCount = 0;

  function loadImg(category, idx) {
    var map = { IDLE: 'Idle', RUN: 'Run', JUMP: 'Jump', DEAD: 'Dead', WALK: 'Walk' };
    var img = new Image();
    img.src = 'assets/dino/' + map[category] + ' (' + idx + ').png';
    img.onload = function () {
      loadedCount++;
      if (window.Runner && Runner.instance_ && !Runner.instance_.playing) {
        var r = Runner.instance_;
        r.clearCanvas();
        if (r.horizon && r.horizon.horizonLine && r.horizon.horizonLine.draw) {
          r.horizon.horizonLine.draw();
        }
        if (r.tRex) {
          r.tRex.draw(0, 0);
        }
      }
    };
    return img;
  }

  (function preload() {
    for (var i = 1; i <= 10; i++) frames.IDLE.push(loadImg('IDLE', i));
    for (var i = 1; i <= 8; i++)  frames.RUN.push(loadImg('RUN', i));
    for (var i = 1; i <= 12; i++) frames.JUMP.push(loadImg('JUMP', i));
    for (var i = 1; i <= 8; i++)  frames.DEAD.push(loadImg('DEAD', i));
    for (var i = 1; i <= 10; i++) frames.WALK.push(loadImg('WALK', i));
  })();

  var animState = {
    status: '',
    frameIdx: 0,
    lastFrameAt: 0,
    crashLocked: false
  };

  function getDinoFrame(status) {
    var now = Date.now();
    var sets = {
      WAITING:  { arr: frames.IDLE, fps: 8  },
      RUNNING:  { arr: frames.RUN,  fps: 14 },
      JUMPING:  { arr: frames.JUMP, fps: 15 },
      CRASHED:  { arr: frames.DEAD, fps: 9  },
      DUCKING:  { arr: frames.RUN,  fps: 16 }
    };
    var s = sets[status] || sets.WAITING;

    if (animState.status !== status) {
      animState.status = status;
      animState.frameIdx = 0;
      animState.lastFrameAt = now;
      if (status !== 'CRASHED') animState.crashLocked = false;
    }

    var msPerFrame = 1000 / s.fps;
    if (now - animState.lastFrameAt > msPerFrame) {
      if (status === 'CRASHED') {
        if (!animState.crashLocked) {
          animState.frameIdx++;
          if (animState.frameIdx >= s.arr.length) {
            animState.frameIdx = s.arr.length - 1;
            animState.crashLocked = true;
          }
        }
      } else {
        animState.frameIdx = (animState.frameIdx + 1) % s.arr.length;
      }
      animState.lastFrameAt = now;
    }

    var frame = s.arr[Math.min(animState.frameIdx, s.arr.length - 1)];
    return (frame && frame.complete && frame.naturalWidth > 0) ? frame : null;
  }

  /* ═══════════════════════════════════════════════════════
     3. CLEAN PROTOTYPE OVERRIDES
  ═══════════════════════════════════════════════════════ */
  function patchGamePrototypes() {
    if (!window.Runner) return;

    /* ── Bypass legacy webkitAnimationEnd intro lock ── */
    Runner.prototype.playIntro = function () {
      if (this.activated) return;
      this.playingIntro = false;
      this.activated = true;
      if (this.tRex) {
        this.tRex.playingIntro = false;
        this.tRex.status = Trex.status.RUNNING;
      }
      this.startGame();
    };

    var origStartGame = Runner.prototype.startGame;
    Runner.prototype.startGame = function () {
      if (origStartGame) origStartGame.call(this);
      this.activated = true;
      this.playingIntro = false;
      if (this.tRex) {
        this.tRex.playingIntro = false;
        this.tRex.status = Trex.status.RUNNING;
      }
    };

    /* Safe loadSounds replacing broken native base64 decoding */
    Runner.prototype.loadSounds = function () {
      ensureAudio();
      this.soundFx = {
        BUTTON_PRESS: 'BUTTON_PRESS',
        HIT: 'HIT',
        SCORE: 'SCORE'
      };
    };

    /* ── T-Rex Player Rendering ────────────────────────── */
    if (window.Trex && Trex.prototype) {
      var origTrexDraw = Trex.prototype.draw;
      Trex.prototype.draw = function (x, y) {
        var status = this.status;
        var isDuck = (this.ducking || status === Trex.status.DUCKING) && status !== Trex.status.CRASHED;
        var animStatus = isDuck ? 'DUCKING' : status;
        if (window.Runner && Runner.instance_ && Runner.instance_.playing && animStatus === Trex.status.WAITING) {
          animStatus = Trex.status.RUNNING;
        }
        var frame = getDinoFrame(animStatus);
        if (frame) {
          var w = isDuck ? 88 : 66;
          var h = isDuck ? 35 : 58;
          var drawX = this.xPos - (isDuck ? 4 : 8);
          var drawY = this.yPos + this.config.HEIGHT - h;

          this.canvasCtx.save();
          if (isDuck) {
            // Speed dash afterimage for aerodynamic low ducking motion
            this.canvasCtx.save();
            this.canvasCtx.globalAlpha = 0.3;
            this.canvasCtx.drawImage(frame, drawX - 14, drawY + 1, w, h);
            this.canvasCtx.restore();
          }
          this.canvasCtx.drawImage(frame, drawX, drawY, w, h);
          this.canvasCtx.restore();
          return;
        }
        origTrexDraw.call(this, x, y);
      };
    }

    /* ── Obstacle Rendering (Glowing Cacti & Indigo Pterosaurs) ── */
    if (window.Obstacle && Obstacle.prototype) {
      if (Obstacle.types) {
        for (var oi = 0; oi < Obstacle.types.length; oi++) {
          if (Obstacle.types[oi].type === 'PTERODACTYL') {
            Obstacle.types[oi].minSpeed = 6.0;
          }
        }
      }
      var origObstacleDraw = Obstacle.prototype.draw;
      Obstacle.prototype.draw = function () {
        var type = this.typeConfig ? this.typeConfig.type : '';
        var isCactus = type.indexOf('CACTUS') !== -1;
        var isPtero = type === 'PTERODACTYL';
        var ctx = this.canvasCtx;

        if (isCactus) {
          ctx.save();
          ctx.shadowBlur = 14;
          ctx.shadowColor = '#00ffaa';
          origObstacleDraw.call(this);

          // Emerald glow overlay
          var w = this.typeConfig.width * this.size;
          var h = this.typeConfig.height;
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = 'rgba(0, 255, 140, 0.88)';
          ctx.fillRect(this.xPos, this.yPos, w, h);

          // Bioluminescent spore tips
          ctx.fillStyle = 'rgba(255, 80, 220, 0.7)';
          ctx.fillRect(this.xPos, this.yPos, w, 5);
          ctx.restore();
          return;
        }

        if (isPtero) {
          ctx.save();
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#00e5ff';
          origObstacleDraw.call(this);

          var pw = this.typeConfig.width * this.size;
          var ph = this.typeConfig.height;
          ctx.globalCompositeOperation = 'source-atop';
          // Midnight indigo body
          ctx.fillStyle = 'rgba(30, 5, 75, 0.9)';
          ctx.fillRect(this.xPos, this.yPos, pw, ph);
          // Neon cyan wing membranes
          ctx.fillStyle = 'rgba(0, 230, 255, 0.65)';
          ctx.fillRect(this.xPos, this.yPos, pw, ph * 0.55);
          ctx.restore();
          return;
        }

        origObstacleDraw.call(this);
      };
    }

    /* ── Horizon Line (Neon Mint-Green Turf) ────────────── */
    if (window.HorizonLine && HorizonLine.prototype) {
      var origHorizonDraw = HorizonLine.prototype.draw;
      HorizonLine.prototype.draw = function () {
        var ctx = this.canvasCtx;
        ctx.save();
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#00ffaa';
        origHorizonDraw.call(this);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = '#00ffaa';
        ctx.fillRect(0, this.yPos, this.dimensions.WIDTH, this.dimensions.HEIGHT);
        ctx.restore();
      };
    }

    /* ── Suppress old canvas distance meter so clean HTML HUD is shown ── */
    if (window.DistanceMeter && DistanceMeter.prototype) {
      DistanceMeter.prototype.draw = function () {
        // Suppressed: Score is now displayed in clean crisp white in #jungle-hud
      };
      DistanceMeter.prototype.drawHighScore = function () {
        // Suppressed
      };
    }

    /* ── Sound Hook ────────────────────────────────────── */
    var origPlaySound = Runner.prototype.playSound;
    Runner.prototype.playSound = function (soundBuffer) {
      if (!soundBuffer) return;
      if (soundBuffer === 'BUTTON_PRESS' || (this.soundFx && soundBuffer === this.soundFx.BUTTON_PRESS)) {
        JungleAudio.jump();
        return;
      }
      if (soundBuffer === 'HIT' || (this.soundFx && soundBuffer === this.soundFx.HIT)) {
        JungleAudio.hit();
        return;
      }
      if (soundBuffer === 'SCORE' || (this.soundFx && soundBuffer === this.soundFx.SCORE)) {
        JungleAudio.score();
        return;
      }
      if (origPlaySound) origPlaySound.call(this, soundBuffer);
    };

    function isAnyOverlayOpen() {
      var startMenu = document.getElementById('jungle-start-menu');
      var goMenu = document.getElementById('jungle-gameover');
      var startVis = startMenu && !startMenu.classList.contains('hidden');
      var goVis = goMenu && !goMenu.classList.contains('hidden');
      return !!(startVis || goVis);
    }

    /* Suppress all native runner events when menus or dialogs are active */
    var origHandleEvent = Runner.prototype.handleEvent;
    if (origHandleEvent) {
      Runner.prototype.handleEvent = function (e) {
        if (isAnyOverlayOpen()) {
          return;
        }
        origHandleEvent.call(this, e);
      };
    }

    var origKeyDown = Runner.prototype.onKeyDown;
    if (origKeyDown) {
      Runner.prototype.onKeyDown = function (e) {
        if (isAnyOverlayOpen()) {
          return;
        }
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (!this.playing || this.crashed) {
          return;
        }
        if ((e.keyCode === 40 || e.keyCode === 18) && this.playing && !this.crashed) {
          if (this.tRex && !this.tRex.ducking) {
            JungleAudio.duck();
          }
        }
        origKeyDown.call(this, e);
      };
    }

    var origKeyUp = Runner.prototype.onKeyUp;
    if (origKeyUp) {
      Runner.prototype.onKeyUp = function (e) {
        if (isAnyOverlayOpen()) {
          return;
        }
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (this.crashed) {
          // Never restart via keyup when crashed — restarts are exclusively via PLAY AGAIN button
          return;
        }
        origKeyUp.call(this, e);
      };
    }

    /* Live HUD Score update on every frame */
    var origUpdate = Runner.prototype.update;
    Runner.prototype.update = function () {
      origUpdate.call(this);
      if (this.playing && !this.crashed) {
        var curScore = this.distanceMeter
          ? this.distanceMeter.getActualDistance(Math.ceil(this.distanceRan))
          : Math.ceil(this.distanceRan);
        updateHUD(curScore);
      }
    };

    /* Reset HUD on game restart */
    var origRestart = Runner.prototype.restart;
    Runner.prototype.restart = function () {
      updateHUD(0);
      if (origRestart) origRestart.call(this);
    };

    /* Game Over hook */
    var origGameOver = Runner.prototype.gameOver;
    Runner.prototype.gameOver = function () {
      origGameOver.call(this);

      // Visceral 150ms screen jitter on impact
      var container = document.getElementById('main-frame-error') || document.body;
      if (container) {
        container.classList.remove('camera-shake');
        void container.offsetWidth; // force reflow
        container.classList.add('camera-shake');
        setTimeout(function () {
          container.classList.remove('camera-shake');
        }, 160);
      }

      var score = this.distanceMeter
        ? this.distanceMeter.getActualDistance(Math.ceil(this.distanceRan))
        : Math.ceil(this.distanceRan);
      updateHUD(score);
      setTimeout(function () { showGameOver(score); }, 650);
    };

    /* Disable night mode canvas color inversion */
    Runner.prototype.invert = function () { /* suppressed */ };
  }

  /* ═══════════════════════════════════════════════════════
     4. PLAYER IDENTITY & LEADERBOARD MANAGEMENT
  ═══════════════════════════════════════════════════════ */
  var LB_KEY = 'jungleRunnerLeaderboard_v1';
  var PLAYER_NAME_KEY = 'jungleRunnerPlayerName_v1';

  var RANDOM_NAMES = [
    'Rex', 'Raptor', 'Dino', 'Hunter', 'Amber', 'Fern',
    'Apex', 'Viper', 'Moss', 'Fang', 'Cycad', 'Tracker',
    'Ranger', 'Shadow', 'Scout', 'Claw', 'Chrono', 'Titan'
  ];

  function generateRandomPlayerName() {
    var base = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
    var num = Math.floor(Math.random() * 90 + 10);
    return base + '_' + num;
  }

  function getPlayerName() {
    try {
      var saved = localStorage.getItem(PLAYER_NAME_KEY);
      if (saved && saved.trim().length > 0) {
        return saved.trim().substring(0, 12);
      }
    } catch (e) {}

    // No persistent name yet -> generate a cool random one and remember it!
    var randomName = generateRandomPlayerName();
    setPlayerName(randomName);
    return randomName;
  }

  function setPlayerName(name) {
    if (!name || !name.trim()) return;
    try {
      localStorage.setItem(PLAYER_NAME_KEY, name.trim().substring(0, 12));
    } catch (e) {}
  }

  window.JunglePlayerName = {
    get: getPlayerName,
    set: setPlayerName,
    generate: generateRandomPlayerName
  };

  var Leaderboard = {
    load: function () {
      try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; }
      catch (e) { return []; }
    },
    save: function (entries) {
      try { localStorage.setItem(LB_KEY, JSON.stringify(entries)); } catch (e) {}
    },
    isTopFive: function (score) {
      if (score <= 0) return false;
      var e = this.load();
      return e.length < 5 || score > e[e.length - 1].score;
    },
    add: function (name, score) {
      var e = this.load();
      var playerName = (name && name.trim().length > 0) ? name.trim().substring(0, 12) : getPlayerName();
      setPlayerName(playerName);
      e.push({
        name: playerName,
        score: score,
        date: new Date().toLocaleDateString()
      });
      e.sort(function (a, b) { return b.score - a.score; });
      if (e.length > 5) e = e.slice(0, 5);
      this.save(e);
      return e;
    },
    render: function (tbodyId) {
      var tb = document.getElementById(tbodyId);
      if (!tb) return;
      var e = this.load();
      var medals = ['🥇', '🥈', '🥉', '④', '⑤'];
      tb.innerHTML = e.length === 0
        ? '<tr><td colspan="4" style="text-align:center;opacity:0.5;padding:12px">No scores yet — be the first!</td></tr>'
        : e.map(function (r, i) {
            return '<tr class="lb-row">' +
              '<td>' + medals[i] + '</td>' +
              '<td>' + r.name + '</td>' +
              '<td class="lb-score">' + r.score + '</td>' +
              '<td class="lb-date">' + r.date + '</td>' +
            '</tr>';
          }).join('');
    }
  };
  window.JungleLeaderboard = Leaderboard;

  function formatScore(n) {
    var val = Math.max(0, Math.floor(n || 0));
    var s = String(val);
    while (s.length < 5) s = '0' + s;
    return s;
  }

  function getHighScore() {
    var lb = Leaderboard.load();
    var lbMax = (lb && lb.length > 0) ? lb[0].score : 0;
    var runnerMax = 0;
    if (window.Runner && Runner.instance_ && Runner.instance_.highestScore) {
      var r = Runner.instance_;
      runnerMax = r.distanceMeter && r.distanceMeter.getActualDistance
        ? r.distanceMeter.getActualDistance(r.highestScore)
        : Math.round(r.highestScore * 0.025);
    }
    return Math.max(lbMax, runnerMax);
  }

  var lastMilestone = 0;
  function updateHUD(currentScore) {
    var hiEl = document.getElementById('hud-hi-score');
    var curEl = document.getElementById('hud-current-score');
    var scoreVal = Math.floor(currentScore || 0);

    if (curEl) {
      curEl.textContent = formatScore(scoreVal);
    }

    var hiVal = Math.max(scoreVal, getHighScore());
    if (hiEl) {
      hiEl.textContent = formatScore(hiVal);
    }

    // Milestone pulse flash every 100 points
    if (scoreVal > 0 && Math.floor(scoreVal / 100) > lastMilestone) {
      lastMilestone = Math.floor(scoreVal / 100);
      var currBox = document.querySelector('.hud-curr-box');
      if (currBox) {
        currBox.classList.remove('hud-flash');
        void currBox.offsetWidth;
        currBox.classList.add('hud-flash');
      }
    } else if (scoreVal === 0) {
      lastMilestone = 0;
    }
  }
  window.updateJungleHUD = updateHUD;

  function showGameOver(score) {
    var el = document.getElementById('jungle-gameover');
    if (!el) return;
    el.classList.remove('hidden');

    var scoreEl = document.getElementById('jg-final-score');
    if (scoreEl) scoreEl.textContent = 'SCORE: ' + score;

    var nhSection = document.getElementById('jg-new-highscore');
    var saveBtn = document.getElementById('jg-save-btn');
    var nameInput = document.getElementById('jg-name-input');

    Leaderboard.render('jg-lb-body');

    if (Leaderboard.isTopFive(score)) {
      if (nhSection) nhSection.classList.remove('hidden');

      var defaultName = getPlayerName();
      if (nameInput) {
        nameInput.value = defaultName;
        setTimeout(function () {
          nameInput.focus();
          nameInput.select();
        }, 50);
      }
      if (saveBtn) {
        saveBtn.onclick = function () {
          var inputVal = nameInput ? nameInput.value.trim() : '';
          var finalName = inputVal || defaultName || getPlayerName();
          setPlayerName(finalName);
          Leaderboard.add(finalName, score);
          Leaderboard.render('jg-lb-body');
          if (nhSection) nhSection.classList.add('hidden');
          updateHUD(score);
        };
      }
      if (nameInput) {
        nameInput.onkeydown = function (e) {
          if (e.keyCode === 13) { // Enter key saves score
            e.preventDefault();
            if (saveBtn) saveBtn.click();
          }
        };
      }
    } else {
      if (nhSection) nhSection.classList.add('hidden');
    }
  }

  /* ═══════════════════════════════════════════════════════
     5. MENU & NAVIGATION CONTROLS
  ═══════════════════════════════════════════════════════ */
  function startGameplay() {
    var startMenu = document.getElementById('jungle-start-menu');
    var goMenu = document.getElementById('jungle-gameover');
    if (startMenu) {
      startMenu.style.opacity = '0';
      startMenu.classList.add('hidden');
    }
    if (goMenu) {
      goMenu.classList.add('hidden');
    }
    ensureAudio();

    if (window.Runner && Runner.instance_) {
      var r = Runner.instance_;
      if (r.crashed) {
        r.restart();
      } else if (!r.playing) {
        r.playingIntro = false;
        r.activated = true;
        if (r.tRex) {
          r.tRex.playingIntro = false;
          r.tRex.status = Trex.status.RUNNING;
        }
        try { r.loadSounds(); } catch (e) {}
        r.playing = true;
        r.containerEl.style.width = r.dimensions.WIDTH + 'px';
        r.clearCanvas();
        r.startGame();
        r.update();
        if (r.tRex && !r.tRex.jumping) {
          r.playSound(r.soundFx ? r.soundFx.BUTTON_PRESS : 'BUTTON_PRESS');
          r.tRex.startJump(r.currentSpeed);
        }
      }
    }
  }

  function returnToMainMenu() {
    var goMenu = document.getElementById('jungle-gameover');
    var startMenu = document.getElementById('jungle-start-menu');
    if (goMenu) goMenu.classList.add('hidden');
    if (startMenu) {
      startMenu.classList.remove('hidden');
      startMenu.style.opacity = '1';
    }

    updateHUD(0);

    if (window.Runner && Runner.instance_) {
      var r = Runner.instance_;
      // Cancel active animation frame loop
      if (r.raqId) {
        cancelAnimationFrame(r.raqId);
        r.raqId = 0;
      }

      r.crashed = false;
      r.playing = false;
      r.activated = false;
      r.playingIntro = false;
      r.runningTime = 0;
      r.currentSpeed = r.config.SPEED;
      r.distanceRan = 0;

      if (r.containerEl) {
        r.containerEl.classList.remove(Runner.classes.CRASHED);
      }
      var mainWrapper = document.getElementById('main-frame-error') || document.body;
      if (mainWrapper) mainWrapper.classList.remove('camera-shake');

      // Reset obstacles and horizon
      if (r.horizon) {
        r.horizon.obstacles = [];
        r.horizon.reset();
      }

      // Reset distance meter
      if (r.distanceMeter) {
        r.distanceMeter.reset(r.highestScore);
      }

      // Reset Trex into resting WAITING state
      if (r.tRex) {
        r.tRex.status = Trex.status.WAITING;
        r.tRex.playingIntro = false;
        r.tRex.jumping = false;
        r.tRex.ducking = false;
        r.tRex.midair = false;
        r.tRex.speedDrop = false;
        r.tRex.jumpCount = 0;
        r.tRex.yPos = r.tRex.groundYPos;
        r.tRex.reset();
        r.tRex.status = Trex.status.WAITING;
      }

      // Redraw resting scene
      r.clearCanvas();
      if (r.horizon && r.horizon.horizonLine && r.horizon.horizonLine.draw) {
        r.horizon.horizonLine.draw();
      }
      if (r.tRex) {
        r.tRex.draw(0, 0);
      }
    }
  }

  function setupControls() {
    var playBtn = document.getElementById('jg-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        startGameplay();
      });
    }

    var lbBtn = document.getElementById('jg-lb-btn-start');
    if (lbBtn) {
      lbBtn.addEventListener('click', function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var startMenu = document.getElementById('jungle-start-menu');
        var goMenu = document.getElementById('jungle-gameover');
        Leaderboard.render('jg-lb-body');
        if (startMenu) startMenu.classList.add('hidden');
        if (goMenu) goMenu.classList.remove('hidden');
        var scoreEl = document.getElementById('jg-final-score');
        if (scoreEl) scoreEl.textContent = '🏆 HALL OF FAME';
        var nhSection = document.getElementById('jg-new-highscore');
        if (nhSection) nhSection.classList.add('hidden');
      });
    }

    var restartBtn = document.getElementById('jg-restart-btn');
    if (restartBtn) {
      restartBtn.addEventListener('click', function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var goMenu = document.getElementById('jungle-gameover');
        if (goMenu) goMenu.classList.add('hidden');
        if (window.Runner && Runner.instance_) {
          Runner.instance_.restart();
        }
        updateHUD(0);
        ensureAudio();
      });
    }

    var menuBtn = document.getElementById('jg-menu-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        returnToMainMenu();
      });
    }

    // Global keyboard handlers for Escape and Mute
    document.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

      // Escape key returns to main menu from gameover / leaderboard
      if (e.keyCode === 27) {
        var goMenu = document.getElementById('jungle-gameover');
        if (goMenu && !goMenu.classList.contains('hidden')) {
          returnToMainMenu();
          return;
        }
      }

      // M key for mute toggle
      if (e.keyCode === 77) {
        var muteBtn = document.getElementById('jungle-mute-btn');
        if (muteBtn) muteBtn.click();
      }
    });

    // Audio controls
    var muteBtn = document.getElementById('jungle-mute-btn');
    var volSlider = document.getElementById('jungle-vol-slider');
    if (muteBtn) {
      muteBtn.addEventListener('click', function () {
        ensureAudio();
        muted = !muted;
        muteBtn.textContent = muted ? '🔇' : '🔊';
        if (masterGain) masterGain.gain.value = muted ? 0 : volume;
      });
    }
    if (volSlider) {
      volSlider.addEventListener('input', function () {
        ensureAudio();
        volume = parseFloat(this.value) / 100;
        if (!muted && masterGain) masterGain.gain.value = volume;
      });
    }
  }

  /* ═══════════════════════════════════════════════════════
     6. BOOTSTRAP (Execute prototype patches immediately)
  ═══════════════════════════════════════════════════════ */
  patchGamePrototypes();

  function init() {
    patchGamePrototypes();
    setupControls();
    updateHUD(0);

    var checkRunner = setInterval(function () {
      if (window.Runner && Runner.instance_) {
        var r = Runner.instance_;
        if (r.containerEl) {
          r.containerEl.style.width = r.dimensions.WIDTH + 'px';
          r.containerEl.style.overflow = 'visible';
        }
        if (r.canvas) {
          r.canvas.style.background = 'transparent';
        }
        // Force redraw initial waiting frame
        if (!r.playing && r.tRex) {
          r.clearCanvas();
          if (r.horizon && r.horizon.horizonLine && r.horizon.horizonLine.draw) {
            r.horizon.horizonLine.draw();
          }
          r.tRex.draw(0, 0);
        }
        updateHUD(0);
        clearInterval(checkRunner);
      }
    }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
