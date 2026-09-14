(function (window, document) {
  "use strict";

  var DOCUMENT_KINDS = {
    query: { className: "query", glyph: "Q", title: "Запрос", tabTitle: "Запрос", language: "bsl_query", order: 0 },
    beforequery: { className: "before", glyph: "B", title: "Перед выполнением запроса", tabTitle: "До запроса", language: "bsl", order: 1 },
    client: { className: "client", glyph: "C", title: "Код клиента", tabTitle: "Клиент", language: "bsl", order: 2 },
    server: { className: "server", glyph: "S", title: "Код сервера", tabTitle: "Сервер", language: "bsl", order: 3 },
    background: { className: "background", glyph: "F", title: "Фоновый код", tabTitle: "Фон", language: "bsl", order: 4 }
  };

  var state = {
    workspace: null,
    algorithms: new Map(),
    documents: new Map(),
    models: new Map(),
    viewStates: new Map(),
    documentButtons: new Map(),
    expandedAlgorithms: new Map(),
    searchExpandedAlgorithms: new Map(),
    activeDocumentId: null,
    pendingDocumentId: null,
    editor: null,
    legacyModel: null,
    suppressContentEvents: false,
    themeBridgeInstalled: false,
    searchQuery: "",
    searchTimer: null,
    sidebarVisible: true,
    sidebarWidth: 260
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
    elements.search = byId("dataconsole-search");
    elements.searchClear = byId("dataconsole-search-clear");
    elements.searchEmpty = byId("dataconsole-search-empty");
    elements.explorerEmpty = byId("dataconsole-explorer-empty");
    elements.editorEmpty = byId("dataconsole-editor-empty");
    elements.editorShell = byId("dataconsole-editor-shell");
    elements.modeBar = byId("dataconsole-mode-bar");
    elements.modeTabs = elements.modeBar ? elements.modeBar.querySelectorAll(".dc-mode-tab") : [];
    elements.splitter = byId("dataconsole-splitter");
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
        var rawParameter = rawParameters[index];
        if (!rawParameter || typeof rawParameter !== "object") {
          throw new Error("Элемент algorithm.parameters должен быть объектом.");
        }
        algorithm.parameters.push({
          id: requiredIdentity(rawParameter.id, "parameter.id"),
          name: String(rawParameter.name || "Параметр"),
          typeName: rawParameter.typeName === undefined ? "" : String(rawParameter.typeName),
          presentation: rawParameter.presentation === undefined ? "" : String(rawParameter.presentation),
          editableInline: Boolean(rawParameter.editableInline)
        });
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

  function orderedDocuments(documents) {
    return documents.slice().sort(function (left, right) {
      return kindDescription(left.kind).order - kindDescription(right.kind).order;
    });
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

    orderedDocuments(algorithm.documents).forEach(function (documentItem) {
      var description = kindDescription(documentItem.kind);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "dc-tree-document-button dc-kind-" + description.className;
      button.setAttribute("data-document-id", documentItem.id);
      button.title = description.title;
      button.setAttribute("aria-label", description.title);
      button.textContent = description.glyph;
      button.addEventListener("click", function (event) {
        if (event && event.stopPropagation) {
          event.stopPropagation();
        }
        activateDocumentFromUi(algorithm.id, documentItem.kind);
      });
      state.documentButtons.set(documentItem.id, button);
      group.appendChild(button);
      updateDocumentButtonState(documentItem.id);
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

  function updateModeBar() {
    var activeDocument = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : null;
    var algorithm = activeDocument ? state.algorithms.get(activeDocument.algorithmId) : null;
    var hasAlgorithm = Boolean(algorithm);
    elements.modeBar.hidden = !hasAlgorithm;
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
  }

  function createParameters(algorithm) {
    var block = document.createElement("div");
    block.className = "dc-parameters";
    appendTextElement(block, "div", "dc-parameters-title", "Параметры");

    algorithm.parameters.forEach(function (parameter) {
      var row = document.createElement(parameter.editableInline ? "button" : "div");
      row.className = "dc-parameter";
      if (parameter.editableInline) {
        row.type = "button";
        row.title = "Изменить параметр " + parameter.name;
        row.addEventListener("click", function () {
          emitBridgeEvent("EVENT_PARAMETER_EDIT_REQUESTED", {
            algorithmId: algorithm.id,
            parameterId: parameter.id,
            parameterName: parameter.name
          });
        });
      }
      appendTextElement(row, "span", "dc-parameter-name", parameter.name);
      var value = appendTextElement(row, "span", "dc-parameter-value", parameter.presentation);
      if (parameter.typeName) {
        value.title = parameter.typeName + ": " + parameter.presentation;
      }
      block.appendChild(row);
    });
    return block;
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
    var hasBody = algorithm.parameters.length || visibleChildren.length;
    var expanded;
    if (state.searchQuery) {
      expanded = state.searchExpandedAlgorithms.has(algorithm.id)
        ? state.searchExpandedAlgorithms.get(algorithm.id)
        : true;
    } else {
      expanded = state.expandedAlgorithms.has(algorithm.id) ? state.expandedAlgorithms.get(algorithm.id) : algorithm.depth < 2;
    }

    node.className = "dc-algorithm";
    node.setAttribute("role", "treeitem");
    node.setAttribute("aria-level", String(algorithm.depth + 1));
    node.style.animationDelay = String(Math.min(order * 16, 160)) + "ms";
    heading.className = "dc-algorithm-heading";
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
    appendTextElement(heading, "span", "dc-algorithm-name", algorithm.name).title = algorithm.name;
    if (algorithm.documents.length) {
      heading.appendChild(createTreeDocumentButtons(algorithm));
    }
    node.appendChild(heading);

    body.className = "dc-algorithm-body";
    body.hidden = !expanded;
    if (algorithm.parameters.length) {
      body.appendChild(createParameters(algorithm));
    }
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

    twistie.addEventListener("click", function () {
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

      var retainedExpansion = new Map();
      state.expandedAlgorithms.forEach(function (expanded, algorithmId) {
        if (state.algorithms.has(algorithmId)) {
          retainedExpansion.set(algorithmId, expanded);
        }
      });
      state.expandedAlgorithms = retainedExpansion;
      state.searchExpandedAlgorithms = new Map();
      renderWorkspace();

      var nextDocument = previousActiveId && state.documents.has(previousActiveId)
        ? state.documents.get(previousActiveId)
        : indexed.orderedDocuments[0];
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
        }
      });
      if (state.searchQuery || operations.some(function (operation) { return operation.op === "updateParameter"; })) {
        renderWorkspace();
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
    elements.search.addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.keyCode === 27) {
        clearSearch();
        event.preventDefault();
      }
    });
    elements.searchClear.addEventListener("click", clearSearch);
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
    });
    renderWorkspace();
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
    initializeSearch();
    initializeModeTabs();
    initializeSplitter();
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
    onEditorReady: onEditorReady,
    onEditorContentChanged: onEditorContentChanged,
    onLegacyContentSet: onLegacyContentSet,
    getContentChangeEventParams: getContentChangeEventParams,
    shouldEmitContentChange: shouldEmitContentChange,
    syncTheme: syncTheme
  };

  initialize();
}(window, document));
