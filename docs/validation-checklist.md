# QVAC Benchmark Validation Checklist

This document defines the manual validation steps needed before declaring `qvac-bench` production‑ready.  
All checks refer to the **real QVAC server stream**, unless explicitly labelled “mock”.

---

## 1. Purpose

- Provide a repeatable, human‑driven validation process.
- Separate mock CI validation (already automated) from real‑QVAC validation (manual).
- Identify unresolved manual checks that block the production‑ready label.
- Ensure reviewers understand the difference between artificial test data and live measurements.

---

## 2. Prerequisites (on any target machine)

- **Node.js**: >= 20.x LTS
- **pnpm**: >= 9.x
- **Git**: latest stable
- **Network access** to the QVAC server (if running real‑QVAC checks)

---

## 3. Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/your‑org/qvac‑bench.git
   cd qvac‑bench
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Build the distributable package:
   ```bash
   pnpm build
   ```
4. Verify the CLI is available:
   ```bash
   node dist/cli.js --help   # or use the package script: pnpm qvac-bench --help
   ```
   Expected output: usage information listing the available options (`--url`, `--model`, etc.).

---

## 4. Mock CI Validation (automated – no real QVAC required)

**Goal**: Confirm that unit tests and build pass without an actual QVAC server.

- Run the test suite:
  ```bash
  pnpm test
  ```
- Expected result: all tests pass; the report shows **no** network‑related failures.
- The mock HTTP responses simulate the QVAC streaming protocol (SSE). No authentication, no remote server.
- This validation is **already part of CI** and does **not** require a real QVAC endpoint.

**Mock CI checklist**:

- [ ] `pnpm test` passes on a clean checkout (no cached node_modules).
- [ ] Code coverage meets project thresholds.
- [ ] No warnings or errors appear in test output.
- [ ] Build (`pnpm build`) completes without errors.
- [ ] Package verification script (`pnpm run verify-package`) succeeds.

---

## 5. Real QVAC Server Validation (manual)

> **Warning**: This section requires a **live QVAC server** and a valid API key.  
> The CI workflow **never** connects to a real server; these checks must be performed manually by a human.

### 5.1 Environment

- Set the API key:
  ```bash
  export QVAC_API_KEY=<your-api-key>
  ```
- Verify connectivity (optional):
  ```bash
  curl -s -o /dev/null -w "%{http_code}" \
       -H "Authorization: Bearer $QVAC_API_KEY" \
       https://your-qvac-server.example.com/health
  ```
  Expected: HTTP 200 (or a documented non‑error status).

### 5.2 Basic correctness

| Step | Command / Action | Expected Result |
|------|------------------|-----------------|
| 5.2.1 | `node dist/cli.js --url https://your-qvac-server.example.com --model <model> --prompt "Hello, world!"` | Output contains `Time to first token` and `Total generation time` (text format by default). No errors. |
| 5.2.2 | Same command with `--output json` | Output is valid JSON (validate with `jq .`). Keys: `timeToFirstTokenMs`, `totalTimeMs`, `output`, etc. |
| 5.2.3 | Same command with `--output csv` | Output includes CSV header and one data row. |
| 5.2.4 | `--iterations 3` | Summary block appears with min/median/max/p95 for each metric. Number of individual results equals 3. |
| 5.2.5 | Increase `--max-tokens 256` and `/or` change the prompt | No degradation in stream parsing; token count increases. |
| 5.2.6 | Omit `--url` (uses default) | QVAC server falls back to the built‑in default. If default is unreachable, a clear error is shown. |
| 5.2.7 | Use an unreachable URL (`--url http://localhost:1999`) | Error message includes `server_unavailable`; exit code is non‑zero. |

### 5.3 Error handling triage

| Failure symptom | Likely cause | Action |
|----------------|-------------|--------|
| `server_unavailable` | Wrong URL, firewall, or QVAC not running | Verify URL, restart QVAC, check network |
| `http_error` (4xx/5xx) | Authentication issue or server misconfiguration | Check API key, model name, server logs |
| `malformed_stream` | QVAC server SSE payload does not match expected format | Compare raw response with `curl -H "Accept: text/event-stream"` |
| `timeout` | Response took longer than `--timeout` | Increase `--timeout` or investigate server latency |
| Missing `output` field in JSON | Model returned an empty or zero‑length response | Retry with a different prompt or model |
| CLI crashes / unhandled rejection | Bug in argument parsing or stream consumption | Capture stack trace, open issue |

---

## 6. Validation matrix

At least **two distinct environments** must be exercised, one resembling a developer workstation (macOS) and one representing a fresh install (Linux CI ephemeral machine).

| Environment | OS / Arch | Node version | pnpm version | Mock CI result | Real QVAC result | Notes |
|-------------|-----------|--------------|--------------|----------------|------------------|-------|
| Mac local run (dev machine) | macOS 14 arm64 | 20.x LTS | 9.x | ✅ (see §4) | ❓ *Unresolved* | Requires access to a real QVAC server; run §5 manually |
| Fresh install run (ephemeral Linux) | Ubuntu 22.04 x86_64 | 20.x LTS | 9.x | ✅ (see §4) | ❓ *Unresolved* | Same as above; if server unreachable, mark as blocked |

**Notes**:

- “Mock CI result” refers to the automated `pnpm test` phase – it **always** passes without a real server.
- “Real QVAC result” is **optional** for the checklist to be considered “ready for production” *only if* the server is available. If unavailable, the check is marked **Unresolved** and must be completed before signing off.
- Additional environments (Windows, Docker more restrictive networks) should be validated in subsequent iterations.

---

## 7. Unresolved manual checks

- [ ] Real‑QVAC validation on **Windows 11** (x64) – no such run performed yet.
- [ ] Real‑QVAC validation behind a **corporate proxy** – proxy configuration and TLS inspection not tested.
- [ ] Real‑QVAC validation with **different model names** (list the exact models that have been tried).
- [ ] Validate behaviour when the QVAC server returns very large responses (> 10k tokens).
- [ ] Validate behaviour when network conditions introduce packet loss / high latency.

> **⚠️ Safety rule**: Do **not** claim that the tool is “production‑ready” based solely on mock CI data.  
> Every unresolved check in this list must be executed and documented before any production‑ready label is applied.

---

## 8. Sign‑off & process

- **Reviewers** will check each box in the relevant sections and add their initials.
- **No automatic merge** is allowed when the checklist references real performance numbers without actual run data.
- Once all **mandatory** real‑QVAC checks are completed (or explicitly deferred with a documented reason), the document is considered satisfied.

---

## 9. Changelog draft (for the upcoming release)

- `docs/validation-checklist.md` added to capture manual validation steps for production readiness.
- Clarified separation between mock‑CI and real‑QVAC validation.
- Included macOS/local run and fresh‑install Linux matrix.
- Marked unresolved cross‑platform and proxy checks for future inspections.

*Draft generated for human/GPT review – not to be merged without approval.*
