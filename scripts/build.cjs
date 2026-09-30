'use strict';
// Netlify publishes only the game files; local index.html remains directly runnable.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(path.join(dist, 'vendor'), { recursive: true });
for (const file of ['index.html', 'style.css', 'game.js', 'vendor/three.min.js', 'vendor/THREE-LICENSE.txt']) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}
console.log('APEX Kart Club: static game ready in dist/');
