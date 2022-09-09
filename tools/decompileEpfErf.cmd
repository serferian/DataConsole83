@chcp 65001
@Echo off
@set RUNNER_IBCONNECTION=/F./.build/ibservice
rem ДеКомпилим из исходников обработку/отчет в свою папку - коммитим изменения в git
rem В параметр передавать полный путь с внешней обработкой/отчетом, изменяемым в конфигураторе - обычно должен лежать в каталоге .build
rem Например: КаталогПроекта> tools/decompileEpfErf.cmd ".build/ОтчетПоГарантированномуМинимуму.epf"

If /I "%~x1"==".epf" (
	call vrunner decompileepf %1 "./src/epf" --nocacheuse
	echo "Обработка -> ./src/epf"
)

If /I "%~x1"==".erf" (
	call vrunner decompileepf %1 "./src/erf" --nocacheuse
	echo "Отчет -> ./src/erf"
)
