const { Proveedor } = require('./Proveedor');
const { Pago } = require('./Pago');
const { ComprobanteQR, QR_BASE_URL } = require('./ComprobanteQR');
const { REGLAS_PREVIAS, REGLAS_TRIBUTARIAS, REGLAS_DE_MONTO, evaluarReglas } = require('./ReglaNegocio');

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
  // Las listas de reglas se pueden reemplazar (por ejemplo en pruebas) sin modificar esta clase
  constructor({ hoy = new Date(), qrBaseUrl = QR_BASE_URL, reglasPrevias = REGLAS_PREVIAS(), reglasTributarias = REGLAS_TRIBUTARIAS(), reglasDeMonto = REGLAS_DE_MONTO() } = {}) {
    this.hoy = hoy;
    this.qrBaseUrl = qrBaseUrl;
    this.reglasPrevias = reglasPrevias;
    this.reglasTributarias = reglasTributarias;
    this.reglasDeMonto = reglasDeMonto;
  }

  // Lleva el pago al estado que indica la regla (retenido o revisión manual)
  #aplicarDecision(pago, decision, motivo) {
    return decision === 'revision_manual' ? pago.enviarARevision(motivo, this.hoy) : pago.retener(motivo, this.hoy);
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

    // R7 y R6: la primera regla previa que se cumpla decide, sin consultar a Hacienda
    const [previa] = evaluarReglas(this.reglasPrevias, { pago, proveedor });
    if (previa) {
      const cambios = this.#aplicarDecision(pago, previa.decision, previa.motivo);
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

    // R1, R2 y R3 se acumulan: el motivo lista todos los impedimentos; luego R4
    for (const reglas of [this.reglasTributarias, this.reglasDeMonto]) {
      const cumplidas = evaluarReglas(reglas, { pago, proveedor });
      if (cumplidas.length > 0) {
        const motivo = cumplidas.map((r) => r.motivo).join('; ');
        const cambios = this.#aplicarDecision(pago, cumplidas[0].decision, motivo);
        return this.#resultado(pago, datosProveedor, cambios.estado, cambios, null, proveedor.situacion);
      }
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
