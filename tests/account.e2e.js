// アカウントを、本物のパスキー（試験用の仮の認証器）と中継のまねで確かめる。使い方: node tests/account.e2e.js
// 開く → 前のアカウントで開く → 信頼できる人を決める → 別の端末で取り戻しを頼む → 承認 → 3日後に切り替わる → 本人は取り消せる
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const HTML = fs.readFileSync(path.resolve(__dirname, "..", "index.html"));
const store = [], subs = new Set();
const match = (f, e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f["#t"] || e.tags.some(t => t[0] === "t" && f["#t"].includes(t[1])));
async function relay(page) {
  await page.routeWebSocket(/^wss:\/\//, ws => { ws.onMessage(m => { const d = JSON.parse(m);
    if (d[0] === "REQ") { for (const e of store.filter(e => match(d[2], e))) ws.send(JSON.stringify(["EVENT", d[1], e])); ws.send(JSON.stringify(["EOSE", d[1]])); subs.add({ws, id: d[1], f: d[2]}); }
    if (d[0] === "EVENT") { const e = d[1]; if (!store.some(x => x.id === e.id)) { store.push(e); for (const s of subs) if (match(s.f, e)) try { s.ws.send(JSON.stringify(["EVENT", s.id, e])); } catch (x) {} } ws.send(JSON.stringify(["OK", e.id, true, ""])); } }); });
}
(async () => {
  const srv = http.createServer((q, s) => { s.setHeader("content-type", "text/html; charset=utf-8"); s.end(HTML); }).listen(8766);
  const b = await chromium.launch(); const errs = [], log = [];
  const check = (l, c) => { if (!c) process.exitCode = 1; log.push((c ? "OK  " : "NG  ") + l); };
  // 端末1台 = ブラウザの文脈1つ + 仮の認証器（パスキー・PRF つき）
  async function device(w = 400) {
    const ctx = await b.newContext({viewport: {width: w, height: 860}, locale: "ja-JP"}); const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p); await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true}});
    await relay(p); await p.goto("http://localhost:8766/"); await p.waitForTimeout(500); return p;
  }
  const open = async (p, h) => { await p.fill("#nm", h); await p.click("[data-act=open]"); await p.waitForTimeout(1200); };
  const acct = p => p.evaluate(() => { const A = __acct.AS.accounts[__acct.AS.byKey[__acct.me && __acct.me.pk]]; return A ? {id: A.id, handle: A.handle, key: A.key} : null; });
  try {
    const A = await device(), B = await device(), C = await device();
    await open(A, "alice"); await open(B, "bob"); await open(C, "cat");
    const a0 = await acct(A);
    check("パスキーでアカウントが開く", a0 && a0.handle === "alice" && (await A.textContent("#main")).includes("パスキー"));
    check("名前は早い者勝ち", await (async () => { const X = await device(); await X.waitForTimeout(800); await open(X, "alice"); const t = await X.textContent("#main"); await X.context().close(); return t.includes("もう使われています"); })());
    // 同じ端末で閉じて、前のアカウントで開く（パスキーから同じかぎが作り直される）
    await A.click("[data-act=acct]"); await A.waitForTimeout(400);
    check("アカウントの画面に、番号と試験チェーンのアドレスが出る", (await A.textContent("#pbody")).includes(a0.id) && /0x[0-9a-fA-F]{40}/.test(await A.textContent("#pbody")));
    await A.fill("#pf-l", "個人開発をしています"); await A.click("[data-act=save-card]"); await A.waitForTimeout(300);
    check("プロフィールを書き換えられる", (await A.textContent("#pbody .idcard")).includes("個人開発をしています"));
    await A.click("[data-act=forget]"); await A.waitForTimeout(300); await A.click("[data-act=reopen]"); await A.waitForTimeout(1200);
    check("前のアカウントで開くと、同じアカウントに戻る", JSON.stringify(await acct(A)) === JSON.stringify(a0));
    // 信頼できる人を決める
    await A.click("[data-act=acct]"); await A.waitForTimeout(400);
    for (const h of ["@bob", "cat"]) { await A.fill("#g-add", h); await A.click("[data-act=g-add]"); await A.waitForTimeout(150); }
    await A.fill("#g-need", "2"); await A.click("[data-act=g-save]"); await A.waitForTimeout(500);
    check("信頼できる人を2人、2人の承認で決められる", await A.evaluate(id => { const g = __acct.AS.accounts[id].guard; return g.list.length === 2 && g.need === 2; }, a0.id));
    await A.click("[data-act=back]"); await A.waitForTimeout(300);
    // 新しい端末で、かぎをなくした
    const D = await device(); await D.waitForTimeout(800);
    await D.click("[data-act=lost]"); await D.waitForTimeout(300); await D.fill("#lost-h", "@alice"); await D.click("[data-act=lost-go]"); await D.waitForTimeout(1200);
    const code = (await D.textContent(".code")).trim();
    check("新しい端末に合言葉が出る", /^[0-9A-F]{4}$/.test(code) && (await D.textContent("#main")).includes("承認 0 / 2"));
    await A.evaluate(() => __acct.tick()); await A.waitForTimeout(300);
    check("今のかぎを持つ本人に、取り戻しの頼みが知らされる", (await A.textContent("#main")).includes("取り戻す頼み"));
    for (const G of [B, C]) { await G.evaluate(() => __acct.tick()); await G.click("[data-act=acct]"); await G.waitForTimeout(400);
      check("信頼できる人に、頼みと合言葉が出る", (await G.textContent("#pbody")).includes("@alice") && (await G.textContent("#pbody")).includes(code));
      await G.click("[data-act=approve]"); await G.waitForTimeout(500); }
    await D.evaluate(() => __acct.tick()); await D.waitForTimeout(300);
    check("承認がそろうと、3日後に使えると出る", (await D.textContent("#main")).includes("日後に使えます"));
    check("3日たつまでは、まだ前のかぎのまま", (await acct(A)).key === a0.id);
    // 3日たつ
    await D.evaluate(() => { const r = Date.now; Date.now = () => r() + 3 * 86400 * 1000 + 5000; __acct.tick(); }); await D.waitForTimeout(500);
    const d1 = await acct(D);
    check("3日たつと、新しい端末で同じアカウント（同じ番号・名前）が使える", d1 && d1.id === a0.id && d1.handle === "alice" && !!(await D.$("#b-eth")));
    // 取り消し：別の取り戻しの頼みを、本人が止める
    const E = await device(); await E.waitForTimeout(800);
    await E.click("[data-act=lost]"); await E.waitForTimeout(300); await E.fill("#lost-h", "bob"); await E.click("[data-act=lost-go]"); await E.waitForTimeout(800);
    check("信頼できる人がいないアカウントは取り戻しを頼めない", (await E.textContent("#lost-msg")).includes("決められていない"));
    check("横にはみ出さない", !(await A.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    if (process.env.SHOT) { await B.click("[data-act=back]").catch(() => {}); await B.waitForTimeout(300); await B.screenshot({path: process.env.SHOT}); await B.click("[data-act=acct]"); await B.waitForTimeout(400); await B.screenshot({path: process.env.SHOT.replace(".png", "-acct.png"), fullPage: true}); }
  } catch (x) { check("途中で止まった：" + x.message.split("\n")[0], false); }
  check("画面の中でエラーが起きない", errs.length === 0);
  console.log(log.join("\n")); if (errs.length) console.log("errors", errs);
  await b.close(); srv.close();
})();
