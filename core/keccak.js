// Keccak-256（イーサリアムや Base のアドレスを作るのに使う。SHA3-256 とは最後の詰め方が違う）
"use strict";
(function (root) {
  const RC = [1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n,
    0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
    0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
  const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
  const M = (1n << 64n) - 1n;
  const rotl = (x, n) => n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M;
  function f(s) {
    for (let r = 0; r < 24; r++) {
      const C = [0, 1, 2, 3, 4].map(x => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
      for (let x = 0; x < 5; x++) { const d = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) s[x + y] ^= d; }
      const B = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 25; y += 5) s[x + y] = B[x + y] ^ (~B[(x + 1) % 5 + y] & M & B[(x + 2) % 5 + y]);
      s[0] ^= RC[r];
    }
  }
  function keccak256(data) {
    const rate = 136, msg = Array.from(data); msg.push(1); while (msg.length % rate) msg.push(0); msg[msg.length - 1] |= 0x80;
    const s = new Array(25).fill(0n);
    for (let off = 0; off < msg.length; off += rate) {
      for (let i = 0; i < rate / 8; i++) { let w = 0n; for (let b = 7; b >= 0; b--) w = (w << 8n) | BigInt(msg[off + i * 8 + b]); s[i] ^= w; }
      f(s);
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++) { let w = s[i]; for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(w & 0xffn); w >>= 8n; } }
    return out;
  }
  const api = {keccak256};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Keccak = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
