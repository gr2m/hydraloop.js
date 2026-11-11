# Examples

All examples require a Hydraloop API key set as an environment variable:

```bash
export HYDRALOOP_API_KEY="your-api-key"
```

Run any example from the repository root with:

```bash
node examples/<name>.js
```

## Available Examples

### `readme.js`

Basic usage matching the README: lists your devices, fetches yearly recycled water data, and checks bypass mode status.

### `full-test.js`

Exercises every API method with formatted output. Useful for verifying your API key works and exploring the full response shapes.

### `water-efficiency.js`

Generates a water efficiency report with year-to-date totals, monthly breakdown, current month detail, and an assessment of your system's recycling performance.

### `tank-levels.js`

Prints the latest tank levels and a per-day summary (min / average / max) of the hourly tank levels for the current month.
