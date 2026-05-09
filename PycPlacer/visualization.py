"""
Visualization utilities for H-Anchor placement algorithm.

Provides interactive visualization of:
- Hierarchy layers
- Placement progression
- Final placement results
- Wirelength analysis
"""

import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.collections import LineCollection
from matplotlib.colors import LinearSegmentedColormap
import numpy as np
import networkx as nx
from typing import Dict, List, Optional, Tuple, Set
from h_anchor_fast import HAnchorPlacer, PlacementConfig


# Custom color scheme inspired by Monokai
COLORS = {
    'background': '#272822',
    'grid': '#3E3D32',
    'text': '#F8F8F2',
    'anchor_top': '#F92672',      # Pink/Magenta
    'anchor_mid': '#FD971F',      # Orange
    'anchor_low': '#A6E22E',      # Green
    'cell_normal': '#66D9EF',     # Cyan
    'edge': '#75715E',            # Gray
    'edge_critical': '#F92672',   # Pink
}

# Extended color palette for more layers
LAYER_COLORS = [
    '#F92672',  # Pink/Magenta - Layer 0 (TOP)
    '#FD971F',  # Orange - Layer 1
    '#A6E22E',  # Green - Layer 2
    '#66D9EF',  # Cyan - Layer 3
    '#AE81FF',  # Purple - Layer 4
    '#E6DB74',  # Yellow - Layer 5
    '#9effff',  # Light Cyan - Layer 6
    '#ff6188',  # Coral - Layer 7+
]

# Edge colors based on layer connections
EDGE_LAYER_COLORS = [
    '#F92672AA',  # Pink with alpha
    '#FD971FAA',  # Orange with alpha
    '#A6E22EAA',  # Green with alpha
    '#66D9EFAA',  # Cyan with alpha
    '#AE81FFAA',  # Purple with alpha
    '#E6DB74AA',  # Yellow with alpha
]

# Module colors for hierarchical origin visualization (20 distinct colors)
MODULE_COLORS = [
    '#F92672',  # Pink/Magenta
    '#FD971F',  # Orange
    '#A6E22E',  # Green
    '#66D9EF',  # Cyan
    '#AE81FF',  # Purple
    '#E6DB74',  # Yellow
    '#FF6B6B',  # Coral Red
    '#4ECDC4',  # Teal
    '#45B7D1',  # Sky Blue
    '#96CEB4',  # Sage Green
    '#FFEAA7',  # Pale Yellow
    '#DDA0DD',  # Plum
    '#98D8C8',  # Mint
    '#F7DC6F',  # Gold
    '#BB8FCE',  # Light Purple
    '#85C1E9',  # Light Blue
    '#F8B500',  # Amber
    '#00CED1',  # Dark Turquoise
    '#FF69B4',  # Hot Pink
    '#32CD32',  # Lime Green
]

# Port color - distinct color for boundary port signals
PORT_COLOR = '#FF4500'  # Orange-Red for ports


class PlacementVisualizer:
    """Visualizer for H-Anchor placement results."""
    
    def __init__(self, placer: HAnchorPlacer):
        self.placer = placer
        self.fig = None
        self.axes = None
        
    def setup_style(self, ax):
        """Apply custom styling to axes."""
        ax.set_facecolor(COLORS['background'])
        ax.tick_params(colors=COLORS['text'])
        ax.xaxis.label.set_color(COLORS['text'])
        ax.yaxis.label.set_color(COLORS['text'])
        ax.title.set_color(COLORS['text'])
        for spine in ax.spines.values():
            spine.set_color(COLORS['grid'])
        ax.grid(False)  # 关闭网格线
            
    def plot_hierarchy_layers(self, save_path: Optional[str] = None):
        """
        Visualize the hierarchy layers.
        
        Shows how anchors are distributed across layers,
        with higher layers having fewer, more important nodes.
        """
        if not self.placer.layers:
            raise ValueError("No hierarchy to visualize.")
            
        num_layers = len(self.placer.layers)
        fig, axes = plt.subplots(1, num_layers, figsize=(4 * num_layers, 4))
        fig.patch.set_facecolor(COLORS['background'])
        
        if num_layers == 1:
            axes = [axes]
            
        # Get positions for visualization
        positions = self.placer.positions
        if not positions:
            # Use spring layout if no positions yet
            positions = nx.spring_layout(self.placer.graph, seed=42)
            
        # Color gradient for layers
        layer_colors = [
            COLORS['anchor_top'],
            COLORS['anchor_mid'],
            COLORS['anchor_low'],
            COLORS['cell_normal'],
        ]
        
        for i, (ax, layer) in enumerate(zip(axes, self.placer.layers)):
            self.setup_style(ax)
            
            layer_set = set(layer)
            subgraph = self.placer.graph.subgraph(layer)
            
            # Get node positions
            pos = {n: positions[n] for n in layer if n in positions}
            
            if not pos:
                pos = nx.spring_layout(subgraph, seed=42)
            
            # Draw edges
            edge_positions = []
            for u, v in subgraph.edges():
                if u in pos and v in pos:
                    edge_positions.append([pos[u], pos[v]])
                    
            if edge_positions:
                edge_collection = LineCollection(
                    edge_positions,
                    colors=COLORS['edge'],
                    alpha=0.3,
                    linewidths=0.5
                )
                ax.add_collection(edge_collection)
            
            # Draw nodes
            color_idx = min(i, len(layer_colors) - 1)
            node_color = layer_colors[color_idx]
            
            x = [pos[n][0] for n in layer if n in pos]
            y = [pos[n][1] for n in layer if n in pos]
            
            size = 100 if i == 0 else 50 - i * 10
            size = max(size, 5)
            
            ax.scatter(x, y, c=node_color, s=size, alpha=0.8, edgecolors='white', linewidths=0.5)
            
            layer_label = "TOP" if i == 0 else f"Layer {i}"
            ax.set_title(f"{layer_label}\n{len(layer):,} nodes", fontsize=10)
            ax.set_aspect('equal')
            ax.axis('off')
            
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=150, facecolor=COLORS['background'], bbox_inches='tight')
            plt.close(fig)
        else:
            plt.show()
        
    def plot_placement(
        self,
        use_legal: bool = True,
        show_edges: bool = True,
        highlight_layer: Optional[int] = None,
        save_path: Optional[str] = None
    ):
        """
        Visualize the final placement.
        
        Args:
            use_legal: Use legalized positions (True) or analytical (False)
            show_edges: Draw edges between connected cells
            highlight_layer: Highlight cells from a specific layer
            save_path: Optional path to save the figure
        """
        positions = self.placer.legal_positions if use_legal else self.placer.positions
        
        if not positions:
            raise ValueError("No placement to visualize.")
            
        fig, ax = plt.subplots(1, 1, figsize=(12, 10))
        fig.patch.set_facecolor(COLORS['background'])
        self.setup_style(ax)
        
        config = self.placer.config
        
        # Draw die boundary
        die_rect = patches.Rectangle(
            (0, 0),
            config.die_width,
            config.die_height,
            linewidth=2,
            edgecolor=COLORS['text'],
            facecolor='none'
        )
        ax.add_patch(die_rect)
        
        # Draw placement rows (grid lines)
        num_rows = int(config.die_height / config.row_height)
        for i in range(1, num_rows):
            y = i * config.row_height
            ax.axhline(y=y, color=COLORS['grid'], linewidth=0.3, alpha=0.5)
            
        # Draw edges first (behind nodes)
        if show_edges:
            edge_positions = []
            edge_colors = []
            
            for u, v in self.placer.graph.edges():
                if u in positions and v in positions:
                    pos_u = positions[u]
                    pos_v = positions[v]
                    
                    if isinstance(pos_u, np.ndarray):
                        pos_u = tuple(pos_u)
                    if isinstance(pos_v, np.ndarray):
                        pos_v = tuple(pos_v)
                        
                    edge_positions.append([pos_u, pos_v])
                    
                    # Color critical (long) edges differently
                    length = abs(pos_u[0] - pos_v[0]) + abs(pos_u[1] - pos_v[1])
                    if length > config.die_width * 0.3:
                        edge_colors.append(COLORS['edge_critical'])
                    else:
                        edge_colors.append(COLORS['edge'])
                        
            if edge_positions:
                edge_collection = LineCollection(
                    edge_positions,
                    colors=edge_colors,
                    alpha=0.2,
                    linewidths=0.3
                )
                ax.add_collection(edge_collection)
        
        # Categorize nodes by layer
        layer_membership = {}
        for layer_idx, layer in enumerate(self.placer.layers):
            for node in layer:
                if node not in layer_membership:
                    layer_membership[node] = layer_idx
                    
        # Draw nodes
        for layer_idx in range(len(self.placer.layers) - 1, -1, -1):
            layer_nodes = [n for n, l in layer_membership.items() if l == layer_idx]
            
            x = []
            y = []
            for n in layer_nodes:
                if n in positions:
                    pos = positions[n]
                    if isinstance(pos, np.ndarray):
                        x.append(pos[0])
                        y.append(pos[1])
                    else:
                        x.append(pos[0])
                        y.append(pos[1])
                        
            if not x:
                continue
                
            # Determine color and size based on layer
            if layer_idx == 0:
                color = COLORS['anchor_top']
                size = 50
                alpha = 1.0
            elif layer_idx == 1:
                color = COLORS['anchor_mid']
                size = 30
                alpha = 0.9
            elif layer_idx == 2:
                color = COLORS['anchor_low']
                size = 20
                alpha = 0.8
            else:
                color = COLORS['cell_normal']
                size = 10
                alpha = 0.6
                
            # Highlight specific layer if requested
            if highlight_layer is not None and layer_idx != highlight_layer:
                alpha = 0.1
                
            ax.scatter(
                x, y,
                c=color,
                s=size,
                alpha=alpha,
                edgecolors='white' if layer_idx <= 1 else 'none',
                linewidths=0.5,
                label=f"Layer {layer_idx}" if layer_idx < 4 else None
            )
        
        # Draw port cells on boundary (with distinct color and marker)
        port_x, port_y = [], []
        for name, cell in self.placer.cells.items():
            if hasattr(cell, 'is_port') and cell.is_port and name in positions:
                pos = positions[name]
                if isinstance(pos, np.ndarray):
                    port_x.append(pos[0])
                    port_y.append(pos[1])
                else:
                    port_x.append(pos[0])
                    port_y.append(pos[1])
        
        if port_x:
            ax.scatter(
                port_x, port_y,
                c=PORT_COLOR,
                s=120,
                alpha=1.0,
                marker='D',  # Diamond marker for ports
                edgecolors='white',
                linewidths=2,
                zorder=100,
                label='Ports'
            )
        
        ax.set_xlim(-50, config.die_width + 50)
        ax.set_ylim(-50, config.die_height + 50)
        ax.set_xlabel("X")
        ax.set_ylabel("Y")
        
        # Count ports and regular cells
        num_ports = len(port_x)
        num_cells = len(positions) - num_ports
        title = f"H-Anchor Placement ({num_cells:,} cells"
        if num_ports > 0:
            title += f", {num_ports} ports"
        title += ")"
        ax.set_title(title, fontsize=14)
        ax.legend(loc='upper right', facecolor=COLORS['background'], labelcolor=COLORS['text'])
        ax.set_aspect('equal')
        
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=150, facecolor=COLORS['background'], bbox_inches='tight')
            plt.close(fig)
        else:
            plt.show()
        
    def plot_placement_progression(self, save_path: Optional[str] = None):
        """
        Visualize the placement at each layer of descent.
        
        Shows how cells are incrementally placed as we
        descend through the hierarchy.
        """
        if not self.placer.layers:
            raise ValueError("No hierarchy to visualize.")
            
        num_layers = len(self.placer.layers)
        cols = min(num_layers, 4)
        rows = (num_layers + cols - 1) // cols
        
        fig, axes = plt.subplots(rows, cols, figsize=(4 * cols, 4 * rows))
        fig.patch.set_facecolor(COLORS['background'])
        
        if num_layers == 1:
            axes = [[axes]]
        elif rows == 1:
            axes = [axes]
            
        config = self.placer.config
        positions = self.placer.positions
        
        for i in range(num_layers):
            row, col = i // cols, i % cols
            ax = axes[row][col] if rows > 1 else axes[col]
            self.setup_style(ax)
            
            # Get all nodes up to this layer
            placed_nodes = set()
            for j in range(i + 1):
                placed_nodes.update(self.placer.layers[j])
                
            # Draw die boundary
            die_rect = patches.Rectangle(
                (0, 0),
                config.die_width,
                config.die_height,
                linewidth=1,
                edgecolor=COLORS['text'],
                facecolor='none'
            )
            ax.add_patch(die_rect)
            
            # Draw edges
            edge_positions = []
            for u, v in self.placer.graph.edges():
                if u in placed_nodes and v in placed_nodes:
                    if u in positions and v in positions:
                        pos_u = positions[u]
                        pos_v = positions[v]
                        if isinstance(pos_u, np.ndarray):
                            pos_u = tuple(pos_u)
                        if isinstance(pos_v, np.ndarray):
                            pos_v = tuple(pos_v)
                        edge_positions.append([pos_u, pos_v])
                        
            if edge_positions:
                edge_collection = LineCollection(
                    edge_positions,
                    colors=COLORS['edge'],
                    alpha=0.2,
                    linewidths=0.3
                )
                ax.add_collection(edge_collection)
            
            # Draw nodes
            x = [positions[n][0] for n in placed_nodes if n in positions]
            y = [positions[n][1] for n in placed_nodes if n in positions]
            
            if x:
                color = COLORS['anchor_top'] if i == 0 else COLORS['cell_normal']
                ax.scatter(x, y, c=color, s=20, alpha=0.7)
                
            ax.set_xlim(-20, config.die_width + 20)
            ax.set_ylim(-20, config.die_height + 20)
            
            label = "Top Layer" if i == 0 else f"After Layer {i}"
            ax.set_title(f"{label}\n{len(placed_nodes):,} cells", fontsize=9)
            ax.set_aspect('equal')
            ax.axis('off')
            
        # Hide empty subplots
        for i in range(num_layers, rows * cols):
            row, col = i // cols, i % cols
            ax = axes[row][col] if rows > 1 else axes[col]
            ax.axis('off')
            
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=150, facecolor=COLORS['background'], bbox_inches='tight')
            plt.close(fig)
        else:
            plt.show()
        
    def plot_detailed_zoom(
        self,
        zoom_region: Optional[Tuple[float, float, float, float]] = None,
        use_legal: bool = True,
        show_labels: bool = False,
        edge_alpha: float = 0.6,
        save_path: Optional[str] = None
    ):
        """
        Detailed zoom-in visualization showing all layers with distinct colors.
        
        Opens in a separate window with:
        - All cells from all layers with layer-specific colors
        - All connections between cells with colors based on connected layers
        - Optional cell labels for detailed inspection
        - Interactive zoom capability
        
        Args:
            zoom_region: Optional (x_min, y_min, x_max, y_max) to zoom into
            use_legal: Use legalized positions (True) or analytical (False)
            show_labels: Show cell names (only recommended for small regions)
            edge_alpha: Transparency of edges (0.0 - 1.0)
            save_path: Optional path to save the figure
        """
        positions = self.placer.legal_positions if use_legal else self.placer.positions
        
        if not positions:
            raise ValueError("No placement to visualize.")
            
        # Create new figure in separate window
        fig = plt.figure(figsize=(16, 14), num="H-Anchor Detailed Layer View")
        fig.patch.set_facecolor(COLORS['background'])
        
        # Main plot area
        ax_main = fig.add_axes([0.05, 0.1, 0.7, 0.85])
        self.setup_style(ax_main)
        ax_main.grid(False)  # 确保关闭网格
        
        # Legend area
        ax_legend = fig.add_axes([0.78, 0.3, 0.2, 0.5])
        ax_legend.set_facecolor(COLORS['background'])
        ax_legend.axis('off')
        
        config = self.placer.config
        num_layers = len(self.placer.layers)
        
        # Build layer membership map (which layer each node belongs to)
        layer_membership = {}
        for layer_idx, layer in enumerate(self.placer.layers):
            for node in layer:
                if node not in layer_membership:
                    layer_membership[node] = layer_idx
        
        # Determine zoom region
        if zoom_region is None:
            x_min, y_min = 0, 0
            x_max, y_max = config.die_width, config.die_height
        else:
            x_min, y_min, x_max, y_max = zoom_region
            
        # Filter nodes in zoom region
        nodes_in_region = []
        for node, pos in positions.items():
            if isinstance(pos, np.ndarray):
                px, py = pos[0], pos[1]
            else:
                px, py = pos
            if x_min <= px <= x_max and y_min <= py <= y_max:
                nodes_in_region.append(node)
        
        # Draw die boundary
        die_rect = patches.Rectangle(
            (0, 0),
            config.die_width,
            config.die_height,
            linewidth=2,
            edgecolor=COLORS['text'],
            facecolor='none',
            linestyle='--',
            alpha=0.5
        )
        ax_main.add_patch(die_rect)
        
        # Draw zoom region if specified
        if zoom_region is not None:
            zoom_rect = patches.Rectangle(
                (x_min, y_min),
                x_max - x_min,
                y_max - y_min,
                linewidth=3,
                edgecolor='#FFD700',
                facecolor='none',
                linestyle='-'
            )
            ax_main.add_patch(zoom_rect)
        
        # Group edges by layer connection type
        edge_groups = {}  # (layer_u, layer_v) -> list of edge positions
        
        for u, v in self.placer.graph.edges():
            if u not in positions or v not in positions:
                continue
                
            pos_u = positions[u]
            pos_v = positions[v]
            
            if isinstance(pos_u, np.ndarray):
                pos_u = tuple(pos_u)
            if isinstance(pos_v, np.ndarray):
                pos_v = tuple(pos_v)
            
            # Check if edge is in zoom region (at least one endpoint)
            u_in = x_min <= pos_u[0] <= x_max and y_min <= pos_u[1] <= y_max
            v_in = x_min <= pos_v[0] <= x_max and y_min <= pos_v[1] <= y_max
            
            if not (u_in or v_in):
                continue
                
            layer_u = layer_membership.get(u, num_layers - 1)
            layer_v = layer_membership.get(v, num_layers - 1)
            
            # Use the higher (more important) layer as the key
            key = min(layer_u, layer_v)
            
            if key not in edge_groups:
                edge_groups[key] = []
            edge_groups[key].append([pos_u, pos_v])
        
        # Draw edges by layer (bottom layers first, so top layer edges are on top)
        for layer_idx in range(num_layers - 1, -1, -1):
            if layer_idx not in edge_groups:
                continue
                
            edges = edge_groups[layer_idx]
            color_idx = min(layer_idx, len(EDGE_LAYER_COLORS) - 1)
            edge_color = EDGE_LAYER_COLORS[color_idx]
            
            # Thicker lines for higher layers
            linewidth = 2.0 if layer_idx == 0 else (1.5 if layer_idx == 1 else 0.8)
            
            edge_collection = LineCollection(
                edges,
                colors=edge_color,
                alpha=edge_alpha * (1.0 - layer_idx * 0.1),
                linewidths=linewidth
            )
            ax_main.add_collection(edge_collection)
        
        # Draw nodes by layer (bottom layers first, so top layer nodes are on top)
        for layer_idx in range(num_layers - 1, -1, -1):
            layer_nodes = [n for n, l in layer_membership.items() 
                          if l == layer_idx and n in nodes_in_region]
            
            if not layer_nodes:
                continue
                
            x_coords = []
            y_coords = []
            
            for n in layer_nodes:
                pos = positions[n]
                if isinstance(pos, np.ndarray):
                    x_coords.append(pos[0])
                    y_coords.append(pos[1])
                else:
                    x_coords.append(pos[0])
                    y_coords.append(pos[1])
            
            # Get layer color
            color_idx = min(layer_idx, len(LAYER_COLORS) - 1)
            node_color = LAYER_COLORS[color_idx]
            
            # Size decreases with layer depth
            if layer_idx == 0:
                size = 200
                edge_width = 2
                marker = 'o'
                zorder = 100
            elif layer_idx == 1:
                size = 120
                edge_width = 1.5
                marker = 'o'
                zorder = 90
            elif layer_idx == 2:
                size = 80
                edge_width = 1
                marker = 'o'
                zorder = 80
            else:
                size = 40
                edge_width = 0.5
                marker = 'o'
                zorder = 70 - layer_idx
            
            ax_main.scatter(
                x_coords, y_coords,
                c=node_color,
                s=size,
                alpha=0.9,
                edgecolors='white',
                linewidths=edge_width,
                marker=marker,
                zorder=zorder
            )
            
            # Add labels if requested
            if show_labels and len(layer_nodes) < 100:
                for n, x, y in zip(layer_nodes, x_coords, y_coords):
                    short_name = n if len(n) < 10 else n[:8] + ".."
                    ax_main.annotate(
                        short_name,
                        (x, y),
                        xytext=(3, 3),
                        textcoords='offset points',
                        fontsize=6,
                        color=COLORS['text'],
                        alpha=0.8
                    )
        
        # Set axis limits
        margin = (x_max - x_min) * 0.05
        ax_main.set_xlim(x_min - margin, x_max + margin)
        ax_main.set_ylim(y_min - margin, y_max + margin)
        ax_main.set_xlabel("X", fontsize=12)
        ax_main.set_ylabel("Y", fontsize=12)
        ax_main.set_aspect('equal')
        
        title = f"H-Anchor Detailed View - {len(nodes_in_region):,} cells visible"
        if zoom_region:
            title += f"\nZoom: ({x_min:.0f}, {y_min:.0f}) to ({x_max:.0f}, {y_max:.0f})"
        ax_main.set_title(title, fontsize=14, color=COLORS['text'])
        
        # Draw custom legend
        legend_y = 0.95
        ax_legend.text(0.5, legend_y, "Layer Legend", fontsize=12, 
                      color=COLORS['text'], ha='center', fontweight='bold')
        
        legend_y -= 0.08
        for i in range(min(num_layers, len(LAYER_COLORS))):
            layer_count = len([n for n, l in layer_membership.items() if l == i])
            color_idx = min(i, len(LAYER_COLORS) - 1)
            color = LAYER_COLORS[color_idx]
            
            # Draw colored circle
            ax_legend.scatter([0.15], [legend_y], c=color, s=150, 
                            edgecolors='white', linewidths=1.5)
            
            # Layer label
            label = "TOP" if i == 0 else f"Layer {i}"
            ax_legend.text(0.3, legend_y, f"{label}: {layer_count:,} cells", 
                          fontsize=10, color=COLORS['text'], va='center')
            
            legend_y -= 0.1
        
        # Add edge legend
        legend_y -= 0.05
        ax_legend.text(0.5, legend_y, "Edge Colors", fontsize=11,
                      color=COLORS['text'], ha='center', fontweight='bold')
        legend_y -= 0.06
        ax_legend.text(0.1, legend_y, "Edges colored by\nhighest layer endpoint",
                      fontsize=9, color=COLORS['grid'], va='top')
        
        # Stats at bottom
        legend_y = 0.05
        total_edges = self.placer.graph.number_of_edges()
        ax_legend.text(0.5, legend_y, f"Total: {len(positions):,} cells\n{total_edges:,} edges",
                      fontsize=10, color=COLORS['text'], ha='center')
        
        ax_legend.set_xlim(0, 1)
        ax_legend.set_ylim(0, 1)
        
        if save_path:
            plt.savefig(save_path, dpi=150, facecolor=COLORS['background'], bbox_inches='tight')
            plt.close(fig)
        else:
            plt.show()
        
        return fig
    
    def plot_interactive_zoom(
        self,
        initial_zoom: Optional[Tuple[float, float, float, float]] = None,
        use_legal: bool = True
    ):
        """
        Interactive zoom visualization with click-to-zoom capability.
        
        Click and drag to select a zoom region.
        Press 'r' to reset to full view.
        Press 'q' to quit.
        
        Args:
            initial_zoom: Optional initial zoom region
            use_legal: Use legalized positions
        """
        from matplotlib.widgets import RectangleSelector
        
        positions = self.placer.legal_positions if use_legal else self.placer.positions
        config = self.placer.config
        
        if not positions:
            raise ValueError("No placement to visualize.")
        
        # Create figure
        fig, ax = plt.subplots(figsize=(14, 12), num="H-Anchor Interactive Zoom")
        fig.patch.set_facecolor(COLORS['background'])
        self.setup_style(ax)
        
        # Current zoom state
        current_zoom = [0, 0, config.die_width, config.die_height]
        if initial_zoom:
            current_zoom = list(initial_zoom)
        
        def draw_view(x_min, y_min, x_max, y_max):
            """Redraw the view for the given region."""
            ax.clear()
            self.setup_style(ax)
            
            num_layers = len(self.placer.layers)
            
            # Build layer membership
            layer_membership = {}
            for layer_idx, layer in enumerate(self.placer.layers):
                for node in layer:
                    if node not in layer_membership:
                        layer_membership[node] = layer_idx
            
            # Draw edges
            for u, v in self.placer.graph.edges():
                if u not in positions or v not in positions:
                    continue
                    
                pos_u = positions[u]
                pos_v = positions[v]
                
                if isinstance(pos_u, np.ndarray):
                    pos_u = tuple(pos_u)
                if isinstance(pos_v, np.ndarray):
                    pos_v = tuple(pos_v)
                
                # Check if in view
                u_in = x_min <= pos_u[0] <= x_max and y_min <= pos_u[1] <= y_max
                v_in = x_min <= pos_v[0] <= x_max and y_min <= pos_v[1] <= y_max
                
                if not (u_in or v_in):
                    continue
                
                layer_u = layer_membership.get(u, num_layers - 1)
                layer_v = layer_membership.get(v, num_layers - 1)
                key = min(layer_u, layer_v)
                color_idx = min(key, len(EDGE_LAYER_COLORS) - 1)
                
                ax.plot([pos_u[0], pos_v[0]], [pos_u[1], pos_v[1]],
                       color=EDGE_LAYER_COLORS[color_idx], alpha=0.4, linewidth=0.8)
            
            # Draw nodes by layer
            for layer_idx in range(num_layers - 1, -1, -1):
                layer_nodes = []
                for n, l in layer_membership.items():
                    if l != layer_idx or n not in positions:
                        continue
                    pos = positions[n]
                    if isinstance(pos, np.ndarray):
                        px, py = pos[0], pos[1]
                    else:
                        px, py = pos
                    if x_min <= px <= x_max and y_min <= py <= y_max:
                        layer_nodes.append((px, py))
                
                if not layer_nodes:
                    continue
                
                x_coords = [p[0] for p in layer_nodes]
                y_coords = [p[1] for p in layer_nodes]
                
                color_idx = min(layer_idx, len(LAYER_COLORS) - 1)
                size = 200 if layer_idx == 0 else (100 if layer_idx == 1 else 50)
                
                ax.scatter(x_coords, y_coords, c=LAYER_COLORS[color_idx],
                          s=size, edgecolors='white', linewidths=1, alpha=0.9,
                          zorder=100 - layer_idx)
            
            margin = (x_max - x_min) * 0.02
            ax.set_xlim(x_min - margin, x_max + margin)
            ax.set_ylim(y_min - margin, y_max + margin)
            ax.set_aspect('equal')
            ax.set_title(f"Interactive View ({len(positions):,} cells)\nDrag to zoom, 'r' to reset, 'q' to quit",
                        fontsize=12, color=COLORS['text'])
            
            fig.canvas.draw_idle()
        
        def on_select(eclick, erelease):
            """Handle rectangle selection."""
            x1, y1 = eclick.xdata, eclick.ydata
            x2, y2 = erelease.xdata, erelease.ydata
            
            if x1 is not None and x2 is not None:
                current_zoom[0] = min(x1, x2)
                current_zoom[1] = min(y1, y2)
                current_zoom[2] = max(x1, x2)
                current_zoom[3] = max(y1, y2)
                draw_view(*current_zoom)
        
        def on_key(event):
            """Handle key press."""
            if event.key == 'r':
                current_zoom[:] = [0, 0, config.die_width, config.die_height]
                draw_view(*current_zoom)
            elif event.key == 'q':
                plt.close(fig)
        
        # Setup rectangle selector
        selector = RectangleSelector(
            ax, on_select,
            useblit=True,
            button=[1],
            minspanx=5, minspany=5,
            spancoords='pixels',
            interactive=False
        )
        
        fig.canvas.mpl_connect('key_press_event', on_key)
        
        # Initial draw
        draw_view(*current_zoom)
        
        plt.show()
        
        return fig

    def plot_module_view(
        self,
        use_legal: bool = True,
        show_edges: bool = True,
        edge_alpha: float = 0.3,
        save_path: Optional[str] = None
    ):
        """
        Visualize placement with cells colored by their module origin.
        
        This visualization helps observe module boundaries after flattening
        and placement. Each module gets a distinct color, allowing users
        to see how well modules are clustered or spread out.
        
        Args:
            use_legal: Use legalized positions (True) or analytical (False)
            show_edges: Draw edges between connected cells
            edge_alpha: Transparency of edges (0.0 - 1.0)
            save_path: Optional path to save the figure
        """
        positions = self.placer.legal_positions if use_legal else self.placer.positions
        
        if not positions:
            raise ValueError("No placement to visualize.")
        
        # Collect module labels from cells
        module_membership: Dict[str, str] = {}
        for cell_id, cell in self.placer.cells.items():
            if hasattr(cell, 'module') and cell.module:
                module_membership[cell_id] = cell.module
            else:
                module_membership[cell_id] = "unknown"
        
        # Get unique modules and assign colors
        unique_modules = sorted(set(module_membership.values()))
        module_to_color = {
            mod: MODULE_COLORS[i % len(MODULE_COLORS)]
            for i, mod in enumerate(unique_modules)
        }
        
        # Create figure
        fig = plt.figure(figsize=(16, 14), num="Module View")
        fig.patch.set_facecolor(COLORS['background'])
        
        # Main plot area
        ax_main = fig.add_axes([0.05, 0.1, 0.72, 0.85])
        self.setup_style(ax_main)
        
        # Legend area
        ax_legend = fig.add_axes([0.78, 0.1, 0.2, 0.85])
        ax_legend.set_facecolor(COLORS['background'])
        ax_legend.axis('off')
        
        config = self.placer.config
        
        # Draw die boundary
        die_rect = patches.Rectangle(
            (0, 0),
            config.die_width,
            config.die_height,
            linewidth=2,
            edgecolor=COLORS['text'],
            facecolor='none'
        )
        ax_main.add_patch(die_rect)
        
        # Draw placement rows (grid lines)
        num_rows = int(config.die_height / config.row_height)
        for i in range(1, min(num_rows, 100)):  # Limit grid lines for large dies
            y = i * config.row_height
            ax_main.axhline(y=y, color=COLORS['grid'], linewidth=0.2, alpha=0.3)
        
        # Draw edges if requested
        if show_edges:
            edge_positions = []
            edge_colors = []
            
            for u, v in self.placer.graph.edges():
                if u in positions and v in positions:
                    pos_u = positions[u]
                    pos_v = positions[v]
                    
                    if isinstance(pos_u, np.ndarray):
                        pos_u = tuple(pos_u)
                    if isinstance(pos_v, np.ndarray):
                        pos_v = tuple(pos_v)
                    
                    edge_positions.append([pos_u, pos_v])
                    
                    # Color edge based on whether it connects same or different modules
                    mod_u = module_membership.get(u, "unknown")
                    mod_v = module_membership.get(v, "unknown")
                    
                    if mod_u == mod_v:
                        # Intra-module edge: use module color with lower alpha
                        edge_colors.append(module_to_color[mod_u] + '40')  # 25% alpha
                    else:
                        # Inter-module edge: gray
                        edge_colors.append('#FFFFFF20')  # White with low alpha
            
            if edge_positions:
                edge_collection = LineCollection(
                    edge_positions,
                    colors=edge_colors,
                    alpha=edge_alpha,
                    linewidths=0.3
                )
                ax_main.add_collection(edge_collection)
        
        # Draw cells grouped by module
        module_stats: Dict[str, Dict] = {}
        
        for module in unique_modules:
            module_cells = [c for c, m in module_membership.items() if m == module]
            
            x_coords = []
            y_coords = []
            
            for cell_id in module_cells:
                if cell_id in positions:
                    pos = positions[cell_id]
                    if isinstance(pos, np.ndarray):
                        x_coords.append(pos[0])
                        y_coords.append(pos[1])
                    else:
                        x_coords.append(pos[0])
                        y_coords.append(pos[1])
            
            if not x_coords:
                continue
            
            color = module_to_color[module]
            
            # Calculate module statistics (bounding box, center)
            x_min, x_max = min(x_coords), max(x_coords)
            y_min, y_max = min(y_coords), max(y_coords)
            center_x = np.mean(x_coords)
            center_y = np.mean(y_coords)
            spread = np.sqrt(np.var(x_coords) + np.var(y_coords))
            
            module_stats[module] = {
                'count': len(x_coords),
                'center': (center_x, center_y),
                'bbox': (x_min, y_min, x_max, y_max),
                'spread': spread,
                'color': color
            }
            
            # Draw cells for this module
            ax_main.scatter(
                x_coords, y_coords,
                c=color,
                s=15,
                alpha=0.8,
                edgecolors='white',
                linewidths=0.2,
                label=module
            )
            
            # Draw module bounding box (optional, for visual clarity)
            if len(x_coords) > 10:
                bbox_rect = patches.Rectangle(
                    (x_min, y_min),
                    x_max - x_min,
                    y_max - y_min,
                    linewidth=1.5,
                    edgecolor=color,
                    facecolor='none',
                    linestyle='--',
                    alpha=0.5
                )
                ax_main.add_patch(bbox_rect)
        
        # Set axis limits
        ax_main.set_xlim(-50, config.die_width + 50)
        ax_main.set_ylim(-50, config.die_height + 50)
        ax_main.set_xlabel("X", fontsize=12)
        ax_main.set_ylabel("Y", fontsize=12)
        ax_main.set_aspect('equal')
        ax_main.set_title(
            f"Module View - {len(positions):,} cells from {len(unique_modules)} modules",
            fontsize=14, color=COLORS['text']
        )
        
        # Draw legend with module statistics
        legend_y = 0.98
        ax_legend.text(0.5, legend_y, "Module Legend", fontsize=13,
                      color=COLORS['text'], ha='center', fontweight='bold')
        legend_y -= 0.03
        ax_legend.axhline(y=legend_y, xmin=0.1, xmax=0.9, color=COLORS['grid'], linewidth=1)
        legend_y -= 0.02
        
        # Sort modules by cell count for legend
        sorted_modules = sorted(module_stats.items(), key=lambda x: -x[1]['count'])
        
        for module, stats in sorted_modules:
            if legend_y < 0.05:
                ax_legend.text(0.5, 0.02, f"... and {len(sorted_modules) - len([m for m in sorted_modules if module_stats[m[0]]['count'] >= stats['count']])} more modules",
                              fontsize=8, color=COLORS['grid'], ha='center')
                break
            
            # Draw colored marker
            ax_legend.scatter([0.08], [legend_y], c=stats['color'], s=120,
                            edgecolors='white', linewidths=1)
            
            # Module name and count
            ax_legend.text(0.18, legend_y, f"{module}", fontsize=10,
                          color=COLORS['text'], va='center', fontweight='bold')
            ax_legend.text(0.18, legend_y - 0.025, f"{stats['count']:,} cells",
                          fontsize=8, color=COLORS['grid'], va='center')
            
            legend_y -= 0.065
        
        # Summary statistics at bottom
        legend_y = 0.02
        total_cells = sum(s['count'] for s in module_stats.values())
        total_edges = self.placer.graph.number_of_edges()
        
        ax_legend.text(0.5, legend_y, f"Total: {total_cells:,} cells | {total_edges:,} edges",
                      fontsize=9, color=COLORS['text'], ha='center')
        
        ax_legend.set_xlim(0, 1)
        ax_legend.set_ylim(0, 1)
        
        if save_path:
            plt.savefig(save_path, dpi=150, facecolor=COLORS['background'], bbox_inches='tight')
            plt.close(fig)
        else:
            plt.show()
        
        return fig, module_stats

    def plot_wirelength_distribution(self, save_path: Optional[str] = None):
        """
        Visualize the distribution of edge lengths.
        """
        positions = self.placer.legal_positions
        if not positions:
            positions = self.placer.positions
            
        if not positions:
            raise ValueError("No placement to analyze.")
            
        lengths = []
        for u, v in self.placer.graph.edges():
            if u in positions and v in positions:
                pos_u = positions[u]
                pos_v = positions[v]
                
                if isinstance(pos_u, np.ndarray):
                    pos_u = tuple(pos_u)
                if isinstance(pos_v, np.ndarray):
                    pos_v = tuple(pos_v)
                    
                length = abs(pos_u[0] - pos_v[0]) + abs(pos_u[1] - pos_v[1])
                lengths.append(length)
                
        fig, ax = plt.subplots(figsize=(10, 5))
        fig.patch.set_facecolor(COLORS['background'])
        self.setup_style(ax)
        
        ax.hist(
            lengths,
            bins=50,
            color=COLORS['anchor_mid'],
            edgecolor=COLORS['background'],
            alpha=0.8
        )
        
        ax.axvline(
            np.mean(lengths),
            color=COLORS['anchor_top'],
            linestyle='--',
            linewidth=2,
            label=f'Mean: {np.mean(lengths):.1f}'
        )
        ax.axvline(
            np.median(lengths),
            color=COLORS['anchor_low'],
            linestyle='--',
            linewidth=2,
            label=f'Median: {np.median(lengths):.1f}'
        )
        
        ax.set_xlabel("Edge Length (Manhattan)")
        ax.set_ylabel("Count")
        ax.set_title("Wirelength Distribution")
        ax.legend(facecolor=COLORS['background'], labelcolor=COLORS['text'])
        
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=150, facecolor=COLORS['background'], bbox_inches='tight')
            plt.close(fig)
        else:
            plt.show()


def visualize_placement(placer: HAnchorPlacer, include_detailed: bool = True):
    """Convenience function to visualize all aspects of a placement."""
    viz = PlacementVisualizer(placer)
    
    print("Visualizing hierarchy layers...")
    viz.plot_hierarchy_layers()
    
    print("Visualizing placement progression...")
    viz.plot_placement_progression()
    
    print("Visualizing final placement...")
    viz.plot_placement(use_legal=True)
    
    if include_detailed:
        print("Visualizing detailed layer view...")
        viz.plot_detailed_zoom()
    
    print("Visualizing wirelength distribution...")
    viz.plot_wirelength_distribution()


def plot_placement_comparison(
    original_positions: Dict[str, Tuple[float, float]],
    updated_positions: Dict[str, Tuple[float, float]],
    changed_nodes: Optional[Set[str]] = None,
    graph: Optional[nx.Graph] = None,
    die_width: float = 1000.0,
    die_height: float = 1000.0,
    original_time: float = 0.0,
    update_time: float = 0.0,
    original_hpwl: float = 0.0,
    updated_hpwl: float = 0.0,
    title: str = "Placement Comparison",
    save_path: Optional[str] = None
):
    """
    比较原始布局和更新后布局，高亮显示变化的单元。
    
    Plot both original and updated placements side by side, 
    highlighting the moved/changed cells.
    
    Args:
        original_positions: Dict mapping cell IDs to (x, y) positions before update
        updated_positions: Dict mapping cell IDs to (x, y) positions after update
        changed_nodes: Optional set of node names that were explicitly changed
        graph: Optional NetworkX graph for edge drawing
        die_width: Die width for boundary
        die_height: Die height for boundary
        original_time: Time taken for original placement (seconds)
        update_time: Time taken for incremental update (seconds)
        original_hpwl: HPWL of original placement
        updated_hpwl: HPWL of updated placement
        title: Plot title
        save_path: Optional path to save the figure
    """
    # Create figure with 2 subplots side by side + a third for legend/stats
    fig = plt.figure(figsize=(20, 10))
    fig.patch.set_facecolor(COLORS['background'])
    
    # Three subplots: Original, Updated, Stats/Legend
    ax1 = fig.add_axes([0.02, 0.1, 0.42, 0.8])  # Original
    ax2 = fig.add_axes([0.46, 0.1, 0.42, 0.8])  # Updated
    ax_stats = fig.add_axes([0.90, 0.1, 0.09, 0.8])  # Stats panel
    
    for ax in [ax1, ax2]:
        ax.set_facecolor(COLORS['background'])
        ax.tick_params(colors=COLORS['text'])
        ax.xaxis.label.set_color(COLORS['text'])
        ax.yaxis.label.set_color(COLORS['text'])
        ax.title.set_color(COLORS['text'])
        for spine in ax.spines.values():
            spine.set_color(COLORS['grid'])
        ax.grid(False)
    
    ax_stats.set_facecolor(COLORS['background'])
    ax_stats.axis('off')
    
    # Detect moved cells by comparing positions
    moved_threshold = 1.0  # Minimum distance to be considered "moved"
    moved_cells = set()
    all_cells = set(original_positions.keys()) & set(updated_positions.keys())
    
    for cell in all_cells:
        orig_pos = original_positions[cell]
        new_pos = updated_positions[cell]
        dist = np.sqrt((orig_pos[0] - new_pos[0])**2 + (orig_pos[1] - new_pos[1])**2)
        if dist > moved_threshold:
            moved_cells.add(cell)
    
    # If changed_nodes provided, combine with moved_cells
    explicitly_changed = changed_nodes if changed_nodes else set()
    
    # Colors for different cell categories
    COLOR_UNCHANGED = '#66D9EF'      # Cyan - cells that didn't move
    COLOR_MOVED = '#FD971F'          # Orange - cells that moved due to propagation
    COLOR_EXPLICIT = '#F92672'       # Pink/Magenta - explicitly changed cells
    COLOR_ARROW = '#A6E22E'          # Green - movement arrows
    
    def draw_placement(ax, positions, title_text, is_updated=False):
        """Draw a single placement on the given axes."""
        # Draw die boundary
        die_rect = patches.Rectangle(
            (0, 0), die_width, die_height,
            linewidth=2, edgecolor=COLORS['text'],
            facecolor='none'
        )
        ax.add_patch(die_rect)
        
        # Draw edges if graph provided
        if graph is not None:
            edge_positions = []
            for u, v in graph.edges():
                if u in positions and v in positions:
                    pos_u = positions[u]
                    pos_v = positions[v]
                    if isinstance(pos_u, np.ndarray):
                        pos_u = tuple(pos_u)
                    if isinstance(pos_v, np.ndarray):
                        pos_v = tuple(pos_v)
                    edge_positions.append([pos_u, pos_v])
            
            if edge_positions:
                edge_collection = LineCollection(
                    edge_positions,
                    colors=COLORS['edge'],
                    alpha=0.15,
                    linewidths=0.3
                )
                ax.add_collection(edge_collection)
        
        # Categorize cells
        unchanged_x, unchanged_y = [], []
        moved_x, moved_y = [], []
        explicit_x, explicit_y = [], []
        
        for cell, pos in positions.items():
            if isinstance(pos, np.ndarray):
                x, y = pos[0], pos[1]
            else:
                x, y = pos
            
            if cell in explicitly_changed:
                explicit_x.append(x)
                explicit_y.append(y)
            elif cell in moved_cells:
                moved_x.append(x)
                moved_y.append(y)
            else:
                unchanged_x.append(x)
                unchanged_y.append(y)
        
        # Draw unchanged cells (smallest)
        if unchanged_x:
            ax.scatter(unchanged_x, unchanged_y, c=COLOR_UNCHANGED, s=8, 
                      alpha=0.6, edgecolors='none', label='Unchanged')
        
        # Draw propagation-moved cells (medium)
        if moved_x:
            ax.scatter(moved_x, moved_y, c=COLOR_MOVED, s=25, 
                      alpha=0.85, edgecolors='white', linewidths=0.5,
                      label='Propagation Moved')
        
        # Draw explicitly changed cells (largest, highlighted)
        if explicit_x:
            ax.scatter(explicit_x, explicit_y, c=COLOR_EXPLICIT, s=80, 
                      alpha=1.0, edgecolors='white', linewidths=1.5,
                      marker='*', label='Explicitly Moved')
        
        # Draw movement arrows on the updated plot
        if is_updated:
            for cell in moved_cells | explicitly_changed:
                if cell in original_positions and cell in updated_positions:
                    orig = original_positions[cell]
                    new = updated_positions[cell]
                    if isinstance(orig, np.ndarray):
                        orig = tuple(orig)
                    if isinstance(new, np.ndarray):
                        new = tuple(new)
                    
                    dx = new[0] - orig[0]
                    dy = new[1] - orig[1]
                    dist = np.sqrt(dx**2 + dy**2)
                    
                    if dist > moved_threshold:
                        # Draw line from original to new position
                        ax.plot([orig[0], new[0]], [orig[1], new[1]],
                               color=COLOR_ARROW, alpha=0.7, linewidth=1.5,
                               zorder=50)
        
        ax.set_xlim(-50, die_width + 50)
        ax.set_ylim(-50, die_height + 50)
        ax.set_xlabel("X", fontsize=10)
        ax.set_ylabel("Y", fontsize=10)
        ax.set_title(title_text, fontsize=12, color=COLORS['text'])
        ax.set_aspect('equal')
    
    # Draw both placements
    draw_placement(ax1, original_positions, 
                   f"Original Placement\n({len(original_positions):,} cells)", 
                   is_updated=False)
    draw_placement(ax2, updated_positions, 
                   f"Updated Placement\n({len(updated_positions):,} cells)", 
                   is_updated=True)
    
    # Add legends to both plots
    for ax in [ax1, ax2]:
        ax.legend(loc='upper right', facecolor=COLORS['background'], 
                 labelcolor=COLORS['text'], fontsize=8)
    
    # Draw statistics panel
    stats_y = 0.95
    ax_stats.text(0.5, stats_y, "Statistics", fontsize=12, 
                 color=COLORS['text'], ha='center', fontweight='bold')
    
    stats_y -= 0.06
    ax_stats.axhline(y=stats_y, xmin=0.1, xmax=0.9, color=COLORS['grid'], linewidth=1)
    
    # Timing stats
    stats_y -= 0.06
    ax_stats.text(0.5, stats_y, "Runtime", fontsize=10, 
                 color=COLORS['text'], ha='center', fontweight='bold')
    
    stats_y -= 0.05
    ax_stats.text(0.1, stats_y, f"Original:", fontsize=9, color=COLORS['grid'])
    ax_stats.text(0.9, stats_y, f"{original_time:.3f}s", fontsize=9, 
                 color='#A6E22E', ha='right')
    
    stats_y -= 0.04
    ax_stats.text(0.1, stats_y, f"Update:", fontsize=9, color=COLORS['grid'])
    ax_stats.text(0.9, stats_y, f"{update_time:.3f}s", fontsize=9, 
                 color='#A6E22E', ha='right')
    
    if original_time > 0:
        speedup = original_time / max(update_time, 0.001)
        stats_y -= 0.04
        ax_stats.text(0.1, stats_y, f"Speedup:", fontsize=9, color=COLORS['grid'])
        ax_stats.text(0.9, stats_y, f"{speedup:.1f}x", fontsize=9, 
                     color='#F92672', ha='right', fontweight='bold')
    
    # HPWL stats
    stats_y -= 0.08
    ax_stats.text(0.5, stats_y, "HPWL", fontsize=10, 
                 color=COLORS['text'], ha='center', fontweight='bold')
    
    stats_y -= 0.05
    ax_stats.text(0.1, stats_y, f"Original:", fontsize=9, color=COLORS['grid'])
    ax_stats.text(0.9, stats_y, f"{original_hpwl:,.0f}", fontsize=9, 
                 color='#66D9EF', ha='right')
    
    stats_y -= 0.04
    ax_stats.text(0.1, stats_y, f"Updated:", fontsize=9, color=COLORS['grid'])
    ax_stats.text(0.9, stats_y, f"{updated_hpwl:,.0f}", fontsize=9, 
                 color='#66D9EF', ha='right')
    
    if original_hpwl > 0:
        hpwl_change = ((updated_hpwl - original_hpwl) / original_hpwl) * 100
        stats_y -= 0.04
        ax_stats.text(0.1, stats_y, f"Change:", fontsize=9, color=COLORS['grid'])
        color = '#A6E22E' if hpwl_change <= 0 else '#F92672'
        sign = '+' if hpwl_change > 0 else ''
        ax_stats.text(0.9, stats_y, f"{sign}{hpwl_change:.1f}%", fontsize=9, 
                     color=color, ha='right')
    
    # Cell change stats
    stats_y -= 0.08
    ax_stats.text(0.5, stats_y, "Cell Changes", fontsize=10, 
                 color=COLORS['text'], ha='center', fontweight='bold')
    
    stats_y -= 0.05
    ax_stats.text(0.1, stats_y, f"Explicit:", fontsize=9, color=COLORS['grid'])
    ax_stats.text(0.9, stats_y, f"{len(explicitly_changed)}", fontsize=9, 
                 color='#F92672', ha='right')
    
    stats_y -= 0.04
    ax_stats.text(0.1, stats_y, f"Propagated:", fontsize=9, color=COLORS['grid'])
    ax_stats.text(0.9, stats_y, f"{len(moved_cells - explicitly_changed)}", fontsize=9, 
                 color='#FD971F', ha='right')
    
    stats_y -= 0.04
    ax_stats.text(0.1, stats_y, f"Unchanged:", fontsize=9, color=COLORS['grid'])
    unchanged_count = len(all_cells) - len(moved_cells) - len(explicitly_changed - moved_cells)
    ax_stats.text(0.9, stats_y, f"{unchanged_count}", fontsize=9, 
                 color='#66D9EF', ha='right')
    
    # Legend
    stats_y -= 0.1
    ax_stats.text(0.5, stats_y, "Legend", fontsize=10, 
                 color=COLORS['text'], ha='center', fontweight='bold')
    
    stats_y -= 0.05
    ax_stats.scatter([0.15], [stats_y], c=COLOR_UNCHANGED, s=40, marker='o')
    ax_stats.text(0.25, stats_y, "Unchanged", fontsize=8, color=COLORS['text'], va='center')
    
    stats_y -= 0.04
    ax_stats.scatter([0.15], [stats_y], c=COLOR_MOVED, s=50, marker='o', edgecolors='white', linewidths=0.5)
    ax_stats.text(0.25, stats_y, "Propagated", fontsize=8, color=COLORS['text'], va='center')
    
    stats_y -= 0.04
    ax_stats.scatter([0.15], [stats_y], c=COLOR_EXPLICIT, s=60, marker='*', edgecolors='white', linewidths=1)
    ax_stats.text(0.25, stats_y, "Explicit", fontsize=8, color=COLORS['text'], va='center')
    
    stats_y -= 0.04
    ax_stats.plot([0.05, 0.25], [stats_y, stats_y], color=COLOR_ARROW, linewidth=2)
    ax_stats.text(0.32, stats_y, "Move", fontsize=8, color=COLORS['text'], va='center')
    
    ax_stats.set_xlim(0, 1)
    ax_stats.set_ylim(0, 1)
    
    # Main title
    fig.suptitle(title, fontsize=14, color=COLORS['text'], y=0.98)
    
    if save_path:
        plt.savefig(save_path, dpi=150, facecolor=COLORS['background'], bbox_inches='tight')
        plt.close(fig)
        print(f"✓ Comparison saved to {save_path}")
    else:
        plt.show()
    
    return fig

