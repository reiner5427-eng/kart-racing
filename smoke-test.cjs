const { chromium } = require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
await page.goto('http://127.0.0.1:4173');await page.waitForFunction(()=>!!window.KartRush,{timeout:60000});
await page.screenshot({path:'test-menu.png'});
await page.click('#start');await page.click('#next');if(await page.textContent('#nameError')!=='플레이어 이름을 입력해주세요.')throw Error('Empty name validation failed');
await page.fill('#name','홍길동');await page.click('#next');await page.click('[data-char="5"]');await page.screenshot({path:'test-character.png'});await page.click('#choose');await page.click('#race');await page.waitForFunction(()=>KartRush.state==='RACING');
await page.keyboard.down('w');await page.waitForTimeout(2000);await page.keyboard.down('Shift');await page.keyboard.down('a');await page.waitForTimeout(1000);const drift=await page.evaluate(()=>KartRush.racers[0]);console.log('DRIFT',drift);if(!drift.drifting||Math.abs(drift.lateralVelocity)<1)throw Error('Drift physics failed');await page.keyboard.up('a');await page.keyboard.up('Shift');await page.keyboard.up('w');await page.screenshot({path:'test-race.png'});
await page.keyboard.press('Escape');const before=await page.evaluate(()=>KartRush.elapsed);await page.waitForTimeout(300);if(before!==await page.evaluate(()=>KartRush.elapsed))throw Error('Pause timer failed');await page.click('#resume');
console.log('STATE',await page.evaluate(()=>({state:KartRush.state,racers:KartRush.racers,elapsed:KartRush.elapsed,time:KartRush.formatTime(42318)})));
await page.keyboard.press('Escape');await page.click('#quit');await page.click('#start');await page.click('#next');await page.click('#choose');await page.click('[data-mode="item"]');await page.click('#race');await page.waitForTimeout(3500);await page.screenshot({path:'test-item.png'});
await page.goto('file:///'+process.cwd().replaceAll('\\','/')+'/index.html');await page.waitForFunction(()=>window.KartRush?.state==='MENU');console.log('FILE URL PASS');console.log('ERRORS',errors);if(errors.length)throw Error(errors.join('\n'));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
