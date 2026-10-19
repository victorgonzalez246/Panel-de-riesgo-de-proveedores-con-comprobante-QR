const test = require('node:test');
const assert = require('node:assert/strict');
const { Proveedor } = require('../src/Proveedor');
const { Pago } = require('../src/Pago');
const { ComprobanteQR } = require('../src/ComprobanteQR');
const { EvaluadorRiesgo } = require('../src/EvaluadorRiesgo');

const HOY = new Date('2026-10-19T15:00:00Z');
const evaluador = new EvaluadorRiesgo({ hoy: HOY });

const proveedorBase = { id: 'PRV-001', nombre: 'Universidad de Costa Rica', cedula: '4000042149', tipoCedula: '02', activo: true };
const pagoBase = {
  id: 'PAG-001', proveedorId: 'PRV-001', monto: 850000, moneda: 'CRC', concepto: 'Capacitación',
  fechaVencimiento: '2026-10-30', estado: 'pendiente', intentosVerificacion: 0
};
const haciendaAlDia = { statusCode: 200, body: { nombre: 'UCR', situacion: { moroso: 'NO', omiso: 'NO', estado: 'Inscrito' } } };
const proveedorOk = (datos = {}) => ({ statusCode: 200, body: { ...proveedorBase, ...datos } });

function evaluarCompleto(pago, respuestaProveedor, respuestaHacienda) {
  const validacion = evaluador.validar(pago, respuestaProveedor);
  if (!validacion.consultarHacienda) return validacion;
  return evaluador.evaluar(validacion.pago, validacion.proveedor, respuestaHacienda);
}

const situacion = (cambios) => ({ statusCode: 200, body: { situacion: { moroso: 'NO', omiso: 'NO', estado: 'Inscrito', ...cambios } } });

test('Proveedor al día y monto normal → aprobado con QR', () => {
  const r = evaluarCompleto(pagoBase, proveedorOk(), haciendaAlDia);
  assert.equal(r.decision, 'aprobado');
  assert.equal(r.cambios.estado, 'aprobado');
  assert.match(r.cambios.qrUrl, /^https:\/\/api\.qrserver\.com\/v1\/create-qr-code\/\?size=250x250&data=/);
  assert.equal(r.cambios.comprobante, 'CMP-PAG-001-20261019');
});

test('R1 moroso → retenido', () => {
  const r = evaluarCompleto(pagoBase, proveedorOk(), situacion({ moroso: 'SI' }));
  assert.equal(r.decision, 'retenido');
  assert.match(r.cambios.motivo, /\[R1\]/);
});

test('R2 omiso → retenido', () => {
  const r = evaluarCompleto(pagoBase, proveedorOk(), situacion({ omiso: 'SI' }));
  assert.equal(r.decision, 'retenido');
  assert.match(r.cambios.motivo, /\[R2\]/);
});

test('R3 inscripción no válida → retenido; "Inscrito de oficio" sí es válido', () => {
  assert.equal(evaluarCompleto(pagoBase, proveedorOk(), situacion({ estado: 'Desinscrito' })).decision, 'retenido');
  assert.equal(evaluarCompleto(pagoBase, proveedorOk(), situacion({ estado: 'Inscrito de oficio' })).decision, 'aprobado');
});

test('R4 monto sobre el umbral → revisión manual (CRC y USD)', () => {
  assert.equal(evaluarCompleto({ ...pagoBase, monto: 5000001 }, proveedorOk(), haciendaAlDia).decision, 'revision_manual');
  assert.equal(evaluarCompleto({ ...pagoBase, monto: 5000000 }, proveedorOk(), haciendaAlDia).decision, 'aprobado');
  assert.equal(evaluarCompleto({ ...pagoBase, moneda: 'USD', monto: 10001 }, proveedorOk(), haciendaAlDia).decision, 'revision_manual');
});

test('R5 un pago ya aprobado no se reevalúa; uno con error previo sí', () => {
  assert.equal(evaluador.validar({ ...pagoBase, estado: 'aprobado' }, proveedorOk()).decision, 'omitido');
  assert.equal(evaluador.validar({ ...pagoBase, estado: 'error_verificacion' }, proveedorOk()).consultarHacienda, true);
});

test('R6 cédula inválida → retenido sin consultar Hacienda', () => {
  const r = evaluador.validar(pagoBase, proveedorOk({ cedula: '12-345' }));
  assert.equal(r.consultarHacienda, false);
  assert.equal(r.decision, 'retenido');
  assert.match(r.cambios.motivo, /\[R6\]/);
  assert.equal(new Proveedor({ cedula: '123456789', tipoCedula: '01' }).validarCedula(), true);
  assert.equal(new Proveedor({ cedula: '123456789', tipoCedula: '02' }).validarCedula(), false);
});

test('R7 proveedor inactivo → retenido sin consultar Hacienda', () => {
  const r = evaluador.validar(pagoBase, proveedorOk({ activo: false }));
  assert.equal(r.consultarHacienda, false);
  assert.match(r.cambios.motivo, /\[R7\]/);
});

test('R8 pago vencido → prioridad alta', () => {
  const r = evaluarCompleto({ ...pagoBase, fechaVencimiento: '2026-10-10' }, proveedorOk(), haciendaAlDia);
  assert.equal(r.cambios.prioridad, 'alta');
  assert.equal(new Pago(pagoBase).prioridad(HOY), 'normal');
});

test('R9 al tercer intento fallido → revisión manual', () => {
  const caida = { error: { message: 'timeout' } };
  const r1 = evaluarCompleto({ ...pagoBase, intentosVerificacion: 0 }, proveedorOk(), caida);
  assert.equal(r1.decision, 'error_verificacion');
  assert.equal(r1.cambios.intentosVerificacion, 1);
  const r3 = evaluarCompleto({ ...pagoBase, estado: 'error_verificacion', intentosVerificacion: 2 }, proveedorOk(), caida);
  assert.equal(r3.decision, 'revision_manual');
  assert.match(r3.cambios.motivo, /\[R9\]/);
});

test('E1 cédula no registrada en Hacienda (404) → retenido', () => {
  const r = evaluarCompleto(pagoBase, proveedorOk(), { statusCode: 404, body: { code: 404 } });
  assert.equal(r.decision, 'retenido');
  assert.match(r.cambios.motivo, /\[E1\]/);
});

test('E2 Hacienda caída, 5xx, 429 o sin situación → error de verificación', () => {
  for (const respuesta of [{ error: { message: 'ECONNREFUSED' } }, { statusCode: 500 }, { statusCode: 429 }, { statusCode: 200, body: {} }]) {
    const r = evaluarCompleto(pagoBase, proveedorOk(), respuesta);
    assert.equal(r.decision, 'error_verificacion');
    assert.match(r.cambios.motivo, /\[E2\]/);
  }
});

test('E3 proveedor inexistente en JSON Server → revisión manual', () => {
  const r = evaluador.validar({ ...pagoBase, proveedorId: 'PRV-099' }, { statusCode: 404, body: {} });
  assert.equal(r.decision, 'revision_manual');
  assert.match(r.cambios.motivo, /\[E3\]/);
});

test('E4 pago con datos incompletos → revisión manual', () => {
  const { monto, ...sinMonto } = pagoBase;
  const r = evaluador.validar(sinMonto, proveedorOk());
  assert.equal(r.decision, 'revision_manual');
  assert.match(r.cambios.motivo, /falta monto/);
  assert.deepEqual(new Pago({ ...pagoBase, moneda: 'EUR', monto: -5 }).camposFaltantes(), ['monto', 'moneda']);
});

test('El QR contiene los datos del pago', () => {
  const qr = new ComprobanteQR(new Pago(pagoBase), new Proveedor(proveedorBase), { fecha: HOY });
  const datos = decodeURIComponent(new URL(qr.url()).searchParams.get('data'));
  assert.match(datos, /Pago: PAG-001/);
  assert.match(datos, /Cedula: 4000042149/);
  assert.match(datos, /Monto: ₡850\.000,00/);
});
