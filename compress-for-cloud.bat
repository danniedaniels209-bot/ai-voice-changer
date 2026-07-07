@echo off
REM Drag a video file onto this .bat to compress it for cloud upload
REM (~3 Mbps video, YouTube-grade quality, fits the 100 MB tunnel cap for
REM videos up to ~4 minutes). Output: <name>_small.mp4 next to the original.
setlocal

if "%~1"=="" (
    echo Drag and drop a video file onto this script to compress it.
    pause
    exit /b 1
)

set "FFMPEG=%~dp0ffmpeg\ffmpeg.exe"
if not exist "%FFMPEG%" set "FFMPEG=C:\Users\USER\AppData\Local\Programs\Python\Python311\ffmpeg.EXE"
if not exist "%FFMPEG%" set "FFMPEG=ffmpeg"

echo Compressing "%~nx1" (this takes a few minutes)...
"%FFMPEG%" -y -i "%~1" -c:v libopenh264 -b:v 3M -pix_fmt yuv420p -c:a aac -b:a 160k "%~dpn1_small.mp4"

if errorlevel 1 (
    echo.
    echo Compression FAILED - see the message above.
) else (
    echo.
    echo Done: "%~dpn1_small.mp4"
)
pause
