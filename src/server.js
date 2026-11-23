require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const { translateAll } = require('./translate');

const app  = express();
const PORT = process.env.PORT ?? 3000;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_API = 'https://api.line.me/v2/bot';
function getToken() { return process.env.LINE_CHANNEL_ACCESS_TOKEN; }

function getBangkokTime() {
  return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

const stats = { startTime: Date.now(), thKr: 0, toTh: 0, fail: 0, lastAt: null, events: [], recent: [] };

function recordEvent(type, preview) {
  const now = Date.now();
  stats.events = stats.events.filter(t => t >= now - 3600000);
  stats.events.push(now);
  stats.recent.unshift({ t: now, type, preview: String(preview||'').slice(0,50) });
  if (stats.recent.length > 30) stats.recent.pop();
}

async function initAccessToken() {
  const id = process.env.LINE_CHANNEL_ID, sec = process.env.LINE_CHANNEL_SECRET;
  if (!id || !sec) return;
  try {
    const body = 'grant_type=client_credentials&client_id='+encodeURIComponent(id)+'&client_secret='+encodeURIComponent(sec);
    const res = await axios.post('https://api.line.me/v2/oauth/accessToken', body,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = res.data.access_token;
    const exp = res.data.expires_in ?? 2592000;
    console.log('[LINE] Token issued (expires '+exp+'s)');
    setTimeout(initAccessToken, Math.min(Math.max((exp-600)*1000, 300000), 86400000));
  } catch (err) {
    console.error('[LINE] Token init failed:', err.response?.data ?? err.message);
  }
}

function verifySignature(rawBody, sig) {
  const hmac = crypto.createHmac('SHA256', CHANNEL_SECRET);
  hmac.update(rawBody);
  return hmac.digest('base64') === sig;
}

async function replyMessages(replyToken, messages) {
  if (!replyToken || /^0+$/.test(replyToken)) throw new Error('dummy reply token');
  await axios.post(LINE_API+'/message/reply', { replyToken, messages },
    { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer '+getToken() } });
}

async function pushText(to, text) {
  try {
    await axios.post(LINE_API+'/message/push', { to, messages: [{ type: 'text', text }] },
      { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer '+getToken() } });
  } catch (err) {
    console.error('[Push] Failed:', err.response?.status, err.response?.data ?? err.message);
  }
}

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.get('/', (_req, res) => res.json({ status: 'ok', time: getBangkokTime() }));

app.get('/status', (_req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const now = Date.now();
  const minutely = [];
  for (let i=29; i>=0; i--) {
    const s=now-(i+1)*60000, e=now-i*60000;
    minutely.push(stats.events.filter(t => t>=s && t<e).length);
  }
  res.json({
    alive: true,
    uptimeSec: Math.floor((now-stats.startTime)/1000),
    bangkokTime: getBangkokTime(),
    translate: { thKr: stats.thKr, toTh: stats.toTh, fail: stats.fail,
      secsSinceLast: stats.lastAt ? Math.floor((now-stats.lastAt)/1000) : null },
    minutely,
    recent: stats.recent.slice(0, 20),
  });
});

app.post('/webhook', async (req, res) => {
  const sig = req.headers['x-line-signature'];
  if (!sig || !verifySignature(req.rawBody, sig)) {
    console.warn('[Webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  res.sendStatus(200);

  for (const event of (req.body.events ?? [])) {
    if (event.type !== 'message')       continue;
    if (event.message?.type !== 'text') continue;
    if (event.source?.type === 'user')  continue;

    const msgText = event.message.text?.trim();
    if (!msgText) continue;

    const groupId = event.source?.groupId ?? event.source?.roomId;
    console.log('[Webhook] src='+event.source?.type+' gid='+(groupId??'').slice(0,10));

    try {
      const result = await translateAll(msgText);
      const replies = [];
      if (result?.kr) {
        replies.push({ type: 'text', text: 'KR: '+result.kr });
        stats.thKr++; stats.lastAt = Date.now();
        recordEvent('th_kr', msgText.slice(0,40));
      } else if (result?.th) {
        replies.push({ type: 'text', text: result.th });
        stats.toTh++; stats.lastAt = Date.now();
        recordEvent('to_th', msgText.slice(0,40));
      } else {
        stats.fail++;
        recordEvent('no_trans', msgText.slice(0,30));
      }
      if (replies.length > 0) {
        try { await replyMessages(event.replyToken, replies); }
        catch { if (groupId) await pushText(groupId, replies.map(m=>m.text).join('\n')); }
      }
    } catch (err) {
      console.error('[Webhook] Error:', err.message);
    }
  }
});

function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return;
  setInterval(async () => { try { await axios.get(url); } catch {} }, 10*60*1000);
}

process.on('uncaughtException',  err => console.error('[FATAL] Uncaught:', err.message));
process.on('unhandledRejection', r   => console.error('[FATAL] Rejection:', r?.message ?? r));

initAccessToken().then(() => {
  app.listen(PORT, () => {
    console.log('\n Prime LINE Bot on port '+PORT+' | '+getBangkokTime());
    startKeepAlive();
  });
});
