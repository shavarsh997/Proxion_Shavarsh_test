#!/bin/sh
set -eu
npx prisma migrate deploy
if [ "${SEED_ON_START:-false}" = "true" ]; then
  npx prisma db seed
fi
exec node dist/src/main
