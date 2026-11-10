/* 3D machine view: geometry is generated from the sizing results of SCW.solve(), in metres, to scale.
 * Needs three.js r128 + OrbitControls (globals). Without WebGL the part data panel still works. */
(function () {
  'use strict';
  const S = window.SCW, IX = S.IX, $ = id => document.getElementById(id), PI = Math.PI;
  const fmt = (x, n) => window.SCWfmt(x, n);
  const T3 = window.THREE;
  let renderer, scene, camera, controls, group, ray, ok3 = false, parts = [], pipes = [], movers = [], labels = [], sel = 'RX', mode = 'T', res = null, lastExtent = 0, visible = true, started = false;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HEAT = ['#fbe0d3', '#f6b79b', '#f08d63', '#eb6834', '#c24e1f', '#8f3814', '#5e240c'], BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); };
  const rampOf = () => { const r = (mode === 'T' ? HEAT : BLUE).slice(); return isDark() ? r.reverse().slice(1) : r.slice(1); };
  function rampColor(f) {
    const r = rampOf(), x = Math.min(0.9999, Math.max(0, f)) * (r.length - 1), i = Math.floor(x), a = new T3.Color(r[i]), b = new T3.Color(r[i + 1]);
    return a.lerp(b, x - i);
  }

  /* ---------- stream helpers ---------- */
  const NOTBY = { GLC: 1, FRU: 1, OLG: 1, XOS: 1, XYL: 1, ASD: 1 };
  function conc(y, w) {                       // g per kg of stream
    let tot = w; for (let i = 0; i < S.SP.length; i++) if (S.SP[i] !== 'W') tot += y[i];
    const o = {}; for (const s of S.SP) if (s !== 'W') o[s] = y[IX[s]] / tot * 1000;
    o.byp = S.DISS.reduce((a, s) => a + (NOTBY[s] ? 0 : o[s]), 0);
    return o;
  }
  const addv = (a, b) => a.map((v, i) => v + b[i]);

  /* ---------- parts: shape + data from the model result ---------- */
  function buildParts(r) {
    const p = r.p, e = r.eq, k = r.kpi, h = 3600 * r.woodRate, d = r.woodDryDay, q = p.quench, pu = p.purification, ps = [];
    const V = (D, H, caps) => ({ t: 'v', w: D, d: D, h: H + 0.1, py: 0.1 + H / 2, D, H, caps });
    const Hc = (D, L) => { const hc = Math.max(0.35, D / 2 + 0.15); return { t: 'h', w: L, d: D, h: hc + D / 2, py: hc, D, L }; };
    const Bx = (w, hh, dd, y0) => ({ t: 'b', w, d: dd, h: (y0 || 0) + hh, py: (y0 || 0) + hh / 2, bw: w, bh: hh, bd: dd, y0: y0 || 0 });
    const tank = Vm3 => { const D = Math.max(0.08, Math.cbrt(4 * Vm3 / (PI * 1.3))); return V(D, 1.3 * D); };
    const hx = A => Hc(Math.min(0.5, 0.05 + 0.07 * Math.sqrt(A)), Math.min(3, 0.3 + 0.7 * Math.sqrt(A)));
    const mods = A => { const m = A <= 1.2 ? ['1812', 0.4, 0.046, 0.305] : A <= 10 ? ['2540', 2.6, 0.061, 1.016] : ['4040', 7.9, 0.1, 1.016], n = Math.max(1, Math.ceil(A / m[1])), rows = Math.min(n, 4), cols = Math.ceil(n / 4), D = m[2] * 1.5;
      return { t: 'm', w: m[3], d: cols * D * 1.4, h: 0.15 + rows * D * 1.4, py: 0.15 + D * 0.7, D, L: m[3], n, rows, cols, type: m[0], each: m[1] }; };
    const zero = new Float64Array(S.SP.length), wood = new Float64Array(S.SP.length), c = p.feed.comp;
    ['CEL', 'HEM', 'ACG', 'URS', 'LIG', 'EXT'].forEach(s => { wood[IX[s]] = c[s]; }); wood[IX.ASS] = c.ASH;
    const s2 = S.sat(Math.min(q.Pf2, q.Pf1)), P = p.reactor.P, Tin = p.recovery.Tin, wat = conc(zero, 1);
    const cR = conc(r.yR, r.mW), cHold = conc(r.yHold, r.yF1.mL), cSt1 = conc(r.yF1.yv, r.yF1.mV), cL = conc(r.yL, r.wL), cSt2 = conc(r.yF2.yv, Math.max(r.yF2.mV, 1e-9));
    const cCond = conc(addv(r.yF1.yv, r.yF2.yv), r.yF1.mV + r.yF2.mV), cProd = conc(r.prod.y, r.prod.w), cSl = conc(wood, (1 - p.slurry.solids) / p.slurry.solids);
    const add = (id, tag, name, shape, T, Pp, flow, dims, cond, a, b) => ps.push(Object.assign(shape, { id, tag, name, T, P: Pp, flow, dims, cond, a, b, byp: a ? a.c.byp : 0 }));
    const mm = x => fmt(x * 1000, 3) + ' mm', kgh = x => fmt(x, 3) + ' kg/h';

    const wt = tank(Math.max(0.004, r.mHw * h / 6 / 1000));
    add('WT', 'F-01', 'Water break tank', wt, Tin, 0.1, r.mHw * h, [['Size', 'Ø' + mm(wt.D) + ' × ' + mm(wt.H)], ['Volume', fmt(PI * wt.D * wt.D / 4 * wt.H * 1000, 3) + ' L, 10 min of feed']], [['Flow', kgh(r.mHw * h)], ['Temperature', Tin + ' °C'], ['Pressure', '0.1 MPa']], { n: 'Water', c: wat });
    const s1 = 0.14 + 0.09 * Math.cbrt(e.pumps.hydKW);
    add('P1', 'P-01', 'High-pressure water pump', Bx(1.6 * s1, s1, s1), Tin, e.pumps.headMPa, r.mHw * h, [['Duty', fmt(e.pumps.hotWaterMlMin) + ' mL/min'], ['Envelope', mm(1.6 * s1) + ' × ' + mm(s1) + ' × ' + mm(s1)]], [['Flow', kgh(r.mHw * h)], ['Temperature', Tin + ' °C'], ['Pressure', '0.1 → ' + fmt(e.pumps.headMPa, 3) + ' MPa']], { n: 'Water', c: wat });
    const hxs = hx(Math.max(0.01, e.preheater.areaM2));
    add('HX', 'HX-01', 'Condensing steam preheater', hxs, e.preheater.Tpre, P, r.mHw * h, [['Shell', 'Ø' + mm(hxs.D) + ' × ' + mm(hxs.L)], ['Area', fmt(e.preheater.areaM2, 2) + ' m²'], ['Duty', fmt(e.preheater.dutyKW) + ' kW']],
      [['Water side', kgh(r.mHw * h) + ', ' + Tin + ' → ' + fmt(e.preheater.Tpre, 3) + ' °C, ' + P + ' MPa'], ['Steam side', fmt(k.T2, 3) + ' °C, ' + q.Pf1 + ' MPa']], { n: 'Water', c: wat }, { n: 'Steam condensate', c: cSt1 });
    let Dc = Math.max(0.12, 20 * e.heater.OD), turns = e.heater.L / (PI * Dc), coilH = turns * 1.5 * e.heater.OD;
    while (coilH > 1.2) { Dc *= 1.25; turns = e.heater.L / (PI * Dc); coilH = turns * 1.5 * e.heater.OD; }
    coilH = Math.max(0.1, coilH);
    const eh = V(Dc + 0.24, coilH + 0.2); eh.coil = { Dc, turns, coilH, OD: e.heater.OD };
    add('EH', 'E-01', 'Electric hot-water heater', eh, p.reactor.Thw, P, r.mHw * h, [['Coil tube', e.heater.tube + ', alloy 625'], ['Coil', fmt(e.heater.L, 3) + ' m as ' + fmt(turns, 2) + ' turns on Ø' + mm(Dc)], ['Housing', 'Ø' + mm(eh.D) + ' × ' + mm(eh.H) + ' with 120 mm insulation'], ['Power', fmt(e.heater.elecKW) + ' kW, peak flux ' + fmt(e.heater.fluxMaxKWm2) + ' kW/m²']],
      [['Flow', kgh(r.mHw * h)], ['Temperature', fmt(e.heater.Tpre, 3) + ' → ' + p.reactor.Thw + ' °C, block ' + fmt(e.heater.Tblock, 3) + ' °C'], ['Pressure', P + ' MPa, Δp ' + fmt(e.heater.dPbar, 2) + ' bar']], { n: 'Water', c: wat });
    const st = tank(Math.max(0.004, r.mSl * d / 1010 * 1.15));
    add('ST', 'F-02', 'Stirred slurry tank', st, p.slurry.T, 0.1, r.mSl * h, [['Size', 'Ø' + mm(st.D) + ' × ' + mm(st.H)], ['Volume', fmt(PI * st.D * st.D / 4 * st.H * 1000, 3) + ' L, one day of feed'], ['Particles', p.slurry.dpUm + ' µm milled birch']], [['Flow', kgh(r.mSl * h) + ' slurry, ' + kgh(h) + ' dry wood'], ['Temperature', p.slurry.T + ' °C'], ['Pressure', '0.1 MPa']], { n: 'Slurry', c: cSl });
    const s2p = 0.14 + 0.09 * Math.cbrt(e.pumps.hydKW * r.mSl / (r.mSl + r.mHw));
    add('P2', 'P-02', 'High-pressure slurry pump', Bx(1.6 * s2p, s2p, s2p), p.slurry.T, e.pumps.headMPa, r.mSl * h, [['Duty', fmt(e.pumps.slurryMlMin) + ' mL/min'], ['Envelope', mm(1.6 * s2p) + ' × ' + mm(s2p) + ' × ' + mm(s2p)]], [['Flow', kgh(r.mSl * h)], ['Temperature', p.slurry.T + ' °C'], ['Pressure', '0.1 → ' + fmt(e.pumps.headMPa, 3) + ' MPa']], { n: 'Slurry', c: cSl });
    const Dout = e.reactor.OD + 2 * p.reactor.insulMm / 1000, hcR = Math.max(0.35, Dout / 2 + 0.15);
    const mx = Bx(0.07, 0.07, 0.07, hcR - 0.035); mx.g = 0;
    add('MX', 'M-01', 'Mixing tee', mx, e.mixer.TmixWater, P, (r.mSl + r.mHw) * h, [['Bore', mm(e.reactor.ID)], ['Hot : cold', fmt(r.ratio, 3) + ' kg water per kg slurry']], [['Flow', kgh((r.mSl + r.mHw) * h)], ['Temperature', 'water enters at ' + fmt(e.mixer.TmixWater, 3) + ' °C; particles heat in ' + fmt(e.mixer.heatUpMs, 2) + ' ms'], ['Pressure', P + ' MPa'], ['Mixing time', fmt(e.mixer.mixTimeMs, 2) + ' ms']], { n: 'Mixed feed', c: conc(wood, r.mW) });
    const nl = e.reactor.L <= 2.5 ? 1 : (Math.ceil(e.reactor.L / 2.5) | 1), legL = e.reactor.L / nl, pz = Dout * 1.25;
    add('RX', 'R-01', 'Supercritical-water reactor', { t: 'r', w: legL, d: nl * pz, h: hcR + Dout / 2, py: hcR, D: Dout, OD: e.reactor.OD, n: nl, legL, pz }, k.Tout, P, (r.mSl + r.mHw) * h,
      [['Tube', e.reactor.tube + ', alloy 625'], ['Length', fmt(e.reactor.L, 3) + ' m' + (nl > 1 ? ' in ' + nl + ' passes' : '')], ['Volume', fmt(e.reactor.volMl, 3) + ' mL'], ['Insulated', 'Ø' + mm(Dout) + ' over ' + p.reactor.insulMm + ' mm microporous'], ['Wall', fmt(e.reactor.wall.wallMm, 3) + ' mm, minimum ' + fmt(e.reactor.wall.tReqMm, 2) + ' mm']],
      [['Flow', kgh((r.mSl + r.mHw) * h)], ['Velocity', fmt(e.reactor.uIn, 3) + ' → ' + fmt(e.reactor.uOut, 3) + ' m/s, Re ' + fmt(e.reactor.ReMin)], ['Residence', fmt(k.tau * 1000, 3) + ' ms'], ['Temperature', fmt(e.reactor.Tin, 3) + ' → ' + fmt(k.Tout, 4) + ' °C'], ['Pressure', P + ' MPa, Δp ' + fmt(e.reactor.dPbar, 2) + ' bar'], ['Heat loss', fmt(e.reactor.heatLossW, 2) + ' W']], { n: 'Outlet', c: cR });
    add('QV', 'Q-01', 'Flash valve', Bx(0.09, 0.12, 0.09, hcR - 0.045), (k.Tout + k.T2) / 2, P, (r.mSl + r.mHw) * h, [['Orifice', fmt(e.valve.orificeMm, 2) + ' mm'], ['Mass flux', fmt(e.valve.massFlux) + ' kg/m²s, choked']], [['Flow', kgh((r.mSl + r.mHw) * h)], ['Temperature', fmt(k.Tout, 4) + ' → ' + fmt(k.T2, 3) + ' °C'], ['Pressure', P + ' → ' + q.Pf1 + ' MPa']], { n: 'Through valve', c: cR });
    const D1 = e.flash.Dmm / 1000, v1 = V(D1, 3 * D1, true);
    add('V1', 'V-01', 'Flash separator and finishing hold', v1, k.T2, q.Pf1, r.yF1.mL * h, [['Size', 'Ø' + mm(v1.D) + ' × ' + mm(v1.H) + ' (vapour needs ≥ Ø' + fmt(e.flash.DminMm, 2) + ' mm)'], ['Volume', fmt(e.flash.vesselL, 3) + ' L, of which ' + fmt(e.flash.holdL, 3) + ' L liquor'], ['Wall', '≥ ' + fmt(e.flash.wallMm, 2) + ' mm 316L']],
      [['Liquor out', kgh(r.yF1.mL * h) + ' after ' + fmt(e.flash.holdS / 60, 2) + ' min'], ['Steam out', kgh(r.yF1.mV * h) + ' (' + fmt(k.xv1 * 100, 2) + '% of feed)'], ['Temperature', fmt(k.T2, 4) + ' °C'], ['Pressure', q.Pf1 + ' MPa'], ['pH at temperature', fmt(k.pHhot, 3)]], { n: 'Liquor', c: cHold }, { n: 'Steam', c: cSt1 });
    const mV2 = r.woodRate * r.yF2.mV, D2 = Math.max(0.05, Math.sqrt(4 * mV2 / s2.rhog / (PI * 0.07 * Math.sqrt((s2.rhof - s2.rhog) / s2.rhog)))), v2 = V(D2, 3 * D2, true);
    add('V2', 'V-02', 'Atmospheric flash', v2, s2.T, q.Pf2, r.wL * h, [['Size', 'Ø' + mm(v2.D) + ' × ' + mm(v2.H)]], [['Liquor out', kgh(r.wL * h)], ['Vapour out', kgh(r.yF2.mV * h)], ['Temperature', fmt(s2.T, 3) + ' °C'], ['Pressure', q.Pf2 + ' MPa'], ['pH cold', fmt(k.pHcold, 3)]], { n: 'Liquor', c: cL }, { n: 'Vapour', c: cSt2 });
    const Ac = Math.max(0.02, e.preheater.coolingKW / 40), cd = hx(Ac);
    add('CD', 'C-01', 'Surplus-steam condenser', cd, 60, 0.1, (r.yF1.mV + r.yF2.mV) * h, [['Shell', 'Ø' + mm(cd.D) + ' × ' + mm(cd.L)], ['Area', fmt(Ac, 2) + ' m² at 1 kW/m²K, 40 K'], ['Duty', fmt(e.preheater.coolingKW) + ' kW to reject']], [['Condensate', kgh((r.yF1.mV + r.yF2.mV) * h)], ['Temperature', '100 → 30 °C'], ['Pressure', '0.1 MPa']], { n: 'Condensate', c: cCond });
    const Df = Math.min(0.8, 0.08 + 0.3 * Math.sqrt(e.filter.areaM2)), f1 = V(Df, 2.5 * Df);
    add('F1', 'S-01', 'Backflushable filter', f1, 30, 0.3, r.pur.filtrate.w * h, [['Housing', 'Ø' + mm(Df) + ' × ' + mm(2.5 * Df)], ['Area', fmt(e.filter.areaM2, 2) + ' m²']], [['Filtrate', kgh(r.pur.filtrate.w * h)], ['Cake', fmt(k.solidsResidueDay) + ' kg/day dry solids'], ['Temperature', '30 °C'], ['Pressure', '0.3 MPa']], { n: 'Filtrate', c: conc(r.pur.filtrate.y, r.pur.filtrate.w) }, { n: 'Wet cake', c: conc(r.pur.cake.y, r.pur.cake.w) });
    const na = mods(e.nfA.areaM2);
    add('NA', 'S-02A', 'Loose nanofiltration', na, 30, pu.dPA / 10, r.pur.permA.w * d / pu.membraneHours, [['Modules', na.n + ' × ' + na.type + ' spiral, ' + na.each + ' m² each'], ['Area needed', fmt(e.nfA.areaM2, 2) + ' m²'], ['Flux', fmt(e.nfA.fluxLMH, 2) + ' L/m²h']], [['Permeate', kgh(r.pur.permA.w * d / pu.membraneHours)], ['Temperature', '30 °C'], ['Pressure', fmt(pu.dPA / 10, 2) + ' MPa, osmotic ' + fmt(e.nfA.osmBar, 2) + ' bar']], { n: 'Permeate', c: conc(r.pur.permA.y, r.pur.permA.w) }, { n: 'Retentate', c: conc(r.pur.retA.y, r.pur.retA.w) });
    const nb = mods(e.nfB.areaM2);
    add('NB', 'S-02B', 'Tight nanofiltration', nb, 30, pu.dPB / 10, r.pur.permB.w * d / pu.membraneHours, [['Modules', nb.n + ' × ' + nb.type + ' spiral, ' + nb.each + ' m² each'], ['Area needed', fmt(e.nfB.areaM2, 2) + ' m²'], ['Flux', fmt(e.nfB.fluxLMH, 2) + ' L/m²h']], [['Permeate', kgh(r.pur.permB.w * d / pu.membraneHours)], ['Temperature', '30 °C'], ['Pressure', fmt(pu.dPB / 10, 2) + ' MPa, osmotic ' + fmt(e.nfB.osmBar, 2) + ' bar']], { n: 'Retentate', c: conc(addv(r.prod.y, r.pur.evap.y), r.prod.w + r.pur.evap.w) }, { n: 'Permeate', c: conc(r.pur.permB.y, r.pur.permB.w) });
    const De = Math.min(1.2, 0.12 + 0.03 * Math.sqrt(e.evap.waterKgDay)), ev = V(De, 2 * De, true);
    add('EV', 'EV-01', 'Vacuum evaporator', ev, 60, 0.02, e.evap.waterKgDay / p.target.hoursPerDay, [['Size', 'Ø' + mm(De) + ' × ' + mm(2 * De)], ['Heat', 'surplus flash steam']], [['Water removed', fmt(e.evap.waterKgDay) + ' kg/day'], ['Temperature', '60 °C'], ['Pressure', '0.02 MPa']], { n: 'Syrup', c: cProd }, { n: 'Vapour', c: conc(r.pur.evap.y, Math.max(r.pur.evap.w, 1e-9)) });
    const pd = tank(Math.max(0.0005, k.syrupKgDay / 1300));
    add('PD', 'Product', 'Syrup drum', pd, 25, 0.1, k.syrupKgDay / p.target.hoursPerDay, [['Size', 'Ø' + mm(pd.D) + ' × ' + mm(pd.H)], ['Holds', fmt(k.syrupKgDay) + ' kg, one day']], [['Syrup', fmt(k.syrupKgDay) + ' kg/day at ' + fmt(pu.dsSyrup * 100, 2) + '% solids'], ['Free C6', fmt(k.c6Day) + ' kg/day, ' + fmt(k.purity * 100, 3) + '% of solids'], ['Temperature', '25 °C']], { n: 'Syrup', c: cProd });
    return ps;
  }

  function layout(ps) {
    const by = {}; ps.forEach(p => { by[p.id] = p; });
    const place = (ids, x0, z, dir) => { let x = x0; for (const id of ids) { const p = by[id]; x += dir * p.w / 2; p.x = x; p.z = z; x += dir * (p.w / 2 + (p.g != null ? p.g : 0.16 + 0.08 * p.w)); } };
    const rowA = ['WT', 'P1', 'HX', 'EH', 'MX', 'RX', 'QV', 'V1'], rowB = ['V2', 'F1', 'NA', 'NB', 'EV', 'PD'];
    const dep = ids => Math.max.apply(null, ids.map(i => by[i].d));
    place(rowA, 0, 0, 1);
    const zB = dep(rowA) / 2 + dep(rowB.concat(['CD'])) / 2 + 0.3, zC = -(dep(rowA) / 2 + dep(['ST', 'P2']) / 2 + 0.3);
    place(rowB, by.V1.x + by.V2.w / 2, zB, -1);
    by.CD.x = by.V1.x + Math.max(by.V1.w, by.V2.w) / 2 + 0.3 + by.CD.w / 2; by.CD.z = zB;
    by.P2.x = by.MX.x; by.P2.z = zC; by.ST.x = by.P2.x - by.P2.w / 2 - 0.25 - by.ST.w / 2; by.ST.z = zC;
    /* piping: [points, source part, tube OD, animated] */
    const L = p => [p.x - p.w / 2, p.py, p.z], R = p => [p.x + p.w / 2, p.py, p.z], T = p => [p.x, p.h, p.z];
    const rt = (a, b) => [a, [b[0], a[1], a[2]], [b[0], b[1], a[2]], b];
    const e = res.eq, od = e.reactor.OD, odH = e.heater.OD, B = by, out = [];
    const rxIn = [B.RX.x - B.RX.w / 2, B.RX.py, -(B.RX.n - 1) * B.RX.pz / 2], rxOut = [B.RX.x + B.RX.w / 2, B.RX.py, (B.RX.n - 1) * B.RX.pz / 2];
    out.push([rt(R(B.WT), L(B.P1)), B.WT, 0.02, 1], [rt(R(B.P1), L(B.HX)), B.P1, odH, 1], [rt(R(B.HX), [B.EH.x - B.EH.w / 2, 0.2, 0]), B.HX, odH, 1],
      [rt([B.EH.x + B.EH.w / 2, B.EH.h - 0.1, 0], L(B.MX)), B.EH, odH, 1], [rt(R(B.ST), L(B.P2)), B.ST, 0.02, 1],
      [[[B.P2.x, B.P2.py, B.P2.z + B.P2.d / 2], [B.P2.x, B.MX.py, B.P2.z + B.P2.d / 2], [B.MX.x, B.MX.py, -B.MX.d / 2]], B.P2, od, 1],
      [[R(B.MX), rxIn], B.MX, od, 0], [rt(rxOut, L(B.QV)), B.RX, od, 1], [rt(R(B.QV), L(B.V1)), B.QV, od * 1.5, 1]);
    const yTop = Math.max(B.V1.h, B.EH.h, B.HX.h) + 0.15, sOD = Math.max(0.012, B.V1.D * 0.2);
    out.push([[T(B.V1), [B.V1.x, yTop, 0], [B.HX.x, yTop, 0], T(B.HX)], B.V1, sOD, 1, 1], [[[B.V1.x, yTop, 0], [B.CD.x, yTop, 0], [B.CD.x, yTop, zB], T(B.CD)], B.V1, sOD, 0, 1]);
    const y2 = Math.max(B.V2.h, B.CD.h) + 0.1;
    out.push([[T(B.V2), [B.V2.x, y2, zB], [B.CD.x - B.CD.w / 4, y2, zB], [B.CD.x - B.CD.w / 4, B.CD.h, zB]], B.V2, sOD * 0.7, 0, 1]);
    out.push([[[B.V1.x, 0.13, B.V1.d / 2], [B.V1.x, 0.13, zB - B.V2.d / 2]], B.V1, 0.012, 1]);
    for (let i = 0; i < rowB.length - 1; i++) out.push([rt(L(B[rowB[i]]), R(B[rowB[i + 1]])), B[rowB[i]], 0.012, 1]);
    for (const id of ['F1', 'NA', 'NB']) out.push([[[B[id].x, 0.12, B[id].z + B[id].d / 2], [B[id].x, 0.12, B[id].z + B[id].d / 2 + 0.22]], B[id], 0.012, 0]);
    pipes = out;
  }

  /* ---------- three.js scene ---------- */
  function init3() {
    const host = $('m3host');
    if (!T3 || !T3.OrbitControls) { $('m3note').textContent = 'The 3D view could not load its graphics library. Part data is still available from the Part menu.'; return; }
    try { renderer = new T3.WebGLRenderer({ antialias: true }); } catch (err) { $('m3note').textContent = 'This browser has no WebGL. Part data is still available from the Part menu.'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.insertBefore(renderer.domElement, host.firstChild);
    scene = new T3.Scene(); camera = new T3.PerspectiveCamera(38, 1, 0.01, 200);
    scene.add(new T3.AmbientLight(0xffffff, 0.75));
    const dl = new T3.DirectionalLight(0xffffff, 0.7); dl.position.set(3, 6, 4); scene.add(dl);
    group = new T3.Group(); scene.add(group);
    controls = new T3.OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = PI / 2 - 0.02;
    ray = new T3.Raycaster();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', ev => { down = [ev.clientX, ev.clientY]; });
    renderer.domElement.addEventListener('pointerup', ev => {
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
      const b = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera({ x: (ev.clientX - b.left) / b.width * 2 - 1, y: -(ev.clientY - b.top) / b.height * 2 + 1 }, camera);
      const hit = ray.intersectObjects(group.children, true).find(x => x.object.userData.pid);
      if (hit) select(hit.object.userData.pid);
    });
    const size = () => { const w = host.clientWidth, hh = host.clientHeight; renderer.setSize(w, hh); camera.aspect = w / hh; camera.updateProjectionMatrix(); };
    size(); if (window.ResizeObserver) new ResizeObserver(size).observe(host); else window.addEventListener('resize', size);
    if (window.IntersectionObserver) new IntersectionObserver(en => { visible = en[0].isIntersecting; }).observe(host);
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => res && draw());
    ok3 = true;
  }
  const mat = (col, o) => new T3.MeshStandardMaterial(Object.assign({ color: col, roughness: 0.55, metalness: 0.2 }, o || {}));
  function cyl(r, len, m, pid) { const g = new T3.Mesh(new T3.CylinderGeometry(r, r, len, 24), m); g.userData.pid = pid; return g; }
  function seg(a, b, r, m, pid) {
    const va = new T3.Vector3(a[0], a[1], a[2]), vb = new T3.Vector3(b[0], b[1], b[2]), dv = vb.clone().sub(va), len = dv.length();
    if (len < 1e-6) return null;
    const g = cyl(r, len, m, pid); g.position.copy(va).add(vb).multiplyScalar(0.5); g.quaternion.setFromUnitVectors(new T3.Vector3(0, 1, 0), dv.normalize());
    return g;
  }
  function val(p) { return mode === 'T' ? p.T : mode === 'P' ? Math.log10(p.P) : p.byp; }
  function draw() {
    if (!ok3) return;
    while (group.children.length) { const o = group.children[group.children.length - 1]; group.remove(o); o.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }); }
    movers = [];
    renderer.setClearColor(new T3.Color(css('--surface')));
    const vals = parts.map(val), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), nrm = v => (v - lo) / (hi - lo || 1);
    const shell = () => mat(css('--muted'), { transparent: true, opacity: 0.28, depthWrite: false });
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, hmax = 0;
    for (const p of parts) {
      const m = mat(rampColor(nrm(val(p)))), g = new T3.Group(); g.position.set(p.x, 0, p.z);
      const addm = o => { g.add(o); return o; };
      if (p.t === 'v') {
        if (p.coil) {
          addm(cyl(p.D / 2, p.H, shell(), p.id)).position.y = 0.1 + p.H / 2;
          const c = p.coil;
          class Helix extends T3.Curve { getPoint(t) { const a = 2 * PI * c.turns * t; return new T3.Vector3(c.Dc / 2 * Math.cos(a), 0.2 + c.coilH * t, c.Dc / 2 * Math.sin(a)); } }
          const tube = new T3.Mesh(new T3.TubeGeometry(new Helix(), Math.min(1400, Math.ceil(c.turns * 28)), Math.max(c.OD / 2, 0.004), 6, false), m); tube.userData.pid = p.id; addm(tube);
        } else {
          addm(cyl(p.D / 2, p.H, m, p.id)).position.y = 0.1 + p.H / 2;
          if (p.caps) for (const s of [0, 1]) { const cap = new T3.Mesh(new T3.SphereGeometry(p.D / 2, 24, 12), m); cap.scale.y = 0.45; cap.position.y = 0.1 + s * p.H; cap.userData.pid = p.id; addm(cap); }
        }
        for (let i = 0; i < 3; i++) { const a = i * 2 * PI / 3, leg = cyl(Math.max(0.006, p.D * 0.04), 0.1, mat(css('--muted')), p.id); leg.position.set(p.D * 0.4 * Math.cos(a), 0.05, p.D * 0.4 * Math.sin(a)); addm(leg); }
      } else if (p.t === 'h') { const c = addm(cyl(p.D / 2, p.L, m, p.id)); c.rotation.z = PI / 2; c.position.y = p.py; addm(cyl(Math.max(0.008, p.D * 0.1), p.py, mat(css('--muted')), p.id)).position.y = p.py / 2;
      } else if (p.t === 'b') { const b = new T3.Mesh(new T3.BoxGeometry(p.bw, p.bh, p.bd), m); b.position.y = p.y0 + p.bh / 2; b.userData.pid = p.id; addm(b);
        if (p.y0 > 0.05) addm(cyl(0.008, p.y0, mat(css('--muted')), p.id)).position.y = p.y0 / 2;
      } else if (p.t === 'r') {
        for (let i = 0; i < p.n; i++) {
          const z = (i - (p.n - 1) / 2) * p.pz, tube = addm(cyl(Math.max(p.OD / 2, 0.004), p.legL, m, p.id)), ins = addm(cyl(p.D / 2, p.legL, shell(), p.id));
          tube.rotation.z = ins.rotation.z = PI / 2; tube.position.set(0, p.py, z); ins.position.set(0, p.py, z);
          if (i < p.n - 1) { const xe = (i % 2 ? -1 : 1) * p.legL / 2, u = seg([xe, p.py, z], [xe, p.py, z + p.pz], Math.max(p.OD / 2, 0.004), m, p.id); if (u) addm(u); }
        }
        for (const s of [-0.35, 0.35]) addm(cyl(0.01, p.py, mat(css('--muted')), p.id)).position.set(s * p.legL, p.py / 2, 0);
      } else if (p.t === 'm') {
        const shown = Math.min(p.n, 16);
        for (let i = 0; i < shown; i++) { const c = addm(cyl(p.D / 2, p.L, m, p.id)); c.rotation.z = PI / 2; c.position.set(0, 0.15 + p.D * 0.7 + (i % 4) * p.D * 1.4, (Math.floor(i / 4) - (Math.ceil(shown / 4) - 1) / 2) * p.D * 1.4); }
        addm(cyl(0.01, 0.15, mat(css('--muted')), p.id)).position.y = 0.075;
      }
      group.add(g);
      x0 = Math.min(x0, p.x - p.w / 2); x1 = Math.max(x1, p.x + p.w / 2); z0 = Math.min(z0, p.z - p.d / 2); z1 = Math.max(z1, p.z + p.d / 2); hmax = Math.max(hmax, p.h);
    }
    const ext = Math.max(x1 - x0, z1 - z0), rmin = 0.0016 * ext;
    for (const pp of pipes) {
      const pts = pp[0], src = pp[1], r = Math.max(pp[2] / 2, rmin), m = pp[4] ? mat(css('--muted'), { transparent: true, opacity: 0.55 }) : mat(rampColor(nrm(val(src))));
      let len = 0; const cum = [0];
      for (let i = 0; i < pts.length - 1; i++) {
        const s = seg(pts[i], pts[i + 1], r, m, src.id); if (s) group.add(s);
        const j = new T3.Mesh(new T3.SphereGeometry(r, 10, 8), m); j.position.set(pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]); group.add(j);
        len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]); cum.push(len);
      }
      if (pp[3] && !reduce && len > 0.05) {
        const n = Math.min(5, Math.max(1, Math.round(len / (0.12 * ext))));
        for (let i = 0; i < n; i++) { const s = new T3.Mesh(new T3.SphereGeometry(r * 1.9, 10, 8), new T3.MeshBasicMaterial({ color: css('--ink') })); group.add(s); movers.push({ s, pts, cum, len, v: 0.08 * ext, off: i * len / n }); }
      }
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, gs = Math.ceil((ext * 1.25) / 0.5) * 0.5, grid = new T3.GridHelper(gs, Math.round(gs / 0.25), css('--muted'), css('--rule'));
    grid.position.set(cx, 0, cz); group.add(grid);
    const bar = new T3.Mesh(new T3.BoxGeometry(1, 0.012, 0.03), new T3.MeshBasicMaterial({ color: css('--accent') })); bar.position.set(x0 + 0.5, 0.006, z1 + 0.12); group.add(bar);
    if (Math.abs(ext - lastExtent) / (lastExtent || 1e-9) > 0.12) { lastExtent = ext; fit(cx, hmax, cz, ext); }
    state.fit = [cx, hmax, cz, ext]; state.bar = [x0 + 0.5, 0.03, z1 + 0.12];
    highlight();
    const u = mode === 'T' ? ' °C' : mode === 'P' ? ' MPa' : ' g/kg', f = v => fmt(mode === 'P' ? Math.pow(10, v) : v, 3) + u;
    $('m3lo').textContent = f(lo); $('m3hi').textContent = f(hi); $('m3bar').style.background = 'linear-gradient(90deg,' + rampOf().join(',') + ')';
    $('m3note').textContent = 'To scale: floor grid 0.25 m, blue bar 1 m. Process tubes are drawn no thinner than ' + fmt(rmin * 2000, 2) + ' mm so they stay visible; true sizes are in the part panel. Moving dots show direction only.';
    if (!started) { started = true; frame(); }
  }
  const state = {};
  function fit(cx, hmax, cz, ext) { controls.target.set(cx, hmax * 0.35, cz); const dist = 1.5 * ext / Math.min(1.25, camera.aspect); camera.position.set(cx + dist * 0.3, hmax * 0.4 + dist * 0.42, cz + dist * 0.85); controls.update(); }
  function highlight() {
    if (!ok3) return;
    const acc = new T3.Color(css('--accent'));
    group.traverse(o => { if (o.material && o.material.emissive && o.userData.pid) { o.material.emissive.copy(o.userData.pid === sel ? acc : new T3.Color(0)); o.material.emissiveIntensity = 0.55; } });
  }
  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    controls.update();
    const t = performance.now() / 1000;
    for (const m of movers) {
      const s = (t * m.v + m.off) % m.len; let i = 0; while (i < m.cum.length - 2 && m.cum[i + 1] < s) i++;
      const f = (s - m.cum[i]) / (m.cum[i + 1] - m.cum[i] || 1), a = m.pts[i], b = m.pts[i + 1];
      m.s.position.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
    }
    renderer.render(scene, camera);
    const w = renderer.domElement.clientWidth, hh = renderer.domElement.clientHeight, v = new T3.Vector3();
    for (const l of labels) {
      v.set(l.pos[0], l.pos[1], l.pos[2]).project(camera);
      const on = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      l.el.hidden = !on;
      if (on) l.el.style.transform = 'translate(' + ((v.x + 1) / 2 * w).toFixed(1) + 'px,' + ((1 - v.y) / 2 * hh).toFixed(1) + 'px) translate(-50%,-110%)';
    }
  }

  /* ---------- part panel ---------- */
  function panel() {
    const p = parts.find(x => x.id === sel) || parts[0]; if (!p) return;
    const dl = rows => '<dl class="m3dl">' + rows.map(x => '<dt>' + x[0] + '</dt><dd>' + x[1] + '</dd>').join('') + '</dl>';
    const sp = S.SP.filter(s => s !== 'W' && ((p.a && p.a.c[s] > 0.005) || (p.b && p.b.c[s] > 0.005))).sort((x, y) => (p.a.c[y] + (p.b ? p.b.c[y] : 0)) - (p.a.c[x] + (p.b ? p.b.c[x] : 0))).slice(0, 14);
    const tb = sp.length ? '<div class="scroll"><table class="num"><thead><tr><th>g per kg of stream</th><th>' + p.a.n + '</th>' + (p.b ? '<th>' + p.b.n + '</th>' : '') + '</tr></thead><tbody>' +
      sp.map(s => '<tr><th scope="row">' + S.NAMES[s] + '</th><td>' + fmt(p.a.c[s], 3) + '</td>' + (p.b ? '<td>' + fmt(p.b.c[s], 3) + '</td>' : '') + '</tr>').join('') +
      '<tr><th scope="row"><b>All by-products</b></th><td><b>' + fmt(p.a.c.byp, 3) + '</b></td>' + (p.b ? '<td><b>' + fmt(p.b.c.byp, 3) + '</b></td>' : '') + '</tr></tbody></table></div>' : '<p class="muted">Clean water: nothing dissolved.</p>';
    $('m3info').innerHTML = '<div><span class="eyebrow">' + p.tag + '</span><h2>' + p.name + '</h2></div><h3>Dimensions</h3>' + dl(p.dims) + '<h3>Flow, temperature, pressure</h3>' + dl(p.cond) + '<h3>Stream composition</h3>' + tb +
      '<p class="muted">By-products are every dissolved organic except glucose, fructose and the C5/C6 sugar oligomers.</p>';
  }
  function select(id) { sel = id; $('m3part').value = id; labels.forEach(l => l.el.classList.toggle('sel', l.id === id)); highlight(); panel(); }

  function update(r) {
    res = r; parts = buildParts(r); layout(parts);
    const ps = $('m3part');
    if (!ps.options.length) { ps.innerHTML = parts.map(p => '<option value="' + p.id + '">' + p.tag + ' · ' + p.name + '</option>').join(''); ps.value = sel; }
    if (ok3) {
      const le = $('m3labels');
      if (!labels.length) { le.innerHTML = parts.map(p => '<button type="button" data-id="' + p.id + '">' + p.tag + '</button>').join('') + '<span>1 m</span>'; labels = parts.map((p, i) => ({ id: p.id, el: le.children[i], pos: [0, 0, 0] })); labels.push({ id: '_bar', el: le.lastChild, pos: [0, 0, 0] }); }
      draw();
      labels.forEach(l => { const p = parts.find(x => x.id === l.id); l.pos = p ? [p.x, p.h, p.z] : state.bar; l.el.classList.toggle('sel', l.id === sel); });
    }
    panel();
  }
  function boot() {
    init3();
    $('m3part').addEventListener('change', ev => select(ev.target.value));
    $('m3mode').addEventListener('change', ev => { mode = ev.target.value; draw(); });
    $('m3reset').addEventListener('click', () => { if (ok3 && state.fit) fit.apply(null, state.fit); });
    $('m3labels').addEventListener('click', ev => { const id = ev.target.getAttribute && ev.target.getAttribute('data-id'); if (id) select(id); });
  }
  window.SCW3D = { update, boot };
})();
