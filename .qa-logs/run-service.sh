#!/usr/bin/env bash
set -euo pipefail
set -a
source ./.env.local
set +a
name="$1"; shift
cd services
export SERVICE_NAME="$name"
exec go run "$@" 
