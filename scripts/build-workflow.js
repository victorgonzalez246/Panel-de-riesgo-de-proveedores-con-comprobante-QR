// Genera n8n/workflow-panel-riesgo.json.
//
// Los nodos Code del workflow reciben una copia exacta de las clases de src/
// (sin las líneas require/module.exports), así la lógica de negocio vive en un solo lugar.
// Después de cambiar una clase: npm run build:workflow y volver a importar el JSON en n8n.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const raiz = path.join(__dirname, '..');
const ARCHIVOS_CLASES = ['config.js', 'Proveedor.js', 'Pago.js', 'ComprobanteQR.js', 'EvaluadorRiesgo.js'];

function cargarClases() {
  return ARCHIVOS_CLASES.map((archivo) => {
    const codigo = fs.readFileSync(path.join(raiz, 'src', archivo), 'utf8')
      .replace(/^const .*= require\(.*\);\r?\n/gm, '')
      .replace(/^module\.exports = .*;\r?\n?/gm, '')
      .trim();
    return `// ---------- src/${archivo} ----------\n${codigo}`;
  }).join('\n\n');
}

const CLASES = cargarClases();

function codigoNodo(llamada) {
  return [
    '// Clases copiadas desde src/ por scripts/build-workflow.js — no editar aquí.',
    CLASES,
    '',
    '// ---------- Lógica del nodo ----------',
    llamada
  ].join('\n');
}

// UUID estable a partir del nombre, para que regenerar no cambie los ids
function idNodo(nombre) {
  const h = crypto.createHash('md5').update(nombre).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function nodo(nombre, tipo, version, posicion, parametros, extra = {}) {
  return { parameters: parametros, id: idNodo(nombre), name: nombre, type: tipo, typeVersion: version, position: posicion, ...extra };
}

const condicion = (leftValue, operator, rightValue = '') => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: idNodo(leftValue + operator.operation), leftValue, rightValue, operator }],
    combinator: 'and'
  },
  options: {}
});

const respuestaCompleta = { response: { response: { fullResponse: true, neverError: true } }, timeout: 10000 };
// JSON Server reescribe db.json en cada cambio; en Windows las escrituras simultáneas lo botan (EPERM)
const escrituraSecuencial = { batching: { batch: { batchSize: 1, batchInterval: 150 } } };
const reintentoEscritura = { retryOnFail: true, maxTries: 3, waitBetweenTries: 1000 };
const URL_JSON_SERVER = "{{ $('Configuración').first().json.jsonServerUrl }}";

const nodos = [
  nodo('Nota: reglas de negocio', 'n8n-nodes-base.stickyNote', 1, [-60, -420], {
    content: [
      '## Panel de riesgo de proveedores',
      'Los nodos **Code (POO)** usan las clases de `src/` (Proveedor, Pago, ComprobanteQR, EvaluadorRiesgo).',
      '',
      '**R1** moroso → retenido · **R2** omiso → retenido · **R3** no inscrito → retenido',
      '**R4** monto > umbral → revisión manual · **R5** solo pendientes · **R6** cédula inválida → retenido',
      '**R7** proveedor inactivo → retenido · **R8** vencido → prioridad alta · **R9** 3 intentos → revisión',
      '',
      '**E1** Hacienda 404 · **E2** Hacienda caída · **E3** proveedor inexistente · **E4** datos incompletos',
      '**E5** QR no disponible · **E6** JSON Server caído',
      '',
      'Demo de error: cambiar `haciendaUrl` en **Configuración** por `https://hacienda-caida.invalid`'
    ].join('\n'),
    height: 300,
    width: 760,
    color: 4
  }),

  nodo('Ejecutar manualmente', 'n8n-nodes-base.manualTrigger', 1, [0, 0], {}),

  nodo('Revisión diaria 7:00', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 200], {
    rule: { interval: [{ field: 'days', triggerAtHour: 7 }] }
  }),

  nodo('Configuración', 'n8n-nodes-base.set', 3.4, [220, 100], {
    assignments: {
      assignments: [
        { id: idNodo('cfg-json'), name: 'jsonServerUrl', value: 'http://127.0.0.1:3000', type: 'string' },
        { id: idNodo('cfg-hacienda'), name: 'haciendaUrl', value: 'https://api.hacienda.go.cr/fe/ae', type: 'string' },
        { id: idNodo('cfg-qr'), name: 'qrServerUrl', value: 'https://api.qrserver.com/v1/create-qr-code/', type: 'string' }
      ]
    },
    options: {}
  }),

  nodo('Obtener pagos por revisar', 'n8n-nodes-base.httpRequest', 4.2, [440, 100], {
    url: `=${URL_JSON_SERVER}/pagos?estado=pendiente&estado=error_verificacion`,
    options: { response: { response: { fullResponse: true } }, timeout: 10000 }
  }, { onError: 'continueErrorOutput' }),

  nodo('JSON Server no disponible', 'n8n-nodes-base.stopAndError', 1, [660, 300], {
    errorMessage: "=[E6] JSON Server no responde en {{ $('Configuración').first().json.jsonServerUrl }}. Inicie el servidor con \"npm run api\" y vuelva a ejecutar."
  }),

  nodo('¿Hay pagos por revisar?', 'n8n-nodes-base.if', 2.2, [660, 0],
    condicion('={{ $json.body }}', { type: 'array', operation: 'notEmpty', singleValue: true })),

  nodo('Sin pagos por revisar', 'n8n-nodes-base.noOp', 1, [880, 160], {}),

  nodo('Separar pagos', 'n8n-nodes-base.splitOut', 1, [880, -100], {
    fieldToSplitOut: 'body',
    options: {}
  }),

  nodo('Obtener proveedor', 'n8n-nodes-base.httpRequest', 4.2, [1100, -100], {
    url: `=${URL_JSON_SERVER}/proveedores/{{ encodeURIComponent($json.proveedorId || 'sin-proveedor') }}`,
    options: respuestaCompleta
  }, { onError: 'continueRegularOutput' }),

  nodo('Validar pago y proveedor (POO)', 'n8n-nodes-base.code', 2, [1320, -100], {
    mode: 'runOnceForEachItem',
    jsCode: codigoNodo([
      "// Paso 1: reglas R5, E4, E3, R7 y R6 (no necesitan a Hacienda)",
      "const evaluador = new EvaluadorRiesgo();",
      "const pago = $('Separar pagos').item.json;",
      "return { json: evaluador.validar(pago, $json) };"
    ].join('\n'))
  }),

  nodo('¿Consultar Hacienda?', 'n8n-nodes-base.if', 2.2, [1540, -100],
    condicion('={{ $json.consultarHacienda }}', { type: 'boolean', operation: 'true', singleValue: true })),

  nodo('Consultar Hacienda', 'n8n-nodes-base.httpRequest', 4.2, [1760, -200], {
    url: "={{ $('Configuración').first().json.haciendaUrl }}?identificacion={{ $json.cedula }}",
    options: { ...respuestaCompleta, batching: { batch: { batchSize: 1, batchInterval: 1500 } } }
  }, { onError: 'continueRegularOutput' }),

  nodo('Evaluar riesgo (POO)', 'n8n-nodes-base.code', 2, [1980, -200], {
    mode: 'runOnceForEachItem',
    jsCode: codigoNodo([
      "// Paso 2: reglas E1, E2, R1, R2, R3, R4, R8, R9 y generación del comprobante QR",
      "const evaluador = new EvaluadorRiesgo({ qrBaseUrl: $('Configuración').first().json.qrServerUrl });",
      "const previo = $('Validar pago y proveedor (POO)').item.json;",
      "return { json: evaluador.evaluar(previo.pago, previo.proveedor, $json) };"
    ].join('\n'))
  }),

  nodo('¿Decisión?', 'n8n-nodes-base.switch', 3.2, [2200, -40], {
    rules: {
      values: [
        { ...condicion('={{ $json.decision }}', { type: 'string', operation: 'equals' }, 'aprobado'), renameOutput: true, outputKey: 'Aprobado' },
        { ...condicion('={{ $json.decision }}', { type: 'string', operation: 'equals' }, 'omitido'), renameOutput: true, outputKey: 'Omitido' }
      ].map(({ options, ...regla }) => regla)
    },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'Retenido / revisión / error' }
  }),

  nodo('Generar comprobante QR', 'n8n-nodes-base.httpRequest', 4.2, [2420, -200], {
    url: '={{ $json.cambios.qrUrl }}',
    options: { response: { response: { responseFormat: 'file' } }, timeout: 30000 }
  }, { onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 }),

  nodo('Registrar pago aprobado', 'n8n-nodes-base.httpRequest', 4.2, [2640, -260], {
    method: 'PATCH',
    url: `=${URL_JSON_SERVER}/pagos/{{ $('¿Decisión?').item.json.pagoId }}`,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify($('¿Decisión?').item.json.cambios) }}",
    options: escrituraSecuencial
  }, reintentoEscritura),

  nodo('QR no disponible', 'n8n-nodes-base.set', 3.4, [2640, -60], {
    mode: 'raw',
    jsonOutput: "={{ { pagoId: $('¿Decisión?').item.json.pagoId, decision: 'error_verificacion', cambios: { estado: 'error_verificacion', motivo: '[E5] No se pudo generar el comprobante QR; se reintentará en la próxima revisión', prioridad: $('¿Decisión?').item.json.cambios.prioridad, fechaRevision: $now.toISO() } } }}",
    options: {}
  }),

  nodo('Pago omitido', 'n8n-nodes-base.noOp', 1, [2420, 0], {}),

  nodo('Registrar resultado del pago', 'n8n-nodes-base.httpRequest', 4.2, [2860, 100], {
    method: 'PATCH',
    url: `=${URL_JSON_SERVER}/pagos/{{ $json.pagoId }}`,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.cambios) }}',
    options: escrituraSecuencial
  }, reintentoEscritura),

  nodo('Registrar en bitácora', 'n8n-nodes-base.httpRequest', 4.2, [3080, -80], {
    method: 'POST',
    url: `=${URL_JSON_SERVER}/bitacora`,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ pagoId: $json.id, proveedorId: $json.proveedorId, estado: $json.estado, motivo: $json.motivo, prioridad: $json.prioridad, comprobante: $json.comprobante || null, qrUrl: $json.qrUrl || null, fecha: $now.toISO() }) }}',
    options: escrituraSecuencial
  }, reintentoEscritura)
];

const enlace = (...destinos) => destinos.map((salida) => salida.map((node) => ({ node, type: 'main', index: 0 })));

const conexiones = {
  'Ejecutar manualmente': { main: enlace(['Configuración']) },
  'Revisión diaria 7:00': { main: enlace(['Configuración']) },
  'Configuración': { main: enlace(['Obtener pagos por revisar']) },
  'Obtener pagos por revisar': { main: enlace(['¿Hay pagos por revisar?'], ['JSON Server no disponible']) },
  '¿Hay pagos por revisar?': { main: enlace(['Separar pagos'], ['Sin pagos por revisar']) },
  'Separar pagos': { main: enlace(['Obtener proveedor']) },
  'Obtener proveedor': { main: enlace(['Validar pago y proveedor (POO)']) },
  'Validar pago y proveedor (POO)': { main: enlace(['¿Consultar Hacienda?']) },
  '¿Consultar Hacienda?': { main: enlace(['Consultar Hacienda'], ['¿Decisión?']) },
  'Consultar Hacienda': { main: enlace(['Evaluar riesgo (POO)']) },
  'Evaluar riesgo (POO)': { main: enlace(['¿Decisión?']) },
  '¿Decisión?': { main: enlace(['Generar comprobante QR'], ['Pago omitido'], ['Registrar resultado del pago']) },
  'Generar comprobante QR': { main: enlace(['Registrar pago aprobado'], ['QR no disponible']) },
  'QR no disponible': { main: enlace(['Registrar resultado del pago']) },
  'Registrar pago aprobado': { main: enlace(['Registrar en bitácora']) },
  'Registrar resultado del pago': { main: enlace(['Registrar en bitácora']) }
};

const workflow = {
  id: 'PanelRiesgoQR001',
  name: 'Panel de riesgo de proveedores con comprobante QR',
  nodes: nodos,
  connections: conexiones,
  pinData: {},
  active: false,
  settings: { executionOrder: 'v1' },
  tags: []
};

const destino = path.join(raiz, 'n8n', 'workflow-panel-riesgo.json');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Workflow generado: ${path.relative(raiz, destino)} (${nodos.length} nodos)`);
