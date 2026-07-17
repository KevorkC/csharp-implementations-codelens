import * as vscode from 'vscode';

const CONFIG_SECTION = 'csharpImplementationsCodeLens';
const SHOW_IMPLEMENTATIONS_COMMAND = 'csharpImplementationsCodeLens.showImplementations';
const DEBOUNCE_MS = 500;
const MAX_SYMBOL_RETRIES = 5;
const SYMBOL_RETRY_DELAY_MS = 2000;

/** Member kinds that can be implemented/overridden. Indexers surface as Property. */
const MEMBER_KINDS = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Property,
  vscode.SymbolKind.Event,
]);

class ImplementationCodeLens extends vscode.CodeLens {
  constructor(range: vscode.Range, readonly uri: vscode.Uri) {
    super(range);
  }
}

const ABSTRACT_RE = /\babstract\b/;
const VIRTUAL_RE = /\bvirtual\b/;
const OVERRIDE_RE = /\boverride\b/;

/**
 * DocumentSymbol carries no modifiers, so read the declaration source from the
 * start of the line containing the symbol name up to the name itself and check
 * for keywords there.
 */
function declarationText(document: vscode.TextDocument, symbol: vscode.DocumentSymbol): string {
  const lineStart = new vscode.Position(symbol.selectionRange.start.line, 0);
  return document.getText(new vscode.Range(lineStart, symbol.selectionRange.end));
}

function toLocation(item: vscode.Location | vscode.LocationLink): vscode.Location {
  if ('targetUri' in item) {
    return new vscode.Location(item.targetUri, item.targetSelectionRange ?? item.targetRange);
  }
  return item;
}

class CSharpImplementationsCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  /** Retries per document while the C# language server is still warming up. */
  private readonly symbolRetries = new Map<string, number>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  refresh(): void {
    if (this.disposed) {
      return;
    }
    this.changeEmitter.fire();
  }

  clearRetries(uri: vscode.Uri): void {
    this.symbolRetries.delete(uri.toString());
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.changeEmitter.dispose();
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document);
    if (!config.get<boolean>('enabled', true)) {
      return [];
    }

    let symbols: (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined;
    try {
      symbols = await vscode.commands.executeCommand<
        (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined
      >('vscode.executeDocumentSymbolProvider', document.uri);
    } catch {
      // Provider can reject while the language server is restarting; fall
      // through to the retry path below.
      symbols = undefined;
    }

    if (token.isCancellationRequested) {
      return [];
    }

    if (!symbols || symbols.length === 0) {
      // The C# extension may not have produced symbols yet (server still
      // loading). Retry a few times so lenses appear once it is ready.
      this.scheduleSymbolRetry(document);
      return [];
    }
    this.symbolRetries.delete(document.uri.toString());

    const showOnInterfaceMembers = config.get<boolean>('showOnInterfaceMembers', true);
    const showOnAbstractVirtualMembers = config.get<boolean>('showOnAbstractVirtualMembers', true);
    const lenses: vscode.CodeLens[] = [];

    const visit = (symbol: vscode.DocumentSymbol, parent: vscode.DocumentSymbol | undefined): void => {
      if (token.isCancellationRequested) {
        return;
      }

      if (symbol.kind === vscode.SymbolKind.Interface) {
        lenses.push(new ImplementationCodeLens(symbol.selectionRange, document.uri));
      } else if (symbol.kind === vscode.SymbolKind.Class) {
        if (ABSTRACT_RE.test(declarationText(document, symbol))) {
          lenses.push(new ImplementationCodeLens(symbol.selectionRange, document.uri));
        }
      } else if (MEMBER_KINDS.has(symbol.kind) && parent) {
        if (parent.kind === vscode.SymbolKind.Interface) {
          if (showOnInterfaceMembers) {
            lenses.push(new ImplementationCodeLens(symbol.selectionRange, document.uri));
          }
        } else if (parent.kind === vscode.SymbolKind.Class && showOnAbstractVirtualMembers) {
          const text = declarationText(document, symbol);
          if (!OVERRIDE_RE.test(text) && (ABSTRACT_RE.test(text) || VIRTUAL_RE.test(text))) {
            lenses.push(new ImplementationCodeLens(symbol.selectionRange, document.uri));
          }
        }
      }

      for (const child of symbol.children) {
        visit(child, symbol);
      }
    };

    for (const symbol of symbols) {
      // Older providers may return flat SymbolInformation; only hierarchical
      // DocumentSymbol carries the selectionRange and modifiers context we need.
      if ('selectionRange' in symbol) {
        visit(symbol, undefined);
      }
    }

    return lenses;
  }

  async resolveCodeLens(
    codeLens: vscode.CodeLens,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens> {
    if (!(codeLens instanceof ImplementationCodeLens)) {
      return codeLens;
    }

    let results: (vscode.Location | vscode.LocationLink)[] | undefined;
    try {
      results = await vscode.commands.executeCommand<
        (vscode.Location | vscode.LocationLink)[] | undefined
      >('vscode.executeImplementationProvider', codeLens.uri, codeLens.range.start);
    } catch {
      // Render nothing rather than returning a command-less resolved lens,
      // which VS Code displays as "!!MISSING: command!!".
      codeLens.command = { title: '', command: '' };
      return codeLens;
    }

    if (token.isCancellationRequested) {
      return codeLens;
    }

    // Some providers include the declaration itself; filter it out.
    const implementations = (results ?? [])
      .map(toLocation)
      .filter(
        (location) =>
          !(
            location.uri.toString() === codeLens.uri.toString() &&
            location.range.intersection(codeLens.range) !== undefined
          )
      );

    const count = implementations.length;
    if (count === 0) {
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION, codeLens.uri);
      codeLens.command = config.get<boolean>('hideWhenZero', false)
        ? { title: '', command: '' }
        : { title: 'no implementations', command: '' };
      return codeLens;
    }

    codeLens.command = {
      title: count === 1 ? '1 implementation' : `${count} implementations`,
      tooltip: 'Go to implementations',
      command: SHOW_IMPLEMENTATIONS_COMMAND,
      arguments: [codeLens.uri, codeLens.range.start, implementations],
    };
    return codeLens;
  }

  private scheduleSymbolRetry(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const attempts = this.symbolRetries.get(key) ?? 0;
    if (attempts >= MAX_SYMBOL_RETRIES) {
      return;
    }
    this.symbolRetries.set(key, attempts + 1);
    // A single shared timer coalesces retries across visible editors.
    if (this.retryTimer !== undefined) {
      return;
    }
    // Exponential backoff: 2s, 4s, 8s, 16s, 32s (~1 min total) to cover slow
    // solution loads.
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.refresh();
    }, SYMBOL_RETRY_DELAY_MS * 2 ** attempts);
  }
}

async function showImplementations(
  uri: vscode.Uri,
  position: vscode.Position,
  locations: vscode.Location[]
): Promise<void> {
  if (locations.length === 1) {
    await vscode.window.showTextDocument(locations[0].uri, {
      selection: locations[0].range,
    });
    return;
  }
  await vscode.commands.executeCommand('editor.action.peekLocations', uri, position, locations, 'peek');
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CSharpImplementationsCodeLensProvider();
  let debounce: ReturnType<typeof setTimeout> | undefined;

  context.subscriptions.push(
    provider,
    vscode.languages.registerCodeLensProvider({ language: 'csharp', scheme: 'file' }, provider),
    vscode.commands.registerCommand(SHOW_IMPLEMENTATIONS_COMMAND, showImplementations),
    vscode.workspace.onDidCloseTextDocument((document) => {
      provider.clearRetries(document.uri);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId !== 'csharp' || event.contentChanges.length === 0) {
        return;
      }
      if (debounce !== undefined) {
        clearTimeout(debounce);
      }
      debounce = setTimeout(() => {
        debounce = undefined;
        provider.refresh();
      }, DEBOUNCE_MS);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        provider.refresh();
      }
    }),
    {
      dispose: () => {
        if (debounce !== undefined) {
          clearTimeout(debounce);
        }
      },
    }
  );
}

export function deactivate(): void {}
