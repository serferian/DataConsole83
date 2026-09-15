param(
	[string]$RunnerIbConnection = $env:VRUNNER_IBCONNECTION,
	[string]$V8Version = "",
	[string]$V8UnpackPath = "C:\Program Files\OneScript\lib\precommit1c\tools\v8unpack.exe"
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $PSScriptRoot "code-executor-template"
$moduleRelativePath = "ИсполнительКодаСервер\Ext\ObjectModule.bsl"
$outputPath = Join-Path $repositoryRoot "src\epf\DtCons83Monaco\DtCons83Monaco\Templates\ИсполнительКодаСервер\Ext\Template.bin"
$slotContentMarker = "__DC83_MODULE_SLOT_CONTENT__"
$slotStartMarker = "__DC83_MODULE_SLOT_START__"
$slotEndMarker = "__DC83_MODULE_SLOT_END__"
$slotSize = 262144

if (-not (Test-Path -LiteralPath $V8UnpackPath -PathType Leaf)) {
	throw "Не найден v8unpack.exe: $V8UnpackPath"
}

if ([string]::IsNullOrWhiteSpace($RunnerIbConnection)) {
	throw "Передайте -RunnerIbConnection или задайте VRUNNER_IBCONNECTION."
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("dc83-code-executor-" + [guid]::NewGuid().ToString("N"))
$resolvedTempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)

if (-not $resolvedTemporaryRoot.StartsWith($resolvedTempBase, [System.StringComparison]::OrdinalIgnoreCase)) {
	throw "Некорректный временный каталог: $resolvedTemporaryRoot"
}

New-Item -ItemType Directory -Path $resolvedTemporaryRoot | Out-Null

try {
	$generatedSource = Join-Path $resolvedTemporaryRoot "source"
	$compiledDirectory = Join-Path $resolvedTemporaryRoot "compiled"
	$unpackedDirectory = Join-Path $resolvedTemporaryRoot "unpacked"
	New-Item -ItemType Directory -Path $compiledDirectory, $unpackedDirectory | Out-Null
	Copy-Item -LiteralPath $sourceRoot -Destination $generatedSource -Recurse

	$modulePath = Join-Path $generatedSource $moduleRelativePath
	$moduleText = Get-Content -LiteralPath $modulePath -Raw
	$expandedSlot = "// " + ("_" * $slotSize)
	$moduleText = $moduleText.Replace("// $slotContentMarker", $expandedSlot)
	[System.IO.File]::WriteAllText($modulePath, $moduleText, [System.Text.UTF8Encoding]::new($false))

	$previousConnection = $env:VRUNNER_IBCONNECTION
	try {
		$env:VRUNNER_IBCONNECTION = $RunnerIbConnection
		$compileArguments = @("epf", "compile", "--out=$compiledDirectory")
		if (-not [string]::IsNullOrWhiteSpace($V8Version)) {
			$compileArguments += "--v8version=$V8Version"
		}
		$compileArguments += $generatedSource
		& vrunner @compileArguments
		if ($LASTEXITCODE -ne 0) {
			throw "Сборка шаблонной обработки завершилась с кодом $LASTEXITCODE."
		}
	}
	finally {
		$env:VRUNNER_IBCONNECTION = $previousConnection
	}

	$compiledEpf = Join-Path $compiledDirectory "ИсполнительКодаСервер.epf"
	if (-not (Test-Path -LiteralPath $compiledEpf -PathType Leaf)) {
		throw "Собранная обработка не найдена: $compiledEpf"
	}

	& $V8UnpackPath -UNPACK $compiledEpf $unpackedDirectory
	if ($LASTEXITCODE -ne 0) {
		throw "Распаковка шаблонной обработки завершилась с кодом $LASTEXITCODE."
	}

	$moduleDataFile = $null
	foreach ($dataFile in Get-ChildItem -LiteralPath $unpackedDirectory -Filter "*.data" -File) {
		$inflatedFile = Join-Path $resolvedTemporaryRoot ($dataFile.BaseName + ".inflated")
		& $V8UnpackPath -INFLATE $dataFile.FullName $inflatedFile | Out-Null
		if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $inflatedFile -PathType Leaf)) {
			continue
		}

		$inflatedText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($inflatedFile))
		if ($inflatedText.Contains($slotStartMarker) -and $inflatedText.Contains($slotEndMarker)) {
			$moduleDataFile = $dataFile.FullName
			Copy-Item -LiteralPath $inflatedFile -Destination $moduleDataFile -Force
			break
		}
	}

	if ($null -eq $moduleDataFile) {
		throw "В собранной обработке не найден слот модуля."
	}

	$outputDirectory = Split-Path -Parent $outputPath
	New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
	& $V8UnpackPath -PACK $unpackedDirectory $outputPath
	if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
		throw "Упаковка шаблонной обработки завершилась с кодом $LASTEXITCODE."
	}

	$outputText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($outputPath))
	if (-not $outputText.Contains($slotStartMarker) -or -not $outputText.Contains($slotEndMarker)) {
		throw "Слот модуля не найден в итоговом шаблоне."
	}

	Get-Item -LiteralPath $outputPath
}
finally {
	if (Test-Path -LiteralPath $resolvedTemporaryRoot) {
		Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
	}
}
