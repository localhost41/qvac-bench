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
| macOS 14 (Apple Silicon) – local | `pnpm install && pnpm test && pnpm build`                             | All tests green; build succeeds     |  ☐   |            | Run on a clean checkout. |
| Linux (fresh install)           | `pnpm install && pnpm test && pnpm build`                             | All tests green; build succeeds     |  ☐   |            | Node.js 20 LTS from a clean image. |

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
| macOS 14 (Apple Silicon) – local | `<real‑qvac‑url>`       | `gpt-4o-mini`  | `node dist/cli.js --url $QVAC_URL --model gpt-4o-mini --prompt "Hello" --max-tokens 50 --iterations 3`                                                               | Time‑to‑first‑token and total‑time stats printed; exit code 0.                           |  ☐   |            | Run after a clean build. |
| Linux (fresh install)           | `<real‑qvac‑url>`       | `gpt-4o-mini`  | `node dist/cli.js --url $QVAC_URL --model gpt-4o-mini --prompt "Hello" --max-tokens 50 --iterations 3`                                                               | Same as above; no errors.                                                                 |  ☐   |            | Node.js 20 LTS from a clean image. |

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

**Optional format checks** (repeat with `--output json` and `--output csv`):
- JSON output must be valid JSON and contain the required keys (see README).
- CSV output must include a header line and at least one data row.

### 2.4 Failure Triage

Use the table below when a real‑QVAC run fails.

| Symptom                                         | Likely Cause                                  | Diagnostic Steps                                                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non‑200 HTTP status in error message            | Server unavailable or auth rejected           | Verify the `--url` and `QVAC_API_KEY`. Try `curl` to the same endpoint with the same headers.                                                                                                 |
| Timeout error (AbortError / exceeded ms)        | Network or server too slow                    | Increase `--timeout-ms` temporarily; check latency with a simple `curl`.                                                                                                                      |
| “malformed_stream” error                        | Unexpected data in the streaming response     | Check if the endpoint is compatible with OpenAI‑style SSE. Capture raw response with `curl -N`.                                                                                               |
| `server_unavailable` error                      | Connect failure (DNS, TLS, network)           | Verify the URL is reachable from the test host (`curl -v`).                                                                                                                                   |
| Sanitised error message still contains secrets  | Sanitiser misses a header or query parameter  | **Stop immediately** and review `sanitizeErrorMessage` / `safeEndpointLabel` in `src/cli.ts`. Do **not** continue until the leak is fixed.                                                    |

### 2.5 Unresolved / Manual Checks

The items below still require manual verification or are out of scope for the
current release.  They are marked **[UNRESOLVED]** until further data is
collected.

- [ ] **[UNRESOLVED]** Large prompts (e.g., several KB of text) and high
      `--max-tokens` values do not cause infinite hangs or memory exhaustion.
- [ ] **[UNRESOLVED]** Streaming interruptions (server disconnects mid‑response)
      are handled gracefully and produce a clear error.
- [ ] **[UNRESOLVED]** Concurrent executions against the real endpoint do not
      violate rate limits or produce corrupted output (not currently targeted by
      the tool).
- [ ] **[UNRESOLVED]** End‑to‑end latency SLOs (e.g., p95 < X ms) are
      acceptable for the production deployment; this checklist does **not**
      measure performance guarantees.

---

## Appendix: Separating Mock CI from Real QVAC Validation

- **Mock CI validation** uses the test fixtures defined in `test/index.test.ts`.
  It can run everywhere and is included in the repository’s CI pipeline
  (`.github/workflows/ci.yml`).  No external network access is required.
- **Real QVAC validation** is **always** manual.  It requires a live QVAC
  server, valid credentials, and careful output inspection.  It must **never**
  gate a CI pipeline that lacks the real endpoint.

Keep the two separate – a green CI badge does **not** imply the tool has been
validated against a production QVAC deployment.  Complete the manual matrix
above when the real endpoint becomes available.
