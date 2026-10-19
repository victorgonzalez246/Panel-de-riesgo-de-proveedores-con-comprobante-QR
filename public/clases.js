// Clases copiadas desde src/ por scripts/build-workflow.js — no editar aquí.
window.ClasesPanel = (() => {
// ---------- src/config.js ----------
// Parámetros de negocio compartidos por todas las clases.
// Si se cambia un umbral aquí, cambia también en el nodo Code del workflow
// (scripts/build-workflow.js copia este archivo dentro de los nodos Code).

const REGLAS = {
  // R4: montos que exigen aprobación manual aunque el proveedor esté al día
  umbralRevisionManual: { CRC: 5000000, USD: 10000 },
  monedasPermitidas: ['CRC', 'USD'],
  // R5: solo estos estados entran a la revisión automática
  estadosProcesables: ['pendiente', 'error_verificacion'],
  // R9: intentos de verificación antes de enviar el pago a revisión manual
  maxIntentosVerificacion: 3,
  // R3: situaciones de inscripción que Hacienda considera válidas
  estadosHaciendaValidos: ['Inscrito', 'Inscrito de oficio'],
  zonaHoraria: 'America/Costa_Rica'
};

const ESTADOS = {
  PENDIENTE: 'pendiente',
  APROBADO: 'aprobado',
  RETENIDO: 'retenido',
  REVISION_MANUAL: 'revision_manual',
  ERROR_VERIFICACION: 'error_verificacion'
};

// Fecha local de Costa Rica en formato AAAA-MM-DD
function fechaLocal(fecha) {
  return fecha.toLocaleDateString('en-CA', { timeZone: REGLAS.zonaHoraria });
}

// ---------- src/ReglaNegocio.js ----------
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

// ---------- src/Proveedor.js ----------
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

  // Quita guiones, puntos y espacios de una cédula digitada (ej. "4-000-042139")
  static normalizarCedula(cedula) {
    return cedula == null ? '' : String(cedula).replace(/[\s.-]/g, '');
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

  // Aplica las reglas tributarias R1, R2 y R3 (subclases de ReglaRetencion).
  // Lista vacía significa que el proveedor está al día.
  impedimentosTributarios() {
    return evaluarReglas(REGLAS_TRIBUTARIAS(), { proveedor: this }).map((resultado) => resultado.motivo);
  }
}

// ---------- src/Pago.js ----------
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

// ---------- src/ComprobanteQR.js ----------
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

// ---------- src/EvaluadorRiesgo.js ----------
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

// ---------- src/DiagnosticoProveedor.js ----------
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

// ---------- src/ResumenRevision.js ----------
// Estados que tesorería tiene que atender (Reto 3 de la extensión)
const ESTADOS_CRITICOS = ['retenido', 'revision_manual', 'error_verificacion'];
const TITULOS = {
  retenido: 'Pagos retenidos',
  revision_manual: 'Requieren revisión manual',
  error_verificacion: 'No se pudieron verificar (se reintentará)',
  aprobado: 'Pagos aprobados'
};
const COLORES = { retenido: '#b91c1c', revision_manual: '#1d4ed8', error_verificacion: '#b45309', aprobado: '#047857' };

const esc = (texto) => String(texto == null ? '' : texto)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Junta el resultado de una revisión de pagos y arma el correo para tesorería
class ResumenRevision {
  constructor({ fecha = new Date(), panelUrl = 'http://127.0.0.1:3000' } = {}) {
    this.fecha = fecha;
    this.panelUrl = panelUrl;
    this.pagos = [];
  }

  // registro = pago ya actualizado (estado, motivo, qrUrl…) + nombre del proveedor
  agregar(registro, nombreProveedor) {
    this.pagos.push({ ...registro, proveedor: nombreProveedor || registro.proveedorId || '—' });
    return this;
  }

  porEstado(estado) {
    return this.pagos.filter((p) => p.estado === estado);
  }

  criticos() {
    return this.pagos.filter((p) => ESTADOS_CRITICOS.includes(p.estado));
  }

  hayCriticos() {
    return this.criticos().length > 0;
  }

  // Proveedores morosos (R1): el caso más grave, va destacado en el asunto
  morosos() {
    return this.pagos.filter((p) => String(p.motivo || '').includes('[R1]'));
  }

  asunto() {
    const criticos = this.criticos().length;
    const morosos = this.morosos().length;
    const alerta = morosos ? `${morosos} proveedor${morosos > 1 ? 'es' : ''} moroso${morosos > 1 ? 's' : ''} · ` : '';
    return `[Panel de riesgo] ${alerta}${criticos} pago${criticos === 1 ? '' : 's'} requiere${criticos === 1 ? '' : 'n'} atención · ${fechaLocal(this.fecha)}`;
  }

  totales() {
    const totales = {};
    for (const p of this.pagos) totales[p.estado] = (totales[p.estado] || 0) + 1;
    return totales;
  }

  html() {
    const t = this.totales();
    const celda = 'padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;vertical-align:top;';
    const fila = (p) => `<tr>
        <td style="${celda}font-family:Consolas,monospace;white-space:nowrap;">${esc(p.id)}</td>
        <td style="${celda}"><b>${esc(p.proveedor)}</b><br><span style="color:#64748b;">${esc(p.concepto)}</span></td>
        <td style="${celda}text-align:right;white-space:nowrap;">${p.monto == null ? '—' : esc(Pago.formatearMonto(p.monto, p.moneda))}</td>
        <td style="${celda}color:#475569;">${esc(p.motivo)}${p.prioridad === 'alta' ? ' <b style="color:#b45309;">· Prioridad alta</b>' : ''}</td>
      </tr>`;
    const seccion = (estado) => {
      const lista = this.porEstado(estado);
      if (!lista.length) return '';
      return `<h3 style="margin:22px 0 8px;font-size:15px;color:${COLORES[estado]};">${TITULOS[estado]} (${lista.length})</h3>
        <table style="width:100%;border-collapse:collapse;">${lista.map(fila).join('')}</table>`;
    };
    const aprobados = this.porEstado('aprobado').filter((p) => p.qrUrl);
    const tarjetasQR = aprobados.map((p) => `<td style="padding:8px;text-align:center;vertical-align:top;width:180px;">
        <img src="${esc(p.qrUrl)}" width="140" height="140" alt="QR ${esc(p.comprobante)}" style="border:1px solid #e2e8f0;border-radius:6px;"><br>
        <span style="font-family:Consolas,monospace;font-size:11px;color:#1d4ed8;">${esc(p.comprobante)}</span><br>
        <b style="font-size:12px;">${esc(p.proveedor)}</b><br>
        <span style="font-size:13px;">${esc(Pago.formatearMonto(p.monto, p.moneda))}</span>
      </td>`).join('');
    const chip = (estado, texto) => `<td style="padding:10px 14px;border-top:3px solid ${COLORES[estado]};background:#f8fafc;">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;">${texto}</div>
        <div style="font-size:22px;font-weight:bold;">${t[estado] || 0}</div></td>`;

    return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;max-width:760px;">
  <div style="background:#0b2a5b;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
    <div style="font-size:18px;font-weight:bold;">Panel de Riesgo de Proveedores</div>
    <div style="font-size:12px;opacity:.85;">Resultado de la revisión del ${esc(this.fecha.toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' }))}</div>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:0;padding:16px 20px;border-radius:0 0 10px 10px;">
    ${this.morosos().length ? `<p style="background:#fee2e2;color:#7f1d1d;padding:10px 12px;border-radius:8px;margin:0 0 12px;"><b>Atención:</b> ${this.morosos().length === 1 ? 'se detectó 1 proveedor moroso ante Hacienda. Su pago quedó retenido.' : `se detectaron ${this.morosos().length} proveedores morosos ante Hacienda. Sus pagos quedaron retenidos.`}</p>` : ''}
    <table style="border-collapse:separate;border-spacing:8px 0;margin-left:-8px;"><tr>
      ${chip('aprobado', 'Aprobados')}${chip('retenido', 'Retenidos')}${chip('revision_manual', 'Revisión manual')}${chip('error_verificacion', 'Con error')}
    </tr></table>
    ${seccion('retenido')}${seccion('revision_manual')}${seccion('error_verificacion')}
    ${aprobados.length ? `<h3 style="margin:22px 0 8px;font-size:15px;color:${COLORES.aprobado};">${TITULOS.aprobado} (${aprobados.length})</h3><table><tr>${tarjetasQR}</tr></table>` : ''}
    <p style="margin-top:22px;font-size:12px;color:#64748b;">Panel: <a href="${esc(this.panelUrl)}">${esc(this.panelUrl)}</a> · Correo generado automáticamente por el workflow de n8n.</p>
  </div>
</div>`;
  }

  // Lo que recibe el nodo "¿Hay situaciones críticas?" y el envío de correo
  aJSON() {
    return { enviar: this.hayCriticos(), asunto: this.asunto(), html: this.html(), totales: this.totales(), revisados: this.pagos.length };
  }
}

  return { REGLAS, ESTADOS, Proveedor, Pago, ComprobanteQR, EvaluadorRiesgo, DiagnosticoProveedor };
})();
