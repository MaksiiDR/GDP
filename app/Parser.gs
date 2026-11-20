/**
 * Lector de correos de bancos chilenos.
 * Funciones puras (sin APIs de Google) para poder probarlas fuera de Apps Script.
 */

var PALABRAS_INGRESO = /(recibiste|te transfiri[oó]|abono|dep[oó]sito recibido|transferencia recibida|has recibido|te han transferido|devoluci[oó]n|anulaci[oó]n)/i;
var PALABRAS_MONTO = /(compra|monto|cargo|por un total|total|pago|transferencia|transferiste|giro|abono|recibiste|valor|importe|por)\W{0,25}$/i;
var PALABRAS_NO_MONTO = /(cupo|disponible|saldo|l[ií]mite|deuda total|utilizado)\W{0,30}$/i;
var PALABRAS_SALIDA = /(realizaste una transferencia|has realizado el siguiente pago|enviamos tu transferencia)/i;
var PALABRAS_PAGO_TARJETA = /(comprobante\s+(?:de\s+)?pago\s+(?:de\s+)?tarjeta\s+de\s+cr[eé]dito|pago\s+de\s+tu\s+tarjeta\s+de\s+cr[eé]dito)/i;

function normalizarTexto_(texto) {
  var acentos = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' };
  return String(texto || '')
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    // Las celdas de tabla (ej: "Comercio | NETFLIX.COM") quedan separadas por |
    .replace(/<\/?(td|th|tr|p|div|li|ul|table|tbody|h\d)\b[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#36;/g, '$')
    .replace(/&([aeiouAEIOU])acute;/g, function (_, v) { return acentos[v]; })
    .replace(/&ntilde;/g, 'ñ').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&deg;/gi, '°')
    .replace(/[ \t]*\r?\n[ \t]*/g, ' ')
    .replace(/[ \t]{2,}\*/g, ' *')
    // 3+ espacios seguidos separan campos (ej: "NETFLIX.COM.     LAS CONDES     CL")
    .replace(/[ \t]{3,}/g, ' | ')
    .replace(/\s+/g, ' ')
    .replace(/(\s*\|\s*)+/g, ' | ')
    .replace(/^[\s|]+|[\s|]+$/g, '');
}

function aNumeroCLP_(s) {
  // "12.345" -> 12345 ; "12.345,50" -> 12345.5 ; "12345" -> 12345
  s = String(s).trim();
  var partes = s.split(',');
  var entero = partes[0].replace(/\./g, '');
  var dec = partes[1] ? '.' + partes[1] : '';
  return Number(entero + dec);
}

function buscarMonto_(t) {
  var re = /(?:\$|CLP)\s?(\d{1,3}(?:\.\d{3})+|\d+)(,\d{1,2})?/gi;
  var m, mejor = null;
  while ((m = re.exec(t)) !== null) {
    var antes = t.slice(Math.max(0, m.index - 45), m.index);
    var puntaje = 1;
    if (PALABRAS_MONTO.test(antes)) puntaje += 2;
    if (PALABRAS_NO_MONTO.test(antes)) puntaje -= 3;
    var valor = aNumeroCLP_(m[1] + (m[2] || ''));
    if (!valor) continue;
    if (!mejor || puntaje > mejor.puntaje) mejor = { valor: valor, puntaje: puntaje };
  }
  return mejor && mejor.puntaje > 0 ? mejor.valor : null;
}

function buscarTarjeta_(t) {
  var m = t.match(/(?:\*{2,}|x{2,}|X{2,}|terminad[ao] en|termina en|finalizada en|final|n[°º]\.?)\s*[-:]?\s*\**\s*(\d{4})\b/i);
  return m ? m[1] : '';
}

function limpiarComercio_(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,-]+|[\s:,.-]+$/g, '')
    .slice(0, 40);
}

function buscarComercio_(t) {
  var patrones = [
    /([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+(?: [A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,3}) te (?:ha )?transfiri/,
    /\bcomercio\s*[:|]\s*(.+?)(?=\s+(?:fecha|monto|hora|tarjeta|cuotas|el \d)|\s*[|;]|$)/i,
    /\bdestinatario\s*[:|]\s*(.+?)(?=\s+(?:rut|banco|cuenta|monto|fecha)|\s*[|;]|$)/i,
    /\ben\s+([A-Z0-9][A-Z0-9*.&'\/ -]{2,40}?)(?=\s+(?:el|con|a las|fecha|por)\b|\s*[.,;|]|\s+\d{1,2}[\/-])/,
    /\ben\s+(?:el comercio\s+)?([^.,;|]{3,40}?)(?=\s+(?:el|con|a las|fecha)\b|\s*[.,;|])/i
  ];
  for (var i = 0; i < patrones.length; i++) {
    var m = t.match(patrones[i]);
    if (m && m[1] && !/^(tu|su|la|el|una?|nacional|internacional|comercio\s+(?:nacional|internacional))\b/i.test(m[1]) && !/tarjeta|cuenta/i.test(m[1])) {
      return limpiarComercio_(m[1]);
    }
  }
  return '';
}

function buscarFecha_(t, respaldo) {
  var m = t.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\D{1,12}(\d{1,2}):(\d{2}))?/);
  if (m) {
    var anio = Number(m[3]); if (anio < 100) anio += 2000;
    var d = new Date(anio, Number(m[2]) - 1, Number(m[1]), Number(m[4] || 12), Number(m[5] || 0));
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d.toISOString();
  }
  var r = respaldo ? new Date(respaldo) : new Date();
  return r.toISOString();
}

var ALIAS_COMERCIO = [
  [/merpago\*universi/i, 'Casino / Cafetería U'],
  [/fredy\s+octavio/i, 'Negocio (Fredy Octavio)'],
  [/panader[ií]a/i, 'Panadería'],
  [/santa\s+emilia/i, 'Santa Emilia'],
  [/unimarc|supermercado\s+uni/i, 'Unimarc'],
  [/\bsanto\s+domingo\b/i, 'Santo Domingo'],
  [/santa\s+isabel|\bsta\.?\s+isabel\b/i, 'Santa Isabel'],
  [/\balvi\b/i, 'Alvi'],
  [/pasajebus/i, 'PasajeBus'],
  [/pullman\s*bus/i, 'Pullman Bus'],
  [/146\s+terminal\s+tb|turbus/i, 'Terminal Turbus'],
  [/872\s+biobio\s+termi|biobio\s+termi/i, 'Terminal Biobío'],
  [/boletos\.la/i, 'Boletos.la'],
  [/\brecorrido\b/i, 'Recorrido'],
  [/uber\s*eat/i, 'Uber Eats'],
  [/\buber\b/i, 'Uber'],
  [/pedidos\s*ya/i, 'PedidosYa'],
  [/netflix/i, 'Netflix'],
  [/\bentel\b/i, 'Entel'],
  [/google\s+one/i, 'Google One'],
  [/anthropic|claude/i, 'Claude'],
  [/\bcanva\b/i, 'Canva'],
  [/webdock/i, 'Webdock'],
  [/falabella/i, 'Falabella'],
  [/mercado\s*libre/i, 'Mercado Libre'],
  [/merpago\*caferoca/i, 'Café Roca'],
  [/merpago\*cafeteri/i, 'Cafetería'],
  [/acaiberry/i, 'Açaí Berry'],
  [/\bairbnb\b/i, 'Airbnb']
];

function aplicarAliasComercio_(s) {
  for (var i = 0; i < ALIAS_COMERCIO.length; i++) {
    if (ALIAS_COMERCIO[i][0].test(s)) return ALIAS_COMERCIO[i][1];
  }
  return s;
}

var REGLAS_CATEGORIA = [
  ['Supermercado', /lider|jumbo|unimarc|tottus|santa isabel|sta\.?\s*isabel|acuenta|ekono|mayorista|alvi|super|fredy octavio/i],
  ['Comida', /rappi|pedidos ?ya|uber ?eat|just ?eat|mcdonald|burger|kfc|starbucks|domino|papa john|sushi|restaurant|cafe|caf[eé]|pizza|telepizza|juan maestro|doggis|casino|panader[ií]a|a[cç]a[ií] ?berry|acaiberry/i],
  ['Transporte', /uber|didi|cabify|metro|bip|copec|shell|petrobras|aramco|enex|estacionamiento|autopista|tag|turbus|pullman|latam|sky airline|jetsmart|pasajebus|boletos\.la|recorrido|terminal biob[ií]o|biobio termi/i],
  ['Suscripciones', /netflix|spotify|disney|hbo|max\b|prime video|amazon prime|youtube|apple\.com|icloud|google|openai|chatgpt|claude|anthropic|xbox|playstation|steam|canva|webdock/i],
  ['Salud', /farmacia|cruz verde|salcobrand|ahumada|dr\.? simi|cl[ií]nica|isapre|fonasa|dental|m[eé]dico/i],
  ['Cuentas y servicios', /enel|cge|aguas|essbio|esval|metrogas|abastible|lipigas|gasco|entel|movistar|claro|wom|vtr|mundo|gtd/i],
  ['Compras', /falabella|paris|ripley|hites|la polar|mercado ?libre|aliexpress|amazon|shein|temu|sodimac|easy|ikea|h&m|zara/i],
  ['Ocio', /cine|cinemark|hoyts|ticket|punto ticket|passline|bar\b|pub\b|santa emilia|santo domingo|airbnb/i]
];

function categoriaSugerida_(comercio, movimientosPrevios) {
  var c = String(comercio || '').toLowerCase();
  if (!c) return '';
  if (movimientosPrevios) {
    for (var i = movimientosPrevios.length - 1; i >= 0; i--) {
      var mv = movimientosPrevios[i];
      if (mv.categoria && String(mv.descripcion || '').toLowerCase() === c) return mv.categoria;
    }
  }
  for (var j = 0; j < REGLAS_CATEGORIA.length; j++) {
    if (REGLAS_CATEGORIA[j][1].test(c)) return REGLAS_CATEGORIA[j][0];
  }
  return '';
}

/** Devuelve {monto, ultimos4, comercio, fecha, esIngreso} o null si no parece un cargo. */
function parsearCorreo_(texto, fechaCorreo) {
  var t = normalizarTexto_(texto);
  var monto = buscarMonto_(t);
  if (!monto) return null;
  if (PALABRAS_PAGO_TARJETA.test(t)) {
    return {
      monto: monto,
      ultimos4: buscarTarjeta_(t),
      comercio: 'Pago tarjeta de crédito',
      fecha: buscarFecha_(t, fechaCorreo),
      esIngreso: false,
      esPagoTarjeta: true
    };
  }
  var tIng = t.replace(/fecha\s+de\s+abono|recibiste\s+este\s+e-?mail/gi, '');
  var esIngreso = !PALABRAS_SALIDA.test(t) && PALABRAS_INGRESO.test(tIng);
  var comercio = buscarComercio_(t);
  return {
    monto: esIngreso ? monto : -monto,
    ultimos4: buscarTarjeta_(t),
    comercio: comercio ? aplicarAliasComercio_(comercio) : (esIngreso ? 'Ingreso' : 'Cargo sin nombre'),
    fecha: buscarFecha_(t, fechaCorreo),
    esIngreso: esIngreso
  };
}

/** Arma el movimiento a guardar a partir de lo leído y de tus tarjetas registradas. */
function armarMovimientoDesdeCorreo_(p, estado, ref) {
  var cuentaId = '';
  if (p.ultimos4) {
    for (var i = 0; i < estado.Tarjetas.length; i++) {
      if (String(estado.Tarjetas[i].ultimos4) === p.ultimos4) { cuentaId = estado.Tarjetas[i].cuentaId; break; }
    }
  }
  if (!cuentaId) {
    for (var k = 0; k < estado.Config.length; k++) {
      if (estado.Config[k].clave === 'cuentaPorDefecto') cuentaId = estado.Config[k].valor || '';
    }
  }
  return {
    id: 'm' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2, 7),
    fecha: p.fecha,
    cuentaId: cuentaId,
    monto: p.monto,
    descripcion: p.comercio,
    categoria: p.esIngreso ? 'Ingreso' : categoriaSugerida_(p.comercio, estado.Movimientos),
    apartadoId: '',
    origen: 'correo',
    ref: ref || '',
    revisado: 'no',
    tarjeta: p.ultimos4 || ''
  };
}

/** Devuelve lista de movimientos (1 normal, o 2 ligados si es pago de tarjeta de crédito desde cuenta corriente). */
function armarMovimientosDesdeCorreo_(p, estado, ref) {
  if (!p.esPagoTarjeta) return [armarMovimientoDesdeCorreo_(p, estado, ref)];

  var destinoId = '';
  if (p.ultimos4) {
    for (var i = 0; i < estado.Tarjetas.length; i++) {
      if (String(estado.Tarjetas[i].ultimos4) === p.ultimos4) { destinoId = estado.Tarjetas[i].cuentaId; break; }
    }
  }
  var cuentas = estado.Cuentas || [];
  var destino = null;
  for (var d = 0; d < cuentas.length; d++) {
    if (cuentas[d].id === destinoId) { destino = cuentas[d]; break; }
  }

  var origenId = '';
  for (var k = 0; k < estado.Config.length; k++) {
    if (estado.Config[k].clave === 'cuentaPorDefecto') origenId = estado.Config[k].valor || '';
  }
  if (!origenId || origenId === destinoId) {
    origenId = '';
    for (var j = 0; j < cuentas.length; j++) {
      var c = cuentas[j];
      if (c.id === destinoId || c.tipo === 'credito') continue;
      if (destino && c.banco === destino.banco && c.tipo === 'corriente') { origenId = c.id; break; }
      if (!origenId && c.tipo === 'corriente') origenId = c.id;
    }
    if (!origenId) {
      for (var j2 = 0; j2 < cuentas.length; j2++) {
        if (cuentas[j2].id !== destinoId && cuentas[j2].tipo !== 'credito') { origenId = cuentas[j2].id; break; }
      }
    }
  }
  var origen = null;
  for (var o = 0; o < cuentas.length; o++) {
    if (cuentas[o].id === origenId) { origen = cuentas[o]; break; }
  }

  var baseId = 'm' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2, 6);
  var parRef = 'pago-' + (ref || baseId);
  var nomDest = destino ? destino.nombre : ('tarjeta ' + (p.ultimos4 || 'crédito'));
  var nomOrig = origen ? origen.nombre : 'cuenta corriente';
  var monto = Math.abs(p.monto);
  var movs = [];
  if (origenId) {
    movs.push({
      id: baseId + 'a',
      fecha: p.fecha,
      cuentaId: origenId,
      monto: -monto,
      descripcion: 'Pago tarjeta → ' + nomDest,
      categoria: 'Transferencia',
      apartadoId: '',
      origen: 'correo',
      ref: parRef,
      revisado: 'no',
      tarjeta: ''
    });
  }
  movs.push({
    id: baseId + 'b',
    fecha: p.fecha,
    cuentaId: destinoId,
    monto: monto,
    descripcion: 'Pago tarjeta ← ' + nomOrig,
    categoria: 'Transferencia',
    apartadoId: '',
    origen: 'correo',
    ref: parRef,
    revisado: 'no',
    tarjeta: p.ultimos4 || ''
  });
  return movs;
}
