# Rig + animate + export one unit from its JSON config.
#   .\run_unit.ps1 units\skeleton_archer.json
# Outputs land in .\out :  <Name>.glb  <Name>_arrow.glb  <Name>_enemy.png  <Name>_qa.png  <Name>.blend
param([Parameter(Mandatory = $true)][string]$Config)
$blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
if (-not (Test-Path $blender)) { $blender = (Get-ChildItem "C:\Program Files\Blender Foundation" -Recurse -Filter blender.exe | Select-Object -First 1).FullName }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& $blender -b -P "$here\blender\rig_unit.py" -- (Resolve-Path $Config) 2>&1 | Select-String "\[rig\]|Error|Traceback|Exception"
