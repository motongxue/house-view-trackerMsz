#!/bin/sh
# 择隅 · 升级后重启脚本（v2.0.0）
# 由 upgrade.js 以独立 argv 调用：sh restart.sh <serviceName>
# 不接受任何 shell 字符串拼接；serviceName 在 JS 侧已做白名单校验。
SVC="$1"
[ -n "$SVC" ] || SVC="house-view-tracker"

# 延时 2 秒，让升级完成的 HTTP 响应先发回前端，避免浏览器看到连接重置。
sleep 2

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$SVC" 2>/dev/null; then
  systemctl restart "$SVC"
  exit $?
fi

# 没有 systemd：杀掉旧进程后用 start.sh 拉起（部署包自带）。
pkill -f "node server.js" 2>/dev/null || true
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$DIR" || exit 1
if [ -f ./start.sh ]; then
  nohup ./start.sh >> run.log 2>&1 &
else
  nohup node server.js >> run.log 2>&1 &
fi
