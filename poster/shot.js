const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 2384, height: 3370 }, deviceScaleFactor: process.argv[3] ? +process.argv[3] : 0.5 });
  await p.goto('file://' + __dirname + '/poster.html', { waitUntil: 'networkidle' }).catch(()=>{});
  await p.evaluate(() => document.fonts.ready);
  // 넘침 검사: 카드/단이 캔버스나 아래 블록과 겹치는지
  const info = await p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return [s, Math.round(b.top), Math.round(b.bottom)]; };
    return [r('#colL'), r('#colR'), r('#bottom'), r('#footer'), ...[...document.querySelectorAll('.card')].map((e,i)=>['card'+i, Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().bottom)])];
  });
  console.log(JSON.stringify(info));
  await p.screenshot({ path: process.argv[2] || 'preview.png' });
  await b.close();
})();
