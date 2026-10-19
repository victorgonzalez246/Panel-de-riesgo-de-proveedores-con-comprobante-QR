// Parámetros de negocio compartidos por todas las clases.
// Si se cambia un umbral aquí, cambia también en el nodo Code del workflow
// (scripts/build-workflow.js copia este archivo dentro de los nodos Code).

const REGLAS = {
  // R4: montos que exigen aprobación manual aunque el proveedor esté al día
  umbralRevisionManual: { CRC: 5000000, USD: 10000 },
  monedasPermitidas: ['CRC', 'USD'],
  // R5: solo estos estados entran a la revisión automática
  estadosProcesables: ['pendiente', 'error_verificacion'],
  // R9: intentos de verificación antes de enviar el pago a revisión manual
  maxIntentosVerificacion: 3,
  // R3: situaciones de inscripción que Hacienda considera válidas
  estadosHaciendaValidos: ['Inscrito', 'Inscrito de oficio'],
  zonaHoraria: 'America/Costa_Rica'
};

const ESTADOS = {
  PENDIENTE: 'pendiente',
  APROBADO: 'aprobado',
  RETENIDO: 'retenido',
  REVISION_MANUAL: 'revision_manual',
  ERROR_VERIFICACION: 'error_verificacion'
};

// Fecha local de Costa Rica en formato AAAA-MM-DD
function fechaLocal(fecha) {
  return fecha.toLocaleDateString('en-CA', { timeZone: REGLAS.zonaHoraria });
}

module.exports = { REGLAS, ESTADOS, fechaLocal };
