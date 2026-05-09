/**
 * H-Anchor Core Algorithm - C++ Implementation
 * 
 * High-performance implementation of the hierarchical anchor-based
 * placement algorithm inspired by HNSW.
 */

#pragma once

#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <string>
#include <cmath>
#include <random>
#include <algorithm>
#include <numeric>

namespace hanchor {

// Forward declarations
struct Cell;
struct Edge;
class Graph;
class HierarchyBuilder;
class ForceDirectedEngine;
class HAnchorCore;

/**
 * Configuration for H-Anchor placement
 */
struct PlacementConfig {
    // Hierarchy parameters
    int num_layers = 5;
    int top_layer_size = 100;
    double decimation_factor = 0.25;
    
    // Scoring
    double alpha = 0.4;  // Degree weight
    double beta = 0.6;   // PageRank weight
    
    // Force-directed
    int top_layer_iterations = 300;
    int refinement_iterations = 100;
    double repulsion_strength = 2.0;
    double attraction_strength = 0.1;
    double overlap_repulsion = 5.0;   // 防止重叠的强排斥力
    double min_spacing = 8.0;         // cells之间的最小间距
    double center_gravity = 0.01;
    double spread_factor = 0.6;       // 初始分布范围 (0-1, 1=整个die, 0.5=中心50%区域)
    double global_attraction = 0.02;  // 全局吸引力，让clusters互相靠近
    
    // Die area
    double die_width = 1000.0;
    double die_height = 1000.0;
    
    // Advanced
    bool use_transitive_edges = true;
    int transitive_edge_hops = 3;
    double jitter_scale = 20.0;
    double anchor_mass_factor = 5.0;
};

/**
 * 2D Position
 */
struct Position {
    double x = 0.0;
    double y = 0.0;
    
    Position() = default;
    Position(double x_, double y_) : x(x_), y(y_) {}
    
    Position operator+(const Position& other) const {
        return Position(x + other.x, y + other.y);
    }
    
    Position operator-(const Position& other) const {
        return Position(x - other.x, y - other.y);
    }
    
    Position operator*(double s) const {
        return Position(x * s, y * s);
    }
    
    Position operator/(double s) const {
        return Position(x / s, y / s);
    }
    
    double norm() const {
        return std::sqrt(x * x + y * y);
    }
    
    Position normalized() const {
        double n = norm();
        if (n < 1e-10) return Position(0, 0);
        return *this / n;
    }
};

/**
 * Cell/Node in the netlist
 */
struct Cell {
    int id;
    std::string name;
    double width = 1.0;
    double height = 1.0;
    Position pos;
    Position legal_pos;
    int layer = -1;  // Which hierarchy layer (-1 = not assigned)
    double score = 0.0;  // Centrality score
};

/**
 * Edge in the graph
 */
struct Edge {
    int from;
    int to;
    double weight = 1.0;
};

/**
 * Graph representation optimized for placement
 */
class Graph {
public:
    std::vector<Cell> cells;
    std::vector<Edge> edges;
    std::vector<std::vector<int>> adjacency;  // adjacency[i] = list of neighbor indices
    std::vector<std::vector<double>> adj_weights;  // corresponding weights
    
    int num_nodes() const { return static_cast<int>(cells.size()); }
    int num_edges() const { return static_cast<int>(edges.size()); }
    
    void build_adjacency();
    void add_node(const std::string& name, double width = 1.0, double height = 1.0);
    void add_edge(int from, int to, double weight = 1.0);
    
    // Get neighbors of a node
    const std::vector<int>& neighbors(int node) const { return adjacency[node]; }
    double edge_weight(int from, int to) const;
};

/**
 * Hierarchy construction using spatial inhibition
 */
class HierarchyBuilder {
public:
    HierarchyBuilder(Graph& graph, const PlacementConfig& config);
    
    void compute_scores();
    void build_layers();
    
    const std::vector<std::vector<int>>& get_layers() const { return layers_; }
    
private:
    Graph& graph_;
    const PlacementConfig& config_;
    std::vector<std::vector<int>> layers_;  // layers_[0] = top (sparse), layers_[n] = bottom (all)
    
    void compute_pagerank(int iterations = 20);
    void compute_degree_centrality();
};

/**
 * Force-directed placement engine with density control
 */
class ForceDirectedEngine {
public:
    ForceDirectedEngine(const PlacementConfig& config);
    
    void run_layout(
        Graph& graph,
        const std::vector<int>& active_nodes,
        const std::unordered_set<int>& fixed_nodes,
        const std::unordered_map<int, double>& masses,
        int iterations
    );
    
private:
    const PlacementConfig& config_;
    std::mt19937 rng_;
    
    void compute_repulsion(
        const Graph& graph,
        const std::vector<int>& nodes,
        std::vector<Position>& forces,
        double k_repel
    );
    
    void compute_attraction(
        const Graph& graph,
        const std::vector<int>& nodes,
        std::vector<Position>& forces,
        double k_attract
    );
    
    void compute_overlap_repulsion(
        const Graph& graph,
        const std::vector<int>& nodes,
        std::vector<Position>& forces,
        double k_repel
    );
    
    void compute_center_gravity(
        const Graph& graph,
        const std::vector<int>& nodes,
        std::vector<Position>& forces
    );
    
    void compute_global_attraction(
        const Graph& graph,
        const std::vector<int>& nodes,
        std::vector<Position>& forces
    );
};

/**
 * Main H-Anchor placement algorithm
 */
class HAnchorCore {
public:
    HAnchorCore(const PlacementConfig& config);
    
    // Load graph from vectors (called from Python)
    void load_graph(
        const std::vector<std::string>& node_names,
        const std::vector<double>& node_widths,
        const std::vector<double>& node_heights,
        const std::vector<int>& edge_from,
        const std::vector<int>& edge_to,
        const std::vector<double>& edge_weights
    );
    
    // Run the complete placement flow
    void run();
    
    // Get results
    std::vector<double> get_positions_x() const;
    std::vector<double> get_positions_y() const;
    std::vector<int> get_layer_sizes() const;
    double get_hpwl() const;
    
    // Access to layers for visualization
    std::vector<std::vector<int>> get_layers() const;
    
    // =========================================================================
    // Incremental Update API
    // =========================================================================
    
    /**
     * Update positions of anchor cells and propagate changes locally.
     * 
     * @param node_indices Indices of nodes whose positions are being updated
     * @param new_x New X coordinates for these nodes
     * @param new_y New Y coordinates for these nodes
     * @param propagation_radius How many hops of neighbors to re-optimize (0=only moved nodes)
     * 
     * Algorithm:
     * 1. Set new positions for specified nodes
     * 2. Find affected region (BFS up to propagation_radius)
     * 3. Run local force-directed optimization on affected region
     * 4. Higher-layer nodes have more mass (move less), lower-layer nodes adjust more
     */
    void incremental_update_positions(
        const std::vector<int>& node_indices,
        const std::vector<double>& new_x,
        const std::vector<double>& new_y,
        int propagation_radius = 2
    );
    
    /**
     * Incrementally add new nodes and edges to the netlist.
     * 
     * @param node_names Names of new nodes
     * @param node_widths Widths of new nodes
     * @param node_heights Heights of new nodes
     * @param edge_from Source node indices for new edges (can reference existing or new nodes)
     * @param edge_to Target node indices for new edges
     * @param edge_weights Weights for new edges
     * @return Starting index of the newly added nodes
     * 
     * Algorithm:
     * 1. Add new nodes to graph
     * 2. Add new edges (rebuild adjacency)
     * 3. Compute scores for new nodes
     * 4. Assign new nodes to appropriate layer based on their connectivity
     * 5. Project new nodes to weighted center of neighbors
     * 6. Run local optimization around new nodes
     */
    int incremental_add_nodes(
        const std::vector<std::string>& node_names,
        const std::vector<double>& node_widths,
        const std::vector<double>& node_heights,
        const std::vector<int>& edge_from,
        const std::vector<int>& edge_to,
        const std::vector<double>& edge_weights
    );
    
    /**
     * Incrementally remove nodes and their edges.
     * 
     * @param node_indices Indices of nodes to remove
     * 
     * Algorithm:
     * 1. Identify layer level of removed nodes
     * 2. Remove nodes and their edges
     * 3. If high-level anchor removed: may need to promote a neighbor to anchor
     * 4. Run local optimization on affected area
     * 
     * Note: Node indices will be invalidated after removal. 
     * Returns mapping of old indices to new indices.
     */
    std::unordered_map<int, int> incremental_remove_nodes(
        const std::vector<int>& node_indices
    );
    
    /**
     * Add edges between existing nodes.
     * 
     * @param edge_from Source node indices
     * @param edge_to Target node indices  
     * @param edge_weights Edge weights
     * 
     * Algorithm:
     * 1. Add new edges to graph
     * 2. Rebuild adjacency for affected nodes
     * 3. Run local optimization on nodes connected by new edges
     */
    void incremental_add_edges(
        const std::vector<int>& edge_from,
        const std::vector<int>& edge_to,
        const std::vector<double>& edge_weights
    );
    
    /**
     * Remove edges from the graph.
     * 
     * @param edge_from Source node indices of edges to remove
     * @param edge_to Target node indices of edges to remove
     * 
     * Algorithm:
     * 1. Remove specified edges
     * 2. Rebuild adjacency for affected nodes
     * 3. Run local optimization on affected nodes
     */
    void incremental_remove_edges(
        const std::vector<int>& edge_from,
        const std::vector<int>& edge_to
    );
    
    /**
     * Get the layer index of a node (0=top/most important, higher=lower level)
     */
    int get_node_layer(int node_idx) const;
    
private:
    PlacementConfig config_;
    Graph graph_;
    std::vector<std::vector<int>> layers_;
    
    void construct_hierarchy();
    void place_top_layer();
    void descend_and_refine();
    void project_new_nodes(
        const std::vector<int>& new_nodes,
        const std::unordered_set<int>& anchors
    );
    void refine_layer(
        const std::vector<int>& current_nodes,
        const std::unordered_set<int>& anchors
    );
    
    // Incremental update helpers
    std::unordered_set<int> find_affected_region(
        const std::vector<int>& seed_nodes,
        int radius
    );
    
    void local_optimize(
        const std::unordered_set<int>& affected_nodes,
        const std::unordered_set<int>& fixed_boundary,
        int iterations
    );
    
    void assign_layer_to_new_nodes(const std::vector<int>& new_nodes);
    
    double compute_node_score(int node_idx) const;
};

}  // namespace hanchor

