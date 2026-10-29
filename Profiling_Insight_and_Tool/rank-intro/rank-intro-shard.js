(function(){
  'use strict';

  var page=document.querySelector('.page');
  var visual=document.getElementById('shardVisual');
  if(!page||!visual)return;
  var title=document.getElementById('shardTitle');
  var body=document.getElementById('shardBody');
  var number=document.getElementById('shardStepNumber');
  var heading=document.getElementById('shardHeading');
  var headingScope=document.getElementById('shardHeadingScope');
  var headingShape=document.getElementById('shardHeadingShape');
  var rankRequired=document.getElementById('shardRankRequired');
  var rankQuantifier=document.getElementById('shardRankQuantifier');
  var minRanks=document.getElementById('shardMinRanks');
  var rankBasis=document.getElementById('shardRankBasis');
  var epToolbar=document.getElementById('shardEpToolbar');
  var epControlsHost=document.getElementById('shardEpControls');
  var steps=document.getElementById('shardSteps');
  var prev=document.getElementById('shardPrev');
  var next=document.getElementById('shardNext');
  var stage=-1;
  var selectedEpRank=null;
  var epMode='cut';
  var epDegree=4;
  var DP=8, CP=2, TP=2, PP=4, BATCH=128, SAMPLES_PER_DP=BATCH/DP, MBS=2, GA=8, SEQ=8192, HIDDEN=4096, CELL=256, CP_SEQ=SEQ/CP, TP_H=HIDDEN/TP;
  if(SAMPLES_PER_DP!==MBS*GA)throw new Error('Shard: B must equal DP × MBS × GA');
  var controllers=[];
  var matrixObserver=null;
  var microbatchFocusTimer=null;
  var visualResizeObserver=null;
  var activeTransition=null;
  var previewCache=new Map();
  var numberCaption={name:'1 个数字',foot:'数字（1）',body:'先看张量中的一个 BF16 数值：0.125。下一步，它会缩入矩阵左上角。',fact:''};
  var captions=[
    {name:'1 个张量',foot:'张量（3千万+数字）',body:'先看一个样本：它是一张 S×H = 8192×4096 的张量。S 是纵向的 token 行，H 是横向的 hidden 列。后续步骤会把这种形状的张量组成一个训练 Step 的输入。图中每个正方形小格代表 256×256 个元素。',fact:'单个样本：[8192, 4096]'},
    {name:'输入 BSH · 128个张量',foot:'数据集（128张量）',body:'一个训练 Step 输入 B=128 个样本，每个样本是一张 S×H = 8192×4096 的矩阵。这里逐张画出 B 0～127，共 128 张；小矩阵沿用后续步骤的无网格简化画法。下一步才沿 B 维分配给 DP0–DP7。',fact:'128 × [8192, 4096]；每张矩阵代表 1 个样本'},
    {name:'DP × 8：分样本',foot:'DP（8）',body:'沿 B 维把 128 个样本分给八个 DP 位置。每个 DP 列出来自上一步的 16 张矩阵；下一步再把它们两两合成微批次。向下滚动可依次查看八个 DP。',fact:'每个 DP：16 × [8192, 4096]'},
    {name:'MBS × 2：分微批次',foot:'MBS（2）',body:'每个 DP 的 16 个样本按两个一组，形成 8 个微批次；DP0 是 B 0～1、B 2～3，依次到 B 14～15。合并后 8 组先保持绿色，再将后 7 组置灰，让我们先聚焦第一批矩阵；它们仍会在这个训练 Step 中依次计算。8 个微批都完成后，GA=8 触发一次权重更新。',fact:'每个 DP：8 微批 × 2 样本；GA = 8'},
    {name:'CP × 2：分 token',foot:'CP（2）',body:'聚焦每个 DP 的第 1 个微批次（例如 DP0 的 B 0～1）。这两张矩阵都沿 S 维切成 CP0、CP1；横向切线画在首个微批次上。其余 7 个微批次暂时置灰，之后按相同规则处理。',fact:'每个 DP×CP：当前微批 2 × [4096, 4096]'},
    {name:'TP × 2：分 hidden',foot:'TP（2）',body:'继续看第 1 个微批次。其余 7 组从画面收起；每个 CP 分支沿 H 维切成 TP0、TP1，绿色区域是原矩阵的四分之一。后续微批次会按同样方式经过 CP 和 TP。',fact:'每个 DP×CP×TP：当前微批 2 × [4096, 2048]'},
    {name:'输入 Rank',foot:'Rank（32）',body:'每条 DP→CP→TP 路径对应一个 Rank，共 8×2×2=32 个。图中展示首个微批次的 2 个样本分片；整个训练 Step 中，每个 Rank 会依次处理所属 DP 的 8 个微批次，共 16 个样本。',fact:'32 个 Rank；每 Rank：16 × [4096, 2048]，每微批 2 个'},
    {name:'PP × 4：分段流水线',foot:'PP（4）',body:'PP 沿模型深度把不同层及其计算分到 PP0–PP3 四段；以 48 层为例，每段负责 12 层，并保留 4 个 CP×TP 坐标。每个 DP 位置的 16 个样本分成 8 个微批（每批 2 个样本）。同一微批依次经过四段：前向激活向后传、反向梯度向前传；不同微批错峰占据不同段，让四段形成流水线。',fact:'每个 DP：8 微批 × 2 样本；Rank 总数：DP8 × PP4 × CP2 × TP2 = 128'},
    {name:'EP：分专家',foot:'EP',body:'选择 EP 切出或 EP 正交，再选择 EP=2、4 或 8。切出口径把已有 DP 位置组成专家组，各 DP 位置仍承接不同样本，专家桶会收到组内多个 DP 位置路由来的 token；正交口径为每个 DP 位置增加独立的 EP 坐标。图中的 B 范围表示原始输入归属，不表示专家最终收到的 token 来源。',fact:''}
  ];

  function cells(cp,tp){
    var result=[];
    for(var row=0;row<SEQ;row+=CELL){
      for(var column=0;column<HIDDEN;column+=CELL){
        var owned=(cp==null||Math.floor(row/CP_SEQ)===cp)&&(tp==null||Math.floor(column/TP_H)===tp);
        result.push({row:row,column:column,rowSpan:CELL,columnSpan:CELL,style:'value',tone:owned?'output':'neutral',states:owned?[]:['muted']});
      }
    }
    return result;
  }
  var cellCache={'cpnull-tpnull':cells(null,null)};
  function matrixScene(cp,tp){
    var key='cp'+cp+'-tp'+tp;
    var simplified=stage>=6&&cp!=null&&tp!=null;
    if(!simplified&&!cellCache[key])cellCache[key]=cells(cp,tp);
    var cuts=[];
    if(cp!=null)cuts.push({axis:'rows',at:CP_SEQ,tone:'output',color:'--cp'});
    if(tp!=null)cuts.push({axis:'columns',at:TP_H,tone:'output',color:'--tp'});
    // From the Rank view onward, keep the earlier muted background and owned fill,
    // but omit the unreadable cell lattice. The semantic CP/TP cuts remain.
    return {extent:{rows:SEQ,columns:HIDDEN},axes:{rows:'S · token',columns:'H · hidden'},cells:simplified?[{row:0,column:0,rowSpan:SEQ,columnSpan:HIDDEN,style:'value',tone:'neutral',states:['muted']},{row:cp*CP_SEQ,column:tp*TP_H,rowSpan:CP_SEQ,columnSpan:TP_H,style:'value',tone:'output',states:[]}]:cellCache[key],cuts:cuts};
  }

  function previewKey(){return document.documentElement.getAttribute('data-theme')+'@'+(window.devicePixelRatio||1);}
  function previewImages(){
    var key=previewKey();
    if(previewCache.has(key))return previewCache.get(key);
    var promise=new Promise(function(resolve){
      var hosts=[],samples=[],images={};
      for(var cp=0;cp<CP;cp++)for(var tp=0;tp<TP;tp++){
        var host=document.createElement('div');
        host.className='shard-fragment-host shard-preview-source';
        var canvas=document.createElement('canvas');
        host.appendChild(canvas);document.body.appendChild(host);
        hosts.push(host);
        samples.push({key:cp+'-'+tp,canvas:canvas,controller:window.PtoMatrixCanvas.render(canvas,matrixScene(cp,tp),{showAxes:false,showGrid:false,interactive:false,showTooltip:false,minZoom:.0001,padding:{top:2,right:2,bottom:2,left:2},cellStrokeAlpha:0})});
      }
      // The shared renderer paints on the first frame; its cut overlay paints on the second.
      requestAnimationFrame(function(){requestAnimationFrame(function(){requestAnimationFrame(function(){
        samples.forEach(function(sample){
          var canvas=sample.canvas,overlay=canvas.parentElement.querySelector('.rank-matrix-canvas-compat');
          var image=document.createElement('canvas');image.width=canvas.width;image.height=canvas.height;
          var ctx=image.getContext('2d');ctx.drawImage(canvas,0,0);
          if(overlay)ctx.drawImage(overlay,0,0,image.width,image.height);
          images[sample.key]=image.toDataURL();
          sample.controller.destroy();
        });
        hosts.forEach(function(host){host.remove();});
        resolve(images);
      });});});
    });
    previewCache.set(key,promise);
    return promise;
  }

  function mountPreviews(){
    var pipelineView=visual.querySelector('.shard-pipeline');
    if(!pipelineView||!window.PtoMatrixCanvas)return;
    var key=previewKey();
    previewImages().then(function(images){
      if(!pipelineView.isConnected||key!==previewKey())return;
      pipelineView.querySelectorAll('img[data-shard-preview]').forEach(function(img){
        img.src=images[img.dataset.shardPreview];
      });
    });
  }

  function destroy(){
    if(matrixObserver){matrixObserver.disconnect();matrixObserver=null;}
    if(microbatchFocusTimer){clearTimeout(microbatchFocusTimer);microbatchFocusTimer=null;}
    controllers.forEach(function(c){c.destroy();});controllers=[];
  }
  function scheduleMicrobatchFocus(delay){
    if(microbatchFocusTimer)clearTimeout(microbatchFocusTimer);
    microbatchFocusTimer=setTimeout(function(){
      microbatchFocusTimer=null;
      if(stage!==3)return;
      var scene=visual.querySelector('.shard-tree[data-stage="3"]');
      if(!scene)return;
      scene.classList.add('is-focused');
      scene.querySelectorAll('.shard-mbs-item.is-muted canvas').forEach(function(canvas){
        canvas.setAttribute('aria-label',canvas.getAttribute('aria-label').replace('；随后置灰','；暂不聚焦'));
      });
    },delay);
  }
  function sizeShardRows(){
    if(stage<4||stage>5)return;
    var treeView=visual.querySelector('.shard-tree');
    if(!treeView)return;
    var rowsOnScreen=stage===5?4.5:2.5;
    var minimum=stage===4?160:84;
    var availableHeight=Math.min(visual.clientHeight,Math.max(320,(window.innerHeight||visual.clientHeight)-120));
    treeView.style.setProperty('--leaf-height',Math.max(minimum,Math.round((availableHeight-24)/rowsOnScreen))+'px');
  }
  function mountCanvases(){
    if(!window.PtoMatrixCanvas)return;
    function mount(canvas){
      if(canvas.dataset.shardMounted)return;
      canvas.dataset.shardMounted='true';
      var cp=canvas.hasAttribute('data-cp')?Number(canvas.dataset.cp):null;
      var tp=canvas.hasAttribute('data-tp')?Number(canvas.dataset.tp):null;
      var context=canvas.getContext('2d');
      if(!context.__shardCornerScale){
        // MatrixCanvas uses a fixed 4px outer radius; keep it proportional as Shard previews shrink.
        var arcTo=context.arcTo;
        context.arcTo=function(x1,y1,x2,y2,radius){
          var scaled=Math.max(.35,canvas.getBoundingClientRect().height*4/146);
          return arcTo.call(this,x1,y1,x2,y2,radius===4?Math.min(radius,scaled):radius);
        };
        context.__shardCornerScale=true;
      }
      controllers.push(window.PtoMatrixCanvas.render(canvas,matrixScene(cp,tp), {ariaLabel:canvas.getAttribute('aria-label'),showAxes:false,showGrid:stage<6,interactive:false,showTooltip:false,minZoom:.0001,padding:{top:2,right:2,bottom:2,left:2},cellStrokeAlpha:stage<6?.12:0}));
      canvas.setAttribute('role','img');
      canvas.tabIndex=-1;
    }
    var canvases=visual.querySelectorAll('canvas[data-shard-matrix]');
    if(!canvases.length)return;
    if((stage===3||stage===4||(stage===8&&epMode==='ortho'))&&window.IntersectionObserver){
      var observer=new IntersectionObserver(function(entries){
        if(matrixObserver!==observer)return;
        entries.forEach(function(entry){if(entry.isIntersecting){observer.unobserve(entry.target);mount(entry.target);}});
      },{root:visual,rootMargin:'160px 0px'});
      matrixObserver=observer;
      var viewport=visual.getBoundingClientRect();
      canvases.forEach(function(canvas){
        var rect=canvas.getBoundingClientRect();
        if(rect.bottom>=viewport.top-160&&rect.top<=viewport.bottom+160&&rect.right>=viewport.left&&rect.left<=viewport.right)mount(canvas);
        else matrixObserver.observe(canvas);
      });
    }else canvases.forEach(mount);
  }
  function sampleLabel(b){return 'B '+b;}
  function batchRange(first,last){return sampleLabel(first)+'～'+last;}
  function sampleRange(dp){var first=dp*SAMPLES_PER_DP;return batchRange(first,first+SAMPLES_PER_DP-1);}
  function microRange(dp,micro){var first=dp*SAMPLES_PER_DP+micro*MBS;return batchRange(first,first+MBS-1);}
  function miniMatrix(b){
    return '<div class="shard-input-matrix" data-shard-sample="'+b+'" role="img" aria-label="'+sampleLabel(b)+'，S 8192 行、H 4096 列"><span class="shard-input-caption">'+sampleLabel(b)+'</span><span class="shard-input-mini" aria-hidden="true"></span></div>';
  }
  function singleTensor(){
    return '<div class="shard-single-tensor"><div class="shard-single-caption">一个张量 <strong>[S, H] = [8192, 4096]，3千3百多万个数字</strong></div><div class="shard-single-chart"><span class="shard-axis-s">S ↓<br>8192</span><div class="shard-single-host"><canvas data-shard-matrix="single" aria-label="单个样本的张量，S 8192 行、H 4096 列；每个小格对应 256 行、256 列"></canvas></div><span class="shard-axis-h">H → 4096</span></div></div>';
  }
  function numberIntro(){
    return '<div class="shard-number-intro"><div class="shard-number-cell" role="img" aria-label="张量中的 BF16 数值 0.125"><span>0.125</span></div></div>';
  }
  function input(){
    var html='<div class="shard-input-group" role="group" aria-label="输入 BSH，128 个样本张量"><div class="shard-input-row">';
    for(var b=0;b<BATCH;b++)html+=miniMatrix(b);
    return html+'</div></div>';
  }
  function dpContents(dp){
    var first=dp*SAMPLES_PER_DP;
    var html='<strong>DP'+dp+'</strong><div class="shard-dp-mini-list">';
    for(var b=first;b<first+SAMPLES_PER_DP;b++)html+=miniMatrix(b);
    return html+'</div>';
  }
  function microbatchContents(dp){
    var html='<strong>DP'+dp+'</strong><span>'+sampleRange(dp)+'</span><div class="shard-mbs-grid">';
    for(var micro=0;micro<GA;micro++){
      var range=microRange(dp,micro),muted=micro>0;
      html+='<div class="shard-mbs-item'+(muted?' is-muted':'')+'"><span>'+range+'</span><div class="shard-mbs-host"><canvas data-shard-matrix="microbatch" data-fragment-key="b'+dp+'-mb'+micro+'"'+(stage===4?' data-keep-visible="true"':'')+' aria-label="DP'+dp+' 第 '+(micro+1)+' 个微批次，'+range+'，2 个样本'+(muted?(stage===4?'；暂不聚焦':'；随后置灰'):'；当前聚焦')+'"></canvas>'+(stage===4&&micro===0?'<i class="shard-mbs-cp-cut" aria-hidden="true"></i>':'')+'</div></div>';
    }
    return html+'</div>';
  }
  function node(col,start,span,kind,html,added){
    return '<div class="shard-tree-node is-'+kind+(added?' is-new':'')+'" style="grid-column:'+col+';grid-row:'+start+' / span '+span+'">'+html+'</div>';
  }
  function brace(col,start,span,label,added,axis){
    // The DP brace ends at the centers of DP0 and DP7, not one DP group inward.
    var marginRows=axis==='dp'?span/(DP*2):span/4;
    return '<div class="shard-tree-brace is-'+axis+(added?' is-new':'')+'" style="grid-column:'+col+';grid-row:'+start+' / span '+span+';--brace-margin-rows:'+marginRows+'" role="img" aria-label="'+label+'"><svg viewBox="0 0 28 100" preserveAspectRatio="none" aria-hidden="true"><path d="M26 0 C12 0 12 24 12 34 C12 44 9 50 2 50"/><path d="M2 50 C9 50 12 56 12 66 C12 76 12 100 26 100"/></svg></div>';
  }
  function source(){
    return '<strong>输入 BSH</strong><span>'+batchRange(0,BATCH-1)+'</span><small>[128, 8192, 4096]</small>';
  }
  function fragment(b,cp,tp){
    var key='b'+b+'-mb0'+(cp==null?'':'-cp'+cp)+(tp==null?'':'-tp'+tp);
    var rows=cp==null?SEQ:CP_SEQ,columns=tp==null?HIDDEN:TP_H;
    var label=microRange(b,0)+' 当前微批次的 2 个样本，'+(stage>=6?'切分线标出':'完整 32×16 正方形网格；持有')+'每个样本 S '+rows+' 行、H '+columns+' 列的分片';
    var graphic=stage>=7?'<img data-shard-preview="'+cp+'-'+tp+'" alt="'+label+'" decoding="async">':'<canvas data-shard-matrix="fragment" data-fragment-key="'+key+'"'+(cp==null?'':' data-cp="'+cp+'"')+(tp==null?'':' data-tp="'+tp+'"')+' aria-label="'+label+'"></canvas>';
    return '<div class="shard-fragment"><span class="shard-fragment-label">'+microRange(b,0)+'</span><div class="shard-fragment-host">'+graphic+'</div></div>';
  }
  function pair(dp,cp,tp){return '<div class="shard-fragment-pair">'+fragment(dp,cp,tp)+'</div>';}
  function rankCard(rank,dp,cp,tp,pp,row,ep){
    var local=(dp*CP+cp)*TP+tp;
    var placement=row==null?'':' style="grid-column:7;grid-row:'+row+'"';
    return '<div class="shard-rank-slot"'+placement+' data-rank="'+rank+'" data-dp="'+dp+'" data-cp="'+cp+'" data-tp="'+tp+'" data-pp="'+(pp==null?0:pp)+'" data-ep="'+(ep==null?0:ep)+'" role="group" aria-label="Rank '+rank+'，DP'+dp+'，CP'+cp+'，TP'+tp+'，当前展示 '+microRange(dp,0)+' 的对应分片；整个 Step 依次处理 '+sampleRange(dp)+' 共 16 个样本'+(stage===8&&epMode==='cut'?'；专家计算还接收同组其他 DP 位置路由的 token':'')+'"><div class="shard-rank-label"><strong>R'+rank+'</strong><span>TP'+tp+'</span></div><div class="shard-tree-node is-rank shard-rank-card" data-rank-local="'+local+'"'+(pp==null?'':' data-pp="'+pp+'"')+'>'+pair(dp,cp,tp)+'</div></div>';
  }
  function tree(){
    var count=stage<=3?DP:stage===4?DP*CP:DP*CP*TP;
    var html='<div class="shard-tree" data-stage="'+stage+'" style="--tree-rows:'+count+'">';
    html+=node(1,1,count,'root',source(),false);
    html+=brace(2,1,count,'沿 B 维分成 DP0 至 DP7',stage===2,'dp');
    for(var dp=0;dp<DP;dp++){
      var dpSpan=count/DP,dpStart=dp*dpSpan+1;
      html+=node(3,dpStart,dpSpan,'dp',stage===2?dpContents(dp):stage<=4?microbatchContents(dp):'<strong>DP'+dp+'</strong><span>'+sampleRange(dp)+'</span><small>8 微批 × 2 样本</small>',false);
      if(stage<4)continue;
      html+=brace(4,dpStart,dpSpan,'DP'+dp+' 的首微批沿 S 维分成 CP0 和 CP1',stage===4,'cp');
      for(var cp=0;cp<2;cp++){
        var cpSpan=count/(DP*CP),cpStart=dpStart+cp*cpSpan;
        html+=node(5,cpStart,cpSpan,'cp','<strong>CP'+cp+'</strong><span>S['+(cp*CP_SEQ)+'~'+((cp+1)*CP_SEQ-1)+']</span>'+(stage===4?pair(dp,cp,null):'<small>首微批 2 × [4096, 4096]</small>'),stage===4);
        if(stage<5)continue;
        html+=brace(6,cpStart,cpSpan,'DP'+dp+' CP'+cp+' 沿 H 维分成 TP0 和 TP1',stage===5,'tp');
        for(var tp=0;tp<2;tp++){
          var rank=(dp*CP+cp)*TP+tp,rankStart=cpStart+tp;
          if(stage===6)html+=rankCard(rank,dp,cp,tp,null,rankStart);
          else html+=node(7,rankStart,1,'tp','<strong>TP'+tp+'</strong><span>H['+(tp*TP_H)+'~'+((tp+1)*TP_H-1)+']</span>'+pair(dp,cp,tp),stage===5);
        }
      }
    }
    return html+'</div>';
  }
  function pipeline(){
    var orthogonal=stage===8&&epMode==='ortho';
    var html='<div class="shard-pipeline'+(orthogonal?' is-ep-ortho':'')+'" data-stage="'+stage+'"><div class="shard-pp-guide">';
    for(var pp=0;pp<PP;pp++){
      html+='<div class="shard-pp-heading"><strong>PP'+pp+'</strong><span>L'+pp*12+'–'+(pp*12+11)+'</span></div>';
    }
    html+='<div class="shard-pp-flow">每个 DP 的 8 个微批依次经过 PP0 → PP1 → PP2 → PP3</div></div>';
    for(var dp=0;dp<DP;dp++){
      if(orthogonal)html+='<div class="shard-dp-group" role="group" aria-label="DP'+dp+'，承接 '+sampleRange(dp)+' 共 16 个样本，包含 EP0 至 EP'+(epDegree-1)+'"><div class="shard-dp-group-heading"><strong>DP'+dp+'</strong><span>'+sampleRange(dp)+'</span><small>EP0–EP'+(epDegree-1)+'</small></div>';
      var lanes=orthogonal?epDegree:1;
      for(var lane=0;lane<lanes;lane++){
      var ep=epMode==='cut'?dp%epDegree:lane;
      var expertStart=ep*(64/epDegree),expertEnd=expertStart+64/epDegree-1;
      var heading=orthogonal?'<div class="shard-dp-heading"><strong>EP'+ep+'</strong><small>E'+expertStart+'–'+expertEnd+'</small></div>':'<div class="shard-dp-heading"><strong>DP'+dp+'</strong><span>'+sampleRange(dp)+'</span><small>EP'+ep+' · E'+expertStart+'–'+expertEnd+'</small></div>';
      html+='<div class="shard-dp-lane" role="group" aria-label="DP'+dp+(stage===8?'，EP'+ep:'')+' 的 16 个 Rank">'+heading+'<div class="shard-dp-columns">';
      for(var pp=0;pp<PP;pp++){
        html+='<div class="shard-dp-column">';
        for(var cp=0;cp<CP;cp++){
          html+='<div class="shard-cp-pair"><span class="shard-cp-label">CP'+cp+'</span><div class="shard-tp-pair">';
          for(var tp=0;tp<TP;tp++){
            var rank=epMode==='ortho'&&stage===8?pp*(DP*epDegree*CP*TP)+(dp*epDegree+ep)*CP*TP+cp*TP+tp:pp*(DP*CP*TP)+(dp*CP+cp)*TP+tp;
            html+=rankCard(rank,dp,cp,tp,pp,null,ep);
          }
          html+='</div></div>';
        }
        html+='</div>';
      }
      html+='</div></div>';
      }
      if(orthogonal)html+='</div>';
    }
    return html+'<div class="shard-pipeline-tail">'+pipelineTail()+'</div></div>';
  }
  function pipelineTail(){return stage===8?'Router 按专家位置在所选 EP 组内分发 token，计算结果返回源 Rank':'每个 DP 的 8 个微批依次流经 PP0→PP3；前向传激活，反向传梯度';}
  function rankCountGuidance(){
    var total=DP*CP*TP*PP*(epMode==='ortho'?epDegree:1);
    var description=epMode==='cut'?'EP '+epDegree+' 从 DP '+DP+' 中切出，形成 '+(DP/epDegree)+' 个专家参数数据副本（EDP），每个 EP 组跨 '+epDegree+' 个 DP 位置；Rank 总数仍为 '+(DP*CP*TP*PP)+'。':'EP '+epDegree+' 与 DP '+DP+' 正交：'+DP+' 个 DP 副本各有 '+epDegree+' 个 EP 位置，Rank 总数乘以 '+epDegree+'。';
    return '<p><strong>当前拓扑：</strong>'+description+'</p><p><strong>输入与更新：</strong>两种 EP 口径均由 '+DP+' 个 DP 位置分别承接 '+SAMPLES_PER_DP+' 个样本；每个 DP 位置每微批 '+MBS+' 个样本，累计 '+GA+' 个微批后，完成全局 B='+BATCH+' 的一个训练 Step 并更新一次权重。</p><p><strong>单个作业：</strong>DP '+DP+' × CP '+CP+' × TP '+TP+' × PP '+PP+(epMode==='ortho'?' × EP '+epDegree:'')+' = '+total+' 个 Rank。固定这些并行度时，每个 Rank 都有明确坐标。</p>';
  }
  function epControls(){
    return '<div class="c4s"><span class="lb">EP 口径</span><div class="ctl choice" role="group" aria-label="EP 口径">'+
      '<button type="button" data-shard-ep-mode="cut" aria-pressed="'+(epMode==='cut')+'">EP 切出</button><button type="button" data-shard-ep-mode="ortho" aria-pressed="'+(epMode==='ortho')+'">EP 正交（EP 切入）</button></div></div>'+
      '<div class="c4s"><span class="lb">EP 并行度（64个专家）</span><div class="ctl choice" role="group" aria-label="EP 并行度（64个专家）">'+[2,4,8].map(function(degree){return '<button type="button" data-shard-ep-degree="'+degree+'" aria-pressed="'+(epDegree===degree)+'"'+(epMode==='cut'&&degree>DP?' disabled title="切出口径的 EP 不能超过 DP='+DP+'"':'')+'>EP '+degree+'</button>';}).join('')+'</div></div>';
  }
  function epGroupKey(slot){
    return [slot.dataset.pp,slot.dataset.cp,slot.dataset.tp,epMode==='cut'?Math.floor(Number(slot.dataset.dp)/epDegree):slot.dataset.dp].join(':');
  }
  function updateEpSelection(){
    var pipelineView=visual.querySelector('.shard-pipeline');
    if(!pipelineView)return;
    var slots=Array.from(pipelineView.querySelectorAll('.shard-rank-slot'));
    var chosen=slots.find(function(slot){return Number(slot.dataset.rank)===selectedEpRank;});
    var key=chosen?epGroupKey(chosen):null;
    var members=key?slots.filter(function(slot){return epGroupKey(slot)===key;}):[];
    slots.forEach(function(slot){
      var rank=Number(slot.dataset.rank);
      var selected=stage===8&&rank===selectedEpRank;
      var paired=stage===8&&key===epGroupKey(slot)&&!selected;
      slot.classList.toggle('is-ep-selected',selected);
      slot.classList.toggle('is-ep-partner',paired);
      if(!slot.dataset.rankDescription)slot.dataset.rankDescription=slot.getAttribute('aria-label');
      if(stage===8){
        slot.setAttribute('role','button');
        slot.tabIndex=0;
        slot.setAttribute('aria-pressed',String(selected));
        slot.setAttribute('aria-label',slot.dataset.rankDescription+'；'+(selected?'当前选中，EP 组：'+members.map(function(item){return 'R'+item.dataset.rank;}).join('、'):paired?'与当前选中 R'+selectedEpRank+' 同属 EP 组':'点选查看 EP 组'));
      }else{
        slot.setAttribute('role','group');
        slot.removeAttribute('tabindex');
        slot.removeAttribute('aria-pressed');
        slot.setAttribute('aria-label',slot.dataset.rankDescription);
      }
    });
    var readout=document.getElementById('shardEpReadout');
    if(readout)readout.textContent=chosen?'R'+selectedEpRank+' 的 EP 组：'+members.map(function(slot){return 'R'+slot.dataset.rank;}).join(' · '):'点选任意 Rank，查看完整 EP 组。';
  }
  function render(){
    destroy();
    var current=stage<0?numberCaption:captions[stage];
    number.textContent=String(stage+2).padStart(2,'0')+' / '+String(captions.length+1).padStart(2,'0');
    heading.hidden=stage<0;
    var factors=[],rankCount=1;
    if(stage>=2){factors.push('DP '+DP);rankCount*=DP;}
    if(stage>=4){factors.push('CP 2');rankCount*=CP;}
    if(stage>=5){factors.push('TP 2');rankCount*=TP;}
    if(stage>=7){factors.push('PP 4');rankCount*=PP;}
    if(stage===8&&epMode==='ortho'){factors.push('EP '+epDegree);rankCount*=epDegree;}
    headingScope.textContent=stage<0?'':stage===0?'1 个样本的张量':'一个训练 Step 的输入';
    headingShape.innerHTML=stage<0?'':stage===0?'<strong>[S, H]</strong> = <strong>[8192, 4096]</strong>，3千3百多万个数字':'<strong>[B, S, H]</strong> = <strong>[128, 8192, 4096]</strong>';
    rankRequired.hidden=stage<=0;
    rankQuantifier.textContent=stage===8?'只能用':'需要至少';
    minRanks.textContent=String(rankCount);
    rankBasis.textContent='（'+(factors.length?factors.join(' × '):'尚未切分')+(stage===8&&epMode==='cut'?'；EP '+epDegree+' 从 DP 切出':'')+'）';
    title.textContent=stage===8?'EP × '+epDegree+'：'+(epMode==='cut'?'从 DP 切出':'与 DP 正交'):current.name;
    var experts=Array.from({length:epDegree},function(_,ep){var first=ep*64/epDegree;return 'EP'+ep+'：E'+first+'–'+(first+64/epDegree-1);}).join('；');
    body.innerHTML=stage===8?'<p>'+current.body+'</p>'+rankCountGuidance()+'<p>每个 MoE 层有 64 个专家，ETP=1；每个 EP 位置持有 '+(64/epDegree)+' 个：'+experts+'。Dense 层沿 DP×CP×TP 运行。</p><p>'+pipelineTail()+'</p>':'<p>'+current.body+'</p>'+(current.detail?'<p>'+current.detail+'</p>':'')+(current.fact?'<div class="shard-fact">'+current.fact+'</div>':'');
    epToolbar.hidden=stage!==8;
    epControlsHost.innerHTML=stage===8?epControls():'';
    visual.dataset.step=String(stage);
    visual.innerHTML=stage>=7?pipeline():stage<0?numberIntro():stage===0?singleTensor():stage===1?input():tree();
    if(stage===2)visual.scrollTop=0;
    updateEpSelection();
    var stageColors=['--success','--fg','--success','--dp','--success','--cp','--tp','--fg','--pp','--ep'];
    steps.innerHTML=[numberCaption].concat(captions).map(function(item,i){var step=i-1;var foot=i===captions.length?'EP（'+epDegree+'）':item.foot;return '<button type="button" class="'+(step===stage?'cur':step<stage?'done':'')+'" style="--c:var('+stageColors[i]+')" data-shard-step="'+step+'" title="'+String(i+1).padStart(2,'0')+' · '+item.name+'"'+(step===stage?' aria-current="step"':'')+'><span class="lbl">'+String(i+1).padStart(2,'0')+' · '+foot+'</span><span class="bar"></span></button>';}).join('');
    prev.disabled=stage<0;
    next.disabled=stage===captions.length-1;
    sizeShardRows();
    mountCanvases();
    if(stage===3&&!visual.classList.contains('is-transitioning'))scheduleMicrobatchFocus(400);
    if(stage>=7)mountPreviews();
  }
  function cancelTransition(){
    if(!activeTransition)return;
    activeTransition.timers.forEach(clearTimeout);
    if(activeTransition.cleanup)activeTransition.cleanup();
    activeTransition.animations.forEach(function(animation){animation.cancel();});
    activeTransition.nodes.forEach(function(node){node.remove();});
    visual.querySelectorAll('.shard-tree-node.is-new,.shard-tree-brace.is-new').forEach(function(node){node.classList.remove('is-new');});
    activeTransition=null;
    visual.classList.remove('is-transitioning','is-transition-visible','is-transitioning-cp','is-transitioning-number','is-transitioning-input','is-transitioning-input-dp');
  }
  function flyBetween(element,from,to,duration,delay){
    return element.animate([
      {transform:'translate(0, 0) scale(1)'},
      {transform:'translate('+(to.left-from.left)+'px, '+(to.top-from.top)+'px) scale('+(to.width/from.width)+', '+(to.height/from.height)+')'}
    ],{duration:duration,delay:delay||0,easing:'cubic-bezier(.2,.72,.2,1)',fill:'both'});
  }
  function transitionNumberToTensor(){
    var source=visual.querySelector('.shard-number-cell');
    if(!source){stage=0;render();return;}
    var from=source.getBoundingClientRect();
    var piece=source.cloneNode(true);
    piece.classList.add('shard-flying-number');
    piece.removeAttribute('role');piece.setAttribute('aria-hidden','true');
    piece.style.left=from.left+'px';piece.style.top=from.top+'px';
    piece.style.width=from.width+'px';piece.style.height=from.height+'px';
    document.body.appendChild(piece);
    var state={nodes:[piece],timers:[],animations:[]};
    activeTransition=state;
    stage=0;
    visual.classList.add('is-transitioning-number');
    render();
    var tensor=visual.querySelector('.shard-single-tensor');
    var canvas=visual.querySelector('.shard-single-host canvas');
    tensor.style.opacity='0';
    state.cleanup=function(){
      tensor.style.animation='none';
      tensor.style.removeProperty('opacity');
    };
    var area=matrixArea(canvas);
    var to={left:area.left,top:area.top,width:area.width/(HIDDEN/CELL),height:area.height/(SEQ/CELL)};
    state.animations.push(piece.animate([
      {left:from.left+'px',top:from.top+'px',width:from.width+'px',height:from.height+'px'},
      {left:to.left+'px',top:to.top+'px',width:to.width+'px',height:to.height+'px'}
    ],{duration:850,easing:'cubic-bezier(.2,.72,.2,1)',fill:'both'}));
    state.animations.push(piece.firstElementChild.animate([{opacity:1},{opacity:0}],{duration:450,fill:'both'}));
    state.animations.push(tensor.animate([{opacity:0},{opacity:0,offset:.52},{opacity:1}],{duration:850,fill:'both'}));
    state.timers.push(setTimeout(function(){if(activeTransition===state)cancelTransition();},860));
  }
  function transitionToInput(){
    var source=visual.querySelector('.shard-single-host canvas');
    if(!source){stage=1;render();return;}
    var from=source.getBoundingClientRect();
    var piece=document.createElement('div');
    piece.className='shard-flying-tensor';
    piece.style.left=from.left+'px';piece.style.top=from.top+'px';
    piece.style.width=from.width+'px';piece.style.height=from.height+'px';
    var snapshot=document.createElement('canvas');
    snapshot.width=source.width;snapshot.height=source.height;
    snapshot.getContext('2d').drawImage(source,0,0);
    piece.appendChild(snapshot);
    var mini=document.createElement('span');
    mini.className='shard-flying-tensor-mini';
    piece.appendChild(mini);
    document.body.appendChild(piece);
    var state={nodes:[piece],timers:[],animations:[]};
    activeTransition=state;
    stage=1;
    visual.classList.add('is-transitioning-input');
    render();
    var inputRow=visual.querySelector('.shard-input-row');
    var targets=Array.from(visual.querySelectorAll('.shard-input-row .shard-input-matrix'));
    targets.forEach(function(target){target.style.opacity='0';});
    state.cleanup=function(){
      inputRow.style.animation='none';
      targets.forEach(function(target){target.style.removeProperty('opacity');});
    };
    var to=targets[0].querySelector('.shard-input-mini').getBoundingClientRect();
    state.animations.push(flyBetween(piece,from,to,720,0));
    state.animations.push(snapshot.animate([{opacity:1,offset:0},{opacity:1,offset:.6},{opacity:0,offset:1}],{duration:720,fill:'both'}));
    state.animations.push(mini.animate([{opacity:0,offset:0},{opacity:0,offset:.6},{opacity:1,offset:1}],{duration:720,fill:'both'}));
    state.timers.push(setTimeout(function(){
      if(activeTransition!==state)return;
      targets[0].style.opacity='1';
      piece.remove();
      targets.slice(1).forEach(function(target,index){
        var b=index+1,delay=Math.floor(b/16)*75+(b%16)*16;
        state.animations.push(target.animate([
          {opacity:0,transform:'scale(.65)'},
          {opacity:1,transform:'scale(1)'}
        ],{duration:270,delay:delay,easing:'ease-out',fill:'both'}));
      });
      state.timers.push(setTimeout(function(){if(activeTransition===state)cancelTransition();},1150));
    },720));
  }
  function transitionInputToDp(){
    var sources=Array.from(visual.querySelectorAll('.shard-input-row .shard-input-matrix'));
    if(sources.length!==BATCH){stage=2;render();return;}
    var origins=sources.map(function(source){return source.querySelector('.shard-input-mini').getBoundingClientRect();});
    var visualRect=visual.getBoundingClientRect();
    var layer=document.createElement('div');
    layer.className='shard-flying-input-layer';
    layer.style.left=visualRect.left+'px';layer.style.top=visualRect.top+'px';
    layer.style.width=visualRect.width+'px';layer.style.height=visualRect.height+'px';
    document.body.appendChild(layer);
    var flyers=sources.map(function(source,i){
      var flying=source.querySelector('.shard-input-mini').cloneNode(true),rect=origins[i];
      flying.classList.add('shard-flying-input-mini');
      flying.setAttribute('aria-hidden','true');
      flying.style.left=(rect.left-visualRect.left)+'px';flying.style.top=(rect.top-visualRect.top)+'px';
      flying.style.width=rect.width+'px';flying.style.height=rect.height+'px';
      layer.appendChild(flying);
      return flying;
    });
    var state={nodes:[layer],timers:[],animations:[]};
    activeTransition=state;
    stage=2;
    visual.classList.add('is-transitioning-input-dp');
    render();
    var targets=Array.from(visual.querySelectorAll('.shard-dp-mini-list .shard-input-matrix'));
    targets.forEach(function(target){target.style.opacity='0';});
    state.cleanup=function(){targets.forEach(function(target){target.style.removeProperty('opacity');});};
    flyers.forEach(function(flying,i){
      var destination=targets[i].querySelector('.shard-input-mini').getBoundingClientRect();
      var delay=Math.floor(i/SAMPLES_PER_DP)*45;
      state.animations.push(flyBetween(flying,origins[i],destination,840,delay));
      state.animations.push(flying.animate([{opacity:1,offset:0},{opacity:1,offset:.82},{opacity:0,offset:1}],{duration:840,delay:delay,fill:'both'}));
      state.animations.push(targets[i].animate([{opacity:0},{opacity:1}],{duration:150,delay:690+delay,fill:'both'}));
    });
    for(var dp=0;dp<DP;dp++)(function(group){
      state.timers.push(setTimeout(function(){
        if(activeTransition!==state)return;
        for(var i=group*SAMPLES_PER_DP;i<(group+1)*SAMPLES_PER_DP;i++){
          targets[i].style.opacity='1';
          flyers[i].remove();
        }
        if(group===DP-1)cancelTransition();
      },840+group*45));
    })(dp);
  }
  function copyCanvases(from,to){
    var originals=from.querySelectorAll('canvas'),copies=to.querySelectorAll('canvas');
    originals.forEach(function(canvas,i){
      var copy=copies[i];
      copy.width=canvas.width;copy.height=canvas.height;
      copy.getContext('2d').drawImage(canvas,0,0);
    });
  }
  function matrixArea(canvas){
    var rect=canvas.getBoundingClientRect();
    var innerWidth=Math.max(1,rect.width-4),innerHeight=Math.max(1,rect.height-4);
    var height=Math.min(innerHeight,innerWidth*SEQ/HIDDEN),width=height*HIDDEN/SEQ;
    return {left:rect.left+(rect.width-width)/2,top:rect.top+(rect.height-height)/2,width:width,height:height};
  }
  function paintCroppedSnapshot(canvas,snapshot,area){
    var canvasRect=canvas.getBoundingClientRect();
    var pixelX=canvas.width/canvasRect.width,pixelY=canvas.height/canvasRect.height;
    snapshot.width=Math.max(1,Math.round(area.width*pixelX));
    snapshot.height=Math.max(1,Math.round(area.height*pixelY));
    var context=snapshot.getContext('2d');
    context.drawImage(canvas,(area.left-canvasRect.left)*pixelX,(area.top-canvasRect.top)*pixelY,area.width*pixelX,area.height*pixelY,0,0,snapshot.width,snapshot.height);
    var overlay=canvas.parentElement.querySelector('.rank-matrix-canvas-compat');
    if(overlay&&overlay.width&&overlay.height){
      var overlayRect=overlay.getBoundingClientRect();
      context.drawImage(overlay,(area.left-overlayRect.left)*overlay.width/overlayRect.width,(area.top-overlayRect.top)*overlay.height/overlayRect.height,area.width*overlay.width/overlayRect.width,area.height*overlay.height/overlayRect.height,0,0,snapshot.width,snapshot.height);
    }
    var cut=canvas.parentElement.querySelector('.shard-transition-cut, .shard-mbs-cp-cut');
    if(cut){
      var cutRect=cut.getBoundingClientRect();
      context.fillStyle=getComputedStyle(cut).backgroundColor;
      context.fillRect((cutRect.left-area.left)*snapshot.width/area.width,(cutRect.top-area.top)*snapshot.height/area.height,cutRect.width*snapshot.width/area.width,cutRect.height*snapshot.height/area.height);
    }
  }
  function morphPiece(source,target,cropMatrix,layer,duration){
    duration=duration||680;
    var rect=cropMatrix?matrixArea(source):source.getBoundingClientRect();
    var dest=cropMatrix?matrixArea(target):target.getBoundingClientRect();
    var layerRect=layer?layer.getBoundingClientRect():{left:0,top:0};
    var piece=document.createElement('div');
    piece.className='shard-flying-piece'+(cropMatrix?' is-matrix-bounds':'');
    if(layer)piece.style.position='absolute';
    piece.style.left=(rect.left-layerRect.left)+'px';piece.style.top=(rect.top-layerRect.top)+'px';piece.style.width=rect.width+'px';piece.style.height=rect.height+'px';
    [source,target].forEach(function(canvas,i){
      var snapshot=document.createElement('canvas');
      snapshot.className=i?'shard-piece-owned':'shard-piece-before';
      if(cropMatrix){
        paintCroppedSnapshot(canvas,snapshot,i?dest:rect);
      }else{
        snapshot.width=canvas.width;snapshot.height=canvas.height;
        snapshot.getContext('2d').drawImage(canvas,0,0);
        var cutOverlay=canvas.parentElement.querySelector('.rank-matrix-canvas-compat');
        if(cutOverlay)snapshot.getContext('2d').drawImage(cutOverlay,0,0,snapshot.width,snapshot.height);
        var animatedCut=i?null:canvas.parentElement.querySelector('.shard-transition-cut, .shard-mbs-cp-cut');
        if(animatedCut){
          var cutRect=animatedCut.getBoundingClientRect(),fullRect=canvas.getBoundingClientRect();
          var cutContext=snapshot.getContext('2d');
          cutContext.fillStyle=getComputedStyle(animatedCut).backgroundColor;
          cutContext.fillRect((cutRect.left-fullRect.left)*snapshot.width/fullRect.width,(cutRect.top-fullRect.top)*snapshot.height/fullRect.height,cutRect.width*snapshot.width/fullRect.width,cutRect.height*snapshot.height/fullRect.height);
        }
      }
      piece.appendChild(snapshot);
    });
    (layer||document.body).appendChild(piece);
    var motion=piece.animate([
      {left:(rect.left-layerRect.left)+'px',top:(rect.top-layerRect.top)+'px',width:rect.width+'px',height:rect.height+'px'},
      {left:(dest.left-layerRect.left)+'px',top:(dest.top-layerRect.top)+'px',width:dest.width+'px',height:dest.height+'px'}
    ],{duration:duration,easing:'cubic-bezier(.2,.72,.2,1)',fill:'forwards'});
    var fadeDuration=Math.round(duration*240/680);
    var handoff={duration:fadeDuration,delay:duration-fadeDuration,fill:'forwards'};
    var fadeBefore=piece.firstChild.animate([{opacity:1},{opacity:0}],handoff);
    var fadeOwned=piece.lastChild.animate([{opacity:0},{opacity:1}],handoff);
    return {piece:piece,motions:[motion,fadeBefore,fadeOwned],refreshOwned:function(){if(cropMatrix)paintCroppedSnapshot(target,piece.lastChild,dest);}};
  }
  function transitionMicrobatchToCp(){
    var oldScene=visual.querySelector('.shard-tree');
    if(!oldScene){stage=4;render();return;}
    var oldRect=oldScene.getBoundingClientRect();
    var ghost=oldScene.cloneNode(true);
    ghost.classList.add('shard-scene-ghost');
    ghost.style.left=oldRect.left+'px';ghost.style.top=oldRect.top+'px';
    ghost.style.width=oldRect.width+'px';ghost.style.height=oldRect.height+'px';ghost.style.margin='0';
    var visibleRect=visual.getBoundingClientRect();
    ghost.style.clipPath='inset('+Math.max(0,visibleRect.top-oldRect.top)+'px '+Math.max(0,oldRect.right-visibleRect.right)+'px '+Math.max(0,oldRect.bottom-visibleRect.bottom)+'px '+Math.max(0,visibleRect.left-oldRect.left)+'px)';
    document.body.appendChild(ghost);
    copyCanvases(oldScene,ghost);
    ghost.querySelectorAll('canvas[data-shard-matrix="microbatch"][data-fragment-key$="-mb0"]').forEach(function(canvas){
      var area=matrixArea(canvas),host=canvas.parentElement.getBoundingClientRect();
      var line=document.createElement('i');
      line.className='shard-transition-cut is-cp';
      line.setAttribute('aria-hidden','true');
      line.style.left=(area.left-host.left)+'px';line.style.right='auto';line.style.width=area.width+'px';
      line.style.top=(area.top-host.top+area.height/2-1)+'px';
      line.style.animation='none';
      canvas.parentElement.appendChild(line);
    });
    var state={nodes:[ghost],timers:[],animations:[]};
    activeTransition=state;
    stage=4;
    visual.classList.add('is-transitioning');
    render();
    if(activeTransition===state){
      var targets=new Map();
      visual.querySelectorAll('canvas[data-fragment-key]').forEach(function(canvas){targets.set(canvas.dataset.fragmentKey,canvas);});
      var viewport=visual.getBoundingClientRect();
      var layer=document.createElement('div');
      layer.className='shard-flying-piece-layer';
      layer.style.left=viewport.left+'px';layer.style.top=viewport.top+'px';
      layer.style.width=viewport.width+'px';layer.style.height=viewport.height+'px';
      document.body.appendChild(layer);
      state.nodes.push(layer);
      var hiddenHosts=[];
      var refreshes=[];
      function hideHost(canvas){
        var host=canvas.parentElement;
        host.setAttribute('data-shard-flight-target','');
        hiddenHosts.push(host);
      }
      ghost.querySelectorAll('.shard-mbs-item.is-muted canvas[data-fragment-key]').forEach(function(source){
        var from=source.closest('.shard-mbs-item').getBoundingClientRect();
        if(from.bottom<viewport.top||from.top>viewport.bottom)return;
        var target=targets.get(source.dataset.fragmentKey);
        if(!target)return;
        var item=target.closest('.shard-mbs-item'),to=item.getBoundingClientRect();
        state.animations.push(item.animate([
          {transform:'translate('+(from.left-to.left)+'px,'+(from.top-to.top)+'px) scale('+(from.width/to.width)+','+(from.height/to.height)+')'},
          {transform:'translate(0,0) scale(1,1)'}
        ],{duration:600,easing:'cubic-bezier(.2,.72,.2,1)',fill:'both'}));
      });
      ghost.querySelectorAll('canvas[data-shard-matrix="microbatch"][data-fragment-key$="-mb0"]').forEach(function(source){
        var bounds=source.getBoundingClientRect();
        if(bounds.bottom<viewport.top||bounds.top>viewport.bottom)return;
        var target=targets.get(source.dataset.fragmentKey);
        if(!target||!target.dataset.shardMounted)return;
        hideHost(target);
        var reference=morphPiece(source,target,true,layer,820);
        state.animations.push.apply(state.animations,reference.motions);
        refreshes.push(reference.refreshOwned);
        for(var cp=0;cp<CP;cp++){
          var cpTarget=targets.get(source.dataset.fragmentKey+'-cp'+cp);
          if(!cpTarget||!cpTarget.dataset.shardMounted)continue;
          hideHost(cpTarget);
          var fragment=morphPiece(source,cpTarget,true,layer,820);
          fragment.piece.firstChild.style.clipPath=cp===0?'inset(0 0 50% 0)':'inset(50% 0 0 0)';
          state.animations.push.apply(state.animations,fragment.motions);
          refreshes.push(fragment.refreshOwned);
        }
      });
      state.cleanup=function(){hiddenHosts.forEach(function(host){host.removeAttribute('data-shard-flight-target');});};
      ghost.remove();
      visual.classList.add('is-transition-visible');
      requestAnimationFrame(function(){requestAnimationFrame(function(){requestAnimationFrame(function(){
        if(activeTransition===state)refreshes.forEach(function(refresh){refresh();});
      });});});
      state.timers.push(setTimeout(function(){if(activeTransition===state)cancelTransition();},840));
    }
  }
  function transitionTo(nextStage){
    var oldScene=visual.querySelector('.shard-tree');
    if(!oldScene){stage=nextStage;render();return;}
    var oldRect=oldScene.getBoundingClientRect();
    var ghost=oldScene.cloneNode(true);
    ghost.classList.add('shard-scene-ghost');
    ghost.style.left=oldRect.left+'px';ghost.style.top=oldRect.top+'px';
    ghost.style.width=oldRect.width+'px';ghost.style.height=oldRect.height+'px';
    ghost.style.margin='0';
    document.body.appendChild(ghost);
    copyCanvases(oldScene,ghost);
    var state={nodes:[ghost],timers:[],animations:[]};
    activeTransition=state;
    var axis=nextStage===4?'cp':nextStage===5?'tp':null;
    if(axis)ghost.querySelectorAll('canvas[data-fragment-key]').forEach(function(canvas){
      if(axis==='cp'&&!canvas.dataset.fragmentKey.endsWith('-mb0'))return;
      if(axis==='tp'&&!canvas.dataset.fragmentKey.includes('-cp'))return;
      var line=document.createElement('i');
      line.className='shard-transition-cut is-'+axis;
      line.setAttribute('aria-hidden','true');
      if(axis==='cp'){
        var area=matrixArea(canvas),host=canvas.parentElement.getBoundingClientRect();
        line.style.left=(area.left-host.left)+'px';
        line.style.right='auto';
        line.style.width=area.width+'px';
        line.style.top=(area.top-host.top+area.height/2-1)+'px';
      }
      canvas.parentElement.appendChild(line);
    });
    stage=nextStage;
    visual.classList.add('is-transitioning');
    render();
    state.timers.push(setTimeout(function(){
      if(activeTransition!==state)return;
      var targets=new Map();
      visual.querySelectorAll('canvas[data-fragment-key]').forEach(function(canvas){targets.set(canvas.dataset.fragmentKey,canvas);});
      var viewport=visual.getBoundingClientRect();
      if(nextStage===3){
        var layer=document.createElement('div');
        layer.className='shard-flying-input-layer';
        layer.style.left=viewport.left+'px';layer.style.top=viewport.top+'px';
        layer.style.width=viewport.width+'px';layer.style.height=viewport.height+'px';
        document.body.appendChild(layer);
        state.nodes.push(layer);
        var visibleTargets=[];
        ghost.querySelectorAll('.shard-dp-mini-list .shard-input-matrix').forEach(function(source){
          var sourceMini=source.querySelector('.shard-input-mini');
          var sourceBounds=sourceMini.getBoundingClientRect();
          if(sourceBounds.bottom<viewport.top||sourceBounds.top>viewport.bottom)return;
          var sample=Number(source.dataset.shardSample);
          var dp=Math.floor(sample/SAMPLES_PER_DP),micro=Math.floor((sample%SAMPLES_PER_DP)/MBS);
          var target=targets.get('b'+dp+'-mb'+micro);
          if(!target)return;
          var destination=matrixArea(target);
          var flying=sourceMini.cloneNode(true);
          flying.classList.add('shard-flying-micro');
          flying.style.left=(sourceBounds.left-viewport.left)+'px';flying.style.top=(sourceBounds.top-viewport.top)+'px';
          flying.style.width=sourceBounds.width+'px';flying.style.height=sourceBounds.height+'px';
          layer.appendChild(flying);
          var motion='translate('+(destination.left-sourceBounds.left)+'px, '+(destination.top-sourceBounds.top)+'px) scale('+(destination.width/sourceBounds.width)+', '+(destination.height/sourceBounds.height)+')';
          state.animations.push(flying.animate([
            {transform:'translate(0, 0) scale(1)',opacity:1,offset:0},
            {transform:motion,opacity:1,offset:.64},
            {transform:motion,opacity:0,offset:1}
          ],{duration:680,easing:'cubic-bezier(.2,.72,.2,1)',fill:'both'}));
          if(visibleTargets.indexOf(target)<0)visibleTargets.push(target);
        });
        visibleTargets.forEach(function(target){
          target.style.visibility='visible';target.style.opacity='0';
          state.animations.push(target.animate([{opacity:0},{opacity:1}],{duration:240,delay:440,fill:'both'}));
        });
        state.cleanup=function(){visibleTargets.forEach(function(target){target.style.visibility='visible';target.style.opacity='1';});};
        scheduleMicrobatchFocus(680+400);
      }else{
        var flightHosts=[];
        ghost.querySelectorAll('canvas[data-fragment-key]').forEach(function(canvas){
        var sourceBounds=canvas.getBoundingClientRect();
        if(sourceBounds.bottom<viewport.top||sourceBounds.top>viewport.bottom)return;
        if(nextStage===4&&!canvas.dataset.fragmentKey.endsWith('-mb0'))return;
        if(nextStage===5&&!canvas.dataset.fragmentKey.includes('-cp'))return;
        var pieces=axis?2:1;
        for(var part=0;part<pieces;part++){
          var key=canvas.dataset.fragmentKey+(axis?'-'+axis+part:'');
          var target=targets.get(key);
          if(!target)continue;
          target.parentElement.setAttribute('data-shard-flight-target','');
          flightHosts.push(target.parentElement);
          var flying=morphPiece(canvas,target,false);
          state.nodes.push(flying.piece);state.animations.push.apply(state.animations,flying.motions);
        }
        });
        state.cleanup=function(){flightHosts.forEach(function(host){host.removeAttribute('data-shard-flight-target');});};
      }
      visual.classList.add('is-transition-visible');
      ghost.style.visibility='hidden';
      state.timers.push(setTimeout(function(){if(activeTransition===state)cancelTransition();},700));
    },axis?650:80));
  }
  function transitionToPP(){
    var oldTree=visual.querySelector('.shard-tree');
    if(!oldTree){stage=7;render();return;}
    var oldRect=oldTree.getBoundingClientRect(),ghost=oldTree.cloneNode(true);
    ghost.classList.add('shard-scene-ghost');
    ghost.style.left=oldRect.left+'px';ghost.style.top=oldRect.top+'px';
    ghost.style.width=oldRect.width+'px';ghost.style.height=oldRect.height+'px';ghost.style.margin='0';
    document.body.appendChild(ghost);
    copyCanvases(oldTree,ghost);
    var state={nodes:[ghost],timers:[],animations:[]};
    activeTransition=state;
    stage=7;
    visual.classList.add('is-transitioning');
    render();
    var pipelineView=visual.querySelector('.shard-pipeline');
    state.cleanup=function(){pipelineView.querySelectorAll('.shard-dp-lane').forEach(function(lane){lane.style.animation='none';});};
    state.timers.push(setTimeout(function(){
      if(activeTransition!==state)return;
      var sources=new Map();
      ghost.querySelectorAll('.shard-rank-card').forEach(function(card){sources.set(card.dataset.rankLocal,card);});
      visual.querySelectorAll('.shard-pipeline .shard-rank-card').forEach(function(target){
        var source=sources.get(target.dataset.rankLocal);
        if(!source)return;
        var origin=source.getBoundingClientRect(),dest=target.getBoundingClientRect();
        var flying=source.cloneNode(true);
        copyCanvases(source,flying);
        flying.classList.add('shard-flying-rank');
        flying.style.left=origin.left+'px';flying.style.top=origin.top+'px';
        document.body.appendChild(flying);
        state.nodes.push(flying);
        state.animations.push(flying.animate([
          {left:origin.left+'px',top:origin.top+'px'},
          {left:dest.left+'px',top:dest.top+'px'}
        ],{duration:720,easing:'cubic-bezier(.2,.72,.2,1)',fill:'forwards'}));
      });
      visual.classList.add('is-transition-visible');
      ghost.style.visibility='hidden';
      state.timers.push(setTimeout(function(){if(activeTransition===state)cancelTransition();},740));
    },80));
  }
  function setStage(value){
    var nextStage=Math.max(-1,Math.min(captions.length-1,value));
    if(activeTransition)cancelTransition();
    if(nextStage===stage)return;
    selectedEpRank=nextStage===8?0:null;
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      if(stage===-1&&nextStage===0){transitionNumberToTensor();return;}
      if(stage===0&&nextStage===1){transitionToInput();return;}
      if(stage===1&&nextStage===2){transitionInputToDp();return;}
    }
    if(stage===6&&nextStage===7&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){transitionToPP();return;}
    if(stage===3&&nextStage===4&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){transitionMicrobatchToCp();return;}
    if((stage===2&&nextStage===3)||(stage===4&&nextStage===5)||(stage===5&&nextStage===6)){
      if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        transitionTo(nextStage);return;
      }
    }
    stage=nextStage;render();
  }
  prev.addEventListener('click',function(){setStage(stage-1);});
  next.addEventListener('click',function(){setStage(stage+1);});
  steps.addEventListener('click',function(event){var button=event.target.closest('[data-shard-step]');if(button)setStage(Number(button.dataset.shardStep));});
  epControlsHost.addEventListener('click',function(event){
    if(stage!==8)return;
    var modeButton=event.target.closest('[data-shard-ep-mode]');
    var degreeButton=event.target.closest('[data-shard-ep-degree]');
    if(modeButton){
      var mode=modeButton.dataset.shardEpMode;
      if(mode===epMode)return;
      epMode=mode;
      if(epMode==='cut'&&epDegree>DP)epDegree=DP;
    }else if(degreeButton&&!degreeButton.disabled){
      var degree=Number(degreeButton.dataset.shardEpDegree);
      if(degree===epDegree)return;
      epDegree=degree;
    }else return;
    selectedEpRank=0;
    render();
  });
  visual.addEventListener('click',function(event){
    if(stage!==8)return;
    var slot=event.target.closest('.shard-pipeline .shard-rank-slot');
    if(!slot||!visual.contains(slot))return;
    var rank=Number(slot.dataset.rank);
    selectedEpRank=selectedEpRank===rank?null:rank;
    updateEpSelection();
  });
  visual.addEventListener('keydown',function(event){
    if(stage!==8||(event.key!=='Enter'&&event.key!==' '))return;
    var slot=event.target.closest('.shard-pipeline .shard-rank-slot');
    if(!slot||!visual.contains(slot))return;
    event.preventDefault();
    slot.click();
  });
  new MutationObserver(function(){
    previewCache.clear();
    if(page.dataset.tab!=='shard')return;
    if(stage>=7)mountPreviews();
    else controllers.forEach(function(controller){controller.resize();});
  }).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  if(window.ResizeObserver){
    visualResizeObserver=new ResizeObserver(sizeShardRows);
    visualResizeObserver.observe(visual);
  }else window.addEventListener('resize',sizeShardRows);
  function focusRank(rank){
    rank=Number(rank);
    if(!Number.isInteger(rank)||rank<0||rank>=DP*CP*TP*PP)return;
    cancelTransition();
    stage=8;
    epMode='cut';
    selectedEpRank=rank;
    render();
    requestAnimationFrame(function(){
      var slot=Array.from(visual.querySelectorAll('.shard-pipeline .shard-rank-slot')).find(function(item){return Number(item.dataset.rank)===rank;});
      if(!slot)return;
      var viewport=visual.getBoundingClientRect(),target=slot.getBoundingClientRect();
      visual.scrollTo({left:visual.scrollLeft+target.left-viewport.left-(viewport.width-target.width)/2,
        top:visual.scrollTop+target.top-viewport.top-(viewport.height-target.height)/2,
        behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    });
  }
  window.RIShard={enter:function(){cancelTransition();render();},leave:function(){cancelTransition();destroy();},focusRank:focusRank};
  if(page.dataset.tab==='shard')render();
})();
