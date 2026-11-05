// The navigation bar at the top of every page. Each page loads this with
//   <script type="module" src="./src/nav.js"></script>
// It uses the colour and font variables every page already defines. It's fixed to the top, and pushes
// the page's content down by its height (exposed as --nav-h for pages with fixed layouts, like the
// game). The game hides it while you're playing by putting the class "playing" on <html>.
const PAGES = [
  ["play.html", "Play"],
  ["tunes.html", "Tunes"],
  ["calibrate.html", "Calibrate"],
  ["whistle-ear.html", "Whistle Ear"],
  ["whistle-sim.html", "Whistle Sim"],
];

const CSS = `
.site-nav{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;gap:4px;
  padding:6px max(12px,env(safe-area-inset-left));height:44px;box-sizing:border-box;
  background:color-mix(in srgb,var(--bg,#0d1210) 88%,transparent);backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line,#2a332f);overflow-x:auto;overflow-y:hidden;white-space:nowrap;scrollbar-width:none}
.site-nav::-webkit-scrollbar{display:none}
.site-nav a{font:500 14px/1 var(--f-body,system-ui,sans-serif);color:var(--muted,#9aa6a0);text-decoration:none;
  padding:8px 10px;border-radius:6px;flex:none}
.site-nav a:hover{color:var(--ink,#e6ece8);background:var(--surface,#151b19)}
.site-nav a:focus-visible{outline:2px solid var(--brass,#d8a94a);outline-offset:1px}
.site-nav a[aria-current="page"]{color:var(--ink,#e6ece8);background:var(--surface,#151b19);box-shadow:inset 0 -2px 0 var(--brass,#d8a94a)}
.site-nav .home{font:800 15px/1 var(--f-display,system-ui,sans-serif);color:var(--ink,#e6ece8);letter-spacing:.02em;margin-right:8px}
.site-nav .sep{flex:none;width:1px;height:18px;background:var(--line,#2a332f);margin:0 4px}
html.playing .site-nav{display:none}
@media print{.site-nav{display:none}}
`;

function mount() {
  if (document.querySelector(".site-nav")) return;
  const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const nav = document.createElement("nav");
  nav.className = "site-nav"; nav.setAttribute("aria-label", "Site");
  const link = (href, text, cls) => {
    const a = document.createElement("a"); a.href = href; a.textContent = text;
    if (cls) a.className = cls;
    if (href === here) a.setAttribute("aria-current", "page");
    return a;
  };
  nav.append(link("index.html", "Whistle Hero", "home"));
  PAGES.forEach(([href, text], i) => {
    if (i === 3) { const s = document.createElement("span"); s.className = "sep"; s.setAttribute("aria-hidden", "true"); nav.append(s); }
    nav.append(link(href, text));
  });
  document.body.prepend(nav);

  // make room for it
  const h = nav.offsetHeight;
  document.documentElement.style.setProperty("--nav-h", h + "px");
  const pad = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  document.body.style.paddingTop = pad + h + "px";
  // keep the current page's link in view on narrow screens
  nav.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" });
}

if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
