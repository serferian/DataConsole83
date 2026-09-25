(function (window, document) {
  "use strict";

  var DOCUMENT_KINDS = {
    query: { className: "query", glyph: "Q", title: "Запрос", tabTitle: "Запрос", language: "bsl_query", order: 0 },
    beforequery: { className: "before", glyph: "B", title: "Перед выполнением запроса", tabTitle: "До запроса", language: "bsl", order: 1 },
    client: { className: "client", glyph: "C", title: "Код клиента", tabTitle: "Клиент", language: "bsl", order: 2 },
    server: { className: "server", glyph: "S", title: "Код сервера", tabTitle: "Сервер", language: "bsl", order: 3 },
    background: { className: "background", glyph: "F", title: "Фоновый код", tabTitle: "Фон", language: "bsl", order: 4 }
  };
  var DOCUMENT_KIND_ORDER = ["query", "before-query", "client", "server", "background"];
  var WORKSPACE_FORMAT_VERSION = 5;
  var DOCUMENT_COMMANDS = {
    query: [
      { action: "execute-query", label: "Выполнить", primary: true },
      { action: "execute-query-to-cursor", label: "До курсора" },
      { action: "execute-query-package", label: "Пакет" },
      { action: "format-query", label: "Форматировать", snippet: true },
      { action: "get-query-code", label: "Код запроса", snippet: true }
    ],
    beforequery: [
      { action: "execute-query", label: "Выполнить запрос", primary: true }
    ],
    client: [
      { action: "execute-client", label: "Выполнить на клиенте", primary: true },
      { action: "insert-iteration-example", label: "Пример обхода", snippet: true },
      { action: "insert-list-load-example", label: "Загрузка в список", snippet: true }
    ],
    server: [
      { action: "execute-server", label: "Выполнить на сервере", primary: true },
      { action: "insert-iteration-example", label: "Пример обхода", snippet: true },
      { action: "insert-list-load-example", label: "Загрузка в список", snippet: true },
      { action: "insert-storage-example", label: "Из хранилища", snippet: true }
    ],
    background: [
      { action: "execute-background", label: "Выполнить в фоне", primary: true },
      { action: "stop-background", label: "Остановить", stop: true },
      { action: "insert-background-example", label: "Пример фонового кода", snippet: true }
    ]
  };

  var state = {
    workspace: null,
    algorithms: new Map(),
    documents: new Map(),
    models: new Map(),
    viewStates: new Map(),
    documentButtons: new Map(),
    algorithmNodes: new Map(),
    parameterRows: new Map(),
    tableRows: new Map(),
    expandedAlgorithms: new Map(),
    searchExpandedAlgorithms: new Map(),
    selectedAlgorithmId: null,
    selectedParameterId: null,
    selectedTableId: null,
    activeDocumentId: null,
    pendingDocumentId: null,
    editor: null,
    legacyModel: null,
    suppressContentEvents: false,
    themeBridgeInstalled: false,
    globalSaveHandlerInstalled: false,
    dialogConfirm: null,
    dialogRestoreFocus: null,
    dialogPending: false,
    dialogWaitForWorkspaceUpdate: false,
    dialogConfirmLabel: "",
    dialogPendingLabel: "",
    dialogPendingMessage: "",
    searchQuery: "",
    searchTimer: null,
    sidebarVisible: true,
    sidebarScrollTop: 0,
    parametersVisible: true,
    parametersSectionExpanded: true,
    tablesSectionExpanded: true,
    settingsVisible: false,
    parameterHint: { documentId: "", visible: false, items: [] },
    workspaceInitialized: false,
    initializationRetryTimer: null,
    initializationRetryVisible: false,
    workspaceBusy: false,
    workspaceBusyOperationId: "",
    sidebarWidth: 260,
    parametersWidth: 280,
    contextMenu: null
  };

  var elements = {};

  var layoutStateStorageKey = "dataconsole83.layout.v1";

  function saveLayoutState() {
    try {
      window.localStorage.setItem(layoutStateStorageKey, JSON.stringify({
        sidebarVisible: state.sidebarVisible,
        parametersVisible: state.parametersVisible,
        parametersSectionExpanded: state.parametersSectionExpanded,
        tablesSectionExpanded: state.tablesSectionExpanded
      }));
    } catch (error) {
      // Storage can be unavailable in an embedded HTML document.
    }
  }

  function restoreLayoutState() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(layoutStateStorageKey) || "null");
      if (!saved || typeof saved !== "object") {
        return;
      }
      ["sidebarVisible", "parametersVisible", "parametersSectionExpanded", "tablesSectionExpanded"].forEach(function (property) {
        if (typeof saved[property] === "boolean") {
          state[property] = saved[property];
        }
      });
    } catch (error) {
      // Ignore malformed or unavailable persisted layout state.
    }
  }

  function applySecondarySectionState() {
    var parametersSection = elements.parameters ? elements.parameters.querySelector(".dc-parameters-section") : null;
    var tablesSection = elements.parameters ? elements.parameters.querySelector(".dc-tables-section") : null;
    if (parametersSection) {
      parametersSection.classList.toggle("dc-section-collapsed", !state.parametersSectionExpanded);
    }
    if (tablesSection) {
      tablesSection.classList.toggle("dc-section-collapsed", !state.tablesSectionExpanded);
    }
    if (elements.parameters) {
      elements.parameters.classList.toggle("dc-parameters-collapsed", !state.parametersSectionExpanded);
      elements.parameters.classList.toggle("dc-tables-collapsed", !state.tablesSectionExpanded);
    }
    if (elements.parametersSectionToggle) {
      elements.parametersSectionToggle.classList.toggle("dc-section-toggle-collapsed", !state.parametersSectionExpanded);
      elements.parametersSectionToggle.title = state.parametersSectionExpanded ? "Свернуть параметры" : "Развернуть параметры";
    }
    if (elements.tablesSectionToggle) {
      elements.tablesSectionToggle.classList.toggle("dc-section-toggle-collapsed", !state.tablesSectionExpanded);
      elements.tablesSectionToggle.title = state.tablesSectionExpanded ? "Свернуть результаты" : "Развернуть результаты";
    }
    saveLayoutState();
  }

  function updateSectionCount(element, count) {
    if (element) {
      element.textContent = " (" + count + ")";
    }
  }

  function closeContextMenu() {
    if (state.contextMenu && state.contextMenu.parentNode) {
      state.contextMenu.parentNode.removeChild(state.contextMenu);
    }
    state.contextMenu = null;
  }

  function openContextMenu(event, items) {
    closeContextMenu();
    var menu = document.createElement("div");
    menu.className = "dc-context-menu";
    menu.setAttribute("role", "menu");
    items.forEach(function (item) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "dc-context-menu-item" + (item.disabled ? " dc-context-menu-item-disabled" : "");
      if (item.icon) {
        var icon = document.createElement("img");
        icon.className = "dc-context-menu-icon";
        icon.src = "tree/icons/actions/" + item.icon + ".svg";
        icon.alt = "";
        icon.setAttribute("aria-hidden", "true");
        button.appendChild(icon);
      }
      appendTextElement(button, "span", "dc-context-menu-label", item.label);
      button.disabled = Boolean(item.disabled);
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", function () {
        if (!item.disabled) {
          closeContextMenu();
          item.action();
        }
      });
      menu.appendChild(button);
    });
    document.body.appendChild(menu);
    var left = event.clientX;
    var top = event.clientY;
    var rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(left, window.innerWidth - rect.width - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(top, window.innerHeight - rect.height - 4)) + "px";
    state.contextMenu = menu;
    var firstEnabled = menu.querySelector("button:not(:disabled)");
    if (firstEnabled) {
      firstEnabled.focus();
    }
  }

  function openAlgorithmContextMenu(event, algorithm) {
    selectAlgorithmInTree(algorithm.id, true);
    openContextMenu(event, [
      { label: "Добавить алгоритм рядом", icon: "add", action: function () { addAlgorithmFromUi(false); } },
      { label: "Добавить вложенный алгоритм", icon: "subdirectory_arrow_right", action: function () { addAlgorithmFromUi(true); } },
      { label: "Переименовать", icon: "edit", action: function () { renameAlgorithmFromUi(algorithm); } },
      { label: "Удалить", icon: "delete", action: deleteAlgorithmFromUi },
      { label: "Свернуть все", icon: "unfold_less", action: collapseAll }
    ]);
  }

  function openParameterContextMenu(event, algorithm, parameter) {
    selectParameter(parameter.id);
    openContextMenu(event, [
      { label: "Заполнить параметры запроса", icon: "playlist_add_check", disabled: !algorithmDocumentByKind(algorithm, "query"), action: fillParametersFromUi },
      { label: "Добавить параметр", icon: "add", action: addParameterFromUi },
      { label: "Копировать параметр", icon: "content_copy", action: copySelectedParameterFromUi },
      { label: "Изменить значение", icon: "edit", action: function () { editSelectedParameterFromUi("edit"); } },
      { label: "Удалить параметр", icon: "delete", action: deleteParameterFromUi }
    ]);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    elements.workbench = byId("dataconsole-workbench");
    elements.explorer = byId("dataconsole-explorer");
    elements.fileName = byId("dataconsole-file-name");
    elements.newWorkspace = byId("dataconsole-new-workspace");
    elements.openWorkspace = byId("dataconsole-open-workspace");
    elements.saveWorkspace = byId("dataconsole-save-workspace");
    elements.saveWorkspaceAs = byId("dataconsole-save-workspace-as");
    elements.tree = byId("dataconsole-algorithm-tree");
    elements.addAlgorithm = byId("dataconsole-add-algorithm");
    elements.addChildAlgorithm = byId("dataconsole-add-child-algorithm");
    elements.deleteAlgorithm = byId("dataconsole-delete-algorithm");
    elements.searchControl = byId("dataconsole-search-control");
    elements.search = byId("dataconsole-search");
    elements.searchClear = byId("dataconsole-search-clear");
    elements.searchEmpty = byId("dataconsole-search-empty");
    elements.explorerEmpty = byId("dataconsole-explorer-empty");
    elements.emptyInitializing = byId("dataconsole-empty-initializing");
    elements.emptyRetry = byId("dataconsole-empty-retry");
    elements.emptyOpen = byId("dataconsole-empty-open");
    elements.editorEmpty = byId("dataconsole-editor-empty");
    elements.editorShell = byId("dataconsole-editor-shell");
    elements.modeBar = byId("dataconsole-mode-bar");
    elements.modeTabsContainer = byId("dataconsole-mode-tabs");
    elements.modeTabs = elements.modeBar ? elements.modeBar.querySelectorAll(".dc-mode-tab") : [];
    elements.togglePrimarySidebar = byId("dataconsole-toggle-primary-sidebar");
    elements.toggleSecondarySidebar = byId("dataconsole-toggle-secondary-sidebar");
    elements.toggleSettings = byId("dataconsole-toggle-settings");
    elements.actionBar = byId("dataconsole-action-bar");
    elements.actions = byId("dataconsole-actions");
    elements.backgroundSettings = byId("dataconsole-background-settings");
    elements.actionNote = byId("dataconsole-action-note");
    elements.parameterHintControl = byId("dataconsole-parameter-hint-control");
    elements.toggleParameterHint = byId("dataconsole-toggle-parameter-hint");
    elements.parameterHint = byId("dataconsole-parameter-hint");
    elements.parameterHintItems = byId("dataconsole-parameter-hint-items");
    elements.parameters = byId("dataconsole-parameters");
    elements.parametersSplitter = byId("dataconsole-parameters-splitter");
    elements.parametersAlgorithm = byId("dataconsole-parameters-algorithm");
    elements.parametersSectionToggle = byId("dataconsole-parameters-toggle");
    elements.parametersList = byId("dataconsole-parameters-list");
    elements.editParameter = byId("dataconsole-edit-parameter");
    elements.copyParameter = byId("dataconsole-copy-parameter");
    elements.clearParameter = byId("dataconsole-clear-parameter");
    elements.fillParameters = byId("dataconsole-fill-parameters");
    elements.addParameter = byId("dataconsole-add-parameter");
    elements.deleteParameter = byId("dataconsole-delete-parameter");
    elements.tablesList = byId("dataconsole-tables-list");
    elements.tablesSectionToggle = byId("dataconsole-tables-toggle");
    elements.toggleMeasurements = byId("dataconsole-toggle-measurements");
    elements.exportTable = byId("dataconsole-export-table");
    elements.settings = byId("dataconsole-settings");
    elements.closeSettings = byId("dataconsole-close-settings");
    elements.sourceDirectory = byId("dataconsole-source-directory");
    elements.chooseSourceDirectory = byId("dataconsole-choose-source-directory");
    elements.loadCommonModules = byId("dataconsole-load-common-modules");
    elements.variableDisplayMode = byId("dataconsole-variable-display-mode");
    elements.savedListLimit = byId("dataconsole-saved-list-limit");
    elements.autoSaveOnExecute = byId("dataconsole-auto-save-on-execute");
    elements.editorTheme = byId("dataconsole-editor-theme");
    elements.editorFontSize = byId("dataconsole-editor-font-size");
    elements.editorLineNumbers = byId("dataconsole-editor-line-numbers");
    elements.editorMinimap = byId("dataconsole-editor-minimap");
    elements.editorWordWrap = byId("dataconsole-editor-word-wrap");
    elements.editorRenderWhitespace = byId("dataconsole-editor-render-whitespace");
    elements.editorQuickSuggestions = byId("dataconsole-editor-quick-suggestions");
    elements.editorStatusBar = byId("dataconsole-editor-status-bar");
    elements.editorQueryHighlighting = byId("dataconsole-editor-query-highlighting");
    elements.splitter = byId("dataconsole-splitter");
    elements.dialogBackdrop = byId("dataconsole-dialog-backdrop");
    elements.dialogTitle = byId("dataconsole-dialog-title");
    elements.dialogMessage = byId("dataconsole-dialog-message");
    elements.dialogInput = byId("dataconsole-dialog-input");
    elements.dialogError = byId("dataconsole-dialog-error");
    elements.dialogCancel = byId("dataconsole-dialog-cancel");
    elements.dialogConfirm = byId("dataconsole-dialog-confirm");
    elements.workspaceBusy = byId("dataconsole-workspace-busy");
    elements.workspaceBusyMessage = byId("dataconsole-workspace-busy-message");
    elements.workspaceBusyFile = byId("dataconsole-workspace-busy-file");
  }

  function normalizedKind(kind) {
    return String(kind || "").toLowerCase().replace(/[\s_-]/g, "");
  }

  function kindDescription(kind) {
    var key = normalizedKind(kind);
    return DOCUMENT_KINDS[key] || {
      className: "server",
      glyph: "B",
      title: String(kind || "Код"),
      tabTitle: String(kind || "Код"),
      language: "bsl",
      order: 99
    };
  }

  function lowercaseSearchValue(value) {
    return String(value === undefined || value === null ? "" : value).toLowerCase();
  }

  function trimmedSearchValue(value) {
    return lowercaseSearchValue(value).replace(/^\s+|\s+$/g, "");
  }

  function rebuildAlgorithmSearchIndex(algorithm) {
    var values = [algorithm.name];
    algorithm.parameters.forEach(function (parameter) {
      values.push(parameter.name, parameter.typeName, parameter.presentation);
    });
    algorithm.searchIndex = lowercaseSearchValue(values.join("\n"));
  }

  function rebuildDocumentSearchIndex(documentItem) {
    var description = kindDescription(documentItem.kind);
    documentItem.searchIndex = lowercaseSearchValue([
      documentItem.kind,
      documentItem.title,
      description.title,
      description.tabTitle,
      documentItem.text
    ].join("\n"));
  }

  function parseJsonValue(value, methodName) {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch (error) {
        throw new Error(methodName + ": некорректный JSON. " + error.message);
      }
    }
    if (!value || typeof value !== "object") {
      throw new Error(methodName + ": ожидался JSON или объект.");
    }
    return value;
  }

  function requiredIdentity(value, fieldName) {
    if (value === undefined || value === null || String(value) === "") {
      throw new Error("Не заполнено обязательное поле " + fieldName + ".");
    }
    return String(value);
  }

  function asArray(value, fieldName) {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new Error("Поле " + fieldName + " должно быть массивом.");
    }
    return value;
  }

  function normalizeParameter(rawParameter, fieldName) {
    if (!rawParameter || typeof rawParameter !== "object") {
      throw new Error("Элемент " + fieldName + " должен быть объектом.");
    }
    return {
      id: requiredIdentity(rawParameter.id, fieldName + ".id"),
      name: String(rawParameter.name || "Параметр"),
      typeName: rawParameter.typeName === undefined ? "" : String(rawParameter.typeName),
      presentation: rawParameter.presentation === undefined ? "" : String(rawParameter.presentation),
      editableInline: Boolean(rawParameter.editableInline)
    };
  }

  function normalizeTable(rawTable, fieldName) {
    if (!rawTable || typeof rawTable !== "object") {
      throw new Error("Элемент " + fieldName + " должен быть объектом.");
    }
    var duration = Number(rawTable.duration || 0);
    var rowCount = Number(rawTable.rowCount || 0);
    return {
      id: requiredIdentity(rawTable.id, fieldName + ".id"),
      name: String(rawTable.name || "Результат"),
      rowCount: isFinite(rowCount) ? rowCount : 0,
      duration: isFinite(duration) ? duration : 0
    };
  }

  function normalizeParameterHintItem(rawItem, fieldName) {
    if (!rawItem || typeof rawItem !== "object") {
      throw new Error("Элемент " + fieldName + " должен быть объектом.");
    }
    var level = Number(rawItem.level || 0);
    if (!isFinite(level) || level < 0) {
      level = 0;
    }
    return {
      name: String(rawItem.name || ""),
      typeName: String(rawItem.typeName || ""),
      description: String(rawItem.description || ""),
      level: Math.min(3, Math.floor(level))
    };
  }

  function normalizeSettings(rawSettings) {
    var source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    var editorSource = source.editor && typeof source.editor === "object" ? source.editor : {};
    var backgroundSource = source.background && typeof source.background === "object" ? source.background : {};
    var variableDisplayMode = Number(source.variableDisplayMode || 0);
    var savedListLimit = Number(source.savedListLimit || 0);
    var fontSize = Number(editorSource.fontSize === undefined ? 14 : editorSource.fontSize);
    var backgroundJobCount = Number(backgroundSource.jobCount === undefined ? 1 : backgroundSource.jobCount);
    var backgroundBatchSize = Number(backgroundSource.batchSize || 0);
    if (variableDisplayMode < 0 || variableDisplayMode > 2 || !isFinite(variableDisplayMode)) {
      variableDisplayMode = 0;
    }
    if (savedListLimit < 0 || savedListLimit > 9999 || !isFinite(savedListLimit)) {
      savedListLimit = 0;
    }
    if (fontSize < 10 || fontSize > 28 || !isFinite(fontSize)) {
      fontSize = 14;
    }
    if (backgroundJobCount < 1 || backgroundJobCount > 10 || !isFinite(backgroundJobCount)) {
      backgroundJobCount = 1;
    }
    if (backgroundBatchSize < 0 || !isFinite(backgroundBatchSize)) {
      backgroundBatchSize = 0;
    }
    return {
      sourceDirectory: source.sourceDirectory === undefined || source.sourceDirectory === null
        ? ""
        : String(source.sourceDirectory),
      autoSaveOnExecute: Boolean(source.autoSaveOnExecute),
      variableDisplayMode: Math.floor(variableDisplayMode),
      savedListLimit: Math.floor(savedListLimit),
      background: {
        jobCount: Math.floor(backgroundJobCount),
        batchSize: Math.floor(backgroundBatchSize),
        safeMode: backgroundSource.safeMode === undefined ? true : Boolean(backgroundSource.safeMode)
      },
      editor: {
        theme: editorSource.theme === "dark" ? "dark" : "light",
        fontSize: Math.floor(fontSize),
        lineNumbers: editorSource.lineNumbers === undefined ? true : Boolean(editorSource.lineNumbers),
        minimap: editorSource.minimap === undefined ? false : Boolean(editorSource.minimap),
        wordWrap: editorSource.wordWrap === undefined ? false : Boolean(editorSource.wordWrap),
        renderWhitespace: editorSource.renderWhitespace === undefined ? false : Boolean(editorSource.renderWhitespace),
        quickSuggestions: editorSource.quickSuggestions === undefined ? true : Boolean(editorSource.quickSuggestions),
        statusBar: editorSource.statusBar === undefined ? false : Boolean(editorSource.statusBar),
        queryHighlighting: editorSource.queryHighlighting === undefined ? false : Boolean(editorSource.queryHighlighting)
      }
    };
  }

  function emitBridgeEvent(eventName, params) {
    if (typeof window.sendEvent !== "function") {
      return false;
    }
    window.sendEvent(eventName, params);
    return true;
  }

  function reportError(methodName, error) {
    var description = error && error.message ? error.message : String(error);
    var result = { errorDescription: description };
    try {
      emitBridgeEvent("EVENT_WORKBENCH_DIAGNOSTIC", {
        source: "DataConsoleApp",
        method: methodName,
        errorDescription: description
      });
    } catch (bridgeError) {
      if (window.console && typeof window.console.error === "function") {
        window.console.error("DataConsoleApp diagnostic bridge error", bridgeError);
      }
    }
    return result;
  }

  function validateAndIndexWorkspace(snapshot) {
    var algorithms = new Map();
    var documents = new Map();
    var orderedDocuments = [];

    function visitAlgorithm(rawAlgorithm, parentId, depth) {
      var algorithmId;
      var algorithm;
      var rawDocuments;
      var rawParameters;
      var rawChildren;
      var index;

      if (!rawAlgorithm || typeof rawAlgorithm !== "object") {
        throw new Error("Элемент algorithms должен быть объектом.");
      }

      algorithmId = requiredIdentity(rawAlgorithm.id, "algorithm.id");
      if (algorithms.has(algorithmId)) {
        throw new Error("Повторяется идентификатор алгоритма: " + algorithmId + ".");
      }

      rawDocuments = asArray(rawAlgorithm.documents, "algorithm.documents");
      rawParameters = asArray(rawAlgorithm.parameters, "algorithm.parameters");
      rawChildren = asArray(rawAlgorithm.children, "algorithm.children");
      algorithm = {
        id: algorithmId,
        name: String(rawAlgorithm.name || "Без имени"),
        parentId: parentId,
        depth: depth,
        documents: [],
        parameters: [],
        children: []
      };
      algorithms.set(algorithmId, algorithm);

      for (index = 0; index < rawDocuments.length; index += 1) {
        var rawDocument = rawDocuments[index];
        var documentId;
        var documentItem;
        if (!rawDocument || typeof rawDocument !== "object") {
          throw new Error("Элемент algorithm.documents должен быть объектом.");
        }
        documentId = requiredIdentity(rawDocument.id, "document.id");
        if (documents.has(documentId)) {
          throw new Error("Повторяется идентификатор документа: " + documentId + ".");
        }
        documentItem = {
          id: documentId,
          algorithmId: algorithmId,
          kind: requiredIdentity(rawDocument.kind, "document.kind"),
          title: rawDocument.title === undefined ? "" : String(rawDocument.title),
          text: rawDocument.text === undefined || rawDocument.text === null ? "" : String(rawDocument.text),
          hasContent: rawDocument.hasContent === undefined ? Boolean(rawDocument.text) : Boolean(rawDocument.hasContent)
        };
        rebuildDocumentSearchIndex(documentItem);
        documents.set(documentId, documentItem);
        orderedDocuments.push(documentItem);
        algorithm.documents.push(documentItem);
      }

      for (index = 0; index < rawParameters.length; index += 1) {
        algorithm.parameters.push(normalizeParameter(rawParameters[index], "algorithm.parameters"));
      }

      rebuildAlgorithmSearchIndex(algorithm);

      for (index = 0; index < rawChildren.length; index += 1) {
        algorithm.children.push(visitAlgorithm(rawChildren[index], algorithmId, depth + 1));
      }

      return algorithm;
    }

    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("Рабочая область должна быть объектом.");
    }

    if (snapshot.formatVersion !== WORKSPACE_FORMAT_VERSION) {
      throw new Error("Неподдерживаемая версия WorkspaceStore: "
        + String(snapshot.formatVersion) + ". Ожидается " + WORKSPACE_FORMAT_VERSION + ".");
    }

    var revision = Number(snapshot.revision);
    if (!isFinite(revision) || revision < 0) {
      revision = 0;
    }

    var roots = asArray(snapshot.algorithms, "workspace.algorithms");
    var normalizedRoots = [];
    var rawTables = asArray(snapshot.tables, "workspace.tables");
    var normalizedTables = [];
    var tableIds = new Map();
    for (var index = 0; index < roots.length; index += 1) {
      normalizedRoots.push(visitAlgorithm(roots[index], null, 0));
    }
    for (var tableIndex = 0; tableIndex < rawTables.length; tableIndex += 1) {
      var table = normalizeTable(rawTables[tableIndex], "workspace.tables");
      if (tableIds.has(table.id)) {
        throw new Error("Повторяется идентификатор таблицы: " + table.id + ".");
      }
      tableIds.set(table.id, true);
      normalizedTables.push(table);
    }

    return {
      workspace: {
        formatVersion: WORKSPACE_FORMAT_VERSION,
        sessionId: snapshot.sessionId === undefined ? "" : String(snapshot.sessionId),
        fileName: snapshot.fileName === undefined ? "" : String(snapshot.fileName),
        modified: Boolean(snapshot.modified),
        revision: Math.floor(revision),
        fileHash: snapshot.fileHash === undefined || snapshot.fileHash === null
          ? ""
          : String(snapshot.fileHash),
        canExecute: snapshot.canExecute === undefined ? true : Boolean(snapshot.canExecute),
        selectedAlgorithmId: snapshot.selectedAlgorithmId === undefined || snapshot.selectedAlgorithmId === null
          ? ""
          : String(snapshot.selectedAlgorithmId),
        selectedTableId: snapshot.selectedTableId === undefined || snapshot.selectedTableId === null
          ? ""
          : String(snapshot.selectedTableId),
        measurementsEnabled: Boolean(snapshot.measurementsEnabled),
        tables: normalizedTables,
        settings: normalizeSettings(snapshot.settings),
        algorithms: normalizedRoots
      },
      algorithms: algorithms,
      documents: documents,
      orderedDocuments: orderedDocuments
    };
  }

  function setAlgorithmDepth(algorithm, parentId, depth) {
    algorithm.parentId = parentId;
    algorithm.depth = depth;
    algorithm.children.forEach(function (child) {
      setAlgorithmDepth(child, algorithm.id, depth + 1);
    });
  }

  function collectAlgorithmTree(algorithm, algorithms, documents) {
    algorithms.push(algorithm);
    algorithm.documents.forEach(function (documentItem) {
      documents.push(documentItem);
    });
    algorithm.children.forEach(function (child) {
      collectAlgorithmTree(child, algorithms, documents);
    });
  }

  function registerAlgorithmTree(algorithm) {
    state.algorithms.set(algorithm.id, algorithm);
    algorithm.documents.forEach(function (documentItem) {
      state.documents.set(documentItem.id, documentItem);
    });
    algorithm.children.forEach(registerAlgorithmTree);
  }

  function ensureAlgorithmChildrenContainer(rendered) {
    var children = rendered.body.querySelector(".dc-children");
    if (!children) {
      children = document.createElement("div");
      children.className = "dc-children";
      children.setAttribute("role", "group");
      rendered.body.appendChild(children);
    }
    rendered.twistie.classList.remove("dc-twistie-empty");
    rendered.twistie.tabIndex = 0;
    return children;
  }

  function updateRenderedAlgorithmChildrenState(algorithmId) {
    var algorithm = state.algorithms.get(algorithmId);
    var rendered = state.algorithmNodes.get(algorithmId);
    if (!algorithm || !rendered) {
      return;
    }
    var hasChildren = algorithm.children.length > 0;
    if (!hasChildren) {
      var children = rendered.body.querySelector(".dc-children");
      if (children) {
        rendered.body.removeChild(children);
      }
      rendered.twistie.classList.add("dc-twistie-empty");
      rendered.twistie.tabIndex = -1;
      rendered.twistie.setAttribute("aria-expanded", "false");
      rendered.twistie.setAttribute("aria-label", "Развернуть " + algorithm.name);
    } else {
      rendered.twistie.classList.remove("dc-twistie-empty");
      rendered.twistie.tabIndex = 0;
    }
  }

  function clearActiveDocument() {
    saveActiveViewState();
    if (state.editor && state.legacyModel && !state.legacyModel.isDisposed()) {
      state.editor.setModel(state.legacyModel);
    }
    state.activeDocumentId = null;
    state.pendingDocumentId = null;
    if (elements.editorEmpty) {
      elements.editorEmpty.hidden = false;
    }
    updateModeBar();
    if (state.editor) {
      state.editor.layout();
    }
  }

  function completePendingWorkspaceMutation() {
    if (!state.dialogPending) {
      return;
    }
    state.dialogRestoreFocus = null;
    closeWorkbenchDialog(true);
  }

  function failPendingWorkspaceMutation(description) {
    if (!state.dialogPending) {
      return;
    }
    state.dialogPending = false;
    elements.dialogBackdrop.removeAttribute("aria-busy");
    elements.dialogInput.disabled = false;
    elements.dialogCancel.disabled = false;
    elements.dialogConfirm.disabled = false;
    elements.dialogConfirm.textContent = state.dialogConfirmLabel || "Продолжить";
    elements.dialogError.textContent = description || "Не удалось выполнить операцию.";
    elements.dialogError.hidden = false;
    elements.dialogConfirm.focus();
  }

  function appendTextElement(parent, tagName, className, text) {
    var element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function updateDocumentButtonState(documentId) {
    var button = state.documentButtons.get(documentId);
    var documentItem = state.documents.get(documentId);
    if (!button || !documentItem) {
      return;
    }
    if (state.activeDocumentId === documentId) {
      button.classList.add("dc-active");
      button.setAttribute("aria-current", "true");
    } else {
      button.classList.remove("dc-active");
      button.removeAttribute("aria-current");
    }
    if (documentItem.hasContent) {
      button.classList.add("dc-has-content");
    } else {
      button.classList.remove("dc-has-content");
    }
  }

  function activateDocumentFromUi(algorithmId, documentKind) {
    var result = activateDocumentInternal(algorithmId, documentKind, true);
    if (result && result.errorDescription) {
      reportError("activateDocument", new Error(result.errorDescription));
    }
  }

  function createTreeDocumentButtons(algorithm) {
    var group = document.createElement("div");
    group.className = "dc-tree-document-buttons";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Документы алгоритма " + algorithm.name);

    DOCUMENT_KIND_ORDER.forEach(function (documentKind) {
      var documentItem = algorithmDocumentByKind(algorithm, documentKind);
      var description = kindDescription(documentKind);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "dc-tree-document-button dc-kind-" + description.className + (documentItem ? "" : " dc-document-unavailable");
      button.disabled = !documentItem;
      if (documentItem) {
        button.setAttribute("data-document-id", documentItem.id);
      }
      button.title = documentItem ? description.title : description.title + ": документ недоступен";
      button.setAttribute("aria-label", button.title);
      button.textContent = description.glyph;
      if (documentItem) {
        button.addEventListener("click", function (event) {
          if (event && event.stopPropagation) {
            event.stopPropagation();
          }
          activateDocumentFromUi(algorithm.id, documentItem.kind);
        });
        state.documentButtons.set(documentItem.id, button);
      }
      group.appendChild(button);
      if (documentItem) {
        updateDocumentButtonState(documentItem.id);
      }
    });
    return group;
  }

  function algorithmDocumentByKind(algorithm, documentKind) {
    var expectedKind = normalizedKind(documentKind);
    for (var index = 0; index < algorithm.documents.length; index += 1) {
      if (normalizedKind(algorithm.documents[index].kind) === expectedKind) {
        return algorithm.documents[index];
      }
    }
    return null;
  }

  function preferredDocumentForAlgorithm(algorithm) {
    var queryDocument = null;
    var firstDocument = null;
    for (var index = 0; index < DOCUMENT_KIND_ORDER.length; index += 1) {
      var documentItem = algorithmDocumentByKind(algorithm, DOCUMENT_KIND_ORDER[index]);
      if (!documentItem) {
        continue;
      }
      if (!firstDocument) {
        firstDocument = documentItem;
      }
      if (normalizedKind(documentItem.kind) === "query") {
        queryDocument = documentItem;
      }
      if (documentItem.hasContent) {
        return documentItem;
      }
    }
    return queryDocument || firstDocument;
  }

  function revealSelectedAlgorithm(algorithmId) {
    var current = state.algorithms.get(String(algorithmId));
    state.expandedAlgorithms = new Map();
    state.searchExpandedAlgorithms = new Map();
    state.algorithms.forEach(function (algorithm) {
      state.expandedAlgorithms.set(algorithm.id, false);
      state.searchExpandedAlgorithms.set(algorithm.id, false);
    });
    while (current) {
      state.expandedAlgorithms.set(current.id, true);
      state.searchExpandedAlgorithms.set(current.id, true);
      current = current.parentId ? state.algorithms.get(current.parentId) : null;
    }
  }

  function restoreSelectedAlgorithmPosition(algorithmId) {
    var normalizedAlgorithmId = String(algorithmId);
    window.setTimeout(function () {
      if (state.selectedAlgorithmId !== normalizedAlgorithmId || !elements.tree) {
        return;
      }
      var rendered = state.algorithmNodes.get(normalizedAlgorithmId);
      if (!rendered || !rendered.heading) {
        return;
      }
      var treeRect = elements.tree.getBoundingClientRect();
      var headingRect = rendered.heading.getBoundingClientRect();
      var centeredOffset = Math.max(0, (elements.tree.clientHeight - headingRect.height) / 2);
      elements.tree.scrollTop += headingRect.top - treeRect.top - centeredOffset;
      state.sidebarScrollTop = elements.tree.scrollTop;
    }, 0);
  }

  function updateRenderedAlgorithmStates() {
    var expansion = state.searchQuery ? state.searchExpandedAlgorithms : state.expandedAlgorithms;
    state.algorithmNodes.forEach(function (rendered, algorithmId) {
      var algorithm = state.algorithms.get(algorithmId);
      var isSelected = state.selectedAlgorithmId === algorithmId;
      var expanded = expansion.has(algorithmId)
        ? expansion.get(algorithmId)
        : (state.searchQuery ? true : algorithm.depth < 2);
      rendered.node.setAttribute("aria-selected", isSelected ? "true" : "false");
      rendered.heading.classList.toggle("dc-selected", isSelected);
      rendered.twistie.setAttribute("aria-expanded", expanded ? "true" : "false");
      rendered.twistie.setAttribute("aria-label", (expanded ? "Свернуть " : "Развернуть ") + algorithm.name);
      rendered.body.hidden = !expanded;
    });
  }

  function selectAlgorithmInTree(algorithmId, forceReveal) {
    var normalizedAlgorithmId = String(algorithmId);
    if (state.selectedAlgorithmId === normalizedAlgorithmId && !forceReveal) {
      return;
    }
    if (state.selectedAlgorithmId !== normalizedAlgorithmId) {
      state.selectedParameterId = null;
    }
    state.selectedAlgorithmId = normalizedAlgorithmId;
    revealSelectedAlgorithm(normalizedAlgorithmId);
    updateRenderedAlgorithmStates();
  }

  function activateAlgorithmFromUi(algorithm) {
    var documentItem = preferredDocumentForAlgorithm(algorithm);
    if (!documentItem) {
      return;
    }
    selectAlgorithmInTree(algorithm.id, true);
    activateDocumentFromUi(algorithm.id, documentItem.kind);
  }

  function updateModeBar() {
    var activeDocument = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : null;
    var algorithm = activeDocument ? state.algorithms.get(activeDocument.algorithmId) : null;
    var hasAlgorithm = Boolean(algorithm);
    elements.modeTabsContainer.hidden = !hasAlgorithm;
    elements.editorShell.classList.toggle("dc-mode-visible", hasAlgorithm);

    for (var index = 0; index < elements.modeTabs.length; index += 1) {
      var tab = elements.modeTabs[index];
      var kind = tab.getAttribute("data-document-kind");
      var documentItem = algorithm ? algorithmDocumentByKind(algorithm, kind) : null;
      var isActive = Boolean(documentItem && documentItem.id === state.activeDocumentId);
      tab.disabled = !documentItem;
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      tab.tabIndex = isActive || (!activeDocument && documentItem) ? 0 : -1;
      tab.classList.toggle("dc-active", isActive);
      tab.setAttribute("data-algorithm-id", algorithm ? algorithm.id : "");
      tab.title = documentItem ? kindDescription(documentItem.kind).title : "Документ недоступен";
    }
    renderActionBar(algorithm, activeDocument);
    renderParametersPanel(algorithm, activeDocument);
  }

  function commandPayload(documentItem, action, additional) {
    var payload = {
      sessionId: state.workspace ? state.workspace.sessionId : "",
      algorithmId: documentItem.algorithmId,
      documentId: documentItem.id,
      documentKind: documentItem.kind,
      action: action,
      // Выполнение использует HTML-модель, даже если скрытое дерево 1С устарело.
      documentText: getDocumentText(documentItem.id)
    };
    payload.workspaceRevision = state.workspace ? state.workspace.revision : 0;
    Object.keys(additional || {}).forEach(function (key) {
      payload[key] = additional[key];
    });
    return payload;
  }

  function requestCommand(documentItem, action, additional) {
    if (!documentItem || !state.workspace
        || (!state.workspace.canExecute && action !== "toggle-parameter-hint")) {
      return false;
    }
    return emitBridgeEvent("EVENT_COMMAND_REQUESTED", commandPayload(documentItem, action, additional));
  }

  function renderParameterHint(activeDocument) {
    while (elements.parameterHintItems.firstChild) {
      elements.parameterHintItems.removeChild(elements.parameterHintItems.firstChild);
    }
    var supported = Boolean(activeDocument
      && ["beforequery", "client", "server", "background"].indexOf(normalizedKind(activeDocument.kind)) >= 0);
    var matchesDocument = supported && state.parameterHint.documentId === activeDocument.id;
    var visible = Boolean(matchesDocument && state.parameterHint.visible);

    elements.parameterHintControl.hidden = !supported;
    elements.toggleParameterHint.setAttribute("aria-pressed", visible ? "true" : "false");
    elements.toggleParameterHint.setAttribute("aria-expanded", visible ? "true" : "false");
    elements.toggleParameterHint.setAttribute("aria-label", visible
      ? "Скрыть параметры среды выполнения"
      : "Показать параметры среды выполнения");
    elements.toggleParameterHint.title = visible
      ? "Скрыть параметры среды выполнения"
      : "Показать параметры среды выполнения";
    elements.parameterHint.hidden = !visible;
    elements.actionBar.classList.toggle("dc-parameter-hint-visible", visible);

    if (!visible) {
      return;
    }
    state.parameterHint.items.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "dc-parameter-hint-item dc-parameter-hint-level-" + item.level;
      appendTextElement(row, "span", "dc-parameter-hint-name", item.name);
      appendTextElement(row, "span", "dc-parameter-hint-type", item.typeName);
      appendTextElement(row, "span", "dc-parameter-hint-description", item.description);
      elements.parameterHintItems.appendChild(row);
    });
  }

  function appendBackgroundSettingLabel(text, control) {
    var label = document.createElement("label");
    label.className = "dc-background-setting";
    appendTextElement(label, "span", "dc-background-setting-label", text);
    label.appendChild(control);
    elements.backgroundSettings.appendChild(label);
  }

  function renderBackgroundSettings(activeDocument) {
    while (elements.backgroundSettings.firstChild) {
      elements.backgroundSettings.removeChild(elements.backgroundSettings.firstChild);
    }
    var visible = Boolean(activeDocument && normalizedKind(activeDocument.kind) === "background");
    elements.backgroundSettings.hidden = !visible;
    if (!visible) {
      return;
    }

    var settings = state.workspace.settings.background;
    var jobCount = document.createElement("input");
    jobCount.type = "number";
    jobCount.className = "dc-background-number";
    jobCount.min = "1";
    jobCount.max = "10";
    jobCount.step = "1";
    jobCount.value = String(settings.jobCount);
    jobCount.disabled = !state.workspace.canExecute;
    jobCount.title = "Количество фоновых заданий (от 1 до 10)";
    jobCount.setAttribute("aria-label", "Количество фоновых заданий");
    jobCount.addEventListener("change", function () {
      var value = Math.max(1, Math.min(10, Math.floor(Number(jobCount.value) || 1)));
      jobCount.value = String(value);
      requestCommand(activeDocument, "update-background-setting", {
        settingName: "jobCount",
        settingValue: value
      });
    });
    appendBackgroundSettingLabel("Заданий", jobCount);

    var batchSize = document.createElement("output");
    batchSize.className = "dc-background-output";
    batchSize.textContent = String(settings.batchSize);
    batchSize.title = "Расчётная порция данных на одно задание";
    batchSize.setAttribute("aria-label", "Порция данных: " + settings.batchSize);
    appendBackgroundSettingLabel("Порция", batchSize);

    var safeMode = document.createElement("input");
    safeMode.type = "checkbox";
    safeMode.className = "dc-background-checkbox";
    safeMode.checked = settings.safeMode;
    safeMode.disabled = !state.workspace.canExecute;
    safeMode.title = "Выполнять фоновые задания в безопасном режиме";
    safeMode.setAttribute("aria-label", "Безопасный режим");
    safeMode.addEventListener("change", function () {
      requestCommand(activeDocument, "update-background-setting", {
        settingName: "safeMode",
        settingValue: safeMode.checked
      });
    });
    appendBackgroundSettingLabel("Безопасный режим", safeMode);
  }

  function renderActionBar(algorithm, activeDocument) {
    while (elements.actions.firstChild) {
      elements.actions.removeChild(elements.actions.firstChild);
    }
    elements.actionNote.textContent = "";
    elements.actionBar.hidden = !activeDocument;
    if (!activeDocument) {
      renderBackgroundSettings(null);
      renderParameterHint(null);
      return;
    }

    var commands = DOCUMENT_COMMANDS[normalizedKind(activeDocument.kind)] || [];
    commands.forEach(function (command) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "dc-command-button" + (command.primary ? " dc-command-primary" : "")
        + (command.stop ? " dc-command-stop" : "") + (command.snippet ? " dc-command-snippet" : "");
      button.disabled = !state.workspace.canExecute;
      button.title = command.label;
      button.setAttribute("aria-label", command.label);
      if (command.primary) {
        var play = document.createElement("span");
        play.className = "dc-command-play";
        play.setAttribute("aria-hidden", "true");
        button.appendChild(play);
      }
      if (command.stop) {
        var stop = document.createElement("span");
        stop.className = "dc-command-stop-mark";
        stop.setAttribute("aria-hidden", "true");
        button.appendChild(stop);
      }
      appendTextElement(button, "span", "dc-command-label", command.label);
      button.addEventListener("click", function () {
        requestCommand(activeDocument, command.action);
      });
      elements.actions.appendChild(button);
    });
    renderBackgroundSettings(activeDocument);
    renderParameterHint(activeDocument);

    if (normalizedKind(activeDocument.kind) === "beforequery") {
      elements.actionNote.textContent = "Код выполнится перед запросом";
    }
  }

  function renderParametersPanel(algorithm, activeDocument) {
    state.parameterRows = new Map();
    while (elements.parametersList.firstChild) {
      elements.parametersList.removeChild(elements.parametersList.firstChild);
    }
    if (!algorithm) {
      state.selectedParameterId = null;
      elements.parametersAlgorithm.textContent = "Выберите алгоритм";
      elements.parametersAlgorithm.title = "";
      elements.fillParameters.hidden = true;
      updateMutationButtonStates(null);
      appendTextElement(elements.parametersList, "div", "dc-parameters-empty", "Выберите алгоритм");
      return;
    }

    elements.parametersAlgorithm.textContent = algorithm.name;
    updateSectionCount(byId("dataconsole-parameters-count"), algorithm.parameters.length);
    elements.parametersAlgorithm.title = algorithm.name;
    var kind = activeDocument ? normalizedKind(activeDocument.kind) : "";
    var canFill = kind === "query" || kind === "beforequery";
    elements.fillParameters.hidden = !canFill;
    elements.fillParameters.disabled = !state.workspace.canExecute || !algorithmDocumentByKind(algorithm, "query");

    var selectedParameterExists = algorithm.parameters.some(function (parameter) {
      return parameter.id === state.selectedParameterId;
    });
    if (!selectedParameterExists) {
      state.selectedParameterId = null;
    }
    updateMutationButtonStates(algorithm);

    if (!algorithm.parameters.length) {
      appendTextElement(elements.parametersList, "div", "dc-parameters-empty", "Нет параметров");
      return;
    }
    algorithm.parameters.forEach(function (parameter) {
      var row = document.createElement("div");
      var isSelected = parameter.id === state.selectedParameterId;
      row.className = "dc-parameter-row" + (isSelected ? " dc-selected" : "");
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-pressed", isSelected ? "true" : "false");
      var name = appendTextElement(row, "div", "dc-parameter-name", parameter.name);
      name.title = parameter.typeName || parameter.name;
      var valueRow = document.createElement("div");
      valueRow.className = "dc-parameter-value-row";
      var value = appendTextElement(valueRow, "div", "dc-parameter-value", parameter.presentation);
      value.title = parameter.typeName ? parameter.typeName + ": " + parameter.presentation : parameter.presentation;
      var actions = document.createElement("div");
      actions.className = "dc-parameter-value-actions";
      [
        { action: "date", title: "Дата — установить значение", icon: "date" },
        { action: "string", title: "Строка — многострочный ввод", icon: "string" },
        { action: "number", title: "Число — формат 15,5", icon: "number" },
        { action: "value-list", title: "СписокЗначений — открыть подбор", icon: "list" },
        { action: "other", title: "Прочее — выбрать значение", icon: "other" },
        { action: "clear", title: "Очистить значение", icon: "clear" }
      ].forEach(function (descriptor) {
        var button = document.createElement("button");
        button.className = "dc-parameter-value-action dc-parameter-value-action-" + descriptor.icon;
        button.type = "button";
        button.title = descriptor.title;
        button.setAttribute("aria-label", descriptor.title);
        button.disabled = !state.workspace.canExecute;
        var icon = document.createElement(descriptor.icon === "clear" ? "img" : "span");
        icon.className = "dc-parameter-value-icon dc-parameter-value-icon-" + descriptor.icon;
        icon.setAttribute("aria-hidden", "true");
        if (descriptor.icon === "clear") {
          icon.src = "tree/icons/actions/clear.svg";
          icon.alt = "";
        }
        button.appendChild(icon);
        button.addEventListener("click", function (event) {
          selectParameter(parameter.id);
          requestParameterEdit(descriptor.action, algorithm.id, parameter.id);
          event.stopPropagation();
        });
        button.addEventListener("dblclick", function (event) {
          event.stopPropagation();
        });
        button.addEventListener("keydown", function (event) {
          event.stopPropagation();
        });
        actions.appendChild(button);
      });
      valueRow.appendChild(actions);
      row.appendChild(valueRow);
      row.addEventListener("click", function () {
        selectParameter(parameter.id);
      });
      row.addEventListener("contextmenu", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openParameterContextMenu(event, algorithm, parameter);
      });
      row.addEventListener("dblclick", function () {
        selectParameter(parameter.id);
        requestParameterEdit("edit", algorithm.id, parameter.id);
      });
      row.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.keyCode === 13) {
          selectParameter(parameter.id);
          requestParameterEdit("edit", algorithm.id, parameter.id);
          event.preventDefault();
        } else if (event.key === " " || event.keyCode === 32) {
          selectParameter(parameter.id);
          event.preventDefault();
        }
      });
      state.parameterRows.set(parameter.id, row);
      elements.parametersList.appendChild(row);
    });
  }

  function updateMutationButtonStates(algorithm) {
    var canMutate = Boolean(state.workspace && state.workspace.canExecute && !state.workspaceBusy);
    var hasAlgorithm = Boolean(algorithm);
    elements.addAlgorithm.disabled = !canMutate;
    elements.addChildAlgorithm.disabled = !canMutate || !hasAlgorithm;
    elements.deleteAlgorithm.disabled = !canMutate || !hasAlgorithm;
    elements.addParameter.disabled = !canMutate || !hasAlgorithm;
    elements.deleteParameter.disabled = !canMutate || !hasAlgorithm || !state.selectedParameterId;
    elements.editParameter.disabled = !canMutate || !hasAlgorithm || !state.selectedParameterId;
    elements.copyParameter.disabled = !canMutate || !hasAlgorithm || !state.selectedParameterId;
    elements.clearParameter.disabled = !canMutate || !hasAlgorithm || !state.selectedParameterId;
  }

  function requestParameterEdit(action, algorithmId, parameterId) {
    if (!state.workspace || !state.workspace.canExecute || !algorithmId || !parameterId) {
      return;
    }
    emitBridgeEvent("EVENT_PARAMETER_EDIT_REQUESTED", {
      sessionId: state.workspace.sessionId,
      algorithmId: String(algorithmId),
      parameterId: String(parameterId),
      action: action
    });
  }

  function editSelectedParameterFromUi(action) {
    var algorithm = currentAlgorithm();
    if (!algorithm || !state.selectedParameterId) {
      return;
    }
    requestParameterEdit(action, algorithm.id, state.selectedParameterId);
  }

  function selectParameter(parameterId) {
    var previousId = state.selectedParameterId;
    state.selectedParameterId = String(parameterId);
    if (previousId && state.parameterRows.has(previousId)) {
      state.parameterRows.get(previousId).classList.remove("dc-selected");
      state.parameterRows.get(previousId).setAttribute("aria-pressed", "false");
    }
    if (state.parameterRows.has(state.selectedParameterId)) {
      state.parameterRows.get(state.selectedParameterId).classList.add("dc-selected");
      state.parameterRows.get(state.selectedParameterId).setAttribute("aria-pressed", "true");
    }
    var activeDocument = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : null;
    var algorithm = activeDocument ? state.algorithms.get(activeDocument.algorithmId) : null;
    updateMutationButtonStates(algorithm);
  }

  function tableCommandPayload(action, tableId) {
    return {
      sessionId: state.workspace ? state.workspace.sessionId : "",
      action: action,
      tableId: tableId || ""
    };
  }

  function requestTableCommand(action, tableId) {
    if (!state.workspace || !state.workspace.canExecute) {
      return;
    }
    emitBridgeEvent("EVENT_TABLE_COMMAND_REQUESTED", tableCommandPayload(action, tableId));
  }

  function selectTableFromUi(table) {
    var previousId = state.selectedTableId;
    state.selectedTableId = table.id;
    if (previousId && state.tableRows.has(previousId)) {
      state.tableRows.get(previousId).classList.remove("dc-selected");
      state.tableRows.get(previousId).setAttribute("aria-pressed", "false");
    }
    if (state.tableRows.has(table.id)) {
      state.tableRows.get(table.id).classList.add("dc-selected");
      state.tableRows.get(table.id).setAttribute("aria-pressed", "true");
    }
    elements.exportTable.disabled = false;
    requestTableCommand("select-table", table.id);
  }

  function durationClass(duration, totalDuration) {
    if (!totalDuration || duration < totalDuration * 0.1) {
      return "dc-duration-fast";
    }
    if (duration < totalDuration * 0.4) {
      return "dc-duration-medium";
    }
    return "dc-duration-slow";
  }

  function durationPresentation(duration) {
    return Number(duration || 0).toFixed(3).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
  }

  function renderTablesPanel() {
    state.tableRows = new Map();
    while (elements.tablesList.firstChild) {
      elements.tablesList.removeChild(elements.tablesList.firstChild);
    }
    var tables = state.workspace ? state.workspace.tables : [];
    updateSectionCount(byId("dataconsole-tables-count"), tables.length);
    var canExecute = Boolean(state.workspace && state.workspace.canExecute);
    var selectedExists = tables.some(function (table) { return table.id === state.selectedTableId; });
    if (!selectedExists) {
      state.selectedTableId = null;
    }
    elements.toggleMeasurements.disabled = !canExecute;
    elements.toggleMeasurements.setAttribute("aria-pressed",
      state.workspace && state.workspace.measurementsEnabled ? "true" : "false");
    elements.exportTable.disabled = !canExecute || !state.selectedTableId;
    if (!tables.length) {
      appendTextElement(elements.tablesList, "div", "dc-tables-empty", "Выполните запрос");
      return;
    }
    var totalDuration = tables.reduce(function (sum, table) { return sum + table.duration; }, 0);
    tables.forEach(function (table) {
      var isSelected = table.id === state.selectedTableId;
      var row = document.createElement("div");
      row.className = "dc-table-row" + (isSelected ? " dc-selected" : "");
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-pressed", isSelected ? "true" : "false");
      row.setAttribute("aria-label", table.name + ", строк: " + table.rowCount);
      var name = appendTextElement(row, "span", "dc-table-name", table.name);
      name.title = table.name;
      appendTextElement(row, "span", "dc-table-count", String(table.rowCount));
      var duration = appendTextElement(row, "span", "dc-table-duration", state.workspace.measurementsEnabled
        ? durationPresentation(table.duration) : "—");
      if (state.workspace.measurementsEnabled) {
        duration.classList.add(durationClass(table.duration, totalDuration));
        duration.title = durationPresentation(table.duration) + " с";
      }
      row.addEventListener("click", function () { selectTableFromUi(table); });
      row.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.keyCode === 13 || event.key === " " || event.keyCode === 32) {
          selectTableFromUi(table);
          event.preventDefault();
        }
      });
      state.tableRows.set(table.id, row);
      elements.tablesList.appendChild(row);
    });
  }

  function settingsCommandPayload(action, value, name) {
    var payload = {
      sessionId: state.workspace ? state.workspace.sessionId : "",
      action: action,
      value: value === undefined || value === null ? "" : value
    };
    if (name) {
      payload.name = name;
    }
    return payload;
  }

  function requestSettingsCommand(action, value, name) {
    if (!state.workspace) {
      return;
    }
    emitBridgeEvent("EVENT_SETTINGS_COMMAND_REQUESTED", settingsCommandPayload(action, value, name));
  }

  function requestEditorSetting(name, value) {
    requestSettingsCommand("set-editor-option", value, name);
  }

  function applyEditorSettings(settings) {
    if (!state.editor || !settings) {
      return;
    }
    state.editor.updateOptions({
      fontSize: settings.fontSize,
      lineNumbers: settings.lineNumbers ? "on" : "off",
      minimap: { enabled: settings.minimap },
      wordWrap: settings.wordWrap ? "on" : "off",
      renderWhitespace: settings.renderWhitespace ? "all" : "none",
      quickSuggestions: settings.quickSuggestions
    });
    var activeDocument = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : null;
    var useQueryTheme = Boolean(activeDocument && normalizedKind(activeDocument.kind) === "query")
      || settings.queryHighlighting;
    var themeName = (settings.theme === "dark" ? "bsl-dark" : "bsl-white")
      + (useQueryTheme ? "-query" : "");
    if (window.monaco && window.monaco.editor) {
      if (typeof window.setTheme === "function") {
        window.setTheme(themeName);
      } else {
        window.monaco.editor.setTheme(themeName);
      }
    }
    if (settings.statusBar && typeof window.showStatusBar === "function") {
      window.showStatusBar();
    } else if (!settings.statusBar && typeof window.hideStatusBar === "function") {
      window.hideStatusBar();
    }
  }

  function renderSettingsPanel() {
    var settings = state.workspace ? state.workspace.settings : normalizeSettings(null);
    var editorSettings = settings.editor;
    var canChange = Boolean(state.workspace);
    elements.sourceDirectory.value = settings.sourceDirectory;
    elements.variableDisplayMode.value = String(settings.variableDisplayMode);
    elements.savedListLimit.value = String(settings.savedListLimit);
    elements.autoSaveOnExecute.checked = settings.autoSaveOnExecute;
    elements.editorTheme.value = editorSettings.theme;
    elements.editorFontSize.value = String(editorSettings.fontSize);
    elements.editorLineNumbers.checked = editorSettings.lineNumbers;
    elements.editorMinimap.checked = editorSettings.minimap;
    elements.editorWordWrap.checked = editorSettings.wordWrap;
    elements.editorRenderWhitespace.checked = editorSettings.renderWhitespace;
    elements.editorQuickSuggestions.checked = editorSettings.quickSuggestions;
    elements.editorStatusBar.checked = editorSettings.statusBar;
    elements.editorQueryHighlighting.checked = editorSettings.queryHighlighting;
    elements.sourceDirectory.disabled = !canChange;
    elements.chooseSourceDirectory.disabled = !canChange;
    elements.loadCommonModules.disabled = !canChange;
    elements.variableDisplayMode.disabled = !canChange;
    elements.savedListLimit.disabled = !canChange;
    elements.autoSaveOnExecute.disabled = !canChange;
    elements.editorTheme.disabled = !canChange;
    elements.editorFontSize.disabled = !canChange;
    elements.editorLineNumbers.disabled = !canChange;
    elements.editorMinimap.disabled = !canChange;
    elements.editorWordWrap.disabled = !canChange;
    elements.editorRenderWhitespace.disabled = !canChange;
    elements.editorQuickSuggestions.disabled = !canChange;
    elements.editorStatusBar.disabled = !canChange;
    elements.editorQueryHighlighting.disabled = !canChange;
  }

  function setSettingsVisible(visible) {
    state.settingsVisible = Boolean(visible);
    if (state.settingsVisible && !state.parametersVisible) {
      setParametersVisible(true);
    }
    elements.parameters.classList.toggle("dc-settings-visible", state.settingsVisible);
    elements.settings.hidden = !state.settingsVisible;
    elements.toggleSettings.setAttribute("aria-pressed", state.settingsVisible ? "true" : "false");
    var toggleLabel = state.settingsVisible ? "Закрыть настройки" : "Открыть настройки";
    elements.toggleSettings.setAttribute("aria-label", toggleLabel);
    elements.toggleSettings.title = toggleLabel;
    if (state.settingsVisible) {
      renderSettingsPanel();
      window.setTimeout(function () { elements.sourceDirectory.focus(); }, 0);
    }
    window.setTimeout(function () {
      if (state.editor) {
        state.editor.layout();
      }
    }, 0);
  }

  function toggleSettings() {
    setSettingsVisible(state.parametersVisible ? !state.settingsVisible : true);
    return { success: true, visible: state.settingsVisible };
  }

  function fillParametersFromUi() {
    var activeDocument = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : null;
    var algorithm = activeDocument ? state.algorithms.get(activeDocument.algorithmId) : null;
    if (!algorithm || !activeDocument || !state.workspace.canExecute) {
      return;
    }
    var queryDocument = algorithmDocumentByKind(algorithm, "query");
    if (!queryDocument) {
      return;
    }
    if (queryDocument.id !== activeDocument.id) {
      activateDocumentById(queryDocument.id, true);
    }
    requestCommand(queryDocument, "fill-parameters");
  }

  function currentAlgorithm() {
    if (!state.selectedAlgorithmId) {
      return null;
    }
    return state.algorithms.get(state.selectedAlgorithmId) || null;
  }

  function closeWorkbenchDialog(force) {
    if (state.dialogPending && !force) {
      return;
    }
    elements.dialogBackdrop.hidden = true;
    elements.dialogBackdrop.removeAttribute("aria-busy");
    state.dialogConfirm = null;
    state.dialogPending = false;
    state.dialogWaitForWorkspaceUpdate = false;
    state.dialogConfirmLabel = "";
    state.dialogPendingLabel = "";
    state.dialogPendingMessage = "";
    elements.dialogInput.disabled = false;
    elements.dialogCancel.disabled = false;
    elements.dialogConfirm.disabled = false;
    elements.dialogError.hidden = true;
    elements.dialogError.textContent = "";
    if (state.dialogRestoreFocus && typeof state.dialogRestoreFocus.focus === "function") {
      state.dialogRestoreFocus.focus();
    }
    state.dialogRestoreFocus = null;
  }

  function showWorkbenchDialog(options) {
    state.dialogConfirm = options.onConfirm;
    state.dialogRestoreFocus = document.activeElement;
    state.dialogPending = false;
    state.dialogWaitForWorkspaceUpdate = Boolean(options.waitForWorkspaceUpdate);
    state.dialogConfirmLabel = options.confirmLabel || "Продолжить";
    state.dialogPendingLabel = options.pendingLabel || "Выполняется…";
    state.dialogPendingMessage = options.pendingMessage || "Подождите, операция выполняется.";
    elements.dialogTitle.textContent = options.title;
    elements.dialogMessage.textContent = options.message || "";
    elements.dialogInput.hidden = !options.requiresName;
    elements.dialogInput.disabled = false;
    elements.dialogInput.value = options.value || "";
    elements.dialogInput.setAttribute("aria-label", options.inputLabel || options.title);
    elements.dialogError.hidden = true;
    elements.dialogError.textContent = "";
    elements.dialogCancel.disabled = false;
    elements.dialogConfirm.disabled = false;
    elements.dialogConfirm.textContent = state.dialogConfirmLabel;
    elements.dialogBackdrop.removeAttribute("aria-busy");
    elements.dialogBackdrop.hidden = false;
    window.setTimeout(function () {
      if (options.requiresName) {
        elements.dialogInput.focus();
        elements.dialogInput.select();
      } else {
        elements.dialogConfirm.focus();
      }
    }, 0);
  }

  function confirmWorkbenchDialog() {
    if (state.dialogPending) {
      return;
    }
    if (typeof state.dialogConfirm !== "function") {
      closeWorkbenchDialog();
      return;
    }
    var confirmAction = state.dialogConfirm;
    var value = String(elements.dialogInput.value || "").replace(/^\s+|\s+$/g, "");
    if (!elements.dialogInput.hidden && !value) {
      elements.dialogError.textContent = "Введите наименование.";
      elements.dialogError.hidden = false;
      elements.dialogInput.focus();
      return;
    }
    if (state.dialogWaitForWorkspaceUpdate) {
      state.dialogPending = true;
      elements.dialogBackdrop.setAttribute("aria-busy", "true");
      elements.dialogMessage.textContent = state.dialogPendingMessage;
      elements.dialogInput.disabled = true;
      elements.dialogCancel.disabled = true;
      elements.dialogConfirm.disabled = true;
      elements.dialogConfirm.textContent = state.dialogPendingLabel;
    } else {
      closeWorkbenchDialog();
    }
    confirmAction(value);
  }

  function mutationPayload(action, additional) {
    var activeDocument = getActiveDocument();
    var payload = {
      sessionId: state.workspace ? state.workspace.sessionId : "",
      action: action,
      algorithmId: state.selectedAlgorithmId || ""
    };
    if (activeDocument) {
      payload.documentId = activeDocument.documentId;
      payload.documentKind = activeDocument.documentKind;
    }
    if (additional) {
      Object.keys(additional).forEach(function (key) {
        payload[key] = additional[key];
      });
    }
    return payload;
  }

  function requestWorkspaceMutation(action, additional) {
    if (!state.workspace || !state.workspace.canExecute) {
      return;
    }

    // Give the HTML document a chance to paint the closed dialog before the
    // synchronous 1C event handler rebuilds the workspace.
    var payload = mutationPayload(action, additional);
    window.setTimeout(function () {
      emitBridgeEvent("EVENT_WORKSPACE_MUTATION_REQUESTED", payload);
    }, 0);
  }

  function addAlgorithmFromUi(asChild) {
    var algorithm = currentAlgorithm();
    var parentAlgorithmId = asChild && algorithm ? algorithm.id : (algorithm && algorithm.parentId ? algorithm.parentId : "");
    showWorkbenchDialog({
      title: asChild ? "Новый вложенный алгоритм" : "Новый алгоритм",
      message: asChild && algorithm ? "Будет добавлен внутрь «" + algorithm.name + "»." : "Введите наименование алгоритма.",
      inputLabel: "Наименование алгоритма",
      requiresName: true,
      confirmLabel: "Добавить",
      pendingLabel: "Добавление…",
      pendingMessage: "Добавление алгоритма. Подождите…",
      waitForWorkspaceUpdate: true,
      onConfirm: function (name) {
        requestWorkspaceMutation("add-algorithm", { name: name, parentAlgorithmId: parentAlgorithmId });
      }
    });
  }

  function renameAlgorithmFromUi(algorithm) {
    if (!algorithm || !state.workspace || !state.workspace.canExecute) {
      return;
    }
    showWorkbenchDialog({
      title: "Переименование алгоритма",
      message: "Введите новое наименование алгоритма.",
      inputLabel: "Наименование алгоритма",
      requiresName: true,
      value: algorithm.name,
      confirmLabel: "Переименовать",
      onConfirm: function (name) {
        if (name !== algorithm.name) {
          requestWorkspaceMutation("rename-algorithm", { algorithmId: algorithm.id, name: name });
        }
      }
    });
  }

  function deleteAlgorithmFromUi() {
    var algorithm = currentAlgorithm();
    if (!algorithm) {
      return;
    }
    showWorkbenchDialog({
      title: "Удаление алгоритма",
      message: "Удалить «" + algorithm.name + "» вместе с вложенными алгоритмами и их параметрами?",
      requiresName: false,
      confirmLabel: "Удалить",
      pendingLabel: "Удаление…",
      pendingMessage: "Удаление алгоритма. Подождите…",
      waitForWorkspaceUpdate: true,
      onConfirm: function () {
        requestWorkspaceMutation("delete-algorithm", {});
      }
    });
  }

  function addParameterFromUi() {
    var algorithm = currentAlgorithm();
    if (!algorithm) {
      return;
    }
    showWorkbenchDialog({
      title: "Новый параметр",
      message: "Параметр алгоритма «" + algorithm.name + "».",
      inputLabel: "Имя параметра",
      requiresName: true,
      confirmLabel: "Добавить",
      onConfirm: function (name) {
        requestWorkspaceMutation("add-parameter", { name: name });
      }
    });
  }

  function deleteParameterFromUi() {
    var algorithm = currentAlgorithm();
    if (!algorithm || !state.selectedParameterId) {
      return;
    }
    var parameter = algorithm.parameters.filter(function (item) {
      return item.id === state.selectedParameterId;
    })[0];
    if (!parameter) {
      return;
    }
    showWorkbenchDialog({
      title: "Удаление параметра",
      message: "Удалить параметр «" + parameter.name + "»?",
      requiresName: false,
      confirmLabel: "Удалить",
      onConfirm: function () {
        requestWorkspaceMutation("delete-parameter", { parameterId: parameter.id });
      }
    });
  }

  function copySelectedParameterFromUi() {
    if (state.workspaceBusy || !state.workspace || !state.workspace.canExecute || !elements.dialogBackdrop.hidden) {
      return false;
    }
    var algorithm = currentAlgorithm();
    if (!algorithm || !state.selectedParameterId || !algorithm.parameters.some(function (parameter) {
      return parameter.id === state.selectedParameterId;
    })) {
      return false;
    }
    requestWorkspaceMutation("copy-parameter", {
      algorithmId: algorithm.id,
      parameterId: state.selectedParameterId
    });
    return true;
  }

  function collectSearchResults(roots, query) {
    var visible = new Map();
    var direct = new Map();

    function visit(algorithm) {
      var ownMatch = algorithm.searchIndex.indexOf(query) >= 0;
      var childMatch = false;
      for (var documentIndex = 0; documentIndex < algorithm.documents.length; documentIndex += 1) {
        if (algorithm.documents[documentIndex].searchIndex.indexOf(query) >= 0) {
          ownMatch = true;
          break;
        }
      }
      algorithm.children.forEach(function (child) {
        if (visit(child)) {
          childMatch = true;
        }
      });
      if (ownMatch) {
        direct.set(algorithm.id, true);
      }
      if (ownMatch || childMatch) {
        visible.set(algorithm.id, true);
        return true;
      }
      return false;
    }

    roots.forEach(visit);
    return { visible: visible, direct: direct };
  }

  function createAlgorithmNode(algorithm, order, searchResults) {
    var node = document.createElement("div");
    var heading = document.createElement("div");
    var twistie = document.createElement("button");
    var body = document.createElement("div");
    var visibleChildren = searchResults
      ? algorithm.children.filter(function (child) { return searchResults.visible.has(child.id); })
      : algorithm.children;
    var hasBody = visibleChildren.length;
    var expanded;
    if (state.searchQuery) {
      expanded = state.searchExpandedAlgorithms.has(algorithm.id)
        ? state.searchExpandedAlgorithms.get(algorithm.id)
        : true;
    } else {
      expanded = state.expandedAlgorithms.has(algorithm.id) ? state.expandedAlgorithms.get(algorithm.id) : algorithm.depth < 2;
    }

    var isSelected = state.selectedAlgorithmId === algorithm.id;
    node.className = "dc-algorithm";
    node.setAttribute("role", "treeitem");
    node.setAttribute("aria-level", String(algorithm.depth + 1));
    node.setAttribute("aria-selected", isSelected ? "true" : "false");
    node.style.animationDelay = String(Math.min(order * 16, 160)) + "ms";
    heading.className = "dc-algorithm-heading" + (isSelected ? " dc-selected" : "");
    heading.tabIndex = 0;
    twistie.type = "button";
    twistie.className = "dc-twistie" + (hasBody ? "" : " dc-twistie-empty");
    twistie.setAttribute("aria-label", (expanded ? "Свернуть " : "Развернуть ") + algorithm.name);
    twistie.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (!hasBody) {
      twistie.tabIndex = -1;
    }
    heading.appendChild(twistie);
    var icon = document.createElement("span");
    icon.className = "dc-algorithm-icon" + (algorithm.documents.length ? " dc-algorithm-icon-code" : "");
    icon.setAttribute("aria-hidden", "true");
    heading.appendChild(icon);
    var algorithmName = appendTextElement(heading, "span", "dc-algorithm-name", algorithm.name);
    algorithmName.title = algorithm.name;
    var documentButtons = null;
    if (algorithm.documents.length) {
      documentButtons = createTreeDocumentButtons(algorithm);
      heading.appendChild(documentButtons);
    }
    node.appendChild(heading);

    body.className = "dc-algorithm-body";
    body.hidden = !expanded;
    if (visibleChildren.length) {
      var children = document.createElement("div");
      children.className = "dc-children";
      children.setAttribute("role", "group");
      visibleChildren.forEach(function (child, childIndex) {
        children.appendChild(createAlgorithmNode(child, order + childIndex + 1, searchResults));
      });
      body.appendChild(children);
    }
    node.appendChild(body);
    state.algorithmNodes.set(algorithm.id, {
      node: node,
      heading: heading,
      twistie: twistie,
      body: body,
      name: algorithmName,
      documentButtons: documentButtons
    });

    heading.addEventListener("click", function () {
      if (state.selectedAlgorithmId === algorithm.id) {
        renameAlgorithmFromUi(algorithm);
      } else {
        activateAlgorithmFromUi(algorithm);
        heading.focus();
      }
    });
    heading.addEventListener("contextmenu", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openAlgorithmContextMenu(event, algorithm);
    });
    heading.addEventListener("keydown", function (event) {
      if (event.key === "F2" || event.keyCode === 113) {
        if (state.selectedAlgorithmId !== algorithm.id) {
          selectAlgorithmInTree(algorithm.id, true);
        }
        renameAlgorithmFromUi(algorithm);
        event.preventDefault();
      } else if (event.key === "Enter" || event.keyCode === 13 || event.key === " " || event.keyCode === 32) {
        activateAlgorithmFromUi(algorithm);
        heading.focus();
        event.preventDefault();
      }
    });

    twistie.addEventListener("click", function (event) {
      if (event && event.stopPropagation) {
        event.stopPropagation();
      }
      if (!hasBody) {
        return;
      }
      var nextExpanded = twistie.getAttribute("aria-expanded") !== "true";
      twistie.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
      twistie.setAttribute("aria-label", (nextExpanded ? "Свернуть " : "Развернуть ") + algorithm.name);
      body.hidden = !nextExpanded;
      if (state.searchQuery) {
        state.searchExpandedAlgorithms.set(algorithm.id, nextExpanded);
      } else {
        state.expandedAlgorithms.set(algorithm.id, nextExpanded);
      }
    });

    return node;
  }

  function renderFileState() {
    var hasWorkspace = Boolean(state.workspace);
    var canChange = Boolean(state.workspace && state.workspace.canExecute && !state.workspaceBusy);
    var canOpen = Boolean(hasWorkspace && !state.workspaceBusy);
    var displayName = hasWorkspace ? (state.workspace.fileName || "Без имени") : "Рабочая область не открыта";
    elements.fileName.textContent = displayName;
    elements.fileName.title = displayName;
    elements.fileName.classList.toggle("dc-modified", Boolean(hasWorkspace && state.workspace.modified));
    elements.newWorkspace.disabled = !canChange;
    elements.openWorkspace.disabled = !canOpen;
    elements.saveWorkspace.disabled = !canChange;
    elements.saveWorkspaceAs.disabled = !canChange;
    elements.emptyInitializing.hidden = state.workspaceInitialized;
    elements.emptyRetry.hidden = state.workspaceInitialized || !state.initializationRetryVisible;
    elements.emptyOpen.hidden = !state.workspaceInitialized;
    elements.emptyOpen.disabled = state.workspaceBusy;
  }

  function scheduleInitializationRetry() {
    if (state.initializationRetryTimer !== null) {
      window.clearTimeout(state.initializationRetryTimer);
    }
    state.initializationRetryVisible = false;
    state.initializationRetryTimer = window.setTimeout(function () {
      state.initializationRetryTimer = null;
      if (!state.workspaceInitialized) {
        state.initializationRetryVisible = true;
        renderFileState();
      }
    }, 15000);
  }

  function retryInitializationAfterCacheClear() {
    var eventButton = byId("event-button");
    if (state.workspaceInitialized || !eventButton) {
      return;
    }
    state.initializationRetryVisible = false;
    renderFileState();
    var eventData = {
      event: "EVENT_WORKSPACE_CACHE_RESET_REQUESTED",
      params: {}
    };
    if (Array.isArray(window.events_queue)) {
      window.events_queue.push(eventData);
    }
    var attachEventData = function (event) {
      event.eventData1C = eventData;
    };
    eventButton.addEventListener("click", attachEventData, true);
    try {
      eventButton.click();
    } finally {
      eventButton.removeEventListener("click", attachEventData, true);
    }
  }

  function setWorkspaceBusy(payloadJson) {
    try {
      var payload = parseJsonValue(payloadJson, "setWorkspaceBusy");
      var operationId = requiredIdentity(payload.operationId, "operationId");
      if (typeof payload.busy !== "boolean") {
        throw new Error("Поле busy должно иметь тип Булево.");
      }
      if (payload.message !== undefined && payload.message !== null && typeof payload.message !== "string") {
        throw new Error("Поле message должно иметь тип Строка.");
      }
      if (payload.fileName !== undefined && payload.fileName !== null && typeof payload.fileName !== "string") {
        throw new Error("Поле fileName должно иметь тип Строка.");
      }

      if (!payload.busy && state.workspaceBusy && operationId !== state.workspaceBusyOperationId) {
        return { success: true, applied: false, stale: true };
      }

      state.workspaceBusy = payload.busy;
      state.workspaceBusyOperationId = payload.busy ? operationId : "";
      elements.workbench.setAttribute("aria-busy", payload.busy ? "true" : "false");
      if (payload.busy) {
        elements.workspaceBusyMessage.textContent = payload.message || "Загрузка файла алгоритмов…";
        elements.workspaceBusyFile.textContent = payload.fileName || "";
        elements.workspaceBusyFile.hidden = !payload.fileName;
        elements.workspaceBusy.hidden = false;
      } else {
        elements.workspaceBusy.hidden = true;
        elements.workspaceBusyFile.textContent = "";
        elements.workspaceBusyFile.hidden = true;
      }
      renderFileState();
      updateMutationButtonStates(currentAlgorithm());
      return { success: true, applied: true, busy: state.workspaceBusy };
    } catch (error) {
      return reportError("setWorkspaceBusy", error);
    }
  }

  function renderWorkspace() {
    if (!elements.tree) {
      cacheElements();
    }
    state.documentButtons = new Map();
    state.algorithmNodes = new Map();
    while (elements.tree.firstChild) {
      elements.tree.removeChild(elements.tree.firstChild);
    }

    renderFileState();
    if (!state.workspace) {
      elements.explorerEmpty.hidden = false;
      elements.searchEmpty.hidden = true;
      elements.editorEmpty.hidden = false;
      updateModeBar();
      renderTablesPanel();
      renderSettingsPanel();
      return;
    }

    var searchResults = state.searchQuery ? collectSearchResults(state.workspace.algorithms, state.searchQuery) : null;
    var hasSearchMatches = !searchResults || searchResults.visible.size > 0;
    elements.explorerEmpty.hidden = state.workspace.algorithms.length > 0 || Boolean(state.searchQuery);
    elements.searchEmpty.hidden = !state.searchQuery || hasSearchMatches;
    state.workspace.algorithms.forEach(function (algorithm, index) {
      if (!searchResults || searchResults.visible.has(algorithm.id)) {
        elements.tree.appendChild(createAlgorithmNode(algorithm, index, searchResults));
      }
    });
    elements.editorEmpty.hidden = Boolean(state.activeDocumentId);
    updateModeBar();
    renderTablesPanel();
    renderSettingsPanel();
  }

  function disposeObsoleteModels(nextDocuments) {
    var obsoleteIds = [];
    state.models.forEach(function (model, documentId) {
      if (!nextDocuments.has(documentId)) {
        obsoleteIds.push(documentId);
      }
    });
    obsoleteIds.forEach(function (documentId) {
      var model = state.models.get(documentId);
      if (state.editor && state.editor.getModel() === model && state.legacyModel && !state.legacyModel.isDisposed()) {
        state.editor.setModel(state.legacyModel);
      }
      if (model && !model.isDisposed()) {
        model.dispose();
      }
      state.models.delete(documentId);
      state.viewStates.delete(documentId);
    });
  }

  function modelUri(documentId) {
    var sessionId = state.workspace ? state.workspace.sessionId : "workspace";
    return "inmemory://dataconsole/" + encodeURIComponent(sessionId || "workspace") + "/" + encodeURIComponent(documentId);
  }

  function getOrCreateModel(documentItem) {
    var model = state.models.get(documentItem.id);
    var description = kindDescription(documentItem.kind);
    if (model && !model.isDisposed()) {
      if (model.getValue() !== documentItem.text) {
        state.suppressContentEvents = true;
        try {
          model.setValue(documentItem.text);
        } finally {
          state.suppressContentEvents = false;
        }
      }
      window.monaco.editor.setModelLanguage(model, description.language);
      return model;
    }
    model = window.monaco.editor.createModel(
      documentItem.text,
      description.language,
      window.monaco.Uri.parse(modelUri(documentItem.id))
    );
    state.models.set(documentItem.id, model);
    return model;
  }

  function saveActiveViewState() {
    if (state.editor && state.activeDocumentId) {
      state.viewStates.set(state.activeDocumentId, state.editor.saveViewState());
    }
  }

  function findDocument(algorithmId, documentKind) {
    var algorithm = state.algorithms.get(String(algorithmId));
    if (!algorithm) {
      throw new Error("Алгоритм не найден: " + algorithmId + ".");
    }
    var documentItem = algorithmDocumentByKind(algorithm, documentKind);
    if (documentItem) {
      return documentItem;
    }
    throw new Error("Документ вида " + documentKind + " не найден в алгоритме " + algorithmId + ".");
  }

  function activateDocumentById(documentId, emitEvent) {
    var documentItem = state.documents.get(String(documentId));
    var previousDocumentId = state.activeDocumentId;
    var model;
    var viewState;

    if (!documentItem) {
      throw new Error("Документ не найден: " + documentId + ".");
    }
    if (!state.editor || !window.monaco) {
      state.pendingDocumentId = documentItem.id;
      return {
        documentId: documentItem.id,
        algorithmId: documentItem.algorithmId,
        documentKind: documentItem.kind,
        pending: true
      };
    }

    saveActiveViewState();
    model = getOrCreateModel(documentItem);
    state.suppressContentEvents = true;
    try {
      state.editor.setModel(model);
      if (typeof window.setLanguageMode === "function") {
        window.setLanguageMode(kindDescription(documentItem.kind).language);
      }
      viewState = state.viewStates.get(documentItem.id);
      if (viewState) {
        state.editor.restoreViewState(viewState);
      } else {
        state.editor.setPosition({ lineNumber: 1, column: 1 });
        state.editor.setScrollTop(0);
        state.editor.setScrollLeft(0);
      }
    } finally {
      state.suppressContentEvents = false;
    }

    state.activeDocumentId = documentItem.id;
    state.pendingDocumentId = null;
    applyEditorSettings(state.workspace.settings.editor);
    selectAlgorithmInTree(documentItem.algorithmId);
    if (previousDocumentId) {
      updateDocumentButtonState(previousDocumentId);
    }
    updateDocumentButtonState(documentItem.id);
    updateModeBar();
    if (elements.editorEmpty) {
      elements.editorEmpty.hidden = true;
    }
    state.editor.layout();
    state.editor.focus();

    var active = {
      documentId: documentItem.id,
      algorithmId: documentItem.algorithmId,
      documentKind: documentItem.kind
    };
    if (emitEvent) {
      emitBridgeEvent("EVENT_DOCUMENT_ACTIVATED", active);
    }
    return active;
  }

  function activateDocumentInternal(algorithmId, documentKind, emitEvent) {
    try {
      return activateDocumentById(findDocument(algorithmId, documentKind).id, emitEvent);
    } catch (error) {
      return { errorDescription: error.message };
    }
  }

  function loadWorkspace(workspaceJson) {
    try {
      var parsed = parseJsonValue(workspaceJson, "loadWorkspace");
      var indexed = validateAndIndexWorkspace(parsed);
      var previousActiveId = state.activeDocumentId;
      disposeObsoleteModels(indexed.documents);
      state.workspace = indexed.workspace;
      state.algorithms = indexed.algorithms;
      state.documents = indexed.documents;
      state.activeDocumentId = null;
      state.selectedAlgorithmId = null;
      state.selectedParameterId = null;
      state.selectedTableId = state.workspace.selectedTableId || null;
      state.parameterHint = { documentId: "", visible: false, items: [] };

      state.suppressContentEvents = true;
      try {
        state.models.forEach(function (model, documentId) {
          var documentItem = state.documents.get(documentId);
          if (documentItem && !model.isDisposed()) {
            if (model.getValue() !== documentItem.text) {
              model.setValue(documentItem.text);
            }
            window.monaco.editor.setModelLanguage(model, kindDescription(documentItem.kind).language);
          }
        });
      } finally {
        state.suppressContentEvents = false;
      }

      var selectedAlgorithm = state.workspace.selectedAlgorithmId
        ? state.algorithms.get(state.workspace.selectedAlgorithmId)
        : null;
      var previousDocument = previousActiveId && state.documents.has(previousActiveId)
        ? state.documents.get(previousActiveId)
        : null;
      var nextDocument = previousDocument && (!selectedAlgorithm || previousDocument.algorithmId === selectedAlgorithm.id)
        ? previousDocument
        : (selectedAlgorithm ? preferredDocumentForAlgorithm(selectedAlgorithm) : indexed.orderedDocuments[0]);
      if (nextDocument) {
        state.selectedAlgorithmId = nextDocument.algorithmId;
        revealSelectedAlgorithm(nextDocument.algorithmId);
      } else {
        state.expandedAlgorithms = new Map();
        state.searchExpandedAlgorithms = new Map();
      }
      renderWorkspace();
      if (nextDocument) {
        restoreSelectedAlgorithmPosition(nextDocument.algorithmId);
      }
      applyEditorSettings(state.workspace.settings.editor);

      if (nextDocument) {
        activateDocumentById(nextDocument.id, false);
      }
      state.workspaceInitialized = true;
      state.initializationRetryVisible = false;
      if (state.initializationRetryTimer !== null) {
        window.clearTimeout(state.initializationRetryTimer);
        state.initializationRetryTimer = null;
      }
      renderFileState();
      return {
        success: true,
        sessionId: state.workspace.sessionId,
        documentCount: indexed.orderedDocuments.length
      };
    } catch (error) {
      return reportError("loadWorkspace", error);
    }
  }

  function validatePatch(patch) {
    if (!Object.prototype.hasOwnProperty.call(patch, "operations")) {
      throw new Error("Неподдерживаемый формат patch: требуется массив operations.");
    }
    var operations = asArray(patch.operations, "patch.operations");
    operations.forEach(function (operation) {
      if (!operation || typeof operation !== "object") {
        throw new Error("Операция patch должна быть объектом.");
      }
      if (operation.op === "addAlgorithm") {
        var parentAlgorithmId = operation.parentAlgorithmId === undefined || operation.parentAlgorithmId === null
          ? ""
          : String(operation.parentAlgorithmId);
        if (parentAlgorithmId && !state.algorithms.has(parentAlgorithmId)) {
          throw new Error("Родительский алгоритм не найден: " + parentAlgorithmId + ".");
        }
        var indexedAlgorithm = validateAndIndexWorkspace({
          sessionId: state.workspace.sessionId,
          algorithms: [operation.algorithm],
          tables: [],
          settings: {}
        });
        var addedAlgorithms = [];
        var addedDocuments = [];
        collectAlgorithmTree(indexedAlgorithm.workspace.algorithms[0], addedAlgorithms, addedDocuments);
        addedAlgorithms.forEach(function (algorithm) {
          if (state.algorithms.has(algorithm.id)) {
            throw new Error("Повторяется идентификатор алгоритма: " + algorithm.id + ".");
          }
        });
        addedDocuments.forEach(function (documentItem) {
          if (state.documents.has(documentItem.id)) {
            throw new Error("Повторяется идентификатор документа: " + documentItem.id + ".");
          }
        });
        setAlgorithmDepth(indexedAlgorithm.workspace.algorithms[0], parentAlgorithmId || null,
          parentAlgorithmId ? state.algorithms.get(parentAlgorithmId).depth + 1 : 0);
        operation.normalizedAlgorithm = indexedAlgorithm.workspace.algorithms[0];
        operation.normalizedSelectedAlgorithmId = requiredIdentity(
          operation.selectedAlgorithmId === undefined || operation.selectedAlgorithmId === null
            ? operation.normalizedAlgorithm.id
            : operation.selectedAlgorithmId,
          "operation.selectedAlgorithmId");
        if (!addedAlgorithms.some(function (algorithm) {
          return algorithm.id === operation.normalizedSelectedAlgorithmId;
        })) {
          throw new Error("Выбранный алгоритм не входит в добавляемую ветку.");
        }
        return;
      }
      if (operation.op === "removeAlgorithm") {
        var removeAlgorithmId = requiredIdentity(operation.algorithmId, "operation.algorithmId");
        if (!state.algorithms.has(removeAlgorithmId)) {
          throw new Error("Алгоритм не найден: " + removeAlgorithmId + ".");
        }
        operation.algorithmId = removeAlgorithmId;
        operation.normalizedSelectedAlgorithmId = operation.selectedAlgorithmId === undefined
          || operation.selectedAlgorithmId === null
          ? ""
          : String(operation.selectedAlgorithmId);
        if (operation.normalizedSelectedAlgorithmId) {
          if (!state.algorithms.has(operation.normalizedSelectedAlgorithmId)) {
            throw new Error("Выбранный алгоритм не найден: " + operation.normalizedSelectedAlgorithmId + ".");
          }
          var removedAlgorithmIds = [];
          collectAlgorithmTree(state.algorithms.get(removeAlgorithmId), removedAlgorithmIds, []);
          if (removedAlgorithmIds.some(function (algorithm) {
            return algorithm.id === operation.normalizedSelectedAlgorithmId;
          })) {
            throw new Error("После удаления выбран удаляемый алгоритм.");
          }
        }
        return;
      }
      if (operation.op === "replaceDocumentText") {
        requiredIdentity(operation.documentId, "operation.documentId");
        if (!state.documents.has(String(operation.documentId))) {
          throw new Error("Документ не найден: " + operation.documentId + ".");
        }
        if (operation.text === undefined || operation.text === null) {
          throw new Error("replaceDocumentText требует поле text.");
        }
        return;
      }
      if (operation.op === "updateParameter") {
        var algorithmId = requiredIdentity(operation.algorithmId, "operation.algorithmId");
        var parameterId = requiredIdentity(operation.parameterId, "operation.parameterId");
        var algorithm = state.algorithms.get(algorithmId);
        if (!algorithm) {
          throw new Error("Алгоритм не найден: " + algorithmId + ".");
        }
        var parameterExists = algorithm.parameters.some(function (parameter) {
          return parameter.id === parameterId;
        });
        if (!parameterExists) {
          throw new Error("Параметр не найден: " + parameterId + ".");
        }
        return;
      }
      if (operation.op === "replaceAlgorithmParameters") {
        var replaceAlgorithmId = requiredIdentity(operation.algorithmId, "operation.algorithmId");
        if (!state.algorithms.has(replaceAlgorithmId)) {
          throw new Error("Алгоритм не найден: " + replaceAlgorithmId + ".");
        }
        var rawParameters = asArray(operation.parameters, "operation.parameters");
        var parameterIds = new Map();
        operation.normalizedParameters = rawParameters.map(function (rawParameter) {
          var parameter = normalizeParameter(rawParameter, "operation.parameters");
          if (parameterIds.has(parameter.id)) {
            throw new Error("Повторяется идентификатор параметра: " + parameter.id + ".");
          }
          parameterIds.set(parameter.id, true);
          return parameter;
        });
        operation.selectedParameterId = operation.selectedParameterId === undefined || operation.selectedParameterId === null
          ? ""
          : String(operation.selectedParameterId);
        return;
      }
      if (operation.op === "renameAlgorithm") {
        var renameAlgorithmId = requiredIdentity(operation.algorithmId, "operation.algorithmId");
        if (!state.algorithms.has(renameAlgorithmId)) {
          throw new Error("Алгоритм не найден: " + renameAlgorithmId + ".");
        }
        operation.normalizedName = String(operation.name === undefined || operation.name === null ? "" : operation.name)
          .replace(/^\s+|\s+$/g, "");
        if (!operation.normalizedName) {
          throw new Error("renameAlgorithm требует непустое поле name.");
        }
        return;
      }
      if (operation.op === "replaceTables") {
        var rawTables = asArray(operation.tables, "operation.tables");
        var tableIds = new Map();
        operation.normalizedTables = rawTables.map(function (rawTable) {
          var table = normalizeTable(rawTable, "operation.tables");
          if (tableIds.has(table.id)) {
            throw new Error("Повторяется идентификатор таблицы: " + table.id + ".");
          }
          tableIds.set(table.id, true);
          return table;
        });
        operation.selectedTableId = operation.selectedTableId === undefined || operation.selectedTableId === null
          ? ""
          : String(operation.selectedTableId);
        operation.measurementsEnabled = Boolean(operation.measurementsEnabled);
        return;
      }
      if (operation.op === "replaceSettings") {
        operation.normalizedSettings = normalizeSettings(operation.settings);
        return;
      }
      if (operation.op === "replaceFileState") {
        operation.normalizedFileName = operation.fileName === undefined || operation.fileName === null
          ? ""
          : String(operation.fileName);
        operation.normalizedModified = Boolean(operation.modified);
        return;
      }
      if (operation.op === "replaceParameterHint") {
        var hintDocumentId = requiredIdentity(operation.documentId, "operation.documentId");
        if (!state.documents.has(hintDocumentId)) {
          throw new Error("Документ не найден: " + hintDocumentId + ".");
        }
        operation.normalizedItems = asArray(operation.items, "operation.items").map(function (rawItem) {
          return normalizeParameterHintItem(rawItem, "operation.items");
        });
        operation.normalizedDocumentId = hintDocumentId;
        operation.normalizedVisible = Boolean(operation.visible);
        return;
      }
      throw new Error("Неподдерживаемая операция patch: " + String(operation.op) + ".");
    });
    return operations;
  }

  function applyAddAlgorithmPatch(operation) {
    var algorithm = operation.normalizedAlgorithm;
    var parentAlgorithm = algorithm.parentId ? state.algorithms.get(algorithm.parentId) : null;
    var renderedParent;
    var renderedNode;
    var targetAlgorithm;
    var targetDocument;

    registerAlgorithmTree(algorithm);
    if (parentAlgorithm) {
      parentAlgorithm.children.push(algorithm);
    } else {
      state.workspace.algorithms.push(algorithm);
    }
    state.workspace.modified = operation.modified === undefined ? true : Boolean(operation.modified);
    state.workspace.selectedAlgorithmId = operation.normalizedSelectedAlgorithmId;

    if (state.searchQuery) {
      renderWorkspace();
    } else {
      renderedParent = parentAlgorithm ? state.algorithmNodes.get(parentAlgorithm.id) : null;
      renderedNode = createAlgorithmNode(
        algorithm,
        parentAlgorithm ? parentAlgorithm.children.length - 1 : state.workspace.algorithms.length - 1,
        null
      );
      if (renderedParent) {
        ensureAlgorithmChildrenContainer(renderedParent).appendChild(renderedNode);
        updateRenderedAlgorithmChildrenState(parentAlgorithm.id);
      } else {
        elements.tree.appendChild(renderedNode);
      }
      elements.explorerEmpty.hidden = state.workspace.algorithms.length > 0;
      elements.searchEmpty.hidden = true;
    }

    state.selectedParameterId = null;
    targetAlgorithm = state.algorithms.get(operation.normalizedSelectedAlgorithmId);
    if (targetAlgorithm) {
      selectAlgorithmInTree(targetAlgorithm.id, true);
      targetDocument = preferredDocumentForAlgorithm(targetAlgorithm);
      if (targetDocument) {
        activateDocumentById(targetDocument.id, false);
      } else {
        clearActiveDocument();
      }
    } else {
      clearActiveDocument();
    }
    renderFileState();
    completePendingWorkspaceMutation();
  }

  function applyRemoveAlgorithmPatch(operation) {
    var algorithm = state.algorithms.get(operation.algorithmId);
    var parentAlgorithm = algorithm.parentId ? state.algorithms.get(algorithm.parentId) : null;
    var removedAlgorithms = [];
    var removedDocuments = [];
    var rendered = state.algorithmNodes.get(algorithm.id);
    var selectedAlgorithm;
    var selectedDocument;

    collectAlgorithmTree(algorithm, removedAlgorithms, removedDocuments);
    if (state.activeDocumentId && removedDocuments.some(function (documentItem) {
      return documentItem.id === state.activeDocumentId;
    })) {
      clearActiveDocument();
    }

    if (parentAlgorithm) {
      parentAlgorithm.children = parentAlgorithm.children.filter(function (child) {
        return child.id !== algorithm.id;
      });
    } else {
      state.workspace.algorithms = state.workspace.algorithms.filter(function (root) {
        return root.id !== algorithm.id;
      });
    }

    removedDocuments.forEach(function (documentItem) {
      state.documentButtons.delete(documentItem.id);
      var model = state.models.get(documentItem.id);
      if (model && !model.isDisposed()) {
        model.dispose();
      }
      state.models.delete(documentItem.id);
      state.viewStates.delete(documentItem.id);
      state.documents.delete(documentItem.id);
    });
    removedAlgorithms.forEach(function (removedAlgorithm) {
      state.algorithmNodes.delete(removedAlgorithm.id);
      state.algorithms.delete(removedAlgorithm.id);
      state.expandedAlgorithms.delete(removedAlgorithm.id);
      state.searchExpandedAlgorithms.delete(removedAlgorithm.id);
    });
    if (rendered && rendered.node.parentNode) {
      rendered.node.parentNode.removeChild(rendered.node);
    }
    if (parentAlgorithm) {
      updateRenderedAlgorithmChildrenState(parentAlgorithm.id);
    }

    state.workspace.modified = operation.modified === undefined ? true : Boolean(operation.modified);
    state.workspace.selectedAlgorithmId = operation.normalizedSelectedAlgorithmId;
    state.selectedParameterId = null;
    if (state.searchQuery) {
      renderWorkspace();
    } else {
      elements.explorerEmpty.hidden = state.workspace.algorithms.length > 0;
      elements.searchEmpty.hidden = true;
    }

    selectedAlgorithm = state.algorithms.get(operation.normalizedSelectedAlgorithmId);
    if (selectedAlgorithm) {
      selectAlgorithmInTree(selectedAlgorithm.id, true);
      selectedDocument = preferredDocumentForAlgorithm(selectedAlgorithm);
      if (selectedDocument) {
        activateDocumentById(selectedDocument.id, false);
      } else {
        clearActiveDocument();
      }
    } else {
      state.selectedAlgorithmId = null;
      clearActiveDocument();
    }
    renderFileState();
    completePendingWorkspaceMutation();
  }

  function applyPatch(patchJson) {
    try {
      if (!state.workspace) {
        throw new Error("Рабочая область еще не загружена.");
      }
      var patch = parseJsonValue(patchJson, "applyPatch");
      var operations = validatePatch(patch);
      operations.forEach(function (operation) {
        if (operation.op === "addAlgorithm") {
          applyAddAlgorithmPatch(operation);
        } else if (operation.op === "removeAlgorithm") {
          applyRemoveAlgorithmPatch(operation);
        } else if (operation.op === "replaceDocumentText") {
          var documentItem = state.documents.get(String(operation.documentId));
          documentItem.text = String(operation.text);
          documentItem.hasContent = operation.hasContent === undefined
            ? documentItem.text.length > 0
            : Boolean(operation.hasContent);
          rebuildDocumentSearchIndex(documentItem);
          var model = state.models.get(documentItem.id);
          if (model && !model.isDisposed() && model.getValue() !== documentItem.text) {
            state.suppressContentEvents = true;
            try {
              model.setValue(documentItem.text);
            } finally {
              state.suppressContentEvents = false;
            }
          }
          updateDocumentButtonState(documentItem.id);
        } else if (operation.op === "updateParameter") {
          var algorithm = state.algorithms.get(String(operation.algorithmId));
          algorithm.parameters.forEach(function (parameter) {
            if (parameter.id === String(operation.parameterId)) {
              parameter.presentation = operation.presentation === undefined ? "" : String(operation.presentation);
              if (operation.typeName !== undefined) {
                parameter.typeName = String(operation.typeName);
              }
              rebuildAlgorithmSearchIndex(algorithm);
            }
          });
        } else if (operation.op === "replaceAlgorithmParameters") {
          var parametersAlgorithm = state.algorithms.get(String(operation.algorithmId));
          parametersAlgorithm.parameters = operation.normalizedParameters;
          rebuildAlgorithmSearchIndex(parametersAlgorithm);
          if (operation.selectedParameterId && parametersAlgorithm.parameters.some(function (parameter) {
            return parameter.id === operation.selectedParameterId;
          })) {
            state.selectedParameterId = operation.selectedParameterId;
          } else if (!parametersAlgorithm.parameters.some(function (parameter) {
            return parameter.id === state.selectedParameterId;
          })) {
            state.selectedParameterId = null;
          }
        } else if (operation.op === "renameAlgorithm") {
          var renamedAlgorithm = state.algorithms.get(String(operation.algorithmId));
          renamedAlgorithm.name = operation.normalizedName;
          rebuildAlgorithmSearchIndex(renamedAlgorithm);
          var renderedAlgorithm = state.algorithmNodes.get(renamedAlgorithm.id);
          if (renderedAlgorithm) {
            renderedAlgorithm.name.textContent = renamedAlgorithm.name;
            renderedAlgorithm.name.title = renamedAlgorithm.name;
            var isExpanded = renderedAlgorithm.twistie.getAttribute("aria-expanded") === "true";
            renderedAlgorithm.twistie.setAttribute("aria-label", (isExpanded ? "Свернуть " : "Развернуть ") + renamedAlgorithm.name);
            if (renderedAlgorithm.documentButtons) {
              renderedAlgorithm.documentButtons.setAttribute("aria-label", "Документы алгоритма " + renamedAlgorithm.name);
            }
          }
          if (state.selectedAlgorithmId === renamedAlgorithm.id) {
            elements.parametersAlgorithm.textContent = renamedAlgorithm.name;
            elements.parametersAlgorithm.title = renamedAlgorithm.name;
          }
        } else if (operation.op === "replaceTables") {
          state.workspace.tables = operation.normalizedTables;
          state.workspace.measurementsEnabled = operation.measurementsEnabled;
          state.selectedTableId = operation.selectedTableId || null;
        } else if (operation.op === "replaceSettings") {
          state.workspace.settings = operation.normalizedSettings;
        } else if (operation.op === "replaceFileState") {
          state.workspace.fileName = operation.normalizedFileName;
          state.workspace.modified = operation.normalizedModified;
        } else if (operation.op === "replaceParameterHint") {
          state.parameterHint = {
            documentId: operation.normalizedDocumentId,
            visible: operation.normalizedVisible,
            items: operation.normalizedItems
          };
        }
      });
      var parametersChanged = operations.some(function (operation) {
        return operation.op === "updateParameter" || operation.op === "replaceAlgorithmParameters";
      });
      var tablesChanged = operations.some(function (operation) { return operation.op === "replaceTables"; });
      var settingsChanged = operations.some(function (operation) { return operation.op === "replaceSettings"; });
      var fileStateChanged = operations.some(function (operation) { return operation.op === "replaceFileState"; });
      var parameterHintChanged = operations.some(function (operation) { return operation.op === "replaceParameterHint"; });
      if (state.searchQuery) {
        renderWorkspace();
      } else if (parametersChanged) {
        var activeDocument = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : null;
        var activeAlgorithm = activeDocument ? state.algorithms.get(activeDocument.algorithmId) : null;
        renderParametersPanel(activeAlgorithm, activeDocument);
      }
      if (tablesChanged) {
        renderTablesPanel();
      }
      if (settingsChanged) {
        renderSettingsPanel();
        applyEditorSettings(state.workspace.settings.editor);
        var activeDocument = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : null;
        var activeAlgorithm = activeDocument ? state.algorithms.get(activeDocument.algorithmId) : null;
        renderActionBar(activeAlgorithm, activeDocument);
      }
      if (fileStateChanged) {
        renderFileState();
      }
      if (parameterHintChanged && !settingsChanged) {
        var hintActiveDocument = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : null;
        renderParameterHint(hintActiveDocument);
      }
      return { success: true, applied: operations.length };
    } catch (error) {
      failPendingWorkspaceMutation(error.message);
      return reportError("applyPatch", error);
    }
  }

  function activateDocument(algorithmId, documentKind) {
    var result = activateDocumentInternal(algorithmId, documentKind, false);
    if (result && result.errorDescription) {
      return reportError("activateDocument", new Error(result.errorDescription));
    }
    return result;
  }

  function getActiveDocument() {
    if (!state.activeDocumentId) {
      return null;
    }
    var item = state.documents.get(state.activeDocumentId);
    return {
      documentId: item.id,
      algorithmId: item.algorithmId,
      documentKind: item.kind
    };
  }

  function getDocumentText(documentId) {
    try {
      var id = requiredIdentity(documentId, "documentId");
      var item = state.documents.get(id);
      if (!item) {
        throw new Error("Документ не найден: " + id + ".");
      }
      var model = state.models.get(id);
      return model && !model.isDisposed() ? model.getValue() : item.text;
    } catch (error) {
      return reportError("getDocumentText", error);
    }
  }

  function getWorkspaceSnapshot() {
    try {
      if (!state.workspace) {
        throw new Error("Рабочая область еще не загружена.");
      }

      function serializeAlgorithm(algorithm) {
        return {
          id: algorithm.id,
          name: algorithm.name,
          documents: algorithm.documents.map(function (documentItem) {
            var text = getDocumentText(documentItem.id);
            return {
              id: documentItem.id,
              kind: documentItem.kind,
              title: documentItem.title,
              text: text,
              hasContent: typeof text === "string" && text.length > 0
            };
          }),
          parameters: algorithm.parameters.map(function (parameter) {
            return {
              id: parameter.id,
              name: parameter.name,
              typeName: parameter.typeName,
              presentation: parameter.presentation,
              editableInline: Boolean(parameter.editableInline)
            };
          }),
          children: algorithm.children.map(serializeAlgorithm)
        };
      }

      return JSON.stringify({
        formatVersion: WORKSPACE_FORMAT_VERSION,
        sessionId: state.workspace.sessionId,
        fileName: state.workspace.fileName,
        modified: Boolean(state.workspace.modified),
        revision: state.workspace.revision,
        fileHash: state.workspace.fileHash,
        selectedAlgorithmId: state.workspace.selectedAlgorithmId || state.selectedAlgorithmId || "",
        selectedTableId: state.selectedTableId || "",
        measurementsEnabled: Boolean(state.workspace.measurementsEnabled),
        tables: state.workspace.tables,
        settings: state.workspace.settings,
        algorithms: state.workspace.algorithms.map(serializeAlgorithm)
      });
    } catch (error) {
      return reportError("getWorkspaceSnapshot", error);
    }
  }

  function setSidebarVisible(visible) {
    try {
      if (typeof visible !== "boolean") {
        throw new Error("setSidebarVisible ожидает Булево.");
      }
      if (!visible && state.sidebarVisible && elements.tree) {
        state.sidebarScrollTop = elements.tree.scrollTop;
      }
      var restoringSidebar = visible && !state.sidebarVisible;
      state.sidebarVisible = visible;
      saveLayoutState();
      elements.workbench.classList.toggle("dc-sidebar-hidden", !visible);
      elements.togglePrimarySidebar.setAttribute("aria-pressed", visible ? "true" : "false");
      if (restoringSidebar) {
        setSidebarWidth(state.sidebarWidth);
        var searchResults = state.workspace && state.searchQuery
          ? collectSearchResults(state.workspace.algorithms, state.searchQuery)
          : null;
        var hasExpectedTreeNodes = Boolean(state.workspace && (
          searchResults ? searchResults.visible.size > 0 : state.workspace.algorithms.length > 0
        ));
        if (hasExpectedTreeNodes && (!elements.tree.firstChild || state.algorithmNodes.size === 0)) {
          renderWorkspace();
        } else {
          updateRenderedAlgorithmStates();
        }
        elements.tree.scrollTop = state.sidebarScrollTop;
        void elements.explorer.offsetWidth;
      }
      window.setTimeout(function () {
        if (state.editor) {
          state.editor.layout();
        }
      }, 0);
      return { success: true, visible: visible };
    } catch (error) {
      return reportError("setSidebarVisible", error);
    }
  }

  function setParametersVisible(visible) {
    try {
      if (typeof visible !== "boolean") {
        throw new Error("setParametersVisible ожидает Булево.");
      }
      state.parametersVisible = visible;
      saveLayoutState();
      elements.workbench.classList.toggle("dc-secondary-sidebar-hidden", !visible);
      elements.toggleSecondarySidebar.setAttribute("aria-pressed", visible ? "true" : "false");
      window.setTimeout(function () {
        if (state.editor) {
          state.editor.layout();
        }
      }, 0);
      return { success: true, visible: visible };
    } catch (error) {
      return reportError("setParametersVisible", error);
    }
  }

  function applySearch(rawValue) {
    var nextQuery = trimmedSearchValue(rawValue);
    if (state.searchQuery !== nextQuery) {
      state.searchExpandedAlgorithms = new Map();
    }
    state.searchQuery = nextQuery;
    renderWorkspace();
  }

  function updateSearchClearButton() {
    elements.searchClear.hidden = elements.search.value.length === 0;
  }

  function scheduleSearch() {
    updateSearchClearButton();
    if (state.searchTimer !== null) {
      window.clearTimeout(state.searchTimer);
    }
    state.searchTimer = window.setTimeout(function () {
      state.searchTimer = null;
      applySearch(elements.search.value);
    }, 120);
  }

  function clearSearch() {
    if (state.searchTimer !== null) {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = null;
    }
    elements.search.value = "";
    updateSearchClearButton();
    applySearch("");
    elements.search.focus();
  }

  function initializeSearch() {
    elements.search.addEventListener("input", scheduleSearch);
    elements.search.addEventListener("focus", function () {
      elements.searchControl.classList.add("dc-focused");
    });
    elements.search.addEventListener("blur", function () {
      elements.searchControl.classList.remove("dc-focused");
    });
    elements.search.addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.keyCode === 27) {
        clearSearch();
        event.preventDefault();
      }
    });
    elements.searchClear.addEventListener("click", clearSearch);
  }

  function initializeMutationControls() {
    elements.addAlgorithm.addEventListener("click", function () { addAlgorithmFromUi(false); });
    elements.addChildAlgorithm.addEventListener("click", function () { addAlgorithmFromUi(true); });
    elements.deleteAlgorithm.addEventListener("click", deleteAlgorithmFromUi);
    elements.addParameter.addEventListener("click", addParameterFromUi);
    elements.deleteParameter.addEventListener("click", deleteParameterFromUi);
    elements.editParameter.addEventListener("click", function () { editSelectedParameterFromUi("edit"); });
    elements.copyParameter.addEventListener("click", copySelectedParameterFromUi);
    elements.clearParameter.addEventListener("click", function () { editSelectedParameterFromUi("clear"); });
    elements.dialogCancel.addEventListener("click", closeWorkbenchDialog);
    elements.dialogConfirm.addEventListener("click", confirmWorkbenchDialog);
    elements.dialogBackdrop.addEventListener("click", function (event) {
      if (event.target === elements.dialogBackdrop) {
        closeWorkbenchDialog();
      }
    });
    elements.dialogInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.keyCode === 13) {
        confirmWorkbenchDialog();
        event.preventDefault();
      } else if (event.key === "Escape" || event.keyCode === 27) {
        closeWorkbenchDialog();
        event.preventDefault();
      }
    });
    elements.dialogBackdrop.addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.keyCode === 27) {
        closeWorkbenchDialog();
        event.preventDefault();
      }
    });
    document.addEventListener("click", function (event) {
      if (state.contextMenu && !state.contextMenu.contains(event.target)) {
        closeContextMenu();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.keyCode === 27) {
        closeContextMenu();
      }
    });
  }

  function initializeSecondarySectionControls() {
    var parametersHeader = document.querySelector(".dc-parameters-header");
    var tablesHeader = document.querySelector(".dc-tables-header");
    if (parametersHeader) {
      parametersHeader.title = "Двойной щелчок: свернуть или развернуть параметры";
      parametersHeader.addEventListener("dblclick", function () {
        state.parametersSectionExpanded = !state.parametersSectionExpanded;
        applySecondarySectionState();
      });
    }
    if (elements.parametersSectionToggle) {
      elements.parametersSectionToggle.setAttribute("role", "button");
      elements.parametersSectionToggle.tabIndex = 0;
      elements.parametersSectionToggle.addEventListener("click", function (event) {
        event.stopPropagation();
        state.parametersSectionExpanded = !state.parametersSectionExpanded;
        applySecondarySectionState();
      });
      elements.parametersSectionToggle.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.keyCode === 13 || event.key === " " || event.keyCode === 32) {
          event.preventDefault();
          elements.parametersSectionToggle.click();
        }
      });
    }
    if (tablesHeader) {
      tablesHeader.title = "Двойной щелчок: свернуть или развернуть результаты";
      tablesHeader.addEventListener("dblclick", function () {
        state.tablesSectionExpanded = !state.tablesSectionExpanded;
        applySecondarySectionState();
      });
    }
    if (elements.tablesSectionToggle) {
      elements.tablesSectionToggle.setAttribute("role", "button");
      elements.tablesSectionToggle.tabIndex = 0;
      elements.tablesSectionToggle.addEventListener("click", function (event) {
        event.stopPropagation();
        state.tablesSectionExpanded = !state.tablesSectionExpanded;
        applySecondarySectionState();
      });
      elements.tablesSectionToggle.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.keyCode === 13 || event.key === " " || event.keyCode === 32) {
          event.preventDefault();
          elements.tablesSectionToggle.click();
        }
      });
    }
    applySecondarySectionState();
  }

  function initializeLayoutControls() {
    elements.togglePrimarySidebar.addEventListener("click", function () {
      setSidebarVisible(!state.sidebarVisible);
    });
    elements.toggleSecondarySidebar.addEventListener("click", function () {
      setParametersVisible(!state.parametersVisible);
    });
    elements.toggleSettings.addEventListener("click", function () {
      toggleSettings();
    });
  }

  function initializeTableControls() {
    elements.toggleMeasurements.addEventListener("click", function () {
      requestTableCommand("toggle-measurements", "");
    });
    elements.exportTable.addEventListener("click", function () {
      if (state.selectedTableId) {
        requestTableCommand("export-table", state.selectedTableId);
      }
    });
  }

  function initializeSettingsControls() {
    function commitSourceDirectory() {
      var value = String(elements.sourceDirectory.value || "").replace(/^\s+|\s+$/g, "");
      var current = state.workspace ? state.workspace.settings.sourceDirectory : "";
      if (value !== current) {
        requestSettingsCommand("set-source-directory", value);
      }
    }
    elements.closeSettings.addEventListener("click", function () {
      setSettingsVisible(false);
      elements.toggleSettings.focus();
    });
    elements.chooseSourceDirectory.addEventListener("click", function () {
      requestSettingsCommand("choose-source-directory", "");
    });
    elements.loadCommonModules.addEventListener("click", function () {
      requestSettingsCommand("load-common-modules", "");
    });
    elements.sourceDirectory.addEventListener("change", commitSourceDirectory);
    elements.sourceDirectory.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.keyCode === 13) {
        commitSourceDirectory();
        event.preventDefault();
      } else if (event.key === "Escape" || event.keyCode === 27) {
        renderSettingsPanel();
        event.preventDefault();
      }
    });
    elements.variableDisplayMode.addEventListener("change", function () {
      requestSettingsCommand("set-variable-display-mode", Number(elements.variableDisplayMode.value));
    });
    elements.savedListLimit.addEventListener("change", function () {
      var value = Math.max(0, Math.min(9999, Math.floor(Number(elements.savedListLimit.value) || 0)));
      elements.savedListLimit.value = String(value);
      requestSettingsCommand("set-saved-list-limit", value);
    });
    elements.autoSaveOnExecute.addEventListener("change", function () {
      requestSettingsCommand("set-auto-save-on-execute", elements.autoSaveOnExecute.checked);
    });
    elements.editorTheme.addEventListener("change", function () {
      requestEditorSetting("theme", elements.editorTheme.value);
    });
    elements.editorFontSize.addEventListener("change", function () {
      var value = Math.max(10, Math.min(28, Math.floor(Number(elements.editorFontSize.value) || 14)));
      elements.editorFontSize.value = String(value);
      requestEditorSetting("fontSize", value);
    });
    elements.editorLineNumbers.addEventListener("change", function () {
      requestEditorSetting("lineNumbers", elements.editorLineNumbers.checked);
    });
    elements.editorMinimap.addEventListener("change", function () {
      requestEditorSetting("minimap", elements.editorMinimap.checked);
    });
    elements.editorWordWrap.addEventListener("change", function () {
      requestEditorSetting("wordWrap", elements.editorWordWrap.checked);
    });
    elements.editorRenderWhitespace.addEventListener("change", function () {
      requestEditorSetting("renderWhitespace", elements.editorRenderWhitespace.checked);
    });
    elements.editorQuickSuggestions.addEventListener("change", function () {
      requestEditorSetting("quickSuggestions", elements.editorQuickSuggestions.checked);
    });
    elements.editorStatusBar.addEventListener("change", function () {
      requestEditorSetting("statusBar", elements.editorStatusBar.checked);
    });
    elements.editorQueryHighlighting.addEventListener("change", function () {
      requestEditorSetting("queryHighlighting", elements.editorQueryHighlighting.checked);
    });
  }

  function enabledModeTabs() {
    var result = [];
    for (var index = 0; index < elements.modeTabs.length; index += 1) {
      if (!elements.modeTabs[index].disabled) {
        result.push(elements.modeTabs[index]);
      }
    }
    return result;
  }

  function activateModeTab(tab) {
    if (tab.disabled) {
      return;
    }
    activateDocumentFromUi(tab.getAttribute("data-algorithm-id"), tab.getAttribute("data-document-kind"));
  }

  function initializeModeTabs() {
    for (var index = 0; index < elements.modeTabs.length; index += 1) {
      elements.modeTabs[index].addEventListener("click", function (event) {
        activateModeTab(event.currentTarget);
      });
      elements.modeTabs[index].addEventListener("keydown", function (event) {
        var tabs = enabledModeTabs();
        var currentIndex = tabs.indexOf(event.currentTarget);
        var nextIndex = currentIndex;
        if (event.key === "ArrowLeft" || event.keyCode === 37) {
          nextIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
        } else if (event.key === "ArrowRight" || event.keyCode === 39) {
          nextIndex = currentIndex >= tabs.length - 1 ? 0 : currentIndex + 1;
        } else if (event.key === "Home" || event.keyCode === 36) {
          nextIndex = 0;
        } else if (event.key === "End" || event.keyCode === 35) {
          nextIndex = tabs.length - 1;
        } else {
          return;
        }
        if (tabs[nextIndex]) {
          tabs[nextIndex].focus();
          activateModeTab(tabs[nextIndex]);
        }
        event.preventDefault();
      });
    }
  }

  function collapseAll() {
    state.algorithms.forEach(function (algorithm) {
      state.expandedAlgorithms.set(algorithm.id, false);
      state.searchExpandedAlgorithms.set(algorithm.id, false);
    });
    updateRenderedAlgorithmStates();
  }

  function requestWorkspaceFileAction(eventName, action, requiresWriteAccess) {
    if (state.workspaceBusy || !state.workspace || (requiresWriteAccess && !state.workspace.canExecute)) {
      return;
    }
    emitBridgeEvent(eventName, mutationPayload(action, {}));
  }

  function requestWorkspaceNew() {
    requestWorkspaceFileAction("EVENT_WORKSPACE_NEW_REQUESTED", "new-workspace", true);
  }

  function requestWorkspaceOpen() {
    requestWorkspaceFileAction("EVENT_WORKSPACE_OPEN_REQUESTED", "open-workspace", false);
  }

  function requestWorkspaceSave(saveAs) {
    if (state.workspaceBusy || !state.workspace || !state.workspace.canExecute) {
      return;
    }
    var snapshot = getWorkspaceSnapshot();
    if (!snapshot || typeof snapshot !== "string") {
      return;
    }
    var payload = mutationPayload(saveAs ? "save-workspace-as" : "save-workspace", {});
    payload.workspaceJson = snapshot;
    emitBridgeEvent(saveAs
      ? "EVENT_WORKSPACE_SAVE_AS_REQUESTED"
      : "EVENT_WORKSPACE_SAVE_REQUESTED", payload);
  }

  function requestQueryConstructor() {
    var activeDocument = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : null;
    if (!activeDocument || normalizedKind(activeDocument.kind) !== "query") {
      return { success: false, requested: false };
    }
    var requested = requestCommand(activeDocument, "open-query-constructor");
    return { success: requested, requested: requested };
  }

  function executeCurrentAlgorithmQueryFromUi() {
    if (state.workspaceBusy || !state.workspace || !state.workspace.canExecute || !elements.dialogBackdrop.hidden) {
      return;
    }
    var algorithm = currentAlgorithm();
    var queryDocument = algorithm ? algorithmDocumentByKind(algorithm, "query") : null;
    if (!queryDocument) {
      return;
    }
    if (queryDocument.id !== state.activeDocumentId) {
      activateDocumentById(queryDocument.id, true);
    }
    requestCommand(queryDocument, "execute-query");
  }

  function initializeWorkspaceFileControls() {
    elements.newWorkspace.addEventListener("click", requestWorkspaceNew);
    elements.openWorkspace.addEventListener("click", requestWorkspaceOpen);
    elements.saveWorkspace.addEventListener("click", function () { requestWorkspaceSave(false); });
    elements.saveWorkspaceAs.addEventListener("click", function () { requestWorkspaceSave(true); });
    elements.emptyOpen.addEventListener("click", requestWorkspaceOpen);
    elements.emptyRetry.addEventListener("click", retryInitializationAfterCacheClear);
    scheduleInitializationRetry();
    if (!state.globalSaveHandlerInstalled) {
      document.addEventListener("keydown", function (event) {
        var key = String(event.key || "").toLowerCase();
        if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
            && (key === "f9" || event.keyCode === 120)) {
          if (copySelectedParameterFromUi()) {
            event.preventDefault();
            if (event.stopImmediatePropagation) {
              event.stopImmediatePropagation();
            } else {
              event.stopPropagation();
            }
          }
          return;
        }
        if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
            && (key === "f5" || event.keyCode === 116)) {
          event.preventDefault();
          if (event.stopImmediatePropagation) {
            event.stopImmediatePropagation();
          } else {
            event.stopPropagation();
          }
          executeCurrentAlgorithmQueryFromUi();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === "s" || event.keyCode === 83)) {
          event.preventDefault();
          if (event.stopImmediatePropagation) {
            event.stopImmediatePropagation();
          } else {
            event.stopPropagation();
          }
          requestWorkspaceSave(false);
        }
      }, true);
      state.globalSaveHandlerInstalled = true;
    }
  }

  function setSidebarWidth(width) {
    var viewportLimit = Math.max(210, document.documentElement.clientWidth - 220);
    var nextWidth = Math.max(210, Math.min(520, viewportLimit, Math.round(width)));
    state.sidebarWidth = nextWidth;
    elements.explorer.style.width = nextWidth + "px";
    elements.explorer.style.flexBasis = nextWidth + "px";
    elements.splitter.setAttribute("aria-valuenow", String(nextWidth));
    if (state.editor) {
      state.editor.layout();
    }
  }

  function initializeSplitter() {
    var startX = 0;
    var startWidth = 0;

    function onMove(event) {
      setSidebarWidth(startWidth + event.clientX - startX);
    }

    function onUp() {
      document.body.classList.remove("dc-resizing");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    elements.splitter.addEventListener("mousedown", function (event) {
      startX = event.clientX;
      startWidth = elements.explorer.getBoundingClientRect().width;
      document.body.classList.add("dc-resizing");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      event.preventDefault();
    });
    elements.splitter.addEventListener("dblclick", function () {
      setSidebarWidth(260);
    });
    elements.splitter.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft" || event.keyCode === 37) {
        setSidebarWidth(state.sidebarWidth - 16);
        event.preventDefault();
      } else if (event.key === "ArrowRight" || event.keyCode === 39) {
        setSidebarWidth(state.sidebarWidth + 16);
        event.preventDefault();
      } else if (event.key === "Home" || event.keyCode === 36) {
        setSidebarWidth(210);
        event.preventDefault();
      } else if (event.key === "End" || event.keyCode === 35) {
        setSidebarWidth(520);
        event.preventDefault();
      }
    });
  }

  function setParametersWidth(width) {
    var viewportLimit = Math.max(220, document.documentElement.clientWidth - 360);
    var nextWidth = Math.max(220, Math.min(420, viewportLimit, Math.round(width)));
    state.parametersWidth = nextWidth;
    elements.parameters.style.width = nextWidth + "px";
    elements.parameters.style.flexBasis = nextWidth + "px";
    elements.parametersSplitter.setAttribute("aria-valuenow", String(nextWidth));
    if (state.editor) {
      state.editor.layout();
    }
  }

  function initializeParametersSplitter() {
    var startX = 0;
    var startWidth = 0;

    function onMove(event) {
      setParametersWidth(startWidth - (event.clientX - startX));
    }

    function onUp() {
      document.body.classList.remove("dc-resizing");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    elements.parametersSplitter.addEventListener("mousedown", function (event) {
      startX = event.clientX;
      startWidth = elements.parameters.getBoundingClientRect().width;
      document.body.classList.add("dc-resizing");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      event.preventDefault();
    });
    elements.parametersSplitter.addEventListener("dblclick", function () {
      setParametersWidth(280);
    });
    elements.parametersSplitter.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft" || event.keyCode === 37) {
        setParametersWidth(state.parametersWidth + 16);
        event.preventDefault();
      } else if (event.key === "ArrowRight" || event.keyCode === 39) {
        setParametersWidth(state.parametersWidth - 16);
        event.preventDefault();
      } else if (event.key === "Home" || event.keyCode === 36) {
        setParametersWidth(220);
        event.preventDefault();
      } else if (event.key === "End" || event.keyCode === 35) {
        setParametersWidth(420);
        event.preventDefault();
      }
    });
  }

  function onEditorReady(editorInstance) {
    state.editor = editorInstance;
    if (!state.themeBridgeInstalled && window.monaco && window.monaco.editor) {
      var originalSetTheme = window.monaco.editor.setTheme;
      window.monaco.editor.setTheme = function (themeName) {
        var result = originalSetTheme.apply(window.monaco.editor, arguments);
        syncTheme(themeName);
        return result;
      };
      state.themeBridgeInstalled = true;
    }
    if (!state.legacyModel && editorInstance) {
      state.legacyModel = editorInstance.getModel();
    }
    if (state.pendingDocumentId && state.documents.has(state.pendingDocumentId)) {
      try {
        activateDocumentById(state.pendingDocumentId, false);
      } catch (error) {
        reportError("onEditorReady", error);
      }
    }
    if (state.editor) {
      if (state.workspace) {
        applyEditorSettings(state.workspace.settings.editor);
      }
      state.editor.layout();
      if (state.editor._themeService && state.editor._themeService.getTheme) {
        syncTheme(state.editor._themeService.getTheme().themeName);
      }
    }
  }

  function onEditorContentChanged() {
    if (!state.workspace && elements.editorEmpty) {
      elements.editorEmpty.hidden = true;
    }
    if (!state.activeDocumentId || !state.editor) {
      return;
    }
    var item = state.documents.get(state.activeDocumentId);
    var model = state.models.get(state.activeDocumentId);
    if (!item || !model || state.editor.getModel() !== model) {
      return;
    }
    item.text = model.getValue();
    item.hasContent = item.text.length > 0;
    state.workspace.modified = true;
    state.workspace.revision += 1;
    rebuildDocumentSearchIndex(item);
    updateDocumentButtonState(item.id);
    renderFileState();
  }

  function getContentChangeEventParams() {
    var active = getActiveDocument();
    if (!active) {
      return "";
    }
    active.sessionId = state.workspace ? state.workspace.sessionId : "";
    return active;
  }

  function shouldEmitContentChange() {
    return !state.suppressContentEvents;
  }

  function onLegacyContentSet() {
    if (!state.workspace && elements.editorEmpty) {
      elements.editorEmpty.hidden = true;
    }
  }

  function syncTheme(themeName) {
    var isDark = String(themeName || "").toLowerCase().indexOf("dark") >= 0;
    document.documentElement.classList.toggle("dc-theme-dark", isDark);
    return { success: true, theme: isDark ? "dark" : "light" };
  }

  function initialize() {
    cacheElements();
    restoreLayoutState();
    initializeWorkspaceFileControls();
    byId("dataconsole-collapse-all").addEventListener("click", collapseAll);
    elements.fillParameters.addEventListener("click", fillParametersFromUi);
    initializeSearch();
    initializeMutationControls();
    initializeSecondarySectionControls();
    initializeLayoutControls();
    initializeTableControls();
    initializeSettingsControls();
    initializeModeTabs();
    elements.toggleParameterHint.addEventListener("click", function () {
      var activeDocument = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : null;
      requestCommand(activeDocument, "toggle-parameter-hint");
    });
    initializeSplitter();
    initializeParametersSplitter();
    renderWorkspace();
    if (window.editor) {
      onEditorReady(window.editor);
    }
  }

  window.DataConsoleApp = {
    loadWorkspace: loadWorkspace,
    setWorkspaceBusy: setWorkspaceBusy,
    applyPatch: applyPatch,
    activateDocument: activateDocument,
    getActiveDocument: getActiveDocument,
    getDocumentText: getDocumentText,
    getWorkspaceSnapshot: getWorkspaceSnapshot,
    requestQueryConstructor: requestQueryConstructor,
    setSidebarVisible: setSidebarVisible,
    setParametersVisible: setParametersVisible,
    setSettingsVisible: setSettingsVisible,
    toggleSettings: toggleSettings,
    onEditorReady: onEditorReady,
    onEditorContentChanged: onEditorContentChanged,
    onLegacyContentSet: onLegacyContentSet,
    getContentChangeEventParams: getContentChangeEventParams,
    shouldEmitContentChange: shouldEmitContentChange,
    syncTheme: syncTheme
  };

  initialize();
}(window, document));
