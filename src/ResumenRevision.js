const { fechaLocal } = require('./config');
const { Pago } = require('./Pago');

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

module.exports = { ResumenRevision, ESTADOS_CRITICOS };
