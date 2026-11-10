#!/usr/bin/env node
// Inline water table + model + UI into one page. Outputs:
//   dist/artifact.html  (fragment for publishing)   index.html  (standalone, open in any browser)
const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
let page = rd('page.html');
for (const [tag, file] of [['WATER', 'water_table.js'], ['MODEL', 'model.js'], ['UI', 'ui.js']]) page = page.replace('/*__' + tag + '__*/', () => rd(file).replace(/<\/script/g, '<\\/script'));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), page);
fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>body{margin:0}[hidden]{display:none!important}</style>\n</head><body>\n' + page + '\n</body></html>\n');
console.log('built', page.length, 'bytes');
