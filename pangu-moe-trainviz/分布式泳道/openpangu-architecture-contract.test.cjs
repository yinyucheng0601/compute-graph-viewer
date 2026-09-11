const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const generator = require('./generate-openpangu-architecture-assets.cjs');
const committed = Object.freeze({
  architecture: JSON.parse(fs.readFileSync(generator.OUTPUTS.architecture, 'utf8')),
  graph: JSON.parse(fs.readFileSync(generator.OUTPUTS.graph, 'utf8')),
});

test('source-checked generation is deterministic and committed artifacts do not drift', (t) => {
  if (!generator.SOURCE_INPUTS.every(fs.existsSync)) {
    t.skip('local source checkouts are not present in this checkout');
    return;
  }
  const first = generator.generate();
  const second = generator.generate();
  assert.deepEqual(second, first);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(generator.OUTPUTS.architecture, 'utf8')),
    first.architecture,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(generator.OUTPUTS.graph, 'utf8')),
    first.graph,
  );
  assert.equal(fs.readFileSync(generator.OUTPUTS.validation, 'utf8'), first.validation);
});

test('Routed Experts owns the complete logical Expert inventory', () => {
  const { architecture, graph } = committed;
  const routed = architecture.nodes.find((node) => node.id === 'routed_expert_bank');
  assert.equal(routed.kind, 'module');
  assert.equal(routed.label, 'Routed Experts');
  assert.equal(routed.children.length, 256);
  assert.deepEqual(routed.children, [...Array(256).keys()].map((id) => `expert_${id}`));

  const find = (item, id) => item.id === id ? item : item.children.map((child) => find(child, id)).find(Boolean);
  const sourceRoot = graph.roots.find((root) => root.id === 'section/source_architecture');
  const routedItem = find(sourceRoot, 'routed_expert_bank');
  assert.equal(routedItem.repeatCount, 256);
  assert.equal(routedItem.children.filter((child) => child.logicalInstance).length, 256);
  assert.equal(find(sourceRoot, 'expert_0').label, 'E000');
  assert.equal(find(sourceRoot, 'expert_193').label, 'E193');
  assert.equal(find(sourceRoot, 'expert_255').label, 'E255');
  assert.equal(find(sourceRoot, 'expert_193').attrs.ownerGlobalRank, null);
  assert.equal(find(sourceRoot, 'expert_193').attrs.epRank, null);
});

test('mHC and ordinary residual paths are separate source branches', () => {
  const { graph } = committed;
  const byId = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const expectedMhcResiduals = [
    'e_decoder_to_attention_residual',
    'e_attention_residual_to_mhc_post',
    'e_mhc_attention_post_to_mlp_residual',
    'e_mlp_residual_to_mhc_post',
  ];
  expectedMhcResiduals.forEach((id) => {
    assert.equal(byId.get(id).semanticEdgeType, 'residual');
    assert.equal(byId.get(id).condition, 'use_mhc=true');
  });
  assert.equal(byId.get('e_attention_residual_to_fallback_add').condition, 'use_mhc=false');
  assert.equal(byId.get('e_mlp_residual_to_fallback_add').condition, 'use_mhc=false');
  assert.ok(!byId.has('e_decoder_to_mhc'));
  assert.ok(!byId.has('e_mhc_to_norm'));
});

test('Q/KV/O MoME residuals remain local and are not decoder residual aliases', () => {
  const { graph } = committed;
  const byId = new Map(graph.edges.map((edge) => [edge.id, edge]));
  [
    ['e_qa_skip_to_qadd', 'q_residual_add'],
    ['e_kva_skip_to_kvadd', 'kv_residual_add'],
    ['e_core_skip_to_oadd', 'o_residual_add'],
  ].forEach(([id, target]) => {
    assert.equal(byId.get(id).semanticEdgeType, 'residual');
    assert.equal(byId.get(id).target, target);
    assert.equal(byId.get(id).condition, undefined);
  });
});

test('MoE communication strategies are mutually exclusive and dispatch IDs are canonical', () => {
  const { graph } = committed;
  const policy = graph.runtimePolicies.find((item) => item.id === 'moe_communication_strategy');
  assert.equal(policy.mutually_exclusive, true);
  assert.deepEqual(policy.options.map((option) => option.value), [
    'allreduce',
    'allgather_reducescatter',
    'all2allv',
    'dispatch_combine',
    'fused',
  ]);
  const graphIds = new Set();
  const walk = (item) => {
    graphIds.add(item.id);
    item.children.forEach(walk);
  };
  graph.roots.forEach(walk);
  assert.ok(graphIds.has('moe_all_to_all_dispatch'));
  assert.ok(graphIds.has('moe_all_to_all_combine'));
  assert.equal(graph.metadata.runtimePolicy.moeCommunicationStrategy, null);
});
