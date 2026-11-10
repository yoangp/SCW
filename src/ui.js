(function () {
  'use strict';
  const S = window.SCW, D = S.DEFAULTS, IX = S.IX, $ = id => document.getElementById(id);
  const state = { frozen: null, frozenAt: null, res: null };

  function fmt(x, sig) {
    sig = sig || 3;
    if (x == null || !isFinite(x)) return '–';
    if (x === 0) return '0';
    x = Number(x.toPrecision(sig)); const a = Math.abs(x);
    if (a >= 1000) return Math.round(x).toLocaleString('en-US');
    return x.toFixed(Math.min(6, Math.max(0, sig - 1 - Math.floor(Math.log10(a)))));
  }
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const getPath = (o, p) => p.split('.').reduce((a, k) => a[k], o);
  function setPath(o, p, v) { const ks = p.split('.'); let a = o; while (ks.length > 1) { const k = ks.shift(); a = a[k] = a[k] || {}; } a[ks[0]] = v; }

  /* group, id, label, path, min, max, step, unit, display scale | 'mult' */
  const CT = [
    ['op', 'hours', 'On-stream hours per day', 'target.hoursPerDay', 1, 24, 1, 'h'],
    ['op', 'TR', 'Reactor temperature', 'reactor.T', 380, 420, 1, '°C'],
    ['op', 'P', 'Reactor pressure', 'reactor.P', 23, 30, 0.5, 'MPa'],
    ['op', 'tau', 'Reactor residence time', 'reactor.tau', 0.05, 1, 0.01, 's'],
    ['op', 'Thw', 'Hot-water temperature', 'reactor.Thw', 450, 620, 5, '°C'],
    ['op', 'solids', 'Slurry solids', 'slurry.solids', 0.02, 0.2, 0.005, 'wt%', 100],
    ['op', 'dp', 'Milled particle size', 'slurry.dpUm', 40, 400, 10, 'µm'],
    ['op', 'Pf1', 'Flash pressure, V-01', 'quench.Pf1', 0.3, 4, 0.1, 'MPa'],
    ['op', 'hold', 'Finishing hold in V-01 liquor', 'finishing.holdMin', 0, 90, 1, 'min'],
    ['op', 'qw', 'Quench water at Q-01', 'quench.quenchWater', 0, 0.5, 0.01, 'kg/kg'],
    ['feed', 'moist', 'Wood moisture, wet basis', 'feed.moistureWB', 0.1, 0.6, 0.01, '%', 100],
    ['feed', 'cel', 'Cellulose', 'feed.comp.CEL', 0.3, 0.5, 0.005, '% dry', 100],
    ['feed', 'hem', 'Hemicellulose', 'feed.comp.HEM', 0.15, 0.35, 0.005, '% dry', 100],
    ['feed', 'lig', 'Lignin', 'feed.comp.LIG', 0.15, 0.3, 0.002, '% dry', 100],
    ['pur', 'NA', 'Loose-NF diavolumes, S-02A', 'purification.NA', 1, 8, 0.5, ''],
    ['pur', 'NB', 'Tight-NF diavolumes, S-02B', 'purification.NB', 0, 15, 0.5, ''],
    ['pur', 'Rg', 'Tight-NF glucose rejection', 'purification.RB.GLC', 0.9, 0.999, 0.001, '%', 100],
    ['pur', 'Rx', 'Tight-NF xylose rejection', 'purification.RB.XYL', 0.5, 0.99, 0.01, '%', 100],
    ['pur', 'Rga', 'Tight-NF glycolaldehyde rejection', 'purification.RB.GA', 0, 0.9, 0.01, '%', 100],
    ['kin', 'mCel', 'Cellulose dissolution rate', 'kinetics.cel.kref', 0.25, 4, 0.05, '×', 'mult'],
    ['kin', 'mDe', 'In-particle diffusivity', 'kinetics.DeRef', 0.25, 4, 0.05, '×', 'mult'],
    ['kin', 'mOg', 'Oligomer hydrolysis rate (SCW)', 'kinetics.og.kref', 0.25, 4, 0.05, '×', 'mult'],
    ['kin', 'mGg', 'Glucose retro-aldol rate', 'kinetics.gg.kref', 0.25, 4, 0.05, '×', 'mult'],
    ['kin', 'mOgH', 'Acid-catalysed oligomer hydrolysis', 'kinetics.og.kH', 0.25, 4, 0.05, '×', 'mult']
  ];
  function buildControls() {
    const g = {};
    for (const c of CT) {
      const def = c[8] === 'mult' ? 1 : getPath(D, c[3]);
      (g[c[0]] = g[c[0]] || []).push('<div class="ctl"><label for="c_' + c[1] + '">' + c[2] + '</label><output id="o_' + c[1] + '"></output>' +
        '<input type="range" id="c_' + c[1] + '" min="' + c[4] + '" max="' + c[5] + '" step="' + c[6] + '" value="' + def + '"></div>');
    }
    for (const k in g) $('ctl_' + k).innerHTML = g[k].join('');
  }
  function readOverrides() {
    const o = {};
    for (const c of CT) {
      const v = +$('c_' + c[1]).value;
      setPath(o, c[3], c[8] === 'mult' ? getPath(D, c[3]) * v : v);
      $('o_' + c[1]).textContent = (c[8] === 'mult' ? v.toFixed(2) : fmt(v * (typeof c[8] === 'number' ? c[8] : 1), 3)) + ' ' + c[7];
    }
    o.purification.RB.FRU = o.purification.RB.GLC;
    const cmp = Object.assign({}, D.feed.comp, o.feed.comp), tot = Object.values(cmp).reduce((a, b) => a + b, 0);
    for (const k in cmp) cmp[k] /= tot;
    o.feed.comp = cmp;
    o.recovery = { heatRecovery: $('c_rec').checked };
    o.target.glucoseKgDay = targetVal();
    return o;
  }
  const targetVal = () => 0.1 * Math.pow(10, +$('target').value / 50);

  /* ---------- charts ---------- */
  function niceMax(v) { if (!(v > 0)) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }
  function lineChart(host, o) {
    const Wd = Math.max(260, host.clientWidth), H = 230, m = { l: 46, r: 14, t: 10, b: 36 }, pw = Wd - m.l - m.r, ph = H - m.t - m.b;
    const x0 = o.x[0], x1 = o.x[o.x.length - 1] || 1;
    let lo = o.ymin != null ? o.ymin : 0, hi = 0;
    for (const s of o.series) for (const v of s.v) hi = Math.max(hi, v);
    hi = o.ymin != null ? Math.ceil(hi / 50) * 50 : niceMax(hi);
    const X = v => m.l + (v - x0) / (x1 - x0 || 1) * pw, Y = v => m.t + ph - (v - lo) / (hi - lo) * ph;
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const yv = lo + (hi - lo) * i / 4, y = Y(yv);
      g += '<line x1="' + m.l + '" x2="' + (Wd - m.r) + '" y1="' + y + '" y2="' + y + '" class="grid"/><text x="' + (m.l - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="tick">' + fmt(yv, 3) + '</text>';
      const xv = x0 + (x1 - x0) * i / 4;
      g += '<text x="' + X(xv) + '" y="' + (H - m.b + 16) + '" text-anchor="middle" class="tick">' + fmt(xv, 3) + '</text>';
    }
    g += '<line x1="' + m.l + '" x2="' + (Wd - m.r) + '" y1="' + Y(lo) + '" y2="' + Y(lo) + '" class="axis"/>';
    g += '<text x="' + (m.l + pw / 2) + '" y="' + (H - 4) + '" text-anchor="middle" class="tick">' + o.xl + '</text>';
    for (const s of o.series) {
      let d = '';
      for (let i = 0; i < o.x.length; i++) d += (i ? 'L' : 'M') + X(o.x[i]).toFixed(1) + ' ' + Y(s.v[i]).toFixed(1);
      g += '<path d="' + d + '" fill="none" stroke="var(' + s.c + ')" stroke-width="2" stroke-linejoin="round"/>';
    }
    g += '<g class="hov" visibility="hidden"><line y1="' + m.t + '" y2="' + (m.t + ph) + '" class="axis"/>' +
      o.series.map(s => '<circle r="4" fill="var(' + s.c + ')" stroke="var(--surface)" stroke-width="2"/>').join('') + '</g>';
    host.innerHTML = '<div class="legend">' + o.series.map(s => '<span><i style="background:var(' + s.c + ')"></i>' + s.n + '</span>').join('') + '</div>' +
      '<div class="plot"><svg width="' + Wd + '" height="' + H + '" role="img" aria-label="' + esc(o.title) + '">' + g +
      '<rect x="' + m.l + '" y="' + m.t + '" width="' + pw + '" height="' + ph + '" fill="transparent" class="hit"/></svg><div class="tip" hidden></div></div>';
    const hit = host.querySelector('.hit'), hov = host.querySelector('.hov'), tip = host.querySelector('.tip'), dots = hov.querySelectorAll('circle'), vl = hov.querySelector('line');
    const move = ev => {
      const r = hit.getBoundingClientRect(), fx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), xv = x0 + fx * (x1 - x0);
      let i = 0; while (i < o.x.length - 1 && Math.abs(o.x[i + 1] - xv) < Math.abs(o.x[i] - xv)) i++;
      const px = X(o.x[i]);
      vl.setAttribute('x1', px); vl.setAttribute('x2', px);
      o.series.forEach((s, j) => { dots[j].setAttribute('cx', px); dots[j].setAttribute('cy', Y(s.v[i])); });
      hov.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = '<b>' + fmt(o.x[i], 3) + ' ' + o.xu + '</b>' + o.series.map(s => '<div><i style="background:var(' + s.c + ')"></i>' + s.n + '<em>' + fmt(s.v[i], 3) + ' ' + o.yu + '</em></div>').join('');
      tip.style.left = (px > Wd / 2 ? px - tip.offsetWidth - 10 : px + 10) + 'px';
    };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { hov.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }
  const pick = (ys, list, scale) => ys.map(y => list.reduce((a, s) => a + y[IX[s]], 0) * scale);
  const DEG = ['C3', 'LAC', 'AHG', 'HMF', 'LEV', 'FOR', 'FUR'];
  function charts(r) {
    const p1 = r.prof, p2 = r.prof2, tms = p1.t.map(t => t * 1000);
    lineChart($('ch_r1'), { title: 'Reactor species profile', x: tms, xl: 'time in R-01, ms', xu: 'ms', yu: '% of dry wood', series: [
      { n: 'Free glucose + fructose', c: '--s1', v: pick(p1.y, ['GLC', 'FRU'], 100) }, { n: 'C6 oligomers', c: '--s2', v: pick(p1.y, ['OLG'], 100) },
      { n: 'Cellulose, solid', c: '--s3', v: pick(p1.y, ['CEL'], 100) }, { n: 'C5 sugars', c: '--s4', v: pick(p1.y, ['XOS', 'XYL'], 100) },
      { n: 'Glycolaldehyde', c: '--s5', v: pick(p1.y, ['GA'], 100) }, { n: 'Other degradation', c: '--s6', v: pick(p1.y, DEG, 100) }] });
    lineChart($('ch_T'), { title: 'Reactor temperature profile', x: tms, xl: 'time in R-01, ms', xu: 'ms', yu: '°C', ymin: 0, series: [
      { n: 'Fluid', c: '--s1', v: p1.Tf }, { n: 'Wood particle', c: '--s2', v: p1.Tp }] });
    if (p2.t.length > 2) lineChart($('ch_r2'), { title: 'Finishing hold species profile', x: p2.t, xl: 'hold time in V-01 liquor, min', xu: 'min', yu: '% of dry wood', series: [
      { n: 'Free glucose + fructose', c: '--s1', v: pick(p2.y, ['GLC', 'FRU'], 100) }, { n: 'C6 oligomers', c: '--s2', v: pick(p2.y, ['OLG'], 100) },
      { n: 'C5 sugars', c: '--s4', v: pick(p2.y, ['XOS', 'XYL'], 100) }, { n: 'Glycolaldehyde', c: '--s5', v: pick(p2.y, ['GA'], 100) },
      { n: 'Other degradation', c: '--s6', v: pick(p2.y, DEG, 100) }] });
    else $('ch_r2').innerHTML = '<p class="muted">Hold time is zero: the liquor is flashed straight through.</p>';
  }

  /* ---------- mass fate ---------- */
  function fate(r) {
    const org = v => S.SP.reduce((a, s) => a + (s === 'W' ? 0 : v[IX[s]]), 0), pr = r.prod.y, c6 = pr[IX.GLC] + pr[IX.FRU];
    const rows = [['Free glucose + fructose in syrup', c6, '--s1'], ['Other solids in syrup', org(pr) - c6, '--s2'], ['Loose-NF retentate (oligomers, lignin)', org(r.pur.retA.y), '--s3'],
      ['Tight-NF permeate (glycolaldehyde, acids, lost sugar)', org(r.pur.permB.y), '--s4'], ['Steam-volatiles to condensate', org(r.yF1.yv) + org(r.yF2.yv) + org(r.pur.evap.y), '--s5'],
      ['Filter cake (lignin-rich solids)', org(r.pur.cake.y), '--s6']];
    const tot = rows.reduce((a, q) => a + q[1], 0);
    $('fate').innerHTML = '<div class="stack" role="img" aria-label="Where one kilogram of dry birch ends up">' + rows.map(q => '<div title="' + q[0] + ': ' + fmt(q[1] * 1000) + ' g/kg" style="flex:' + q[1] + ';background:var(' + q[2] + ')"></div>').join('') + '</div>' +
      '<ul class="fate-l">' + rows.map(q => '<li><i style="background:var(' + q[2] + ')"></i><span>' + q[0] + '</span><b>' + fmt(q[1] * 1000) + ' g</b><em>' + fmt(q[1] / tot * 100, 2) + '%</em></li>').join('') + '</ul>' +
      '<p class="muted">Per kg of dry wood fed. Outputs total ' + fmt(tot * 1000, 4) + ' g because hydrolysis binds ' + fmt((tot - 1) * 1000, 2) + ' g of water.</p>';
  }

  /* ---------- flowsheet ---------- */
  function flowsheet(r) {
    const k = r.kpi, e = r.eq, h = 3600, wr = r.woodRate, perDay = r.woodDryDay;
    const B = [
      ['F-01', 'Water', 10, 30, [fmt(wr * r.mHw * h) + ' kg/h', fmt(e.pumps.headMPa, 3) + ' MPa pump']],
      ['HX-01', 'Preheater', 148, 30, ['to ' + fmt(e.preheater.Tpre, 3) + ' °C', fmt(e.preheater.dutyKW) + ' kW saved']],
      ['E-01', 'Heater', 286, 30, ['to ' + r.p.reactor.Thw + ' °C', fmt(e.heater.elecKW) + ' kW']],
      ['M-01', 'Mix tee', 424, 30, ['ratio ' + fmt(r.ratio, 3) + ' : 1', 'heat-up ' + fmt(e.mixer.heatUpMs, 2) + ' ms']],
      ['R-01', 'Reactor', 562, 30, [fmt(k.Tout, 3) + ' °C · ' + r.p.reactor.P + ' MPa', fmt(k.tau * 1000, 3) + ' ms · ' + fmt(e.reactor.L, 3) + ' m']],
      ['Q-01', 'Valve', 700, 30, ['orifice ' + fmt(e.valve.orificeMm, 2) + ' mm', 'to ' + r.p.quench.Pf1 + ' MPa']],
      ['V-01', 'Flash + hold', 838, 30, [fmt(k.T2, 3) + ' °C · ' + fmt(e.flash.holdS / 60, 2) + ' min', 'steam ' + fmt(k.xv1 * 100, 2) + '%']],
      ['V-02', 'Atm. flash', 838, 200, ['liquor ' + fmt(wr * r.wL * h) + ' kg/h', 'pH ' + fmt(k.pHcold, 2) + ' cold']],
      ['S-01', 'Filter', 700, 200, ['cake ' + fmt(k.solidsResidueDay) + ' kg/d', fmt(e.filter.areaM2, 2) + ' m²']],
      ['S-02A', 'Loose NF', 562, 200, [fmt(e.nfA.areaM2, 2) + ' m² · ' + fmt(e.nfA.fluxLMH, 2) + ' LMH', 'holds oligomers']],
      ['S-02B', 'Tight NF', 424, 200, [fmt(e.nfB.areaM2, 2) + ' m² · ' + fmt(e.nfB.fluxLMH, 2) + ' LMH', 'perm. ' + fmt(r.pur.meta.permBw * perDay) + ' kg/d']],
      ['EV-01', 'Evaporator', 286, 200, ['−' + fmt(e.evap.waterKgDay) + ' kg/d water', 'on flash steam']],
      ['Product', 'Syrup', 148, 200, [fmt(k.syrupKgDay) + ' kg/d syrup', fmt(k.c6Day) + ' kg/d C6']],
      ['F-02', 'Slurry', 424, 118, [fmt(wr * r.mSl * h) + ' kg/h · ' + fmt(r.p.slurry.solids * 100, 2) + '%', fmt(wr * h) + ' kg/h wood']]
    ];
    const bw = 124, bh = 62;
    let s = '<defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--muted)"/></marker></defs>';
    const arrow = (x1, y1, x2, y2, cls) => '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="pipe ' + (cls || '') + '" marker-end="url(#ah)"/>';
    for (let i = 0; i < 6; i++) s += arrow(B[i][2] + bw, 61, B[i + 1][2] - 1, 61);
    s += arrow(900, 92, 900, 199);
    for (let i = 7; i < 12; i++) s += arrow(B[i][2], 231, B[i + 1][2] + bw + 1, 231);
    s += arrow(486, 118, 486, 93);
    s += '<path d="M900 30V12H210V29" fill="none" class="pipe steam" marker-end="url(#ah)"/><text x="555" y="9" text-anchor="middle" class="fs-n">flash steam ' + fmt(wr * r.yF1.mV * h) + ' kg/h</text>';
    s += arrow(762, 262, 762, 292, 'steam') + '<text x="762" y="304" text-anchor="middle" class="fs-n">lignin cake</text>';
    s += arrow(624, 262, 624, 292, 'steam') + '<text x="624" y="304" text-anchor="middle" class="fs-n">oligomer retentate</text>';
    s += arrow(486, 262, 486, 292, 'steam') + '<text x="486" y="304" text-anchor="middle" class="fs-n">permeate: GA, acids</text>';
    for (const b of B) {
      s += '<g transform="translate(' + b[2] + ',' + b[3] + ')"><rect width="' + bw + '" height="' + bh + '" rx="3" class="' + (b[0] === 'Product' ? 'fs-b prod' : b[0] === 'R-01' ? 'fs-b hot' : 'fs-b') + '"/>' +
        '<text x="7" y="15" class="fs-t">' + b[0] + '</text><text x="' + (bw - 7) + '" y="15" text-anchor="end" class="fs-n">' + b[1] + '</text>' +
        '<text x="7" y="35" class="fs-v">' + esc(b[4][0]) + '</text><text x="7" y="51" class="fs-v">' + esc(b[4][1]) + '</text></g>';
    }
    $('flow').innerHTML = '<svg viewBox="0 0 972 312" width="972" height="312" role="img" aria-label="Process flowsheet with live stream values">' + s + '</svg>';
  }

  /* ---------- tables ---------- */
  const table = (head, rows, cls) => '<div class="scroll"><table class="' + (cls || '') + '"><thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map((c, i) => (i ? '<td>' : '<th scope="row">') + c + (i ? '</td>' : '</th>')).join('') + '</tr>').join('') + '</tbody></table></div>';
  function tables(r) {
    const k = r.kpi, e = r.eq, E = r.energy, w = r.water, d = r.woodDryDay, h = 3600 * r.woodRate, q = r.p.quench;
    const ds = (v, wat) => { const m = S.DISS.reduce((a, s) => a + v[IX[s]], 0); return fmt(m / (m + wat) * 100, 2) + '%'; };
    $('t_streams').innerHTML = table(['Stream', 'Flow', 'T, °C', 'P, MPa', 'Dissolved solids', 'Free C6'], [
      ['Standing birch, fresh with bark', fmt(k.woodFreshDay) + ' kg/d', '–', '–', '–', '–'],
      ['Milled debarked wood, dry basis', fmt(d) + ' kg/d', '20', '0.1', '–', '–'],
      ['Slurry to M-01', fmt(r.mSl * h) + ' kg/h', r.p.slurry.T, r.p.reactor.P, '–', '–'],
      ['Hot water to M-01', fmt(r.mHw * h) + ' kg/h', r.p.reactor.Thw, r.p.reactor.P, '–', '–'],
      ['R-01 outlet', fmt((r.mSl + r.mHw) * h) + ' kg/h', fmt(k.Tout, 4), r.p.reactor.P, ds(r.yR, r.mW), fmt((r.yR[IX.GLC] + r.yR[IX.FRU]) * h, 3) + ' kg/h'],
      ['V-01 steam', fmt(r.yF1.mV * h) + ' kg/h', fmt(k.T2, 4), q.Pf1, '–', '–'],
      ['V-01 liquor after hold', fmt(r.yF1.mL * h) + ' kg/h', fmt(k.T2, 4), q.Pf1, ds(r.yHold, r.yF1.mL), fmt(k.afterHoldC6 * h, 3) + ' kg/h'],
      ['Liquor to S-01', fmt(r.wL * h) + ' kg/h', '100 → 30', q.Pf2, ds(r.yL, r.wL), fmt((r.yL[IX.GLC] + r.yL[IX.FRU]) * h, 3) + ' kg/h'],
      ['Filter cake, dry solids', fmt(k.solidsResidueDay) + ' kg/d', '30', '0.1', '–', fmt(r.pur.cake.y[IX.GLC] * d, 2) + ' kg/d lost'],
      ['S-02A retentate', fmt(r.pur.retA.w * d) + ' kg/d', '30', '1.0', ds(r.pur.retA.y, r.pur.retA.w), fmt((r.pur.retA.y[IX.GLC] + r.pur.retA.y[IX.FRU]) * d, 2) + ' kg/d lost'],
      ['S-02B permeate', fmt(r.pur.meta.permBw * d) + ' kg/d', '30', '0.1', ds(r.pur.permB.y, r.pur.meta.permBw), fmt((r.pur.permB.y[IX.GLC] + r.pur.permB.y[IX.FRU]) * d, 2) + ' kg/d lost'],
      ['Product syrup', fmt(k.syrupKgDay) + ' kg/d', '60', '0.1', fmt(r.p.purification.dsSyrup * 100, 2) + '%', fmt(k.c6Day, 3) + ' kg/d']]);
    const sp = S.DISS.filter(s => r.yR[IX[s]] > 2e-4 || r.yHold[IX[s]] > 2e-4);
    $('t_species').innerHTML = table(['Species', 'R-01 outlet', 'After hold', 'In syrup', 'Syrup, g/day', 'Syrup, % of solids'], sp.map(s => [S.NAMES[s], fmt(r.yR[IX[s]] * 1000), fmt(r.yHold[IX[s]] * 1000),
      fmt(r.prod.y[IX[s]] * 1000), fmt(r.prod.y[IX[s]] * d * 1000), fmt(r.prod.y[IX[s]] * d / k.dsProd * 100, 2)]), 'num');
    const wl = x => (x.ok ? 'ok ' : 'UNDER ') + fmt(x.wallMm, 3) + ' mm vs ' + fmt(x.tReqMm, 2) + ' mm min';
    $('t_equip').innerHTML = table(['Item', 'Size found by the model', 'Basis'], [
      ['R-01 reactor tube', e.reactor.tube + ', ' + fmt(e.reactor.L, 3) + ' m, ' + fmt(e.reactor.volMl, 3) + ' mL, alloy 625', fmt(e.reactor.uIn, 3) + ' m/s, Re ' + fmt(e.reactor.ReMin) + ', Δp ' + fmt(e.reactor.dPbar, 2) + ' bar, wall ' + wl(e.reactor.wall)],
      ['R-01 insulation', r.p.reactor.insulMm + ' mm microporous', 'loss ' + fmt(e.reactor.heatLossW, 2) + ' W, outlet ' + fmt(k.Tout, 4) + ' °C'],
      ['E-01 heater coil', e.heater.tube + ', ' + fmt(e.heater.L, 3) + ' m in a ' + fmt(e.heater.Tblock, 3) + ' °C block', fmt(e.heater.elecKW) + ' kW electric, peak flux ' + fmt(e.heater.fluxMaxKWm2) + ' kW/m², wall ' + wl(e.heater.wall)],
      ['HX-01 condensing preheater', fmt(e.preheater.areaM2, 2) + ' m²', fmt(e.preheater.dutyKW) + ' kW, water to ' + fmt(e.preheater.Tpre, 3) + ' °C, U 1.2 kW/m²K'],
      ['P-01 water pump', fmt(e.pumps.hotWaterMlMin) + ' mL/min at ' + fmt(e.pumps.headMPa, 3) + ' MPa', 'triplex / HPLC-class plunger pump'],
      ['P-02 slurry pump', fmt(e.pumps.slurryMlMin) + ' mL/min at ' + fmt(e.pumps.headMPa, 3) + ' MPa', fmt(r.p.slurry.solids * 100, 2) + ' wt% wood at ' + r.p.slurry.dpUm + ' µm'],
      ['M-01 mixing tee', 'bore ' + fmt(e.reactor.ID * 1000, 3) + ' mm', 'mixing ≈ ' + fmt(e.mixer.mixTimeMs, 2) + ' ms, water enters at ' + fmt(e.mixer.TmixWater, 3) + ' °C before particles heat'],
      ['Q-01 flash valve', 'orifice ' + fmt(e.valve.orificeMm, 2) + ' mm', 'choked, ' + fmt(e.valve.massFlux) + ' kg/m²s'],
      ['V-01 flash separator', 'Ø' + fmt(e.flash.Dmm) + ' × ' + fmt(e.flash.Hmm) + ' mm, ' + fmt(e.flash.vesselL, 3) + ' L, ' + q.Pf1 + ' MPa', 'liquor hold ' + fmt(e.flash.holdL, 3) + ' L, wall ≥ ' + fmt(e.flash.wallMm, 2) + ' mm 316L'],
      ['Condenser for surplus steam', fmt(e.preheater.coolingKW) + ' kW to reject', 'low-grade heat, about 100 °C'],
      ['S-01 backflushable filter', fmt(e.filter.areaM2, 2) + ' m²', r.p.purification.filterFluxLMH + ' L/m²h'],
      ['S-02A loose NF', fmt(e.nfA.areaM2, 2) + ' m²', fmt(e.nfA.fluxLMH, 2) + ' L/m²h at ' + r.p.purification.dPA + ' bar, osmotic ' + fmt(e.nfA.osmBar, 2) + ' bar'],
      ['S-02B tight NF', fmt(e.nfB.areaM2, 2) + ' m²', fmt(e.nfB.fluxLMH, 2) + ' L/m²h at ' + r.p.purification.dPB + ' bar, osmotic ' + fmt(e.nfB.osmBar, 2) + ' bar']]);
    const en = [['E-01 hot-water heater', E.heater], ['Daily heat-up', E.startup], ['High-pressure pumps', E.pumps], ['Milling', E.milling], ['Membrane pumps', E.membranes], ['Evaporation top-up', E.evaporation], ['Controls and auxiliaries', E.aux]];
    $('t_energy').innerHTML = table(['Energy use', 'kWh/day', 'kWh per kg free C6'], en.map(x => [x[0], fmt(x[1]), fmt(x[1] / k.c6Day)]).concat([['<b>Total</b>', '<b>' + fmt(E.total) + '</b>', '<b>' + fmt(k.kWhPerKg) + '</b>']]), 'num');
    const wa = [['Hot water to E-01', w.hotWater], ['Slurry make-up', w.slurryMakeup], ['Quench', w.quench], ['Cake wash', w.wash], ['Dilution before NF', w.dilution], ['Diafiltration', w.diafiltration]];
    $('t_water').innerHTML = table(['Water use', 'kg/day', 'kg per kg free C6'], wa.map(x => [x[0], fmt(x[1] * d), fmt(x[1] * d / k.c6Day)]).concat([
      ['<b>Total in</b>', '<b>' + fmt(w.totalIn * d) + '</b>', '<b>' + fmt(w.totalIn * d / k.c6Day) + '</b>'], ['Condensate out (reuse candidate)', fmt(w.condensate * d), fmt(w.condensate * d / k.c6Day)], ['NF permeate out', fmt(w.permeateB * d), fmt(w.permeateB * d / k.c6Day)]]), 'num');
  }

  function render() {
    const over = readOverrides(), tgt = over.target.glucoseKgDay;
    $('targetOut').textContent = fmt(tgt, 3);
    let r;
    try { r = S.solve(over, state.frozen); } catch (err) { r = { error: String(err) }; }
    if (r.error) { $('warn').innerHTML = '<li class="crit"><b>Stopped</b>' + esc(r.error) + '</li>'; return; }
    state.res = r;
    const k = r.kpi, theo = r.p.feed.comp.CEL * S.M.glc / S.M.anh;
    const tile = (l, v, u, s) => '<div class="kpi"><span>' + l + '</span><b>' + v + '<small> ' + u + '</small></b><em>' + s + '</em></div>';
    $('kpis').innerHTML = tile('Dry wood feed', fmt(r.woodDryDay), 'kg/day', fmt(k.woodFreshDay) + ' kg/day fresh logs with bark') +
      tile('Free C6 out', fmt(k.c6Day), 'kg/day', fmt(k.kcalDay) + ' kcal/day in ' + fmt(k.syrupKgDay) + ' kg syrup') +
      tile('Yield', fmt(k.c6PerWood * 100, 3), '% of dry wood', fmt(k.c6PerWood / theo * 100, 2) + '% of the glucose locked in cellulose') +
      tile('Syrup purity', fmt(k.purity * 100, 3), '% free C6', 'glycolaldehyde ' + fmt(k.gaMgPerKgCarb / 1000, 2) + ' g per kg carbohydrate') +
      tile('Energy', fmt(k.kWhPerKg), 'kWh/kg', 'heater ' + fmt(k.heaterKW) + ' kW · plan target 20–50') +
      tile('Process water', fmt(r.water.totalIn * r.woodDryDay), 'kg/day', fmt(r.water.totalIn * r.woodDryDay / k.c6Day) + ' kg per kg free C6');
    const chip = (ok, t) => '<span class="chip ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓' : '!') + ' ' + t + '</span>';
    const nc = r.warn.filter(x => x.lvl === 'crit').length;
    $('chips').innerHTML = chip(r.converged, r.converged ? 'Solved for target' : 'Target not reached') + chip(Math.abs(k.massErr) < 1e-3, 'Mass closes to ' + (Math.abs(k.massErr) * 100).toExponential(0) + '%') +
      chip(Math.abs(k.carbErr) < 2e-3, 'Carbon closes to ' + fmt(Math.abs(k.carbErr) * 100, 1) + '%') + chip(nc === 0, r.warn.length + ' design flags' + (nc ? ', ' + nc + ' critical' : ''));
    $('warn').innerHTML = r.warn.length ? r.warn.map(x => '<li class="' + x.lvl + '"><b>' + (x.lvl === 'crit' ? 'Critical' : 'Check') + '</b>' + esc(x.msg) + '</li>').join('') : '<li class="ok"><b>Clear</b>No design flags at this operating point.</li>';
    $('freezeNote').textContent = state.frozen ? 'Hardware frozen as sized for ' + fmt(state.frozenAt, 3) + ' kg/day: ' + state.frozen.tube.name + ' × ' + fmt(state.frozen.L, 3) + ' m, ' + fmt(state.frozen.holdL, 3) + ' L hold. The slider now changes flow through fixed hardware.' :
      'Hardware is re-sized for every setting. Freeze it to see how one built machine behaves when you turn the feed up or down.';
    $('sum1').textContent = 'Cellulose conversion ' + fmt(k.celConv * 100, 3) + '%. Leaving R-01: ' + fmt(k.rawFreeC6 * 1000) + ' g free C6 and ' + fmt(k.rawOligPotential * 1000) + ' g glucose-equivalent still bound in oligomers, per kg dry wood.';
    $('sum2').textContent = 'Liquor at ' + fmt(k.T2, 3) + ' °C, pH ' + fmt(k.pHhot, 3) + ' from the wood’s own acids. Free C6 goes from ' + fmt(k.rawFreeC6 * 1000) + ' to ' + fmt(k.afterHoldC6 * 1000) + ' g per kg dry wood; purification then recovers ' + fmt(k.purifRecovery * 100, 2) + '%.';
    flowsheet(r); charts(r); fate(r); tables(r);
  }
  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };

  function init() {
    buildControls();
    document.querySelectorAll('input').forEach(el => el.addEventListener('input', schedule));
    $('freeze').addEventListener('change', ev => {
      if (ev.target.checked && state.res) { state.frozen = state.res.geom; state.frozenAt = state.res.p.target.glucoseKgDay; } else state.frozen = null;
      schedule();
    });
    $('reset').addEventListener('click', () => {
      for (const c of CT) $('c_' + c[1]).value = c[8] === 'mult' ? 1 : getPath(D, c[3]);
      $('c_rec').checked = true; $('freeze').checked = false; state.frozen = null; $('target').value = 50; schedule();
    });
    $('copy').addEventListener('click', () => {
      const r = state.res; if (!r) return;
      const txt = JSON.stringify({ parameters: r.p, woodDryKgDay: r.woodDryDay, kpi: r.kpi, energyKWhDay: r.energy, waterKgPerKgWood: r.water, equipment: r.eq, flags: r.warn }, null, 1);
      const done = ok => { $('copy').textContent = ok ? 'Copied' : 'Select and copy below'; if (!ok) { $('dump').hidden = false; $('dump').value = txt; $('dump').select(); } setTimeout(() => { $('copy').textContent = 'Copy results as JSON'; }, 2500); };
      try { navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); } catch (e) { done(false); }
    });
    $('t_valid').innerHTML = table(['Check', 'Model', 'Accepted range', 'Reference', ''], S.validate().map(c => [c.name, fmt(c.got, 4) + ' ' + c.unit, c.lo + ' – ' + c.hi, c.ref, c.ok ? '<span class="chip ok">✓ pass</span>' : '<span class="chip bad">! fail</span>']));
    let rz = 0; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => state.res && charts(state.res), 150); });
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
