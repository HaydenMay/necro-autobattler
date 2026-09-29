# Bundle the game into docs\game.js (docs\ is the whole website: index.html + game.js + vendor\ + assets\)
#   .\build_game.ps1          then serve docs\ (see README) or push it to GitHub Pages
Set-Location $PSScriptRoot
npx esbuild game/main.ts --bundle --outfile=docs/game.js --target=es2019 --sourcemap=inline --log-level=warning
if ($LASTEXITCODE -eq 0) { "built docs\game.js  ({0:N0} KB)" -f ((Get-Item docs\game.js).Length / 1KB) }
