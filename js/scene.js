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

  /* ─────────── renderer / camera ─────────── */
  const host = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  const DPR = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
  renderer.setPixelRatio(DPR);
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x030006);
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
      vFade = exp(-d * 0.036) * smoothstep(0.4, 4.0, d);
      vZ = -p.z; vRnd = aRnd;
      gl_Position = projectionMatrix * mv;
    }`;
  const webFS = /* glsl */`
    uniform float uTime, uHeart;
    uniform vec3 uA, uB;
    varying float vZ, vRnd, vFade;
    void main() {
      float pulse = pow(0.5 + 0.5 * sin(vZ * 0.28 - uTime * 3.2 + vRnd * 2.0), 10.0);
      vec3 col = mix(uA, uB, clamp(vRnd * 0.5 + pulse * 0.8, 0.0, 1.0));
      float a = vFade * (0.36 + pulse * 1.5 + uHeart * 0.55);
      gl_FragColor = vec4(col * a, 1.0);
    }`;
  const ptVS = /* glsl */`
    attribute float aSize; attribute float aRnd;
    uniform float uTime, uScale, uDrift;
    varying float vFade, vRnd;
    void main() {
      vec3 p = position;
      p.y += sin(uTime * 0.3 + aRnd * 30.0) * 0.5 * uDrift;
      p.x += cos(uTime * 0.25 + aRnd * 20.0) * 0.5 * uDrift;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float d = length(mv.xyz);
      float tw = 0.75 + 0.5 * sin(uTime * 2.0 + aRnd * 40.0);
      gl_PointSize = clamp(aSize * tw * uScale / d, 0.0, 64.0);
      vFade = exp(-d * 0.03) * smoothstep(0.3, 3.0, d);
      vRnd = aRnd;
      gl_Position = projectionMatrix * mv;
    }`;
  const ptFS = /* glsl */`
    uniform vec3 uColor; uniform float uHeart;
    varying float vFade, vRnd;
    void main() {
      float r = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, r);
      a *= a;
      gl_FragColor = vec4(uColor * a * vFade * (1.4 + uHeart), 1.0);
    }`;

  const uni = {
    uTime: { value: 0 }, uHeart: { value: 0 },
    uA: { value: new THREE.Color(0xdc143c) }, uB: { value: new THREE.Color(0x00d4ff) },
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
    uTime: uni.uTime, uHeart: uni.uHeart, uScale: { value: 800 }, uDrift: { value: drift }, uColor: { value: new THREE.Color(color) },
  });
  const nodeUni = ptUni(0xff2d55, 0);
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
  const dustUni = ptUni(0xbfd8ff, 1);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dP, 3));
  dustGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(dS, 1));
  dustGeo.setAttribute('aRnd', new THREE.Float32BufferAttribute(dR, 1));
  const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
    uniforms: dustUni, vertexShader: ptVS, fragmentShader: ptFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  dust.frustumCulled = false;
  scene.add(dust);

  /* ─────────── chapter gates (mini webs you fly through) ─────────── */
  const gates = new THREE.Group();
  scene.add(gates);
  const gateMat = new THREE.LineBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
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
    const torus = new THREE.Mesh(new THREE.TorusGeometry(R0 * 1.04, 0.09, 8, 72), new THREE.MeshBasicMaterial({ color: 0xff1a44, toneMapped: false }));
    g.add(torus);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(R0 * 0.62, 0.05, 8, 60), new THREE.MeshBasicMaterial({ color: 0x00d4ff, toneMapped: false }));
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
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x14030a });
  const rimMat = new THREE.MeshBasicMaterial({ color: 0x7a1128, side: THREE.BackSide });
  const legMat = new THREE.LineBasicMaterial({ color: 0xff2d55, toneMapped: false });
  const redGlow = new THREE.MeshBasicMaterial({ color: 0xff1030, toneMapped: false });
  const geoAb = new THREE.SphereGeometry(0.55, 14, 10), geoTh = new THREE.SphereGeometry(0.34, 12, 8), geoDot = new THREE.SphereGeometry(0.07, 6, 6);

  function makeSpider(scale) {
    const g = new THREE.Group();
    const add = (geo, x, y, z, sx = 1, sy = 1, sz = 1, mat = bodyMat, rim = true) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m);
      if (rim) { const r = new THREE.Mesh(geo, rimMat); r.position.copy(m.position); r.scale.set(sx * 1.1, sy * 1.1, sz * 1.1); g.add(r); }
    };
    add(geoAb, 0, 0.85, -0.55, 1, 0.85, 1.3);
    add(geoTh, 0, 0.8, 0.28);
    add(geoDot, 0, 1.31, -0.62, 1.5, 0.6, 2.4, redGlow, false);         // hourglass mark
    add(geoDot, -0.11, 0.93, 0.56, 1, 1, 1, redGlow, false);
    add(geoDot, 0.11, 0.93, 0.56, 1, 1, 1, redGlow, false);
    const pos = new Float32Array(8 * 4 * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const legs = new THREE.LineSegments(lg, legMat);
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
    const s = makeSpider(rand(0.9, 2.3));
    const c = { g: s, t: i < 5 ? rand(20, 140) : rand(0, L), th: rand(0, Math.PI * 2), v: rand(1.5, 5) * (Math.random() < 0.5 ? 1 : -1), dth: rand(-0.06, 0.06), sp: rand(5, 11) };
    crawlers.push(c); scene.add(s);
  }
  const _v = new THREE.Vector3(), _t = new THREE.Vector3();
  function updateCrawlers(dt, time) {
    for (const c of crawlers) {
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
  const dropper = { g: makeSpider(1.5), state: 0, t: 0, next: rand(14, 24), off: new THREE.Vector3(), thread: null };
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
      if (d.next <= 0 && WEB.entered && WEB.fx > 0 && WEB.p > 0.03) {
        d.state = 1; d.t = 0;
        d.off.set(rand(-4, 4), 0, rand(9, 12));
        WEB.kick(1.2); WEB.sfx && WEB.sfx.sting();
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

  /* ─────────── eight eyes that watch the cursor ─────────── */
  const eyes = new THREE.Group();
  scene.add(eyes);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1030, toneMapped: false });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const EYE_LAYOUT = [
    [-1.7, -0.4, 1.5], [1.7, -0.4, 1.5],
    [-3.7, 0.8, 0.95], [3.7, 0.8, 0.95],
    [-2.5, 2.3, 0.62], [2.5, 2.3, 0.62],
    [-0.95, 2.0, 0.5], [0.95, 2.0, 0.5],
  ];
  const eyeList = EYE_LAYOUT.map(([x, y, r]) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), eyeMat));
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.62, 16, 12), pupilMat);
    pupil.scale.set(0.3, 1, 0.3);
    g.add(pupil);
    eyes.add(g);
    return { g, pupil, r };
  });

  /* ─────────── post-processing ─────────── */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(DPR);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.5, 0.28);
  composer.addPass(bloom);

  const fxPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uTime: { value: 0 }, uGlitch: { value: 0 }, uAber: { value: 0.002 },
      uNoise: { value: 0.05 }, uInvert: { value: 0 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
    },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float uTime, uGlitch, uAber, uNoise, uInvert;
      uniform vec2 uRes;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 uv = vUv;
        vec2 c = uv - 0.5;
        // faint lens bulge
        uv = c * (1.0 - 0.06 * dot(c, c)) + 0.5;

        // horizontal block tearing
        float tstep = floor(uTime * 14.0);
        float band = floor(uv.y * 28.0);
        float g = step(1.0 - uGlitch * 0.5, hash(vec2(band, tstep))) * min(uGlitch, 1.0);
        uv.x = fract(uv.x + (hash(vec2(band, tstep + 7.0)) - 0.5) * 0.22 * g);
        // vertical roll on big hits
        uv.y += step(1.6, uGlitch) * (hash(vec2(tstep, 3.0)) - 0.5) * 0.08;

        float ab = uAber + g * 0.025 + uGlitch * 0.004;
        vec3 col;
        col.r = texture2D(tDiffuse, uv + c * ab * 1.2).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - c * ab * 1.2).b;

        // scanlines + grain
        col *= 0.93 + 0.07 * sin(uv.y * uRes.y * 1.6);
        col += (hash(uv * uRes + uTime) - 0.5) * uNoise;
        col = mix(col, 1.0 - col, uInvert);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  composer.addPass(fxPass);
  composer.addPass(new OutputPass());

  /* ─────────── palette that drifts with depth ─────────── */
  const PAL = [
    [0xdc143c, 0x00d4ff], [0xff0a6c, 0x8a2be2], [0x8a2be2, 0x00ffd0],
    [0xff3b30, 0xffb000], [0xdc143c, 0x00d4ff], [0xff0033, 0xff5a7a],
  ].map(([a, b]) => [new THREE.Color(a), new THREE.Color(b)]);
  const _ca = new THREE.Color(), _cb = new THREE.Color();
  function palette(p) {
    const f = clamp(p, 0, 0.9999) * (PAL.length - 1), i = Math.floor(f), k = f - i;
    uni.uA.value.copy(_ca.copy(PAL[i][0]).lerp(PAL[i + 1][0], k));
    uni.uB.value.copy(_cb.copy(PAL[i][1]).lerp(PAL[i + 1][1], k));
    gateMat.color.copy(uni.uA.value);
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
  let time = 0, ps = 0, introK = 0, ms = { x: 0, y: 0 }, blinkT = 3, blink = 0;
  const _c0 = new THREE.Vector3(), _c1 = new THREE.Vector3(), _e = new THREE.Vector3();

  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) { clock.getDelta(); return; }

    let dt = Math.min(clock.getDelta(), 0.05);
    if (WEB.paused) dt = 0;
    time += dt;
    const fxm = clamp(WEB.fxMul(), 0.15, 2);

    // smooth progress; `vel` is how hard you're falling
    const diff = WEB.p - ps;
    ps += diff * (1 - Math.exp(-dt * 2.6));
    const vel = clamp(diff, -0.2, 0.2);
    ms.x += (WEB.mouse.x - ms.x) * (1 - Math.exp(-dt * 4));
    ms.y += (WEB.mouse.y - ms.y) * (1 - Math.exp(-dt * 4));

    if (WEB.entered) introK = Math.min(1, introK + dt / 3.4);
    const intro = 1 - Math.pow(1 - introK, 3);

    /* camera rides the tunnel centre-line */
    const tCam = 6 + ps * (L - 50);
    center(tCam, _c0); center(tCam + 9, _c1);
    camera.position.copy(_c0);
    camera.up.set(0, 1, 0);
    camera.lookAt(_c1);
    camera.rotateY(-ms.x * 0.24 * Math.min(fxm, 1.3));
    camera.rotateX(ms.y * 0.17 * Math.min(fxm, 1.3));
    camera.rotateZ(-vel * 2.2 + Math.sin(time * 0.4) * 0.03 * fxm + (1 - intro) * 0.9);
    camera.translateX(ms.x * 1.2);
    camera.translateY(Math.sin(time * 0.9) * 0.08 + WEB.heart * 0.05 * fxm);
    const shake = WEB.glitch * 0.06;
    if (shake > 0.002) camera.position.add(_e.set(rand(-shake, shake), rand(-shake, shake), 0));
    camera.fov = 70 + Math.min(Math.abs(vel) * 260, 26) + WEB.heart * 2.5 * fxm + (1 - intro) * 65;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    /* uniforms */
    uni.uTime.value = time;
    uni.uHeart.value = WEB.heart * Math.min(fxm, 1.5);
    palette(ps);
    const scale = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    nodeUni.uScale.value = dustUni.uScale.value = scale;
    dustUni.uColor.value.copy(uni.uB.value).lerp(new THREE.Color(0xffffff), 0.6);
    nodeUni.uColor.value.copy(uni.uA.value).multiplyScalar(1.3);

    /* gates spin & throb */
    gates.children.forEach(g => {
      g.rotation.z += g.userData.spin * dt;
      g.userData.inner.rotation.z -= g.userData.spin * dt * 2.6;
      g.scale.setScalar(1 + WEB.heart * 0.04);
    });

    updateCrawlers(dt, time);
    updateDropper(dt, time);

    /* eyes — hover ahead of you, creeping closer the deeper you go */
    const D = 70 - ps * 46;
    const base = 0.02 + ps * ps * ps * 0.028;
    center(tCam + D, eyes.position);
    eyes.position.x += -ms.x * 6;
    eyes.position.y += -ms.y * 3 + Math.sin(time * 0.7) * 0.6;
    eyes.scale.setScalar(D * base * intro);
    eyes.lookAt(camera.position);
    blinkT -= dt;
    if (blinkT <= 0) { blink = 1; blinkT = rand(2.5, 6.5); }
    blink = Math.max(0, blink - dt * 4.5);
    const lid = 1 - Math.sin(Math.min(1, (1 - blink)) * Math.PI) * (blink > 0 ? 0.94 : 0);
    eyeMat.color.setRGB(0.62 + WEB.heart * 0.3, 0.015, 0.05 + WEB.heart * 0.04);
    for (const e of eyeList) {
      const dx = ms.x * 0.6, dy = ms.y * 0.6;
      const len = Math.hypot(dx, dy, 1);
      e.pupil.position.set((dx / len) * e.r * 0.8, (dy / len) * e.r * 0.8, (1 / len) * e.r * 0.85);
      e.g.scale.y = blink > 0 ? Math.max(0.06, lid) : 1;
    }

    /* post */
    renderer.toneMappingExposure = Math.max(1, WEB.bright);
    fxPass.uniforms.uTime.value = time;
    fxPass.uniforms.uGlitch.value = WEB.glitch + (WEB.entered ? (1 - intro) * 1.4 : 0) + 0.02 * fxm;
    fxPass.uniforms.uAber.value = 0.0012 * fxm + Math.min(Math.abs(vel) * 0.03, 0.006) + WEB.heart * 0.0018 * fxm;
    fxPass.uniforms.uNoise.value = 0.018 + 0.014 * fxm;
    fxPass.uniforms.uInvert.value = WEB.invert;
    bloom.strength = 0.75 + WEB.heart * 0.4 * fxm + ps * 0.1;

    composer.render();
  }
  frame();
}
