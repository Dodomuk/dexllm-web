// dexllm-web decompile worker.
//
// Keeps a parallel set of WasmDexKits (one per source) on a background thread
// so decompile calls (which are synchronous in wasm) don't freeze the UI when
// they take many seconds on a heavy class. Mirrors the main thread's load /
// dump / rebuild state — the main thread sends "load" / "addDump" / "reset"
// messages whenever its own state changes, and "decompile" for each click.
//
// Protocol (postMessage):
//   main → worker: { id, type: "load",     bytes: Uint8Array, label: string }
//                  { id, type: "addDump",  bytes: Uint8Array, label: string, vfs: string }
//                  { id, type: "decompile", cls: string, sourceIdx: number /*-1 = aggregated dk*/ }
//                  { id, type: "reset" }
//   worker → main: { id, ok: true,  result?: any }
//                  { id, ok: false, error: string }
//
// Each call carries an opaque `id`; the worker echoes it so the main thread
// can pair the response with its pending Promise.

// Cache-bust via the same `?v=SHA` query the main thread uses (the bootstrap
// posts a {type:"init", buildSha} message before the first call).
let BUILD_SHA = "";
let CREATE = null;
function bootstrapModule() {
  // importScripts has no native promise form, but we can call it lazily after
  // the first init message arrives so we know which cache-busted path to use.
  const qs = BUILD_SHA ? "?v=" + BUILD_SHA : "";
  importScripts("dexllm.js" + qs);
  // emscripten's MODULARIZE exports `createDexllm` on `self`.
  CREATE = self.createDexllm;
}

let Module = null;
let dk = null;                         // multi-source aggregated DexKit
let sources = [];                      // [{vfs, label, slotCount, dk, baseDexId, dump}]
let dumpedSources = [];                // alias of sources where .dump === true
let originalSource = null;             // alias of sources[i] where .dump === false
let initPromise = null;

function ensureInit() {
  if (Module) return Promise.resolve();
  if (initPromise) return initPromise;
  if (!CREATE) bootstrapModule();
  const qs = BUILD_SHA ? "?v=" + BUILD_SHA : "";
  initPromise = CREATE({ locateFile: f => f + qs }).then(m => { Module = m; });
  return initPromise;
}

function getExceptionMessage(err) {
  if (err && Module && Module.getExceptionMessage && err.excPtr != null) {
    try { return Module.getExceptionMessage(err.excPtr); } catch (_) {}
  }
  return err && err.message ? err.message : String(err);
}

function resetState() {
  for (const s of sources) { try { s.dk && s.dk.delete(); } catch (_) {} }
  if (dk && (!sources.length || dk !== sources.find(s => !s.dump)?.dk)) {
    try { dk.delete(); } catch (_) {}
  }
  sources = []; dumpedSources = []; originalSource = null; dk = null;
}

function rebuildDk() {
  // Drop the aggregated dk if it doesn't alias originalSource.dk (the single-
  // source case, where we just reuse the same instance).
  const aliasesOrig = dk === (originalSource && originalSource.dk);
  if (dk && !aliasesOrig) { try { dk.delete(); } catch (_) {} }
  dk = null;
  if (!dumpedSources.length) { dk = originalSource.dk; return; }
  const VS = new Module.VectorString();
  for (const d of dumpedSources) VS.push_back(d.vfs);
  VS.push_back(originalSource.vfs);
  try { dk = new Module.WasmDexKit(VS, true); }
  finally { VS.delete(); }

  // Recompute baseDexId per source for routing.
  let cursor = 0;
  for (const s of dumpedSources) { s.baseDexId = cursor; cursor += s.slotCount; }
  originalSource.baseDexId = cursor;
}

async function handleLoad({ bytes, label }) {
  resetState();
  const buf = new Uint8Array(bytes);
  try { Module.FS.writeFile("/input.bin", buf); } catch (_) {
    try { Module.FS.unlink("/input.bin"); } catch (_) {}
    Module.FS.writeFile("/input.bin", buf);
  }
  const standalone = new Module.WasmDexKit("/input.bin");
  const slotCount = standalone.verifyReport().length;
  originalSource = { vfs: "/input.bin", label, slotCount, dk: standalone, baseDexId: 0, dump: false };
  sources = [originalSource];
  dk = standalone;
  return { dexCount: dk.dexCount() };
}

async function handleAddDump({ bytes, label, vfs }) {
  const buf = new Uint8Array(bytes);
  try { Module.FS.writeFile(vfs, buf); } catch (_) {
    try { Module.FS.unlink(vfs); } catch (_) {}
    Module.FS.writeFile(vfs, buf);
  }
  const standalone = new Module.WasmDexKit(vfs);
  const slotCount = standalone.verifyReport().length;
  const entry = { vfs, label, slotCount, dk: standalone, baseDexId: 0, dump: true };
  dumpedSources.push(entry);
  sources = [...dumpedSources, originalSource];
  rebuildDk();
  return { dexCount: dk.dexCount() };
}

function handleDecompile({ cls, sourceIdx }) {
  const useDk = sourceIdx === -1 ? dk : (sources[sourceIdx] && sources[sourceIdx].dk) || dk;
  if (!useDk) throw new Error("no source loaded");
  return useDk.decompileClassJava(cls);
}

self.onmessage = async (e) => {
  const msg = e.data;
  const { id, type } = msg;
  try {
    if (type === "init") {
      // Sync the build SHA used for cache-busting; then proceed to lazy init.
      BUILD_SHA = msg.buildSha || "";
      await ensureInit();
      self.postMessage({ id, ok: true, result: { ready: true } });
      return;
    }
    await ensureInit();
    let result;
    if (type === "load")       result = await handleLoad(msg);
    else if (type === "addDump") result = await handleAddDump(msg);
    else if (type === "decompile") result = handleDecompile(msg);
    else if (type === "reset") { resetState(); result = {}; }
    else throw new Error("unknown message type: " + type);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: getExceptionMessage(err) });
  }
};
