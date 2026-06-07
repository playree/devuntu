#!/bin/sh
set -e

./prisma-cli/node_modules/.bin/prisma migrate deploy --schema=./prisma/schema.prisma

# exec で CMD に渡された node を PID 1 として起動し、シグナルを正しく受け取らせる
exec "$@"
