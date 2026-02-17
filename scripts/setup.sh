#!/bin/bash
set -e

echo "╔══════════════════════════════════════════════╗"
echo "║  X-LLM Setup                                ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required. Install it from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Error: Node.js 18+ required. You have $(node -v)"
    exit 1
fi

echo "Node.js $(node -v) detected."

# Install dependencies
echo "Installing dependencies..."
npm install

# Build
echo "Building..."
npm run build

echo ""
echo "Setup complete! Run with:"
echo "  npm start        # Interactive CLI"
echo "  npm run dev      # Dev mode (no build needed)"
echo "  npm run api      # REST API server"
echo ""
echo "You'll need an OpenRouter API key: https://openrouter.ai/keys"
