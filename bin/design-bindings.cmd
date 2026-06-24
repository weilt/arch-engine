@echo off
setlocal
if not defined APT_HOME set "APT_HOME=%USERPROFILE%\.apt"
node "%APT_HOME%\arch-engine\dist\cli-design-bindings.js" %*
