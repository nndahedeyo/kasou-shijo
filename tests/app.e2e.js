// 画面を人と同じように操作して、開設→注文→まとめて約定→残高の変化を確かめる。使い方: node tests/app.e2e.js 400
const { chromium } = require('playwright');
const path = require('path');
const W = parseInt(process.argv[2] || '400');
(async () => {
  const b = await chromium.launch(); const errs = []; const log = [];
  const p = await (await b.newContext({viewport: {width: W, height: 860}})).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  const check = (l, c) => { if (!c) process.exitCode = 1; log.push((c ? 'OK  ' : 'NG  ') + l); };
  const bal = async () => p.evaluate(() => JSON.parse(localStorage.getItem('kasou-shijo.v1')).bal);
  await p.fill('#nm', 'X'); await p.click('[data-act=open]');
  check('名前の形が違うと開設しない', !(await p.$('#b-eth')));
  await p.fill('#nm', 'nnda'); await p.click('[data-act=open]'); await p.waitForSelector('#b-eth');
  check('開設して配布を受け取る', (await p.textContent('#b-eth')).startsWith('2.'));
  const b0 = await bal();
  // 高めの値段で買う（必ず約定するように）
  await p.fill('#qty', '0.2'); await p.fill('#px', '3600'); await p.click('[data-act=review]');
  const sheet = await p.textContent('.sheet');
  check('署名の前に、出ていくもの・入ってくるもの・期限を見せる', sheet.includes('出ていくかもしれないもの') && sheet.includes('入ってくるもの') && sheet.includes('期限'));
  check('承認や委任が含まれないと書いてある', sheet.includes('承認') && sheet.includes('委任'));
  await p.click('[data-act=sign]');
  check('注文を出しても残高は動かない', JSON.stringify(await bal()) === JSON.stringify(b0));
  for (let i = 0; i < 6; i++) { await p.evaluate(() => window.__clearNow()); const st = await p.evaluate(() => JSON.parse(localStorage.getItem('kasou-shijo.v1')).mine[0].st); if (st !== 'open') break; }
  const s = await p.evaluate(() => JSON.parse(localStorage.getItem('kasou-shijo.v1')));
  const m = s.mine[0];
  check('約定した（' + m.st + '）', m.st === 'done' || (m.filled && BigInt(m.filled) > 0n));
  const b1 = s.bal;
  const gotEth = BigInt(b1.tETH) - BigInt(b0.tETH), paid = BigInt(b0.tUSD) - BigInt(b1.tUSD);
  check('試験ETHが増え、試験ドルが減った', gotEth > 0n && paid > 0n);
  check('払った額は、条件（1ETHあたり3600ドルまで）を超えない', paid <= gotEth * 3600n + 1n);
  check('全員の値段がまとめの記録に出る', s.hist.some(h => h.price));
  await p.fill('#qty', '999'); await p.fill('#px', '3000'); await p.click('[data-act=review]');
  check('足りないときは止める', (await p.textContent('[data-flash]')).includes('足りません'));
  await p.click('[data-help="batch"]'); check('説明が開く', (await p.textContent('.sheet h2')) === 'まとめて約定'); await p.click('[data-hx]');
  check('横にはみ出さない', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  if (W === 400) await p.screenshot({path: '/tmp/claude-0/-home-claude/5e021df8-936d-57ea-b411-4aa434b57390/scratchpad/shijo/app400.png', fullPage: true});
  console.log(log.join('\n')); console.log('errors', JSON.stringify(errs)); if (errs.length) process.exitCode = 1;
  await b.close();
})();
