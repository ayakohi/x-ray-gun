// A live web page: load it in headless Chrome/Edge, then report the structure, the scripts and
// libraries, the network it touched, a screenshot — and, aimed at "how is this effect made", the
// real computed styles of the elements doing blur / glass / gradients / transforms / animation.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../lib/cdp.mjs';
import { captureMotion } from '../lib/motion.mjs';

// Runs in the page. Finds elements whose computed style uses an "effect" property, and returns the
// properties that actually make the look, deduped by the style fingerprint so 100 identical cards
// collapse to one entry.
const PROBE = `(() => {
  const EFFECT = ['backdrop-filter','-webkit-backdrop-filter','filter','mix-blend-mode','box-shadow','background-image','clip-path','mask','mask-image','transform','transition','animation','opacity','border-radius'];
  const DEFAULT = {'backdrop-filter':'none','-webkit-backdrop-filter':'none','filter':'none','mix-blend-mode':'normal','box-shadow':'none','background-image':'none','clip-path':'none','mask':'none','mask-image':'none','transform':'none','transition':'all 0s ease 0s','animation':'none 0s ease 0s 1 normal none running','opacity':'1','border-radius':'0px'};
  const INTERESTING = new Set(['backdrop-filter','-webkit-backdrop-filter','filter','mix-blend-mode','clip-path','mask','mask-image','animation']);
  const seen = new Map();
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const got = {};
    let interesting = false;
    for (const p of EFFECT) {
      const v = cs.getPropertyValue(p);
      if (v && v !== DEFAULT[p] && v !== 'none' && v !== 'normal') {
        got[p] = v.length > 200 ? v.slice(0,200)+'…' : v;
        if (INTERESTING.has(p) || (p==='background-image' && /gradient/.test(v)) || (p==='box-shadow' && v.split(',').length>1) || (p==='transform' && /matrix3d|perspective/.test(v))) interesting = true;
      }
    }
    if (!interesting || !Object.keys(got).length) continue;
    // The rest of the recipe: glass is blur + a see-through fill + an edge; gradient text needs its clip.
    const bg = cs.backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)') got['background-color'] = bg;
    const bw = cs.borderTopWidth; if (bw && bw !== '0px') got['border'] = bw + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor;
    const clip = cs.webkitBackgroundClip || cs.backgroundClip; if (clip === 'text') { got['background-clip'] = 'text'; got['-webkit-text-fill-color'] = cs.webkitTextFillColor; }
    // Group by the look, not the moment: transform and opacity drift mid-animation, so they stay
    // out of the key and only the first element's values are shown.
    const look = Object.fromEntries(Object.entries(got).filter(([p]) => p !== 'transform' && p !== 'opacity'));
    const key = el.tagName + JSON.stringify(look);
    if (seen.has(key)) { const s = seen.get(key); s.count++; if (got.transform) s.moving = true; continue; }
    const r = el.getBoundingClientRect();
    seen.set(key, { count:1, sel: el.tagName.toLowerCase()+(el.id?('#'+el.id):'')+(el.className&&typeof el.className==='string'?('.'+el.className.trim().split(/\\s+/).slice(0,2).join('.')):''), size: Math.round(r.width)+'×'+Math.round(r.height), props: got });
  }
  const list = [...seen.values()].sort((a,b)=>b.count-a.count).slice(0,40);
  // Big pictures and motion: images, videos, canvases and CSS background images covering a real
  // share of the screen. Many hero visuals are just a file, not an effect.
  const vw = innerWidth*innerHeight, visuals = [];
  for (const el of document.querySelectorAll('img,video,canvas,picture,svg,div,section')) {
    const r = el.getBoundingClientRect(); if (r.width*r.height < vw*0.08) continue;
    const cs = getComputedStyle(el);
    let src = null, kind = el.tagName.toLowerCase();
    if (kind==='img') src = el.currentSrc||el.src;
    else if (kind==='video') src = el.currentSrc||el.src||el.querySelector('source')?.src;
    else if (kind==='canvas') src = '(drawn by script)';
    else if (/url\\(/.test(cs.backgroundImage)) { src = cs.backgroundImage.match(/url\\("?([^")]+)/)?.[1]; kind += ' (css background)'; }
    if (!src) continue;
    const dup = visuals.find((v) => v.src === String(src).slice(0,200));
    if (dup) { dup.count++; continue; }
    visuals.push({ count: 1, kind, src: String(src).slice(0,200), size: Math.round(r.width)+'×'+Math.round(r.height), at: Math.round(r.left)+','+Math.round(r.top+scrollY), autoplay: el.autoplay||undefined, loop: el.loop||undefined });
    if (visuals.length>=15) break;
  }
  const fonts = [...new Set([...document.querySelectorAll('*')].slice(0,2000).map(e=>getComputedStyle(e).fontFamily).filter(Boolean))].slice(0,12);
  const counts = {}; for (const e of document.querySelectorAll('*')) counts[e.tagName]=(counts[e.tagName]||0)+1;
  return { effects:list, visuals, fonts, canvases: document.querySelectorAll('canvas').length, svgs: document.querySelectorAll('svg').length, videos: document.querySelectorAll('video').length,
    tags: Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([t,n])=>t.toLowerCase()+':'+n), title: document.title, nodes: document.querySelectorAll('*').length };
})()`;

// Runs in the page. The page's own words: headings, every link and button with where it leads
// (repeats counted), and the visible text. Cheaper to read than screenshots, and quotable exactly.
const TEXT = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const heads = [...document.querySelectorAll('h1,h2,h3')].map((h) => h.tagName.toLowerCase() + ': ' + clean(h.innerText)).filter((x) => x.length > 4).slice(0, 120);
  const acts = new Map();
  for (const el of document.querySelectorAll('a[href],button,[role="button"],input[type="submit"]')) {
    const label = clean(el.innerText || el.value || el.getAttribute('aria-label'));
    if (!label || label.length > 80) continue;
    const to = el.tagName === 'A' ? el.getAttribute('href') : '(button)';
    const key = label + ' → ' + to;
    acts.set(key, (acts.get(key) || 0) + 1);
  }
  const text = document.body ? document.body.innerText : '';
  // Rows that open on a click (closed <details>) hold words the visible text leaves out.
  const closed = [...document.querySelectorAll('details:not([open])')].slice(0, 80).map((d) => {
    const label = clean(d.querySelector('summary') ? d.querySelector('summary').textContent : '');
    return { label, inside: clean(d.textContent).slice(label.length).trim().slice(0, 1200) };
  }).filter((r) => r.inside);
  return { heads, closed, actions: [...acts.entries()].slice(0, 300), text: text.slice(0, 60000), cut: text.length > 60000, words: text.split(/\\s+/).filter(Boolean).length };
})()`;

// Runs in the page. The page itself, as a builder needs it: its base colours and fonts, then its
// sections from top to bottom with size, background and what each holds. A wrapper taller than the
// screen is opened up, so the list names the bands a person scrolls past, not one box around them.
const PAGE = `(() => {
  const clear = (c) => !c || c === 'transparent' || /rgba\\(\\s*0,\\s*0,\\s*0,\\s*0\\s*\\)/.test(c);
  const solid = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!clear(c)) return c; } return 'rgb(255, 255, 255)'; };
  // A band's colour is often painted by a child that covers it, with the band itself left clear.
  const fill = (el) => {
    if (!clear(getComputedStyle(el).backgroundColor)) return getComputedStyle(el).backgroundColor;
    const r = el.getBoundingClientRect(), area = r.width * r.height;
    let layer = [...el.children];
    for (let d = 0; d < 3 && layer.length; d++) {
      for (const c of layer) { const q = c.getBoundingClientRect(), bg = getComputedStyle(c).backgroundColor; if (!clear(bg) && q.width * q.height >= area * 0.8) return bg; }
      layer = layer.flatMap((c) => [...c.children]).slice(0, 60);
    }
    return solid(el);
  };
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const name = (el) => el.tagName.toLowerCase() + (el.id && el.id.length <= 24 ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  const b = getComputedStyle(document.body), h = document.querySelector('h1,h2'), hc = h ? getComputedStyle(h) : null;
  const base = { background: solid(document.body), text: b.color, font: b.fontFamily, size: b.fontSize, lineHeight: b.lineHeight,
    heading: hc ? { font: hc.fontFamily, weight: hc.fontWeight, size: hc.fontSize, color: hc.color } : null };
  const vw = document.documentElement.clientWidth, vh = innerHeight, out = [];
  const band = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    if (cs.position === 'fixed' && r.height >= vh * 0.9) return false;
    return r.width >= vw * 0.6 && r.height >= 24;
  };
  const visit = (el, depth) => {
    for (const c of el.children) {
      if (out.length >= 30 || !band(c)) continue;
      const r = c.getBoundingClientRect(), inner = [...c.children].filter(band);
      if (depth < 6 && (inner.length >= 2 || (inner.length === 1 && r.height > vh * 1.2))) { visit(c, depth + 1); continue; }
      const cs = getComputedStyle(c);
      const photo = /url\\(/.test(cs.backgroundImage) || [...c.querySelectorAll('img,video')].some((m) => { const q = m.getBoundingClientRect(); return q.width * q.height >= r.width * r.height * 0.5; });
      out.push({ sel: name(c), y: Math.round(r.top + scrollY), size: Math.round(r.width) + '×' + Math.round(r.height), background: fill(c), photo,
        pinned: cs.position === 'sticky' || cs.position === 'fixed', heading: clean((c.querySelector('h1,h2,h3') || {}).innerText).slice(0, 70),
        images: c.querySelectorAll('img').length, buttons: c.querySelectorAll('a.btn,button,[role="button"],input[type="submit"]').length });
    }
  };
  if (document.body) visit(document.body, 0);
  return { base, sections: out.sort((p, q) => p.y - q.y) };
})()`;

const LIBS = [['React','window.React||document.querySelector("[data-reactroot],#__next")'],['Vue','window.Vue||document.querySelector("[data-v-app],#app[data-v-]")'],['Three.js','window.THREE'],['PixiJS','window.PIXI'],['GSAP','window.gsap'],['jQuery','window.jQuery'],['Lottie','window.lottie||window.bodymovin'],['Next.js','window.__NEXT_DATA__'],['Nuxt','window.__NUXT__']];

export default {
  name: 'web',
  about: 'a live web page (an address or an .html file): its words, structure, scripts, network, screenshot, the styles behind each effect, and motion',
  detect: (t) => (t.kind === 'url' ? 100 : t.kind === 'file' && ['.html', '.htm'].includes(t.ext) ? 60 : 0),
  async run(t, ctx) {
    const address = t.url || pathToFileURL(t.path).href;
    const browser = await launch();
    const requests = [];
    try {
      const page = await browser.newPage();
      await page.send('Page.enable');
      await page.send('Network.enable');
      await page.send('Runtime.enable');
      page.on('Network.requestWillBeSent', (p) => requests.push({ url: p.request.url, type: p.type, method: p.request.method }));
      const responses = new Map();
      page.on('Network.responseReceived', (p) => responses.set(p.requestId, { status: p.response.status, mime: p.response.mimeType, url: p.response.url }));

      await page.send('Page.navigate', { url: address });
      await new Promise((r) => { const to = setTimeout(r, 8000); page.on('Page.loadEventFired', () => { clearTimeout(to); setTimeout(r, 2500); }); });

      const probe = (await page.send('Runtime.evaluate', { expression: PROBE, returnByValue: true })).result.value || {};
      const libs = [];
      for (const [name, expr] of LIBS) {
        try { if ((await page.send('Runtime.evaluate', { expression: `!!(${expr})` })).result.value) libs.push(name); } catch { /* */ }
      }

      let shot = null;
      try {
        const cap = await page.send('Page.captureScreenshot', { format: 'png' });
        shot = join(ctx.filesDir, 'screenshot.png');
        writeFileSync(shot, Buffer.from(cap.data, 'base64'));
      } catch { /* headless gpu quirk */ }

      // Motion: idle, pointer, scroll. On by default; --no-motion skips it, --steps N caps the scroll.
      let motion = { findings: [], guesses: [], unknowns: [], files: [], facts: {} };
      if (!ctx.opts['no-motion']) {
        try { motion = await captureMotion(page, ctx.filesDir, { steps: ctx.opts.steps }); }
        catch (err) { motion.unknowns.push(`Motion capture failed: ${err.message}`); }
      }

      // The words, read last so content that loads while scrolling is included.
      let words = null;
      try {
        words = (await page.send('Runtime.evaluate', { expression: TEXT, returnByValue: true })).result.value;
        writeFileSync(join(ctx.filesDir, 'text.md'), [
          `# Page text — ${probe.title || address}`, '',
          '## Headings', ...words.heads.map((h) => `- ${h}`), '',
          '## Links and buttons', ...words.actions.map(([k, n]) => `- ${k}${n > 1 ? `  ×${n}` : ''}`), '',
          ...(words.closed.length ? ['## Behind a closed row (shown after a click)', ...words.closed.map((r) => `- ${r.label} → ${r.inside}`), ''] : []),
          `## Visible text${words.cut ? ' (first 60,000 characters)' : ''}`, '', words.text,
        ].join('\n'));
      } catch { words = null; }

      // The page's base and its sections, also read last, so sections that load on scroll are in the list.
      let layout = null;
      try { layout = (await page.send('Runtime.evaluate', { expression: PAGE, returnByValue: true })).result.value; } catch { layout = null; }

      const scripts = [...responses.values()].filter((r) => /javascript/.test(r.mime)).map((r) => r.url);
      const thirdParty = [...new Set(requests.map((r) => { try { return new URL(r.url).host; } catch { return null; } }).filter(Boolean))];
      writeFileSync(join(ctx.filesDir, 'network.json'), JSON.stringify([...responses.values()], null, 2));

      const findings = [];
      findings.push({ what: `"${probe.title || '(no title)'}", ${probe.nodes} DOM nodes`, evidence: address });
      if (words) {
        findings.push({ what: `the page's words saved: ${words.words} words, ${words.heads.length} headings, ${words.actions.length} distinct links and buttons${words.closed.length ? `, ${words.closed.length} closed rows with their hidden text` : ''}`, evidence: 'files/text.md' });
      }
      if (layout?.base) {
        const p = layout.base;
        findings.push({ what: `page base: background ${p.background}, text ${p.text}, body font ${p.font} at ${p.size} (line height ${p.lineHeight})${p.heading ? `, headings ${p.heading.font} weight ${p.heading.weight} at ${p.heading.size} in ${p.heading.color}` : ''}`, evidence: 'computed style' });
      }
      (layout?.sections || []).forEach((s, i) => findings.push({
        what: `section ${i + 1}: \`${s.sel}\` at y ${s.y}, ${s.size}, background ${s.background}${s.photo ? ', filled by a photo or video' : ''}${s.pinned ? ', stays on screen while scrolling' : ''}${s.heading ? `, heading "${s.heading}"` : ''}, ${s.images} images, ${s.buttons} buttons`,
        evidence: 'DOM + layout',
      }));
      if (libs.length) findings.push({ what: `libraries live in the page: ${libs.join(', ')}`, evidence: 'window globals' });
      if (probe.canvases) findings.push({ what: `${probe.canvases} <canvas> (custom drawing / WebGL likely)`, evidence: 'DOM' });
      if (probe.svgs) findings.push({ what: `${probe.svgs} <svg>`, evidence: 'DOM' });
      if (probe.fonts?.length) findings.push({ what: `fonts: ${probe.fonts.slice(0, 6).join(' · ')}`, evidence: 'computed style' });
      for (const v of probe.visuals || []) findings.push({ what: `big visual${v.count > 1 ? ` ×${v.count}` : ''}: ${v.kind} ${v.size} at ${v.at}${v.count > 1 ? ' (first of them)' : ''}${v.autoplay ? ', autoplay' : ''}${v.loop ? ', loops' : ''} — ${v.src}`, evidence: 'DOM + layout' });

      // The headline: each distinct visual effect, as copy-pasteable CSS.
      const effects = (probe.effects || []).map((e) => ({
        what: `effect ×${e.count} on \`${e.sel}\` (${e.size})${e.moving ? ' — transform/opacity vary across copies (animated?)' : ''}\n` + Object.entries(e.props).map(([k, v]) => `    ${k}: ${v};`).join('\n'),
        evidence: 'computed style',
      }));

      const guesses = [];
      if ((probe.effects || []).some((e) => e.props['backdrop-filter'] || e.props['-webkit-backdrop-filter'])) guesses.push('The frosted-glass look is `backdrop-filter: blur()`. It blurs whatever sits behind the element — copy the exact value from the effect list.');
      if (probe.canvases && libs.includes('Three.js')) guesses.push('The moving/3D look is drawn on a canvas with Three.js, not CSS. CSS alone will not reproduce it; the logic is in the scripts.');
      if (!effects.length && probe.canvases) guesses.push('Almost nothing is styled with CSS effects; the visuals are painted on canvas. Read the scripts for the drawing code.');

      return {
        kind: 'web page (live)',
        summary: `${probe.title || address}: ${probe.nodes} nodes, ${effects.length} distinct visual effects, ${libs.join('/') || 'no known libs'}, ${thirdParty.length} hosts contacted.${shot ? ' Screenshot saved.' : ''}`,
        facts: { nodes: probe.nodes, canvases: probe.canvases, svgs: probe.svgs, scripts: scripts.length, requests: requests.length, libraries: libs, ...motion.facts },
        findings: [...findings, ...effects, ...motion.findings],
        guesses: [...guesses, ...motion.guesses],
        unknowns: ['One viewport (1280×900), no clicks or login: state behind those was not reached.', ...motion.unknowns,
          ...(browser.noSandbox ? ["The browser ran as root with its sandbox off (--no-sandbox), so the page's scripts were less contained than usual."] : [])],
        next: ['Open files/screenshot.png to confirm you measured the right page.', words ? "Read files/text.md for the page's own words and where each button leads." : null, motion.files.length ? 'Flip through files/scroll/ in order: it is the page as a filmstrip, one frame per scroll step.' : null, 'Copy an effect block straight into your CSS and tune the numbers.', `Read files/network.json for the scripts, then scan a downloaded bundle with the js adapter.`].filter(Boolean),
        inventory: [`hosts contacted: ${thirdParty.slice(0, 20).join(', ')}`, ...scripts.slice(0, 20).map((s) => `script: ${s}`)],
        files: [shot ? 'files/screenshot.png' : null, words ? 'files/text.md' : null, 'files/network.json', ...(motion.files.length ? [`files/scroll/ (${motion.files.length} frames)`] : [])].filter(Boolean),
      };
    } finally {
      browser.close();
    }
  },
};
