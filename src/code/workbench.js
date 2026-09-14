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
  var DOCUMENT_COMMANDS = {
    query: [
      { action: "execute-query", label: "Выполнить", primary: true },
      { action: "execute-query-to-cursor", label: "До курсора" },
      { action: "execute-query-package", label: "Пакет" }
    ],
    beforequery: [
      { action: "execute-query", label: "Выполнить запрос", primary: true }
    ],
    client: [
      { action: "execute-client", label: "Выполнить на клиенте", primary: true }
    ],
    server: [
      { action: "execute-server", label: "Выполнить на сервере", primary: true }
    ],
    background: [
      { action: "execute-background", label: "Выполнить в фоне", primary: true },
      { action: "stop-background", label: "Остановить", stop: true }
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
    expandedAlgorithms: new Map(),
    searchExpandedAlgorithms: new Map(),
    selectedAlgorithmId: null,
    selectedParameterId: null,
    activeDocumentId: null,
    pendingDocumentId: null,
    editor: null,
    legacyModel: null,
    suppressContentEvents: false,
    themeBridgeInstalled: false,
    saveCommandEditor: null,
    dialogConfirm: null,
    dialogRestoreFocus: null,
    searchQuery: "",
    searchTimer: null,
    sidebarVisible: true,
    parametersVisible: true,
    sidebarWidth: 260,
    parametersWidth: 280
  };

  var elements = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    elements.workbench = byId("dataconsole-workbench");
    elements.explorer = byId("dataconsole-explorer");
    elements.fileName = byId("dataconsole-file-name");
    elements.tree = byId("dataconsole-algorithm-tree");
    elements.addAlgorithm = byId("dataconsole-add-algorithm");
    elements.addChildAlgorithm = byId("dataconsole-add-child-algorithm");
    elements.deleteAlgorithm = byId("dataconsole-delete-algorithm");
    elements.searchControl = byId("dataconsole-search-control");
    elements.search = byId("dataconsole-search");
    elements.searchClear = byId("dataconsole-search-clear");
    elements.searchEmpty = byId("dataconsole-search-empty");
    elements.explorerEmpty = byId("dataconsole-explorer-empty");
    elements.editorEmpty = byId("dataconsole-editor-empty");
    elements.editorShell = byId("dataconsole-editor-shell");
    elements.modeBar = byId("dataconsole-mode-bar");
    elements.modeTabsContainer = byId("dataconsole-mode-tabs");
    elements.modeTabs = elements.modeBar ? elements.modeBar.querySelectorAll(".dc-mode-tab") : [];
    elements.togglePrimarySidebar = byId("dataconsole-toggle-primary-sidebar");
    elements.toggleSecondarySidebar = byId("dataconsole-toggle-secondary-sidebar");
    elements.actionBar = byId("dataconsole-action-bar");
    elements.actions = byId("dataconsole-actions");
    elements.actionNote = byId("dataconsole-action-note");
    elements.parameters = byId("dataconsole-parameters");
    elements.parametersSplitter = byId("dataconsole-parameters-splitter");
    elements.parametersAlgorithm = byId("dataconsole-parameters-algorithm");
    elements.parametersList = byId("dataconsole-parameters-list");
    elements.fillParameters = byId("dataconsole-fill-parameters");
    elements.addParameter = byId("dataconsole-add-parameter");
    elements.deleteParameter = byId("dataconsole-delete-parameter");
    elements.splitter = byId("dataconsole-splitter");
    elements.dialogBackdrop = byId("dataconsole-dialog-backdrop");
    elements.dialogTitle = byId("dataconsole-dialog-title");
    elements.dialogMessage = byId("dataconsole-dialog-message");
    elements.dialogInput = byId("dataconsole-dialog-input");
    elements.dialogError = byId("dataconsole-dialog-error");
    elements.dialogCancel = byId("dataconsole-dialog-cancel");
    elements.dialogConfirm = byId("dataconsole-dialog-confirm");
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

    var roots = asArray(snapshot.algorithms, "workspace.algorithms");
    var normalizedRoots = [];
    for (var index = 0; index < roots.length; index += 1) {
      normalizedRoots.push(visitAlgorithm(roots[index], null, 0));
    }

    return {
      workspace: {
        sessionId: snapshot.sessionId === undefined ? "" : String(snapshot.sessionId),
        fileName: snapshot.fileName === undefined ? "" : String(snapshot.fileName),
        canExecute: snapshot.canExecute === undefined ? true : Boolean(snapshot.canExecute),
        selectedAlgorithmId: snapshot.selectedAlgorithmId === undefined || snapshot.selectedAlgorithmId === null
          ? ""
          : String(snapshot.selectedAlgorithmId),
        algorithms: normalizedRoots
      },
      algorithms: algorithms,
      documents: documents,
      orderedDocuments: orderedDocuments
    };
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

  function commandPayload(documentItem, action) {
    return {
      sessionId: state.workspace ? state.workspace.sessionId : "",
      algorithmId: documentItem.algorithmId,
      documentId: documentItem.id,
      documentKind: documentItem.kind,
      action: action
    };
  }

  function requestCommand(documentItem, action) {
    if (!documentItem || !state.workspace || !state.workspace.canExecute) {
      return;
    }
    emitBridgeEvent("EVENT_COMMAND_REQUESTED", commandPayload(documentItem, action));
  }

  function renderActionBar(algorithm, activeDocument) {
    while (elements.actions.firstChild) {
      elements.actions.removeChild(elements.actions.firstChild);
    }
    elements.actionNote.textContent = "";
    elements.actionBar.hidden = !activeDocument;
    if (!activeDocument) {
      return;
    }

    var commands = DOCUMENT_COMMANDS[normalizedKind(activeDocument.kind)] || [];
    commands.forEach(function (command) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "dc-command-button" + (command.primary ? " dc-command-primary" : "") + (command.stop ? " dc-command-stop" : "");
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
      var value = appendTextElement(row, "div", "dc-parameter-value", parameter.presentation);
      value.title = parameter.typeName ? parameter.typeName + ": " + parameter.presentation : parameter.presentation;
      row.addEventListener("click", function () {
        selectParameter(parameter.id);
      });
      row.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.keyCode === 13 || event.key === " " || event.keyCode === 32) {
          selectParameter(parameter.id);
          event.preventDefault();
        }
      });
      state.parameterRows.set(parameter.id, row);
      elements.parametersList.appendChild(row);
    });
  }

  function updateMutationButtonStates(algorithm) {
    var canMutate = Boolean(state.workspace && state.workspace.canExecute);
    var hasAlgorithm = Boolean(algorithm);
    elements.addAlgorithm.disabled = !canMutate;
    elements.addChildAlgorithm.disabled = !canMutate || !hasAlgorithm;
    elements.deleteAlgorithm.disabled = !canMutate || !hasAlgorithm;
    elements.addParameter.disabled = !canMutate || !hasAlgorithm;
    elements.deleteParameter.disabled = !canMutate || !hasAlgorithm || !state.selectedParameterId;
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

  function closeWorkbenchDialog() {
    elements.dialogBackdrop.hidden = true;
    state.dialogConfirm = null;
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
    elements.dialogTitle.textContent = options.title;
    elements.dialogMessage.textContent = options.message || "";
    elements.dialogInput.hidden = !options.requiresName;
    elements.dialogInput.value = options.value || "";
    elements.dialogInput.setAttribute("aria-label", options.inputLabel || options.title);
    elements.dialogError.hidden = true;
    elements.dialogError.textContent = "";
    elements.dialogConfirm.textContent = options.confirmLabel || "Продолжить";
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
    closeWorkbenchDialog();
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
    emitBridgeEvent("EVENT_WORKSPACE_MUTATION_REQUESTED", mutationPayload(action, additional));
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

  function renderWorkspace() {
    if (!elements.tree) {
      cacheElements();
    }
    state.documentButtons = new Map();
    state.algorithmNodes = new Map();
    while (elements.tree.firstChild) {
      elements.tree.removeChild(elements.tree.firstChild);
    }

    if (!state.workspace) {
      elements.fileName.textContent = "Рабочая область не открыта";
      elements.explorerEmpty.hidden = false;
      elements.searchEmpty.hidden = true;
      elements.editorEmpty.hidden = false;
      updateModeBar();
      return;
    }

    elements.fileName.textContent = state.workspace.fileName || "Без имени";
    elements.fileName.title = state.workspace.fileName || "Без имени";
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
        activateDocumentById(nextDocument.id, false);
      }
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
      throw new Error("Неподдерживаемая операция patch: " + String(operation.op) + ".");
    });
    return operations;
  }

  function applyPatch(patchJson) {
    try {
      if (!state.workspace) {
        throw new Error("Рабочая область еще не загружена.");
      }
      var patch = parseJsonValue(patchJson, "applyPatch");
      var operations = validatePatch(patch);
      operations.forEach(function (operation) {
        if (operation.op === "replaceDocumentText") {
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
        }
      });
      var parametersChanged = operations.some(function (operation) {
        return operation.op === "updateParameter" || operation.op === "replaceAlgorithmParameters";
      });
      if (state.searchQuery) {
        renderWorkspace();
      } else if (parametersChanged) {
        var activeDocument = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : null;
        var activeAlgorithm = activeDocument ? state.algorithms.get(activeDocument.algorithmId) : null;
        renderParametersPanel(activeAlgorithm, activeDocument);
      }
      return { success: true, applied: operations.length };
    } catch (error) {
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

  function setSidebarVisible(visible) {
    try {
      if (typeof visible !== "boolean") {
        throw new Error("setSidebarVisible ожидает Булево.");
      }
      state.sidebarVisible = visible;
      elements.workbench.classList.toggle("dc-sidebar-hidden", !visible);
      elements.togglePrimarySidebar.setAttribute("aria-pressed", visible ? "true" : "false");
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
  }

  function initializeLayoutControls() {
    elements.togglePrimarySidebar.addEventListener("click", function () {
      setSidebarVisible(!state.sidebarVisible);
    });
    elements.toggleSecondarySidebar.addEventListener("click", function () {
      setParametersVisible(!state.parametersVisible);
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

  function requestWorkspaceOpen() {
    emitBridgeEvent("EVENT_WORKSPACE_OPEN_REQUESTED", {});
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
    if (editorInstance && typeof editorInstance.addCommand === "function"
        && window.monaco && window.monaco.KeyMod && window.monaco.KeyCode
        && state.saveCommandEditor !== editorInstance) {
      editorInstance.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KEY_S, function () {
        if (state.workspace && state.workspace.canExecute) {
          emitBridgeEvent("EVENT_WORKSPACE_SAVE_REQUESTED", mutationPayload("save-workspace", {}));
        }
      });
      state.saveCommandEditor = editorInstance;
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
    rebuildDocumentSearchIndex(item);
    updateDocumentButtonState(item.id);
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
    byId("dataconsole-open-workspace").addEventListener("click", requestWorkspaceOpen);
    byId("dataconsole-empty-open").addEventListener("click", requestWorkspaceOpen);
    byId("dataconsole-collapse-all").addEventListener("click", collapseAll);
    elements.fillParameters.addEventListener("click", fillParametersFromUi);
    initializeSearch();
    initializeMutationControls();
    initializeLayoutControls();
    initializeModeTabs();
    initializeSplitter();
    initializeParametersSplitter();
    renderWorkspace();
    if (window.editor) {
      onEditorReady(window.editor);
    }
  }

  window.DataConsoleApp = {
    loadWorkspace: loadWorkspace,
    applyPatch: applyPatch,
    activateDocument: activateDocument,
    getActiveDocument: getActiveDocument,
    getDocumentText: getDocumentText,
    setSidebarVisible: setSidebarVisible,
    setParametersVisible: setParametersVisible,
    onEditorReady: onEditorReady,
    onEditorContentChanged: onEditorContentChanged,
    onLegacyContentSet: onLegacyContentSet,
    getContentChangeEventParams: getContentChangeEventParams,
    shouldEmitContentChange: shouldEmitContentChange,
    syncTheme: syncTheme
  };

  initialize();
}(window, document));
