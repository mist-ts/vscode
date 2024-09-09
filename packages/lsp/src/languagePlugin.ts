import {
    CodeMapping,
    forEachEmbeddedCode,
    type LanguagePlugin,
    type VirtualCode,
} from "@volar/language-core";
import { Parser, ParserError } from "@mistts/parser";
import {
    ImportStatement,
    Statement,
    StatementName,
} from "@mistts/parser/dist/parser/statement.js";
import type * as ts from "typescript";
import * as html from "vscode-html-languageservice";
import { URI } from "vscode-uri";

export const mistLanguagePlugin: LanguagePlugin<URI> = {
    getLanguageId(uri) {
        if (uri.path.endsWith("mist")) {
            return "mist";
        }

        return undefined;
    },
    createVirtualCode(_uri, languageId, snapshot) {
        if (languageId === "mist") {
            return new Html1VirtualCode(snapshot);
        }

        return undefined;
    },
    typescript: {
        extraFileExtensions: [
            {
                extension: "mist",
                isMixedContent: true,
                scriptKind: 7 satisfies ts.ScriptKind.Deferred,
            },
        ],
        getServiceScript() {
            return undefined;
        },
        getExtraServiceScripts(fileName, root) {
            const scripts = [];
            for (const code of forEachEmbeddedCode(root)) {
                if (code.languageId === "typescript") {
                    scripts.push({
                        fileName: fileName + "." + code.id + ".ts",
                        code,
                        extension: ".ts",
                        scriptKind: 3 satisfies ts.ScriptKind.TS,
                    });
                }
            }
            return scripts;
        },
    },
};

const htmlLs = html.getLanguageService();

export class Html1VirtualCode implements VirtualCode {
    id = "root";
    languageId = "html";
    mappings: CodeMapping[];
    embeddedCodes: VirtualCode[] = [];
    errors: {
        start: number;
        end: number;
        message: string;
    }[] = [];
    importedFilePaths: string[] = [];

    // Reuse in custom language service plugin
    htmlDocument: html.HTMLDocument;
    parser: Parser;

    constructor(public snapshot: ts.IScriptSnapshot) {
        this.mappings = [
            {
                sourceOffsets: [0],
                generatedOffsets: [0],
                lengths: [snapshot.getLength()],
                data: {
                    completion: true,
                    format: true,
                    navigation: true,
                    semantic: true,
                    structure: true,
                    verification: true,
                },
            },
        ];
        this.htmlDocument = htmlLs.parseHTMLDocument(
            html.TextDocument.create(
                "",
                "html",
                0,
                snapshot.getText(0, snapshot.getLength())
            )
        );
        this.parser = new Parser(snapshot.getText(0, snapshot.getLength()), "");

        let statements;
        try {
            statements = this.parser.parse();
        } catch (err) {
            if (err instanceof ParserError) {
                this.errors.push({
                    message: err.baseMessage,
                    start: err.position.start,
                    end: err.position.end,
                });
            }

            return;
        }

        for (const statement of statements) {
            if (!(statement instanceof ImportStatement)) continue;

            const filePath = statement.filePath;
            if (!filePath) continue;

            this.importedFilePaths.push(filePath);
        }

        this.embeddedCodes = [...getHtml1EmbeddedCodes(snapshot, statements)];
    }
}

function* getHtml1EmbeddedCodes(
    snapshot: ts.IScriptSnapshot,
    statements: Statement[]
): Generator<VirtualCode> {
    let mappings: CodeMapping[] = [];
    let code = "";

    let defineSlotStatementsLeft = statements.filter(
        (statement) => statement.name === StatementName.DefineSlotStatement
    ).length;

    if (defineSlotStatementsLeft === 0) {
        code +=
            "declare const $slots: Partial<{\n\tmain: () => Promise<string>\n}>\n";
    }

    for (const [i, statement] of statements.entries()) {
        const asTsCode = statement.toTsCode();
        if (!asTsCode) continue;

        const [maps, tsCodeAsString] = asTsCode.toMappedString();

        mappings = mappings.concat(
            maps.map((map) => ({
                sourceOffsets: [map.sourceOffset],
                generatedOffsets: [map.generatedOffset + code.length],
                lengths: [map.length],
                data: {
                    completion: true,
                    format: true,
                    navigation: true,
                    semantic: true,
                    structure: true,
                    verification: true,
                },
            }))
        );

        code += tsCodeAsString + "\n";

        if (statement.name === StatementName.DefineSlotStatement) {
            defineSlotStatementsLeft--;

            if (defineSlotStatementsLeft !== 0) continue;

            code += "interface $Slots {\n\tmain: {}\n}\n\n";
            code +=
                "declare const $slots: Partial<{ [K in keyof $Slots]: {} extends $Slots[K] ? () => Promise<string> : (props: $Slots[K]) => Promise<string> }>\n";
        }
    }

    code += `export {}`;

    yield {
        id: "ts",
        languageId: "typescript",
        snapshot: {
            getText: (start, end) => code.slice(start, end),
            getLength: () => code.length,
            getChangeRange: () => undefined,
        },
        mappings: mappings,
    };
}

