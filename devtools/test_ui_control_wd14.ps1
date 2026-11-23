# ui_control.ps1 本機 WD14 環境注入：隔離測試
# 使用 temp 中 ui_control.ps1 的副本 + mock server，不連接、不停止任何正式服務。
# 可同時用 PowerShell 7 與 Windows PowerShell 5.1 執行。
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repo 'ui_control.ps1'
$pass = 0
$fail = 0
$base = Join-Path ([System.IO.Path]::GetTempPath()) ("sid-wd14-launcher-test-" + [guid]::NewGuid().ToString('N'))
$script:OriginalEnv = @{}
foreach ($n in @('WD14_PY', 'WD14_WORKER', 'WD14_VIT_PY', 'WD14_VIT_WORKER')) {
    $script:OriginalEnv[$n] = [System.Environment]::GetEnvironmentVariable($n, 'Process')
}

function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) {
        $script:pass++
        Write-Output "  PASS  $Name"
    } else {
        $script:fail++
        Write-Output "  FAIL  $Name  $Detail"
    }
}

function Make-Copy {
    param([string]$DirName, [hashtable]$Paths, [string]$MockServer, [string]$PythonExe)

    $dir = Join-Path $base $DirName
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $content = [System.IO.File]::ReadAllText($source, [System.Text.Encoding]::UTF8)

    # 把本機 WD14 絕對路徑換成 temp 假檔（並保留原程式碼邏輯）
    foreach ($k in $Paths.Keys) {
        $old = $script:Wd14Defaults[$k]
        $content = $content.Replace($old, $Paths[$k])
    }
    $content = $content.Replace(
        "`$script:ServerScript = 'C:\ComfyUI\simple_ui\server.py'",
        "`$script:ServerScript = '$MockServer'")
    $content = $content.Replace(
        "`$script:Logs         = 'C:\ComfyUI\logs'",
        "`$script:Logs         = '$dir\logs'")
    $content = $content.Replace(
        "`$script:Python       = 'C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe'",
        "`$script:Python       = '$PythonExe'")
    $content = $content.Replace('-lt 15 -and -not (Test-PortUp 7860)', '-lt 1 -and -not (Test-PortUp 7860)')
    $content = $content.Replace('($($i + 1)/15)', '($($i + 1)/1)')

    $copy = Join-Path $dir 'ui_control.copy.ps1'
    [System.IO.File]::WriteAllText($copy, $content, (New-Object System.Text.UTF8Encoding($true)))
    return $copy
}

function Set-ParentWd14 {
    [System.Environment]::SetEnvironmentVariable('WD14_PY', 'PARENT_PY', 'Process')
    [System.Environment]::SetEnvironmentVariable('WD14_WORKER', 'PARENT_WORKER', 'Process')
    Remove-Item -LiteralPath 'Env:WD14_VIT_PY' -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath 'Env:WD14_VIT_WORKER' -ErrorAction SilentlyContinue
}

try {
    New-Item -ItemType Directory -Path $base -Force | Out-Null
    $script:Wd14Defaults = @{
        WD14_PY         = 'C:\ComfyUI\tools\wd14-venv\Scripts\python.exe'
        WD14_WORKER     = 'C:\ComfyUI\tools\wd14_worker.py'
        WD14_VIT_PY     = 'C:\ComfyUI\tools\wd14-vit-eval\venv\Scripts\python.exe'
        WD14_VIT_WORKER = 'C:\ComfyUI\tools\wd14_vit_worker.py'
    }

    # mock server：把子程序收到的 WD14 環境變數寫成 JSON，證明「確實繼承」
    $mock1 = Join-Path $base 'mock_server_ok.py'
    $dump1 = Join-Path $base 'env_ok.json'
    @"
import json, os, sys
names = ['WD14_PY', 'WD14_WORKER', 'WD14_VIT_PY', 'WD14_VIT_WORKER']
data = {n: os.environ.get(n, '<UNSET>') for n in names}
with open(r'$dump1', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False)
"@ | Set-Content -LiteralPath $mock1 -Encoding UTF8

    $pythonExe = (Get-Command python).Source
    Write-Output "PowerShell $($PSVersionTable.PSVersion.ToString()) | python=$pythonExe"

    $fake = @{}
    foreach ($k in $script:Wd14Defaults.Keys) {
        $p = Join-Path $base ($k + '.fake')
        Set-Content -LiteralPath $p -Value 'fake' -Encoding ASCII
        $fake[$k] = $p
    }

    Write-Output '[A] 本機 WD14 完整：注入子程序 + finally 還原'
    $copy1 = Make-Copy -DirName 'ok' -Paths $fake -MockServer $mock1 -PythonExe $pythonExe
    Set-ParentWd14
    $script:EnvDumpFile = $dump1
    . $copy1
    # dot-source 會定義正式 Test-PortUp，必須在之後覆寫，避免碰到正式 port
    function Test-PortUp {
        param([int]$Port)
        if ($Port -eq 8188) { return $true }
        return (Test-Path -LiteralPath $script:EnvDumpFile)
    }
    $r1 = Start-Ui
    $child = Get-Content -LiteralPath $dump1 -Raw -Encoding UTF8 | ConvertFrom-Json
    Check '四個 WD14 環境變數傳遞給 server.py 子程序' (
        $child.WD14_PY -eq $fake.WD14_PY -and
        $child.WD14_WORKER -eq $fake.WD14_WORKER -and
        $child.WD14_VIT_PY -eq $fake.WD14_VIT_PY -and
        $child.WD14_VIT_WORKER -eq $fake.WD14_VIT_WORKER) (
        $child | ConvertTo-Json -Compress)
    Check '父 Process 原有值還原 (WD14_PY / WD14_WORKER)' (
        [System.Environment]::GetEnvironmentVariable('WD14_PY', 'Process') -eq 'PARENT_PY' -and
        [System.Environment]::GetEnvironmentVariable('WD14_WORKER', 'Process') -eq 'PARENT_WORKER')
    Check '父 Process 原本未設定的變數仍為未設定' (
        $null -eq [System.Environment]::GetEnvironmentVariable('WD14_VIT_PY', 'Process') -and
        $null -eq [System.Environment]::GetEnvironmentVariable('WD14_VIT_WORKER', 'Process'))
    Check '成功訊息標示本機 WD14 已設定' ($r1.Wd14 -match '本機 WD14 已設定') $r1.Message

    Write-Output '[B] 缺少必要路徑：明確錯誤 + 不注入 + 基本服務仍啟動'
    $mock2 = Join-Path $base 'mock_server_missing.py'
    $dump2 = Join-Path $base 'env_missing.json'
    @"
import json, os
names = ['WD14_PY', 'WD14_WORKER', 'WD14_VIT_PY', 'WD14_VIT_WORKER']
data = {n: os.environ.get(n, '<UNSET>') for n in names}
with open(r'$dump2', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False)
"@ | Set-Content -LiteralPath $mock2 -Encoding UTF8

    $fakeMissing = @{}
    foreach ($k in $fake.Keys) { $fakeMissing[$k] = $fake[$k] }
    $fakeMissing['WD14_WORKER'] = (Join-Path $base 'NOT_EXIST_WORKER.py')
    $copy2 = Make-Copy -DirName 'missing' -Paths $fakeMissing -MockServer $mock2 -PythonExe $pythonExe
    Set-ParentWd14
    $script:EnvDumpFile = $dump2
    . $copy2
    function Test-PortUp {
        param([int]$Port)
        if ($Port -eq 8188) { return $true }
        return (Test-Path -LiteralPath $script:EnvDumpFile)
    }
    $r2 = Start-Ui
    $child2 = Get-Content -LiteralPath $dump2 -Raw -Encoding UTF8 | ConvertFrom-Json
    Check '缺少路徑時有明確白話錯誤（含缺少的變數與基本生圖不受影響）' (
        $r2.Wd14 -match '本機 WD14 資源不完整' -and
        $r2.Wd14 -match 'WD14_WORKER' -and
        $r2.Wd14 -match '基本生圖不受影響') $r2.Wd14
    Check '缺少路徑時不注入任何 WD14 環境變數' (
        $child2.WD14_PY -eq 'PARENT_PY' -and
        $child2.WD14_WORKER -eq 'PARENT_WORKER' -and
        $child2.WD14_VIT_PY -eq '<UNSET>' -and
        $child2.WD14_VIT_WORKER -eq '<UNSET>') ($child2 | ConvertTo-Json -Compress)
    Check '缺少 WD14 仍嘗試啟動基本服務（mock server 有被啟動）' (Test-Path -LiteralPath $dump2)
    Check '缺少路徑情境下父 Process 環境仍乾淨' (
        [System.Environment]::GetEnvironmentVariable('WD14_PY', 'Process') -eq 'PARENT_PY' -and
        $null -eq [System.Environment]::GetEnvironmentVariable('WD14_VIT_PY', 'Process'))

    Write-Output '[D] 7860 已有既存 Server：不重啟、不注入、不誤報已載入 WD14'
    $dump3 = Join-Path $base 'env_existing.json'
    $mock3 = Join-Path $base 'mock_server_existing.py'
    @"
import json
with open(r'$dump3', 'w', encoding='utf-8') as f:
    json.dump({'launched': True}, f)
"@ | Set-Content -LiteralPath $mock3 -Encoding UTF8
    $copy3 = Make-Copy -DirName 'existing' -Paths $fake -MockServer $mock3 -PythonExe $pythonExe
    Set-ParentWd14
    $script:injectCalls = 0
    $script:stopCalls = 0
    . $copy3
    # dot-source 後再覆寫，模擬「7860 已經在運行」並攔截注入／終止行為
    function Test-PortUp { param([int]$Port) return $true }
    function Set-LocalWd14Env { $script:injectCalls++; return @() }
    function Stop-Process {
        [CmdletBinding()]
        param([int]$Id, [switch]$Force)
        $script:stopCalls++
    }
    $r3 = Start-Ui
    Check '既存 Server：不呼叫 Start-Process（mock server 未被啟動）' (-not (Test-Path -LiteralPath $dump3))
    Check '既存 Server：不注入 WD14 環境變數' ($script:injectCalls -eq 0) "injectCalls=$($script:injectCalls)"
    Check '既存 Server：不終止既存程序' ($script:stopCalls -eq 0) "stopCalls=$($script:stopCalls)"
    Check '既存 Server：Wd14 / Message 不宣稱已載入 WD14' (
        $r3.Wd14 -notmatch '本機 WD14 已設定' -and
        $r3.Wd14 -match '沒有重新啟動' -and
        $r3.Wd14 -match '無法確認目前介面是否已載入 WD14' -and
        $r3.Message -notmatch '本機 WD14 已設定') $r3.Message
    Check '既存 Server：父 Process 環境變數保持原值' (
        [System.Environment]::GetEnvironmentVariable('WD14_PY', 'Process') -eq 'PARENT_PY' -and
        [System.Environment]::GetEnvironmentVariable('WD14_WORKER', 'Process') -eq 'PARENT_WORKER' -and
        $null -eq [System.Environment]::GetEnvironmentVariable('WD14_VIT_PY', 'Process') -and
        $null -eq [System.Environment]::GetEnvironmentVariable('WD14_VIT_WORKER', 'Process'))

    Write-Output "[C] 公開使用者情境：server.py 未設定 WD14 時仍回 WD14_NOT_CONFIGURED"
    $srv = Get-Content -LiteralPath (Join-Path $repo 'server.py') -Raw -Encoding UTF8
    Check '公開版 server.py 不含本機絕對路徑' ($srv -notmatch 'wd14-venv\\Scripts' -and $srv -notmatch 'wd14-vit-eval\\venv')
    Check '公開版仍保留 WD14_NOT_CONFIGURED' ($srv -match 'WD14_NOT_CONFIGURED')
    Check '注入邏輯僅存在於本機啟動器' (
        (Get-Content -LiteralPath $source -Raw -Encoding UTF8) -match 'WD14_VIT_WORKER')
}
finally {
    # 還原測試前的父 Process 環境（就算測試失敗也不留下污染）
    foreach ($n in @('WD14_PY', 'WD14_WORKER', 'WD14_VIT_PY', 'WD14_VIT_WORKER')) {
        $old = $script:OriginalEnv[$n]
        if ($null -eq $old) {
            Remove-Item -LiteralPath ("Env:" + $n) -ErrorAction SilentlyContinue
        } else {
            [System.Environment]::SetEnvironmentVariable($n, $old, 'Process')
        }
    }
    if (Test-Path -LiteralPath $base) {
        Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Output "`n結果：$pass PASS / $fail FAIL"
    if ($fail -gt 0) { exit 1 }
}
