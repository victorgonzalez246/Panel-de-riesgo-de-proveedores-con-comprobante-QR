// Prueba independiente de las clases (sin n8n).
//
//   node main.js            usa respuestas reales de Hacienda guardadas en data/respuestas-hacienda.json
//   node main.js --en-vivo  consulta la API de Hacienda en este momento
//   node main.js --en-vivo --guardar  además actualiza data/respuestas-hacienda.json

const fs = require('fs');
const path = require('path');
const { Proveedor } = require('./src/Proveedor');
const { Pago } = require('./src/Pago');
const { ComprobanteQR } = require('./src/ComprobanteQR');
const { EvaluadorRiesgo } = require('./src/EvaluadorRiesgo');
const { REGLAS_PREVIAS, REGLAS_TRIBUTARIAS, REGLAS_DE_MONTO } = require('./src/ReglaNegocio');
const { HistorialTendencia } = require('./src/HistorialTendencia');

const HACIENDA_URL = 'https://api.hacienda.go.cr/fe/ae';
const ARCHIVO_RESPUESTAS = path.join(__dirname, 'data', 'respuestas-hacienda.json');
const enVivo = process.argv.includes('--en-vivo');
const guardar = process.argv.includes('--guardar');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'db.inicial.json'), 'utf8'));
const respuestasGuardadas = fs.existsSync(ARCHIVO_RESPUESTAS)
  ? JSON.parse(fs.readFileSync(ARCHIVO_RESPUESTAS, 'utf8'))
  : {};

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

async function consultarHacienda(cedula) {
  if (!enVivo) {
    return respuestasGuardadas[cedula] || { error: { message: `sin respuesta guardada para ${cedula}` } };
  }
  try {
    const respuesta = await fetch(`${HACIENDA_URL}?identificacion=${cedula}`, { signal: AbortSignal.timeout(10000) });
    const body = await respuesta.json().catch(() => null);
    await esperar(1200); // Hacienda limita las consultas seguidas
    return { statusCode: respuesta.status, body };
  } catch (error) {
    return { error: { message: error.message } };
  }
}

// Simula GET /proveedores/:id de JSON Server
function buscarProveedor(proveedorId) {
  const proveedor = db.proveedores.find((p) => p.id === proveedorId);
  return proveedor ? { statusCode: 200, body: proveedor } : { statusCode: 404, body: {} };
}

function titulo(texto) {
  console.log(`\n${'='.repeat(78)}\n${texto}\n${'='.repeat(78)}`);
}

function mostrarResultado(resultado) {
  const cambios = resultado.cambios || {};
  console.log(`\n${resultado.pagoId}  →  ${resultado.decision.toUpperCase()}${cambios.prioridad ? `  (prioridad ${cambios.prioridad})` : ''}`);
  console.log(`   ${resultado.resumen}`);
  if (cambios.intentosVerificacion !== undefined) console.log(`   Intentos de verificación: ${cambios.intentosVerificacion}`);
  if (cambios.qrUrl) {
    console.log(`   Comprobante: ${cambios.comprobante}`);
    console.log(`   QR: ${cambios.qrUrl.slice(0, 90)}...`);
  }
}

async function evaluarPago(evaluador, datosPago, respuestaHacienda) {
  const validacion = evaluador.validar(datosPago, buscarProveedor(datosPago.proveedorId));
  if (!validacion.consultarHacienda) return validacion;
  const respuesta = respuestaHacienda || (await consultarHacienda(validacion.cedula));
  return evaluador.evaluar(validacion.pago, validacion.proveedor, respuesta);
}

async function main() {
  const hoy = new Date();
  const evaluador = new EvaluadorRiesgo({ hoy });

  titulo('1. Métodos de las clases Proveedor y Pago');

  const ucr = new Proveedor(db.proveedores.find((p) => p.id === 'PRV-001'));
  const malRegistrado = new Proveedor(db.proveedores.find((p) => p.id === 'PRV-005'));
  const recope = new Proveedor(db.proveedores.find((p) => p.id === 'PRV-006'));
  console.log(`${ucr.nombre}: validarCedula() = ${ucr.validarCedula()}, estaActivo() = ${ucr.estaActivo()}`);
  console.log(`${malRegistrado.nombre}: validarCedula() = ${malRegistrado.validarCedula()}  (cédula "${malRegistrado.cedula}")`);
  console.log(`${recope.nombre}: estaActivo() = ${recope.estaActivo()}`);

  const ice = new Proveedor(db.proveedores.find((p) => p.id === 'PRV-002'));
  ice.registrarSituacionHacienda((await consultarHacienda(ice.cedula)).body);
  console.log(`${ice.nombre}: estaMoroso() = ${ice.estaMoroso()}, estaOmiso() = ${ice.estaOmiso()}, estaInscrito() = ${ice.estaInscrito()}`);

  const pagoNormal = new Pago(db.pagos.find((p) => p.id === 'PAG-001'));
  const pagoGrande = new Pago(db.pagos.find((p) => p.id === 'PAG-003'));
  const pagoVencido = new Pago(db.pagos.find((p) => p.id === 'PAG-008'));
  const pagoIncompleto = new Pago(db.pagos.find((p) => p.id === 'PAG-007'));
  const pagoYaAprobado = new Pago(db.pagos.find((p) => p.id === 'PAG-010'));
  console.log(`${pagoNormal.id} ${pagoNormal.montoFormateado()}: requiereAprobacionManual() = ${pagoNormal.requiereAprobacionManual()}, estaVencido() = ${pagoNormal.estaVencido(hoy)}`);
  console.log(`${pagoGrande.id} ${pagoGrande.montoFormateado()}: requiereAprobacionManual() = ${pagoGrande.requiereAprobacionManual()}`);
  console.log(`${pagoVencido.id} vence ${pagoVencido.fechaVencimiento}: estaVencido() = ${pagoVencido.estaVencido(hoy)}, prioridad() = ${pagoVencido.prioridad(hoy)}`);
  console.log(`${pagoIncompleto.id}: camposFaltantes() = [${pagoIncompleto.camposFaltantes().join(', ')}]`);
  console.log(`${pagoYaAprobado.id} (estado "${pagoYaAprobado.estado}"): esProcesable() = ${pagoYaAprobado.esProcesable()}`);

  const comprobante = new ComprobanteQR(pagoNormal, ucr, { fecha: hoy });
  console.log(`\nComprobanteQR.codigo() = ${comprobante.codigo()}`);
  console.log(`ComprobanteQR.contenido():\n  ${comprobante.contenido().split('\n').join('\n  ')}`);

  titulo('2. Polimorfismo: la misma lista de reglas, evaluar() sobre dos casos distintos');

  ucr.registrarSituacionHacienda((await consultarHacienda(ucr.cedula)).body);
  const casos = [
    [`ICE (moroso) + ${pagoNormal.id} ${pagoNormal.montoFormateado()}`, { proveedor: ice, pago: pagoNormal }],
    [`UCR (al día) + ${pagoGrande.id} ${pagoGrande.montoFormateado()}`, { proveedor: ucr, pago: pagoGrande }]
  ];
  for (const [nombre, contexto] of casos) {
    console.log(`\n${nombre}`);
    for (const regla of [...REGLAS_PREVIAS(), ...REGLAS_TRIBUTARIAS(), ...REGLAS_DE_MONTO()]) {
      const padre = Object.getPrototypeOf(regla.constructor).name;
      const resultado = regla.evaluar(contexto);
      console.log(`  ${regla.codigo}  ${regla.constructor.name.padEnd(24)} extends ${padre.padEnd(20)} → ${resultado ? resultado.motivo : 'no aplica'}`);
    }
  }

  titulo(`3. Evaluación de todos los pagos de db.json (Hacienda: ${enVivo ? 'EN VIVO' : 'respuestas reales guardadas'})`);

  const resumen = {};
  for (const datosPago of db.pagos) {
    const resultado = await evaluarPago(evaluador, datosPago);
    mostrarResultado(resultado);
    resumen[resultado.decision] = (resumen[resultado.decision] || 0) + 1;
  }
  console.log('\nResumen:', resumen);

  titulo('4. Situaciones inesperadas simuladas');

  const pagoPrueba = db.pagos.find((p) => p.id === 'PAG-001');

  console.log('\nHacienda no responde (timeout) en el primer intento:');
  mostrarResultado(await evaluarPago(evaluador, pagoPrueba, { error: { message: 'The operation was aborted due to timeout' } }));

  console.log('\nHacienda responde 503 y el pago ya lleva 2 intentos fallidos:');
  mostrarResultado(await evaluarPago(evaluador, { ...pagoPrueba, estado: 'error_verificacion', intentosVerificacion: 2 }, { statusCode: 503, body: null }));

  console.log('\nHacienda responde 200 pero sin la situación tributaria:');
  mostrarResultado(await evaluarPago(evaluador, pagoPrueba, { statusCode: 200, body: { nombre: 'UNIVERSIDAD DE COSTA RICA' } }));

  console.log('\nProveedor omiso y con inscripción desinscrita:');
  mostrarResultado(await evaluarPago(evaluador, pagoPrueba, {
    statusCode: 200,
    body: { nombre: 'UNIVERSIDAD DE COSTA RICA', situacion: { moroso: 'NO', omiso: 'SI', estado: 'Desinscrito' } }
  }));

  titulo('5. Tendencia del riesgo (HistorialTendencia, reto 4 de la extensión)');

  const historial = [
    { fecha: '2026-10-15T13:00:00Z', totales: { aprobado: 8, retenido: 1, revision_manual: 1 } },
    { fecha: '2026-10-16T13:00:00Z', totales: { aprobado: 9, retenido: 1 } }
  ];
  const totalesHoy = resumen.aprobado !== undefined
    ? { aprobado: resumen.aprobado || 0, retenido: resumen.retenido || 0, revision_manual: resumen.revision_manual || 0 }
    : {};
  console.log(`Revisiones anteriores: ${historial.map((r) => `${r.fecha.slice(0, 10)} → ${Math.round(HistorialTendencia.indiceRiesgo(r.totales) * 100)} %`).join(', ')}`);
  console.log(`Revisión de hoy: ${JSON.stringify(totalesHoy)} → ${Math.round(HistorialTendencia.indiceRiesgo(totalesHoy) * 100)} %`);
  const tendencia = new HistorialTendencia(historial).analizar(totalesHoy);
  console.log(`${tendencia.etiqueta.toUpperCase()}: ${tendencia.mensaje}`);
  console.log(`Sin historial: ${new HistorialTendencia([]).analizar(totalesHoy).mensaje}`);

  if (enVivo && guardar) {
    const respuestas = {};
    for (const proveedor of db.proveedores) {
      if (new Proveedor(proveedor).validarCedula()) respuestas[proveedor.cedula] = await consultarHacienda(proveedor.cedula);
    }
    fs.writeFileSync(ARCHIVO_RESPUESTAS, `${JSON.stringify(respuestas, null, 2)}\n`);
    console.log(`\nRespuestas de Hacienda guardadas en ${path.relative(__dirname, ARCHIVO_RESPUESTAS)}`);
  }
}

main();
