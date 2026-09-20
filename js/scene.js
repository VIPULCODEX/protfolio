/* ════════════════════════════════════════════════════════════════
   scene.js — the WebGL half.
   A procedural spider-web tunnel you fall through as you scroll,
   crawling spiders, eight eyes that follow your cursor, and a
   post-processing chain (bloom · chromatic aberration · glitch).
════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const WEB = window.WEB;
try {
  boot();
} catch (err) {
  console.warn('[web] WebGL scene failed, falling back to CSS-only mode:', err);
  document.body.classList.add('no-gl');
}

function boot() {
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const lowPower = isTouch || (navigator.hardwareConcurrency || 8) <= 4;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smoothstep01 = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /* ─────────── renderer / camera ─────────── */
  const host = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  let DPR = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
  renderer.setPixelRatio(DPR);
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x05060f);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1800);

  /* ─────────── tunnel centre-line ─────────── */
  const L = 900;                                    // tunnel length
  const cx = t => Math.sin(t * 0.011) * 7 + Math.sin(t * 0.027) * 3;
  const cy = t => Math.cos(t * 0.009) * 5 + Math.sin(t * 0.021) * 2;
  const rad = t => 11 + Math.sin(t * 0.05) * 3 + Math.sin(t * 0.013) * 2;
  const center = (t, out = new THREE.Vector3()) => out.set(cx(t), cy(t), -t);

  /* ─────────── the web ─────────── */
  const SPACING = 2.2, RINGS = Math.floor(L / SPACING), SEG = lowPower ? 12 : 16;

  const webVS = /* glsl */`
    attribute vec2 aDir; attribute float aRnd;
    uniform float uTime, uHeart;
    varying float vZ, vRnd, vFade;
    void main() {
      vec3 p = position;
      float br = sin(uTime * 1.3 + p.z * 0.08 + aRnd * 6.283) * 0.2 + uHeart * 0.6;
      p.xy += aDir * br;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float d = length(mv.xyz);
      vFade = exp(-d * 0.024) * smoothstep(0.4, 4.0, d);
      vZ = -p.z; vRnd = aRnd;
      gl_Position = projectionMatrix * mv;
    }`;
  const webFS = /* glsl */`
    uniform float uTime, uHeart, uWeb, uPulseK;
    uniform vec3 uA, uB;
    varying float vZ, vRnd, vFade;
    void main() {
      float pulse = pow(0.5 + 0.5 * sin(vZ * 0.28 - uTime * 3.2 + vRnd * 2.0), 10.0);
      vec3 base = vec3(0.72, 0.78, 0.95);                         // silvery web silk
      vec3 energy = mix(uA, uB, clamp(vRnd, 0.0, 1.0));         // red / blue pulses running along it
      vec3 col = mix(base, energy, clamp(pulse * 1.2, 0.0, 1.0));
      float a = vFade * (0.95 * uWeb + pulse * 2.2 * uPulseK + uHeart * 0.4);
      gl_FragColor = vec4(col * a, 1.0);
    }`;
  const ptVS = /* glsl */`
    attribute float aSize; attribute float aRnd;
    uniform float uTime, uScale, uDrift, uMax;
    varying float vFade, vRnd;
    void main() {
      vec3 p = position;
      p.y += sin(uTime * 0.3 + aRnd * 30.0) * 0.5 * uDrift;
      p.x += cos(uTime * 0.25 + aRnd * 20.0) * 0.5 * uDrift;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float d = length(mv.xyz);
      float tw = 0.75 + 0.5 * sin(uTime * 2.0 + aRnd * 40.0);
      gl_PointSize = clamp(aSize * tw * uScale / d, 0.0, uMax);
      vFade = exp(-d * 0.03) * smoothstep(0.3, 3.0, d);
      vRnd = aRnd;
      gl_Position = projectionMatrix * mv;
    }`;
  const ptFS = /* glsl */`
    uniform vec3 uColor; uniform float uHeart, uAlpha;
    varying float vFade, vRnd;
    void main() {
      float r = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, r);
      a *= a;
      gl_FragColor = vec4(uColor * a * vFade * (1.4 + uHeart) * uAlpha, 1.0);
    }`;

  const uni = {
    uTime: { value: 0 }, uHeart: { value: 0 }, uWeb: { value: 1 }, uPulseK: { value: 1 },
    uA: { value: new THREE.Color(0xe62429) }, uB: { value: new THREE.Color(0x4c8dff) },
  };

  // build strands as non-indexed line segments
  const P = [], D = [], R = [];
  const nodeP = [], nodeS = [], nodeR = [];
  const grid = [];
  for (let i = 0; i < RINGS; i++) {
    const t = i * SPACING + (Math.random() - 0.5) * 0.6;
    const row = [];
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2 + i * 0.035 + (Math.random() - 0.5) * 0.08;
      const r = rad(t) * (0.9 + Math.random() * 0.2);
      const dx = Math.cos(a), dy = Math.sin(a);
      row.push({ x: cx(t) + dx * r, y: cy(t) + dy * r, z: -t, dx, dy });
    }
    grid.push(row);
  }
  const seg = (a, b) => {
    const k = Math.random();
    P.push(a.x, a.y, a.z, b.x, b.y, b.z);
    D.push(a.dx, a.dy, b.dx, b.dy);
    R.push(k, k);
  };
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = grid[i][j];
      if (Math.random() > 0.08) seg(a, grid[i][(j + 1) % SEG]);                 // ring
      if (Math.random() > 0.05) seg(a, grid[i + 1][j]);                          // spoke
      if (Math.random() < 0.3) seg(a, grid[i + 1][(j + 1) % SEG]);               // cross strand
      if (i < RINGS - 3 && Math.random() < 0.06) seg(a, grid[i + 3][(j + SEG - 1) % SEG]); // long drape
      if (Math.random() > 0.74) { nodeP.push(a.x, a.y, a.z); nodeS.push(rand(0.1, 0.34)); nodeR.push(Math.random()); }
    }
  }
  const webGeo = new THREE.BufferGeometry();
  webGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  webGeo.setAttribute('aDir', new THREE.Float32BufferAttribute(D, 2));
  webGeo.setAttribute('aRnd', new THREE.Float32BufferAttribute(R, 1));
  const webMat = new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: webVS, fragmentShader: webFS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const web = new THREE.LineSegments(webGeo, webMat);
  web.frustumCulled = false;
  scene.add(web);

  // glowing junction nodes
  const ptUni = (color, drift) => ({
    uTime: uni.uTime, uHeart: uni.uHeart, uScale: { value: 800 }, uDrift: { value: drift }, uColor: { value: new THREE.Color(color) }, uMax: { value: 64 }, uAlpha: { value: 1 },
  });
  const nodeUni = ptUni(0xffffff, 0);
  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.Float32BufferAttribute(nodeP, 3));
  nodeGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(nodeS, 1));
  nodeGeo.setAttribute('aRnd', new THREE.Float32BufferAttribute(nodeR, 1));
  const nodes = new THREE.Points(nodeGeo, new THREE.ShaderMaterial({
    uniforms: nodeUni, vertexShader: ptVS, fragmentShader: ptFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  nodes.frustumCulled = false;
  scene.add(nodes);

  // floating dust / spores
  const DUST = lowPower ? 900 : 1800;
  const dP = [], dS = [], dR = [];
  for (let i = 0; i < DUST; i++) {
    const t = Math.random() * L, a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * rad(t) * 0.92;
    dP.push(cx(t) + Math.cos(a) * r, cy(t) + Math.sin(a) * r, -t);
    dS.push(rand(0.05, 0.16)); dR.push(Math.random());
  }
  const dustUni = ptUni(0xcfe0ff, 1);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dP, 3));
  dustGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(dS, 1));
  dustGeo.setAttribute('aRnd', new THREE.Float32BufferAttribute(dR, 1));
  const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
    uniforms: dustUni, vertexShader: ptVS, fragmentShader: ptFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  dust.frustumCulled = false;
  scene.add(dust);

  // cinematic bokeh: big, soft, out-of-focus discs drifting through the frame
  function makeBokeh(color, n) {
    const bp = [], bs = [], br = [];
    for (let i = 0; i < n; i++) {
      const t = Math.random() * L, a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * rad(t) * 0.8;
      bp.push(cx(t) + Math.cos(a) * r, cy(t) + Math.sin(a) * r, -t);
      bs.push(rand(0.9, 2.8)); br.push(Math.random());
    }
    const u = ptUni(color, 2.5);
    u.uMax.value = 220; u.uAlpha.value = 0.13;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(bs, 1));
    g.setAttribute('aRnd', new THREE.Float32BufferAttribute(br, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: ptVS, fragmentShader: ptFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false;
    scene.add(pts);
    return u;
  }
  const bokehA = makeBokeh(0xe62429, lowPower ? 40 : 80), bokehB = makeBokeh(0x4c8dff, lowPower ? 40 : 80);

  // a glowing light at the far end of the tunnel + a horizontal anamorphic streak through it
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xe62429) }, uI: { value: 0.6 }, uStreak: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uI, uStreak;
      void main(){
        vec2 c = vUv - 0.5;
        float d = length(c) * 2.0;
        float halo = pow(max(0.0, 1.0 - d), 2.2);
        float streak = uStreak * pow(max(0.0, 1.0 - abs(c.x) * 2.0), 3.0) * exp(-abs(c.y) * 90.0);
        gl_FragColor = vec4(uColor * (halo * uI + streak * uI * 1.6), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const farGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
  const farStreak = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat.clone());
  farStreak.material.uniforms = { uColor: glowMat.uniforms.uColor, uI: { value: 0.9 }, uStreak: { value: 1 } };
  scene.add(farGlow, farStreak);

  /* ─────────── chapter gates (mini webs you fly through) ─────────── */
  const gates = new THREE.Group();
  scene.add(gates);
  const gateMat = new THREE.LineBasicMaterial({ color: 0xff3b3f, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  function makeGate(R0) {
    const g = new THREE.Group();
    const pts = [];
    const S = 12;
    for (let k = 0; k < S; k++) {                      // radial spokes
      const a = (k / S) * Math.PI * 2;
      pts.push(Math.cos(a) * R0 * 0.06, Math.sin(a) * R0 * 0.06, 0, Math.cos(a) * R0, Math.sin(a) * R0, 0);
    }
    [0.2, 0.38, 0.58, 0.8, 1].forEach(f => {           // concentric rings, slightly sagging between spokes
      for (let k = 0; k < S; k++) {
        const a0 = (k / S) * Math.PI * 2, a1 = ((k + 1) / S) * Math.PI * 2, am = (a0 + a1) / 2, sag = f * 0.93;
        pts.push(Math.cos(a0) * R0 * f, Math.sin(a0) * R0 * f, 0, Math.cos(am) * R0 * sag, Math.sin(am) * R0 * sag, 0);
        pts.push(Math.cos(am) * R0 * sag, Math.sin(am) * R0 * sag, 0, Math.cos(a1) * R0 * f, Math.sin(a1) * R0 * f, 0);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(geo, gateMat));
    const torus = new THREE.Mesh(new THREE.TorusGeometry(R0 * 1.04, 0.09, 8, 72), new THREE.MeshBasicMaterial({ color: 0xe62429, toneMapped: false }));
    g.add(torus);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(R0 * 0.62, 0.05, 8, 60), new THREE.MeshBasicMaterial({ color: 0x4c8dff, toneMapped: false }));
    g.add(inner);
    g.userData.inner = inner;
    return g;
  }
  function layoutGates() {
    gates.clear();
    (WEB.chapters || []).forEach((c, i) => {
      if (i === 0) return;
      const t = tOf(c.p);
      const g = makeGate(rad(t) * 0.78);
      center(t, g.position);
      g.userData.spin = (i % 2 ? 1 : -1) * rand(0.15, 0.4);
      gates.add(g);
    });
  }
  const tOf = p => 6 + p * (L - 50);
  window.addEventListener('web:layout', layoutGates);

  /* ─────────── spiders ─────────── */
  const skin = (body, rim, leg, glow) => ({
    body: new THREE.MeshBasicMaterial({ color: body }),
    rim: new THREE.MeshBasicMaterial({ color: rim, side: THREE.BackSide }),
    leg: new THREE.LineBasicMaterial({ color: leg, toneMapped: false }),
    glow: new THREE.MeshBasicMaterial({ color: glow, toneMapped: false }),
  });
  const SKIN_SPIDEY = skin(0x120508, 0x8a1418, 0xff3b3f, 0xff3b3f);
  const SKIN_VENOM = skin(0x020204, 0x8b93a8, 0xf2f4fa, 0xffffff);
  const geoAb = new THREE.SphereGeometry(0.55, 14, 10), geoTh = new THREE.SphereGeometry(0.34, 12, 8), geoDot = new THREE.SphereGeometry(0.07, 6, 6);

  function makeSpider(scale, venom) {
    const M = venom ? SKIN_VENOM : SKIN_SPIDEY;
    const g = new THREE.Group();
    const add = (geo, x, y, z, sx = 1, sy = 1, sz = 1, mat = M.body, rim = true) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m);
      if (rim) { const r = new THREE.Mesh(geo, M.rim); r.position.copy(m.position); r.scale.set(sx * 1.1, sy * 1.1, sz * 1.1); g.add(r); }
    };
    add(geoAb, 0, 0.85, -0.55, 1, 0.85, 1.3);
    add(geoTh, 0, 0.8, 0.28);
    add(geoDot, 0, 1.31, -0.62, 1.5, 0.6, 2.4, M.glow, false);         // hourglass mark
    add(geoDot, -0.11, 0.93, 0.56, 1, 1, 1, M.glow, false);
    add(geoDot, 0.11, 0.93, 0.56, 1, 1, 1, M.glow, false);
    const pos = new Float32Array(8 * 4 * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const legs = new THREE.LineSegments(lg, M.leg);
    legs.frustumCulled = false;
    g.add(legs);
    g.userData.pos = pos; g.userData.lg = lg; g.userData.ph = Math.random() * 10;
    g.scale.setScalar(scale);
    return g;
  }
  const FOOT_Z = [0.95, 0.4, -0.3, -0.95];
  function animateLegs(g, time, speed, lift) {
    const pos = g.userData.pos, ph0 = g.userData.ph;
    for (let k = 0; k < 8; k++) {
      const side = k < 4 ? -1 : 1, i = k % 4;
      const hz = 0.35 - i * 0.24;
      const ph = time * speed + ph0 + i * 1.7 + (side > 0 ? Math.PI : 0);
      const sw = Math.sin(ph), lf = Math.max(0, Math.cos(ph)) * 0.55 * lift;
      const reach = 1.75 + (i === 0 || i === 3 ? 0.35 : 0);
      const fx = side * reach, fy = lf, fz = FOOT_Z[i] + sw * 0.32;
      const kx = side * (0.22 + reach * 0.52), ky = 1.65 + lf * 0.5, kz = (hz + fz) / 2;
      const o = k * 12;
      pos[o] = side * 0.22; pos[o + 1] = 0.8; pos[o + 2] = hz;
      pos[o + 3] = kx; pos[o + 4] = ky; pos[o + 5] = kz;
      pos[o + 6] = kx; pos[o + 7] = ky; pos[o + 8] = kz;
      pos[o + 9] = fx; pos[o + 10] = fy; pos[o + 11] = fz;
    }
    g.userData.lg.attributes.position.needsUpdate = true;
  }

  // wall crawlers
  const crawlers = [];
  const NSP = lowPower ? 10 : 18;
  for (let i = 0; i < NSP; i++) {
    const s = makeSpider(rand(0.9, 2.3), i % 2 === 1);
    const c = { g: s, venom: i % 2 === 1, t: i < 5 ? rand(20, 140) : rand(0, L), th: rand(0, Math.PI * 2), v: rand(1.5, 5) * (Math.random() < 0.5 ? 1 : -1), dth: rand(-0.06, 0.06), sp: rand(5, 11) };
    crawlers.push(c); scene.add(s);
  }
  const _v = new THREE.Vector3(), _t = new THREE.Vector3();
  function updateCrawlers(dt, time) {
    for (const c of crawlers) {
      if (!c.g.visible) continue;
      c.t += c.v * dt; c.th += c.dth * dt;
      if (c.t < 2 || c.t > L - 2) c.v *= -1;
      const t = clamp(c.t, 0, L), n = { x: Math.cos(c.th), y: Math.sin(c.th) };
      const r = rad(t) * 0.97;
      center(t, _v);
      c.g.position.set(_v.x + n.x * r, _v.y + n.y * r, _v.z);
      c.g.up.set(-n.x, -n.y, 0);
      c.g.lookAt(c.g.position.x, c.g.position.y, c.g.position.z - Math.sign(c.v));
      animateLegs(c.g, time, c.sp * Math.min(1, Math.abs(c.v) / 3), 1);
    }
  }

  // the one that drops in front of you
  const dropper = { g: makeSpider(1.5, true), state: 0, t: 0, next: rand(14, 24), off: new THREE.Vector3(), thread: null };
  {
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 40, 0], 3));
    dropper.thread = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffd0d8, transparent: true, opacity: 0.55, toneMapped: false }));
    dropper.g.visible = dropper.thread.visible = false;
    scene.add(dropper.g, dropper.thread);
  }
  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function updateDropper(dt, time) {
    const d = dropper;
    if (d.state === 0) {
      d.next -= dt;
      if (d.next <= 0 && WEB.entered && WEB.fx === 2 && WEB.p > 0.03) {
        d.state = 1; d.t = 0;
        d.off.set(rand(-4, 4), 0, rand(9, 12));
        WEB.kick(0.5);
        d.g.visible = d.thread.visible = true;
      }
      return;
    }
    d.t += dt;
    const T_DROP = 0.45, T_HOLD = 1.7, T_RISE = 1.4;
    let y;
    if (d.t < T_DROP) { const k = d.t / T_DROP; y = 16 - (1 - (1 - k) * (1 - k)) * 14.8; }
    else if (d.t < T_DROP + T_HOLD) y = 1.2 + Math.sin(time * 9) * 0.22;
    else { const k = (d.t - T_DROP - T_HOLD) / T_RISE; y = 1.2 + k * k * 15; }
    camera.getWorldDirection(_f);
    _f.y = 0; _f.normalize();
    _r.crossVectors(_f, _up);
    d.g.position.copy(camera.position).addScaledVector(_f, d.off.z).addScaledVector(_r, d.off.x);
    d.g.position.y = camera.position.y + y - 2.2;
    d.g.lookAt(camera.position.x, d.g.position.y, camera.position.z);
    d.thread.position.set(d.g.position.x, d.g.position.y + 2.4, d.g.position.z);
    animateLegs(d.g, time, 30, 1.8);
    if (d.t > T_DROP + T_HOLD + T_RISE) {
      d.state = 0; d.g.visible = d.thread.visible = false;
      d.next = rand(16, 30) / (WEB.fx === 2 ? 2 : 1);
    }
  }

  /* ─────────── Venom's eyes — two white, angry, cursor-following ─────────── */
  const eyes = new THREE.Group();
  scene.add(eyes);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide });
  const eyeShape = new THREE.Shape();
  eyeShape.moveTo(-2.7, 1.1);
  eyeShape.quadraticCurveTo(0.3, 2.3, 2.6, -1.8);     // sweeping top edge down to the inner point
  eyeShape.quadraticCurveTo(-0.4, -0.8, -2.7, 1.1);   // underside
  const eyeGeo = new THREE.ShapeGeometry(eyeShape, 28);
  const eyeList = [-1, 1].map(side => {
    const m = new THREE.Mesh(eyeGeo, eyeMat);
    m.position.x = side * 3.5;
    m.scale.x = -side;                                  // mirror the right eye
    eyes.add(m);
    return m;
  });

  /* ─────────── post-processing ─────────── */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(DPR);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.05, 0.7, 0.2);
  composer.addPass(bloom);

  const fxPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uTime: { value: 0 }, uGlitch: { value: 0 }, uAber: { value: 0.002 },
      uNoise: { value: 0.05 }, uInvert: { value: 0 }, uSym: { value: 0 }, uSat: { value: 1.2 }, uContrast: { value: 1.1 }, uHalftone: { value: 0 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
    },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float uTime, uGlitch, uAber, uNoise, uInvert, uSym, uSat, uContrast, uHalftone;
      uniform vec2 uRes;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec2 uv = vUv;
        vec2 c = uv - 0.5;
        // faint lens bulge
        uv = c * (1.0 - 0.06 * dot(c, c)) + 0.5;

        // horizontal block tearing
        float tstep = floor(uTime * 14.0);
        float band = floor(uv.y * 28.0);
        float g = step(1.0 - uGlitch * 0.5, hash(vec2(band, tstep))) * min(uGlitch, 1.0);
        uv.x = fract(uv.x + (hash(vec2(band, tstep + 7.0)) - 0.5) * 0.09 * g);
        // vertical roll on big hits
        uv.y += step(1.6, uGlitch) * (hash(vec2(tstep, 3.0)) - 0.5) * 0.08;

        float ab = uAber + g * 0.025 + uGlitch * 0.004;
        vec3 col;
        col.r = texture2D(tDiffuse, uv + c * ab * 1.2 + vec2(uHalftone * 0.0016, 0.0)).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - c * ab * 1.2 - vec2(uHalftone * 0.0016, 0.0)).b;

        // scanlines + grain
        // film grade: gentle S-curve + a little extra saturation
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(luma), col, uSat);
        col = (col - 0.5) * uContrast + 0.5;
        col = max(col, 0.0);
        // Spider-Verse style comic print: Ben-Day halftone dots in the shadows + a touch of poster banding
        if (uHalftone > 0.001) {
          float ang = 0.7854;
          mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
          vec2 cell = fract(R * (vUv * uRes) / (7.0 * uRes.y / 810.0)) - 0.5;
          float l2 = dot(col, vec3(0.299, 0.587, 0.114));
          float r = (1.0 - smoothstep(0.0, 0.75, l2)) * 0.62;
          float m = smoothstep(r + 0.06, r - 0.06, length(cell));
          col = mix(col, col * 0.4, uHalftone * m * (1.0 - l2));
          col = mix(col, floor(col * 7.0 + 0.5) / 7.0, uHalftone * 0.35);
        }
        col *= 0.95 + 0.05 * sin(uv.y * uRes.y * 1.6);
        col += (hash(uv * uRes + uTime) - 0.5) * uNoise;

        // Venom: black symbiote creeping in from the edges of the frame
        float aspect = uRes.x / uRes.y;
        float ed = min(min(vUv.x, 1.0 - vUv.x) * aspect, min(vUv.y, 1.0 - vUv.y));
        float nz = fbm(vec2(vUv.x * aspect * 3.0, vUv.y * 3.0 + uTime * 0.05));
        float thr = uSym * 0.2 + (nz - 0.5) * 0.3 * uSym;
        float ink = 1.0 - smoothstep(thr - 0.012, thr + 0.012, ed);
        float rim = smoothstep(0.012, 0.0, abs(ed - thr)) * uSym;
        col = mix(col, vec3(0.006, 0.008, 0.016), ink);
        col += rim * vec3(0.25, 0.32, 0.5) * (1.0 - ink);

        col = mix(col, 1.0 - col, uInvert);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  composer.addPass(fxPass);
  composer.addPass(new OutputPass());

  /* ─────────── palette that drifts with depth ─────────── */
  const PAL = [
    [0xe62429, 0x2b6cff], [0xff3b3f, 0x4c8dff], [0xd0d4e4, 0x2b6cff],
    [0xffffff, 0x9aa4c0], [0xf5f7ff, 0xf5f7ff], [0xffffff, 0xffffff],
  ].map(([a, b]) => [new THREE.Color(a), new THREE.Color(b)]);
  const _ca = new THREE.Color(), _cb = new THREE.Color();
  function palette(p, depth) {
    const f = clamp(p, 0, 0.9999) * (PAL.length - 1), i = Math.floor(f), k = f - i;
    _ca.copy(PAL[i][0]).lerp(PAL[i + 1][0], k);
    _cb.copy(PAL[i][1]).lerp(PAL[i + 1][1], k);
    uni.uA.value.copy(look.A).lerp(_ca, depth);
    uni.uB.value.copy(look.B).lerp(_cb, depth);
    gateMat.color.copy(uni.uA.value);
  }

  /* ─────────── LOOKS: Calm / Spider-Sense / Venom each get their own visual identity ─────────── */
  const C = h => new THREE.Color(h);
  const LOOKS = [
    // 0 · CALM — clean, muted steel-blue, nothing flashing
    { sat: 0.55, contrast: 1.0, bloom: 0.5, halftone: 0, grain: 0.012, inkBase: 0, inkMax: 0, bokeh: 0.3, eyes: 0, eyesLate: 0, eyeSize: 1, glow: 0.6, web: 0.8, pulse: 0.5, depth: 0, swing: 0.3, hand: 0.25, smooth: 1.5, aber: 0.0006, A: C(0x6f8fc7), B: C(0x9db4d9) },
    // 1 · SPIDER-SENSE — comic-book energy: vivid red/blue, halftone print, dynamic swinging camera
    { sat: 1.3, contrast: 1.1, bloom: 1.1, halftone: 0.6, grain: 0.03, inkBase: 0, inkMax: 0.55, bokeh: 1, eyes: 0.55, eyesLate: 1, eyeSize: 1, glow: 1, web: 1, pulse: 1.3, depth: 1, swing: 1.5, hand: 1, smooth: 1.9, aber: 0.0018, A: C(0xe62429), B: C(0x2b6cff) },
    // 2 · VENOM — monochrome symbiote: crushed blacks, heavy ink from the start, big watching eyes
    { sat: 0.06, contrast: 1.3, bloom: 0.9, halftone: 0, grain: 0.075, inkBase: 0.5, inkMax: 1.15, bokeh: 0.35, eyes: 1, eyesLate: 0, eyeSize: 1.35, glow: 0.3, web: 1.1, pulse: 0.8, depth: 0, swing: 0.7, hand: 1.4, smooth: 1.5, aber: 0.0025, A: C(0xffffff), B: C(0xaeb6c9) },
  ];
  const LOOK_KEYS = ['sat', 'contrast', 'bloom', 'halftone', 'grain', 'inkBase', 'inkMax', 'bokeh', 'eyes', 'eyesLate', 'eyeSize', 'glow', 'web', 'pulse', 'depth', 'swing', 'hand', 'smooth', 'aber'];
  const look = Object.assign({}, LOOKS[1], { A: LOOKS[1].A.clone(), B: LOOKS[1].B.clone() });
  function blendLook(target, k) {
    for (const key of LOOK_KEYS) look[key] += (target[key] - look[key]) * k;
    look.A.lerp(target.A, k); look.B.lerp(target.B, k);
  }

  /* ─────────── resize ─────────── */
  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    fxPass.uniforms.uRes.value.set(innerWidth * DPR, innerHeight * DPR);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ─────────── main loop ─────────── */
  const clock = new THREE.Clock();
  let perfN = 0, perfSum = 0, perfDone = false;
  let time = 0, ps = 0, introK = 0, ms = { x: 0, y: 0 }, blinkT = 3, blink = 0;
  const _c0 = new THREE.Vector3(), _c1 = new THREE.Vector3(), _e = new THREE.Vector3();

  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden || WEB.quick) { clock.getDelta(); return; }   // quick view: render nothing

    const rawDt = clock.getDelta();
    let dt = Math.min(rawDt, 0.05);
    if (WEB.paused) dt = 0;
    time += dt;
    const fxm = clamp(WEB.fxMul(), 0.15, 2);
    blendLook(LOOKS[WEB.fx], 1 - Math.exp(-Math.max(dt, 0.016) * 3.2));   // smooth cross-fade when the mode changes

    // smooth progress; `vel` is how hard you're falling
    const diff = WEB.p - ps;
    ps += diff * (1 - Math.exp(-dt * look.smooth));
    const vel = clamp(diff, -0.2, 0.2);
    ms.x += (WEB.mouse.x - ms.x) * (1 - Math.exp(-dt * 4));
    ms.y += (WEB.mouse.y - ms.y) * (1 - Math.exp(-dt * 4));

    if (WEB.entered) introK = Math.min(1, introK + dt / 3.4);

    // adaptive quality: if the first ~1.5s after the intro run slow, drop resolution and bloom
    if (!perfDone && introK >= 1 && !WEB.paused) {
      perfSum += rawDt;
      if (++perfN >= 90) {
        perfDone = true;
        if (perfSum / perfN > 0.045) {
          DPR = 1;
          renderer.setPixelRatio(1); composer.setPixelRatio(1);
          bloom.enabled = false;
          resize();
          if (WEB.toast) WEB.toast('Performance mode enabled — try Quick view for the fastest experience');
        }
      }
    }
    const intro = 1 - Math.pow(1 - introK, 3);

    /* camera rides the tunnel centre-line */
    const tCam = 6 + ps * (L - 50);
    center(tCam, _c0); center(tCam + 9, _c1);
    camera.position.copy(_c0);
    camera.up.set(0, 1, 0);
    camera.lookAt(_c1);
    camera.rotateY(-ms.x * 0.24 * Math.min(fxm, 1.3));
    camera.rotateX(ms.y * 0.17 * Math.min(fxm, 1.3));
    camera.rotateZ(-vel * 2.2 * look.swing + Math.sin(time * 0.4) * 0.03 * look.swing + (1 - intro) * 0.9);
    camera.translateX(ms.x * 1.2);
    camera.translateY(Math.sin(time * 0.9) * 0.08 + WEB.heart * 0.05 * fxm);
    // subtle handheld: layered slow sines on rotation + a touch of positional drift
    const hh = look.hand;
    camera.rotateX((Math.sin(time * 1.3) + Math.sin(time * 2.9) * 0.5) * 0.0035 * hh);
    camera.rotateY((Math.sin(time * 1.1 + 1.7) + Math.sin(time * 3.3) * 0.5) * 0.0035 * hh);
    camera.translateX(Math.sin(time * 0.7) * 0.06 * hh);
    const shake = WEB.glitch * 0.06;
    if (shake > 0.002) camera.position.add(_e.set(rand(-shake, shake), rand(-shake, shake), 0));
    camera.fov = 70 + Math.min(Math.abs(vel) * 260 * look.swing, 26 * look.swing) + WEB.heart * 2.5 * fxm + (1 - intro) * 65;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    /* uniforms */
    uni.uTime.value = time;
    uni.uHeart.value = WEB.heart * Math.min(fxm, 1.5);
    palette(ps, look.depth);
    uni.uWeb.value = look.web; uni.uPulseK.value = look.pulse;
    const scale = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    nodeUni.uScale.value = dustUni.uScale.value = scale;
    dustUni.uColor.value.copy(uni.uB.value).lerp(new THREE.Color(0xffffff), 0.6);
    nodeUni.uColor.value.copy(uni.uA.value).multiplyScalar(1.3);

    /* far light + streak follow the tunnel ahead of you */
    const gt = Math.min(tCam + 150, L + 40);
    center(gt, farGlow.position); farStreak.position.copy(farGlow.position);
    farGlow.lookAt(camera.position); farStreak.lookAt(camera.position);
    const gd = camera.position.distanceTo(farGlow.position);
    farGlow.scale.set(gd * 0.75, gd * 0.75, 1);
    farStreak.scale.set(gd * 1.7, gd * 0.5, 1);
    glowMat.uniforms.uColor.value.copy(uni.uA.value).lerp(uni.uB.value, 0.35);
    glowMat.uniforms.uI.value = (0.45 + WEB.heart * 0.25) * (1 - ps * 0.35) * look.glow;
    bokehA.uScale.value = bokehB.uScale.value = scale;
    bokehA.uColor.value.copy(uni.uA.value); bokehB.uColor.value.copy(uni.uB.value);
    bokehA.uAlpha.value = bokehB.uAlpha.value = 0.13 * look.bokeh;

    /* gates spin & throb */
    gates.children.forEach(g => {
      g.rotation.z += g.userData.spin * dt;
      g.userData.inner.rotation.z -= g.userData.spin * dt * 2.6;
      g.scale.setScalar(1 + WEB.heart * 0.04);
    });

    // spiders: none in Calm · red (Spider-Man) in Spider-Sense · white (Venom) in Venom
    for (const c of crawlers) c.g.visible = WEB.fx === 1 ? !c.venom : WEB.fx === 2 ? c.venom : false;
    updateCrawlers(dt, time);
    updateDropper(dt, time);

    /* eyes — hover ahead of you, creeping closer the deeper you go */
    const D = 70 - ps * 46;
    const base = 0.02 + ps * ps * ps * 0.026;
    const eyeVis = look.eyes * (1 - look.eyesLate + look.eyesLate * smoothstep01(ps, 0.55, 1));
    center(tCam + D, eyes.position);
    eyes.position.x += -ms.x * 6;
    eyes.position.y += -ms.y * 3 + Math.sin(time * 0.7) * 0.6;
    eyes.visible = eyeVis > 0.03;
    eyes.scale.setScalar(D * base * intro * eyeVis * look.eyeSize);
    eyes.lookAt(camera.position);
    eyes.rotateY(ms.x * 0.4);                            // turn toward the cursor
    eyes.rotateX(-ms.y * 0.28);
    blinkT -= dt;
    if (blinkT <= 0) { blink = 1; blinkT = rand(3, 7); }
    blink = Math.max(0, blink - dt * 4.5);
    const lid = blink > 0 ? 1 - Math.sin((1 - blink) * Math.PI) * 0.92 : 1;
    const glow = 0.82 + WEB.heart * 0.18;
    eyeMat.color.setRGB(glow, glow, glow);
    for (const e of eyeList) e.scale.y = Math.max(0.08, lid);

    /* post */
    renderer.toneMappingExposure = Math.max(1, WEB.bright);
    fxPass.uniforms.uTime.value = time;
    fxPass.uniforms.uGlitch.value = WEB.glitch + (WEB.entered ? (1 - intro) * 0.18 : 0);
    fxPass.uniforms.uAber.value = look.aber + Math.min(Math.abs(vel) * 0.03, 0.006) * look.swing + WEB.heart * 0.0018 * fxm;
    fxPass.uniforms.uNoise.value = look.grain + 0.008 * fxm;
    fxPass.uniforms.uSat.value = look.sat;
    fxPass.uniforms.uContrast.value = look.contrast;
    fxPass.uniforms.uHalftone.value = look.halftone;
    fxPass.uniforms.uInvert.value = WEB.invert;
    fxPass.uniforms.uSym.value = (look.inkBase + smoothstep01(ps, 0.2, 0.95) * (look.inkMax - look.inkBase)) * 0.7;
    bloom.strength = look.bloom + WEB.heart * 0.35 * fxm + ps * 0.1;

    composer.render();
  }
  frame();
}
