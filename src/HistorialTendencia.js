// Reto 4 de la extensión: ¿el riesgo de los proveedores va mejorando o empeorando?
//
// Índice de riesgo de una revisión = pagos detenidos o enviados a revisión manual / pagos revisados.
// La revisión actual se compara con el promedio de las anteriores (hasta `ventana` revisiones).

const ETIQUETAS_TENDENCIA = {
  empeorando: 'Empeorando',
  mejorando: 'Mejorando',
  estable: 'Estable',
  sin_historial: 'Sin historial'
};

class HistorialTendencia {
  constructor(revisionesAnteriores = [], { ventana = 5, margen = 0.1 } = {}) {
    this.ventana = ventana;
    this.margen = margen; // diferencia mínima (en proporción) para hablar de cambio: 0.1 = 10 puntos
    // Solo cuentan las revisiones que revisaron al menos un pago; de la más reciente a la más antigua
    this.revisiones = revisionesAnteriores
      .filter((r) => r && r.totales && HistorialTendencia.revisados(r.totales) > 0)
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
      .slice(0, ventana);
  }

  static revisados(totales) {
    return Object.values(totales || {}).reduce((suma, n) => suma + (Number(n) || 0), 0);
  }

  // Proporción de pagos con problema (0 a 1); null si no se revisó nada
  static indiceRiesgo(totales) {
    const revisados = HistorialTendencia.revisados(totales);
    if (!revisados) return null;
    return ((Number(totales.retenido) || 0) + (Number(totales.revision_manual) || 0)) / revisados;
  }

  static porcentaje(indice) {
    return `${Math.round(indice * 100)} %`;
  }

  promedioAnterior() {
    if (!this.revisiones.length) return null;
    const indices = this.revisiones.map((r) => HistorialTendencia.indiceRiesgo(r.totales));
    return indices.reduce((suma, i) => suma + i, 0) / indices.length;
  }

  // totalesActuales = { aprobado, retenido, revision_manual, error_verificacion } de la revisión que termina
  analizar(totalesActuales) {
    const indiceActual = HistorialTendencia.indiceRiesgo(totalesActuales);
    const indicePrevio = this.promedioAnterior();
    const comparadas = this.revisiones.length;

    if (indiceActual === null || indicePrevio === null) {
      return this.#resultado('sin_historial', indiceActual, null, comparadas,
        'Es la primera revisión registrada: todavía no hay con qué comparar.');
    }

    const diferencia = indiceActual - indicePrevio;
    const ahora = HistorialTendencia.porcentaje(indiceActual);
    const antes = HistorialTendencia.porcentaje(indicePrevio);
    const referencia = comparadas === 1 ? 'en la revisión anterior' : `en promedio en las últimas ${comparadas} revisiones`;

    if (diferencia > this.margen) {
      return this.#resultado('empeorando', indiceActual, indicePrevio, comparadas,
        `El riesgo subió: el ${ahora} de los pagos quedó detenido o en revisión, frente al ${antes} ${referencia}.`);
    }
    if (diferencia < -this.margen) {
      return this.#resultado('mejorando', indiceActual, indicePrevio, comparadas,
        `El riesgo bajó: el ${ahora} de los pagos quedó detenido o en revisión, frente al ${antes} ${referencia}.`);
    }
    return this.#resultado('estable', indiceActual, indicePrevio, comparadas,
      `Sin cambios importantes: el ${ahora} de los pagos quedó detenido o en revisión (${antes} ${referencia}).`);
  }

  #resultado(tendencia, indiceActual, indicePrevio, comparadas, mensaje) {
    return {
      tendencia,
      etiqueta: ETIQUETAS_TENDENCIA[tendencia],
      indiceActual: indiceActual === null ? null : Math.round(indiceActual * 1000) / 1000,
      indicePrevio: indicePrevio === null ? null : Math.round(indicePrevio * 1000) / 1000,
      revisionesComparadas: comparadas,
      mensaje
    };
  }
}

module.exports = { HistorialTendencia, ETIQUETAS_TENDENCIA };
