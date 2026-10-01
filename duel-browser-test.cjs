'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const { handleDuel } = await import('./netlify/functions/duel.mts');
  const values = new Map();
  const store = {
    async get(key) { return values.get(key) ?? null; },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && values.has(key)) return { modified: false };
      values.set(key, value);
      return { modified: true };
    },
  };
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = [];
  for (const context of [hostContext, guestContext]) {
    await context.route('**/game.js', route => {
      const source = fs.readFileSync('game.js', 'utf8');
      const marker = "setPreview();menu();$('#loading').remove();requestAnimationFrame(frame);";
      const testHook = "window.__finishDuelForTest=()=>{if(!duel)throw Error('No duel');player.lap=3;player.lapTimes=[40000,41000,42000];player.bestLap=40000;elapsed=123000;player.finishTime=elapsed;finishRace();};window.__duelInspect=()=>({x:player?.x,z:player?.z,yaw:player?.yaw,cam:camera.position.toArray(),camRotation:camera.rotation.toArray(),meshCount:raceGroup.children.length,near:player?.near,state});";
      if (!source.includes(marker)) throw Error('Game test hook marker missing');
      return route.fulfill({ contentType: 'text/javascript', body: source.replace(marker, testHook + marker) });
    });
    await context.route('**/three.min.js', route => {
      if (process.env.THREE_TEST_SCRIPT && fs.existsSync(process.env.THREE_TEST_SCRIPT))
        return route.fulfill({ path: process.env.THREE_TEST_SCRIPT, contentType: 'text/javascript' });
      return route.continue();
    });
    await context.route('**/api/duel**', async route => {
      const request = route.request();
      const response = await handleDuel(new Request(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: request.method() === 'POST' ? request.postData() : undefined,
      }), store);
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
    });
  }
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  host.on('pageerror', error => errors.push('host: ' + error.message));
  guest.on('pageerror', error => errors.push('guest: ' + error.message));
  await Promise.all([host.goto('http://127.0.0.1:4173/'), guest.goto('http://127.0.0.1:4173/')]);
  await Promise.all([host.waitForFunction(() => window.KartRush?.state === 'MENU'), guest.waitForFunction(() => window.KartRush?.state === 'MENU')]);
  await host.click('#duel');
  await host.fill('#duelName', '호스트');
  await host.click('[data-duel-char="0"]');
  await host.click('#createRoom');
  await host.waitForFunction(() => window.KartRush?.state === 'DUEL_WAIT');
  await host.screenshot({ path: 'test-duel-wait.png' });
  const code = (await host.locator('#roomCode').textContent()).trim();
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  await guest.click('#duel');
  await guest.screenshot({ path: 'test-duel-mobile-lobby.png' });
  await guest.fill('#duelName', '게스트');
  await guest.click('[data-duel-char="5"]');
  await guest.fill('#joinCode', code);
  await guest.click('#joinRoom');
  await Promise.all([
    host.waitForFunction(() => window.KartRush?.state === 'RACING', null, { timeout: 18000 }),
    guest.waitForFunction(() => window.KartRush?.state === 'RACING', null, { timeout: 18000 }),
  ]);
  assert.equal((await host.evaluate(() => KartRush.racers)).length, 2);
  assert.equal((await guest.evaluate(() => KartRush.racers)).length, 2);
  assert.equal((await host.evaluate(() => KartRush.racers[1].character)), '잠만보');
  assert.equal((await guest.evaluate(() => KartRush.racers[1].character)), '피카츄');
  await guest.screenshot({ path: 'test-duel-mobile-race.png' });
  await host.keyboard.down('w');
  const touch = await guestContext.newCDPSession(guest);
  const go = await guest.locator('[data-touch-hold="KeyW"]').boundingBox();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: go.x + go.width / 2, y: go.y + go.height / 2 }] });
  await guest.waitForFunction(() => KartRush.racers[1].speed > 2, null, { timeout: 8000 });
  await guest.waitForFunction(() => KartRush.racers[0].speed > 2, null, { timeout: 8000 });
  assert.ok((await host.evaluate(() => KartRush.racers[0].speed)) > 2);
  assert.ok((await guest.evaluate(() => KartRush.racers[0].speed)) > 2);
  await guest.screenshot({ path: 'test-duel-mobile-driving.png' });
  assert.ok((await guest.evaluate(() => window.__duelInspect().cam)).every(Number.isFinite));
  await guest.setViewportSize({ width: 844, height: 390 });
  await guest.screenshot({ path: 'test-duel-mobile-landscape.png' });
  assert.ok(await guest.locator('#duelQuit').isVisible());
  await guest.setViewportSize({ width: 390, height: 844 });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await host.evaluate(() => window.__finishDuelForTest());
  await host.waitForFunction(() => window.KartRush?.state === 'DUEL_RESULT', null, { timeout: 8000 });
  assert.match(await host.locator('#duelVerdict').textContent(), /결과 확인 중/);
  await guest.evaluate(() => window.__finishDuelForTest());
  await guest.waitForFunction(() => window.KartRush?.state === 'DUEL_RESULT', null, { timeout: 8000 });
  await host.waitForFunction(() => document.querySelector('#duelVerdict')?.textContent === 'YOU WIN!', null, { timeout: 8000 });
  await guest.waitForFunction(() => document.querySelector('#duelVerdict')?.textContent === 'RIVAL WINS', null, { timeout: 8000 });
  assert.match(await guest.locator('#duelVerdict').textContent(), /RIVAL WINS/);
  await guest.screenshot({ path: 'test-duel-mobile-result.png' });
  assert.equal(await host.locator('#record').count(), 0);
  assert.equal(await host.evaluate(() => KartRush.loadRecords().length), 0);
  assert.equal(await guest.evaluate(() => KartRush.loadRecords().length), 0);
  assert.deepEqual(errors, []);
  console.log('PASS two devices, code join, live remote kart, mobile control, finish order, no leaderboard entry');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
