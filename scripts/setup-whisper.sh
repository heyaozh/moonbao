#!/usr/bin/env bash
# 安装 whisper.cpp（Metal 加速）并下载中文效果好且体积小的量化模型（约 574MB）
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v whisper-cli >/dev/null 2>&1; then
  echo "==> brew install whisper-cpp"
  brew install whisper-cpp
else
  echo "==> whisper-cli 已安装: $(command -v whisper-cli)"
fi

MODEL=models/ggml-large-v3-turbo-q5_0.bin
mkdir -p models
if [ ! -f "$MODEL" ]; then
  echo "==> 下载模型 ggml-large-v3-turbo-q5_0.bin (~574MB)"
  curl -L --progress-bar -o "$MODEL" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"
else
  echo "==> 模型已存在: $MODEL"
fi

echo "==> 完成。快速自检："
whisper-cli --help >/dev/null && echo "whisper-cli OK"
ls -lh "$MODEL"
