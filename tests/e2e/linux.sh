#!/usr/bin/env bash
# Builds and smoke-tests the app on Linux inside Docker. Run from the project root.
set -euo pipefail

docker run --rm --ipc=host \
	-v "$PWD":/src:ro \
	-v dproz-agent-linux:/work \
	node:24-bookworm bash -euo pipefail -c '
		mkdir -p /work/app && cd /work/app
		rm -rf src resources tests
		cp -a /src/package.json /src/package-lock.json /src/electron.vite.config.ts /src/vitest.config.ts /src/tsconfig.json /src/tsconfig.node.json /src/tsconfig.web.json /src/biome.json .
		cp -a /src/src /src/resources .
		mkdir -p tests && cp -a /src/tests/unit tests/unit && mkdir -p tests/e2e && cp /src/tests/e2e/*.mjs tests/e2e/
		npm ci --no-audit --no-fund
		node node_modules/electron/install.js
		export DEBIAN_FRONTEND=noninteractive
		apt-get update -qq && apt-get install -y -qq xvfb xauth libgtk-3-0 libnotify4 libsecret-1-0 > /dev/null
		npx playwright install-deps chromium > /dev/null
		npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
		npx vitest run
		npx electron-vite build
		export DPROZ_AGENT_BROWSERS_PATH=/work/browsers DPROZ_AGENT_ELECTRON_ARGS=--no-sandbox EXPECT_SIGNED_OUT=1
		xvfb-run -a node tests/e2e/run.mjs platform
		mkdir -p /work/shots && cp tests/e2e/.tmp/shots/*.png /work/shots/
	'
