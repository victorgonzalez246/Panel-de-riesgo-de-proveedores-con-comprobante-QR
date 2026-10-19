// Restaura db.json a los datos de prueba iniciales (útil antes de cada demo).
// Con --si-no-existe solo lo crea cuando falta, sin borrar los datos actuales.
// db.json no se sube a Git: guarda las consultas reales hechas desde el panel.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'db.json');
if (process.argv.includes('--si-no-existe') && fs.existsSync(destino)) process.exit(0);
fs.copyFileSync(path.join(raiz, 'data', 'db.inicial.json'), destino);
console.log('db.json restaurado desde data/db.inicial.json');
