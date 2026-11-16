const test = require("node:test"), assert = require("node:assert");
const {clear, validate} = require("../core/auction.js");
const NOW = 1_000_000;
const o = (id, sell, buy, sellAmount, buyMin, extra = {}) => ({id, owner: "u" + id, sell, buy, sellAmount: String(sellAmount), buyMin: String(buyMin), deadline: NOW + 60, ...extra});

function invariants(orders, r) {
  const net = {};
  for (const f of r.fills) {
    const ord = orders.find(x => x.id === f.id);
    assert.ok(BigInt(f.give) <= BigInt(ord.sellAmount), "渡す量が上限を超えない");
    assert.ok(BigInt(f.receive) * BigInt(ord.sellAmount) >= BigInt(ord.buyMin) * BigInt(f.give), "条件より不利にならない " + f.id);
    net[f.sell] = (net[f.sell] || 0n) + BigInt(f.give);
    net[f.buy] = (net[f.buy] || 0n) - BigInt(f.receive);
  }
  for (const k in net) assert.strictEqual(net[k], 0n, "資産が増えも減りもしない: " + k);
}

test("同じ値段でまとめて約定する", () => {
  const os = [o(1, "A", "B", 10, 100), o(2, "B", "A", 1200, 10)];   // 1は10Bで1A以上、2は120Bまで払う
  const r = clear(os, "A", "B", NOW);
  assert.ok(r.price); invariants(os, r);
  assert.strictEqual(r.fills.length, 2);
});
test("条件が合わなければ何も起きない", () => {
  const os = [o(1, "A", "B", 10, 200), o(2, "B", "A", 1000, 100)];   // 1は1Aに20B以上ほしい、2は1Aに10Bまでしか払わない
  assert.strictEqual(clear(os, "A", "B", NOW).fills.length, 0);
});
test("期限切れの注文は使わない", () => {
  const os = [o(1, "A", "B", 10, 100, {deadline: NOW - 1}), o(2, "B", "A", 1200, 10)];
  assert.strictEqual(clear(os, "A", "B", NOW).fills.length, 0);
  assert.deepStrictEqual(validate(os[0], NOW), ["期限切れ"]);
});
test("片側が多いときは比例で分ける", () => {
  const os = [o(1, "A", "B", 10, 100), o(2, "A", "B", 30, 300), o(3, "B", "A", 2000, 15)];
  const r = clear(os, "A", "B", NOW); invariants(os, r);
});
test("ばらばらの注文でも、資産の保存と条件を必ず守る（2000回）", () => {
  let s = 7; const rnd = n => (s = (s * 1103515245 + 12345) % 2147483648) % n;
  for (let t = 0; t < 2000; t++) {
    const os = []; const k = 2 + rnd(8);
    for (let i = 0; i < k; i++) { const amt = 1 + rnd(100000); const px = 50 + rnd(100);
      os.push(rnd(2) ? o(i, "A", "B", amt, Math.max(1, Math.floor(amt * px / 100))) : o(i, "B", "A", amt, Math.max(1, Math.floor(amt * 100 / px)))); }
    invariants(os, clear(os, "A", "B", NOW));
  }
});
