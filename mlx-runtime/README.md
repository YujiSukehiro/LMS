# Disposable MLX development runtime

This directory is local-only development infrastructure. The Next.js application never imports MLX, starts this server, or deploys this directory. Delete `mlx-runtime` to remove the SDK, model cache, and server scripts together.

## Start

From the upgrade-fork root:

```sh
./mlx-runtime/start.sh
```

The default smoke-test model is `mlx-community/Qwen2.5-7B-Instruct-4bit`. Override it with `MLX_MODEL` when needed. The first start downloads the model into `mlx-runtime/hf-cache`; no global Hugging Face cache is used. The server listens only on `127.0.0.1:8081` (leaving port 8080 free for the Firestore emulator) and runs in the foreground. Press Ctrl+C to stop it.

For another terminal, use the environment wrapper without reading or changing `.env.local`:

```sh
npm run verify:local-ai:mlx
npm run dev:mlx
```

`dev:mlx` runs the real capability preflight first and starts Next.js only when every required capability passes. Both commands select the same generic loopback HTTP profile. Do not declare local AI ready unless every required capability passes.

## Stop and status

```sh
./mlx-runtime/status.sh
./mlx-runtime/stop.sh
```

`MLX_PORT` and `MLX_MAX_TOKENS` are optional overrides. Keep concurrency at 1 until memory and latency measurements support a change. No hosted AI API or API key is required.
