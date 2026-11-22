import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from api.index import app

client = TestClient(app)

# 1. Test GET / serves index.html with security headers
r = client.get('/')
assert r.status_code == 200, f'Status {r.status_code}'
assert 'QuantumOrbit' in r.text
print('✓ GET / serves QuantumOrbit Sim HTML successfully')

# Check security headers
headers = r.headers
for h in ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'x-xss-protection', 'cross-origin-opener-policy']:
    assert h in headers, f'Missing header {h}'
    print(f'✓ Header {h}: {headers[h][:45]}...')

# 2. Test GET /health
r_health = client.get('/health')
assert r_health.status_code == 200
assert r_health.json()['status'] == 'healthy'
print('✓ GET /health is healthy')

# 3. Test Pydantic extra='forbid' on /api/v1/engine2/optimize-maneuver
bad_payload = {
    'conjunction_id': 1,
    'active_sat_norad_id': 44804,
    'debris_norad_id': 48078,
    'time_to_tca_hours': 4.5,
    'pre_maneuver_miss_dist_km': 1.2,
    'relative_velocity_kms': 12.1,
    'collision_prob_pc': 0.005,
    'crossing_angle_deg': 45.0,
    'malicious_extra_field': 'attack_payload'
}
r_bad = client.post('/api/v1/engine2/optimize-maneuver', json=bad_payload)
assert r_bad.status_code == 422, f'Expected 422 for extra field, got {r_bad.status_code}'
print("✓ Pydantic extra='forbid' rejected injected payload with 422 Unprocessable Entity")

# 4. Test valid maneuver optimization
valid_payload = {
    'conjunction_id': 101,
    'active_sat_norad_id': 44804,
    'debris_norad_id': 48078,
    'time_to_tca_hours': 4.5,
    'pre_maneuver_miss_dist_km': 1.2,
    'relative_velocity_kms': 12.1,
    'collision_prob_pc': 0.005,
    'crossing_angle_deg': 45.0,
}
r_valid = client.post('/api/v1/engine2/optimize-maneuver', json=valid_payload)
assert r_valid.status_code == 200
data = r_valid.json()
print(f"Optimal Strategy: {data['optimal_maneuver_label']}, post-miss: {data['post_maneuver_miss_dist_km']} km")
assert data['post_maneuver_miss_dist_km'] >= data['optimal_burn_dv_ms']
print(f"✓ Optimization succeeded: optimal dv = {data['optimal_burn_dv_ms']} m/s, post-miss = {data['post_maneuver_miss_dist_km']} km")

# 5. Test Live TLE endpoint
r_tle = client.get('/api/v1/live/tles')
assert r_tle.status_code == 200
assert 'earth' in r_tle.json()
print('✓ GET /api/v1/live/tles returned valid TLEs')

print('\nALL FASTAPI SECURITY & FUNCTIONAL VERIFICATIONS PASSED!')
