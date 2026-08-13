# vhs tape for the gate hero GIF.
# Render with:  vhs demo/gate.tape   (https://github.com/charmbracelet/vhs)
# Produces demo/gate.gif — scan finds secrets, [f] fixes them into .env.
#
# The tape builds a throwaway fixture in /tmp so the scan isn't polluted by
# the repo's own files, and cleans up after.

Output demo/gate.gif

Set FontSize 16
Set Width 1200
Set Height 820
Set Padding 22
Set Theme "Catppuccin Mocha"

Type "# gate — find secrets, see how exposed they are, fix them." Enter
Sleep 700ms

# Build a throwaway project with planted secrets.
Type "mkdir -p /tmp/gate-demo && cd /tmp/gate-demo" Enter
Sleep 300ms
Type `printf 'const awsKey = "AKIAIOSFODNN7EXAMPLE";\nconst dbUrl = "postgres://admin:hunter2pw@db.internal:5432/prod";\n' > app.js` Enter
Sleep 400ms
Type "cat app.js" Enter
Sleep 1500ms

Type "# Scan. Secrets are redacted in output, and classified by exposure:" Enter
Sleep 500ms
Type "gate scan app.js" Enter
Sleep 4s

# gate scan ends at an interactive prompt: [f] Fix all. Press it.
Type "f"
Sleep 3s

# The source now reads from env; the values live in .env.
Type "cat app.js" Enter
Sleep 2000ms
Type "cat .env" Enter
Sleep 3000ms

Type "cd - >/dev/null && rm -rf /tmp/gate-demo" Enter
Sleep 500ms
