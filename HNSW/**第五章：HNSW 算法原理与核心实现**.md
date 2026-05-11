##

### **5.1 HNSW 算法概述**

#### **5.1.1 算法背景**

HNSW（Hierarchical Navigable Small World）是目前最先进的近似最近邻（ANN）搜索算法之一，由Malkov和Yashunin在2018年提出。它结合了：

- **小世界网络理论**：利用"六度分离"现象进行快速导航
- **分层结构**：通过多层索引提高搜索效率
- **跳表思想**：高层稀疏、底层密集的层次结构

#### **5.1.2 核心思想**

![](https://developer.qcloudimg.com/http-save/yehe-4456907/ab8285813828bce3fec7ca4e59203379.png)

#### **5.1.3 算法优势**

1. **搜索效率高**：时间复杂度O(log N)
2. **插入删除友好**：支持动态更新
3. **内存效率**：相比LSH等方法更节省内存
4. **参数简单**：只需调整少量参数

### **5.2 数学理论基础**

#### **5.2.1 小世界网络特性**

小世界网络具有以下重要特性：

- **高聚类系数**：邻居节点之间连接密度高
- **短平均路径长度**：任意两点间距离较短
- **度分布**：节点连接数遵循特定分布

#### **5.2.2 层级分配算法**

每个节点的层级按照以下概率分布确定：

其中

是自然对数，这确保了：

- 大部分节点在底层（level 0）
- 高层节点数量指数递减

#### **5.2.3 连接数量控制**

- **M**：每层的目标连接数
- **maxM**：第0层的最大连接数（通常为）
- **efConstruction**：构建时的候选集大小

### **5.3 HNSW节点设计**

#### **5.3.1 节点数据结构**

代码语言：javascript

```javascript
package com.jvector.index;

import com.jvector.core.Vector;
import java.io.Serializable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Set;
import java.util.Map;

/**
 * HNSW网络中的节点
 */
public class HnswNode implements Serializable {
    private static final long serialVersionUID = 1L;

    private final long id;
    private final Vector vector;
    private final int level;

    // 每层的连接关系，使用ConcurrentHashMap确保线程安全
    private final Map<Integer, Set<Long>> connections;

    public HnswNode(long id, Vector vector, int level) {
        this.id = id;
        this.vector = vector;
        this.level = level;
        this.connections = new ConcurrentHashMap<>();

        // 初始化每层的连接集合
        for (int i = 0; i <= level; i++) {
            connections.put(i, ConcurrentHashMap.newKeySet());
        }
    }

    /**
     * 获取节点ID
     */
    public long getId() {
        return id;
    }

    /**
     * 获取节点向量
     */
    public Vector getVector() {
        return vector;
    }

    /**
     * 获取节点层级
     */
    public int getLevel() {
        return level;
    }

    /**
     * 获取指定层的连接
     */
    public Set<Long> getConnections(int layerLevel) {
        return connections.get(layerLevel);
    }

    /**
     * 添加连接
     */
    public void addConnection(int layerLevel, long nodeId) {
        Set<Long> layerConnections = connections.get(layerLevel);
        if (layerConnections != null) {
            layerConnections.add(nodeId);
        }
    }

    /**
     * 移除连接
     */
    public void removeConnection(int layerLevel, long nodeId) {
        Set<Long> layerConnections = connections.get(layerLevel);
        if (layerConnections != null) {
            layerConnections.remove(nodeId);
        }
    }

    /**
     * 获取指定层的连接数量
     */
    public int getConnectionCount(int layerLevel) {
        Set<Long> layerConnections = connections.get(layerLevel);
        return layerConnections != null ? layerConnections.size() : 0;
    }
}
```

#### **5.3.2 节点层级分配**

代码语言：javascript

```javascript
/**
 * 分配节点层级
 * 使用指数分布确保层级的合理分布
 */
private int assignLevel() {
    double levelMultiplier = 1.0 / Math.log(2.0);
    Random random = new Random(seed);

    // 使用指数分布生成层级
    int level = (int) (-Math.log(random.nextDouble()) * levelMultiplier);

    // 限制最大层级
    return Math.min(level, maxLevel);
}
```

### **5.4 索引构建算法**

#### **5.4.1 插入算法流程**

代码语言：javascript

```javascript
/**
 * 添加向量到索引
 */
public void add(long id, Vector vector) {
    ensureLockInitialized();
    globalLock.writeLock().lock();
    try {
        if (nodes.containsKey(id)) {
            throw new IllegalArgumentException("Vector with id " + id + " already exists");
        }

        // 1. 分配层级
        int nodeLevel = assignLevel();
        HnswNode newNode = new HnswNode(id, vector, nodeLevel);
        nodes.put(id, newNode);

        // 2. 如果是第一个节点，设为入口点
        if (entryPointId == null) {
            entryPointId = id;
            return;
        }

        // 3. 从顶层搜索到新节点层级
        List<SearchResult> entryPoints = searchLayerEf(vector, entryPointId, 1, nodeLevel + 1);

        // 4. 在每一层建立连接
        for (int level = Math.min(nodeLevel, getEntryPointLevel()); level >= 0; level--) {
            List<SearchResult> candidates = searchLayerEf(vector, entryPoints.get(0).getId(), efConstruction, level);

            // 选择最优连接
            int levelM = (level == 0) ? maxM : M;
            connectNewNode(newNode, candidates, level, levelM);

            // 更新入口点为当前层的最佳候选
            entryPoints = candidates.subList(0, Math.min(1, candidates.size()));
        }

        // 5. 更新全局入口点
        if (nodeLevel > getEntryPointLevel()) {
            entryPointId = id;
        }

    } finally {
        globalLock.writeLock().unlock();
    }
}
```

#### **5.4.2 连接建立算法**

代码语言：javascript

```javascript
/**
 * 为新节点建立连接
 */
private void connectNewNode(HnswNode newNode, List<SearchResult> candidates, int level, int m) {
    // 按距离排序候选节点
    candidates.sort(Comparator.comparingDouble(SearchResult::getDistance));

    // 选择前M个作为连接
    List<SearchResult> selectedConnections = selectBestConnections(candidates, m);

    // 建立双向连接
    for (SearchResult result : selectedConnections) {
        long candidateId = result.getId();

        // 新节点连接到候选节点
        newNode.addConnection(level, candidateId);

        // 候选节点连接到新节点
        HnswNode candidateNode = nodes.get(candidateId);
        if (candidateNode != null) {
            candidateNode.addConnection(level, newNode.getId());

            // 如果候选节点连接数超限，需要剪枝
            if (candidateNode.getConnectionCount(level) > m) {
                pruneConnections(candidateNode, level, m);
            }
        }
    }
}

/**
 * 选择最佳连接（启发式算法）
 */
private List<SearchResult> selectBestConnections(List<SearchResult> candidates, int m) {
    if (candidates.size() <= m) {
        return new ArrayList<>(candidates);
    }

    List<SearchResult> selected = new ArrayList<>();
    List<SearchResult> remaining = new ArrayList<>(candidates);

    // 贪心选择算法：优先选择距离近且不冗余的连接
    while (selected.size() < m && !remaining.isEmpty()) {
        SearchResult best = null;
        double bestScore = Double.NEGATIVE_INFINITY;

        for (SearchResult candidate : remaining) {
            double score = calculateConnectionScore(candidate, selected);
            if (score > bestScore) {
                bestScore = score;
                best = candidate;
            }
        }

        if (best != null) {
            selected.add(best);
            remaining.remove(best);
        }
    }

    return selected;
}

/**
 * 计算连接得分（距离 + 多样性）
 */
private double calculateConnectionScore(SearchResult candidate, List<SearchResult> selected) {
    double distanceScore = 1.0 / (1.0 + candidate.getDistance());

    // 计算与已选择节点的多样性
    double diversityScore = 1.0;
    if (!selected.isEmpty()) {
        float minDistance = Float.MAX_VALUE;
        for (SearchResult s : selected) {
            float dist = computeEngine.distance(
                candidate.getVector().getData(),
                s.getVector().getData(),
                distanceMetric
            );
            minDistance = Math.min(minDistance, dist);
        }
        diversityScore = minDistance;
    }

    return distanceScore * diversityScore;
}
```

### **5.5 搜索算法实现**

#### **5.5.1 多层搜索策略**

代码语言：javascript

```javascript
/**
 * 在指定层搜索最近邻
 */
private List<SearchResult> searchLayerEf(Vector query, Long entryId, int efLocal, int targetLevel) {
    Set<Long> visited = new HashSet<>();

    // 使用优先队列维护候选集
    PriorityQueue<SearchResult> candidates = new PriorityQueue<>(
        Comparator.comparingDouble(SearchResult::getDistance));

    PriorityQueue<SearchResult> dynamicList = new PriorityQueue<>(
        Comparator.comparingDouble(SearchResult::getDistance).reversed());

    // 初始化入口点
    HnswNode entryNode = nodes.get(entryId);
    if (entryNode == null) {
        return Collections.emptyList();
    }

    float distance = computeEngine.distance(
        query.getData(),
        entryNode.getVector().getData(),
        distanceMetric
    );

    SearchResult entryResult = new SearchResult(entryId, distance, entryNode.getVector());
    candidates.add(entryResult);
    dynamicList.add(entryResult);
    visited.add(entryId);

    // 贪心搜索
    while (!candidates.isEmpty()) {
        SearchResult current = candidates.poll();

        // 如果当前距离大于动态列表中的最远距离，停止搜索
        if (dynamicList.size() >= efLocal &&
            current.getDistance() > dynamicList.peek().getDistance()) {
            break;
        }

        // 检查当前节点的所有邻居
        HnswNode currentNode = nodes.get(current.getId());
        Set<Long> connections = currentNode.getConnections(targetLevel);

        if (connections != null) {
            for (Long neighborId : connections) {
                if (!visited.contains(neighborId)) {
                    visited.add(neighborId);

                    HnswNode neighborNode = nodes.get(neighborId);
                    if (neighborNode != null) {
                        float neighborDistance = computeEngine.distance(
                            query.getData(),
                            neighborNode.getVector().getData(),
                            distanceMetric
                        );

                        SearchResult neighborResult = new SearchResult(
                            neighborId, neighborDistance, neighborNode.getVector());

                        // 如果发现更好的候选或动态列表未满，加入候选集
                        if (dynamicList.size() < efLocal ||
                            neighborDistance < dynamicList.peek().getDistance()) {

                            candidates.add(neighborResult);
                            dynamicList.add(neighborResult);

                            // 保持动态列表大小
                            if (dynamicList.size() > efLocal) {
                                dynamicList.poll();
                            }
                        }
                    }
                }
            }
        }
    }

    // 返回结果
    List<SearchResult> results = new ArrayList<>(dynamicList);
    results.sort(Comparator.comparingDouble(SearchResult::getDistance));
    return results;
}
```

#### **5.5.2 完整搜索流程**

代码语言：javascript

```javascript
/**
 * 搜索K个最近邻
 */
public List<SearchResult> search(Vector query, int k, int searchEf) {
    ensureLockInitialized();
    globalLock.readLock().lock();
    try {
        if (entryPointId == null) {
            return Collections.emptyList();
        }

        HnswNode entryPoint = nodes.get(entryPointId);
        Long currentEntry = entryPointId;

        // 阶段1：从顶层搜索到第1层，每层只保留1个最佳候选
        for (int level = entryPoint.getLevel(); level > 0; level--) {
            List<SearchResult> results = searchLayerEf(query, currentEntry, 1, level);
            if (!results.isEmpty()) {
                currentEntry = results.get(0).getId();
            }
        }

        // 阶段2：在第0层进行详细搜索
        List<SearchResult> finalResults = searchLayerEf(query, currentEntry,
                                                       Math.max(searchEf, k), 0);

        // 返回前K个结果
        finalResults.sort(Comparator.comparingDouble(SearchResult::getDistance));
        return finalResults.subList(0, Math.min(k, finalResults.size()));

    } finally {
        globalLock.readLock().unlock();
    }
}
```

### **5.6 连接剪枝算法**

#### **5.6.1 剪枝策略**

代码语言：javascript

```javascript
/**
 * 剪枝连接，保持连接质量
 */
private void pruneConnections(HnswNode node, int level, int maxConnections) {
    Set<Long> connections = node.getConnections(level);
    if (connections.size() <= maxConnections) {
        return;
    }

    // 收集所有连接的距离信息
    List<SearchResult> connectionResults = new ArrayList<>();
    for (Long connId : connections) {
        HnswNode connNode = nodes.get(connId);
        if (connNode != null) {
            float distance = computeEngine.distance(
                node.getVector().getData(),
                connNode.getVector().getData(),
                distanceMetric
            );
            connectionResults.add(new SearchResult(connId, distance, connNode.getVector()));
        }
    }

    // 使用启发式算法选择保留的连接
    List<SearchResult> toKeep = selectBestConnections(connectionResults, maxConnections);

    // 更新连接
    connections.clear();
    for (SearchResult result : toKeep) {
        connections.add(result.getId());
    }
}
```

### **5.7 删除操作实现**

#### **5.7.1 节点删除算法**

代码语言：javascript

```javascript
/**
 * 删除指定ID的向量
 */
public boolean remove(long id) {
    ensureLockInitialized();
    globalLock.writeLock().lock();
    try {
        HnswNode nodeToRemove = nodes.get(id);
        if (nodeToRemove == null) {
            return false;
        }

        // 1. 移除所有连接关系
        removeNodeConnections(nodeToRemove);

        // 2. 从节点映射中删除
        nodes.remove(id);

        // 3. 如果删除的是入口点，需要更新入口点
        if (entryPointId != null && entryPointId.equals(id)) {
            updateEntryPoint();
        }

        return true;

    } finally {
        globalLock.writeLock().unlock();
    }
}

/**
 * 移除节点的所有连接
 */
private void removeNodeConnections(HnswNode nodeToRemove) {
    for (int level = 0; level <= nodeToRemove.getLevel(); level++) {
        Set<Long> connections = nodeToRemove.getConnections(level);
        if (connections != null) {
            // 移除双向连接
            for (Long connectedId : new HashSet<>(connections)) {
                HnswNode connectedNode = nodes.get(connectedId);
                if (connectedNode != null) {
                    connectedNode.removeConnection(level, nodeToRemove.getId());
                }
            }
            connections.clear();
        }
    }
}

/**
 * 更新入口点
 */
private void updateEntryPoint() {
    entryPointId = null;
    int maxLevel = -1;

    // 找到层级最高的节点作为新的入口点
    for (HnswNode node : nodes.values()) {
        if (node.getLevel() > maxLevel) {
            maxLevel = node.getLevel();
            entryPointId = node.getId();
        }
    }
}
```

### **5.8 性能优化技术**

#### **5.8.1 内存访问优化**

代码语言：javascript

```javascript
/**
 * 预取优化，减少缓存缺失
 */
private void prefetchNodes(Set<Long> nodeIds) {
    // 批量加载节点数据到CPU缓存
    for (Long nodeId : nodeIds) {
        HnswNode node = nodes.get(nodeId);
        if (node != null) {
            // 访问节点数据，触发缓存加载
            Vector vector = node.getVector();
            float[] data = vector.getData();
            // 简单的内存访问以确保数据在缓存中
            @SuppressWarnings("unused")
            float sum = data[0] + data[data.length - 1];
        }
    }
}
```

#### **5.8.2 并行搜索优化**

代码语言：javascript

```javascript
/**
 * 并行搜索实现
 */
public List<SearchResult> parallelSearch(Vector query, int k, int searchEf) {
    if (Runtime.getRuntime().availableProcessors() == 1) {
        return search(query, k, searchEf);
    }

    ensureLockInitialized();
    globalLock.readLock().lock();
    try {
        // 使用Fork/Join框架进行并行搜索
        ForkJoinPool forkJoinPool = new ForkJoinPool();
        ParallelSearchTask task = new ParallelSearchTask(query, k, searchEf, 0, getEntryPointLevel());
        return forkJoinPool.invoke(task);
    } finally {
        globalLock.readLock().unlock();
    }
}

/**
 * Fork/Join并行搜索任务
 */
private class ParallelSearchTask extends RecursiveTask<List<SearchResult>> {
    private final Vector query;
    private final int k;
    private final int searchEf;
    private final int fromLevel;
    private final int toLevel;

    public ParallelSearchTask(Vector query, int k, int searchEf, int fromLevel, int toLevel) {
        this.query = query;
        this.k = k;
        this.searchEf = searchEf;
        this.fromLevel = fromLevel;
        this.toLevel = toLevel;
    }

    @Override
    protected List<SearchResult> compute() {
        if (toLevel - fromLevel <= 1) {
            // 直接搜索
            return searchLayerEf(query, entryPointId, searchEf, fromLevel);
        } else {
            // 分解任务
            int midLevel = (fromLevel + toLevel) / 2;
            ParallelSearchTask leftTask = new ParallelSearchTask(query, k, searchEf, fromLevel, midLevel);
            ParallelSearchTask rightTask = new ParallelSearchTask(query, k, searchEf, midLevel, toLevel);

            leftTask.fork();
            List<SearchResult> rightResults = rightTask.compute();
            List<SearchResult> leftResults = leftTask.join();

            // 合并结果
            return mergeResults(leftResults, rightResults, k);
        }
    }
}
```

### **小结**

本章深入介绍了HNSW算法的核心原理和实现：

1. **理论基础**：
    - 小世界网络理论
    - 分层结构设计
    - 概率层级分配
2. **核心算法**：
    - 节点插入算法
    - 多层搜索策略
    - 连接建立与剪枝
3. **工程优化**：
    - 内存访问优化
    - 并行搜索实现
    - 删除操作支持
4. **数据结构**：
    - 线程安全的节点设计
    - 高效的连接管理
    - 动态入口点维护

HNSW算法是向量搜索引擎的核心，其分层结构和小世界网络特性使其在保证搜索精度的同时，实现了优异的搜索性能。

---

**思考题：**

1. 为什么HNSW使用指数分布来分配节点层级？
2. 连接剪枝算法如何平衡搜索性能和索引质量？
3. 如何根据数据特性调整HNSW的关键参数？