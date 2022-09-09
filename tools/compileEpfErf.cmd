@chcp 65001
@set RUNNER_IBCONNECTION=/F./.build/ibservice
rem Компилим из исходников обработку/отчет
rem В парметр передавать КАТАЛОГ с внешним отчетом / обработкой
call vrunner compileepf --nocacheuse %1 .build