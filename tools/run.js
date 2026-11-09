#!/usr/bin/env node
// CLI: node tools/run.js [glucoseKgDay] [--json] [--set path=value ...]
const SCW = require('../src/model.js');
const args = process.argv.slice(2), over = { target: {} };
let json = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') json = true;
  else if (args[i] === '--set') { const [k, v] = args[++i].split('='); const path = k.split('.'); let o = over; while (path.length > 1) { const q = path.shift(); o = o[q] = o[q] || {}; } o[path[0]] = isNaN(+v) ? v === 'true' : +v; }
  else over.target.glucoseKgDay = +args[i];
}
const r = SCW.solve(over);
if (r.error) { console.error(r.error); process.exit(1); }
const k = r.kpi, f = (x, n = 3) => Number(x).toPrecision(n);
if (json) { console.log(JSON.stringify({ kpi: k, energy: r.energy, water: r.water, eq: r.eq, warn: r.warn, ratio: r.ratio }, (key, v) => (v instanceof Float64Array ? Array.from(v) : v), 1)); process.exit(0); }
console.log(`target free C6 ${f(k.c6Day)} kg/day | dry wood ${f(r.woodDryDay)} kg/day (fresh ${f(k.woodFreshDay)}) | converged ${r.converged}`);
console.log(`yield ${f(k.c6PerWood)} kg/kg  purity ${f(k.purity * 100)}%  celConv ${f(k.celConv * 100)}%  rawFreeC6 ${f(k.rawFreeC6)}  oligPot ${f(k.rawOligPotential)}  afterHold ${f(k.afterHoldC6)}  purifRec ${f(k.purifRecovery * 100)}%`);
console.log(`ratio ${f(r.ratio)}  Tout ${f(k.Tout, 4)} C  tau ${f(k.tau)} s  xv1 ${f(k.xv1)}  T2 ${f(k.T2, 4)} C  pH hot ${f(k.pHhot)} cold ${f(k.pHcold)}  GA ${f(k.gaMgPerKgCarb)} mg/kg carb`);
console.log(`energy ${f(k.kWhPerKg)} kWh/kg  heater ${f(k.heaterKW)} kW  ` + Object.entries(r.energy).map(([a, b]) => a + ' ' + f(b)).join('  '));
console.log(`water in ${f(r.water.totalIn * r.woodDryDay)} kg/day  mass err ${k.massErr.toExponential(2)}  carbon err ${k.carbErr.toExponential(2)}`);
const e = r.eq;
console.log(`reactor ${e.reactor.tube} L=${f(e.reactor.L)} m  u=${f(e.reactor.uIn)} m/s Re=${f(e.reactor.ReMin)} dP=${f(e.reactor.dPbar)} bar | heater ${e.heater.tube} L=${f(e.heater.L)} m | orifice ${f(e.valve.orificeMm)} mm | V-01 D=${f(e.flash.Dmm)} mm hold ${f(e.flash.holdL)} L | NF A ${f(e.nfA.areaM2)} m2 B ${f(e.nfB.areaM2)} m2`);
for (const w of r.warn) console.log(' [' + w.lvl + '] ' + w.msg);
