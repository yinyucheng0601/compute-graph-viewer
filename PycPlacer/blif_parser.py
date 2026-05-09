"""
BLIF (Berkeley Logic Interchange Format) Parser for H-Anchor

Parses BLIF netlists and converts them to NetworkX graphs
suitable for placement with the H-Anchor algorithm.

Supports the EPFL benchmark suite and other standard BLIF files.
"""

import networkx as nx
import os
import re
from typing import Dict, List, Tuple, Optional, Set
from dataclasses import dataclass
from pathlib import Path
from h_anchor_fast import Cell


@dataclass
class BlifGate:
    """Represents a gate/cell in the BLIF netlist."""
    name: str
    inputs: List[str]
    output: str
    gate_type: str  # 'AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'BUFFER', 'LATCH', etc.


@dataclass
class BlifLatch:
    """Represents a latch/flip-flop in the BLIF netlist."""
    name: str
    input_signal: str
    output_signal: str
    init_val: str  # '0', '1', or 'x'


@dataclass
class BlifNetlist:
    """Parsed BLIF netlist data."""
    model_name: str
    inputs: List[str]
    outputs: List[str]
    gates: List[BlifGate]
    latches: List[BlifLatch]  # Sequential elements (flip-flops)
    wires: Set[str]  # All internal wire names


def parse_blif(filepath: str) -> BlifNetlist:
    """
    Parse a BLIF file and extract netlist information.
    
    Supports:
    - Combinational gates (.names)
    - Sequential elements (.latch)
    - Standard ISCAS89/IWLS05 format
    
    Args:
        filepath: Path to the BLIF file
        
    Returns:
        BlifNetlist object containing parsed data
    """
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Handle line continuations (backslash at end of line)
    content = content.replace('\\\n', ' ')
    lines = content.split('\n')
    
    model_name = ""
    inputs: List[str] = []
    outputs: List[str] = []
    gates: List[BlifGate] = []
    latches: List[BlifLatch] = []
    wires: Set[str] = set()
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        
        # Skip empty lines and comments
        if not line or line.startswith('#'):
            i += 1
            continue
        
        # Skip directives we don't need
        if line.startswith('.wire_load'):
            i += 1
            continue
        
        # Model name
        if line.startswith('.model'):
            parts = line.split()
            model_name = parts[1] if len(parts) > 1 else "unknown"
            # Clean up model name (remove path if present)
            if '/' in model_name:
                model_name = model_name.split('/')[-1]
            if '.' in model_name:
                model_name = model_name.split('.')[0]
            
        # Primary inputs
        elif line.startswith('.inputs'):
            tokens = line.split()[1:]
            inputs.extend(tokens)
            
        # Primary outputs  
        elif line.startswith('.outputs'):
            tokens = line.split()[1:]
            outputs.extend(tokens)
        
        # Latch (flip-flop) - sequential element
        # Format: .latch input output [type] [init_val]
        elif line.startswith('.latch'):
            tokens = line.split()[1:]
            if len(tokens) >= 2:
                latch_input = tokens[0]
                latch_output = tokens[1]
                init_val = tokens[-1] if len(tokens) > 2 and tokens[-1] in ('0', '1', '2', '3') else '0'
                
                latch = BlifLatch(
                    name=f"FF_{latch_output}",
                    input_signal=latch_input,
                    output_signal=latch_output,
                    init_val=init_val
                )
                latches.append(latch)
                
                wires.add(latch_input)
                wires.add(latch_output)
            
        # Gate definition (.names)
        elif line.startswith('.names'):
            tokens = line.split()[1:]
            if len(tokens) >= 1:
                if len(tokens) == 1:
                    # Constant or buffer
                    gate_inputs = []
                    gate_output = tokens[0]
                else:
                    gate_inputs = tokens[:-1]
                    gate_output = tokens[-1]
                
                # Read truth table to determine gate type
                truth_lines = []
                i += 1
                while i < len(lines):
                    tt_line = lines[i].strip()
                    if tt_line and not tt_line.startswith('.') and not tt_line.startswith('#'):
                        truth_lines.append(tt_line)
                        i += 1
                    else:
                        break
                i -= 1  # Back up to reprocess the non-truth-table line
                
                gate_type = _infer_gate_type(gate_inputs, truth_lines)
                
                gate = BlifGate(
                    name=gate_output,
                    inputs=gate_inputs,
                    output=gate_output,
                    gate_type=gate_type
                )
                gates.append(gate)
                
                # Track wires
                for inp in gate_inputs:
                    wires.add(inp)
                wires.add(gate_output)
        
        # End of model
        elif line.startswith('.end'):
            break
            
        i += 1
    
    return BlifNetlist(
        model_name=model_name,
        inputs=inputs,
        outputs=outputs,
        gates=gates,
        latches=latches,
        wires=wires
    )


def _infer_gate_type(inputs: List[str], truth_lines: List[str]) -> str:
    """
    Infer gate type from truth table.
    
    Common patterns:
    - "1" -> Buffer/Identity
    - "0" -> Inverter (if single input)
    - "11 1" -> AND
    - "00 1" -> NOR
    - "1- 1" and "-1 1" -> OR
    - "01 1" and "10 1" -> XOR
    """
    num_inputs = len(inputs)
    
    if num_inputs == 0:
        return "CONST"
    elif num_inputs == 1:
        if any("1 1" in line for line in truth_lines):
            return "BUFFER"
        elif any("0 1" in line for line in truth_lines):
            return "NOT"
        return "BUFFER"
    elif num_inputs == 2:
        patterns = set()
        for line in truth_lines:
            parts = line.split()
            if len(parts) >= 2:
                patterns.add(parts[0])
        
        if patterns == {"11"}:
            return "AND"
        elif patterns == {"00"}:
            return "NOR"
        elif patterns == {"1-", "-1"} or patterns == {"10", "01", "11"}:
            return "OR"
        elif patterns == {"01", "10"}:
            return "XOR"
        elif patterns == {"00", "01", "10"}:
            return "NAND"
        return "LOGIC2"
    else:
        return f"LOGIC{num_inputs}"


def blif_to_graph(
    netlist: BlifNetlist,
    include_io: bool = True
) -> Tuple[nx.Graph, Dict[str, Cell]]:
    """
    Convert parsed BLIF netlist to NetworkX graph.
    
    Creates a graph where:
    - Nodes represent gates/cells/flip-flops
    - Edges represent wires between elements
    - Edge weights based on fanout and timing criticality
    
    Args:
        netlist: Parsed BlifNetlist
        include_io: Whether to include I/O pads as nodes
        
    Returns:
        Tuple of (graph, cells dict)
    """
    G = nx.Graph()
    cells: Dict[str, Cell] = {}
    
    # Track which signal is produced by which gate/latch
    signal_producer: Dict[str, str] = {}
    
    # Add input pads
    if include_io:
        for inp in netlist.inputs:
            node_name = f"PI_{inp}"
            G.add_node(node_name)
            cells[node_name] = Cell(id=node_name, width=2.0, height=1.0)
            signal_producer[inp] = node_name
    
    # Add latches (flip-flops) - these are important anchor candidates!
    for latch in netlist.latches:
        node_name = latch.name
        G.add_node(node_name)
        # Flip-flops are larger and more important
        cells[node_name] = Cell(id=node_name, width=2.0, height=2.0)
        signal_producer[latch.output_signal] = node_name
    
    # Add gates
    for gate in netlist.gates:
        node_name = f"G_{gate.name}"
        G.add_node(node_name)
        
        # Size based on gate type
        if gate.gate_type in ("AND", "OR", "NAND", "NOR", "XOR"):
            width, height = 1.0, 1.0
        elif gate.gate_type in ("NOT", "BUFFER", "CONST"):
            width, height = 0.5, 1.0
        else:
            width = 1.0 + 0.2 * len(gate.inputs)
            height = 1.0
            
        cells[node_name] = Cell(id=node_name, width=width, height=height)
        signal_producer[gate.output] = node_name
    
    # Add output pads
    if include_io:
        for out in netlist.outputs:
            node_name = f"PO_{out}"
            G.add_node(node_name)
            cells[node_name] = Cell(id=node_name, width=2.0, height=1.0)
    
    # Create edges from gates
    for gate in netlist.gates:
        gate_node = f"G_{gate.name}"
        
        # Connect from input sources
        for inp in gate.inputs:
            if inp in signal_producer:
                source = signal_producer[inp]
                if not G.has_edge(source, gate_node):
                    G.add_edge(source, gate_node, weight=1.0)
                else:
                    G[source][gate_node]['weight'] += 0.5
    
    # Create edges from latches (flip-flop inputs)
    for latch in netlist.latches:
        latch_node = latch.name
        inp = latch.input_signal
        
        if inp in signal_producer:
            source = signal_producer[inp]
            if not G.has_edge(source, latch_node):
                # Higher weight for flip-flop connections (timing critical)
                G.add_edge(source, latch_node, weight=2.0)
            else:
                G[source][latch_node]['weight'] += 1.0
    
    # Connect gates to output pads
    if include_io:
        for out in netlist.outputs:
            if out in signal_producer:
                source = signal_producer[out]
                out_node = f"PO_{out}"
                if not G.has_edge(source, out_node):
                    G.add_edge(source, out_node, weight=2.0)  # Higher weight for outputs
    
    return G, cells


def load_blif_benchmark(
    filepath: str,
    include_io: bool = True
) -> Tuple[nx.Graph, Dict[str, Cell], BlifNetlist]:
    """
    Load a BLIF benchmark file and convert to graph.
    
    Args:
        filepath: Path to BLIF file
        include_io: Include I/O pads as nodes
        
    Returns:
        Tuple of (graph, cells, netlist)
    """
    netlist = parse_blif(filepath)
    graph, cells = blif_to_graph(netlist, include_io)
    
    return graph, cells, netlist


def get_available_benchmarks(benchmark_dir: str = None) -> Dict[str, str]:
    """
    List available BLIF benchmarks.
    
    Args:
        benchmark_dir: Directory containing benchmarks
        
    Returns:
        Dict mapping benchmark name to file path
    """
    benchmarks = {}
    base_dir = os.path.dirname(__file__)
    
    # EPFL benchmarks
    epfl_dir = os.path.join(base_dir, "benchmarks_data", "epfl_benchmarks")
    for subdir in ["arithmetic", "random_control"]:
        subdir_path = os.path.join(epfl_dir, subdir)
        if os.path.exists(subdir_path):
            for f in os.listdir(subdir_path):
                if f.endswith('.blif'):
                    name = os.path.splitext(f)[0]
                    benchmarks[f"epfl/{subdir}/{name}"] = os.path.join(subdir_path, f)
    
    # ISCAS/IWLS benchmarks (CPU-scale circuits)
    hdl_dir = os.path.join(base_dir, "benchmarks_data", "hdl_benchmarks")
    
    # IWLS05 ISCAS BLIF files
    iwls_iscas = os.path.join(hdl_dir, "iwls05", "iscas", "blif")
    if os.path.exists(iwls_iscas):
        for f in os.listdir(iwls_iscas):
            if f.endswith('.blif'):
                name = os.path.splitext(f)[0]
                benchmarks[f"iscas89/{name}"] = os.path.join(iwls_iscas, f)
    
    # LGSynth91 BLIF files
    lgsynth_dir = os.path.join(hdl_dir, "lgsynth91", "blif")
    if os.path.exists(lgsynth_dir):
        for f in os.listdir(lgsynth_dir):
            if f.endswith('.blif'):
                name = os.path.splitext(f)[0]
                benchmarks[f"lgsynth91/{name}"] = os.path.join(lgsynth_dir, f)
    
    # MCNC benchmarks (blif files are in Combinational/blif/)
    mcnc_comb = os.path.join(hdl_dir, "mcnc", "Combinational", "blif")
    if os.path.exists(mcnc_comb):
        for f in os.listdir(mcnc_comb):
            if f.endswith('.blif'):
                name = os.path.splitext(f)[0]
                benchmarks[f"mcnc/{name}"] = os.path.join(mcnc_comb, f)
    
    return benchmarks


def print_netlist_stats(netlist: BlifNetlist, graph: nx.Graph):
    """Print statistics about a parsed netlist."""
    print(f"\n{'='*50}")
    print(f"  Netlist: {netlist.model_name}")
    print(f"{'='*50}")
    print(f"  Primary Inputs:  {len(netlist.inputs):,}")
    print(f"  Primary Outputs: {len(netlist.outputs):,}")
    print(f"  Gates:           {len(netlist.gates):,}")
    print(f"  Flip-Flops:      {len(netlist.latches):,}")
    print(f"  Total Nodes:     {graph.number_of_nodes():,}")
    print(f"  Total Edges:     {graph.number_of_edges():,}")
    
    # Gate type breakdown
    gate_types: Dict[str, int] = {}
    for gate in netlist.gates:
        gate_types[gate.gate_type] = gate_types.get(gate.gate_type, 0) + 1
    
    if gate_types:
        print(f"\n  Gate Types:")
        for gtype, count in sorted(gate_types.items(), key=lambda x: -x[1])[:10]:
            print(f"    {gtype}: {count:,}")
    
    print(f"{'='*50}\n")


# Quick test
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        filepath = sys.argv[1]
    else:
        # Try to use a default benchmark
        benchmarks = get_available_benchmarks()
        if benchmarks:
            # Use i2c as default (medium size)
            filepath = benchmarks.get("random_control/i2c") or list(benchmarks.values())[0]
            print(f"Using default benchmark: {filepath}")
        else:
            print("No benchmarks found. Please provide a BLIF file path.")
            sys.exit(1)
    
    graph, cells, netlist = load_blif_benchmark(filepath)
    print_netlist_stats(netlist, graph)

