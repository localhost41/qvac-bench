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
  --max-tokens 64 \
  --timeout-ms 30000 \
  --iterations 5
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
are available. With `--iterations` greater than `1`, it repeats the same request and
prints min, median, max, and p95 summaries for time to first token and total
generation time. Tokens/sec summaries are included when the endpoint reports
completion token counts.

## Troubleshooting

The CLI exits non-zero for validation and endpoint failures. Authentication
values from `--api-key`, `QVAC_API_KEY`, `OPENAI_API_KEY`, bearer headers, and
sensitive URL query parameters are redacted from error output.

- Missing option values include help text, for example:
  `Missing value for --url. Provide --url <url> or omit --url to use the default.`
  and
  `Missing value for --model. Provide --model <model> or omit --model to use the default.`
- If the QVAC server is not running or the endpoint cannot be reached, the CLI
  prints: `QVAC server unavailable at <endpoint>. Is it running? <reason>`
- If the server responds with an error status, the CLI prints:
  `QVAC endpoint returned a non-2xx response at <endpoint>. HTTP <status> <status text>`
  Check that the URL points to `/v1/chat/completions`, the model is loaded, and
  any required bearer token is valid.
- If the response is not an OpenAI-compatible streaming body, the CLI prints:
  `QVAC endpoint returned a malformed stream at <endpoint>. <reason>` Check that
  the server is returning `data:` server-sent event chunks with JSON payloads.
- If the request or stream exceeds the timeout, the CLI prints:
  `QVAC request timed out at <endpoint>. <reason>` Increase `--timeout-ms` for
  cold starts or first model loads.

## CI validation

CI runs a smoke test against a lightweight local mock OpenAI-compatible streaming
endpoint. This verifies CLI behavior, streaming parsing, time to first token, total
duration, and approximate tokens/sec without requiring network access or a live
QVAC server. Real QVAC server validation should be run separately against the
target QVAC build and model.

## Methodology

`qvac-bench` sends one or more OpenAI-compatible streaming chat completion requests
to the configured endpoint. Each request includes the selected model, prompt,
`max_tokens`, `stream: true`, and `stream_options: { include_usage: true }`.

The benchmark reports:

- Time to first token: elapsed time from starting the HTTP request until the first
  non-empty streamed content delta is received.
- Total generation time: elapsed time from starting the HTTP request until the
  stream finishes.
- Completion tokens: the server-reported `usage.completion_tokens` value, when the
  server includes streaming usage.
- Approx tokens/sec: completion tokens divided by total generation time, when
  completion tokens are available.

When `--iterations` is greater than `1`, the summary reports:

- Min: fastest observed value.
- Median: middle value after sorting, or the average of the two middle values for
  an even number of runs.
- Max: slowest observed value.
- p95: nearest-rank 95th percentile after sorting.

Use repeated runs to compare warm performance across the same endpoint, model,
prompt, and `--max-tokens` value. Time to first token is most useful for perceived
responsiveness. Total generation time captures end-to-end streamed completion
duration. Tokens/sec is approximate because it depends on server-reported completion
token counts and uses total generation time as the denominator.

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
     --iterations 5 \
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

## Output compatibility

`qvac-bench` treats JSON and CSV output fields as a compatibility surface for
downstream tools. Patch and alpha releases may add fields, but existing field
names, data types, and CSV column ordering should not change without a clear
release note.

For one iteration, JSON output is a single object with this shape:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `timeToFirstTokenMs` | number | Yes | Milliseconds from request start until the first non-empty streamed token delta. |
| `totalTimeMs` | number | Yes | Milliseconds from request start until the stream finishes. |
| `completionTokens` | number | No | Server-reported `usage.completion_tokens`, when included by the endpoint. |
| `tokensPerSecond` | number | No | `completionTokens` divided by total generation seconds, when completion tokens are available. |
| `output` | string | Yes | Concatenated streamed text output. Empty output is represented as an empty string. |

CSV output uses one header row and one result row. The current column order is:

```text
timeToFirstTokenMs,totalTimeMs,completionTokens,tokensPerSecond,output
```

When optional numeric values are unavailable, their CSV cells are empty. CSV
values are escaped with double quotes when needed.

For repeated runs, JSON output includes `iterations`, `results`, and `summary`.
The `results` array contains one single-run result object per iteration, and
`summary` contains `timeToFirstTokenMs`, `totalTimeMs`, and, when available,
`tokensPerSecond` summary objects with `min`, `median`, `max`, and `p95`.

For repeated CSV runs, output is summary-oriented with this header:

```text
metric,min,median,max,p95
```

If your local endpoint requires a bearer token, pass `--api-key` or set
`QVAC_API_KEY` or `OPENAI_API_KEY`.
