# Build the whole website into docs\ : the 3D game bundle (docs\game.js) and the Angular navigation shell (docs\index.html, main.js, chunk-*.js, styles.css)
#   .\build_all.ps1        then serve docs\ (node serve.cjs 8081) or push to GitHub Pages
Set-Location $PSScriptRoot
& "$PSScriptRoot\build_game.ps1"
if ($LASTEXITCODE -ne 0) { exit 1 }
Remove-Item docs\chunk-*.js, docs\main.js, docs\styles.css, docs\index.html, docs\3rdpartylicenses.txt, docs\prerendered-routes.json -ErrorAction SilentlyContinue
Set-Location "$PSScriptRoot\shell"
if (-not (Test-Path node_modules)) { npm install }
npx ng build 2>&1 | Select-String -Pattern 'ERROR|error|Initial total|complete' | ForEach-Object { $_.Line }
Remove-Item "$PSScriptRoot\docs\prerendered-routes.json" -ErrorAction SilentlyContinue
