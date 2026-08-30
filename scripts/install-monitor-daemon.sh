#!/bin/sh
# 把 catalyst-monitor 装成 macOS launchd 常驻服务：
# 开机自启、崩溃自动拉起（30s 冷却）、caffeinate 防休眠。
# 用法: sh scripts/install-monitor-daemon.sh      安装/更新
#       sh scripts/install-monitor-daemon.sh off  卸载
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.happystock.catalyst-monitor"
PLIST_SRC="$REPO/catalyst-monitor/launchd/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "$1" = "off" ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST_DST"
    echo "已卸载 $LABEL"
    exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__REPO__|$REPO|g" "$PLIST_SRC" > "$PLIST_DST"

# 重新加载（已存在则先卸载）
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo "已安装并启动 $LABEL"
echo "日志: tail -f /tmp/catalyst-monitor.log"
echo "卸载: sh scripts/install-monitor-daemon.sh off"
