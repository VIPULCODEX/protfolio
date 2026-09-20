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
    quick: false,             // plain fast view: no WebGL, no effects
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
  function enterSite(quick) {
    if (WEB.entered) return;
    WEB.entered = true;
    if (!quick && $('#opt-fs').checked) toggleFullscreen(true);

    body.classList.remove('locked');
    body.classList.add('entered');
    gate.classList.add('gone');
    window.scrollTo(0, 0);
    setQuick(quick);
    measure();
    if (!quick) { WEB.kick(0.9); flash('white', 120); startReveals(); }
    typeLog();
    startRoles();
    beatAt = clock + 800;
    nextWhisper = clock + 12000;
  }
  $('#enter').addEventListener('click', () => enterSite(false));
  $('#quick').addEventListener('click', () => enterSite(true));

  // quick view: plain, fast, effect-free. Toggleable any time from the nav.
  function setQuick(on) {
    WEB.quick = on;
    body.classList.toggle('quick', on);
    const t = $('#mode-toggle');
    t.textContent = on ? 'Immersive view' : 'Quick view';
    if (on) {
      $$('.reveal').forEach(el => el.classList.add('in'));
      $$('[data-count]').forEach(el => { el.textContent = (el.dataset.prefix || '') + (+el.dataset.count).toFixed(+(el.dataset.dec || 0)) + (el.dataset.suffix || ''); });
      whisperEl.classList.remove('on');
    } else if (WEB.entered) {
      WEB.kick(0.6);
    }
  }
  $('#mode-toggle').addEventListener('click', () => setQuick(!WEB.quick));

  // suggest quick view on weak hardware / data-saver, and allow ?quick deep-links
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2 || (navigator.connection && navigator.connection.saveData);
  if (lowEnd) { $('#gate-lowpower').hidden = false; $('#quick').classList.add('rec'); }
  if (new URLSearchParams(location.search).has('quick')) setTimeout(() => enterSite(true), 0);

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
  $('#hud-term').addEventListener('click', () => toggleTerm());
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev =>
    document.addEventListener(ev, () => {
      const on = document.fullscreenElement || document.webkitFullscreenElement;
      hudFs.innerHTML = `<i class="fas ${on ? 'fa-compress' : 'fa-expand'}"></i>`;
    }));

  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (e.key === 'Escape' && !termEl.hidden) { closeTerm(); return; }
    if ((tag === 'input' && e.target.type !== 'range') || tag === 'textarea') return;
    if (!WEB.entered) return;
    const k = e.key.toLowerCase();
    if (e.key === '`' || e.key === '~') { e.preventDefault(); toggleTerm(); return; }
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
    if (WEB.entered && WEB.fx > 0 && !WEB.quick) {
      m.gx += ((innerWidth - m.x) - m.gx) * 0.045;
      m.gy += ((innerHeight - m.y) - m.gy) * 0.045;
      ghost.style.transform = `translate(${m.gx}px,${m.gy}px)`;
    }

    if (WEB.paused || WEB.quick) return;
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
    const to = +el.dataset.count, dec = +(el.dataset.dec || 0), suf = el.dataset.suffix || '', pre = el.dataset.prefix || '';
    const dur = 1600, t0 = performance.now();
    (function step(t) {
      const k = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      el.textContent = pre + (to * e).toFixed(dec) + (k >= 1 ? suf : '');
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
    const roles = ['Data / AI Engineer', 'Backend & Databases', 'Applied ML & GenAI', 'GATE CS 2025 · Top 5.5%', 'M.Tech @ IIIT Una'];
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
        if (WEB.quick) return;
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
      const R = Math.min(host.clientWidth, host.clientHeight) * 0.46;
      const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
      for (const p of pts) {
        let x = p.x * cy - p.z * sy, z = p.x * sy + p.z * cy;
        let y = p.y * cx - z * sx; z = p.y * sx + z * cx;
        const inv = 1 / Math.hypot(x, y, z);
        p.x = x = x * inv; p.y = y = y * inv; p.z = z = z * inv;
        const s = 0.62 + (z + 1) * 0.28;
        p.el.style.transform = `translate(-50%,-50%) translate(${(x * R * 1.7).toFixed(1)}px,${(y * R).toFixed(1)}px) scale(${s.toFixed(3)})`;
        p.el.style.opacity = (0.22 + (z + 1) * 0.39).toFixed(2);
        p.el.style.zIndex = Math.round((z + 1) * 50);
      }
    })();
  })();

  /* ═══════════════════════════════════════════
     TOAST · PLACEHOLDER LINKS · CV DOWNLOAD
  ═══════════════════════════════════════════ */
  const toastEl = $('#toast');
  let toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('on'), 2600);
  }
  WEB.toast = toast;

  document.addEventListener('click', e => {
    const todo = e.target.closest('a[data-todo]');
    if (todo) { e.preventDefault(); toast('Link coming soon'); return; }
    const asset = e.target.closest('a[data-asset]');
    if (asset) {
      e.preventDefault();
      const href = asset.getAttribute('href');
      fetch(href, { method: 'HEAD' })
        .then(r => {
          if (!r.ok) throw new Error('missing');
          const a = document.createElement('a');
          a.href = href; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
          toast('Downloading CV…');
        })
        .catch(() => toast('CV will be available soon'));
    }
  });

  /* copy email + contact form (mailto — nothing leaves the browser) */
  const EMAIL = 'vipul26122004@gmail.com';
  $('#copy-email').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(EMAIL); }
    catch (err) {
      const ta = document.createElement('textarea'); ta.value = EMAIL; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove();
    }
    toast('Email copied: ' + EMAIL);
  });
  $('#contact-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#cf-name').value.trim(), msg = $('#cf-msg').value.trim();
    if (!name || !msg) return;
    const subject = encodeURIComponent(`Portfolio enquiry from ${name}`);
    const bodyTxt = encodeURIComponent(`${msg}\n\n— ${name}`);
    location.href = `mailto:${EMAIL}?subject=${subject}&body=${bodyTxt}`;
    toast('Opening your email app…');
  });

  /* ═══════════════════════════════════════════
     WEB-SHOOTER — click anywhere to fire a web
  ═══════════════════════════════════════════ */
  (function webShooter() {
    const cv = $('#webfx'), ctx = cv.getContext('2d');
    const shots = [];
    let dpr = 1, raf = 0;
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size(); window.addEventListener('resize', size);

    const IGNORE = 'a,button,input,textarea,select,label,form,#hud,#nav,nav,#term,#gate,#sphere,#demo-canvas,#toast';
    document.addEventListener('click', e => {
      if (!WEB.entered || WEB.paused || e.target.closest(IGNORE)) return;
      const ox = e.clientX < innerWidth / 2 ? -10 : innerWidth + 10, oy = innerHeight + 10;
      shots.push({ ox, oy, x: e.clientX, y: e.clientY, t: 0, start: performance.now(), sag: rand(20, 50) * (Math.random() < 0.5 ? -1 : 1), a0: rand(0, 6.28) });
      if (!raf) raf = requestAnimationFrame(loop);
    });

    function loop(now) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i]; s.t = (now - s.start) / 1000;   // wall-clock, so it never lingers on slow frames
        const fly = clamp(s.t / 0.16, 0, 1);              // web travels to the target
        const fade = clamp(1 - (s.t - 0.16) / 1.7, 0, 1);
        if (fade <= 0) { shots.splice(i, 1); continue; }
        const mx = (s.ox + s.x) / 2 + s.sag, my = (s.oy + s.y) / 2;
        // point on the quadratic curve at parameter `fly`
        const q = k => ({ x: (1 - k) * (1 - k) * s.ox + 2 * (1 - k) * k * mx + k * k * s.x, y: (1 - k) * (1 - k) * s.oy + 2 * (1 - k) * k * my + k * k * s.y });
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.lineCap = 'round';
        ctx.shadowColor = '#4c8dff'; ctx.shadowBlur = 10;
        ctx.strokeStyle = 'rgba(235,240,255,.9)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(s.ox, s.oy);
        for (let k = 0.05; k <= fly + 1e-6; k += 0.05) { const p = q(Math.min(k, fly)); ctx.lineTo(p.x, p.y); }
        ctx.stroke();
        if (fly >= 1) {
          // splat: mini web at the impact point
          const grow = clamp((s.t - 0.16) / 0.18, 0, 1), R = 54 * grow, N = 8;
          ctx.lineWidth = 1.2; ctx.shadowColor = '#e62429';
          ctx.beginPath();
          for (let k = 0; k < N; k++) { const a = s.a0 + (k / N) * 6.283; ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(a) * R, s.y + Math.sin(a) * R); }
          ctx.stroke();
          for (const f of [0.35, 0.65, 1]) {
            ctx.beginPath();
            for (let k = 0; k <= N; k++) {
              const a = s.a0 + (k / N) * 6.283, am = s.a0 + ((k - 0.5) / N) * 6.283, r = R * f;
              if (k === 0) ctx.moveTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
              else { ctx.quadraticCurveTo(s.x + Math.cos(am) * r * 0.86, s.y + Math.sin(am) * r * 0.86, s.x + Math.cos(a) * r, s.y + Math.sin(a) * r); }
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      if (shots.length) raf = requestAnimationFrame(loop);
      else { raf = 0; ctx.clearRect(0, 0, innerWidth, innerHeight); }
    }
  })();

  /* ═══════════════════════════════════════════
     TERMINAL — press ~ (or the >_ button)
  ═══════════════════════════════════════════ */
  const termEl = $('#term'), termOut = $('#term-out'), termIn = $('#term-in');
  const hist = []; let hi = -1, termBooted = false;
  function print(text, cls) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = text;
    termOut.appendChild(d);
    termOut.scrollTop = termOut.scrollHeight;
  }
  function openTerm() {
    termEl.hidden = false;
    if (!termBooted) { termBooted = true; print('Welcome. Type "help" to see what I can do.', 'hl'); }
    setTimeout(() => termIn.focus(), 30);
  }
  function closeTerm() { termEl.hidden = true; termIn.blur(); }
  function toggleTerm() { termEl.hidden ? openTerm() : closeTerm(); }
  $('#term-close').addEventListener('click', closeTerm);
  termEl.addEventListener('click', e => { if (e.target === termEl) closeTerm(); });

  const SECTION_IDS = { about: 'about', education: 'education', experience: 'experience', projects: 'projects', skills: 'skills', certs: 'certifications', certifications: 'certifications', publication: 'publication', achievements: 'achievements', contact: 'contact', top: 'hero' };
  const PROJECTS = ['QUANTX AI', 'VIPVISUALIZE', 'NORTH STARS', 'RESUME-AI', 'FRET CONNECT', 'VEDAGYA', 'ALZHEIMER PREDICTION SYSTEM', 'TRAFFIC SIMULATION SYSTEM', 'PG LIFE', 'KBC GAME & HANGMAN'];
  const jump = id => { closeTerm(); const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth' }); };

  const CMDS = {
    help: () => ['Commands:', '  whoami        who is this guy', '  skills        tech stack', '  education     academic record', '  experience    work history', '  projects      list projects (then: open <n>)', '  contact       how to reach me', '  cv            download my resume', '  hire          the important one', '  goto <where>  about | projects | skills | contact …', '  venom         you asked for it', '  calm          reduce effects', '  clear         clear the screen', '  exit          close (or press Esc)'],
    whoami: () => ['Vipul Sharma — Aspiring Data/AI Engineer', 'M.Tech CSE @ IIIT Una (2025–2027) · CGPA 8.65', 'GATE CS 2025 qualified (Top 5.5%) · published researcher', 'Databases, backend APIs, applied ML / GenAI. From Himachal Pradesh, India.'],
    skills: () => ['Languages & DBs  Python, SQL, C++, JavaScript · MySQL, PostgreSQL, MongoDB', 'Data & Backend   REST API design, data modeling, graph modeling, Node.js, Express.js', 'ML & AI          NumPy, Pandas, Scikit-learn, GenAI fundamentals, prompt engineering', 'Tools            Docker, Git, Linux, VS Code · DBMS, DSA, OS, Networks, Compilers'],
    education: () => ['M.Tech CSE   IIIT Una ............ 2025–2027 · 8.65 CGPA (current)', 'B.Tech CSE   HPTU ................. 2021–2025 · 8.16 CGPA', 'XII          CBSE .................. 2021 · 94.8%', 'X            HP Board .............. 2019 · 92.4%'],
    experience: () => ['Teaching Assistant, IIIT Una (2026–present)', '  · lab practicals & grading: Network Security, OOP (C++)', 'Trainee, Excellence Technology (Jan–May 2025)', 'Freelance & Technical Contributions (2023–present)', '  · technical reports; debugging/review of C/C++, Python, web & DB projects'],
    projects: () => [...PROJECTS.map((p, i) => `  ${i + 1}. ${p}`), 'Type "open <n>" to jump to the Projects section.'],
    contact: () => [`Email     ${EMAIL}`, 'Phone     +91-8628997357', 'LinkedIn  linkedin.com/in/vipul-s-302734228', 'GitHub    github.com/VIPULCODEX'],
    cv: () => { $('#btn-cv').click(); return ['Requesting resume…']; },
    hire: () => { setTimeout(() => { jump('contact'); }, 500); return ['Excellent decision.', 'Taking you to the contact section…']; },
    venom: () => { setFx(2); return ['We are Venom.', '(intensity set to VENOM)']; },
    calm: () => { setFx(0); return ['Effects reduced.']; },
    spiderman: () => ['With great power comes great responsibility.'],
    sudo: () => ['Nice try, web-slinger.'],
    ls: () => Object.keys(SECTION_IDS).filter(k => k !== 'certifications').map(k => k + '/'),
    pwd: () => ['/portfolio/vipul-sharma'],
    exit: () => { closeTerm(); return []; },
  };

  function runCmd(raw) {
    const line = raw.trim();
    if (!line) return;
    print(line, 'cmd');
    hist.unshift(line); hi = -1;
    const [cmd, ...args] = line.toLowerCase().split(/\s+/);
    if (cmd === 'clear') { termOut.textContent = ''; return; }
    if (cmd === 'goto' || cmd === 'cd') {
      const id = SECTION_IDS[(args[0] || '').replace('/', '')];
      if (!id) return print(`unknown place: ${args[0] || ''}. Try: ${Object.keys(SECTION_IDS).join(', ')}`, 'err');
      print(`Going to ${args[0]}…`, 'hl'); setTimeout(() => jump(id), 350); return;
    }
    if (cmd === 'open') {
      const n = parseInt(args[0], 10);
      if (!n || n < 1 || n > PROJECTS.length) return print(`usage: open <1-${PROJECTS.length}>`, 'err');
      print(`Opening ${PROJECTS[n - 1]}…`, 'hl'); setTimeout(() => jump('projects'), 350); return;
    }
    const fn = CMDS[cmd];
    if (!fn) return print(`command not found: ${cmd}. Type "help".`, 'err');
    fn().forEach(l => print(l));
  }
  $('#term-form').addEventListener('submit', e => { e.preventDefault(); const v = termIn.value; termIn.value = ''; runCmd(v); });
  termIn.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { e.preventDefault(); if (hi < hist.length - 1) termIn.value = hist[++hi]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.max(-1, hi - 1); termIn.value = hi === -1 ? '' : hist[hi]; }
    else if (e.key === '`' || e.key === '~') { e.preventDefault(); closeTerm(); }
  });

  /* ═══════════════════════════════════════════
     CONCEPT DEMO — kidney-exchange cycles
     (an illustration of the idea behind VipVisualize, not the tool itself)
  ═══════════════════════════════════════════ */
  (function exchangeDemo() {
    const cv = $('#demo-canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d'), status = $('#demo-status');
    const N = 7;
    let adj = [], W = 0, H = 0, dpr = 1, litEdges = [], litNodes = new Set(), timer = 0;

    const cyclesFrom = () => {
      const found = [];
      const dfs = (start, path) => {
        const u = path[path.length - 1];
        for (let v = 0; v < N; v++) {
          if (!adj[u][v]) continue;
          if (v === start && path.length >= 2) found.push([...path]);
          else if (v > start && !path.includes(v) && path.length < 4) dfs(start, [...path, v]);
        }
      };
      for (let s = 0; s < N; s++) dfs(s, [s]);
      return found;
    };
    function shuffle() {
      clearInterval(timer); litEdges = []; litNodes = new Set();
      let tries = 0;
      do {
        adj = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => i !== j && Math.random() < 0.3));
        tries++;
      } while (tries < 30 && (cyclesFrom().length === 0) === (Math.random() < 0.85));
      status.textContent = 'Press “Find an exchange” to search for a cycle.';
      draw();
    }
    const R = () => ({ rx: W * 0.34, ry: H * 0.36 });
    const pos = i => { const a = -Math.PI / 2 + (i / N) * Math.PI * 2, { rx, ry } = R(); return { x: W / 2 + Math.cos(a) * rx, y: H / 2 + Math.sin(a) * ry }; };

    function arrow(a, b, lit, bend) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, nr = 20;
      const cx = (a.x + b.x) / 2 + nx * bend, cy = (a.y + b.y) / 2 + ny * bend;
      const t0 = { x: cx - a.x, y: cy - a.y }, t1 = { x: b.x - cx, y: b.y - cy };
      const l0 = Math.hypot(t0.x, t0.y), l1 = Math.hypot(t1.x, t1.y);
      const sx = a.x + (t0.x / l0) * nr, sy = a.y + (t0.y / l0) * nr;
      const ex = b.x - (t1.x / l1) * nr, ey = b.y - (t1.y / l1) * nr;
      ctx.strokeStyle = lit ? '#ff3b3f' : 'rgba(150,165,200,.42)';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = lit ? 3 : 1.4;
      ctx.shadowColor = '#e62429'; ctx.shadowBlur = lit ? 14 : 0;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
      const ang = Math.atan2(ey - cy, ex - cx), h = lit ? 11 : 8;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang - 0.4) * h, ey - Math.sin(ang - 0.4) * h);
      ctx.lineTo(ex - Math.cos(ang + 0.4) * h, ey - Math.sin(ang + 0.4) * h);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    function draw() {
      if (!W) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const isLit = (i, j) => litEdges.some(e => e[0] === i && e[1] === j);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        if (!adj[i][j] || isLit(i, j)) continue;
        arrow(pos(i), pos(j), false, adj[j][i] ? 22 : 8);
      }
      litEdges.forEach(([i, j]) => arrow(pos(i), pos(j), true, adj[j][i] ? 22 : 8));
      for (let i = 0; i < N; i++) {
        const p = pos(i), on = litNodes.has(i);
        ctx.beginPath(); ctx.arc(p.x, p.y, 20, 0, 6.283);
        ctx.fillStyle = on ? '#e62429' : '#0a0e1c';
        ctx.strokeStyle = on ? '#fff' : 'rgba(76,141,255,.75)'; ctx.lineWidth = 2;
        ctx.shadowColor = on ? '#e62429' : '#4c8dff'; ctx.shadowBlur = on ? 18 : 8;
        ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff'; ctx.font = '700 13px "Share Tech Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('P' + (i + 1), p.x, p.y + 1);
      }
    }
    function find() {
      clearInterval(timer); litEdges = []; litNodes = new Set();
      const all = cyclesFrom();
      if (!all.length) { status.textContent = 'No exchange cycle in this pool — try a new pool.'; draw(); return; }
      const cyc = all[Math.floor(Math.random() * all.length)];
      const edges = cyc.map((u, k) => [u, cyc[(k + 1) % cyc.length]]);
      let k = 0;
      status.textContent = 'Searching…';
      timer = setInterval(() => {
        litEdges.push(edges[k]); litNodes.add(edges[k][0]); litNodes.add(edges[k][1]); k++;
        draw();
        if (k >= edges.length) {
          clearInterval(timer);
          status.textContent = `Exchange found: ${cyc.map(i => 'P' + (i + 1)).join(' → ')} → P${cyc[0] + 1}. ${cyc.length} pairs each receive a compatible kidney.`;
        }
      }, 480);
    }
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      draw();
    }
    $('#demo-shuffle').addEventListener('click', shuffle);
    $('#demo-find').addEventListener('click', find);
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(cv); else window.addEventListener('resize', resize);
    shuffle(); resize();
  })();
})();
