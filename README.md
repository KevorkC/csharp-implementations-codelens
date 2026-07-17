# C# Implementations CodeLens

**See how many classes implement your C# interfaces — and jump straight to them.**

This extension shows a Rider-style `N implementations` CodeLens above interfaces, interface members, and abstract/virtual members in C# files. It answers the everyday questions the built-in tooling makes you dig for: *Who implements this interface? Which classes override this virtual method? Is this abstract member implemented anywhere?*

It complements the `N references` CodeLens you already get from the official C# extension — references tell you who *calls* a symbol, this tells you who *implements* it. If you're coming to VS Code from JetBrains Rider or Visual Studio and miss the implementations counter, this brings it back.

## Features

- **Implementation counts as CodeLens** above:
  - `interface` declarations and every member inside them (methods, properties, events, indexers)
  - `abstract` and `virtual` members of classes
  - `abstract` class declarations
- **Click to navigate**: one implementation jumps directly to it; two or more open the peek view so you can browse all implementations inline
- **No noise**: `override` members and ordinary concrete members get no lens
- **Fast in large files**: counts are resolved lazily, only for the lenses scrolled into view
- **No reloads**: all settings apply immediately

## Requirements

- VS Code 1.101 or newer.
- The official [C# extension](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csharp) (or C# Dev Kit) must be installed and running — this extension does no C# parsing of its own; it queries the C# language server through VS Code's document-symbol and implementation providers.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `csharpImplementationsCodeLens.enabled` | `true` | Show the implementations CodeLens in C# files. |
| `csharpImplementationsCodeLens.showOnInterfaceMembers` | `true` | Show the lens on members declared inside interfaces. |
| `csharpImplementationsCodeLens.showOnAbstractVirtualMembers` | `true` | Show the lens on `abstract`/`virtual` class members. |
| `csharpImplementationsCodeLens.hideWhenZero` | `false` | Hide the lens entirely when there are no implementations, instead of showing "no implementations". |

## Development

```sh
npm install
npm run build     # type-check + bundle to dist/extension.js
npm run watch     # incremental rebuild (used by F5)
npm run package   # produce the .vsix
```

Press **F5** to launch an Extension Development Host with the watch build, then open `sample/Sample.cs` to see the lenses (give the C# language server a moment to load).

## How it works

Lenses are emitted unresolved from the document symbol tree and only resolved (one implementation lookup each) when they scroll into view, so large files stay fast. Implementation lookups are answered by the C# language server (Roslyn) via VS Code's `executeImplementationProvider` — the same engine behind **Go to Implementations** (`Ctrl+F12` / `⌘F12`).
