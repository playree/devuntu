#!/bin/sh
set -e

cd migrate
ln -s ../db ./db
npx prisma migrate deploy

# exec で CMD に渡された node を PID 1 として起動し、シグナルを正しく受け取らせる
exec "$@"
