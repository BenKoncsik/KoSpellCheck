(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  let state = {
    loading: false,
    refreshedAtUtc: new Date().toISOString(),
    overview: {
      workspaceRoot: '',
      scope: 'none',
      filesScanned: 0,
      typesScanned: 0,
      dominantCaseStyle: 'Unknown',
      diagnosticsCount: 0,
      featureEnabled: false,
      aiEnabled: false,
      coralActive: false,
      coralDetail: 'inactive',
      inFlightRebuildCount: 0,
      queuedRebuildCount: 0
    },
    uiStrings: {},
    settings: [],
    conventionMap: [],
    diagnostics: [],
    logs: []
  };
  const persisted = vscode.getState();
  let expandedFolders = new Set(
    Array.isArray(persisted && persisted.expandedFolders)
      ? persisted.expandedFolders.filter((value) => typeof value === 'string')
      : []
  );
  let defaultExpansionApplied = expandedFolders.size > 0;

  function persistTreeState() {
    vscode.setState({
      expandedFolders: Array.from(expandedFolders)
    });
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'state') {
      return;
    }

    state = message.payload || state;
    render();
  });

  function post(command, extra) {
    vscode.postMessage(Object.assign({ command }, extra || {}));
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function ui(key, fallback) {
    const strings = state.uiStrings || {};
    const value = strings[key];
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  }

  function normalizeFolderPath(value) {
    const raw = String(value ?? '').trim().replaceAll('\\', '/');
    if (!raw || raw === '.' || raw === '/') {
      return '.';
    }

    return raw
      .replace(/^\.\/+/u, '')
      .replace(/^\/+/u, '')
      .replace(/\/+$/u, '')
      .replace(/\/{2,}/gu, '/');
  }

  function getParentFolderPath(folderPath) {
    if (folderPath === '.') {
      return undefined;
    }

    const separatorIndex = folderPath.lastIndexOf('/');
    if (separatorIndex < 0) {
      return '.';
    }

    return folderPath.slice(0, separatorIndex);
  }

  function getFolderLabel(folderPath) {
    if (folderPath === '.') {
      return '.';
    }

    const separatorIndex = folderPath.lastIndexOf('/');
    return separatorIndex < 0 ? folderPath : folderPath.slice(separatorIndex + 1);
  }

  function compareConventionNodes(leftPath, rightPath, nodes) {
    const left = nodes.get(leftPath);
    const right = nodes.get(rightPath);
    const leftConfidence = Number(left && left.item ? left.item.confidence : 0);
    const rightConfidence = Number(right && right.item ? right.item.confidence : 0);
    if (rightConfidence !== leftConfidence) {
      return rightConfidence - leftConfidence;
    }

    return leftPath.localeCompare(rightPath);
  }

  function buildConventionTree(items) {
    const nodes = new Map();
    const ensureNode = (folderPath) => {
      const normalized = normalizeFolderPath(folderPath);
      const existing = nodes.get(normalized);
      if (existing) {
        return existing;
      }

      const created = {
        path: normalized,
        item: undefined,
        children: []
      };
      nodes.set(normalized, created);
      return created;
    };

    ensureNode('.');
    for (const entry of items) {
      const folderPath = normalizeFolderPath(entry.folderPath);
      ensureNode(folderPath).item = entry;
      let parentPath = getParentFolderPath(folderPath);
      while (parentPath !== undefined) {
        ensureNode(parentPath);
        if (parentPath === '.') {
          break;
        }

        parentPath = getParentFolderPath(parentPath);
      }
    }

    for (const [folderPath, node] of nodes.entries()) {
      if (folderPath === '.') {
        continue;
      }

      const parentPath = getParentFolderPath(folderPath) || '.';
      const parent = ensureNode(parentPath);
      if (!parent.children.includes(folderPath)) {
        parent.children.push(folderPath);
      }
    }

    const sortChildren = (folderPath) => {
      const node = nodes.get(folderPath);
      if (!node) {
        return;
      }

      node.children.sort((leftPath, rightPath) =>
        compareConventionNodes(leftPath, rightPath, nodes)
      );
      for (const childPath of node.children) {
        sortChildren(childPath);
      }
    };

    sortChildren('.');
    return {
      nodes,
      rootPath: '.'
    };
  }

  function deriveSyntheticConfidence(tree, folderPath, cache) {
    if (cache.has(folderPath)) {
      return cache.get(folderPath);
    }

    const node = tree.nodes.get(folderPath);
    if (!node) {
      cache.set(folderPath, 0);
      return 0;
    }

    if (node.item) {
      const confidence = Number(node.item.confidence || 0);
      const bounded = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
      cache.set(folderPath, bounded);
      return bounded;
    }

    if (node.children.length === 0) {
      cache.set(folderPath, 0);
      return 0;
    }

    let sum = 0;
    let count = 0;
    for (const childPath of node.children) {
      sum += deriveSyntheticConfidence(tree, childPath, cache);
      count += 1;
    }

    const average = count > 0 ? sum / count : 0;
    cache.set(folderPath, average);
    return average;
  }

  function buildConventionRows(tree) {
    const rows = [];
    const syntheticConfidenceCache = new Map();

    const walk = (folderPath, depth) => {
      const node = tree.nodes.get(folderPath);
      if (!node) {
        return;
      }

      const item = node.item || {
        folderPath,
        expectedSuffix: '',
        expectedPrefix: '',
        dominantKind: '',
        confidence: deriveSyntheticConfidence(tree, folderPath, syntheticConfidenceCache),
        namespaceSample: '',
        exampleTypes: []
      };

      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && expandedFolders.has(folderPath);

      rows.push({
        folderPath,
        depth,
        item,
        hasChildren,
        expanded,
        isSynthetic: !node.item
      });

      if (!expanded) {
        return;
      }

      for (const childPath of node.children) {
        walk(childPath, depth + 1);
      }
    };

    walk(tree.rootPath, 0);
    return rows;
  }

  function ensureDefaultExpandedFolders(tree) {
    const validPaths = new Set(tree.nodes.keys());
    let changed = false;
    for (const folderPath of Array.from(expandedFolders)) {
      if (!validPaths.has(folderPath)) {
        expandedFolders.delete(folderPath);
        changed = true;
      }
    }

    if (!defaultExpansionApplied && tree.nodes.size > 0) {
      expandedFolders.clear();
      expandedFolders.add('.');
      const root = tree.nodes.get('.');
      if (root) {
        for (const childPath of root.children) {
          expandedFolders.add(childPath);
        }
      }
      defaultExpansionApplied = true;
      changed = true;
    }

    if (changed) {
      persistTreeState();
    }
  }

  function confidenceHue(confidence) {
    const bounded = Math.max(0, Math.min(1, Number(confidence || 0)));
    return 8 + Math.round(112 * bounded);
  }

  function renderConfidenceCell(confidence) {
    const bounded = Math.max(0, Math.min(1, Number(confidence || 0)));
    const percent = Math.round(bounded * 100);
    const hue = confidenceHue(bounded);
    return `
      <div class="confidence-cell" title="${bounded.toFixed(2)}">
        <div class="confidence-track">
          <span class="confidence-fill" style="width:${percent}%; --confidence-hue:${hue};"></span>
        </div>
        <span class="confidence-value">${bounded.toFixed(2)}</span>
      </div>
    `;
  }

  function renderFolderCell(row) {
    const item = row.item || {};
    const folderLabel = getFolderLabel(row.folderPath);
    const folderPathMeta = row.folderPath === '.' ? ui('overviewWorkspaceRoot', 'Workspace root') : row.folderPath;
    const toggleButton = row.hasChildren
      ? `<button class="tree-toggle secondary" data-action="toggleFolder" data-folder-path="${esc(row.folderPath)}" aria-label="toggle">${row.expanded ? '▾' : '▸'}</button>`
      : '<span class="tree-spacer"></span>';
    const syntheticBadge = row.isSynthetic
      ? `<span class="folder-badge">${ui('valueAuto', '(auto)')}</span>`
      : '';
    const suffix = item.expectedSuffix ? `*${esc(item.expectedSuffix)}` : '-';
    const prefix = item.expectedPrefix ? `${esc(item.expectedPrefix)}*` : '-';
    const kind = item.dominantKind ? esc(item.dominantKind) : '-';
    const inlineNamespace = item.namespaceSample
      ? `<span class="hint-chip">${ui('tableNamespaceSample', 'Namespace sample')}: ${esc(item.namespaceSample)}</span>`
      : '';
    const inlineExamples = Array.isArray(item.exampleTypes) && item.exampleTypes.length > 0
      ? `<span class="hint-chip">${ui('tableExamples', 'Examples')}: ${item.exampleTypes.slice(0, 2).map((entry) => esc(entry)).join(', ')}</span>`
      : '';
    const inlineHints = inlineNamespace || inlineExamples
      ? `<div class="folder-hints">${inlineNamespace}${inlineExamples}</div>`
      : '';

    return `
      <div class="folder-cell" style="--depth:${row.depth};">
        ${toggleButton}
        <div class="folder-main">
          <div class="folder-line">
            <span class="folder-label">${esc(folderLabel)}</span>
            ${syntheticBadge}
          </div>
          <div class="folder-meta">${esc(folderPathMeta)}</div>
          <div class="folder-rules">
            <span class="rule-chip">${ui('tableExpectedSuffix', 'Expected suffix')}: ${suffix}</span>
            <span class="rule-chip">${ui('tableExpectedPrefix', 'Expected prefix')}: ${prefix}</span>
            <span class="rule-chip">${ui('tableDominantKind', 'Dominant kind')}: ${kind}</span>
          </div>
          ${inlineHints}
        </div>
      </div>
    `;
  }

  function renderToolbar() {
    return `
      <div class="toolbar">
        <button data-action="refresh">${ui('toolbarRefresh', 'Refresh Dashboard')}</button>
        <button data-action="rebuild">${ui('toolbarRebuild', 'Rebuild Convention Profile')}</button>
        <button data-action="refreshConventionMap" class="secondary">${ui('toolbarRefreshMap', 'Refresh Convention Map')}</button>
        <button data-action="clearLogs" class="secondary">${ui('toolbarClearLogs', 'Clear Logs')}</button>
        <button data-action="openSettings" class="secondary">${ui('toolbarOpenSettings', 'Open Settings')}</button>
        ${state.profilePath ? `<button data-action="openProfile" data-path="${esc(state.profilePath)}" class="secondary">${ui('toolbarOpenProfileJson', 'Open Profile JSON')}</button>` : ''}
      </div>
    `;
  }

  function renderOverview() {
    const o = state.overview || {};
    return `
      <details open>
        <summary>${ui('sectionOverview', 'Overview')}</summary>
        <div class="section-body">
          <div class="kv-grid">
            <div class="kv-key">${ui('overviewWorkspaceRoot', 'Workspace root')}</div><div>${esc(o.workspaceRoot || '-')}</div>
            <div class="kv-key">${ui('overviewScope', 'Scope')}</div><div>${esc(o.scope || '-')}</div>
            <div class="kv-key">${ui('overviewFilesScanned', 'Files scanned')}</div><div>${esc(o.filesScanned)}</div>
            <div class="kv-key">${ui('overviewTypesScanned', 'Types scanned')}</div><div>${esc(o.typesScanned)}</div>
            <div class="kv-key">${ui('overviewDominantCase', 'Dominant case')}</div><div>${esc(o.dominantCaseStyle || ui('valueUnknown', 'Unknown'))}</div>
            <div class="kv-key">${ui('overviewProfileUpdated', 'Profile updated')}</div><div>${esc(state.overview.profileLastUpdatedUtc || '-')}</div>
            <div class="kv-key">${ui('overviewDiagnostics', 'Diagnostics')}</div><div>${esc(o.diagnosticsCount)}</div>
            <div class="kv-key">${ui('overviewConventionFeature', 'Convention feature')}</div><div>${o.featureEnabled ? ui('valueActive', 'Active') : ui('valueInactive', 'Inactive')}</div>
            <div class="kv-key">${ui('overviewAiAnomaly', 'AI anomaly')}</div><div>${o.aiEnabled ? ui('valueActive', 'Active') : ui('valueInactive', 'Inactive')}</div>
            <div class="kv-key">${ui('overviewCoral', 'Coral')}</div><div>${o.coralActive ? ui('valueActive', 'Active') : ui('valueInactive', 'Inactive')} (${esc(o.coralDetail || ui('valueNotAvailable', 'n/a'))})</div>
            <div class="kv-key">${ui('overviewRebuildQueue', 'Rebuild queue')}</div><div>${ui('valueInFlight', 'In-flight')}: ${esc(o.inFlightRebuildCount)} | ${ui('valueQueued', 'Queued')}: ${esc(o.queuedRebuildCount)}</div>
          </div>
        </div>
      </details>
    `;
  }

  function renderSettings() {
    const rows = (state.settings || [])
      .map((item) => {
        const value = typeof item.value === 'boolean' ? (item.value ? 'true' : 'false') : String(item.value);
        const toggleButton = item.editable && item.type === 'boolean'
          ? `<button data-action="toggleSetting" data-setting-id="${esc(item.id)}" data-value="${esc(item.value)}" class="secondary">${ui('toggle', 'Toggle')}</button>`
          : '';
        return `
          <tr>
            <td>${esc(item.label)}</td>
            <td>${esc(value)}</td>
            <td>${toggleButton}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <details>
        <summary>${ui('sectionSettings', 'Settings')}</summary>
        <div class="section-body">
          ${rows
          ? `<table class="table"><thead><tr><th>${ui('tableSetting', 'Setting')}</th><th>${ui('tableValue', 'Value')}</th><th>${ui('tableAction', 'Action')}</th></tr></thead><tbody>${rows}</tbody></table>`
            : `<div class="empty">${ui('emptySettings', 'No settings snapshot available.')}</div>`}
        </div>
      </details>
    `;
  }

  function renderConventionMap() {
    const items = state.conventionMap || [];
    const tree = buildConventionTree(items);
    ensureDefaultExpandedFolders(tree);
    const rows = buildConventionRows(tree)
      .map((row) => {
        const item = row.item || {};
        const examples = Array.isArray(item.exampleTypes) && item.exampleTypes.length > 0
          ? item.exampleTypes
              .map((example) => `<span class="example-chip">${esc(example)}</span>`)
              .join('')
          : `<span class="empty">${ui('emptyExamples', 'No examples found in current workspace snapshot.')}</span>`;
        return `
          <tr class="${row.isSynthetic ? 'synthetic-row' : ''}">
            <td class="folder-column" data-label="${ui('tableFolder', 'Folder')}">${renderFolderCell(row)}</td>
            <td class="namespace-column" data-label="${ui('tableNamespaceSample', 'Namespace sample')}"><span class="namespace-value" title="${esc(item.namespaceSample || '-')}">${esc(item.namespaceSample || '-')}</span></td>
            <td class="examples-column" data-label="${ui('tableExamples', 'Examples')}">${examples}</td>
            <td class="confidence-column" data-label="${ui('tableConfidence', 'Confidence')}">${renderConfidenceCell(item.confidence)}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <details open>
        <summary>${ui('sectionConventionMap', 'Convention Map')}</summary>
        <div class="section-body">
          ${rows
            ? `<table class="table table-convention">
                <thead>
                  <tr>
                    <th>${ui('tableFolder', 'Folder')}</th>
                    <th>${ui('tableNamespaceSample', 'Namespace sample')}</th>
                    <th>${ui('tableExamples', 'Examples')}</th>
                    <th>${ui('tableConfidence', 'Confidence')}</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>`
            : `<div class="empty">${ui('emptyConventionMap', 'No convention profile loaded yet. Rebuild profile to populate this section.')}</div>`}
        </div>
      </details>
    `;
  }

  function renderDiagnostics() {
    const rows = (state.diagnostics || [])
      .map((item) => {
        const severity = (item.severity || 'info').toLowerCase();
        const confidence = Number(item.confidence || 0);
        return `
          <tr>
            <td><span class="chip severity-${esc(severity)}">${esc(severity)}</span></td>
            <td>${esc(item.filePath)}</td>
            <td>${esc(item.title)}</td>
            <td>${esc(item.ruleId)}</td>
            <td>${confidence.toFixed(2)}</td>
            <td>${esc(item.expected || '-')}</td>
            <td>${esc(item.observed || '-')}</td>
            <td>${esc(item.suggestion || '-')}</td>
            <td>
              <button class="secondary" data-action="revealDiagnostic" data-path="${esc(item.absolutePath)}" data-line="${esc(item.line)}" data-column="${esc(item.column)}">${ui('reveal', 'Reveal')}</button>
            </td>
          </tr>
        `;
      })
      .join('');

    return `
      <details open>
        <summary>${ui('sectionDiagnostics', 'Diagnostics')}</summary>
        <div class="section-body">
          ${rows
            ? `<table class="table">
                <thead>
                  <tr>
                    <th>${ui('tableSeverity', 'Severity')}</th>
                    <th>${ui('tableFile', 'File')}</th>
                    <th>${ui('tableProblem', 'Problem')}</th>
                    <th>${ui('tableRule', 'Rule')}</th>
                    <th>${ui('tableConfidence', 'Conf.')}</th>
                    <th>${ui('tableExpected', 'Expected')}</th>
                    <th>${ui('tableObserved', 'Observed')}</th>
                    <th>${ui('tableSuggestion', 'Suggestion')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>`
            : `<div class="empty">${ui('emptyDiagnostics', 'No active convention diagnostics.')}</div>`}
        </div>
      </details>
    `;
  }

  function renderLogs() {
    const rows = (state.logs || [])
      .map((entry) => {
        const level = esc(entry.level || 'info');
        return `<div class="log-line"><span class="meta">${esc(entry.timestampUtc)} [${level}]</span><br/>${esc(entry.message)}</div>`;
      })
      .join('');

    return `
      <details>
        <summary>${ui('sectionLogs', 'Logs')}</summary>
        <div class="section-body">
          ${rows || `<div class="empty">${ui('emptyLogs', 'No log entries yet.')}</div>`}
        </div>
      </details>
    `;
  }

  function render() {
    app.innerHTML = `
      ${renderToolbar()}
      <div class="meta">${ui('metaLastRefresh', 'Last refresh:')} ${esc(state.refreshedAtUtc)} ${state.loading ? `| ${ui('metaLoading', 'Loading...')}` : ''}</div>
      ${state.errorMessage ? `<div class="error">${esc(state.errorMessage)}</div>` : ''}
      ${renderOverview()}
      ${renderSettings()}
      ${renderConventionMap()}
      ${renderDiagnostics()}
      ${renderLogs()}
    `;

    app.querySelectorAll('[data-action]').forEach((element) => {
      element.addEventListener('click', () => {
        const action = element.getAttribute('data-action');
        if (!action) {
          return;
        }

        if (action === 'toggleFolder') {
          const folderPath = element.getAttribute('data-folder-path');
          if (!folderPath) {
            return;
          }

          if (expandedFolders.has(folderPath)) {
            expandedFolders.delete(folderPath);
          } else {
            expandedFolders.add(folderPath);
          }

          persistTreeState();
          render();
          return;
        }

        if (action === 'openProfile') {
          post('openProfile', { path: element.getAttribute('data-path') || '' });
          return;
        }

        if (action === 'toggleSetting') {
          post('toggleSetting', {
            settingId: element.getAttribute('data-setting-id') || '',
            value: element.getAttribute('data-value') === 'true'
          });
          return;
        }

        if (action === 'revealDiagnostic') {
          post('revealDiagnostic', {
            path: element.getAttribute('data-path') || '',
            line: Number(element.getAttribute('data-line') || '0'),
            column: Number(element.getAttribute('data-column') || '0')
          });
          return;
        }

        post(action);
      });
    });
  }

  render();
})();
