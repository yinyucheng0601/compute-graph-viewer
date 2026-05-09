"""
Synthetic benchmark generators for H-Anchor testing.

Provides various netlist patterns to test the algorithm:
- Random graphs
- Hierarchical/clustered graphs
- Mesh/grid topologies
- Realistic circuit-like structures
"""

import networkx as nx
import numpy as np
from typing import Tuple, Optional, Dict
from h_anchor_fast import Cell


def generate_random_netlist(
    num_cells: int = 1000,
    num_edges: int = 3000,
    seed: Optional[int] = None
) -> Tuple[nx.Graph, Dict[str, Cell]]:
    """
    Generate a random Erdos-Renyi style netlist.
    
    Args:
        num_cells: Number of cells in the netlist
        num_edges: Target number of edges
        seed: Random seed for reproducibility
        
    Returns:
        Tuple of (graph, cells dict)
    """
    if seed is not None:
        np.random.seed(seed)
        
    # Create random graph
    p = 2 * num_edges / (num_cells * (num_cells - 1))
    G = nx.gnp_random_graph(num_cells, p, seed=seed)
    
    # Rename nodes to strings
    mapping = {i: f"cell_{i}" for i in range(num_cells)}
    G = nx.relabel_nodes(G, mapping)
    
    # Add random edge weights
    for u, v in G.edges():
        G[u][v]['weight'] = np.random.uniform(0.5, 2.0)
        
    # Create cell objects
    cells = {name: Cell(id=name) for name in G.nodes()}
    
    return G, cells


def generate_clustered_netlist(
    num_clusters: int = 10,
    cells_per_cluster: int = 100,
    intra_cluster_density: float = 0.3,
    inter_cluster_density: float = 0.01,
    seed: Optional[int] = None
) -> Tuple[nx.Graph, Dict[str, Cell]]:
    """
    Generate a hierarchically clustered netlist.
    
    Simulates a circuit with functional blocks where
    cells within a block are densely connected, but
    blocks have sparse inter-connections.
    
    Args:
        num_clusters: Number of functional blocks
        cells_per_cluster: Cells per block
        intra_cluster_density: Edge probability within clusters
        inter_cluster_density: Edge probability between clusters
        seed: Random seed
        
    Returns:
        Tuple of (graph, cells dict)
    """
    if seed is not None:
        np.random.seed(seed)
        
    G = nx.Graph()
    
    # Create clusters
    for c in range(num_clusters):
        cluster_nodes = [f"c{c}_cell_{i}" for i in range(cells_per_cluster)]
        G.add_nodes_from(cluster_nodes)
        
        # Intra-cluster edges
        for i, u in enumerate(cluster_nodes):
            for j, v in enumerate(cluster_nodes):
                if i < j and np.random.random() < intra_cluster_density:
                    G.add_edge(u, v, weight=np.random.uniform(1.0, 3.0))
                    
    # Inter-cluster edges (between cluster "ports")
    cluster_ports = []
    for c in range(num_clusters):
        # Select a few nodes as "ports" connecting to other clusters
        cluster_nodes = [n for n in G.nodes() if n.startswith(f"c{c}_")]
        num_ports = max(1, len(cluster_nodes) // 10)
        ports = np.random.choice(cluster_nodes, num_ports, replace=False)
        cluster_ports.append(list(ports))
        
    # Connect ports between clusters
    for i in range(num_clusters):
        for j in range(i + 1, num_clusters):
            for port_i in cluster_ports[i]:
                for port_j in cluster_ports[j]:
                    if np.random.random() < inter_cluster_density:
                        G.add_edge(port_i, port_j, weight=np.random.uniform(0.5, 1.5))
                        
    cells = {name: Cell(id=name) for name in G.nodes()}
    
    return G, cells


def generate_mesh_netlist(
    rows: int = 30,
    cols: int = 30,
    diagonal_connections: bool = False,
    seed: Optional[int] = None
) -> Tuple[nx.Graph, Dict[str, Cell]]:
    """
    Generate a 2D mesh/grid topology.
    
    Common in systolic arrays, NoC, and regular datapath designs.
    
    Args:
        rows: Number of rows in the mesh
        cols: Number of columns
        diagonal_connections: Include diagonal neighbors
        seed: Random seed
        
    Returns:
        Tuple of (graph, cells dict)
    """
    if seed is not None:
        np.random.seed(seed)
        
    G = nx.Graph()
    
    # Create grid nodes
    for r in range(rows):
        for c in range(cols):
            node_name = f"mesh_{r}_{c}"
            G.add_node(node_name)
            
    # Connect neighbors
    for r in range(rows):
        for c in range(cols):
            node = f"mesh_{r}_{c}"
            
            # Right neighbor
            if c + 1 < cols:
                neighbor = f"mesh_{r}_{c+1}"
                G.add_edge(node, neighbor, weight=1.0)
                
            # Bottom neighbor
            if r + 1 < rows:
                neighbor = f"mesh_{r+1}_{c}"
                G.add_edge(node, neighbor, weight=1.0)
                
            if diagonal_connections:
                # Bottom-right
                if r + 1 < rows and c + 1 < cols:
                    neighbor = f"mesh_{r+1}_{c+1}"
                    G.add_edge(node, neighbor, weight=0.7)
                    
                # Bottom-left
                if r + 1 < rows and c - 1 >= 0:
                    neighbor = f"mesh_{r+1}_{c-1}"
                    G.add_edge(node, neighbor, weight=0.7)
                    
    cells = {name: Cell(id=name) for name in G.nodes()}
    
    return G, cells


def generate_datapath_netlist(
    num_stages: int = 8,
    width: int = 32,
    feedback_ratio: float = 0.1,
    seed: Optional[int] = None
) -> Tuple[nx.Graph, Dict[str, Cell]]:
    """
    Generate a datapath-like netlist.
    
    Simulates a pipelined datapath with:
    - Forward connections between stages
    - Parallel bit-slices within each stage
    - Some feedback paths
    
    Args:
        num_stages: Number of pipeline stages
        width: Bit width of the datapath
        feedback_ratio: Fraction of feedback edges
        seed: Random seed
        
    Returns:
        Tuple of (graph, cells dict)
    """
    if seed is not None:
        np.random.seed(seed)
        
    G = nx.Graph()
    
    # Create stage nodes
    for stage in range(num_stages):
        for bit in range(width):
            node = f"stage{stage}_bit{bit}"
            G.add_node(node)
            
    # Forward connections (stage to stage)
    for stage in range(num_stages - 1):
        for bit in range(width):
            current = f"stage{stage}_bit{bit}"
            next_node = f"stage{stage+1}_bit{bit}"
            G.add_edge(current, next_node, weight=2.0)
            
            # Some cross-bit connections (like carry chains)
            if bit + 1 < width and np.random.random() < 0.3:
                next_cross = f"stage{stage+1}_bit{bit+1}"
                G.add_edge(current, next_cross, weight=1.5)
                
    # Intra-stage connections (like mux/logic sharing)
    for stage in range(num_stages):
        for bit in range(width - 1):
            current = f"stage{stage}_bit{bit}"
            neighbor = f"stage{stage}_bit{bit+1}"
            if np.random.random() < 0.2:
                G.add_edge(current, neighbor, weight=1.0)
                
    # Feedback connections
    num_feedback = int(num_stages * width * feedback_ratio)
    for _ in range(num_feedback):
        src_stage = np.random.randint(1, num_stages)
        dst_stage = np.random.randint(0, src_stage)
        bit = np.random.randint(0, width)
        
        src = f"stage{src_stage}_bit{bit}"
        dst = f"stage{dst_stage}_bit{bit}"
        
        if not G.has_edge(src, dst):
            G.add_edge(src, dst, weight=0.8)
            
    cells = {name: Cell(id=name) for name in G.nodes()}
    
    return G, cells


def generate_heterogeneous_netlist(
    num_standard_cells: int = 800,
    num_rams: int = 20,
    num_dsps: int = 30,
    num_ios: int = 100,
    seed: Optional[int] = None
) -> Tuple[nx.Graph, Dict[str, Cell]]:
    """
    Generate a heterogeneous netlist mimicking FPGA/ASIC designs.
    
    Includes:
    - Standard cells (logic gates)
    - RAM blocks (memory)
    - DSP blocks (computation)
    - I/O cells
    
    RAMs, DSPs, and IOs naturally act as "anchors" in the hierarchy.
    
    Args:
        num_standard_cells: Number of standard logic cells
        num_rams: Number of RAM blocks
        num_dsps: Number of DSP blocks  
        num_ios: Number of I/O pads
        seed: Random seed
        
    Returns:
        Tuple of (graph, cells dict)
    """
    if seed is not None:
        np.random.seed(seed)
        
    G = nx.Graph()
    cells = {}
    
    # Create different cell types
    standard_cells = [f"std_{i}" for i in range(num_standard_cells)]
    ram_cells = [f"ram_{i}" for i in range(num_rams)]
    dsp_cells = [f"dsp_{i}" for i in range(num_dsps)]
    io_cells = [f"io_{i}" for i in range(num_ios)]
    
    all_cells = standard_cells + ram_cells + dsp_cells + io_cells
    G.add_nodes_from(all_cells)
    
    # Create cell objects with different sizes
    for name in standard_cells:
        cells[name] = Cell(id=name, width=1.0, height=1.0)
        
    for name in ram_cells:
        cells[name] = Cell(id=name, width=8.0, height=4.0)
        
    for name in dsp_cells:
        cells[name] = Cell(id=name, width=4.0, height=4.0)
        
    for name in io_cells:
        cells[name] = Cell(id=name, width=2.0, height=1.0)
        
    # Connect standard cells among themselves
    num_std_edges = num_standard_cells * 3
    for _ in range(num_std_edges):
        u = np.random.choice(standard_cells)
        v = np.random.choice(standard_cells)
        if u != v and not G.has_edge(u, v):
            G.add_edge(u, v, weight=1.0)
            
    # Connect RAMs to standard cells (each RAM connects to many cells)
    for ram in ram_cells:
        num_connections = np.random.randint(20, 50)
        connected_cells = np.random.choice(standard_cells, num_connections, replace=False)
        for cell in connected_cells:
            G.add_edge(ram, cell, weight=2.0)
            
    # Connect DSPs to standard cells
    for dsp in dsp_cells:
        num_connections = np.random.randint(10, 30)
        connected_cells = np.random.choice(standard_cells, num_connections, replace=False)
        for cell in connected_cells:
            G.add_edge(dsp, cell, weight=2.0)
            
    # Connect IOs to various cells
    for io in io_cells:
        # IOs connect to few cells but with high weight (timing critical)
        num_connections = np.random.randint(2, 8)
        all_internal = standard_cells + ram_cells + dsp_cells
        connected_cells = np.random.choice(all_internal, min(num_connections, len(all_internal)), replace=False)
        for cell in connected_cells:
            G.add_edge(io, cell, weight=3.0)
            
    return G, cells


def generate_small_world_netlist(
    num_cells: int = 1000,
    k: int = 6,
    p: float = 0.1,
    seed: Optional[int] = None
) -> Tuple[nx.Graph, Dict[str, Cell]]:
    """
    Generate a small-world netlist (Watts-Strogatz model).
    
    Has high clustering coefficient with short path lengths,
    similar to many real-world circuits.
    
    Args:
        num_cells: Number of cells
        k: Each node connects to k nearest neighbors in ring
        p: Probability of rewiring each edge
        seed: Random seed
        
    Returns:
        Tuple of (graph, cells dict)
    """
    G = nx.watts_strogatz_graph(num_cells, k, p, seed=seed)
    
    # Rename nodes
    mapping = {i: f"sw_cell_{i}" for i in range(num_cells)}
    G = nx.relabel_nodes(G, mapping)
    
    # Add weights
    for u, v in G.edges():
        G[u][v]['weight'] = np.random.uniform(0.5, 2.0)
        
    cells = {name: Cell(id=name) for name in G.nodes()}
    
    return G, cells


def generate_large_cpu_design(
    seed: Optional[int] = None
) -> Tuple[nx.Graph, Dict[str, Cell]]:
    """
    Generate a large CPU-like design by merging multiple functional modules.
    
    This simulates a flattened hierarchical design where each cell retains
    a label indicating which original module it came from. This allows
    visualization of module boundaries after placement.
    
    Modules included:
    - ALU (Arithmetic Logic Unit)
    - Register File
    - Control Unit
    - Instruction Decoder
    - Memory Controller
    - Cache Controller
    - Branch Predictor
    - Pipeline Registers
    
    Args:
        seed: Random seed for reproducibility
        
    Returns:
        Tuple of (graph, cells dict) where each cell has a module label
    """
    if seed is not None:
        np.random.seed(seed)
        
    G = nx.Graph()
    cells: Dict[str, Cell] = {}
    
    # Module definitions: (name, num_cells, internal_density, cell_size)
    # Note: Keep internal density low (0.02-0.05) to avoid overly dense graphs
    # that cause poor layer construction and cluster separation
    modules = [
        ("ALU", 500, 0.03, (1.0, 1.0)),
        ("RegFile", 400, 0.04, (1.5, 1.0)),
        ("Control", 300, 0.03, (1.0, 1.0)),
        ("Decoder", 250, 0.04, (1.0, 1.0)),
        ("MemCtrl", 350, 0.03, (1.2, 1.0)),
        ("CacheCtrl", 300, 0.035, (1.2, 1.0)),
        ("BranchPred", 200, 0.04, (1.0, 1.0)),
        ("Pipeline", 400, 0.025, (0.8, 1.0)),
        ("Datapath", 450, 0.03, (1.0, 1.0)),
        ("IOCtrl", 150, 0.035, (1.5, 1.0)),
    ]
    
    # Track module boundaries for inter-module connections
    module_cells: Dict[str, list] = {}
    module_ports: Dict[str, list] = {}  # "Port" cells for inter-module wiring
    
    # Create cells for each module
    for module_name, num_cells, density, (width, height) in modules:
        module_cell_names = []
        
        for i in range(num_cells):
            cell_name = f"{module_name}_cell_{i}"
            G.add_node(cell_name)
            cells[cell_name] = Cell(
                id=cell_name,
                width=width,
                height=height,
                module=module_name  # Track module origin
            )
            module_cell_names.append(cell_name)
        
        module_cells[module_name] = module_cell_names
        
        # Create intra-module edges (internal connectivity)
        for i, u in enumerate(module_cell_names):
            for j, v in enumerate(module_cell_names):
                if i < j and np.random.random() < density:
                    weight = np.random.uniform(1.0, 3.0)
                    G.add_edge(u, v, weight=weight)
        
        # Select port cells (10% of module cells) for inter-module connections
        num_ports = max(5, num_cells // 10)
        port_indices = np.random.choice(len(module_cell_names), num_ports, replace=False)
        module_ports[module_name] = [module_cell_names[i] for i in port_indices]
    
    # Define inter-module connections (architecture-aware)
    # Increased connection counts to ensure modules are well-connected
    inter_module_connections = [
        # (src_module, dst_module, num_connections, weight_range)
        ("Decoder", "Control", 60, (2.0, 4.0)),      # Decoder feeds control
        ("Control", "ALU", 50, (2.0, 3.5)),          # Control signals to ALU
        ("Control", "RegFile", 45, (2.0, 3.5)),     # Control signals to regs
        ("Control", "MemCtrl", 40, (2.0, 3.0)),     # Memory control
        ("Control", "Datapath", 35, (2.0, 3.0)),   # Control to datapath
        ("Control", "Pipeline", 40, (2.0, 3.0)),   # Control to pipeline
        ("RegFile", "ALU", 80, (3.0, 5.0)),         # Operands to ALU (critical)
        ("ALU", "RegFile", 70, (3.0, 5.0)),         # Results back to regs
        ("ALU", "Datapath", 60, (2.5, 4.0)),        # ALU to datapath
        ("Datapath", "RegFile", 55, (2.5, 4.0)),   # Datapath to regs
        ("MemCtrl", "CacheCtrl", 70, (3.0, 5.0)),  # Memory hierarchy
        ("CacheCtrl", "Datapath", 50, (2.5, 4.0)), # Cache to datapath
        ("CacheCtrl", "RegFile", 30, (2.5, 3.5)), # Cache to regs
        ("BranchPred", "Control", 40, (2.0, 3.5)), # Branch prediction
        ("BranchPred", "Decoder", 35, (2.0, 3.0)), # PC control
        ("BranchPred", "Pipeline", 25, (2.0, 3.0)), # Branch to pipeline
        ("Pipeline", "ALU", 50, (2.0, 3.5)),       # Pipeline regs
        ("Pipeline", "RegFile", 45, (2.0, 3.5)),  # Pipeline regs
        ("Pipeline", "Decoder", 40, (2.0, 3.0)),  # Pipeline regs
        ("Pipeline", "Datapath", 55, (2.5, 4.0)), # Pipeline regs
        ("IOCtrl", "MemCtrl", 35, (2.0, 3.5)),    # I/O to memory
        ("IOCtrl", "Control", 30, (2.0, 3.0)),    # I/O control
        ("IOCtrl", "Datapath", 25, (2.0, 3.0)),   # I/O to datapath
        ("Datapath", "MemCtrl", 50, (2.5, 4.0)),  # Load/Store
        ("Decoder", "Pipeline", 35, (2.0, 3.0)),  # Instruction flow
        ("ALU", "Pipeline", 40, (2.0, 3.5)),      # ALU to pipeline
    ]
    
    # Create inter-module edges
    for src_mod, dst_mod, num_conn, (wmin, wmax) in inter_module_connections:
        src_ports = module_ports[src_mod]
        dst_ports = module_ports[dst_mod]
        
        for _ in range(num_conn):
            src_cell = np.random.choice(src_ports)
            dst_cell = np.random.choice(dst_ports)
            weight = np.random.uniform(wmin, wmax)
            
            if G.has_edge(src_cell, dst_cell):
                G[src_cell][dst_cell]['weight'] += weight * 0.5
            else:
                G.add_edge(src_cell, dst_cell, weight=weight)
    
    # Add some random long-distance connections (global signals like clock, reset)
    all_cells = list(G.nodes())
    num_global = len(all_cells) // 50  # 2% global connections
    
    for _ in range(num_global):
        u = np.random.choice(all_cells)
        v = np.random.choice(all_cells)
        if u != v and not G.has_edge(u, v):
            G.add_edge(u, v, weight=np.random.uniform(0.5, 1.5))
    
    return G, cells


def hypergraph_to_graph(
    hyperedges: Dict[str, list],
    cells: list,
    model: str = "clique"
) -> nx.Graph:
    """
    Convert a hypergraph (netlist with multi-pin nets) to a graph.
    
    Args:
        hyperedges: Dict mapping net names to lists of cell names
        cells: List of all cell names
        model: Conversion model - "clique" or "star"
        
    Returns:
        NetworkX graph
    """
    G = nx.Graph()
    G.add_nodes_from(cells)
    
    for net_name, net_cells in hyperedges.items():
        if len(net_cells) < 2:
            continue
            
        if model == "clique":
            # Clique model: connect all pairs
            # Weight inversely proportional to net size
            weight = 1.0 / (len(net_cells) - 1)
            for i, u in enumerate(net_cells):
                for v in net_cells[i+1:]:
                    if G.has_edge(u, v):
                        G[u][v]['weight'] += weight
                    else:
                        G.add_edge(u, v, weight=weight)
                        
        elif model == "star":
            # Star model: create virtual net node
            star_center = f"_net_{net_name}"
            G.add_node(star_center)
            for cell in net_cells:
                G.add_edge(star_center, cell, weight=1.0)
                
    return G

