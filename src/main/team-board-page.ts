export const teamBoardHtml = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Branchloom · Projektansicht</title><link rel="stylesheet" href="__BOARD_PATH__/style.css"><script defer src="__BOARD_PATH__/app.js"></script></head>
<body><header class="top"><div class="brand">branchloom <span>team view</span></div><div id="updated" role="status">Lade Projektstand…</div></header>
<main><div class="heading"><div><p class="eyebrow">GETEILTE PROJEKTANSICHT</p><h1 id="project">Projekt</h1><p id="summary">Keine Agenten- oder Git-Aktionen</p></div><p id="queue" class="queue"></p></div>
<div id="message" class="message" role="alert" hidden></div><div id="board" class="board" aria-label="Projektboard"></div></main>
<footer>Diese Ansicht zeigt Kartentitel und laufende Sitzungen. Karten-, Agenten- und Git-Aktionen erfolgen ausschließlich in der Branchloom-App des Hosts.</footer></body></html>`;

export const teamBoardCss = `:root{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#242725;background:#f7f7f4}
*{box-sizing:border-box}body{margin:0;min-height:100vh}.top{height:58px;padding:0 28px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #ddded9;background:#fff}
.brand{font-weight:720;letter-spacing:-.045em;font-size:19px}.brand span{font-size:12px;font-weight:500;letter-spacing:0;color:#777d78;margin-left:10px}#updated{font-size:12px;color:#66716c}
main{padding:34px 28px 42px;max-width:1500px;margin:auto}.heading{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:30px}.eyebrow{font-size:10px;font-weight:700;letter-spacing:.13em;color:#6b756f;margin:0 0 8px}
h1{font-size:30px;font-weight:620;letter-spacing:-.045em;margin:0 0 5px}#summary{font-size:13px;color:#6a716b;margin:0}.queue{font-size:12px;color:#535c55;margin:0;padding-bottom:4px}.message{padding:12px 14px;margin-bottom:18px;border-left:3px solid #bf775b;background:#fff4ef;font-size:13px}
.board{display:flex;align-items:stretch;gap:14px;overflow-x:auto;padding-bottom:18px;scrollbar-color:#bfc4be transparent;scrollbar-width:thin}.board::-webkit-scrollbar{height:8px}.board::-webkit-scrollbar-thumb{background:#bfc4be;border-radius:8px}.column{flex:1 0 220px;max-width:320px;min-height:260px;border-top:2px solid #a8aea9;padding:13px 2px}.column-head{display:flex;align-items:center;gap:8px;margin:0 5px 13px;font-size:14px;font-weight:620}.count{font-size:11px;color:#747b75;border:1px solid #d9dcd6;border-radius:99px;padding:1px 7px;font-weight:500}.card{background:#fff;border:1px solid #dedfda;border-radius:8px;padding:12px 13px;margin-bottom:8px;box-shadow:0 1px 2px #1b281908}.card-title{font-size:13px;line-height:1.4;font-weight:560;margin:0;overflow-wrap:anywhere}.card-meta{margin:8px 0 0;font-size:11px;color:#6a746d;display:flex;gap:9px;align-items:center}.live-dot{width:6px;height:6px;border-radius:50%;background:#a65442;display:inline-block;margin-right:4px}.empty{font-size:12px;color:#929891;padding:10px 5px}
.comment-action{border:0;background:transparent;color:#505b54;padding:0;margin-top:10px;font:inherit;font-size:11px;cursor:pointer}.comment-action:hover{text-decoration:underline}.comment-form{display:grid;gap:8px;margin-top:9px}.comment-form textarea{width:100%;resize:vertical;min-height:70px;max-height:180px;border:1px solid #cfd3cd;border-radius:5px;padding:8px;font:inherit;font-size:12px;color:#242725;background:#fff}.comment-form button{justify-self:start;border:1px solid #aeb7af;border-radius:5px;background:#f5f6f2;padding:5px 10px;font:inherit;font-size:11px;cursor:pointer}.comment-form button:disabled{opacity:.55;cursor:default}.comment-form .comment-status{font-size:11px;color:#875d47;margin:0}.comment-action:focus-visible,.comment-form :focus-visible{outline:2px solid #5b6b64;outline-offset:2px}
footer{border-top:1px solid #ddded9;padding:18px 28px;font-size:11px;color:#737a74}@media(max-width:650px){.top{padding:0 16px}.brand span{display:none}main{padding:25px 16px}.heading{align-items:start;flex-direction:column;gap:8px}.board{gap:10px}.column{flex-basis:250px}footer{padding:18px 16px}}`;

export const teamBoardJs = `(() => {
  const path = location.pathname.split('/');
  const secret = path[2] || '';
  const endpoint = '/api/board/' + encodeURIComponent(secret);
  const board = document.getElementById('board');
  const message = document.getElementById('message');
  let stopped = false;
  let refreshTimer;
  let latest = null;
  let openCardId = '';
  const drafts = new Map();
  const pending = new Map();
  const feedback = new Map();
  const label = { off: 'Queue aus', running: 'Queue läuft', paused: 'Queue pausiert' };
  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }
  function render(data) {
    latest = data;
    document.getElementById('project').textContent = data.projectName;
    document.getElementById('updated').textContent = 'Stand ' + new Date(data.observedAt).toLocaleTimeString('de-DE');
    document.getElementById('queue').textContent = label[data.queueState] || '';
    document.getElementById('summary').textContent = data.cards.length + ' Karten · ' + (data.canComment ? 'Kartenkommentare erlaubt' : 'Nur lesen') + ' · Keine Agenten- oder Git-Aktionen';
    board.replaceChildren();
    for (const column of data.columns) {
      const section = node('section', 'column');
      const cards = data.cards.filter((card) => card.columnId === column.id);
      const heading = node('h2', 'column-head', column.name);
      heading.append(node('span', 'count', String(cards.length)));
      section.append(heading);
      for (const card of cards) {
        const item = node('article', 'card');
        item.append(node('p', 'card-title', card.title));
        const meta = node('p', 'card-meta');
        if (card.runningSince) { const live = node('span', '', 'Agent läuft'); live.prepend(node('i', 'live-dot')); meta.append(live); }
        if (card.priority !== 'none') meta.append(node('span', '', 'Priorität ' + card.priority));
        if (meta.childNodes.length) item.append(meta);
        if (data.canComment) {
          const toggle = node('button', 'comment-action', openCardId === card.id ? 'Kommentar schließen' : 'Kommentar schreiben');
          toggle.type = 'button';
          toggle.addEventListener('click', () => { openCardId = openCardId === card.id ? '' : card.id; render(latest); if (openCardId) board.querySelector('.comment-form textarea')?.focus(); });
          item.append(toggle);
          if (openCardId === card.id) {
            const form = node('form', 'comment-form');
            const field = node('textarea'); field.maxLength = 800; field.required = true;
            field.setAttribute('aria-label', 'Kommentar zu ' + card.title);
            field.value = drafts.get(card.id) || '';
            field.addEventListener('input', () => { drafts.set(card.id, field.value); feedback.delete(card.id); });
            const send = node('button', '', 'Kommentar senden'); send.type = 'submit';
            form.append(field, send);
            if (feedback.has(card.id)) form.append(node('p', 'comment-status', feedback.get(card.id)));
            form.addEventListener('submit', (event) => { event.preventDefault(); void sendComment(card.id, field.value, send); });
            item.append(form);
          }
        }
        section.append(item);
      }
      if (!cards.length) section.append(node('p', 'empty', 'Keine Karten'));
      board.append(section);
    }
    message.hidden = !data.truncated;
    if (data.truncated) message.textContent = 'Die Ansicht ist auf 200 Karten begrenzt.';
  }
  async function sendComment(cardId, rawBody, button) {
    const body = rawBody.trim();
    if (!body || stopped) return;
    const existing = pending.get(cardId);
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const clientMutationId = existing && existing.body === body ? existing.id : Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    pending.set(cardId, { id: clientMutationId, body });
    button.disabled = true; button.textContent = 'Sende…';
    try {
      const response = await fetch(endpoint + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, body, clientMutationId }) });
      if (response.status === 403) { stopped = true; board.replaceChildren(); message.hidden = false; message.textContent = 'Dieser Kommentarzugang ist nicht mehr verfügbar.'; return; }
      if (!response.ok) throw new Error('Kommentar nicht bestätigt');
      pending.delete(cardId); drafts.delete(cardId); feedback.delete(cardId); openCardId = '';
      render(latest);
      document.getElementById('updated').textContent = 'Kommentar gesendet';
    } catch { feedback.set(cardId, 'Senden nicht bestätigt. Erneut senden verwendet dieselbe Anfrage-ID.'); render(latest); }
  }
  async function refresh() {
    if (stopped) return;
    clearTimeout(refreshTimer);
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (response.status === 403) { stopped = true; board.replaceChildren(); message.hidden = false; message.textContent = 'Dieser Einladungslink ist nicht mehr verfügbar.'; return; }
      if (!response.ok) throw new Error('Projektstand nicht erreichbar');
      render(await response.json());
    } catch { message.hidden = false; message.textContent = 'Verbindung unterbrochen. Die Ansicht versucht es erneut.'; }
    if (!stopped) refreshTimer = setTimeout(refresh, 15000);
  }
  window.addEventListener('online', refresh);
  refresh();
})();`;
