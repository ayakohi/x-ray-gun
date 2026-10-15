// A live web page: load it in headless Chrome/Edge, then report the structure, the scripts and
// libraries, the network it touched, a screenshot — and, aimed at "how is this effect made", the
// real computed styles of the elements doing blur / glass / gradients / transforms / animation.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../lib/cdp.mjs';

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

const LIBS = [['React','window.React||document.querySelector("[data-reactroot],#__next")'],['Vue','window.Vue||document.querySelector("[data-v-app],#app[data-v-]")'],['Three.js','window.THREE'],['PixiJS','window.PIXI'],['GSAP','window.gsap'],['jQuery','window.jQuery'],['Lottie','window.lottie||window.bodymovin'],['Next.js','window.__NEXT_DATA__'],['Nuxt','window.__NUXT__']];

export default {
  name: 'web',
  about: 'a live web page: structure, scripts, network, screenshot, and the styles behind each visual effect',
  detect: (t) => (t.kind === 'url' ? 100 : 0),
  async run(t, ctx) {
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

      await page.send('Page.navigate', { url: t.url });
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

      const scripts = [...responses.values()].filter((r) => /javascript/.test(r.mime)).map((r) => r.url);
      const thirdParty = [...new Set(requests.map((r) => { try { return new URL(r.url).host; } catch { return null; } }).filter(Boolean))];
      writeFileSync(join(ctx.filesDir, 'network.json'), JSON.stringify([...responses.values()], null, 2));

      const findings = [];
      findings.push({ what: `"${probe.title || '(no title)'}", ${probe.nodes} DOM nodes`, evidence: t.url });
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
        summary: `${probe.title || t.url}: ${probe.nodes} nodes, ${effects.length} distinct visual effects, ${libs.join('/') || 'no known libs'}, ${thirdParty.length} hosts contacted.${shot ? ' Screenshot saved.' : ''}`,
        facts: { nodes: probe.nodes, canvases: probe.canvases, svgs: probe.svgs, scripts: scripts.length, requests: requests.length, libraries: libs },
        findings: [...findings, ...effects],
        guesses,
        unknowns: ['This is one load, one viewport (1280×900), no clicks or scrolling. State behind interaction, hover, or login was not reached. Pass actions is not built yet — drive the page yourself and re-point the gun if needed.'],
        next: ['Open files/screenshot.png to confirm you measured the right page.', 'Copy an effect block straight into your CSS and tune the numbers.', `Read files/network.json for the scripts, then scan a downloaded bundle with the js adapter.`],
        inventory: [`hosts contacted: ${thirdParty.slice(0, 20).join(', ')}`, ...scripts.slice(0, 20).map((s) => `script: ${s}`)],
        files: [shot ? 'files/screenshot.png' : null, 'files/network.json'].filter(Boolean),
      };
    } finally {
      browser.close();
    }
  },
};
