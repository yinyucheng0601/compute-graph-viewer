import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "dependency-manifest.json"), "utf8"));
const requiredPaths = [
  ...manifest.runtime.map((item) => item.path),
  ...(manifest.bundledPatternSources || []),
  ...manifest.documentation,
];

await Promise.all(requiredPaths.map((path) => access(resolve(root, path))));

const paths = {
  index: resolve(root, "index.html"),
  mock: resolve(root, "mock-profiling-data.js"),
  modelHtml: resolve(root, "vendor/pto-design-system/patterns/model-graphviz/assets/openpangu_2_0_flash_modelviz.html"),
  modelJson: resolve(root, "vendor/pto-design-system/patterns/model-graphviz/assets/openpangu_2_0_flash_model_architecture.json"),
  modelPatternCss: resolve(root, "vendor/pto-design-system/patterns/model-graphviz/pattern.css"),
  modelPatternJs: resolve(root, "vendor/pto-design-system/patterns/model-graphviz/pattern.js"),
  sharedCss: resolve(root, "vendor/pto-design-system/css/style.css"),
};

const [indexHtml, mockScript, modelHtml, modelJsonText, modelPatternCss, modelPatternJs, sharedCss] = await Promise.all([
  readFile(paths.index, "utf8"),
  readFile(paths.mock, "utf8"),
  readFile(paths.modelHtml, "utf8"),
  readFile(paths.modelJson, "utf8"),
  readFile(paths.modelPatternCss, "utf8"),
  readFile(paths.modelPatternJs, "utf8"),
  readFile(paths.sharedCss, "utf8"),
]);

const architecture = JSON.parse(modelJsonText);
const executableScriptTypes = new Set(["", "text/javascript", "application/javascript", "module"]);

const parseInlineScripts = (html, fileName) => {
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let count = 0;
  while ((match = scriptPattern.exec(html))) {
    const attributes = match[1];
    if (/\bsrc\s*=/.test(attributes)) continue;
    const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "";
    if (!executableScriptTypes.has(type)) continue;
    new vm.Script(match[2], { filename: `${fileName}#inline-${count + 1}` });
    count += 1;
  }
  return count;
};

const indexScriptCount = parseInlineScripts(indexHtml, "index.html");
const modelScriptCount = parseInlineScripts(modelHtml, "openpangu_2_0_flash_modelviz.html");
const mockSandbox = { window: {} };
new vm.Script(mockScript, { filename: "mock-profiling-data.js" }).runInNewContext(mockSandbox);
const profile = mockSandbox.window.OPENPANGU_MOCK_PROFILE;

const schemaNodeIds = new Set(architecture.nodes.map((node) => node.id));
const reportNodeIds = Object.keys(profile?.REPORTS || {});
const missingReportNodeIds = reportNodeIds.filter((nodeId) => (
  !schemaNodeIds.has(nodeId) &&
  !modelHtml.includes(`id: '${nodeId}'`) &&
  !modelHtml.includes(`id: "${nodeId}"`)
));
const invalidTimelineNodeIds = (profile?.MODULE_TIMELINE || [])
  .map((item) => item.nodeId)
  .filter((nodeId) => nodeId && !profile.REPORTS[nodeId]);
const reportsWithoutMockDisclosure = reportNodeIds.filter((nodeId) => {
  const report = profile.REPORTS[nodeId];
  return report.synthetic !== true || !String(report.facts?.[0] || "").includes("MOCK PROFILE");
});

const tagReferencePattern = /<(?:link|script|iframe)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
const importReferencePattern = /@import\s+url\(\s*["']?([^"')]+)["']?\s*\)/gi;
const directImportReferencePattern = /@import\s+["']([^"']+)["']/gi;
const collectReferences = (text, pattern, baseDir) => {
  const references = [];
  let match;
  while ((match = pattern.exec(text))) references.push({ baseDir, reference: match[1] });
  return references;
};

const modelAssetDir = dirname(paths.modelHtml);
const runtimeReferences = [
  ...collectReferences(indexHtml, new RegExp(tagReferencePattern), root),
  ...collectReferences(modelHtml, new RegExp(tagReferencePattern), modelAssetDir),
  ...collectReferences(sharedCss, new RegExp(importReferencePattern), dirname(paths.sharedCss)),
  ...collectReferences(sharedCss, new RegExp(directImportReferencePattern), dirname(paths.sharedCss)),
  ...collectReferences(modelPatternCss, new RegExp(importReferencePattern), dirname(paths.modelPatternCss)),
  ...collectReferences(modelPatternCss, new RegExp(directImportReferencePattern), dirname(paths.modelPatternCss)),
];
const externalRuntimeReferences = runtimeReferences.filter(({ reference }) => /^(?:https?:)?\/\//i.test(reference));
const localRuntimeReferences = runtimeReferences.filter(({ reference }) => !/^(?:https?:)?\/\//i.test(reference));

await Promise.all(localRuntimeReferences.map(({ baseDir, reference }) => {
  const cleanReference = reference.split(/[?#]/, 1)[0].replaceAll("&amp;", "&");
  return access(resolve(baseDir, cleanReference));
}));

const mainLayerRepeat = architecture.repeats?.find((item) => item.id === "repeat_main_decoder_layers");
const denseLayerRepeat = architecture.repeats?.find((item) => item.id === "repeat_dense_ffn_layers");
const moeLayerRepeat = architecture.repeats?.find((item) => item.id === "repeat_moe_ffn_layers");
const mtpLayerRepeat = architecture.repeats?.find((item) => item.id === "repeat_mtp_layers");

const assertions = [
  [indexHtml.includes("openpangu_2_0_flash_modelviz.html?embed=1&amp;theme=dark&amp;report=1"), "entry embeds the bundled openPangu model viewer"],
  [indexHtml.includes('<script src="./mock-profiling-data.js"></script>'), "entry loads the explicit mock profile data layer"],
  [!indexHtml.includes("deepseek") && !indexHtml.includes("dsv32arch_"), "entry has no stale DeepSeek graph identifiers"],
  [!mockScript.includes("dsv32arch_"), "mock data uses openPangu node identifiers"],
  [!indexHtml.includes("../vendor/pto-design-system"), "entry has no parent-directory design-system reference"],
  [!modelHtml.includes("file:///"), "model viewer has no machine-local file URL"],
  [modelHtml.includes("PtoModelGraphvizPattern.renderController"), "model viewer uses the shared model-graphviz renderer"],
  [modelHtml.includes("PtoOpenPanguReportBridge"), "model viewer exposes the local report-selection bridge"],
  [modelPatternJs.includes("PtoModelGraphvizPattern"), "bundled model-graphviz behavior is present"],
  [architecture.model?.name === "openPangu-2.0-Flash", "canonical schema identifies openPangu-2.0-Flash"],
  [mainLayerRepeat?.count === 46 && denseLayerRepeat?.count === 2 && moeLayerRepeat?.count === 44 && mtpLayerRepeat?.count === 3, "canonical layer counts are 46 main, 2 dense, 44 MoE, and 3 MTP"],
  [architecture.symbol_table?.E === 256 && architecture.symbol_table?.top_k === 8, "canonical MoE parameters are 256 experts and top-k 8"],
  [reportNodeIds.length === 15 && missingReportNodeIds.length === 0, "all 15 mock report mappings resolve to bundled graph nodes"],
  [reportsWithoutMockDisclosure.length === 0, "every profiling report is synthetic and starts with a MOCK PROFILE disclosure"],
  [invalidTimelineNodeIds.length === 0, "all timeline node mappings resolve to mock reports"],
  [profile?.STEP_TIMELINE?.length === 10 && profile?.MODULE_TIMELINE?.length === 13, "mock profile includes 10 steps and 13 module segments"],
  [indexScriptCount === 2, "entry inline JavaScript parses"],
  [modelScriptCount >= 2, "model viewer inline JavaScript parses"],
  [externalRuntimeReferences.length === 0, "HTML and CSS declare no network runtime resources"],
];

const failed = assertions.filter(([condition]) => !condition);
for (const [condition, label] of assertions) console[condition ? "log" : "error"](`${condition ? "OK  " : "FAIL"} ${label}`);

if (failed.length) {
  if (missingReportNodeIds.length) console.error(`Missing report nodes: ${missingReportNodeIds.join(", ")}`);
  if (reportsWithoutMockDisclosure.length) console.error(`Missing mock disclosure: ${reportsWithoutMockDisclosure.join(", ")}`);
  if (invalidTimelineNodeIds.length) console.error(`Invalid timeline nodes: ${invalidTimelineNodeIds.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`OK   ${localRuntimeReferences.length} local HTML/CSS resource references resolve`);
  console.log(`OK   ${requiredPaths.length} declared project files exist`);
}
