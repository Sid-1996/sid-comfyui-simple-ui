# ui_panel.ps1 — 生圖控制台（WinForms 小視窗）
# 用按鈕操作 ComfyUI 與生圖介面的開始/關閉/重新啟動。
# 按 X 只關掉本視窗，不會停止服務。
param([switch]$HideConsole)

# 桌面捷徑會帶 -HideConsole：讓 PowerShell 正常啟動（否則 SW_HIDE 會讓
# WinForms 表單也無法出現），再由此處把自己的命令視窗藏掉。
if ($HideConsole) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ConsoleHider {
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@
    [void][ConsoleHider]::ShowWindow([ConsoleHider]::GetConsoleWindow(), 0)
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

. "$PSScriptRoot\ui_control.ps1"

$form = New-Object System.Windows.Forms.Form
$form.Text = '生圖控制台'
$form.Width = 420
$form.Height = 322
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('微軟正黑體', 10)
$form.BackColor = [System.Drawing.Color]::FromArgb(30, 24, 44)
$form.ForeColor = [System.Drawing.Color]::White

$green = [System.Drawing.Color]::FromArgb(80, 210, 120)
$red   = [System.Drawing.Color]::FromArgb(230, 90, 90)

# ---------- 狀態區 ----------
$grp = New-Object System.Windows.Forms.GroupBox
$grp.Text = '服務狀態'
$grp.Left = 16; $grp.Top = 14; $grp.Width = 372; $grp.Height = 82
$grp.ForeColor = [System.Drawing.Color]::FromArgb(200, 190, 220)
$form.Controls.Add($grp)

$dotComfy = New-Object System.Windows.Forms.Panel
$dotComfy.Left = 18; $dotComfy.Top = 34; $dotComfy.Width = 14; $dotComfy.Height = 14
$dotComfy.BackColor = [System.Drawing.Color]::Gray
$grp.Controls.Add($dotComfy)

$lblComfy = New-Object System.Windows.Forms.Label
$lblComfy.Left = 40; $lblComfy.Top = 32; $lblComfy.Width = 320; $lblComfy.Height = 20
$lblComfy.ForeColor = [System.Drawing.Color]::White
$grp.Controls.Add($lblComfy)

$dotUi = New-Object System.Windows.Forms.Panel
$dotUi.Left = 18; $dotUi.Top = 58; $dotUi.Width = 14; $dotUi.Height = 14
$dotUi.BackColor = [System.Drawing.Color]::Gray
$grp.Controls.Add($dotUi)

$lblUi = New-Object System.Windows.Forms.Label
$lblUi.Left = 40; $lblUi.Top = 56; $lblUi.Width = 320; $lblUi.Height = 20
$lblUi.ForeColor = [System.Drawing.Color]::White
$grp.Controls.Add($lblUi)

# ---------- 按鈕 ----------
function New-Btn($text, $left, $top) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $text
    $b.Left = $left; $b.Top = $top; $b.Width = 116; $b.Height = 38
    $b.FlatStyle = 'Flat'
    $b.BackColor = [System.Drawing.Color]::FromArgb(92, 64, 140)
    $b.ForeColor = [System.Drawing.Color]::White
    $b.FlatAppearance.BorderSize = 0
    return $b
}

$btnStart   = New-Btn '▶ 開始生圖' 16 108
$btnStop    = New-Btn '■ 關閉生圖' 152 108
$btnRestart = New-Btn '↻ 重新啟動' 288 108
$btnOpen    = New-Btn '開啟介面'   16 154
$btnRefresh = New-Btn '重新整理狀態' 152 154

$allButtons = @($btnStart, $btnStop, $btnRestart, $btnOpen, $btnRefresh)
foreach ($b in $allButtons) { $form.Controls.Add($b) }

# ---------- 訊息區 ----------
$msg = New-Object System.Windows.Forms.TextBox
$msg.Multiline = $true
$msg.ReadOnly = $true
$msg.ScrollBars = 'Vertical'
$msg.Left = 16; $msg.Top = 204; $msg.Width = 372; $msg.Height = 72
$msg.BackColor = [System.Drawing.Color]::FromArgb(22, 18, 32)
$msg.ForeColor = [System.Drawing.Color]::FromArgb(170, 230, 170)
$msg.BorderStyle = 'FixedSingle'
$msg.Font = New-Object System.Drawing.Font('微軟正黑體', 9)
$form.Controls.Add($msg)

function Refresh-Status {
    try {
        $s = Get-UiStatus
        $dotComfy.BackColor = if ($s.Comfy) { $green } else { $red }
        $dotUi.BackColor    = if ($s.UI)    { $green } else { $red }
        $lblComfy.Text = "ComfyUI (8188)：" + $(if ($s.Comfy) { '運行中' } else { '未啟動' })
        $lblUi.Text    = "生圖介面 (7860)：" + $(if ($s.UI) { '運行中' } else { '未啟動' })
    } catch {
        $msg.Text = "讀取狀態失敗：$($_.Exception.Message)"
    }
}

function Invoke-Action($action) {
    foreach ($b in $allButtons) { $b.Enabled = $false }
    $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
    [System.Windows.Forms.Application]::DoEvents()

    $onTick = {
        param($text)
        $msg.Text = $text
        [System.Windows.Forms.Application]::DoEvents()
    }.GetNewClosure()

    function Set-ActionMessage {
        param([bool]$Ok, [string]$Text)
        $color = [System.Drawing.Color]::FromArgb(170, 230, 170)
        if (-not $Ok) { $color = $red; $Text = "操作失敗：$Text" }
        $msg.ForeColor = $color
        $msg.Text = $Text
    }

    try {
        switch ($action) {
            'start'   { $r = Start-Ui   -OnTick $onTick; Set-ActionMessage $r.Ok $r.Message }
            'stop'    { $r = Stop-Ui    -OnTick $onTick; Set-ActionMessage $r.Ok $r.Message }
            'restart' { $r = Restart-Ui -OnTick $onTick; Set-ActionMessage $r.Ok $r.Message }
            'open' {
                Start-Process 'http://127.0.0.1:7860'
                Set-ActionMessage $true '已開啟生圖介面（請到瀏覽器操作）。'
            }
            'refresh' {
                Refresh-Status
                Set-ActionMessage $true '狀態已更新。'
            }
        }
    } catch {
        Set-ActionMessage $false $_.Exception.Message
    } finally {
        Refresh-Status
        foreach ($b in $allButtons) { $b.Enabled = $true }
        $form.Cursor = [System.Windows.Forms.Cursors]::Default
    }
}

$btnStart.Add_Click({ Invoke-Action 'start' })
$btnStop.Add_Click({ Invoke-Action 'stop' })
$btnRestart.Add_Click({ Invoke-Action 'restart' })
$btnOpen.Add_Click({ Invoke-Action 'open' })
$btnRefresh.Add_Click({ Invoke-Action 'refresh' })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({ Refresh-Status })

# 視窗顯示前先查好狀態、填滿所有控制項，避免看到畫到一半的半成品。
# 一開始設為透明，等 Shown（第一次繪製完成）再一次顯示。
Refresh-Status
$form.Opacity = 0

$form.Add_Shown({
    [System.Windows.Forms.Application]::DoEvents()
    $form.Opacity = 1
    $timer.Start()
})
$form.Add_FormClosed({ $timer.Stop() })

[System.Windows.Forms.Application]::Run($form)
