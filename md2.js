/* md2.js — Molecular dynamics of water in any phase, rigid TIP4P/Ice model.
 *
 * Units: Å, fs, amu, kJ/mol, e, K, bar.
 *
 * TIP4P/Ice (Abascal, Sanz, García Fernández & Vega, J. Chem. Phys. 122, 234511 (2005)):
 *   r(OH) = 0.9572 Å, angle HOH = 104.52°, q_H = +0.5897 e, q_M = −1.1794 e on a massless site M
 *   on the HOH bisector at d_OM = 0.1577 Å; Lennard-Jones on O: σ = 3.1668 Å, ε/k_B = 106.1 K.
 *   Model melting point of ice Ih at 1 bar: 272.2 K.
 * M is a linear virtual site, r_M = r_O + a (r_H1 − r_O) + a (r_H2 − r_O), a = d_OM / (2 r_OH cos(θ/2));
 *   its force is shared as F_O += (1−2a) F_M, F_Hk += a F_M (exact for linear virtual sites).
 * Electrostatics: damped shifted force (Fennell & Gezelter 2006), α = 0.2 Å⁻¹, R_c = 8.5 Å.
 * Rigid-body constraints: velocity Verlet + SHAKE/RATTLE, Δt = 2 fs.
 * Temperature: Bussi–Donadio–Parrinello stochastic velocity rescaling.
 * Pressure: stochastic cell rescaling (Bernetti & Bussi, J. Chem. Phys. 153, 114107 (2020)), applied per box axis
 *   (orthorhombic box) so crystals can change shape; molecules are moved rigidly with their centres of mass.
 * Orthorhombic periodic box Lx × Ly × Lz, minimum image.
 */
(function (root) {
  'use strict';
  const KE = 1389.35457, KB = 0.0083144626, FCONV = 1e-4, KCONV = 1e4, BAR = 16605.390, NA = 6.02214076e23;
  const mO = 15.9994, mH = 1.008, MW = mO + 2 * mH;
  const dOH = 0.9572, THETA = 104.52 * Math.PI / 180, dHH = 2 * dOH * Math.sin(THETA / 2);
  const qH = 0.5897, qM = -1.1794, dOM = 0.1577;
  const SIG = 3.1668, EPS = 106.1 * KB;
  const AM = dOM / (2 * dOH * Math.cos(THETA / 2));
  const ALPHA = 0.2, RC = 8.5, RC2 = RC * RC, SQPI = Math.sqrt(Math.PI);
  function erfc(x) { const t = 1 / (1 + 0.3275911 * x); return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x); }
  const DSF_V0 = erfc(ALPHA * RC) / RC;
  const DSF_F0 = erfc(ALPHA * RC) / RC2 + 2 * ALPHA / SQPI * Math.exp(-ALPHA * ALPHA * RC2) / RC;
  const sr6c = Math.pow(SIG * SIG / RC2, 3), LJ_V0 = 4 * EPS * (sr6c * sr6c - sr6c), LJ_F0 = 24 * EPS * (2 * sr6c * sr6c - sr6c) / RC;
  const MASS = [mO, mH, mH];
  const QS = [qH, qH, qM]; // charged sites: H1, H2, M
  const COSHB = Math.cos(30 * Math.PI / 180), RHB2 = 3.5 * 3.5;
  const BETA_T = 4.5e-5; // bar^-1, isothermal compressibility used by the barostat (sets its speed only)

  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function gauss(R) { let u = 0; while (u === 0) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); }
  function gammaRand(R, k) { const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = gauss(R); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = R(); if (u < 1 - 0.0331 * x * x * x * x) return d * v; if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } }

  // Put an arbitrary (O, H, H) triple onto exact model geometry: keep O, the bisector direction and the molecular plane.
  function regularize(x, N) {
    for (let m = 0; m < N; m++) {
      const o = 9 * m;
      const a = [x[o + 3] - x[o], x[o + 4] - x[o + 1], x[o + 5] - x[o + 2]], b = [x[o + 6] - x[o], x[o + 7] - x[o + 1], x[o + 8] - x[o + 2]];
      const na = Math.hypot(...a), nb = Math.hypot(...b);
      const u = a.map((v, i) => v / na + b[i] / nb); const nu = Math.hypot(...u); for (let i = 0; i < 3; i++) u[i] /= nu;
      const w = a.map((v, i) => v / na - b[i] / nb); const dw = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
      for (let i = 0; i < 3; i++) w[i] -= dw * u[i];
      const nw = Math.hypot(...w); for (let i = 0; i < 3; i++) w[i] /= nw;
      const c = dOH * Math.cos(THETA / 2), s = dOH * Math.sin(THETA / 2);
      for (let i = 0; i < 3; i++) { x[o + 3 + i] = x[o + i] + c * u[i] + s * w[i]; x[o + 6 + i] = x[o + i] + c * u[i] - s * w[i]; }
    }
  }

  function create(o) {
    const N = o.N;
    const S = {
      N, box: o.box.slice(), T: o.T || 300, P: o.P == null ? 1 : o.P, dt: o.dt || 2, tau: o.tau || 100, tauP: o.tauP || 2000,
      baro: o.baro || [0, 0, 0], iso: !!o.iso, frozen: o.frozen || null,
      x: new Float64Array(9 * N), v: new Float64Array(9 * N), f: new Float64Array(9 * N), xo: new Float64Array(9 * N),
      sx: new Float64Array(12 * N), hb: new Int32Array(3 * 6 * N), nhb: 0,
      t: 0, U: 0, K: 0, Pint: [0, 0, 0], Pavg: 0, W: [0, 0, 0], R: rng(o.seed || 1234), wantHB: o.wantHB !== false,
    };
    S.x.set(o.x); if (o.regularize) regularize(S.x, N);
    wrap(S);
    if (o.v) { S.v.set(o.v); rattleV(S); } else maxwell(S, S.T);
    forces(S); pressure(S);
    return S;
  }
  function nfree(S) { let n = S.N; if (S.frozen) for (let m = 0; m < S.N; m++) if (S.frozen[m]) n--; return 6 * n - 3; }
  function maxwell(S, T) {
    const { N, v, R } = S;
    for (let m = 0; m < N; m++) for (let s = 0; s < 3; s++) { const sd = Math.sqrt(KB * T / MASS[s] / KCONV); for (let c = 0; c < 3; c++) v[9 * m + 3 * s + c] = S.frozen && S.frozen[m] ? 0 : sd * gauss(R); }
    rattleV(S); removeCOM(S);
    const sc = Math.sqrt(T / Math.max(1e-6, temperature(S))); for (let i = 0; i < v.length; i++) v[i] *= sc;
  }
  function removeCOM(S) {
    const { N, v } = S; let p = [0, 0, 0], M = 0;
    for (let m = 0; m < N; m++) { if (S.frozen && S.frozen[m]) continue; M += MW; for (let s = 0; s < 3; s++) for (let c = 0; c < 3; c++) p[c] += MASS[s] * v[9 * m + 3 * s + c]; }
    for (let m = 0; m < N; m++) { if (S.frozen && S.frozen[m]) continue; for (let s = 0; s < 3; s++) for (let c = 0; c < 3; c++) v[9 * m + 3 * s + c] -= p[c] / M; }
  }
  function kinetic(S) { const { N, v } = S; let k = 0; for (let m = 0; m < N; m++) for (let s = 0; s < 3; s++) { const o = 9 * m + 3 * s; k += MASS[s] * (v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2]); } return 0.5 * k * KCONV; }
  function temperature(S) { return 2 * kinetic(S) / (nfree(S) * KB); }
  function wrap(S) {
    const { N, x, box } = S;
    for (let m = 0; m < N; m++) for (let c = 0; c < 3; c++) { const o = 9 * m; const w = box[c] * Math.floor(x[o + c] / box[c]); if (w !== 0) { x[o + c] -= w; x[o + 3 + c] -= w; x[o + 6 + c] -= w; } }
  }

  function forces(S) {
    const { N, x, f, sx, hb, box } = S;
    const Lx = box[0], Ly = box[1], Lz = box[2], iLx = 1 / Lx, iLy = 1 / Ly, iLz = 1 / Lz;
    f.fill(0);
    // site positions: O, H1, H2, M
    for (let m = 0; m < N; m++) {
      const o = 9 * m, q = 12 * m;
      for (let i = 0; i < 9; i++) sx[q + i] = x[o + i];
      for (let c = 0; c < 3; c++) sx[q + 9 + c] = x[o + c] + AM * (x[o + 3 + c] - x[o + c]) + AM * (x[o + 6 + c] - x[o + c]);
    }
    const fM = new Float64Array(3 * N);
    let U = 0, Wx = 0, Wy = 0, Wz = 0, nhb = 0;
    const RL = RC + 2.0, RL2 = RL * RL;
    for (let i = 0; i < N - 1; i++) {
      const qi = 12 * i, oi = 9 * i;
      const fi = S.frozen && S.frozen[i];
      for (let j = i + 1; j < N; j++) {
        if (fi && S.frozen[j]) continue;
        const qj = 12 * j, oj = 9 * j;
        let dx = sx[qi] - sx[qj], dy = sx[qi + 1] - sx[qj + 1], dz = sx[qi + 2] - sx[qj + 2];
        const shx = Lx * Math.round(dx * iLx), shy = Ly * Math.round(dy * iLy), shz = Lz * Math.round(dz * iLz);
        dx -= shx; dy -= shy; dz -= shz;
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 > RL2) continue;
        let Fx = 0, Fy = 0, Fz = 0;
        if (r2 < RC2) {
          const r = Math.sqrt(r2), s2 = SIG * SIG / r2, s6 = s2 * s2 * s2;
          U += 4 * EPS * (s6 * s6 - s6);
          const fr = 24 * EPS * (2 * s6 * s6 - s6) / r2;
          const fx = fr * dx, fy = fr * dy, fz = fr * dz;
          f[oi] += fx; f[oi + 1] += fy; f[oi + 2] += fz; f[oj] -= fx; f[oj + 1] -= fy; f[oj + 2] -= fz;
          Fx += fx; Fy += fy; Fz += fz;
        }
        for (let a = 0; a < 3; a++) {
          const ia = qi + 3 + 3 * a, qa = QS[a];
          for (let b = 0; b < 3; b++) {
            const jb = qj + 3 + 3 * b;
            const rx = sx[ia] - sx[jb] - shx, ry = sx[ia + 1] - sx[jb + 1] - shy, rz = sx[ia + 2] - sx[jb + 2] - shz;
            const s2 = rx * rx + ry * ry + rz * rz;
            if (s2 >= RC2) continue;
            const r = Math.sqrt(s2), qq = KE * qa * QS[b], ar = ALPHA * r, ex = Math.exp(-ar * ar);
            const t = 1 / (1 + 0.3275911 * ar);
            const ec = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * ex;
            U += qq * (ec / r - DSF_V0 + DSF_F0 * (r - RC));
            const fr = qq * (ec / s2 + 2 * ALPHA / SQPI * ex / r - DSF_F0) / r;
            const fx = fr * rx, fy = fr * ry, fz = fr * rz;
            if (a === 2) { fM[3 * i] += fx; fM[3 * i + 1] += fy; fM[3 * i + 2] += fz; } else { const k = oi + 3 + 3 * a; f[k] += fx; f[k + 1] += fy; f[k + 2] += fz; }
            if (b === 2) { fM[3 * j] -= fx; fM[3 * j + 1] -= fy; fM[3 * j + 2] -= fz; } else { const k = oj + 3 + 3 * b; f[k] -= fx; f[k + 1] -= fy; f[k + 2] -= fz; }
            Fx += fx; Fy += fy; Fz += fz;
          }
        }
        // molecular virial (centre-of-mass separation)
        let cx = 0, cy = 0, cz = 0;
        for (let s = 0; s < 3; s++) { const w = MASS[s] / MW; cx += w * (x[oi + 3 * s] - x[oj + 3 * s]); cy += w * (x[oi + 3 * s + 1] - x[oj + 3 * s + 1]); cz += w * (x[oi + 3 * s + 2] - x[oj + 3 * s + 2]); }
        Wx += Fx * (cx - shx); Wy += Fy * (cy - shy); Wz += Fz * (cz - shz);
        if (S.wantHB && r2 < RHB2) {
          const r = Math.sqrt(r2);
          for (let h = 1; h <= 2; h++) {
            let hx = x[oi + 3 * h] - x[oi], hy = x[oi + 3 * h + 1] - x[oi + 1], hz = x[oi + 3 * h + 2] - x[oi + 2];
            if ((-dx * hx - dy * hy - dz * hz) / (r * dOH) > COSHB && nhb < hb.length / 3) { hb[3 * nhb] = i; hb[3 * nhb + 1] = h; hb[3 * nhb + 2] = j; nhb++; }
            hx = x[oj + 3 * h] - x[oj]; hy = x[oj + 3 * h + 1] - x[oj + 1]; hz = x[oj + 3 * h + 2] - x[oj + 2];
            if ((dx * hx + dy * hy + dz * hz) / (r * dOH) > COSHB && nhb < hb.length / 3) { hb[3 * nhb] = j; hb[3 * nhb + 1] = h; hb[3 * nhb + 2] = i; nhb++; }
          }
        }
      }
    }
    // distribute virtual-site forces
    for (let m = 0; m < N; m++) {
      const o = 9 * m;
      for (let c = 0; c < 3; c++) { const F = fM[3 * m + c]; f[o + c] += (1 - 2 * AM) * F; f[o + 3 + c] += AM * F; f[o + 6 + c] += AM * F; }
    }
    // standard long-range Lennard-Jones corrections for the truncated O–O interaction (uniform density beyond R_c)
    const V = Lx * Ly * Lz, rho = N / V, sr3 = Math.pow(SIG / RC, 3), sr9 = sr3 * sr3 * sr3;
    S.Utail = 8 / 3 * Math.PI * rho * EPS * SIG * SIG * SIG * (sr9 / 3 - sr3);
    S.Ptail = 16 / 3 * Math.PI * rho * rho * EPS * SIG * SIG * SIG * (2 / 3 * sr9 - sr3) * BAR;
    S.U = U / N + (S.tailOff ? 0 : S.Utail); S.W = [Wx, Wy, Wz]; S.nhb = nhb;
  }

  function pressure(S) {
    const { N, v, box } = S; const kc = [0, 0, 0];
    for (let m = 0; m < N; m++) {
      if (S.frozen && S.frozen[m]) continue;
      const p = [0, 0, 0];
      for (let s = 0; s < 3; s++) for (let c = 0; c < 3; c++) p[c] += MASS[s] * v[9 * m + 3 * s + c];
      for (let c = 0; c < 3; c++) kc[c] += p[c] * p[c] / MW * KCONV;
    }
    const V = box[0] * box[1] * box[2];
    S.Pint = [0, 1, 2].map((c) => (kc[c] + S.W[c]) / V * BAR + (S.tailOff ? 0 : S.Ptail));
    S.Pavg = (S.Pint[0] + S.Pint[1] + S.Pint[2]) / 3;
  }

  const CON = [[0, 1, dOH * dOH], [0, 2, dOH * dOH], [1, 2, dHH * dHH]];
  function shake(S, dt) {
    const { N, x, xo, v } = S;
    for (let m = 0; m < N; m++) {
      if (S.frozen && S.frozen[m]) continue;
      const o = 9 * m;
      for (let it = 0; it < 100; it++) {
        let done = true;
        for (let c = 0; c < 3; c++) {
          const a = o + 3 * CON[c][0], b = o + 3 * CON[c][1], d2 = CON[c][2], ma = MASS[CON[c][0]], mb = MASS[CON[c][1]];
          const rx = x[a] - x[b], ry = x[a + 1] - x[b + 1], rz = x[a + 2] - x[b + 2];
          const diff = d2 - (rx * rx + ry * ry + rz * rz);
          if (Math.abs(diff) > 2e-10 * d2) {
            done = false;
            const ox = xo[a] - xo[b], oy = xo[a + 1] - xo[b + 1], oz = xo[a + 2] - xo[b + 2];
            const g = diff / (2 * (1 / ma + 1 / mb) * (rx * ox + ry * oy + rz * oz));
            x[a] += g / ma * ox; x[a + 1] += g / ma * oy; x[a + 2] += g / ma * oz; x[b] -= g / mb * ox; x[b + 1] -= g / mb * oy; x[b + 2] -= g / mb * oz;
            v[a] += g / ma * ox / dt; v[a + 1] += g / ma * oy / dt; v[a + 2] += g / ma * oz / dt; v[b] -= g / mb * ox / dt; v[b + 1] -= g / mb * oy / dt; v[b + 2] -= g / mb * oz / dt;
          }
        }
        if (done) break;
      }
    }
  }
  function rattleV(S) {
    const { N, x, v } = S;
    for (let m = 0; m < N; m++) {
      const o = 9 * m;
      for (let it = 0; it < 100; it++) {
        let done = true;
        for (let c = 0; c < 3; c++) {
          const a = o + 3 * CON[c][0], b = o + 3 * CON[c][1], d2 = CON[c][2], ma = MASS[CON[c][0]], mb = MASS[CON[c][1]];
          const rx = x[a] - x[b], ry = x[a + 1] - x[b + 1], rz = x[a + 2] - x[b + 2];
          const rv = rx * (v[a] - v[b]) + ry * (v[a + 1] - v[b + 1]) + rz * (v[a + 2] - v[b + 2]);
          if (Math.abs(rv) > 1e-12) {
            done = false; const k = rv / (d2 * (1 / ma + 1 / mb));
            v[a] -= k / ma * rx; v[a + 1] -= k / ma * ry; v[a + 2] -= k / ma * rz; v[b] += k / mb * rx; v[b + 1] += k / mb * ry; v[b + 2] += k / mb * rz;
          }
        }
        if (done) break;
      }
    }
  }
  function thermostat(S) {
    const Nf = nfree(S), K = kinetic(S), Kt = 0.5 * Nf * KB * S.T;
    if (K <= 0) return;
    const c = Math.exp(-S.dt / S.tau), R1 = gauss(S.R), SNf = 2 * gammaRand(S.R, (Nf - 1) / 2);
    const a2 = c + (Kt / (Nf * K)) * (1 - c) * (R1 * R1 + SNf) + 2 * R1 * Math.sqrt(c * (1 - c) * Kt / (Nf * K));
    const sgn = (R1 + Math.sqrt(c * Nf * K / ((1 - c) * Kt))) < 0 ? -1 : 1;
    const al = sgn * Math.sqrt(Math.max(a2, 0)); const v = S.v; for (let i = 0; i < v.length; i++) v[i] *= al;
  }
  // stochastic cell rescaling, per axis
  function barostat(S) {
    if (!(S.baro[0] || S.baro[1] || S.baro[2])) return;
    const V = S.box[0] * S.box[1] * S.box[2];
    const noiseVar = 2 * (KB * S.T) * BETA_T * S.dt / (V * S.tauP) * BAR; // dimensionless (KB*T/V in bar via BAR)
    const mu = [1, 1, 1];
    if (S.iso) {
      // isotropic: ε = ln V,  dε = −(β_T/τ_p)(P0 − P − k_BT/V) dt + sqrt(2 k_BT β_T dt/(V τ_p)) ξ;  each length scales by exp(dε/3)
      const de = -BETA_T * S.dt / S.tauP * (S.P - S.Pavg - (KB * S.T / V) * BAR) + Math.sqrt(noiseVar) * gauss(S.R);
      mu[0] = mu[1] = mu[2] = Math.exp(Math.max(-0.003, Math.min(0.003, de / 3)));
    } else {
      // per axis (orthorhombic): the three ln L_c share the drift and noise of ln V equally
      for (let c = 0; c < 3; c++) {
        if (!S.baro[c]) continue;
        const de = -BETA_T * S.dt / S.tauP * (S.P - S.Pint[c] - (KB * S.T / V) * BAR) / 3 + Math.sqrt(noiseVar / 3) * gauss(S.R);
        mu[c] = Math.exp(Math.max(-0.002, Math.min(0.002, de)));
      }
    }
    const { N, x } = S;
    for (let m = 0; m < N; m++) {
      const o = 9 * m;
      for (let c = 0; c < 3; c++) {
        if (mu[c] === 1) continue;
        const com = (mO * x[o + c] + mH * x[o + 3 + c] + mH * x[o + 6 + c]) / MW, d = (mu[c] - 1) * com;
        x[o + c] += d; x[o + 3 + c] += d; x[o + 6 + c] += d;
      }
    }
    for (let c = 0; c < 3; c++) S.box[c] *= mu[c];
  }

  function step(S) {
    const { N, x, v, f, xo, dt } = S, h = 0.5 * dt * FCONV, fr = S.frozen;
    for (let m = 0; m < N; m++) { if (fr && fr[m]) continue; for (let s = 0; s < 3; s++) { const o = 9 * m + 3 * s, im = h / MASS[s]; v[o] += im * f[o]; v[o + 1] += im * f[o + 1]; v[o + 2] += im * f[o + 2]; } }
    xo.set(x);
    for (let m = 0; m < N; m++) { if (fr && fr[m]) continue; for (let k = 9 * m; k < 9 * m + 9; k++) x[k] += dt * v[k]; }
    shake(S, dt);
    barostat(S);
    wrap(S);
    forces(S);
    for (let m = 0; m < N; m++) { if (fr && fr[m]) continue; for (let s = 0; s < 3; s++) { const o = 9 * m + 3 * s, im = h / MASS[s]; v[o] += im * f[o]; v[o + 1] += im * f[o + 1]; v[o + 2] += im * f[o + 2]; } }
    rattleV(S);
    if (S.tau > 0) thermostat(S);
    S.t += dt; S.K = kinetic(S); pressure(S);
  }
  function density(S) { return S.N * MW / NA / (S.box[0] * S.box[1] * S.box[2] * 1e-24); }

  const API = { create, step, forces, temperature, density, maxwell, regularize, consts: { mO, mH, MW, dOH, THETA, qH, qM, dOM, SIG, EPS, AM, RC, ALPHA, KB, NA } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.WaterMD2 = API;
})(typeof self !== 'undefined' ? self : this);
