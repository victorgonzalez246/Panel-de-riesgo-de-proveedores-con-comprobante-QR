# Guion de la presentación (≈ 10–12 minutos)

## Antes de empezar (5 min antes)

1. Abrir una terminal en la carpeta del proyecto y ejecutar `npm run api:limpio` (deja los 10 pagos en su estado inicial y levanta JSON Server). Dejar esa ventana abierta.
2. Abrir n8n (`n8n start`) en el navegador y tener el workflow **Panel de riesgo de proveedores con comprobante QR** abierto.
3. Tener una pestaña con http://127.0.0.1:3000/pagos para mostrar los datos antes y después.
4. Tener abiertos en el editor `src/EvaluadorRiesgo.js` y `src/Pago.js`.

## 1. El problema (1–2 min)

- Antes de pagarle a un proveedor hay que verificar que esté al día con Hacienda. Hoy es manual, cédula por cédula, y no queda rastro.
- La solución revisa todos los pagos pendientes cada día a las 7:00, aprueba los que cumplen con un comprobante QR y deja retenidos los riesgosos con un motivo.
- Idea clave: **nunca se aprueba un pago por defecto**; ante la duda, el pago se detiene.

## 2. El workflow funcionando (3–4 min)

1. Mostrar http://127.0.0.1:3000/pagos: 9 pagos `pendiente` y uno ya aprobado.
2. Recorrer el lienzo de izquierda a derecha (usar la nota amarilla con las reglas):
   Trigger → Configuración → GET pagos → IF → Separar → GET proveedor → **Code Validar (POO)** → IF ¿Consultar Hacienda? → GET Hacienda → **Code Evaluar riesgo (POO)** → Switch → QR / PATCH → bitácora.
3. **Execute workflow** (si n8n pregunta el trigger, elegir *Ejecutar manualmente*). Abrir el nodo **Consultar Hacienda** y mostrar la respuesta real del ICE (`"moroso": "SI"`).
4. Abrir **¿Decisión?**: 2 aprobados, el resto por la rama de retenidos o revisión.
5. Refrescar http://127.0.0.1:3000/pagos y mostrar:
   - PAG-001 aprobado con `qrUrl`: abrir la URL y mostrar el QR. Escanearlo con el celular para enseñar los datos del pago.
   - PAG-002 retenido `[R1] Proveedor moroso`.
   - PAG-003 en revisión `[R4]` por el monto.
   - PAG-008 aprobado con prioridad **alta**, porque está vencido.
6. Mostrar http://127.0.0.1:3000/bitacora.

## 3. Las clases y cómo viven en el nodo Code (3 min)

- **Proveedor**: `validarCedula()`, `estaActivo()`, `estaMoroso()`, `estaOmiso()`, `estaInscrito()`.
- **Pago**: `camposFaltantes()`, `requiereAprobacionManual()`, `estaVencido()` y las transiciones `aprobar()`, `retener()`, `enviarARevision()`, `registrarFallaVerificacion()`.
- **ComprobanteQR**: `codigo()`, `contenido()`, `url()`.
- **EvaluadorRiesgo**: `validar()` = nodo Code 1 y `evaluar()` = nodo Code 2.
- Ejecutar `node main.js` en la terminal: los mismos 10 pagos dan los mismos resultados sin n8n.
- Abrir el nodo Code en n8n y bajar hasta el final: son las mismas clases (copiadas por `scripts/build-workflow.js`) y la última línea llama a `evaluador.evaluar(...)`.
- Opcional: `npm test` (15 pruebas en verde).

## 4. Error en vivo (2 min)

1. En la terminal de JSON Server: `Ctrl + C` y luego `npm run api:limpio`, para tener pagos pendientes otra vez.
2. En el nodo **Configuración** cambiar `haciendaUrl` por `https://hacienda-caida.invalid/fe/ae` y ejecutar.
3. Mostrar el nodo **Consultar Hacienda** con el error `ENOTFOUND`, y en JSON Server los pagos en `error_verificacion`: `[E2] Hacienda no respondió... (intento 1 de 3; se reintentará)`. **Ningún pago se aprobó.**
4. Restaurar la URL (`https://api.hacienda.go.cr/fe/ae`) y ejecutar: los pagos se recuperan y se procesan.
5. Mencionar: si falla 3 veces seguidas, pasa a revisión manual (R9).

Alternativa rápida: detener JSON Server y ejecutar. El workflow se detiene en **JSON Server no disponible** con el mensaje E6.

## Extra opcional: panel web (1–2 min)

Solo si sobra tiempo, y presentándolo como un agregado (el laboratorio pide "sin interfaz visual"):
1. Abrir http://127.0.0.1:3000 y mostrar los indicadores, que se actualizan con lo que hizo el workflow.
2. Consultar `4-000-042139` (ICE): **No apto**, moroso. Luego `4000042149` (UCR): **Apto**.
3. Mostrar que la consulta pasó por n8n: en *Executions* del workflow **Consulta de cédula (panel)** aparece cada consulta, con los nodos Code que usan la clase `DiagnosticoProveedor`.
4. Mostrar el historial con la hora local de Costa Rica.

## 5. Conclusiones (1 min)

Posibles puntos (decirlos con sus propias palabras):
- Lo más difícil fue que la lógica fuera **una sola**: si las clases y el nodo Code se escriben por separado, tarde o temprano se desalinean. Se resolvió generando el workflow a partir de las clases.
- Los errores reales aparecieron al probar con datos reales, no en papel:
  - JSON Server se caía en Windows con escrituras simultáneas.
  - `localhost` resolvía a IPv6.
  - La CCSS aparece como "Inscrito de oficio", un estado que no se había previsto.
- Separar en dos pasos (validar → Hacienda → evaluar) ahorra consultas a una API que limita la frecuencia.

## Preguntas que podría hacer el docente

| Pregunta | Respuesta corta |
|---|---|
| ¿Por qué dos nodos Code? | Las reglas que no necesitan a Hacienda se aplican antes, para no gastar consultas en datos malos. |
| ¿Qué pasa si Hacienda está caída? | El pago queda en `error_verificacion` y se reintenta en la próxima corrida; al tercer fallo pasa a revisión manual. Nunca se aprueba. |
| ¿Cómo garantizan que la lógica es la misma? | `build-workflow.js` copia `src/` dentro de los nodos Code; `main.js` y n8n dan el mismo resultado con los mismos datos. |
| ¿Por qué un 404 de Hacienda retiene y no da error? | El 404 es una respuesta válida: esa cédula no es contribuyente. Un error es cuando no se sabe la respuesta. |
| ¿Dónde se cambia el umbral de ₡5 000 000? | `src/config.js` → `npm run build:workflow` → reimportar. |
| ¿Por qué `error_verificacion` además de `retenido`? | Distingue un problema temporal (se reintenta solo) de uno definitivo (lo resuelve una persona). |
