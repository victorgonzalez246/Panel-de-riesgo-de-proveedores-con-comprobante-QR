// Guarda la credencial SMTP de Gmail en n8n sin entrar a la interfaz de n8n.
// La contraseña de aplicación se escribe aquí (no se muestra en pantalla) y se importa con el CLI de n8n.
//
//   node scripts/configurar-correo.js cuenta@gmail.com

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const CREDENCIAL = { id: 'SmtpPanelRiesgo1', name: 'Gmail SMTP (Panel de riesgo)' };

function preguntar(texto, oculto = false) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) {
      rl._writeToOutput = (s) => { if (s.includes(texto)) rl.output.write(s); else if (!s.includes('\n')) rl.output.write('*'); };
    }
    rl.question(texto, (respuesta) => { rl.close(); if (oculto) process.stdout.write('\n'); ok(respuesta.trim()); });
  });
}

(async () => {
  console.log('\n=== Configurar el correo del Panel de riesgo (Gmail SMTP) ===\n');
  const cuenta = process.argv[2] || await preguntar('Cuenta de Gmail que envía: ');
  console.log(`Cuenta que envía: ${cuenta}`);
  const clave = (await preguntar('Pegue la contraseña de aplicación de 16 letras y presione Enter: ', true)).replace(/\s/g, '');
  if (!/^[a-zA-Z]{16}$/.test(clave)) {
    console.log('\nLa contraseña de aplicación debe tener 16 letras. No se guardó nada.');
    await preguntar('\nPresione Enter para cerrar.');
    process.exit(1);
  }

  const temporal = path.join(os.tmpdir(), `cred-${process.pid}.json`);
  fs.writeFileSync(temporal, JSON.stringify([{ ...CREDENCIAL, type: 'smtp', data: { user: cuenta, password: clave, host: 'smtp.gmail.com', port: 465, secure: true } }]));
  try {
    const r = spawnSync('n8n', ['import:credentials', `--input=${temporal}`], { shell: true, encoding: 'utf8' });
    const salida = `${r.stdout || ''}${r.stderr || ''}`;
    console.log(/Successfully imported/.test(salida) ? '\nListo: la credencial quedó guardada en n8n.' : `\nNo se pudo guardar la credencial:\n${salida.slice(-500)}`);
  } finally {
    fs.rmSync(temporal, { force: true }); // la contraseña no queda en ningún archivo
  }
  await preguntar('\nPresione Enter para cerrar esta ventana.');
})();
