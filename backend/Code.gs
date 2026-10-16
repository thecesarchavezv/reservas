/**
 * Reservas AP · Backend (Google Apps Script)
 * ------------------------------------------------------------
 * Hoja de Google = base de datos. Este script expone una API JSON
 * que usa la interfaz publicada en GitHub Pages, y manda los
 * correos (códigos de acceso y alertas de fin de turno).
 *
 * Instalación: ver GUIA.md. Resumen:
 *   1. Ajusta CONFIG (abajo).
 *   2. Ejecuta la función setup() una vez y autoriza.
 *   3. Implementar > Nueva implementación > Aplicación web
 *      (Ejecutar como: Yo · Acceso: Cualquier usuario).
 */

// =============================================================
// CONFIGURACIÓN — edita solo esta sección
// =============================================================
const CONFIG = {
  // Herramientas que aparecen en el selector. Para agregar una, copia una línea y cámbiala:
  //   id: identificador corto, sin espacios ni acentos (se usa en el enlace, ej. ?h=semrush)
  //   name: nombre que ve el equipo
  // La primera es la que se abre por defecto. No cambies el id de una que ya tenga reservas.
  TOOLS: [
    { id: 'edtake', name: 'Edtake' },
    { id: 'semrush', name: 'Semrush' },
  ],
  APP_URL: 'https://thecesarchavezv.github.io/reservas/', // URL de GitHub Pages (para los enlaces en los correos)
  TIMEZONE: 'America/Mexico_City',  // Zona horaria por defecto para correos
  BUFFER_MIN: 15,                   // Minutos mínimos entre una reserva y la siguiente
  MIN_DURATION_MIN: 15,             // Duración mínima de una reserva
  MAX_DURATION_MIN: 240,            // Duración máxima de una reserva (4 h)
  MAX_DAYS_AHEAD: 30,               // Hasta cuántos días adelante se puede reservar
  ALLOWED_DOMAINS: ['aplatam.com'], // Dominios permitidos. [] = cualquier correo
  CODE_TTL_MIN: 10,                 // Vigencia del código de acceso
  SESSION_DAYS: 30,                 // Días que la sesión queda abierta en el navegador
  SENDER_NAME: 'Reservas AP Latam', // Nombre que aparece como remitente
};

// =============================================================
// Estructura de la hoja
// =============================================================
const SHEETS = {
  Usuarios: ['email', 'nombre', 'zona_horaria', 'creado'],
  Reservas: ['id', 'email', 'nombre', 'inicio_ms', 'fin_ms', 'inicio', 'fin', 'nota',
             'estado', 'alerta15', 'alerta5', 'creado', 'actualizado', 'herramienta'],
  Codigos: ['email', 'hash', 'expira_ms', 'intentos'],
  Sesiones: ['token', 'email', 'expira_ms', 'creado'],
};

const MIN = 60 * 1000;

function toolIds_() { return CONFIG.TOOLS.map(function (t) { return t.id; }); }
/** Herramienta de una reserva; las reservas anteriores al selector cuentan como la primera. */
function toolOf_(r) { return String(r.herramienta || CONFIG.TOOLS[0].id); }
function toolName_(id) {
  const t = CONFIG.TOOLS.filter(function (x) { return x.id === id; })[0];
  return t ? t.name : id;
}
function checkTool_(id) {
  id = String(id || '');
  if (toolIds_().indexOf(id) === -1) fail_('Elige una herramienta válida.');
  return id;
}
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// =============================================================
// Instalación
// =============================================================
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SHEETS[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkAlerts') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkAlerts').timeBased().everyMinutes(1).create();
  bumpVersion_();
  Logger.log('Listo. Hojas creadas y alerta programada cada minuto.');
}

/** Prueba rápida: te manda un correo a ti para confirmar que el envío funciona. */
function probarCorreo() {
  const me = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  sendMail_(me, 'Prueba de Reservas AP', emailLayout_('Todo listo',
    '<p>Si recibiste este correo, el envío de alertas funciona correctamente.</p>'));
  Logger.log('Correo de prueba enviado a ' + me + '. Cuota restante hoy: ' + MailApp.getRemainingDailyQuota());
}

// =============================================================
// API web
// =============================================================
function doGet() {
  return json_({ ok: true, app: 'reservas-ap', hint: 'Usa POST' });
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Solicitud inválida.' });
  }
  try {
    const handler = ACTIONS[body.action];
    if (!handler) return json_({ ok: false, error: 'Acción desconocida.' });
    return json_(Object.assign({ ok: true }, handler(body)));
  } catch (err) {
    const msg = err && err.userMessage ? err.userMessage : 'Ocurrió un error inesperado. Intenta de nuevo.';
    if (!(err && err.userMessage)) console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: msg, code: err && err.code });
  }
}

const ACTIONS = {
  requestCode: apiRequestCode_,
  verifyCode: apiVerifyCode_,
  state: apiState_,
  create: apiCreate_,
  update: apiUpdate_,
  cancel: apiCancel_,
  release: apiRelease_,
  logout: apiLogout_,
};

// ---------- Acceso por código ----------
function apiRequestCode_(b) {
  const email = normEmail_(b.email);
  const name = String(b.name || '').trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail_('Escribe un correo válido.');
  if (CONFIG.ALLOWED_DOMAINS.length) {
    const dom = email.split('@')[1];
    if (CONFIG.ALLOWED_DOMAINS.indexOf(dom) === -1) {
      fail_('Solo se permiten correos de: ' + CONFIG.ALLOWED_DOMAINS.join(', ') + '.');
    }
  }
  const existing = findRow_('Usuarios', 'email', email);
  if (!existing && !name) fail_('Es tu primera vez: escribe tu nombre completo.', 'NEED_NAME');

  const cache = CacheService.getScriptCache();
  if (cache.get('rc_' + email)) fail_('Ya te enviamos un código. Espera un minuto para pedir otro.');
  cache.put('rc_' + email, '1', 60);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  withLock_(function () {
    deleteRows_('Codigos', function (r) { return r.email === email; });
    appendRow_('Codigos', { email: email, hash: sha_(email + ':' + code), expira_ms: Date.now() + CONFIG.CODE_TTL_MIN * MIN, intentos: 0 });
    if (!existing) {
      appendRow_('Usuarios', { email: email, nombre: name, zona_horaria: String(b.tz || CONFIG.TIMEZONE), creado: new Date() });
    } else if (name && name !== existing.row.nombre) {
      updateRow_('Usuarios', existing.index, { nombre: name });
    }
  });

  sendMail_(email, 'Tu código de acceso: ' + code, emailLayout_('Tu código de acceso',
    '<p>Usa este código para entrar a las reservas de herramientas de AP Latam:</p>' +
    '<p style="font-size:34px;font-weight:700;letter-spacing:8px;color:#003CFA;margin:18px 0">' + code + '</p>' +
    '<p style="color:#6b7474">Vence en ' + CONFIG.CODE_TTL_MIN + ' minutos. Si no lo pediste, ignora este correo.</p>'));
  return { sent: true, isNew: !existing };
}

function apiVerifyCode_(b) {
  const email = normEmail_(b.email);
  const code = String(b.code || '').replace(/\D/g, '');
  const found = findRow_('Codigos', 'email', email);
  if (!found) fail_('Pide un código nuevo.');
  const r = found.row;
  if (Number(r.expira_ms) < Date.now()) fail_('El código venció. Pide uno nuevo.');
  if (Number(r.intentos) >= 5) fail_('Demasiados intentos. Pide un código nuevo.');
  if (r.hash !== sha_(email + ':' + code)) {
    updateRow_('Codigos', found.index, { intentos: Number(r.intentos) + 1 });
    fail_('El código no coincide.');
  }
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const expira = Date.now() + CONFIG.SESSION_DAYS * 24 * 60 * MIN;
  withLock_(function () {
    deleteRows_('Codigos', function (x) { return x.email === email; });
    deleteRows_('Sesiones', function (x) { return Number(x.expira_ms) < Date.now(); });
    appendRow_('Sesiones', { token: token, email: email, expira_ms: expira, creado: new Date() });
    const u = findRow_('Usuarios', 'email', email);
    if (u && b.tz) updateRow_('Usuarios', u.index, { zona_horaria: String(b.tz) });
  });
  CacheService.getScriptCache().put('s_' + token, email, 21600);
  const user = findRow_('Usuarios', 'email', email).row;
  return { token: token, user: { email: email, name: user.nombre } };
}

function apiLogout_(b) {
  const token = String(b.token || '');
  CacheService.getScriptCache().remove('s_' + token);
  withLock_(function () { deleteRows_('Sesiones', function (x) { return x.token === token; }); });
  return {};
}

// ---------- Estado ----------
function apiState_(b) {
  const email = auth_(b.token);
  const version = getVersion_();
  if (b.version && Number(b.version) === version) return { unchanged: true, version: version, now: Date.now() };

  const now = Date.now();
  const from = now - 8 * 24 * 60 * MIN;  // una semana hacia atrás
  const to = now + (CONFIG.MAX_DAYS_AHEAD + 1) * 24 * 60 * MIN;
  const reservations = readAll_('Reservas')
    .filter(function (r) { return r.estado === 'activa' && Number(r.fin_ms) > from && Number(r.inicio_ms) < to; })
    .map(publicRes_)
    .sort(function (a, b2) { return a.start - b2.start; });
  const u = findRow_('Usuarios', 'email', email);
  return {
    version: version,
    now: now,
    user: { email: email, name: u ? u.row.nombre : email },
    reservations: reservations,
    config: {
      tools: CONFIG.TOOLS,
      bufferMin: CONFIG.BUFFER_MIN,
      minDurationMin: CONFIG.MIN_DURATION_MIN,
      maxDurationMin: CONFIG.MAX_DURATION_MIN,
      maxDaysAhead: CONFIG.MAX_DAYS_AHEAD,
    },
  };
}

// ---------- Crear / editar / cancelar ----------
function apiCreate_(b) {
  const email = auth_(b.token);
  let start = roundMin_(Number(b.start));
  const end = roundMin_(Number(b.end));
  const note = String(b.note || '').trim().slice(0, 200);
  const tool = checkTool_(b.tool);
  // "Empezar ahora": si el inicio cae en los últimos 15 min, se ajusta a este minuto.
  const nowMin = Math.floor(Date.now() / MIN) * MIN;
  if (start < nowMin && start >= nowMin - 15 * MIN) start = nowMin;
  return withLock_(function () {
    validateSlot_(start, end, null, null, tool);
    const u = findRow_('Usuarios', 'email', email);
    const id = Utilities.getUuid().slice(0, 8);
    appendRow_('Reservas', {
      id: id, email: email, nombre: u ? u.row.nombre : email,
      inicio_ms: start, fin_ms: end, inicio: fmtDate_(start, CONFIG.TIMEZONE), fin: fmtDate_(end, CONFIG.TIMEZONE),
      nota: note, estado: 'activa', alerta15: '', alerta5: '', creado: new Date(), actualizado: new Date(),
      herramienta: tool,
    });
    bumpVersion_();
    return { id: id };
  });
}

function apiUpdate_(b) {
  const email = auth_(b.token);
  const start = roundMin_(Number(b.start));
  const end = roundMin_(Number(b.end));
  const note = String(b.note || '').trim().slice(0, 200);
  return withLock_(function () {
    const found = ownRes_(b.id, email);
    validateSlot_(start, end, found.row.id, found.row, toolOf_(found.row));
    const changes = {
      inicio_ms: start, fin_ms: end, inicio: fmtDate_(start, CONFIG.TIMEZONE), fin: fmtDate_(end, CONFIG.TIMEZONE),
      nota: note, actualizado: new Date(),
    };
    if (end !== Number(found.row.fin_ms)) { changes.alerta15 = ''; changes.alerta5 = ''; }
    updateRow_('Reservas', found.index, changes);
    bumpVersion_();
    return { id: found.row.id };
  });
}

function apiCancel_(b) {
  const email = auth_(b.token);
  return withLock_(function () {
    const found = ownRes_(b.id, email);
    if (Number(found.row.fin_ms) <= Date.now()) fail_('Esa reserva ya terminó.');
    if (Number(found.row.inicio_ms) <= Date.now()) fail_('Tu turno ya empezó. Usa "Liberar ahora".');
    updateRow_('Reservas', found.index, { estado: 'cancelada', actualizado: new Date() });
    bumpVersion_();
    return {};
  });
}

/** Termina un turno en curso antes de tiempo para liberar la herramienta. */
function apiRelease_(b) {
  const email = auth_(b.token);
  return withLock_(function () {
    const found = ownRes_(b.id, email);
    const now = roundMin_(Date.now());
    const r = found.row;
    if (!(Number(r.inicio_ms) <= now && Number(r.fin_ms) > now)) fail_('Esa reserva no está en curso.');
    updateRow_('Reservas', found.index, {
      fin_ms: now, fin: fmtDate_(now, CONFIG.TIMEZONE), alerta15: 'liberada', alerta5: 'liberada', actualizado: new Date(),
    });
    bumpVersion_();
    return {};
  });
}

function ownRes_(id, email) {
  const found = findRow_('Reservas', 'id', String(id || ''));
  if (!found || found.row.estado !== 'activa') fail_('No encontramos esa reserva.');
  if (normEmail_(found.row.email) !== email) fail_('Solo puedes cambiar tus propias reservas.');
  return found;
}

/** Reglas de negocio: duración, ventana permitida y separación de 15 min. */
function validateSlot_(start, end, ignoreId, existing, tool) {
  const now = Date.now();
  if (!isFinite(start) || !isFinite(end)) fail_('Fecha u hora inválida.');
  if (end <= start) fail_('La hora de fin debe ser posterior a la de inicio.');
  const dur = (end - start) / MIN;
  if (dur < CONFIG.MIN_DURATION_MIN) fail_('La reserva mínima es de ' + CONFIG.MIN_DURATION_MIN + ' minutos.');
  if (dur > CONFIG.MAX_DURATION_MIN) fail_('La reserva máxima es de ' + fmtDur_(CONFIG.MAX_DURATION_MIN) + '.');
  const keepsStart = existing && Number(existing.inicio_ms) === start && start <= now;
  if (start < now - 2 * MIN && !keepsStart) fail_('No puedes reservar en el pasado.');
  if (end <= now) fail_('La hora de fin ya pasó.');
  if (start > now + CONFIG.MAX_DAYS_AHEAD * 24 * 60 * MIN) {
    fail_('Solo puedes reservar hasta ' + CONFIG.MAX_DAYS_AHEAD + ' días adelante.');
  }
  const buf = CONFIG.BUFFER_MIN * MIN;
  const clash = readAll_('Reservas').filter(function (r) {
    return r.estado === 'activa' && r.id !== ignoreId && toolOf_(r) === tool &&
      start < Number(r.fin_ms) + buf && end > Number(r.inicio_ms) - buf;
  })[0];
  if (clash) {
    fail_('Choca con la reserva de ' + clash.nombre + ' en ' + toolName_(tool) + ' (' + fmtTime_(Number(clash.inicio_ms), CONFIG.TIMEZONE) + '–' +
      fmtTime_(Number(clash.fin_ms), CONFIG.TIMEZONE) + ', hora CDMX). Recuerda dejar ' + CONFIG.BUFFER_MIN +
      ' min entre turnos.', 'CONFLICT');
  }
}

// =============================================================
// Alertas automáticas (se ejecuta cada minuto)
// =============================================================
function checkAlerts() {
  const now = Date.now();
  const sh = sheet_('Reservas');
  const rows = readAll_('Reservas');
  if (!rows.length) return;
  const headers = SHEETS.Reservas;
  const col15 = headers.indexOf('alerta15') + 1;
  const col5 = headers.indexOf('alerta5') + 1;
  const users = {};
  readAll_('Usuarios').forEach(function (u) { users[normEmail_(u.email)] = u; });

  rows.forEach(function (r, i) {
    if (r.estado !== 'activa') return;
    const start = Number(r.inicio_ms), end = Number(r.fin_ms);
    if (start > now || end < now - 2 * MIN) return;   // solo turnos en curso
    const left = (end - now) / MIN;
    const dur = (end - start) / MIN;
    const tz = (users[normEmail_(r.email)] || {}).zona_horaria || CONFIG.TIMEZONE;
    const rowNum = i + 2;
    const tool = toolOf_(r), tname = toolName_(tool);

    if (!r.alerta15 && left <= 15 && left > 6 && dur >= 25) {
      sendMail_(r.email, 'Tu turno en ' + tname + ' termina en 15 minutos', emailLayout_(
        'Te quedan 15 minutos',
        '<p>Hola ' + esc_(firstName_(r.nombre)) + ', tu turno en ' + esc_(tname) + ' termina a las <b>' +
        fmtTime_(end, tz) + '</b>.</p><p>Ve cerrando lo que estás haciendo para que la siguiente persona pueda entrar a tiempo.</p>'));
      sh.getRange(rowNum, col15).setValue(new Date());
    }
    if (!r.alerta5 && left <= 5 && left > -2) {
      const next = nextFreeSlots_(rows.filter(function (x) { return toolOf_(x) === tool; }), now, 60, 3);
      const list = next.length
        ? '<p style="margin-top:22px"><b>Próximos espacios libres de 1 hora en ' + esc_(tname) + ':</b></p><ul>' + next.map(function (s) {
            return '<li>' + fmtDate_(s, tz) + '</li>';
          }).join('') + '</ul>'
        : '';
      sendMail_(r.email, 'Quedan 5 minutos en ' + tname + ': guarda tu trabajo', emailLayout_(
        'Quedan 5 minutos',
        '<p>Hola ' + esc_(firstName_(r.nombre)) + ', tu turno termina a las <b>' + fmtTime_(end, tz) + '</b>.</p>' +
        '<p><b>Guarda todo tu trabajo y cierra sesión</b> en ' + esc_(tname) + ' para no perder nada.</p>' +
        '<p>¿Necesitas más tiempo? Agenda un nuevo espacio cuando quieras.</p>' + list +
        (CONFIG.APP_URL ? button_(CONFIG.APP_URL + '?h=' + encodeURIComponent(tool) + '&reservar=1', 'Reservar otro turno') : '')));
      sh.getRange(rowNum, col5).setValue(new Date());
    }
  });
}

/** Busca los siguientes huecos libres (respetando el buffer) de cierta duración. */
function nextFreeSlots_(rows, from, durMin, count) {
  const buf = CONFIG.BUFFER_MIN * MIN, dur = durMin * MIN;
  const busy = rows.filter(function (r) { return r.estado === 'activa' && Number(r.fin_ms) > from; })
    .map(function (r) { return [Number(r.inicio_ms) - buf, Number(r.fin_ms) + buf]; })
    .sort(function (a, b) { return a[0] - b[0]; });
  const out = [];
  let t = Math.ceil(from / (15 * MIN)) * 15 * MIN;
  for (let guard = 0; guard < 2000 && out.length < count; guard++) {
    const block = busy.filter(function (x) { return t < x[1] && t + dur > x[0]; })[0];
    if (block) { t = Math.ceil(block[1] / (15 * MIN)) * 15 * MIN; continue; }
    out.push(t);
    t += dur + buf;
  }
  return out;
}

// =============================================================
// Utilidades
// =============================================================
function auth_(token) {
  token = String(token || '');
  if (!token) fail_('Tu sesión expiró. Vuelve a entrar.', 'AUTH');
  const cache = CacheService.getScriptCache();
  const cached = cache.get('s_' + token);
  if (cached) return cached;
  const found = findRow_('Sesiones', 'token', token);
  if (!found || Number(found.row.expira_ms) < Date.now()) fail_('Tu sesión expiró. Vuelve a entrar.', 'AUTH');
  const email = normEmail_(found.row.email);
  cache.put('s_' + token, email, 21600);
  return email;
}

function publicRes_(r) {
  return {
    id: String(r.id), email: normEmail_(r.email), name: String(r.nombre),
    start: Number(r.inicio_ms), end: Number(r.fin_ms), note: String(r.nota || ''), tool: toolOf_(r),
  };
}

function fail_(msg, code) { const e = new Error(msg); e.userMessage = msg; e.code = code || 'ERROR'; throw e; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function roundMin_(ms) { return Math.round(ms / MIN) * MIN; }
function firstName_(n) { return String(n || '').split(' ')[0] || 'hola'; }
function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) fail_('Hay mucha actividad en este momento. Intenta de nuevo.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function getVersion_() { return Number(PropertiesService.getScriptProperties().getProperty('version') || 1); }
function bumpVersion_() { PropertiesService.getScriptProperties().setProperty('version', String(getVersion_() + 1)); }

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) fail_('Falta la hoja "' + name + '". Ejecuta setup() en Apps Script.');
  return sh;
}

function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = SHEETS[name];
  return sh.getRange(2, 1, last - 1, headers.length).getValues().map(function (row) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

function findRow_(name, key, value) {
  const rows = readAll_(name);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][key]).toLowerCase() === String(value).toLowerCase()) return { row: rows[i], index: i };
  }
  return null;
}

function appendRow_(name, obj) {
  sheet_(name).appendRow(SHEETS[name].map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

function updateRow_(name, index, changes) {
  const sh = sheet_(name);
  const headers = SHEETS[name];
  Object.keys(changes).forEach(function (k) {
    const c = headers.indexOf(k);
    if (c >= 0) sh.getRange(index + 2, c + 1).setValue(changes[k]);
  });
}

function deleteRows_(name, predicate) {
  const sh = sheet_(name);
  const rows = readAll_(name);
  for (let i = rows.length - 1; i >= 0; i--) if (predicate(rows[i])) sh.deleteRow(i + 2);
}

// ---------- Fechas en español ----------
function parts_(ms, tz) {
  const p = Utilities.formatDate(new Date(ms), tz, 'yyyy|M|d|H|mm|u').split('|');
  return { y: +p[0], m: +p[1], d: +p[2], h: +p[3], mi: p[4], dow: (+p[5]) % 7 };
}
function fmtTime_(ms, tz) {
  const p = parts_(ms, tz || CONFIG.TIMEZONE);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return h12 + ':' + p.mi + (p.h < 12 ? ' a. m.' : ' p. m.');
}
function fmtDate_(ms, tz) {
  const p = parts_(ms, tz || CONFIG.TIMEZONE);
  return DIAS[p.dow] + ' ' + p.d + ' ' + MESES[p.m - 1] + ', ' + fmtTime_(ms, tz);
}
function fmtDur_(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
}

// ---------- Correos ----------
function sendMail_(to, subject, html) {
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: CONFIG.SENDER_NAME });
}

function button_(url, label) {
  return '<p style="margin:26px 0 6px"><a href="' + esc_(url) + '" style="background:#003CFA;color:#fff;text-decoration:none;' +
    'padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">' + esc_(label) + '</a></p>';
}

function emailLayout_(title, inner) {
  return '<div style="background:#f3f5f7;padding:28px 12px;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;color:#343E3E">' +
    '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e3e7e7">' +
    '<div style="background:#003CFA;color:#fff;padding:18px 26px;font-size:13px;letter-spacing:2px;font-weight:600">AP LATAM · RESERVAS</div>' +
    '<div style="padding:26px 26px 30px;font-size:15px;line-height:1.55">' +
    '<h1 style="font-size:22px;margin:0 0 12px;color:#343E3E">' + esc_(title) + '</h1>' + inner + '</div></div>' +
    '<p style="text-align:center;color:#AEB4B4;font-size:12px;margin-top:16px">Mensaje automático de Reservas AP Latam</p></div>';
}
