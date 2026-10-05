#!/usr/bin/env bash
# M 板（M-01 / M-02 / M-04）逐帧结构核对 —— 一次跑完。
# 用法：bash scripts/struct-specs/run-m-boards.sh
#
# dev:clean 起的服务在别的文件被改动时会整页重编译，单次跑测到编译中间态就会报
# 「产品里找不到 …」。所以每帧最多试三次，只有三次都失败才算这一帧没过。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SPECS=(
  m-01-frame-a-topbar
  m-02-frame-a-process-summary
  m-04-frame-a-drawer-head
  m-04-frame-a-drawer-search
  m-04-frame-a-drawer-newtask
  m-04-frame-a-drawer-seg
  m-04-frame-a-drawer-foot
  m-04-frame-d-delete-confirm
)
fail=0
for s in "${SPECS[@]}"; do
  ok=0
  for try in 1 2 3; do
    out="$(node "$HERE/../struct-diff.mjs" "$HERE/$s.mjs" 2>&1)"
    code=$?
    if [ "$code" -eq 0 ] || ! printf '%s' "$out" | grep -q "产品里找不到"; then
      printf '%s\n' "$out"
      ok=1
      break
    fi
    sleep 12
  done
  if [ "$ok" -eq 0 ]; then printf '%s\n' "$out"; fail=1; fi
  echo
done
exit $fail
