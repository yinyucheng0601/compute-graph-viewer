module ascend_tile_control (
    input wire clk,
    input wire rst_n,
    input wire host_cmd_valid,
    input wire hbm_valid,
    input wire peer_valid,
    input wire [1:0] op_code,
    input wire [7:0] tensor_in,
    input wire [7:0] peer_in,
    output reg dma_req,
    output reg ai_start,
    output reg fusion_start,
    output reg reduce_start,
    output reg tile_valid,
    output reg peer_out_valid,
    output reg [7:0] tile_out
);
    localparam OP_MATMUL = 2'b00;
    localparam OP_FUSION = 2'b01;
    localparam OP_REDUCE = 2'b10;

    reg [1:0] state;
    reg [3:0] step_count;
    reg [7:0] local_tensor;
    reg [7:0] matmul_acc;
    reg [7:0] fusion_value;
    reg [7:0] reduce_value;

    wire matmul_op = host_cmd_valid && (op_code == OP_MATMUL);
    wire fusion_op = host_cmd_valid && (op_code == OP_FUSION);
    wire reduce_op = host_cmd_valid && (op_code == OP_REDUCE);
    wire data_ready = hbm_valid || peer_valid;
    wire step_done = step_count == 4'd9;
    wire [7:0] selected_input = peer_valid ? peer_in : tensor_in;
    wire [7:0] matmul_next = local_tensor + {4'b0000, step_count};
    wire [7:0] fusion_next = matmul_acc ^ 8'h5a;
    wire [7:0] reduce_next = fusion_value + peer_in;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state <= 2'b00;
            step_count <= 4'd0;
            local_tensor <= 8'd0;
            matmul_acc <= 8'd0;
            fusion_value <= 8'd0;
            reduce_value <= 8'd0;
            dma_req <= 1'b0;
            ai_start <= 1'b0;
            fusion_start <= 1'b0;
            reduce_start <= 1'b0;
            tile_valid <= 1'b0;
            peer_out_valid <= 1'b0;
            tile_out <= 8'd0;
        end else begin
            dma_req <= matmul_op && !hbm_valid;
            ai_start <= matmul_op && data_ready;
            fusion_start <= fusion_op || (state == 2'b01 && step_done);
            reduce_start <= reduce_op && peer_valid;
            tile_valid <= 1'b0;
            peer_out_valid <= 1'b0;

            if (host_cmd_valid && data_ready) begin
                local_tensor <= selected_input;
                step_count <= 4'd0;
                state <= op_code;
            end else if (!step_done) begin
                step_count <= step_count + 4'd1;
            end

            if (matmul_op && data_ready) begin
                matmul_acc <= matmul_next;
            end

            if (fusion_op || (state == 2'b01 && step_done)) begin
                fusion_value <= fusion_next;
                tile_out <= fusion_next;
                tile_valid <= 1'b1;
            end

            if (reduce_op && peer_valid) begin
                reduce_value <= reduce_next;
                tile_out <= reduce_next;
                tile_valid <= 1'b1;
                peer_out_valid <= 1'b1;
            end
        end
    end
endmodule
