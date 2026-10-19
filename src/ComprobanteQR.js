const { fechaLocal } = require('./config');

const QR_BASE_URL = 'https://api.qrserver.com/v1/create-qr-code/';

// Comprobante visual de un pago aprobado: el QR contiene los datos del pago
class ComprobanteQR {
  constructor(pago, proveedor, { fecha = new Date(), baseUrl = QR_BASE_URL, tamano = 250 } = {}) {
    this.pago = pago;
    this.proveedor = proveedor;
    this.fecha = fecha;
    this.baseUrl = baseUrl;
    this.tamano = tamano;
  }

  codigo() {
    return `CMP-${this.pago.id}-${fechaLocal(this.fecha).replace(/-/g, '')}`;
  }

  contenido() {
    return [
      'COMPROBANTE DE PAGO APROBADO',
      `Comprobante: ${this.codigo()}`,
      `Pago: ${this.pago.id}`,
      `Proveedor: ${this.proveedor.nombre}`,
      `Cedula: ${this.proveedor.cedula}`,
      `Monto: ${this.pago.montoFormateado()}`,
      `Concepto: ${this.pago.concepto}`,
      `Verificado en Hacienda: ${fechaLocal(this.fecha)}`
    ].join('\n');
  }

  url() {
    return `${this.baseUrl}?size=${this.tamano}x${this.tamano}&data=${encodeURIComponent(this.contenido())}`;
  }
}

module.exports = { ComprobanteQR, QR_BASE_URL };
