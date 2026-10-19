// Jerarquía de reglas de negocio.
//
//   ReglaNegocio (abstracta)
//   ├── ReglaRetencion (abstracta)       → el pago queda "retenido"
//   │   ├── ReglaProveedorInactivo  R7
//   │   ├── ReglaCedulaInvalida     R6
//   │   ├── ReglaMoroso             R1
//   │   ├── ReglaOmiso              R2
//   │   └── ReglaNoInscrito         R3
//   └── ReglaRevisionManual (abstracta)  → el pago pasa a "revision_manual"
//       └── ReglaMontoAlto          R4
//
// Cada subclase redefine aplica() y motivo(); EvaluadorRiesgo las recorre con el mismo
// método evaluar() sin saber cuál es cuál (polimorfismo). Agregar una regla nueva es
// crear otra subclase y sumarla a la lista, sin tocar el evaluador.

class ReglaNegocio {
  constructor(codigo) {
    if (new.target === ReglaNegocio || new.target === ReglaRetencion || new.target === ReglaRevisionManual) {
      throw new Error(`${new.target.name} es abstracta: use una de sus subclases`);
    }
    this.codigo = codigo;
  }

  // contexto = { pago, proveedor }: cada subclase decide si la regla se cumple
  aplica(contexto) {
    throw new Error(`${this.constructor.name} debe implementar aplica()`);
  }

  motivo(contexto) {
    throw new Error(`${this.constructor.name} debe implementar motivo()`);
  }

  // Estado en que deja el pago; lo definen las clases intermedias
  get decision() {
    throw new Error(`${this.constructor.name} debe definir su decisión`);
  }

  // Método común (plantilla): igual para todas las reglas
  evaluar(contexto) {
    if (!this.aplica(contexto)) return null;
    return { codigo: this.codigo, decision: this.decision, motivo: `[${this.codigo}] ${this.motivo(contexto)}` };
  }
}

class ReglaRetencion extends ReglaNegocio {
  get decision() { return 'retenido'; }
}

class ReglaRevisionManual extends ReglaNegocio {
  get decision() { return 'revision_manual'; }
}

class ReglaProveedorInactivo extends ReglaRetencion {
  constructor() { super('R7'); }
  aplica({ proveedor }) { return !proveedor.estaActivo(); }
  motivo({ proveedor }) { return `El proveedor ${proveedor.nombre} está inactivo en el registro de la empresa`; }
}

class ReglaCedulaInvalida extends ReglaRetencion {
  constructor() { super('R6'); }
  aplica({ proveedor }) { return !proveedor.validarCedula(); }
  motivo({ proveedor }) { return `La cédula "${proveedor.cedula}" no tiene un formato válido; no se consultó a Hacienda`; }
}

class ReglaMoroso extends ReglaRetencion {
  constructor() { super('R1'); }
  aplica({ proveedor }) { return proveedor.estaMoroso(); }
  motivo() { return 'Proveedor moroso ante Hacienda'; }
}

class ReglaOmiso extends ReglaRetencion {
  constructor() { super('R2'); }
  aplica({ proveedor }) { return proveedor.estaOmiso(); }
  motivo() { return 'Proveedor omiso (declaraciones pendientes)'; }
}

class ReglaNoInscrito extends ReglaRetencion {
  constructor() { super('R3'); }
  aplica({ proveedor }) { return !proveedor.estaInscrito(); }
  motivo({ proveedor }) { return `Situación en Hacienda no válida: "${proveedor.situacion ? proveedor.situacion.estado : 'desconocida'}"`; }
}

class ReglaMontoAlto extends ReglaRevisionManual {
  constructor() { super('R4'); }
  aplica({ pago }) { return pago.requiereAprobacionManual(); }
  motivo({ pago }) { return `Proveedor al día, pero el monto ${pago.montoFormateado()} supera el umbral de aprobación automática`; }
}

// Grupos de reglas según el momento del workflow en que se aplican
const REGLAS_PREVIAS = () => [new ReglaProveedorInactivo(), new ReglaCedulaInvalida()];
const REGLAS_TRIBUTARIAS = () => [new ReglaMoroso(), new ReglaOmiso(), new ReglaNoInscrito()];
const REGLAS_DE_MONTO = () => [new ReglaMontoAlto()];

// Aplica una lista de reglas y devuelve las que se cumplen
function evaluarReglas(reglas, contexto) {
  return reglas.map((regla) => regla.evaluar(contexto)).filter(Boolean);
}

module.exports = {
  ReglaNegocio, ReglaRetencion, ReglaRevisionManual,
  ReglaProveedorInactivo, ReglaCedulaInvalida, ReglaMoroso, ReglaOmiso, ReglaNoInscrito, ReglaMontoAlto,
  REGLAS_PREVIAS, REGLAS_TRIBUTARIAS, REGLAS_DE_MONTO, evaluarReglas
};
