/** A small, self-contained guest surface. All project data arrives through the scoped invite URL. */
export const teamReviewHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Branchloom review</title><link rel="stylesheet" href="/team-review.css"></head>
<body><main class="shell"><header class="masthead"><span class="brand">branchloom</span><span class="eyebrow">Shared review</span></header>
<div class="heading"><div><p class="kicker">Snapshot review</p><h1 id="scenario">Loading review…</h1><p id="source" class="source"></p></div><span id="room-state" class="room-state"></span></div>
<p id="notice" class="notice" role="status" aria-live="polite"></p>
<div class="workspace"><section class="preview" aria-label="Reviewed screenshot"><div id="image-stage" class="image-stage"><img id="review-image" tabindex="0" role="button" aria-label="Select a point on the saved QA screenshot" alt="Saved QA screenshot for this review"><div id="markers" class="markers" aria-hidden="true"></div><div id="pin" class="pin" aria-hidden="true"></div></div><p class="caption">Click the screenshot to choose a point, or use Enter and the arrow keys. Both reviewers see this same saved image, identified by its checksum.</p></section>
<aside class="discussion"><div class="discussion-head"><h2>Comments</h2><span id="comment-count">0</span></div><ol id="comments" class="comments"></ol>
<form id="comment-form"><label for="comment-body">Comment at the selected point</label><textarea id="comment-body" rows="3" maxlength="2000" required placeholder="What should change here?"></textarea><div class="form-actions"><span id="point-label">Select a point on the image</span><button type="submit" id="send-comment" disabled>Add comment</button></div></form>
<button type="button" id="retry-comment" class="retry" hidden>Retry the same comment</button></aside></div>
<footer>Review comments do not start an agent or approve a merge. The Git checkout observation does not prove which files the dev server served.</footer></main>
<script src="/team-review.js" defer></script></body></html>`;

export const teamReviewCss = `:root{color-scheme:light;font-family:Segoe UI,Arial,sans-serif;background:#f7f6f3;color:#252827}*{box-sizing:border-box}body{margin:0}.shell{max-width:1500px;margin:auto;padding:0 28px 32px}.masthead{height:62px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dcdedb}.brand{font-size:17px;font-weight:700;letter-spacing:-.045em}.eyebrow,.kicker{font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:#737a78}.heading{display:flex;justify-content:space-between;gap:16px;align-items:center;margin:25px 0 18px}.heading h1{font-size:23px;font-weight:600;letter-spacing:-.035em;margin:4px 0 8px}.kicker{margin:0}.source{font-size:12px;color:#666d6b;margin:0}.room-state{font-size:12px;color:#666d6b}.notice{min-height:18px;margin:0 0 12px;font-size:12px;color:#9c5a40}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:22px}.preview{min-width:0}.image-stage{position:relative;border:1px solid #d8dcd9;background:#fff;min-height:120px}.image-stage img{display:block;width:100%;height:auto}.markers{position:absolute;inset:0;pointer-events:none}.marker,.pin{position:absolute;width:17px;height:17px;border-radius:50%;border:2px solid #fff;background:#4d78a4;box-shadow:0 1px 5px #283c4b66;transform:translate(-50%,-50%)}.marker{display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700}.pin{display:none;background:#bd8052}.caption{font-size:11px;line-height:1.5;color:#707674;margin:10px 0}.discussion{border-top:1px solid #d8dcd9;min-width:0}.discussion-head{display:flex;align-items:center;justify-content:space-between;padding:12px 0}.discussion h2{margin:0;font-size:14px;font-weight:600}.discussion-head span{font-size:11px;color:#737a78}.comments{list-style:none;margin:0;padding:0;max-height:46vh;overflow:auto;border-bottom:1px solid #d8dcd9}.comments li{padding:12px 2px;border-top:1px solid #e4e6e3;font-size:12px;line-height:1.5}.comments li strong{display:block;font-size:11px;margin-bottom:3px}.comments li p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.comments li small{display:block;color:#737a78;margin-top:4px}.discussion form{padding-top:16px}.discussion label{display:block;font-size:12px;font-weight:600;margin-bottom:7px}.discussion textarea{display:block;width:100%;min-height:86px;padding:10px;border:1px solid #cbd0cb;border-radius:4px;background:#fff;color:#252827;font:inherit;font-size:12px;resize:vertical}.discussion textarea:focus-visible,button:focus-visible{outline:2px solid #4d78a4;outline-offset:2px}.form-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}.form-actions span{font-size:11px;color:#737a78}.discussion button{border:1px solid #343d3a;border-radius:4px;background:#343d3a;color:#fff;padding:7px 10px;font:inherit;font-size:11px;cursor:pointer}.discussion button:disabled{opacity:.45;cursor:default}.discussion .retry{margin-top:10px;background:transparent;color:#343d3a}footer{border-top:1px solid #dcdedb;margin-top:30px;padding-top:13px;color:#707674;font-size:11px;line-height:1.5}@media(max-width:760px){.shell{padding:0 14px 24px}.workspace{grid-template-columns:1fr}.heading h1{font-size:19px}.discussion{padding-top:7px}.comments{max-height:280px}}`;

export const teamReviewJs = `(() => {
  'use strict';
  const secret = location.pathname.split('/')[2] || '';
  const endpoint = '/api/r/' + encodeURIComponent(secret);
  const scenario = document.getElementById('scenario');
  const source = document.getElementById('source');
  const state = document.getElementById('room-state');
  const notice = document.getElementById('notice');
  const image = document.getElementById('review-image');
  const markers = document.getElementById('markers');
  const pin = document.getElementById('pin');
  const comments = document.getElementById('comments');
  const count = document.getElementById('comment-count');
  const form = document.getElementById('comment-form');
  const body = document.getElementById('comment-body');
  const pointLabel = document.getElementById('point-label');
  const send = document.getElementById('send-comment');
  const retry = document.getElementById('retry-comment');
  let selected = null;
  let room = null;
  let busy = false;
  const pendingKey = 'branchloom-review-pending-' + secret;

  async function getJson(path, options) {
    const response = await fetch(path, options);
    const value = await response.json();
    if (!response.ok) {
      const error = new Error(value.error || 'Review request failed.');
      error.status = response.status;
      throw error;
    }
    return value;
  }
  function showComments(items) {
    comments.replaceChildren();
    markers.replaceChildren();
    count.textContent = String(items.length);
    items.forEach((item, index) => {
      const marker = document.createElement('span');
      marker.className = 'marker';
      marker.style.left = (item.x * 100) + '%';
      marker.style.top = (item.y * 100) + '%';
      marker.textContent = String(index + 1);
      markers.append(marker);
      const row = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = item.displayName;
      const text = document.createElement('p');
      text.textContent = item.body;
      const time = document.createElement('small');
      time.textContent = new Date(item.createdAt).toLocaleString();
      row.append(name, text, time);
      comments.append(row);
    });
  }
  async function refresh() {
    try {
      const value = await getJson(endpoint);
      room = value.room;
      scenario.textContent = room.scenario;
      const observation = room.checkoutObservation;
      source.textContent = observation && observation.endHead ? 'Checkout observed: ' + observation.endHead.slice(0, 12) + ' · Image: ' + room.imageSha256.slice(0, 12)
        : 'Checkout version unavailable · Image: ' + room.imageSha256.slice(0, 12);
      state.textContent = room.closedAt ? 'Closed · read only' : 'Open for review';
      if (image.getAttribute('src') !== endpoint + '/image') image.src = endpoint + '/image';
      showComments(value.comments);
      send.disabled = !selected || !!room.closedAt || busy;
      body.disabled = !!room.closedAt;
      notice.textContent = '';
    } catch (error) {
      notice.textContent = error.message || String(error);
      if (error.status === 403) {
        room = null;
        image.removeAttribute('src');
        showComments([]);
        state.textContent = 'Invitation unavailable';
        send.disabled = true;
        body.disabled = true;
        retry.hidden = true;
      }
    }
  }
  function choosePoint(x, y) {
    if (!room || room.closedAt) return;
    selected = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    pin.style.left = (selected.x * 100) + '%';
    pin.style.top = (selected.y * 100) + '%';
    pin.style.display = 'block';
    pointLabel.textContent = 'Point selected';
    send.disabled = busy;
  }
  image.addEventListener('click', (event) => {
    const rect = image.getBoundingClientRect();
    choosePoint((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  });
  image.addEventListener('keydown', (event) => {
    const position = selected || { x: 0.5, y: 0.5 };
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choosePoint(position.x, position.y); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); choosePoint(position.x - 0.05, position.y); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); choosePoint(position.x + 0.05, position.y); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); choosePoint(position.x, position.y - 0.05); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); choosePoint(position.x, position.y + 0.05); }
  });
  async function submitPending(payload) {
    if (busy) return;
    busy = true; send.disabled = true; retry.hidden = true;
    try {
      await getJson(endpoint + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      sessionStorage.removeItem(pendingKey);
      body.value = ''; selected = null; pin.style.display = 'none'; pointLabel.textContent = 'Select a point on the image';
      await refresh();
    } catch (error) {
      notice.textContent = error.message || String(error);
      retry.hidden = false;
    } finally { busy = false; send.disabled = !selected || !!(room && room.closedAt); }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!selected || !body.value.trim() || !room || room.closedAt || busy) return;
    const payload = { clientMutationId: crypto.randomUUID(), body: body.value.trim(), x: selected.x, y: selected.y };
    sessionStorage.setItem(pendingKey, JSON.stringify(payload));
    void submitPending(payload);
  });
  retry.addEventListener('click', () => { const pending = sessionStorage.getItem(pendingKey); if (pending) void submitPending(JSON.parse(pending)); });
  window.addEventListener('online', () => { const pending = sessionStorage.getItem(pendingKey); if (pending) void submitPending(JSON.parse(pending)); else void refresh(); });
  const pending = sessionStorage.getItem(pendingKey);
  if (pending) { retry.hidden = false; notice.textContent = 'A comment was not confirmed. Retry sends the same request ID.'; }
  void refresh();
  setInterval(() => { if (navigator.onLine && !document.hidden) void refresh(); }, 5000);
})();`;
