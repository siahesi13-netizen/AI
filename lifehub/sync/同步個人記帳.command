#!/bin/sh
# 連按兩下即可把 Numbers 記帳檔同步到網站的個人財務
cd "$(dirname "$0")" || exit 1
[ -x .venv/bin/python ] || { python3 -m venv .venv && .venv/bin/pip -q install numbers-parser; }
.venv/bin/python personal_ledger.py
echo; echo "完成，可以關閉這個視窗。"
