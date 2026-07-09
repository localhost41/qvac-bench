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

## CI validation

CI runs a smoke test against a lightweight local mock OpenAI-compatible streaming
endpoint. This verifies CLI behavior, streaming parsing, time to first token, total
duration, and approximate tokens/sec without requiring network access or a live
QVAC server. Real QVAC server validation should be run separately against the
target QVAC build and model.

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

## Output compatibility

`qvac-bench` treats JSON and CSV output fields as a compatibility surface for
downstream tools. Patch and alpha releases may add fields, but existing field
names, data types, and CSV column ordering should not change without a clear
release note.

JSON output is a single object with this shape:

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

If your local endpoint requires a bearer token, pass `--api-key` or set
`QVAC_API_KEY` or `OPENAI_API_KEY`.
