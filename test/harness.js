/* Shared loader: boots the browser-shaped PageScan modules under Node so the
 * geometry can be exercised headlessly. */
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = global.window || {};

['core', 'pdf', 'templates', 'marker', 'render', 'generator', 'geom', 'finder', 'scanner', 'pages']
  .forEach(m => require(path.join(ROOT, 'src', m + '.js')));

module.exports = { PS: global.window.PS, ROOT };
