/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { COBOLFileSymbol, COBOLGlobalSymbolTable } from "./cobolglobalcache";
import { GlobalCachesHelper } from "./globalcachehelper";

export class COBOLWorkspaceSymbolCacheHelper {
    private static removeAllProgramSymbols(srcfilename: string, symbolsCache: Map<string, COBOLFileSymbol[]>): void {
        for (const [key] of symbolsCache) {
            const symbolList: COBOLFileSymbol[] | undefined = symbolsCache.get(key);
            if (symbolList !== undefined) {
                const newSymbols:COBOLFileSymbol[] = [];
                for (let i = 0; i < symbolList.length; i++) {
                    if (symbolList[i].filename !== srcfilename) {
                        newSymbols.push(symbolList[i]);
                    }
                }

                if (newSymbols.length !== symbolList.length) {
                    symbolsCache.set(key, newSymbols);
                }
            }
        }
    }

    private static addSymbolToCache(srcfilename: string, symbolUnchanged: string, lineNumber: number, symbolsCache: Map<string, COBOLFileSymbol[]>) {
        const symbol = symbolUnchanged.toLowerCase();
        if (symbolsCache.has(symbol)) {
            const symbolList: COBOLFileSymbol[] | undefined = symbolsCache.get(symbol);

            /* search the list of COBOLFileSymbols */
            if (symbolList !== undefined) {
                let foundCount = 0;
                let foundLast = 0;
                let foundLastNonFileSymbol = -1;
                for (let i = 0; i < symbolList.length; i++) {
                    if (symbolList[i].filename === srcfilename) {
                        foundLast = i;
                        foundCount++;

                        // remember last non file line number
                        if (symbolList[i].lnum !== 1) {
                            foundLastNonFileSymbol = i;
                        }
                    }
                }
                // not found?
                if (foundCount === 0) {
                    symbolList.push(new COBOLFileSymbol(srcfilename, lineNumber));
                    InMemoryGlobalSymbolCache.isDirty = true;
                    return;
                }
                // if we have only one symbol, then we can update it
                if (foundCount === 1) {
                    symbolList[foundLast].lnum = lineNumber;
                } else {
                    // if we have multiple, never update the filename symbol which has a line number of 1
                    if (foundLastNonFileSymbol !== -1) {
                        symbolList[foundLastNonFileSymbol].lnum = lineNumber;
                    }
                }

                return;
            }
        }
        const symbolList = [];
        symbolList.push(new COBOLFileSymbol(srcfilename, lineNumber));
        symbolsCache.set(symbol, symbolList);
        InMemoryGlobalSymbolCache.isDirty = true;
        return;
    }

    public static addSymbol(srcfilename: string, symbolUnchanged: string, lineNumber = 1): void {
        COBOLWorkspaceSymbolCacheHelper.addSymbolToCache(
            GlobalCachesHelper.getFilenameWithoutPath(srcfilename), symbolUnchanged, lineNumber, InMemoryGlobalSymbolCache.callableSymbols);
    }

    public static addEntryPoint(srcfilename: string, symbolUnchanged: string, lineNumber: number): void {
        COBOLWorkspaceSymbolCacheHelper.addSymbolToCache(
            GlobalCachesHelper.getFilenameWithoutPath(srcfilename), symbolUnchanged, lineNumber, InMemoryGlobalSymbolCache.entryPoints);
    }

    public static removeAllProgramEntryPoints(srcfilename: string):void {
        COBOLWorkspaceSymbolCacheHelper.removeAllProgramSymbols(GlobalCachesHelper.getFilenameWithoutPath(srcfilename),
        InMemoryGlobalSymbolCache.entryPoints);
    }

    public static loadGlobalCacheFromArray(symbols: string[]): void {
        for (const symbol of symbols) {
            const symbolValues = symbol.split(",");
            if (symbolValues.length === 2) {
                COBOLWorkspaceSymbolCacheHelper.addSymbol(symbolValues[1], symbolValues[0]);
            }
        }
    }

    public static loadGlobalEntryCacheFromArray(symbols: string[]): void {
        for (const symbol of symbols) {
            const symbolValues = symbol.split(",");
            if (symbolValues.length === 3) {
                COBOLWorkspaceSymbolCacheHelper.addEntryPoint(symbolValues[1], symbolValues[0], Number.parseInt(symbolValues[2]));
            }
        }
    }
}

export const InMemoryGlobalSymbolCache: COBOLGlobalSymbolTable = new COBOLGlobalSymbolTable();
