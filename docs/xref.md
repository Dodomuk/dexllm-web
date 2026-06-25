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

## Gap analysis vs JEB and jadx

What the current xref subsystem covers well, and what it's missing relative
to the two production references. Treat this as the requirements list for the
rewrite — every gap is a feature the rewrite should land or consciously
decline.

### Parity / better-than

| Feature | dexllm-web | JEB | jadx |
|---|---|---|---|
| Method callers | ✓ — synthetic accessor expansion + multi-invocation rows with bytecode offset | ✓ | ✓ |
| Field read/write split | ✓ — separate READ BY / WRITTEN BY sections | ✓ | ✗ (combined Find Usage) |
| Multi-invocation disambiguation | ✓ — `× N of M @ 0xNN` per row | partial | ✗ |
| Smali-faithful callee resolution | ✓ — invoke-* descriptor verbatim | ✓ | ✓ |
| Browser back/forward | ✓ | ✓ (internal) | ✓ |

### Missing — ranked by impact

#### Phase 1 — large coverage gaps

1. **Class/type xref.** `new X()` is forward-only. There's no "where is X
   referenced?" — field types, parameter/return types, `instanceof`, casts,
   annotation arguments, generic parameters. Both JEB and jadx treat this as
   table stakes. Largest single gap. dexkit's `findUsingType` family covers it.
2. **Override / implementor navigation.** Interface method → implementing
   methods, abstract method → overrides, class → subclasses. dexkit exposes
   `findMethodsImplementing` and `findClassesByExtends` but no UI consumer.
3. **Class hierarchy navigation.** Click a class → super/implements/subclasses
   panel (JEB's "Type Hierarchy", jadx's inheritance tree).
4. **String xref from a code-site click.** The IoC panel maps strings →
   classes, but clicking a string literal inside the decompiled body to see
   "every other place this is referenced" isn't wired. `xrefStringsToClasses`
   is already exposed.

#### Phase 2 — UX

5. **Result panel instead of popup.** A 480px-tall popup doesn't scale — a
   method with 100+ callers becomes unusable. JEB has a dockable References
   pane with group/filter/search; jadx opens results in a tab. Promote the
   xref result UI from popup-only to a dockable side panel.
6. **Human-readable descriptors.** Rows currently show
   `La2dp/Vol/AppChooser$AppInfoCache;->getAppName()Ljava/lang/String;` —
   JEB / jadx render `AppInfoCache.getAppName(): String`. Add a descriptor
   → human-form formatter and use it everywhere xref output is shown.
7. **Filtering.** App-only vs framework, package, kind (ctor / static /
   instance). `dangerous_permission_api_callers` already has `app_only` —
   the caller popup doesn't. Reuse the same filter.
8. **Global symbol search.** Class list filtering exists, but there's no
   "by name → method/field/class search → click to jump." JEB Ctrl+G, jadx
   Ctrl+Shift+F.
9. **Sort options.** Current sort is descriptor-alpha. Add frequency / package
   proximity / distance-from-current sorts.

#### Phase 3 — depth

10. **Local variable highlighting.** Clicking `v0_3` should highlight every
    occurrence inside the current method. Current handler bails on `^[vp]\d`.
    jadx default behavior, JEB color-coded.
11. **Smali ↔ Java view sync.** `renderMethodSmali` exists; not exposed as a
    toggle with synchronized cursor. JEB synchronizes both views.
12. **Reference-count badges.** JEB pre-renders `(↑12 ↓3)` next to method
    names in the sidebar — incoming/outgoing call counts without a click.
13. **Lambda / synthetic factory unwinding.** `access$NNN` is expanded but
    `-$$Lambda$Cls$ABC.run()` and similar lambda factory hops aren't traced
    back to their capture site. JEB does this end-to-end.
14. **Override indicators in the gutter.** Tiny icons on the line gutter for
    "overrides X" / "overridden by N".
15. **Framework method markers.** SDK API callees marked + optionally linked
    to docs (jadx does the marking).
16. **Call graph visualization.** JEB has a graphical incoming/outgoing tree;
    we have a flat list only. Lower priority but cited often.

### Suggested rewrite phasing

- **Phase 1** lands class/type xref + override/implementor + string
  click-xref. After this, "find references" is symmetric across method /
  field / class / string — the core JEB/jadx promise.
- **Phase 2** replaces the popup with a dockable panel, switches all xref
  output to human-readable descriptors, and adds the filter / global-search
  / sort surface. The result panel becomes the entry point everything else
  feeds into.
- **Phase 3** adds local-var highlighting, smali sync, count badges,
  lambda unwinding, gutter icons, framework markers, and (optionally) the
  call-graph view. These are the "feels professional" details.

Out of scope for this codebase (no plans): rename propagation, persistent
project state / bookmarks. dexllm-web is a read-only triage view.

### Feasibility with dexkit

For each gap, which dexkit primitive backs it — and which need work outside
dexkit's surface. (Bindings to add to `wasm_module.cpp` are listed inline.)

#### A. Fully implementable with EXISTING dexkit APIs

Just need a new embind binding + JS wiring. dexkit already does the heavy
analysis.

| Gap | dexkit primitive | Notes |
|---|---|---|
| Class/type xref (#1) | `FindMethodsByMatcher` with `MethodMatcher::usingTypes` (schema); also `FieldMatcher::type` for field-of-type-X queries | A type appears in 5 positions: field type, method return, method param, `instanceof`/`check-cast`, annotation argument. The first three are covered by matchers; the cast/instanceof ones can be picked up via smali parse if needed. |
| Override / implementor (#2) | `FindClassesBySuperclass` + `FindClassesImplementing` (already in `DexKitExt`, just not bound) | Direct one-liner each. |
| Class hierarchy (#3) | slicer `ClassDef::superclass_idx` + `interfaces_off` for ↑; `FindClassesBySuperclass`/`Implementing` for ↓ | Hierarchy walks the slicer reader directly — same pattern as `BuildFieldDescriptor`. |
| String click-xref (#4) | `xrefStringsToClasses` already exposed; `BatchFindMethodsUsingStrings` in `DexKitExt` not yet exposed | Wire a binding for the method-level variant so the click can target the precise method, not just the class. |
| Global symbol search (#8) | `listClasses` + `listClassMethods` + `listClassFieldDescriptors` already exposed | Pure JS index on top. |
| Lambda factory unwinding (#13) | Same `findCallSitesWithOffset` + name pattern (`-$$Lambda$Cls$ABC`, `$$ExternalSyntheticLambda*`) | Extends the existing `access$NNN` BFS to a wider name pattern. |
| Framework method markers (#15) | `listExternalMethodRefs` already exposed | Tag callees whose target class is in the external-ref set. |
| Call graph view (#16) | Recursive `findCallSitesToApi` / smali-invokes | Implementable; UI cost is a graph-layout dep (dagre/d3), not a dexkit cost. |

#### B. Pure UI / JS — no dexkit work needed

| Gap | What it needs |
|---|---|
| Local variable highlighting (#10) | DOM scan inside the current method block. Identifier-occurrence highlighting only — no semantic analysis required. |
| Result panel (#5) | DOM refactor: hoist the popup body into a dockable side-panel container. |
| Human-readable descriptors (#6) | One formatter function: `Lpkg/sub/Outer$Inner;->meth(IJ)Ljava/lang/String;` → `Outer$Inner.meth(int, long): String`. |
| Filtering (#7) | Predicate composition over the existing result list. |
| Sort options (#9) | Comparator selector. |

#### C. Implementable but EXPENSIVE — needs precompute

| Gap | Why expensive | Mitigation |
|---|---|---|
| Reference-count badges (#12) | Requires `findCallSitesToApi` on every method in the visible class (or every class for sidebar badges). dexkit has no batched count API. | Compute lazily on class open + cache; throttle / Web Worker so the UI doesn't block. |

#### D. NOT cleanly implementable without modifying the decompiler

| Gap | What's missing | Workaround |
|---|---|---|
| Smali ↔ Java view sync (#11) | ~~DAD emits Java text via `Writer::WriteMethod`; baksmali emits smali. No PC-to-source-line map is exposed across the boundary.~~ | **LANDED** (D-3, dexllm#1 / PR#2 commit 565a716, dexllm-web commit 96d2450). dexllm now exposes `DecompileMethodWithPcMap(desc) → {source, pc_map}` with conditional/loop/switch header hooks per Finding A. dexllm-web's "↔ smali" toggle opens a right-docked smali pane with bidirectional click-to-sync. Verified: `doListFilter()` 13 pc_map entries, 4 hitting `if`/`while` headers (offsets 0x3a, 0x82, 0xae, 0x52). Original spec preserved in [`d3-pc-line-map.md`](d3-pc-line-map.md) for v1→v2→v3 revision history. |

#### E. Explicitly out of scope (not a dexkit question)

| Item | Reason |
|---|---|
| Rename propagation | Read-only triage view — no persistent symbol store. |
| Bookmarks / project state | Same. Browser history is the only persistence layer. |

### Summary

- **8 of 16 gaps** (A) — drop-in with new bindings + JS. No upstream changes.
- **5 of 16 gaps** (B) — UI work only. dexkit already has what's needed via existing exposed methods.
- **1 of 16 gaps** (C) — implementable but needs precompute strategy.
- **1 of 16 gaps** (D) — limited by DAD's lack of source-line ↔ bytecode-offset map; heuristic only without upstream changes.
- **2 items** (E) — out of scope by design.

The high-impact Phase 1 gaps (class/type xref, override/implementor, string
click-xref) are all in bucket A — dexkit has every primitive required. The
rewrite's friction is JS architecture, not dexkit capability.
