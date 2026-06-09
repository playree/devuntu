#!/bin/sh
set -e

cd /migrate
pnpm prisma migrate deploy

# exec で CMD に渡された node を PID 1 として起動し、シグナルを正しく受け取らせる
exec "$@"
