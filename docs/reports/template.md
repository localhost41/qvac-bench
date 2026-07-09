# QVAC Benchmark Report

## Summary

- Date:
- Reporter:
- QVAC version or commit:
- Benchmark command:
- Prompt or prompt fixture:
- Max tokens:
- Run type: cold start / warm start

## System

- Device:
- OS:
- CPU:
- GPU or accelerator:
- RAM:
- Memory notes:

## Model

- Model:
- Quantization:
- Context length:
- Runtime or server:

## Results

| Metric | Value | Notes |
| --- | --- | --- |
| Time to first token (TTFT) |  |  |
| Tokens/sec |  |  |
| Completion tokens |  |  |
| Total generation time |  |  |

## Benchmark methodology

- **Run type:** (cold start / warm start / warm‑up + measurement)  
  <!-- Explain how the server was started and whether a warm‑up request was performed. -->
- **Warm‑up procedure:** [e.g., ran one unrecorded request with the same parameters before measurement]
- **Measurement iterations:** [e.g., single shot, or mean of N runs with standard deviation]
- **System idle state:** [e.g., no other compute‑heavy workloads; note any concurrent processes]
- **Background load:** [describe any other processes that were running during the benchmark]
- **Hardware notes:** (refer to the [System](#system) section)
- **Model/quantization notes:** (refer to the [Model](#model) section)
- **Recommended command template (repeatable local benchmark):**
  ```bash
  # Warm‑up (unrecorded)
  qvac-bench \
    --url http://localhost:8000/v1/chat/completions \
    --model qvac \
    --prompt-name hello \
    --max-tokens 64 > /dev/null

  # Measured run
  qvac-bench \
    --url http://localhost:8000/v1/chat/completions \
    --model qvac \
    --prompt-name hello \
    --max-tokens 64 \
    --output json
  ```

## Limitations

- **Approximate token counting:** Tokens/sec is calculated as `completion_tokens / total_generation_time`.  
  This includes network round‑trip time and server‑side overhead, not pure inference time.  
  Use the reported tokens/sec only for relative comparisons under identical conditions.
- **Single‑request variability:** The tool executes a single streaming request.  
  Run several independent measurements and report the median and spread for robust conclusions.
- **Network influence:** For intra‑machine benchmarks, prefer `--url http://localhost:...`.  
  Results can be affected by other local network activity.
- **Stream handling:** The benchmark waits until the stream ends.  
  If the server closes the stream before all tokens are generated, total time may be under‑estimated.

## Reproduction Notes

- Endpoint URL:
- Environment variables used:
- Setup notes:
- Additional observations:
