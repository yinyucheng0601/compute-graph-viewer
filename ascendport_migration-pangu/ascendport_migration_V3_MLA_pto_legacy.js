// Extracted unchanged from ascendport_migration_V3_MLA.html for PTO shell refresh.
// Business data/state machine remains page-owned; visual shell lives in ascendport_migration_V3_MLA_pto.html.
/* ============================ 源代码 & 产物 ============================ */
const CUDA = String.raw`import torch
import triton
import triton.language as tl
import math
import time

@triton.jit
def _flash_attention_v2_forward_kernel(
    # 查询、键、值张量指针
    q_ptr, k_ptr, v_ptr, output_ptr,
    # softmax统计量指针 (用于backward)
    l_ptr, m_ptr,
    # 张量的形状参数
    batch_size, seq_len, head_dim,
    # 块大小设置
    BLOCK_SIZE_M: tl.constexpr, BLOCK_SIZE_N: tl.constexpr, BLOCK_SIZE_DMODEL: tl.constexpr,
    # 缩放因子
    scale,
):
    """Flash Attention v2 前向内核实现"""
    # 获取程序ID
    pid = tl.program_id(0)
    batch_id = tl.program_id(1)
    
    # 计算当前处理的行范围
    row_start = pid * BLOCK_SIZE_M
    row_offsets = row_start + tl.arange(0, BLOCK_SIZE_M)
    row_mask = row_offsets < seq_len
    
    # 计算批次偏移
    batch_offset = batch_id * seq_len * BLOCK_SIZE_DMODEL
    
    # 加载Q块
    q_offsets = tl.arange(0, BLOCK_SIZE_DMODEL)
    q_block_ptr = q_ptr + batch_offset + row_offsets[:, None] * BLOCK_SIZE_DMODEL + q_offsets[None, :]
    q_block = tl.load(q_block_ptr, mask=row_mask[:, None], other=0.0)
    
    # 初始化输出和softmax统计量
    acc_o = tl.zeros([BLOCK_SIZE_M, BLOCK_SIZE_DMODEL], dtype=tl.float32)
    m_i = tl.zeros([BLOCK_SIZE_M], dtype=tl.float32) - float('inf')
    l_i = tl.zeros([BLOCK_SIZE_M], dtype=tl.float32)
    
    # Flash Attention v2的核心改进：按列分块处理，减少HBM访问
    for start_n in range(0, seq_len, BLOCK_SIZE_N):
        # 计算当前列块的范围
        end_n = min(start_n + BLOCK_SIZE_N, seq_len)
        col_offsets = start_n + tl.arange(0, BLOCK_SIZE_N)
        col_mask = col_offsets < end_n
        
        # 加载K块
        k_block_ptr = k_ptr + batch_offset + col_offsets[:, None] * BLOCK_SIZE_DMODEL + q_offsets[None, :]
        k_block = tl.load(k_block_ptr, mask=col_mask[:, None], other=0.0)
        
        # 加载V块
        v_block_ptr = v_ptr + batch_offset + col_offsets[:, None] * BLOCK_SIZE_DMODEL + q_offsets[None, :]
        v_block = tl.load(v_block_ptr, mask=col_mask[:, None], other=0.0)
        
        # 计算Q @ K^T
        qk = tl.dot(q_block, tl.trans(k_block)) * scale
        
        # 应用因果mask (如果需要)
        if start_n > row_start:
            causal_mask = col_offsets[None, :] <= row_offsets[:, None]
            qk = tl.where(causal_mask, qk, float('-inf'))
        
        # 计算当前块的最大值
        m_ij = tl.max(qk, axis=1)
        m_i_new = tl.maximum(m_i, m_ij)
        
        # 计算缩放因子
        p_scale = tl.exp(m_i - m_i_new)
        
        # 更新softmax分母
        p_ij = tl.exp(qk - m_i_new[:, None])
        l_i_new = l_i * p_scale + tl.sum(p_ij, axis=1)
        
        # 更新输出
        acc_o = acc_o * p_scale[:, None] + tl.dot(p_ij, v_block)
        
        # 更新统计量
        m_i = m_i_new
        l_i = l_i_new
    
    # 最终归一化
    acc_o = acc_o / l_i[:, None]
    
    # 存储输出
    output_block_ptr = output_ptr + batch_offset + row_offsets[:, None] * BLOCK_SIZE_DMODEL + q_offsets[None, :]
    tl.store(output_block_ptr, acc_o, mask=row_mask[:, None])
    
    # 存储softmax统计量 (用于backward)
    l_block_ptr = l_ptr + batch_offset + row_offsets
    m_block_ptr = m_ptr + batch_offset + row_offsets
    tl.store(l_block_ptr, l_i, mask=row_mask)
    tl.store(m_block_ptr, m_i, mask=row_mask)

@triton.jit
def _flash_attention_v2_backward_kernel(
    # 输出梯度指针
    doutput_ptr,
    # 输入梯度指针
    dq_ptr, dk_ptr, dv_ptr,
    # softmax统计量指针
    l_ptr, m_ptr,
    # 原始输入指针
    q_ptr, k_ptr, v_ptr,
    # 张量的形状参数
    batch_size, seq_len, head_dim,
    # 块大小设置
    BLOCK_SIZE_M: tl.constexpr, BLOCK_SIZE_N: tl.constexpr, BLOCK_SIZE_DMODEL: tl.constexpr,
    # 缩放因子
    scale,
):
    """Flash Attention v2 反向内核实现"""
    # 获取程序ID
    pid = tl.program_id(0)
    batch_id = tl.program_id(1)
    
    # 计算当前处理的行范围
    row_start = pid * BLOCK_SIZE_M
    row_offsets = row_start + tl.arange(0, BLOCK_SIZE_M)
    row_mask = row_offsets < seq_len
    
    # 计算批次偏移
    batch_offset = batch_id * seq_len * BLOCK_SIZE_DMODEL
    
    # 加载softmax统计量
    l_i = tl.load(l_ptr + batch_offset + row_offsets, mask=row_mask)
    m_i = tl.load(m_ptr + batch_offset + row_offsets, mask=row_mask)
    
    # 加载输出梯度
    doutput_offsets = tl.arange(0, BLOCK_SIZE_DMODEL)
    doutput_block_ptr = doutput_ptr + batch_offset + row_offsets[:, None] * BLOCK_SIZE_DMODEL + doutput_offsets[None, :]
    doutput = tl.load(doutput_block_ptr, mask=row_mask[:, None], other=0.0)
    
    # 初始化梯度
    dq = tl.zeros([BLOCK_SIZE_M, BLOCK_SIZE_DMODEL], dtype=tl.float32)
    dk = tl.zeros([BLOCK_SIZE_M, BLOCK_SIZE_DMODEL], dtype=tl.float32)
    dv = tl.zeros([BLOCK_SIZE_M, BLOCK_SIZE_DMODEL], dtype=tl.float32)
    
    # 反向传播
    for start_n in range(0, seq_len, BLOCK_SIZE_N):
        # 计算当前列块的范围
        end_n = min(start_n + BLOCK_SIZE_N, seq_len)
        col_offsets = start_n + tl.arange(0, BLOCK_SIZE_N)
        col_mask = col_offsets < end_n
        
        # 加载K, V块
        k_block_ptr = k_ptr + batch_offset + col_offsets[:, None] * BLOCK_SIZE_DMODEL + doutput_offsets[None, :]
        k_block = tl.load(k_block_ptr, mask=col_mask[:, None], other=0.0)
        
        v_block_ptr = v_ptr + batch_offset + col_offsets[:, None] * BLOCK_SIZE_DMODEL + doutput_offsets[None, :]
        v_block = tl.load(v_block_ptr, mask=col_mask[:, None], other=0.0)
        
        # 计算Q @ K^T
        qk = tl.dot(q_block, tl.trans(k_block)) * scale
        
        # 计算softmax
        p_ij = tl.exp(qk - m_i[:, None])
        p_ij = p_ij / l_i[:, None]
        
        # 计算dv
        dv += tl.dot(tl.trans(p_ij), doutput)
        
        # 计算dp
        dp = tl.dot(doutput, tl.trans(v_block))
        
        # 计算dq
        ds = (p_ij * (dp - tl.sum(p_ij * dp, axis=1, keepdims=True))) * scale
        dq += tl.dot(ds, k_block)
        
        # 计算dk
        dk += tl.dot(tl.trans(ds), q_block)
    
    # 存储梯度
    dq_block_ptr = dq_ptr + batch_offset + row_offsets[:, None] * BLOCK_SIZE_DMODEL + doutput_offsets[None, :]
    dk_block_ptr = dk_ptr + batch_offset + row_offsets[:, None] * BLOCK_SIZE_DMODEL + doutput_offsets[None, :]
    dv_block_ptr = dv_ptr + batch_offset + row_offsets[:, None] * BLOCK_SIZE_DMODEL + doutput_offsets[None, :]
    
    tl.store(dq_block_ptr, dq, mask=row_mask[:, None])
    tl.store(dk_block_ptr, dk, mask=row_mask[:, None])
    tl.store(dv_block_ptr, dv, mask=row_mask[:, None])

class FlashAttentionV2Function(torch.autograd.Function):
    """Flash Attention v2 的autograd函数"""
    
    @staticmethod
    def forward(ctx, q, k, v, scale=None):
        """
        Flash Attention v2 前向传播
        
        参数:
            q: 查询张量 [batch_size, seq_len, head_dim]
            k: 键张量 [batch_size, seq_len, head_dim]
            v: 值张量 [batch_size, seq_len, head_dim]
            scale: 缩放因子，默认为1/sqrt(head_dim)
        """
        batch_size, seq_len, head_dim = q.shape
        
        # 默认缩放因子
        if scale is None:
            scale = 1.0 / math.sqrt(head_dim)
        
        # 确保输入是连续的
        q = q.contiguous()
        k = k.contiguous()
        v = v.contiguous()
        
        # 分配输出张量
        output = torch.empty_like(q)
        
        # 分配softmax统计量
        l_i = torch.empty(batch_size, seq_len, dtype=torch.float32, device=q.device)
        m_i = torch.empty(batch_size, seq_len, dtype=torch.float32, device=q.device)
        
        # 确定块大小 - Flash Attention v2优化
        BLOCK_SIZE_M = 128
        BLOCK_SIZE_N = 128
        BLOCK_SIZE_DMODEL = head_dim
        
        # 计算网格维度
        grid = (
            triton.cdiv(seq_len, BLOCK_SIZE_M),  # 行块数
            batch_size,  # 批次数
        )
        
        # 启动前向内核
        _flash_attention_v2_forward_kernel[grid](
            q, k, v, output,
            l_i, m_i,
            batch_size, seq_len, head_dim,
            BLOCK_SIZE_M, BLOCK_SIZE_N, BLOCK_SIZE_DMODEL,
            scale,
        )
        
        # 保存用于backward的张量
        ctx.save_for_backward(q, k, v, l_i, m_i)
        ctx.scale = scale
        ctx.BLOCK_SIZE_M = BLOCK_SIZE_M
        ctx.BLOCK_SIZE_N = BLOCK_SIZE_N
        ctx.BLOCK_SIZE_DMODEL = BLOCK_SIZE_DMODEL
        
        return output
    
    @staticmethod
    def backward(ctx, doutput):
        """
        Flash Attention v2 反向传播
        
        参数:
            doutput: 输出梯度 [batch_size, seq_len, head_dim]
        """
        # 获取保存的张量
        q, k, v, l_i, m_i = ctx.saved_tensors
        scale = ctx.scale
        BLOCK_SIZE_M = ctx.BLOCK_SIZE_M
        BLOCK_SIZE_N = ctx.BLOCK_SIZE_N
        BLOCK_SIZE_DMODEL = ctx.BLOCK_SIZE_DMODEL
        
        batch_size, seq_len, head_dim = q.shape
        
        # 分配梯度张量
        dq = torch.empty_like(q)
        dk = torch.empty_like(k)
        dv = torch.empty_like(v)
        
        # 计算网格维度
        grid = (
            triton.cdiv(seq_len, BLOCK_SIZE_M),  # 行块数
            batch_size,  # 批次数
        )
        
        # 启动反向内核
        _flash_attention_v2_backward_kernel[grid](
            doutput,
            dq, dk, dv,
            l_i, m_i,
            q, k, v,
            batch_size, seq_len, head_dim,
            BLOCK_SIZE_M, BLOCK_SIZE_N, BLOCK_SIZE_DMODEL,
            scale,
        )
        
        return dq, dk, dv, None

def flash_attention_v2(q, k, v, scale=None):
    """
    使用Flash Attention v2算法进行高效注意力计算
    
    Flash Attention v2的改进：
    1. 更好的IO-awareness，减少HBM访问
    2. 支持反向传播，可用于训练
    3. 优化的块大小和计算顺序
    4. 更好的数值稳定性
    
    参数:
        q: 查询张量 [batch_size, seq_len, head_dim]
        k: 键张量 [batch_size, seq_len, head_dim]
        v: 值张量 [batch_size, seq_len, head_dim]
        scale: 缩放因子，默认为1/sqrt(head_dim)
    
    返回:
        output: 注意力输出 [batch_size, seq_len, head_dim]
    """
    return FlashAttentionV2Function.apply(q, k, v, scale)

def benchmark_flash_attention_v2(batch_size, seq_len, head_dim):
    """测试Flash Attention v2性能"""
    # 创建随机输入
    q = torch.randn(batch_size, seq_len, head_dim, device='cuda', requires_grad=True)
    k = torch.randn(batch_size, seq_len, head_dim, device='cuda', requires_grad=True)
    v = torch.randn(batch_size, seq_len, head_dim, device='cuda', requires_grad=True)
    
    # 预热
    _ = flash_attention_v2(q, k, v)
    torch.cuda.synchronize()
    
    # 测量前向时间
    torch.cuda.synchronize()
    start_time = time.time()
    output = flash_attention_v2(q, k, v)
    torch.cuda.synchronize()
    forward_time = (time.time() - start_time) * 1000
    
    # 测量反向时间
    loss = output.sum()
    torch.cuda.synchronize()
    start_time = time.time()
    loss.backward()
    torch.cuda.synchronize()
    backward_time = (time.time() - start_time) * 1000
    
    return forward_time, backward_time

def main():
    """主函数：运行Flash Attention v2性能测试"""
    print("Flash Attention v2 性能测试")
    print("========================")
    
    batch_size = 4
    head_dim = 64
    seq_lengths = [512, 1024, 2048, 4096]
    
    print("序列长度 | 前向时间 (ms) | 反向时间 (ms) | 总时间 (ms)")
    print("--------|-------------|-------------|----------")
    
    for seq_len in seq_lengths:
        try:
            forward_time, backward_time = benchmark_flash_attention_v2(batch_size, seq_len, head_dim)
            total_time = forward_time + backward_time
            print(f"{seq_len:8d} | {forward_time:13.2f} | {backward_time:13.2f} | {total_time:10.2f}")
        except RuntimeError as e:
            print(f"{seq_len:8d} | 内存不足       | 内存不足       | 内存不足")
    
    print("\nFlash Attention v2的主要优势:")
    print("1. 支持反向传播，可用于模型训练")
    print("2. 更好的IO-awareness，减少HBM访问次数")
    print("3. 优化的块大小和计算顺序")
    print("4. 更好的数值稳定性")

if __name__ == "__main__":
    main()`;

const S3 = String.raw`// flash_mla_decode.cpp · AscendC 核  (AscendPort · S3 自动生成)
// 由 example_mla_decode.py 迁移 —— SIMT grid → 分核 SPMD
#include "kernel_operator.h"
using namespace AscendC;

constexpr int32_t DIM     = 512;   // KV / V 主维 (non-pe)
constexpr int32_t PE_DIM  = 64;    // RoPE 位置编码维
constexpr int32_t BLOCK_N = 128;   // KV 序列分块

class FlashMLADecode {
public:
    __aicore__ inline FlashMLADecode() {}
    __aicore__ inline void Init(GM_ADDR q, GM_ADDR qPe, GM_ADDR kv,
                                GM_ADDR kPe, GM_ADDR out,
                                int32_t B, int32_t numHeads,
                                int32_t seqlenKv, float softmaxScale) {
        // CUDA: (blockIdx.x=head-group, blockIdx.y=batch) → 昇腾:按 AI Core 切分 (batch, head) 对
        this->batchIdx = GetBlockIdx() / numHeads;
        this->headIdx  = GetBlockIdx() % numHeads;
        this->B = B;  this->numHeads = numHeads;  this->seqlenKv = seqlenKv;
        this->softmaxScale = softmaxScale;
        qGm.SetGlobalBuffer((__gm__ half*)q);
        qPeGm.SetGlobalBuffer((__gm__ half*)qPe);
        kvGm.SetGlobalBuffer((__gm__ half*)kv);
        kPeGm.SetGlobalBuffer((__gm__ half*)kPe);
        outGm.SetGlobalBuffer((__gm__ half*)out);
        // TODO(S4): 分配 L1 / L0A / L0B / L0C / UB,插入逐级 DataCopy
        // TODO(S5): 沿 KV(seqlen 维)选择分块长度
    }
    __aicore__ inline void Process() {
        if (batchIdx >= B || headIdx >= numHeads) return;
        ComputeAttention();     // QKᵀ+PEᵀ(矩阵单元) → 在线 Softmax(向量单元) → P·V 累加
    }
private:
    // TODO(S4): QKᵀ 走矩阵单元,在线 Softmax 走向量单元,P·V 回矩阵单元
    __aicore__ inline void ComputeAttention() { /* 待 S4 填充 */ }
    // TODO(S6): 替代 use_swizzle / GemmWarpPolicy(SIMT 专属) → 分核 + 向量单元规约

    GlobalTensor<half> qGm, qPeGm, kvGm, kPeGm, outGm;
    int32_t batchIdx, headIdx, B, numHeads, seqlenKv;
    float softmaxScale;
};

extern "C" __global__ __aicore__ void flash_mla_decode(
        GM_ADDR q, GM_ADDR qPe, GM_ADDR kv,
        GM_ADDR kPe, GM_ADDR out, GM_ADDR tiling) {
    FlashMLADecode op;
    op.Init(q, qPe, kv, kPe, out, /*B*/0, /*numHeads*/0, /*seqlenKv*/0, /*scale*/1.0f);
    op.Process();
}
`;

const S4 = String.raw`// flash_mla_decode.cpp · AscendC 核  (AscendPort · S4 内存层次已注入)
#include "kernel_operator.h"
using namespace AscendC;

constexpr int32_t DIM     = 512;
constexpr int32_t PE_DIM  = 64;
constexpr int32_t BLOCK_N = 128;

class FlashMLADecode {
public:
    __aicore__ inline void Init(GM_ADDR q, GM_ADDR qPe, GM_ADDR kv,
                                GM_ADDR kPe, GM_ADDR out,
                                GM_ADDR workspace,
                                int32_t B, int32_t numHeads,
                                int32_t seqlenKv, float softmaxScale, int32_t nTile) {
        this->batchIdx = GetBlockIdx() / numHeads;
        this->headIdx  = GetBlockIdx() % numHeads;
        this->B = B; this->numHeads = numHeads; this->seqlenKv = seqlenKv;
        this->softmaxScale = softmaxScale; this->nTile = nTile;
        qGm.SetGlobalBuffer((__gm__ half*)q);
        qPeGm.SetGlobalBuffer((__gm__ half*)qPe);
        kvGm.SetGlobalBuffer((__gm__ half*)kv);
        kPeGm.SetGlobalBuffer((__gm__ half*)kPe);
        outGm.SetGlobalBuffer((__gm__ half*)out);
        wsGm.SetGlobalBuffer((__gm__ float*)workspace);                  // L0C→GM→UB 中转工作区
        // === 片上缓冲层次(S4 注入)===
        pipe.InitBuffer(qL1,  1, (DIM + PE_DIM) * sizeof(half));         // Q|Q_pe: GM→L1→L0A
        pipe.InitBuffer(kL1,  1, BLOCK_N * (DIM + PE_DIM) * sizeof(half));// KV|K_pe: GM→L1→L0B
        pipe.InitBuffer(vL1,  1, BLOCK_N * DIM * sizeof(half));          // V(=KV): GM→L1
        pipe.InitBuffer(cO,   1, BLOCK_N * sizeof(float));               // QKᵀ logits: L0C
        pipe.InitBuffer(ubQK, 1, BLOCK_N * sizeof(float));              // 在线 Softmax 中间: UB
        pipe.InitBuffer(ubOut,1, DIM * sizeof(float));                  // 输出累加: UB
    }
    __aicore__ inline void Process() {
        if (batchIdx >= B || headIdx >= numHeads) return;
        // 加载 Q 与 Q_pe (拼接为 [DIM+PE_DIM])
        LocalTensor<half> qLoc = qL1.AllocTensor<half>();
        DataCopy(qLoc,        qGm[(batchIdx * numHeads + headIdx) * DIM], DIM);
        DataCopy(qLoc[DIM], qPeGm[(batchIdx * numHeads + headIdx) * PE_DIM], PE_DIM);
        qL1.EnQue(qLoc);
        LocalTensor<half> q = qL1.DeQue<half>();

        LocalTensor<float> outAcc = ubOut.Get<float>();
        SetValue(outAcc, DIM, 0.f);                                 // 初始化输出累加器 acc_o
        float mPrev = -1e30f, lPrev = 0.f;                          // 在线 Softmax 统计量

        // 沿 KV 序列分块遍历 (dense, 全序列)
        for (int32_t tile = 0; tile < nTile; ++tile) {
            ComputeTile(q, tile, outAcc, mPrev, lPrev);
        }
        // 归一化并写回
        Div(outAcc, outAcc, lPrev, DIM);                           // 向量单元: acc_o /= logsum
        DataCopy(outGm[(batchIdx * numHeads + headIdx) * DIM], outAcc, DIM);
        qL1.FreeTensor(q);
    }
private:
    __aicore__ inline void ComputeTile(LocalTensor<half>& q, int32_t tile,
                                       LocalTensor<float>& outAcc, float& mPrev, float& lPrev) {
        int32_t kvStart  = tile * BLOCK_N;
        int32_t tileSize = min(BLOCK_N, seqlenKv - kvStart);

        // 加载 KV 分块 (K 的非位置部分 + K_pe),GM→L1
        LocalTensor<half> kLoc = kL1.AllocTensor<half>();
        DataCopy(kLoc,      kvGm[(batchIdx * seqlenKv + kvStart) * DIM], tileSize * DIM);
        DataCopy(kLoc[tileSize * DIM], kPeGm[(batchIdx * seqlenKv + kvStart) * PE_DIM], tileSize * PE_DIM);
        kL1.EnQue(kLoc);
        LocalTensor<half> k = kL1.DeQue<half>();

        // 矩阵单元: QKᵀ = Q·KVᵀ + Q_pe·K_peᵀ (两段累加)
        LocalTensor<float> logits = cO.AllocTensor<float>();
        Mmad(logits, q, k, {1, tileSize, DIM + PE_DIM});           // [1, tileSize] logits → L0C
        Muls(logits, logits, softmaxScale, tileSize);              // logits *= softmax_scale
        cO.EnQue(logits);
        LocalTensor<float> lg = cO.DeQue<float>();

        // 在线 Softmax: L0C 无直连 UB → 经 GM 中转 (L0C→GM→UB),再向量单元规约
        int32_t coreIdx = GetBlockIdx();
        DataCopy(wsGm[coreIdx * BLOCK_N], lg, tileSize);          // L0C → GM workspace
        LocalTensor<float> qkScores = ubQK.Get<float>();
        DataCopy(qkScores, wsGm[coreIdx * BLOCK_N], tileSize);    // GM → UB
        float mCurr = ReduceMax(qkScores, tileSize);              // 向量单元: reduce_max
        float mNew  = fmaxf(mPrev, mCurr);
        float alpha = expf(mPrev - mNew);                         // exp2→exp: 去 log2(e)
        Muls(outAcc, outAcc, alpha, DIM);                        // rescale 历史输出 acc_o

        Subs(qkScores, qkScores, mNew, tileSize);                 // qk -= mNew
        Exp(qkScores, qkScores, tileSize);                        // qk = exp(qk)  自然底
        float localSum = ReduceSum(qkScores, tileSize);          // 向量单元: reduce_sum
        float lNew = lPrev * alpha + localSum;                    // logsum 在线更新

        // P·V 累加:概率 qkScores 逐行加权 V(=KV 的非位置部分)
        for (int32_t j = 0; j < tileSize; ++j) {
            float weight = qkScores[j];
            Axpy(outAcc, k[j * (DIM + PE_DIM)], weight, DIM);    // acc_o += weight * v[j]
        }

        mPrev = mNew; lPrev = lNew;
        kL1.FreeTensor(k); cO.FreeTensor(lg);
    }

    TPipe pipe;
    TQue<TPosition::A1, 1> qL1;
    TQue<TPosition::B1, 1> kL1;
    TQue<TPosition::VECIN,1> vL1;
    TQue<TPosition::CO1,1> cO;
    TBuf<TPosition::VECCALC> ubQK, ubOut;
    GlobalTensor<half> qGm, qPeGm, kvGm, kPeGm, outGm;
    GlobalTensor<float> wsGm;                                     // GM workspace: L0C→GM→UB
    int32_t batchIdx, headIdx, B, numHeads, seqlenKv, nTile;
    float softmaxScale;
};
`;

const S6 = String.raw`// flash_mla_decode.cpp · AscendC 核  (AscendPort · S6 双缓冲流水已编排)
#include "kernel_operator.h"
using namespace AscendC;

constexpr int32_t DIM     = 512;
constexpr int32_t PE_DIM  = 64;
constexpr int32_t BLOCK_N = 128;
constexpr int32_t DEPTH   = 2;              // ← 双缓冲深度

class FlashMLADecode {
public:
    __aicore__ inline void Init(GM_ADDR q, GM_ADDR qPe, GM_ADDR kv,
                                GM_ADDR kPe, GM_ADDR out,
                                GM_ADDR workspace,
                                int32_t B, int32_t numHeads,
                                int32_t seqlenKv, float softmaxScale, int32_t nTile) {
        this->batchIdx = GetBlockIdx() / numHeads;
        this->headIdx  = GetBlockIdx() % numHeads;
        this->B = B; this->numHeads = numHeads; this->seqlenKv = seqlenKv;
        this->softmaxScale = softmaxScale; this->nTile = nTile;
        qGm.SetGlobalBuffer((__gm__ half*)q);
        qPeGm.SetGlobalBuffer((__gm__ half*)qPe);
        kvGm.SetGlobalBuffer((__gm__ half*)kv);
        kPeGm.SetGlobalBuffer((__gm__ half*)kPe);
        outGm.SetGlobalBuffer((__gm__ half*)out);
        wsGm.SetGlobalBuffer((__gm__ float*)workspace);                  // L0C→GM→UB 中转工作区
        pipe.InitBuffer(qL1,  1,     (DIM + PE_DIM) * sizeof(half));
        pipe.InitBuffer(kL1,  DEPTH, BLOCK_N * (DIM + PE_DIM) * sizeof(half));  // 深度=2 双缓冲
        pipe.InitBuffer(cO,   DEPTH, BLOCK_N * sizeof(float));
        pipe.InitBuffer(ubQK, DEPTH, BLOCK_N * sizeof(float));
        pipe.InitBuffer(ubOut,1,     DIM * sizeof(float));
    }
    __aicore__ inline void Process() {
        if (batchIdx >= B || headIdx >= numHeads) return;
        LocalTensor<half> qLoc = qL1.AllocTensor<half>();
        DataCopy(qLoc,        qGm[(batchIdx * numHeads + headIdx) * DIM], DIM);
        DataCopy(qLoc[DIM], qPeGm[(batchIdx * numHeads + headIdx) * PE_DIM], PE_DIM);
        qL1.EnQue(qLoc);
        LocalTensor<half> q = qL1.DeQue<half>();

        LocalTensor<float> outAcc = ubOut.Get<float>();
        SetValue(outAcc, DIM, 0.f);
        float mPrev = -1e30f, lPrev = 0.f;

        // ---- 软件流水:预取 n+1  ∥  矩阵/向量计算 n  ∥  P·V 累加 ----
        CopyInKV(0);                                        // 预热:载入第 0 块
        for (int32_t tile = 0; tile < nTile; ++tile) {
            if (tile + 1 < nTile) CopyInKV(tile + 1);       // 预取下一块(与计算重叠)
            ComputeTile(q, tile, outAcc, mPrev, lPrev);     // 矩阵 QKᵀ → 向量在线 Softmax
        }
        // 归一化并写回
        Div(outAcc, outAcc, lPrev, DIM);
        DataCopy(outGm[(batchIdx * numHeads + headIdx) * DIM], outAcc, DIM);
        qL1.FreeTensor(q);
    }
private:
    __aicore__ inline void CopyInKV(int32_t tile) {
        int32_t kvStart  = tile * BLOCK_N;
        int32_t tileSize = min(BLOCK_N, seqlenKv - kvStart);
        // KV 分块 (K 非位置部分 + K_pe) 一并载入
        LocalTensor<half> kLoc = kL1.AllocTensor<half>();
        DataCopy(kLoc,      kvGm[(batchIdx * seqlenKv + kvStart) * DIM], tileSize * DIM);
        DataCopy(kLoc[tileSize * DIM], kPeGm[(batchIdx * seqlenKv + kvStart) * PE_DIM], tileSize * PE_DIM);
        kL1.EnQue(kLoc);                                    // 入队 → 与 Compute 并行
    }
    __aicore__ inline void ComputeTile(LocalTensor<half>& q, int32_t tile,
                                       LocalTensor<float>& outAcc, float& mPrev, float& lPrev) {
        int32_t kvStart  = tile * BLOCK_N;
        int32_t tileSize = min(BLOCK_N, seqlenKv - kvStart);

        LocalTensor<half> k = kL1.DeQue<half>();            // 取上一轮预取的块
        LocalTensor<float> logits = cO.AllocTensor<float>();
        Mmad(logits, q, k, {1, tileSize, DIM + PE_DIM});    // 矩阵单元: QKᵀ + PEᵀ
        Muls(logits, logits, softmaxScale, tileSize);
        cO.EnQue(logits);
        LocalTensor<float> lg = cO.DeQue<float>();

        // L0C 无直连 UB → 经 GM 中转 (L0C→GM→UB)
        int32_t coreIdx = GetBlockIdx();
        DataCopy(wsGm[coreIdx * BLOCK_N], lg, tileSize);          // L0C → GM workspace
        LocalTensor<float> qkScores = ubQK.AllocTensor<float>();
        DataCopy(qkScores, wsGm[coreIdx * BLOCK_N], tileSize);    // GM → UB
        // use_swizzle / GemmWarpPolicy 在昇腾无对应物 → 分核 + 向量单元片上归约
        float mCurr = ReduceMax(qkScores, tileSize);        // 向量单元规约 reduce_max
        float mNew  = fmaxf(mPrev, mCurr);
        float alpha = expf(mPrev - mNew);
        Muls(outAcc, outAcc, alpha, DIM);

        Subs(qkScores, qkScores, mNew, tileSize);
        Exp(qkScores, qkScores, tileSize);                  // 自然底 exp (非 exp2)
        float localSum = ReduceSum(qkScores, tileSize);     // 向量单元规约 reduce_sum
        float lNew = lPrev * alpha + localSum;

        for (int32_t j = 0; j < tileSize; ++j) {
            float weight = qkScores[j];
            Axpy(outAcc, k[j * (DIM + PE_DIM)], weight, DIM);// P·V 累加
        }
        ubQK.EnQue(qkScores);

        mPrev = mNew; lPrev = lNew;
        kL1.FreeTensor(k); cO.FreeTensor(lg);
    }

    TPipe pipe;
    TQue<TPosition::A1, 1>        qL1;
    TQue<TPosition::B1, DEPTH>    kL1;      // ← 双缓冲
    TQue<TPosition::CO1, DEPTH>   cO;
    TQue<TPosition::VECOUT,DEPTH> ubQK;
    TBuf<TPosition::VECCALC>      ubOut;
    GlobalTensor<half> qGm, qPeGm, kvGm, kPeGm, outGm;
    GlobalTensor<float> wsGm;                                     // GM workspace: L0C→GM→UB
    int32_t batchIdx, headIdx, B, numHeads, seqlenKv, nTile;
    float softmaxScale;
};
`;

/* view: {file, lang, text, hl(lineText,idx)->class} */
function riskHL(t){return /use_swizzle|GemmWarpPolicy|T\.exp2|T\.log2|num_split/.test(t)?'hl-risk':''}
function todoHL(t){return /TODO\(/.test(t)?'hl-add':''}
function copyHL(t){return /DataCopy|InitBuffer|Mmad|Exp\(|ReduceMax|ReduceSum|AllocTensor|EnQue|DeQue/.test(t)?'hl-add':''}
// S4：内存层次注入的关键行更醒目
function s4HL(t){
  if(/InitBuffer|DataCopy|Mmad\(|Exp\(|ReduceMax|ReduceSum|Div\(/.test(t)) return 'hl-new';
  if(/AllocTensor|EnQue|DeQue|FreeTensor|\.Get<|SetValue/.test(t)) return 'hl-add';
  return '';
}
function bufHL(t){return /DEPTH|CopyInKV|预取|Ping-Pong|双缓冲|流水|EnQue|DeQue/.test(t)?'hl-buf':''}
// S6：双缓冲流水新增代码更醒目
function s6HL(t){
  if(/DEPTH|软件流水|预取|CopyInKV\(|Ping-Pong|ReduceMax|ReduceSum|nTile/.test(t)) return 'hl-new';
  if(/EnQue|DeQue|AllocTensor|FreeTensor|ComputeTile\(/.test(t)) return 'hl-buf';
  return '';
}
// tiling.h 高亮:nTile / TilingData 关键行醒目
function tilingHL(t){
  if(/nTile|TILING_KEY|TilingData|SetBlockDim|GET_TILING_DATA/.test(t)) return 'hl-new';
  if(/BEGIN_TILING|REGISTER_TILING|FIELD/.test(t)) return 'hl-add';
  return '';
}
// tiling.h 内容随所选分块方案变化
function tilingSrc(){
  const c=state.choices['S5']||'B';
  const nTile=(c==='A')?16:(c==='B')?8:4;
  const ubUtil=(c==='A')?58:(c==='B')?85:102;
  const cyc=(c==='A')?'1.00':(c==='B')?'0.68':'0.92';
  const note=(c==='C')?'// ⚠ nTile=4 超 L0C 容量,将触发回退搬运':'// ✓ 片上驻留最大化,回 GM 次数最小';
  return `// tiling.h · AscendC Tiling 结构  (AscendPort · S5 自动生成)
// 沿 KV 序列维分块:每核每次处理 BLOCK_N 个 KV,贴合 L1/L0C/UB 容量
#include "register/tilingdata_base.h"
#include "tiling/tiling_api.h"
namespace optiling {

BEGIN_TILING_DATA_DEF(FlashMLATiling)
  TILING_DATA_FIELD_DEF(int32_t, B);          // batch size
  TILING_DATA_FIELD_DEF(int32_t, numHeads);   // query heads
  TILING_DATA_FIELD_DEF(int32_t, seqlenKv);   // KV 序列长度 (dense)
  TILING_DATA_FIELD_DEF(int32_t, nTile);      // ← 分块数 = ceil(seqlenKv / BLOCK_N)
END_TILING_DATA_DEF;
REGISTER_TILING_DATA_CLASS(flash_mla_decode, FlashMLATiling)

// ---- 自动 Tiling:在 L0C / UB 容量约束下选定 BLOCK_N ----
constexpr int32_t BLOCK_N = ${(c==='A')?128:(c==='B')?256:512};  // UB 利用率 ${ubUtil}% · 周期 ${cyc}×
${note}
static ge::graphStatus TilingFunc(gert::TilingContext* ctx) {
    FlashMLATiling t;
    int32_t B = ctx->GetInputShape(0)->GetStorageShape().GetDim(0);
    int32_t numHeads = ctx->GetInputShape(0)->GetStorageShape().GetDim(1);
    int32_t seqlenKv = ctx->GetInputShape(2)->GetStorageShape().GetDim(1);
    t.set_B(B);  t.set_numHeads(numHeads);  t.set_seqlenKv(seqlenKv);
    t.set_nTile((seqlenKv + BLOCK_N - 1) / BLOCK_N);   // 向上取整分块数
    ctx->SetBlockDim(B * numHeads);                 // 每个 (batch, head) 对一个核
    ctx->SetTilingKey(1);
    t.SaveToBuffer(ctx->GetRawTilingData()->GetData(),
                   ctx->GetRawTilingData()->GetCapacity());
    ctx->GetRawTilingData()->SetDataSize(t.GetDataSize());
    return ge::GRAPH_SUCCESS;
}
} // namespace optiling
`;
}

const VIEWS = {
  cuda:{file:'example_mla_decode.py', lang:'py', text:CUDA, hl:()=>''},
  s3:{file:'flash_mla_decode.cpp', lang:'cpp', text:S3, hl:todoHL},
  s4:{file:'flash_mla_decode.cpp', lang:'cpp', text:S4, hl:s4HL},
  s6:{file:'flash_mla_decode.cpp', lang:'cpp', text:S6, hl:s6HL},
  get tiling(){ return {file:'tiling.h', lang:'cpp', text:tilingSrc(), hl:tilingHL}; },
};

/* ============================ 语法高亮 ============================ */
const KW = new Set(('for while if else return const void int float bool char class public private struct namespace using constexpr inline extern template this reinterpret_cast static true false import from as def pass assert if elif try except finally with lambda global nonlocal yield in is and or not None True False __global__ __device__ __aicore__ __forceinline__ __restrict__ __shared__ __nv_fp8_e4m3 __nv_fp8x4_e4m3').split(' '));
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function highlight(line){
  let s = esc(line);
  const RE=/(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|(#[a-zA-Z]+)|\b(0x[0-9a-fA-F]+|\d+\.?\d*f?)\b|\b([A-Za-z_][A-Za-z0-9_]*)\b(\s*\()?/g;
  return s.replace(RE,(m,com,str,pp,num,word,paren)=>{
    if(com) return '<span class="c-com">'+com+'</span>';
    if(str) return '<span class="c-str">'+str+'</span>';
    if(pp)  return '<span class="c-pp">'+pp+'</span>';
    if(num!==undefined) return '<span class="c-num">'+num+'</span>';
    if(word){
      if(KW.has(word)) return '<span class="c-k">'+word+'</span>'+(paren||'');
      if(paren) return '<span class="c-fn">'+word+'</span>'+paren;
      if(/^[A-Z_]/.test(word)&&/[a-z]/.test(word)===false&&word.length>1) return '<span class="c-num">'+word+'</span>';
      if(/^[A-Z]/.test(word)) return '<span class="c-ty">'+word+'</span>';
      return word;
    }
    return m;
  });
}
function renderCode(key){
  const v=VIEWS[key]; const lines=v.text.replace(/\n$/,'').split('\n');
  const g=document.getElementById('gutter'), c=document.getElementById('codelines');
  g.textContent=lines.map((_,i)=>i+1).join('\n');
  c.innerHTML=lines.map((l,i)=>{const cls=v.hl?v.hl(l):'';return '<span class="ln '+cls+'" data-line="'+(i+1)+'">'+(highlight(l)||' ')+'</span>'}).join('');
  document.getElementById('codewrap').scrollTop=0;
}
// 右侧对比面板：渲染生成的 AscendC 源码
function renderDiff(key){
  const v=VIEWS[key]; if(!v) return;
  const lines=v.text.replace(/\n$/,'').split('\n');
  const g=document.getElementById('diffGutter'), c=document.getElementById('diffLines');
  g.textContent=lines.map((_,i)=>i+1).join('\n');
  c.innerHTML=lines.map(l=>{const cls=v.hl?v.hl(l):'';return '<span class="ln '+cls+'">'+(highlight(l)||' ')+'</span>'}).join('');
  const f=document.getElementById('diffFile'); if(f) f.textContent=v.file;
  document.getElementById('diffwrap').scrollTop=0;
  // S4：新注入的内存层次行做一次入场闪烁
  if(key==='s4'){
    const news=c.querySelectorAll('.ln.hl-new');
    news.forEach(el=>el.classList.add('flash'));
    setTimeout(()=>news.forEach(el=>el.classList.remove('flash')),1100);
  }
}
const ANALYSIS_LABELS={
  graph:'计算图',
  api:'API可视化',
  generated:'生成代码',
  flow:'数据流',
  tiling:'分块',
  pipeline:'流水',
  accuracy:'精度',
  performance:'性能',
};
const unlockedAnalysisViews=new Set(['graph']);
function currentAnalysisView(){
  return document.getElementById('analysisPane')?.dataset.analysisView || '';
}
function isAnalysisViewUnlocked(view){
  return unlockedAnalysisViews.has(view);
}
function syncAnalysisTabs(){
  const active=currentAnalysisView();
  document.querySelectorAll('.analysis-tab[data-analysis]').forEach(tab=>{
    const unlocked=isAnalysisViewUnlocked(tab.dataset.analysis);
    tab.hidden=!unlocked;
    tab.disabled=!unlocked;
    tab.setAttribute('aria-hidden', String(!unlocked));
    tab.classList.toggle('on', unlocked && tab.dataset.analysis===active);
  });
}
function unlockAnalysisView(view){
  unlockedAnalysisViews.add(view);
  syncAnalysisTabs();
}
function resetAnalysisUnlocks(){
  unlockedAnalysisViews.clear();
  unlockedAnalysisViews.add('graph');
  syncAnalysisTabs();
}
function analysisGutter(){
  const pane=document.getElementById('analysisPane');
  if(!pane) return null;
  const prev=pane.previousElementSibling;
  return prev?.matches?.('.pto-workbench-shell__split-gutter') ? prev : null;
}
function setAnalysisView(view){
  const sp=document.getElementById('split');
  const pane=document.getElementById('analysisPane');
  if(!sp||!pane) return false;
  if(!isAnalysisViewUnlocked(view)){
    syncAnalysisTabs();
    return false;
  }
  sp.classList.remove('graph-open','compare-open','tiling-open','pipe-open');
  sp.classList.add('analysis-open');
  pane.hidden=false;
  const gutter=analysisGutter();
  if(gutter) gutter.hidden=false;
  if(view==='graph') sp.classList.add('graph-open');
  if(view==='generated') sp.classList.add('compare-open');
  if(view==='tiling') sp.classList.add('tiling-open');
  if(view==='pipeline') sp.classList.add('pipe-open');
  pane.dataset.analysisView=view;
  const title=document.getElementById('analysisTitle');
  if(title) title.textContent=ANALYSIS_LABELS[view]||'分析';
  syncAnalysisTabs();
  syncParseBtn();
  return true;
}
function closeAnalysisView(){
  const sp=document.getElementById('split');
  if(!sp) return;
  sp.classList.remove('analysis-open','graph-open','compare-open','tiling-open','pipe-open','link-active');
  const pane=document.getElementById('analysisPane');
  if(pane){ pane.hidden=true; delete pane.dataset.analysisView; }
  const gutter=analysisGutter();
  if(gutter) gutter.hidden=true;
  clearLinkHot();
  const h=document.getElementById('leftPaneH');
  if(h) h.style.display='none';
  syncParseBtn();
}
// 开启源码对比：左侧源端代码，右侧生成代码
function openCompare(diffKey){
  closeGraph(); closeTiling(); closePipe();        // 关闭计算图 / tiling / 流水对比
  activeTab='cuda';
  renderCode('cuda');                             // 左侧固定为 CUDA
  document.getElementById('leftPaneH').style.display='flex';
  renderDiff(diffKey);                            // 右侧为生成的 AscendC
  const genTab=document.querySelector('.analysis-tab[data-analysis="generated"]');
  if(genTab) genTab.childNodes[0].textContent = (VIEWS[diffKey]?.file) || '生成代码';
  unlockAnalysisView('generated');
  setAnalysisView('generated');
  renderTabs(); renderTree();
  const f=document.getElementById('etbFile'); if(f) f.textContent='flash_attention_v2.py ↔ flash_mla_decode.cpp';
  tagLinkGroups(diffKey);                          // 建立相同计算过程的联动呼应
}
function closeCompare(){
  const sp=document.getElementById('split');
  sp.classList.remove('compare-open'); sp.classList.remove('link-active');
  clearLinkHot(); hideLinkPop();
  document.getElementById('leftPaneH').style.display='none';
  if(currentAnalysisView()==='generated') closeAnalysisView();
}

/* ---------- S3 对比联动：相同计算过程的代码片段互相呼应 ---------- */
// 每组：cuda[起,止] ↔ asc[起,止]（1-based，含端点），label 为该计算过程。
let linkGroups=[]; // 当前对比视图的分组
const LINKMAP={
  s3:[
    {label:'内核入口 / 参数', cuda:[124,129], asc:[13,16]},
    {label:'T.Kernel → 分核 SPMD', cuda:[131,131], asc:[18,19],
     explain:{title:'线程网格 → 分核 SPMD', api:'tl.program_id(0) → GetBlockIdx()',
       gpu:'Triton/CUDA 用 <code>tl.program_id(0)</code> 从 SIMT 线程网格取块索引：每个 program 即一个 GPU 线程块，由硬件调度器分发到 SM 上并发执行。',
       npu:'昇腾无线程网格 / SM 概念，改为 <code>GetBlockIdx()</code> 让每个 AI Core 主动认领 (行块, batch) 分片，做 SPMD 分核。',
       why:'达芬奇是「多算力核 + 核内多单元 (Cube/Vector)」架构，没有 warp / 线程块调度器，并行度以物理算力核为粒度，故用分核认领替代网格映射。'}},
    {label:'Q / Q_pe 载入', cuda:[148,149], asc:[22,26],
     explain:{title:'指针访存 → 分级 DataCopy', api:'tl.load(ptr+offs, mask) → DataCopy (GM→L1→L0A)',
       gpu:'GPU 用指针算术 + mask 直接从 HBM 按偏移寻址：<code>tl.load(ptr+offs, mask=…)</code>，缓存层次由硬件自动托管。',
       npu:'改为显式 <code>DataCopy</code> 逐级搬运 GM→L1→L0A，缓冲由 <code>InitBuffer</code> / <code>TQue</code> 声明，无裸指针访存。',
       why:'达芬奇是显式多级片上缓冲 (L1/L0/UB) 架构，访存必须经 DMA 逐级搬运并双缓冲流水；不存在 GPU 那种由缓存自动托管的指针访存模型。'}},
    {label:'QKᵀ+PEᵀ → 在线 Softmax → P·V', cuda:[155,175], asc:[30,36],
     explain:{title:'warp 张量核 → Cube/Vector 分派', api:'tl.dot + warp shuffle → Mmad + ReduceMax/Exp/ReduceSum',
       gpu:'<code>tl.dot</code> 在 warp 级张量核 (MMA) 上做矩阵乘，softmax 的 max/exp/sum 借 warp shuffle 跨线程归约，全部融合在一个 kernel 的寄存器里完成。',
       npu:'Q·Kᵀ / P·V 交给 Cube 矩阵单元 <code>Mmad</code> (自管 L0A/L0B/L0C)；在线 Softmax 的 <code>ReduceMax</code> / <code>Exp</code> / <code>ReduceSum</code> 交给 Vector 向量单元片上归约。',
       why:'达芬奇 Cube 与 Vector 是物理分离的执行单元，没有 warp 也没有 warp shuffle；矩阵与向量运算须分派到各自单元，且 Cube 输出 L0C 无直连 UB，打分要 L0C→GM→UB 中转。'}},
    {label:'use_swizzle / GemmWarpPolicy (SIMT 专属)', cuda:[53,53], asc:[37,37],
     explain:{title:'SIMT 专属旋钮 → 直接删除', api:'use_swizzle / GemmWarpPolicy → (移除)',
       gpu:'<code>use_swizzle</code> / <code>GemmWarpPolicy</code> 是为 GPU L2 命中率与 warp 内 tensor-core 分工设的调度旋钮。',
       npu:'直接删除 —— 昇腾没有 warp / L2-swizzle 概念，其职责由分核 + 向量单元规约承担。',
       why:'这些是 SIMT / warp 硬件模型专属参数，在达芬奇架构上无对应物，保留反而误导，故整体移除。'}},
    {label:'Output 写回', cuda:[176,179], asc:[26,26]},
  ],
  s4:[
    {label:'T.Kernel → 分核', cuda:[131,131], asc:[15,16]},
    {label:'片上缓冲层次注入 (L1/L0/UB)', cuda:[132,144], asc:[25,30]},
    {label:'KV 序列分块循环', cuda:[155,155], asc:[45,48]},
    {label:'KV / K_pe 载入 GM→L1', cuda:[156,157], asc:[61,63]},
    {label:'QKᵀ = Q·KVᵀ + Q_pe·K_peᵀ → 矩阵单元 (Mmad)', cuda:[158,159], asc:[67,70]},
    {label:'在线 Softmax → 向量单元', cuda:[160,169], asc:[74,86]},
    {label:'P·V 累加 → 矩阵/向量', cuda:[175,175], asc:[87,91]},
  ],
  s6:[
    {label:'KV 分块 + 软件流水', cuda:[155,155], asc:[43,48]},
    {label:'预取下一块 (双缓冲)', cuda:[155,155], asc:[44,46]},
    {label:'KV 载入 (CopyInKV)', cuda:[156,157], asc:[55,62]},
    {label:'QKᵀ+PEᵀ → 矩阵单元 (Mmad)', cuda:[158,159], asc:[71,72]},
    {label:'在线 Softmax → 向量单元', cuda:[160,169], asc:[76,87]},
    {label:'use_swizzle / GemmWarpPolicy → 分核+向量规约', cuda:[53,53], asc:[78,78]},
    {label:'P·V 累加', cuda:[175,175], asc:[88,93]},
    {label:'归一化 + 写回', cuda:[176,179], asc:[49,51]},
  ],
};
// 给两侧代码行打上分组标记（一行可属于多个分组）
function tagLinkGroups(diffKey){
  linkGroups = LINKMAP[diffKey] || [];
  const leftLns = document.querySelectorAll('#codelines .ln');
  const rightLns = document.querySelectorAll('#diffLines .ln');
  const reset=el=>{el.classList.remove('link-grp');el.removeAttribute('data-grp');};
  leftLns.forEach(reset); rightLns.forEach(reset);
  const add=(el,gi)=>{ if(!el) return; el.classList.add('link-grp');
    const cur=el.dataset.grp?el.dataset.grp.split(','):[]; if(!cur.includes(''+gi)){cur.push(''+gi);el.dataset.grp=cur.join(',');}
    // 改写行（该组带架构差异解释）：打标记 + 记录首个解释组
    if(linkGroups[gi] && linkGroups[gi].explain){ el.classList.add('link-diff'); if(el.dataset.diffgrp==null) el.dataset.diffgrp=''+gi; } };
  linkGroups.forEach((g,gi)=>{
    for(let i=g.cuda[0]-1;i<=g.cuda[1]-1;i++) add(leftLns[i],gi);
    for(let i=g.asc[0]-1;i<=g.asc[1]-1;i++) add(rightLns[i],gi);
  });
  bindLinkHover(leftLns,'left'); bindLinkHover(rightLns,'right');
}
function clearLinkHot(){
  document.querySelectorAll('.ln.link-hot').forEach(el=>el.classList.remove('link-hot'));
  document.getElementById('split').classList.remove('link-active');
}
/* ---------- 改写行架构差异浮窗 ---------- */
let linkPopEl=null;
function ensureLinkPop(){
  if(linkPopEl) return linkPopEl;
  linkPopEl=document.createElement('div');
  linkPopEl.className='link-pop'; linkPopEl.id='linkPop';
  document.body.appendChild(linkPopEl);
  return linkPopEl;
}
function showLinkPop(el){
  const gi=el.dataset.diffgrp; if(gi==null) return;
  const g=linkGroups[Number(gi)]; if(!g||!g.explain) return;
  const e=g.explain;
  const pop=ensureLinkPop();
  pop.innerHTML=`<div class="lp-h"><span class="lp-tag">改写 · 算子 API 差异</span><b>${e.title}</b></div>
    ${e.api?`<div class="lp-arrow" style="padding-top:7px"><code style="font-size:11px">${e.api.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></div>`:''}
    <div class="lp-row lp-gpu"><span class="lp-k">GPU · SIMT</span><p>${e.gpu}</p></div>
    <div class="lp-arrow">↓ 昇腾达芬奇改写为</div>
    <div class="lp-row lp-npu"><span class="lp-k">昇腾 · 达芬奇</span><p>${e.npu}</p></div>
    <div class="lp-why"><b>为什么这么改</b>${e.why}</div>`;
  pop.style.visibility='hidden'; pop.classList.add('show');
  // 定位：优先置于该行右侧，空间不足则左侧；纵向以行为中心并夹在视口内
  const r=el.getBoundingClientRect();
  const pw=pop.offsetWidth, ph=pop.offsetHeight, gap=10, m=8;
  let left = r.right + gap;
  if(left + pw > window.innerWidth - m) left = r.left - gap - pw;   // 右侧放不下 → 左侧
  if(left < m) left = Math.min(window.innerWidth - pw - m, Math.max(m, r.left)); // 仍放不下 → 夹取
  let top = r.top + r.height/2 - ph/2;
  top = Math.max(m, Math.min(top, window.innerHeight - ph - m));
  pop.style.left=left+'px'; pop.style.top=top+'px';
  pop.style.visibility='visible';
}
function hideLinkPop(){ if(linkPopEl) linkPopEl.classList.remove('show'); }
function highlightGroup(grpAttr, originSide){
  clearLinkHot();
  if(grpAttr==null||grpAttr==='') return;
  const gis=(''+grpAttr).split(',').map(Number).filter(x=>!isNaN(x));
  if(!gis.length) return;
  const leftLns=document.querySelectorAll('#codelines .ln');
  const rightLns=document.querySelectorAll('#diffLines .ln');
  let firstOppLine=null;
  gis.forEach(gi=>{
    const g=linkGroups[gi]; if(!g) return;
    for(let i=g.cuda[0]-1;i<=g.cuda[1]-1;i++){ if(leftLns[i]) leftLns[i].classList.add('link-hot'); }
    for(let i=g.asc[0]-1;i<=g.asc[1]-1;i++){ if(rightLns[i]) rightLns[i].classList.add('link-hot'); }
    // 记录对侧首行用于滚动
    if(firstOppLine===null){
      firstOppLine = originSide==='left' ? rightLns[g.asc[0]-1] : leftLns[g.cuda[0]-1];
    }
  });
  const wrapId = originSide==='left' ? 'diffwrap' : 'codewrap';
  scrollLineIntoView(wrapId, firstOppLine);
  document.getElementById('split').classList.add('link-active');
}
function scrollLineIntoView(wrapId, lineEl){
  if(!lineEl) return;
  const wrap=document.getElementById(wrapId);
  const wr=wrap.getBoundingClientRect(), lr=lineEl.getBoundingClientRect();
  const offset=(lr.top-wr.top)+wrap.scrollTop;
  wrap.scrollTo({top:Math.max(0,offset - wrap.clientHeight/3), behavior:'smooth'});
}
function bindLinkHover(lns, side){
  lns.forEach(el=>{
    if(!el.classList.contains('link-grp')) return;
    if(el.__linkSide===side) return; el.__linkSide=side;
    el.onmouseenter=()=>{ highlightGroup(el.dataset.grp, side); if(el.classList.contains('link-diff')) showLinkPop(el); else hideLinkPop(); };
    el.onclick=()=>highlightGroup(el.dataset.grp, side); // 点击滚动到对侧
  });
  // 离开代码区清除高亮 + 关闭浮窗
  const wrap = side==='left'?document.getElementById('codewrap'):document.getElementById('diffwrap');
  wrap.onmouseleave=()=>{ clearLinkHot(); hideLinkPop(); };
}

/* ============================ S4 硬件数据流动画 ============================ */
// 达芬奇内存层次 + 执行单元。坐标基于 viewBox 780×188。
const FUNITS={
  gm:  {x:14,  y:70, w:78, h:48, c:'--mem',    t:'全局内存', s:'GM · 高带宽内存'},
  l1:  {x:150, y:70, w:74, h:48, c:'--mem',    t:'一级缓存',  s:'片上缓存'},
  l0a: {x:280, y:14, w:74, h:40, c:'--cube',   t:'L0A',        s:'矩阵输入 q'},
  l0b: {x:280, y:134,w:74, h:40, c:'--cube',   t:'L0B',        s:'矩阵输入 k'},
  cube:{x:410, y:60, w:86, h:66, c:'--cube',   t:'矩阵单元',   s:'Mmad · QKᵀ'},
  l0c: {x:540, y:60, w:74, h:48, c:'--cube',   t:'L0C',        s:'矩阵输出'},
  ub:  {x:664, y:14, w:102,h:48, c:'--vec',    t:'统一缓冲', s:'UB · 打分/概率'},
  vec: {x:664, y:118,w:102,h:52, c:'--vec',    t:'向量单元', s:'在线 Softmax'},
};
const FEDGES={
  gm_l1:  ['gm','l1'], l1_l0a:['l1','l0a'], l1_l0b:['l1','l0b'],
  l0a_cube:['l0a','cube'], l0b_cube:['l0b','cube'], cube_l0c:['cube','l0c'],
  l0c_gm:['l0c','gm'], gm_ub:['gm','ub'], ub_vec:['ub','vec'],
};
// 每一步：亮起的单元、走的边、说明、颜色、对应 S4 代码行
const FLOW_STEPS=[
  {t:'查询向量搬运 GM→L1→L0A', units:['gm','l1','l0a'], edges:['gm_l1','l1_l0a'], code:[35,37], col:'--mem',
   note:'Q 与 Q_pe 拼接后逐级搬运:GM → L1 → L0A,进入矩阵单元的 A 侧入口。'},
  {t:'KV 分块搬运 GM→L1→L0B', units:['gm','l1','l0b'], edges:['gm_l1','l1_l0b'], code:[61,63], col:'--mem',
   note:'KV 分块(K 的非位置部分 + K_pe)逐级搬运:GM → L1 → L0B,进入矩阵单元的 B 侧入口。'},
  {t:'矩阵乘写入 L0C', units:['l0a','l0b','cube','l0c'], edges:['l0a_cube','l0b_cube','cube_l0c'], code:[67,70], col:'--cube',
   note:'矩阵(Cube)单元执行 QKᵀ = Q·KVᵀ + Q_pe·K_peᵀ(FP16),dim 与 pe 两段累加,结果写入 L0C。这是算力主体。'},
  {t:'打分搬运 L0C→GM→UB', units:['l0c','gm','ub'], edges:['l0c_gm','gm_ub'], code:[74,78], col:'--vec',
   note:'910C 的 Cube/Vector 分离,L0C 无直连 Vector:打分须 L0C→GM→UB 中转,再由 Vector 做在线 softmax(减最大值、exp)。'},
  {t:'在线 Softmax 归约 + P·V', units:['ub','vec'], edges:['ub_vec'], code:[77,91], col:'--vec',
   note:'向量(Vector)单元做 reduce_max / exp / reduce_sum 与 rescale 完成在线 softmax 归一,概率随即加权 V 累加到输出 acc_o。'},
];
let flowIdx=0, flowTimer=null, flowPlaying=false;

function unitCol(k){return getComputedStyle(document.documentElement).getPropertyValue(FUNITS[k].c).trim();}
function edgePath(ek){
  const [a,b]=FEDGES[ek]; const na=FUNITS[a], nb=FUNITS[b];
  // 竖直相邻(同列上下,如 UB↕Vector):走垂直连线
  const sameCol = Math.abs((na.x+na.w/2)-(nb.x+nb.w/2)) < 30;
  if(sameCol){
    const x=na.x+na.w/2;
    const y1=(na.y<nb.y)?na.y+na.h:na.y;
    const y2=(na.y<nb.y)?nb.y:nb.y+nb.h;
    return {d:`M${x},${y1} L${x},${y2}`, x1:x,y1,x2:x,y2};
  }
  // 头权重 GM→UB:从 GM 顶部绕行到 UB 左侧,避免横穿画布
  if(ek==='gm_ub'){
    const x1=na.x+na.w/2, y1=na.y, x2=nb.x, y2=nb.y+nb.h/2;
    return {d:`M${x1},${y1} C${x1},2 ${x2-40},2 ${x2},${y2}`, x1,y1,x2,y2};
  }
  const x1=na.x+na.w, y1=na.y+na.h/2, x2=nb.x, y2=nb.y+nb.h/2;
  const mx=(x1+x2)/2;
  return {d:`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, x1,y1,x2,y2};
}
function buildFlowSVG(){
  let edges='', nodes='';
  Object.keys(FEDGES).forEach(ek=>{ const p=edgePath(ek);
    edges+=`<path class="fedge" id="fe_${ek}" d="${p.d}"/>`; });
  Object.keys(FUNITS).forEach(k=>{ const u=FUNITS[k]; const col=unitCol(k);
    nodes+=`<g class="fu-box" id="fu_${k}">
      <rect x="${u.x}" y="${u.y}" width="${u.w}" height="${u.h}" rx="9" fill="${col}22" stroke="${col}" stroke-width="1.5"/>
      <text class="fu-lbl" x="${u.x+u.w/2}" y="${u.y+u.h/2-2}" text-anchor="middle">${u.t}</text>
      <text class="fu-sub" x="${u.x+u.w/2}" y="${u.y+u.h/2+11}" text-anchor="middle">${u.s}</text>
    </g>`; });
  return `<svg viewBox="0 0 780 188" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    ${edges}
    <text class="fcap" x="53" y="134" text-anchor="middle">DDR / HBM</text>
    <text class="fcap" x="453" y="140" text-anchor="middle">矩阵单元</text>
    <text class="fcap" x="715" y="180" text-anchor="middle">向量单元</text>
    ${nodes}
    <g id="fpkts"></g>
  </svg>`;
}
function renderFlow(){
  const pane=document.getElementById('flowpane');
  pane.innerHTML=`
    <div class="flow-bar">
      <button class="fb-btn" id="flowPlay">▶ 播放</button>
      <button class="fb-btn" id="flowStep">⏭ 单步</button>
      <span class="fb-step">步骤 <b id="flowNo">1</b>/${FLOW_STEPS.length} · <span id="flowTitle">${FLOW_STEPS[0].t}</span></span>
      <span class="fb-spacer"></span>
      <span class="fb-legend">
        <span><i style="background:var(--mem)"></i>搬运单元</span>
        <span><i style="background:var(--cube)"></i>矩阵单元</span>
        <span><i style="background:var(--vec)"></i>向量单元</span>
      </span>
    </div>
    <div class="flow-stage" id="flowStage"></div>
    <div style="padding:6px 12px;border-top:1px solid #ffffff0a;font-size:14px;color:var(--dim)"><span id="flowNote">${FLOW_STEPS[0].note}</span></div>`;
  document.getElementById('flowStage').innerHTML=buildFlowSVG();
  document.getElementById('flowPlay').onclick=toggleFlowPlay;
  document.getElementById('flowStep').onclick=()=>{ stopFlow(); flowIdx=(flowIdx+1)%FLOW_STEPS.length; showFlowStep(flowIdx); };
  flowIdx=0; showFlowStep(0);
}
function clearFlowHot(){
  Object.keys(FUNITS).forEach(k=>document.getElementById('fu_'+k)?.classList.remove('active'));
  Object.keys(FEDGES).forEach(ek=>document.getElementById('fe_'+ek)?.classList.remove('lit'));
}
function spawnPacket(ek, col){
  const stage=document.getElementById('flowStage'); if(!stage) return;
  const svg=stage.querySelector('svg'); const layer=svg.querySelector('#fpkts');
  const path=svg.querySelector('#fe_'+ek); if(!path) return;
  const len=path.getTotalLength();
  const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.setAttribute('r','4.5'); c.setAttribute('fill',col); c.setAttribute('filter','url(#glow)');
  c.setAttribute('opacity','0.95'); layer.appendChild(c);
  const t0=performance.now(), dur=620;
  (function move(now){
    const p=Math.min(1,(now-t0)/dur); const pt=path.getPointAtLength(p*len);
    c.setAttribute('cx',pt.x); c.setAttribute('cy',pt.y);
    if(p<1) requestAnimationFrame(move); else c.remove();
  })(t0);
}
function showFlowStep(i){
  const s=FLOW_STEPS[i]; if(!s) return;
  clearFlowHot();
  const col=getComputedStyle(document.documentElement).getPropertyValue(s.col).trim();
  s.units.forEach(u=>document.getElementById('fu_'+u)?.classList.add('active'));
  s.edges.forEach(ek=>{ document.getElementById('fe_'+ek)?.classList.add('lit'); spawnPacket(ek,col); });
  const no=document.getElementById('flowNo'), ti=document.getElementById('flowTitle'), nt=document.getElementById('flowNote');
  if(no) no.textContent=i+1; if(ti) ti.textContent=s.t; if(nt) nt.textContent=s.note;
  // 与右侧 AscendC 代码联动：高亮对应注入行
  if(s.code && document.getElementById('split').classList.contains('compare-open')){
    highlightDiffLines(s.code[0], s.code[1]);
  }
}
// 高亮/滚动 AscendC(右)面板的指定行
function highlightDiffLines(a,b){
  const lns=document.querySelectorAll('#diffLines .ln');
  lns.forEach(el=>el.classList.remove('hl-node'));
  for(let i=a-1;i<b && i<lns.length;i++) lns[i]?.classList.add('hl-node');
  if(lns[a-1]) scrollLineIntoView('diffwrap', lns[a-1]);
}
function toggleFlowPlay(){ flowPlaying?stopFlow():startFlow(); }
function startFlow(){
  flowPlaying=true; const b=document.getElementById('flowPlay'); if(b){b.textContent='⏸ 暂停';b.classList.add('on');}
  showFlowStep(flowIdx);
  flowTimer=setInterval(()=>{ flowIdx=(flowIdx+1)%FLOW_STEPS.length; showFlowStep(flowIdx); }, 1500);
}
function stopFlow(){
  flowPlaying=false; if(flowTimer){clearInterval(flowTimer);flowTimer=null;}
  const b=document.getElementById('flowPlay'); if(b){b.textContent='▶ 播放';b.classList.remove('on');}
}
// 供面板 tab 调用
function openFlowPanel(autoplay){
  unlockAnalysisView('flow');
  setAnalysisView('flow');
  renderFlow();
  if(autoplay) startFlow();
}
function activatePanelTab(p){
  document.querySelectorAll('.ptab').forEach(x=>x.classList.toggle('on',x.dataset.p===p));
  document.getElementById('term').style.display=p==='term'?'block':'none';
  document.getElementById('outputpane').style.display=p==='term2'?'block':'none';
  document.getElementById('probs').style.display=p==='probs'?'block':'none';
}

/* ============================ S7 精度报告 ============================ */
// 逐算子对齐 CUDA 黄金基准。fixed 表示已应用修复后的复测结果。
let accFixed=false;
const ACC_OPS=[
  {op:'DataCopy (GM→L1/UB)',   kind:'搬运', err:'0',      pass:true},
  {op:'Mmad · QKᵀ+PEᵀ',        kind:'矩阵单元', err:'2.4e-4', pass:true},
  {op:'ReduceMax · 在线 max',   kind:'向量单元',err:'0',     pass:true},
  {op:'Exp · 在线 Softmax',     kind:'向量单元',err:'3.1e-2',pass:false,   // ← 异常算子
    fixedErr:'8.0e-4', anomaly:true},
  {op:'Mmad · P·V 累加',        kind:'矩阵单元',err:'—',     pass:true, note:'余弦一致 1.0000 (2048/2048)'},
];
function accStats(){
  const anomaly = ACC_OPS.find(o=>o.anomaly);
  const maxErr = accFixed ? '8.0e-4' : '3.1e-2';
  const cos    = accFixed ? '0.99987' : '0.9962';
  const passN  = accFixed ? ACC_OPS.length : ACC_OPS.filter(o=>o.pass).length;
  return {anomaly, maxErr, cos, passN, total:ACC_OPS.length};
}
function renderAccReport(){
  const st=accStats();
  const pane=document.getElementById('accpane');
  const rows=ACC_OPS.map(o=>{
    const ok = o.pass || accFixed;
    const err = (o.anomaly && accFixed) ? o.fixedErr : o.err;
    const stCls = (o.anomaly && accFixed) ? 'fixed' : (ok?'pass':'fail');
    const stTxt = (o.anomaly && accFixed) ? '已修复' : (ok?'通过':'异常');
    const errCol = (!ok)?'color:var(--risk)':((o.anomaly&&accFixed)?'color:var(--mem)':'color:var(--txt)');
    return `<tr class="${(!ok)?'bad':''}">
      <td class="acc-op">${o.op}</td>
      <td style="color:var(--dim)">${o.kind}</td>
      <td class="acc-err" style="${errCol}">${err}${o.note?`<div style="font-size:12px;color:var(--dim);font-family:var(--sans)">${o.note}</div>`:''}</td>
      <td><span class="acc-st ${stCls}">${stTxt}</span></td>
    </tr>`;
  }).join('');

  const a=st.anomaly;
  const anomalyBlock = accFixed ? `
    <div class="acc-card ok">
      <div class="ac-h">✓ 精度对齐通过 <span class="tag" style="background:#48d59722;color:var(--ok);border:1px solid #48d59755">已修复</span></div>
      <div class="ac-row"><div class="ac-k">复测</div><div class="ac-v">最大绝对误差 <code>8.0e-4</code> · 余弦相似度 <code>0.99987</code>,已达 rtol 1e-3 阈值。</div></div>
      <div class="ac-row"><div class="ac-k">输出</div><div class="ac-v">逐 head 输出余弦一致 <code>1.0000</code> (2048/2048),logsum 跨块合并已对齐。</div></div>
    </div>` : `
    <div class="acc-card">
      <div class="ac-h">⚠ 检测到精度异常算子 <span class="tag risk">异常</span></div>
      <div class="ac-row"><div class="ac-k">算子</div><div class="ac-v"><code>${a.op}</code>(${a.kind})</div></div>
      <div class="ac-row"><div class="ac-k">现象</div><div class="ac-v">最大绝对误差 <code>${a.err}</code>,超出 rtol <code>1e-3</code> 阈值约 30×。</div></div>
      <div class="ac-row"><div class="ac-k">根因</div><div class="ac-v"><b>exp2→exp 底数改写 + 在线归约次序不一致</b>:源端用 <code>T.exp2(x·log2e)</code> 且各分块串行 rescale;昇腾改用自然 <code>Exp</code>,若 scale 未去掉 <code>log2(e)</code> 预乘、或 rescale 以 <b>FP16 累加</b>,在线 softmax 的 <code>logsum</code> 跨块合并时舍入被放大。</div></div>
      <div class="ac-fix">
        <div class="fh">🔧 修复方案 · 去 log2(e) + 提升 FP32 累加</div>
        <div class="acc-diff"><span class="ctx">    // 在线 Softmax: 自然底 exp,logsum 跨块合并</span><span class="del">-   Exp(qk, qk * scale_log2e, sTile);              // 残留 log2(e) 预乘,底数不一致</span><span class="add">+   Exp(qk, (qk - mNew) * softmaxScale, sTile);    // 自然底,去 log2(e)</span><span class="add">+   float lNew = lPrev * alpha + ReduceSum&lt;float&gt;(qk); // logsum 提升 FP32 在线合并</span></div>
        <div class="acc-apply" id="accApply">▶ 应用修复并复测</div>
      </div>
    </div>`;

  pane.innerHTML=`
    <div class="acc-top">
      <div class="acc-kpi"><div class="kv" style="color:${accFixed?'var(--ok)':'var(--risk)'}">${st.maxErr}</div><div class="kk">最大绝对误差</div><div class="kd" style="color:${accFixed?'var(--ok)':'var(--risk)'}">阈值 rtol 1e-3</div></div>
      <div class="acc-kpi"><div class="kv" style="color:${accFixed?'var(--ok)':'var(--warn)'}">${st.cos}</div><div class="kk">余弦相似度</div><div class="kd" style="color:var(--dim)">越接近 1 越好</div></div>
      <div class="acc-kpi"><div class="kv">${st.passN}/${st.total}</div><div class="kk">算子通过</div><div class="kd" style="color:${accFixed?'var(--ok)':'var(--risk)'}">${accFixed?'全部通过':'1 个异常'}</div></div>
    </div>
    <div class="acc-sec-h">逐算子精度对齐 · 基准为源端</div>
    <table class="acc-table">
      <thead><tr><th>算子</th><th>单元</th><th>最大绝对误差</th><th>状态</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${anomalyBlock}`;

  const ap=document.getElementById('accApply');
  if(ap) ap.onclick=()=>{
    accFixed=true; setProblems(0);
    const accCnt=document.getElementById('accCnt');
    if(accCnt) accCnt.textContent='✓';
    renderAccReport();
    notify('✓ 精度修复已应用','累加提升 FP32 · 余弦相似度 0.99987 · 问题清零','ok');
  };
}
function openAccPanel(){
  const accCnt=document.getElementById('accCnt');
  if(accCnt){
    accCnt.textContent = accFixed?'✓':'!';
    accCnt.style.background = accFixed?'#48d59722':'#ff547033';
    accCnt.style.color = accFixed?'var(--ok)':'#ff8ba0';
  }
  unlockAnalysisView('accuracy');
  setAnalysisView('accuracy');
  renderAccReport();
}

/* ============================ S8 性能报告 ============================ */
// 泳道图:每条泳道一个硬件单元,cell 为 {s起, w宽, cls, l标签}。时间以格为单位。
// 直译版:串行,单元间大量空转。
function perfSwimBefore(){
  const rows={mte:[],cube:[],vec:[]}; let t=0;
  for(let n=0;n<3;n++){
    rows.mte.push({s:t,w:3,cls:'mte',l:`搬${n}`});
    rows.cube.push({s:t,w:3,cls:'idle',l:''});          // 矩阵单元空等搬运
    rows.cube.push({s:t+3,w:2,cls:'cube',l:`矩${n}`});
    rows.vec.push({s:t,w:5,cls:'idle',l:''});           // 向量单元长时间空等
    rows.vec.push({s:t+5,w:1,cls:'vec',l:`向${n}`});
    t+=6;
  }
  return {rows,total:t};
}
// 优化版:双缓冲重叠,搬运隐藏在计算下,单元密排。
function perfSwimAfter(){
  const rows={mte:[],cube:[],vec:[]};
  for(let n=0;n<3;n++) rows.mte.push({s:n*2,w:2,cls:'mte',l:`搬${n}`});
  for(let n=0;n<3;n++) rows.cube.push({s:2+n*2,w:2,cls:'cube',l:`矩${n}`});
  for(let n=0;n<3;n++) rows.vec.push({s:4+n*2,w:1,cls:'vec',l:`向${n}`});
  return {rows,total:4+3*2};
}
function swimRow(label, cells, total, play){
  const pct=x=>(x/total*100);
  let inner='';
  cells.forEach((c,i)=>{ inner+=`<div class="swim-cell ${c.cls} ${play?'play':''}" style="left:${pct(c.s)}%;width:${pct(c.w)}%;${play?`animation-delay:${i*70}ms`:''}">${c.l}</div>`; });
  return `<div class="swim-row"><div class="swim-lbl">${label}</div><div class="swim-track">${inner}</div></div>`;
}
function swimHTML(model, play){
  const {rows,total}=model;
  return `<div class="swim">
    ${swimRow('搬运单元', rows.mte, total, play)}
    ${swimRow('矩阵单元', rows.cube, total, play)}
    ${swimRow('向量单元', rows.vec, total, play)}
    <div class="swim-axis"><span>t=0</span><span>时间(周期)→</span><span>t=${total}</span></div>
    <div class="swim-legend"><span><i style="background:var(--mem)"></i>搬运单元</span><span><i style="background:var(--cube)"></i>矩阵单元</span><span><i style="background:var(--vec)"></i>向量单元</span><span><i style="background:repeating-linear-gradient(45deg,#ffffff30,#ffffff30 3px,transparent 3px,transparent 6px)"></i>空转</span></div>
  </div>`;
}
// 利用率对比条
function cmpBar(label, before, after){
  return `<div class="cmp"><div class="cl"><span>${label}</span><b><span style="color:var(--risk)">${before}%</span> → <span style="color:var(--ok)">${after}%</span></b></div>
    <div class="bars">
      <div class="barrow"><span class="brl">直译</span><div class="brt"><div class="brf" style="width:${before}%;background:var(--risk)">${before}%</div></div></div>
      <div class="barrow"><span class="brl">优化</span><div class="brt"><div class="brf" style="width:${after}%;background:var(--ok)">${after}%</div></div></div>
    </div></div>`;
}
function renderPerfReport(play){
  const before=perfSwimBefore(), after=perfSwimAfter();
  const speedup=(before.total/after.total).toFixed(1);
  const pane=document.getElementById('perfpane');
  pane.innerHTML=`
    <div class="perf-top">
      <div class="perf-kpi"><div class="kv" style="color:var(--ok)">3.1×</div><div class="kk">端到端加速</div></div>
      <div class="perf-kpi"><div class="kv"><span style="color:var(--risk)">31%</span><span class="arw">→</span><span style="color:var(--ok)">82%</span></div><div class="kk">算力核利用率</div></div>
      <div class="perf-kpi"><div class="kv" style="color:var(--ok)">76%</div><div class="kk">矩阵单元占用</div></div>
      <div class="perf-kpi"><div class="kv" style="color:var(--ok)">94%</div><div class="kk">搬运隐藏率</div></div>
    </div>

    <div class="perf-sec-h">流水泳道图 · msProf<span class="tag old">直译版</span></div>
    <div class="perf-play" id="perfPlay">▶ 播放泳道时序</div>
    ${swimHTML(before, play)}
    <div style="font-size:14px;color:var(--dim);margin:2px 0 0">串行搬运-计算,矩阵单元和向量单元大量空转(斜纹),总耗时 ${before.total} 个周期。</div>

    <div class="perf-sec-h">流水泳道图 · msProf<span class="tag new">优化版</span></div>
    ${swimHTML(after, play)}
    <div style="font-size:14px;color:var(--dim);margin:2px 0 0">双缓冲重叠,搬运隐藏在计算下,总耗时 ${after.total} 个周期(约 ${speedup}× 缩短)。</div>

    <div class="perf-sec-h">利用率对比 · 直译 → 优化</div>
    ${cmpBar('算力核总利用率', 31, 82)}
    ${cmpBar('矩阵单元占用率', 22, 76)}
    ${cmpBar('搬运隐藏率', 12, 94)}

    <div class="perf-sec-h">调优发现与建议</div>
    <div class="perf-tune">
      <div class="pt-item"><span class="ic" style="color:var(--ok)">✓</span><div><b>双缓冲重叠</b> <span class="pv">已消除搬运气泡,流水气泡 21%→4%(见 S6)。</span></div></div>
      <div class="pt-item"><span class="ic" style="color:var(--ok)">✓</span><div><b>矩阵单元满流水</b> <span class="pv">Mmad 连续无断流,矩阵单元占用 76%。</span></div></div>
      <div class="pt-item"><span class="ic" style="color:var(--warn)">◐</span><div><b>向量单元仍有空隙</b> <span class="pv">在线 Softmax 归约与矩阵单元存在轻微串行,可进一步用统一缓冲双缓冲重叠(潜在 +6%)。</span></div></div>
      <div class="pt-item"><span class="ic" style="color:var(--warn)">◐</span><div><b>末块尾效应</b> <span class="pv">末块无预取对象,建议按分块长度对齐序列长度以摊薄尾延迟。</span></div></div>
    </div>

    <div class="perf-reg"><b>✓ 已注册 aclNN 算子:</b> <code>aclnnFlashAttentionV2</code> —— 可供图层直接调用。端到端相较直译版 <b>3.1×</b> 加速,精度余弦相似度 0.99987。</div>`;
  const pb=document.getElementById('perfPlay');
  if(pb) pb.onclick=()=>renderPerfReport(true);
}
function openPerfPanel(){
  unlockAnalysisView('performance');
  setAnalysisView('performance');
  renderPerfReport(true);
}

/* ============================ S5 Tiling 可视化 ============================ */
const TILING_OPTS={
  A:{
    name:'基线方案',
    mode:'自动',
    verdict:'就绪',
    status:'ready',
    sTile:128,
    ub:61,
    l0c:48,
    gm:16,
    cyc:'1.00',
    buffer:1,
    queue:'4 <= 8',
    queueOk:true,
    alignment:'32B 已对齐',
    alignmentOk:true,
    tail:'整除，无尾块',
    note:'分块较小，可读性高，但回 GM 次数较多。',
    advice:'适合作为第一版解释基线。'
  },
  B:{
    name:'推荐方案',
    mode:'自动',
    verdict:'就绪',
    status:'ready',
    sTile:256,
    ub:88,
    l0c:96,
    gm:8,
    cyc:'0.72',
    buffer:2,
    queue:'4 <= 8',
    queueOk:true,
    alignment:'32B 已对齐',
    alignmentOk:true,
    tail:'整除，无尾块',
    note:'容量贴合片上缓存，分块数和驻留率平衡。',
    advice:'作为当前 S5 输出写入 tiling.h。'
  },
  C:{
    name:'双缓冲方案',
    mode:'自动',
    verdict:'待复核',
    status:'review',
    sTile:512,
    ub:103,
    l0c:128,
    gm:4,
    cyc:'0.95',
    buffer:2,
    queue:'6 <= 8',
    queueOk:true,
    alignment:'32B 已对齐',
    alignmentOk:true,
    tail:'整除，无尾块',
    note:'分块更大，回 GM 次数少，但片上容量已经溢出。',
    advice:'需要缩小分块或降低缓冲数后再采用。'
  },
};
const S_TOTAL=2048; // 演示用 key 总长
function openTiling(){
  closeGraph(); closeCompare(); closePipe();
  unlockAnalysisView('tiling');
  setAnalysisView('tiling');
  renderTilingViz();
}
function closeTiling(){ if(currentAnalysisView()==='tiling') closeAnalysisView();else document.getElementById('split').classList.remove('tiling-open'); }
function tilingCapacityColor(value){
  if(value>100) return 'var(--danger)';
  if(value>=85) return 'var(--success)';
  return 'var(--warning)';
}
function tilingVerdictClass(o){
  return o.status==='review'?'tp-verdict--review':'tp-verdict--ready';
}
function tilingStateText(o,nTile,tail){
  const tailText=tail>0?`末块 ${tail}`:'整除';
  return `分块长度 ${o.sTile}，共 ${nTile} 块，${tailText}`;
}
function tilingMemoryFocus(stage){
  const focus = [
    {
      label:'读取全局内存',
      selectors:['[data-mem950-node="rail:GM"]','[data-mem950-node="rail:L2"]']
    },
    {
      label:'搬入 L1 缓存',
      routes:['l2-to-aic'],
      selectors:['[data-mem950-node="rail:GM"]','[data-mem950-node="rail:L2"]','#mem950-aic [data-aic-node="buffer:L1"]']
    },
    {
      label:'送入 L0B',
      selectors:['#mem950-aic [data-aic-node="buffer:L1"]','#mem950-aic [data-aic-node="buffer:L0B"]']
    },
    {
      label:'进入矩阵计算',
      selectors:['#mem950-aic [data-aic-node="buffer:L0B"]','#mem950-aic [data-aic-node="cube:CUBE"]']
    }
  ];
  return focus[stage] || focus[0];
}
function mountTilingMemoryArchitecture(){
  const shell=document.getElementById('tpMemoryArch');
  const stage=document.getElementById('tpMemoryStage');
  const mem=window.PtoMemoryArchitecturePattern;
  if(!shell||!stage||!mem) return;
  mem.renderArchitecture(stage,'ascend910b');
  mem.setAivFolded?.(stage,true);
  mem.setDetailVisibility?.(stage,false);
  const syncAicHeight=()=>{
    const aic=stage.querySelector('#mem950-aic .pto-aic-core') || stage.querySelector('#mem950-aic');
    const height=aic?.offsetHeight || 0;
    if(height>0) shell.style.setProperty('--tp-aic-height', `${Math.round(height)}px`);
  };
  syncAicHeight();
  const overlay=mem.createRouteOverlay?.(stage,'ascend910b');
  overlay?.render?.();
  window.__mlaTilingMemoryStage=stage;
  window.__mlaTilingMemoryOverlay=overlay;
  const viewport=shell.querySelector('[data-pto-mem-arch-viewport]');
  const sizer=shell.querySelector('[data-pto-mem-arch-sizer]');
  const canvas=shell.querySelector('[data-pto-mem-arch-canvas]');
  const zoom=mem.createZoomController?.({
    viewport,
    sizer,
    canvas,
    defaultZoom:0.32,
    min:0.26,
    max:0.9,
    pan:true,
    wheelZoom:true,
    centerOnReset:false,
    centerTarget:'.pto-mem950__rails, #mem950-aic',
    onZoom:()=>overlay?.render?.(),
    onPan:()=>overlay?.render?.()
  });
  requestAnimationFrame(()=>{
    syncAicHeight();
    zoom?.center?.();
    const pan=zoom?.getPan?.();
    if(pan) zoom.setPan(pan.x, 0);
    overlay?.render?.();
  });
  focusTilingMemoryStage(1);
  const tileCount=Number(shell.dataset.tileCount || 0);
  if(tileCount>0) animateTiling(tileCount,{loop:true});
}
function focusTilingMemoryStage(stage){
  const mem=window.PtoMemoryArchitecturePattern;
  const root=window.__mlaTilingMemoryStage;
  if(!mem||!root) return;
  mem.setPathFocus(root,'ascend910b',tilingMemoryFocus(stage));
  window.__mlaTilingMemoryOverlay?.render?.();
}
function renderTilingViz(){
  if(tileAnimTimer){clearInterval(tileAnimTimer);tileAnimTimer=null;}
  const c=TILING_OPTS[state.choices['S5']]?state.choices['S5']:'B';
  const o=TILING_OPTS[c];
  const nTile=Math.ceil(S_TOTAL/o.sTile);
  const full=Math.floor(S_TOTAL/o.sTile), tail=S_TOTAL - full*o.sTile;
  let blks='';
  for(let i=0;i<nTile;i++){
    const isTail=(tail>0 && i===nTile-1);
    const size=isTail?tail:o.sTile;
    blks+=`<div class="sblk ${isTail?'tail':''}" data-i="${i}" title="第 ${i+1} 块 · ${size}">${size}</div>`;
  }
  const ubCol=tilingCapacityColor(o.ub);
  const l0cCol=tilingCapacityColor(o.l0c);
  const verdictNote=o.status==='review'
    ? `待复核：UB ${o.ub}%，L0C ${o.l0c}%，超过片上容量后会触发回退搬运。`
    : `就绪：UB ${o.ub}%，L0C ${o.l0c}%，满足当前片上容量约束。`;
  const body=document.getElementById('tpBody');
  body.innerHTML=`
    <div class="tp-sec">
      <div class="h">分块方案</div>
      <div class="tp-scheme-grid">
        ${Object.entries(TILING_OPTS).map(([k,v])=>`
          <article class="tp-scheme ${k===c?'is-active':''}" role="button" tabindex="0" data-v="${k}">
            <div class="tp-scheme__top">
              <h4>${v.name}</h4>
              <span class="tp-scheme__badge">${v.mode}</span>
            </div>
            <div class="tp-verdict ${tilingVerdictClass(v)}"><span>判定</span><b>${v.verdict}</b></div>
            <div class="tp-scheme__facts">
              <div class="tp-scheme__row"><span>UB</span><b class="${v.ub>100?'is-risk':'is-ok'}">${v.ub}%</b></div>
              <div class="tp-scheme__row"><span>对齐</span><b class="${v.alignmentOk?'is-ok':'is-warn'}">${v.alignment}</b></div>
              <div class="tp-scheme__row"><span>队列</span><b class="${v.queueOk?'is-ok':'is-warn'}">${v.queue}</b></div>
              <div class="tp-scheme__row"><span>尾块</span><b>${v.tail}</b></div>
            </div>
            <p class="tp-scheme__note">${v.note}</p>
          </article>`).join('')}
      </div>
    </div>

    <div class="tp-sec">
      <div class="h">选中方案详情</div>
      <div class="tp-detail-grid">
        <section class="tp-detail-card tp-detail-card--wide">
          <div class="tp-detail-head">
            <h4>键维分块</h4>
            <span id="tpPlayState">${tilingStateText(o,nTile,tail)}</span>
          </div>
          <div class="tp-control-row">
            <div class="tp-explain">键维 ${S_TOTAL} 按 ${o.sTile} 切块。当前块的搬运路径会自动高亮，并标出下一块是否预取。</div>
          </div>
          <div class="sbar" id="sbar">${blks}</div>
          <div class="sbar-cap"><span>从第 1 块开始</span><span>${tail>0?`末块 ${tail}`:'整除'}</span></div>
          <div class="tp-memory-area">
            <div class="tp-memory-arch" id="tpMemoryArch" data-tile-count="${nTile}">
              <div class="tp-memory-arch__head"><span>内存架构 · 昇腾 A3 (910C)</span><span>路径随播放同步</span></div>
              <div class="pto-memory-architecture-viewport" data-pto-mem-arch-viewport>
                <div class="pto-memory-architecture-sizer" data-pto-mem-arch-sizer>
                  <div class="pto-memory-architecture-canvas" data-pto-mem-arch-canvas>
                    <div id="tpMemoryStage"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="tp-transfer-status">
              <div class="tp-transfer-card"><span>当前块</span><b id="tpCurrentBlock">等待播放</b></div>
              <div class="tp-transfer-card"><span>下一块</span><b id="tpNextBlock">尚未预取</b></div>
            </div>
          </div>
        </section>
        <section class="tp-detail-card">
          <div class="tp-current-summary">
            <div><b>${o.name}</b> · 分块长度 ${o.sTile}</div>
            <div>回 GM 次数 / 行：<b>${nTile}</b></div>
            <div>相对周期：<b style="color:${o.status==='ready'?'var(--success)':'var(--warning)'}">${o.cyc}×</b></div>
            <div>缓冲数：<b>${o.buffer}</b></div>
            <div class="tp-current-note ${o.status==='ready'?'is-ready':'is-review'}">${verdictNote}</div>
          </div>
        </section>
      </div>
    </div>

    <div class="tp-sec">
      <div class="h">片上缓冲占用 · 容量约束</div>
      <div class="util">
        <div class="ul"><span>统一缓冲 (UB)</span><b style="color:${ubCol}">${o.ub}%</b></div>
        <div class="track"><div class="fill" style="width:${Math.min(o.ub,100)}%;background:${ubCol}"></div><div class="cap-line" style="left:100%"></div></div>
      </div>
      <div class="util">
        <div class="ul"><span>L0C (矩阵输出)</span><b style="color:${l0cCol}">${o.l0c}%</b></div>
        <div class="track"><div class="fill" style="width:${Math.min(o.l0c,100)}%;background:${l0cCol}"></div><div class="cap-line" style="left:100%"></div></div>
      </div>
      ${o.ub>100||o.l0c>100?`<div style="font-size:14px;color:var(--danger);margin-top:4px">容量超限，触发回退搬运后周期会升高。</div>`:`<div style="font-size:14px;color:var(--success);margin-top:4px">${o.advice}</div>`}
    </div>

    <div class="tp-sec">
      <div class="h">代价评估</div>
      <div class="tp-metrics">
        <div class="tp-metric"><div class="mv">${nTile}</div><div class="mk">回 GM 次数 / 行</div></div>
        <div class="tp-metric"><div class="mv" style="color:${o.status==='ready'?'var(--success)':'var(--warning)'}">${o.cyc}×</div><div class="mk">相对周期</div></div>
        <div class="tp-metric"><div class="mv">${o.sTile}</div><div class="mk">分块长度</div></div>
      </div>
    </div>`;
  // 选项联动:更新选择 → 重渲染 tiling.h 与可视化
  body.querySelectorAll('.tp-scheme').forEach(el=>{
    const choose=()=>{
      state.choices['S5']=el.dataset.v;
      renderTilingViz();
      if(activeTab==='tiling') renderCode('tiling');       // 同步 tiling.h 源码
      renderWizard();                                       // 同步向导选项
    };
    el.onclick=choose;
    el.onkeydown=(ev)=>{
      if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();choose();}
    };
  });
  requestAnimationFrame(mountTilingMemoryArchitecture);
}
let tileAnimTimer=null;
function animateTiling(nTile,options={}){
  if(tileAnimTimer){clearInterval(tileAnimTimer);tileAnimTimer=null;}
  const blks=document.querySelectorAll('#sbar .sblk');
  const stateLabel=document.getElementById('tpPlayState');
  const current=document.getElementById('tpCurrentBlock');
  const next=document.getElementById('tpNextBlock');
  const clear=()=>{
    blks.forEach(b=>b.classList.remove('act','next'));
  };
  clear();
  let frame=0;
  const stageCount=4;
  const step=()=>{
    clear();
    const tile=Math.floor(frame/stageCount);
    const stage=frame%stageCount;
    if(tile>=nTile){
      if(options.loop){
        frame=0;
        return step();
      }
      if(stateLabel) stateLabel.textContent='播放完成';
      if(current) current.textContent=`共 ${nTile} 块已完成`;
      if(next) next.textContent='没有待预取分块';
      clearInterval(tileAnimTimer);
      tileAnimTimer=null;
      return;
    }
    const stageInfo=tilingMemoryFocus(stage);
    const nextStageInfo=stage<stageCount-1?tilingMemoryFocus(stage+1):null;
    if(blks[tile]) blks[tile].classList.add('act');
    if(blks[tile+1]) blks[tile+1].classList.add('next');
    focusTilingMemoryStage(stage);
    if(stateLabel) stateLabel.textContent=`第 ${tile+1} / ${nTile} 块：${stageInfo.label}`;
    if(current) current.textContent=nextStageInfo?`第 ${tile+1} 块：${stageInfo.label} → ${nextStageInfo.label}`:`第 ${tile+1} 块：进入矩阵计算`;
    if(next) next.textContent=tile+1<nTile?`第 ${tile+2} 块等待预取`:'没有下一块';
    frame++;
  };
  step();
  tileAnimTimer=setInterval(step, Math.max(220, 2600/Math.max(nTile,1)));
}

/* ============================ S6 流水线前后对比可视化 ============================ */
// 三个分块,时间以「格」为单位。op:mte(搬运2格)/cube(2格)/vec(1格)
const PIPE_TILES=3;
// 串行:每块依次搬运→矩阵→向量,单元间空档形成气泡
function buildSerial(){
  const rows={mte:[],cube:[],vec:[]}; let t=0;
  for(let n=0;n<PIPE_TILES;n++){
    rows.mte.push({s:t,w:2,l:`搬${n}`,cls:'mte'});
    // 矩阵单元需等搬运完成 → 气泡
    rows.cube.push({s:t,w:2,l:'',cls:'bub'});          // 矩阵单元空转等待
    rows.cube.push({s:t+2,w:2,l:`矩${n}`,cls:'cube'});
    rows.vec.push({s:t+4,w:1,l:`向${n}`,cls:'vec'});
    t+=5;
  }
  return {rows,total:t};
}
// 双缓冲流水:搬运连续预取,矩阵单元紧接上一块搬运后连续执行,向量单元跟随
function buildPipe(){
  const rows={mte:[],cube:[],vec:[]};
  // 搬运单元预热块0(2格),之后每块提前预取,连续排布
  for(let n=0;n<PIPE_TILES;n++) rows.mte.push({s:n*2,w:2,l:`搬${n}`,cls:'mte'});
  // 矩阵单元从块0搬完(t=2)起连续执行,每块2格
  for(let n=0;n<PIPE_TILES;n++) rows.cube.push({s:2+n*2,w:2,l:`矩${n}`,cls:'cube'});
  // 向量单元跟在各自矩阵计算之后
  for(let n=0;n<PIPE_TILES;n++) rows.vec.push({s:4+n*2,w:1,l:`向${n}`,cls:'vec'});
  const total=4+PIPE_TILES*2; // 末块矩阵与向量结束
  return {rows,total};
}
function tlRowHTML(label, cells, total, play){
  const pct=x=>(x/total*100);
  let inner='';
  cells.forEach((c,i)=>{
    inner+=`<div class="tl-cell ${c.cls} ${play?'play':''}" style="left:${pct(c.s)}%;width:${pct(c.w)}%;${play?`animation-delay:${i*90}ms`:''}">${c.l}</div>`;
  });
  return `<div class="tl-row"><div class="tl-lbl">${label}</div><div class="tl-track">${inner}</div></div>`;
}
function timelineHTML(model, play){
  const {rows,total}=model;
  return `<div class="tl-rows">
    ${tlRowHTML('搬运单元', rows.mte, total, play)}
    ${tlRowHTML('矩阵单元', rows.cube, total, play)}
    ${tlRowHTML('向量单元', rows.vec, total, play)}
  </div>
  <div class="tl-axis"><span>t=0</span><span>时间 →</span><span>t=${total}</span></div>`;
}
function openPipe(){
  closeGraph(); closeCompare(); closeTiling();
  unlockAnalysisView('pipeline');
  setAnalysisView('pipeline');
  renderPipeViz(false);
}
function closePipe(){ if(currentAnalysisView()==='pipeline') closeAnalysisView();else document.getElementById('split').classList.remove('pipe-open'); }
function renderPipeViz(play){
  const ser=buildSerial(), pip=buildPipe();
  const serBubbles=ser.rows.cube.filter(c=>c.cls==='bub').length;
  const body=document.getElementById('ppBody');
  body.innerHTML=`
    <div class="pp-play" id="ppPlay">▶ 播放流水时序</div>
    <div class="pp-block">
      <div class="h"><span class="badge old">编排前</span>串行:搬运→计算 顺序执行</div>
      ${timelineHTML(ser, play)}
      <div style="font-size:14px;color:var(--dim);margin-top:5px">矩阵单元每块都要空等搬运完成(斜纹为气泡),单元利用率低。</div>
    </div>
    <div class="pp-block">
      <div class="h"><span class="badge new">编排后</span>双缓冲:预取 n+1 ∥ 计算 n</div>
      ${timelineHTML(pip, play)}
      <div style="font-size:14px;color:var(--dim);margin-top:5px">TQue 深度 1→2,搬运预取与矩阵/向量计算重叠,气泡几乎消除。</div>
    </div>
    <div class="pp-metrics">
      <div class="pp-metric"><div class="mv"><span style="color:var(--risk)">${ser.total}</span><span class="arw">→</span><span style="color:var(--ok)">${pip.total}</span></div><div class="mk">总周期(格)</div></div>
      <div class="pp-metric"><div class="mv"><span style="color:var(--risk)">21%</span><span class="arw">→</span><span style="color:var(--ok)">4%</span></div><div class="mk">流水气泡</div></div>
      <div class="pp-metric"><div class="mv" style="color:var(--ok)">${(ser.total/pip.total).toFixed(2)}×</div><div class="mk">吞吐提升</div></div>
    </div>`;
  const pb=document.getElementById('ppPlay');
  if(pb) pb.onclick=()=>renderPipeViz(true);
}

/* ============================ 计算图 ============================ */
// unit: mem|cube|vector|scalar|risk
const GNODES=[
  {id:'q', x:16, y:20, w:130, h:42, unit:'mem', t:'Q', s:'[batch, seq, dim]', d:'查询张量输入。前向核按 BLOCK_SIZE_M 把序列行分块,由 program_id 决定当前行块,tl.load 将 Q 块读入片上 SRAM,在整个列循环中常驻,参与每个 KV 块的 Q·Kᵀ。', lines:[34,36]},
  {id:'k', x:170, y:20, w:130, h:42, unit:'mem', t:'K', s:'[batch, seq, dim]', d:'键张量输入。列循环中按 BLOCK_SIZE_N 分块,tl.load 逐块读入当前 K 块,再经 tl.trans 转置后与 Q 做点积得到注意力分数。', lines:[54,55]},
  {id:'v', x:324, y:20, w:130, h:42, unit:'mem', t:'V', s:'[batch, seq, dim]', d:'值张量输入。与 K 同步按列分块 tl.load 载入,softmax 归一化后的概率矩阵 P 与之相乘累加到输出 acc_o。', lines:[58,59]},
  {id:'cfg', x:530, y:24, w:150, h:42, unit:'scalar', t:'分块 / 缩放参数', s:'BLOCK_M/N/D · scale', d:'BLOCK_SIZE_M/N/DMODEL 决定行列与特征维分块大小,scale=1/sqrt(head_dim) 作为 logits 缩放因子,共同控制分块循环范围与数值范围。', lines:[14,21]},
  {id:'loadq', x:40, y:150, w:140, h:44, unit:'mem', t:'载入 Q 块', s:'tl.load → SRAM', d:'把当前行块的 Q 通过 tl.load 读入片上 SRAM,并用 row_mask 处理序列尾块。Flash Attention 让 Q 块常驻,不在列循环中重复搬运。', lines:[34,39]},
  {id:'loadkv', x:250, y:150, w:170, h:44, unit:'mem', t:'载入 K / V 块 (列循环)', s:'for start_n · tl.load', d:'沿 seq_len 按 BLOCK_SIZE_N 循环,tl.load 逐块把 K、V 读入片上,并用 col_mask 处理尾块。分块流式加载是 v2 减少 HBM 访问的核心。', lines:[44,59]},
  {id:'qk', x:110, y:280, w:160, h:46, unit:'cube', t:'Q·Kᵀ · scale', s:'tl.dot(q, kᵀ)', d:'第一路矩阵乘: q_block 与转置后的 k_block 做 tl.dot,再乘 scale 得到当前 KV 块的注意力 logits qk。', lines:[59,59]},
  {id:'mask', x:120, y:400, w:160, h:46, unit:'vector', t:'因果 Mask', s:'tl.where(-inf)', d:'因果场景下当列块处于当前行块之后时,用 tl.where 把上三角(col>row)的 logits 置为 -inf,保证只关注历史位置。', lines:[62,64]},
  {id:'softmax', x:100, y:520, w:200, h:62, unit:'vector', t:'在线 Softmax', s:'max · exp · p_scale · l_i', d:'在线 softmax: 计算块内行最大 m_ij 并更新 m_i,用自然 tl.exp 得到概率 p_ij,以 p_scale=exp(m_i-m_i_new) 修正历史贡献,滚动更新归一化分母 l_i。昇腾向量单元可直接对应,无需 exp2/log2 底数技巧。', lines:[67,75]},
  {id:'pv', x:120, y:662, w:160, h:46, unit:'cube', t:'P·V 累加', s:'tl.dot(p, v)', d:'第二路矩阵乘: 概率矩阵 p_ij 与 v_block 做 tl.dot,先按 p_scale 缩放历史 acc_o 再累加,实现分块在线加权求和。', lines:[78,78]},
  {id:'norm', x:110, y:772, w:160, h:44, unit:'vector', t:'归一化', s:'acc_o / l_i', d:'列循环结束后用累积分母 l_i 对 acc_o 做逐元素归一化,得到最终注意力输出。', lines:[85,85]},
  {id:'out', x:60, y:862, w:150, h:44, unit:'mem', t:'Output', s:'tl.store → HBM', d:'把归一化后的输出块 tl.store 写回 output,并用 row_mask 跳过尾块无效行。', lines:[88,89]},
  {id:'lmstat', x:250, y:862, w:170, h:44, unit:'mem', t:'保存 L / M 统计', s:'l_i / m_i (backward)', d:'存储每行的 softmax 统计量 l_i、m_i,供反向核重算概率并计算 dq/dk/dv 梯度使用。', lines:[92,95]},
  {id:'simt', x:520, y:150, w:160, h:44, unit:'risk', gpuOnly:true, t:'SIMT grid 映射', s:'tl.program_id', d:'Triton 用 tl.program_id 把 (行块, batch) 映射到 GPU 线程网格,依赖 SIMT 执行模型。昇腾达芬奇无 SIMT,须在 S2 决策改为分核 SPMD,用 block_idx 切分行块。', lines:[22,28]},
  {id:'warp', x:520, y:290, w:160, h:44, unit:'risk', gpuOnly:true, t:'warp 级 tl.dot', s:'MMA / num_warps', d:'tl.dot 借助 GPU warp 级张量核 (MMA) 完成分块矩阵乘,受 num_warps 调度。昇腾无 warp 概念,须在 S2 决策删除,改用 Cube 矩阵单元 Mmad + 分核并行。', lines:[59,59]},
];
const GEDGES=[
  ['q','loadq'],['cfg','loadq'],['k','loadkv'],['v','loadkv'],['cfg','loadkv'],
  ['loadq','qk'],['loadkv','qk'],
  ['qk','mask'],['mask','softmax'],
  ['softmax','pv'],['loadkv','pv'],['pv','norm'],['norm','out'],['softmax','lmstat'],
  ['simt','loadq'],['simt','loadkv'],['warp','qk'],['warp','pv']
];
const UNITC={mem:'--mem',cube:'--cube',vector:'--vec',scalar:'--scalar',risk:'--risk'};
let graphMapped=false; // 经 S2 后 risk→vector

function unitColor(u){return getComputedStyle(document.documentElement).getPropertyValue(UNITC[u]).trim()}
function renderGraph(animate){
  const W=800,H=920;
  const eff=id=>{const n=GNODES.find(x=>x.id===id);let u=n.unit;if(graphMapped&&u==='risk')u='vector';return u;};
  let edges='';
  GEDGES.forEach(([a,b])=>{
    const na=GNODES.find(n=>n.id===a),nb=GNODES.find(n=>n.id===b);
    const x1=na.x+na.w/2,y1=na.y+na.h,x2=nb.x+nb.w/2,y2=nb.y;
    const my=(y1+y2)/2;
    const hot=(eff(a)==='risk'||eff(b)==='risk');
    edges+=`<path class="gedge${hot?' hot':''}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
  });
  let nodes='';
  GNODES.forEach((n,i)=>{
    const u=eff(n.id); const col=unitColor(u);
    const risk=(u==='risk');
    nodes+=`<g class="gnode${animate?' enter':''}" data-id="${n.id}" style="${animate?`animation-delay:${i*70}ms`:''}">
      ${risk?`<rect x="${n.x-3}" y="${n.y-3}" width="${n.w+6}" height="${n.h+6}" rx="${n.h/2+3}" fill="none" stroke="${col}" stroke-width="1.4" class="risk-pulse"/>`:''}
      <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${risk ? n.h/2 : 9}" fill="${risk ? 'var(--surface-3)' : `${col}22`}" stroke="${risk ? 'var(--danger)' : col}" stroke-width="${risk ? 2.2 : 1.4}"/>
      <text class="nt" x="${n.x+11}" y="${n.y+ (n.h>42?19:18)}" fill="#eef" font-size="13">${n.t}</text>
      <text class="ns2" x="${n.x+11}" y="${n.y+(n.h>42?33:31)}" fill="${risk ? 'var(--danger)' : col}" font-size="12" font-family="ui-monospace,Menlo,Consolas,monospace">${n.s}</text>
      ${(graphMapped&&n.unit==='risk')?`<text x="${n.x+n.w-8}" y="${n.y+13}" text-anchor="end" fill="${col}" font-size="12" font-weight="700">✓改写</text>`:''}
    </g>`;
  });
  document.getElementById('gcanvas').innerHTML=
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="min-height:${H}px">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L9,5 L0,10 z" fill="#5a6076"/></marker></defs>
      ${edges}${nodes}
    </svg>`;
  document.querySelectorAll('.gnode').forEach(el=>el.addEventListener('click',()=>selectNode(el.dataset.id)));
}
function selectNode(id){
  document.querySelectorAll('.gnode').forEach(e=>e.classList.toggle('sel',e.dataset.id===id));
  const n=GNODES.find(x=>x.id===id); let u=n.unit; if(graphMapped&&u==='risk')u='vector';
  const label={mem:'片上搬运',cube:'矩阵单元',vector:'向量单元',scalar:'标量单元',risk:'仅源端支持 · 无直接适配'}[u];
  const col=unitColor(u);
  let note=n.d;
  if(graphMapped&&n.unit==='risk') note='【已在 S2 改写】'+n.d.replace(/S2 决策.*$/,'现映射为分核 + 向量单元片上归约,见 S6 的在线 Softmax 规约实现。');
  document.getElementById('gdetail').innerHTML=
    `<span class="badge" style="background:${col}22;color:${col};border:1px solid ${col}66">${label}</span>`+
    `<b>${n.t}</b> · <code style="font-family:var(--mono);font-size:13px">${n.s}</code><br>`+
    `<span style="display:block;margin-top:6px">${note}</span>`;

  // 源码联动：计算图节点来自 CUDA 解析，始终定位到 .cu 源码
  if(n.lines && n.lines.length >= 2){
    if(activeTab !== 'cuda'){ switchTab('cuda'); }
    // 切换 tab 后 DOM 需要重新渲染，稍作延迟再高亮滚动
    requestAnimationFrame(()=>highlightCodeLines(n.lines[0], n.lines[1]));
  }
}

/* ---------- S2 算子映射清单（主内容区展示） ---------- */
// CUDA 算子 → 昇腾算子/执行单元 对照。risk 项随 S2 决策变化。
const OPMAP=[
  {cuda:'tl.load(Q → SRAM)', op:'DataCopy / 片上暂存', unit:'mem', node:'loadq', rewrite:false},
  {cuda:'tl.load(K / V → SRAM, 列循环)', op:'DataCopy + pipeline stage', unit:'mem', node:'loadkv', rewrite:false},
  {cuda:'tl.dot(q, kᵀ) · scale', op:'Mmad / Cube GEMM', unit:'cube', node:'qk', rewrite:false},
  {cuda:'tl.where 因果 Mask', op:'Vector Select', unit:'vector', node:'mask', rewrite:false},
  {cuda:'max / tl.exp / sum (在线 Softmax)', op:'Vector Reduce / Exp', unit:'vector', node:'softmax', rewrite:false},
  {cuda:'tl.dot(p, v)', op:'Mmad / Cube GEMM', unit:'cube', node:'pv', rewrite:false},
  {cuda:'acc_o /= l_i', op:'Vector Div', unit:'vector', node:'norm', rewrite:false},
  {cuda:'tl.store(L / M 统计)', op:'DataCopy → GM', unit:'mem', node:'lmstat', rewrite:false},
  {cuda:'tl.program_id (SIMT 网格)', op:'无对应 → 改分核 SPMD (GetBlockIdx)', unit:'risk', node:'simt', rewrite:true},
  {cuda:'warp 级 tl.dot (MMA / num_warps)', op:'无对应 → Cube Mmad + 分核', unit:'risk', node:'warp', rewrite:true},
];const UNIT_LABEL={mem:'片上搬运',cube:'矩阵单元',vector:'向量单元',scalar:'标量单元',risk:'仅源端支持 · 无直接适配'};
/* ---------- 迁移可行性雷达 ---------- */
// 六维评分(0-100,越高越易迁移)。s1=S1 初判(未做映射决策);v=S2 选「向量单元片上归约」后;
// s=S2 选「标量单元模拟」后。S2 雷达随 S2 决策实时切换主多边形并叠加 S1 基线做对比。
const FEAS_AXES=[
  {label:'计算密度', s1:82, v:92, s:88, tip:'Q·Kᵀ / P·V GEMM 直接落 Cube 矩阵单元'},
  {label:'API 覆盖', s1:70, v:90, s:78, tip:'DataCopy / Mmad / Reduce* 均有昇腾对应算子'},
  {label:'精度对齐', s1:58, v:60, s:56, tip:'FP16 + FP32 累加;在线 Softmax rescale 次序待 S7 校验'},
  {label:'性能收益', s1:60, v:88, s:34, tip:'向量单元片上归约吞吐最高;标量模拟严重浪费算力'},
  {label:'并行模型', s1:28, v:82, s:44, tip:'SIMT 网格 + warp 级 MMA 无对应 → 分核 SPMD 重写'},
  {label:'内存层次', s1:52, v:66, s:60, tip:'GPU 共享内存 → L1 / L0 / UB;L0C 无直连 UB 需中转'},
];
function feasVerdict(avg){
  if(avg>=75) return {t:'高可行', c:'var(--ok)'};
  if(avg>=60) return {t:'可迁移 · 有改写点', c:'var(--warn)'};
  return {t:'需重写关键路径', c:'var(--risk)'};
}
function heatColor(v){ return v<45?'var(--risk)':(v<66?'var(--warn)':'var(--ok)'); }
function renderFeasRadar(stage){
  const isS2 = stage==='S2';
  const choice = state.choices['S2'] || 'vector';
  const mainKey = !isS2 ? 's1' : (choice==='scalar'?'s':'v');
  const mainVals = FEAS_AXES.map(a=>a[mainKey]);
  const baseVals = FEAS_AXES.map(a=>a.s1);           // S2 叠加的对比基线
  const avg = Math.round(mainVals.reduce((x,y)=>x+y,0)/mainVals.length);
  const vd = feasVerdict(avg);
  const mainCol = !isS2 ? 'var(--mem)' : (choice==='scalar'?'var(--risk)':'var(--ok)');
  // ---- SVG 几何 ----
  const cx=120, cy=104, R=74, N=FEAS_AXES.length;
  const ang=i=>(-90 + i*360/N)*Math.PI/180;
  const pt=(i,val)=>[cx+R*val/100*Math.cos(ang(i)), cy+R*val/100*Math.sin(ang(i))];
  const polyStr=vals=>vals.map((v,i)=>pt(i,v).join(',')).join(' ');
  // 网格环 + 轴线
  let grid='';
  [25,50,75,100].forEach(r=>{ grid+=`<polygon class="grid" points="${polyStr(FEAS_AXES.map(()=>r))}"/>`; });
  for(let i=0;i<N;i++){ const p=pt(i,100); grid+=`<line class="spoke" x1="${cx}" y1="${cy}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}"/>`; }
  // 轴标签
  let labels='';
  for(let i=0;i<N;i++){
    const a=ang(i), lx=cx+(R+13)*Math.cos(a), ly=cy+(R+13)*Math.sin(a);
    const c=Math.cos(a); const anchor=Math.abs(c)<0.3?'middle':(c>0?'start':'end');
    const dy=Math.sin(a)<-0.3?-1:(Math.sin(a)>0.3?8:3);
    labels+=`<text class="axl" x="${lx.toFixed(1)}" y="${(ly+dy).toFixed(1)}" text-anchor="${anchor}">${FEAS_AXES[i].label}</text>`;
  }
  // 基线多边形(仅 S2)+ 主多边形 + 顶点
  const basePoly = isS2 ? `<polygon class="poly-base" points="${polyStr(baseVals)}"/>` : '';
  const mainPoly = `<polygon class="poly-main" points="${polyStr(mainVals)}" style="fill:color-mix(in srgb, ${mainCol} 18%, transparent);stroke:${mainCol}"/>`;
  const dots = mainVals.map((v,i)=>{const p=pt(i,v);return `<circle class="dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.4" style="fill:${mainCol}"/>`;}).join('');
  const svg=`<svg class="feas-plot" viewBox="0 0 240 216" role="img" aria-label="迁移可行性雷达图">
    ${grid}${labels}${basePoly}${mainPoly}${dots}</svg>`;
  // 图例(S2)
  const legend = isS2 ? `<div class="feas-legend">
    <span><i style="border-top-color:${mainCol}"></i>映射后 (${choice==='scalar'?'标量模拟':'向量单元'})</span>
    <span><i style="border-top-color:var(--foreground-secondary);border-top-style:dashed"></i>S1 源端基线</span>
  </div>` : '';
  // 逐轴条形
  const rows=FEAS_AXES.map((a,i)=>{
    const v=mainVals[i];
    let delta='';
    if(isS2){ const d=v-a.s1; delta = d===0?'' : ` <span class="${d>0?'up':'dn'}">${d>0?'▲':'▼'}${Math.abs(d)}</span>`; }
    return `<div class="feas-row" title="${a.tip}">
      <span class="fl">${a.label}</span>
      <span class="fbar"><i style="width:${v}%;background:${heatColor(v)}"></i>${isS2?`<u style="left:${a.s1}%"></u>`:''}</span>
      <span class="fv">${v}${delta}</span>
    </div>`;
  }).join('');
  const title = isS2 ? '🛰 迁移可行性雷达 · 映射后 vs 源端基线' : '🛰 迁移可行性雷达 · 源端初判';
  return `<div class="feas">
    <div class="feas-h">${title}<span class="verdict" style="color:${vd.c};background:color-mix(in srgb, ${vd.c} 14%, transparent)">${vd.t} · <b>${avg}</b>/100</span></div>
    ${svg}${legend}
    <div class="feas-rows">${rows}</div>
  </div>`;
}
function renderOpMapTable(){
  const choice = state.choices['S2'] || 'vector';
  let rows='';
  OPMAP.forEach(m=>{
    let unit=m.unit, op=m.op, st, stCls, isRw=false;
    if(m.rewrite){
      // 依据 S2 决策决定重写目标; GPU 专属原语(risk)保留自定义描述
      if(m.unit !== 'risk'){
        if(choice==='scalar'){ unit='scalar'; op='标量单元逐元素模拟'; }
        else { unit='vector'; op='向量单元片上归约'; }
      }
      st='需重写'; stCls='rw'; isRw=true;
    } else {
      st='直接映射'; stCls='ok';
    }
    const col=unitColor(unit);
    const on=(lastApiNode===m.node && currentAnalysisView()==='api')?'on':'';
    rows+=`<tr class="${isRw?'rw':''} ${on}" data-node="${m.node}" title="查看 ${op} 的昇腾 API 详情">
      <td class="cuda">${m.cuda}</td>
      <td class="op">${op}</td>
      <td><span class="unit" style="color:${col}"><i style="background:${col}"></i>${UNIT_LABEL[unit]}</span></td>
      <td><span class="st ${stCls}">${st}</span></td>
      <td><span class="api-link">详情<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"></path></svg></span></td>
    </tr>`;
  });
  const rwN=OPMAP.filter(m=>m.rewrite).length, okN=OPMAP.length-rwN;
  return `<div class="opmap">
    <div class="opmap-h">🗺 算子映射清单 · 源端 → 昇腾<span class="cnt">${okN} 直接映射 · ${rwN} 需重写 · 点击行查看 API</span></div>
    <table>
      <thead><tr><th>源端算子</th><th>昇腾算子</th><th>执行单元</th><th>状态</th><th>API</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
/* ---------- S4 内存层次注入代码清单（源码定位 + 数据流动画） ---------- */
// 注入到 flash_mla_decode.cpp (S4 视图) 的关键内存层次代码。line 为渲染源码行号(1-based)，
// flow 为对应「数据流」动画步骤索引 (FLOW_STEPS)。
const S4_SITES=[
  {unit:'mem',  where:'片上缓冲层次声明', what:'InitBuffer × 6 分配 L1 / L0 / UB 缓冲',
   code:'pipe.InitBuffer(qL1, 1, (DIM+PE_DIM)*sizeof(half));', line:[27,32], flow:0},
  {unit:'mem',  where:'Q | Q_pe 载入', what:'DataCopy · GM → L1 → L0A',
   code:'DataCopy(qLoc, qGm[…], DIM);', line:[38,39], flow:0},
  {unit:'mem',  where:'KV | K_pe 分块载入', what:'DataCopy · GM → L1 → L0B (列循环)',
   code:'DataCopy(kLoc, kvGm[…], tileSize*DIM);', line:[64,65], flow:1},
  {unit:'cube', where:'Q·Kᵀ 矩阵乘', what:'Mmad · 结果落 L0C (FP32 累加)',
   code:'Mmad(logits, q, k, {1, tileSize, DIM+PE_DIM});', line:[71,72], flow:2},
  {unit:'risk', where:'打分回写中转', what:'DataCopy ×2 · L0C → GM → UB (无直连)',
   code:'DataCopy(wsGm[…], lg, tileSize);   // L0C→GM\nDataCopy(qkScores, wsGm[…], tileSize); // GM→UB', line:[78,80], flow:3},
  {unit:'vec',  where:'在线 Softmax 归约', what:'向量单元 · ReduceMax / Exp / ReduceSum 片上归约',
   code:'ReduceMax(qkScores,…) → Exp(qkScores,…) → ReduceSum(qkScores,…);', line:[81,88], flow:4},
];
function renderS4CodeSites(){
  const rows=S4_SITES.map((s,i)=>{
    const col=unitColor(s.unit==='risk'?'risk':s.unit);
    const ln = s.line[0]===s.line[1] ? `L${s.line[0]}` : `L${s.line[0]}–${s.line[1]}`;
    return `<div class="s4site" data-i="${i}" title="定位源码并播放数据流">
      <div class="s4-top">
        <span class="s4-dot" style="background:${col}"></span>
        <b>${s.where}</b>
        <span class="s4-ln">${ln}</span>
      </div>
      <div class="s4-what">${s.what}</div>
      <pre class="s4-code">${s.code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
    </div>`;
  }).join('');
  return `<div class="s4list">
    <div class="s4list-h">🧩 内存层次注入代码 · <code>flash_mla_decode.cpp</code><span class="cnt">${S4_SITES.length} 处 · 点击定位源码 + 播放数据流</span></div>
    ${rows}
  </div>`;
}
// 让左侧编辑器显示 S4 版 AscendC 源码（若尚未显示）
function ensureS4Source(){
  if(activeTab!=='cpp'){
    activeTab='cpp'; renderTabs(); renderTree();
  }
  renderCode('s4');
  const h=document.getElementById('leftPaneH'); if(h) h.style.display='none';
  const f=document.getElementById('etbFile'); if(f) f.textContent='flash_mla_decode.cpp';
}
// 点击清单项：定位左侧源码 + 在「数据流」视图播放对应动画步骤
function gotoS4Site(i){
  const s=S4_SITES[i]; if(!s) return;
  // 1) 先打开「数据流」视图并播放对应流转步骤（先切视图，稳定编辑器布局）
  if(!unlockedAnalysisViews.has('flow')) unlockAnalysisView('flow');
  setAnalysisView('flow');
  if(!document.getElementById('flowpane').innerHTML.trim()) renderFlow();
  stopFlow();
  flowIdx = Math.max(0, Math.min(FLOW_STEPS.length-1, s.flow));
  showFlowStep(flowIdx);
  // 2) 定位左侧源码：高亮 + 即时滚动到目标行（规避 smooth 被布局变更打断）
  ensureS4Source();
  highlightCodeLines(s.line[0], s.line[1]);
  const cw=document.getElementById('codewrap');
  const cl=document.getElementById('codelines');
  const t=cl && cl.querySelectorAll('.ln')[s.line[0]-1];
  if(cw && t){
    const wr=cw.getBoundingClientRect(), lr=t.getBoundingClientRect();
    cw.scrollTop = Math.max(0, (lr.top - wr.top) + cw.scrollTop - cw.clientHeight/3);
  }
}

/* ---------- S2 昇腾算子 API 详情（点击映射清单 → 在计算图面板区展示） ---------- */
// 复用的 AscendC API 卡片定义。签名中的尖括号/取址符已按 HTML 实体转义。
const API_DATACOPY={nm:'DataCopy',ns:'AscendC',since:'CANN 8.0.RC1',
  brief:'在 GM 与片上缓冲（L1 / L0 / UB）之间搬运连续数据块，是所有数据流动的基础搬运指令。',
  sig:'template &lt;typename T&gt;\nvoid DataCopy(const LocalTensor&lt;T&gt;&amp; dst,\n              const GlobalTensor&lt;T&gt;&amp; src,\n              const uint32_t calCount);',
  params:[
    {n:'dst',t:'LocalTensor&lt;T&gt;',d:'目的片上张量（L1 / L0 / UB），由 <code>TQue</code> 分配'},
    {n:'src',t:'GlobalTensor&lt;T&gt;',d:'源全局张量（GM）'},
    {n:'calCount',t:'uint32_t',d:'搬运元素个数，起止地址需 <code>32B</code> 对齐'},
  ],
  notes:['搬运方向由张量的 <code>TPosition</code> 决定：GM ↔ L1 ↔ L0 ↔ UB。','大块搬运建议配合 <code>TQue</code> 深度 2 双缓冲，让搬运与计算重叠（见 S6）。'],
  ex:'DataCopy(qLocal, qGm[bOffset], BLOCK_M * headDim);'};
const API_MMAD={nm:'Mmad',ns:'AscendC',since:'CANN 8.0.RC1',
  brief:'矩阵单元（Cube）GEMM 指令：dst = a · b，FP16 输入、FP32 片上累加，结果落 L0C。',
  sig:'void Mmad(const LocalTensor&lt;float&gt;&amp; dstL0C,\n          const LocalTensor&lt;half&gt;&amp; a,\n          const LocalTensor&lt;half&gt;&amp; b,\n          const MmadParams&amp; params);',
  params:[
    {n:'dstL0C',t:'LocalTensor&lt;float&gt;',d:'结果矩阵，位于 L0C，FP32 累加'},
    {n:'a',t:'LocalTensor&lt;half&gt;',d:'左矩阵（L0A），由矩阵单元自动分形'},
    {n:'b',t:'LocalTensor&lt;half&gt;',d:'右矩阵（L0B）'},
    {n:'params',t:'MmadParams',d:'含 <code>m / n / k</code> 尺寸与 <code>cmatrixInitVal</code>（是否清零累加）'},
  ],
  notes:['昇腾<b>无 warp 概念</b>：矩阵单元自管 L0A / L0B 分形，源端 <code>num_warps</code> / warp 级 MMA 整体删除。','沿 <code>k</code> 方向可累加，配合 KV 分块循环实现大 GEMM 分块。'],
  ex:'Mmad(scoreL0C, qL0A, kL0B, {BLOCK_M, BLOCK_N, headDim, false});'};
const API_SELECT={nm:'Select',ns:'AscendC',since:'CANN 8.0.RC1',
  brief:'向量单元按位选择：mask 为真取 src0，否则取标量 src1，用于因果 Mask 屏蔽上三角。',
  sig:'template &lt;typename T&gt;\nvoid Select(const LocalTensor&lt;T&gt;&amp; dst,\n            const LocalTensor&lt;uint8_t&gt;&amp; mask,\n            const LocalTensor&lt;T&gt;&amp; src0, T src1,\n            SELMODE mode, const uint32_t count);',
  params:[
    {n:'dst',t:'LocalTensor&lt;T&gt;',d:'输出张量（UB）'},
    {n:'mask',t:'LocalTensor&lt;uint8_t&gt;',d:'因果掩码，1 保留、0 屏蔽'},
    {n:'src0 / src1',t:'LocalTensor&lt;T&gt; / T',d:'保留值 / 屏蔽填充值（<code>-inf</code>）'},
    {n:'mode',t:'SELMODE',d:'选择模式，逐元素用 <code>VSEL_TENSOR_SCALAR_MODE</code>'},
  ],
  notes:['在向量单元执行，替代源端 <code>tl.where</code> 的指针 + mask 寻址。'],
  ex:'Select(qk, causalMask, qk, -INFINITY, VSEL_TENSOR_SCALAR_MODE, sTile);'};
const API_REDUCEMAX={nm:'ReduceMax',ns:'AscendC',since:'CANN 8.0.RC1',
  brief:'向量单元树形归约求每行最大值，用于在线 Softmax 的数值稳定项 m_i。',
  sig:'template &lt;typename T&gt;\nvoid ReduceMax(const LocalTensor&lt;T&gt;&amp; dst,\n               const LocalTensor&lt;T&gt;&amp; src,\n               const LocalTensor&lt;T&gt;&amp; work,\n               const uint32_t count, bool calIndex);',
  params:[
    {n:'dst',t:'LocalTensor&lt;T&gt;',d:'归约结果（每行最大值）'},
    {n:'src',t:'LocalTensor&lt;T&gt;',d:'输入打分张量'},
    {n:'work',t:'LocalTensor&lt;T&gt;',d:'归约中间缓冲'},
    {n:'calIndex',t:'bool',d:'是否同时输出最大值下标，此处 <code>false</code>'},
  ],
  notes:['与 <code>ReduceSum</code> 一起构成在线 Softmax 的 running max / sum 更新。']};
const API_EXP={nm:'Exp',ns:'AscendC',since:'CANN 8.0.RC1',
  brief:'向量单元逐元素自然指数。昇腾用自然底 Exp，须去掉源端 <code>exp2</code> 的 <code>log2(e)</code> 预乘（否则 S7 精度异常）。',
  sig:'template &lt;typename T&gt;\nvoid Exp(const LocalTensor&lt;T&gt;&amp; dst,\n         const LocalTensor&lt;T&gt;&amp; src,\n         const uint32_t count);',
  params:[
    {n:'dst',t:'LocalTensor&lt;T&gt;',d:'输出 exp 值'},
    {n:'src',t:'LocalTensor&lt;T&gt;',d:'输入 = (score - m_i) · softmaxScale'},
    {n:'count',t:'uint32_t',d:'元素个数'},
  ],
  notes:['源端 <code>tl.exp2(x·log2e)</code> → 昇腾 <code>Exp((x - m)·scale)</code>，底数改写须一致（见 S7 精度对齐）。'],
  ex:'Exp(p, (qk - mNew) * softmaxScale, sTile);'};
const API_REDUCESUM={nm:'ReduceSum',ns:'AscendC',since:'CANN 8.0.RC1',
  brief:'向量单元树形归约求每行和，得到在线 Softmax 的归一化分母 l_i（建议 FP32 累加）。',
  sig:'template &lt;typename T&gt;\nvoid ReduceSum(const LocalTensor&lt;T&gt;&amp; dst,\n               const LocalTensor&lt;T&gt;&amp; src,\n               const LocalTensor&lt;T&gt;&amp; work,\n               const uint32_t count);',
  params:[
    {n:'dst',t:'LocalTensor&lt;T&gt;',d:'每行求和结果 l_i'},
    {n:'src',t:'LocalTensor&lt;T&gt;',d:'exp 后的概率张量'},
    {n:'work',t:'LocalTensor&lt;T&gt;',d:'归约中间缓冲'},
  ],
  notes:['跨 KV 分块在线合并时以 <code>float</code> 累加，避免 FP16 舍入放大（见 S7）。']};
const API_DIV={nm:'Div',ns:'AscendC',since:'CANN 8.0.RC1',
  brief:'向量单元逐元素除法，用于末尾归一化 acc_o /= l_i。',
  sig:'template &lt;typename T&gt;\nvoid Div(const LocalTensor&lt;T&gt;&amp; dst,\n         const LocalTensor&lt;T&gt;&amp; src0,\n         const LocalTensor&lt;T&gt;&amp; src1,\n         const uint32_t count);',
  params:[
    {n:'dst',t:'LocalTensor&lt;T&gt;',d:'归一化后的输出'},
    {n:'src0',t:'LocalTensor&lt;T&gt;',d:'P·V 累加结果 acc_o'},
    {n:'src1',t:'LocalTensor&lt;T&gt;',d:'归一化分母 l_i（按行广播）'},
  ],
  notes:['也可先 <code>Reciprocal</code> 求倒数再 <code>Muls</code>，减少一次向量除法开销。']};
const API_GETBLOCKIDX={nm:'GetBlockIdx',ns:'AscendC',since:'CANN 8.0.RC1',
  brief:'返回当前算力核编号，用于分核 SPMD：源端 SIMT 网格无对应物，改为每核认领 (行块, batch)。',
  sig:'__aicore__ inline int64_t GetBlockIdx();',
  params:[
    {n:'返回',t:'int64_t',d:'当前核索引，范围 <code>[0, blockDim)</code>'},
  ],
  notes:['源端 <code>tl.program_id</code> 的二维 SIMT 网格 → 一维分核，<code>blockDim</code> 由 Tiling 决定。','<b>warp / num_warps 概念整体删除</b>，核内串行执行，多核间并行。'],
  ex:'int64_t core = GetBlockIdx();\nint64_t mBlk = core % mBlocks;\nint64_t bIdx = core / mBlocks;'};

// 计算图节点 → 昇腾算子及其 API 卡片（可含多个相关 API）。
const ASCEND_API={
  loadq:{op:'DataCopy · Q 片上暂存',unit:'mem',apis:[API_DATACOPY]},
  loadkv:{op:'DataCopy · K/V 流式载入',unit:'mem',apis:[API_DATACOPY]},
  qk:{op:'Mmad · Q·Kᵀ Cube GEMM',unit:'cube',apis:[API_MMAD]},
  mask:{op:'Select · 因果 Mask',unit:'vector',apis:[API_SELECT]},
  softmax:{op:'在线 Softmax · 向量归约',unit:'vector',apis:[API_REDUCEMAX,API_EXP,API_REDUCESUM]},
  pv:{op:'Mmad · P·V Cube GEMM',unit:'cube',apis:[API_MMAD]},
  norm:{op:'Div · 输出归一化',unit:'vector',apis:[API_DIV]},
  lmstat:{op:'DataCopy · L/M 统计写回',unit:'mem',apis:[API_DATACOPY]},
  simt:{op:'分核 SPMD · GetBlockIdx（重写）',unit:'risk',apis:[API_GETBLOCKIDX]},
  warp:{op:'Cube Mmad + 分核（删 warp，重写）',unit:'cube',apis:[API_MMAD,API_GETBLOCKIDX]},
};
let lastApiNode=null;
function apiUnitBadge(unit){
  const col=unitColor(unit);
  return `<span class="ah-unit" style="color:${col};background:color-mix(in srgb, ${col} 14%, transparent)"><i style="background:${col}"></i>${UNIT_LABEL[unit]}</span>`;
}
function renderApiCard(a){
  const params=(a.params&&a.params.length)?`<table class="api-ptable"><thead><tr><th>参数</th><th>类型</th><th>说明</th></tr></thead><tbody>${a.params.map(p=>`<tr><td class="pn">${p.n}</td><td class="pt">${p.t}</td><td class="pd">${p.d}</td></tr>`).join('')}</tbody></table>`:'';
  const notes=(a.notes&&a.notes.length)?`<ul class="api-notes">${a.notes.map(n=>`<li>${n}</li>`).join('')}</ul>`:'';
  const ex=a.ex?`<div class="api-ex-h">示例</div><pre class="api-ex">${a.ex}</pre>`:'';
  return `<div class="api-card">
    <div class="apc-h"><span class="nm">${a.nm}</span><span class="ns">${a.ns}</span>${a.since?`<span class="since">${a.since}</span>`:''}</div>
    <div class="apc-brief">${a.brief}</div>
    <pre class="api-sig">${a.sig}</pre>
    ${params}${notes}${ex}
  </div>`;
}
function renderApiDetail(node){
  const pane=document.getElementById('apipane');
  if(!pane) return;
  const key=node||lastApiNode;
  const info=key?ASCEND_API[key]:null;
  if(!info){
    pane.innerHTML=`<div class="api-empty">在 S2「算子映射清单」中点击任意映射行，<br>即可在此查看对应昇腾算子的 API 详情。</div>`;
    return;
  }
  lastApiNode=key;
  const m=OPMAP.find(x=>x.node===key);
  pane.innerHTML=`<div class="api-head">
      <div class="ah-t"><b>${info.op}</b><span>源端 ${m?`<code>${m.cuda}</code>`:''} → 昇腾算子 · 共 ${info.apis.length} 个 API</span></div>
      ${apiUnitBadge(info.unit)}
    </div>
    ${info.apis.map(renderApiCard).join('')}`;
}
// 从映射清单点击某算子 → 在计算图所在面板区打开「API可视化」视图
function openApiPanel(node){
  unlockAnalysisView('api');
  if(!setAnalysisView('api')) return;
  renderApiDetail(node);
}
function syncParseBtn(){const open=currentAnalysisView()==='graph'&&document.getElementById('split')?.classList.contains('analysis-open');
  document.getElementById('parseBtn')?.classList.toggle('on',open);}
function openGraph(){closeCompare();closeTiling();closePipe();setAnalysisView('graph');renderGraph(true);}
function closeGraph(){if(currentAnalysisView()==='graph') closeAnalysisView();else syncParseBtn();}

// 源码高亮联动函数
function highlightCodeLines(startLine, endLine){
  // 清除之前的高亮
  document.querySelectorAll('.ln.hl-node').forEach(el => el.classList.remove('hl-node'));

  // 添加新的高亮
  const codelines = document.getElementById('codelines');
  if(!codelines) return;

  const lines = codelines.querySelectorAll('.ln');
  for(let i = startLine - 1; i < endLine && i < lines.length; i++){
    lines[i].classList.add('hl-node');
  }

  // 滚动到可视区域（用 rect 计算，兼容 sticky gutter 与内边距）
  const targetLine = lines[startLine - 1];
  if(targetLine){
    const codewrap = document.getElementById('codewrap');
    const wrapRect = codewrap.getBoundingClientRect();
    const lineRect = targetLine.getBoundingClientRect();
    // 目标行当前相对滚动容器顶部的偏移 + 已有滚动量
    const lineOffsetInWrap = (lineRect.top - wrapRect.top) + codewrap.scrollTop;
    const scrollTarget = lineOffsetInWrap - codewrap.clientHeight / 3; // 显示在上 1/3 位置
    codewrap.scrollTo({top: Math.max(0, scrollTarget), behavior: 'smooth'});
  }
}

document.getElementById('gclose').onclick=closeGraph;
document.getElementById('tpClose').onclick=closeTiling;
document.getElementById('ppClose').onclick=closePipe;
document.getElementById('parseBtn').onclick=()=>{
  const open=document.getElementById('split').classList.contains('graph-open');
  if(open){closeGraph();}
  else{ openGraph();
    termLine('解析算子 → 生成计算图(手动触发)','d');
    if(state.step===0) notify('已打开计算图','这是 S1 的解析结果预览 · 点「运行 S1」可写入迁移流程','ok');
  }
};

/* ============================ 文件树 / Tabs ============================ */
let hasCpp=false, activeTab='cuda', tilingReady=false;
function renderTree(){
  const t=document.getElementById('tree');
  t.innerHTML=`
   <div class="node"><svg class="fic" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="1.6"><path d="m6 9 6 6 6-6"/></svg><b style="font-weight:600;color:#cfd6ea">openPangu-2.0-flash.MLA</b></div>
   <div class="node ind"><svg class="fic" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="1.5"><path d="m6 9 6 6 6-6"/></svg>ops/</div>
   <div class="node ind2 ${activeTab==='cuda'?'sel':''}" data-open="cuda"><span class="dot-c" style="background:var(--cube)"></span>flash_attention_v2</div>
   ${hasCpp?`<div class="node ind2 ${(activeTab!=='cuda'&&activeTab!=='tiling')?'sel':''}" data-open="cpp"><span class="dot-c" style="background:var(--acc)"></span>flash_mla_decode.cpp<span class="tag new">新</span></div>`:''}
   ${tilingReady?`<div class="node ind2 ${activeTab==='tiling'?'sel':''}" data-open="tiling"><span class="dot-c" style="background:var(--vec)"></span>tiling.h<span class="tag new">新</span></div>`:''}
   <div class="node ind2"><span class="dot-c" style="background:var(--dim2)"></span>mla_ref.py</div>
   <div class="node ind"><svg class="fic" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="1.5"><path d="m9 18 6-6-6-6"/></svg>tests/</div>
   ${hasCpp?`<div class="node ind"><svg class="fic" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="1.5"><path d="m9 18 6-6-6-6"/></svg>build/</div>`:''}
  `;
  t.querySelectorAll('[data-open]').forEach(n=>n.onclick=()=>{
    const d=n.dataset.open;
    if(d==='cuda') switchTab('cuda');
    else if(d==='tiling') openTilingFile();
    else switchTab(codeKey());
  });
}
function codeKey(){ if(state.step>=6)return's6'; if(state.step>=4)return's4'; if(state.step>=3)return's3'; return'cuda'; }
function renderTabs(){
  const tabs=document.getElementById('tabs');
  let html=`<div class="tab ${activeTab==='cuda'?'on':''}" data-t="cuda">
     <span class="dot-c" style="background:var(--cube)"></span>flash_attention_v2.py<span class="x">×</span></div>`;
  if(hasCpp) html+=`<div class="tab ${(activeTab!=='cuda'&&activeTab!=='tiling')?'on':''}" data-t="cpp">
     <span class="dot-c" style="background:var(--acc)"></span>flash_mla_decode.cpp<span class="x">×</span></div>`;
  if(tilingReady) html+=`<div class="tab ${activeTab==='tiling'?'on':''}" data-t="tiling">
     <span class="dot-c" style="background:var(--vec)"></span>tiling.h<span class="x">×</span></div>`;
  tabs.innerHTML=html;
  tabs.querySelectorAll('[data-t]').forEach(el=>el.onclick=()=>{
    const d=el.dataset.t;
    if(d==='cuda') switchTab('cuda');
    else if(d==='tiling') openTilingFile();
    else switchTab(codeKey());
  });
}
function switchTab(key){ closeCompare(); closeTiling(); closePipe(); activeTab = (key==='cuda')?'cuda':key; renderCode(activeTab==='cuda'?'cuda':key); renderTabs(); renderTree();
  document.getElementById('leftPaneH').style.display='none';
  const f=document.getElementById('etbFile'); if(f) f.textContent=(activeTab==='cuda')?'flash_attention_v2.py':'flash_mla_decode.cpp'; }
// 打开 tiling.h 文件 + 右侧 Tiling 可视化
function openTilingFile(){
  closeCompare(); closeGraph(); closePipe();
  activeTab='tiling';
  renderCode('tiling');                 // 左侧显示 tiling.h
  renderTabs(); renderTree();
  document.getElementById('leftPaneH').style.display='none';
  const f=document.getElementById('etbFile'); if(f) f.textContent='tiling.h';
  openTiling();                         // 右侧 Tiling 可视化
}
// S6:定位回 AscendC 源码页签 + 高亮新增流水代码 + 右侧前后对比
function openS6Source(){
  closeGraph(); closeCompare(); closeTiling();
  activeTab='s6';
  renderCode('s6');                     // 左侧显示 AscendC(S6)源码
  renderTabs(); renderTree();
  document.getElementById('leftPaneH').style.display='none';
  const f=document.getElementById('etbFile'); if(f) f.textContent='flash_mla_decode.cpp';
  openPipe();                           // 右侧流水前后对比
  // 高亮并滚动到新增的软件流水代码块(Process 内)
  requestAnimationFrame(()=>flashCodeLines(43,48));
}
// 在左侧代码面板闪烁高亮一段行并滚动
function flashCodeLines(a,b){
  const lns=document.querySelectorAll('#codelines .ln');
  lns.forEach(el=>el.classList.remove('hl-node'));
  for(let i=a-1;i<b && i<lns.length;i++) lns[i]?.classList.add('hl-node');
  if(lns[a-1]){
    const wrap=document.getElementById('codewrap');
    const wr=wrap.getBoundingClientRect(), lr=lns[a-1].getBoundingClientRect();
    wrap.scrollTo({top:Math.max(0,(lr.top-wr.top)+wrap.scrollTop - wrap.clientHeight/3), behavior:'smooth'});
  }
}

/* ============================ 步骤定义 ============================ */
const STEPS=[
 {n:'S1',t:'解析算子',sub:'源码语法树 → 计算图',
  body:`扫描 <code>flash_attention_v2.py</code> 的 <code>_flash_attention_v2_forward_kernel</code>,抽取算子结构并生成计算图。识别为<b>「Flash Attention v2」融合注意力算子</b>:Q·Kᵀ GEMM → 因果 Mask → 在线 Softmax → P·V 累加 → 归一化,沿 KV 序列逐块流式处理并维护 running max/sum,末尾保存 L/M 统计供反向传播。`,
  risk:{h:'检测到源端专属结构',p:'<code>tl.program_id</code> 的 SIMT 网格映射、<code>tl.dot</code> 的 warp 级张量核 (MMA)、指针算术 + mask 的 HBM 分块寻址 —— 均依赖 GPU 线程/warp 硬件模型,昇腾达芬奇架构<b>无直接对应物</b>,须在 S2 决策改写。'},
  log:[['','ascendport migrate ./ops/flash_attention_v2.py','p'],
       ['解析 Triton / Python translation unit … 362 行','d'],
       ['✓ 识别 kernel: _flash_attention_v2_forward_kernel (+ backward)','g'],
       ['  ├─ 融合级别: Q·Kᵀ → Causal Mask → 在线 Softmax → P·V (fused)','d'],
       ['  ├─ 精度: FP16 输入 · FP32 累加 (acc_o/m_i/l_i)','d'],
       ['  └─ 并行粒度: 1 program = 1 (行块 BLOCK_M, batch)','d'],
       ['构建数据流图 … 15 节点 / 18 边','b'],
       ['⚠ 检测 SIMT 专属原语 ×2: program_id 网格, warp 级 tl.dot','r'],
       ['✓ 计算图已生成 → 右侧画布','a']],
  run(){ hasCpp=false; graphMapped=false; renderTree(); renderTabs(); switchTab('cuda'); openGraph(); }},

 {n:'S2',t:'算子映射',sub:'算子 → 达芬奇执行单元',
  body:`把计算图里的每个源端算子映射到目标昇腾算子与达芬奇执行单元。下方清单列出全部映射结果 —— Q·Kᵀ 与 P·V 直接落矩阵单元、因果 Mask 与在线 Softmax 落向量单元,仅 GPU 专属的 <b>SIMT 网格 + warp 级 MMA</b>无对应物、需重写。`,
  choice:{q:'tl.program_id 的 SIMT 网格 + warp 级 tl.dot 如何在昇腾重写?',
    opts:[
     {v:'vector',rec:'推荐',title:'删 warp 概念,分核 SPMD + 向量单元片上归约',
      desc:'tl.dot 交给矩阵单元自管 L0A/L0B,warp 划分整体删除;program_id 网格改为 GetBlockIdx() 分核认领 (行块, batch);在线 Softmax 的 max/exp/sum 用向量单元树形归约。吞吐最高。'},
     {v:'scalar',warn:'不推荐',title:'标量单元逐元素模拟归约',
      desc:'用标量循环逐元素模拟 softmax 归约。语义等价但向量单元闲置,严重浪费算力。'}]},
  log:[['','ascendport map --target davinci','p'],
       ['映射计算图节点 → 执行单元 …','d'],
       ['  Q·Kᵀ (tl.dot)         → 矩阵单元 (Mmad, FP16)','g'],
       ['  因果 Mask + 在线 Softmax → 向量单元','g'],
       ['  P·V 累加 (tl.dot)      → 矩阵单元','g'],
       ['  tl.load/store + mask   → GM↔L1/UB DataCopy','g']],
  logVector:[['  SIMT 网格 + warp → 分核 SPMD + 向量单元片上归约','g'],
       ['✓ 计算图风险节点已更新: 源端专属 → 分核/向量单元','a'],
       ['⚠ 注意:在线 Softmax rescale 次序与 FP16 累加 → S7 校验精度','y']],
  logScalar:[['  SIMT 网格 + warp → 标量单元逐元素模拟','y'],
       ['⚠ 向量单元将闲置,预计算力利用率 < 40% —— 不推荐','r']]},

 {n:'S3',t:'代码生成',sub:'线程模型 → 分核模型',
  body:`生成 AscendC 算子核骨架,并在编辑器<b>左源端 · 右昇腾</b>同屏对比。<code>tl.program_id</code> 的 (行块, batch) 二维网格映射为按算力核分核(<code>GetBlockIdx()</code> 认领);<code>tl.dot</code> 的 warp 级 MMA 改为 Cube 矩阵单元 <code>Mmad</code>;指针算术 + mask 寻址删除,改为核内 KV 分块循环 + <code>DataCopy</code>。`,
  log:[['','ascendport codegen --arch ascend910c','p'],
       ['生成 AscendC kernel 类 …','d'],
       ['✓ 新建 AscendC kernel 类','g'],
       ['  ├─ Init/Process/ComputeAttention/ComputeTile','d'],
       ['  ├─ program_id 网格 → GetBlockIdx() 分核','g'],
       ['  └─ warp 级 tl.dot → Cube Mmad (删 warp 概念)','g'],
       ['插入 2 处 TODO 标记 (S4 内存 / S6 流水)','y'],
       ['✓ 已开启源端 ↔ 昇腾同屏对比视图 (计算图已收起)','a']],
  run(){ hasCpp=true; renderTree(); renderTabs(); openCompare('s3'); }},

 {n:'S4',t:'内存层次映射',sub:'显式片上缓冲 + DataCopy',
  body:`为每处数据流动生成逐级搬运:<code>Q</code> 块走 GM→L1→L0A、<code>K/V</code> 块→L0B、<code>Q·Kᵀ</code> 打分结果落 L0C,因果 Mask 与在线 Softmax 在 UB。<b>关键落差</b>:910C 的 Cube/Vector 分离,<code>L0C</code> 无直连 <code>UB</code>,打分须 <code>L0C→GM→UB</code> 中转。下方清单列出注入到 <code>flash_mla_decode.cpp</code> 的内存层次代码 —— 点击可定位源码并播放数据流动画。`,
  log:[['','ascendport memmap --emit-datacopy','p'],
       ['分析数据生命周期 … Q/K/V/O + L/M 统计','d'],
       ['✓ 注入 InitBuffer × 6 (L1/L0A/L0B/L0C/UB)','g'],
       ['✓ 注入 DataCopy: Q GM→L1(常驻), K|V GM→L1(列循环)','g'],
       ['✓ Mmad→L0C, 在线 Softmax(经 GM→UB 中转)→向量单元','g'],
       ['✓ 新注入代码已在 AscendC 侧高亮','a'],
       ['▶ 已生成硬件数据流动画 → 右侧「数据流」视图','a'],
       ['当前为串行搬运-计算,S6 将做双缓冲重叠','y']],
  run(){ openCompare('s4'); }},

 {n:'S5',t:'自动分块',sub:'贴合缓冲容量的分块',
  body:`沿 KV 序列维搜索分块长度,在 L1/L0/UB 容量约束下最大化片上驻留、最小化回 GM 次数,结果写入 <code>tiling.h</code>(默认打开)。Q 行块(<code>BLOCK_M</code>)常驻片上,K/V 按 <code>BLOCK_N</code> 流式载入,L1 容量需核算。右侧 <b>分块可视化</b>直观呈现:KV 维如何被切成多个分块、各方案的缓冲占用与代价。给出候选,由你确认:`,
  choice:{q:'选择 KV 序列维分块方案:',
    opts:[
     {v:'A',title:'分块长度 = 128',desc:'UB 利用率 61% · 回 GM 次数多 · 周期基线 1.00×'},
     {v:'B',rec:'推荐',title:'分块长度 = 256',desc:'UB 利用率 88% · L0C 恰好容纳 · 周期 0.72× —— 综合最优'},
     {v:'C',warn:'溢出风险',title:'分块长度 = 512',desc:'UB 利用率 103% · 超 L0C 容量 → 触发回退搬运,周期 0.95×'}]},
  log:[['','ascendport tiling --search --constraint l0c,ub','p'],
       ['枚举分块长度 ∈ {128,256,512} …','d'],
       ['  分块长度=128 → UB 61%  周期 1.00×','d'],
       ['  分块长度=256 → UB 88%  周期 0.72×  ★','g'],
       ['  分块长度=512 → UB 103% 溢出回退 0.95×','y']],
  logDone:[['✓ tiling.h 已生成 (分块长度写入 TilingData)','a'],
       ['▶ 已打开 tiling.h 并生成分块可视化 → 右侧','a']],
  run(){ tilingReady=true; renderTree(); renderTabs(); }},

 {n:'S6',t:'流水线编排',sub:'双缓冲重叠',
  body:`把串行的「搬运→计算」重排为软件流水:<b>预取 n+1 ∥ 计算 n ∥ 写回 n-1</b>。<code>TQue</code> 深度 1→2,让 K/V 搬运与矩阵/向量计算重叠 —— 这是开箱性能翻倍的关键。在线 Softmax 直接用向量单元自然 <code>Exp</code>,并保持 <code>acc_o/l_i</code> 的 FP32 累加以稳住 rescale 次序。完成后定位回生成的 AscendC 源码,<b>高亮新增流水代码</b>,右侧给出编排前后的流水时序对比。`,
  log:[['','ascendport pipeline --double-buffer','p'],
       ['构建软件流水 …','d'],
       ['✓ TQue 深度 1→2 (kvL1/cO/ubQK) 双缓冲','g'],
       ['✓ 预取 CopyIn K|V(n+1) 与 Compute(n) 重叠','g'],
       ['✓ 在线 Softmax rescale 保持 FP32 累加 (acc_o/l_i)','g'],
       ['✓ 已定位回 AscendC 源码并高亮新增流水代码','a'],
       ['▶ 流水前后对比 → 右侧面板','a'],
       ['流水气泡 21% → 4%','a']],
  run(){ /* 完成后在回调中定位源码 */ }},

 {n:'S7',t:'精度对齐',sub:'以源端为基准',
  body:`用相同输入跑昇腾 kernel 与源端参考(Triton FA2 / torch 注意力),逐元素比对,生成<b>精度报告</b>(见右侧「精度」视图)。报告会定位精度异常的算子、给出根因与修复方案 —— 一键应用修复即可复测通过。`,
  log:[['','ascendport verify --golden triton --rtol 1e-3','p'],
       ['运行昇腾 kernel 对比源端参考 …','d'],
       ['逐算子比对 … 5 个算子','d'],
       ['  Mmad·Q·Kᵀ 2.4e-4 ✓ · ReduceMax 0 ✓ · DataCopy 0 ✓','g'],
       ['✗ Exp·在线 Softmax: 最大绝对误差 3.1e-2 (超阈值 30×)','r'],
       ['  根因: 在线 rescale 次序 + FP16 累加 → 误差放大','y'],
       ['▶ 精度报告已生成 → 右侧「精度」视图,可查看根因与修复方案','a']],
  run(){ /* 报告在完成回调中打开 */ }},

 {n:'S8',t:'性能剖析与调优',sub:'msProf → aclNN 注册',
  body:`采集硬件流水,定位瓶颈并给出调优建议,最后把算子注册为 <code>aclNN</code> 供图层调用。完成后生成<b>性能报告</b>(见右侧「性能」视图):含 msProf <b>流水泳道图</b>(直译对比优化)、利用率对比与调优建议。相比直译版,端到端 <b>3.1×</b> 加速。`,
  log:[['','ascendport profile --with msprof','p'],
       ['采集算力核流水利用率 …','d'],
       ['  直译版算力核利用率: 31%  (矩阵单元空转,串行搬运)','y'],
       ['  优化版算力核利用率: 82%  (双缓冲重叠)','g'],
       ['  端到端加速: 3.1× · 矩阵单元占用 76% · 搬运隐藏 94%','g'],
       ['✓ 注册 aclNN 算子: aclnnFlashAttentionV2','a'],
       ['▶ 性能报告已生成 → 右侧「性能」视图','a'],
       ['✓ 迁移完成 —— S1→S8 全流程通过','a']],
  run(){ if(!accFixed){ accFixed=true; setProblems(0); } setAicore('82%'); }},
];

/* ============================ 状态机 ============================ */
const state={step:1, choices:{}, viewStep:0}; // 初始 step=1：S1 已完成，按钮执行 S2
function renderProg(){
  const p=document.getElementById('prog'), l=document.getElementById('plabels');
  const viewIndex = Math.max(0, Math.min(STEPS.length-1, Number.isFinite(state.viewStep)?state.viewStep:Math.max(0,state.step-1)));
  p.innerHTML=STEPS.map((s,i)=>`<button class="pstep ${i<state.step?'done':''} ${i===viewIndex?'view':''}" type="button" data-step-index="${i}" title="${s.n} · ${s.t}｜${s.sub}" ${i<state.step?'':'disabled'} aria-label="查看 ${s.n} ${s.t}"></button>`).join('');
  l.innerHTML=STEPS.map((s,i)=>`<button class="plabel ${i===viewIndex?'view':''}" type="button" data-step-index="${i}" title="${s.n} · ${s.t}" ${i<state.step?'':'disabled'}>${s.n}</button>`).join('');
  [...p.querySelectorAll('[data-step-index]'), ...l.querySelectorAll('[data-step-index]')].forEach(el=>{if(el.disabled)return; el.onclick=()=>{
    state.viewStep=Number(el.dataset.stepIndex);
    renderProg();
    renderWizard();
  }});
}
function renderWizard(){
  const sc=document.getElementById('wzContent') || document.getElementById('wzScroll');
  // step 是已执行进度；viewStep 只控制右侧当前查看的阶段。
  const defaultView = Math.max(0, Math.min(STEPS.length-1, state.step-1));
  const viewIndex = Math.max(0, Math.min(STEPS.length-1, Number.isFinite(state.viewStep)?state.viewStep:defaultView));
  const viewedStep = STEPS[viewIndex];
  const viewedDone = viewIndex < state.step;
  const viewedNext = viewIndex === state.step;
  const completedStep = state.step > 0 ? STEPS[Math.min(state.step - 1, STEPS.length - 1)] : null;
  const nextStep = state.step < STEPS.length ? STEPS[state.step] : null;

  let html='';

  if(viewedStep){
    const status = viewedDone ? '已完成' : (viewedNext ? '下一步' : '待执行');
    const icon = viewedDone ? '✓' : (viewedNext ? '▶' : viewedStep.n.replace('S',''));
    const cardTone = viewedDone
      ? 'border-color:var(--ok);background:#48d59708'
      : (viewedNext ? 'border-color:var(--primary);background:var(--state-selected)' : 'background:color-mix(in srgb, var(--surface-2) 64%, transparent)');
    html+=`<div class="stepcard" style="${cardTone}">
      <div class="sc-h"><div class="sc-n" style="${viewedDone?'background:#48d59722;color:var(--ok)':(viewedNext?'background:var(--state-selected);color:var(--primary)':'')}">${icon}</div>
        <div class="sc-t"><b>${viewedStep.n} · ${viewedStep.t}</b><span>${viewedStep.sub} · ${status}</span></div></div>
      <div class="sc-body">${viewedStep.body}`;
    // S1：源端初判的迁移可行性雷达（六维评分）
    if(viewedStep.n==='S1') html+=renderFeasRadar('S1');
    // S2：在主内容区展示"算子映射清单"，直观呈现 CUDA 算子 → 昇腾算子/单元
    if(viewedStep.n==='S2'){ html+=renderOpMapTable(); html+=renderFeasRadar('S2'); }
    // S4：列出注入到 AscendC 源码的内存层次代码（行号 + 代码），点击定位源码 + 播放数据流
    if(viewedStep.n==='S4') html+=renderS4CodeSites();
    if(viewedStep.risk) html+=`<div class="riskcard"><div class="rh">⚠ ${viewedStep.risk.h}</div><p>${viewedStep.risk.p}</p></div>`;
    if(viewedStep.choice && viewIndex <= state.step){
      const sel=state.choices[viewedStep.n]||viewedStep.choice.opts.find(o=>o.rec)?.v||viewedStep.choice.opts[0].v;
      state.choices[viewedStep.n]=sel;
      html+=`<div class="choice"><div class="q">${viewedStep.choice.q}</div>`+
        viewedStep.choice.opts.map(o=>`<div class="opt ${o.v===sel?'on':''}" data-step="${viewedStep.n}" data-v="${o.v}">
          <div class="rd"></div><div class="ot"><b>${o.title} ${o.rec?`<span class="pill rec">${o.rec}</span>`:''}${o.warn?`<span class="pill warn">${o.warn}</span>`:''}</b>
          <span>${o.desc}</span></div></div>`).join('')+`</div>`;
    }
    html+=`</div></div>`;
  }

  if(!nextStep){
    // 全部完成
    html+=`<div class="stepcard" style="border-color:var(--ok);background:#48d5970d">
      <div class="sc-h"><div class="sc-n" style="background:#48d59722;color:var(--ok)">✓</div>
      <div class="sc-t"><b>迁移完成</b><span>S1 → S8 全流程通过</span></div></div>
      <div class="sc-body">Flash Attention v2 算子已迁移为 AscendC 算子并注册为 <code>aclnnFlashAttentionV2</code>。端到端 <b>3.1×</b> 加速,算力核利用率 31%→82%,精度余弦相似度 0.99987。</div></div>`;
  }
  sc.innerHTML=html;
  // S2 映射清单：点击任意行 → 在计算图面板区打开该算子的「API可视化」
  sc.querySelectorAll('.opmap tbody tr[data-node]').forEach(tr=>tr.onclick=()=>{
    sc.querySelectorAll('.opmap tbody tr.on').forEach(x=>x.classList.remove('on'));
    tr.classList.add('on');
    openApiPanel(tr.dataset.node);
  });
  // S4 注入代码清单：点击 → 定位左侧源码 + 播放数据流动画
  sc.querySelectorAll('.s4site[data-i]').forEach(el=>el.onclick=()=>{
    sc.querySelectorAll('.s4site.on').forEach(x=>x.classList.remove('on'));
    el.classList.add('on');
    gotoS4Site(Number(el.dataset.i));
  });
  sc.querySelectorAll('.opt').forEach(o=>o.onclick=()=>{
    state.choices[o.dataset.step]=o.dataset.v;
    // 若在 S2 卡片上改变映射决策，实时反映到计算图
    if(o.dataset.step==='S2'){ graphMapped=(o.dataset.v==='vector'); renderGraph(false); }
    // 若在 S5 卡片上改变 tiling 决策，实时反映到 tiling.h 与可视化
    if(o.dataset.step==='S5'){
      if(document.getElementById('split').classList.contains('tiling-open')) renderTilingViz();
      if(activeTab==='tiling') renderCode('tiling');
    }
    renderWizard();
  });

  // footer
  const btn=document.getElementById('runBtn'), hint=document.getElementById('footHint');
  const allBtn=document.getElementById('runAllBtn');
  if(state.step>=STEPS.length){
    btn.disabled=false; btn.textContent='↻ 重新开始迁移'; btn.className='run ghost';
    if(allBtn){allBtn.disabled=true; allBtn.textContent='全部完成';}
    hint.textContent='全部 8 个阶段已完成';
  } else {
    btn.disabled=false; btn.className='run';
    btn.textContent=`执行${nextStep.t}`;
    if(allBtn){allBtn.disabled=false; allBtn.textContent='全部执行';}
    hint.textContent=`共 8 个阶段 · 当前 ${state.step} / 8 完成`;
  }
  document.getElementById('sbStep').textContent = state.step>=STEPS.length?'✓ 完成':(completedStep?`${completedStep.n} · 已完成`:'准备就绪');
}

/* ---------- terminal ---------- */
let termBusy=false;
let runAllMode=false;
function termLine(txt,cls){const d=document.createElement('div');d.className='tl';
  d.innerHTML=`<span class="t">$ </span><span class="${cls||''}">${txt}</span>`;
  if(cls==='p'){d.innerHTML=`<span class="t">➜ </span><span class="p">${txt}</span>`;}
  document.getElementById('term').appendChild(d);
  document.getElementById('term').scrollTop=1e9;}
function streamLog(lines,done){
  termBusy=true; let i=0; let finished=false;
  const delay=runAllMode?20:160;
  const term=document.getElementById('term');
  const cur=document.createElement('div');cur.className='tl';cur.innerHTML='<span class="cursor"></span>';
  term.appendChild(cur);
  const finish=()=>{ if(finished) return; finished=true; clearInterval(iv);
    if(cur.parentNode) cur.remove(); termBusy=false; done&&done(); };
  const iv=setInterval(()=>{
    if(i>=lines.length){ finish(); return; }
    const [txt,cls]=lines[i]; termLine(txt,cls); i++;
    term.appendChild(cur); term.scrollTop=1e9;
  },delay);
  // 看门狗:无论中途发生什么,流式都会结束并恢复按钮/状态
  setTimeout(finish, lines.length*delay + (runAllMode?160:800));
}

/* ---------- problems ---------- */
let problems=3;
function setProblems(n){problems=n;const c=document.getElementById('probCnt');c.textContent=n;c.className='cnt'+(n>0?' err':'');
  const pl=document.getElementById('probs');
  if(n===0){pl.innerHTML=`<div class="prob" style="color:var(--ok)"><span class="pi">✓</span>无问题 —— 精度对齐通过</div>`;}
}
function initProblems(){
  const pl=document.getElementById('probs');
  pl.innerHTML=`
   <div class="prob"><span class="pi" style="color:var(--risk)">⚠</span><div><div><code style="font-family:var(--mono)">T.exp2</code> 无昇腾对应 —— 在线 softmax 须改自然 <code style="font-family:var(--mono)">T.exp</code>,去掉 log2(e) 预乘,注意数值一致性</div><div class="pf">example_mla_decode.py · 在线 softmax</div></div></div>
   <div class="prob"><span class="pi" style="color:var(--risk)">⚠</span><div><div><code style="font-family:var(--mono)">GemmWarpPolicy.FullCol</code> / <code style="font-family:var(--mono)">use_swizzle</code> 无昇腾对应 —— warp/swizzle 概念删除,改 Cube/Vector 分核 + <code style="font-family:var(--mono)">T.Persistent</code></div><div class="pf">flash_mla_decode · GEMM 调度</div></div></div>
   <div class="prob"><span class="pi" style="color:var(--warn)">⚠</span><div><div>split-KV + combine(flash-decoding)—— 需改 GM workspace 多核归约;<code style="font-family:var(--mono)">L0C→UB</code> 无直连,须经 GM 中转</div><div class="pf">example_mla_decode.py · num_split / combine</div></div></div>`;
}
// S7：精度异常写入问题面板
function setAccProblem(){
  problems=1;const c=document.getElementById('probCnt');c.textContent=1;c.className='cnt err';
  document.getElementById('probs').innerHTML=`
   <div class="prob"><span class="pi" style="color:var(--risk)">⚠</span><div><div>PV/softmax 归约精度异常 —— 最大绝对误差超阈值(exp2→exp 底数改写 + Vector 归约次序 / FP16 累加)</div><div class="pf">flash_mla_decode.cpp · 详见右侧「精度」视图</div></div></div>`;
}

/* ---------- notifications ---------- */
function notify(title,msg,kind){
  const w=document.getElementById('notifs');const d=document.createElement('div');
  d.className='notif '+(kind||'');d.innerHTML=`<b>${title}</b><span>${msg}</span>`;
  w.appendChild(d);setTimeout(()=>{d.style.transition='opacity .4s,transform .4s';d.style.opacity=0;d.style.transform='translateX(20px)';setTimeout(()=>d.remove(),400)},3400);
}
function setAicore(v){document.getElementById('sbAicore').textContent='算力核 '+v;}

/* ---------- panel tabs ---------- */
document.querySelectorAll('.ptab').forEach(t=>t.onclick=()=>{
  const p=t.dataset.p;
  stopFlow();
  activatePanelTab(p);
});
document.querySelectorAll('.analysis-tab[data-analysis]').forEach(t=>t.onclick=()=>{
  const view=t.dataset.analysis;
  if(t.hidden || t.disabled || !setAnalysisView(view)) return;
  if(view==='graph') renderGraph(false);
  if(view==='api') renderApiDetail(lastApiNode);
  if(view==='generated'){
    if(!document.getElementById('diffLines')?.innerHTML.trim()) renderDiff(hasCpp?'s3':'s3');
  }
  if(view==='tiling') renderTilingViz();
  if(view==='flow'){
    if(document.getElementById('flowpane').innerHTML.trim()==='') renderFlow();
  } else {
    stopFlow();
  }
  if(view==='pipeline') renderPipeViz(false);
  if(view==='accuracy') renderAccReport();
  if(view==='performance') renderPerfReport(false);
});
document.getElementById('analysisClose')?.addEventListener('click', closeAnalysisView);

/* ---------- run a step ---------- */
function runStep(){
  if(termBusy) return;
  if(state.step>=STEPS.length){ runAllMode=false; reset(); return; }

  const s=STEPS[state.step]; // 执行下一步
  const btn=document.getElementById('runBtn');
  const allBtn=document.getElementById('runAllBtn');
  btn.disabled=true; btn.textContent=`运行中 ${s.n}`;
  document.querySelector(`.pstep[data-step-index="${state.step}"]`)?.classList.add('cur');
  if(allBtn){allBtn.disabled=true; allBtn.textContent=runAllMode?'连续执行中':'全部执行';}
  document.getElementById('sbStep').textContent=`${s.n} · 运行中…`;
  stopFlow();

  // 切到终端标签,确保用户看到流式日志
  activatePanelTab('term');

  // assemble log with choice enrichment
  let lines=s.log.slice();
  if(s.n==='S2'){ const c=state.choices['S2']||'vector';
    lines=lines.concat(c==='vector'?s.logVector:s.logScalar); }
  if(s.n==='S5'){ const c=state.choices['S5']||'B';
    lines.push([`✓ 选定 sTile = ${c==='A'?128:c==='B'?256:512}`, c==='C'?'y':'g']);
    lines=lines.concat(s.logDone); }

  s.run && s.run();
  streamLog(lines,()=>{
    // graph mapping update after S2
    if(s.n==='S2'){ const c=state.choices['S2']||'vector'; if(c==='vector'){graphMapped=true;renderGraph(false);} }
    state.step++; // 完成后步骤+1
    state.viewStep=Math.min(state.step-1, STEPS.length-1);
    renderProg(); renderWizard();
    // S3：完成后关闭计算图，展示源端↔昇腾同屏对比
    if(s.n==='S3'){ closeGraph(); openCompare('s3'); }
    // S4：左面板切换到 flash_mla_decode.cpp（绿色高亮新增内存行），右侧只显示数据流
    if(s.n==='S4'){
      activeTab='cpp'; renderCode('s4'); renderTabs(); renderTree();
      document.getElementById('leftPaneH').style.display='none';
      const f=document.getElementById('etbFile'); if(f) f.textContent='flash_mla_decode.cpp';
      unlockedAnalysisViews.delete('graph'); unlockedAnalysisViews.delete('generated');
      openFlowPanel(false); // 不自动播放动画
      // 点击绿色高亮代码行 → 跳转到对应含义的数据流步骤（不循环播放）
      document.querySelectorAll('#codelines .ln.hl-new').forEach(el=>{
        el.style.cursor='pointer';
        el.addEventListener('click',()=>{
          const line=parseInt(el.dataset.line); if(isNaN(line)) return;
          stopFlow();
          let found=-1;
          for(let i=0;i<FLOW_STEPS.length;i++){ const c=FLOW_STEPS[i].code; if(line>=c[0]&&line<=c[1]){found=i;break;} }
          if(found>=0){ flowIdx=found; showFlowStep(found); }
        });
      });
    }
    // S5：完成后默认打开 tiling.h 并展示 Tiling 可视化
    if(s.n==='S5'){ openTilingFile(); }
    // S6：完成后定位回 AscendC 源码,高亮新增流水代码并展示前后对比
    if(s.n==='S6'){ openS6Source(); }
    // S7：完成后打开精度报告(异常态),用户可查看根因/修复方案并一键修复
    if(s.n==='S7'){ accFixed=false; setAccProblem(); openAccPanel(); }
    // S8：完成后打开性能报告(泳道图 + 对比)
    if(s.n==='S8'){ openPerfPanel(); }
    const done=state.step>=STEPS.length;
    notify(done?'🎉 迁移完成':`✓ ${s.n} 完成`, done?'MLA Decode 算子已注册为 aclNN 算子':`${s.t} —— ${s.sub}`, done?'ok':'ok');
    if(runAllMode && !done){
      const nextBtn=document.getElementById('runBtn');
      const nextAllBtn=document.getElementById('runAllBtn');
      if(nextBtn){nextBtn.disabled=true; nextBtn.textContent='等待下一阶段';}
      if(nextAllBtn){nextAllBtn.disabled=true; nextAllBtn.textContent='连续执行中';}
      setTimeout(runStep, 30);
      return;
    }
    runAllMode=false;
    renderWizard();
  });
}
function runAllSteps(){
  if(termBusy) return;
  if(state.step>=STEPS.length){ runAllMode=false; reset(); return; }
  runAllMode=true;
  runStep();
}
function reset(){
  runAllMode=false;
  state.step=1; state.choices={}; state.viewStep=0; hasCpp=false; graphMapped=false; activeTab='cuda'; tilingReady=false; accFixed=false; // 重置到 S1 已完成状态
  document.getElementById('term').innerHTML='';
  closeAnalysisView(); stopFlow();
  resetAnalysisUnlocks();
  document.getElementById('flowpane').innerHTML='';
  document.getElementById('accpane').innerHTML='';
  document.getElementById('perfpane').innerHTML='';
  document.getElementById('apipane').innerHTML=''; lastApiNode=null;
  initProblems(); setProblems(3); setAicore('—');
  renderTree(); renderTabs(); renderCode('cuda'); renderProg(); renderWizard();
  openGraph(); // S1 已完成，展示计算图
  termLine('AscendPort 迁移工作台 · 就绪。S1 解析已完成，点击右侧「运行 S2」继续。','d');
}
document.getElementById('runBtn').onclick=runStep;
document.getElementById('runAllBtn').onclick=runAllSteps;

/* ---------- boot ---------- */
initProblems();
renderTree(); renderTabs(); renderCode('cuda'); renderProg(); renderWizard();
resetAnalysisUnlocks();
termLine('AscendPort v0.9 · 目标 Atlas A3 (Ascend 910C) · Ascend C \u0026 PTO','d');
termLine('✓ S1 解析算子已完成 — 已生成计算图，点击任意节点可定位源码。','g');
termLine('点击右侧「运行 S2 · 算子映射」继续迁移流程。','d');
// S1 已完成，打开计算图
openGraph();
