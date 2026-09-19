# 🕷️ Vipul Sharma — Enter the Web

> An immersive, possession-themed portfolio. You fall through a procedural spider-web tunnel while eight eyes follow your cursor, a heartbeat speeds up the deeper you scroll, and the page whispers to you not to leave.

🔗 **Live:** https://vipulcodex.github.io/protfolio/

## What's inside

- **WebGL tunnel (three.js)** — procedurally generated web you fly through as you scroll, with chapter "gates", crawling spiders, a spider that drops in front of you, and eight cursor-tracking eyes that creep closer with depth
- **Post-processing** — bloom, chromatic aberration, block-glitch, scanlines, film grain, heartbeat-synced vignette
- **Custom player HUD** — seek bar with chapter ticks, volume, mute, **brightness**, intensity (Calm / Possessed / Insane), fullscreen, pause
- **Brightness calibration gate** — horror-game style "slide until the spider is barely visible"
- **Synthesised audio** (Web Audio, zero audio files) — sub drone, heartbeat, whispers, stings
- **Possession meter** — CURIOUS → HOOKED → POSSESSED → LOST → ONE OF US
- Draggable 3D skill orb, tilt/glare project cards, text scramble, ghost cursor, exit-intent trap, tab-blur guilt-trip, and a `hire` easter egg
- Full content (education, experience, projects, skills, certs, publication, achievements) lives in real semantic HTML

### Keyboard
`Space` pause · `M` mute · `F` fullscreen · `+`/`−` brightness · type `hire` 😈

### Accessibility
Contains flashing/glitch effects — the entry gate offers a **CALM** mode (also auto-selected for `prefers-reduced-motion`). If WebGL is unavailable the site falls back to a CSS-only version with all content intact.

## Structure

```
index.html      markup + all content
css/style.css   styling
js/ui.js        gate, HUD, audio, heartbeat, whispers, cursor, reveals, skill orb
js/scene.js     three.js scene + post-processing (ES module via CDN import map)
profile.jpg
```

No build step. Run locally with any static server, e.g. `python3 -m http.server` (ES modules don't load from `file://`).

## Deploy (GitHub Pages)

Repo → **Settings → Pages → Deploy from a branch → `main` / `(root)`**.

## Contact
[vipul26122004@gmail.com](mailto:vipul26122004@gmail.com) · [GitHub](https://github.com/VIPULCODEX) · [LinkedIn](https://linkedin.com/in/vipul-s-302734228)

*M.Tech CSE @ IIIT Una · GATE CS 2025 Qualified · Himachal Pradesh, India*
