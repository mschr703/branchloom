const { createServer } = require('node:http');
const { app, BrowserWindow } = require('electron');
const { electronBugReplayBrowser } = require('../dist-main/main/bug-replay.js');

async function main() {
  // Keep the app process alive between isolated replay windows, as the real UI does.
  const anchor = new BrowserWindow({ show: false });
  let fixed = false;
  let writes = 0;
  const server = createServer((_request, response) => {
    if (_request.method === 'POST') { writes++; response.end('unexpected write'); return; }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><title>Synthetic bug replay</title><button id="menu">Menu</button><button id="post">Write</button><button id="duplicate">One</button><button id="duplicate">Two</button><button id="filter">Filter</button><div style="position:relative;width:120px;height:40px"><button id="covered" style="width:120px;height:40px">Covered</button><div style="position:absolute;inset:0;background:#ddd">Overlay</div></div><script>
      let menuOpened = false;
      document.getElementById('menu').addEventListener('click', () => { menuOpened = true; });
      window.addEventListener('resize', () => { if (menuOpened && !${fixed} && innerWidth <= 500) document.getElementById('filter')?.remove(); });
      document.getElementById('post').addEventListener('click', () => { fetch('/write', { method: 'POST' }).catch(() => undefined); });</script>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Synthetic server has no port.');
    const url = `http://127.0.0.1:${address.port}/`;
    const actions = [{ kind: 'click', target: { kind: 'id', value: 'menu' } }, { kind: 'resize', width: 390, height: 844 }];
    const expected = { target: { kind: 'id', value: 'filter' }, state: 'visible' };
    const verify = async (requestUrl) => new URL(requestUrl).origin === new URL(url).origin;
    const broken = await electronBugReplayBrowser(url, 900, 700, actions, expected, verify);
    if (broken.status !== 'failed' || broken.width !== 390 || broken.height !== 844) throw new Error(`Broken case was not detected: ${JSON.stringify(broken)}`);
    const missing = await electronBugReplayBrowser(url, 900, 700, actions, { target: { kind: 'id', value: 'missing' }, state: 'hidden' }, verify);
    if (missing.status !== 'error') throw new Error(`Missing expectation was accepted: ${JSON.stringify(missing)}`);
    const write = await electronBugReplayBrowser(url, 900, 700, [{ kind: 'click', target: { kind: 'id', value: 'post' } }], { target: { kind: 'id', value: 'menu' }, state: 'visible' }, verify);
    if (write.status !== 'error' || writes !== 0) throw new Error(`Write request escaped replay guard: ${JSON.stringify(write)}; writes=${writes}`);
    const ambiguous = await electronBugReplayBrowser(url, 900, 700, [{ kind: 'click', target: { kind: 'id', value: 'duplicate' } }], { target: { kind: 'id', value: 'menu' }, state: 'visible' }, verify);
    if (ambiguous.status !== 'error') throw new Error(`Ambiguous click was accepted: ${JSON.stringify(ambiguous)}`);
    const covered = await electronBugReplayBrowser(url, 900, 700, [{ kind: 'click', target: { kind: 'id', value: 'covered' } }], { target: { kind: 'id', value: 'menu' }, state: 'visible' }, verify);
    if (covered.status !== 'error' || !covered.observed.includes('verdeckt')) throw new Error(`Covered click was accepted: ${JSON.stringify(covered)}`);
    fixed = true;
    const repaired = await electronBugReplayBrowser(url, 900, 700, actions, expected, verify);
    if (repaired.status !== 'passed') throw new Error(`Fixed case was not accepted: ${JSON.stringify(repaired)}`);
    process.stdout.write('F17_BUG_REPLAY_SMOKE_OK\n');
  } finally { await new Promise((resolve) => server.close(resolve)); anchor.destroy(); }
}

app.whenReady().then(main).then(() => app.exit(0), (reason) => {
  process.stderr.write(`${reason instanceof Error ? reason.stack : String(reason)}\n`);
  app.exit(1);
});
