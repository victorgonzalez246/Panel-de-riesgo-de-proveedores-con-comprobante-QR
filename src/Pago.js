const { REGLAS, ESTADOS, fechaLocal } = require('./config');

class Pago {
  constructor({ id, proveedorId, monto, moneda, concepto, fechaVencimiento, estado, intentosVerificacion = 0 } = {}) {
    this.id = id;
    this.proveedorId = proveedorId;
    this.monto = monto;
    this.moneda = moneda;
    this.concepto = concepto;
    this.fechaVencimiento = fechaVencimiento;
    this.estado = estado;
    this.intentosVerificacion = Number(intentosVerificacion) || 0;
  }

  // R5: solo los pagos pendientes (o con verificación fallida) se revisan
  esProcesable() {
    return REGLAS.estadosProcesables.includes(this.estado);
  }

  // E4: datos mínimos para poder evaluar el pago
  camposFaltantes() {
    const faltantes = [];
    if (!this.proveedorId) faltantes.push('proveedorId');
    if (typeof this.monto !== 'number' || !Number.isFinite(this.monto) || this.monto <= 0) faltantes.push('monto');
    if (!REGLAS.monedasPermitidas.includes(this.moneda)) faltantes.push('moneda');
    if (!this.concepto) faltantes.push('concepto');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.fechaVencimiento || '')) faltantes.push('fechaVencimiento');
    return faltantes;
  }

  // R4: pagos grandes siempre los aprueba una persona
  requiereAprobacionManual() {
    const umbral = REGLAS.umbralRevisionManual[this.moneda];
    return umbral !== undefined && this.monto > umbral;
  }

  // R8: un pago vencido se atiende con prioridad alta
  estaVencido(hoy = new Date()) {
    return this.fechaVencimiento < fechaLocal(hoy);
  }

  prioridad(hoy = new Date()) {
    return this.estaVencido(hoy) ? 'alta' : 'normal';
  }

  // R9: el intento actual es el último permitido
  agotoIntentos() {
    return this.intentosVerificacion + 1 >= REGLAS.maxIntentosVerificacion;
  }

  montoFormateado() {
    return Pago.formatearMonto(this.monto, this.moneda);
  }

  static formatearMonto(monto, moneda) {
    const simbolo = moneda === 'USD' ? '$' : '₡';
    const [entero, decimales] = Number(monto).toFixed(2).split('.');
    return `${simbolo}${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimales}`;
  }

  // Transiciones de estado: cada una devuelve los cambios que se guardan en JSON Server

  aprobar(qrUrl, codigoComprobante, hoy = new Date()) {
    return this.#cambiarEstado(ESTADOS.APROBADO, '[OK] Proveedor al día con Hacienda; pago aprobado', hoy, {
      qrUrl,
      comprobante: codigoComprobante
    });
  }

  retener(motivo, hoy = new Date()) {
    return this.#cambiarEstado(ESTADOS.RETENIDO, motivo, hoy);
  }

  enviarARevision(motivo, hoy = new Date()) {
    return this.#cambiarEstado(ESTADOS.REVISION_MANUAL, motivo, hoy);
  }

  // Falla temporal: se reintenta en la próxima ejecución hasta agotar los intentos (R9)
  registrarFallaVerificacion(motivo, hoy = new Date()) {
    const intentos = this.intentosVerificacion + 1;
    if (this.agotoIntentos()) {
      return this.#cambiarEstado(
        ESTADOS.REVISION_MANUAL,
        `[R9] Se agotaron ${REGLAS.maxIntentosVerificacion} intentos de verificación. Último error: ${motivo}`,
        hoy,
        { intentosVerificacion: intentos }
      );
    }
    return this.#cambiarEstado(
      ESTADOS.ERROR_VERIFICACION,
      `${motivo} (intento ${intentos} de ${REGLAS.maxIntentosVerificacion}; se reintentará en la próxima revisión)`,
      hoy,
      { intentosVerificacion: intentos }
    );
  }

  #cambiarEstado(estado, motivo, hoy, extra = {}) {
    this.estado = estado;
    return {
      estado,
      motivo,
      prioridad: this.prioridad(hoy),
      fechaRevision: hoy.toISOString(),
      ...extra
    };
  }
}

module.exports = { Pago };
