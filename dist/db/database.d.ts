/// <reference path="../../src/types/sql.js.d.ts" />
import { Database as SqlJsDatabase } from 'sql.js';
export declare function initDb(): Promise<SqlJsDatabase>;
export declare function saveDb(): void;
export declare function getDb(): SqlJsDatabase;
export declare function dbRun(sql: string, params?: any[]): {
    lastInsertRowid: number;
    changes: number;
};
export declare function dbGet(sql: string, params?: any[]): any;
export declare function dbAll(sql: string, params?: any[]): any[];
export declare function closeDb(): void;
//# sourceMappingURL=database.d.ts.map