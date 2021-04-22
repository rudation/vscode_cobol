import path from "path";
import fs from 'fs';

import { extensions, FileType, Uri, workspace } from "vscode";
import { getWorkspaceFolders } from "./cobolfolders";
import { COBSCANNER_ADDFILE, COBSCANNER_KNOWNCOPYBOOK, COBSCANNER_SENDCLASS, COBSCANNER_SENDENUM, COBSCANNER_SENDEP, COBSCANNER_SENDINTERFACE, COBSCANNER_SENDPRGID, COBSCANNER_STATUS, ScanData, ScanDataHelper } from "./cobscannerdata";
import { VSCOBOLConfiguration } from "./configuration";
import { COBOLStatUtils, logChannelHide, logChannelSetPreserveFocus, logException, logMessage, progressStatusBarItem } from "./extension";
import { ICOBOLSettings } from "./iconfiguration";
import { COBOLFileUtils } from "./opencopybook";
import VSCOBOLSourceScanner from "./vscobolscanner";
import { fork, ForkOptions } from 'child_process';
import { COBOLWorkspaceSymbolCacheHelper, TypeCategory } from "./cobolworkspacecache";
import { COBOLUtils } from "./cobolutils";
import tempDirectory from 'temp-dir';
import { InMemoryGlobalCacheHelper } from "./globalcachehelper";
import { COBOLWorkspaceFile } from "./cobolglobalcache";
import { COBOLSourceScannerUtils } from "./cobolsourcescannerutils";


class ScanStats {
    parentPid = 0;
    filesIgnored = 0;
    directoriesScanned = 0;
    directoryDepth = 0;
    maxDirectoryDepth = 0;
    fileCount = 0;
    showMessage = false;
    directoriesScannedMap: Map<string, Uri> = new Map<string, Uri>();
}

export class VSCobScanner {
    public static readonly scannerBinDir = VSCobScanner.getCobScannerDirectory();

    public static async processSavedFile(fsPath: string, settings: ICOBOLSettings): Promise<void> {
        if (VSCOBOLConfiguration.isOnDiskCachingEnabled() === false) {
            return;
        }

        // handle when parsed
        if (settings.parse_copybooks_for_references) {
            return;
        }

        // cleanup old sym files
        const cacheDirectory = VSCOBOLSourceScanner.getCacheDirectory();
        if (cacheDirectory !== undefined) {
            COBOLSourceScannerUtils.cleanUpOldMetadataFiles(settings, cacheDirectory);
        }

        if (COBOLFileUtils.isValidCopybookExtension(fsPath, settings) || COBOLFileUtils.isValidProgramExtension(fsPath, settings)) {
            COBOLUtils.saveGlobalCacheToWorkspace(settings,false);
            const sf = new ScanData();
            sf.showStats = false;
            sf.Files.push(fsPath);
            sf.parse_copybooks_for_references = settings.parse_copybooks_for_references;
            sf.showMessage = settings.cache_metadata_show_progress_messages;
            sf.md_symbols = settings.metadata_symbols;
            sf.md_entrypoints = settings.metadata_entrypoints;
            sf.md_types = settings.metadata_types;
            sf.md_metadata_files = settings.metadata_files;
            sf.md_metadata_knowncopybooks = settings.metadata_knowncopybooks;
            await this.forkScanner(settings, sf, "OnSave", true);
        }
    }

    private static getCobScannerDirectory(): string {
        const thisExtension = extensions.getExtension("bitlang.cobol");
        if (thisExtension !== undefined) {
            const extPath = `${thisExtension.extensionPath}`;
            return path.join(extPath, "cobscanner");
        }
        return "";
    }

    private static activePid = 0;

    public static isAlive(pid: number): boolean {
        if (this.activePid === 0) {
            return false;
        }

        try {
            return process.kill(pid, 0);
        }
        catch (e) {
            return e.code === 'EPERM';
        }
    }

    private static removeScannerFile(cacheDirectory: string): void {
        const jsonFile = path.join(cacheDirectory, ScanDataHelper.scanFilename);
        try {
            fs.unlinkSync(jsonFile);
        } catch {
            //continue
        }
    }

    public static IsScannerActive(cacheDirectory: string): boolean {

        const jsonFile = path.join(cacheDirectory, ScanDataHelper.scanFilename);
        const jsonFileExists = fs.existsSync(jsonFile);

        if (VSCobScanner.activePid === 0) {
            return jsonFileExists;
        }

        // if the file exists.. then leave early
        if (jsonFileExists) {
            return jsonFileExists;
        }

        return this.isAlive(VSCobScanner.activePid);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public static async forkScanner(settings: ICOBOLSettings, sf: ScanData, reason: string, deprecatedMode: boolean): Promise<void> {
        ScanDataHelper.save(tempDirectory, sf);

        const jcobscanner_js = path.join(VSCobScanner.scannerBinDir, "cobscanner.js");
        const jsonFile = path.join(tempDirectory, ScanDataHelper.scanFilename);

        const options: ForkOptions = {
            stdio: [0, 1, 2, "ipc"],
            cwd: VSCobScanner.scannerBinDir
        };

        const child = fork(jcobscanner_js, [jsonFile], options);
        if (child == undefined) {
            return;
        }

        VSCobScanner.activePid = child.pid;

        child.on('error', err => {
            if (tempDirectory !== undefined) {
                VSCobScanner.removeScannerFile(tempDirectory);
            }
            logException(`Fork caused ${reason}`, err);
        });

        child.on('exit', code => {
            VSCobScanner.activePid = 0;
            if (code !== 0) {
                if (sf.showMessage) {
                    logMessage(`External scan completed [Exit Code=${code}/${reason}]`);
                }
            } else {
                progressStatusBarItem.hide();
            }
            COBOLUtils.saveGlobalCacheToWorkspace(settings);
        });

        let prevPercent = 0;
        child.on('message', (msg) => {
            const message = msg as string;
            if (message.startsWith("@@")) {
                if (message.startsWith(COBSCANNER_STATUS)) {
                    const args = message.split(" ");
                    progressStatusBarItem.show();
                    const a1 = Number.parseInt(args[1], 10);
                    const a2 = Number.parseInt(args[2], 10);
                    const percent = ((a1 / a2) * 100) | 0;
                    if (prevPercent !== percent) {
                        progressStatusBarItem.text = `Processing metadata: ${percent}%`;
                        prevPercent = percent;
                    }
                }
                else if (message.startsWith(COBSCANNER_SENDEP)) {
                    const args = message.split(",");
                    const tokenName = args[1];
                    const tokenLine = Number.parseInt(args[2], 10);
                    const tokenFilename = args[3];
                    COBOLWorkspaceSymbolCacheHelper.addEntryPoint(tokenFilename, tokenName, tokenLine);
                }
                else if (message.startsWith(COBSCANNER_SENDPRGID)) {
                    const args = message.split(",");
                    const tokenName = args[1];
                    const tokenLine = Number.parseInt(args[2], 10);
                    const tokenFilename = args[3];
                    COBOLWorkspaceSymbolCacheHelper.removeAllProgramEntryPoints(tokenFilename);
                    COBOLWorkspaceSymbolCacheHelper.removeAllTypes(tokenFilename);
                    COBOLWorkspaceSymbolCacheHelper.addSymbol(tokenFilename, tokenName, tokenLine);
                }
                else if (message.startsWith(COBSCANNER_SENDCLASS)) {
                    const args = message.split(",");
                    const tokenName = args[1];
                    const tokenLine = Number.parseInt(args[2], 10);
                    const tokenFilename = args[3];
                    COBOLWorkspaceSymbolCacheHelper.addClass(tokenFilename, tokenName, tokenLine, TypeCategory.ClassId);
                }
                else if (message.startsWith(COBSCANNER_SENDINTERFACE)) {
                    const args = message.split(",");
                    const tokenName = args[1];
                    const tokenLine = Number.parseInt(args[2], 10);
                    const tokenFilename = args[3];
                    COBOLWorkspaceSymbolCacheHelper.addClass(tokenFilename, tokenName, tokenLine, TypeCategory.InterfaceId);
                }
                else if (message.startsWith(COBSCANNER_SENDENUM)) {
                    const args = message.split(",");
                    const tokenName = args[1];
                    const tokenLine = Number.parseInt(args[2], 10);
                    const tokenFilename = args[3];
                    COBOLWorkspaceSymbolCacheHelper.addClass(tokenFilename, tokenName, tokenLine, TypeCategory.EnumId);
                } else if (message.startsWith(COBSCANNER_ADDFILE)) {
                    const args = message.split(",");
                    const ms = BigInt(args[1]);
                    const fullFilename = args[2];
                    const shortFilename = COBOLStatUtils.getShortWorkspaceFilename(fullFilename);
                    if (shortFilename !== undefined) {
                        const cws = new COBOLWorkspaceFile(ms, shortFilename);
                        if (fullFilename !== undefined) {
                            InMemoryGlobalCacheHelper.addFilename(fullFilename, cws);
                            COBOLWorkspaceSymbolCacheHelper.removeAllProgramEntryPoints(shortFilename);
                        }
                    }
                } else if (message.startsWith(COBSCANNER_KNOWNCOPYBOOK)) {
                    const args = message.split(",");
                    const enKey = args[1];
                    const inFilename = args[2];
                    COBOLWorkspaceSymbolCacheHelper.addReferencedCopybook(enKey,inFilename);
                }
            } else {
                logMessage(msg as string);
            }
        });

        if (child.stdout !== null) {
            for await (const data of child.stdout) {
                // compress the output
                const lines: string = data.toString();
                for (const line of lines.split("\n")) {
                    const lineTrimmed = line.trim();
                    if (lineTrimmed.length !== 0) {
                        logMessage(` ${line}`);
                    }
                }
            }
        }
    }

    public static async processAllFilesInWorkspaceOutOfProcess(viaCommand: boolean, deprecatedMode: boolean): Promise<void> {

        const msgViaCommand = "(" + (viaCommand ? "on demand" : "startup") + ")";
        const settings = VSCOBOLConfiguration.get();

        if (deprecatedMode) {
            if (VSCOBOLConfiguration.isOnDiskCachingEnabled() === false) {
                logMessage(`Metadata cache is off, no action taken ${msgViaCommand}`);
                return;
            }

            const cacheDirectory = VSCOBOLSourceScanner.getCacheDirectory();
            if (cacheDirectory !== undefined && VSCobScanner.IsScannerActive(cacheDirectory)) {
                COBOLSourceScannerUtils.cleanUpOldMetadataFiles(settings, cacheDirectory);
                if (!viaCommand) {
                    logMessage(`Source scanner lock file is present on startup ${msgViaCommand}`);
                    VSCobScanner.removeScannerFile(cacheDirectory);
                    logMessage(` - lock file released`);
                } else {
                    logMessage(`Source scanner already active, no action taken ${msgViaCommand}`);
                    return;
                }
            }
        }

        const ws = getWorkspaceFolders();
        const stats = new ScanStats();
        const files: string[] = [];

        if (ws === undefined) {
            logMessage(`No workspace folders available ${msgViaCommand}`);
            return;
        }

        if (!viaCommand) {
            logChannelHide();
        } else {
            logChannelSetPreserveFocus(!viaCommand);
        }
        logMessage("");
        logMessage(`Starting to process metadata from workspace folders ${msgViaCommand}`);

        if (ws !== undefined) {
            for (const folder of ws) {
                try {
                    await VSCobScanner.generateCOBScannerData(settings, folder.uri, stats, files);
                } catch {
                    continue;
                }
            }

        }

        COBOLUtils.saveGlobalCacheToWorkspace(settings, false);
        const sf = new ScanData();
        sf.directoriesScanned = stats.directoriesScanned;
        sf.maxDirectoryDepth = stats.maxDirectoryDepth;
        sf.fileCount = stats.fileCount;

        sf.parse_copybooks_for_references = settings.parse_copybooks_for_references;
        sf.Files = files;
        sf.showMessage = settings.cache_metadata_show_progress_messages;
        sf.md_symbols = settings.metadata_symbols;
        sf.md_entrypoints = settings.metadata_entrypoints;
        sf.md_metadata_files = settings.metadata_files;
        sf.md_metadata_knowncopybooks = settings.metadata_knowncopybooks;
        for (const [, uri] of stats.directoriesScannedMap) {
            sf.Directories.push(uri.fsPath);
        }

        if (ws !== undefined) {
            for (const f of ws) {
                if (f !== undefined && f.uri.scheme === 'file') {
                    sf.workspaceFolders.push(f.uri.fsPath);
                }
            }
        }

        await VSCobScanner.forkScanner(settings, sf, msgViaCommand, deprecatedMode);
    }

    private static async generateCOBScannerData(settings: ICOBOLSettings, folder: Uri, stats: ScanStats, files2scan: string[]): Promise<boolean> {
        const entries = await workspace.fs.readDirectory(folder);
        stats.directoriesScanned++;
        if (stats.directoriesScannedMap.has(folder.fsPath)) {
            return true;
        }

        if (stats.showMessage) {
            const spaces = " ".repeat(stats.directoryDepth);
            logMessage(` ${spaces}Directory : ${folder.fsPath}`);
        }
        stats.directoriesScannedMap.set(folder.fsPath, folder);

        const dir2scan: Uri[] = [];

        for (const [entry, fileType] of entries) {
            switch (fileType) {
                case FileType.File | FileType.SymbolicLink:
                    {
                        const spaces4file = " ".repeat(1 + stats.directoryDepth);
                        logMessage(`${spaces4file} File : ${entry} in ${folder.fsPath} is a symbolic link which may cause duplicate data to be cached`);
                    }
                // eslint-disable-next-line no-fallthrough
                case FileType.File:
                    {
                        const fullPath = path.join(folder.fsPath, entry);
                        if (COBOLFileUtils.isValidProgramExtension(fullPath, settings) || COBOLFileUtils.isValidCopybookExtension(fullPath, settings)) {
                            files2scan.push(fullPath);
                            stats.fileCount++;
                        } else {
                            stats.filesIgnored++;
                        }
                    }
                    break;
                case FileType.Directory | FileType.SymbolicLink:
                    {
                        const spaces4dir = " ".repeat(1 + stats.directoryDepth);
                        logMessage(`${spaces4dir} Directory : ${entry} in ${folder.fsPath} is a symbolic link which may cause duplicate data to be cached`);
                    }
                // eslint-disable-next-line no-fallthrough
                case FileType.Directory:
                    if (!VSCOBOLSourceScanner.ignoreDirectory(entry)) {
                        const fullDirectory = path.join(folder.fsPath, entry);
                        if (!VSCOBOLSourceScanner.ignoreDirectory(entry)) {
                            try {
                                dir2scan.push(Uri.file(fullDirectory));
                            } catch (ex) {
                                logMessage(` Uri.file failed with ${fullDirectory} from ${folder.fsPath} + ${entry}`);
                                if (ex instanceof Error) {
                                    logException("Unexpected abort during Uri Parse", ex as Error);
                                } else {
                                    logMessage(ex);
                                }
                            }
                        }
                    }
                    break;
            }
        }

        if (dir2scan.length !== 0) {
            if (1 + stats.directoryDepth <= settings.cache_metadata_max_directory_scan_depth) {
                stats.directoryDepth++;
                for (const directoryUri of dir2scan) {
                    try {
                        await VSCobScanner.generateCOBScannerData(settings, directoryUri, stats, files2scan);
                    } catch {
                        continue;       // file not found
                    }
                }
                if (stats.directoryDepth > stats.maxDirectoryDepth) {
                    stats.maxDirectoryDepth = stats.directoryDepth;
                }
                stats.directoryDepth--;
            } else {
                logMessage(` Directories below : ${folder.fsPath} has not been scanned (depth limit is ${settings.cache_metadata_max_directory_scan_depth})`);
            }

        }

        return true;
    }


}
