(function registerDeepSeekReportData(global) {
  "use strict";

  function collectNodeObjects(value, result = new Map()) {
    if (Array.isArray(value)) {
      value.forEach((item) => collectNodeObjects(item, result));
      return result;
    }
    if (!value || typeof value !== "object") return result;

    if (typeof value.node_id === "string" && value.node_id) {
      const score = [
        value.semantic,
        value.node_kind,
        value.code_ref,
        value.children,
        value.kernels,
        value.op_ratio,
        value.time_us
      ].filter((item) => item != null).length;
      const previous = result.get(value.node_id);
      if (!previous || score > previous.score) result.set(value.node_id, { value, score });
    }

    Object.values(value).forEach((item) => collectNodeObjects(item, result));
    return result;
  }

  function nodeIndex(value) {
    return new Map(Array.from(collectNodeObjects(value), ([id, item]) => [id, item.value]));
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatNumber(value, digits = 2) {
    const numeric = number(value, NaN);
    if (!Number.isFinite(numeric)) return "–";
    return numeric.toLocaleString("en-US", { maximumFractionDigits: digits });
  }

  function formatUs(value) {
    const us = number(value);
    if (us >= 1000) return `${formatNumber(us / 1000, 3)} ms`;
    return `${formatNumber(us, 2)} us`;
  }

  function titleFor(nodeId, analysis, perf) {
    const raw = analysis?.name || perf?.module || nodeId.split("/").pop() || nodeId;
    if (nodeId.includes("/layers/dense_decoder_layer/") && nodeId !== "model/deepseek-v3.2-exp/layers/dense_decoder_layer") {
      return `Dense · ${raw}`;
    }
    if (nodeId.includes("/layers/moe_decoder_layer/") && nodeId !== "model/deepseek-v3.2-exp/layers/moe_decoder_layer") {
      return `MoE · ${raw}`;
    }
    if (nodeId.includes("/layers/mtp_layer/") && nodeId !== "model/deepseek-v3.2-exp/layers/mtp_layer") {
      return `MTP · ${raw}`;
    }
    return raw;
  }

  function laneKey(event) {
    const device = event.device_id == null ? "?" : event.device_id;
    const stream = event.stream_id == null ? "None" : event.stream_id;
    const core = event.accelerator_core || "UNKNOWN";
    return `D${device} · S${stream} · ${core}`;
  }

  function eventColor(event) {
    const core = String(event.accelerator_core || "").toUpperCase();
    if (core.includes("VECTOR")) return "#c678dd";
    if (core.includes("AI_CORE") || core.includes("MIX")) return "#61afef";
    if (core.includes("HCCL") || core.includes("COMM")) return "#e5c07b";
    if (core.includes("SDMA")) return "#56b6c2";
    return event.owner_node_id ? "#98c379" : "#7f848e";
  }

  function assertCompatible(analysisConfig, perfData, timelineData, analysisNodes, perfNodes) {
    const identity = [analysisConfig, perfData, timelineData].map((item) => `${item.model_id}::${item.report_id}`);
    if (new Set(identity).size !== 1) throw new Error(`Data identity mismatch: ${identity.join(", ")}`);

    const missingPerf = Array.from(perfNodes.keys()).filter((id) => !analysisNodes.has(id));
    const missingTimeline = Array.from(new Set(
      (timelineData.events || []).map((event) => event.owner_node_id).filter(Boolean)
    )).filter((id) => !analysisNodes.has(id));
    if (missingPerf.length || missingTimeline.length) {
      throw new Error(`Unresolved node IDs: perf=${missingPerf.length}, timeline=${missingTimeline.length}`);
    }
  }

  function createReportModel(analysisConfig, perfData, timelineData) {
    const analysisNodes = nodeIndex(analysisConfig);
    const perfNodes = nodeIndex(perfData);
    assertCompatible(analysisConfig, perfData, timelineData, analysisNodes, perfNodes);

    const events = Array.isArray(timelineData.events) ? timelineData.events : [];
    const eventsByOwner = new Map();
    events.forEach((event) => {
      if (!event.owner_node_id) return;
      if (!eventsByOwner.has(event.owner_node_id)) eventsByOwner.set(event.owner_node_id, []);
      eventsByOwner.get(event.owner_node_id).push(event);
    });

    const reports = {};
    perfNodes.forEach((perf, nodeId) => {
      const analysis = analysisNodes.get(nodeId) || {};
      const ownedEvents = eventsByOwner.get(nodeId) || [];
      const opRatio = Object.entries(perf.op_ratio || {})
        .sort((a, b) => number(b[1]) - number(a[1]))
        .slice(0, 6)
        .map(([name, ratio]) => [name, `${formatNumber(ratio, 2)}%`]);
      const facts = [
        analysis.semantic,
        analysis.code_ref ? `Source: ${analysis.code_ref}` : "",
        perf.metric_scope ? `Metric scope: ${perf.metric_scope}` : "",
        Array.isArray(perf.instance_indices) ? `Instances: ${perf.instance_indices.join(", ")}` : "",
        perf.representative_instance != null ? `Representative instance: ${perf.representative_instance}` : "",
        `Timeline mapping: ${ownedEvents.length} direct event${ownedEvents.length === 1 ? "" : "s"}`
      ].filter(Boolean);

      const metrics = [
        ["kernel time", formatUs(perf.time_us)],
        ["time share", `${formatNumber(perf.time_pct, 2)}%`],
        ["operators", formatNumber(perf.nops, 0)],
        ["HBM estimate", perf.hbm_mb == null ? "–" : `${formatNumber(perf.hbm_mb, 3)} MB`],
        ["MFU INT8", perf.mfu_int8_pct == null ? "–" : `${formatNumber(perf.mfu_int8_pct, 2)}%`],
        ["MFU BF16", perf.mfu_bf16_pct == null ? "–" : `${formatNumber(perf.mfu_bf16_pct, 2)}%`]
      ];

      reports[nodeId] = {
        nodeId,
        timeSharePct: number(perf.time_pct),
        dimension: analysis.node_kind || perf.metric_scope || "performance node",
        title: titleFor(nodeId, analysis, perf),
        metricShort: `${formatNumber(perf.time_pct, 2)}%`,
        summary: analysis.semantic || `${perf.module || nodeId} performance metrics for representative step ${perfData.representative_step}.`,
        metrics,
        facts,
        operators: opRatio,
        actions: []
      };
    });

    const reportOrder = Object.keys(reports).sort((left, right) => {
      const leftPerf = perfNodes.get(left);
      const rightPerf = perfNodes.get(right);
      return number(rightPerf?.time_us) - number(leftPerf?.time_us) || left.localeCompare(right);
    });

    const timeline = events.map((event) => {
      const lane = laneKey(event);
      return {
        eventId: event.event_id,
        name: event.name || event.op_type || event.event_id,
        nodeId: event.owner_node_id || "",
        instanceIndex: event.instance_index,
        startUs: number(event.ts_us),
        endUs: number(event.end_us, number(event.ts_us) + number(event.duration_us)),
        wallUs: number(event.duration_us),
        opUs: number(event.duration_us),
        waitUs: number(event.wait_time_us),
        lane,
        stream: event.stream_id == null ? "None" : String(event.stream_id),
        device: event.device_id,
        core: event.accelerator_core || "UNKNOWN",
        dominant: lane,
        category: event.mapping_status || (event.owner_node_id ? "direct" : "unmapped"),
        color: eventColor(event)
      };
    }).sort((left, right) => left.startUs - right.startUs || right.wallUs - left.wallUs);

    const laneMap = new Map();
    timeline.forEach((event) => {
      if (!laneMap.has(event.lane)) {
        laneMap.set(event.lane, {
          lane: event.lane,
          stream: event.stream,
          device: event.device,
          core: event.core,
          opUs: 0,
          waitUs: 0,
          ops: 0
        });
      }
      const lane = laneMap.get(event.lane);
      lane.opUs += event.opUs;
      lane.waitUs += event.waitUs;
      lane.ops += 1;
    });
    const streamSummary = Array.from(laneMap.values()).sort((left, right) => {
      if (left.device !== right.device) return number(left.device) - number(right.device);
      if (left.stream !== right.stream) return number(left.stream, Number.MAX_SAFE_INTEGER) - number(right.stream, Number.MAX_SAFE_INTEGER);
      return left.core.localeCompare(right.core);
    });

    const mapping = timelineData.mapping_summary || {};
    const mappedEvents = number(mapping.mapped_events, timeline.filter((event) => event.nodeId).length);
    const unmappedEvents = number(mapping.unmapped_events, timeline.length - mappedEvents);
    const mappingCoveragePct = number(mapping.mapping_coverage_pct, timeline.length ? mappedEvents / timeline.length * 100 : 0);
    const stepSummary = {
      step: timelineData.representative_step ?? perfData.representative_step,
      decodeLatencyUs: number(perfData.summary?.decode_latency_ms) * 1000,
      kernelSumUs: number(perfData.summary?.kernel_sum_ms) * 1000,
      mappingCoveragePct,
      mappedEvents,
      unmappedEvents,
      eventCount: number(timelineData.event_count, timeline.length),
      globalMfuInt8Pct: number(perfData.summary?.global_mfu_int8_pct)
    };

    return {
      identity: {
        modelId: perfData.model_id,
        reportId: perfData.report_id,
        idNamespace: perfData.id_namespace,
        sku: perfData.sku
      },
      reports,
      reportOrder,
      timeline,
      streamSummary,
      stepSummary,
      counts: {
        analysisNodes: analysisNodes.size,
        perfNodes: perfNodes.size,
        timelineEvents: timeline.length,
        mappedEvents,
        unmappedEvents,
        lanes: streamSummary.length
      }
    };
  }

  global.DeepSeekReportData = {
    createReportModel
  };
})(window);
