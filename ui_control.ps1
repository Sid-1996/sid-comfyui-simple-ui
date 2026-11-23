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

# 完整路徑比對，找出本專案的 process。
# 絕對不要用 taskkill /IM python.exe /F —— 那會把 ComfyUI 一起殺掉。
function Get-ManagedProcesses {
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $pys = @($all | Where-Object {
        $_.Name -match '^python(w)?\.exe$' -and $_.CommandLine
    })
    $servers = @($pys | Where-Object {
        $_.CommandLine.IndexOf($script:ServerScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    $comfys = @($pys | Where-Object {
        $_.CommandLine.IndexOf('ComfyUI\main.py', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $_.CommandLine.IndexOf('ComfyUI/main.py',  [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    [pscustomobject]@{ Servers = $servers; Comfys = $comfys }
}

function Test-PortUp {
    param([int]$Port)
    [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Invoke-Tick {
    param([scriptblock]$OnTick, [string]$Text)
    if ($OnTick) { & $OnTick $Text }
}

function Stop-Ui {
    param([scriptblock]$OnTick)

    $r = [pscustomobject]@{ Ok = $false; KilledServers = 0; KilledComfys = 0; Message = '' }
    try {
        $procs = Get-ManagedProcesses
        $targets = @($procs.Servers) + @($procs.Comfys)
        $r.KilledServers = @($procs.Servers).Count
        $r.KilledComfys  = @($procs.Comfys).Count

        foreach ($p in $targets) {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }

        # 等 process 真的消失（WD14 Worker 會跟著 stdin 關閉自行退出，不在此處理）
        $remain = -1
        for ($i = 0; $i -lt 20; $i++) {
            Invoke-Tick $OnTick "正在關閉… ($($i + 1)/20)"
            $now = Get-ManagedProcesses
            $remain = @($now.Servers).Count + @($now.Comfys).Count
            if ($remain -eq 0) { break }
            Start-Sleep -Milliseconds 500
        }

        if ($remain -eq 0) {
            $r.Ok = $true
            $r.Message = '已關閉：ComfyUI 與生圖介面都已停止，可以安全關機。'
        } else {
            $r.Message = "還有 $remain 個程式沒結束，請再按一次「關閉生圖」。"
        }
    } catch {
        $r.Message = "關閉時發生問題：$($_.Exception.Message)"
    }
    return $r
}

function Start-Ui {
    param([scriptblock]$OnTick)

    $r = [pscustomobject]@{ Ok = $false; Cleaned = 0; Wd14 = ''; Message = '' }
    try {
        New-Item -ItemType Directory -Path $script:Logs -Force | Out-Null

        # 1) 清掉重複的 server.py（多於一個才處理，避免舊實例接手請求）
        $procs = Get-ManagedProcesses
        if (@($procs.Servers).Count -gt 1) {
            Invoke-Tick $OnTick '發現重複的舊介面程序，正在清理…'
            foreach ($p in $procs.Servers) {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            }
            $r.Cleaned = @($procs.Servers).Count
            for ($i = 0; $i -lt 10 -and (Test-PortUp 7860); $i++) {
                Start-Sleep -Milliseconds 500
            }
        }

        # 2) ComfyUI (8188)
        if (-not (Test-PortUp 8188)) {
            Invoke-Tick $OnTick '正在啟動 ComfyUI…'
            $comfyArgs = @('-s', 'ComfyUI\main.py', '--windows-standalone-build', '--output-directory', 'D:\ComfyUI_output')
            Start-Process -FilePath $script:Python -ArgumentList $comfyArgs -WorkingDirectory $script:ComfyRoot -WindowStyle Hidden -RedirectStandardOutput "$script:Logs\comfyui.log" -RedirectStandardError "$script:Logs\comfyui.err.log"
            for ($i = 0; $i -lt 90 -and -not (Test-PortUp 8188); $i++) {
                Start-Sleep 2
                Invoke-Tick $OnTick "正在啟動 ComfyUI… ($($i + 1)/90)"
            }
        }

        # 3) 生圖介面 server.py (7860)
        # 本機 WD14 只在「本次確實啟動新的 server.py」時才注入目前 Process 環境，
        # 讓子程序繼承；啟動後於 finally 還原，不污染其他程式或 PowerShell 工作階段。
        # 若 7860 已有既存 Server，不能對它宣稱已載入 WD14。
        $uiAlreadyUp = Test-PortUp 7860
        $willLaunchUi = -not $uiAlreadyUp
        $wd14Missing = @()
        if ($willLaunchUi) {
            $wd14Missing = @(Test-LocalWd14Ready)
            if ($wd14Missing.Count -eq 0) {
                $r.Wd14 = '本機 WD14 已設定（EVA02 與 ViT v3 皆可用）。'
            } else {
                # 沒有本機 WD14 也照樣啟動基本生圖，但必須明確告知，不可靜默略過。
                $r.Wd14 = "本機 WD14 資源不完整（缺 $($wd14Missing -join '、')），反推功能無法使用；基本生圖不受影響。若要啟用，請確認上述檔案存在。"
            }
        } else {
            # 既存 Server 不是本次啟動，沒有被注入；不可暗示反推已恢復。
            $r.Wd14 = '生圖介面已在運行；本次沒有重新啟動，因此無法確認目前介面是否已載入 WD14 設定。若反推無法使用，需在適當時機重新啟動生圖介面。'
        }
        $wd14Saved = $null
        try {
            if ($willLaunchUi) {
                if ($wd14Missing.Count -eq 0) { $wd14Saved = Set-LocalWd14Env }
                Invoke-Tick $OnTick '正在啟動生圖介面…'
                Start-Process -FilePath $script:Python -ArgumentList $script:ServerScript -WindowStyle Hidden -RedirectStandardOutput "$script:Logs\server.log" -RedirectStandardError "$script:Logs\server.err.log"
                for ($i = 0; $i -lt 15 -and -not (Test-PortUp 7860); $i++) {
                    Start-Sleep 1
                    Invoke-Tick $OnTick "正在啟動生圖介面… ($($i + 1)/15)"
                }
            }
        } finally {
            if ($wd14Saved) { Restore-LocalWd14Env -Saved $wd14Saved }
        }

        $comfyUp = Test-PortUp 8188
        $uiUp    = Test-PortUp 7860
        if ($comfyUp -and $uiUp) {
            $extra = if ($r.Cleaned -gt 0) { "（已清除 $($r.Cleaned) 個重複的舊介面程序）" } else { '' }
            $r.Ok = $true
            $r.Message = "已啟動：ComfyUI 與生圖介面都在運行$extra，可以開始生圖了。 $($r.Wd14)"
        } else {
            $bad = @()
            if (-not $comfyUp) { $bad += 'ComfyUI' }
            if (-not $uiUp)    { $bad += '生圖介面' }
            $r.Message = "$($bad -join '、') 啟動失敗，請查看 C:\ComfyUI\logs 裡的錯誤訊息。 $($r.Wd14)"
        }
    } catch {
        $r.Message = "啟動時發生問題：$($_.Exception.Message) $($r.Wd14)"
    }
    return $r
}

function Restart-Ui {
    param([scriptblock]$OnTick)
    $s = Stop-Ui -OnTick $OnTick
    Start-Sleep -Milliseconds 500
    $t = Start-Ui -OnTick $OnTick
    [pscustomobject]@{
        Ok      = ($s.Ok -and $t.Ok)
        Message = "重新啟動：$($t.Message)"
    }
}

function Get-UiStatus {
    $p = Get-ManagedProcesses
    [pscustomobject]@{
        Comfy       = Test-PortUp 8188
        UI          = Test-PortUp 7860
        ServerCount = @($p.Servers).Count
        ComfyCount  = @($p.Comfys).Count
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
