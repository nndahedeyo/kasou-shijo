// 画面を人と同じように操作して、開設→注文→まとめて約定→残高の変化を確かめる。使い方: node tests/app.e2e.js 400
const { chromium } = require('playwright');
const path = require('path');
const W = parseInt(process.argv[2] || '400');
(async () => {
  const b = await chromium.launch(); const errs = []; const log = [];
  const p = await (await b.newContext({viewport: {width: W, height: 860}})).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.routeWebSocket(/^wss:\/\//, ws => { ws.onMessage(() => {}); });   // 本物の中継には何も出さない（テストの名前を本番で取らない）
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  const check = (l, c) => { if (!c) process.exitCode = 1; log.push((c ? 'OK  ' : 'NG  ') + l); };
  const bal = async () => p.evaluate(() => JSON.parse(localStorage.getItem('kasou-shijo.v1')).bal);
  await p.fill('#nm', 'X'); await p.click('[data-act=open]');
  check('名前の形が違うと開設しない', !(await p.$('#b-eth')));
  await p.fill('#nm', 'nnda'); await p.click('[data-act=open]'); await p.waitForSelector('#b-eth');
  check('開設して配布を受け取る', (await p.textContent('#b-eth')).startsWith('2.'));
  const b0 = await bal();
  // 高めの値段で買う（必ず約定するように）
  await p.fill('#qty', '0.2'); await p.click('details.adv summary'); await p.fill('#px', '3600'); await p.click('[data-act=review]');
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
  await p.fill('#qty', '999'); await p.click('details.adv summary'); await p.fill('#px', '3000'); await p.click('[data-act=review]');
  check('足りないときは止める', (await p.textContent('[data-flash]')).includes('足りません'));
  await p.click('[data-act=how]'); await p.waitForTimeout(350);
  check('しくみの画面が開く', (await p.textContent('#pbody h2')) === 'しくみ');
  const sc = await p.evaluate(() => { const b = document.querySelector('.panel .body'); b.scrollTop = 9999; return {top: b.scrollTop, can: b.scrollHeight > b.clientHeight}; });
  check('しくみは最後までスクロールできる', !sc.can || sc.top > 0);
  await p.evaluate(() => window.__clearNow());
  check('まとめが来ても、開いている画面は閉じない', await p.evaluate(() => document.getElementById('panel').classList.contains('on')));
  await p.evaluate(() => { const el = document.getElementById('panel'); const mk = (type, x) => { const t = new Touch({identifier: 1, target: el, clientX: x, clientY: 300}); el.dispatchEvent(new TouchEvent(type, {touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true})); };
    mk('touchstart', 40); mk('touchmove', 90); mk('touchmove', 200); mk('touchend', 200); });
  await p.waitForTimeout(400);
  check('横に払うと戻る', !(await p.evaluate(() => document.getElementById('panel').classList.contains('on'))));
  await p.fill('#qty', '0.37'); await p.evaluate(() => window.__clearNow());
  check('まとめが来ても、入力中の量は消えない', (await p.inputValue('#qty')) === '0.37');
  check('数字のカウントダウンを出さない', !(await p.textContent('#main')).includes('秒'));
  check('横にはみ出さない', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  if (W === 400) await p.screenshot({path: '/tmp/claude-0/-home-claude/5e021df8-936d-57ea-b411-4aa434b57390/scratchpad/shijo/app400.png', fullPage: true});
  console.log(log.join('\n')); console.log('errors', JSON.stringify(errs)); if (errs.length) process.exitCode = 1;
  await b.close();
})();
