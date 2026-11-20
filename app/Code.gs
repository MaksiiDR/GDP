/**
 * Mi Plata — backend en Google Apps Script.
 * Guarda todo en una planilla de Google ("Mi Plata - datos") y lee los correos
 * de tus bancos en Gmail para registrar los cargos solos.
 */

var TABLAS = {
  Cuentas: ['id', 'banco', 'nombre', 'tipo', 'saldoInicial', 'orden'],
  Apartados: ['id', 'cuentaId', 'nombre', 'asignado', 'meta', 'color'],
  Movimientos: ['id', 'fecha', 'cuentaId', 'monto', 'descripcion', 'categoria', 'apartadoId', 'origen', 'ref', 'revisado', 'tarjeta'],
  Tarjetas: ['id', 'ultimos4', 'cuentaId', 'alias'],
  Config: ['clave', 'valor'],
  Correos: ['id', 'fecha', 'asunto', 'estado', 'extracto']
};
var NUMERICOS = { saldoInicial: 1, asignado: 1, meta: 1, monto: 1, orden: 1 };

var CONSULTA_POR_DEFECTO =
  'newer_than:3d from:(bancoestado.cl OR santander.cl OR bancochile.cl OR bci.cl OR itau.cl OR scotiabank.cl ' +
  'OR bancofalabella.cl OR bancoripley.cl OR security.cl OR bice.cl OR tenpo.cl OR mach.cl OR mercadopago.com OR cmrfalabella.cl) ' +
  '(compra OR cargo OR transacción OR transaccion OR transferencia OR giro OR pago OR abono OR recibiste)';

/* ---------- API para la app (PWA) ----------
 * La app instalable vive en otro sitio y llama aquí por POST.
 * Cada llamada trae la clave secreta; sin ella no se entrega nada.
 */

var FUNCIONES_API = {
  getState: function () { return getState(); },
  aplicar: function (ops) { return aplicar(ops); },
  probarCorreo: function (t) { return probarCorreo(t); },
  escanearCorreos: function () { return escanearCorreos(); },
  activarAutomatico: function (v) { return activarAutomatico(v); },
  olvidarCorreo: function (id) { return olvidarCorreo(id); }
};

function doGet() {
  return json_({ ok: true, app: 'Mi Plata', nota: 'Esta dirección es el servidor de la app. Ábrela desde la app instalada.' });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!claveValida_(req.clave)) return json_({ error: 'Clave incorrecta' });
    var f = FUNCIONES_API[req.fn];
    if (!f) return json_({ error: 'Función desconocida' });
    return json_({ ok: true, data: f.apply(null, req.args || []) });
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function clave_() {
  var props = PropertiesService.getScriptProperties();
  var c = props.getProperty('CLAVE_API');
  if (!c) {
    c = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('CLAVE_API', c);
  }
  return c;
}

function claveValida_(c) {
  var real = clave_();
  if (typeof c !== 'string' || c.length !== real.length) return false;
  var dif = 0;
  for (var i = 0; i < real.length; i++) dif |= real.charCodeAt(i) ^ c.charCodeAt(i);
  return dif === 0;
}

/** Ejecuta esta función en el editor y copia el código que aparece en el registro. */
function verCodigoDeConexion() {
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  Logger.log('Código de conexión (pégalo en la app):\n' + url.replace(/\/dev$/, '/exec') + ' ' + clave_());
}

/** Si crees que alguien vio tu clave: ejecuta esto, y vuelve a conectar la app con el código nuevo. */
function cambiarClave() {
  PropertiesService.getScriptProperties().deleteProperty('CLAVE_API');
  verCodigoDeConexion();
}

/* ---------- Planilla ---------- */

function libro_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SS_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* se borró: crear otra */ }
  }
  var ss = SpreadsheetApp.create('Mi Plata - datos');
  props.setProperty('SS_ID', ss.getId());
  Object.keys(TABLAS).forEach(function (nombre) { hoja_(ss, nombre); });
  var sobrante = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (sobrante && ss.getSheets().length > 1) ss.deleteSheet(sobrante);
  return ss;
}

function hoja_(ss, nombre) {
  var h = ss.getSheetByName(nombre);
  var cols = TABLAS[nombre];
  if (!h) {
    h = ss.insertSheet(nombre);
    h.getRange(1, 1, h.getMaxRows(), cols.length).setNumberFormat('@');
    h.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    h.setFrozenRows(1);
  } else {
    // Agrega columnas nuevas si la planilla es de una versión anterior.
    var actuales = h.getRange(1, 1, 1, Math.max(1, h.getLastColumn())).getValues()[0];
    cols.forEach(function (c) {
      if (actuales.indexOf(c) === -1) {
        var col = h.getLastColumn() + 1;
        h.getRange(1, col).setValue(c).setFontWeight('bold');
        h.getRange(2, col, Math.max(1, h.getMaxRows() - 1), 1).setNumberFormat('@');
      }
    });
  }
  return h;
}

function leer_(ss, nombre) {
  var h = hoja_(ss, nombre);
  var datos = h.getDataRange().getValues();
  var cab = datos.shift() || [];
  return datos.filter(function (f) { return f[0] !== ''; }).map(function (f) {
    var o = {};
    cab.forEach(function (c, i) {
      var v = f[i];
      if (v instanceof Date) v = v.toISOString();
      o[c] = NUMERICOS[c] ? (v === '' ? 0 : Number(v)) : String(v);
      if (c === 'ultimos4' && o[c]) o[c] = ('0000' + o[c]).slice(-4);
    });
    return o;
  });
}

function guardarEn_(ss, nombre, obj) {
  var h = hoja_(ss, nombre);
  var cab = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
  var clave = cab[0];
  var fila = cab.map(function (c) { return obj[c] === undefined || obj[c] === null ? '' : String(obj[c]); });
  var ids = h.getLastRow() > 1 ? h.getRange(2, 1, h.getLastRow() - 1, 1).getValues() : [];
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(obj[clave])) {
      h.getRange(i + 2, 1, 1, fila.length).setValues([fila]);
      return;
    }
  }
  h.appendRow(fila);
}

function borrarEn_(ss, nombre, id) {
  var h = hoja_(ss, nombre);
  if (h.getLastRow() < 2) return;
  var ids = h.getRange(2, 1, h.getLastRow() - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) h.deleteRow(i + 2);
  }
}

function validarTabla_(nombre) {
  if (!TABLAS[nombre]) throw new Error('Tabla desconocida: ' + nombre);
}

/* ---------- API para la página ---------- */

function getState() {
  var ss = libro_();
  var estado = {};
  Object.keys(TABLAS).forEach(function (n) { estado[n] = leer_(ss, n); });
  estado.Correos = estado.Correos.slice(-40);
  estado.consultaPorDefecto = CONSULTA_POR_DEFECTO;
  estado.automatico = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'escanearAutomatico'; });
  estado.planilla = ss.getUrl();
  return estado;
}

/** ops: [{op:'guardar', tabla, obj} | {op:'borrar', tabla, id}] */
function aplicar(ops) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = libro_();
    (ops || []).forEach(function (o) {
      validarTabla_(o.tabla);
      if (o.op === 'guardar') guardarEn_(ss, o.tabla, o.obj);
      else if (o.op === 'borrar') borrarEn_(ss, o.tabla, o.id);
    });
  } finally {
    lock.releaseLock();
  }
  return getState();
}

function probarCorreo(texto) {
  return parsearCorreo_(texto, new Date());
}

/* ---------- Gmail ---------- */

function consulta_(estado) {
  var c = estado.Config.filter(function (x) { return x.clave === 'consultaCorreo'; })[0];
  return (c && c.valor) ? c.valor : CONSULTA_POR_DEFECTO;
}

function escanearCorreos() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { nuevos: 0, noEntendidos: 0, estado: getState() };
  var nuevos = 0, noEntendidos = 0;
  try {
    var ss = libro_();
    var estado = {
      Cuentas: leer_(ss, 'Cuentas'),
      Tarjetas: leer_(ss, 'Tarjetas'),
      Config: leer_(ss, 'Config'),
      Movimientos: leer_(ss, 'Movimientos')
    };
    var vistos = {};
    leer_(ss, 'Correos').forEach(function (c) { vistos[c.id] = true; });

    var hilos = GmailApp.search(consulta_(estado), 0, 40);
    hilos.forEach(function (hilo) {
      hilo.getMessages().forEach(function (msg) {
        var id = msg.getId();
        if (vistos[id]) return;
        vistos[id] = true;
        var asunto = msg.getSubject() || '';
        // El HTML conserva las celdas de tabla (Monto | $12.880), que el lector usa para separar campos.
        var cuerpo = msg.getBody() || msg.getPlainBody();
        var p = parsearCorreo_(asunto + '. ' + cuerpo, msg.getDate());
        if (p) {
          var movs = armarMovimientosDesdeCorreo_(p, estado, id);
          movs.forEach(function (mov) {
            guardarEn_(ss, 'Movimientos', mov);
            estado.Movimientos.push(mov);
          });
          nuevos++;
        } else {
          noEntendidos++;
        }
        guardarEn_(ss, 'Correos', {
          id: id,
          fecha: msg.getDate().toISOString(),
          asunto: asunto.slice(0, 120),
          estado: p ? 'registrado' : 'no entendido',
          extracto: p ? '' : normalizarTexto_(cuerpo).slice(0, 600)
        });
      });
    });
  } finally {
    lock.releaseLock();
  }
  return { nuevos: nuevos, noEntendidos: noEntendidos, estado: getState() };
}

function escanearAutomatico() {
  escanearCorreos();
}

function activarAutomatico(activar) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'escanearAutomatico') ScriptApp.deleteTrigger(t);
  });
  if (activar) ScriptApp.newTrigger('escanearAutomatico').timeBased().everyMinutes(10).create();
  return getState();
}

/** Para reintentar un correo que no se entendió (después de cambiar algo). */
function olvidarCorreo(id) {
  var ss = libro_();
  borrarEn_(ss, 'Correos', id);
  return getState();
}
