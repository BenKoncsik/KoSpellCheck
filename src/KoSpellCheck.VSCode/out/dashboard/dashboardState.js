"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardStateStore = void 0;
const vscode = __importStar(require("vscode"));
class DashboardStateStore {
    constructor() {
        this.changeEmitter = new vscode.EventEmitter();
        this.state = createEmptyState();
        this.onDidChange = this.changeEmitter.event;
    }
    setLoading() {
        this.state = {
            ...this.state,
            loading: true,
            errorMessage: undefined,
            refreshedAtUtc: new Date().toISOString()
        };
        this.changeEmitter.fire(this.state);
    }
    setData(next) {
        this.state = {
            ...next,
            loading: false
        };
        this.changeEmitter.fire(this.state);
    }
    setError(message) {
        this.state = {
            ...this.state,
            loading: false,
            errorMessage: message,
            refreshedAtUtc: new Date().toISOString()
        };
        this.changeEmitter.fire(this.state);
    }
    setLogs(logs) {
        this.state = {
            ...this.state,
            logs: logs.slice(),
            refreshedAtUtc: new Date().toISOString()
        };
        this.changeEmitter.fire(this.state);
    }
    snapshot() {
        return this.state;
    }
    dispose() {
        this.changeEmitter.dispose();
    }
}
exports.DashboardStateStore = DashboardStateStore;
function createEmptyState() {
    return {
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
        settings: [],
        conventionMap: [],
        diagnostics: [],
        logs: []
    };
}
//# sourceMappingURL=dashboardState.js.map