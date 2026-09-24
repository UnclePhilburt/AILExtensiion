@echo off
cd /d "%~dp0"
title IMPACT Phone Companion
echo Keep this window open while using your phone.
echo Open one of the Phone URLs below on your phone using the same Wi-Fi.
echo.
node phone-web/server.js
pause
