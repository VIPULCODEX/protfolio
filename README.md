# 🕷️ Vipul Sharma — Enter the Web

> An immersive **Spider-Man × Venom** themed portfolio. You swing through a procedural spider-web tunnel that starts as Spider-Man's red-and-blue web and gets slowly taken over by a black symbiote as you scroll deeper.

🔗 **Live:** https://vipulcodex.github.io/protfolio/

## What's inside

- **WebGL tunnel (three.js)** — procedurally generated web you fly through as you scroll, with chapter "gates", wall-crawling spiders (red = Spider-Man, white = Venom), a spider that drops in front of you, and Venom's white eyes that follow your cursor and creep closer with depth
- **Symbiote takeover** — the frame edges fill with black ink as your "symbiote bond" rises (SPIDER-SENSE → TINGLING → BONDING → SYMBIOTE → VENOM)
- **Post-processing** — bloom, chromatic aberration, light glitch, scanlines, film grain, heartbeat-synced vignette
- **Custom player HUD** — seek bar with chapter ticks, **brightness**, intensity (Calm / Spider-Sense / Venom), fullscreen, pause
- **Readable by design** — solid dark panels behind all content, glitch kept subtle outside Venom mode
- Draggable 3D skill orb, tilt/glare project cards, text scramble, exit-intent message, and a `hire` easter egg
- Full content (education, experience, projects, skills, certs, publication, achievements) lives in real semantic HTML
- No audio

### Keyboard
`Space` pause effects · `F` fullscreen · `+`/`−` brightness · type `hire`

### Accessibility
Contains motion and brief flashing effects — the entry gate offers a **CALM** mode (also auto-selected for `prefers-reduced-motion`). If WebGL is unavailable the site falls back to a CSS-only version with all content intact.

## Structure

```
index.html      markup + all content
css/style.css   styling
js/ui.js        gate, HUD, heartbeat, whispers, cursor, reveals, skill orb
js/scene.js     three.js scene + post-processing (ES module via CDN import map)
profile.jpg
```

No build step. Run locally with any static server, e.g. `python3 -m http.server` (ES modules don't load from `file://`).

## Deploy (GitHub Pages)

Repo → **Settings → Pages → Deploy from a branch → `main` / `(root)`**.

## Contact
[vipul26122004@gmail.com](mailto:vipul26122004@gmail.com) · [GitHub](https://github.com/VIPULCODEX) · [LinkedIn](https://linkedin.com/in/vipul-s-302734228)

*M.Tech CSE @ IIIT Una · GATE CS 2025 Qualified · Himachal Pradesh, India*
