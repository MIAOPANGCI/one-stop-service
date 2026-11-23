import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8080';
const DBG = 'http://127.0.0.1:9250';
const ts = await (await fetch(DBG + '/json/list')).json();
const page = ts.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async e => { try { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; } catch (err) { return undefined; } };
const wait = ms => new Promise(r => setTimeout(r, ms));

await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE + '/login.html' });
await wait(2500);
await ev(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'}),cache:'no-store'}).then(r=>r.status)`);
await wait(700);
await send('Page.navigate', { url: BASE + '/' });
await wait(4000);

await ev(`document.querySelector('#settingsBtn').click(); 1`);
await wait(700);
await ev(`document.querySelector('#checkUpdateBtn').click(); 1`);
await wait(8000);
console.log('发现:', await ev(`(function(){var b=document.querySelector('#updBox');return b.className+' | '+b.textContent.slice(0,40)})()`));
console.log('按钮:', await ev(`!!document.querySelector('#doUpdateBtn')`));

await ev(`document.querySelector('#doUpdateBtn').click(); 1`);
await wait(900);
await ev(`document.querySelector('#confirmOk').click(); 1`);
console.log('已点确认，等待更新…');
ws.close();
