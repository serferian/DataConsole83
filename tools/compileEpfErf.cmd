@chcp 65001
@set VRUNNER_IBCONNECTION=/F./.build/ibservice
rem Компилим из исходников обработку/отчет
rem В парметр передавать КАТАЛОГ с внешним отчетом / обработкой
call vrunner epf compile --v8version 8.3.27 --out .build %1