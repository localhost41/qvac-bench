# QVAC Benchmark Validation Checklist

This document describes the manual validation steps needed before considering
`qvac-bench` production‑ready.  It separates **mock CI‑style validation**
(runnable without a real QVAC server) from **real‑QVAC validation** (which
requires a live QVAC endpoint).  CI does *not* require a live QVAC server;
all automated tests use in‑memory mock servers.

> **Important**  
> Do **not** treat results in this checklist as evidence of real‑world
> performance unless they have been backed by actual measurements on a live
> QVAC deployment. Every item that still needs verification is marked as
> **[UNRESOLVED]**.

---

## 1. Mock CI Validation

These checks confirm that the tool builds, its unit tests pass, and the
built CLI responds correctly when pointed at a mock provider.  They can be
run on any developer machine or CI agent – no QVAC access is needed.

### 1.1 Setup

- [ ] Clone the repository and run `pnpm install`.
- [ ] Execute `pnpm test` and verify all test suites pass.
- [ ] Execute `pnpm build`; the bundled CLI should appear under `dist/`.
- [ ] Run `node dist/cli.js --help` and confirm that the usage text is displayed
      (exit code `0`).

### 1.2 Mock Validation Matrix

| Environment                     | Steps                                                                 | Expected Outcome                    | Pass? | Date       | Notes |
| ------------------------------- | --------------------------------------------------------------------- | ----------------------------------- | :---: | ---------- | ----- |
| macOS 14 (Apple Silicon) – local | `pnpm install && pnpm test && pnpm build`                             | All tests green; build succeeds     |  ☐   |            | Run on a clean checkout. **[UNRESOLVED]** |
| Linux (fresh install)           | `pnpm install && pnpm test && pnpm build`                             | All tests green; build succeeds     |  ☐   |            | Node.js 20 LTS from a clean image. **[UNRESOLVED]** |

### 1.3 Additional Mock Checks

- [ ] Run `node dist/cli.js --output json --iterations 2` with mock fetch
      (using the test file helpers) and verify that the JSON output contains
      the keys described in the README.
- [ ] Run `node dist/cli.js --output csv` with mock fetch and confirm that
      the CSV header row appears and contains numeric values.
- [ ] Confirm that a simulated HTTP error produces a sanitised error message
      and a non‑zero exit code.
- [ ] Confirm that a simulated timeout produces an appropriate error and a
      non‑zero exit code.

---

## 2. Real QVAC Validation

These checks require **a live QVAC server and valid credentials**.  They
must be performed manually; they may **never** run inside an automated CI
pipeline that does not have access to the real endpoint.

### 2.1 Prerequisites

- [ ] QVAC endpoint URL (e.g., `https://qvac.example.com/v1/chat/completions`).
- [ ] Valid API key set in the `QVAC_API_KEY` (or `OPENAI_API_KEY`)
      environment variable.
- [ ] A model name supported by the endpoint (e.g., `gpt-4o-mini`).
- [ ] A prompt that returns a manageable number of tokens (suggested: `"Hello"`).

### 2.2 Real‑QVAC Validation Matrix

| Environment                     | QVAC URL               | Model          | Command (example)                                                                                                                                                    | Expected Output                                                                          | Pass? | Date       | Notes |
| ------------------------------- | ----------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | :---: | ---------- | ----- |
| macOS 14 (Apple Silicon) – local | `<real‑qvac‑url>`       | `gpt-4o-mini`  | `node dist/cli.js --url $QVAC_URL --model gpt-4o-mini --prompt "Hello" --max-tokens 50 --iterations 3`                                                               | Time‑to‑first‑token and total‑time stats printed; exit code 0.                           |  ☐   |            | Run after a clean build. **[UNRESOLVED]** |
| Linux (fresh install)           | `<real‑qvac‑url>`       | `gpt-4o-mini`  | `node dist/cli.js --url $QVAC_URL --model gpt-4o-mini --prompt "Hello" --max-tokens 50 --iterations 3`                                                               | Same as above; no errors.                                                                 |  ☐   |            | Node.js 20 LTS from a clean image. **[UNRESOLVED]** |

### 2.3 Steps for Each Row

1. Set the environment variables:
   ```bash
   export QVAC_URL="<real‑qvac‑url>"
   export QVAC_API_KEY="<your‑key>"
   ```
2. Build the CLI if not already built: `pnpm build`.
3. Execute the command from the matrix using the correct `--url` and model.
4. Inspect stdout:
   - The output must contain `Time to first token:` and `Total generation time:`.
   - If token‑level usage is reported, `Completion tokens:` and
     `Approx tokens/sec:` should also appear.
   - When `--iterations N` (N > 1) is used, summary lines (min, median, max, p95)
     must be present.
5. Inspect stderr; it must be empty for a successful run.
6. Confirm that the exit code is `0`.
7. If the run exits with a non‑zero code or produces unexpected output, refer to the [Failure Triage](#24-failure-triage) section for debugging guidance.

**Example expected stdout (single iteration)**

### 2.4 Failure Triage

When a real-QVAC run exits with a non-zero code or produces unexpected output,
use the following checks to isolate the cause. Error output should be sanitized;
do not share raw credentials or unredacted logs.

1. **Validate connectivity** - Verify the endpoint URL from the same machine:
   ```bash
   curl -v "$QVAC_URL"
   ```
   If the host cannot be reached, check DNS, VPN, firewall, and proxy settings.

2. **Confirm endpoint shape** - Make sure the URL points at the expected
   OpenAI-compatible chat completions path, commonly `/v1/chat/completions`.

3. **Check authentication** - Confirm `QVAC_API_KEY` or `OPENAI_API_KEY` is
   exported, current, and allowed to use the selected model. HTTP `401` or
   `403` errors usually indicate missing, expired, or unauthorized credentials.

4. **Verify the model name** - Ensure the value passed to `--model` is
   available on the target endpoint. Query the provider's model list when one
   is available.

5. **Inspect common error codes**:
   - `server_unavailable`: the upstream host could not be reached.
   - `http_error`: the endpoint returned a non-2xx HTTP status.
   - `malformed_stream`: the endpoint returned unexpected or invalid SSE data.
   - `timeout`: the request took longer than the configured timeout.

6. **Reduce the request** - Retry with a short prompt and a small token budget:
   ```bash
   node dist/cli.js --url "$QVAC_URL" --model "$QVAC_MODEL" --prompt "Hello" --max-tokens 10
   ```

7. **Capture sanitized diagnostics** - Save stdout and stderr separately:
   ```bash
   node dist/cli.js --url "$QVAC_URL" --model "$QVAC_MODEL" > out.txt 2> err.txt
   ```
   Confirm `err.txt` does not contain raw API keys before sharing it.

8. **Compare with a raw request** - If the CLI still fails, use `curl --no-buffer`
   against the same endpoint. If the raw request fails too, the issue is likely
   endpoint, credential, or network related rather than a `qvac-bench` bug.
