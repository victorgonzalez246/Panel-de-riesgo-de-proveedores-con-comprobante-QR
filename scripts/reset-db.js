// Restaura db.json a los datos de prueba iniciales (útil antes de cada demo).
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
fs.copyFileSync(path.join(raiz, 'data', 'db.inicial.json'), path.join(raiz, 'db.json'));
console.log('db.json restaurado desde data/db.inicial.json');
