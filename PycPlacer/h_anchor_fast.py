"""
H-Anchor Fast: Python wrapper for C++ backend

Provides seamless integration between the C++ core algorithm
and Python utilities (parsing, visualization).
"""

import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum

# Try to import C++ backend
try:
    import h_anchor_cpp
    HAS_CPP_BACKEND = True
    print("✓ H-Anchor C++ backend loaded")
except ImportError:
    HAS_CPP_BACKEND = False
    raise ImportError("C++ backend is required. Please compile with: python setup.py build_ext --inplace")


class ScoringMethod(Enum):
    """Scoring methods for anchor selection."""
    PAGERANK = "pagerank"
    DEGREE = "degree"
    HYBRID = "hybrid"
    BETWEENNESS = "betweenness"


class PortSide(Enum):
    """Side of the placement rectangle where a port is located."""
    LEFT = "left"      # x = 0
    RIGHT = "right"    # x = die_width
    TOP = "top"        # y = die_height
    BOTTOM = "bottom"  # y = 0
    AUTO = "auto"      # Let algorithm decide


@dataclass
class PlacementConfig:
    """Configuration for H-Anchor placement."""
    # Hierarchy parameters
    num_layers: int = 5
    top_layer_size: int = 100
    decimation_factor: float = 0.25
    
    # Scoring parameters
    scoring_method: ScoringMethod = ScoringMethod.HYBRID
    alpha: float = 0.4
    beta: float = 0.6
    
    # Force-directed parameters
    top_layer_iterations: int = 300
    refinement_iterations: int = 100
    repulsion_strength: float = 2.0
    attraction_strength: float = 0.1
    overlap_repulsion: float = 5.0    # 防止重叠的强排斥力
    min_spacing: float = 8.0          # cells之间的最小间距
    center_gravity: float = 0.01
    spread_factor: float = 0.6        # 初始分布范围 (0-1, 1=整个die, 0.5=中心50%)
    global_attraction: float = 0.02   # 全局吸引力，让clusters互相靠近
    
    # Legalization parameters
    cell_width: float = 1.0
    cell_height: float = 1.0
    row_height: float = 1.0
    die_width: float = 1000.0
    die_height: float = 1000.0
    
    # Advanced options
    use_transitive_edges: bool = True
    transitive_edge_hops: int = 3
    jitter_scale: float = 20.0
    anchor_mass_factor: float = 5.0


@dataclass
class Cell:
    """Represents a cell/node in the netlist."""
    id: str
    width: float = 1.0
    height: float = 1.0
    fixed: bool = False
    layer: int = 0
    module: str = ""
    
    x: float = 0.0
    y: float = 0.0
    legal_x: float = 0.0
    legal_y: float = 0.0
    
    # Port properties
    is_port: bool = False
    port_side: Optional[PortSide] = None  # Which side of rectangle (None = not a port)
    port_position: Optional[float] = None  # Position along the side (0.0-1.0, None = auto)


@dataclass
class Port:
    """
    Represents a port signal on the boundary of the placement region.
    
    Ports are represented as dummy cells that must be placed on the 
    boundary of the placement rectangle.
    """
    name: str
    side: PortSide = PortSide.AUTO  # Which side (LEFT/RIGHT/TOP/BOTTOM/AUTO)
    position: Optional[float] = None  # Position along side (0.0-1.0), None = auto
    connected_cells: List[str] = field(default_factory=list)  # Internal cells connected to this port
    
    def __post_init__(self):
        if self.connected_cells is None:
            self.connected_cells = []


class HAnchorPlacer:
    """
    H-Anchor placer using C++ backend for high performance.
    """
    
    def __init__(self, config: Optional[PlacementConfig] = None):
        self.py_config = config or PlacementConfig()
        self.graph = None
        self.cells: Dict[str, Cell] = {}
        self.ports: Dict[str, Port] = {}  # Port signals on boundary
        self.positions: Dict[str, np.ndarray] = {}
        self.legal_positions: Dict[str, Tuple[float, float]] = {}
        self.layers: List[List[str]] = []
        self._node_names: List[str] = []
        self._node_to_idx: Dict[str, int] = {}
        
        self._cpp_config = h_anchor_cpp.PlacementConfig()
        self._sync_config()
        self._cpp_core = h_anchor_cpp.HAnchorCore(self._cpp_config)
    
    def _sync_config(self):
        """Sync Python config to C++ config."""
        c = self._cpp_config
        p = self.py_config
        
        c.num_layers = p.num_layers
        c.top_layer_size = p.top_layer_size
        c.decimation_factor = p.decimation_factor
        c.alpha = p.alpha
        c.beta = p.beta
        c.top_layer_iterations = p.top_layer_iterations
        c.refinement_iterations = p.refinement_iterations
        c.repulsion_strength = p.repulsion_strength
        c.attraction_strength = p.attraction_strength
        c.overlap_repulsion = p.overlap_repulsion
        c.min_spacing = p.min_spacing
        c.center_gravity = p.center_gravity
        c.spread_factor = p.spread_factor
        c.global_attraction = p.global_attraction
        c.die_width = p.die_width
        c.die_height = p.die_height
        c.use_transitive_edges = p.use_transitive_edges
        c.transitive_edge_hops = p.transitive_edge_hops
        c.jitter_scale = p.jitter_scale
        c.anchor_mass_factor = p.anchor_mass_factor
    
    def load_netlist(self, graph, cells: Optional[Dict[str, Cell]] = None):
        """
        Load a netlist graph.
        
        Args:
            graph: NetworkX graph representing the netlist
            cells: Optional dict of Cell objects with properties
        """
        self.graph = graph
        
        # Create default cells if not provided
        if cells:
            self.cells = cells
        else:
            self.cells = {
                node: Cell(id=node) for node in graph.nodes()
            }
        
        # Build node mapping
        self._node_names = list(graph.nodes())
        self._node_to_idx = {name: i for i, name in enumerate(self._node_names)}
        
        # Convert to C++ format
        node_widths = [self.cells[n].width for n in self._node_names]
        node_heights = [self.cells[n].height for n in self._node_names]
        
        edge_from = []
        edge_to = []
        edge_weights = []
        
        for u, v, data in graph.edges(data=True):
            edge_from.append(self._node_to_idx[u])
            edge_to.append(self._node_to_idx[v])
            edge_weights.append(data.get('weight', 1.0))
        
        self._cpp_core.load_graph(
            self._node_names,
            node_widths,
            node_heights,
            edge_from,
            edge_to,
            edge_weights
        )
    
    def add_port(self, port: Port, edge_weight: float = 2.0) -> str:
        """
        Add a port signal to the placement.
        
        Creates a dummy cell for the port and connects it to internal cells.
        The port will be constrained to the boundary of the placement rectangle.
        
        Note: Call this AFTER load_netlist(), then call reload_with_ports() to update.
        
        Args:
            port: Port object defining the port signal
            edge_weight: Weight for edges connecting port to internal cells
            
        Returns:
            Name of the dummy cell created for this port
        """
        port_cell_name = f"__port__{port.name}"
        
        # Create dummy cell for port
        port_cell = Cell(
            id=port_cell_name,
            width=1.0,
            height=1.0,
            is_port=True,
            port_side=port.side,
            port_position=port.position,
            module="__PORT__"
        )
        
        self.cells[port_cell_name] = port_cell
        self.ports[port.name] = port
        
        # Add to graph if it exists
        if self.graph is not None:
            self.graph.add_node(port_cell_name)
            for connected_cell in port.connected_cells:
                if connected_cell in self.graph.nodes():
                    self.graph.add_edge(port_cell_name, connected_cell, weight=edge_weight)
        
        return port_cell_name
    
    def add_ports(self, ports: List[Port], edge_weight: float = 2.0) -> List[str]:
        """Add multiple ports at once."""
        return [self.add_port(p, edge_weight) for p in ports]
    
    def reload_with_ports(self):
        """
        Reload the netlist with ports included.
        
        Call this after adding ports to update the C++ backend.
        """
        if self.graph is None:
            return
        
        # Rebuild node mapping (now includes port cells)
        self._node_names = list(self.graph.nodes())
        self._node_to_idx = {name: i for i, name in enumerate(self._node_names)}
        
        # Convert to C++ format
        node_widths = [self.cells[n].width if n in self.cells else 1.0 for n in self._node_names]
        node_heights = [self.cells[n].height if n in self.cells else 1.0 for n in self._node_names]
        
        edge_from = []
        edge_to = []
        edge_weights = []
        
        for u, v, data in self.graph.edges(data=True):
            edge_from.append(self._node_to_idx[u])
            edge_to.append(self._node_to_idx[v])
            edge_weights.append(data.get('weight', 1.0))
        
        # Reload C++ core
        self._cpp_core = h_anchor_cpp.HAnchorCore(self._cpp_config)
        self._cpp_core.load_graph(
            self._node_names,
            node_widths,
            node_heights,
            edge_from,
            edge_to,
            edge_weights
        )
    
    def _compute_port_position(self, port_cell_name: str) -> Tuple[float, float]:
        """
        Compute the position for a port cell based on its constraints.
        
        For AUTO side ports, determines the best side based on connected cells.
        """
        cell = self.cells[port_cell_name]
        config = self.py_config
        
        # Get connected cells' positions
        connected_positions = []
        if self.graph is not None:
            for neighbor in self.graph.neighbors(port_cell_name):
                if neighbor in self.positions:
                    pos = self.positions[neighbor]
                    if isinstance(pos, np.ndarray):
                        connected_positions.append((pos[0], pos[1]))
                    else:
                        connected_positions.append(pos)
        
        # Default to center if no connections
        if not connected_positions:
            center_x = config.die_width / 2
            center_y = config.die_height / 2
            connected_positions = [(center_x, center_y)]
        
        # Compute centroid of connected cells
        avg_x = np.mean([p[0] for p in connected_positions])
        avg_y = np.mean([p[1] for p in connected_positions])
        
        side = cell.port_side
        position = cell.port_position  # 0.0-1.0 along the side
        
        # Determine side if AUTO
        if side == PortSide.AUTO or side is None:
            # Choose side closest to centroid
            distances = {
                PortSide.LEFT: avg_x,
                PortSide.RIGHT: config.die_width - avg_x,
                PortSide.BOTTOM: avg_y,
                PortSide.TOP: config.die_height - avg_y,
            }
            side = min(distances, key=distances.get)
            cell.port_side = side
        
        # Compute position along the side
        if position is None:
            # Position based on projection of centroid onto the side
            if side in (PortSide.LEFT, PortSide.RIGHT):
                position = avg_y / config.die_height
            else:
                position = avg_x / config.die_width
            position = np.clip(position, 0.05, 0.95)  # Keep away from corners
        
        # Convert to actual coordinates
        if side == PortSide.LEFT:
            return (0.0, position * config.die_height)
        elif side == PortSide.RIGHT:
            return (config.die_width, position * config.die_height)
        elif side == PortSide.BOTTOM:
            return (position * config.die_width, 0.0)
        elif side == PortSide.TOP:
            return (position * config.die_width, config.die_height)
        else:
            return (0.0, position * config.die_height)
    
    def _constrain_ports_to_boundary(self):
        """Constrain all port cells to their designated boundary positions."""
        for port_name, port in self.ports.items():
            port_cell_name = f"__port__{port_name}"
            if port_cell_name in self.cells:
                x, y = self._compute_port_position(port_cell_name)
                self.positions[port_cell_name] = np.array([x, y])
                self.legal_positions[port_cell_name] = (x, y)
                self.cells[port_cell_name].x = x
                self.cells[port_cell_name].y = y
    
    def _clamp_positions_to_boundary(self):
        """Ensure all non-port cells are within the placement rectangle."""
        config = self.py_config
        for name, pos in self.positions.items():
            cell = self.cells.get(name)
            if cell and cell.is_port:
                continue  # Ports handled separately
            
            if isinstance(pos, np.ndarray):
                x, y = pos[0], pos[1]
            else:
                x, y = pos
            
            # Clamp to boundary with margin for cell size
            margin_x = cell.width / 2 if cell else 0.5
            margin_y = cell.height / 2 if cell else 0.5
            
            x = np.clip(x, margin_x, config.die_width - margin_x)
            y = np.clip(y, margin_y, config.die_height - margin_y)
            
            self.positions[name] = np.array([x, y])
            self.legal_positions[name] = (x, y)
            if cell:
                cell.x = x
                cell.y = y
    
    def run(self) -> Dict[str, Tuple[float, float]]:
        """
        Run the complete H-Anchor placement flow.
        
        Returns:
            Dictionary mapping cell IDs to (x, y) positions.
        """
        # Run C++ core
        self._cpp_core.run()
        
        # Get results
        pos_x = self._cpp_core.get_positions_x()
        pos_y = self._cpp_core.get_positions_y()
        
        # Convert to Python format
        self.positions = {}
        self.legal_positions = {}
        
        for i, name in enumerate(self._node_names):
            self.positions[name] = np.array([pos_x[i], pos_y[i]])
            self.legal_positions[name] = (pos_x[i], pos_y[i])
            self.cells[name].x = pos_x[i]
            self.cells[name].y = pos_y[i]
        
        # Get layers
        cpp_layers = self._cpp_core.get_layers()
        self.layers = []
        for layer_indices in cpp_layers:
            layer_names = [self._node_names[i] for i in layer_indices]
            self.layers.append(layer_names)
        
        # Apply boundary constraints
        self._clamp_positions_to_boundary()  # All cells within rectangle
        self._constrain_ports_to_boundary()  # Ports on boundary edges
        
        return self.legal_positions
    
    def compute_wirelength(self, use_legal: bool = True) -> float:
        """Compute total Half-Perimeter Wirelength (HPWL)."""
        return self._cpp_core.get_hpwl()
    
    # =========================================================================
    # Incremental Update API
    # =========================================================================
    
    def update_positions(
        self,
        node_positions: Dict[str, Tuple[float, float]],
        propagation_radius: int = 2
    ) -> float:
        """
        Update positions of specific nodes and propagate changes locally.
        
        This is much faster than re-running full placement when only a few
        anchor cells are moved.
        
        Args:
            node_positions: Dict mapping node names to new (x, y) positions
            propagation_radius: How many hops of neighbors to re-optimize
                               (0 = only moved nodes, 2 = recommended default)
        
        Returns:
            New HPWL after update
            
        Example:
            # Move two cells to new positions
            placer.update_positions({
                'cell_123': (500, 300),
                'cell_456': (600, 400)
            })
        """
        node_indices = []
        new_x = []
        new_y = []
        
        for name, (x, y) in node_positions.items():
            if name in self._node_to_idx:
                node_indices.append(self._node_to_idx[name])
                new_x.append(x)
                new_y.append(y)
        
        if node_indices:
            self._cpp_core.incremental_update_positions(
                node_indices, new_x, new_y, propagation_radius
            )
            self._sync_positions()
            
            # Re-apply boundary constraints for ports
            if self.ports:
                self._constrain_ports_to_boundary()
        
        return self.compute_wirelength()
    
    def add_nodes(
        self,
        new_cells: Dict[str, Cell],
        new_edges: List[Tuple[str, str, float]] = None
    ) -> List[str]:
        """
        Incrementally add new nodes and edges to the placed design.
        
        Args:
            new_cells: Dict mapping new cell names to Cell objects
            new_edges: List of (from_name, to_name, weight) tuples
                       Can reference both existing and new nodes
        
        Returns:
            List of added cell names
            
        Example:
            new_cells = {'new_gate': Cell(id='new_gate')}
            new_edges = [('existing_cell', 'new_gate', 1.0)]
            placer.add_nodes(new_cells, new_edges)
        """
        if not new_cells:
            return []
        
        # Prepare data for C++
        node_names = list(new_cells.keys())
        node_widths = [c.width for c in new_cells.values()]
        node_heights = [c.height for c in new_cells.values()]
        
        # Process edges
        edge_from = []
        edge_to = []
        edge_weights = []
        
        # First, add new nodes to our mapping
        start_idx = len(self._node_names)
        for i, name in enumerate(node_names):
            self._node_to_idx[name] = start_idx + i
        self._node_names.extend(node_names)
        
        if new_edges:
            for from_name, to_name, weight in new_edges:
                if from_name in self._node_to_idx and to_name in self._node_to_idx:
                    edge_from.append(self._node_to_idx[from_name])
                    edge_to.append(self._node_to_idx[to_name])
                    edge_weights.append(weight)
        
        # Add to C++ core
        self._cpp_core.incremental_add_nodes(
            node_names, node_widths, node_heights,
            edge_from, edge_to, edge_weights
        )
        
        # Update local state
        self.cells.update(new_cells)
        self._sync_positions()
        
        return node_names
    
    def remove_nodes(self, node_names: List[str]) -> Dict[str, str]:
        """
        Incrementally remove nodes from the placed design.
        
        Args:
            node_names: List of node names to remove
            
        Returns:
            Dict mapping old node names to new indices (for nodes that remain)
            
        Note:
            Removing high-level anchor nodes will trigger more extensive
            re-optimization than removing low-level nodes.
        """
        node_indices = []
        for name in node_names:
            if name in self._node_to_idx:
                node_indices.append(self._node_to_idx[name])
        
        if not node_indices:
            return {}
        
        # Call C++ removal
        old_to_new = self._cpp_core.incremental_remove_nodes(node_indices)
        
        # Update local state
        for name in node_names:
            if name in self.cells:
                del self.cells[name]
            if name in self.positions:
                del self.positions[name]
            if name in self.legal_positions:
                del self.legal_positions[name]
        
        # Rebuild node mapping
        removed_set = set(node_names)
        new_node_names = [n for n in self._node_names if n not in removed_set]
        self._node_names = new_node_names
        self._node_to_idx = {name: i for i, name in enumerate(new_node_names)}
        
        self._sync_positions()
        
        return {self._node_names[new_idx]: new_idx 
                for old_idx, new_idx in old_to_new.items()
                if new_idx < len(self._node_names)}
    
    def add_edges(self, edges: List[Tuple[str, str, float]]):
        """
        Add edges between existing nodes.
        
        Args:
            edges: List of (from_name, to_name, weight) tuples
        """
        edge_from = []
        edge_to = []
        edge_weights = []
        
        for from_name, to_name, weight in edges:
            if from_name in self._node_to_idx and to_name in self._node_to_idx:
                edge_from.append(self._node_to_idx[from_name])
                edge_to.append(self._node_to_idx[to_name])
                edge_weights.append(weight)
        
        if edge_from:
            self._cpp_core.incremental_add_edges(edge_from, edge_to, edge_weights)
            self._sync_positions()
    
    def remove_edges(self, edges: List[Tuple[str, str]]):
        """
        Remove edges from the design.
        
        Args:
            edges: List of (from_name, to_name) tuples
        """
        edge_from = []
        edge_to = []
        
        for from_name, to_name in edges:
            if from_name in self._node_to_idx and to_name in self._node_to_idx:
                edge_from.append(self._node_to_idx[from_name])
                edge_to.append(self._node_to_idx[to_name])
        
        if edge_from:
            self._cpp_core.incremental_remove_edges(edge_from, edge_to)
            self._sync_positions()
    
    def get_node_layer(self, node_name: str) -> int:
        """
        Get the hierarchy layer of a node.
        
        Returns:
            Layer index (0 = top/most important, higher = lower level)
            Returns -1 if node not found
        """
        if node_name not in self._node_to_idx:
            return -1
        return self._cpp_core.get_node_layer(self._node_to_idx[node_name])
    
    def _sync_positions(self):
        """Sync positions from C++ to Python state."""
        pos_x = self._cpp_core.get_positions_x()
        pos_y = self._cpp_core.get_positions_y()
        
        for i, name in enumerate(self._node_names):
            if i < len(pos_x) and i < len(pos_y):
                self.positions[name] = np.array([pos_x[i], pos_y[i]])
                self.legal_positions[name] = (pos_x[i], pos_y[i])
                if name in self.cells:
                    self.cells[name].x = pos_x[i]
                    self.cells[name].y = pos_y[i]
    
    def get_placement_stats(self) -> str:
        """Return placement quality statistics."""
        wl = self.compute_wirelength()
        placed = len(self.legal_positions)
        total = len(self.cells)
        num_edges = self.graph.number_of_edges() if self.graph else 0
        
        lines = [
            "\nPlacement Statistics (C++ backend):",
            "=" * 40,
            f"  Cells placed: {placed:,} / {total:,}",
            f"  Total HPWL: {wl:,.2f}",
            f"  Avg HPWL per edge: {wl / max(num_edges, 1):,.2f}",
            "=" * 40,
        ]
        return "\n".join(lines)
    
    # Compatibility properties for visualization
    @property
    def config(self):
        return self.py_config


def run_benchmark(benchmark_name: str):
    """Run a benchmark using the C++ backend."""
    from blif_parser import load_blif_benchmark, get_available_benchmarks, print_netlist_stats
    from visualization import PlacementVisualizer
    import os
    import time
    
    benchmarks = get_available_benchmarks()
    
    if benchmark_name not in benchmarks:
        matches = [b for b in benchmarks if benchmark_name in b]
        if len(matches) == 1:
            benchmark_name = matches[0]
        else:
            print(f"Benchmark '{benchmark_name}' not found.")
            return
    
    filepath = benchmarks[benchmark_name]
    
    print(f"\n{'='*60}")
    print(f"  H-Anchor Placement (C++ Backend)")
    print(f"{'='*60}")
    print(f"  Benchmark: {benchmark_name}")
    print(f"{'='*60}\n")
    
    # Load netlist
    print("Loading BLIF netlist...")
    graph, cells, netlist = load_blif_benchmark(filepath)
    print_netlist_stats(netlist, graph)
    
    # Configure based on size
    num_cells = graph.number_of_nodes()
    
    config = PlacementConfig(
        num_layers=6 if num_cells > 5000 else 5,
        top_layer_size=200 if num_cells > 10000 else 100,
        decimation_factor=0.2,
        die_width=3000 if num_cells > 10000 else 1500,
        die_height=3000 if num_cells > 10000 else 1500,
        overlap_repulsion=5.0,
        min_spacing=8.0,
        center_gravity=0.02,
    )
    
    # Run placement
    placer = HAnchorPlacer(config)
    placer.load_netlist(graph, cells)
    
    start = time.time()
    placer.run()
    elapsed = time.time() - start
    
    print(placer.get_placement_stats())
    print(f"\n  Placement time: {elapsed:.2f} seconds")
    print(f"  Throughput: {num_cells / elapsed:.0f} cells/sec")
    
    # Save visualization
    OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    safe_name = benchmark_name.replace("/", "_")
    
    print(f"\nGenerating visualizations...")
    viz = PlacementVisualizer(placer)
    viz.plot_hierarchy_layers(save_path=os.path.join(OUTPUT_DIR, f"{safe_name}_hierarchy.png"))
    viz.plot_placement(save_path=os.path.join(OUTPUT_DIR, f"{safe_name}_placement.png"))
    
    print(f"✓ Saved to {OUTPUT_DIR}/")
    
    return placer


# Aliases for compatibility
HAnchorPlacerFast = HAnchorPlacer


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        run_benchmark(sys.argv[1])
    else:
        print("Usage: python h_anchor_fast.py <benchmark_name>")
        print("Example: python h_anchor_fast.py iscas89/s38417")

