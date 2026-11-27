# ui_control.ps1
# 生圖控制台共用核心。
# - 被 ui_panel.ps1 以 dot-source 引入（此時不會執行底部的 dispatched 區塊）
# - 也可被 .bat 以 -Action start/stop/restart/status 直接執行，輸出 JSON

param(
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

$script:Python       = 'C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe'
$script:ComfyRoot    = 'C:\ComfyUI\ComfyUI_windows_portable'
$script:ServerScript = 'C:\ComfyUI\simple_ui\server.py'
$script:Logs         = 'C:\ComfyUI\logs'
$script:UiPort       = 7860
$script:ComfyPort    = 8188

# 本機 WD14 資源只存在於這台開發電腦；絕對路徑刻意只放在本機啟動器，
# 不寫入公開版 server.py。公開使用者不會使用這個啟動器，也不會受影響。
$script:LocalWd14 = [ordered]@{
    WD14_PY         = 'C:\ComfyUI\tools\wd14-venv\Scripts\python.exe'
    WD14_WORKER     = 'C:\ComfyUI\tools\wd14_worker.py'
    WD14_VIT_PY     = 'C:\ComfyUI\tools\wd14-vit-eval\venv\Scripts\python.exe'
    WD14_VIT_WORKER = 'C:\ComfyUI\tools\wd14_vit_worker.py'
}

# 回傳缺少的項目（含完整路徑）；空陣列代表本機 WD14 完整可用。
function Test-LocalWd14Ready {
    $missing = @()
    foreach ($name in $script:LocalWd14.Keys) {
        $path = $script:LocalWd14[$name]
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            $missing += "$name ($path)"
        }
    }
    return $missing
}

# 暫時寫入目前 Process 環境，讓緊接著 Start-Process 的 server.py 子程序繼承。
# 回傳快照給 Restore-LocalWd14Env 在 finally 還原（不設使用者／系統層級變數）。
function Set-LocalWd14Env {
    $saved = @()
    foreach ($name in $script:LocalWd14.Keys) {
        $old = [System.Environment]::GetEnvironmentVariable($name, 'Process')
        $saved += [pscustomobject]@{
            Name   = $name
            Value  = $old
            WasSet = ($null -ne $old)
        }
        [System.Environment]::SetEnvironmentVariable($name, $script:LocalWd14[$name], 'Process')
    }
    return $saved
}

# 還原成啟動前的狀態；本來不存在的變數要移除，不能留下空字串。
function Restore-LocalWd14Env {
    param([object[]]$Saved)
    foreach ($s in $Saved) {
        if ($null -eq $s) { continue }
        if ($s.WasSet) {
            [System.Environment]::SetEnvironmentVariable($s.Name, $s.Value, 'Process')
        } else {
            # 設成空字串不等於「未設定」：要真正移除，子程序才不會看到空值
            Remove-Item -LiteralPath ("Env:" + $s.Name) -ErrorAction SilentlyContinue
        }
    }
}

# ── 程序識別 ───────────────────────────────────────────────
# 絕對不要用 taskkill /IM python.exe /F —— 那會把 ComfyUI 或其他 Python 一起殺掉。
# 識別同時使用「Port 的 Listener PID」與「PID 的命令列／執行檔」，避免只靠模糊字串。
# 下列三個函式刻意保持單純，方便隔離測試覆寫。

function Get-PortOwnerPid {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
    return 0
}

function Get-ProcessInfoById {
    param([int]$Id)
    if ($Id -le 0) { return $null }
    return Get-CimInstance Win32_Process -Filter "ProcessId = $Id" -ErrorAction SilentlyContinue
}

function Get-AllPythonProcesses {
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -match '^python(w)?\.exe$' -and $_.CommandLine
    })
}

function Test-IsManagedServer {
    param($Proc)
    if (-not $Proc -or $Proc.Name -notmatch '^python(w)?\.exe$') { return $false }

    # 只檢查 Python 真正的 script entry，不可因為其他程式把 server.py 當參數就誤認。
    $tokens = @(Get-CommandLineTokens -CommandLine ([string]$Proc.CommandLine))
    if ($tokens.Count -lt 2) { return $false }
    $noValueFlags  = @('-s', '-S', '-u', '-b', '-B', '-d', '-E', '-i', '-O', '-OO', '-q', '-v')
    $valueFlags    = @('-W', '-X')
    $terminalFlags = @('-c', '-m', '-h', '-?', '-V', '--help', '--version')
    $scriptToken = $null
    for ($i = 1; $i -lt $tokens.Count; $i++) {
        $t = $tokens[$i]
        if ($t.StartsWith('-')) {
            if ($terminalFlags -contains $t) { return $false }
            if ($noValueFlags -contains $t) { continue }
            if ($valueFlags -contains $t) {
                if (($i + 1) -ge $tokens.Count) { return $false }
                $val = $tokens[$i + 1]
                if ($val.StartsWith('-') -or [string]::IsNullOrWhiteSpace($val)) { return $false }
                $i++
                continue
            }
            return $false
        }
        $scriptToken = $t
        break
    }
    if (-not $scriptToken -or $scriptToken -notmatch '(?i)\.py$') { return $false }

    # 必須是本專案 server.py 的絕對入口；相對 server.py 無法從 WMI 證明 CWD，
    # 因此保守視為 Foreign，避免誤終止同一 embedded Python 執行的其他服務。
    if (-not [IO.Path]::IsPathRooted($scriptToken)) { return $false }
    try {
        $actual = [IO.Path]::GetFullPath($scriptToken)
        $expected = [IO.Path]::GetFullPath($script:ServerScript)
        return $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

# 把 Windows 命令列拆成 token：引號內的空白不拆開，並去掉外層雙引號。
function Get-CommandLineTokens {
    param([string]$CommandLine)
    $tokens = @()
    if (-not $CommandLine) { return $tokens }
    foreach ($m in [regex]::Matches($CommandLine, '"([^"]*)"|(\S+)')) {
        $t = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
        if ($t) { $tokens += $t }
    }
    return $tokens
}

# 路徑邊界判斷：根目錄補上結尾分隔符號，避免 C:\Foo 被當成 C:\Foobar 的上層。
function Test-PathUnderRoot {
    param([string]$Path, [string]$Root)
    if (-not $Path -or -not $Root) { return $false }
    try {
        $fullRoot = [IO.Path]::GetFullPath($Root)
        if (-not $fullRoot.EndsWith([IO.Path]::DirectorySeparatorChar)) {
            $fullRoot += [IO.Path]::DirectorySeparatorChar
        }
        $fullPath = [IO.Path]::GetFullPath($Path)
        return $fullPath.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Test-IsManagedComfy {
    param($Proc)
    if (-not $Proc -or $Proc.Name -notmatch '^python(w)?\.exe$') { return $false }
    $cl = [string]$Proc.CommandLine
    $exe = [string]$Proc.ExecutablePath
    $embedded = $exe -and $exe.Equals($script:Python, [StringComparison]::OrdinalIgnoreCase)

    $tokens = @(Get-CommandLineTokens -CommandLine $cl)
    if ($tokens.Count -lt 2) { return $false }

    # 找出真正的 Python 腳本入口：只有獨立、非選項的 token 才算。
    # 關鍵：-c / -m / --help / --version 不是 script 模式，即使後面出現本專案
    # ComfyUI\main.py 也一律 Foreign（那些路徑只是參數，不是正在執行的腳本）。
    $noValueFlags  = @('-s', '-S', '-u', '-b', '-B', '-d', '-E', '-i', '-O', '-OO', '-q', '-v')
    $valueFlags    = @('-W', '-X')
    $terminalFlags = @('-c', '-m', '-h', '-?', '-V', '--help', '--version')
    $scriptToken = $null
    for ($i = 1; $i -lt $tokens.Count; $i++) {
        $t = $tokens[$i]
        if ($t.StartsWith('-')) {
            if ($terminalFlags -contains $t) { return $false }
            if ($noValueFlags -contains $t) { continue }
            if ($valueFlags -contains $t) {
                # -W / -X 必須有合理的值；缺值、空白或值又是選項都視為解析不明確
                if (($i + 1) -ge $tokens.Count) { return $false }
                $val = $tokens[$i + 1]
                if ($val.StartsWith('-') -or [string]::IsNullOrWhiteSpace($val)) { return $false }
                $i++
                continue
            }
            # 其他選項語義不明確（含 --opt=value），保守判為 Foreign
            return $false
        }
        $scriptToken = $t
        break
    }
    if (-not $scriptToken -or $scriptToken -notmatch '(?i)\.py$') { return $false }

    $expected = [IO.Path]::GetFullPath((Join-Path $script:ComfyRoot 'ComfyUI\main.py'))
    try {
        if ([IO.Path]::IsPathRooted($scriptToken)) {
            # 絕對入口：任何 Python 都可，但正規化後必須正好是本專案 ComfyRoot 底下那一個 main.py。
            $actual = [IO.Path]::GetFullPath($scriptToken)
            return (Test-PathUnderRoot -Path $actual -Root $script:ComfyRoot) -and
                   $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)
        }
        # 相對入口：必須是本專案 embedded Python（正式啟動器 "-s ComfyUI\main.py" 形式），
        # 且以本專案 ComfyRoot 為基準解析後仍落在 ComfyRoot 底下。
        if (-not $embedded) { return $false }
        $actual = [IO.Path]::GetFullPath((Join-Path $script:ComfyRoot $scriptToken))
        return (Test-PathUnderRoot -Path $actual -Root $script:ComfyRoot) -and
               $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function New-ForeignInfo {
    param($Proc, [int]$Port, [int]$FallbackPid = 0)
    $pidValue = $FallbackPid; $nameValue = '(不明)'; $pathValue = ''; $cmdValue = ''
    if ($Proc) {
        $pidValue = [int]$Proc.ProcessId
        $nameValue = [string]$Proc.Name
        $pathValue = [string]$Proc.ExecutablePath
        $cmdValue = [string]$Proc.CommandLine
    }
    return [pscustomobject]@{
        Port        = $Port
        ProcessId   = $pidValue
        Name        = $nameValue
        Path        = $pathValue
        CommandLine = $cmdValue
    }
}

function Get-ManagedProcesses {
    $servers = @(); $comfys = @(); $foreignUi = @(); $foreignComfy = @()

    $uiOwner = Get-PortOwnerPid -Port $script:UiPort
    if ($uiOwner -gt 0) {
        $p = Get-ProcessInfoById -Id $uiOwner
        if (Test-IsManagedServer $p) { $servers += $p } else { $foreignUi += (New-ForeignInfo -Proc $p -Port $script:UiPort -FallbackPid $uiOwner) }
    }
    $comfyOwner = Get-PortOwnerPid -Port $script:ComfyPort
    if ($comfyOwner -gt 0) {
        $p = Get-ProcessInfoById -Id $comfyOwner
        if (Test-IsManagedComfy $p) { $comfys += $p } else { $foreignComfy += (New-ForeignInfo -Proc $p -Port $script:ComfyPort -FallbackPid $comfyOwner) }
    }

    # 補抓沒有監聽 Port 的重複實例（例如剛啟動還沒綁定的 server.py）
    foreach ($p in (Get-AllPythonProcesses)) {
        $pid2 = [int]$p.ProcessId
        if (($servers | Where-Object { $_.ProcessId -eq $pid2 }) -or
            ($comfys  | Where-Object { $_.ProcessId -eq $pid2 })) { continue }
        if (Test-IsManagedServer $p) { $servers += $p }
        elseif (Test-IsManagedComfy $p) { $comfys += $p }
    }

    [pscustomobject]@{
        Servers     = @($servers)
        Comfys      = @($comfys)
        ForeignUi   = @($foreignUi)
        ForeignComfy = @($foreignComfy)
        UiPortUp    = (Test-PortUp -Port $script:UiPort)
        ComfyPortUp = (Test-PortUp -Port $script:ComfyPort)
    }
}

function Test-PortUp {
    param([int]$Port)
    [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Invoke-Tick {
    param([scriptblock]$OnTick, [string]$Text)
    if ($OnTick) { & $OnTick $Text }
}

function Get-ForeignText {
    param($Items, [int]$Port)
    $parts = @($Items | ForEach-Object {
        "PID $($_.ProcessId)（$($_.Name)，路徑：$($_.Path)）"
    })
    if (-not $parts.Count) { return '' }
    return "連接埠 $Port 被非本專案程式占用：$($parts -join '、')。為了安全不會終止它。"
}

function Stop-Ui {
    param([scriptblock]$OnTick)

    $r = [pscustomobject]@{ Ok = $false; Result = ''; KilledServers = 0; KilledComfys = 0; Message = '' }
    try {
        $procs = Get-ManagedProcesses
        $foreign = @()
        $foreign += @($procs.ForeignUi)
        $foreign += @($procs.ForeignComfy)
        if ($foreign.Count -gt 0) {
            $r.Result = 'foreign_port'
            $r.Message = ((Get-ForeignText -Items @($procs.ForeignUi) -Port $script:UiPort) + ' ' +
                          (Get-ForeignText -Items @($procs.ForeignComfy) -Port $script:ComfyPort)).Trim()
            return $r
        }

        $targets = @($procs.Servers) + @($procs.Comfys)
        $r.KilledServers = @($procs.Servers).Count
        $r.KilledComfys  = @($procs.Comfys).Count

        $killFailed = @()
        foreach ($p in $targets) {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
            } catch {
                $killFailed += "PID $($p.ProcessId)（$($p.Name)）"
            }
        }
        if ($killFailed.Count -gt 0) {
            $r.Result = 'failed'
            $r.Message = "停止失敗：無法終止 $($killFailed -join '、')，請手動確認。"
            return $r
        }

        # 同時確認程序消失與 Port 真正釋放；WD14 Worker 會隨 stdin 關閉自行退出。
        $remain = -1; $uiUp = $true; $comfyUp = $true; $now = $null
        for ($i = 0; $i -lt 20; $i++) {
            Invoke-Tick $OnTick "正在關閉… ($($i + 1)/20)"
            Start-Sleep -Milliseconds 500
            $now = Get-ManagedProcesses
            $remain = @($now.Servers).Count + @($now.Comfys).Count
            $uiUp = Test-PortUp -Port $script:UiPort
            $comfyUp = Test-PortUp -Port $script:ComfyPort
            if ($remain -eq 0 -and -not $uiUp -and -not $comfyUp) { break }
        }

        $newForeign = @($now.ForeignUi) + @($now.ForeignComfy)
        if ($newForeign.Count -gt 0) {
            $r.Result = 'foreign_port'
            $r.Message = ((Get-ForeignText -Items @($now.ForeignUi) -Port $script:UiPort) + ' ' +
                          (Get-ForeignText -Items @($now.ForeignComfy) -Port $script:ComfyPort)).Trim()
            return $r
        }
        if ($remain -gt 0) {
            $r.Result = 'timeout'
            $r.Message = "停止逾時：還有 $remain 個本專案程式沒有結束，請再按一次「關閉生圖」。"
            return $r
        }
        if ($uiUp -or $comfyUp) {
            $r.Result = 'timeout'
            $ports = @()
            if ($uiUp) { $ports += "7860" }
            if ($comfyUp) { $ports += "8188" }
            $r.Message = "停止逾時：連接埠 $($ports -join '、') 仍在監聽，請確認後再試一次。"
            return $r
        }

        $r.Ok = $true
        if ($targets.Count -eq 0) {
            $r.Result = 'already'
            $r.Message = '已經停止：ComfyUI 與生圖介面原本就沒有運行。'
        } else {
            $r.Result = 'stopped'
            $r.Message = '已關閉：ComfyUI 與生圖介面都已停止，可以安全關機。'
        }
    } catch {
        $r.Result = 'failed'
        $r.Message = "關閉時發生問題：$($_.Exception.Message)"
    }
    return $r
}

function Start-Ui {
    param([scriptblock]$OnTick)

    $r = [pscustomobject]@{ Ok = $false; Result = ''; Cleaned = 0; Wd14 = ''; Message = '' }
    try {
        New-Item -ItemType Directory -Path $script:Logs -Force | Out-Null

        $procs = Get-ManagedProcesses
        $foreignUi = @($procs.ForeignUi); $foreignComfy = @($procs.ForeignComfy)
        if ($foreignUi.Count -gt 0 -or $foreignComfy.Count -gt 0) {
            $r.Result = 'foreign_port'
            $r.Message = ((Get-ForeignText -Items $foreignUi -Port $script:UiPort) + ' ' +
                          (Get-ForeignText -Items $foreignComfy -Port $script:ComfyPort)).Trim()
            return $r
        }

        # 1) 清掉重複的 server.py（多於一個才處理，避免舊實例接手請求）
        if (@($procs.Servers).Count -gt 1) {
            Invoke-Tick $OnTick '發現重複的舊介面程序，正在清理…'
            foreach ($p in $procs.Servers) {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            }
            $r.Cleaned = @($procs.Servers).Count
            for ($i = 0; $i -lt 10 -and (Test-PortUp -Port $script:UiPort); $i++) {
                Start-Sleep -Milliseconds 500
            }
            $procs = Get-ManagedProcesses
            if (@($procs.ForeignUi).Count -gt 0 -or @($procs.ForeignComfy).Count -gt 0) {
                $r.Result = 'foreign_port'
                $r.Message = ((Get-ForeignText -Items @($procs.ForeignUi) -Port $script:UiPort) + ' ' +
                              (Get-ForeignText -Items @($procs.ForeignComfy) -Port $script:ComfyPort)).Trim()
                return $r
            }
        }

        # 程序掃描發現的本專案程序：即使 Port 還沒監聽也不能當作「沒有程序」。
        # 這三種狀態必須分開：已在監聽 / 程序還在綁定 Port / 確定沒有程序。
        $existingServers = @($procs.Servers)
        $existingComfys  = @($procs.Comfys)
        $hasServerProc   = $existingServers.Count -gt 0
        $hasComfyProc    = $existingComfys.Count -gt 0

        # 2) ComfyUI
        $launchedComfy = $false
        $comfyPortNow = Test-PortUp -Port $script:ComfyPort
        if (-not $comfyPortNow -and -not $hasComfyProc) {
            Invoke-Tick $OnTick '正在啟動 ComfyUI…'
            $comfyArgs = @('-s', 'ComfyUI\main.py', '--windows-standalone-build', '--output-directory', 'D:\ComfyUI_output')
            Start-Process -FilePath $script:Python -ArgumentList $comfyArgs -WorkingDirectory $script:ComfyRoot -WindowStyle Hidden -RedirectStandardOutput "$script:Logs\comfyui.log" -RedirectStandardError "$script:Logs\comfyui.err.log"
            $launchedComfy = $true
            for ($i = 0; $i -lt 90 -and -not (Test-PortUp -Port $script:ComfyPort); $i++) {
                Start-Sleep 2
                Invoke-Tick $OnTick "正在啟動 ComfyUI… ($($i + 1)/90)"
            }
        } elseif (-not $comfyPortNow -and $hasComfyProc) {
            # 程序已存在但 8188 尚未監聽：可能正在啟動或已卡住，不啟動第二份。
            Invoke-Tick $OnTick 'ComfyUI 程序已存在，正在等待連接埠 8188 就緒…'
            for ($i = 0; $i -lt 90 -and -not (Test-PortUp -Port $script:ComfyPort); $i++) {
                Start-Sleep 2
                Invoke-Tick $OnTick "等待 ComfyUI 綁定連接埠… ($($i + 1)/90)"
            }
        }

        # 3) 生圖介面 server.py
        # 本機 WD14 只在「本次確實啟動新的 server.py」時才注入目前 Process 環境；
        # 啟動後於 finally 還原，不污染其他程式或 PowerShell 工作階段。
        $uiAlreadyUp    = Test-PortUp -Port $script:UiPort
        $willLaunchUi   = (-not $uiAlreadyUp) -and (-not $hasServerProc)
        $waitingUiProc  = (-not $uiAlreadyUp) -and $hasServerProc
        $wd14Missing = @()
        if ($willLaunchUi) {
            $wd14Missing = @(Test-LocalWd14Ready)
            if ($wd14Missing.Count -eq 0) {
                $r.Wd14 = '本機 WD14 已設定（EVA02 與 ViT v3 皆可用）。'
            } else {
                $r.Wd14 = "本機 WD14 資源不完整（缺 $($wd14Missing -join '、')），反推功能無法使用；基本生圖不受影響。若要啟用，請確認上述檔案存在。"
            }
        } elseif ($waitingUiProc) {
            $r.Wd14 = '已找到生圖介面程序，但連接埠尚未監聽；先等待它綁定連接埠，本次沒有重新啟動。'
        } else {
            $r.Wd14 = '生圖介面已在運行；本次沒有重新啟動，因此無法確認目前介面是否已載入 WD14 設定。若反推無法使用，需在適當時機重新啟動生圖介面。'
        }
        $wd14Saved = $null
        try {
            if ($willLaunchUi) {
                if ($wd14Missing.Count -eq 0) { $wd14Saved = Set-LocalWd14Env }
                Invoke-Tick $OnTick '正在啟動生圖介面…'
                Start-Process -FilePath $script:Python -ArgumentList $script:ServerScript -WindowStyle Hidden -RedirectStandardOutput "$script:Logs\server.log" -RedirectStandardError "$script:Logs\server.err.log"
                for ($i = 0; $i -lt 15 -and -not (Test-PortUp -Port $script:UiPort); $i++) {
                    Start-Sleep 1
                    Invoke-Tick $OnTick "正在啟動生圖介面… ($($i + 1)/15)"
                }
            } elseif ($waitingUiProc) {
                # 已存在的程序可能還在啟動，也可能卡住；只等待，不啟動第二份 server.py。
                Invoke-Tick $OnTick '生圖介面程序已存在，正在等待連接埠 7860 就緒…'
                for ($i = 0; $i -lt 15 -and -not (Test-PortUp -Port $script:UiPort); $i++) {
                    Start-Sleep 1
                    Invoke-Tick $OnTick "等待生圖介面綁定連接埠… ($($i + 1)/15)"
                }
            }
        } finally {
            if ($wd14Saved) { Restore-LocalWd14Env -Saved $wd14Saved }
        }

        # 4) 驗證：Port 與程序身分都要正確（只驗證本次確實啟動過的服務）
        $final = Get-ManagedProcesses
        if (@($final.ForeignUi).Count -gt 0 -or @($final.ForeignComfy).Count -gt 0) {
            $r.Result = 'foreign_port'
            $r.Message = ((Get-ForeignText -Items @($final.ForeignUi) -Port $script:UiPort) + ' ' +
                          (Get-ForeignText -Items @($final.ForeignComfy) -Port $script:ComfyPort)).Trim()
            return $r
        }
        $comfyUp = Test-PortUp -Port $script:ComfyPort
        $uiUp    = Test-PortUp -Port $script:UiPort
        $bad = @()
        if (-not $comfyUp) {
            if ($hasComfyProc) { $bad += 'ComfyUI（程序已存在但連接埠尚未監聽，可能仍在啟動或已卡住，請查看 C:\ComfyUI\logs）' }
            else { $bad += 'ComfyUI' }
        }
        if (-not $uiUp) {
            if ($hasServerProc) { $bad += '生圖介面（程序已存在但連接埠尚未監聽，可能仍在啟動或已卡住，請查看 C:\ComfyUI\logs）' }
            else { $bad += '生圖介面' }
        }
        if ($launchedComfy -and $comfyUp -and @($final.Comfys).Count -eq 0) {
            $bad += 'ComfyUI（程序身分無法確認）'
        }
        if ($willLaunchUi -and $uiUp -and @($final.Servers).Count -eq 0) {
            $bad += '生圖介面（程序身分無法確認）'
        }
        if ($bad.Count -gt 0) {
            $r.Result = 'failed'
            $r.Message = "$($bad -join '、') 啟動失敗，請查看 C:\ComfyUI\logs 裡的錯誤訊息。 $($r.Wd14)"
            return $r
        }

        $extra = if ($r.Cleaned -gt 0) { "（已清除 $($r.Cleaned) 個重複的舊介面程序）" } else { '' }
        $r.Ok = $true
        $r.Result = 'started'
        $r.Message = "已啟動：ComfyUI 與生圖介面都在運行$extra，可以開始生圖了。 $($r.Wd14)"
    } catch {
        $r.Result = 'failed'
        $r.Message = "啟動時發生問題：$($_.Exception.Message) $($r.Wd14)"
    }
    return $r
}

function Restart-Ui {
    param([scriptblock]$OnTick)
    $s = Stop-Ui -OnTick $OnTick
    if (-not $s.Ok) {
        return [pscustomobject]@{
            Ok      = $false
            Result  = 'stop_failed'
            Message = "停止失敗，已中止重新啟動：$($s.Message)"
        }
    }
    Start-Sleep -Milliseconds 500
    $t = Start-Ui -OnTick $OnTick
    $result = if ($t.Ok) { 'restarted' } else { 'start_failed' }
    $message = if ($t.Ok) { "重新啟動：$($t.Message)" } else { "重新啟動失敗：$($t.Message)" }
    [pscustomobject]@{
        Ok      = [bool]($s.Ok -and $t.Ok)
        Result  = $result
        Message = $message
    }
}

function Get-UiStatus {
    $p = Get-ManagedProcesses
    [pscustomobject]@{
        Comfy        = Test-PortUp -Port $script:ComfyPort
        UI           = Test-PortUp -Port $script:UiPort
        ServerCount  = @($p.Servers).Count
        ComfyCount   = @($p.Comfys).Count
        ForeignText  = ((Get-ForeignText -Items @($p.ForeignUi) -Port $script:UiPort) + ' ' +
                        (Get-ForeignText -Items @($p.ForeignComfy) -Port $script:ComfyPort)).Trim()
    }
}

# 只有直接執行（-File）時才 dispatch；被 dot-source 時 $MyInvocation.InvocationName 是 '.'
if ($MyInvocation.InvocationName -ne '.') {
    switch ($Action) {
        'start'   { Start-Ui      | ConvertTo-Json -Compress }
        'stop'    { Stop-Ui       | ConvertTo-Json -Compress }
        'restart' { Restart-Ui    | ConvertTo-Json -Compress }
        'status'  { Get-UiStatus  | ConvertTo-Json -Compress }
    }
}
