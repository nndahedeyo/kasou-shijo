// アカウントの決まりの確かめ。使い方: node --test tests/account.test.js
const test = require("node:test"), assert = require("node:assert");
const {reduce, byHandle, R, DAY} = require("../core/account.js");
const K = require("../core/keccak.js"), Sig = require("../core/sig.js");
let n = 0;
const ev = (pk, at, c) => ({id: (++n).toString(16).padStart(64, "0"), pubkey: pk, created_at: at, kind: 7720, tags: [["t", "kasou-account"]], content: JSON.stringify(c)});
const P = c => c.repeat(64);
const open = (k, h, at = 1) => ev(k, at, {t: "open", handle: h, display: h.toUpperCase(), line: "こんにちは"});

test("名前は早い者勝ち。形が違う名前・同じかぎの二重開設は数えない", () => {
  const S = reduce([open(P("a"), "nnda"), open(P("b"), "nnda", 2), open(P("c"), "X"), ev(P("a"), 3, {t: "open", handle: "other"})], 10);
  assert.deepEqual(Object.keys(S.accounts), [P("a")]);
  assert.equal(byHandle(S, "@nnda").id, P("a")); assert.equal(byHandle(S, "other"), null);
});
test("プロフィールは今のかぎだけが書き換えられる。リンクは https だけ", () => {
  const S = reduce([open(P("a"), "nnda"), ev(P("a"), 2, {t: "card", line: "個人開発", links: ["https://x.example", "javascript:alert(1)"]}), ev(P("b"), 3, {t: "card", line: "乗っ取り"})], 10);
  assert.equal(S.accounts[P("a")].line, "個人開発"); assert.deepEqual(S.accounts[P("a")].links, ["https://x.example"]);
});
test("持ち替え：今のかぎで新しいかぎに替えると、古いかぎは使えなくなる。番号と名前は変わらない", () => {
  const S = reduce([open(P("a"), "nnda"), ev(P("a"), 2, {t: "rotate", to: P("d")}), ev(P("a"), 3, {t: "card", line: "古いかぎ"}), ev(P("d"), 4, {t: "card", line: "新しいかぎ"})], 10);
  const A = S.accounts[P("a")]; assert.equal(A.key, P("d")); assert.equal(A.line, "新しいかぎ"); assert.equal(A.handle, "nnda");
});
test("取り戻し：信頼できる人の承認がそろってから3日で新しいかぎになる", () => {
  const e = [open(P("a"), "nnda"), open(P("b"), "bob"), open(P("c"), "cat"), open(P("e"), "eve"),
    ev(P("a"), 5, {t: "guard", list: [P("b"), P("c"), P("e")], need: 2}),
    ev(P("f"), 10, {t: "ask", account: P("a")}),
    ev(P("b"), 11, {t: "approve", account: P("a"), to: P("f")}),
    ev(P("9"), 12, {t: "approve", account: P("a"), to: P("f")}),            // 信頼できる人でない承認は数えない
    ev(P("c"), 13, {t: "approve", account: P("a"), to: P("f")})];
  let S = reduce(e, 13 + 2 * DAY); assert.equal(S.accounts[P("a")].key, P("a")); assert.equal(S.accounts[P("a")].recovery[P("f")].ok.length, 2);
  S = reduce(e, 13 + 3 * DAY); assert.equal(S.accounts[P("a")].key, P("f")); assert.equal(S.byKey[P("f")], P("a")); assert.equal(S.byKey[P("a")], undefined);
});
test("取り戻しの3日のあいだに、今のかぎで取り消せる（信頼した人が勝手に乗っ取れない）", () => {
  const e = [open(P("a"), "nnda"), open(P("b"), "bob"), ev(P("a"), 5, {t: "guard", list: [P("b")], need: 1}),
    ev(P("f"), 10, {t: "ask", account: P("a")}), ev(P("b"), 11, {t: "approve", account: P("a"), to: P("f")}),
    ev(P("a"), 11 + DAY, {t: "cancel", to: P("f")})];
  const S = reduce(e, 11 + 10 * DAY); assert.equal(S.accounts[P("a")].key, P("a"));
});
test("信頼できる人がいないと取り戻しは頼めない。人数より多い承認数は決められない。自分は入れられない", () => {
  const e = [open(P("a"), "nnda"), open(P("b"), "bob"), ev(P("f"), 3, {t: "ask", account: P("a")}),
    ev(P("a"), 4, {t: "guard", list: [P("b")], need: 2}), ev(P("a"), 5, {t: "guard", list: [P("a")], need: 1})];
  const S = reduce(e, 10); assert.deepEqual(S.accounts[P("a")].recovery, {}); assert.deepEqual(S.accounts[P("a")].guard.list, []);
});
test("信頼できる人がかぎを持ち替えても、承認できる", () => {
  const e = [open(P("a"), "nnda"), open(P("b"), "bob"), ev(P("a"), 3, {t: "guard", list: [P("b")], need: 1}),
    ev(P("b"), 4, {t: "rotate", to: P("7")}), ev(P("f"), 5, {t: "ask", account: P("a")}), ev(P("7"), 6, {t: "approve", account: P("a"), to: P("f")})];
  assert.equal(reduce(e, 6 + 3 * DAY).accounts[P("a")].key, P("f"));
});
test("Keccak-256 と、かぎから作るチェーンのアドレス（公式の値と一致）", () => {
  const h = b => Buffer.from(b).toString("hex");
  assert.equal(h(K.keccak256(new Uint8Array(0))), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(h(K.keccak256(Buffer.from("abc"))), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  assert.equal("0x" + h(K.keccak256(Sig.pubXY("0".repeat(63) + "1"))).slice(24), "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
  assert.equal("0x" + h(K.keccak256(Sig.pubXY("0".repeat(63) + "2"))).slice(24), "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf");
});

test("名前なしで始めて、あとから名前を決められる。決めた名前は変えられない", () => {
  const S = reduce([ev(P("a"), 1, {t: "open", display: "あおい"}), ev(P("a"), 2, {t: "name", handle: "aoi"}), ev(P("a"), 3, {t: "name", handle: "other"}), open(P("b"), "aoi", 4)], 10);
  assert.equal(S.accounts[P("a")].handle, "aoi"); assert.equal(S.accounts[P("b")], undefined); assert.equal(byHandle(S, "other"), null);
});
test("かぎを盗まれたとき：信頼できる人を替えるのは3日後。そのあいだは前の人たちで取り戻せ、全員の承認は取り消せない", () => {
  const e = [open(P("a"), "nnda"), open(P("b"), "bob"), open(P("c"), "cat"), open(P("9"), "thief"),
    ev(P("a"), 5, {t: "guard", list: [P("b"), P("c")], need: 2}),
    ev(P("a"), 10, {t: "guard", list: [P("9")], need: 1}),                        // 盗んだ人が自分の仲間に替えようとする
    ev(P("f"), 11, {t: "ask", account: P("a")}),                                   // 本人が新しい端末で取り戻しを頼む
    ev(P("b"), 12, {t: "approve", account: P("a"), to: P("f")}), ev(P("c"), 13, {t: "approve", account: P("a"), to: P("f")}),
    ev(P("a"), 14, {t: "cancel", to: P("f")})];                                    // 盗んだ人が取り消そうとする
  let S = reduce(e, 14 + DAY); assert.deepEqual(S.accounts[P("a")].guard.list, [P("b"), P("c")]); assert.ok(S.accounts[P("a")].recovery[P("f")].all);
  S = reduce(e, 13 + 3 * DAY); assert.equal(S.accounts[P("a")].key, P("f"));      // 取り戻しが先に効き、盗んだ人の替え（3日後）は効かない
  assert.deepEqual(S.accounts[P("a")].guard.list, [P("b"), P("c")]);
});
test("一部の承認だけなら、本人が取り消せる（信頼した人の一部が組んでも乗っ取れない）", () => {
  const e = [open(P("a"), "nnda"), open(P("b"), "bob"), open(P("c"), "cat"), ev(P("a"), 5, {t: "guard", list: [P("b"), P("c")], need: 1}),
    ev(P("f"), 10, {t: "ask", account: P("a")}), ev(P("b"), 11, {t: "approve", account: P("a"), to: P("f")}), ev(P("a"), 12, {t: "cancel", to: P("f")})];
  assert.equal(reduce(e, 12 + 5 * DAY).accounts[P("a")].key, P("a"));
});
test("ある時刻に、そのかぎがどのアカウントのものだったか", () => {
  const {ownerAt} = require("../core/account.js");
  const S = reduce([open(P("a"), "nnda", 1), ev(P("a"), 10, {t: "rotate", to: P("d")})], 20);
  assert.equal(ownerAt(S, P("a"), 5), P("a")); assert.equal(ownerAt(S, P("a"), 15), null); assert.equal(ownerAt(S, P("d"), 15), P("a")); assert.equal(ownerAt(S, P("d"), 5), null);
});
test("resolver：使っている間のかぎはアカウントの番号に、使われなくなったかぎは「だれでもない」に、アカウントより前は元のまま", () => {
  const {resolver} = require("../core/account.js");
  const S = reduce([open(P("a"), "nnda", 5), ev(P("a"), 6, {t: "rotate", to: P("d")})], 10), who = resolver(S);
  assert.equal(who(P("a"), 3), null);            // アカウントを開く前（相互レビューの前からの記録はそのまま）
  assert.equal(who(P("a"), 5), P("a"));
  assert.equal(who(P("d"), 7), P("a"));          // 新しいかぎも同じ人
  assert.equal(who(P("a"), 7), "retired:" + P("a"));   // 古いかぎで出したものは数えない
  assert.equal(who(P("f"), 7), null);
});
