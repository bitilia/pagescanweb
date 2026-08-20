/* Shared loader: boots the browser-shaped PageScan modules under Node so the
 * geometry can be exercised headlessly. */
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = global.window || {};
require(path.join(ROOT, 'vendor/qrcode.js'));
if (typeof global.qrcode !== 'function') {
  global.qrcode = global.window.qrcode || require(path.join(ROOT, 'vendor/qrcode.js'));
}
global.jsQR = require(path.join(ROOT, 'vendor/jsQR.js'));

['core', 'pdf', 'templates', 'marker', 'render', 'generator', 'geom', 'scanner']
  .forEach(m => require(path.join(ROOT, 'src', m + '.js')));

module.exports = { PS: global.window.PS, ROOT };
