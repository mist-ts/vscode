import {
    createConnection,
    createServer,
    createTypeScriptProject,
    Diagnostic,
    Hover,
    loadTsdkByPath,
    MarkupKind,
} from "@volar/language-server/node.js";
import { create as createEmmetService } from "volar-service-emmet";
import { create as createHtmlService } from "volar-service-html";
import { create as createTypeScriptServices } from "volar-service-typescript";
import { create as createPrettierService } from "volar-service-prettier";
import { URI } from "vscode-uri";
import { mistLanguagePlugin, Html1VirtualCode } from "./languagePlugin.js";
import { hoverInfo } from "./hoverInfo.js";
import * as prettier from "prettier";

const connection = createConnection();
const server = createServer(connection);

connection.listen();

connection.onInitialize((params) => {
    const tsdk = loadTsdkByPath(
        params.initializationOptions.typescript.tsdk,
        params.locale
    );
    return server.initialize(
        params,
        createTypeScriptProject(
            tsdk.typescript,
            tsdk.diagnosticMessages,
            () => [mistLanguagePlugin]
        ),
        [
            createHtmlService(),
            createEmmetService(),
            ...createTypeScriptServices(tsdk.typescript),
            {
                capabilities: {
                    diagnosticProvider: {
                        workspaceDiagnostics: true,
                    },
                    hoverProvider: true,
                },
                create(context) {
                    server.watchFiles(["**/*.{ts}"]);

                    return {
                        provideDiagnostics(document) {
                            const decoded = context.decodeEmbeddedDocumentUri(
                                URI.parse(document.uri)
                            );
                            if (!decoded) {
                                // Not a embedded document
                                return;
                            }
                            const virtualCode = context.language.scripts
                                .get(decoded[0])
                                ?.generated?.embeddedCodes.get(decoded[1]);
                            if (!(virtualCode instanceof Html1VirtualCode)) {
                                return;
                            }

                            if (virtualCode.errors.length === 0) return;

                            const errors: Diagnostic[] = [];
                            for (const err of virtualCode.errors) {
                                errors.push({
                                    severity: 1,
                                    message: err.message,
                                    range: {
                                        start: document.positionAt(err.start),
                                        end: document.positionAt(err.end),
                                    },
                                });
                            }

                            return errors;
                        },
                        provideHover(document, position, token) {
                            const code = document.getText();
                            const line = code.split("\n").at(position.line);
                            if (!line) return;

                            let inWord = "";
                            let i = 0;
                            for (const char of line) {
                                if (char.trim().length === 0) {
                                    if (i >= position.character) break;
                                    inWord = "";
                                } else {
                                    inWord += char;
                                }

                                i++;
                            }

                            if (!inWord.startsWith("@")) return;

                            let name = "";
                            for (const char of inWord.slice(1)) {
                                if (char.toUpperCase() === char.toLowerCase())
                                    break;
                                name += char;
                            }

                            const info = hoverInfo.get(name);
                            if (!info) return;

                            return {
                                contents: {
                                    kind: MarkupKind.Markdown,
                                    value: info,
                                },
                            } satisfies Hover;
                        },
                    };
                },
            },
            createPrettierService(prettier, {
                documentSelector: [
                    "html",
                    "css",
                    "scss",
                    "typescript",
                    "javascript",
                    "mist",
                ],
                html: {
                    breakContentsFromTags: true,
                },
            }),
        ]
    );
});

connection.onInitialized(server.initialized);

connection.onShutdown(server.shutdown);

