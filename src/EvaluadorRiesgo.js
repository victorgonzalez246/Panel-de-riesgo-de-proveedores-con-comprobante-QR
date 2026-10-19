const { Proveedor } = require('./Proveedor');
const { Pago } = require('./Pago');
const { ComprobanteQR, QR_BASE_URL } = require('./ComprobanteQR');

// Clasifica una respuesta HTTP. Acepta la forma que entrega n8n con "Full Response"
// ({ statusCode, body }) o el error que deja "Continue On Fail" ({ error }).
function clasificarRespuesta(respuesta) {
  if (!respuesta) return { tipo: 'caida', detalle: 'sin respuesta' };
  if (respuesta.error) {
    const detalle = respuesta.error.message || respuesta.error.description || String(respuesta.error);
    return { tipo: 'caida', detalle };
  }
  const codigo = Number(respuesta.statusCode);
  if (codigo === 200) return { tipo: 'ok', body: respuesta.body };
  if (codigo === 404) return { tipo: 'no_encontrado', codigo };
  if (codigo === 429 || codigo >= 500) return { tipo: 'caida', detalle: `código HTTP ${codigo}` };
  return { tipo: 'inesperada', detalle: `código HTTP ${codigo}` };
}

// Decide qué pasa con cada pago. Trabaja en dos pasos, igual que el workflow:
//   1. validar(): reglas que no necesitan a Hacienda (antes del HTTP a Hacienda)
//   2. evaluar(): reglas con la situación tributaria (después del HTTP a Hacienda)
class EvaluadorRiesgo {
  constructor({ hoy = new Date(), qrBaseUrl = QR_BASE_URL } = {}) {
    this.hoy = hoy;
    this.qrBaseUrl = qrBaseUrl;
  }

  // Paso 1. respuestaProveedor = respuesta de GET /proveedores/:id en JSON Server
  validar(datosPago, respuestaProveedor) {
    const pago = new Pago(datosPago);

    if (!pago.esProcesable()) {
      return this.#resultado(pago, null, 'omitido', null, `[R5] El pago está en estado "${pago.estado}" y no se reevalúa`);
    }

    const faltantes = pago.camposFaltantes();
    if (faltantes.length > 0) {
      const cambios = pago.enviarARevision(`[E4] Datos incompletos del pago: falta ${faltantes.join(', ')}`, this.hoy);
      return this.#resultado(pago, null, cambios.estado, cambios);
    }

    const consulta = clasificarRespuesta(respuestaProveedor);
    if (consulta.tipo === 'no_encontrado' || (consulta.tipo === 'ok' && !consulta.body)) {
      const cambios = pago.enviarARevision(`[E3] El proveedor ${pago.proveedorId} no existe en el registro de la empresa`, this.hoy);
      return this.#resultado(pago, null, cambios.estado, cambios);
    }
    if (consulta.tipo !== 'ok') {
      const cambios = pago.registrarFallaVerificacion(`[E2] No se pudo consultar el proveedor en JSON Server (${consulta.detalle})`, this.hoy);
      return this.#resultado(pago, null, cambios.estado, cambios);
    }

    const datosProveedor = consulta.body;
    const proveedor = new Proveedor(datosProveedor);

    if (!proveedor.estaActivo()) {
      const cambios = pago.retener(`[R7] El proveedor ${proveedor.nombre} está inactivo en el registro de la empresa`, this.hoy);
      return this.#resultado(pago, datosProveedor, cambios.estado, cambios);
    }
    if (!proveedor.validarCedula()) {
      const cambios = pago.retener(`[R6] La cédula "${proveedor.cedula}" no tiene un formato válido; no se consultó a Hacienda`, this.hoy);
      return this.#resultado(pago, datosProveedor, cambios.estado, cambios);
    }

    const resultado = this.#resultado(pago, datosProveedor, 'consultar_hacienda', null, 'Datos completos; falta verificar en Hacienda');
    resultado.consultarHacienda = true;
    resultado.cedula = proveedor.cedula;
    return resultado;
  }

  // Paso 2. respuestaHacienda = respuesta de GET api.hacienda.go.cr/fe/ae
  evaluar(datosPago, datosProveedor, respuestaHacienda) {
    const pago = new Pago(datosPago);
    const proveedor = new Proveedor(datosProveedor);
    const consulta = clasificarRespuesta(respuestaHacienda);

    if (consulta.tipo === 'no_encontrado') {
      const cambios = pago.retener(`[E1] La cédula ${proveedor.cedula} no está registrada en Hacienda`, this.hoy);
      return this.#resultado(pago, datosProveedor, cambios.estado, cambios);
    }
    if (consulta.tipo !== 'ok') {
      const cambios = pago.registrarFallaVerificacion(`[E2] Hacienda no respondió correctamente (${consulta.detalle})`, this.hoy);
      return this.#resultado(pago, datosProveedor, cambios.estado, cambios);
    }
    if (!consulta.body || !consulta.body.situacion) {
      const cambios = pago.registrarFallaVerificacion('[E2] Hacienda respondió sin la situación tributaria del proveedor', this.hoy);
      return this.#resultado(pago, datosProveedor, cambios.estado, cambios);
    }

    proveedor.registrarSituacionHacienda(consulta.body);
    const impedimentos = proveedor.impedimentosTributarios();
    if (impedimentos.length > 0) {
      const cambios = pago.retener(impedimentos.join('; '), this.hoy);
      return this.#resultado(pago, datosProveedor, cambios.estado, cambios, null, proveedor.situacion);
    }

    if (pago.requiereAprobacionManual()) {
      const cambios = pago.enviarARevision(
        `[R4] Proveedor al día, pero el monto ${pago.montoFormateado()} supera el umbral de aprobación automática`,
        this.hoy
      );
      return this.#resultado(pago, datosProveedor, cambios.estado, cambios, null, proveedor.situacion);
    }

    const comprobante = new ComprobanteQR(pago, proveedor, { fecha: this.hoy, baseUrl: this.qrBaseUrl });
    const cambios = pago.aprobar(comprobante.url(), comprobante.codigo(), this.hoy);
    return this.#resultado(pago, datosProveedor, cambios.estado, cambios, null, proveedor.situacion);
  }

  // Forma única de salida: es lo que recibe el Switch "¿Decisión?" del workflow
  #resultado(pago, datosProveedor, decision, cambios, resumen = null, situacionHacienda = null) {
    return {
      pagoId: pago.id,
      decision,
      consultarHacienda: false,
      cedula: null,
      resumen: resumen || (cambios ? cambios.motivo : ''),
      cambios,
      situacionHacienda,
      pago: { ...pago },
      proveedor: datosProveedor
    };
  }
}

module.exports = { EvaluadorRiesgo, clasificarRespuesta };
