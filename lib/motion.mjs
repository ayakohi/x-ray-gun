// Motion capture for the web adapter: what moves on its own, what follows the pointer, and what
// scroll does to the page. Works by snapshotting every sizeable element's position and style,
// acting (wait / move the mouse / wheel-scroll like a person), snapshotting again, and diffing.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Installed in the page once. Tracks elements that are big, styled for motion, or pinned, and
// returns compact rows: [index, docTop, left, width, height, transform, opacity, filter, clipPath, position].
const INSTALL = `(() => {
  if (window.__xraySnap) return true;
  const vw = innerWidth * innerHeight, els = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width * r.height >= vw * 0.01 || cs.transform !== 'none' || cs.animationName !== 'none' || +cs.opacity < 1 || cs.position === 'sticky' || cs.position === 'fixed') els.push(el);
    if (els.length >= 1500) break;
  }
  window.__xrayTracked = els;
  const idx = new Map(els.map((e, i) => [e, i]));
  window.__xrayParent = els.map((e) => { let p = e.parentElement; while (p && !idx.has(p)) p = p.parentElement; return p ? idx.get(p) : -1; });
  window.__xraySnap = () => els.map((el, i) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return [i, Math.round(r.top + scrollY), Math.round(r.left), Math.round(r.width), Math.round(r.height), cs.transform, cs.opacity, cs.filter, cs.clipPath, cs.position];
  });
  window.__xraySel = (i) => { const el = els[i]; if (!el) return '?';
    let s = el.tagName.toLowerCase(); if (el.id && !/^w-node|[0-9a-f]{8}|^[a-z]{1,3}-?\\d{3,}/i.test(el.id)) s += '#' + el.id;
    if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
    return s; };
  return true;
})()`;

const ANIMS = `(() => (document.getAnimations ? document.getAnimations() : []).slice(0, 60).map((a) => {
  const t = a.effect && a.effect.target, timing = a.effect ? a.effect.getTiming() : {};
  let sel = '?'; if (t) { sel = t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + (typeof t.className === 'string' && t.className.trim() ? '.' + t.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''); }
  return { sel, name: a.animationName || a.transitionProperty || (a.constructor && a.constructor.name) || 'animation', duration: timing.duration, iterations: timing.iterations, easing: timing.easing, scroll: !!(a.timeline && a.timeline.constructor && /Scroll|View/.test(a.timeline.constructor.name)) };
}))()`;

const LIBS = `(() => ({ lenis: !!(window.Lenis || window.lenis || document.documentElement.classList.contains('lenis')),
  locomotive: !!(window.LocomotiveScroll || document.querySelector('[data-scroll-container]')),
  scrollTrigger: !!(window.ScrollTrigger || (window.gsap && window.gsap.plugins && window.gsap.plugins.scrollTrigger)),
  scrollSmoother: !!window.ScrollSmoother, aos: !!(window.AOS || document.querySelector('[data-aos]')),
  framer: !!document.querySelector('[data-framer-name],[data-projection-id]'), webflowIx: !!(window.Webflow && document.querySelector('[data-w-id]')),
  height: document.documentElement.scrollHeight, vh: innerHeight, scrollY }))()`;

// matrix(...) / matrix3d(...) → the parts a person can read.
function readTransform(t) {
  if (!t || t === 'none') return { tx: 0, ty: 0, s: 1, r: 0 };
  const n = t.match(/-?[\d.e]+/g)?.map(Number) || [];
  if (t.startsWith('matrix3d') && n.length >= 16) { const [a, b] = n; return { tx: n[12], ty: n[13], s: Math.hypot(a, b), r: Math.atan2(b, a) * 180 / Math.PI }; }
  if (n.length >= 6) { const [a, b, , , e, f] = n; return { tx: e, ty: f, s: Math.hypot(a, b), r: Math.atan2(b, a) * 180 / Math.PI }; }
  return { tx: 0, ty: 0, s: 1, r: 0 };
}

const r1 = (x) => Math.round(x * 10) / 10;

// What changed in one element between a list of snapshots, as words. `heights` is the page height at
// each snapshot: a step where the page grew (lazy content, accordions) shifts everything below it,
// so pinning, parallax and resizing are only judged on steps where the height held still.
function describe(rows, scrolls, heights) {
  const out = [];
  const tf = rows.map((x) => readTransform(x[5]));
  const span = (k, unit, label, min) => {
    const v = tf.map((t) => t[k]);
    const lo = Math.min(...v), hi = Math.max(...v);
    if (hi - lo >= min) out.push(`${label} ${r1(v[0])}${unit} → ${r1(v[v.length - 1])}${unit}${(lo < Math.min(v[0], v.at(-1)) || hi > Math.max(v[0], v.at(-1))) ? ` (range ${r1(lo)}–${r1(hi)})` : ''}`);
  };
  span('tx', 'px', 'slides X', 4); span('ty', 'px', 'slides Y', 4); span('s', '×', 'scales', 0.03); span('r', '°', 'rotates', 2);
  const op = rows.map((x) => +x[6]);
  if (Math.max(...op) - Math.min(...op) >= 0.05) out.push(`opacity ${r1(op[0])} → ${r1(op.at(-1))}${op[0] < 0.2 && op.at(-1) > 0.8 ? ' (fades in)' : op[0] > 0.8 && op.at(-1) < 0.2 ? ' (fades out)' : ''}`);
  const fl = new Set(rows.map((x) => x[7])); if (fl.size > 1) out.push(`filter ${rows[0][7]} → ${rows.at(-1)[7]}`);
  const cp = new Set(rows.map((x) => x[8])); if (cp.size > 1) out.push(`clip-path changes (reveal/wipe): ${String(rows[0][8]).slice(0, 50)} → ${String(rows.at(-1)[8]).slice(0, 50)}`);
  const steady = (i) => !heights || heights[i] === heights[i - 1];
  let grew = 0;
  for (let i = 1; i < rows.length; i++) if (steady(i) && (Math.abs(rows[i][3] - rows[i - 1][3]) > 8 || Math.abs(rows[i][4] - rows[i - 1][4]) > 8)) grew++;
  if (grew) out.push(`resizes ${rows[0][3]}×${rows[0][4]} → ${rows.at(-1)[3]}×${rows.at(-1)[4]}`);

  // Position against the page while scrolling: 1 = rides along with the screen (pinned), 0 = scrolls normally.
  if (scrolls && rows[0][9] !== 'fixed') {
    let pinnedSteps = 0, dDoc = 0, dS = 0;
    for (let i = 1; i < rows.length; i++) {
      const s = scrolls[i] - scrolls[i - 1], d = rows[i][1] - rows[i - 1][1];
      if (s <= 20 || !steady(i)) continue;
      if (d / s > 0.85 && d / s < 1.15) pinnedSteps++;
      else { dDoc += d; dS += s; }
    }
    if (pinnedSteps) out.push(`pinned on screen for ${pinnedSteps} scroll step${pinnedSteps > 1 ? 's' : ''}${rows[0][9] === 'sticky' ? ' (position: sticky)' : ' (by script, e.g. ScrollTrigger pin)'}`);
    else if (dS > 300 && Math.abs(dDoc / dS) > 0.05) { const ratio = dDoc / dS; out.push(`parallax: moves at ${r1(1 - ratio)}× scroll speed${ratio > 0 ? ' (slower than the page)' : ' (faster than the page)'}`); }
  }
  return out;
}

// Many copies of one thing (letters split by SplitType, a grid of cards) collapse into one line.
function group(list) {
  const out = new Map();
  for (const h of list) {
    const key = h.sel + '|' + h.what.map((w) => w.replace(/-?[\d.]+/g, '#')).join(';');
    if (out.has(key)) out.get(key).count++;
    else out.set(key, { ...h, count: 1 });
  }
  return [...out.values()];
}
const times = (h) => (h.count > 1 ? `×${h.count} ` : '');

function diff(snaps, scrolls, parent, heights) {
  const n = snaps[0].length, hits = new Map();
  for (let i = 0; i < n; i++) {
    const rows = snaps.map((s) => s[i]).filter(Boolean);
    if (rows.length < 2) continue;
    const what = describe(rows, scrolls, heights);
    if (what.length) hits.set(i, { what, area: rows[0][3] * rows[0][4], firstChange: scrolls ? scrolls[rows.findIndex((r, k) => k > 0 && JSON.stringify(r.slice(5)) !== JSON.stringify(rows[k - 1].slice(5)))] : null });
  }
  // Children ride along with a pinned, parallax or resizing parent: report the outermost one only.
  const inherited = /pinned|parallax|resizes/;
  for (const [i, h] of hits) {
    let p = parent[i];
    while (p >= 0) {
      const ph = hits.get(p);
      if (ph && h.what.every((w) => inherited.test(w)) && ph.what.some((w) => inherited.test(w))) { hits.delete(i); break; }
      p = parent[p];
    }
  }
  return [...hits.entries()].sort((a, b) => b[1].area - a[1].area);
}

export async function captureMotion(page, filesDir, opts = {}) {
  const ev = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  await ev(INSTALL);
  const parent = await ev('window.__xrayParent');
  const libs = await ev(LIBS);
  const anims = new Map();
  const noteAnims = async () => { for (const a of (await ev(ANIMS)) || []) anims.set(a.sel + a.name, a); };
  const findings = [], guesses = [], unknowns = [], files = [];
  const label = async (list) => Promise.all(list.map(async ([i, h]) => ({ ...h, sel: await ev(`window.__xraySel(${i})`) })));

  // 1. Idle: does anything move with nobody touching it?
  await noteAnims();
  const idle = [await ev('window.__xraySnap()')];
  await sleep(700); idle.push(await ev('window.__xraySnap()'));
  await sleep(700); idle.push(await ev('window.__xraySnap()'));
  for (const h of group(await label(diff(idle, null, parent).slice(0, 80))).slice(0, 12)) findings.push({ what: `moves on its own: ${times(h)}\`${h.sel}\` — ${h.what.join('; ')}`, evidence: 'idle, 1.4s, no input' });

  // 2. Pointer: sweep the mouse across the first screen.
  const vw = 1280, vh = 900, pts = [[200, 200], [1080, 220], [1060, 700], [220, 680], [640, 450]];
  const ptr = [await ev('window.__xraySnap()')];
  for (const [x, y] of pts) { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(260); ptr.push(await ev('window.__xraySnap()')); }
  const idleSet = new Set(diff(idle, null, parent).map(([i]) => i));
  // Things already animating on their own are not pointer reactions; neither are more of the same element kind.
  const idleSels = new Set((await label(diff(idle, null, parent).slice(0, 200))).map((h) => h.sel));
  for (const h of group((await label(diff(ptr, null, parent).filter(([i]) => !idleSet.has(i)).slice(0, 80))).filter((h) => !idleSels.has(h.sel))).slice(0, 12)) findings.push({ what: `follows the pointer: ${times(h)}\`${h.sel}\` — ${h.what.join('; ')}`, evidence: 'mouse swept across 5 points' });

  // 3. Scroll like a person: mouse-wheel steps, so smooth-scroll libraries react too.
  const dir = join(filesDir, 'scroll'); mkdirSync(dir, { recursive: true });
  const maxSteps = Number(opts.steps) || 16, stepPx = Math.round(vh * 0.75);
  const pageH = 'document.documentElement.scrollHeight';
  const snaps = [await ev('window.__xraySnap()')], scrolls = [await ev('scrollY')], heights = [await ev(pageH)];
  let stuck = 0, hijacked = false;
  for (let k = 1; k <= maxSteps; k++) {
    const before = await ev('scrollY');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: vw / 2, y: vh / 2, deltaX: 0, deltaY: stepPx });
    await sleep(750);
    let after = await ev('scrollY');
    if (after === before) {
      // Some libraries move a container instead of the window; others ignore synthetic wheels.
      const ok = await ev(`(() => { const y = scrollY; window.scrollBy(0, ${stepPx}); return scrollY !== y; })()`);
      if (!ok) { stuck++; if (k === 1) hijacked = true; } else { await sleep(500); after = await ev('scrollY'); }
    }
    snaps.push(await ev('window.__xraySnap()')); scrolls.push(after); heights.push(await ev(pageH));
    await noteAnims();
    try {
      const cap = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
      const f = `step-${String(k).padStart(2, '0')}-y${after}.jpg`;
      writeFileSync(join(dir, f), Buffer.from(cap.data, 'base64')); files.push(`files/scroll/${f}`);
    } catch { /* */ }
    if (stuck >= 2) break;
    if (await ev('scrollY + innerHeight >= document.documentElement.scrollHeight - 2')) break;
  }
  const grewBy = heights.at(-1) - heights[0];
  if (grewBy > 50) findings.push({ what: `the page grew ${heights[0]} → ${heights.at(-1)}px while scrolling (lazy-loaded or revealed content)`, evidence: 'scrollHeight per step' });
  for (const h of group(await label(diff(snaps, scrolls, parent, heights).filter(([i]) => !idleSet.has(i)).slice(0, 120))).slice(0, 25)) {
    findings.push({ what: `on scroll: ${times(h)}\`${h.sel}\` — ${h.what.join('; ')}${h.firstChange != null ? ` (starts near scrollY ${h.firstChange})` : ''}`, evidence: `${snaps.length - 1} wheel steps of ${stepPx}px` });
  }

  // 4. Named animations the browser knows about (CSS animations, transitions, Web Animations).
  for (const a of [...anims.values()].slice(0, 20)) {
    findings.push({ what: `animation "${a.name}" on \`${a.sel}\`: ${a.duration === 'auto' ? 'auto' : Math.round(a.duration)}ms, ${a.iterations === Infinity || a.iterations === null ? 'loops forever' : `${a.iterations}×`}, ${a.easing}${a.scroll ? ', driven by scroll (scroll-timeline)' : ''}`, evidence: 'document.getAnimations()' });
  }

  const libsOn = Object.entries(libs).filter(([k, v]) => v === true).map(([k]) => k);
  if (libsOn.length) findings.unshift({ what: `motion libraries present: ${libsOn.join(', ')}`, evidence: 'window globals / markers' });
  if (libs.scrollTrigger) guesses.push('GSAP ScrollTrigger is loaded: scroll effects are scripted. The exact trigger points and timelines are in the page scripts — grep them for "scrollTrigger" and "pin:".');
  if (libs.lenis || libs.locomotive || libs.scrollSmoother) guesses.push('A smooth-scroll library is present: the page eases scroll itself, which is why it feels buttery. Positions here were read after each step settled.');
  if (libs.webflowIx) guesses.push('Webflow Interactions are in use: animations are configured in Webflow\'s editor and run from webflow.js — elements carry data-w-id.');
  if (hijacked) unknowns.push('The page would not scroll from wheel events or scrollBy: it may use a custom scroll container. Motion during scroll was not observed.');
  unknowns.push('Snapshots are taken per step, not per frame: fast effects between steps are summarised by their start and end. Elements added after load (lazy sections) were not tracked. Hover on specific buttons is not tested — only a pointer sweep.');

  await ev('window.scrollTo(0, 0)');
  return { findings, guesses, unknowns, files, facts: { scrollSteps: snaps.length - 1, pageHeight: libs.height, motionLibraries: libsOn } };
}
