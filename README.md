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

Cold starts and warm starts can produce very different numbers. The first request
after starting a local QVAC server may include model loading, cache setup, or other
one-time work. For more comparable warm-start results, send one unrecorded request
first, then run the benchmark command several times with the same endpoint, model,
prompt, and `--max-tokens` value.

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

## Testing

The test suite includes smoke tests that exercise the CLI against a lightweight
mock OpenAI‑compatible streaming endpoint built into the test harness. These tests
verify that time‑to‑first‑token, total generation time, and tokens‑per‑second are
output and produce reasonable values without requiring a real QVAC server. CI runs
this suite with no external network dependencies.

To validate against a real QVAC server, run the benchmark manually against your
local endpoint as described above.
