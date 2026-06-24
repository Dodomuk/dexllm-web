# dexllm-web xref subsystem

Catalog of every click-to-navigate / cross-reference feature in this repo, so
the whole subsystem can be rewritten as one coherent module later.

The current implementation grew incrementally — caller popup first, then callee
navigation via smali, then `<init>` flow, then occurrence-disambiguated rows,
then field get/set, then browser back/forward — so the code is functional but
spread across `index.html`. This doc is the reference for ripping it out and
replacing it with a single well-factored module.

**Rule for new contributions:** keep additions adjacent to the existing xref
code blocks (don't sprinkle xref logic through unrelated areas). When in doubt,
add a new `// ── <feature> ──` banner next to the others.

## Features (user-facing)

| Click target | Behavior |
|---|---|
| Method declaration `public T foo(...)` | Popup listing **all callers** of `foo` (every overload, every dex). Each row shows the caller method descriptor + an accessor chain note when reached via `access$NNN`. Multi-invocation callers split into separate rows labeled `× N of M @ 0xNN`. |
| Method call site `obj.foo(...)` / `Cls.foo(...)` | Jump to `foo`'s declaration. SMALI-based resolution: enclosing method's `invoke-*` lines carry the exact `Lcls;->name(proto)Ret`. Multiple invokes named `foo` from the caller → picker. |
| Constructor reference `new Cls(...)` (type token) | Jump to `Cls`'s constructor. Inner-class `$`-suffix aware. |
| Constructor declaration `public Cls(...)` (type token on header) | Same callers popup, special-cased to `<init>` — glow lands on the `new Cls(` site in each caller, not on `<init>(`. |
| Field declaration `private T foo;` (identifier token at class scope) | Popup with **READ BY** and **WRITTEN BY** sections (iget*/sget* vs iput*/sput* faithful). Field type shown as suffix. |
| Field usage `this.foo` / `obj.foo` (identifier token in method body) | Jump to the field's declaration. SMALI-based resolution: enclosing method's `iget*/iput*/sget*/sput*` lines carry the exact `Lcls;->name:Type`. |
| Browser back / forward | Restores prior class + glow position via History API (`pushState` + `popstate`). |
| Popup item click | Closes the popup, navigates to the chosen target with a `hint` that drives `locateAndGlow`. |

## Code map

All locations are in [`index.html`](../index.html) unless noted. Line numbers
drift; banners are stable.

### Click delegation

| Banner / function | Role |
|---|---|
| `$("#code").addEventListener("click", …)` | Single delegated click handler on the code viewer. Routes by closest `.tk-*` token class: field path (`.tk-var`/`.tk-con`/`.tk-ide`) → method path (`.tk-fun`) → constructor path (`.tk-typ`). |
| `document.addEventListener("click", …)` outside-click dismiss | Closes the popup when clicking outside it (re-clicks on identifier tokens rebuild). |
| `document.addEventListener("keydown", "Escape")` | Closes the popup. |

### Token classification

| Function | Role |
|---|---|
| `highlight(code)` | Java syntax tokenizer. Emits `.tk-com / .tk-str / .tk-ann / .tk-num / .tk-typ / .tk-key / .tk-lit / .tk-con / .tk-var / .tk-fun / .tk-ide`. The xref system depends on this — every clickable feature lives on one of those classes. |

### Line / context resolution

| Function | Role |
|---|---|
| `getLineForElement(el)` | Inverse of the render: which `codeLineCache` index a clicked DOM element corresponds to (uses bounding rect + measured line-height). |
| `findEnclosingMethodName(lineIdx)` | Walks backward looking for a method-header line (`(public\|private\|…)\b` and contains `(`). Returns the simple method name or null. Null result = class-scope context (field decl, etc.). |
| `findEnclosingMethodDescriptor(cls, lineIdx, useDk)` | Resolves the full Dalvik descriptor for the enclosing method, including the constructor (`<init>`) / static-init (`<clinit>`) name remapping (DAD emits constructors as the class simple name). |
| `receiverClassOf(line, name, lineIdx)` | Class qualifier for `Cls.method(` / `var.method(`. Last-resort text inference when smali resolution is empty. |
| `inferVariableType(name, lineIdx)` | Reverse-scans text to type a `vN_M` local or `pN` param. Powers the variable-receiver case in `receiverClassOf`. |

### SMALI-based resolution

| Function | Role |
|---|---|
| `smaliInvokesFrom(useDk, methodDesc)` | Parses `invoke-*` lines of a method's smali. Returns `[{kind, descriptor}]`. Cached. Drives method callee navigation. |
| `smaliFieldsFrom(useDk, methodDesc)` | Parses `iget*/iput*/sget*/sput*` lines. Returns `[{op, descriptor}]`. Cached. Drives field declaration navigation. |
| `_smaliInvokesCache` / `_smaliFieldsCache` | Per-method caches. Cleared on class switch via `clearSmaliCacheForClass`. |

### Caller resolution

| Function | Role |
|---|---|
| `isSyntheticAccessor(desc)` | Detects `access$NNN` accessor methods. |
| `resolveTransitiveCallers(useDk, descriptors, opts)` | BFS through synthetic-accessor chains. Yields one record per `(caller, offset)` pair — multi-invocation callers stay as distinct records, not deduped. `chain` field records the accessor hops. |

### Popups

| Function | Role |
|---|---|
| `showCallersFor(cls, name, anchor)` | The method-callers popup. Handles the `<init>` special case (anchor wording + needle remapping to the class simple name). Per-descriptor occurrence indexing builds the `× N of M @ 0xNN` labels. |
| `showCalleePicker(descriptors, name)` | Reusable picker — same chrome as the callers popup. Used when multiple callees / fields match. |
| `showFieldXrefFor(cls, fieldName, anchor)` | The field READ BY / WRITTEN BY popup. Iterates field overloads (same name, different types) and renders one block per overload. |

### Navigation primitives

| Function | Role |
|---|---|
| `navigateToClass(desc, hint)` | The single entry point for "go to this class". Handles per-dex view switching, runtime vs isolated mode routing, same-class re-glow (no re-decompile), and `pushState`. |
| `_navigateAfterClassCheck(targetCls, name)` | Pre-flight that confirms the target class is loaded in the active mode/dex, then delegates to `navigateToClass`. |
| `navigateToCalleeMethod(currentCls, name, line, lineIdx)` | The method-call-site path: smali first, receiver-text fallback, last-resort same-class search. |
| `navigateToConstructor(name, lineIdx, anchor)` | The `new X(` path: matches inner-class `$`-suffix, falls back to `findClassesByName` ends-with. |
| `navigateToFieldDeclFromUsage(currentCls, lineIdx, fieldName)` | The field-usage path: smali first, same-class field-by-name fallback. |
| `locateAndGlow(hint)` | Final step of every navigation. `hint = { needle, scope, occurrence }`. Scope-relative search first (find `scope(`, then look forward for `needle`), full-file fallback, then `#glowline` overlay positioning + scroll-to-center. The `occurrence` field skips the first N-1 matches for multi-invocation rows. |

### Browser history

| Function | Role |
|---|---|
| `pushState`/`popstate` block (`// ── Browser back/forward navigation ──` banner) | Wires class navigation into the History API. `suppressPush` flag prevents `popstate` from re-pushing the popped state. State payload: `{cls, hint}`. |

### Mode awareness

| Function | Role |
|---|---|
| `activeQueryDk()` | Returns the dk to use for xref queries — isolated mode's per-dex iso dk vs runtime mode's aggregated dk. **Every xref query path must go through this**, otherwise an isolated tab's queries leak into the runtime aggregate. |

## C++/WASM API surface

Defined in [`wasm_module.cpp`](../../dexllm-wasm-build/wasm_module.cpp) (the
build tooling is out-of-repo). Listed in dependency order — top entries serve
the lower-level features below them.

| Embind method | Backed by | Used for |
|---|---|---|
| `findCallSitesToApi(api_descriptor) → VectorString` | `DexKitExt::FindCallSitesToApi` | Legacy descriptor-only caller list. Still used by IoC lazy-xref and the permission caller pipeline (which don't care about offsets). |
| `findCallSitesWithOffset(api_descriptor) → [{caller, offset}]` | Same `FindCallSitesToApi` but exposes `CallSite.bytecode_offset` | Method-callers popup multi-occurrence rows (`× N of M @ 0xNN`). |
| `renderMethodSmali(descriptor) → string` | `DexKitExt::RenderMethodSmali` | Smali parsing for both callee and field-usage navigation. |
| `listClassFieldDescriptors(cls) → VectorString` | Walks `DexItem::GetClassFieldIds(type_idx)` + locally rebuilds the descriptor from `FieldIds + TypeIds + Strings` (GetFieldDescriptor is private) | Mapping clicked field NAME → full `Lcls;->name:Type` descriptor. |
| `findFieldGetMethods(field_descriptor) → VectorString` | `DexItem::FieldGetMethods(field_idx)` after `WarmAnalysisCaches()` | Field xref popup READ BY section. |
| `findFieldPutMethods(field_descriptor) → VectorString` | `DexItem::FieldPutMethods(field_idx)` after `WarmAnalysisCaches()` | Field xref popup WRITTEN BY section. |
| `listClassMethods(cls) → VectorString` | `DexKitExt::ListClassMethods` | Resolving the visible method name → full method descriptor (including all overloads). |
| `findMethodsByName / findClassesByName` | dexkit L4 search | Last-resort callee / constructor resolution. |

`WasmDexKit::LocateField(field_descriptor)` is a private helper that parses the
class part, locates the declaring dex via `DexKitExt::LocateClassDex`, walks
that dex's `TypeNames` to `type_idx`, and matches `BuildFieldDescriptor(item,
fid)` against the input.

## Design invariants

These are properties the current code holds; the rewrite should preserve them
(or document why it doesn't).

1. **dex-bytecode faithful.** Every navigation that COULD use smali DOES use
   smali. Text inference is a fallback, never the primary path. The user
   shouldn't see "I guessed your callee from `var.method()` syntax" when the
   `invoke-virtual` instruction names the exact target.
2. **Per-dex isolation respected.** In isolated mode, every query goes through
   `activeQueryDk()`. Cross-dex navigation is blocked with a toast.
3. **No silent dedup.** Multi-invocation callers each get their own row (with
   bytecode offset for disambiguation). Same principle for field accesses (one
   row per overload of `(name, type)`).
4. **Synthetic accessors are transparent.** When `M` is only reachable through
   `access$NNN`, the popup shows the REAL caller, not the accessor.
5. **History-aware.** Every navigation writes a history entry; back/forward
   restores both the class and the glow position.
6. **Cache-aware.** Smali parses are cached per method (cleared on class
   switch). dexkit L2.5 cross-ref builds are amortized via `WarmAnalysisCaches`.

## Rewrite checklist

When the rewrite happens, the following should land as one coherent module
(suggested file: `src/xref.js`):

- [ ] Single dispatch entry point — one delegated click handler that classifies
      the click context once and dispatches to the right resolver.
- [ ] Shared "where am I?" primitive — replaces the ad-hoc combo of
      `getLineForElement` + `findEnclosingMethodName` + line-shape regexes
      scattered through `isMethodDeclaration` / `isCtorDeclaration` /
      `isFieldDeclLine`.
- [ ] Shared smali query — `parseSmali(methodDesc) → { invokes, fieldAccesses }`
      replaces the two parallel cached parsers.
- [ ] Shared popup component — one renderer, configured by a section list;
      replaces `showCallersFor` / `showCalleePicker` / `showFieldXrefFor`.
- [ ] Single `navigate(targetCls, hint)` — the only function that touches
      class switching, dex tabs, history, and glow.
- [ ] Tests — the existing one-off `*.js` probe scripts in `dexllm-wasm-build/`
      should be folded into a small integration suite that exercises each
      click → popup → row click → glow cycle.

Until the rewrite, **keep new xref features adjacent to the existing ones**
(don't sprinkle).
