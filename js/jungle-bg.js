/**
 * jungle-bg.js
 * Bioluminescent Prehistoric Jungle — Parallax Background Engine
 * Draws a full-viewport animated jungle canvas behind the game canvas.
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

  /* ── Sky ────────────────────────────────────────────────────── */
  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0,   '#03050c');
    g.addColorStop(0.35,'#091326');
    g.addColorStop(0.68,'#08201a');
    g.addColorStop(1,   '#04120e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ── Moon ───────────────────────────────────────────────────── */
  function drawMoon() {
    var mx = W * 0.82, my = H * 0.12;
    var glow = ctx.createRadialGradient(mx, my, 0, mx, my, 80);
    glow.addColorStop(0, 'rgba(180,230,255,0.25)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(mx, my, 80, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#d8f0ff';
    ctx.beginPath(); ctx.arc(mx, my, 22, 0, Math.PI * 2); ctx.fill();

    // subtle craters
    ctx.fillStyle = 'rgba(140,185,220,0.35)';
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

  /* ── Giant Background Mushroom (From Reference Image) ─────── */
  function drawGiantMushroom(ox) {
    var groundY = getGroundY();
    var mx = ((W * 0.18 + ox) % (W * 1.5)) - W * 0.1;
    var baseY = groundY;
    var mh   = H * 0.38;
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
      var s  = c.s;
      var baseY = groundY - 20;
      ctx.fillRect(tx - 7*s, baseY, 14*s, H - baseY);
      ctx.beginPath(); ctx.arc(tx,      baseY,       52*s, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(tx-32*s, baseY+18*s,  36*s, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(tx+28*s, baseY+14*s,  40*s, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(tx+8*s,  baseY-20*s,  28*s, 0, Math.PI*2); ctx.fill();
    });
  }

  /* ── Small Ground Mushrooms ──────────────────────────────── */
  var mushDefs = [
    {f:0.08, col:'#ff3399', glo:'255,51,153', h:26, cw:16},
    {f:0.22, col:'#00ffcc', glo:'0,255,204',  h:20, cw:12},
    {f:0.38, col:'#ff55bb', glo:'255,85,187', h:28, cw:18},
    {f:0.54, col:'#00e5ff', glo:'0,229,255',  h:18, cw:11},
    {f:0.72, col:'#ff22aa', glo:'255,34,170', h:24, cw:15},
    {f:0.88, col:'#00ff88', glo:'0,255,136',  h:22, cw:14}
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

  function drawSpores() {
    var groundY = getGroundY();
    ctx.fillStyle = 'rgba(180,255,220,0.7)';
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

  /* ── Speed Helper ───────────────────────────────────────── */
  function getSpeed() {
    try {
      if (window.Runner && Runner.instance_) {
        if (Runner.instance_.playing && !Runner.instance_.crashed) {
          return Runner.instance_.currentSpeed;
        }
      }
      return 0.4; // gentle ambient breeze when idle
    } catch (e) {
      return 0.4;
    }
  }

  /* ── Main Parallax Animation Loop ──────────────────────── */
  function resize() {
    W = bgCanvas.width = window.innerWidth;
    H = bgCanvas.height = window.innerHeight;
    initFireflies();
    initSpores();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    t = now;

    var spd = getSpeed();
    layerX[0] += spd * 0.10;
    layerX[1] += spd * 0.20;
    layerX[2] += spd * 0.38;
    layerX[3] += spd * 0.75;

    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawMoon();
    drawFarTrees(layerX[0]);
    drawGiantMushroom(layerX[1]);
    drawMidTrees(layerX[2]);
    drawSmallMushrooms(layerX[3]);
    drawGrass(layerX[3]);
    updateFireflies();
    drawFireflies();
    drawSpores();
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
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();
