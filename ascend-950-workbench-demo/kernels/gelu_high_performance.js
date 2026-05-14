(function () {
    const GELU_HIGH_PERF_SOURCE_LINES = String.raw`/**
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
 * \brief GELU operator performance tuning sample
 *
 * GELU formula (tanh approximation):
 * GELU(x) ≈ x / (1 + e^(-1.595769 · (x + 0.044715 · x³)))
 */

#include "acl/acl.h"
#include "kernel_operator.h"
#include "data_utils.h"

#ifdef ASCENDC_CPU_DEBUG
#include "cpu_debug_launch.h"
#endif

constexpr uint32_t scenarioNum = SCENARIO_NUM;
constexpr float COEFF_A = 0.044715f;
constexpr float COEFF_B = -1.595769f;

template <uint32_t totalM, uint32_t totalN, uint32_t singleCoreM, uint32_t singleCoreN, uint32_t tileLen>
class KernelGelu {
public:
    __aicore__ inline KernelGelu() {}
    __aicore__ inline void Init(GM_ADDR x, GM_ADDR y)
    {
        AscendC::InitSocState();
        xGm.SetGlobalBuffer((__gm__ float*)x);
        yGm.SetGlobalBuffer((__gm__ float*)y);
        InitGMOffsets();
    }

    __aicore__ inline void InitGMOffsets()
    {
        uint32_t blockIdx = AscendC::GetBlockIdx();
        constexpr uint32_t mIndex = (totalM + singleCoreM - 1) / singleCoreM;
        constexpr uint32_t nIndex = (totalN + singleCoreN - 1) / singleCoreN;
        constexpr uint32_t tailSingleCoreM = totalM - (mIndex - 1) * singleCoreM;
        constexpr uint32_t tailSingleCoreN = totalM - (nIndex - 1) * singleCoreN;

        uint32_t mIterIdx = blockIdx % mIndex;
        uint32_t nIterIdx = blockIdx / mIndex;
        actualSingleCoreM = (mIterIdx == (mIndex - 1)) ? tailSingleCoreM : singleCoreM;
        actualSingleCoreN = (nIterIdx == (nIndex - 1)) ? tailSingleCoreN : singleCoreN;

        uint64_t gmOffset = mIterIdx * singleCoreM * totalN + nIterIdx * singleCoreN;
        xGm = xGm[gmOffset];
        yGm = yGm[gmOffset];
    }

    __aicore__ inline void GeluCompute(
        const AscendC::LocalTensor<float>& xLocal, const AscendC::LocalTensor<float>& yLocal, uint32_t n)
    {
        // yLocal = x * x = x²
        AscendC::Mul(yLocal, xLocal, xLocal, n);
        AscendC::PipeBarrier<PIPE_V>();
        // yLocal = x² * x = x³
        AscendC::Mul(yLocal, yLocal, xLocal, n);
        AscendC::PipeBarrier<PIPE_V>();
        // yLocal = x³ * 0.044715 = 0.044715 * x³
        AscendC::Muls(yLocal, yLocal, COEFF_A, n);
        AscendC::PipeBarrier<PIPE_V>();
        // yLocal = x + 0.044715 * x³
        AscendC::Add(yLocal, xLocal, yLocal, n);
        AscendC::PipeBarrier<PIPE_V>();
        // yLocal = -1.595769 * (x + 0.044715 * x³)
        AscendC::Muls(yLocal, yLocal, COEFF_B, n);
        AscendC::PipeBarrier<PIPE_V>();
        // yLocal = e^(-1.595769 * (x + 0.044715 * x³))
        AscendC::Exp(yLocal, yLocal, n);
        AscendC::PipeBarrier<PIPE_V>();
        // yLocal = 1 + e^(-1.595769 * (x + 0.044715 * x³))
        AscendC::Adds(yLocal, yLocal, (float)1.0, n);
        AscendC::PipeBarrier<PIPE_V>();
        // yLocal = x / (1 + e^(-1.595769 * (x + 0.044715 * x³)))
        AscendC::Div(yLocal, xLocal, yLocal, n);
    }

    __simd_vf__ inline static void GeluVfBasic(
        __ubuf__ float* xAddr, __ubuf__ float* yAddr, uint32_t n, uint32_t loopNum)
    {
        constexpr uint32_t oneRepeatSize = AscendC::GetVecLen() / sizeof(float);
        AscendC::Reg::MaskReg mask;
        AscendC::Reg::RegTensor<float> xReg, yReg;
#if SCENARIO_NUM == 2
#pragma unroll 6
#endif
        for (uint16_t i = 0; i < loopNum; ++i) {
            mask = AscendC::Reg::UpdateMask<float>(n);
            AscendC::Reg::LoadAlign(xReg, xAddr + i * oneRepeatSize);
            AscendC::Reg::Mul(yReg, xReg, xReg, mask);
            AscendC::Reg::Mul(yReg, yReg, xReg, mask);
            AscendC::Reg::Muls(yReg, yReg, COEFF_A, mask);
            AscendC::Reg::Add(yReg, xReg, yReg, mask);
            AscendC::Reg::Muls(yReg, yReg, COEFF_B, mask);
            AscendC::Reg::Exp(yReg, yReg, mask);
            AscendC::Reg::Adds(yReg, yReg, 1.0f, mask);
            AscendC::Reg::Div(yReg, xReg, yReg, mask);
            AscendC::Reg::StoreAlign(yAddr + i * oneRepeatSize, yReg, mask);
        }
    }

    __aicore__ inline void GeluRegBaseCompute(
        const AscendC::LocalTensor<float>& xLocal, const AscendC::LocalTensor<float>& yLocal, uint32_t n)
    {
        constexpr uint32_t oneRepeatSize = AscendC::GetVecLen() / sizeof(float);
        uint32_t loopNum = AscendC::CeilDivision(n, oneRepeatSize);
        __ubuf__ float* xAddr = (__ubuf__ float*)xLocal.GetPhyAddr();
        __ubuf__ float* yAddr = (__ubuf__ float*)yLocal.GetPhyAddr();
        asc_vf_call<GeluVfBasic>(xAddr, yAddr, n, loopNum);
    }

    __aicore__ inline void Process()
    {
        AscendC::LocalTensor<float> xPing(AscendC::TPosition::VECCALC, xAddrPing, tileLen);
        AscendC::LocalTensor<float> yPing(AscendC::TPosition::VECCALC, yAddrPing, tileLen);
        AscendC::LocalTensor<float> xPong(AscendC::TPosition::VECCALC, xAddrPong, tileLen);
        AscendC::LocalTensor<float> yPong(AscendC::TPosition::VECCALC, yAddrPong, tileLen);

        constexpr uint32_t tileRow = tileLen / singleCoreN;
        uint32_t loopNum = (actualSingleCoreM + tileRow - 1) / tileRow;
        uint32_t tailRow = actualSingleCoreM - (loopNum - 1) * tileRow;

        AscendC::SetFlag<AscendC::HardEvent::V_MTE2>(EVENT_ID0);
        AscendC::SetFlag<AscendC::HardEvent::V_MTE2>(EVENT_ID1);
        AscendC::SetFlag<AscendC::HardEvent::MTE3_V>(EVENT_ID0);
        AscendC::SetFlag<AscendC::HardEvent::MTE3_V>(EVENT_ID1);

        for (uint32_t loopIdx = 0; loopIdx < loopNum; loopIdx++) {
            uint32_t copyRows = (loopIdx == (loopNum - 1)) ? tailRow : tileRow;

            int32_t eventID = ((loopIdx & 1) == 0 ? EVENT_ID0 : EVENT_ID1);
            AscendC::LocalTensor<float>& xLocal = ((loopIdx & 1) == 0 ? xPing : xPong);
            AscendC::LocalTensor<float>& yLocal = ((loopIdx & 1) == 0 ? yPing : yPong);

            AscendC::WaitFlag<AscendC::HardEvent::V_MTE2>(eventID);

            uint32_t blockLen = actualSingleCoreN * sizeof(float);
            uint32_t srcStride = (totalN - actualSingleCoreN) * sizeof(float);
            uint32_t dstStride = 0;
            AscendC::DataCopyExtParams copyParams = {
                static_cast<uint16_t>(copyRows), blockLen, srcStride, dstStride, 0};
            AscendC::DataCopyPadExtParams<float> padParams = {false, 0, 0, 0};
            AscendC::DataCopyPad<float>(xLocal, xGm[loopIdx * tileRow * totalN], copyParams, padParams);

            AscendC::SetFlag<AscendC::HardEvent::MTE2_V>(eventID);
            AscendC::WaitFlag<AscendC::HardEvent::MTE2_V>(eventID);
            AscendC::WaitFlag<AscendC::HardEvent::MTE3_V>(eventID);

            if constexpr (scenarioNum == 0) {
                GeluCompute(xLocal, yLocal, copyRows * singleCoreN);
            } else if (scenarioNum == 1 || scenarioNum == 2) {
                GeluRegBaseCompute(xLocal, yLocal, copyRows * singleCoreN);
            }
            AscendC::SetFlag<AscendC::HardEvent::V_MTE2>(eventID);

            AscendC::SetFlag<AscendC::HardEvent::V_MTE3>(eventID);
            AscendC::WaitFlag<AscendC::HardEvent::V_MTE3>(eventID);

            copyParams.srcStride = 0;
            copyParams.dstStride = srcStride;
            AscendC::DataCopyPad<float>(yGm[loopIdx * tileRow * totalN], yLocal, copyParams);
            AscendC::SetFlag<AscendC::HardEvent::MTE3_V>(eventID);
        }

        AscendC::WaitFlag<AscendC::HardEvent::V_MTE2>(EVENT_ID0);
        AscendC::WaitFlag<AscendC::HardEvent::V_MTE2>(EVENT_ID1);
        AscendC::WaitFlag<AscendC::HardEvent::MTE3_V>(EVENT_ID0);
        AscendC::WaitFlag<AscendC::HardEvent::MTE3_V>(EVENT_ID1);
    }

private:
    static constexpr uint32_t xAddrPing = 0;
    static constexpr uint32_t xAddrPong = tileLen * sizeof(float);
    static constexpr uint32_t yAddrPing = xAddrPong + tileLen * sizeof(float);
    static constexpr uint32_t yAddrPong = yAddrPing + tileLen * sizeof(float);

    AscendC::GlobalTensor<float> xGm;
    AscendC::GlobalTensor<float> yGm;
    uint32_t actualSingleCoreM;
    uint32_t actualSingleCoreN;
};

template <uint32_t totalM, uint32_t totalN, uint32_t singleCoreM, uint32_t singleCoreN, uint32_t tileLen>
__global__ __vector__ void gelu_custom(GM_ADDR x, GM_ADDR y)
{
    KernelGelu<totalM, totalN, singleCoreM, singleCoreN, tileLen> op;
    op.Init(x, y);
    op.Process();
    AscendC::PipeBarrier<PIPE_ALL>();
}

int32_t main(int32_t argc, char* argv[])
{
    constexpr uint32_t totalM = 8192;
    constexpr uint32_t totalN = 8192;
    constexpr uint32_t singleCoreM = 256;
    constexpr uint32_t singleCoreN = 4096;
    // tileLen 和 singleCoreN 满足整数倍关系
    constexpr uint32_t tileLen = 2 * singleCoreN;
    constexpr uint32_t mTileNum = (totalM + singleCoreM - 1) / singleCoreM;
    constexpr uint32_t nTileNum = (totalN + singleCoreN - 1) / singleCoreN;
    uint32_t numBlocks = mTileNum * nTileNum;

    size_t inputByteSize = totalM * totalN * sizeof(float);
    size_t outputByteSize = totalM * totalN * sizeof(float);

    aclInit(nullptr);
    int32_t deviceId = 0;
    aclrtSetDevice(deviceId);
    aclrtStream stream = nullptr;
    aclrtCreateStream(&stream);

    uint8_t* inputHost = nullptr;
    uint8_t* inputDevice = nullptr;
    aclrtMallocHost((void**)(&inputHost), inputByteSize);
    aclrtMalloc((void**)(&inputDevice), inputByteSize, ACL_MEM_MALLOC_HUGE_FIRST);
    ReadFile("./input/input_x.bin", inputByteSize, inputHost, inputByteSize);
    aclrtMemcpy(inputDevice, inputByteSize, inputHost, inputByteSize, ACL_MEMCPY_HOST_TO_DEVICE);

    uint8_t* outputHost = nullptr;
    uint8_t* outputDevice = nullptr;
    aclrtMallocHost((void**)(&outputHost), outputByteSize);
    aclrtMalloc((void**)(&outputDevice), outputByteSize, ACL_MEM_MALLOC_HUGE_FIRST);

    gelu_custom<totalM, totalN, singleCoreM, singleCoreN, tileLen>
        <<<numBlocks, nullptr, stream>>>(inputDevice, outputDevice);
    aclrtSynchronizeStream(stream);

    aclrtMemcpy(outputHost, outputByteSize, outputDevice, outputByteSize, ACL_MEMCPY_DEVICE_TO_HOST);
    WriteFile("./output/output.bin", outputHost, outputByteSize);

    aclrtFree(inputDevice);
    aclrtFreeHost(inputHost);
    aclrtFree(outputDevice);
    aclrtFreeHost(outputHost);

    aclrtDestroyStream(stream);
    aclrtResetDevice(deviceId);
    aclFinalize();

    printf("GELU operator completed.\n");
    return 0;
}`.replace(/\n$/, '').split('\n');

    const GELU_HIGH_PERF_LINES = [
      {
        id: 'gelu-hp-l53',
        line: 53,
        kind: 'control',
        tag: 'tile tail',
        code: 'actualSingleCoreM = (mIterIdx == (mIndex - 1)) ? tailSingleCoreM : singleCoreM;',
        short: '按 blockIdx 推导 M/N tile 与 tail，仍是标量控制下的 SIMD 主路径。',
        selectors: ['#mem950-aiv1 [data-aiv-node="scalar:Scalar"]', '#mem950-aiv1 [data-aiv-node="exec:SIMD"]'],
        routes: [],
        path: 'BlockIdx → Scalar tiling → SIMD region',
        verdict: 'SIMD tail 控制',
        reasons: ['标量守卫', '固定 tile 长度', '无数据相关分支'],
        explanation: '性能样例的 tail 是 tile 边界控制，不是按元素 mask 分支；950 Inspector 应保持 SIMT cycle 为 0。',
        rewrite: 'actualSingleCoreM = SelectTail(mIterIdx, mIndex, tailSingleCoreM, singleCoreM);',
        metrics: { confidence: '86%', cycles: '0% SIMT', pressure: '控制中' }
      },
      {
        id: 'gelu-hp-l65',
        line: 65,
        kind: 'compute',
        tag: '公式展开',
        code: 'AscendC::Mul(yLocal, xLocal, xLocal, n);',
        short: '手写 tanh 近似公式，形成连续 Vector 算术链。',
        selectors: ['#mem950-aiv1 [data-aiv-node="buffer:UB"]', '#mem950-aiv1 [data-aiv-node="exec:SIMD"]', '#mem950-aiv1 [data-aiv-node="vector:Vector"]'],
        routes: [],
        path: 'AIV UB → SIMD → Vector arithmetic chain',
        verdict: 'SIMD 算术链',
        reasons: ['稠密向量通道', '数据已在 UB', '无分支发散'],
        explanation: 'Mul/Muls/Add/Exp/Div 串联后，主要瓶颈来自 Vector pipeline latency 和 barrier 排布，而不是 SIMT 分支。',
        rewrite: 'Fuse Mul/Muls/Add/Exp/Div into RegBase/VF path when n is repeat-aligned;',
        metrics: { confidence: '90%', cycles: '-18%', pressure: '寄存器中' }
      },
      {
        id: 'gelu-hp-l89',
        line: 89,
        kind: 'compute',
        tag: 'VF 内核',
        code: '__simd_vf__ inline static void GeluVfBasic(',
        short: '把 GELU 公式下沉到 VF 函数，减少高阶 API 展开不可见性。',
        selectors: ['#mem950-aiv1 [data-aiv-node="exec:SIMD"]', '#mem950-aiv1 [data-aiv-node="vector:Vector"]'],
        routes: [],
        path: 'RegBase → VF fused sequence → Vector lanes',
        verdict: 'RegBase/VF 融合',
        reasons: ['稠密向量通道', '无分支发散', '数据已在 UB'],
        explanation: 'VF 版本是 950/910B 都能解释的 SIMD 优化路径；950 侧可进一步输出 cycle split 和寄存器压力。',
        rewrite: '__simd_vf__ inline static void GeluVfBasic(...) // report RegBase occupancy',
        metrics: { confidence: '94%', cycles: '-24%', pressure: '寄存器中' }
      },
      {
        id: 'gelu-hp-l120',
        line: 120,
        kind: 'compute',
        tag: 'asc_vf_call',
        code: 'asc_vf_call<GeluVfBasic>(xAddr, yAddr, n, loopNum);',
        short: '主计算通过 asc_vf_call 进入融合 VF 路径，是性能样例的核心优化点。',
        selectors: ['#mem950-aiv1 [data-aiv-node="buffer:UB"]', '#mem950-aiv1 [data-aiv-node="exec:SIMD"]', '#mem950-aiv1 [data-aiv-node="vector:Vector"]'],
        routes: [],
        path: 'UB physical addr → asc_vf_call → VF SIMD',
        verdict: 'SIMD fast path',
        reasons: ['稠密向量通道', '数据已在 UB', '无分支发散'],
        explanation: 'Inspector 应把这行作为高性能 GELU 的主要收益来源，并展示 RegBase/VF 与普通 AscendC API 的 cycle 差异。',
        rewrite: 'asc_vf_call<GeluVfBasic>(xAddr, yAddr, AlignTo(n, oneRepeatSize), loopNum);',
        metrics: { confidence: '96%', cycles: '-31%', pressure: '寄存器中' }
      },
      {
        id: 'gelu-hp-l154',
        line: 154,
        kind: 'memory',
        tag: 'DataCopyPad',
        code: 'AscendC::DataCopyPad<float>(xLocal, xGm[loopIdx * tileRow * totalN], copyParams, padParams);',
        short: '按二维 stride 搬入 ping/pong UB，是 128B sector 和 NDDMA 重写检查点。',
        selectors: ['[data-mem950-node="rail:GM"]', '[data-mem950-node="rail:L2"]', '#mem950-aiv1 [data-aiv-node="buffer:UB"]'],
        routes: ['l2-to-aiv1'],
        path: 'GM strided tile → L2 → Ping/Pong UB',
        verdict: 'stride 搬运',
        reasons: ['GM 连续读', '128B sector 友好', 'MTE2 可搬运'],
        explanation: 'singleCoreN=4096 时单行 blockLen 很大，适合做 sector hit rate 与 NDDMA/预取收益评估。',
        rewrite: 'Mark copyParams as nddma_rewrite_candidate when blockLen % 128 == 0 && srcStride is stable;',
        metrics: { confidence: '91%', cycles: '-16%', pressure: 'L2 中' }
      },
      {
        id: 'gelu-hp-l160',
        line: 160,
        kind: 'control',
        tag: '场景选择',
        code: 'if constexpr (scenarioNum == 0) {',
        short: '编译期选择普通 Vector 或 RegBase/VF 路径，用于对比优化 case。',
        selectors: ['#mem950-aiv1 [data-aiv-node="scalar:Scalar"]', '#mem950-aiv1 [data-aiv-node="exec:SIMD"]'],
        routes: [],
        path: 'Compile-time scenario → SIMD implementation choice',
        verdict: '白盒分支',
        reasons: ['固定 tile 长度', '无数据相关分支', '稠密向量通道'],
        explanation: '这是编译期场景开关，不会引入运行时 SIMT island；Inspector 可以展示不同 scenario 的 cycle what-if。',
        rewrite: 'Report scenarioNum=0/1/2 cycle delta and RegBase enablement reason;',
        metrics: { confidence: '89%', cycles: 'what-if', pressure: '控制低' }
      },
      {
        id: 'gelu-hp-l172',
        line: 172,
        kind: 'memory',
        tag: 'UB→GM 写回',
        code: 'AscendC::DataCopyPad<float>(yGm[loopIdx * tileRow * totalN], yLocal, copyParams);',
        short: '结果从 ping/pong UB 写回 GM，和下一轮读入通过 eventID 交错。',
        selectors: ['#mem950-aiv1 [data-aiv-node="buffer:UB"]', '[data-mem950-node="rail:L2"]', '[data-mem950-node="rail:GM"]'],
        routes: ['aiv1-to-l2'],
        path: 'Ping/Pong UB → L2 → GM strided tile',
        verdict: '双缓冲写回',
        reasons: ['写回连续', 'UB 排空', 'MTE3 可搬运'],
        explanation: '配合 V_MTE2 / MTE3_V eventID，950 迁移助手可以检查是否能用更窄同步或 BufferID 表达。',
        rewrite: 'Replace coarse event waits with BufferID producer/consumer barriers when dependency scope is local;',
        metrics: { confidence: '90%', cycles: '-13%', pressure: 'sync 中' }
      },
      { id: 'gelu-hp-l95-tag', line: 95, kind: 'control', tag: 'unroll case', tagOnly: true },
      { id: 'gelu-hp-l134-tag', line: 134, kind: 'control', tag: '双缓冲 flag', tagOnly: true },
      { id: 'gelu-hp-l146-tag', line: 146, kind: 'control', tag: '等待读槽', tagOnly: true },
      { id: 'gelu-hp-l156-tag', line: 156, kind: 'control', tag: '读完置位', tagOnly: true },
      { id: 'gelu-hp-l163-tag', line: 163, kind: 'compute', tag: 'RegBase', tagOnly: true },
      { id: 'gelu-hp-l167-tag', line: 167, kind: 'control', tag: '写回置位', tagOnly: true },
      { id: 'gelu-hp-l236-tag', line: 236, kind: 'control', tag: 'launch', tagOnly: true }
    ];

    window.registerWorkbenchKernel({
      id: 'gelu_high_performance',
      name: 'gelu_high_performance.asc',
      label: 'gelu_custom · high performance',
      path: 'gitcode.com/cann/asc-devkit/.../gelu_high_performance/gelu.asc',
      sourceUrl: 'https://gitcode.com/cann/asc-devkit/blob/master/examples/01_simd_cpp_api/04_best_practices/02_reg_vector_compute_practices/gelu_high_performance/gelu.asc',
      summary: 'GELU RegBase/VF fusion and loop-unroll sample',
      target: 'Ascend 950 / 910B',
      analysis: 'T2 编译估算 + RegBase/VF',
      verdict: 'SIMD optimized path',
      defaultTier: 't2',
      selectedId: 'gelu-hp-l120',
      family: 'gelu',
      profile: 'gelu_high_performance',
      sourceLines: GELU_HIGH_PERF_SOURCE_LINES,
      annotations: GELU_HIGH_PERF_LINES
    });
})();
