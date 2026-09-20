# 🕷️ Vipul Sharma — Enter the Web

> An immersive **Spider-Man × Venom** themed portfolio. You swing through a procedural spider-web tunnel that starts as Spider-Man's red-and-blue web and gets slowly taken over by a black symbiote as you scroll deeper.

🔗 **Live:** https://vipulcodex.github.io/protfolio/

## What's inside

**For recruiters (the practical part)**
- **Download CV** buttons (hero, nav, contact), copy-email button and a `mailto` contact form
- **Featured projects** with tech tags and Code / Live-demo links (VipVisualize's live Hugging Face demo included), plus an **interactive concept demo** of the idea behind VipVisualize (kidney-exchange cycles)
- **Quick view** — a plain, fast, effect-free version of the whole site (toggle in the nav, or share `…/protfolio/?quick`). Suggested automatically on low-power devices; the 3D scene also drops to a lighter mode if it runs slowly
- Real semantic HTML, JSON-LD `Person` data, Open Graph / Twitter preview image

**For everyone else (the fun part)**
- **WebGL tunnel (three.js)** — a procedural web you fly through as you scroll, with chapter gates, wall-crawling spiders (red = Spider-Man, white = Venom), a spider that drops in front of you, and Venom's white eyes that follow your cursor
- **Cinematic direction** — opening title sequence, letterbox bars, a title card at every chapter ("CHAPTER 05 — PROJECTS"), bokeh, anamorphic light streak, film colour grade, handheld camera drift, and end credits
- **Symbiote takeover** — black ink creeps in from the frame edges as your "symbiote bond" rises (SPIDER-SENSE → TINGLING → BONDING → SYMBIOTE → VENOM)
- **Web-shooter** — click anywhere to fire a web
- **Terminal** — a Terminal button in the nav and hero (or press `~`); try `help`, `whoami`, `projects`, `goto contact`
- **Custom player HUD** — seek bar with chapter ticks, brightness, intensity (Calm / Spider-Sense / Venom), fullscreen, pause
- Draggable 3D skill orb, tilt/glare project cards, text scramble
- No audio

### Keyboard
`~` terminal · `Space` pause effects · `F` fullscreen · `+`/`−` brightness

### Accessibility
Contains motion and brief flashing effects — the entry gate offers a **CALM** mode (also auto-selected for `prefers-reduced-motion`). If WebGL is unavailable the site falls back to a CSS-only version with all content intact.

## Structure

```
index.html      markup + all content
css/style.css   styling
js/ui.js        gate, quick view, HUD, terminal, web-shooter, concept demo, cursor, reveals, skill orb
js/scene.js     three.js scene + post-processing (ES module via CDN import map)
assets/         profile-crop.jpg, og.png (link preview), Vipul_Sharma_CV.pdf (resume)
profile.jpg     original photo
```

No build step. Run locally with any static server, e.g. `python3 -m http.server` (ES modules don't load from `file://`).

## Deploy (GitHub Pages)

Repo → **Settings → Pages → Deploy from a branch → `main` / `(root)`**.

## Contact
[vipul26122004@gmail.com](mailto:vipul26122004@gmail.com) · [GitHub](https://github.com/VIPULCODEX) · [LinkedIn](https://linkedin.com/in/vipul-s-302734228)

*M.Tech CSE @ IIIT Una · GATE CS 2025 Qualified · Himachal Pradesh, India*

## Updating content

- **Resume:** replace `assets/Vipul_Sharma_CV.pdf` (keep the filename) — all Download CV buttons pick it up.
- **Project links:** in `index.html`, each project card has a `project-links` block; edit the `href`s there.
- **Certificates:** every card links to the LinkedIn certifications page.
