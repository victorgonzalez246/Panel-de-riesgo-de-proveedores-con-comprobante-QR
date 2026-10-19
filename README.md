# Panel de riesgo de proveedores con comprobante QR

Laboratorio #1 — Soluciones de Negocio: POO + n8n.

Workflow de n8n que revisa los pagos pendientes a proveedores (JSON Server), verifica la situación tributaria de cada proveedor en la API de Hacienda y, si no está moroso, genera un comprobante QR (api.qrserver.com). Si el proveedor está moroso u ocurre un error, el pago queda retenido para revisión manual.

La lógica de negocio se modela con clases en JavaScript puro (POO) y es la misma que ejecuta el nodo Code del workflow.
