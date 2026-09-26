@echo off
title Cai dat moi truong Windows LTSC cho MyDownloader
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%~dp0setup-ltsc.ps1""'"
