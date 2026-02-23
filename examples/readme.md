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

Generates a water efficiency report with year-to-date totals, monthly breakdown, today's detail, and an assessment of your system's recycling performance.

### `auxiliary-output.js`

Fetches auxiliary output data for the past 30 days and prints a per-day breakdown with a summary. Exits early if your device does not support auxiliary output.
