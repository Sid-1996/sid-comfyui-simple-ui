# ui_control.ps1 程序管理隔離測試
# 使用 temp 中的 ui_control.ps1 副本，完全覆寫 Port / 程序查詢 / Start-Process / Stop-Process，
# 不連接、不停止任何正式服務。可用 PowerShell 7 與 Windows PowerShell 5.1 執行。
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repo 'ui_control.ps1'
$base = Join-Path ([System.IO.Path]::GetTempPath()) ("sid-ui-control-test-" + [guid]::NewGuid().ToString('N'))
$pass = 0; $fail = 0

function Check {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) { $script:pass++; Write-Output "  PASS  $Name" }
    else { $script:fail++; Write-Output "  FAIL  $Name  $Detail" }
}

function New-FakeProc {
    param([int]$Id, [string]$Exe, [string]$CommandLine, [string]$Name = 'python.exe')
    [pscustomobject]@{ ProcessId = $Id; Name = $Name; ExecutablePath = $Exe; CommandLine = $CommandLine }
}

try {
    New-Item -ItemType Directory -Path $base -Force | Out-Null
    $content = [System.IO.File]::ReadAllText($source, [System.Text.Encoding]::UTF8)
    # 隔離 Port 與 Log，避免任何路徑碰到正式環境
    $content = $content.Replace('$script:UiPort    = 7860', '$script:UiPort    = 17860')
    $content = $content.Replace('$script:ComfyPort = 8188', '$script:ComfyPort = 18188')
    $content = $content.Replace("`$script:Logs         = 'C:\ComfyUI\logs'", "`$script:Logs         = '$base\logs'")
    $copy = Join-Path $base 'ui_control.copy.ps1'
    [System.IO.File]::WriteAllText($copy, $content, (New-Object System.Text.UTF8Encoding($true)))

    # 先取得副本中的常數值，供 fake process 使用
    . $copy
    $fakeExe = $script:Python
    $fakeServerPath = $script:ServerScript
    $uiPort = $script:UiPort
    $comfyPort = $script:ComfyPort

    # ── 模擬環境 ─────────────────────────────────────────────
    $script:Sim = $null
    function Reset-Sim {
        $script:Sim = @{
            UiPortUp = $false; ComfyPortUp = $false
            UiOwner = 0; ComfyOwner = 0
            Processes = @(); Stopped = @(); Started = @()
            StopMode = 'normal'   # normal / fail / noop
            StartFails = $false
            NextPid = 90000
            UiPortBindAt = 0; UiPortProbes = 0; PendingUiOwner = 0
        }
    }
    function Add-Server {
        param([int]$Id)
        $p = New-FakeProc -Id $Id -Exe $fakeExe -CommandLine "`"$fakeExe`" -u `"$fakeServerPath`" "
        $script:Sim.Processes = @($script:Sim.Processes) + @($p)
        $script:Sim.UiOwner = $Id; $script:Sim.UiPortUp = $true
        return $p
    }
    function Add-Comfy {
        param([int]$Id)
        $p = New-FakeProc -Id $Id -Exe $fakeExe -CommandLine "`"$fakeExe`" -s ComfyUI\main.py --windows-standalone-build"
        $script:Sim.Processes = @($script:Sim.Processes) + @($p)
        $script:Sim.ComfyOwner = $Id; $script:Sim.ComfyPortUp = $true
        return $p
    }
    function Add-Foreign {
        param([int]$Id, [int]$Port)
        $p = New-FakeProc -Id $Id -Exe 'C:\Other\python.exe' -CommandLine '"C:\Other\python.exe" -m http.server 8080'
        $script:Sim.Processes = @($script:Sim.Processes) + @($p)
        if ($Port -eq $uiPort) { $script:Sim.UiOwner = $Id; $script:Sim.UiPortUp = $true }
        else { $script:Sim.ComfyOwner = $Id; $script:Sim.ComfyPortUp = $true }
        return $p
    }
    function Add-ForeignComfy {
        param([int]$Id, [string]$Exe, [string]$CommandLine)
        $p = New-FakeProc -Id $Id -Exe $Exe -CommandLine $CommandLine
        $script:Sim.Processes = @($script:Sim.Processes) + @($p)
        $script:Sim.ComfyOwner = $Id; $script:Sim.ComfyPortUp = $true
        return $p
    }
    function Add-ForeignServer {
        param([int]$Id, [string]$Exe, [string]$CommandLine)
        $p = New-FakeProc -Id $Id -Exe $Exe -CommandLine $CommandLine
        $script:Sim.Processes = @($script:Sim.Processes) + @($p)
        $script:Sim.UiOwner = $Id; $script:Sim.UiPortUp = $true
        return $p
    }
    function Add-ServerNoPort {
        param([int]$Id)
        # 本專案 server.py 程序已存在，但 7860 尚未監聽（正在啟動或卡住）
        $p = New-FakeProc -Id $Id -Exe $fakeExe -CommandLine "`"$fakeExe`" -u `"$fakeServerPath`" "
        $script:Sim.Processes = @($script:Sim.Processes) + @($p)
        return $p
    }

    # ── 覆寫所有外部查詢／操作 ─────────────────────────────
    function Get-PortOwnerPid {
        param([int]$Port)
        if ($Port -eq $uiPort) { return [int]$script:Sim.UiOwner }
        if ($Port -eq $comfyPort) { return [int]$script:Sim.ComfyOwner }
        return 0
    }
    function Get-ProcessInfoById {
        param([int]$Id)
        return @($script:Sim.Processes | Where-Object { $_.ProcessId -eq $Id } | Select-Object -First 1)
    }
    function Get-AllPythonProcesses { return @($script:Sim.Processes) }
    function Test-PortUp {
        param([int]$Port)
        if ($Port -eq $uiPort) {
            if ($script:Sim.UiPortBindAt -gt 0) {
                $script:Sim.UiPortProbes++
                if ($script:Sim.UiPortProbes -ge $script:Sim.UiPortBindAt) {
                    $script:Sim.UiPortUp = $true
                    $script:Sim.UiOwner = $script:Sim.PendingUiOwner
                }
            }
            return [bool]$script:Sim.UiPortUp
        }
        if ($Port -eq $comfyPort) { return [bool]$script:Sim.ComfyPortUp }
        return $false
    }
    function Start-Sleep { param([int]$Milliseconds, [int]$Seconds) }
    function Invoke-Tick { param([scriptblock]$OnTick, [string]$Text) }
    function Test-LocalWd14Ready { return @('MOCK_WD14_MISSING') }
    function Set-LocalWd14Env { return @() }
    function Restore-LocalWd14Env { param([object[]]$Saved) }
    function Stop-Process {
        [CmdletBinding()]
        param([int]$Id, [switch]$Force)
        $script:Sim.Stopped += $Id
        if ($script:Sim.StopMode -eq 'fail') { throw 'mock stop error' }
        if ($script:Sim.StopMode -eq 'noop') { return }
        $script:Sim.Processes = @($script:Sim.Processes | Where-Object { $_.ProcessId -ne $Id })
        if ($Id -eq $script:Sim.UiOwner) { $script:Sim.UiOwner = 0; $script:Sim.UiPortUp = $false }
        if ($Id -eq $script:Sim.ComfyOwner) { $script:Sim.ComfyOwner = 0; $script:Sim.ComfyPortUp = $false }
    }
    function Start-Process {
        [CmdletBinding()]
        param([string]$FilePath, [string[]]$ArgumentList = @(), [string]$WorkingDirectory,
              [string]$WindowStyle, [string]$RedirectStandardOutput, [string]$RedirectStandardError)
        if ($script:Sim.StartFails) { throw 'mock start error' }
        $joined = ($ArgumentList -join ' ')
        $script:Sim.Started += $joined
        $id = ++$script:Sim.NextPid
        if ($joined -match 'ComfyUI[\\/]main\.py') { Add-Comfy -Id $id | Out-Null }
        elseif ($joined -match 'server\.py') { Add-Server -Id $id | Out-Null }
    }

    Write-Output '[A] 程序辨識'
    Reset-Sim
    Add-Server -Id 111
    Add-Comfy -Id 222
    $p = Get-ManagedProcesses
    Check 'python.exe -u 本專案 server.py 絕對入口被辨識為本專案介面' (@($p.Servers).Count -eq 1 -and @($p.Servers)[0].ProcessId -eq 111) (
        @($p.Servers) | ConvertTo-Json -Compress)
    Check 'ComfyUI main.py 被辨識為本專案 ComfyUI' (@($p.Comfys).Count -eq 1 -and @($p.Comfys)[0].ProcessId -eq 222) (
        @($p.Comfys) | ConvertTo-Json -Compress)
    Check '沒有誤判外來程序' (@($p.ForeignUi).Count -eq 0 -and @($p.ForeignComfy).Count -eq 0)

    Reset-Sim
    Add-ForeignServer -Id 223 -Exe $fakeExe -CommandLine "`"$fakeExe`" unrelated_worker.py `"$fakeServerPath`""
    $serverArg = Get-ManagedProcesses
    Check 'server.py 只出現在其他 Script 的參數時列為 Foreign' (
        @($serverArg.Servers).Count -eq 0 -and @($serverArg.ForeignUi).Count -eq 1 -and @($serverArg.ForeignUi)[0].ProcessId -eq 223) (
        $serverArg.ForeignUi | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignServer -Id 224 -Exe $fakeExe -CommandLine "`"$fakeExe`" -u server.py"
    $serverRelative = Get-ManagedProcesses
    Check '無法證明 CWD 的相對 server.py 入口列為 Foreign' (
        @($serverRelative.Servers).Count -eq 0 -and @($serverRelative.ForeignUi).Count -eq 1 -and @($serverRelative.ForeignUi)[0].ProcessId -eq 224) (
        $serverRelative.ForeignUi | ConvertTo-Json -Compress)

    Reset-Sim
    Add-Comfy -Id 341
    $pc = Get-ManagedProcesses
    Check '本專案 embedded Python + -s ComfyUI\main.py 列為 Managed' (
        @($pc.Comfys).Count -eq 1 -and @($pc.Comfys)[0].ProcessId -eq 341 -and @($pc.ForeignComfy).Count -eq 0) (
        $pc.Comfys | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 342 -Exe 'C:\Other\python.exe' -CommandLine '"C:\Other\python.exe" C:\Other\ComfyUI\main.py'
    $pf = Get-ManagedProcesses
    Check '其他 Python + C:\Other\ComfyUI\main.py 列為 Foreign' (
        @($pf.Comfys).Count -eq 0 -and @($pf.ForeignComfy).Count -eq 1 -and @($pf.ForeignComfy)[0].ProcessId -eq 342) (
        $pf.ForeignComfy | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 343 -Exe 'D:\ComfyUI-X\python.exe' -CommandLine '"D:\ComfyUI-X\python.exe" -s ComfyUI\main.py'
    $pf2 = Get-ManagedProcesses
    Check '其他 ComfyUI 安裝目錄 + 不同 Python 列為 Foreign' (
        @($pf2.Comfys).Count -eq 0 -and @($pf2.ForeignComfy).Count -eq 1 -and @($pf2.ForeignComfy)[0].ProcessId -eq 343) (
        $pf2.ForeignComfy | ConvertTo-Json -Compress)

    # ── 第三輪：入口路徑與目錄邊界 ─────────────────────────
    $absEntry = Join-Path $script:ComfyRoot 'ComfyUI\main.py'
    $siblingEntry = Join-Path $script:ComfyRoot 'ComfyUI2\main.py'

    Reset-Sim
    Add-ForeignComfy -Id 344 -Exe 'C:\Other\python.exe' -CommandLine "C:\Other\python.exe $absEntry --windows-standalone-build"
    $pb1 = Get-ManagedProcesses
    Check '絕對 main.py 入口（無引號）列為 Managed' (
        @($pb1.Comfys).Count -eq 1 -and @($pb1.Comfys)[0].ProcessId -eq 344) (
        @($pb1.Comfys) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 345 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" `"$absEntry`" --windows-standalone-build"
    $pb2 = Get-ManagedProcesses
    Check '絕對 main.py 入口（有引號）列為 Managed' (
        @($pb2.Comfys).Count -eq 1 -and @($pb2.Comfys)[0].ProcessId -eq 345) (
        @($pb2.Comfys) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 346 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" -s ${absEntry}.backup"
    $pb3 = Get-ManagedProcesses
    Check 'main.py.backup 不是入口，列為 Foreign' (
        @($pb3.Comfys).Count -eq 0 -and @($pb3.ForeignComfy).Count -eq 1 -and @($pb3.ForeignComfy)[0].ProcessId -eq 346) (
        @($pb3.ForeignComfy) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 347 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" --config=`"$absEntry`""
    $pb4 = Get-ManagedProcesses
    Check '正確路徑嵌入 --config= 參數，列為 Foreign' (
        @($pb4.Comfys).Count -eq 0 -and @($pb4.ForeignComfy).Count -eq 1 -and @($pb4.ForeignComfy)[0].ProcessId -eq 347) (
        @($pb4.ForeignComfy) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 348 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" -X `"$absEntry`""
    $pb5 = Get-ManagedProcesses
    Check '正確路徑當作 -X 選項的值，列為 Foreign' (
        @($pb5.Comfys).Count -eq 0 -and @($pb5.ForeignComfy).Count -eq 1 -and @($pb5.ForeignComfy)[0].ProcessId -eq 348) (
        @($pb5.ForeignComfy) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 349 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" D:\ComfyUI-X\ComfyUI\main.py"
    $pb6 = Get-ManagedProcesses
    Check '不同安裝根目錄的絕對 main.py，列為 Foreign' (
        @($pb6.Comfys).Count -eq 0 -and @($pb6.ForeignComfy).Count -eq 1 -and @($pb6.ForeignComfy)[0].ProcessId -eq 349) (
        @($pb6.ForeignComfy) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 350 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" `"$siblingEntry`""
    $pb7 = Get-ManagedProcesses
    Check '同根目錄不同子目錄 ComfyUI2\main.py，列為 Foreign' (
        @($pb7.Comfys).Count -eq 0 -and @($pb7.ForeignComfy).Count -eq 1 -and @($pb7.ForeignComfy)[0].ProcessId -eq 350) (
        @($pb7.ForeignComfy) | ConvertTo-Json -Compress)

    # ── 第四輪：Python 執行模式（-c / -m / 解析歧義） ────────
    Reset-Sim
    Add-ForeignComfy -Id 351 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" -c `"print(1)`" `"$absEntry`""
    $pm1 = Get-ManagedProcesses
    Check 'python -c 模式，後面參數含本專案 main.py → Foreign' (
        @($pm1.Comfys).Count -eq 0 -and @($pm1.ForeignComfy).Count -eq 1 -and @($pm1.ForeignComfy)[0].ProcessId -eq 351) (
        @($pm1.ForeignComfy) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 352 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" -m http.server `"$absEntry`""
    $pm2 = Get-ManagedProcesses
    Check 'python -m 模式，後面參數含本專案 main.py → Foreign' (
        @($pm2.Comfys).Count -eq 0 -and @($pm2.ForeignComfy).Count -eq 1 -and @($pm2.ForeignComfy)[0].ProcessId -eq 352) (
        @($pm2.ForeignComfy) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 353 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" -c `"print('x').py`""
    $pm3 = Get-ManagedProcesses
    Check '-c 後面的字串本身以 .py 結尾 → Foreign' (
        @($pm3.Comfys).Count -eq 0 -and @($pm3.ForeignComfy).Count -eq 1 -and @($pm3.ForeignComfy)[0].ProcessId -eq 353) (
        @($pm3.ForeignComfy) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 354 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" -m `"$absEntry`""
    $pm4 = Get-ManagedProcesses
    Check '-m 後面的 module 名稱即本專案路徑 → Foreign' (
        @($pm4.Comfys).Count -eq 0 -and @($pm4.ForeignComfy).Count -eq 1 -and @($pm4.ForeignComfy)[0].ProcessId -eq 354) (
        @($pm4.ForeignComfy) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 355 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" -X utf8 $absEntry"
    $pm5 = Get-ManagedProcesses
    Check '-X 有合法參數值時仍能解析後續真正的 Script 入口 → Managed' (
        @($pm5.Comfys).Count -eq 1 -and @($pm5.Comfys)[0].ProcessId -eq 355) (
        @($pm5.Comfys) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 356 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" -W ignore $absEntry"
    $pm6 = Get-ManagedProcesses
    Check '-W 有合法參數值時仍能解析後續真正的 Script 入口 → Managed' (
        @($pm6.Comfys).Count -eq 1 -and @($pm6.Comfys)[0].ProcessId -eq 356) (
        @($pm6.Comfys) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 357 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" -X"
    $pm7 = Get-ManagedProcesses
    Check '-X 缺少必要參數 → Foreign' (
        @($pm7.Comfys).Count -eq 0 -and @($pm7.ForeignComfy).Count -eq 1 -and @($pm7.ForeignComfy)[0].ProcessId -eq 357) (
        @($pm7.ForeignComfy) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 358 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" -W"
    $pm8 = Get-ManagedProcesses
    Check '-W 缺少必要參數 → Foreign' (
        @($pm8.Comfys).Count -eq 0 -and @($pm8.ForeignComfy).Count -eq 1 -and @($pm8.ForeignComfy)[0].ProcessId -eq 358) (
        @($pm8.ForeignComfy) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 359 -Exe 'C:\Other\python.exe' -CommandLine "`"C:\Other\python.exe`" --unknown-mode $absEntry"
    $pm9 = Get-ManagedProcesses
    Check '不明確／不支援的執行模式 → Foreign' (
        @($pm9.Comfys).Count -eq 0 -and @($pm9.ForeignComfy).Count -eq 1 -and @($pm9.ForeignComfy)[0].ProcessId -eq 359) (
        @($pm9.ForeignComfy) | ConvertTo-Json -Compress)

    Reset-Sim
    Add-Foreign -Id 333 -Port $uiPort
    $p2 = Get-ManagedProcesses
    Check '其他 Python 程序占用 7860 時列為外來，不當成 server' (
        @($p2.Servers).Count -eq 0 -and @($p2.ForeignUi).Count -eq 1 -and @($p2.ForeignUi)[0].ProcessId -eq 333) (
        @($p2.ForeignUi) | ConvertTo-Json -Compress)

    Reset-Sim
    $script:Sim.UiOwner = 444; $script:Sim.UiPortUp = $true
    $p3 = Get-ManagedProcesses
    Check 'Port 有監聽但查不到程序資訊時，仍回報外來占用' (@($p3.ForeignUi).Count -eq 1 -and @($p3.ForeignUi)[0].ProcessId -eq 444)

    Write-Output '[B] Stop-Ui'
    Reset-Sim
    $s1 = Stop-Ui
    Check '服務已停止時回 already 且 Ok' ($s1.Ok -and $s1.Result -eq 'already' -and $s1.Message -match '已經停止') ($s1 | ConvertTo-Json -Compress)

    Reset-Sim
    $oldUi = Add-Server -Id 501
    $oldComfy = Add-Comfy -Id 502
    $s2 = Stop-Ui
    Check '正常停止兩個服務並確認 Port 釋放' (
        $s2.Ok -and $s2.Result -eq 'stopped' -and -not $script:Sim.UiPortUp -and -not $script:Sim.ComfyPortUp) (
        $s2 | ConvertTo-Json -Compress)
    Check '只終止已辨識的 PID' (($script:Sim.Stopped -join ',') -eq '501,502') ($script:Sim.Stopped -join ',')

    Reset-Sim
    Add-Foreign -Id 601 -Port $uiPort
    $s3 = Stop-Ui
    Check '外來程序占用 Port 時不回報成功、不終止對方' (
        -not $s3.Ok -and $s3.Result -eq 'foreign_port' -and $script:Sim.Stopped.Count -eq 0 -and
        $s3.Message -match '7860' -and $s3.Message -match '601') ($s3 | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 602 -Exe 'C:\Other\python.exe' -CommandLine '"C:\Other\python.exe" C:\Other\ComfyUI\main.py'
    $s6 = Stop-Ui
    Check '外來 ComfyUI 占用 8188 時不終止對方、不回報成功' (
        -not $s6.Ok -and $s6.Result -eq 'foreign_port' -and $script:Sim.Stopped.Count -eq 0 -and
        $s6.Message -match '8188' -and $s6.Message -match '602') ($s6 | ConvertTo-Json -Compress)

    Reset-Sim
    Add-Server -Id 701
    $script:Sim.StopMode = 'fail'
    $s4 = Stop-Ui
    Check '終止例外時回報 failed' (-not $s4.Ok -and $s4.Result -eq 'failed' -and $s4.Message -match '停止失敗') ($s4 | ConvertTo-Json -Compress)
    $script:Sim.StopMode = 'normal'

    Reset-Sim
    Add-Server -Id 801
    $script:Sim.StopMode = 'noop'
    $s5 = Stop-Ui
    Check '程序未消失且 Port 仍監聽時回報 timeout' (-not $s5.Ok -and $s5.Result -eq 'timeout' -and $s5.Message -match '逾時') ($s5 | ConvertTo-Json -Compress)
    $script:Sim.StopMode = 'normal'

    Write-Output '[C] Start-Ui'
    Reset-Sim
    Add-Server -Id 901
    Add-Comfy -Id 902
    $t1 = Start-Ui
    Check '服務已存在時不重複啟動' ($t1.Ok -and $script:Sim.Started.Count -eq 0) (
        $t1 | ConvertTo-Json -Compress)

    Reset-Sim
    $t2 = Start-Ui
    Check '未啟動時啟動 ComfyUI 與 server.py 並驗證 Port / 程序' (
        $t2.Ok -and $t2.Result -eq 'started' -and $script:Sim.Started.Count -eq 2 -and
        @((Get-ManagedProcesses).Servers).Count -eq 1 -and @((Get-ManagedProcesses).Comfys).Count -eq 1) (
        $t2 | ConvertTo-Json -Compress)

    Reset-Sim
    Add-Foreign -Id 931 -Port $comfyPort
    $t3 = Start-Ui
    Check 'Port 被其他程序占用時不啟動' (
        -not $t3.Ok -and $t3.Result -eq 'foreign_port' -and $script:Sim.Started.Count -eq 0) (
        $t3 | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ForeignComfy -Id 932 -Exe 'C:\Other\python.exe' -CommandLine '"C:\Other\python.exe" C:\Other\ComfyUI\main.py'
    $t5 = Start-Ui
    Check 'Start 遇到外來 ComfyUI 占用 8188 時不啟動本專案 ComfyUI' (
        -not $t5.Ok -and $t5.Result -eq 'foreign_port' -and $script:Sim.Started.Count -eq 0) (
        $t5 | ConvertTo-Json -Compress)

    Write-Output '[C2] 程序已存在但 Port 尚未監聽'
    Reset-Sim
    Add-ServerNoPort -Id 941
    $t6 = Start-Ui
    $serverStarts = @($script:Sim.Started | Where-Object { $_ -match 'server\.py' }).Count
    Check 'server.py 程序已存在但 7860 未監聽時，不啟動第二份 server.py' (
        $serverStarts -eq 0 -and -not $t6.Ok -and $t6.Message -match '程序已存在') ($t6 | ConvertTo-Json -Compress)

    Reset-Sim
    Add-ServerNoPort -Id 951
    $script:Sim.UiPortBindAt = 3
    $script:Sim.PendingUiOwner = 951
    $t7 = Start-Ui
    $serverStarts2 = @($script:Sim.Started | Where-Object { $_ -match 'server\.py' }).Count
    Check '等待期間 7860 開始監聽：不啟動第二份且回報成功' (
        $serverStarts2 -eq 0 -and $t7.Ok -and $script:Sim.UiPortUp) ($t7 | ConvertTo-Json -Compress)

    Reset-Sim
    $script:Sim.StartFails = $true
    $t4 = Start-Ui
    Check '啟動例外時回報 failed 而非成功' (-not $t4.Ok -and $t4.Result -eq 'failed' -and $t4.Message -match '啟動時發生問題') (
        $t4 | ConvertTo-Json -Compress)
    $script:Sim.StartFails = $false

    Write-Output '[D] Restart-Ui'
    Reset-Sim
    Add-Server -Id 1001
    Add-Comfy -Id 1002
    $script:Sim.StopMode = 'fail'
    $r1 = Restart-Ui
    Check '停止失敗時 Restart 立即中止，不啟動新程序' (
        -not $r1.Ok -and $r1.Result -eq 'stop_failed' -and $script:Sim.Started.Count -eq 0) (
        $r1 | ConvertTo-Json -Compress)
    $script:Sim.StopMode = 'normal'

    Reset-Sim
    Add-Server -Id 1101
    Add-Comfy -Id 1102
    $r2 = Restart-Ui
    $newP = Get-ManagedProcesses
    $newUi = @($newP.Servers)[0].ProcessId
    $newComfy = @($newP.Comfys)[0].ProcessId
    Check 'Restart 成功且使用新程序與新 Port' (
        $r2.Ok -and $r2.Result -eq 'restarted' -and $newUi -ne 1101 -and $newComfy -ne 1102 -and
        $script:Sim.UiPortUp -and $script:Sim.ComfyPortUp) ($r2 | ConvertTo-Json -Compress)

    Write-Output '[E] 直接執行動作的 JSON 欄位'
    Reset-Sim
    $json = (& $copy -Action status | ConvertFrom-Json)
    Check 'status JSON 保留既有欄位並新增 ForeignText' (
        $null -ne $json.Comfy -and $null -ne $json.UI -and
        $null -ne $json.ServerCount -and $null -ne $json.ComfyCount -and
        $null -ne $json.ForeignText) ($json | ConvertTo-Json -Compress)
}
finally {
    if (Test-Path -LiteralPath $base) { Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Output "`n結果：$pass PASS / $fail FAIL"
    if ($fail -gt 0) { exit 1 }
}
