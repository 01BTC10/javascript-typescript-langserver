/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>

var net = require('net');
var fs = require('fs');
var path = require('path');
var os = require('os');

var program = require('commander');

import * as ts from 'typescript';
import * as util from './util';

import {
    InitializeParams, InitializeResult,
    TextDocuments,
    TextDocumentPositionParams, Definition, ReferenceParams, Location, Hover, MarkedString, WorkspaceSymbolParams,
    SymbolInformation, SymbolKind, Range, RequestType
} from 'vscode-languageserver';

import TypeScriptService from './typescript-service';
import Connection from './connection';

import {serve} from './processor';

namespace GlobalRefsRequest {
    export const type: RequestType<WorkspaceSymbolParams, SymbolInformation[], any> = { get method() { return 'textDocument/global-refs'; } };
}

namespace InitializeRequest {
    export const type: RequestType<InitializeParams, InitializeResult, any> = { get method() { return 'initialize'; } };
}

namespace ShutdownRequest {
    export const type: RequestType<any, any, any> = { get method() { return 'shutdown'; } };
}

namespace ExitRequest {
    export const type = { get method() { return 'exit'; } };
}

var server = net.createServer(function (socket) {
    let connection: Connection = new Connection(socket);
    let documents: TextDocuments = new TextDocuments();

    let workspaceRoot : string

    // connection.connection.onInitialize((params: InitializeParams): InitializeResult => {
    //     console.log('initialize', params.rootPath);
    //     workspaceRoot = util.uri2path(params.rootPath);
    //     connection.service = new TypeScriptService(workspaceRoot);
    //     return {
    //         capabilities: {
    //             // Tell the client that the server works in FULL text document sync mode
    //             textDocumentSync: documents.syncKind,
    //             hoverProvider: true,
    //             definitionProvider: true,
    //             referencesProvider: true
    //         }
    //     }
    // });

    connection.connection.onRequest(InitializeRequest.type, (params: InitializeParams): InitializeResult => {
        console.log('initialize', params.rootPath);
        workspaceRoot = util.uri2path(params.rootPath);
        connection.service = new TypeScriptService(workspaceRoot);
        return {
            capabilities: {
                // Tell the client that the server works in FULL text document sync mode
                textDocumentSync: documents.syncKind,
                hoverProvider: true,
                definitionProvider: true,
                referencesProvider: true
            }
        }
    });

    connection.connection.onRequest(ShutdownRequest.type, () => {
        console.log('shutdown new ');
    });

     connection.connection.onRequest(ExitRequest.type, () => {
        console.log('exit new ');
    });

    connection.connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
        try {
            console.log('workspace symbols', params.query);
            if (params.query == "exported") {
                const exported = connection.service.getExportedEnts();
                if (exported) {
                    let res = exported.map(ent => {
                        return SymbolInformation.create(ent.name, ent.kind, ent.location.range,
                            'file:///' + ent.location.file, util.formExternalUri(ent));
                    });
                    console.error("Res = ", res);
                    return res;
                }
            } else if (params.query == "externals") {
                const externals = connection.service.getExternalRefs();
                if (externals) {
                    let res = externals.map(external => {
                        return SymbolInformation.create(external.name, util.formEmptyKind(), util.formEmptyRange(), util.formExternalUri(external));
                    });
                    console.error("externals Res = ", res);
                    return res;
                }
            } else if (params.query == '') {
                const topDecls = connection.service.getTopLevelDeclarations();
                if (topDecls) {
                    let res = topDecls.map(decl => {
                        return SymbolInformation.create(decl.name, decl.kind, decl.location.range,
                            'file:///' + decl.location.file, util.formExternalUri(decl));
                    });
                    console.error("top declarations = ", res);
                    console.error("Res length = ", res.length);
                    return res;
                }
            }
            return [];
        } catch (e) {
            console.error(params, e);
            return [];
        }
    });

    connection.connection.onDefinition((params: TextDocumentPositionParams): Definition => {
        try {
            console.log('definition', params.textDocument.uri, params.position.line, params.position.character)
            let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
            const defs: ts.DefinitionInfo[] = connection.service.getDefinition(reluri, params.position.line + 1, params.position.character + 1);
            let result: Location[] = [];
            if (defs) {
                for (let def of defs) {
                    if (def['url']) {
                        //TODO process external doc ref here
                        //result.push(Location.create(def['url'], util.formEmptyRange()));
                    } else {
                        let start = connection.service.position(def.fileName, def.textSpan.start);
                        start.line--;
                        start.character--;
                        let end = connection.service.position(def.fileName, def.textSpan.start + def.textSpan.length);
                        end.line--;
                        end.character--;
                        result.push(Location.create(util.path2uri(workspaceRoot, def.fileName), {
                            start: start,
                            end: end
                        }));
                    }
                }
            } else {
                //check whether definition is external, if uri string returned, add this location
                // TODO
                /*
                let externalDef = connection.service.getExternalDefinition(params.textDocument.uri, params.position.line, params.position.character);
                if (externalDef) {
                    let fileName = externalDef.file;
                    let res = Location.create(util.formExternalUri(externalDef), util.formEmptyRange());
                    result.push(res);
                }
                */
            }
            result.forEach(function(r) {
                console.log(r, r.range);
            });
            return result;
        } catch (e) {
            console.error(params, e);
            return [];
        }
    });

    connection.connection.onHover((params: TextDocumentPositionParams): Hover => {
        try {
            console.log('hover', params.textDocument.uri, params.position.line, params.position.character);
            let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
            const quickInfo: ts.QuickInfo = connection.service.getHover(reluri, params.position.line + 1, params.position.character + 1);
            let contents = [];
            if (quickInfo) {
                contents.push({language: 'javascript', value: ts.displayPartsToString(quickInfo.displayParts)});
                let documentation = ts.displayPartsToString(quickInfo.documentation);
                if (documentation) {
                    contents.push({language: 'text/html', value: documentation});
                }
            }
            let result: Hover = { contents: contents };
            return result;
        } catch (e) {
            console.error(params, e);
            return { contents: [] };
        }
    });

    connection.connection.onReferences((params: ReferenceParams): Location[] => {
        try {
            // const refs: ts.ReferenceEntry[] = service.getReferences('file:///' + req.body.File, req.body.Line + 1, req.body.Character + 1);
            let reluri = util.uri2reluri(params.textDocument.uri, workspaceRoot);
            const refEntries: ts.ReferenceEntry[] = connection.service.getReferences(reluri, params.position.line + 1, params.position.character + 1);
            const result: Location[] = [];
            if (refEntries) {
                for (let ref of refEntries) {
                    let start = connection.service.position(ref.fileName, ref.textSpan.start);
                    start.line--;
                    start.character--;
                    let end = connection.service.position(ref.fileName, ref.textSpan.start + ref.textSpan.length);
                    end.line--;
                    end.character--;
                    result.push(Location.create(util.path2uri(workspaceRoot, ref.fileName), {
                        start: start,
                        end: end
                    }));

                }
            }
            return result;
        } catch (e) {
            console.error(params, e);
            return [];
        }
    });

    connection.connection.onRequest(GlobalRefsRequest.type, (params: WorkspaceSymbolParams): SymbolInformation[] => {
        try {
            console.log('global-refs', params.query);
            const externals = connection.service.getExternalRefs();
            if (externals) {
                let res = externals.map(external => {
                    return SymbolInformation.create(external.name, util.formEmptyKind(), util.formEmptyRange(), util.formExternalUri(external));
                });
                console.error("global refs res = ", res);
                return res;
            }
            return [];
        } catch (e) {
            console.error(params, e);
            return [];
        }
    });

    // connection.connection.onShutdown(() => {
    //     console.log('shutdown');
    //     console.trace('inside shutdown');
    //     connection.service = null;
    // });

    connection.connection.listen();
});

process.on('uncaughtException', (err) => {
    console.error(err);
});

const defaultLspPort = 2088;
const defaultLpPort = 4145;

program
    .version('0.0.1')
    .option('-l, --lsp [port]', 'LSP port (' + defaultLspPort + ')', parseInt)
    .option('-p, --lp [port]', 'LP port (' + defaultLpPort + ')', parseInt)
    .option('-w, --workspace [directory]', 'Workspace directory')
    .parse(process.argv);

const lspPort = program.lsp || defaultLspPort;
const lpPort = program.lp || defaultLpPort;
const workspace = program.workspace ||
    path.join(process.env.SGPATH || path.join(os.homedir(), '.sourcegraph'),
        'workspace',
        'js');

console.log('Using workspace', workspace);
console.log('Listening for incoming LSP connections on', lspPort, 'and incoming LP connections on', lpPort);

server.listen(lspPort);
serve(lpPort, workspace);
