(function () {
    const GELU_HIGH_API_SOURCE_LINES = String.raw`/**
 * Copyright (c) 2026 Huawei Technologies Co., Ltd.
 * This program is free software, you can redistribute it and/or modify it under the terms and conditions of
 * CANN Open Software License Agreement Version 2.0 (the "License").
 * Please refer to the License for details. You may not use this file except in compliance with the License.
 * THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY, OR FITNESS FOR A PARTICULAR PURPOSE.
 * See LICENSE in the root of the software repository for the full text of the License.
 */

/* !
 * \file gelu.asc
 * \brief 基于Gelu高阶API实现GELU激活函数计算样例
 */

#include "acl/acl.h"
#include "data_utils.h"
#include "kernel_operator.h"
#include "tiling/tiling_api.h"

#ifdef ASCENDC_CPU_DEBUG
#include "cpu_debug_launch.h"
#endif

/**
 * @brief Gelu计算Kernel类
 */
template <typename T>
class KernelGelu {
public:
    __aicore__ inline KernelGelu() {}
    __aicore__ inline void Init(
        GM_ADDR srcGm, GM_ADDR dstGm, uint32_t inputSize, uint32_t tmpBufSize, AscendC::TPipe* pipeIn)
    {
        pipe = pipeIn;
        dataSize = inputSize;
        this->tmpBufSize = tmpBufSize;

        srcGlobal.SetGlobalBuffer(reinterpret_cast<__gm__ T*>(srcGm), dataSize);
        dstGlobal.SetGlobalBuffer(reinterpret_cast<__gm__ T*>(dstGm), dataSize);
        pipe->InitBuffer(inQueueX, 1, dataSize * sizeof(T));
        pipe->InitBuffer(outQueue, 1, dataSize * sizeof(T));
        if (tmpBufSize > 0) {
            pipe->InitBuffer(bufQueue, tmpBufSize);
        }
    }
    __aicore__ inline void Process()
    {
        CopyIn();
        Compute();
        CopyOut();
    }

    __aicore__ inline void CopyIn()
    {
        AscendC::LocalTensor<T> srcLocal = inQueueX.AllocTensor<T>();
        AscendC::DataCopy(srcLocal, srcGlobal, dataSize);
        inQueueX.EnQue(srcLocal);
    }
    __aicore__ inline void Compute()
    {
        AscendC::LocalTensor<T> dstLocal = outQueue.AllocTensor<T>();
        AscendC::LocalTensor<T> srcLocal = inQueueX.DeQue<T>();
        // 调用Gelu高阶API，对srcLocal按元素做GELU计算，结果写入dstLocal
        AscendC::LocalTensor<uint8_t> tmpLocal;
        if (tmpBufSize > 0) {
            tmpLocal = bufQueue.Get<uint8_t>();
            AscendC::Gelu(dstLocal, srcLocal, tmpLocal, dataSize);
        } else {
            AscendC::Gelu(dstLocal, srcLocal, dataSize);
        }
        outQueue.EnQue<T>(dstLocal);
        inQueueX.FreeTensor(srcLocal);
    }
    __aicore__ inline void CopyOut()
    {
        AscendC::LocalTensor<T> dstLocal = outQueue.DeQue<T>();
        AscendC::DataCopy(dstGlobal, dstLocal, dataSize);
        outQueue.FreeTensor(dstLocal);
    }

private:
    AscendC::TPipe* pipe;
    AscendC::TQue<AscendC::QuePosition::VECIN, 1> inQueueX;
    AscendC::TQue<AscendC::QuePosition::VECOUT, 1> outQueue;
    AscendC::TBuf<AscendC::TPosition::VECCALC> bufQueue;
    AscendC::GlobalTensor<T> srcGlobal;
    AscendC::GlobalTensor<T> dstGlobal;
    uint32_t dataSize = 0;
    uint32_t tmpBufSize = 0;
};

__global__ __vector__ void gelu_custom(GM_ADDR srcGm, GM_ADDR dstGm, uint32_t dataSize, uint32_t tmpBufSize)
{
    AscendC::TPipe pipe;
    KernelGelu<float> op;
    op.Init(srcGm, dstGm, dataSize, tmpBufSize, &pipe);
    op.Process();
}

static bool CompareResult(const void* outputData, uint32_t outSize)
{
    void* goldenData;
    aclrtMallocHost((void**)(&goldenData), outSize);
    size_t goldenSize = outSize;
    bool ret = ReadFile("./output/golden.bin", goldenSize, goldenData, goldenSize);
    if (ret) {
        printf("ReadFile golden.bin success!\n");
    } else {
        printf("test failed!\n");
        return false;
    }
    constexpr float EPS = 1e-4;
    int64_t wrongNum = 0;

    for (size_t i = 0; i < outSize / sizeof(float); i++) {
        float a = (reinterpret_cast<const float*>(outputData))[i];
        float b = (reinterpret_cast<const float*>(goldenData))[i];
        float ae = std::abs(a - b);
        float re = ae / std::abs(b + EPS);
        if (ae > EPS && re > EPS) {
            printf("CompareResult golden.bin failed output is %lf, golden is %lf\n", a, b);
            wrongNum++;
        }
    }
    aclrtFreeHost(goldenData);
    if (wrongNum != 0) {
        return false;
    } else {
        printf("CompareResult golden.bin success!\n");
        return true;
    }
}

int32_t main(int32_t argc, char* argv[])
{
    uint32_t dataSize = 32;
    uint32_t numBlocks = 1;

    // 获取Gelu接口所需的最小临时空间大小
    std::vector<int64_t> shapeVec = {dataSize};
    ge::Shape srcShape(shapeVec);
    uint32_t minValue = AscendC::GetGeluMinTmpSize(srcShape, sizeof(float));

    size_t param1FileSize = dataSize * sizeof(float);
    size_t param2FileSize = dataSize * sizeof(float);

    aclInit(nullptr);
    aclrtContext context;
    int32_t deviceId = 0;
    aclrtSetDevice(deviceId);
    aclrtCreateContext(&context, deviceId);
    aclrtStream stream = nullptr;
    aclrtCreateStream(&stream);

    uint8_t* param1Host;
    uint8_t* param1Device;
    aclrtMallocHost((void**)(&param1Host), param1FileSize);
    aclrtMalloc((void**)&param1Device, param1FileSize, ACL_MEM_MALLOC_HUGE_FIRST);
    ReadFile("./input/input_src.bin", param1FileSize, param1Host, param1FileSize);
    aclrtMemcpy(param1Device, param1FileSize, param1Host, param1FileSize, ACL_MEMCPY_HOST_TO_DEVICE);

    uint8_t* param2Host;
    uint8_t* param2Device;
    aclrtMallocHost((void**)(&param2Host), param2FileSize);
    aclrtMalloc((void**)&param2Device, param2FileSize, ACL_MEM_MALLOC_HUGE_FIRST);

    gelu_custom<<<numBlocks, nullptr, stream>>>(param1Device, param2Device, dataSize, minValue);
    aclrtSynchronizeStream(stream);

    aclrtFree(param1Device);
    aclrtFreeHost(param1Host);

    aclrtMemcpy(param2Host, param2FileSize, param2Device, param2FileSize, ACL_MEMCPY_DEVICE_TO_HOST);
    WriteFile("./output/output.bin", param2Host, param2FileSize);

    bool goldenResult = true;
    goldenResult = CompareResult(param2Host, param2FileSize);
    if (goldenResult) {
        printf("test pass!\n");
    } else {
        printf("test failed!\n");
    }

    aclrtFree(param2Device);
    aclrtFreeHost(param2Host);

    aclrtDestroyStream(stream);
    aclrtDestroyContext(context);
    aclrtResetDevice(deviceId);
    aclFinalize();

    return 0;
}`.replace(/\n$/, '').split('\n');

    const GELU_HIGH_API_LINES = [
      {
        id: 'gelu-api-l41',
        line: 41,
        kind: 'memory',
        tag: 'VECIN 队列',
        code: 'pipe->InitBuffer(inQueueX, 1, dataSize * sizeof(T));',
        short: '为输入 tensor 建立 VECIN 队列，GELU 主路径保持 UB 内局部计算。',
        selectors: ['[data-mem950-node="rail:GM"]', '#mem950-aiv1 [data-aiv-node="buffer:UB"]'],
        routes: ['l2-to-aiv1'],
        path: 'GM/L2 → VECIN queue → AIV UB',
        verdict: 'SIMD 输入队列',
        reasons: ['UB 常驻输入', '固定 tile 长度', '稠密向量通道'],
        explanation: '基础 GELU 样例用 AscendC 队列抽象承接输入，Inspector 会把它归入 PURE SIMD 的输入 staging。',
        rewrite: 'pipe->InitBuffer(inQueueX, 1, AlignTo(dataSize, 32) * sizeof(T));',
        metrics: { confidence: '88%', cycles: '-6%', pressure: 'UB 中' }
      },
      {
        id: 'gelu-api-l57',
        line: 57,
        kind: 'memory',
        tag: 'GM→UB 读入',
        code: 'AscendC::DataCopy(srcLocal, srcGlobal, dataSize);',
        short: '输入从 GM 连续搬入 UB，是 950 sector / NDDMA 检查的入口。',
        selectors: ['[data-mem950-node="rail:GM"]', '[data-mem950-node="rail:L2"]', '#mem950-aiv1 [data-aiv-node="buffer:UB"]'],
        routes: ['l2-to-aiv1'],
        path: 'Global Memory → L2 → AIV UB',
        verdict: '连续搬运',
        reasons: ['GM 连续读', '128B sector 友好', 'MTE2 可搬运'],
        explanation: 'dataSize 在 host 侧固定为 32，当前样例天然对齐；扩大数据规模时应继续检查 128B sector 命中和 DataCopy 粒度。',
        rewrite: 'AscendC::DataCopy(srcLocal, srcGlobal, AlignTo(dataSize, 32));',
        metrics: { confidence: '92%', cycles: '-9%', pressure: 'L2 低' }
      },
      {
        id: 'gelu-api-l68',
        line: 68,
        kind: 'compute',
        tag: 'GELU 高阶 API',
        code: 'AscendC::Gelu(dstLocal, srcLocal, tmpLocal, dataSize);',
        short: '调用 AscendC::Gelu 高阶 API，编译器负责展开为 AIV Vector 序列。',
        selectors: ['#mem950-aiv1 [data-aiv-node="buffer:UB"]', '#mem950-aiv1 [data-aiv-node="exec:SIMD"]', '#mem950-aiv1 [data-aiv-node="vector:Vector"]'],
        routes: [],
        path: 'AIV UB → SIMD → Vector GELU',
        verdict: 'PURE SIMD',
        reasons: ['稠密向量通道', '无分支发散', '数据已在 UB'],
        explanation: '高阶 API 样例强调易用性，模式选择器应把它作为 PURE SIMD baseline，同时把 tmp buffer 大小和 API 展开结果纳入白盒报告。',
        rewrite: 'AscendC::Gelu(dstLocal, srcLocal, tmpLocal, AlignTo(dataSize, 8));',
        metrics: { confidence: '95%', cycles: '-14%', pressure: 'tmpBuf 中' }
      },
      {
        id: 'gelu-api-l70',
        line: 70,
        kind: 'compute',
        tag: '无临时缓冲',
        code: 'AscendC::Gelu(dstLocal, srcLocal, dataSize);',
        short: '无 tmp buffer 路径保持相同 SIMD 语义，但需要确认编译器展开策略。',
        selectors: ['#mem950-aiv1 [data-aiv-node="exec:SIMD"]', '#mem950-aiv1 [data-aiv-node="vector:Vector"]'],
        routes: [],
        path: 'AIV UB → SIMD → Vector GELU',
        verdict: 'API fallback',
        reasons: ['稠密向量通道', '无分支发散', '数据已在 UB'],
        explanation: '当 tmpBufSize 为 0 时仍然是 SIMD GELU；Inspector 需要展示是否触发额外临时寄存器或 UB 压力。',
        rewrite: 'AscendC::Gelu(dstLocal, srcLocal, dataSize); // inspect tmp-free lowering',
        metrics: { confidence: '87%', cycles: 'check', pressure: '寄存器中' }
      },
      {
        id: 'gelu-api-l78',
        line: 78,
        kind: 'memory',
        tag: 'UB→GM 写回',
        code: 'AscendC::DataCopy(dstGlobal, dstLocal, dataSize);',
        short: 'GELU 结果从 VECOUT/UB 连续写回 GM。',
        selectors: ['#mem950-aiv1 [data-aiv-node="buffer:UB"]', '[data-mem950-node="rail:L2"]', '[data-mem950-node="rail:GM"]'],
        routes: ['aiv1-to-l2'],
        path: 'AIV UB → L2 → Global Memory',
        verdict: '连续写回',
        reasons: ['写回连续', 'UB 排空', 'MTE3 可搬运'],
        explanation: '写回路径适合和 CopyIn 一起看 sector 命中率，避免 API 高阶封装把搬运瓶颈隐藏起来。',
        rewrite: 'AscendC::DataCopy(dstGlobal, dstLocal, AlignTo(dataSize, 32));',
        metrics: { confidence: '91%', cycles: '-8%', pressure: 'GM 低' }
      },
      {
        id: 'gelu-api-l143',
        line: 143,
        kind: 'control',
        tag: 'tmpBuf 规划',
        code: 'uint32_t minValue = AscendC::GetGeluMinTmpSize(srcShape, sizeof(float));',
        short: 'Host 侧查询 GELU 最小临时空间，是 API 版性能可解释性的关键。',
        selectors: ['#mem950-aiv1 [data-aiv-node="scalar:Scalar"]', '#mem950-aiv1 [data-aiv-node="buffer:UB"]'],
        routes: [],
        path: 'Host tiling → tmpBuf size → AIV UB pressure',
        verdict: '白盒检查点',
        reasons: ['UB 常驻输入', '固定 tile 长度', '无数据相关分支'],
        explanation: 'Feature enablement report 应显示 tmpBufSize 如何影响 GELU API 展开、UB 占用和寄存器压力。',
        rewrite: 'uint32_t minValue = AscendC::GetGeluMinTmpSize(srcShape, sizeof(float)); // report UB pressure',
        metrics: { confidence: '84%', cycles: 'report', pressure: 'UB 中' }
      },
      { id: 'gelu-api-l32-tag', line: 32, kind: 'scalar', tag: '初始化', tagOnly: true },
      { id: 'gelu-api-l43-tag', line: 43, kind: 'control', tag: 'tmpBuf 分支', tagOnly: true },
      { id: 'gelu-api-l49-tag', line: 49, kind: 'memory', tag: 'CopyIn', tagOnly: true },
      { id: 'gelu-api-l50-tag', line: 50, kind: 'compute', tag: 'Compute', tagOnly: true },
      { id: 'gelu-api-l51-tag', line: 51, kind: 'memory', tag: 'CopyOut', tagOnly: true },
      { id: 'gelu-api-l93-tag', line: 93, kind: 'scalar', tag: 'kernel', tagOnly: true },
      { id: 'gelu-api-l168-tag', line: 168, kind: 'control', tag: 'launch', tagOnly: true }
    ];

    window.registerWorkbenchKernel({
      id: 'gelu_high_api',
      name: 'gelu_high_api.asc',
      label: 'gelu_custom · high API',
      path: 'gitcode.com/cann/asc-devkit/.../03_libraries/01_activation/gelu/gelu.asc',
      sourceUrl: 'https://gitcode.com/cann/asc-devkit/blob/master/examples/01_simd_cpp_api/03_libraries/01_activation/gelu/gelu.asc',
      summary: 'AscendC::Gelu high-level API sample',
      target: 'Ascend 950 / 910B',
      analysis: 'T1 静态 + API 展开检查',
      verdict: 'PURE SIMD high API',
      defaultTier: 't1',
      selectedId: 'gelu-api-l68',
      family: 'gelu',
      profile: 'gelu_api',
      sourceLines: GELU_HIGH_API_SOURCE_LINES,
      annotations: GELU_HIGH_API_LINES
    });
})();
