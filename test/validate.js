// node test/validate.js -- anchors + sweep across the 0.1-10 kg/day control range
const SCW = require('../src/model.js');
let fail = 0;
for (const c of SCW.validate()) { if (!c.ok) fail++; console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + ': ' + c.got.toPrecision(5) + ' ' + c.unit + '  [' + c.lo + ', ' + c.hi + ']  ref ' + c.ref); }
for (const g of [0.1, 0.3, 1, 3, 10]) {
  const r = SCW.solve({ target: { glucoseKgDay: g } });
  const ok = r.converged && Math.abs(r.kpi.c6Day - g) / g < 1e-3 && Math.abs(r.kpi.massErr) < 5e-4 && Math.abs(r.kpi.carbErr) < 2e-3;
  if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + 'solve ' + g + ' kg/day -> dry wood ' + r.woodDryDay.toPrecision(4) + ' kg/day, ' + r.kpi.kWhPerKg.toPrecision(3) + ' kWh/kg, reactor ' + r.eq.reactor.tube + ' x ' + r.eq.reactor.L.toPrecision(3) + ' m');
}
const base = SCW.solve({ target: { glucoseKgDay: 3 } }), fz = SCW.solve({ target: { glucoseKgDay: 1.5 } }, base.geom);
console.log('frozen hardware (sized 3 kg/day) at 1.5 kg/day: tau ' + fz.kpi.tau.toPrecision(3) + ' s, yield ' + fz.kpi.c6PerWood.toPrecision(3) + ' vs ' + base.kpi.c6PerWood.toPrecision(3));
process.exit(fail ? 1 : 0);
