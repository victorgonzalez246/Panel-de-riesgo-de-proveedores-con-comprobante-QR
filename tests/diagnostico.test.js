const test = require('node:test');
const assert = require('node:assert/strict');
const { DiagnosticoProveedor } = require('../src/DiagnosticoProveedor');
const { Proveedor } = require('../src/Proveedor');

const FECHA = new Date('2026-10-19T15:00:00Z');
const hacienda = (situacion, nombre = 'UNIVERSIDAD DE COSTA RICA') => ({
  statusCode: 200,
  body: { nombre, situacion: { moroso: 'NO', omiso: 'NO', estado: 'Inscrito', ...situacion } }
});

test('Normaliza la cédula digitada con guiones o espacios', () => {
  assert.equal(Proveedor.normalizarCedula(' 4-000-042149 '), '4000042149');
  assert.equal(new DiagnosticoProveedor('4.000.042149').puedeConsultar(), true);
});

test('R6 cédula inválida → no se consulta Hacienda', () => {
  const d = new DiagnosticoProveedor('12-345', { fecha: FECHA });
  assert.equal(d.puedeConsultar(), false);
  const r = d.sinConsulta();
  assert.equal(r.resultado, 'cedula_invalida');
  assert.equal(r.apto, false);
  assert.equal(r.fecha, FECHA.toISOString());
});

test('Proveedor al día → apto con su nombre y situación', () => {
  const r = new DiagnosticoProveedor('4000042149').conRespuesta(hacienda({}));
  assert.equal(r.resultado, 'apto');
  assert.equal(r.apto, true);
  assert.equal(r.nombre, 'UNIVERSIDAD DE COSTA RICA');
  assert.deepEqual(r.situacion, { moroso: 'NO', omiso: 'NO', estado: 'Inscrito' });
});

test('R1/R2/R3 → no apto con todos los motivos', () => {
  const r = new DiagnosticoProveedor('4000042139').conRespuesta(hacienda({ moroso: 'SI', omiso: 'SI' }, 'ICE'));
  assert.equal(r.resultado, 'no_apto');
  assert.equal(r.motivos.length, 2);
  assert.match(r.motivos[0], /\[R1\]/);
  assert.match(r.motivos[1], /\[R2\]/);
});

test('E1 404 → no registrado; E2 caída → error de consulta', () => {
  assert.equal(new DiagnosticoProveedor('3101000107').conRespuesta({ statusCode: 404 }).resultado, 'no_registrado');
  const caida = new DiagnosticoProveedor('3101000107').conRespuesta({ error: { message: 'ENOTFOUND' } });
  assert.equal(caida.resultado, 'error_consulta');
  assert.match(caida.motivos[0], /ENOTFOUND/);
});
