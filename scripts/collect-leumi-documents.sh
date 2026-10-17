#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
if mise exec -- npm run docs:leumi -- --collect --watch; then
  if command -v notify-send >/dev/null; then
    notify-send 'Leumi documents ready' 'The requested mortgage report is saved in SpendWise: private/leumi-documents/' || true
  fi
else
  result=$?
  if command -v notify-send >/dev/null; then
    notify-send 'Leumi document collection needs attention' 'The request was preserved. Run docs:leumi --collect to check again.' || true
  fi
  exit "$result"
fi
