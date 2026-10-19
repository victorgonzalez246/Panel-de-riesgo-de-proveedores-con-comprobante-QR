const { REGLAS } = require('./config');

// Longitudes válidas de identificación según el tipo que usa Hacienda:
// 01 física, 02 jurídica, 03 DIMEX, 04 NITE
const LONGITUD_POR_TIPO = { '01': [9], '02': [10], '03': [11, 12], '04': [10] };

class Proveedor {
  constructor({ id, nombre, cedula, tipoCedula, email, activo = true } = {}) {
    this.id = id;
    this.nombre = nombre;
    this.cedula = cedula == null ? '' : String(cedula).trim();
    this.tipoCedula = tipoCedula;
    this.email = email;
    this.activo = activo !== false;
    this.situacion = null; // se completa con la respuesta de Hacienda
  }

  // R7: la empresa solo le paga a proveedores activos en su registro
  estaActivo() {
    return this.activo;
  }

  // R6: la cédula debe tener solo dígitos y la longitud de su tipo
  validarCedula() {
    if (!/^\d+$/.test(this.cedula)) return false;
    const longitudes = LONGITUD_POR_TIPO[this.tipoCedula] || [9, 10, 11, 12];
    return longitudes.includes(this.cedula.length);
  }

  registrarSituacionHacienda(datosHacienda) {
    const situacion = (datosHacienda && datosHacienda.situacion) || {};
    this.situacion = {
      moroso: situacion.moroso,
      omiso: situacion.omiso,
      estado: situacion.estado,
      nombreHacienda: datosHacienda ? datosHacienda.nombre : undefined
    };
  }

  // R1
  estaMoroso() {
    return this.situacion !== null && this.situacion.moroso === 'SI';
  }

  // R2
  estaOmiso() {
    return this.situacion !== null && this.situacion.omiso === 'SI';
  }

  // R3
  estaInscrito() {
    return this.situacion !== null && REGLAS.estadosHaciendaValidos.includes(this.situacion.estado);
  }

  // Junta R1, R2 y R3: lista vacía significa que el proveedor está al día
  impedimentosTributarios() {
    const impedimentos = [];
    if (this.estaMoroso()) impedimentos.push('[R1] Proveedor moroso ante Hacienda');
    if (this.estaOmiso()) impedimentos.push('[R2] Proveedor omiso (declaraciones pendientes)');
    if (!this.estaInscrito()) {
      impedimentos.push(`[R3] Situación en Hacienda no válida: "${this.situacion ? this.situacion.estado : 'desconocida'}"`);
    }
    return impedimentos;
  }
}

module.exports = { Proveedor };
