; NSIS 自定义安装/卸载钩子（由 package.json 的 build.nsis.include 引入）
;
; 背景：本应用关闭主窗口只是隐藏到托盘、进程不退出。若升级安装时旧进程仍在运行，
; 新安装的启动会被单实例锁挡掉（用户看到的还是旧版本界面），且 app.asar 被占用时
; 可能替换失败。这里在安装/卸载前强制结束旧进程。

!macro customInstall
  DetailPrint "Closing running Aether Todo ..."
  ExecWait 'taskkill /F /IM "Aether Todo.exe" /T'
  Sleep 1200
!macroend

!macro customUnInstall
  DetailPrint "Closing running Aether Todo ..."
  ExecWait 'taskkill /F /IM "Aether Todo.exe" /T'
  Sleep 1200
!macroend
