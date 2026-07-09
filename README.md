# qvac-bench

Public QVAC developer tooling from LocalHost Labs.

## Local development

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

Verify the package before an alpha release:

```bash
pnpm verify:package
```

This runs lint, tests, build, and an `npm pack --dry-run` integrity check. The
package check verifies the packed files include the CLI entrypoint, README,
CHANGELOG, LICENSE, type declarations, and shipped docs under `docs/`. It also
packs the real tarball, installs it into a temporary consumer project, imports
the public API, runs the installed `qvac-bench --help` bin, and confirms the
report and validation templates are present after install.

Supported runtime majors are Node.js 22, 24, and 26. CI runs the full package
verification flow across that matrix.

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
target QVAC build and model, and must be tracked in
[docs/validation-checklist.md](docs/validation-checklist.md). Until a live run is
recorded there, real-QVAC validation is unresolved.

## Methodology

`qvac-bench` sends one or more OpenAI-compatible streaming chat completion requests
to the configured endpoint. Each request includes the selected model, prompt,
`max_tokens`, `stream: true`, and `stream_options: { include_usage: true }`.
Use the [benchmark report template](docs/reports/template.md) when publishing or
sharing results so the command, system, model, and known limitations are recorded
next to the numbers.

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

Time to first token is most useful for perceived responsiveness. Total generation
time captures end-to-end streamed completion duration. Tokens/sec is approximate
because it depends on server-reported completion token counts and uses total
generation time as the denominator.

### Production benchmark guidance

Public benchmark results should keep the benchmark setup fixed and documented.
Changing the server build, model, quantization, prompt, `--max-tokens`, or machine
load between runs can move the numbers enough to make comparisons misleading.

- Warmup vs measured runs: run at least one unrecorded warmup request before
  collecting warm-start results. Use the same endpoint, model, prompt, and
  `--max-tokens` value for warmup and measurement. Increase `--iterations` for the
  measured command instead of mixing separate one-off runs.
- Cold start vs warm start: label results clearly. A cold-start run starts from a
  freshly launched QVAC server and may include model loading, memory mapping, cache
  setup, compilation, or other one-time work. A warm-start run measures after the
  model is already loaded and a matching warmup request has completed.
- Hardware notes: record the device, OS, CPU, GPU or accelerator, RAM, power mode,
  thermal constraints, and whether the machine was plugged in. For shared or cloud
  systems, record the instance type and any visible resource limits.
- Model and quantization notes: record the exact model identifier, quantization,
  context length, runtime or server version, QVAC commit or build, and any relevant
  runtime flags. Do not compare different model files or quantization levels as if
  they were the same benchmark target.
- Background load: close unrelated CPU, GPU, and disk-heavy work where practical.
  Record meaningful background load, including other inference servers, indexing
  jobs, downloads, video calls, browser tabs, or container workloads.
- Repeated local runs: run the same measured command multiple times when publishing
  important numbers. Report the command, summary statistics, and any discarded
  outliers with the reason they were discarded.

Recommended repeatable local QVAC flow:

```bash
# 1. Build the CLI.
pnpm install
pnpm build

# 2. Start the QVAC server and load the target model in another terminal.

# 3. Warm the endpoint once without recording the result.
node dist/cli.js \
  --url http://localhost:8000/v1/chat/completions \
  --model qvac \
  --prompt-name hello \
  --max-tokens 64 \
  --timeout-ms 60000 \
  --iterations 1 \
  --output json

# 4. Run the measured benchmark with the same inputs.
node dist/cli.js \
  --url http://localhost:8000/v1/chat/completions \
  --model qvac \
  --prompt-name hello \
  --max-tokens 64 \
  --timeout-ms 60000 \
  --iterations 10 \
  --output json
```

For a cold-start result, restart the QVAC server immediately before the measured
command and skip the warmup command. Publish cold-start and warm-start results as
separate numbers.

### Token counting limitations

`qvac-bench` only reports completion tokens and tokens/sec when the endpoint
includes `usage.completion_tokens` in the streaming response. That count is
server-reported and may vary by tokenizer, model family, runtime, or compatibility
layer. If an endpoint omits streaming usage, `completionTokens` and
`tokensPerSecond` are unavailable.

Tokens/sec is an approximate throughput metric. It divides reported completion
tokens by total streamed generation time, so it includes request setup, scheduling,
and final stream shutdown time. It is useful for comparing repeatable local runs on
the same stack, but it should not be treated as a tokenizer-independent or
cross-runtime absolute measurement.

To reproduce a result:

1. Start the same QVAC server build and model locally.
2. Install dependencies and build the CLI:

   ```bash
   pnpm install
   pnpm build
   ```

3. Run the benchmark with explicit inputs:

   ```bash
   node dist/cli.js \
     --url http://localhost:8000/v1/chat/completions \
     --model qvac \
     --prompt-name hello \
     --max-tokens 64 \
     --timeout-ms 60000 \
     --iterations 5 \
     --output json
   ```

4. Record the command, QVAC server version or commit, model name, prompt or prompt
   fixture, `--max-tokens`, output format, machine type, hardware notes,
   quantization, background load, and whether the run was cold-start or warm-start.

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
