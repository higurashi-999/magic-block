#!/usr/bin/env bash
# マジック・ブロック 品質ゲート：全JSの構文チェック＋テスト実行。
# これが通らないコードはデプロイしない。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== syntax check =="
for f in js/*.js tests/*.js; do
  node --check "$f"
  echo "syntax ok: $f"
done

echo "== tests =="
for t in tests/*.test.js; do
  node "$t"
done

echo "check.sh: ALL OK"
