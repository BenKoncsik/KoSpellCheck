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
exports.DashboardLogService = void 0;
const vscode = __importStar(require("vscode"));
class DashboardLogService {
    constructor(maxEntries = 300) {
        this.maxEntries = maxEntries;
        this.entries = [];
        this.changeEmitter = new vscode.EventEmitter();
        this.nextId = 1;
        this.onDidChange = this.changeEmitter.event;
    }
    append(message, level = 'info') {
        const trimmed = (message ?? '').trim();
        if (!trimmed) {
            return;
        }
        this.entries.push({
            id: this.nextId++,
            timestampUtc: new Date().toISOString(),
            level,
            message: trimmed
        });
        if (this.entries.length > this.maxEntries) {
            this.entries.splice(0, this.entries.length - this.maxEntries);
        }
        this.changeEmitter.fire();
    }
    clear() {
        if (this.entries.length === 0) {
            return;
        }
        this.entries.length = 0;
        this.changeEmitter.fire();
    }
    snapshot() {
        return this.entries.slice().reverse();
    }
    dispose() {
        this.changeEmitter.dispose();
    }
}
exports.DashboardLogService = DashboardLogService;
//# sourceMappingURL=dashboardLogService.js.map