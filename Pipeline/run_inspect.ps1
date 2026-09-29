# First look at a NEW Tripo zip: stats + labelled grid renders for reading landmarks.
#   .\run_inspect.ps1 input\some+character.zip
param([Parameter(Mandatory = $true)][string]$Zip)
$blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
if (-not (Test-Path $blender)) { $blender = (Get-ChildItem "C:\Program Files\Blender Foundation" -Recurse -Filter blender.exe | Select-Object -First 1).FullName }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& $blender -b -P "$here\blender\inspect_model.py" -- (Resolve-Path $Zip) 2>&1 | Select-String "\[inspect\]|Error|Traceback|Exception"
