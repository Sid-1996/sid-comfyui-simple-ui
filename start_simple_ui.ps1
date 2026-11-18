$root = 'C:\ComfyUI\ComfyUI_windows_portable'
$py = "$root\python_embeded\python.exe"
$logs = 'C:\ComfyUI\logs'; New-Item -ItemType Directory -Path $logs -Force | Out-Null
function Up($port){ [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
if(-not (Up 8188)){
  Start-Process -FilePath $py -ArgumentList '-s','ComfyUI\main.py','--windows-standalone-build','--output-directory','D:\ComfyUI_output' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$logs\comfyui.log" -RedirectStandardError "$logs\comfyui.err.log"
  for($i=0; $i -lt 90 -and -not (Up 8188); $i++){ Start-Sleep 2 }
}
if(-not (Up 7860)){
  Start-Process -FilePath $py -ArgumentList 'C:\ComfyUI\simple_ui\server.py' -WindowStyle Hidden
  for($i=0; $i -lt 15 -and -not (Up 7860); $i++){ Start-Sleep 1 }
}
Start-Process 'http://127.0.0.1:7860'