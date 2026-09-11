(function attachTimelineContractV4(root) {
  'use strict';

  const EPSILON = 1e-8;

  function validate(data, schema) {
    const fail = (message) => { throw new Error(`Timeline v4 contract: ${message}`); };
    const supported = new Set([
      '$schema', '$id', '$defs', '$ref', 'type', 'required', 'properties', 'items',
      'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'pattern',
    ]);

    function resolveRef(ref) {
      if (!ref.startsWith('#/')) fail(`unsupported ref ${ref}`);
      return ref.slice(2).split('/').reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], schema);
    }

    function check(value, rule, path) {
      if (rule.$ref) return check(value, resolveRef(rule.$ref), path);
      Object.keys(rule).forEach((key) => { if (!supported.has(key)) fail(`unsupported schema keyword ${key}`); });
      if (rule.type) {
        const types = Array.isArray(rule.type) ? rule.type : [rule.type];
        const valid = types.some((type) => type === 'null' ? value === null
          : type === 'integer' ? Number.isInteger(value)
            : type === 'number' ? Number.isFinite(value)
              : type === 'array' ? Array.isArray(value)
                : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
                  : typeof value === type);
        if (!valid) fail(`${path}: type`);
      }
      if (rule.enum && !rule.enum.includes(value)) fail(`${path}: enum`);
      if (rule.minimum !== undefined && value !== null && value < rule.minimum) fail(`${path}: minimum`);
      if (rule.maximum !== undefined && value !== null && value > rule.maximum) fail(`${path}: maximum`);
      if (rule.minLength !== undefined && typeof value === 'string' && value.length < rule.minLength) fail(`${path}: minLength`);
      if (rule.pattern && typeof value === 'string' && !(new RegExp(rule.pattern).test(value))) fail(`${path}: pattern`);
      if (rule.minItems !== undefined && Array.isArray(value) && value.length < rule.minItems) fail(`${path}: minItems`);
      if (rule.maxItems !== undefined && Array.isArray(value) && value.length > rule.maxItems) fail(`${path}: maxItems`);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        (rule.required || []).forEach((key) => { if (!(key in value)) fail(`${path}.${key}: missing`); });
        Object.entries(rule.properties || {}).forEach(([key, child]) => { if (key in value) check(value[key], child, `${path}.${key}`); });
      }
      if (rule.items && Array.isArray(value)) value.forEach((item, index) => check(item, rule.items, `${path}[${index}]`));
      return value;
    }

    check(data, schema, 'root');
    if (data.stepBounds.end <= data.stepBounds.start) fail('step bounds must be positive');
    if (data.incident.timeRange.end <= data.incident.timeRange.start) fail('incident time range must be positive');
    if (data.incident.timeRange.start < data.stepBounds.start || data.incident.timeRange.end > data.stepBounds.end) fail('incident time range');

    const provenance = uniqueMap(data.provenance, 'id', fail, 'provenance');
    const requireProvenance = (item, label) => {
      if (!item.provenanceIds?.length || item.provenanceIds.some((id) => !provenance.has(id))) fail(`${label} provenance`);
    };
    requireProvenance(data.modelExecution, 'model execution');

    if (data.training.worldSizePolicy.kind === 'cartesian-product') {
      const dimensions = data.training.worldSizePolicy.dimensions || [];
      if (!dimensions.length || new Set(dimensions).size !== dimensions.length) fail('world size dimensions');
      const product = dimensions.reduce((total, key) => total * data.training[key], 1);
      if (product !== data.training.worldSize) fail('world size does not match declared Cartesian policy');
    }

    const stages = uniqueMap(data.stages, 'id', fail, 'stage');
    if (stages.size !== data.training.pp) fail('stage count does not match PP');
    const layerOwners = new Map();
    data.stages.forEach((stage) => {
      requireProvenance(stage, `stage PP${stage.id}`);
      if (stage.last < stage.first || stage.last >= data.model.numHiddenLayers) fail(`stage range PP${stage.id}`);
      for (let layer = stage.first; layer <= stage.last; layer += 1) {
        if (layerOwners.has(layer)) fail(`layer L${layer} belongs to multiple stages`);
        layerOwners.set(layer, stage.id);
      }
    });
    for (let layer = 0; layer < data.model.numHiddenLayers; layer += 1) {
      if (!layerOwners.has(layer)) fail(`layer L${layer} has no stage`);
    }

    const ranks = new Map();
    data.ranks.forEach((rank) => {
      if (ranks.has(rank.globalRank) || rank.rank !== rank.globalRank) fail(`duplicate or ambiguous global rank ${rank.globalRank}`);
      if (rank.dp >= data.training.dp || rank.stage >= data.training.pp || rank.tp >= data.training.tp || rank.epRank >= data.training.ep) fail(`rank coordinate R${rank.globalRank}`);
      requireProvenance(rank, `rank R${rank.globalRank}`);
      ranks.set(rank.globalRank, rank);
    });
    if (data.coverage.visibleRanks !== data.ranks.length) fail('coverage.visibleRanks must equal ranks.length');
    const visibleDp = [...new Set(data.ranks.map((rank) => rank.dp))].sort((a, b) => a - b);
    if (!sameArray(visibleDp, [...data.coverage.visibleDp].sort((a, b) => a - b))) fail('coverage.visibleDp does not match rank coordinates');
    if (data.coverage.mode === 'full-world' && data.ranks.length !== data.training.worldSize) fail('full-world coverage does not contain worldSize ranks');

    const groups = new Map();
    data.epGroups.forEach((group) => {
      if (groups.has(group.id)) fail(`duplicate EP group ${group.id}`);
      if (!stages.has(group.stage) || group.dp >= data.training.dp || group.tp >= data.training.tp) fail(`EP group coordinate ${group.id}`);
      if (group.ranks.length !== data.training.ep) fail(`EP group ${group.id} does not contain EP${data.training.ep} members`);
      const coordinates = new Set();
      group.ranks.forEach((member) => {
        const rank = ranks.get(member.globalRank);
        if (!rank || rank.epGroupId !== group.id || rank.epRank !== member.epRank || rank.stage !== group.stage || rank.dp !== group.dp || rank.tp !== group.tp) fail(`EP group member mismatch ${group.id}/R${member.globalRank}`);
        if (coordinates.has(member.epRank)) fail(`duplicate EP coordinate ${group.id}/EP${member.epRank}`);
        coordinates.add(member.epRank);
      });
      requireProvenance(group, `EP group ${group.id}`);
      groups.set(group.id, group);
    });

    const bindings = uniqueMap(data.modelBindings, 'semanticNodeId', fail, 'model binding');
    data.modelBindings.forEach((binding) => {
      if (binding.architectureAssetId !== data.model.architectureAsset.id) fail(`binding asset ${binding.semanticNodeId}`);
    });

    const events = new Map();
    data.events.forEach((event) => {
      if (events.has(event.id)) fail(`duplicate event ${event.id}`);
      const rank = ranks.get(event.globalRank);
      if (!rank || event.rank !== event.globalRank || event.dp !== rank.dp || event.stage !== rank.stage || event.tp !== rank.tp || event.epRank !== rank.epRank || event.epGroupId !== rank.epGroupId) fail(`event placement ${event.id}`);
      if (!groups.has(event.epGroupId)) fail(`event EP group ${event.id}`);
      if (event.layer !== null && layerOwners.get(event.layer) !== event.stage) fail(`event layer/stage ${event.id}`);
      if (event.end < event.start || event.start < data.stepBounds.start || event.end > data.stepBounds.end) fail(`event interval ${event.id}`);
      if (event.fidelity !== data.fidelity) fail(`event fidelity ${event.id}`);
      if (event.graphNodeIds.some((id) => !bindings.has(id))) fail(`event graph binding ${event.id}`);
      if (event.participants.some((rankId) => !ranks.has(rankId))) fail(`event participants ${event.id}`);
      requireProvenance(event, `event ${event.id}`);
      events.set(event.id, event);
    });
    data.events.forEach((event) => {
      event.dependsOn.forEach((id) => {
        const previous = events.get(id);
        if (!previous || previous.end > event.start + EPSILON) fail(`causal dependency ${event.id} <- ${id}`);
      });
      [...event.blockedBy, ...event.affects].forEach((id) => { if (!events.has(id) || id === event.id) fail(`diagnosis relation ${event.id} -> ${id}`); });
    });

    const placements = new Map();
    data.expertPlacements.forEach((placement) => {
      const key = contextExpertKey(placement);
      if (placements.has(key)) fail(`duplicate expert placement ${key}`);
      if (placement.logicalExpertId >= data.model.expertCount) fail(`placement expert id ${placement.logicalExpertId}`);
      if (!groups.has(placement.epGroupId)) fail(`placement EP group ${key}`);
      const rank = ranks.get(placement.ownerGlobalRank);
      if (!rank || rank.epRank !== placement.epRank || rank.epGroupId !== placement.epGroupId) fail(`expert placement owner ${key}`);
      requireProvenance(placement, `expert placement ${key}`);
      placements.set(key, placement);
    });

    const metrics = new Map();
    data.routerMetrics.forEach((metric) => {
      const key = contextKey(metric);
      if (metrics.has(key)) fail(`duplicate router metric ${key}`);
      if (metric.topExpertId >= data.model.expertCount || metric.idleTop1Experts > data.model.expertCount) fail(`router metric expert range ${key}`);
      if (!groups.has(metric.epGroupId) || layerOwners.get(metric.layer) !== groups.get(metric.epGroupId).stage) fail(`router metric context ${key}`);
      requireProvenance(metric, `router metric ${key}`);
      metrics.set(key, metric);
    });

    const loadsByContext = new Map();
    const loadsByKey = new Map();
    data.expertLoads.forEach((load) => {
      const key = contextExpertKey(load);
      if (loadsByKey.has(key) || load.logicalExpertId >= data.model.expertCount) fail(`expert load id ${key}`);
      const placement = placements.get(key);
      if (!placement || placement.ownerGlobalRank !== load.ownerGlobalRank || placement.epRank !== load.epRank) fail(`expert load placement ${key}`);
      if (Math.abs(load.top1Share - load.top1TokenCount / (metrics.get(contextKey(load))?.totalTop1Assignments || 1)) > EPSILON) fail(`expert top1 share ${key}`);
      if (load.status === 'idle-top1' && load.top1TokenCount !== 0) fail(`idle Top1 expert has assignments ${key}`);
      if (load.status === 'missing' && (load.top1TokenCount !== 0 || load.topKCopyCount !== null || load.routingWeightSum !== null)) fail(`missing expert has populated metrics ${key}`);
      requireProvenance(load, `expert load ${key}`);
      const context = contextKey(load);
      if (!loadsByContext.has(context)) loadsByContext.set(context, []);
      loadsByContext.get(context).push(load);
      loadsByKey.set(key, load);
    });
    metrics.forEach((metric, context) => {
      const loads = loadsByContext.get(context) || [];
      if (loads.length !== data.model.expertCount) fail(`expert load inventory ${context}`);
      const ids = loads.map((load) => load.logicalExpertId).sort((a, b) => a - b);
      if (!sameArray(ids, Array.from({ length: data.model.expertCount }, (_, id) => id))) fail(`expert load ID set ${context}`);
      const total = loads.reduce((sum, load) => sum + load.top1TokenCount, 0);
      const shares = loads.reduce((sum, load) => sum + load.top1Share, 0);
      if (total !== metric.totalTop1Assignments || Math.abs(shares - 1) > EPSILON) fail(`Top1 conservation ${context}`);
      const top = loads.find((load) => load.logicalExpertId === metric.topExpertId);
      if (!top || Math.abs(top.top1Share - metric.topExpertTop1Share) > EPSILON) fail(`top Expert metric ${context}`);
      if (loads.filter((load) => load.status === 'idle-top1').length !== metric.idleTop1Experts) fail(`idle Top1 summary ${context}`);
    });

    if (data.routingMode === 'aggregate-only' && data.routingRecords.length) fail('aggregate-only dataset must not contain token routing records');
    if (data.routingMode === 'token-level') {
      data.routingRecords.forEach((record) => {
        if (record.routes.length !== data.model.topK) fail(`routing Top-K ${record.id}`);
        const ids = record.routes.map((route) => route.logicalExpertId);
        if (new Set(ids).size !== ids.length || ids.some((id) => id >= data.model.expertCount)) fail(`routing Expert IDs ${record.id}`);
        if (Math.abs(record.routes.reduce((sum, route) => sum + route.weight, 0) - 1) > EPSILON) fail(`routing weights ${record.id}`);
        record.routes.forEach((route) => {
          if (!placements.has(`${record.layer}|${record.epGroupId}|${route.logicalExpertId}`)) fail(`routing placement ${record.id}/E${route.logicalExpertId}`);
        });
        requireProvenance(record, `routing record ${record.id}`);
      });
    }

    const focus = data.incident.focus;
    const focusStage = stages.get(focus.stage);
    if (!focusStage || focus.layer < focusStage.first || focus.layer > focusStage.last) fail('incident focus layer/stage');
    if (!groups.has(focus.epGroupId) || groups.get(focus.epGroupId).stage !== focus.stage) fail('incident focus EP group');
    if (focus.eventIds.some((id) => !events.has(id)) || focus.rankIds.some((id) => !ranks.has(id)) || focus.nodeIds.some((id) => !bindings.has(id)) || focus.expertIds.some((id) => id >= data.model.expertCount)) fail('incident focus references');
    focus.rankIds.forEach((id) => {
      const rank = ranks.get(id);
      if (rank.stage !== focus.stage || rank.epGroupId !== focus.epGroupId) fail(`incident focus rank context R${id}`);
    });
    const focusContext = `${focus.layer}|${focus.microbatchId}|${focus.epGroupId}`;
    if (!metrics.has(focusContext)) fail('incident focus router metric');
    focus.expertIds.forEach((id) => {
      if (!loadsByKey.has(`${focus.layer}|${focus.epGroupId}|${id}`)) fail(`incident focus Expert E${id}`);
    });
    requireProvenance(data.incident, 'incident');
    return data;
  }

  function uniqueMap(items, key, fail, label) {
    const map = new Map();
    items.forEach((item) => {
      if (map.has(item[key])) fail(`duplicate ${label} ${item[key]}`);
      map.set(item[key], item);
    });
    return map;
  }

  function sameArray(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function contextKey(item) {
    return `${item.layer}|${item.microbatchId}|${item.epGroupId}`;
  }

  function contextExpertKey(item) {
    return `${item.layer}|${item.epGroupId}|${item.logicalExpertId}`;
  }

  const api = Object.freeze({ validate });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimelineContractV4 = api;
})(globalThis);
