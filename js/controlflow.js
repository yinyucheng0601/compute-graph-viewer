(function () {
  var allNodesMap = {};

  function buildNodeMap() {
    var data = window.CONTROLFLOW_DATA;
    allNodesMap = {};
    data.sourceNodes.forEach(function (n) { allNodesMap[n.id] = n; });
    data.compiledNodes.forEach(function (n) { allNodesMap[n.id] = n; });
  }

  function renderNode(node, allNodes) {
    var nodeMap = {};
    allNodes.forEach(function (n) { nodeMap[n.id] = n; });

    var el = document.createElement('div');
    var pathId = node.pathId || node.pathRef || null;
    var cls = 'cf-node cf-node-' + node.type;
    if (pathId) cls += ' cf-clickable';
    el.className = cls;
    el.dataset.nodeId = node.id;
    if (pathId) el.dataset.pathId = pathId;

    var inner = '<div class="cf-node-main">';
    inner += '<span class="cf-node-label">' + node.label + '</span>';
    if (node.annotation) {
      inner += '<span class="cf-node-annotation">' + node.annotation.replace(/\n/g, '<br>') + '</span>';
    }
    inner += '</div>';

    if (node.children && node.children.length > 0) {
      inner += '<div class="cf-children">';
      node.children.forEach(function (childId) {
        var child = nodeMap[childId];
        if (child) inner += renderNode(child, allNodes).outerHTML;
      });
      inner += '</div>';
    }

    el.innerHTML = inner;
    return el;
  }

  function renderControlflow() {
    var data = window.CONTROLFLOW_DATA;
    buildNodeMap();

    var colSource = document.getElementById('cfColSource');
    var colCompiled = document.getElementById('cfColCompiled');
    if (!colSource || !colCompiled) return;

    // Clear existing nodes (keep the label div)
    var sourceLabel = colSource.querySelector('.cf-col-label');
    colSource.innerHTML = '';
    if (sourceLabel) colSource.appendChild(sourceLabel);

    var compiledLabel = colCompiled.querySelector('.cf-col-label');
    colCompiled.innerHTML = '';
    if (compiledLabel) colCompiled.appendChild(compiledLabel);

    // Render source nodes (entry node is root)
    var srcEntry = data.sourceNodes.find(function (n) { return n.type === 'entry'; });
    if (srcEntry) {
      colSource.appendChild(renderNode(srcEntry, data.sourceNodes));
    }

    // Render compiled nodes (entry node is root)
    var cmpEntry = data.compiledNodes.find(function (n) { return n.type === 'entry'; });
    if (cmpEntry) {
      colCompiled.appendChild(renderNode(cmpEntry, data.compiledNodes));
    }
  }

  function drawMappingLines(activePathId) {
    var svg = document.getElementById('cfMappingSvg');
    if (!svg) return;

    var data = window.CONTROLFLOW_DATA;
    var svgRect = svg.getBoundingClientRect();
    if (svgRect.width === 0) return;

    svg.innerHTML = '';

    data.mappings.forEach(function (mapping) {
      var fromEl = document.querySelector('[data-node-id="' + mapping.from + '"]');
      var toEl = document.querySelector('[data-node-id="' + mapping.to + '"]');
      if (!fromEl || !toEl) return;

      var fromRect = fromEl.getBoundingClientRect();
      var toRect = toEl.getBoundingClientRect();

      var x1 = fromRect.right - svgRect.left;
      var y1 = fromRect.top + fromRect.height / 2 - svgRect.top;
      var x2 = toRect.left - svgRect.left;
      var y2 = toRect.top + toRect.height / 2 - svgRect.top;

      var cx1 = x1 + (x2 - x1) * 0.5;
      var cy1 = y1;
      var cx2 = x1 + (x2 - x1) * 0.5;
      var cy2 = y2;

      // Determine if this mapping is active
      var fromNode = allNodesMap[mapping.from];
      var toNode = allNodesMap[mapping.to];
      var isActive = false;
      if (activePathId) {
        isActive = (fromNode && fromNode.pathRef === activePathId) ||
                   (toNode && toNode.pathId === activePathId);
      }

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + cx1 + ',' + cy1 + ' ' + cx2 + ',' + cy2 + ' ' + x2 + ',' + y2);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', isActive ? '#7c3aed' : '#2a2a2a');
      path.setAttribute('stroke-width', isActive ? '2' : '1');
      path.setAttribute('stroke-opacity', isActive ? '1' : '0.7');
      if (isActive) {
        path.setAttribute('filter', 'drop-shadow(0 0 3px rgba(124,58,237,0.6))');
      }
      svg.appendChild(path);
    });
  }

  window.drawMappingLines = drawMappingLines;

  window.cfHighlightPath = function (pathId) {
    var data = window.CONTROLFLOW_DATA;

    // Remove all active states
    document.querySelectorAll('.cf-active').forEach(function (el) {
      el.classList.remove('cf-active');
    });

    if (!pathId) {
      drawMappingLines(null);
      return;
    }

    // Highlight compiled node with matching pathId
    var cmpEl = document.querySelector('[data-path-id="' + pathId + '"]');
    if (cmpEl) cmpEl.classList.add('cf-active');

    // Find and highlight corresponding source node via mappings
    data.mappings.forEach(function (mapping) {
      var toNode = allNodesMap[mapping.to];
      if (toNode && toNode.pathId === pathId) {
        var srcEl = document.querySelector('[data-node-id="' + mapping.from + '"]');
        if (srcEl) srcEl.classList.add('cf-active');
      }
    });

    drawMappingLines(pathId);
  };

  // Panel close toggle
  var cfToggle = document.getElementById('cfToggle');
  if (cfToggle) {
    cfToggle.addEventListener('click', function () {
      var panel = document.getElementById('cfPanel');
      panel.classList.remove('cf-visible');
      var reopenBtn = document.getElementById('cfReopenBtn');
      if (reopenBtn) reopenBtn.style.display = 'flex';
    });
  }

  // Reopen button
  var cfReopenBtn = document.getElementById('cfReopenBtn');
  if (cfReopenBtn) {
    cfReopenBtn.addEventListener('click', function () {
      var panel = document.getElementById('cfPanel');
      panel.classList.add('cf-visible');
      cfReopenBtn.style.display = 'none';
      setTimeout(function () {
        if (window.cfHighlightPath) window.cfHighlightPath(null);
      }, 260);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderControlflow();

    // Click on compiled path nodes
    var colCompiled = document.getElementById('cfColCompiled');
    if (colCompiled) {
      colCompiled.addEventListener('click', function (e) {
        var node = e.target.closest('[data-path-id]');
        if (!node) return;
        var pathId = node.dataset.pathId;
        window.cfHighlightPath(pathId);
        if (window.navSelectPath) window.navSelectPath(pathId);
      });
    }

    // Draw lines after first paint
    requestAnimationFrame(function () {
      drawMappingLines(null);
    });
  });

  window.addEventListener('resize', function () {
    var currentActive = document.querySelector('.cf-active[data-path-id]');
    drawMappingLines(currentActive ? currentActive.dataset.pathId : null);
  });
})();
