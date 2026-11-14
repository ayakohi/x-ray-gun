// A tiny Chrome DevTools Protocol client: launch a headless Chrome/Edge, talk to it over its
// WebSocket, and shut it down. No dependencies — Node's built-in WebSocket and fetch.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, delimiter } from 'node:path';

// Where a browser usually lives, per platform, in the order to try. `env` and `platform` are
// arguments so the list for another platform can be read from this one.
export function browserCandidates(platform = process.platform, env = process.env) {
  const under = (root, ...rest) => (root ? join(root, ...rest) : null);
  let list;
  if (platform === 'win32') {
    const chrome = ['Google', 'Chrome', 'Application', 'chrome.exe'], edge = ['Microsoft', 'Edge', 'Application', 'msedge.exe'];
    list = [
      under(env.PROGRAMFILES, ...chrome), under(env['PROGRAMFILES(X86)'], ...chrome), under(env.LOCALAPPDATA, ...chrome),
      under(env['PROGRAMFILES(X86)'], ...edge), under(env.PROGRAMFILES, ...edge),
      'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ];
  } else if (platform === 'darwin') {
    const chrome = 'Google Chrome.app/Contents/MacOS/Google Chrome';
    list = [
      `/Applications/${chrome}`, join(homedir(), 'Applications', chrome),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ];
  } else {
    list = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/snap/bin/chromium', '/opt/google/chrome/chrome'];
  }
  // Last, the folders on PATH, for a browser installed somewhere unusual (macOS and Linux).
  if (platform !== 'win32') {
    for (const dir of (env.PATH || '').split(delimiter).filter(Boolean)) {
      for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) list.push(join(dir, name));
    }
  }
  return [env.XRAY_BROWSER, ...list].filter(Boolean);
}

const EXAMPLE = {
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/chromium',
};

export function findBrowser() {
  const hit = browserCandidates().find((p) => existsSync(p));
  if (!hit) throw new Error(`no Chrome, Chromium or Edge found. Set XRAY_BROWSER to the browser's full path, eg. ${EXAMPLE[process.platform] || EXAMPLE.linux}`);
  return hit;
}

export async function launch({ timeout = 20000 } = {}) {
  const exe = findBrowser();
  const profile = mkdtempSync(join(tmpdir(), 'xray-cdp-'));
  // Chrome refuses to start as root (containers, CI) with its sandbox on. The web adapter reports this.
  const noSandbox = process.getuid?.() === 0;
  const child = spawn(exe, [
    ...(noSandbox ? ['--no-sandbox'] : []),
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--mute-audio',
    '--window-size=1280,900', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // Chrome prints "DevTools listening on ws://..." to stderr; the port it chose is in that line.
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('browser did not report a debugging port in time')), timeout);
    child.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(to); resolve(m[0]); }
    });
    child.on('exit', (c) => { clearTimeout(to); reject(new Error(`browser exited early (code ${c})`)); });
  });

  return new CDP(child, wsUrl, profile, noSandbox);
}

class CDP {
  constructor(child, browserWsUrl, profile, noSandbox) { this.child = child; this.browserWsUrl = browserWsUrl; this.profile = profile; this.noSandbox = noSandbox; this.id = 0; }

  // Open one page target and attach to it, returning a session that speaks the page protocol.
  async newPage() {
    const base = this.browserWsUrl.replace(/^ws/, 'http').replace(/\/devtools\/browser\/.*$/, '');
    const res = await fetch(`${base}/json/new`, { method: 'PUT' }).catch(() => fetch(`${base}/json/new`));
    const target = await res.json();
    const sock = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { sock.onopen = r; sock.onerror = () => j(new Error('could not attach to page')); });
    return new Session(sock, target.id, base);
  }

  close() {
    try { this.child.kill(); } catch { /* already gone */ }
    setTimeout(() => { try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* locked */ } }, 500);
  }
}

class Session {
  constructor(sock, targetId, httpBase) {
    this.sock = sock; this.targetId = targetId; this.httpBase = httpBase;
    this.id = 0; this.pending = new Map(); this.handlers = new Map();
    sock.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).forEach((h) => h(msg.params));
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      // The timer is cleared as soon as the call settles, so a finished scan exits at once.
      const timer = setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} timed out`)); } }, 30000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.sock.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, handler) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(handler); }
  close() { try { this.sock.close(); } catch { /* */ } }
}
