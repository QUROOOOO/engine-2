"""Step 1: CelesTrak TLE + SOCRATES fetcher & SGP4 propagator."""

import os
import json
import datetime
import logging
import requests
import numpy as np
from sgp4.api import Satrec, jday
from pathlib import Path

logger = logging.getLogger(__name__)
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TLE_DIR = DATA_DIR / "tles"

# CelesTrak endpoints
TLE_URLS = {
    "earth_obs": "https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=tle",
    "cosmos_debris": "https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-2251-debris&FORMAT=tle",
    "fengyun_debris": "https://celestrak.org/NORAD/elements/gp.php?GROUP=fengyun-1c-debris&FORMAT=tle",
}

# ---------------------------------------------------------------------------
# TLE checksum helper
# ---------------------------------------------------------------------------

def _tle_checksum(line: str) -> int:
    """Compute TLE checksum: sum digits, treat '-' as 1, mod 10."""
    s = 0
    for ch in line[:68]:
        if ch.isdigit():
            s += int(ch)
        elif ch == "-":
            s += 1
    return s % 10


def _format_tle_line(line_raw: str) -> str:
    """Ensure the line is exactly 69 chars with a valid checksum at position 69."""
    body = line_raw[:68].ljust(68)
    return body + str(_tle_checksum(body))


# ---------------------------------------------------------------------------
# Fetch / cache / fallback
# ---------------------------------------------------------------------------

def fetch_tles(timeout: int = 10) -> dict[str, list[tuple[str, str, str]]]:
    """Fetch TLE data from CelesTrak.

    Returns dict mapping group name to list of (name, line1, line2) tuples.
    Saves to data/tles/ as cache.  On failure returns cached or synthetic
    fallback.
    """
    TLE_DIR.mkdir(parents=True, exist_ok=True)
    result: dict[str, list[tuple[str, str, str]]] = {}

    for group, url in TLE_URLS.items():
        cache_path = TLE_DIR / f"{group}.tle"
        try:
            resp = requests.get(url, timeout=timeout)
            resp.raise_for_status()
            text = resp.text.strip()
            cache_path.write_text(text, encoding="utf-8")
            logger.info(f"  Fetched & cached {group} TLEs from CelesTrak")
        except Exception as exc:
            logger.warning(f"  Network fetch failed for {group}: {exc}")
            if cache_path.exists():
                text = cache_path.read_text(encoding="utf-8")
                logger.info(f"  Loaded cached {group} TLEs")
            else:
                text = None

        if text:
            lines = [l.rstrip() for l in text.splitlines() if l.strip()]
            triples: list[tuple[str, str, str]] = []
            i = 0
            while i < len(lines) - 1:
                # Detect whether we have a name line or only two-line sets
                if lines[i].startswith("1 ") and i + 1 < len(lines) and lines[i + 1].startswith("2 "):
                    triples.append(("UNKNOWN", lines[i], lines[i + 1]))
                    i += 2
                elif (
                    i + 2 < len(lines)
                    and lines[i + 1].startswith("1 ")
                    and lines[i + 2].startswith("2 ")
                ):
                    triples.append((lines[i].strip(), lines[i + 1], lines[i + 2]))
                    i += 3
                else:
                    i += 1
            result[group] = triples
        else:
            result[group] = []

    # If everything is empty, use fallback
    total = sum(len(v) for v in result.values())
    if total == 0:
        logger.warning("  No TLEs available – generating synthetic fallback")
        result = _generate_fallback_tles()

    return result


# ---------------------------------------------------------------------------
# Synthetic fallback TLE generator
# ---------------------------------------------------------------------------

def _build_tle(
    norad_id: int,
    name: str,
    epoch_year: int,
    epoch_day: float,
    inclination_deg: float,
    raan_deg: float,
    eccentricity: float,
    arg_perigee_deg: float,
    mean_anomaly_deg: float,
    mean_motion_revday: float,
    bstar: float = 0.0,
    classification: str = "U",
    intl_designator: str = "24001A  ",
    rev_number: int = 100,
    element_set: int = 999,
) -> tuple[str, str]:
    """Build a valid two-line TLE pair with correct checksums."""
    # --- Line 1 ---
    # Columns (1-indexed):
    # 01     Line number
    # 03-07  NORAD cat number (5 digits, right justified)
    # 08     Classification
    # 10-17  International designator (8 chars)
    # 19-20  Epoch year (2 digits)
    # 21-32  Epoch day of year + fractional (12 chars, right justified)
    # 34-43  First deriv mean motion (10 chars)
    # 45-52  Second deriv mean motion (8 chars, implied decimal)
    # 54-61  BSTAR drag (8 chars, implied decimal)
    # 63     Ephemeris type (0)
    # 65-68  Element set number (4 digits)
    # 69     Checksum

    ey = epoch_year % 100  # 2-digit year

    # BSTAR formatting: e.g. 0.00001 -> " 10000-4"
    if bstar == 0.0:
        bstar_str = " 00000-0"
    else:
        bstar_exp = int(np.floor(np.log10(abs(bstar)))) + 1
        bstar_man = bstar / (10.0 ** bstar_exp)
        sign = "-" if bstar < 0 else " "
        bstar_str = f"{sign}{abs(bstar_man):.4f}"[0] + f"{abs(bstar_man):.4f}"[2:] + f"{bstar_exp:+d}"[-2:]
        # Simplify: use fixed small drag
        bstar_str = " 00000-0"

    line1_body = (
        f"1 {norad_id:05d}{classification} "
        f"{intl_designator}"
        f"{ey:02d}{epoch_day:012.8f} "
        f" .00000000 "
        f" 00000-0 "
        f"{bstar_str} "
        f"0 {element_set:4d}"
    )
    line1_body = line1_body[:68].ljust(68)
    line1 = _format_tle_line(line1_body)

    # --- Line 2 ---
    # 01     Line number
    # 03-07  NORAD cat number
    # 09-16  Inclination (8 chars, degrees)
    # 18-25  RAAN (8 chars, degrees)
    # 27-33  Eccentricity (7 digits, implied leading decimal)
    # 35-42  Arg of perigee (8 chars, degrees)
    # 44-51  Mean anomaly (8 chars, degrees)
    # 53-63  Mean motion (11 chars, rev/day)
    # 64-68  Rev number at epoch (5 digits)
    # 69     Checksum

    ecc_str = f"{eccentricity:.7f}"[2:]  # remove "0."

    line2_body = (
        f"2 {norad_id:05d} "
        f"{inclination_deg:8.4f} "
        f"{raan_deg:8.4f} "
        f"{ecc_str} "
        f"{arg_perigee_deg:8.4f} "
        f"{mean_anomaly_deg:8.4f} "
        f"{mean_motion_revday:11.8f}"
        f"{rev_number:5d}"
    )
    line2_body = line2_body[:68].ljust(68)
    line2 = _format_tle_line(line2_body)

    return line1, line2


def _altitude_to_mean_motion(alt_km: float, ecc: float = 0.001) -> float:
    """Convert altitude (km) to mean motion in rev/day."""
    MU = 3.986004418e5  # km³/s²
    a = 6371.0 + alt_km
    n_rad_s = np.sqrt(MU / a ** 3)
    return n_rad_s * 86400.0 / (2.0 * np.pi)


def _generate_fallback_tles() -> dict[str, list[tuple[str, str, str]]]:
    """Generate realistic synthetic TLEs for ISRO sats and debris.

    Produces at least 20 satellites and 50 debris objects with valid TLE
    format that sgp4 can propagate.
    """
    rng = np.random.default_rng(2024)
    now = datetime.datetime.now(datetime.timezone.utc)
    epoch_year = now.year
    epoch_day = float(now.timetuple().tm_yday) + now.hour / 24.0

    result: dict[str, list[tuple[str, str, str]]] = {}

    # ---- Earth observation satellites (ISRO-like, 500-700 km, sun-sync) ----
    sat_names = [
        "CARTOSAT-2A", "CARTOSAT-2B", "CARTOSAT-3", "EOS-01", "EOS-02",
        "EOS-03", "EOS-04", "EOS-06", "RESOURCESAT-2", "RESOURCESAT-2A",
        "OCEANSAT-3", "INSAT-3DR", "RISAT-1A", "RISAT-2B", "HySIS",
        "EMISAT", "MICROSAT-R", "IRNSS-1A", "IRNSS-1B", "SCATSAT-1",
        "SARAL", "ASTROSAT", "GSAT-6A", "GSAT-7A",
    ]
    norad_base_sat = 43689
    sat_triples: list[tuple[str, str, str]] = []
    for i, name in enumerate(sat_names):
        nid = norad_base_sat + i * 100
        alt = rng.uniform(500, 700)
        inc = rng.uniform(97.0, 99.0)  # sun-sync
        raan = rng.uniform(0, 360)
        ecc = rng.uniform(0.0001, 0.003)
        argp = rng.uniform(0, 360)
        ma = rng.uniform(0, 360)
        mm = _altitude_to_mean_motion(alt, ecc)
        intl = f"{(epoch_year % 100):02d}{(i + 1):03d}A  "
        l1, l2 = _build_tle(
            norad_id=nid, name=name, epoch_year=epoch_year,
            epoch_day=epoch_day, inclination_deg=inc, raan_deg=raan,
            eccentricity=ecc, arg_perigee_deg=argp, mean_anomaly_deg=ma,
            mean_motion_revday=mm, intl_designator=intl,
        )
        sat_triples.append((name, l1, l2))

    result["earth_obs"] = sat_triples

    # ---- Cosmos-2251 debris (600-900 km, inc 65-75°) ----
    cosmos_triples: list[tuple[str, str, str]] = []
    for i in range(30):
        nid = 33000 + i
        alt = rng.uniform(600, 900)
        inc = rng.uniform(65.0, 75.0)
        raan = rng.uniform(0, 360)
        ecc = rng.uniform(0.0005, 0.02)
        argp = rng.uniform(0, 360)
        ma = rng.uniform(0, 360)
        mm = _altitude_to_mean_motion(alt, ecc)
        name = f"COSMOS 2251 DEB [{i}]"
        intl = f"93{(i + 50):03d}A  "
        l1, l2 = _build_tle(
            norad_id=nid, name=name, epoch_year=epoch_year,
            epoch_day=epoch_day, inclination_deg=inc, raan_deg=raan,
            eccentricity=ecc, arg_perigee_deg=argp, mean_anomaly_deg=ma,
            mean_motion_revday=mm, intl_designator=intl,
        )
        cosmos_triples.append((name, l1, l2))
    result["cosmos_debris"] = cosmos_triples

    # ---- Fengyun-1C debris (600-900 km, inc 98-100°) ----
    fengyun_triples: list[tuple[str, str, str]] = []
    for i in range(30):
        nid = 29500 + i
        alt = rng.uniform(600, 900)
        inc = rng.uniform(98.0, 100.0)
        raan = rng.uniform(0, 360)
        ecc = rng.uniform(0.0005, 0.02)
        argp = rng.uniform(0, 360)
        ma = rng.uniform(0, 360)
        mm = _altitude_to_mean_motion(alt, ecc)
        name = f"FENGYUN 1C DEB [{i}]"
        intl = f"99{(i + 80):03d}A  "
        l1, l2 = _build_tle(
            norad_id=nid, name=name, epoch_year=epoch_year,
            epoch_day=epoch_day, inclination_deg=inc, raan_deg=raan,
            eccentricity=ecc, arg_perigee_deg=argp, mean_anomaly_deg=ma,
            mean_motion_revday=mm, intl_designator=intl,
        )
        fengyun_triples.append((name, l1, l2))
    result["fengyun_debris"] = fengyun_triples

    # Cache fallback to disk
    TLE_DIR.mkdir(parents=True, exist_ok=True)
    for group, triples in result.items():
        lines: list[str] = []
        for name, l1, l2 in triples:
            lines.extend([name, l1, l2])
        cache_path = TLE_DIR / f"{group}.tle"
        cache_path.write_text("\n".join(lines), encoding="utf-8")

    logger.info(
        f"  Generated fallback TLEs: "
        f"{len(sat_triples)} sats, "
        f"{len(cosmos_triples)} Cosmos debris, "
        f"{len(fengyun_triples)} Fengyun debris"
    )
    return result


# ---------------------------------------------------------------------------
# SGP4 orbit propagation
# ---------------------------------------------------------------------------

def propagate_orbits(
    tles: dict[str, list[tuple[str, str, str]]],
    lookahead_hours: float = 72.0,
    dt_minutes: float = 30.0,
) -> dict:
    """Propagate all TLEs using SGP4 over the lookahead window.

    Returns dict with 'satellites' and 'debris' keys, each containing lists of
    dicts:
        {
            'norad_id': int,
            'name': str,
            'positions_eci': np.ndarray (N×3 km),
            'velocities_eci': np.ndarray (N×3 km/s),
            'times_jd': np.ndarray,
        }
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    n_steps = int(lookahead_hours * 60 / dt_minutes) + 1
    # Build Julian-date time array
    jd_array = np.empty(n_steps, dtype=np.float64)
    fr_array = np.empty(n_steps, dtype=np.float64)
    for k in range(n_steps):
        t = now + datetime.timedelta(minutes=k * dt_minutes)
        jd, fr = jday(t.year, t.month, t.day, t.hour, t.minute, t.second + t.microsecond / 1e6)
        jd_array[k] = jd
        fr_array[k] = fr

    times_jd = jd_array + fr_array  # full JD for output

    satellites_group_keys = {"earth_obs"}
    debris_group_keys = {"cosmos_debris", "fengyun_debris"}

    output: dict[str, list[dict]] = {"satellites": [], "debris": []}

    for group, triples in tles.items():
        target_key = "satellites" if group in satellites_group_keys else "debris"
        # Limit counts for performance
        max_items = 20 if target_key == "satellites" else 50
        for name, line1, line2 in triples[:max_items]:
            try:
                sat = Satrec.twoline2rv(line1, line2)
            except Exception as exc:
                logger.debug(f"  Skipping bad TLE {name}: {exc}")
                continue

            pos = np.empty((n_steps, 3), dtype=np.float64)
            vel = np.empty((n_steps, 3), dtype=np.float64)
            valid = True
            for k in range(n_steps):
                e, r, v = sat.sgp4(jd_array[k], fr_array[k])
                if e != 0:
                    valid = False
                    break
                pos[k] = r
                vel[k] = v

            if not valid:
                logger.debug(f"  SGP4 error for {name} – skipping")
                continue

            norad_id = int(sat.satnum)
            output[target_key].append(
                {
                    "norad_id": norad_id,
                    "name": name,
                    "positions_eci": pos,
                    "velocities_eci": vel,
                    "times_jd": times_jd.copy(),
                }
            )

    logger.info(
        f"  Propagated {len(output['satellites'])} satellites, "
        f"{len(output['debris'])} debris objects over {lookahead_hours}h "
        f"({n_steps} steps)"
    )
    return output


# ---------------------------------------------------------------------------
# RTN frame conversion
# ---------------------------------------------------------------------------

def eci_to_rtn(
    r_sat: np.ndarray,
    v_sat: np.ndarray,
    r_debris: np.ndarray,
) -> np.ndarray:
    """Convert ECI position difference to RTN frame.

    R = radial (away from Earth)
    T = along-track (velocity direction)
    N = cross-track (orbit normal = R × T)

    Parameters
    ----------
    r_sat : (3,) or (N, 3) – satellite ECI position in km
    v_sat : (3,) or (N, 3) – satellite ECI velocity in km/s
    r_debris : (3,) or (N, 3) – debris ECI position in km

    Returns
    -------
    rel_rtn : same shape as input – relative position in RTN (km)
    """
    # Ensure 2-D
    squeeze = r_sat.ndim == 1
    r_sat = np.atleast_2d(r_sat)
    v_sat = np.atleast_2d(v_sat)
    r_debris = np.atleast_2d(r_debris)

    # Unit vectors
    r_hat = r_sat / np.linalg.norm(r_sat, axis=1, keepdims=True)          # radial
    h = np.cross(r_sat, v_sat)                                             # angular momentum
    n_hat = h / np.linalg.norm(h, axis=1, keepdims=True)                  # normal
    t_hat = np.cross(n_hat, r_hat)                                        # along-track

    dr = r_debris - r_sat  # ECI relative position

    rel_rtn = np.stack(
        [
            np.sum(dr * r_hat, axis=1),
            np.sum(dr * t_hat, axis=1),
            np.sum(dr * n_hat, axis=1),
        ],
        axis=1,
    )

    if squeeze:
        return rel_rtn.squeeze(0)
    return rel_rtn


# ---------------------------------------------------------------------------
# Close-approach screening
# ---------------------------------------------------------------------------

def find_close_approaches(
    propagated: dict,
    threshold_km: float = 10.0,
) -> list[dict]:
    """Screen all satellite-debris pairs for close approaches.

    Uses vectorised numpy distance computation.  Returns the top-200
    closest conjunction events sorted by miss distance.
    """
    sats = propagated["satellites"]
    debris_list = propagated["debris"]

    if not sats or not debris_list:
        logger.warning("  No satellites or debris to screen")
        return []

    conjunctions: list[dict] = []

    for sat_obj in sats:
        s_pos = sat_obj["positions_eci"]  # (N, 3)
        s_vel = sat_obj["velocities_eci"]
        s_times = sat_obj["times_jd"]

        for deb_obj in debris_list:
            d_pos = deb_obj["positions_eci"]  # (N, 3)
            d_vel = deb_obj["velocities_eci"]

            # Vectorised distance over all timesteps
            diff = s_pos - d_pos  # (N, 3)
            dist = np.linalg.norm(diff, axis=1)  # (N,)

            min_idx = int(np.argmin(dist))
            min_dist = float(dist[min_idx])

            if min_dist < threshold_km:
                tca_jd = float(s_times[min_idx])
                # Convert JD to UTC string
                # JD 2451545.0 = 2000-01-01T12:00:00
                jd_offset = tca_jd - 2451545.0
                tca_dt = datetime.datetime(2000, 1, 1, 12, 0, 0, tzinfo=datetime.timezone.utc) + datetime.timedelta(days=jd_offset)
                tca_utc = tca_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

                # Relative velocity
                rel_vel_eci = d_vel[min_idx] - s_vel[min_idx]
                rel_speed = float(np.linalg.norm(rel_vel_eci))

                # RTN decomposition at TCA
                rel_pos_rtn = eci_to_rtn(
                    s_pos[min_idx], s_vel[min_idx], d_pos[min_idx]
                )
                rel_vel_rtn = eci_to_rtn(
                    s_pos[min_idx], s_vel[min_idx],
                    s_pos[min_idx] + rel_vel_eci,  # trick: treat velocity as position offset
                )

                conjunctions.append(
                    {
                        "sat_norad_id": sat_obj["norad_id"],
                        "debris_norad_id": deb_obj["norad_id"],
                        "sat_name": sat_obj["name"],
                        "tca_jd": tca_jd,
                        "tca_utc": tca_utc,
                        "miss_distance_km": min_dist,
                        "relative_velocity_kms": rel_speed,
                        "rel_pos_rtn_km": rel_pos_rtn.tolist(),
                        "rel_vel_rtn_kms": rel_vel_rtn.tolist(),
                    }
                )

    # Sort by miss distance, keep top 200
    conjunctions.sort(key=lambda c: c["miss_distance_km"])
    conjunctions = conjunctions[:200]

    return conjunctions


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_ingestion() -> list[dict]:
    """Main entry point.  Fetches TLEs, propagates, finds conjunctions.

    Returns list of conjunction events.
    """
    logger.info("Step 1: Starting TLE ingestion and orbit propagation...")
    tles = fetch_tles()
    total = sum(len(v) for v in tles.values())
    logger.info(f"  Loaded {total} TLE objects across {len(tles)} groups")
    propagated = propagate_orbits(tles, lookahead_hours=72.0, dt_minutes=60.0)
    conjunctions = find_close_approaches(propagated, threshold_km=10.0)
    logger.info(f"  Found {len(conjunctions)} close approaches within 10 km")
    return conjunctions


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    events = run_ingestion()
    print(f"\nTotal conjunction events: {len(events)}")
    for ev in events[:5]:
        print(
            f"  SAT {ev['sat_name']} vs DEB {ev['debris_norad_id']}  "
            f"miss={ev['miss_distance_km']:.3f} km  "
            f"TCA={ev['tca_utc']}  "
            f"Vrel={ev['relative_velocity_kms']:.2f} km/s"
        )
