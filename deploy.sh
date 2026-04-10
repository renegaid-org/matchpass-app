#!/bin/bash
set -euo pipefail

cd /opt/matchpass-app

docker compose -f docker-compose.prod.yml up -d --build

docker image prune -f
