const test = require('node:test');
const assert = require('node:assert/strict');
const { ResumenRevision } = require('../src/ResumenRevision');

const FECHA = new Date('2026-10-19T15:00:00Z');
const base = { moneda: 'CRC', concepto: 'Servicio', prioridad: 'normal' };

function resumenEjemplo() {
  return new ResumenRevision({ fecha: FECHA })
    .agregar({ ...base, id: 'PAG-001', monto: 850000, estado: 'aprobado', motivo: '[OK] al día', qrUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=x', comprobante: 'CMP-PAG-001-20261019' }, 'Universidad de Costa Rica')
    .agregar({ ...base, id: 'PAG-002', monto: 1200000, estado: 'retenido', motivo: '[R1] Proveedor moroso ante Hacienda' }, 'ICE')
    .agregar({ ...base, id: 'PAG-003', monto: 7500000, estado: 'revision_manual', motivo: '[R4] monto alto' }, 'Banco Nacional');
}

test('Detecta situaciones críticas y morosos', () => {
  const r = resumenEjemplo();
  assert.equal(r.hayCriticos(), true);
  assert.equal(r.criticos().length, 2);
  assert.equal(r.morosos().length, 1);
  assert.deepEqual(r.totales(), { aprobado: 1, retenido: 1, revision_manual: 1 });
});

test('El asunto destaca a los morosos y la cantidad de pagos a atender', () => {
  assert.equal(resumenEjemplo().asunto(), '[Panel de riesgo] 1 proveedor moroso · 2 pagos requieren atención · 2026-10-19');
});

test('Sin críticos no se envía correo', () => {
  const r = new ResumenRevision({ fecha: FECHA }).agregar({ ...base, id: 'PAG-001', monto: 1, estado: 'aprobado', motivo: '[OK]' }, 'UCR');
  assert.equal(r.aJSON().enviar, false);
});

test('El HTML incluye cada sección, el QR del aprobado y escapa el texto', () => {
  const r = resumenEjemplo().agregar({ ...base, id: 'PAG-9', monto: 1, estado: 'retenido', motivo: '<script>x</script>' }, 'A & B');
  const html = r.html();
  assert.match(html, /Pagos retenidos \(2\)/);
  assert.match(html, /Requieren revisión manual \(1\)/);
  assert.match(html, /<img src="https:\/\/api\.qrserver\.com/);
  assert.match(html, /₡1\.200\.000,00/);
  assert.match(html, /A &amp; B/);
  assert.doesNotMatch(html, /<script>/);
});
