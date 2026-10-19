const { Proveedor } = require('./Proveedor');
const { clasificarRespuesta } = require('./EvaluadorRiesgo');

// Consulta puntual de una cédula desde el panel: ¿se le puede pagar a este proveedor?
// Usa las mismas reglas tributarias (R1, R2, R3, R6) y los mismos casos de error (E1, E2)
// que la revisión automática de pagos.
class DiagnosticoProveedor {
  constructor(cedulaIngresada, { fecha = new Date() } = {}) {
    this.cedulaIngresada = cedulaIngresada == null ? '' : String(cedulaIngresada).trim();
    this.proveedor = new Proveedor({ cedula: Proveedor.normalizarCedula(this.cedulaIngresada) });
    this.fecha = fecha;
  }

  // R6: solo se consulta a Hacienda si la cédula tiene un formato válido
  puedeConsultar() {
    return this.proveedor.validarCedula();
  }

  sinConsulta() {
    return this.#registro('cedula_invalida', [
      `[R6] "${this.cedulaIngresada}" no es una cédula válida (debe tener de 9 a 12 dígitos)`
    ]);
  }

  conRespuesta(respuestaHacienda) {
    const consulta = clasificarRespuesta(respuestaHacienda);
    if (consulta.tipo === 'no_encontrado') {
      return this.#registro('no_registrado', ['[E1] La cédula no está registrada en Hacienda']);
    }
    if (consulta.tipo !== 'ok' || !consulta.body || !consulta.body.situacion) {
      const detalle = consulta.detalle || 'respuesta sin situación tributaria';
      return this.#registro('error_consulta', [`[E2] No se pudo verificar en Hacienda (${detalle}); intente de nuevo`]);
    }

    this.proveedor.registrarSituacionHacienda(consulta.body);
    const impedimentos = this.proveedor.impedimentosTributarios();
    if (impedimentos.length > 0) return this.#registro('no_apto', impedimentos, consulta.body);
    return this.#registro('apto', ['[OK] Al día con Hacienda: se le puede pagar'], consulta.body);
  }

  #registro(resultado, motivos, datosHacienda = null) {
    return {
      // si la cédula es inválida se guarda tal como se digitó, para que se entienda el error
      cedula: resultado === 'cedula_invalida' ? this.cedulaIngresada : this.proveedor.cedula,
      nombre: datosHacienda ? datosHacienda.nombre : null,
      resultado,
      apto: resultado === 'apto',
      situacion: this.proveedor.situacion
        ? { moroso: this.proveedor.situacion.moroso, omiso: this.proveedor.situacion.omiso, estado: this.proveedor.situacion.estado }
        : null,
      motivos,
      fecha: this.fecha.toISOString()
    };
  }
}

module.exports = { DiagnosticoProveedor };
