#!/bin/bash
set -e

cd "$(dirname "$0")"

VERSION="0.1.0"

echo "Building squirreldb-sdk v${VERSION}..."
bun run build

echo "Running tests..."
bun test

echo "Publishing to npm..."
npm publish --access public

echo "Published squirreldb-sdk@${VERSION} to npm"
