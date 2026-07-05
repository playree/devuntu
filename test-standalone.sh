#!/bin/bash

cd "$(dirname "$0")"

rm -rf ./out

cp -r ./.next/standalone ./out
cp -r ./.next/static ./out/.next/static
cp -r ./db ./out/db
cp .env ./out/.env
