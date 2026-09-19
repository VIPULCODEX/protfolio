/* ════════════════════════════════════════════════════════════════
   ui.js — everything that is NOT WebGL:
   gate, audio engine, HUD/player, heartbeat, whispers, cursor,
   reveal animations, skill orb.  Shares state with scene.js via window.WEB
════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  const body = document.body;

  /* ─────────── shared state ─────────── */
  const WEB = (window.WEB = {
    entered: false,
    paused: false,
    fx: reduce ? 0 : 1,       // 0 calm · 1 possessed · 2 insane
    p: 0,                     // scroll progress 0..1
    heart: 0,                 // heartbeat pulse 0..1 (decays)
    glitch: 0,                // glitch burst 0..1 (decays)
    invert: 0,
    bright: 1,
    mouse: { x: 0, y: 0 },
    chapters: [],             // [{ p, name }]
    chapter: 0,
    fxMul() { return [0.1, 0.45, 2][this.fx]; },
    kick(a) { this.glitch = Math.max(this.glitch, a * this.fxMul()); },
  });

  /* ═══════════════════════════════════════════
     BRIGHTNESS  (overlay dim / soft-light lift + WebGL exposure)
  ═══════════════════════════════════════════ */
  const dimEl = $('#dim'), brightEl = $('#bright');
  function setBright(pct) {
    const b = clamp(pct, 30, 150) / 100;
    WEB.bright = b;
    dimEl.style.opacity = b < 1 ? (1 - b).toFixed(3) : 0;
    brightEl.style.opacity = b > 1 ? ((b - 1) * 1.2).toFixed(3) : 0;
    $('#gate-bright').value = $('#hud-bright').value = Math.round(b * 100);
  }
  $('#gate-bright').addEventListener('input', e => setBright(+e.target.value));
  $('#hud-bright').addEventListener('input', e => setBright(+e.target.value));

  /* ═══════════════════════════════════════════
     INTENSITY
  ═══════════════════════════════════════════ */
  function setFx(n) {
    WEB.fx = n;
    body.dataset.fx = n;
    $$('[data-fx-btn]').forEach(b => b.classList.toggle('on', +b.dataset.fxBtn === n));
    $('#hud-fx').value = n;
  }
  $$('[data-fx-btn]').forEach(b => b.addEventListener('click', () => setFx(+b.dataset.fxBtn)));
  $('#hud-fx').addEventListener('change', e => setFx(+e.target.value));
  setFx(WEB.fx);

  /* ═══════════════════════════════════════════
     GATE → ENTER
  ═══════════════════════════════════════════ */
  const gate = $('#gate');
  $('#enter').addEventListener('click', () => {
    if (WEB.entered) return;
    WEB.entered = true;
    if ($('#opt-fs').checked) toggleFullscreen(true);

    body.classList.remove('locked');
    body.classList.add('entered');
    gate.classList.add('gone');
    WEB.kick(0.9); flash('white', 120);
    window.scrollTo(0, 0);
    measure();
    startReveals();
    typeLog();
    startRoles();
    beatAt = clock + 800;
    nextWhisper = clock + 12000;
    
  });

  /* ═══════════════════════════════════════════
     PLAYER HUD
  ═══════════════════════════════════════════ */
  const hudPlay = $('#hud-play'), hudFs = $('#hud-fs');

  function setPaused(v) {
    WEB.paused = v;
    body.classList.toggle('paused', v);
    hudPlay.innerHTML = `<i class="fas ${v ? 'fa-play' : 'fa-pause'}"></i>`;
    hudPlay.title = v ? 'Resume the possession (Space)' : 'Pause the possession (Space)';
  }
  hudPlay.addEventListener('click', () => setPaused(!WEB.paused));

  function toggleFullscreen(force) {
    const de = document.documentElement;
    const isFs = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (!isFs && force !== false) (de.requestFullscreen || de.webkitRequestFullscreen || (() => Promise.reject())).call(de).catch?.(() => {});
      else if (isFs) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } catch (e) { /* fullscreen denied — fine */ }
  }
  hudFs.addEventListener('click', () => toggleFullscreen());
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev =>
    document.addEventListener(ev, () => {
      const on = document.fullscreenElement || document.webkitFullscreenElement;
      hudFs.innerHTML = `<i class="fas ${on ? 'fa-compress' : 'fa-expand'}"></i>`;
    }));

  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && e.target.type !== 'range') return;
    if (!WEB.entered) return;
    const k = e.key.toLowerCase();
    if (k === ' ' && tag !== 'button' && tag !== 'a' && tag !== 'select') { e.preventDefault(); setPaused(!WEB.paused); }
    else if (k === 'f') toggleFullscreen();
    else if (k === '+' || k === '=') setBright(WEB.bright * 100 + 5);
    else if (k === '-' || k === '_') setBright(WEB.bright * 100 - 5);
    // easter egg: type "hire"
    typed = (typed + k).slice(-4);
    if (typed === 'hire') {
      typed = '';
      WEB.kick(1.5); flash('red', 220);
      showWhisper('GOOD CHOICE', true);
      setTimeout(() => $('#contact').scrollIntoView({ behavior: 'smooth' }), 400);
    }
  });
  let typed = '';

  /* ─── seek bar ─── */
  const seek = $('#hud-seek'), seekFill = $('.seek-fill'), seekKnob = $('.seek-knob'), seekTicks = $('.seek-ticks');
  let maxScroll = 1, sections = [];
  function seekTo(clientX, smooth) {
    const r = seek.getBoundingClientRect();
    const f = clamp((clientX - r.left) / r.width, 0, 1);
    window.scrollTo({ top: f * maxScroll, behavior: smooth ? 'smooth' : 'auto' });
  }
  let seeking = false;
  seek.addEventListener('pointerdown', e => {
    if (e.target.closest('.seek-ticks i')) return;
    seeking = true; seek.setPointerCapture(e.pointerId); seekTo(e.clientX);
  });
  seek.addEventListener('pointermove', e => { if (seeking) seekTo(e.clientX); });
  seek.addEventListener('pointerup', () => (seeking = false));
  seek.addEventListener('pointercancel', () => (seeking = false));
  seek.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') window.scrollBy({ top: innerHeight * 0.8, behavior: 'smooth' });
    if (e.key === 'ArrowLeft') window.scrollBy({ top: -innerHeight * 0.8, behavior: 'smooth' });
  });

  const STAGES = [[0.15, 'SPIDER-SENSE'], [0.4, 'TINGLING'], [0.7, 'BONDING'], [0.985, 'SYMBIOTE'], [2, 'VENOM']];
  const hudCh = $('#hud-ch'), hudPos = $('#hud-pos');
  function updateHud() {
    const p = WEB.p;
    seekFill.style.width = seekKnob.style.left = (p * 100).toFixed(2) + '%';
    seek.setAttribute('aria-valuenow', Math.round(p * 100));
    const stage = STAGES.find(s => p < s[0])[1];
    hudPos.textContent = `SYMBIOTE BOND ${String(Math.round(p * 100)).padStart(2, '0')}% · ${stage}`;
  }

  /* ═══════════════════════════════════════════
     SCROLL / LAYOUT / CHAPTERS
  ═══════════════════════════════════════════ */
  sections = $$('main > section');
  const navLinks = $$('.nav-links a');

  function measure() {
    maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const sy = scrollY;
    WEB.chapters = sections.map((s, i) => {
      const top = s.getBoundingClientRect().top + sy;
      return { p: clamp((top - innerHeight * 0.55) / maxScroll, 0, 1), top, name: s.dataset.name, i };
    });
    seekTicks.innerHTML = WEB.chapters
      .map(c => `<i style="left:${(clamp(c.top / maxScroll, 0, 1) * 100).toFixed(2)}%" data-label="${String(c.i + 1).padStart(2, '0')} ${c.name}" data-top="${c.top}"></i>`)
      .join('');
    onScroll();
    window.dispatchEvent(new Event('web:layout'));
  }
  seekTicks.addEventListener('click', e => {
    const t = e.target.closest('i');
    if (t) window.scrollTo({ top: +t.dataset.top, behavior: 'smooth' });
  });

  let lastChapter = -1, finaleSeen = false;
  function onScroll() {
    WEB.p = clamp(scrollY / maxScroll, 0, 1);
    body.classList.toggle('scrolled', scrollY > 60);

    let cur = 0;
    const probe = scrollY + innerHeight * 0.45;
    for (const c of WEB.chapters) if (c.top <= probe) cur = c.i;
    if (cur !== lastChapter) {
      const first = lastChapter === -1;
      lastChapter = WEB.chapter = cur;
      const s = sections[cur];
      hudCh.textContent = `CH.${String(cur + 1).padStart(2, '0')} · ${s.dataset.name}`;
      navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + s.id));
      if (!first && WEB.entered) {
        WEB.kick(0.9);
        if (WEB.fx > 0 && Math.random() < 0.8) showWhisper();
      }
    }
    const fin = WEB.p > 0.985;
    body.classList.toggle('finale-on', fin);
    if (fin && !finaleSeen && WEB.entered) {
      finaleSeen = true;
      WEB.kick(2); flash('red', 200);
      showWhisper('WE ARE VENOM', true);
    }
    updateHud();
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  if ('ResizeObserver' in window) new ResizeObserver(() => measure()).observe(body);
  measure();

  $('#wake').addEventListener('click', () => {
    finaleSeen = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => showWhisper('SEE YOU SOON', true), 1200);
  });

  /* ═══════════════════════════════════════════
     WHISPERS · FLASHES · HEARTBEAT
  ═══════════════════════════════════════════ */
  const whisperEl = $('#whisper'), flashEl = $('#flash');
  const WHISPERS = [
    'SPIDER-SENSE TINGLING', 'WE ARE VENOM', 'STAY IN THE WEB', 'HIRE HIM', 'KEEP SCROLLING',
    'GO DEEPER', 'STILL HERE?', 'THE WEB HOLDS', 'ALMOST THERE',
  ];
  let whisperTimer = 0;
  function showWhisper(text, force) {
    if (!force && (WEB.fx === 0 || WEB.paused || !WEB.entered)) return;
    if (WEB.fx === 0 && !force) return;
    clearTimeout(whisperTimer);
    const rot = rand(-4, 4);
    whisperEl.textContent = text || pick(WHISPERS);
    whisperEl.style.setProperty('--rot', rot + 'deg');
    whisperEl.style.fontSize = rand(1.2, 2.4).toFixed(2) + 'rem';
    whisperEl.style.left = (Math.random() < 0.5 ? rand(10, 18) : rand(82, 90)).toFixed(1) + '%';
    whisperEl.style.top = rand(20, 75).toFixed(1) + '%';
    whisperEl.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`;
    whisperEl.classList.add('on');
    WEB.kick(0.15);
    whisperTimer = setTimeout(() => whisperEl.classList.remove('on'), force ? 1200 : rand(500, 900));
  }

  function flash(kind, ms) {
    if (WEB.fx < 2 && kind !== 'white') return;
    if (WEB.fx === 0) return;
    flashEl.className = kind;
    flashEl.style.opacity = kind === 'white' ? 0.55 : 0.75;
    setTimeout(() => (flashEl.style.opacity = 0), ms);
  }

  const vignette = $('#vignette');
  let clock = 0, beatAt = Infinity, dubAt = Infinity, nextWhisper = Infinity, nextBlink = Infinity, last = performance.now();

  function beat(v) {
    WEB.heart = Math.max(WEB.heart, v);
  }

  /* ═══════════════════════════════════════════
     CURSOR (+ a ghost that mirrors you)
  ═══════════════════════════════════════════ */
  const cur = $('#cur'), ring = $('#cur-ring'), ghost = $('#ghost');
  const m = { x: innerWidth / 2, y: innerHeight / 2, rx: innerWidth / 2, ry: innerHeight / 2, gx: innerWidth / 2, gy: innerHeight / 2 };
  if (fine) body.classList.add('has-cursor');
  window.addEventListener('pointermove', e => {
    m.x = e.clientX; m.y = e.clientY;
    WEB.mouse.x = (e.clientX / innerWidth) * 2 - 1;
    WEB.mouse.y = -((e.clientY / innerHeight) * 2 - 1);
    cur.style.transform = `translate(${m.x}px,${m.y}px)`;
  }, { passive: true });
  document.addEventListener('pointerover', e => {
    const t = e.target.closest && e.target.closest('a,button,label,select,input,.tilt,.fx-btn,#hud-seek');
    ring.classList.toggle('hot', !!t);
  });

  // exit-intent + tab-blur
  const exitEl = $('#exit-warning');
  document.addEventListener('mouseout', e => {
    if (!WEB.entered || WEB.fx === 0 || e.relatedTarget || e.clientY > 8) return;
    exitEl.classList.add('on');
    setTimeout(() => exitEl.classList.remove('on'), 1300);
  });
  const baseTitle = document.title;
  let titleIv = 0;
  document.addEventListener('visibilitychange', () => {
    clearInterval(titleIv);
    if (document.hidden && WEB.entered) {
      const t = ['Still swinging? 🕷️', 'The web misses you'];
      let i = 0;
      document.title = t[0];
      titleIv = setInterval(() => (document.title = t[++i % t.length]), 1200);
    } else {
      document.title = baseTitle;
      
    }
  });

  /* ═══════════════════════════════════════════
     MAIN TICK  (heartbeat · whispers · cursor · decays)
  ═══════════════════════════════════════════ */
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // cursor is always smooth, even when effects are paused
    m.rx += (m.x - m.rx) * 0.2; m.ry += (m.y - m.ry) * 0.2;
    ring.style.transform = `translate(${m.rx}px,${m.ry}px)`;
    if (WEB.entered && WEB.fx > 0) {
      m.gx += ((innerWidth - m.x) - m.gx) * 0.045;
      m.gy += ((innerHeight - m.y) - m.gy) * 0.045;
      ghost.style.transform = `translate(${m.gx}px,${m.gy}px)`;
    }

    if (WEB.paused) return;
    clock += dt * 1000;
    WEB.heart *= Math.exp(-dt * 6);
    WEB.glitch *= Math.exp(-dt * 3.5);
    WEB.invert *= Math.exp(-dt * 14);

    if (WEB.entered) {
      // lub-dub, faster the deeper you go
      if (clock >= beatAt) {
        beat(1);
        dubAt = clock + 190;
        beatAt = clock + 60000 / (56 + WEB.p * 58 + WEB.heart * 0);
      }
      if (clock >= dubAt) { beat(0.6); dubAt = Infinity; }

      if (WEB.fx > 0 && clock >= nextWhisper) {
        showWhisper();
        nextWhisper = clock + rand(14000, 26000) / (WEB.fx === 2 ? 2.2 : 1);
      }
      // random micro-blackouts & inversions
      if (WEB.fx === 2 && clock >= nextBlink) {
        if (Math.random() < 0.5) WEB.invert = 1;
        flash(Math.random() < 0.35 ? 'red' : 'black', rand(40, 90));
        WEB.kick(0.8);
        nextBlink = clock + rand(9000, 22000) / (WEB.fx === 2 ? 2.5 : 1);
      }
      if (nextBlink === Infinity) nextBlink = clock + 12000;
    }

    const vig = 0.42 + WEB.heart * 0.5 + WEB.p * 0.18;
    vignette.style.opacity = Math.min(1, vig).toFixed(3);
  }
  requestAnimationFrame(tick);

  /* ═══════════════════════════════════════════
     REVEALS · SCRAMBLE · COUNT-UP · TILT
  ═══════════════════════════════════════════ */
  const GLYPHS = '█▓▒░<>/\\|{}[]#$%&*+=?!ΩΣΔ0123456789';
  function scramble(el) {
    const txt = el.dataset.text || (el.dataset.text = el.textContent);
    if (el._sc) clearInterval(el._sc);
    if (WEB.fx === 0) { el.textContent = txt; return; }
    let f = 0; const frames = 22;
    el._sc = setInterval(() => {
      f++;
      const keep = Math.floor((f / frames) * txt.length);
      let out = '';
      for (let i = 0; i < txt.length; i++) out += txt[i] === ' ' || i < keep ? txt[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      el.textContent = out;
      if (f >= frames) { clearInterval(el._sc); el.textContent = txt; }
    }, 34);
  }
  $$('.scr').forEach(el => el.addEventListener('mouseenter', () => scramble(el)));

  function countUp(el) {
    const to = +el.dataset.count, dec = +(el.dataset.dec || 0), suf = el.dataset.suffix || '';
    const dur = 1600, t0 = performance.now();
    (function step(t) {
      const k = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (to * e).toFixed(dec) + (k >= 1 ? suf : '');
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting || en.target.classList.contains('in')) return;
      const el = en.target;
      el.classList.add('in');
      io.unobserve(el);
      $$('[data-count]', el).forEach(countUp);
      if (el.matches('[data-count]')) countUp(el);
      const s = $('.scr', el);
      if (s) scramble(s);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  function startReveals() { $$('.reveal').forEach(el => io.observe(el)); }
  // no-JS-scene fallback: still show content if the gate is bypassed
  window.addEventListener('web:show-all', () => $$('.reveal').forEach(el => el.classList.add('in')));

  /* hero: role rotator + terminal log */
  function startRoles() {
    const roles = ['Web Developer', 'ML Engineer', 'Cybersecurity Enthusiast', 'GATE CS 2025 Qualified', 'M.Tech @ IIIT Una'];
    const el = $('#role');
    let ri = 0, ci = roles[0].length, del = true;
    (function loop() {
      const word = roles[ri];
      if (del) { ci--; if (ci <= 0) { del = false; ri = (ri + 1) % roles.length; } }
      else { ci++; if (ci >= roles[ri].length) del = true; }
      el.textContent = roles[ri].slice(0, Math.max(ci, 0));
      const atEnd = !del && ci >= roles[ri].length;
      setTimeout(loop, atEnd ? 1700 : del ? 32 : 65);
    })();
  }
  function typeLog() {
    const lines = [
      '> loading profile ............ <b>done</b>',
      '> user: VIPUL SHARMA // M.TECH CSE // IIIT UNA',
      '> spider-sense ............... <b>ACTIVE</b>',
      '> symbiote bond .............. <b>0%</b>',
    ];
    const log = $('#hero-log');
    let li = 0;
    (function nextLine() {
      if (li >= lines.length) return;
      const raw = lines[li++];
      let i = 0, html = '';
      const plain = raw.replace(/<[^>]+>/g, '');
      (function typeChar() {
        // type plain text, then swap in the marked-up line
        i++;
        log.innerHTML = lines.slice(0, li - 1).join('\n') + (li > 1 ? '\n' : '') + plain.slice(0, i);
        if (i < plain.length) setTimeout(typeChar, 14);
        else { log.innerHTML = lines.slice(0, li).join('\n'); setTimeout(nextLine, 260); }
      })();
    })();
  }

  /* 3D tilt + glare on cards */
  if (fine) {
    $$('.tilt').forEach(el => {
      if (el.classList.contains('project-card')) el.insertAdjacentHTML('afterbegin', '<div class="glare"></div>');
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 12}deg) rotateY(${(x - 0.5) * 14}deg) translateZ(10px)`;
        el.style.setProperty('--mx', x * 100 + '%');
        el.style.setProperty('--my', y * 100 + '%');
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ═══════════════════════════════════════════
     SKILL ORB — draggable 3D tag sphere
  ═══════════════════════════════════════════ */
  (function skillOrb() {
    const host = $('#sphere');
    const tags = $$('.skill-group').flatMap((g, gi) => $$('.skill-tag', g).map(t => ({ text: t.textContent, cat: gi })));
    const n = tags.length;
    const pts = tags.map((t, i) => {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
      const el = document.createElement('span');
      el.className = 'sphere-tag'; el.dataset.cat = t.cat; el.textContent = t.text;
      host.appendChild(el);
      return { x: Math.cos(th) * r, y, z: Math.sin(th) * r, el };
    });
    let ax = 0.002, ay = 0.004, dragging = false, px = 0, py = 0, visible = false, hover = false;
    new IntersectionObserver(e => (visible = e[0].isIntersecting)).observe(host);
    host.addEventListener('pointerdown', e => { dragging = true; px = e.clientX; py = e.clientY; host.classList.add('drag'); host.setPointerCapture(e.pointerId); });
    host.addEventListener('pointermove', e => {
      if (!dragging) return;
      ay = (e.clientX - px) * 0.0007; ax = -(e.clientY - py) * 0.0007;
      px = e.clientX; py = e.clientY;
    });
    const end = () => { dragging = false; host.classList.remove('drag'); };
    host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
    host.addEventListener('pointerenter', () => (hover = true));
    host.addEventListener('pointerleave', () => (hover = false));

    (function loop() {
      requestAnimationFrame(loop);
      if (!visible || WEB.paused) return;
      if (!dragging) {
        // relax toward a slow spin; hover speeds it up slightly
        ay += ((hover ? 0.006 : 0.0035) * Math.sign(ay || 1) - ay) * 0.03;
        ax += (0.0012 - ax) * 0.03;
      }
      const R = Math.min(host.clientWidth, host.clientHeight) * 0.42;
      const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
      for (const p of pts) {
        let x = p.x * cy - p.z * sy, z = p.x * sy + p.z * cy;
        let y = p.y * cx - z * sx; z = p.y * sx + z * cx;
        const inv = 1 / Math.hypot(x, y, z);
        p.x = x = x * inv; p.y = y = y * inv; p.z = z = z * inv;
        const s = 0.62 + (z + 1) * 0.28;
        p.el.style.transform = `translate(-50%,-50%) translate(${(x * R * 1.55).toFixed(1)}px,${(y * R).toFixed(1)}px) scale(${s.toFixed(3)})`;
        p.el.style.opacity = (0.22 + (z + 1) * 0.39).toFixed(2);
        p.el.style.zIndex = Math.round((z + 1) * 50);
      }
    })();
  })();
})();
