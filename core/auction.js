// 仮想市場 試験所：まとめて約定させる計算（バッチオークション）。チェーンに関係なく動く。
// 注文は「sell を最大 sellAmount 渡して、1あたり buyMin/sellAmount 以上の割合で buy を受け取る。deadline まで有効」。
// 数量はすべて最小単位の整数（BigInt）。端数で誰かが損をしたり、資産が増えたり消えたりしないように計算する。
"use strict";

const big = v => BigInt(v);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// 値段は「Aの1単位あたりのBの単位数」を分数 n/d で表す
const cmpP = (p, q) => cmp(p.n * q.d, q.n * p.d);

function validate(o, now) {
  const errs = [];
  for (const k of ["id", "owner", "sell", "buy", "sellAmount", "buyMin", "deadline"]) if (o[k] === undefined) errs.push(k + " がない");
  if (errs.length) return errs;
  if (o.sell === o.buy) errs.push("同じ銘柄どうし");
  if (big(o.sellAmount) <= 0n) errs.push("渡す量が0以下");
  if (big(o.buyMin) <= 0n) errs.push("受け取る量が0以下");
  if (Number(o.deadline) <= now) errs.push("期限切れ");
  return errs;
}

// A を売る注文の下限値段 = buyMin/sellAmount、B を売る注文の上限値段 = sellAmount/buyMin（どちらも B per A）
function limitOf(o, A) {
  return o.sell === A ? {n: big(o.buyMin), d: big(o.sellAmount)} : {n: big(o.sellAmount), d: big(o.buyMin)};
}

function volumes(asks, bids, p) {
  // asks: A を売る、bids: B を売る（A を買う）
  const a = asks.filter(o => cmpP(o.lim, p) <= 0), b = bids.filter(o => cmpP(o.lim, p) >= 0);
  const S = a.reduce((s, o) => s + o.amt, 0n);                 // 売りに出た A
  const D = b.reduce((s, o) => s + (o.amt * p.d) / p.n, 0n);  // B で買える A
  return {a, b, S, D, V: S < D ? S : D};
}

// 一つの組（A と B）について、全員同じ値段で約定させる
function clear(orders, A, B, now) {
  const live = orders.filter(o => !validate(o, now).length && ((o.sell === A && o.buy === B) || (o.sell === B && o.buy === A)))
    .map(o => ({o, amt: big(o.sellAmount), lim: limitOf(o, A)}));
  let asks = live.filter(x => x.o.sell === A), bids = live.filter(x => x.o.sell === B);
  for (let guard = 0; guard < 50; guard++) {
    // 候補の値段：各注文の条件の値段と、隣り合う値段のちょうど中間
    const lims = [...asks, ...bids].map(x => x.lim).sort(cmpP);
    const cands = [];
    lims.forEach((p, i) => { cands.push(p); const q = lims[i + 1]; if (q && cmpP(p, q) < 0) cands.push({n: p.n * q.d + q.n * p.d, d: 2n * p.d * q.d}); });
    // 約定する量が一番多い値段を選ぶ。同じ量の値段が並ぶときは、その真ん中（どちらか一方だけが得をしない）
    let maxV = 0n; const vs = cands.map(p => { const v = volumes(asks, bids, p); if (v.V > maxV) maxV = v.V; return {p, v}; });
    const top = vs.filter(x => x.v.V === maxV && maxV > 0n);
    const best = top.length ? top[Math.floor((top.length - 1) / 2)] : null;
    if (!best) return {price: null, fills: []};
    const res = settle(best.p, best.v);
    const bad = res.fills.find(f => !meetsLimit(f));
    if (!bad) return {price: best.p, fills: res.fills};
    // 端数のせいで条件を割る注文があれば、その注文を外してやり直す
    asks = asks.filter(x => x.o.id !== bad.id); bids = bids.filter(x => x.o.id !== bad.id);
  }
  return {price: null, fills: []};
}

function prorata(list, total, key) {
  // total を list の key の比で整数に分ける。合計がぴったり total になるよう、余りは先頭から1ずつ
  const sum = list.reduce((s, x) => s + x[key], 0n);
  const out = list.map(x => (sum === 0n ? 0n : (x[key] * total) / sum));
  let r = total - out.reduce((s, v) => s + v, 0n);
  for (let i = 0; r > 0n; i = (i + 1) % out.length) { if (out[i] < list[i][key]) { out[i] += 1n; r -= 1n; } }
  return out;
}

function settle(p, {a, b, S, D}) {
  const fills = [];
  if (S <= D) {
    // A を売る側が全部約定。B を売る側は、受け取る A を比例で分ける
    const want = b.map(x => ({...x, cap: (x.amt * p.d) / p.n}));
    const aOut = prorata(want, S, "cap");
    const bGive = aOut.map(q => (q * p.n + p.d - 1n) / p.d);          // 切り上げ（買う側が端数を払う）
    const bRecv = a.map(x => (x.amt * p.n) / p.d);                      // 切り捨て
    let surplus = bGive.reduce((s, v) => s + v, 0n) - bRecv.reduce((s, v) => s + v, 0n);
    for (let i = 0; surplus > 0n && i < bGive.length; i++) { const t = bGive[i] - (aOut[i] * p.n) / p.d; const cut = t < surplus ? t : surplus; bGive[i] -= cut; surplus -= cut; }
    a.forEach((x, i) => fills.push(fill(x, x.amt, bRecv[i])));
    b.forEach((x, i) => fills.push(fill(x, bGive[i], aOut[i])));
    if (surplus > 0n) bRecv[0] += surplus, fills[0].receive = String(bRecv[0]);
  } else {
    // B を売る側が全部約定。A を売る側は、渡す A を比例で分ける
    const aIn = b.map(x => (x.amt * p.d) / p.n);
    const T = aIn.reduce((s, v) => s + v, 0n);
    const aGive = prorata(a, T, "amt");
    const bRecv = aGive.map(q => (q * p.n) / p.d);
    let surplus = b.reduce((s, x) => s + x.amt, 0n) - bRecv.reduce((s, v) => s + v, 0n);
    // B の売り手は全量を渡し、受け取る側の切り捨てで余った B は A の売り手に先頭から返す
    for (let i = 0; surplus > 0n && i < bRecv.length; i++) { bRecv[i] += 1n; surplus -= 1n; if (i === bRecv.length - 1) i = -1; }
    a.forEach((x, i) => fills.push(fill(x, aGive[i], bRecv[i])));
    b.forEach((x, i) => fills.push(fill(x, x.amt, aIn[i])));
  }
  return {fills: fills.filter(f => f.give !== "0" || f.receive !== "0")};
}

function fill(x, give, receive) {
  return {id: x.o.id, owner: x.o.owner, sell: x.o.sell, buy: x.o.buy, give: String(give), receive: String(receive), _o: x.o};
}
function meetsLimit(f) {
  const o = f._o, g = big(f.give), r = big(f.receive);
  if (g > big(o.sellAmount) || g < 0n || r < 0n) return false;
  return r * big(o.sellAmount) >= big(o.buyMin) * g;   // 受け取り/渡し ≥ buyMin/sellAmount
}

module.exports = {clear, validate, meetsLimit};
