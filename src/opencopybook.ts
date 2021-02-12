'use strict';

import { Range, TextDocument, Definition, Position, CancellationToken, Uri } from 'vscode';
import * as vscode from 'vscode';
import * as path from 'path';
import * as process from 'process';
import { getCombinedCopyBookSearchPath, COBOLStatUtils} from './extension';
import { VSCOBOLConfiguration } from './configuration';
import { COBOLSettings, ICOBOLSettings } from './iconfiguration';


export class COBOLFileUtils {
    static readonly isWin32 = process.platform === "win32";

    public static isValidCopybookExtension(filename: string, settings: COBOLSettings): boolean {
        const lastDot = filename.lastIndexOf(".");
        let extension = filename;
        if (lastDot !== -1) {
            extension = filename.substr(1 + lastDot);
        }

        const exts = settings.copybookexts;
        for (let extpos = 0; extpos < exts.length; extpos++) {
            if (exts[extpos] === extension) {
                return true;
            }
        }
        return false;
    }

    public static isValidProgramExtension(filename: string, settings: COBOLSettings): boolean {
        const lastDot = filename.lastIndexOf(".");
        let extension = "";
        if (lastDot !== -1) {
            extension = filename.substr(1 + lastDot);
        }

        const exts = settings.program_extensions;
        for (let extpos = 0; extpos < exts.length; extpos++) {
            if (exts[extpos] === extension) {
                return true;
            }
        }
        return false;
    }

    public static isDirectPath(dir: string): boolean {
        if (dir === undefined && dir === null) {
            return false;
        }

        if (COBOLFileUtils.isWin32) {
            if (dir.length > 2 && dir[1] === ':') {
                return true;
            }

            if (dir.length > 1 && dir[0] === '\\') {
                return true;
            }

            return false;
        }

        if (dir.length > 1 && dir[0] === '/') {
            return true;
        }

        return false;
    }

    // only handle unc filenames
    public static isNetworkPath(dir: string): boolean {
        if (dir === undefined && dir === null) {
            return false;
        }

        if (COBOLFileUtils.isWin32) {
            if (dir.length > 1 && dir[0] === '\\') {
                return true;
            }
        }

        return false;
    }

    public static findCopyBook(filename: string, config: ICOBOLSettings): string {
        if (!filename) {
            return "";
        }

        const hasDot = filename.indexOf(".");

        for (const copybookdir of getCombinedCopyBookSearchPath()) {

            /* check for the file as is.. */
            const firstPossibleFile = path.join(copybookdir, filename);
            if (COBOLStatUtils.isFile(firstPossibleFile)) {
                return firstPossibleFile;
            }

            /* no extension? */
            if (hasDot === -1) {
                // search through the possible extensions
                for (const ext of config.copybookexts) {
                    const possibleFile = path.join(copybookdir, filename + "." + ext);

                    if (COBOLStatUtils.isFile(possibleFile)) {
                        return possibleFile;
                    }
                }
            }
        }

        return "";
    }

    public static findCopyBookInDirectory(filename: string, inDirectory: string, config: ICOBOLSettings): string {
        if (!filename) {
            return "";
        }

        const hasDot = filename.indexOf(".");

        for (const baseCopybookdir of getCombinedCopyBookSearchPath()) {
            const copybookdir = path.join(baseCopybookdir, inDirectory);

            /* check for the file as is.. */
            const firstPossibleFile = path.join(copybookdir, filename);
            if (COBOLStatUtils.isFile(firstPossibleFile)) {
                return firstPossibleFile;
            }

            /* no extension? */
            if (hasDot === -1) {
                // search through the possible extensions
                for (const ext of config.copybookexts) {
                    const possibleFile = path.join(copybookdir, filename + "." + ext);

                    if (COBOLStatUtils.isFile(possibleFile)) {
                        return possibleFile;
                    }
                }
            }

        }

        return "";
    }

}

export class COBOLCopyBookProvider implements vscode.DefinitionProvider {

    readonly sectionRegEx = new RegExp('[0-9a-zA-Z][a-zA-Z0-9-_]*');
    readonly variableRegEx = new RegExp('[#0-9a-zA-Z][a-zA-Z0-9-_]*');
    readonly callRegEx = new RegExp('[0-9a-zA-Z][a-zA-Z0-9-_]*');
    readonly classRegEx = new RegExp('[0-9a-zA-Z][a-zA-Z0-9-_]*');
    readonly methodRegEx = new RegExp('[0-9a-zA-Z][a-zA-Z0-9-_]*');
    readonly oraIncDirectives = ["#oraincfld{", "#oraincfldpro{", "#oraincfldproind{", "#oraincupdate{", "#oraincstru{", "#oraincstruind{", "#oraincppp2stru{", "#oraincstru2ppp{", "#oraincfld2{", "#oraincstrutab{", "#oraincstrutabind{", "#oraincstru2tstru{", "#orainctstru2stru{", "#oraincstrupoz{", "#oraincflddyn{", "#oraincflddyn2{", "#oraincsprvar{", "#dodaj{"];

    public provideDefinition(document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition> {
        return this.resolveDefinitions(document, position, token);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private async resolveDefinitions(doc: TextDocument, pos: Position, ct: CancellationToken): Promise<Definition> {
        const config = VSCOBOLConfiguration.get();
        const line = doc.lineAt(pos);
        const text = line.text;
        const textLower = text.toLowerCase().replace("\t", " ");
        const filename = this.extractCopyBoolFilename(text);
        let inPos = -1;

        // leave asap
        if (filename === undefined) {
            return [];
        }

        // exec sql include "has" in in the line.. so becareful
        if (textLower.indexOf("copy") !== -1) {
            inPos = textLower.indexOf(" in ");
        }

        let inDirectory = inPos !== -1 ? text.substr(2 + inPos) : "";

        if (inDirectory.length !== 0) {
            let inDirItems = inDirectory.trim();

            if (inDirItems.endsWith(".")) {
                inDirItems = inDirItems.substr(0, inDirItems.length - 1);
            }

            if (inDirItems.endsWith("\"") && inDirItems.startsWith("\"")) {
                inDirItems = inDirItems.substr(1, inDirItems.length - 2);
            }

            if (inDirItems.endsWith("'") && inDirItems.startsWith("'")) {
                inDirItems = inDirItems.substr(1, inDirItems.length - 2);
            }

            inDirectory = inDirItems;
        }

        if (filename !== null && filename.length !== 0) {
            const fullPath = COBOLCopyBookProvider.expandLogicalCopyBookToFilenameOrEmpty(filename.trim(), inDirectory, config);
            if (fullPath.length !== 0) {
                return new vscode.Location(
                    Uri.file(fullPath),
                    new Range(new Position(0, 0), new Position(0, 0))
                );
            }
        }

        return [];
    }

    public static expandLogicalCopyBookToFilenameOrEmpty(filename: string, inDirectory: string, config: ICOBOLSettings): string {

        if (inDirectory === null || inDirectory.length === 0) {
            const fullPath = COBOLFileUtils.findCopyBook(filename, config);
            if (fullPath.length !== 0) {
                return path.normalize(fullPath);
            }

            return fullPath;
        }

        const fullPath = COBOLFileUtils.findCopyBookInDirectory(filename, inDirectory, config);
        if (fullPath.length !== 0) {
            return path.normalize(fullPath);
        }

        return fullPath;
    }

    private extractCopyBoolFilename(str: string): string | undefined {
        const copyPos = str.toLowerCase().indexOf("copy");
        if (copyPos !== -1) {
            const noCopyStr = str.substr(4 + copyPos).trimLeft();
            const spacePos = noCopyStr.indexOf(" ");
            let justCopyArg = noCopyStr;
            if (spacePos !== -1) {
                justCopyArg = justCopyArg.substr(0, spacePos).trim();
            }

            // remove trailing .
            if (justCopyArg.endsWith(".")) {
                justCopyArg = justCopyArg.substr(0, justCopyArg.length - 1);
                justCopyArg = justCopyArg.trim();
            }

            // remove double quote
            if (justCopyArg.startsWith('"') && justCopyArg.endsWith('"')) {
                justCopyArg = justCopyArg.substr(1, justCopyArg.length - 2);
                justCopyArg = justCopyArg.trim();
                return justCopyArg;
            }

            // remove single quote
            if (justCopyArg.startsWith('\'') && justCopyArg.endsWith('\'')) {
                justCopyArg = justCopyArg.substr(1, justCopyArg.length - 2);
                justCopyArg = justCopyArg.trim();
            }

            return justCopyArg;
        }

        const strLower = str.toLowerCase();
        if (strLower.indexOf("exec") !== -1) {
            if (strLower.includes("sql", strLower.indexOf("exec"))) {
                let includePos = strLower.indexOf("include");
                if (includePos !== -1) {
                    includePos += 7;
                    const strRight = str.substr(includePos).trimLeft();
                    const strRightLower = strRight.toLowerCase();
                    const endExecPos = strRightLower.indexOf("end-exec");
                    if (endExecPos !== -1) {
                        const filename = strRight.substr(0, endExecPos).trim();

                        return filename;
                    }
                }
            }
        }

        const includePos = str.toLowerCase().indexOf("#include");
        if (includePos !== -1) {
            const noIncludeStr = str.substr(8 + includePos).trimLeft();
            const spacePos = noIncludeStr.indexOf(" ");
            let justIncludeArg = noIncludeStr;
            if (spacePos !== -1) {
                justIncludeArg = justIncludeArg.substr(0, spacePos).trim();
            }

            // remove trailing .
            if (justIncludeArg.endsWith(".")) {
                justIncludeArg = justIncludeArg.substr(0, justIncludeArg.length - 1);
                justIncludeArg = justIncludeArg.trim();
            }

            // remove double quote
            if (justIncludeArg.startsWith('"') && justIncludeArg.endsWith('"')) {
                justIncludeArg = justIncludeArg.substr(1, justIncludeArg.length - 2);
                justIncludeArg = justIncludeArg.trim();
                return justIncludeArg;
            }

            // remove single quote
            if (justIncludeArg.startsWith('\'') && justIncludeArg.endsWith('\'')) {
                justIncludeArg = justIncludeArg.substr(1, justIncludeArg.length - 2);
                justIncludeArg = justIncludeArg.trim();
            }

            return justIncludeArg;
        }

        let i: number;
        for (i = 0; i < this.oraIncDirectives.length; i++) {
            if (str.includes(this.oraIncDirectives[i])) {
                break;
            }
        }
        if (i < this.oraIncDirectives.length) {
            const noOraincstruStr = str.substr(this.oraIncDirectives[i].length).trimLeft();
            const spacePos = noOraincstruStr.indexOf(",");
            let justOraincstruArg = noOraincstruStr;
            if (spacePos !== -1) {
                justOraincstruArg = justOraincstruArg.substr(0, spacePos).trim();
            }

            // remove trailing .
            if (justOraincstruArg.endsWith(".")) {
                justOraincstruArg = justOraincstruArg.substr(0, justOraincstruArg.length - 1);
                justOraincstruArg = justOraincstruArg.trim();
            }

            // remove trailing .
            if (justOraincstruArg.endsWith("}")) {
                justOraincstruArg = justOraincstruArg.substr(0, justOraincstruArg.length - 1);
                justOraincstruArg = justOraincstruArg.trim();
            }

            // remove double quote
            if (justOraincstruArg.startsWith('"') && justOraincstruArg.endsWith('"')) {
                justOraincstruArg = justOraincstruArg.substr(1, justOraincstruArg.length - 2);
                justOraincstruArg = justOraincstruArg.trim();
                return justOraincstruArg;
            }

            // remove single quote
            if (justOraincstruArg.startsWith('\'') && justOraincstruArg.endsWith('\'')) {
                justOraincstruArg = justOraincstruArg.substr(1, justOraincstruArg.length - 2);
                justOraincstruArg = justOraincstruArg.trim();
            }

            return justOraincstruArg;
        }

        return undefined;
    }

}
