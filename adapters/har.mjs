// A saved network capture (.har): every request a page or app made. Groups them by host and kind,
// surfaces APIs, and flags anything that looks like a secret sitting in a URL or header.

import { readFileSync } from 'node:fs';
import { human } from '../lib/bytes.mjs';

export default {
  name: 'har',
  about: 'a saved .har network capture: requests by host, API calls, exposed secrets',
  detect(t) {
    if (t.kind !== 'file') return 0;
    if (t.ext === '.har') return 90;
    return t.head?.toString('utf8', 0, 200).includes('"log"') && t.head.includes('"version"') ? 30 : 0;
  },
  async run(t) {
    const har = JSON.parse(readFileSync(t.path, 'utf8'));
    const entries = har.log?.entries || [];
    const byHost = {}, apis = [], secrets = [];
    const SECRET = /(api[_-]?key|token|secret|password|bearer|authorization|sig|signature)=([^&\s"]{6,})/i;

    for (const e of entries) {
      const url = e.request?.url || '';
      let host = '?';
      try { host = new URL(url).host; } catch { /* */ }
      byHost[host] = (byHost[host] || 0) + 1;
      const mime = e.response?.content?.mimeType || '';
      if (/json|graphql/.test(mime) || /\/api\/|\/graphql/.test(url)) apis.push({ what: `${e.request.method} ${url.slice(0, 140)} → ${e.response?.status} (${mime})`, evidence: `${human(e.response?.content?.size || 0)}` });
      const hay = url + ' ' + (e.request?.headers || []).map((h) => `${h.name}=${h.value}`).join(' ');
      const m = hay.match(SECRET);
      if (m) secrets.push({ what: `possible ${m[1]} in the clear: ${m[2].slice(0, 12)}…`, evidence: url.slice(0, 80) });
    }

    const hosts = Object.entries(byHost).sort((a, b) => b[1] - a[1]);
    return {
      kind: 'network capture (HAR)',
      summary: `${entries.length} requests across ${hosts.length} hosts. ${apis.length} look like API calls.`,
      facts: { requests: entries.length, hosts: hosts.length, apiCalls: apis.length },
      findings: [...apis.slice(0, 40)],
      guesses: secrets.length ? ['Secrets below are pattern matches, not proof — many are short-lived or public keys. Treat them as leads, and never paste a real one anywhere.'] : [],
      unknowns: ['A HAR is one recorded session. It shows what was called, not the server\'s full API. Response bodies are only present if the capture saved them.'],
      next: ['Replay an API call yourself to see its full response shape.'],
      inventory: hosts.slice(0, 40).map(([h, n]) => `${h}  ×${n}`),
      // secrets go in the json report but not the loud summary
      ...(secrets.length ? { secretsSeen: secrets } : {}),
    };
  },
};
