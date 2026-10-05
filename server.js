// MikroTik Gold API adapter -> Firebase Realtime Database
// Replicates the khalils.me PHP endpoints so the app works unchanged.
// No dependencies: plain Node.js >= 18 (uses built-in fetch + http).
//
// Env vars:
//   FB_DB     Firebase RTDB base URL, e.g. https://YOUR-PROJECT-default-rtdb.firebaseio.com
//   FB_AUTH   optional database secret / custom token appended as ?auth=
//   PORT      listen port (default 8080)

const http = require('http');
const crypto = require('crypto');

const FB_DB = (process.env.FB_DB || 'https://onrender-9cb03-default-rtdb.firebaseio.com').replace(/\/+$/, '');
const FB_AUTH = process.env.FB_AUTH || '';
const PORT = process.env.PORT || 8080;

if (!FB_DB) {
  console.error('Set FB_DB env var to your Firebase RTDB URL');
  process.exit(1);
}

const authQ = () => (FB_AUTH ? `?auth=${encodeURIComponent(FB_AUTH)}` : '');
const url = (p) => `${FB_DB}/${p.replace(/^\/+|\/+$/g, '')}.json${authQ()}`;
const key = (s) => String(s || '').replace(/[.#$\[\]\/]/g, '_');

async function dbGet(path) {
  const r = await fetch(url(path));
  if (!r.ok) throw new Error('RTDB GET ' + path + ': ' + r.status);
  return r.json();
}
async function dbPut(path, val) {
  const r = await fetch(url(path), { method: 'PUT', body: JSON.stringify(val) });
  if (!r.ok) throw new Error('RTDB PUT ' + path + ': ' + r.status);
  return r.json();
}
async function dbPatch(path, val) {
  const r = await fetch(url(path), { method: 'PATCH', body: JSON.stringify(val) });
  if (!r.ok) throw new Error('RTDB PATCH ' + path + ': ' + r.status);
  return r.json();
}
async function dbPush(path, val) {
  const r = await fetch(url(path), { method: 'POST', body: JSON.stringify(val) });
  if (!r.ok) throw new Error('RTDB POST ' + path + ': ' + r.status);
  return r.json();
}
async function dbDel(path) {
  const r = await fetch(url(path), { method: 'DELETE' });
  if (!r.ok) throw new Error('RTDB DELETE ' + path + ': ' + r.status);
  return r.json();
}
// find the user record under any common phone format (+967..., 00967..., 0..., bare)
async function userKey(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  const cand = [raw, digits];
  if (digits.length >= 9) {
    const last9 = digits.slice(-9);
    cand.push(last9, '+967' + last9, '967' + last9, '00967' + last9, '0' + last9);
  }
  for (const c of [...new Set(cand)]) {
    const k = key(c);
    if (await dbGet('users/' + k)) return k;
  }
  return key(raw);
}
const vals = (o) => (o ? Object.values(o) : []);
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

// ---------- request parsing ----------
function readBody(req) {
  return new Promise((res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks)));
  });
}
async function parseForm(req) {
  const body = await readBody(req);
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    const boundary = ct.split('boundary=')[1];
    const out = { _files: {} };
    for (const part of body.toString('binary').split('--' + boundary)) {
      const m = part.match(/Content-Disposition:[^\n]*name="([^"]+)"(?:[^\n]*filename="([^"]*)")?/i);
      if (!m) continue;
      const idx = part.indexOf('\r\n\r\n');
      const data = part.slice(idx + 4, part.lastIndexOf('\r\n'));
      if (m[2]) out._files[m[1]] = { filename: m[2], data };
      else out[m[1]] = data;
    }
    return out;
  }
  const out = {};
  for (const kv of body.toString().split('&')) {
    const [k, v] = kv.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
  }
  return out;
}
const J = (res, obj, code = 200) => {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(s);
};

// ---------- endpoint handlers ----------
const handlers = {
  // ============ index2.php ============
  async finduser(f, res) {
    const u = await dbGet('users/' + await userKey(f.phone));
    if (!u) return J(res, { error: true, message: 'Nothing found' });
    if (f.password && u.password && u.password !== f.password)
      return J(res, { error: true, message: 'Wrong password' });
    if (f.device_sn) {
      if (u.isbind === 1 && u.device_sn && u.device_sn !== f.device_sn)
        return J(res, { error: true, message: 'Device bound to another' });
      if (!u.device_sn) await dbPatch('users/' + await userKey(f.phone), { device_sn: f.device_sn });
    }
    J(res, { error: false, message: [u] });
  },
  async insertuser(f, res) {
    const p = await userKey(f.phone);
    if (await dbGet('users/' + p))
      return J(res, { error: true, message: 'Already exists' });
    const user = {
      id: Date.now(), phone: f.phone || '', password: f.password || '',
      device_sn: f.device_sn || '', isbind: 0, money: 0, network_allowed: 5,
      network_binded: '', network_date_changed: '', note: '', payed: 0,
      date: today(), date_end: plusDays(365), token: crypto.randomBytes(8).toString('hex'),
      reset_code: '', sn_date_change: '', ppp_methode: '', ppp_network: '', ppp_note: '', ppp_phone: '',
    };
    await dbPut('users/' + p, user);
    J(res, { error: false, message: [user] });
  },
  async resetpassword(f, res) {
    const p = await userKey(f.phone);
    const u = await dbGet('users/' + p);
    if (!u) return J(res, { error: '1', message: 'Nothing found' });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await dbPatch('users/' + p, { reset_code: code });
    J(res, { error: '0', message: code });
  },
  async getrouters(f, res) {
    const list = vals(await dbGet('routers/' + await userKey(f.phone)));
    J(res, { error: false, routers: list });
  },
  async addrouter(f, res) {
    const p = await userKey(f.phone);
    const r = {
      id: Date.now(), phone: f.phone || '', host: f.host || '',
      username: f.username || '', password: f.password || '',
      networkname: f.networkname || '', vpnusername: f.vpn || f.vpnusername || '',
      vpnpassword: f.vpnpassword || '',
    };
    await dbPut(`routers/${p}/${key(r.host || r.id)}`, r);
    J(res, { error: false, message: 'added' });
  },
  async editrouter(f, res) {
    const p = await userKey(f.phone);
    const updates = {
      host: f.host || '', username: f.username || '', password: f.password || '',
      networkname: f.networkname || '', vpnusername: f.vpnusername || '',
      vpnpassword: f.vpnpassword || '',
    };
    const list = await dbGet('routers/' + p) || {};
    for (const [k, r] of Object.entries(list))
      if (String(r.id) === String(f.id) || r.host === f.id)
        await dbPatch(`routers/${p}/${k}`, updates);
    J(res, { error: false, message: 'done' });
  },
  async removerouter(f, res) {
    const p = await userKey(f.phone);
    const list = await dbGet('routers/' + p) || {};
    for (const [k, r] of Object.entries(list))
      if (String(r.id) === String(f.id) || r.host === f.id) await dbDel(`routers/${p}/${k}`);
    J(res, { error: false, message: 'done' });
  },
  async router(f, res) { // addOrUpdateRouter (serial,phone,type,payed)
    await dbPatch('users/' + await userKey(f.phone), {
      serial: f.serial || '', router_type: f.type || '', payed: parseInt(f.payed || '0') || 0,
    });
    J(res, { error: false, message: 'ok', suspend: false });
  },
  async checkandblock(f, res) {
    const u = await dbGet('users/' + await userKey(f.phone));
    const blocked = u && u.blocked === true;
    J(res, { error: String(blocked), message: blocked ? 'blocked' : 'ok' });
  },
  async checkversion(f, res) {
    const v = (await dbGet('meta/version')) || {};
    J(res, { message: v.message || '8', url: v.url || '' });
  },
  async getpages(f, res) {
    const all = vals(await dbGet('pages/' + key(f.server || 'default')));
    const pages = f.name ? all.filter((x) => String(x.name).includes(f.name)) : all;
    J(res, { error: false, message: '', pages });
  },
  async updateonserver(f, res) { // updateOnServer -> cards
    const p = await userKey(f.phone);
    await dbPatch(`cards/${p}/${key(f.name)}`, {
      token: f.token || '', router_id: f.router_id || '', name: f.name || '',
      password: f.password || '', profile: f.profile || '', price: f.price || '',
      type: f.type || '', session_date_end: f.session_date_end || '', expired: f.expired || '',
    });
    J(res, { error: 'false', message: 'ok' });
  },
  async updateuserpppinfo(f, res) {
    await dbPatch('users/' + await userKey(f.phone), {
      ppp_methode: f.ppp_methode || '', ppp_network: f.ppp_network || '',
      ppp_note: f.ppp_note || '', ppp_phone: f.ppp_phone || '',
      password: f.password || undefined,
    });
    J(res, { error: 'false', message: 'ok' });
  },

  // ============ backup.php ============
  async backup(f, res) {
    const p = await userKey(f.phone);
    const t = (f.type || '').toLowerCase().includes('ppp') ? 'ppp' : 'hot';
    const list = vals(await dbGet(`backups/${t}/${p}`));
    J(res, list); // app expects a bare JSON array of BackupHotItem/BackupPPPItem
  },

  // ============ server.php ============
  async getcert(f, res) {
    const cert = (await dbGet('certs/' + await userKey(f.phone))) || '';
    J(res, { cert, result: cert ? 'success' : 'empty' });
  },

  // ============ mikrotik_handler.php ============
  async addnewcloud(f, res) {
    const p = await userKey(f.phone);
    const u = (await dbGet('users/' + p)) || {};
    const clouds = vals(await dbGet('clouds/' + p));
    const used = clouds.length;
    const allowed = u.network_allowed ?? 5;
    const name = f.name || '', server = f.server || '';
    const existing = clouds.find((c) => c.name === name || c.server === server);
    if (existing)
      return J(res, { error: 'false', message: 'NAT rules created for existing user', name: existing.name, network_allowed: allowed, secretComment: existing.secretComment, server: existing.server, status: 'success', usedClouds: used });
    if (used >= allowed)
      return J(res, { error: 'true', message: 'limit reached', name: '', network_allowed: allowed, secretComment: '', server: '', status: 'fail', usedClouds: used });
    const cloud = {
      name, server,
      secretComment: 'g-' + crypto.randomBytes(6).toString('hex'),
      apiPort: f.apiPort || '', wwwPort: f.wwwPort || '', winboxPort: f.winboxPort || '',
      created: today(),
    };
    await dbPush('clouds/' + p, cloud);
    J(res, { error: 'false', message: 'New cloud added successfully', name: cloud.name, network_allowed: allowed, secretComment: cloud.secretComment, server: cloud.server, status: 'success', usedClouds: used + 1 });
  },
  async gettingcloudinfo(f, res) {
    const p = await userKey(f.phone);
    const u = (await dbGet('users/' + p)) || {};
    const used = vals(await dbGet('clouds/' + p)).length;
    const allowed = u.network_allowed ?? 5;
    J(res, { network_allowed: String(allowed), remaining_clouds: String(Math.max(0, allowed - used)), used_clouds: String(used) });
  },
  async getrouterinfo(f, res) {
    const info = (await dbGet('routerinfo/' + await userKey(f.phone))) || {};
    J(res, {
      last_logged_out: info.last_logged_out || '', lookup_name: info.lookup_name || '',
      original_name: info.original_name || '', state: info.state || 'online', uptime: info.uptime || '',
    });
  },

  // ============ upload.php ============
  async getpics(f, res) {
    const list = vals(await dbGet('images/' + await userKey(f.phone)));
    J(res, { error: false, images: list });
  },
  async uploadimage(f, res) {
    const p = await userKey(f.phone);
    const file = (f._files && Object.values(f._files)[0]) || null;
    const item = {
      id: Date.now(), phone: p, name: f.name || (file && file.filename) || '',
      tags: f.tags || '', date_created: today(), checked: 0,
      image: file ? 'data:image/png;base64,' + Buffer.from(file.data, 'binary').toString('base64') : '',
    };
    await dbPush('images/' + p, item);
    J(res, { error: false, image: item.name, message: 'uploaded' });
  },

  // ============ notify.php (called by MikroTik router scripts) ============
  async notify(f, res) {
    const p = await userKey(f.iphone || f.phone || 'unknown');
    await dbPush('notify/' + p, { ...f, _files: undefined, ts: Date.now() });
    await dbPut('routerinfo/' + p, { last_logged_out: today(), state: 'online', uptime: f.uptime || '', lookup_name: f.name || '', original_name: f.name || '' });
    J(res, { ok: true });
    // forward to telegram (don't block the response)
    tgNotify(p, f).catch((e) => console.error('tg:', e.message));
  },
};

// ---------- telegram bot ----------
const TG_TOKEN = process.env.TG_TOKEN || '8964611095:AAHmlwr3795J_fwjpY02bb4lhuY9f3uLBiw';
const tgApi = (m) => `https://api.telegram.org/bot${TG_TOKEN}/${m}`;
async function tgSend(chatId, text) {
  if (!TG_TOKEN || !chatId) return;
  await fetch(tgApi('sendMessage'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4000) }),
  });
}
async function tgNotify(userK, f) {
  const t = await dbGet('telegram/' + userK);
  if (!t || !t.chat_id) return;
  const lines = ['تنبيه من الشبكة'];
  for (const [k, v] of Object.entries(f)) {
    if (k === '_files' || v === undefined || v === '') continue;
    lines.push(`${k}: ${v}`);
  }
  await tgSend(t.chat_id, lines.join('\n'));
}
async function tgPoll() {
  if (!TG_TOKEN) return;
  let offset = (await dbGet('meta/tg_offset')) || 0;
  console.log('telegram polling started');
  for (;;) {
    try {
      const r = await fetch(tgApi('getUpdates') + `?timeout=50&offset=${offset}`);
      const j = await r.json();
      for (const u of j.result || []) {
        offset = u.update_id + 1;
        const msg = u.message;
        if (!msg || !msg.chat) continue;
        const text = (msg.text || '').trim();
        const digits = text.replace(/\D/g, '');
        if (text === '/start') {
          await tgSend(msg.chat.id, 'أهلاً بك في تنبيهات ميكروتك الذهبي 🔔\nأرسل رقم حسابك في التطبيق (مثال: 784152069) لربط التنبيهات.');
        } else if (digits.length >= 7) {
          const k = await userKey(digits);
          await dbPut('telegram/' + k, { chat_id: msg.chat.id, phone: digits, linked: today() });
          await tgSend(msg.chat.id, `✅ تم ربط حسابك ${digits} بالتنبيهات بنجاح`);
        } else {
          await tgSend(msg.chat.id, 'أرسل رقم حسابك في التطبيق لربط التنبيهات.');
        }
      }
      if ((j.result || []).length) await dbPut('meta/tg_offset', offset);
    } catch (e) {
      console.error('tgPoll:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ---------- router ----------
http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const path = u.pathname.toLowerCase();
    const f = await parseForm(req);
    const op = (u.searchParams.get('op') || '').toLowerCase();
    const action = (u.searchParams.get('action') || '').toLowerCase();
    console.log(new Date().toISOString(), req.method, path, 'op=' + op, 'action=' + action, JSON.stringify({ ...f, _files: f._files ? Object.keys(f._files) : undefined }));

    let h = null;
    if (path.includes('index2.php')) {
      h = { finduser: handlers.finduser, insertuser: handlers.insertuser, insert_user: handlers.insertuser,
        adduser: handlers.insertuser, add_user: handlers.insertuser, register: handlers.insertuser,
        resetpassword: handlers.resetpassword, getrouters: handlers.getrouters, addrouter: handlers.addrouter,
        editrouter: handlers.editrouter, removerouter: handlers.removerouter, router: handlers.router,
        checkandblock: handlers.checkandblock, checkversion: handlers.checkversion, getpages: handlers.getpages,
        updateserver: handlers.updateonserver, updateuserpppinfo: handlers.updateuserpppinfo }[op]
        || handlers[op];
    } else if (path.includes('backup.php')) h = handlers.backup;
    else if (path.includes('server.php')) h = { getcert: handlers.getcert }[action] || handlers.getcert;
    else if (path.includes('mikrotik_handler.php'))
      h = { addnewcloud: handlers.addnewcloud, gettingcloudinfo: handlers.gettingcloudinfo, getrouterinfo: handlers.getrouterinfo }[action];
    else if (path.includes('upload.php'))
      h = req.method === 'POST' && !op ? handlers.uploadimage : { getpics: handlers.getpics }[op] || handlers.uploadimage;
    else if (path.includes('notify.php')) h = handlers.notify;
    else if (path === '/' || path === '/health') return J(res, { ok: true, fb: FB_DB });

    // ---- static pages the app references (WebView / images) ----
    else if (path.includes('button.png')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    } else if (path.includes('expired.php')) {
      const html = (await dbGet('pages/_static/expired')) ||
        '<!doctype html><html dir="rtl"><body style="font-family:sans-serif;padding:2em;text-align:center"><h2>انتهت صلاحية الكرت</h2><p>يرجى التواصل مع مزود الخدمة</p></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } else if (path.includes('qr.html') || path.includes('speed.html') || path.includes('openvpn')) {
      const html = (await dbGet('pages/_static/' + key(path))) ||
        '<!doctype html><html dir="rtl"><body style="font-family:sans-serif;padding:2em;text-align:center"><h3>الصفحة غير متوفرة حالياً</h3></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (!h) return J(res, { error: 'unknown endpoint', path, op, action }, 404);
    await h(f, res);
  } catch (e) {
    console.error(e);
    J(res, { error: true, message: String(e.message || e) }, 500);
  }
}).listen(PORT, () => { console.log(`adapter listening on :${PORT} -> ${FB_DB}`); tgPoll(); });
