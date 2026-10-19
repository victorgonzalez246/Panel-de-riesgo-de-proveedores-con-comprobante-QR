// Pruebas de los pilares de POO: abstracción, herencia, polimorfismo y encapsulamiento
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ReglaNegocio, ReglaRetencion, ReglaRevisionManual,
  ReglaMoroso, ReglaOmiso, ReglaNoInscrito, ReglaMontoAlto, ReglaCedulaInvalida, ReglaProveedorInactivo
} = require('../src/ReglaNegocio');
const { Proveedor } = require('../src/Proveedor');
const { Pago } = require('../src/Pago');
const { EvaluadorRiesgo } = require('../src/EvaluadorRiesgo');

const proveedorMoroso = () => {
  const p = new Proveedor({ id: 'PRV-002', nombre: 'ICE', cedula: '4000042139', tipoCedula: '02' });
  p.registrarSituacionHacienda({ situacion: { moroso: 'SI', omiso: 'NO', estado: 'Inscrito' } });
  return p;
};

test('Abstracción: las clases base no se pueden instanciar', () => {
  assert.throws(() => new ReglaNegocio('X'), /abstracta/);
  assert.throws(() => new ReglaRetencion('X'), /abstracta/);
  assert.throws(() => new ReglaRevisionManual('X'), /abstracta/);
});

test('Abstracción: una subclase que no implementa aplica() avisa el error', () => {
  class ReglaIncompleta extends ReglaRetencion {}
  assert.throws(() => new ReglaIncompleta('R99').evaluar({}), /debe implementar aplica/);
});

test('Herencia: cada regla hereda de su clase intermedia y de ReglaNegocio', () => {
  for (const Clase of [ReglaMoroso, ReglaOmiso, ReglaNoInscrito, ReglaCedulaInvalida, ReglaProveedorInactivo]) {
    const regla = new Clase();
    assert.ok(regla instanceof ReglaRetencion, `${Clase.name} es ReglaRetencion`);
    assert.ok(regla instanceof ReglaNegocio);
    assert.equal(regla.decision, 'retenido');
  }
  const montoAlto = new ReglaMontoAlto();
  assert.ok(montoAlto instanceof ReglaRevisionManual);
  assert.equal(montoAlto.decision, 'revision_manual');
});

test('Polimorfismo: el mismo evaluar() da resultados distintos según la subclase', () => {
  const contexto = { proveedor: proveedorMoroso(), pago: new Pago({ monto: 9000000, moneda: 'CRC' }) };
  const resultados = [new ReglaMoroso(), new ReglaOmiso(), new ReglaMontoAlto()].map((r) => r.evaluar(contexto));
  assert.deepEqual(resultados[0], { codigo: 'R1', decision: 'retenido', motivo: '[R1] Proveedor moroso ante Hacienda' });
  assert.equal(resultados[1], null);
  assert.equal(resultados[2].decision, 'revision_manual');
});

test('Extensión: una regla nueva se agrega sin modificar EvaluadorRiesgo', () => {
  class ReglaProveedorBloqueado extends ReglaRetencion {
    constructor() { super('R10'); }
    aplica({ proveedor }) { return proveedor.cedula === '4000042149'; }
    motivo() { return 'Proveedor en lista de bloqueo interna'; }
  }
  const evaluador = new EvaluadorRiesgo({ reglasPrevias: [new ReglaProveedorBloqueado()] });
  const pago = { id: 'PAG-X', proveedorId: 'PRV-001', monto: 1000, moneda: 'CRC', concepto: 'x', fechaVencimiento: '2026-12-01', estado: 'pendiente' };
  const r = evaluador.validar(pago, { statusCode: 200, body: { id: 'PRV-001', nombre: 'UCR', cedula: '4000042149', tipoCedula: '02' } });
  assert.equal(r.decision, 'retenido');
  assert.equal(r.cambios.motivo, '[R10] Proveedor en lista de bloqueo interna');
});

test('Encapsulamiento: el cambio de estado del pago solo ocurre por sus métodos', () => {
  const pago = new Pago({ id: 'PAG-1', estado: 'pendiente', monto: 1, moneda: 'CRC' });
  assert.equal(typeof pago.cambiarEstado, 'undefined'); // #cambiarEstado es privado
  const cambios = pago.retener('[R1] prueba', new Date('2026-10-19T12:00:00Z'));
  assert.equal(pago.estado, 'retenido');
  assert.equal(cambios.estado, 'retenido');
});
