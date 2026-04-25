import csv
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.neighbors import NearestNeighbors

CSV = 'data/projects_combined.csv'

# ── Load ──────────────────────────────────────────────────────────────────────
ORDER_COLS = ['ordered_solar', 'ordered_battery', 'ordered_wallbox', 'ordered_heatpump']

with open(CSV) as f:
    rows = [r for r in csv.DictReader(f)
            if any(r[c] == 'True' for c in ORDER_COLS)]

# ── Features ──────────────────────────────────────────────────────────────────
# Continuous: standardized so large-valued fields don't dominate
CONTINUOUS = ['energy_demand_wh', 'energy_price_per_wh', 'energy_price_increase']
# Boolean flags: already 0/1, no scaling needed
BOOLEANS   = ['has_ev', 'has_solar', 'has_storage', 'has_wallbox']
# Categorical: one-hot (country has 2 values, so 1 dummy suffices)

def encode_row(r):
    cont  = [float(r[c]) if r[c] else np.nan for c in CONTINUOUS]
    bools = [1.0 if r[c] == 'True' else 0.0   for c in BOOLEANS]
    cat   = [1.0 if r['country'] == 'Germany' else 0.0]
    return cont + bools + cat

raw = np.array([encode_row(r) for r in rows], dtype=float)

# Save pre-standardisation medians for use in find_similar imputation
pre_scale_medians = [float(np.nanmedian(raw[:, col])) for col in range(len(CONTINUOUS))]

# Impute missing continuous values with column median
for col in range(len(CONTINUOUS)):
    raw[np.isnan(raw[:, col]), col] = pre_scale_medians[col]

# Standardize continuous columns only (booleans + dummy stay as 0/1)
scaler = StandardScaler()
raw[:, :len(CONTINUOUS)] = scaler.fit_transform(raw[:, :len(CONTINUOUS)])

# ── Fit KNN ───────────────────────────────────────────────────────────────────
# k=6 so we can exclude the query row itself and still get 5 neighbours
knn = NearestNeighbors(n_neighbors=6, metric='euclidean')
knn.fit(raw)

project_ids = [r['project_id'] for r in rows]

def find_similar(query: dict, k: int = 5):
    """
    query: dict with the same keys as a projects_combined row,
           or a partial dict — missing values fall back to dataset medians.
    Returns list of (project_id, distance, row_dict) for the k nearest houses.
    """
    vec = np.array([encode_row(query)], dtype=float)
    for col in range(len(CONTINUOUS)):
        if np.isnan(vec[0, col]):
            vec[0, col] = pre_scale_medians[col]   # use pre-standardisation median
    vec[0, :len(CONTINUOUS)] = scaler.transform(vec[:, :len(CONTINUOUS)])[0]

    dists, idxs = knn.kneighbors(vec, n_neighbors=k + 1)
    results = []
    for dist, idx in zip(dists[0], idxs[0]):
        pid = project_ids[idx]
        if pid == query.get('project_id'):   # skip self if querying an existing row
            continue
        results.append((pid, round(dist, 4), rows[idx]))
        if len(results) == k:
            break
    return results


# ── Demo ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    # Example: a German household with 5000 kWh/yr demand, 32ct/kWh, has an EV
    query = {
        'energy_demand_wh':    '5000000',
        'energy_price_per_wh': '0.00032',
        'energy_price_increase': '0.03',
        'has_ev':      'True',
        'has_solar':   'False',
        'has_storage': 'False',
        'has_wallbox': 'False',
        'country':     'Germany',
    }

    print(f'Query: {query["energy_demand_wh"]} Wh/yr, EV={query["has_ev"]}, country={query["country"]}')
    print()

    OUTPUT_COLS = ['ordered_solar', 'ordered_battery', 'ordered_wallbox',
                   'primary_module_count', 'primary_battery_kwh', 'primary_wallbox_kw']

    for pid, dist, neighbour in find_similar(query, k=5):
        print(f'  [{dist:.3f}] {pid}  demand={float(neighbour["energy_demand_wh"])/1000:.0f} kWh  '
              f'EV={neighbour["has_ev"]}  country={neighbour["country"]}')
        for col in OUTPUT_COLS:
            if neighbour.get(col):
                print(f'           {col}: {neighbour[col]}')
        print()
