<#
Instal OCR lokal CAP (Tesseract) pada komputer server Windows.
Jalankan PowerShell sebagai Administrator. Skrip ini tidak mengirim gambar CAP
ke internet; internet dipakai sekali hanya untuk memasang program dan data
bahasa Indonesia bila belum ada.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ocrHome = Join-Path ${env:ProgramFiles} 'Tesseract-OCR'
$ocrExe = Join-Path $ocrHome 'tesseract.exe'

if (-not (Test-Path -LiteralPath $ocrExe)) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { throw 'Winget tidak tersedia. Instal Tesseract OCR Windows terlebih dahulu, lalu jalankan skrip ini kembali.' }
  & $winget.Source install --id UB-Mannheim.TesseractOCR --exact --silent --accept-package-agreements --accept-source-agreements
}
if (-not (Test-Path -LiteralPath $ocrExe)) { throw 'Tesseract belum ditemukan setelah pemasangan.' }

$tessdata = Join-Path $ocrHome 'tessdata'
$indonesia = Join-Path $tessdata 'ind.traineddata'
if (-not (Test-Path -LiteralPath $indonesia)) {
  Invoke-WebRequest -Uri 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/ind.traineddata' -OutFile $indonesia
}

$languages = & $ocrExe --list-langs
if ($languages -notcontains 'eng' -or $languages -notcontains 'ind') { throw 'Bahasa Inggris atau Indonesia belum aktif pada Tesseract.' }
Write-Host 'OCR CAP siap: Bahasa Indonesia dan Inggris aktif.' -ForegroundColor Green
