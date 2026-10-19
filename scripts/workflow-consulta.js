// Define el workflow "Consulta de cédula (panel)": Webhook que usa el panel web.
// Lo invoca scripts/build-workflow.js, que le pasa las utilidades compartidas.

module.exports = function workflowConsulta({ nodo, condicion, codigoNodo, idNodo, respuestaCompleta }) {
  const WEBHOOK = 'Webhook: consultar cédula';

  const nodos = [
    nodo('Nota: consulta desde el panel', 'n8n-nodes-base.stickyNote', 1, [-60, -300], {
      content: [
        '## Consulta de cédula (panel web)',
        'El panel (http://127.0.0.1:3000) envía `POST /webhook/consulta-cedula` con `{ "cedula": "..." }`.',
        'Las clases de `src/` validan la cédula (**R6**), interpretan a Hacienda (**R1 R2 R3**, **E1 E2**)',
        'y la consulta queda guardada en JSON Server (`/consultas`) para el historial.',
        '',
        'El workflow debe estar **publicado** para que el webhook responda.'
      ].join('\n'),
      height: 200,
      width: 640,
      color: 5
    }),

    nodo(WEBHOOK, 'n8n-nodes-base.webhook', 2, [0, 0], {
      httpMethod: 'POST',
      path: 'consulta-cedula',
      responseMode: 'responseNode',
      options: { allowedOrigins: '*' }
    }, { webhookId: 'b7c1d2e3-4f50-4a61-8b72-c3d4e5f60718' }),

    nodo('Configuración', 'n8n-nodes-base.set', 3.4, [220, 0], {
      assignments: {
        assignments: [
          { id: idNodo('consulta-cfg-json'), name: 'jsonServerUrl', value: 'http://127.0.0.1:3000', type: 'string' },
          { id: idNodo('consulta-cfg-hacienda'), name: 'haciendaUrl', value: 'https://api.hacienda.go.cr/fe/ae', type: 'string' }
        ]
      },
      options: {}
    }),

    nodo('Preparar consulta (POO)', 'n8n-nodes-base.code', 2, [440, 0], {
      jsCode: codigoNodo([
        '// R6: valida y normaliza la cédula digitada en el panel',
        `const entrada = $('${WEBHOOK}').first().json.body || {};`,
        'const diagnostico = new DiagnosticoProveedor(entrada.cedula);',
        'const consultar = diagnostico.puedeConsultar();',
        'return [{ json: {',
        '  cedula: diagnostico.proveedor.cedula,',
        '  cedulaIngresada: diagnostico.cedulaIngresada,',
        '  consultar,',
        '  registro: consultar ? null : diagnostico.sinConsulta()',
        '} }];'
      ].join('\n'))
    }),

    nodo('¿Cédula válida?', 'n8n-nodes-base.if', 2.2, [660, 0],
      condicion('={{ $json.consultar }}', { type: 'boolean', operation: 'true', singleValue: true })),

    nodo('Consultar Hacienda', 'n8n-nodes-base.httpRequest', 4.2, [880, -100], {
      url: "={{ $('Configuración').first().json.haciendaUrl }}?identificacion={{ $json.cedula }}",
      options: respuestaCompleta
    }, { onError: 'continueRegularOutput' }),

    nodo('Diagnosticar (POO)', 'n8n-nodes-base.code', 2, [1100, -100], {
      jsCode: codigoNodo([
        '// R1, R2, R3, E1 y E2: interpreta la respuesta de Hacienda',
        "const previo = $('Preparar consulta (POO)').first().json;",
        'const diagnostico = new DiagnosticoProveedor(previo.cedulaIngresada);',
        'return [{ json: diagnostico.conRespuesta($input.first().json) }];'
      ].join('\n'))
    }),

    nodo('Cédula inválida', 'n8n-nodes-base.set', 3.4, [1100, 100], {
      mode: 'raw',
      jsonOutput: '={{ $json.registro }}',
      options: {}
    }),

    nodo('Guardar en historial', 'n8n-nodes-base.httpRequest', 4.2, [1320, 0], {
      method: 'POST',
      url: "={{ $('Configuración').first().json.jsonServerUrl }}/consultas",
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json) }}',
      options: { timeout: 10000 }
    }),

    nodo('Responder al panel', 'n8n-nodes-base.respondToWebhook', 1.1, [1540, 0], {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify($json) }}',
      options: {}
    })
  ];

  const enlace = (...destinos) => destinos.map((salida) => salida.map((node) => ({ node, type: 'main', index: 0 })));

  return {
    id: 'ConsultaCedula01',
    name: 'Consulta de cédula (panel)',
    nodes: nodos,
    connections: {
      [WEBHOOK]: { main: enlace(['Configuración']) },
      'Configuración': { main: enlace(['Preparar consulta (POO)']) },
      'Preparar consulta (POO)': { main: enlace(['¿Cédula válida?']) },
      '¿Cédula válida?': { main: enlace(['Consultar Hacienda'], ['Cédula inválida']) },
      'Consultar Hacienda': { main: enlace(['Diagnosticar (POO)']) },
      'Diagnosticar (POO)': { main: enlace(['Guardar en historial']) },
      'Cédula inválida': { main: enlace(['Guardar en historial']) },
      'Guardar en historial': { main: enlace(['Responder al panel']) }
    },
    pinData: {},
    active: false,
    settings: { executionOrder: 'v1' },
    tags: []
  };
};
