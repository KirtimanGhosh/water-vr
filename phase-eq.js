/* Phase boundaries of real H2O. Pressures in MPa, temperatures in K.
 * Melting & sublimation: IAPWS R14-08(2011) (Wagner, Riethmann, Feistel & Harvey, J. Phys. Chem. Ref. Data 40, 043103 (2011)).
 * Vapour pressure: IAPWS SR1-86(1992) (Wagner & Pruss, J. Phys. Chem. Ref. Data 22, 783 (1993)). */
(function (root) {
  const PH = {
    Tt: 273.16, pt: 611.657e-6, Tc: 647.096, pc: 22.064,
    meltIh(T) { const th = T / 273.16, a = [1.19539337e6, 8.08183159e4, 3.33826860e3], b = [3.0, 25.75, 103.75]; let s = 1; for (let i = 0; i < 3; i++) s += a[i] * (1 - Math.pow(th, b[i])); return s * 611.657e-6; },
    meltIII(T) { const th = T / 251.165; return 208.566 * (1 - 0.2999481 * (1 - Math.pow(th, 60))); },
    meltV(T) { const th = T / 256.164; return 350.1 * (1 - 1.18721 * (1 - Math.pow(th, 8))); },
    meltVI(T) { const th = T / 273.31; return 632.4 * (1 - 1.07476 * (1 - Math.pow(th, 4.6))); },
    meltVII(T) { const th = T / 355; return 2216 * Math.exp(1.73683 * (1 - 1 / th) - 0.0544606 * (1 - Math.pow(th, 5)) + 0.806106e-7 * (1 - Math.pow(th, 22))); },
    subl(T) { const th = T / 273.16, a = [-0.212144006e2, 0.273203819e2, -0.610598130e1], b = [0.333333333e-2, 0.120666667e1, 0.170333333e1]; let s = 0; for (let i = 0; i < 3; i++) s += a[i] * Math.pow(th, b[i]); return 611.657e-6 * Math.exp(s / th); },
    sat(T) { const t = 1 - T / 647.096; return 22.064 * Math.exp(647.096 / T * (-7.85951783 * t + 1.84408259 * Math.pow(t, 1.5) - 11.7866497 * t * t * t + 22.6807411 * Math.pow(t, 3.5) - 15.9618719 * Math.pow(t, 4) + 1.80122502 * Math.pow(t, 7.5))); },
    // Stable phase of real water at (T [K], p [MPa]). Solid–solid boundaries (and ice II) are not in IAPWS; solids are labelled by the melting-curve pressure band.
    phase(T, p) {
      if (T >= PH.Tc) return p >= PH.pc ? 'supercritical' : 'vapour';
      if (T < PH.Tt ? p < PH.subl(T) : p < PH.sat(T)) return 'vapour';
      if (p < 208.566) return (T <= 251.165 || (T < PH.Tt && p < PH.meltIh(T))) ? 'Ih' : 'liquid';
      if (p < 350.1) return T < PH.meltIII_T(p) ? 'III' : 'liquid';
      if (p < 632.4) return T < PH.meltV_T(p) ? 'V' : 'liquid';
      if (p < 2216) return T < PH.meltVI_T(p) ? 'VI' : 'liquid';
      return T < PH.meltVII_T(p) ? 'VII' : 'liquid';
    },
  };
  // inverse melting curves T(p) by bisection
  const inv = (f, lo, hi) => (p) => { for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; ((f(m) - p) * (f(hi) - f(lo)) > 0 ? hi = m : lo = m); } return (lo + hi) / 2; };
  PH.meltIII_T = inv(PH.meltIII, 251.165, 256.164);
  PH.meltV_T = inv(PH.meltV, 256.164, 273.31);
  PH.meltVI_T = inv(PH.meltVI, 273.31, 355);
  PH.meltVII_T = inv(PH.meltVII, 355, 715);
  if (typeof module !== 'undefined' && module.exports) module.exports = PH; else root.PhaseEq = PH;
})(typeof self !== 'undefined' ? self : this);
