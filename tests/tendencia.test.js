const test = require('node:test');
const assert = require('node:assert/strict');
const { HistorialTendencia } = require('../src/HistorialTendencia');

const revision = (fecha, totales) => ({ fecha, totales });
const historial = [
  revision('2026-10-15T13:00:00Z', { aprobado: 8, retenido: 1, revision_manual: 1 }), // 20 %
  revision('2026-10-16T13:00:00Z', { aprobado: 7, retenido: 2, revision_manual: 1 }), // 30 %
  revision('2026-10-17T13:00:00Z', { aprobado: 9, retenido: 1 })                      // 10 %
];

test('Índice de riesgo = detenidos + revisión manual sobre revisados', () => {
  assert.equal(HistorialTendencia.indiceRiesgo({ aprobado: 2, retenido: 4, revision_manual: 3 }), 7 / 9);
  assert.equal(HistorialTendencia.indiceRiesgo({ aprobado: 5 }), 0);
  assert.equal(HistorialTendencia.indiceRiesgo({}), null);
});

test('Empeorando cuando el riesgo sube más de 10 puntos sobre el promedio', () => {
  const r = new HistorialTendencia(historial).analizar({ aprobado: 2, retenido: 4, revision_manual: 3 });
  assert.equal(r.tendencia, 'empeorando');
  assert.equal(r.revisionesComparadas, 3);
  assert.equal(r.indicePrevio, 0.2);
  assert.match(r.mensaje, /78 %.*20 %.*últimas 3 revisiones/);
});

test('Mejorando cuando baja más de 10 puntos', () => {
  const r = new HistorialTendencia([revision('2026-10-17', { aprobado: 2, retenido: 6, revision_manual: 2 })]).analizar({ aprobado: 9, retenido: 1 });
  assert.equal(r.tendencia, 'mejorando');
  assert.match(r.mensaje, /revisión anterior/);
});

test('Estable dentro del margen de ±10 puntos', () => {
  assert.equal(new HistorialTendencia(historial).analizar({ aprobado: 8, retenido: 2 }).tendencia, 'estable');
});

test('Sin historial en la primera revisión; ignora revisiones vacías y respeta la ventana', () => {
  assert.equal(new HistorialTendencia([]).analizar({ aprobado: 1 }).tendencia, 'sin_historial');
  assert.equal(new HistorialTendencia([revision('2026-10-17', {})]).analizar({ aprobado: 1 }).tendencia, 'sin_historial');
  const muchas = Array.from({ length: 8 }, (_, i) => revision(`2026-10-0${i + 1}`, { aprobado: 1 }));
  assert.equal(new HistorialTendencia(muchas, { ventana: 5 }).revisiones.length, 5);
});
