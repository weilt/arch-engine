@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apt-status.ps1" %*
