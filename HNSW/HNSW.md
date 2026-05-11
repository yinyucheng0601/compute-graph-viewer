#
https://milvus.io/docs/zh/hnsw.md
**HNSW**索引是一种**基于图的**索引算法，可以提高搜索高维浮动向量时的性能。它具有**出色的**搜索精度和**低**延迟，但需要**较高的**内存开销来维护其分层图结构。

## 概览

分层导航小世界（HNSW）算法构建了一个多层图，有点像不同缩放级别的地图。**底层**包含所有数据点，而**上层**则由从底层采样的数据点子集组成。

在这种层次结构中，每一层都包含代表数据点的节点，节点之间由表示其接近程度的边连接。上层提供远距离跳转，以快速接近目标，而下层则进行细粒度搜索，以获得最准确的结果。

下面是它的工作原理：

1. **入口点**：搜索从顶层的一个固定入口点开始，该入口点是图中的一个预定节点。

2. **贪婪搜索**：算法贪婪地移动到当前层的最近邻居，直到无法再接近查询向量为止。上层起到导航作用，作为粗过滤器，为下层的精细搜索找到潜在的入口点。

3. **层层下降**：一旦当前层达到**局部最小值**，算法就会通过预先建立的连接跳转到下层，并重复贪婪搜索。

4. **最后** **细化**：这一过程一直持续到最底层，在最底层进行最后的细化步骤，找出最近的邻居。


![HNSW](https://milvus-docs.s3.us-west-2.amazonaws.com/assets/hnsw.png)HNSW

HNSW 的性能取决于控制图结构和搜索行为的几个关键参数。这些参数包括

- `M`:图中每个节点在层次结构的每个层级所能拥有的最大边数或连接数。`M` 越高，图的密度就越大，搜索结果的召回率和准确率也就越高，因为有更多的路径可以探索，但同时也会消耗更多内存，并由于连接数的增加而减慢插入时间。如上图所示，**M = 5**表示 HNSW 图中的每个节点最多与 5 个其他节点直接相连。这就形成了一个中等密度的图结构，节点有多条路径到达其他节点。

- `efConstruction`:索引构建过程中考虑的候选节点数量。`efConstruction` 越高，图的质量越好，但需要更多时间来构建。

- `ef`:搜索过程中评估的邻居数量。增加`ef` 可以提高找到最近邻居的可能性，但会减慢搜索过程。


有关如何根据需要调整这些设置的详情，请参阅[索引参数](https://milvus.io/docs/zh/hnsw.md#Index-params)。

## 建立索引

要在 Milvus 中的向量场上建立`HNSW` 索引，请使用`add_index()` 方法，为索引指定`index_type`,`metric_type`, 以及附加参数。

```python
from pymilvus import MilvusClient

# Prepare index building params
index_params = MilvusClient.prepare_index_params()

index_params.add_index(
    field_name="your_vector_field_name", # Name of the vector field to be indexed
    index_type="HNSW", # Type of the index to create
    index_name="vector_index", # Name of the index to create
    metric_type="L2", # Metric type used to measure similarity
    params={
        "M": 64, # Maximum number of neighbors each node can connect to in the graph
        "efConstruction": 100 # Number of candidate neighbors considered for connection during index construction
    } # Index building params
)
```

在此配置中

- `index_type`:要建立的索引类型。在本例中，将值设为`HNSW` 。

- `metric_type`:用于计算向量间距离的方法。支持的值包括`COSINE`,`L2`, 和`IP` 。有关详情，请参阅[公制类型](https://milvus.io/docs/zh/metric.md)。

- `params`:用于建立索引的附加配置选项。

    - `M`:每个节点可连接的最大邻居数量。

    - `efConstruction`:索引构建过程中考虑连接的候选邻居数量。


    要了解`HNSW` 索引可用的更多构建[参数](https://milvus.io/docs/zh/hnsw.md#Index-building-params)，请参阅[索引构建参数](https://milvus.io/docs/zh/hnsw.md#Index-building-params)。


配置好索引参数后，可直接使用`create_index()` 方法或在`create_collection` 方法中传递索引参数来创建索引。有关详情，请参阅[创建 Collections](https://milvus.io/docs/zh/create-collection.md)。

## 在索引上搜索

建立索引并插入实体后，就可以在索引上执行相似性搜索。

```python
search_params = {
    "params": {
        "ef": 10, # Number of neighbors to consider during the search
    }
}

res = MilvusClient.search(
    collection_name="your_collection_name", # Collection name
    anns_field="vector_field", # Vector field name
    data=[[0.1, 0.2, 0.3, 0.4, 0.5]],  # Query vector
    limit=10,  # TopK results to return
    search_params=search_params
)
```

在此配置中

- `params`:在索引上搜索的其他配置选项。

    - `ef`:搜索时要考虑的邻居数量。

    要了解`HNSW` 索引可用的更多搜索[参数](https://milvus.io/docs/zh/hnsw.md#Index-specific-search-params)，请参阅[特定于索引的搜索参数](https://milvus.io/docs/zh/hnsw.md#Index-specific-search-params)。


## 索引参数

本节概述了用于建立索引和在索引上执行搜索的参数。

### 索引建立参数

下表列出了[建立索引](https://milvus.io/docs/zh/hnsw.md#Build-index)时可在`params` 中配置的参数。

|参数|说明|值范围|调整建议|
|---|---|---|---|
|`M`|图中每个节点可拥有的最大连接数（或边），包括出边和入边。该参数直接影响索引构建和搜索。|**类型**： 整数整数**范围**：[2, 2048]<br><br>**默认值**：`30` （每个节点最多有 30 条出边和 30 条入边）|更大的`M` 通常会带来**更高的准确率**，但会**增加内存开销**，并**减慢索引构建和搜索速度**。对于高维度数据集或高召回率至关重要时，可考虑提高`M` 。<br><br>当内存使用和搜索速度是首要考虑因素时，可考虑降低`M` 。<br><br>在大多数情况下，我们建议您在此范围内设置一个值：[5, 100].|
|`efConstruction`|索引构建过程中考虑连接的候选邻居数量。每个新元素都会评估一个更大的候选池，但实际建立的最大连接数仍受`M` 限制。|**类型**： 整数整数**范围**：[1，_int_max］_<br><br>**默认值**：`360`|`efConstruction` 越高，**索引**越**准确**，因为会探索更多潜在连接。不过，这也会导致建立**索引的时间延长和内存使用量增加**。考虑增加`efConstruction` 以提高准确性，尤其是在索引时间不太重要的情况下。<br><br>在资源紧张的情况下，可考虑降低`efConstruction` ，以加快索引构建速度。<br><br>在大多数情况下，我们建议在此范围内设置一个值：[50, 500].|

### 特定于索引的搜索参数

下表列出了[在索引上搜索](https://milvus.io/docs/zh/hnsw.md#Search-on-index)时可在`search_params.params` 中配置的参数。

| 参数   | 说明                                                        | 值范围                                                                 | 调整建议                                                                                                                                                                            |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ef` | 控制近邻检索时的搜索范围。它决定访问多少节点并将其评估为潜在近邻。 该参数只影响搜索过程，并且只适用于图形的底层。 | **类型**： 整数整数**范围**：[1，_int_max］_<br><br>**默认值**：_limit_（返回的前 K 个近邻） | `ef` 越大，通常**搜索精度越高**，因为会考虑更多的潜在近邻。不过，这也会**增加搜索时间**。如果实现高召回率至关重要，而搜索速度则不那么重要，则可考虑提高`ef` 。<br><br>考虑降低`ef` 以优先提高搜索速度，尤其是在可以接受稍微降低准确率的情况下。<br><br>在大多数情况下，我们建议您在此范围内设置一个值：[K，10K]。 |