// A tiny Chrome DevTools Protocol client: launch a headless Chrome/Edge, talk to it over its
// WebSocket, and shut it down. No dependencies — Node's built-in WebSocket and fetch.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.XRAY_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

export function findBrowser() {
  const hit = CANDIDATES.find((p) => existsSync(p));
  if (!hit) throw new Error('no Chrome or Edge found. Set XRAY_BROWSER to the browser .exe path.');
  return hit;
}

export async function launch({ timeout = 20000 } = {}) {
  const exe = findBrowser();
  const profile = mkdtempSync(join(tmpdir(), 'xray-cdp-'));
  const child = spawn(exe, [
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

  return new CDP(child, wsUrl, profile);
}

class CDP {
  constructor(child, browserWsUrl, profile) { this.child = child; this.browserWsUrl = browserWsUrl; this.profile = profile; this.id = 0; }

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
      this.pending.set(id, { resolve, reject });
      this.sock.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} timed out`)); } }, 30000);
    });
  }
  on(method, handler) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(handler); }
  close() { try { this.sock.close(); } catch { /* */ } }
}
