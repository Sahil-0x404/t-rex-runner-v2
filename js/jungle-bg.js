/**
 * jungle-bg.js
 * Bioluminescent Prehistoric Jungle — Parallax & Dynamic Atmospheric Engine
 * - 4-Layer Parallax (Sky, Moon, Far Trees, Giant Mushroom, Mid Trees, Ground Flora, Grass)
 * - Dynamic Atmospheric Phases every 500 points (Midnight -> Violet Twilight -> Spore Rain -> Jade Eclipse)
 * - Tropical Bioluminescent Rain with speed-dependent slant
 * - Organic Fireflies & Floating Spores
 */
(function () {
  'use strict';

  var bgCanvas, ctx;
  var W, H;
  var layerX = [0, 0, 0, 0];
  var t = 0;

  function getGroundY() {
    var rCanvas = document.querySelector('.runner-canvas');
    if (rCanvas) {
      var rect = rCanvas.getBoundingClientRect();
      if (rect.height > 0) {
        return rect.top + 127 * (rect.height / 150);
      }
    }
    return H * 0.76;
  }

  /* ═══════════════════════════════════════════════════════
     1. ATMOSPHERIC PHASES & PALETTES
  ═══════════════════════════════════════════════════════ */
  var PHASES = [
    {
      // Phase 1 (0-499): Midnight Bioluminescence (Deep navy/teal)
      sky: [
        [3, 5, 12],    // stop 0
        [9, 19, 38],   // stop 0.35
        [8, 32, 26],   // stop 0.68
        [4, 18, 14]    // stop 1
      ],
      moonGlow: [180, 230, 255, 0.25],
      moonColor: '#d8f0ff',
      sporeColor: [180, 255, 220],
      rain: 0
    },
    {
      // Phase 2 (500-999): Twilight Violet Aurora (Cosmic purple & wine)
      sky: [
        [12, 3, 24],   // stop 0
        [28, 8, 48],   // stop 0.35
        [38, 11, 46],  // stop 0.68
        [18, 5, 22]    // stop 1
      ],
      moonGlow: [230, 180, 255, 0.30],
      moonColor: '#f3e2ff',
      sporeColor: [255, 175, 235],
      rain: 0
    },
    {
      // Phase 3 (1000-1499): Tropical Spore Storm & Rain (Slate-teal downpour)
      sky: [
        [2, 9, 20],    // stop 0
        [8, 26, 40],   // stop 0.35
        [12, 40, 48],  // stop 0.68
        [5, 24, 28]    // stop 1
      ],
      moonGlow: [140, 220, 240, 0.22],
      moonColor: '#d0f5ff',
      sporeColor: [150, 245, 255],
      rain: 1 // Active tropical neon rain
    },
    {
      // Phase 4 (1500+): Ancient Jade Eclipse (Toxic jade & amber horizon)
      sky: [
        [4, 10, 8],    // stop 0
        [6, 29, 21],   // stop 0.35
        [20, 44, 22],  // stop 0.68
        [12, 30, 15]   // stop 1
      ],
      moonGlow: [255, 190, 80, 0.35],
      moonColor: '#ffe29a',
      sporeColor: [220, 255, 160],
      rain: 0.35 // Ambient misty spore rain
    }
  ];

  function lerp(a, b, progress) {
    return a + (b - a) * progress;
  }

  function lerpColor(c1, c2, progress) {
    return [
      Math.round(lerp(c1[0], c2[0], progress)),
      Math.round(lerp(c1[1], c2[1], progress)),
      Math.round(lerp(c1[2], c2[2], progress))
    ];
  }

  function getCurrentPhase() {
    var score = 0;
    try {
      if (window.Runner && Runner.instance_) {
        var r = Runner.instance_;
        if (r.distanceMeter && r.distanceMeter.getActualDistance) {
          score = r.distanceMeter.getActualDistance(Math.ceil(r.distanceRan));
        } else {
          score = Math.floor((r.distanceRan || 0) * 0.025);
        }
      }
    } catch (e) {
      score = 0;
    }

    var phaseIndex = Math.min(PHASES.length - 1, Math.floor(score / 500));
    var nextIndex = Math.min(PHASES.length - 1, phaseIndex + 1);

    // Smooth transition over the last 60 points before each 500 milestone
    var withinPhase = score % 500;
    var tProgress = 0;
    if (phaseIndex < PHASES.length - 1 && withinPhase >= 440) {
      tProgress = (withinPhase - 440) / 60;
      tProgress = tProgress * tProgress * (3 - 2 * tProgress); // smoothstep
    }

    var currP = PHASES[phaseIndex];
    var nextP = PHASES[nextIndex];

    var blendedSky = [
      lerpColor(currP.sky[0], nextP.sky[0], tProgress),
      lerpColor(currP.sky[1], nextP.sky[1], tProgress),
      lerpColor(currP.sky[2], nextP.sky[2], tProgress),
      lerpColor(currP.sky[3], nextP.sky[3], tProgress)
    ];

    var blendedRain = lerp(currP.rain, nextP.rain, tProgress);
    var blendedMoonGlow = [
      Math.round(lerp(currP.moonGlow[0], nextP.moonGlow[0], tProgress)),
      Math.round(lerp(currP.moonGlow[1], nextP.moonGlow[1], tProgress)),
      Math.round(lerp(currP.moonGlow[2], nextP.moonGlow[2], tProgress)),
      lerp(currP.moonGlow[3], nextP.moonGlow[3], tProgress)
    ];
    var blendedSpore = lerpColor(currP.sporeColor, nextP.sporeColor, tProgress);

    return {
      sky: blendedSky,
      rain: blendedRain,
      moonGlow: blendedMoonGlow,
      moonColor: (tProgress > 0.5) ? nextP.moonColor : currP.moonColor,
      sporeColor: blendedSpore,
      phase: phaseIndex + 1
    };
  }

  /* ═══════════════════════════════════════════════════════
     2. PARALLAX VISUAL ELEMENTS
  ═══════════════════════════════════════════════════════ */

  /* ── Sky ────────────────────────────────────────────────────── */
  function drawSky(p) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0,    'rgb(' + p.sky[0].join(',') + ')');
    g.addColorStop(0.35, 'rgb(' + p.sky[1].join(',') + ')');
    g.addColorStop(0.68, 'rgb(' + p.sky[2].join(',') + ')');
    g.addColorStop(1,    'rgb(' + p.sky[3].join(',') + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ── Distant Atmospheric Illumination (Stormy Thunder) ─────── */
  var flashCounter = 0;
  var nextFlashInterval = 750;
  function drawAtmosphericFlash(rainIntensity) {
    if (rainIntensity < 0.5) return;
    flashCounter++;
    if (flashCounter > nextFlashInterval) {
      if (flashCounter < nextFlashInterval + 3) {
        ctx.fillStyle = 'rgba(100, 230, 255, 0.08)';
        ctx.fillRect(0, 0, W, H);
      } else {
        flashCounter = 0;
        nextFlashInterval = 650 + Math.floor(Math.random() * 550);
      }
    }
  }

  /* ── Moon ───────────────────────────────────────────────────── */
  function drawMoon(p) {
    var mx = W * 0.82, my = H * 0.12;
    var glow = ctx.createRadialGradient(mx, my, 0, mx, my, 80);
    glow.addColorStop(0, 'rgba(' + p.moonGlow[0] + ',' + p.moonGlow[1] + ',' + p.moonGlow[2] + ',' + p.moonGlow[3] + ')');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(mx, my, 80, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = p.moonColor;
    ctx.beginPath(); ctx.arc(mx, my, 22, 0, Math.PI * 2); ctx.fill();

    // subtle craters
    ctx.fillStyle = 'rgba(120,165,200,0.30)';
    [[mx-7, my-4, 4], [mx+5, my+6, 3], [mx-2, my+7, 2.5]].forEach(function(c) {
      ctx.beginPath(); ctx.arc(c[0], c[1], c[2], 0, Math.PI * 2); ctx.fill();
    });
  }

  /* ── Far Trees (Distant Silhouettes) ───────────────────────── */
  function drawFarTrees(ox) {
    var groundY = getGroundY();
    ctx.fillStyle = '#06131e';
    var count = Math.ceil(W / 120) + 3;
    for (var i = 0; i < count; i++) {
      var tx = ((i * 130 + ox) % (W + 260)) - 130;
      var baseY = groundY - 40;
      ctx.fillRect(tx - 6, baseY, 12, H - baseY);
      ctx.beginPath(); ctx.arc(tx, baseY, 30 + Math.sin(i) * 8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(tx - 20, baseY + 14, 22, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(tx + 18, baseY + 10, 20, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ── Giant Background Mushroom ─────────────────────────────── */
  function drawGiantMushroom(ox) {
    var groundY = getGroundY();
    var mx = ((W * 0.18 + ox) % (W * 1.5)) - W * 0.1;
    var baseY = groundY;
    var mh = H * 0.38;
    var pulse = 0.85 + Math.sin(t * 0.0016) * 0.15;

    // Outer bioluminescent magenta glow
    var glow = ctx.createRadialGradient(mx, baseY - mh * 0.65, 0, mx, baseY - mh * 0.65, 125 * pulse);
    glow.addColorStop(0, 'rgba(255,50,210,0.26)');
    glow.addColorStop(0.5,'rgba(220,30,180,0.12)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(mx, baseY - mh * 0.65, 125 * pulse, 100 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stem
    var sg = ctx.createLinearGradient(mx - 15, 0, mx + 15, 0);
    sg.addColorStop(0, '#5a1555');
    sg.addColorStop(0.5, '#d648c6');
    sg.addColorStop(1, '#5a1555');
    ctx.fillStyle = sg;
    ctx.fillRect(mx - 12, baseY - mh * 0.52, 24, mh * 0.52);

    // Glowing Cap
    var cg = ctx.createRadialGradient(mx, baseY - mh * 0.7, 0, mx, baseY - mh * 0.7, 80);
    cg.addColorStop(0, '#ffe0fa');
    cg.addColorStop(0.4, '#ff38c8');
    cg.addColorStop(1, '#900074');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(mx, baseY - mh * 0.58, 72 * pulse, 52 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();

    // White bioluminescent spots
    ctx.fillStyle = 'rgba(255,240,255,0.7)';
    [[mx - 20, baseY - mh * 0.68, 12], [mx + 22, baseY - mh * 0.61, 8], [mx + 2, baseY - mh * 0.75, 10]].forEach(function(s) {
      ctx.beginPath(); ctx.arc(s[0], s[1], s[2], 0, Math.PI * 2); ctx.fill();
    });
  }

  /* ── Mid Trees ──────────────────────────────────────────────── */
  function drawMidTrees(ox) {
    var groundY = getGroundY();
    ctx.fillStyle = '#030b12';
    var configs = [
      {f:0.04, s:1.4}, {f:0.25, s:1.1}, {f:0.45, s:1.35},
      {f:0.65, s:1.0}, {f:0.82, s:1.25}, {f:1.05, s:1.15}
    ];
    configs.forEach(function(c) {
      var tx = ((c.f * W + W * 1.2 + ox) % (W * 1.4)) - W * 0.15;
      var s = c.s;
      var baseY = groundY - 20;
      ctx.fillRect(tx - 7*s, baseY, 14*s, H - baseY);
      ctx.beginPath(); ctx.arc(tx, baseY, 52*s, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(tx-32*s, baseY+18*s, 36*s, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(tx+28*s, baseY+14*s, 40*s, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(tx+8*s, baseY-20*s, 28*s, 0, Math.PI*2); ctx.fill();
    });
  }

  /* ── Small Ground Mushrooms ──────────────────────────────── */
  var mushDefs = [
    {f:0.08, col:'#ff3399', glo:'255,51,153', h:26, cw:16},
    {f:0.22, col:'#00ffcc', glo:'0,255,204', h:20, cw:12},
    {f:0.38, col:'#ff55bb', glo:'255,85,187', h:28, cw:18},
    {f:0.54, col:'#00e5ff', glo:'0,229,255', h:18, cw:11},
    {f:0.72, col:'#ff22aa', glo:'255,34,170', h:24, cw:15},
    {f:0.88, col:'#00ff88', glo:'0,255,136', h:22, cw:14}
  ];

  function drawSmallMushrooms(ox) {
    var groundY = getGroundY();
    for (var i = 0; i < mushDefs.length; i++) {
      var m = mushDefs[i];
      var mx = ((m.f * W * 1.5 + W * 0.5 + ox * 0.6) % (W * 1.6)) - W * 0.1;
      var mh = m.h;
      var pulse = 0.8 + Math.sin(t * 0.002 + i * 1.2) * 0.2;

      ctx.save();
      ctx.shadowBlur = 12 * pulse;
      ctx.shadowColor = 'rgba(' + m.glo + ',0.8)';

      // Stem
      ctx.fillStyle = m.col;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(mx - 2, groundY - mh, 4, mh);

      // Glowing Cap
      ctx.beginPath();
      ctx.ellipse(mx, groundY - mh, m.cw * pulse, m.cw * 0.55 * pulse, 0, Math.PI, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  /* ── Foreground Grass Blades ─────────────────────────────── */
  function drawGrass(ox) {
    var groundY = getGroundY();
    var blades = Math.ceil(W / 6);
    ctx.lineWidth = 1.5;
    for (var i = 0; i < blades; i++) {
      var bx = ((i * 6 + ox * 0.9) % W);
      var bh = 8 + Math.sin(i * 0.85) * 4;
      var glow = (i % 5 === 0);
      ctx.strokeStyle = glow
        ? 'rgba(0,255,170,' + (0.55 + Math.sin(i) * 0.3) + ')'
        : 'rgba(0,160,100,' + (0.35 + Math.sin(i * 1.2) * 0.2) + ')';
      ctx.beginPath();
      ctx.moveTo(bx, groundY);
      ctx.quadraticCurveTo(
        bx + Math.sin(i * 0.9) * 3,
        groundY - bh * 0.55,
        bx + Math.sin(i * 0.5) * 2,
        groundY - bh
      );
      ctx.stroke();
    }
  }

  /* ═══════════════════════════════════════════════════════
     3. PARTICLES: FIREFLIES, SPORES & TROPICAL RAIN
  ═══════════════════════════════════════════════════════ */

  /* ── Fireflies ─────────────────────────────────────────────── */
  var fireflies = [];
  function initFireflies() {
    fireflies = [];
    for (var i = 0; i < 45; i++) {
      fireflies.push({
        x: Math.random() * (W || 800),
        y: Math.random() * (H || 600) * 0.72,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -Math.random() * 0.25 - 0.05,
        alpha: Math.random(),
        dir: Math.random() > 0.5 ? 1 : -1,
        size: Math.random() * 2 + 0.8,
        color: Math.random() > 0.4 ? '#00ffcc' : '#aaff55'
      });
    }
  }

  function updateFireflies() {
    for (var i = 0; i < fireflies.length; i++) {
      var f = fireflies[i];
      f.x += f.vx;
      f.y += f.vy;
      f.alpha += f.dir * 0.018;
      if (f.alpha >= 1 || f.alpha <= 0) f.dir *= -1;
      f.alpha = Math.max(0, Math.min(1, f.alpha));
      if (f.x < 0) f.x = W;
      if (f.x > W) f.x = 0;
      if (f.y < 0 || f.y > H * 0.75) {
        f.y = Math.random() * H * 0.65;
        f.x = Math.random() * W;
      }
    }
  }

  function drawFireflies() {
    for (var i = 0; i < fireflies.length; i++) {
      var f = fireflies[i];
      var r = f.size * 8;

      var hexToRgba = function(hex, a) {
        var bigint = parseInt(hex.slice(1), 16);
        var rr = (bigint >> 16) & 255;
        var gg = (bigint >> 8) & 255;
        var bb = bigint & 255;
        return 'rgba(' + rr + ',' + gg + ',' + bb + ',' + a + ')';
      };

      var grd = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      grd.addColorStop(0, hexToRgba(f.color, f.alpha * 0.8));
      grd.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,230,' + (f.alpha * 0.95) + ')';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── Floating Spores ─────────────────────────────────────── */
  var spores = [];
  function initSpores() {
    spores = [];
    for (var i = 0; i < 24; i++) {
      spores.push({
        x: Math.random() * (W || 800),
        y: (H || 600) * 0.5 + Math.random() * (H || 600) * 0.3,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -Math.random() * 0.35 - 0.08,
        size: Math.random() * 1.5 + 0.6,
        alpha: Math.random() * 0.6 + 0.1
      });
    }
  }

  function drawSpores(p) {
    var groundY = getGroundY();
    var rgb = p.sporeColor.join(',');
    ctx.fillStyle = 'rgba(' + rgb + ',0.75)';
    for (var i = 0; i < spores.length; i++) {
      var s = spores[i];
      s.x += s.vx;
      s.y += s.vy;
      s.alpha -= 0.001;
      if (s.y < 0 || s.alpha <= 0) {
        s.y = groundY + Math.random() * 40;
        s.x = Math.random() * W;
        s.alpha = Math.random() * 0.5 + 0.1;
      }
      ctx.globalAlpha = s.alpha;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ── Tropical Bioluminescent Rain ─────────────────────────── */
  var raindrops = [];
  function initRain() {
    raindrops = [];
    for (var i = 0; i < 55; i++) {
      raindrops.push({
        x: Math.random() * (W || 800),
        y: Math.random() * (H || 600),
        len: Math.random() * 18 + 14,
        vy: Math.random() * 7 + 16,
        alpha: Math.random() * 0.35 + 0.15
      });
    }
  }

  function updateAndDrawRain(spd, rainIntensity) {
    if (rainIntensity <= 0.01) return;
    ctx.save();
    ctx.lineWidth = 1.3;
    var slant = spd * 1.6;
    for (var i = 0; i < raindrops.length; i++) {
      var r = raindrops[i];
      r.y += r.vy;
      r.x -= slant;
      if (r.y > H + 20) {
        r.y = -20;
        r.x = Math.random() * (W + slant * 2);
      }
      if (r.x < -40) {
        r.x = W + 40;
      }
      ctx.strokeStyle = 'rgba(0, 240, 220, ' + (r.alpha * rainIntensity) + ')';
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - slant * 0.5, r.y + r.len);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ═══════════════════════════════════════════════════════
     4. SPEED & MAIN ANIMATION LOOP
  ═══════════════════════════════════════════════════════ */
  function getSpeed() {
    try {
      if (window.Runner && Runner.instance_) {
        if (Runner.instance_.playing && !Runner.instance_.crashed) {
          return Runner.instance_.currentSpeed;
        }
      }
      return 0.4;
    } catch (e) {
      return 0.4;
    }
  }

  function resize() {
    W = bgCanvas.width = window.innerWidth;
    H = bgCanvas.height = window.innerHeight;
    initFireflies();
    initSpores();
    initRain();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    t = now;

    var spd = getSpeed();
    layerX[0] += spd * 0.10;
    layerX[1] += spd * 0.20;
    layerX[2] += spd * 0.38;
    layerX[3] += spd * 0.75;

    var palette = getCurrentPhase();

    ctx.clearRect(0, 0, W, H);
    drawSky(palette);
    drawAtmosphericFlash(palette.rain);
    drawMoon(palette);
    drawFarTrees(layerX[0]);
    drawGiantMushroom(layerX[1]);
    drawMidTrees(layerX[2]);
    drawSmallMushrooms(layerX[3]);
    drawGrass(layerX[3]);
    updateFireflies();
    drawFireflies();
    drawSpores(palette);
    updateAndDrawRain(spd, palette.rain);
  }

  /* ── Bootstrap ──────────────────────────────────────────── */
  function init() {
    bgCanvas = document.createElement('canvas');
    bgCanvas.id = 'jungle-bg-canvas';
    document.body.insertBefore(bgCanvas, document.body.firstChild);
    ctx = bgCanvas.getContext('2d');
    W = bgCanvas.width = window.innerWidth;
    H = bgCanvas.height = window.innerHeight;
    window.addEventListener('resize', resize);
    initFireflies();
    initSpores();
    initRain();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();
