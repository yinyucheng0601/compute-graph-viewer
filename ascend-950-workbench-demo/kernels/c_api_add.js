(function () {
    const C_API_ADD_SOURCE_LINES = String.raw`/**
* Copyright (c) 2025 Huawei Technologies Co., Ltd.
* This program is free software, you can redistribute it and/or modify it under the terms and conditions of
* CANN Open Software License Agreement Version 2.0 (the "License").
* Please refer to the License for details. You may not use this file except in compliance with the License.
* THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED,
* INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY, OR FITNESS FOR A PARTICULAR PURPOSE.
* See LICENSE in the root of the software repository for the full text of the License.
*/


/* !
 * \file c_api_add.asc
 * \brief
 */

#include <cstdint>
#include <iostream>
#include <vector>
#include <algorithm>
#include <iterator>
#include "acl/acl.h"
#include "c_api/asc_simd.h"

constexpr uint32_t TILE_LENGTH = 2048;
constexpr uint32_t NUM_BLOCKS = 8;

__vector__ __global__ __aicore__ void add_custom(__gm__ float* x, __gm__ float* y, __gm__ float* z)
{
    asc_init();

    uint32_t blockLength = NUM_BLOCKS * TILE_LENGTH / asc_get_block_num();

    __gm__ float* xGm = x + asc_get_block_idx() * blockLength;
    __gm__ float* yGm = y + asc_get_block_idx() * blockLength;
    __gm__ float* zGm = z + asc_get_block_idx() * blockLength;

    __ubuf__ float xLocal[TILE_LENGTH];
    __ubuf__ float yLocal[TILE_LENGTH];
    __ubuf__ float zLocal[TILE_LENGTH];

    asc_copy_gm2ub((__ubuf__ void*)xLocal, (__gm__ void*)xGm, blockLength * sizeof(float));
    asc_copy_gm2ub((__ubuf__ void*)yLocal, (__gm__ void*)yGm, blockLength * sizeof(float));
    asc_sync();

    asc_add(zLocal, xLocal, yLocal, blockLength);
    asc_sync();

    asc_copy_ub2gm((__gm__ void*)zGm, (__ubuf__ void*)zLocal, blockLength * sizeof(float));
    asc_sync();
}

std::vector<float> kernel_add(std::vector<float> &x, std::vector<float> &y)
{
    constexpr uint32_t numBlocks = NUM_BLOCKS;
    uint32_t totalLength = x.size();
    size_t totalByteSize = totalLength * sizeof(float);
    int32_t deviceId = 0;
    aclrtStream stream = nullptr;
    uint8_t *xHost = reinterpret_cast<uint8_t *>(x.data());
    uint8_t *yHost = reinterpret_cast<uint8_t *>(y.data());
    uint8_t *zHost = nullptr;
    float *xDevice = nullptr;
    float *yDevice = nullptr;
    float *zDevice = nullptr;

    aclInit(nullptr);
    aclrtSetDevice(deviceId);
    aclrtCreateStream(&stream);

    aclrtMallocHost((void **)(&zHost), totalByteSize);
    aclrtMalloc((void **)&xDevice, totalByteSize, ACL_MEM_MALLOC_HUGE_FIRST);
    aclrtMalloc((void **)&yDevice, totalByteSize, ACL_MEM_MALLOC_HUGE_FIRST);
    aclrtMalloc((void **)&zDevice, totalByteSize, ACL_MEM_MALLOC_HUGE_FIRST);

    aclrtMemcpy((uint8_t*)xDevice, totalByteSize, xHost, totalByteSize, ACL_MEMCPY_HOST_TO_DEVICE);
    aclrtMemcpy((uint8_t*)yDevice, totalByteSize, yHost, totalByteSize, ACL_MEMCPY_HOST_TO_DEVICE);

    add_custom<<<numBlocks, nullptr, stream>>>(xDevice, yDevice, zDevice);
    aclrtSynchronizeStream(stream);

    aclrtMemcpy(zHost, totalByteSize, (uint8_t*)zDevice, totalByteSize, ACL_MEMCPY_DEVICE_TO_HOST);
    std::vector<float> z((float *)zHost, (float *)(zHost + totalByteSize));

    aclrtFree(xDevice);
    aclrtFree(yDevice);
    aclrtFree(zDevice);
    aclrtFreeHost(zHost);

    aclrtDestroyStream(stream);
    aclrtResetDevice(deviceId);
    aclFinalize();

    return z;
}

uint32_t VerifyResult(std::vector<float> &output, std::vector<float> &golden)
{
    auto printTensor = [](std::vector<float> &tensor, const char *name) {
        constexpr size_t maxPrintSize = 20;
        std::cout << name << ": ";
        std::copy(tensor.begin(), tensor.begin() + std::min(tensor.size(), maxPrintSize),
            std::ostream_iterator<float>(std::cout, " "));
        if (tensor.size() > maxPrintSize) {
            std::cout << "...";
        }
        std::cout << std::endl;
    };
    printTensor(output, "Output");
    printTensor(golden, "Golden");
    if (std::equal(golden.begin(), golden.end(), output.begin())) {
        std::cout << "[Success] Case accuracy is verification passed." << std::endl;
        return 0;
    } else {
        std::cout << "[Failed] Case accuracy is verification failed!" << std::endl;
        return 1;
    }
    return 0;
}

int32_t main(int32_t argc, char *argv[])
{
    constexpr uint32_t totalLength = NUM_BLOCKS * TILE_LENGTH;
    std::vector<float> x(totalLength);
    std::vector<float> y(totalLength);
    for (uint32_t i = 0; i < totalLength; ++i) {
        x[i] = i * 0.1f;
        y[i] = i * 0.1f;
    }
    std::vector<float> output = kernel_add(x, y);
    std::vector<float> golden(totalLength);
    for (uint32_t i = 0; i < totalLength; ++i) {
        golden[i] = x[i] + y[i];
    }
    return VerifyResult(output, golden);
}`.split('\n');

    const C_API_ADD_LINES = [
      {
        id: 'add-l32',
        line: 32,
        kind: 'control',
        tag: 'block 切分',
        code: 'uint32_t blockLength = NUM_BLOCKS * TILE_LENGTH / asc_get_block_num();',
        short: '按 block 均分连续向量，SIMD 主干没有额外 tail 分支。',
        selectors: ['#mem950-aiv1 [data-aiv-node="scalar:Scalar"]', '#mem950-aiv1 [data-aiv-node="exec:SIMD"]'],
        routes: [],
        path: 'Block Scheduler → Scalar 参数 → SIMD 执行配置',
        verdict: 'SIMD 分块',
        reasons: ['固定 tile 长度', 'block 均分', '无数据相关分支'],
        explanation: 'TILE_LENGTH 与 NUM_BLOCKS 都是编译期常量，blockLength 只由 block 数确定。Inspector 会把它判为稳定的 SIMD 分块策略。',
        rewrite: 'uint32_t blockLength = AlignDown(NUM_BLOCKS * TILE_LENGTH / asc_get_block_num(), 8);',
        metrics: { confidence: '89%', cycles: '0%', pressure: '控制低' }
      },
      {
        id: 'add-l42',
        line: 42,
        kind: 'memory',
        tag: 'GM→UB 读入',
        code: 'asc_copy_gm2ub((__ubuf__ void*)xLocal, (__gm__ void*)xGm, blockLength * sizeof(float));',
        short: 'x 向量从 GM/L2 连续搬入 UB，可观察 128B sector 命中。',
        selectors: ['[data-mem950-node="rail:GM"]', '[data-mem950-node="rail:L2"]', '#mem950-aiv1 [data-aiv-node="buffer:UB"]'],
        routes: ['l2-to-aiv1'],
        path: 'Global Memory → L2 → AIV UB',
        verdict: '访存读入',
        reasons: ['GM 连续读', 'UB 常驻输入', '128B sector 友好'],
        explanation: 'xGm 基于 blockIdx 做连续偏移，源地址和长度都适合用 NDDMA / sector 命中报告进一步确认访存效率。',
        rewrite: 'asc_copy_gm2ub((__ubuf__ void*)xLocal, (__gm__ void*)xGm, AlignTo(blockLength, 32) * sizeof(float));',
        metrics: { confidence: '92%', cycles: '-12%', pressure: 'L2 低' }
      },
      {
        id: 'add-l43',
        line: 43,
        kind: 'memory',
        tag: 'GM→UB 读入',
        code: 'asc_copy_gm2ub((__ubuf__ void*)yLocal, (__gm__ void*)yGm, blockLength * sizeof(float));',
        short: '第二个输入保持相同 stride，适合与 x 读入合并成访存白盒报告。',
        selectors: ['[data-mem950-node="rail:GM"]', '[data-mem950-node="rail:L2"]', '#mem950-aiv1 [data-aiv-node="buffer:UB"]'],
        routes: ['l2-to-aiv1'],
        path: 'Global Memory → L2 → AIV UB',
        verdict: '访存读入',
        reasons: ['双输入对齐', 'burst 长度稳定', 'UB 常驻输入'],
        explanation: 'yGm 与 xGm 的索引规则一致，工具可以把两条搬运合并观察，给出 sector 命中率和 NDDMA 重写收益。',
        rewrite: 'asc_copy_gm2ub((__ubuf__ void*)yLocal, (__gm__ void*)yGm, AlignTo(blockLength, 32) * sizeof(float));',
        metrics: { confidence: '91%', cycles: '-10%', pressure: 'L2 低' }
      },
      {
        id: 'add-l46',
        line: 46,
        kind: 'compute',
        tag: 'SIMD / Vector',
        code: 'asc_add(zLocal, xLocal, yLocal, blockLength);',
        short: '核心算子是稠密逐元素加法，直接落在 AIV SIMD / Vector 路径。',
        selectors: ['#mem950-aiv1 [data-aiv-node="buffer:UB"]', '#mem950-aiv1 [data-aiv-node="exec:SIMD"]', '#mem950-aiv1 [data-aiv-node="vector:Vector"]'],
        routes: [],
        path: 'AIV UB → SIMD → Vector',
        verdict: 'PURE SIMD',
        reasons: ['稠密向量通道', '无分支发散', '寄存器压力低'],
        explanation: 'asc_add 的输入输出都在 UB，且没有 mask 或 ragged tail。模式建议器会给出 PURE SIMD，Hybrid Inspector 只保留解释而不拆 SIMT 岛。',
        rewrite: 'asc_add(zLocal, xLocal, yLocal, AlignTo(blockLength, 8));',
        metrics: { confidence: '97%', cycles: '-19%', pressure: 'UB 低' }
      },
      {
        id: 'add-l49',
        line: 49,
        kind: 'memory',
        tag: 'UB→GM 写回',
        code: 'asc_copy_ub2gm((__gm__ void*)zGm, (__ubuf__ void*)zLocal, blockLength * sizeof(float));',
        short: '输出向量从 UB 连续写回 GM，关注写回对齐和 MTE drain。',
        selectors: ['#mem950-aiv1 [data-aiv-node="buffer:UB"]', '[data-mem950-node="rail:L2"]', '[data-mem950-node="rail:GM"]'],
        routes: ['aiv1-to-l2'],
        path: 'AIV UB → L2 → Global Memory',
        verdict: '访存写回',
        reasons: ['写回连续', 'UB 排空', 'MTE3 可搬运'],
        explanation: 'zGm 与输入同样按 block 连续切分，写回路径可以用 128B sector 和 L2 Control Hint 做最终校准。',
        rewrite: 'asc_copy_ub2gm((__gm__ void*)zGm, (__ubuf__ void*)zLocal, AlignTo(blockLength, 32) * sizeof(float));',
        metrics: { confidence: '93%', cycles: '-11%', pressure: 'GM 低' }
      },
      {
        id: 'add-l79',
        line: 79,
        kind: 'control',
        tag: 'Kernel Launch',
        code: 'add_custom<<<numBlocks, nullptr, stream>>>(xDevice, yDevice, zDevice);',
        short: 'Host 侧 launch 决定 block 数，适合作为 910→950 迁移检查入口。',
        selectors: ['#mem950-aiv1 [data-aiv-node="scalar:Scalar"]', '#mem950-aiv1 [data-aiv-node="exec:SIMD"]'],
        routes: [],
        path: 'ACL Runtime → Kernel Launch → AIV SIMD',
        verdict: '迁移检查点',
        reasons: ['block 数显式', 'host/device 边界', '可做 what-if'],
        explanation: 'numBlocks 当前固定为 8。What-if 分析可以快速比较 block 数、tile 长度和实际 block_num 对 SIMD 利用率的影响。',
        rewrite: 'add_custom<<<numBlocks, nullptr, stream>>>(xDevice, yDevice, zDevice); // inspect block occupancy',
        metrics: { confidence: '86%', cycles: 'what-if', pressure: '调度低' }
      },
      { id: 'add-l30-tag', line: 30, kind: 'scalar', tag: '初始化', tagOnly: true },
      { id: 'add-l34-tag', line: 34, kind: 'scalar', tag: '地址计算', tagOnly: true },
      { id: 'add-l35-tag', line: 35, kind: 'scalar', tag: '地址计算', tagOnly: true },
      { id: 'add-l36-tag', line: 36, kind: 'scalar', tag: '地址计算', tagOnly: true },
      { id: 'add-l38-tag', line: 38, kind: 'scalar', tag: 'UB 缓冲声明', tagOnly: true },
      { id: 'add-l39-tag', line: 39, kind: 'scalar', tag: 'UB 缓冲声明', tagOnly: true },
      { id: 'add-l40-tag', line: 40, kind: 'scalar', tag: 'UB 缓冲声明', tagOnly: true },
      { id: 'add-l44-tag', line: 44, kind: 'control', tag: '流水同步', tagOnly: true },
      { id: 'add-l47-tag', line: 47, kind: 'control', tag: '流水同步', tagOnly: true },
      { id: 'add-l50-tag', line: 50, kind: 'control', tag: '流水同步', tagOnly: true },
      { id: 'add-l56-tag', line: 56, kind: 'scalar', tag: '长度计算', tagOnly: true },
      { id: 'add-l57-tag', line: 57, kind: 'scalar', tag: '字节计算', tagOnly: true },
      { id: 'add-l67-tag', line: 67, kind: 'control', tag: 'ACL 初始化', tagOnly: true },
      { id: 'add-l68-tag', line: 68, kind: 'control', tag: '设备选择', tagOnly: true },
      { id: 'add-l69-tag', line: 69, kind: 'control', tag: '创建 stream', tagOnly: true },
      { id: 'add-l71-tag', line: 71, kind: 'scalar', tag: 'Host 分配', tagOnly: true },
      { id: 'add-l72-tag', line: 72, kind: 'scalar', tag: 'Device 分配', tagOnly: true },
      { id: 'add-l73-tag', line: 73, kind: 'scalar', tag: 'Device 分配', tagOnly: true },
      { id: 'add-l74-tag', line: 74, kind: 'scalar', tag: 'Device 分配', tagOnly: true },
      { id: 'add-l76-tag', line: 76, kind: 'memory', tag: 'Host→Device 拷贝', tagOnly: true },
      { id: 'add-l77-tag', line: 77, kind: 'memory', tag: 'Host→Device 拷贝', tagOnly: true },
      { id: 'add-l80-tag', line: 80, kind: 'control', tag: '流同步', tagOnly: true },
      { id: 'add-l82-tag', line: 82, kind: 'memory', tag: 'Device→Host 拷贝', tagOnly: true },
      { id: 'add-l83-tag', line: 83, kind: 'scalar', tag: 'Host 构造', tagOnly: true },
      { id: 'add-l85-tag', line: 85, kind: 'scalar', tag: 'Device 释放', tagOnly: true },
      { id: 'add-l86-tag', line: 86, kind: 'scalar', tag: 'Device 释放', tagOnly: true },
      { id: 'add-l87-tag', line: 87, kind: 'scalar', tag: 'Device 释放', tagOnly: true },
      { id: 'add-l88-tag', line: 88, kind: 'scalar', tag: 'Host 释放', tagOnly: true },
      { id: 'add-l90-tag', line: 90, kind: 'control', tag: '销毁 stream', tagOnly: true },
      { id: 'add-l91-tag', line: 91, kind: 'control', tag: '重置设备', tagOnly: true },
      { id: 'add-l92-tag', line: 92, kind: 'control', tag: 'ACL 收尾', tagOnly: true },
      { id: 'add-l124-tag', line: 124, kind: 'scalar', tag: 'Host 声明', tagOnly: true },
      { id: 'add-l125-tag', line: 125, kind: 'scalar', tag: 'Host 声明', tagOnly: true },
      { id: 'add-l126-tag', line: 126, kind: 'loop', tag: '循环', tagOnly: true },
      { id: 'add-l127-tag', line: 127, kind: 'scalar', tag: '赋值', tagOnly: true },
      { id: 'add-l128-tag', line: 128, kind: 'scalar', tag: '赋值', tagOnly: true },
      { id: 'add-l130-tag', line: 130, kind: 'scalar', tag: '调用 kernel', tagOnly: true },
      { id: 'add-l131-tag', line: 131, kind: 'scalar', tag: 'Host 声明', tagOnly: true },
      { id: 'add-l132-tag', line: 132, kind: 'loop', tag: '循环', tagOnly: true },
      { id: 'add-l133-tag', line: 133, kind: 'scalar', tag: 'golden 计算', tagOnly: true },
      { id: 'add-l135-tag', line: 135, kind: 'scalar', tag: '结果校验', tagOnly: true }
    ];


    window.registerWorkbenchKernel({
      id: 'c_api_add',
      name: 'c_api_add.asc',
      label: 'c_api_add',
      path: 'gitcode.com/cann/asc-devkit/.../c_api_add.asc',
      sourceUrl: 'https://gitcode.com/cann/asc-devkit/blob/master/examples/02_simd_c_api/00_introduction/01_add/c_api_async_add/c_api_add.asc',
      summary: 'Baseline SIMD C API / legacy source kernel',
      target: 'Ascend 950',
      analysis: 'T1 静态 + 迁移检查',
      verdict: '可迁移 baseline',
      defaultTier: 't1',
      selectedId: 'add-l42',
      sourceLines: C_API_ADD_SOURCE_LINES,
      annotations: C_API_ADD_LINES
    });
})();
