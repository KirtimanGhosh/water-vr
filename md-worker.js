/* Runs the water simulation (md2.js, TIP4P/Ice) off the main thread. */
importScripts('md2.js');
let S = null, info = null;

function post() {
  const x = new Float32Array(S.x), hb = S.hb.slice(0, 3 * S.nhb);
  self.postMessage({ type: 'frame', x, hb, N: S.N, box: S.box.slice(), t: S.t, T: WaterMD2.temperature(S), U: S.U, P: S.Pavg, rho: WaterMD2.density(S), nhb: S.nhb, Tset: S.T }, [x.buffer, hb.buffer]);
}
function gasBox(Pbar) { // ideal-gas box for N molecules at T and P: L = (N k_B T / P)^(1/3)
  const L = Math.cbrt(S.N * 1.380649e-23 * S.T / (Pbar * 1e5)) * 1e10;
  const f = L / S.box[0];
  for (let m = 0; m < S.N; m++) for (let c = 0; c < 3; c++) { const o = 9 * m, d = (f - 1) * S.x[o + c]; S.x[o + c] += d; S.x[o + 3 + c] += d; S.x[o + 6 + c] += d; }
  S.box = [L, L, L]; WaterMD2.forces(S);
}
self.onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'load') {
    fetch(m.url).then((r) => r.json()).then((d) => {
      info = d;
      S = WaterMD2.create({ N: d.N, box: d.box, x: d.x, T: m.T || d.T, P: m.P != null ? m.P : d.P, baro: m.baro || [0, 0, 0], iso: !!m.iso, tau: 100, seed: (Date.now() & 0xffff) + 1 });
      if (m.gasP) gasBox(m.gasP);
      self.postMessage({ type: 'loaded', name: d.name, N: d.N, box: S.box.slice(), net: d.net || null, phase: d.phase, stats: d.stats, token: m.token });
      post();
    }).catch((err) => self.postMessage({ type: 'error', msg: String(err) }));
  } else if (!S) {
    return;
  } else if (m.cmd === 'step') {
    for (let i = 0; i < m.n; i++) WaterMD2.step(S);
    post();
  } else if (m.cmd === 'setT') {
    S.T = m.T;
  } else if (m.cmd === 'setP') {
    S.P = m.P; if (m.gas) gasBox(m.P);
  }
};
