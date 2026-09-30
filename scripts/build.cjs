'use strict';
// Browser assets are static; Netlify bundles the separate leaderboard function.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
for (const file of ['index.html', 'style.css', 'game.js']) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}
console.log('KART RUSH: static game ready in dist/');
