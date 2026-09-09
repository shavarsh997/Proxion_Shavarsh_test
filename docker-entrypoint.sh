#!/bin/sh
set -eu
yarn prisma:migrate
if [ "${SEED_ON_START:-false}" = "true" ]; then
  yarn prisma:seed
fi
exec node dist/src/main
