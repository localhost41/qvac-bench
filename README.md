# qvac-bench

Public QVAC developer tooling from LocalHost Labs.

## Local development

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

## CLI

Run the local CLI after building:

```bash
pnpm build
node dist/cli.js --help
```

Available command:

```bash
qvac-bench --help
```

Benchmark a local QVAC OpenAI-compatible streaming endpoint:

```bash
qvac-bench \
  --url http://localhost:8000/v1/chat/completions \
  --model qvac \
  --prompt "Say hello in one short sentence." \
  --max-tokens 64
```

Run a built-in prompt fixture by name:

```bash
qvac-bench --prompt-name hello
qvac-bench --prompt-name summary
qvac-bench --prompt-name reasoning
```

Available prompt fixtures:

| Name | Description |
| --- | --- |
| `hello` | Short greeting baseline. |
| `summary` | Concise summarization baseline. |
| `reasoning` | Small multi-step reasoning baseline. |

The CLI prints time to first token, total generation time, completion tokens when the
server includes streaming usage, and approximate tokens/sec when completion tokens
are available. If the QVAC server is not running or the endpoint is unreachable, the
CLI exits non-zero with a clear unavailable-server message.

## Methodology

`qvac-bench` sends one OpenAI-compatible streaming chat completion request to the
configured endpoint. The request includes the selected model, prompt, `max_tokens`,
`stream: true`, and `stream_options: { include_usage: true }`.

The benchmark reports:

- Time to first token: elapsed time from starting the HTTP request until the first
  non-empty streamed content delta is received.
- Total generation time: elapsed time from starting the HTTP request until the
  stream finishes.
- Completion tokens: the server-reported `usage.completion_tokens` value, when the
  server includes streaming usage.
- Approx tokens/sec: completion tokens divided by total generation time, when
  completion tokens are available.

### Warm‑up, cold start, and measured runs

Cold starts and warm starts yield different numbers because the first request may
include model loading, cache setup, or other one‑time work. For **warm‑start**
results:

1. Start your QVAC server.
2. Send an unrecorded warm‑up request with the same parameters you intend to measure:

   ```bash
   qvac-bench \
     --url http://localhost:8000/v1/chat/completions \
     --model qvac \
     --prompt-name hello \
     --max-tokens 64 > /dev/null
   ```

3. Run the measured benchmark one or more times:

   ```bash
   qvac-bench \
     --url http://localhost:8000/v1/chat/completions \
     --model qvac \
     --prompt-name hello \
     --max-tokens 64 \
     --output json
   ```

For **cold‑start** results, simply omit the warm‑up request and run the measured
benchmark immediately after starting the server.

To increase confidence, repeat the measurement several times (e.g., 3–5 runs) and
report the median and spread. Ensure no other heavy workloads are competing for
CPU, GPU, or memory during the runs, and note any concurrent processes in the
report.

> **Report template:** A reusable report template that captures all the details
> listed below is available at
> [`docs/reports/template.md`](docs/reports/template.md).

#### Approximate tokens/sec

The “Approx tokens/sec” value is calculated as `completion_tokens` divided by
`total_generation_time`. This figure is an **approximation** because total
generation time includes network round‑trips, HTTP parsing, and server‑side
overhead beyond pure token generation. Use it for relative comparisons under the
same network conditions and infrastructure, not as a precise measure of model
throughput.

To reproduce a result:

1. Start the same QVAC server build and model locally.
2. Install dependencies and build the CLI:

   ```bash
   pnpm install
   pnpm build
   ```

3. Run the benchmark with explicit inputs:

   ```bash
   qvac-bench \
     --url http://localhost:8000/v1/chat/completions \
     --model qvac \
     --prompt-name hello \
     --max-tokens 64 \
     --output json
   ```

4. Record the command, QVAC server version or commit, model name, prompt or prompt
   fixture, `--max-tokens`, output format, machine type, and whether the run was
   cold-start or warm-start.

Use `--output json` or `--output csv` for machine-readable benchmark results:

```bash
qvac-bench --output json
qvac-bench --output csv
```

If your local endpoint requires a bearer token, pass `--api-key` or set
`QVAC_API_KEY` or `OPENAI_API_KEY`.
