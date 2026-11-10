/* SCW birch-to-glucose process model (POC v2 architecture: F-01/F-02 -> E-01 -> M-01 -> R-01 -> Q-01 -> V-01 -> S-01 -> S-02).
 * Units: SI unless noted. Species amounts are kg per kg oven-dry debarked birch fed to the reactor.
 * Water properties: IAPWS-95 table (src/water_table.js). Kinetics: Arrhenius about 400 C, calibrated to
 * literature anchors (see README) -- every constant is a parameter meant to be re-fitted on Stage A data. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./water_table.js'));
  else root.SCW = factory(root.WATER_TABLE);
})(typeof self !== 'undefined' ? self : this, function (WT) {
  'use strict';
  const RG = 8.314462, TREF = 673.15, PI = Math.PI;

  /* ---------- water properties ---------- */
  function idxFrac(arr, x) {
    const n = arr.length;
    if (x <= arr[0]) return [0, 0];
    if (x >= arr[n - 1]) return [n - 2, 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m; else hi = m; }
    return [lo, (x - arr[lo]) / (arr[hi] - arr[lo])];
  }
  function wprop(name, T, P) {               // T degC, P MPa
    const ip = idxFrac(WT.P, P), it = idxFrac(WT.T, T), a = WT[name][ip[0]], b = WT[name][ip[0] + 1];
    const va = a[it[0]] + (a[it[0] + 1] - a[it[0]]) * it[1], vb = b[it[0]] + (b[it[0] + 1] - b[it[0]]) * it[1];
    return va + (vb - va) * ip[1];
  }
  const hW = (T, P) => wprop('h', T, P), rhoW = (T, P) => wprop('rho', T, P);
  const muW = (T, P) => wprop('mu', T, P) * 1e-6, kW = (T, P) => wprop('k', T, P);
  const cpW = (T, P) => (hW(T + 0.5, P) - hW(T - 0.5, P)) * 1000;   // J/kg/K
  function TofH(h, P) {
    let lo = WT.T[0], hi = WT.T[WT.T.length - 1];
    for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (hW(m, P) < h) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
  }
  function sat(P) {                           // saturation properties at P (MPa)
    const S = WT.sat, lp = S.P.map(Math.log), f = idxFrac(lp, Math.log(P)), o = {};
    for (const k of ['T', 'hf', 'hg', 'rhof', 'rhog', 'muf', 'kf']) o[k] = S[k][f[0]] + (S[k][f[0] + 1] - S[k][f[0]]) * f[1];
    o.muf *= 1e-6; o.hfg = o.hg - o.hf;
    return o;
  }
  /* Marshall & Franck (1981) ion product of water; T in K, rho in kg/m3 -> Kw in (mol/kg)^2 */
  function Kw(TK, rho) {
    const r = Math.max(rho, 1) / 1000;
    const l = -4.098 - 3245.2 / TK + 2.2362e5 / (TK * TK) - 3.984e7 / (TK * TK * TK) +
      (13.957 - 1262.3 / TK + 8.5641e5 / (TK * TK)) * Math.log10(r);
    return Math.pow(10, l);
  }

  /* ---------- species & stoichiometry ---------- */
  const M = { glc: 180.156, anh: 162.141, ga: 60.052, c3: 90.078, hmf: 126.111, lev: 116.116, fo: 46.025,
    xyl: 150.13, xan: 132.115, fur: 96.085, aca: 60.052, ket: 42.037, ura: 176.124 };
  const SOLID = ['CEL', 'HEM', 'ACG', 'URS', 'LIG', 'ASS'];
  const DISS = ['OLG', 'GLC', 'FRU', 'GA', 'C3', 'LAC', 'AHG', 'HMF', 'LEV', 'FOR', 'XOS', 'XYL', 'FUR', 'ACA', 'URA', 'SLM', 'SLO', 'EXT', 'ASD'];
  const SP = SOLID.concat(DISS, ['W']);       // W = net water released by reaction (negative = consumed)
  const IX = {}; SP.forEach((s, i) => { IX[s] = i; });
  const NAMES = { CEL: 'Cellulose (solid)', HEM: 'Hemicellulose (solid)', ACG: 'Acetyl groups (solid)', URS: 'Uronic groups (solid)',
    LIG: 'Lignin (solid)', ASS: 'Insoluble ash', OLG: 'Cello-oligomers', GLC: 'Glucose', FRU: 'Fructose', GA: 'Glycolaldehyde',
    C3: 'Glyceraldehyde / DHA', LAC: 'Lactic acid', AHG: '1,6-Anhydroglucose', HMF: '5-HMF', LEV: 'Levulinic acid', FOR: 'Formic acid',
    XOS: 'Xylo-oligomers', XYL: 'Xylose (C5 sugars)', FUR: 'Furfural', ACA: 'Acetic acid', URA: 'Uronic acids', SLM: 'Lignin monomers (phenolics)',
    SLO: 'Lignin oligomers', EXT: 'Extractives', ASD: 'Dissolved ash', W: 'Reaction water' };
  /* carbon mass fractions (independent check of the stoichiometric factors) */
  const CF = { CEL: 72.066 / M.anh, OLG: 72.066 / M.anh, AHG: 72.066 / M.anh, GLC: 0.4, FRU: 0.4, GA: 0.4, C3: 0.4, LAC: 0.4, ACA: 0.4,
    HMF: 72.066 / M.hmf, LEV: 60.055 / M.lev, FOR: 12.011 / M.fo, HEM: 60.055 / M.xan, XOS: 60.055 / M.xan, XYL: 0.4, FUR: 60.055 / M.fur,
    ACG: 24.022 / M.ket, URS: 72.066 / M.ura, URA: 72.066 / M.ura, LIG: 0.63, SLM: 0.63, SLO: 0.63, EXT: 0.7, ASS: 0, ASD: 0, W: 0 };
  /* molar mass for osmotic pressure / acid-base (g/mol) */
  const MM = { OLG: 666, GLC: 180.2, FRU: 180.2, GA: 60.05, C3: 90.08, LAC: 90.08, AHG: 162.1, HMF: 126.1, LEV: 116.1, FOR: 46.03,
    XOS: 678, XYL: 150.1, FUR: 96.09, ACA: 60.05, URA: 176.1, SLM: 170, SLO: 800, EXT: 400, ASD: 50 };
  const ACIDS = [['ACA', 4.76], ['FOR', 3.75], ['LAC', 3.86], ['LEV', 4.6], ['URA', 3.3]];
  const RX = [
    ['CEL', 'cel', { OLG: 1 }], ['HEM', 'hem', { XOS: 1 }], ['ACG', 'hem', { ACA: M.aca / M.ket }], ['URS', 'hem', { URA: 1 }],
    ['OLG', 'og', { GLC: M.glc / M.anh }], ['OLG', 'ogra', { GA: M.glc / M.anh }],
    ['GLC', 'gf', { FRU: 1 }], ['FRU', 'fg', { GLC: 1 }], ['GLC', 'gg', { GA: 1 }], ['FRU', 'fra', { C3: 1 }], ['C3', 'c3', { LAC: 1 }],
    ['GLC', 'ga', { AHG: M.anh / M.glc }], ['GLC', 'gh', { HMF: M.hmf / M.glc }], ['FRU', 'fh', { HMF: M.hmf / M.glc }],
    ['HMF', 'hl', { LEV: M.lev / M.hmf, FOR: M.fo / M.hmf }],
    ['XOS', 'ox', { XYL: M.xyl / M.xan }], ['XOS', 'oxra', { GA: M.ga / M.xan, C3: M.c3 / M.xan }],
    ['XYL', 'xf', { FUR: M.fur / M.xyl }], ['XYL', 'xra', { GA: M.ga / M.xyl, C3: M.c3 / M.xyl }]
  ].map(r => {
    const prod = Object.keys(r[2]).map(s => [IX[s], r[2][s]]);
    return { from: IX[r[0]], key: r[1], prod, wfac: 1 - prod.reduce((a, q) => a + q[1], 0) };
  });

  /* ---------- default parameters ---------- */
  const DEFAULTS = {
    target: { glucoseKgDay: 1.0, hoursPerDay: 6 },
    feed: { moistureWB: 0.45, barkLoss: 0.12, prepLoss: 0.03,
      comp: { CEL: 0.41, HEM: 0.24, ACG: 0.044, URS: 0.04, LIG: 0.226, EXT: 0.036, ASH: 0.004 }, ashSolubleFrac: 0.7, cationEqPerKgAsh: 20 },
    slurry: { solids: 0.06, dpUm: 150, T: 20, cpSolids: 1.6, rhoParticle: 1100, cpParticle: 2800, kParticle: 0.3, slipFrac: 0.06, millKWhPerKgAt1mm: 0.03 },
    reactor: { T: 400, P: 25, tau: 0.2, Thw: 550, uTarget: 5, insulMm: 50, kInsul: 0.05, Tamb: 20, roughUm: 1.5, heaterBlockDT: 60, uHeater: 8 },
    quench: { Pf1: 1.5, quenchWater: 0, Pf2: 0.1 },
    finishing: { holdMin: 20 },
    recovery: { heatRecovery: true, approachK: 10, recEff: 0.9, Tin: 15 },
    purification: { cakeLiquor: 1.5, washEff: 0.85, washRatio: 2, dsA: 0.08, NA: 3, dsB: 0.15, NB: 4, dsSyrup: 0.65,
      LpA: 8, dPA: 10, LpB: 4, dPB: 30, membraneHours: 16, filterFluxLMH: 300,
      RA: { OLG: 0.85, GLC: 0.08, FRU: 0.08, GA: 0.02, C3: 0.03, LAC: 0.05, AHG: 0.07, HMF: 0.05, LEV: 0.05, FOR: 0, XOS: 0.75, XYL: 0.05, FUR: 0.03, ACA: 0, URA: 0.25, SLM: 0.15, SLO: 0.9, EXT: 0.6, ASD: 0.2 },
      RB: { OLG: 0.995, GLC: 0.975, FRU: 0.975, GA: 0.35, C3: 0.55, LAC: 0.55, AHG: 0.95, HMF: 0.6, LEV: 0.6, FOR: 0.1, XOS: 0.99, XYL: 0.9, FUR: 0.25, ACA: 0.15, URA: 0.97, SLM: 0.75, SLO: 0.99, EXT: 0.9, ASD: 0.8 } },
    volatility: { ACA: 0.7, FOR: 0.6, FUR: 6, GA: 0.08, HMF: 0.01, LAC: 0.02, LEV: 0.03, SLM: 1.0, C3: 0.05, EXT: 0.05 },
    utilities: { pumpEff: 0.5, heaterEff: 0.95, startupMin: 30, auxKW: 0.3, memPumpEff: 0.45, evapEconomy: 0.9, condensateReuse: 0 },
    /* kref = rate constant at 400 C / 25 MPa (1/s); Ea kJ/mol; ion = scales with sqrt(Kw) when P differs from 25 MPa;
       kH = acid-catalysed second-order constant (L/mol/s) at TH (K) with EaH -- used in the finishing hold only. */
    kinetics: {
      cel: { kref: 200, EaSuper: 430.3, EaSub: 154.4, EaLow: 215 },
      hem: { kref: 50, Ea: 125 },
      lig: { kref: 8, Ea: 80, solubleFrac: 0.3, monomerFrac: 0.2 },
      DeRef: 3.5e-9,
      og: { kref: 5, Ea: 135.2, ion: 1, kH: 2.4e-3, TH: 394.15, EaH: 130 },
      gg: { kref: 1.5, Ea: 115 }, DPc: 4, endFactor: 2.5,
      gf: { kref: 0.6, Ea: 111.5, ion: 1 }, KeqGF: 1,
      fra: { kref: 4, Ea: 115 }, c3: { kref: 1.5, Ea: 90 }, ga: { kref: 0.25, Ea: 100 },
      gh: { kref: 0.01, Ea: 110, ion: 1, kH: 4.4e-3, TH: 453.15, EaH: 137.5 },
      fh: { kref: 0.05, Ea: 110, ion: 1, kH: 0.05, TH: 453.15, EaH: 137.5 },
      hl: { kH: 0.02, TH: 453.15, EaH: 110 },
      ox: { kref: 20, Ea: 125, ion: 1, kH: 7e-3, TH: 394.15, EaH: 125 },
      xra: { kref: 2.5, Ea: 115 }, DPx: 5,
      xf: { kref: 0.2, Ea: 110, ion: 1, kH: 1.3e-2, TH: 453.15, EaH: 135 }
    }
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(base, over) {
    const out = clone(base);
    (function rec(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && a[k] && typeof a[k] === 'object') rec(a[k], b[k]); else a[k] = b[k]; } })(out, over || {});
    return out;
  }

  /* ---------- kinetics ---------- */
  function kCel(q, T) {
    const Tc = 647.096, Tl = 573.15, e = (Ea, T1, T0) => Math.exp(-Ea * 1e3 / RG * (1 / T1 - 1 / T0));
    if (T >= Tc) return q.kref * e(q.EaSuper, T, TREF);
    const kc = q.kref * e(q.EaSuper, Tc, TREF);
    if (T >= Tl) return kc * e(q.EaSub, T, Tc);
    return kc * e(q.EaSub, Tl, Tc) * e(q.EaLow, T, Tl);
  }
  function rateConsts(K, env) {               // env: Tp, Tf (K), ionic, H (mol/L), tauMt (s)
    const a = (q, T) => q.kref * Math.exp(-q.Ea * 1e3 / RG * (1 / T - 1 / TREF));
    const ion = q => (q.ion ? env.ionic : 1);
    const ac = (q, T) => (env.H > 0 && q.kH ? q.kH * Math.exp(-q.EaH * 1e3 / RG * (1 / T - 1 / q.TH)) * env.H : 0);
    const mt = k => 1 / (1 / Math.max(k, 1e-30) + env.tauMt), Tf = env.Tf, k = {};
    k.cel = mt(kCel(K.cel, env.Tp)); k.hem = mt(a(K.hem, env.Tp)); k.lig = a(K.lig, env.Tp);
    k.og = a(K.og, Tf) * ion(K.og) + ac(K.og, Tf); k.gg = a(K.gg, Tf); k.ogra = K.endFactor * k.gg / K.DPc;
    k.gf = a(K.gf, Tf) * ion(K.gf); k.fg = k.gf / K.KeqGF;
    k.fra = a(K.fra, Tf); k.c3 = a(K.c3, Tf); k.ga = a(K.ga, Tf);
    k.gh = a(K.gh, Tf) * ion(K.gh) + ac(K.gh, Tf); k.fh = a(K.fh, Tf) * ion(K.fh) + ac(K.fh, Tf); k.hl = ac(K.hl, Tf);
    k.ox = a(K.ox, Tf) * ion(K.ox) + ac(K.ox, Tf); k.xra = a(K.xra, Tf); k.oxra = K.endFactor * k.xra / K.DPx;
    k.xf = a(K.xf, Tf) * ion(K.xf) + ac(K.xf, Tf);
    k.max = Math.max(k.cel, k.hem, k.lig, k.og, k.gg, k.gf, k.fra, k.c3, k.gh, k.fh, k.hl, k.ox, k.xra, k.xf);
    return k;
  }
  function deriv(y, k, ligFloor, ligMono, dy) {
    dy.fill(0);
    for (let i = 0; i < RX.length; i++) {
      const r = RX[i], rate = k[r.key] * y[r.from];
      dy[r.from] -= rate;
      for (let j = 0; j < r.prod.length; j++) dy[r.prod[j][0]] += rate * r.prod[j][1];
      dy[IX.W] += rate * r.wfac;
    }
    const rl = k.lig * Math.max(0, y[IX.LIG] - ligFloor);
    dy[IX.LIG] -= rl; dy[IX.SLM] += rl * ligMono; dy[IX.SLO] += rl * (1 - ligMono);
  }
  const _b = [0, 1, 2, 3, 4].map(() => new Float64Array(SP.length));
  function rk4(y, k, dt, ligFloor, ligMono) {
    const n = Math.max(1, Math.ceil(dt * k.max / 0.5)), h = dt / n, k1 = _b[0], k2 = _b[1], k3 = _b[2], k4 = _b[3], t = _b[4];
    for (let s = 0; s < n; s++) {
      deriv(y, k, ligFloor, ligMono, k1);
      for (let i = 0; i < y.length; i++) t[i] = y[i] + 0.5 * h * k1[i];
      deriv(t, k, ligFloor, ligMono, k2);
      for (let i = 0; i < y.length; i++) t[i] = y[i] + 0.5 * h * k2[i];
      deriv(t, k, ligFloor, ligMono, k3);
      for (let i = 0; i < y.length; i++) t[i] = y[i] + h * k3[i];
      deriv(t, k, ligFloor, ligMono, k4);
      for (let i = 0; i < y.length; i++) y[i] = Math.max(0, y[i] + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) * (i === IX.W ? 1 : 1));
    }
  }
  /* rk4 clamps at zero, which would break W (can be negative): integrate W unclamped separately */
  function stepSpecies(y, k, dt, ligFloor, ligMono) {
    const before = massSum(y);
    const w0 = y[IX.W]; y[IX.W] = 0; rk4(y, k, dt, ligFloor, ligMono);
    y[IX.W] = w0 + (before - w0) - massSum(y) + y[IX.W];   // close the water term on total mass
  }
  function massSum(y) { let s = 0; for (let i = 0; i < y.length; i++) s += y[i]; return s; }
  function carbon(y) { let s = 0; for (let i = 0; i < SP.length; i++) s += y[i] * CF[SP[i]]; return s; }

  /* particle heat-up time constant: Ranz-Marshall film (turbulent slip) in series with internal conduction */
  function particleTau(sl, dp, rho, mu, kf, cp, u) {
    const Rep = rho * sl.slipFrac * u * dp / mu, Pr = Math.min(8, Math.max(0.7, cp * mu / kf));
    const Nu = 2 + 0.6 * Math.sqrt(Rep) * Math.cbrt(Pr), hEff = 1 / (dp / (Nu * kf) + dp / (10 * sl.kParticle));
    return sl.rhoParticle * sl.cpParticle * dp / (6 * hEff);
  }

  /* weak-acid charge balance -> [H+] (mol/L) in the hot liquor */
  function hPlus(y, litres, TC, cationEq) {
    const d = 2.7e-5 * (TC - 25) * (TC - 25), kw = Kw(TC + 273.15, 1000 - 0.0025 * Math.pow(Math.max(TC - 4, 0), 1.9));
    const ac = ACIDS.map(a => [y[IX[a[0]]] / MM[a[0]] * 1000 / litres, Math.pow(10, -(a[1] + d))]);
    const f = h => { let s = h + cationEq / litres - kw / h; for (const a of ac) s -= a[0] * a[1] / (a[1] + h); return s; };
    let lo = Math.log(1e-10), hi = Math.log(1);
    for (let i = 0; i < 50; i++) { const m = 0.5 * (lo + hi); if (f(Math.exp(m)) > 0) hi = m; else lo = m; }
    return Math.exp(0.5 * (lo + hi));
  }

  /* single-stage equilibrium flash of the liquor: returns liquid & vapour species vectors */
  function flashSplit(y, mWater, xv, Kvol) {
    const yl = Float64Array.from(y), yv = new Float64Array(y.length), V = mWater * xv, L = mWater * (1 - xv);
    for (const s in Kvol) { const i = IX[s], f = Kvol[s] * V / (Kvol[s] * V + L + 1e-12); yv[i] = y[i] * f; yl[i] = y[i] - yv[i]; }
    yl[IX.W] = y[IX.W]; yv[IX.W] = 0;
    return { yl, yv, mL: L, mV: V };
  }

  /* ---------- hardware catalogue & pressure design ---------- */
  const TUBES = [[1 / 16, 0.508], [1 / 16, 0.762], [1 / 16, 1.016], [1 / 8, 1.397], [1 / 8, 1.753], [3 / 16, 2.985], [1 / 4, 3.048], [1 / 4, 3.861],
    [1 / 4, 4.572], [3 / 8, 5.309], [3 / 8, 6.223], [3 / 8, 7.036], [1 / 2, 8.484], [1 / 2, 9.398], [3 / 4, 13.51], [1, 19.3], [1.5, 28.6], [2, 38.1]]
    .map(t => ({ name: fracIn(t[0]) + '" OD x ' + t[1].toFixed(2) + ' mm ID', OD: t[0] * 25.4e-3, ID: t[1] * 1e-3 }));
  function fracIn(x) { const m = { 0.0625: '1/16', 0.125: '1/8', 0.1875: '3/16', 0.25: '1/4', 0.375: '3/8', 0.5: '1/2', 0.75: '3/4', 1: '1', 1.5: '1-1/2', 2: '2' }; return m[x] || String(x); }
  /* Indicative allowable stress (MPa) -- NOT design allowables; verify against ASME II-D and the heat certificate. */
  const S_ALLOW = { 'Alloy 625': [[20, 276], [400, 250], [500, 240], [550, 230], [600, 190], [650, 130], [700, 75]],
    '316/316L': [[20, 115], [200, 100], [300, 90], [400, 85], [500, 80]] };
  function allowable(mat, T) {
    const c = S_ALLOW[mat]; if (T <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) if (T <= c[i][0]) return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * (T - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
    return c[c.length - 1][1] * 0.5;
  }
  function wallCheck(tube, mat, Tmetal, P) {   // ASME B31.3 eq. 3a, E=W=1, Y=0.4, design P = 1.1 x operating
    const Pd = 1.1 * P, S = allowable(mat, Tmetal), tReq = Pd * tube.OD / (2 * (S + 0.4 * Pd)), wall = (tube.OD - tube.ID) / 2;
    return { mat, Tmetal, S, tReqMm: tReq * 1e3, wallMm: wall * 1e3, ok: wall >= tReq, margin: wall / tReq };
  }
  function pickTube(Dtarget, minID) {
    let best = null, bs = 1e9;
    for (const t of TUBES) { if (t.ID < minID) continue; const s = Math.abs(Math.log(t.ID / Dtarget)); if (s < bs) { bs = s; best = t; } }
    return best || TUBES[TUBES.length - 1];
  }
  function friction(Re, relRough) {
    if (Re < 2300) return 64 / Math.max(Re, 1);
    return Math.pow(-1.8 * Math.log10(Math.pow(relRough / 3.7, 1.11) + 6.9 / Re), -2);
  }

  /* ---------- downstream physical purification ---------- */
  function purify(p, yIn, wIn) {
    const pu = p.purification, y = Float64Array.from(yIn), S = {};
    const dsum = v => DISS.reduce((a, s) => a + v[IX[s]], 0);
    /* S-01 reusable solid/liquid separation with displacement wash */
    const solids = SOLID.reduce((a, s) => a + y[IX[s]], 0), cakeLiq = solids * pu.cakeLiquor, liquor = wIn + dsum(y);
    const loss = Math.min(1, cakeLiq / liquor) * (1 - pu.washEff), washW = pu.washRatio * cakeLiq;
    const cake = new Float64Array(y.length), filt = new Float64Array(y.length);
    SOLID.forEach(s => { cake[IX[s]] = y[IX[s]]; });
    DISS.forEach(s => { cake[IX[s]] = y[IX[s]] * loss; filt[IX[s]] = y[IX[s]] * (1 - loss); });
    let w = wIn + washW - cakeLiq * (wIn / liquor);
    S.cake = { y: cake, w: cakeLiq * (wIn / liquor), solids };
    S.filtrate = { y: Float64Array.from(filt), w };
    /* S-02A loose NF (monomers pass, oligomers & lignin oligomers held): dilute, then diafilter */
    let dilW = 0; const ds0 = dsum(filt);
    if (ds0 / (w + ds0) > pu.dsA) { dilW = ds0 * (1 - pu.dsA) / pu.dsA - w; w += dilW; }
    const permA = new Float64Array(y.length), retA = new Float64Array(y.length), dfA = pu.NA * (w + ds0);
    DISS.forEach(s => { const f = 1 - Math.exp(-(1 - pu.RA[s]) * pu.NA); permA[IX[s]] = filt[IX[s]] * f; retA[IX[s]] = filt[IX[s]] * (1 - f); });
    S.retA = { y: retA, w }; S.permA = { y: Float64Array.from(permA), w: dfA };
    const osm = (v, wat, R) => 0.083145 * 298.15 * DISS.reduce((a, s) => a + v[IX[s]] / MM[s] * 1000 * R[s], 0) / wat;
    const piA = osm(filt, w, pu.RA);
    /* S-02B tight NF: concentrate (batch, constant rejection) then constant-volume diafiltration */
    let wB = dsum(permA) * (1 - pu.dsB) / pu.dsB, ret = new Float64Array(y.length);
    for (let it = 0; it < 4; it++) {
      const vcf = Math.max(1, dfA / wB);
      DISS.forEach(s => { ret[IX[s]] = permA[IX[s]] * Math.pow(vcf, pu.RB[s] - 1); });
      wB = Math.min(dfA, dsum(ret) * (1 - pu.dsB) / pu.dsB);
    }
    const piB = osm(ret, wB, pu.RB);
    DISS.forEach(s => { ret[IX[s]] *= Math.exp(-(1 - pu.RB[s]) * pu.NB); });
    const permB = new Float64Array(y.length); DISS.forEach(s => { permB[IX[s]] = permA[IX[s]] - ret[IX[s]]; });
    const permBw = dfA - wB + pu.NB * wB;
    S.permB = { y: permB, w: permBw };
    /* evaporation to syrup with steam-volatile carry-over */
    const dsR = dsum(ret), wSyr = dsR * (1 - pu.dsSyrup) / pu.dsSyrup, evapW = Math.max(0, wB - wSyr);
    const fl = flashSplit(ret, wB, evapW / wB, p.volatility);
    S.evap = { y: fl.yv, w: evapW }; S.product = { y: fl.yl, w: wB - evapW };
    S.meta = { washW, dilW, dfA, dfB: pu.NB * wB, permAw: dfA, permBw, evapW, piA, piB, lossS01: loss };
    return S;
  }

  /* ---------- one pass through the plant at a given dry-wood feed ---------- */
  function simulate(pIn, woodDryDay, fixedGeom) {
    const p = pIn, K = p.kinetics, warn = [], R1 = p.reactor, sl = p.slurry;
    const hrs = p.target.hoursPerDay, woodRate = woodDryDay / (hrs * 3600);
    const P = R1.P, w = sl.solids, dp = sl.dpUm * 1e-6;
    const hR = hW(R1.T, P), hHw = hW(R1.Thw, P), hSl = hW(sl.T, P), cps = sl.cpSolids;
    if (hHw <= hR + 20) return { error: 'Hot-water temperature must be well above the reactor temperature.' };
    const ratio = ((1 - w) * (hR - hSl) + w * cps * (R1.T - sl.T)) / (hHw - hR);     // kg hot water / kg slurry
    const mSl = 1 / w, mHw = ratio / w, mW = (1 - w + ratio) / w;                     // per kg dry wood
    const mdotTot = woodRate * (mSl + mHw), mdotW = woodRate * mW;

    /* reactor geometry */
    const rhoR = rhoW(R1.T, P);
    let tube, Lfix = null;
    if (fixedGeom) { tube = fixedGeom.tube; Lfix = fixedGeom.L; }
    else tube = pickTube(Math.sqrt(4 * mdotTot / rhoR / (PI * R1.uTarget)), 5 * dp);
    const A = PI * tube.ID * tube.ID / 4;

    /* initial state */
    const c = p.feed.comp, y = new Float64Array(SP.length);
    y[IX.CEL] = c.CEL; y[IX.HEM] = c.HEM; y[IX.ACG] = c.ACG; y[IX.URS] = c.URS; y[IX.LIG] = c.LIG; y[IX.EXT] = c.EXT;
    y[IX.ASD] = c.ASH * p.feed.ashSolubleFrac; y[IX.ASS] = c.ASH * (1 - p.feed.ashSolubleFrac);
    const m0 = massSum(y), c0 = carbon(y), ligFloor = c.LIG * (1 - K.lig.solubleFrac), cationEq = y[IX.ASD] * p.feed.cationEqPerKgAsh;

    /* ---- R-01: Lagrangian plug-flow integration ---- */
    let hf = (ratio * hHw + (1 - w) * hSl) / (ratio + 1 - w), Tp = sl.T, t = 0, x = 0, dP = 0, ReMin = 1e99, uIn = 0;
    const N = 1500, prof = { t: [], x: [], Tf: [], Tp: [], y: [] };
    const muRef = muW(400, 25), solidsPerWater = 1 / mW;
    const rIns = tube.OD / 2, rOut = rIns + R1.insulMm * 1e-3;
    const rec = () => { prof.t.push(t); prof.x.push(x); prof.Tf.push(TofH(hf, P)); prof.Tp.push(Tp); prof.y.push(Float64Array.from(y)); };
    rec();
    for (let i = 0; i < N; i++) {
      const Tf = TofH(hf, P), rho = rhoW(Tf, P), mu = muW(Tf, P), kf = kW(Tf, P), u = mdotTot / (rho * A);
      if (i === 0) uIn = u;
      const dt = Lfix ? (Lfix / N) / u : R1.tau / N, dx = u * dt;
      const ionic = Math.min(5, Math.max(0.2, Math.sqrt(Kw(Tf + 273.15, rho) / Kw(Tf + 273.15, rhoW(Tf, 25)))));
      const De = K.DeRef * ((Tf + 273.15) / TREF) * (muRef / mu), tauMt = dp * dp / (60 * De);
      const k = rateConsts(K, { Tp: Tp + 273.15, Tf: Tf + 273.15, ionic, H: 0, tauMt });
      stepSpecies(y, k, dt, ligFloor, K.lig.monomerFrac);
      const tauH = particleTau(sl, dp, rho, mu, kf, cpW(Tf, P), u);
      const dTp = (Tf - Tp) * (1 - Math.exp(-dt / tauH));
      const qLoss = 2 * PI * R1.kInsul * (Tf - R1.Tamb) / Math.log(rOut / rIns);                 // W/m
      hf -= solidsPerWater * cps * dTp + qLoss * dx / mdotW / 1000;
      Tp += dTp;
      const Re = rho * u * tube.ID / mu; ReMin = Math.min(ReMin, Re);
      dP += friction(Re, R1.roughUm * 1e-6 / tube.ID) * dx / tube.ID * rho * u * u / 2;
      t += dt; x += dx;
      if ((i + 1) % 10 === 0) rec();
    }
    const Tout = TofH(hf, P), tau = t, Lr = x, rhoOut = rhoW(Tout, P);
    const yR = Float64Array.from(y);

    /* ---- Q-01 / V-01: flash quench ---- */
    const q = p.quench, s1 = sat(q.Pf1), s2 = sat(Math.min(q.Pf2, q.Pf1));
    const mW1 = mW * (1 + q.quenchWater);
    const h1 = (mW * hf + mW * q.quenchWater * hW(p.recovery.Tin, P) + cps * (Tp - s1.T)) / mW1;
    let xv1 = (h1 - s1.hf) / s1.hfg;
    if (xv1 > 0.97) { warn.push({ lvl: 'crit', msg: 'Flash V-01 would run nearly dry (vapour fraction ' + (xv1 * 100).toFixed(0) + '%): sugars would bake onto hot walls. Add quench water or raise the flash pressure.' }); xv1 = 0.97; }
    if (xv1 < 0) xv1 = 0;
    const f1 = flashSplit(y, mW1, xv1, p.volatility);

    /* ---- R-02: water-only finishing hold in the V-01 liquor ---- */
    const y2 = f1.yl, T2 = s1.T, litres = f1.mL / s1.rhof * 1000;
    let holdS = p.finishing.holdMin * 60;
    if (fixedGeom && fixedGeom.holdL != null) holdS = fixedGeom.holdL / (woodRate * litres + 1e-30);
    const prof2 = { t: [0], y: [Float64Array.from(y2)], pH: [] };
    const tauMt2 = dp * dp / (60 * K.DeRef * ((T2 + 273.15) / TREF) * (muRef / s1.muf));
    let H = hPlus(y2, litres, T2, cationEq); prof2.pH.push(-Math.log10(H));
    const N2 = holdS > 0 ? 300 : 0;
    for (let i = 0; i < N2; i++) {
      H = hPlus(y2, litres, T2, cationEq);
      const k = rateConsts(K, { Tp: T2 + 273.15, Tf: T2 + 273.15, ionic: 1, H, tauMt: tauMt2 });
      stepSpecies(y2, k, holdS / N2, ligFloor, K.lig.monomerFrac);
      if ((i + 1) % 5 === 0) { prof2.t.push((i + 1) * holdS / N2 / 60); prof2.y.push(Float64Array.from(y2)); prof2.pH.push(-Math.log10(H)); }
    }
    const pHhot = -Math.log10(hPlus(y2, litres, T2, cationEq)), pHcold = -Math.log10(hPlus(y2, litres, 25, cationEq));

    /* ---- V-02: second flash to near-atmospheric, then cool ---- */
    let xv2 = q.Pf2 < q.Pf1 ? Math.max(0, (s1.hf - s2.hf) / s2.hfg) : 0;
    const f2 = flashSplit(y2, f1.mL, xv2, p.volatility);
    const yL = f2.yl, wL = f2.mL;

    /* ---- S-01 / S-02 ---- */
    const pur = purify(p, yL, wL), prod = pur.product;
    const c6 = prod.y[IX.GLC] + prod.y[IX.FRU], dsProd = DISS.reduce((a, s) => a + prod.y[IX[s]], 0);

    /* ---- balances ---- */
    const allOut = [f1.yv, f2.yv, pur.cake.y, pur.retA.y, pur.permB.y, pur.evap.y, prod.y];
    let mOut = yL[IX.W], cOut = 0;
    for (const v of allOut) { for (let i = 0; i < SP.length; i++) { if (i !== IX.W) mOut += v[i]; cOut += v[i] * CF[SP[i]]; } }
    const massErr = (mOut - m0) / m0, carbErr = (cOut - c0) / c0;

    /* ---- heat integration & energy (per kg dry wood, kJ) ---- */
    const rc = p.recovery, ut = p.utilities, hIn = hW(rc.Tin, P);
    let Tpre = rc.Tin, Qpre = 0;
    const steam1 = f1.mV * s1.hfg;
    if (rc.heatRecovery && s1.T - rc.approachK > rc.Tin) {
      Tpre = s1.T - rc.approachK; Qpre = mHw * (hW(Tpre, P) - hIn);
      if (Qpre > steam1 * rc.recEff) { Qpre = steam1 * rc.recEff; Tpre = TofH(hIn + Qpre / mHw, P); }
    }
    const QheatHw = mHw * (hHw - hIn) - Qpre;                                          // kJ/kg wood into E-01
    const heaterKW = QheatHw * woodRate / ut.heaterEff;
    const perDay = woodDryDay, kWh = kJ => kJ / 3600;
    const startups = hrs < 24 ? 1 : 0;
    const E = {};
    E.heater = kWh(QheatHw * perDay) / ut.heaterEff;
    E.startup = heaterKW * ut.startupMin / 60 * startups;
    E.pumps = kWh((mHw + mSl) * (P * 1000 + dP / 1000) / 1000 * perDay / ut.pumpEff) * (1000 / 1000);
    E.milling = perDay * sl.millKWhPerKgAt1mm * (1000 / sl.dpUm);
    const meta = pur.meta;
    E.membranes = kWh((meta.permAw * p.purification.dPA * 100 + meta.permBw * p.purification.dPB * 100) / 1000 * perDay / ut.memPumpEff);
    const steamLeft = steam1 - Qpre + f2.mV * s2.hfg, evapNeed = meta.evapW * 2330 / ut.evapEconomy;
    E.evaporation = kWh(Math.max(0, evapNeed - steamLeft) * perDay);
    E.aux = ut.auxKW * (hrs + ut.startupMin / 60 * startups);
    E.total = E.heater + E.startup + E.pumps + E.milling + E.membranes + E.evaporation + E.aux;
    const c6Day = c6 * perDay;
    const coolingKW = Math.max(0, steamLeft - evapNeed) * woodRate;

    /* ---- water ledger (kg per kg dry wood) ---- */
    const moistW = p.feed.moistureWB / (1 - p.feed.moistureWB);
    const water = { slurryMakeup: Math.max(0, (1 - w) / w - moistW), hotWater: mHw, quench: mW * q.quenchWater, wash: meta.washW, dilution: meta.dilW,
      diafiltration: meta.dfA + meta.dfB, condensate: f1.mV + f2.mV + meta.evapW, permeateB: meta.permBw };
    water.totalIn = water.slurryMakeup + water.hotWater + water.quench + water.wash + water.dilution + water.diafiltration;
    water.fresh = water.totalIn - ut.condensateReuse * water.condensate;

    /* ---- equipment sizing ---- */
    const eq = {};
    const wcR = wallCheck(tube, 'Alloy 625', Math.max(R1.T, prof.Tf[0]) + 15, P);
    eq.reactor = { tube: tube.name, ID: tube.ID, OD: tube.OD, L: Lr, volMl: A * Lr * 1e6, tau, uIn, uOut: mdotTot / (rhoOut * A), ReMin, dPbar: dP / 1e5, Tin: prof.Tf[0], Tout, wall: wcR,
      heatLossW: 2 * PI * R1.kInsul * (R1.T - R1.Tamb) / Math.log(rOut / rIns) * Lr };
    /* E-01 electric hot-water heater: coil in a heated block at Thw + dT */
    const mdotHw = woodRate * mHw, rhoHw = rhoW(R1.Thw, P), tubeH = pickTube(Math.sqrt(4 * mdotHw / rhoHw / (PI * R1.uHeater)), 0);
    const Tblock = R1.Thw + R1.heaterBlockDT, hPre = hW(Tpre, P), AH = PI * tubeH.ID * tubeH.ID / 4;
    let LH = 0, dPH = 0, fluxMax = 0;
    for (let i = 0; i < 80; i++) {
      const ha = hPre + (hHw - hPre) * (i + 0.5) / 80, T = TofH(ha, P), rho = rhoW(T, P), mu = muW(T, P), kf = kW(T, P), u = mdotHw / (rho * AH);
      const Re = rho * u * tubeH.ID / mu, Pr = Math.min(8, Math.max(0.7, cpW(T, P) * mu / kf));
      const NuT = 0.023 * Math.pow(Math.max(Re, 1), 0.8) * Math.pow(Pr, 0.4), Nu = Re > 4000 ? NuT : Re < 2300 ? 4.36 : 4.36 + (NuT - 4.36) * (Re - 2300) / 1700;
      const hi = Nu * kf / tubeH.ID, dL = mdotHw * (hHw - hPre) / 80 * 1000 / (hi * PI * tubeH.ID * (Tblock - T));
      LH += dL; fluxMax = Math.max(fluxMax, hi * (Tblock - T));
      dPH += friction(Re, R1.roughUm * 1e-6 / tubeH.ID) * dL / tubeH.ID * rho * u * u / 2;
    }
    eq.heater = { tube: tubeH.name, OD: tubeH.OD, ID: tubeH.ID, L: LH, dutyKW: QheatHw * woodRate, elecKW: heaterKW, Tblock, fluxMaxKWm2: fluxMax / 1000, dPbar: dPH / 1e5, wall: wallCheck(tubeH, 'Alloy 625', Tblock, P), Tpre };
    /* pumps */
    const qHwMlMin = mdotHw / rhoW(rc.Tin, P) * 6e7, qSlMlMin = woodRate * mSl / 1010 * 6e7;
    eq.pumps = { hotWaterMlMin: qHwMlMin, slurryMlMin: qSlMlMin, headMPa: P + (dP + dPH) / 1e6, hydKW: (mdotTot / 1000) * P * 1e6 / 1000 };
    /* M-01 mixing tee */
    eq.mixer = { ratio, TmixWater: prof.Tf[0], mixTimeMs: 10 * tube.ID / uIn * 1000, heatUpMs: particleTau(sl, dp, rhoR, muW(R1.T, P), kW(R1.T, P), cpW(R1.T, P), uIn) * 1000 };
    /* Q-01 flash valve (choked, homogeneous estimate) */
    const G = 0.61 * Math.sqrt(2 * rhoOut * (P - Math.max(q.Pf1, 0.55 * P)) * 1e6), dOr = Math.sqrt(4 * mdotTot / (PI * G));
    eq.valve = { orificeMm: dOr * 1e3, massFlux: G };
    /* V-01 flash separator + R-02 hold volume */
    const mdotV1 = woodRate * f1.mV, mdotL1 = woodRate * f1.mL, uMax = 0.07 * Math.sqrt((s1.rhof - s1.rhog) / s1.rhog);
    const DvMin = Math.max(0.04, Math.sqrt(4 * mdotV1 / s1.rhog / (PI * uMax))), holdL = woodRate * litres * holdS;
    const vesselL = PI * DvMin * DvMin / 4 * 3 * DvMin * 1000 + holdL * 1.3;      // disengagement space + liquor sump
    const Dv = Math.max(DvMin, Math.cbrt(4 * vesselL / 1000 / (3 * PI)));          // 3:1 vessel that holds it
    eq.flash = { Dmm: Dv * 1e3, Hmm: 3 * Dv * 1e3, DminMm: DvMin * 1e3, holdL, vesselL, T: s1.T, PMPa: q.Pf1, vapFrac: xv1, wallMm: Math.max(1.5, 1.1 * q.Pf1 * Dv / (2 * 100 - 1.2 * 1.1 * q.Pf1) * 1e3), holdS };
    /* HX-01 condensing preheater */
    const dT1 = s1.T - rc.Tin, dT2 = s1.T - Tpre, lmtd = Qpre > 0 ? (dT1 - dT2) / Math.log(dT1 / Math.max(dT2, 0.1)) : 0;
    eq.preheater = { dutyKW: Qpre * woodRate, areaM2: Qpre > 0 ? Qpre * woodRate * 1000 / (1200 * lmtd) : 0, Tpre, coolingKW };
    /* S-01 / S-02 */
    const pu = p.purification, memRate = perDay / pu.membraneHours;                    // kg wood / h equivalent
    const JA = Math.max(0.1 * pu.dPA, pu.dPA - meta.piA) * pu.LpA, JB = Math.max(0.1 * pu.dPB, pu.dPB - meta.piB) * pu.LpB;
    eq.filter = { areaM2: (pur.filtrate.w + pur.cake.w) * woodRate * 3600 / pu.filterFluxLMH, cakeKgDay: pur.cake.solids * perDay };
    eq.nfA = { areaM2: meta.permAw * memRate / JA, fluxLMH: JA, osmBar: meta.piA };
    eq.nfB = { areaM2: meta.permBw * memRate / JB, fluxLMH: JB, osmBar: meta.piB };
    eq.evap = { waterKgDay: meta.evapW * perDay };

    /* ---- warnings ---- */
    const W2 = (lvl, msg) => warn.push({ lvl, msg });
    if (ReMin < 4000) W2('warn', 'Reactor Reynolds number ' + ReMin.toFixed(0) + ' is not fully turbulent: residence-time distribution broadens and particles can settle. The plug-flow yield is optimistic.');
    if (tube.ID < 5 * dp) W2('crit', 'Reactor bore is under 5 particle diameters: bridging / plugging risk.');
    if (dOr < 3 * dp) W2('crit', 'Flash-valve orifice ' + (dOr * 1e3).toFixed(2) + ' mm is under 3 feed-particle diameters (' + sl.dpUm + ' um): it will plug. Mill finer, run fewer hours per day at a higher flow, or use a capillary letdown.');
    else if (dOr < 0.3e-3) W2('warn', 'Flash-valve orifice ' + (dOr * 1e3).toFixed(2) + ' mm is very small; erosion and partial plugging will shift pressure.');
    if (!wcR.ok) W2('crit', 'Reactor tube wall is below the indicative B31.3 minimum at ' + wcR.Tmetal.toFixed(0) + ' C.');
    if (!eq.heater.wall.ok) W2('crit', 'Heater coil wall is below the indicative B31.3 minimum at block temperature ' + Tblock.toFixed(0) + ' C.');
    if (Tblock > 600) W2('warn', 'Heater block at ' + Tblock.toFixed(0) + ' C is in the creep range of alloy 625; allowable stress falls steeply. Needs a vendor design basis.');
    if (w > 0.1) W2('warn', 'Slurry at ' + (w * 100).toFixed(0) + ' wt% wood solids: metering at 25 MPa is unproven at this scale (the plan lists pumpability as undemonstrated).');
    if (qSlMlMin < 5) W2('warn', 'Slurry flow ' + qSlMlMin.toFixed(1) + ' mL/min is too low for check-valve slurry pumps; use a piston/syringe feeder.');
    if (s1.T > 225 && holdS > 60) W2('warn', 'Liquor is held at ' + s1.T.toFixed(0) + ' C: sugar degradation is fast at this temperature.');
    if (Math.abs(Tout - R1.T) > 8) W2('warn', 'Reactor outlet is ' + Tout.toFixed(0) + ' C against a ' + R1.T + ' C setpoint (wall heat loss at this scale). Trace-heat or guard-heat the reactor.');
    if (E.total / c6Day > 50) W2('warn', 'Energy ' + (E.total / c6Day).toFixed(0) + ' kWh per kg free C6 exceeds the 20-50 kWh/kg working target. Main levers: slurry solids, hot-water temperature, pressurised heat recovery, free-C6 yield.');
    if (c6 / dsProd < 0.8) W2('warn', 'Product is ' + (c6 / dsProd * 100).toFixed(0) + '% free C6 on dry solids. Xylose and uronic acids co-retain with glucose on a tight NF; this is a mixed sugar syrup, not pure glucose.');
    if (vesselL > 40 && q.Pf1 > 0.1) W2('warn', 'V-01/R-02 holds about ' + vesselL.toFixed(0) + ' L at ' + q.Pf1 + ' MPa: confirm pressure-vessel registration requirements (CSA B51 / RBQ).');

    const sumOf = (v, list) => list.reduce((a, s) => a + v[IX[s]], 0);
    return {
      p, woodDryDay, woodRate, ratio, mSl, mHw, mW, mdotTot, tube, geom: { tube, L: Lr, holdL },
      prof, prof2, yR, yF1: f1, yHold: y2, yF2: f2, yL, wL, pur, prod,
      kpi: { c6PerWood: c6, c6Day, purity: c6 / dsProd, dsProd: dsProd * perDay, syrupKgDay: (dsProd + prod.w) * perDay,
        gaMgPerKgCarb: prod.y[IX.GA] / Math.max(1e-12, c6 + prod.y[IX.XYL] + prod.y[IX.OLG] + prod.y[IX.XOS]) * 1e6,
        rawFreeC6: yR[IX.GLC] + yR[IX.FRU], rawOligPotential: yR[IX.OLG] * M.glc / M.anh, celConv: 1 - yR[IX.CEL] / c.CEL,
        afterHoldC6: y2[IX.GLC] + y2[IX.FRU], purifRecovery: c6 / Math.max(1e-12, yL[IX.GLC] + yL[IX.FRU]),
        kWhPerKg: E.total / c6Day, kcalDay: c6Day * 3750, pHhot, pHcold, T2, xv1, xv2, Tout, tau, massErr, carbErr,
        woodFreshDay: woodDryDay / (1 - p.feed.prepLoss) / (1 - p.feed.barkLoss) / (1 - p.feed.moistureWB),
        solidsResidueDay: sumOf(pur.cake.y, SOLID) * perDay, heaterKW },
      energy: E, water, eq, warn, coolingKW
    };
  }

  /* ---------- solve the wood feed for a target free-C6 output ---------- */
  function solve(pOver, fixedGeom) {
    const p = merge(DEFAULTS, pOver), target = p.target.glucoseKgDay;
    let wood = target / 0.1, res = null, converged = false;
    for (let i = 0; i < 14; i++) {
      res = simulate(p, wood, fixedGeom);
      if (res.error) return res;
      const Y = res.kpi.c6PerWood;
      if (!(Y > 1e-6)) break;
      const next = target / Y;
      if (Math.abs(next - wood) / wood < 1e-4) { converged = true; break; }
      wood = fixedGeom ? Math.min(Math.max(0.5 * (wood + next), wood / 3), wood * 3) : next;
    }
    res.converged = converged;
    if (!converged) res.warn.unshift({ lvl: 'crit', msg: 'Target output is not reachable with this frozen hardware (yield collapses at this flow). Shown: closest operating point.' });
    return res;
  }

  /* ---------- self-checks against published anchors ---------- */
  function validate() {
    const out = [], add = (name, got, lo, hi, unit, ref) => out.push({ name, got, lo, hi, unit, ref, ok: got >= lo && got <= hi });
    add('Water density at 400 C / 25 MPa', rhoW(400, 25), 166.3, 166.8, 'kg/m3', 'NIST: 166.54');
    add('Water enthalpy at 400 C / 25 MPa', hW(400, 25), 2577.5, 2579.7, 'kJ/kg', 'NIST: 2578.6');
    const r = (hW(400, 25) - hW(20, 25)) / (hW(600, 25) - hW(400, 25));
    add('Hot/cold mixing ratio, 600 C water', r, 2.65, 2.75, 'kg/kg', 'Plan sec. 11: 2.70');
    add('Hot-water duty per kg cold slurry', r * (hW(600, 25) - hW(20, 25)) / 1000, 9.0, 9.3, 'MJ/kg', 'Plan sec. 11: 9.147');
    add('Ion product pKw at 400 C / 25 MPa', -Math.log10(Kw(673.15, rhoW(400, 25))), 19.0, 19.8, '', 'Marshall-Franck: ~19.4');
    add('Diafiltration retention, R=0.99, N=9.2', Math.exp(-0.01 * 9.2) * 100, 91.1, 91.3, '%', 'Plan sec. 06: 91.2%');
    const mcc = merge(DEFAULTS, { feed: { comp: { CEL: 1, HEM: 0, ACG: 0, URS: 0, LIG: 0, EXT: 0, ASH: 0 } }, slurry: { dpUm: 10 }, reactor: { tau: 0.02, insulMm: 200 } });
    let s = simulate(mcc, 50), yy = s.yR;
    add('MCC at 400 C / 25 MPa / 0.02 s: soluble C6 sugars', (yy[IX.OLG] + yy[IX.GLC] + yy[IX.FRU]) * 100, 88, 100, 'wt%', 'Cantero 2015: >95 (98)');
    mcc.reactor.tau = 1.0; s = simulate(mcc, 50); yy = s.yR;
    add('MCC at 400 C / 25 MPa / 1 s: glycolaldehyde', yy[IX.GA] * 100, 45, 75, 'wt%', 'Cantero 2015: ~60');
    const d = merge(DEFAULTS, { reactor: { tau: 0.19 } }); s = simulate(d, 50); yy = s.yR;
    const sug = (yy[IX.OLG] * M.glc / M.anh + yy[IX.GLC] + yy[IX.FRU] + yy[IX.XOS] * M.xyl / M.xan + yy[IX.XYL]) / (d.feed.comp.CEL * M.glc / M.anh + d.feed.comp.HEM * M.xyl / M.xan);
    add('Biomass at 400 C / 0.19 s: C5+C6 soluble sugar recovery', sug * 100, 55, 80, '%', 'Wheat bran 73; beet pulp 61/71');
    add('Mass balance closure', Math.abs(s.kpi.massErr) * 100, 0, 0.05, '%', 'by construction');
    add('Carbon balance closure', Math.abs(s.kpi.carbErr) * 100, 0, 0.2, '%', 'independent of mass');
    return out;
  }

  return { DEFAULTS, SP, IX, DISS, SOLID, NAMES, CF, M, merge, clone, simulate, solve, validate, purify, hPlus, Kw, sat,
    water: { h: hW, rho: rhoW, mu: muW, k: kW, cp: cpW, TofH }, TUBES, allowable };
});
