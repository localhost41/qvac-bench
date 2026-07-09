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

The CLI prints time to first token, total generation time, completion tokens when the
server includes streaming usage, and approximate tokens/sec when completion tokens
are available. If the QVAC server is not running or the endpoint is unreachable, the
CLI exits non-zero with a clear unavailable-server message.

Use `--output json` or `--output csv` for machine-readable benchmark results:

```bash
qvac-bench --output json
qvac-bench --output csv
```

If your local endpoint requires a bearer token, pass `--api-key` or set
`QVAC_API_KEY` or `OPENAI_API_KEY`.
