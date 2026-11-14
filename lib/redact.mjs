// Addresses often carry the thing that unlocked a request: a token, a key, a signature. A report
// should show where a request went and keep nothing that unlocked it. Adapters pass every address
// they write to disk through redactUrl.

const SECRET = /^(access_?token|id_token|refresh_token|token|api_?key|key|client_secret|secret|password|passwd|pwd|sig|signature|auth|authorization|session|sessionid|sid|code)$/i;

// The same address with the value of each secret-looking parameter replaced by "…".
export function redactUrl(address) {
  const s = String(address), q = s.indexOf('?');
  if (q < 0) return s;
  const hashAt = s.indexOf('#', q);
  const query = s.slice(q + 1, hashAt < 0 ? undefined : hashAt);
  const masked = query.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return pair;
    let name = pair.slice(0, eq);
    try { name = decodeURIComponent(name); } catch { /* keep the raw name */ }
    return SECRET.test(name) ? `${pair.slice(0, eq)}=…` : pair;
  }).join('&');
  return s.slice(0, q + 1) + masked + (hashAt < 0 ? '' : s.slice(hashAt));
}
