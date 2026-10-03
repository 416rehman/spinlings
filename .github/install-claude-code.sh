# Installs one exact Claude Code build for `claude plugin validate` and `claude plugin test` (SPEC 12): the linux-x64
# native package straight from the registry, checked against its pinned sha512, with no install script run. Bump both
# lines together, from `npm view @anthropic-ai/claude-code-linux-x64@<version> dist.integrity`.
set -eu
version=2.1.288
integrity=sha512-m80cJZimlKjRiwveadPgAfubhbmwa2nF85gg20WbjnHl6QKMad0bXiMp6JNcPeSZsr0N1KJ/wkR34rRoiyyYyg==

dir="$RUNNER_TEMP/claude-code"
mkdir -p "$dir"
cd "$dir"
tgz=$(npm pack --silent "@anthropic-ai/claude-code-linux-x64@$version")
got="sha512-$(openssl dgst -sha512 -binary "$tgz" | base64 -w0)"
if [ "$got" != "$integrity" ]; then
  echo "::error::Claude Code $version does not match its pinned hash"
  exit 1
fi
tar -xzf "$tgz"
chmod +x package/claude
"$dir/package/claude" --version
echo "$dir/package" >> "$GITHUB_PATH"
echo "SPINLINGS_CLAUDE=$dir/package/claude" >> "$GITHUB_ENV"
