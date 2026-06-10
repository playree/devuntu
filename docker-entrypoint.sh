#!/bin/sh
set -e

cd migrate
npx prisma migrate deploy
cd ..

# exec で CMD に渡された node を PID 1 として起動し、シグナルを正しく受け取らせる
exec "$@"
