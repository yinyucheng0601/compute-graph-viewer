/**
 * H-Anchor Core Algorithm - C++ Implementation
 */

#include "h_anchor_core.hpp"
#include <iostream>
#include <queue>
#include <set>
#include <chrono>

namespace hanchor {

// ============================================================================
// Graph Implementation
// ============================================================================

void Graph::build_adjacency() {
    int n = num_nodes();
    adjacency.assign(n, std::vector<int>());
    adj_weights.assign(n, std::vector<double>());
    
    for (const auto& edge : edges) {
        adjacency[edge.from].push_back(edge.to);
        adj_weights[edge.from].push_back(edge.weight);
        adjacency[edge.to].push_back(edge.from);
        adj_weights[edge.to].push_back(edge.weight);
    }
}

void Graph::add_node(const std::string& name, double width, double height) {
    Cell cell;
    cell.id = static_cast<int>(cells.size());
    cell.name = name;
    cell.width = width;
    cell.height = height;
    cells.push_back(cell);
}

void Graph::add_edge(int from, int to, double weight) {
    Edge e;
    e.from = from;
    e.to = to;
    e.weight = weight;
    edges.push_back(e);
}

double Graph::edge_weight(int from, int to) const {
    const auto& neighbors = adjacency[from];
    const auto& weights = adj_weights[from];
    for (size_t i = 0; i < neighbors.size(); ++i) {
        if (neighbors[i] == to) {
            return weights[i];
        }
    }
    return 0.0;
}

// ============================================================================
// HierarchyBuilder Implementation
// ============================================================================

HierarchyBuilder::HierarchyBuilder(Graph& graph, const PlacementConfig& config)
    : graph_(graph), config_(config) {}

void HierarchyBuilder::compute_pagerank(int iterations) {
    int n = graph_.num_nodes();
    if (n == 0) return;
    
    std::vector<double> pr(n, 1.0 / n);
    std::vector<double> new_pr(n, 0.0);
    double damping = 0.85;
    
    for (int iter = 0; iter < iterations; ++iter) {
        std::fill(new_pr.begin(), new_pr.end(), (1.0 - damping) / n);
        
        for (int i = 0; i < n; ++i) {
            const auto& neighbors = graph_.neighbors(i);
            if (neighbors.empty()) continue;
            
            double contrib = damping * pr[i] / neighbors.size();
            for (int j : neighbors) {
                new_pr[j] += contrib;
            }
        }
        
        std::swap(pr, new_pr);
    }
    
    // Store PageRank in cell scores
    for (int i = 0; i < n; ++i) {
        graph_.cells[i].score = pr[i];
    }
}

void HierarchyBuilder::compute_degree_centrality() {
    int n = graph_.num_nodes();
    if (n == 0) return;
    
    int max_degree = 0;
    for (int i = 0; i < n; ++i) {
        int degree = static_cast<int>(graph_.neighbors(i).size());
        max_degree = std::max(max_degree, degree);
    }
    
    if (max_degree == 0) max_degree = 1;
    
    for (int i = 0; i < n; ++i) {
        int degree = static_cast<int>(graph_.neighbors(i).size());
        double degree_score = static_cast<double>(degree) / max_degree;
        // Combine with existing score (PageRank)
        graph_.cells[i].score = config_.alpha * degree_score + 
                                config_.beta * graph_.cells[i].score;
    }
}

void HierarchyBuilder::compute_scores() {
    compute_pagerank();
    compute_degree_centrality();
}

void HierarchyBuilder::build_layers() {
    int n = graph_.num_nodes();
    if (n == 0) return;
    
    // Layer 0 (bottom) = all nodes
    std::vector<int> current_nodes(n);
    std::iota(current_nodes.begin(), current_nodes.end(), 0);
    
    layers_.clear();
    layers_.push_back(current_nodes);
    
    // Build upper layers by decimation with spatial inhibition
    for (int layer_idx = 0; layer_idx < config_.num_layers - 1; ++layer_idx) {
        int target_count = std::max(
            static_cast<int>(current_nodes.size() * config_.decimation_factor),
            config_.top_layer_size
        );
        
        // Sort by score (descending)
        std::vector<int> sorted_nodes = current_nodes;
        std::sort(sorted_nodes.begin(), sorted_nodes.end(),
            [this](int a, int b) {
                return graph_.cells[a].score > graph_.cells[b].score;
            });
        
        std::vector<int> next_layer;
        std::unordered_set<int> covered;
        
        // Spatial inhibition: suppress neighbors of selected anchors
        for (int node : sorted_nodes) {
            if (covered.find(node) != covered.end()) continue;
            
            next_layer.push_back(node);
            
            // Mark neighbors as covered
            for (int neighbor : graph_.neighbors(node)) {
                covered.insert(neighbor);
            }
            
            if (static_cast<int>(next_layer.size()) >= target_count) break;
        }
        
        layers_.push_back(next_layer);
        current_nodes = next_layer;
        
        if (static_cast<int>(next_layer.size()) <= config_.top_layer_size) break;
    }
    
    // Reverse so layers_[0] is top (sparse)
    std::reverse(layers_.begin(), layers_.end());
    
    // Assign layer indices to cells
    for (size_t layer_idx = 0; layer_idx < layers_.size(); ++layer_idx) {
        for (int node : layers_[layer_idx]) {
            if (graph_.cells[node].layer < 0) {
                graph_.cells[node].layer = static_cast<int>(layer_idx);
            }
        }
    }
}

// ============================================================================
// ForceDirectedEngine Implementation
// ============================================================================

ForceDirectedEngine::ForceDirectedEngine(const PlacementConfig& config)
    : config_(config), rng_(std::random_device{}()) {}

void ForceDirectedEngine::compute_repulsion(
    const Graph& graph,
    const std::vector<int>& nodes,
    std::vector<Position>& forces,
    double k_repel
) {
    int n = static_cast<int>(nodes.size());
    double k2 = k_repel * k_repel;
    
    // 使用 schedule(static) 确保每次运行任务分配相同，保证确定性
    // 每个 forces[i] 只被线程 i 写入，无需锁
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < n; ++i) {
        int node_i = nodes[i];
        Position force_i(0, 0);
        
        // 按固定顺序 j=0,1,2,... 累加，确保浮点累加顺序一致
        for (int j = 0; j < n; ++j) {
            if (i == j) continue;
            int node_j = nodes[j];
            
            Position diff = graph.cells[node_i].pos - graph.cells[node_j].pos;
            double dist = diff.norm();
            if (dist < 0.01) dist = 0.01;
            
            // Coulomb repulsion: F = k^2 / r^2
            double magnitude = k2 / (dist * dist);
            force_i = force_i + diff.normalized() * magnitude;
        }
        
        forces[i] = forces[i] + force_i;  // 无锁，每个i独立
    }
}

void ForceDirectedEngine::compute_attraction(
    const Graph& graph,
    const std::vector<int>& nodes,
    std::vector<Position>& forces,
    double k_attract
) {
    int n = static_cast<int>(nodes.size());
    
    // 预构建节点索引映射（在并行区域外完成）
    std::unordered_map<int, int> node_to_idx;
    for (int i = 0; i < n; ++i) {
        node_to_idx[nodes[i]] = i;
    }
    
    // 每个节点独立计算自己受到的吸引力（避免写冲突）
    // 使用 schedule(static) 确保确定性
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < n; ++i) {
        int node_i = nodes[i];
        const auto& neighbors = graph.neighbors(node_i);
        const auto& weights = graph.adj_weights[node_i];
        
        Position force_i(0, 0);
        
        // 按邻居顺序累加，确保浮点顺序一致
        for (size_t k = 0; k < neighbors.size(); ++k) {
            int node_j = neighbors[k];
            auto it = node_to_idx.find(node_j);
            if (it == node_to_idx.end()) continue;  // 邻居不在当前活跃节点中
            
            Position diff = graph.cells[node_j].pos - graph.cells[node_i].pos;
            double dist = diff.norm();
            if (dist < 0.01) continue;
            
            // Hooke's law: F = k * weight * d
            // 节点 i 被邻居 j 吸引
            double magnitude = k_attract * weights[k] * dist;
            force_i = force_i + diff.normalized() * magnitude;
        }
        
        forces[i] = forces[i] + force_i;
    }
}

void ForceDirectedEngine::compute_overlap_repulsion(
    const Graph& graph,
    const std::vector<int>& nodes,
    std::vector<Position>& forces,
    double k_repel
) {
    // 基于距离的平滑排斥力，防止 cells 重叠
    double k_overlap = config_.overlap_repulsion;
    double min_dist = config_.min_spacing;
    
    if (k_overlap <= 0 || min_dist <= 0) return;
    
    int n = static_cast<int>(nodes.size());
    
    // 每个节点独立计算受到的重叠排斥力（避免写冲突）
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < n; ++i) {
        int node_i = nodes[i];
        Position force_i(0, 0);
        
        // 按固定顺序 j=0,1,2,... 遍历，确保累加顺序一致
        for (int j = 0; j < n; ++j) {
            if (i == j) continue;
            int node_j = nodes[j];
            
            Position diff = graph.cells[node_i].pos - graph.cells[node_j].pos;
            double dist = diff.norm();
            
            // 当两个 cell 距离小于 min_spacing 时，施加强排斥力
            if (dist < min_dist && dist > 0.01) {
                double overlap_factor = (min_dist - dist) / min_dist;
                double force_magnitude = k_overlap * overlap_factor * k_repel;
                force_i = force_i + diff.normalized() * force_magnitude;
            }
        }
        
        forces[i] = forces[i] + force_i;
    }
}

void ForceDirectedEngine::compute_center_gravity(
    const Graph& graph,
    const std::vector<int>& nodes,
    std::vector<Position>& forces
) {
    if (config_.center_gravity <= 0) return;
    
    Position center(config_.die_width / 2, config_.die_height / 2);
    int n = static_cast<int>(nodes.size());
    
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < n; ++i) {
        Position to_center = center - graph.cells[nodes[i]].pos;
        forces[i] = forces[i] + to_center * config_.center_gravity;
    }
}

void ForceDirectedEngine::compute_global_attraction(
    const Graph& graph,
    const std::vector<int>& nodes,
    std::vector<Position>& forces
) {
    // 全局吸引力：让所有节点向质心靠拢，促进 clusters 融合
    if (config_.global_attraction <= 0) return;
    
    int n = static_cast<int>(nodes.size());
    if (n == 0) return;
    
    // 使用 OpenMP reduction 并行计算质心
    double cx = 0, cy = 0;
    #pragma omp parallel for reduction(+:cx,cy) schedule(static)
    for (int i = 0; i < n; ++i) {
        cx += graph.cells[nodes[i]].pos.x;
        cy += graph.cells[nodes[i]].pos.y;
    }
    cx /= n;
    cy /= n;
    Position centroid(cx, cy);
    
    // 并行计算每个节点受到的向质心的吸引力
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < n; ++i) {
        Position to_centroid = centroid - graph.cells[nodes[i]].pos;
        double dist = to_centroid.norm();
        if (dist > 0.01) {
            // 吸引力随距离增加（远的节点受更强吸引）
            forces[i] = forces[i] + to_centroid * config_.global_attraction * std::sqrt(dist);
        }
    }
}

void ForceDirectedEngine::run_layout(
    Graph& graph,
    const std::vector<int>& active_nodes,
    const std::unordered_set<int>& fixed_nodes,
    const std::unordered_map<int, double>& masses,
    int iterations
) {
    int n = static_cast<int>(active_nodes.size());
    if (n == 0) return;
    
    double k_repel = config_.repulsion_strength * 
        std::sqrt(config_.die_width * config_.die_height / n);
    double k_attract = config_.attraction_strength;
    
    double temperature = config_.die_width / 10;
    double cooling = temperature / (iterations + 1);
    
    std::vector<Position> forces(n);
    
    for (int iter = 0; iter < iterations; ++iter) {
        // Reset forces
        std::fill(forces.begin(), forces.end(), Position(0, 0));
        
        // Compute forces
        compute_repulsion(graph, active_nodes, forces, k_repel);
        compute_attraction(graph, active_nodes, forces, k_attract);
        compute_overlap_repulsion(graph, active_nodes, forces, k_repel);
        compute_center_gravity(graph, active_nodes, forces);
        compute_global_attraction(graph, active_nodes, forces);
        
        // Apply forces with mass-based damping
        for (int i = 0; i < n; ++i) {
            int node = active_nodes[i];
            
            // Skip fixed nodes
            if (fixed_nodes.find(node) != fixed_nodes.end()) continue;
            
            // Get mass
            double mass = 1.0;
            auto it = masses.find(node);
            if (it != masses.end()) mass = it->second;
            
            Position displacement = forces[i] / mass;
            double disp_norm = displacement.norm();
            
            if (disp_norm > 0.01) {
                // Limit by temperature
                displacement = displacement.normalized() * std::min(disp_norm, temperature);
                
                // Apply
                graph.cells[node].pos = graph.cells[node].pos + displacement;
                
                // Bound to die area
                graph.cells[node].pos.x = std::max(0.0, std::min(config_.die_width, graph.cells[node].pos.x));
                graph.cells[node].pos.y = std::max(0.0, std::min(config_.die_height, graph.cells[node].pos.y));
            }
        }
        
        temperature -= cooling;
    }
}

// ============================================================================
// HAnchorCore Implementation
// ============================================================================

HAnchorCore::HAnchorCore(const PlacementConfig& config) : config_(config) {}

void HAnchorCore::load_graph(
    const std::vector<std::string>& node_names,
    const std::vector<double>& node_widths,
    const std::vector<double>& node_heights,
    const std::vector<int>& edge_from,
    const std::vector<int>& edge_to,
    const std::vector<double>& edge_weights
) {
    graph_ = Graph();
    
    // Add nodes
    for (size_t i = 0; i < node_names.size(); ++i) {
        double w = (i < node_widths.size()) ? node_widths[i] : 1.0;
        double h = (i < node_heights.size()) ? node_heights[i] : 1.0;
        graph_.add_node(node_names[i], w, h);
    }
    
    // Add edges
    for (size_t i = 0; i < edge_from.size(); ++i) {
        double weight = (i < edge_weights.size()) ? edge_weights[i] : 1.0;
        graph_.add_edge(edge_from[i], edge_to[i], weight);
    }
    
    graph_.build_adjacency();
}

void HAnchorCore::run() {
    auto start = std::chrono::high_resolution_clock::now();
    
    std::cout << "\n================================================" << std::endl;
    std::cout << "H-Anchor Core (C++)" << std::endl;
    std::cout << "================================================" << std::endl;
    std::cout << "Nodes: " << graph_.num_nodes() << ", Edges: " << graph_.num_edges() << std::endl;
    
    // Phase 1: Hierarchy Construction
    std::cout << "\nPhase 1: Constructing Hierarchy..." << std::endl;
    construct_hierarchy();
    
    // Print layer stats
    std::cout << "Layers: ";
    for (size_t i = 0; i < layers_.size(); ++i) {
        std::cout << layers_[i].size();
        if (i < layers_.size() - 1) std::cout << " -> ";
    }
    std::cout << std::endl;
    
    // Phase 2A: Top Layer Placement
    std::cout << "\nPhase 2A: Placing Top Layer..." << std::endl;
    place_top_layer();
    
    // Phase 2B: Descend and Refine
    std::cout << "\nPhase 2B: Recursive Descent..." << std::endl;
    descend_and_refine();
    
    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    
    std::cout << "\nPlacement complete!" << std::endl;
    std::cout << "HPWL: " << get_hpwl() << std::endl;
    std::cout << "Time: " << duration.count() / 1000.0 << " seconds" << std::endl;
}

void HAnchorCore::construct_hierarchy() {
    HierarchyBuilder builder(graph_, config_);
    builder.compute_scores();
    builder.build_layers();
    layers_ = builder.get_layers();
}

void HAnchorCore::place_top_layer() {
    if (layers_.empty()) return;
    
    const auto& top_nodes = layers_[0];
    
    // 使用 spread_factor 控制初始分布范围
    // spread_factor=1.0 表示整个 die，0.5 表示中心 50% 区域
    double sf = config_.spread_factor;
    double margin_x = config_.die_width * (1.0 - sf) / 2.0;
    double margin_y = config_.die_height * (1.0 - sf) / 2.0;
    double range_x = config_.die_width * sf;
    double range_y = config_.die_height * sf;
    
    // Initialize with random positions within spread range
    std::mt19937 rng(42);
    std::uniform_real_distribution<double> dist_x(margin_x, margin_x + range_x);
    std::uniform_real_distribution<double> dist_y(margin_y, margin_y + range_y);
    
    for (int node : top_nodes) {
        graph_.cells[node].pos.x = dist_x(rng);
        graph_.cells[node].pos.y = dist_y(rng);
    }
    
    // Run force-directed on top layer
    ForceDirectedEngine engine(config_);
    engine.run_layout(
        graph_,
        top_nodes,
        {},  // No fixed nodes
        {},  // Equal masses
        config_.top_layer_iterations
    );
}

void HAnchorCore::descend_and_refine() {
    for (size_t layer_idx = 1; layer_idx < layers_.size(); ++layer_idx) {
        const auto& current_layer = layers_[layer_idx];
        const auto& prev_layer = layers_[layer_idx - 1];
        
        // Find new nodes (in current but not in previous)
        std::unordered_set<int> prev_set(prev_layer.begin(), prev_layer.end());
        std::vector<int> new_nodes;
        for (int node : current_layer) {
            if (prev_set.find(node) == prev_set.end()) {
                new_nodes.push_back(node);
            }
        }
        
        std::cout << "Layer " << layer_idx << ": Inserting " << new_nodes.size() << " new cells..." << std::endl;
        
        // Project new nodes
        project_new_nodes(new_nodes, prev_set);
        
        // Refine layer
        refine_layer(current_layer, prev_set);
    }
}

void HAnchorCore::project_new_nodes(
    const std::vector<int>& new_nodes,
    const std::unordered_set<int>& anchors
) {
    std::mt19937 rng(42);
    std::normal_distribution<double> jitter(0, config_.jitter_scale);
    
    for (int node : new_nodes) {
        const auto& neighbors = graph_.neighbors(node);
        const auto& weights = graph_.adj_weights[node];
        
        // Find placed neighbors
        double total_weight = 0;
        double avg_x = 0, avg_y = 0;
        
        for (size_t i = 0; i < neighbors.size(); ++i) {
            int neighbor = neighbors[i];
            if (anchors.find(neighbor) != anchors.end() || 
                graph_.cells[neighbor].pos.x != 0 || graph_.cells[neighbor].pos.y != 0) {
                double w = weights[i];
                avg_x += graph_.cells[neighbor].pos.x * w;
                avg_y += graph_.cells[neighbor].pos.y * w;
                total_weight += w;
            }
        }
        
        if (total_weight > 0) {
            graph_.cells[node].pos.x = avg_x / total_weight + jitter(rng);
            graph_.cells[node].pos.y = avg_y / total_weight + jitter(rng);
        } else {
            // Random near center
            graph_.cells[node].pos.x = config_.die_width / 2 + jitter(rng) * 10;
            graph_.cells[node].pos.y = config_.die_height / 2 + jitter(rng) * 10;
        }
        
        // Bound to die
        graph_.cells[node].pos.x = std::max(0.0, std::min(config_.die_width, graph_.cells[node].pos.x));
        graph_.cells[node].pos.y = std::max(0.0, std::min(config_.die_height, graph_.cells[node].pos.y));
    }
}

void HAnchorCore::refine_layer(
    const std::vector<int>& current_nodes,
    const std::unordered_set<int>& anchors
) {
    // Anchors have higher mass
    std::unordered_map<int, double> masses;
    for (int node : current_nodes) {
        if (anchors.find(node) != anchors.end()) {
            masses[node] = config_.anchor_mass_factor;
        } else {
            masses[node] = 1.0;
        }
    }
    
    ForceDirectedEngine engine(config_);
    engine.run_layout(
        graph_,
        current_nodes,
        {},  // No completely fixed nodes
        masses,
        config_.refinement_iterations
    );
}

std::vector<double> HAnchorCore::get_positions_x() const {
    std::vector<double> result;
    result.reserve(graph_.cells.size());
    for (const auto& cell : graph_.cells) {
        result.push_back(cell.pos.x);
    }
    return result;
}

std::vector<double> HAnchorCore::get_positions_y() const {
    std::vector<double> result;
    result.reserve(graph_.cells.size());
    for (const auto& cell : graph_.cells) {
        result.push_back(cell.pos.y);
    }
    return result;
}

std::vector<int> HAnchorCore::get_layer_sizes() const {
    std::vector<int> result;
    for (const auto& layer : layers_) {
        result.push_back(static_cast<int>(layer.size()));
    }
    return result;
}

std::vector<std::vector<int>> HAnchorCore::get_layers() const {
    return layers_;
}

double HAnchorCore::get_hpwl() const {
    double total = 0;
    for (const auto& edge : graph_.edges) {
        const auto& p1 = graph_.cells[edge.from].pos;
        const auto& p2 = graph_.cells[edge.to].pos;
        total += (std::abs(p1.x - p2.x) + std::abs(p1.y - p2.y)) * edge.weight;
    }
    return total;
}

// ============================================================================
// Incremental Update Implementation
// ============================================================================

int HAnchorCore::get_node_layer(int node_idx) const {
    if (node_idx < 0 || node_idx >= graph_.num_nodes()) return -1;
    return graph_.cells[node_idx].layer;
}

std::unordered_set<int> HAnchorCore::find_affected_region(
    const std::vector<int>& seed_nodes,
    int radius
) {
    // BFS to find all nodes within 'radius' hops of seed nodes
    std::unordered_set<int> affected;
    std::queue<std::pair<int, int>> queue;  // (node, distance)
    
    for (int seed : seed_nodes) {
        if (seed >= 0 && seed < graph_.num_nodes()) {
            queue.push({seed, 0});
            affected.insert(seed);
        }
    }
    
    while (!queue.empty()) {
        auto [node, dist] = queue.front();
        queue.pop();
        
        if (dist >= radius) continue;
        
        for (int neighbor : graph_.neighbors(node)) {
            if (affected.find(neighbor) == affected.end()) {
                affected.insert(neighbor);
                queue.push({neighbor, dist + 1});
            }
        }
    }
    
    return affected;
}

void HAnchorCore::local_optimize(
    const std::unordered_set<int>& affected_nodes,
    const std::unordered_set<int>& fixed_boundary,
    int iterations
) {
    if (affected_nodes.empty()) return;
    
    // Convert to vector for force engine
    std::vector<int> active_nodes(affected_nodes.begin(), affected_nodes.end());
    
    // Assign masses based on layer level
    // Higher layer (smaller index) = more mass = less movement
    std::unordered_map<int, double> masses;
    for (int node : active_nodes) {
        int layer = graph_.cells[node].layer;
        if (layer < 0) layer = static_cast<int>(layers_.size()) - 1;
        
        // Layer 0 (top) has highest mass, bottom layer has mass 1.0
        double layer_factor = 1.0 + (layers_.size() - 1 - layer) * 0.5;
        masses[node] = layer_factor;
    }
    
    ForceDirectedEngine engine(config_);
    engine.run_layout(graph_, active_nodes, fixed_boundary, masses, iterations);
}

double HAnchorCore::compute_node_score(int node_idx) const {
    // Simple degree-based score for incremental updates
    if (node_idx < 0 || node_idx >= graph_.num_nodes()) return 0.0;
    
    double degree = static_cast<double>(graph_.neighbors(node_idx).size());
    double max_degree = 1.0;
    for (const auto& cell : graph_.cells) {
        max_degree = std::max(max_degree, static_cast<double>(graph_.neighbors(cell.id).size()));
    }
    
    return degree / max_degree;
}

void HAnchorCore::assign_layer_to_new_nodes(const std::vector<int>& new_nodes) {
    // Assign new nodes to the bottom layer by default,
    // unless they have very high connectivity (then higher layer)
    int bottom_layer = static_cast<int>(layers_.size()) - 1;
    
    for (int node : new_nodes) {
        double score = compute_node_score(node);
        graph_.cells[node].score = score;
        
        // Determine layer based on score
        // High score -> higher layer (smaller index)
        int assigned_layer = bottom_layer;
        for (int l = 0; l < static_cast<int>(layers_.size()); ++l) {
            // Check if score is high enough for this layer
            double threshold = 1.0 - (l + 1.0) / layers_.size();
            if (score >= threshold) {
                assigned_layer = l;
                break;
            }
        }
        
        graph_.cells[node].layer = assigned_layer;
        
        // Add to appropriate layer
        if (assigned_layer < static_cast<int>(layers_.size())) {
            layers_[assigned_layer].push_back(node);
        }
    }
}

void HAnchorCore::incremental_update_positions(
    const std::vector<int>& node_indices,
    const std::vector<double>& new_x,
    const std::vector<double>& new_y,
    int propagation_radius
) {
    std::cout << "Incremental position update: " << node_indices.size() << " nodes" << std::endl;
    
    // Step 1: Calculate displacement vectors for each moved node
    std::vector<std::pair<double, double>> displacements(node_indices.size());
    for (size_t i = 0; i < node_indices.size(); ++i) {
        int idx = node_indices[i];
        if (idx >= 0 && idx < graph_.num_nodes()) {
            double old_x = graph_.cells[idx].pos.x;
            double old_y = graph_.cells[idx].pos.y;
            displacements[i] = {new_x[i] - old_x, new_y[i] - old_y};
            
            // Set new position for moved node
            graph_.cells[idx].pos.x = new_x[i];
            graph_.cells[idx].pos.y = new_y[i];
        }
    }
    
    if (propagation_radius <= 0) {
        // No propagation, just move the specified nodes
        std::cout << "  Affected region: " << node_indices.size() << " nodes" << std::endl;
        std::cout << "  HPWL after update: " << get_hpwl() << std::endl;
        return;
    }
    
    // Step 2: Ripple propagation (like water waves)
    // Use BFS to propagate displacement with decay
    std::unordered_set<int> moved_set(node_indices.begin(), node_indices.end());
    std::unordered_map<int, int> node_hop;  // node -> hop distance from moved nodes
    std::unordered_map<int, std::pair<double, double>> node_displacement;  // accumulated displacement
    
    // Initialize with moved nodes
    std::queue<int> bfs_queue;
    for (size_t i = 0; i < node_indices.size(); ++i) {
        int idx = node_indices[i];
        node_hop[idx] = 0;
        node_displacement[idx] = displacements[i];
        
        // Add neighbors to queue
        for (int neighbor : graph_.neighbors(idx)) {
            if (moved_set.find(neighbor) == moved_set.end() && node_hop.find(neighbor) == node_hop.end()) {
                node_hop[neighbor] = 1;
                bfs_queue.push(neighbor);
            }
        }
    }
    
    // BFS propagation
    while (!bfs_queue.empty()) {
        int current = bfs_queue.front();
        bfs_queue.pop();
        
        // Skip port nodes (they should maintain fixed boundary positions)
        const std::string& cell_name = graph_.cells[current].name;
        if (cell_name.find("__port__") == 0) {
            continue;
        }
        
        int hop = node_hop[current];
        
        // Calculate weighted average displacement from neighbors that are closer to source
        double total_dx = 0.0, total_dy = 0.0;
        double total_weight = 0.0;
        
        for (int neighbor : graph_.neighbors(current)) {
            auto it = node_hop.find(neighbor);
            if (it != node_hop.end() && it->second < hop) {
                // This neighbor is closer to the source
                auto disp_it = node_displacement.find(neighbor);
                if (disp_it != node_displacement.end()) {
                    // Weight by edge weight if available
                    double edge_weight = 1.0;
                    for (const auto& edge : graph_.edges) {
                        if ((edge.from == current && edge.to == neighbor) ||
                            (edge.from == neighbor && edge.to == current)) {
                            edge_weight = edge.weight;
                            break;
                        }
                    }
                    total_dx += disp_it->second.first * edge_weight;
                    total_dy += disp_it->second.second * edge_weight;
                    total_weight += edge_weight;
                }
            }
        }
        
        if (total_weight > 0) {
            // Decay factor: displacement decreases with hop distance
            // decay = 1 / (1 + hop * decay_rate)^2
            // This creates a gentle ripple effect with quadratic decay
            double decay_rate = 3.0;  // Higher = faster decay
            double base_decay = 1.0 / (1.0 + hop * decay_rate);
            double decay = base_decay * base_decay;  // Quadratic decay for smoother falloff
            
            double avg_dx = (total_dx / total_weight) * decay;
            double avg_dy = (total_dy / total_weight) * decay;
            
            // Store displacement for this node
            node_displacement[current] = {avg_dx, avg_dy};
            
            // Apply displacement (with bounds checking)
            double new_px = graph_.cells[current].pos.x + avg_dx;
            double new_py = graph_.cells[current].pos.y + avg_dy;
            
            // Clamp to die area
            new_px = std::max(0.0, std::min(config_.die_width, new_px));
            new_py = std::max(0.0, std::min(config_.die_height, new_py));
            
            graph_.cells[current].pos.x = new_px;
            graph_.cells[current].pos.y = new_py;
        }
        
        // Add next hop neighbors to queue
        if (hop < propagation_radius) {
            for (int neighbor : graph_.neighbors(current)) {
                if (node_hop.find(neighbor) == node_hop.end()) {
                    node_hop[neighbor] = hop + 1;
                    bfs_queue.push(neighbor);
                }
            }
        }
    }
    
    std::cout << "  Affected region: " << node_hop.size() << " nodes (ripple propagation)" << std::endl;
    std::cout << "  HPWL after update: " << get_hpwl() << std::endl;
}

int HAnchorCore::incremental_add_nodes(
    const std::vector<std::string>& node_names,
    const std::vector<double>& node_widths,
    const std::vector<double>& node_heights,
    const std::vector<int>& edge_from,
    const std::vector<int>& edge_to,
    const std::vector<double>& edge_weights
) {
    int start_idx = graph_.num_nodes();
    std::cout << "Incremental add: " << node_names.size() << " nodes, " 
              << edge_from.size() << " edges" << std::endl;
    
    // Step 1: Add new nodes
    std::vector<int> new_node_indices;
    for (size_t i = 0; i < node_names.size(); ++i) {
        double w = (i < node_widths.size()) ? node_widths[i] : 1.0;
        double h = (i < node_heights.size()) ? node_heights[i] : 1.0;
        graph_.add_node(node_names[i], w, h);
        new_node_indices.push_back(start_idx + static_cast<int>(i));
    }
    
    // Step 2: Add new edges
    for (size_t i = 0; i < edge_from.size(); ++i) {
        double weight = (i < edge_weights.size()) ? edge_weights[i] : 1.0;
        graph_.add_edge(edge_from[i], edge_to[i], weight);
    }
    
    // Step 3: Rebuild adjacency
    graph_.build_adjacency();
    
    // Step 4: Assign layers to new nodes
    assign_layer_to_new_nodes(new_node_indices);
    
    // Step 5: Project new nodes to weighted center of neighbors
    std::unordered_set<int> existing_nodes;
    for (int i = 0; i < start_idx; ++i) {
        existing_nodes.insert(i);
    }
    project_new_nodes(new_node_indices, existing_nodes);
    
    // Step 6: Find affected region and optimize
    auto affected = find_affected_region(new_node_indices, 2);
    std::unordered_set<int> boundary;
    for (int node : affected) {
        for (int neighbor : graph_.neighbors(node)) {
            if (affected.find(neighbor) == affected.end()) {
                boundary.insert(neighbor);
            }
        }
    }
    
    local_optimize(affected, boundary, config_.refinement_iterations / 2);
    
    std::cout << "  HPWL after add: " << get_hpwl() << std::endl;
    return start_idx;
}

std::unordered_map<int, int> HAnchorCore::incremental_remove_nodes(
    const std::vector<int>& node_indices
) {
    std::cout << "Incremental remove: " << node_indices.size() << " nodes" << std::endl;
    
    // Find affected region before removal
    auto affected = find_affected_region(node_indices, 2);
    
    // Remove the nodes being deleted from affected set
    for (int node : node_indices) {
        affected.erase(node);
    }
    
    // Track which nodes to remove
    std::unordered_set<int> to_remove(node_indices.begin(), node_indices.end());
    
    // Check if any removed nodes are high-level anchors
    bool high_level_removal = false;
    for (int node : node_indices) {
        if (node >= 0 && node < graph_.num_nodes()) {
            int layer = graph_.cells[node].layer;
            if (layer >= 0 && layer <= 2) {  // Top 3 layers
                high_level_removal = true;
                std::cout << "  Warning: Removing high-level anchor (layer " << layer << ")" << std::endl;
            }
        }
    }
    
    // Build new graph without removed nodes
    std::vector<Cell> new_cells;
    std::unordered_map<int, int> old_to_new;
    
    for (int i = 0; i < graph_.num_nodes(); ++i) {
        if (to_remove.find(i) == to_remove.end()) {
            int new_idx = static_cast<int>(new_cells.size());
            old_to_new[i] = new_idx;
            
            Cell cell = graph_.cells[i];
            cell.id = new_idx;
            new_cells.push_back(cell);
        }
    }
    
    // Build new edges (skip edges involving removed nodes)
    std::vector<Edge> new_edges;
    for (const auto& edge : graph_.edges) {
        if (to_remove.find(edge.from) == to_remove.end() &&
            to_remove.find(edge.to) == to_remove.end()) {
            Edge new_edge;
            new_edge.from = old_to_new[edge.from];
            new_edge.to = old_to_new[edge.to];
            new_edge.weight = edge.weight;
            new_edges.push_back(new_edge);
        }
    }
    
    // Replace graph
    graph_.cells = new_cells;
    graph_.edges = new_edges;
    graph_.build_adjacency();
    
    // Update layers with new indices
    for (auto& layer : layers_) {
        std::vector<int> new_layer;
        for (int node : layer) {
            auto it = old_to_new.find(node);
            if (it != old_to_new.end()) {
                new_layer.push_back(it->second);
            }
        }
        layer = new_layer;
    }
    
    // Remap affected set to new indices
    std::unordered_set<int> new_affected;
    for (int node : affected) {
        auto it = old_to_new.find(node);
        if (it != old_to_new.end()) {
            new_affected.insert(it->second);
        }
    }
    
    // If high-level anchor removed, do more extensive optimization
    int iterations = high_level_removal ? config_.refinement_iterations : config_.refinement_iterations / 2;
    
    // Find boundary
    std::unordered_set<int> boundary;
    for (int node : new_affected) {
        for (int neighbor : graph_.neighbors(node)) {
            if (new_affected.find(neighbor) == new_affected.end()) {
                boundary.insert(neighbor);
            }
        }
    }
    
    local_optimize(new_affected, boundary, iterations);
    
    std::cout << "  Nodes remaining: " << graph_.num_nodes() << std::endl;
    std::cout << "  HPWL after remove: " << get_hpwl() << std::endl;
    
    return old_to_new;
}

void HAnchorCore::incremental_add_edges(
    const std::vector<int>& edge_from,
    const std::vector<int>& edge_to,
    const std::vector<double>& edge_weights
) {
    std::cout << "Incremental add edges: " << edge_from.size() << " edges" << std::endl;
    
    // Collect affected nodes
    std::vector<int> affected_list;
    for (size_t i = 0; i < edge_from.size(); ++i) {
        int from = edge_from[i];
        int to = edge_to[i];
        double weight = (i < edge_weights.size()) ? edge_weights[i] : 1.0;
        
        if (from >= 0 && from < graph_.num_nodes() &&
            to >= 0 && to < graph_.num_nodes()) {
            graph_.add_edge(from, to, weight);
            affected_list.push_back(from);
            affected_list.push_back(to);
        }
    }
    
    // Rebuild adjacency
    graph_.build_adjacency();
    
    // Optimize around affected nodes
    auto affected = find_affected_region(affected_list, 1);
    std::unordered_set<int> boundary;
    for (int node : affected) {
        for (int neighbor : graph_.neighbors(node)) {
            if (affected.find(neighbor) == affected.end()) {
                boundary.insert(neighbor);
            }
        }
    }
    
    local_optimize(affected, boundary, config_.refinement_iterations / 3);
    
    std::cout << "  HPWL after add edges: " << get_hpwl() << std::endl;
}

void HAnchorCore::incremental_remove_edges(
    const std::vector<int>& edge_from,
    const std::vector<int>& edge_to
) {
    std::cout << "Incremental remove edges: " << edge_from.size() << " edges" << std::endl;
    
    // Create set of edges to remove
    std::set<std::pair<int, int>> to_remove;
    std::vector<int> affected_list;
    
    for (size_t i = 0; i < edge_from.size(); ++i) {
        int from = edge_from[i];
        int to = edge_to[i];
        to_remove.insert({std::min(from, to), std::max(from, to)});
        affected_list.push_back(from);
        affected_list.push_back(to);
    }
    
    // Filter edges
    std::vector<Edge> new_edges;
    for (const auto& edge : graph_.edges) {
        auto key = std::make_pair(std::min(edge.from, edge.to), std::max(edge.from, edge.to));
        if (to_remove.find(key) == to_remove.end()) {
            new_edges.push_back(edge);
        }
    }
    
    graph_.edges = new_edges;
    graph_.build_adjacency();
    
    // Optimize around affected nodes
    auto affected = find_affected_region(affected_list, 1);
    std::unordered_set<int> boundary;
    for (int node : affected) {
        for (int neighbor : graph_.neighbors(node)) {
            if (affected.find(neighbor) == affected.end()) {
                boundary.insert(neighbor);
            }
        }
    }
    
    local_optimize(affected, boundary, config_.refinement_iterations / 3);
    
    std::cout << "  HPWL after remove edges: " << get_hpwl() << std::endl;
}

}  // namespace hanchor

