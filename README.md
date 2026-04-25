# Reonic AI Roof Analyzer

An AI-powered renewable energy system designer for residential installations. Enter an address to analyze its solar potential via the Google Solar API, and receive an automatically generated system proposal — PV panels, battery storage, inverter — sized to the household's energy demand and roof geometry.

Built for the **Reonic Track** at BBH 2026.

---

## Setup

### 1. API Keys

Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

Then edit `.env`:

```
MAPS_API_KEY=your_google_maps_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

- **MAPS_API_KEY** — Google Maps Platform key with the [Solar API](https://developers.google.com/maps/documentation/solar) and [Map Tiles API](https://developers.google.com/maps/documentation/tile) enabled
- **GEMINI_API_KEY** — Google Gemini API key

### 2. Python Dependencies

Requires Python 3.12+. Install dependencies using [uv](https://docs.astral.sh/uv/):

```bash
uv sync
```

### 3. Run Locally

Serve the project from its root directory:

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080/index.html](http://localhost:8080/index.html) in your browser.

---

## Data

> **Work in progress.**

Training data from Reonic (anonymized real customer projects) should be placed in the `data/` directory. The `data/` directory is gitignored. See `nearest_house.py` for the KNN-based similar-project lookup used to inform system recommendations.
