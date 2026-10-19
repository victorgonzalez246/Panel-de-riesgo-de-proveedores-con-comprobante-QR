# Panel de riesgo de proveedores con comprobante QR

Laboratorio #1 — Soluciones de Negocio: POO + n8n (escenario 4).

Antes de aprobar un pago, la empresa verifica que el proveedor no esté moroso ante Hacienda. Un workflow de n8n toma los pagos pendientes de **JSON Server**, consulta la **API de Hacienda** por cada proveedor y, si está al día, genera un **comprobante QR** (api.qrserver.com) y aprueba el pago. Si está moroso, omiso o algo falla, el pago queda retenido o en revisión manual con un motivo claro.

La lógica de negocio está modelada con clases en JavaScript puro (`src/`), y es **exactamente el mismo código** que ejecutan los nodos Code del workflow.

## Estructura

```
├── src/
│   ├── config.js            umbrales y estados (parámetros de negocio)
│   ├── Proveedor.js         cédula, actividad y situación tributaria
│   ├── Pago.js              validación, umbral, vencimiento y cambios de estado
│   ├── ComprobanteQR.js     código y URL del comprobante QR
│   └── EvaluadorRiesgo.js   validar() y evaluar(): las dos decisiones del workflow
├── main.js                  prueba las clases por consola sin n8n
├── tests/reglas.test.js     15 pruebas automatizadas (R1–R9, E1–E4)
├── db.json                  base de datos de JSON Server
├── data/
│   ├── db.inicial.json      datos de prueba originales (para reiniciar)
│   └── respuestas-hacienda.json  respuestas reales de Hacienda guardadas
├── n8n/workflow-panel-riesgo.json   workflow exportado (importar en n8n)
├── scripts/
│   ├── build-workflow.js    genera el workflow copiando las clases a los nodos Code
│   └── reset-db.js          restaura db.json
└── docs/
    ├── documento-logica-negocio.docx / .pdf
    ├── diagrama-workflow.png
    └── guion-presentacion.md
```

## Cómo ejecutarlo

Requisitos: Node.js 18+ y n8n (probado con n8n 2.38.6 local).

```bash
npm install
npm test              # 15 pruebas de las reglas
node main.js          # métodos de las clases + evaluación de los 10 pagos
node main.js --en-vivo   # igual, pero consultando Hacienda en este momento
npm run api:limpio    # reinicia db.json y levanta JSON Server en http://127.0.0.1:3000
```

En n8n: **Workflows → Import from File →** `n8n/workflow-panel-riesgo.json`, y luego **Execute workflow**.

> JSON Server se levanta sin `--watch` y en `127.0.0.1` a propósito. Con `--watch` se recarga a sí mismo tras cada escritura y deja de responder por un instante; con `localhost`, n8n intenta conectar por IPv6 (`::1`), que JSON Server no escucha.

Si se cambia una clase de `src/`, regenerar el workflow con `npm run build:workflow` y volver a importarlo.

## Datos de prueba

| Pago | Proveedor | Resultado esperado |
|---|---|---|
| PAG-001 | Universidad de Costa Rica (al día) | **aprobado** + QR |
| PAG-002 | ICE (moroso real en Hacienda) | **retenido** — R1 |
| PAG-003 | Banco Nacional, ₡7 500 000 | **revisión manual** — R4 |
| PAG-004 | Cédula 3101000107 (404 en Hacienda) | **retenido** — E1 |
| PAG-005 | Cédula "12-345" | **retenido** — R6 |
| PAG-006 | Proveedor PRV-099 inexistente | **revisión manual** — E3 |
| PAG-007 | Pago sin monto | **revisión manual** — E4 |
| PAG-008 | CCSS ("Inscrito de oficio"), vencido | **aprobado** + QR, prioridad alta — R8 |
| PAG-009 | RECOPE, inactivo en la empresa | **retenido** — R7 |
| PAG-010 | Ya aprobado antes | no se toca — R5 |

## Reglas de negocio

| | Regla | Resultado |
|---|---|---|
| R1 | Proveedor moroso | retenido |
| R2 | Proveedor omiso | retenido |
| R3 | Inscripción distinta de "Inscrito" / "Inscrito de oficio" | retenido |
| R4 | Monto > ₡5 000 000 o > $10 000 | revisión manual |
| R5 | Solo se revisan pagos `pendiente` o `error_verificacion` | — |
| R6 | Cédula con formato inválido (no se consulta Hacienda) | retenido |
| R7 | Proveedor inactivo en la empresa | retenido |
| R8 | Pago vencido | prioridad alta |
| R9 | Tercer intento de verificación fallido | revisión manual |

## Situaciones inesperadas

| | Situación | Manejo |
|---|---|---|
| E1 | Hacienda responde 404 | retenido |
| E2 | Hacienda caída, 5xx/429 o sin situación tributaria | `error_verificacion`, se reintenta (máx. 3, R9) |
| E3 | Proveedor no existe en JSON Server | revisión manual |
| E4 | Pago con datos incompletos | revisión manual |
| E5 | api.qrserver.com no genera el QR | 3 reintentos y luego `error_verificacion` |
| E6 | JSON Server apagado | el workflow se detiene con un mensaje claro |

**Demo de error en vivo:** en el nodo **Configuración**, cambiar `haciendaUrl` por `https://hacienda-caida.invalid/fe/ae` y ejecutar. Los pagos quedan en `error_verificacion` con el motivo `[E2]`. Al restaurar la URL y ejecutar de nuevo, se procesan normalmente.

## Entregables

- Workflow funcionando: `n8n/workflow-panel-riesgo.json`
- Clases POO: `src/` + `main.js`
- Documento de lógica de negocio: `docs/documento-logica-negocio.pdf` (y `.docx`)
- Guía de la presentación: `docs/guion-presentacion.md`
