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
    const rows = items
      .map((item) => {
        const examples = item.exampleTypes && item.exampleTypes.length > 0
          ? item.exampleTypes.map((example) => `<li>${esc(example)}</li>`).join('')
          : `<li class="empty">${ui('emptyExamples', 'No examples found in current workspace snapshot.')}</li>`;
        return `
          <tr>
            <td>${esc(item.folderPath)}</td>
            <td>${item.expectedSuffix ? `*${esc(item.expectedSuffix)}` : '-'}</td>
            <td>${item.expectedPrefix ? `${esc(item.expectedPrefix)}*` : '-'}</td>
            <td>${esc(item.dominantKind || '-')}</td>
            <td>${Number(item.confidence || 0).toFixed(2)}</td>
            <td>${esc(item.namespaceSample || '-')}</td>
            <td><ul class="list">${examples}</ul></td>
          </tr>
        `;
      })
      .join('');

    return `
      <details open>
        <summary>${ui('sectionConventionMap', 'Convention Map')}</summary>
        <div class="section-body">
          ${rows
            ? `<table class="table">
                <thead>
                  <tr>
                    <th>${ui('tableFolder', 'Folder')}</th>
                    <th>${ui('tableExpectedSuffix', 'Expected suffix')}</th>
                    <th>${ui('tableExpectedPrefix', 'Expected prefix')}</th>
                    <th>${ui('tableDominantKind', 'Dominant kind')}</th>
                    <th>${ui('tableConfidence', 'Confidence')}</th>
                    <th>${ui('tableNamespaceSample', 'Namespace sample')}</th>
                    <th>${ui('tableExamples', 'Examples')}</th>
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
