#!/bin/bash
set -e

cd "$(dirname "$0")"

VERSION=$(grep '"version"' package.json | head -1 | awk -F'"' '{print $4}')

echo "Building squirreldb TypeScript SDK v${VERSION}..."
bun run build

echo "Running tests..."
bun test

echo "Publishing to npm..."
npm publish --access public

echo "Published squirreldb@${VERSION} to npm"
