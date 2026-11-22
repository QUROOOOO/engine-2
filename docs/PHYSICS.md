# QuantumOrbit Sim — Astrodynamics & Physics Reference

**Standard Reference**: Classical Astrodynamics, SGP4 (Vallado et al.), Universal Variable Two-Body Propagation  
**Coordinate Frame**: TEME (True Equator, Mean Equinox) / ECI J2000

---

## 1. Universal Variable Keplerian Two-Body Solver

For unperturbed two-body orbital propagation between time $t_0$ and $t$, the state vector $(\mathbf{r}_0, \mathbf{v}_0) \to (\mathbf{r}, \mathbf{v})$ is solved using the universal anomaly variable $\chi$ and Stumpff functions.

### 1.1 Stumpff Functions
For dimensionless parameter $z = \alpha \chi^2$, where $\alpha = \frac{2}{r_0} - \frac{v_0^2}{\mu}$:

$$
c(z) = \sum_{k=0}^{\infty} \frac{(-1)^k z^k}{(2k+2)!} = \begin{cases}
\frac{1 - \cos\sqrt{z}}{z}, & z > 0 \\
\frac{\cosh\sqrt{-z} - 1}{-z}, & z < 0 \\
\frac{1}{2}, & z = 0
\end{cases}
$$

$$
s(z) = \sum_{k=0}^{\infty} \frac{(-1)^k z^k}{(2k+3)!} = \begin{cases}
\frac{\sqrt{z} - \sin\sqrt{z}}{z^{3/2}}, & z > 0 \\
\frac{\sinh\sqrt{-z} - \sqrt{-z}}{(-z)^{3/2}}, & z < 0 \\
\frac{1}{6}, & z = 0
\end{cases}
$$

In `src/physics/stumpff.ts`, series expansions up to order $k=7$ are utilized for $|z| < 10^{-4}$ to eliminate floating-point catastrophe.

### 1.2 Universal Kepler Equation
$$
F(\chi) = \frac{r_0 v_{r0}}{\sqrt{\mu}} \chi^2 c(\alpha \chi^2) + (1 - \alpha r_0) \chi^3 s(\alpha \chi^2) + r_0 \chi - \sqrt{\mu} \Delta t = 0
$$

The first derivative is:
$$
\frac{dF}{d\chi} = \frac{r_0 v_{r0}}{\sqrt{\mu}} \chi [1 - \alpha \chi^2 s(\alpha \chi^2)] + (1 - \alpha r_0) \chi^2 c(\alpha \chi^2) + r_0
$$

Solved via Newton-Raphson iteration with convergence tolerance $|F(\chi)| < 10^{-11}$.

### 1.3 Position and Velocity Reconstruction
Using Lagrange coefficients $f, g, \dot{f}, \dot{g}$:
$$
f = 1 - \frac{\chi^2}{r_0} c(z), \quad g = \Delta t - \frac{\chi^3}{\sqrt{\mu}} s(z)
$$
$$
\dot{f} = \frac{\sqrt{\mu}}{r r_0} (\alpha \chi^3 s(z) - \chi), \quad \dot{g} = 1 - \frac{\chi^2}{r} c(z)
$$
$$
\mathbf{r} = f \mathbf{r}_0 + g \mathbf{v}_0, \quad \mathbf{v} = \dot{f} \mathbf{r}_0 + \dot{g} \mathbf{v}_0
$$

---

## 2. Orthonormal RTN Frame & Coordinate Transformations

For an active satellite with position $\mathbf{r}$ and velocity $\mathbf{v}$:

1. **Radial Unit Vector**:
   $$
   \hat{\mathbf{R}} = \frac{\mathbf{r}}{\|\mathbf{r}\|}
   $$
2. **Normal (Cross-Track) Unit Vector**:
   $$
   \hat{\mathbf{N}} = \frac{\mathbf{r} \times \mathbf{v}}{\|\mathbf{r} \times \mathbf{v}\|}
   $$
3. **Transverse (Along-Track) Unit Vector**:
   $$
   \hat{\mathbf{T}} = \hat{\mathbf{N}} \times \hat{\mathbf{R}}
   $$

The projection of any relative displacement vector $\Delta \mathbf{r}$ into RTN coordinates is:
$$
\Delta r_R = \Delta \mathbf{r} \cdot \hat{\mathbf{R}}, \quad \Delta r_T = \Delta \mathbf{r} \cdot \hat{\mathbf{T}}, \quad \Delta r_N = \Delta \mathbf{r} \cdot \hat{\mathbf{N}}
$$

---

## 3. Collision Probability ($P_c$) via 2D B-Plane Foster-Chan Formulation

In the encounter B-plane perpendicular to relative velocity $\mathbf{v}_{\text{rel}}$ at TCA:
$$
\hat{\mathbf{k}} = \frac{\mathbf{v}_{\text{rel}}}{\|\mathbf{v}_{\text{rel}}\|}
$$

Assuming a combined spherical collision radius $R_{\text{coll}} = 10\text{ m}$ and combined position covariance matrix $\mathbf{C} = \text{diag}(\sigma_T^2, \sigma_N^2)$:

$$
P_c = \frac{1}{2\pi \sigma_T \sigma_N} \iint_{\|\mathbf{x} - \mathbf{x}_{\text{miss}}\| \le R_{\text{coll}}} \exp\left( -\frac{x_T^2}{2\sigma_T^2} - \frac{x_N^2}{2\sigma_N^2} \right) dx_T dx_N
$$

Under the Foster-Chan point approximation for $R_{\text{coll}} \ll \min(\sigma_T, \sigma_N)$:
$$
P_c \approx \frac{R_{\text{coll}}^2}{2 \sigma_T \sigma_N} \exp\left[ -\frac{1}{2} \left( \frac{\Delta x_T^2}{\sigma_T^2} + \frac{\Delta x_N^2}{\sigma_N^2} \right) \right]
$$

Implemented in `src/physics/collisionProbability.ts`.

---

## 4. Impulsive RTN Maneuver Optimization (Clohessy-Wiltshire Phasing)

Under the linearized Hill-Clohessy-Wiltshire (CW) equations with mean orbital motion $n = \sqrt{\mu / a^3}$, an along-track transverse burn $\Delta v_T$ applied at lead time $\Delta t = t_{\text{TCA}} - t_{\text{burn}}$ induces an along-track phasing displacement at TCA:

$$
\Delta x_T(\Delta t) \approx -6 n \Delta t \, \frac{\Delta v_T}{n} = -6 \Delta t \, \Delta v_T
$$

To achieve minimum safe miss distance $d_{\text{safe}} = 5.0\text{ km}$:
$$
\Delta v_{T,\text{req}} = \frac{d_{\text{safe}} - d_{\text{nominal}}}{6 \Delta t}
$$

The optimizer checks available fuel budget ($\le 15.0\text{ m/s}$) and tests post-burn feasibility via full numerical propagation.
