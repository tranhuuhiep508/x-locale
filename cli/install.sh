#!/bin/sh
# Install the standalone `loc` binary (no Python needed) on Linux or macOS.
#
#   curl -fsSL https://github.com/tranhuuhiep508/x-locale/releases/latest/download/install.sh | sh
#
# Environment overrides:
#   LOC_VERSION      release to install, e.g. 0.2.0 or cli-v0.2.0 (default: newest cli-v* release)
#   LOC_INSTALL_DIR  install directory (default: $HOME/.local/bin)
#   LOC_REPO         GitHub owner/repo hosting the releases
set -eu

REPO="${LOC_REPO:-tranhuuhiep508/x-locale}"
INSTALL_DIR="${LOC_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${LOC_VERSION:-}"

fail() { echo "loc install: $*" >&2; exit 1; }

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  *) fail "unsupported OS $(uname -s); on Windows use install.ps1" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported CPU $(uname -m)" ;;
esac
# A shell running under Rosetta reports x86_64; prefer the native build.
if [ "$os" = macos ] && [ "$arch" = x64 ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = 1 ]; then
  arch=arm64
fi
asset="loc-$os-$arch"

if [ -z "$VERSION" ]; then
  tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=100" \
    | grep -o '"tag_name": *"cli-v[^"]*"' | head -n 1 | sed 's/.*"\(cli-v[^"]*\)"/\1/') \
    || fail "could not list releases of $REPO"
  [ -n "$tag" ] || fail "no cli-v* release found in $REPO"
else
  case "$VERSION" in cli-v*) tag="$VERSION" ;; *) tag="cli-v$VERSION" ;; esac
fi

base="https://github.com/$REPO/releases/download/$tag"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "Downloading $asset ($tag)..."
curl -fsSL "$base/$asset" -o "$tmp/$asset" || fail "download failed: $base/$asset"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "download failed: $base/SHA256SUMS"

expected=$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d ' ' -f 1)
[ -n "$expected" ] || fail "$asset is missing from SHA256SUMS"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/$asset" | cut -d ' ' -f 1)
else
  actual=$(shasum -a 256 "$tmp/$asset" | cut -d ' ' -f 1)
fi
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset"

mkdir -p "$INSTALL_DIR"
chmod +x "$tmp/$asset"
mv "$tmp/$asset" "$INSTALL_DIR/loc"
echo "Installed $("$INSTALL_DIR/loc" --version) to $INSTALL_DIR/loc"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Add $INSTALL_DIR to your PATH, e.g.: echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.profile" ;;
esac
