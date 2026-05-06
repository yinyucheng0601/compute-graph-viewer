import type { DesignSystem, Page, SlideMeta } from '@open-slide/core';
import type React from 'react';

export const design: DesignSystem = {
  palette: {
    bg: '#f5f1e8',
    text: '#171615',
    accent: '#0f7b6c',
  },
  fonts: {
    display: '"Avenir Next", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    body: '"Avenir Next", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  typeScale: {
    hero: 142,
    body: 34,
  },
  radius: 18,
};

const C = {
  bg: 'var(--osd-bg)',
  text: 'var(--osd-text)',
  accent: 'var(--osd-accent)',
  ink: '#171615',
  muted: '#6f6b62',
  soft: '#e7dfd2',
  line: '#d5cabb',
  white: '#fffaf1',
  dark: '#15211f',
  red: '#b45d4d',
  blue: '#3b628f',
  amber: '#c58b30',
  green: '#0f7b6c',
};

const fill = {
  width: '100%',
  height: '100%',
  background: C.bg,
  color: C.text,
  fontFamily: 'var(--osd-font-body)',
  position: 'relative' as const,
  overflow: 'hidden',
};

const css = `
  @keyframes rise {
    from { opacity: 0; transform: translateY(18px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes draw {
    from { width: 0; }
    to { width: 100%; }
  }
  .rise { opacity: 0; animation: rise .65s cubic-bezier(.2,.7,.2,1) forwards; }
  .delay1 { animation-delay: .12s; }
  .delay2 { animation-delay: .24s; }
  .delay3 { animation-delay: .36s; }
  .delay4 { animation-delay: .48s; }
  .rule { height: 2px; background: ${C.ink}; animation: draw .8s ease forwards; }
`;

const Styles = () => <style>{css}</style>;

const pageNo = (n: string) => (
  <div
    style={{
      position: 'absolute',
      right: 86,
      bottom: 56,
      fontSize: 20,
      letterSpacing: '0.18em',
      color: C.muted,
      fontWeight: 700,
    }}
  >
    {n}
  </div>
);

const Header = ({ tag, title }: { tag: string; title: string }) => (
  <div style={{ position: 'absolute', left: 110, right: 110, top: 78 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
      <div style={{ fontSize: 22, letterSpacing: '0.16em', color: C.accent, fontWeight: 800 }}>
        {tag}
      </div>
      <div style={{ flex: 1, height: 1, background: C.line }} />
    </div>
    <h2
      style={{
        margin: '26px 0 0',
        fontFamily: 'var(--osd-font-display)',
        fontSize: 64,
        lineHeight: 1.12,
        letterSpacing: '-0.035em',
        fontWeight: 860,
        maxWidth: 1260,
      }}
    >
      {title}
    </h2>
  </div>
);

const Card = ({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) => (
  <div
    className={className}
    style={{
      background: C.white,
      border: `1px solid ${C.line}`,
      borderRadius: 'var(--osd-radius)',
      boxShadow: '0 22px 44px rgba(54,42,24,0.08)',
      ...style,
    }}
  >
    {children}
  </div>
);

const Pill = ({ children, tone = C.green }: { children: React.ReactNode; tone?: string }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 42,
      padding: '0 18px',
      borderRadius: 999,
      color: tone,
      border: `1px solid ${tone}55`,
      background: `${tone}12`,
      fontSize: 22,
      fontWeight: 780,
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </span>
);

const BigStep = ({
  index,
  title,
  text,
  color,
}: {
  index: string;
  title: string;
  text: string;
  color: string;
}) => (
  <Card style={{ padding: 34, minHeight: 188 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 18 }}>
      <div
        style={{
          width: 58,
          height: 58,
          borderRadius: 18,
          display: 'grid',
          placeItems: 'center',
          background: color,
          color: '#fff',
          fontSize: 28,
          fontWeight: 900,
        }}
      >
        {index}
      </div>
      <div style={{ fontSize: 34, fontWeight: 850 }}>{title}</div>
    </div>
    <div style={{ fontSize: 27, lineHeight: 1.48, color: C.muted }}>{text}</div>
  </Card>
);

const Cover: Page = () => (
  <div style={{ ...fill, padding: '116px 116px' }}>
    <Styles />
    <div
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        width: 720,
        height: 1080,
        background: C.dark,
        clipPath: 'polygon(22% 0, 100% 0, 100% 100%, 0 100%)',
      }}
    />
    <div
      style={{
        position: 'absolute',
        right: 118,
        top: 138,
        width: 430,
        height: 760,
        border: '1px solid rgba(255,255,255,.22)',
        borderRadius: 28,
        padding: 34,
        color: '#f6efe2',
      }}
    >
      <div style={{ fontSize: 24, letterSpacing: '.2em', color: '#8ed7c8', fontWeight: 800 }}>
        TWO SKILLS
      </div>
      {['业务理解 / 竞争分析', '低保真原型迁移', '团队模板化复用'].map((item, i) => (
        <div
          key={item}
          className={`rise delay${i + 1}`}
          style={{
            marginTop: 46,
            padding: '28px 0',
            borderTop: '1px solid rgba(255,255,255,.18)',
            fontSize: 34,
            lineHeight: 1.35,
            fontWeight: 760,
          }}
        >
          {item}
        </div>
      ))}
    </div>
    <div style={{ position: 'relative', width: 1020 }}>
      <div className="rise" style={{ fontSize: 25, letterSpacing: '.2em', color: C.accent, fontWeight: 850 }}>
        AI FOR DESIGN · CAPABILITY SET
      </div>
      <h1
        className="rise delay1"
        style={{
          margin: '38px 0 0',
          fontFamily: 'var(--osd-font-display)',
          fontSize: 'var(--osd-size-hero)',
          lineHeight: 1.02,
          letterSpacing: '-0.06em',
          fontWeight: 900,
        }}
      >
        把设计前期探索沉淀成可复用能力
      </h1>
      <p
        className="rise delay2"
        style={{
          marginTop: 44,
          maxWidth: 900,
          fontSize: 38,
          lineHeight: 1.45,
          color: C.muted,
        }}
      >
        以 PTO / MemViewer 项目为例，验证从文档与开源仓理解业务，到低保真原型迁移的 AI 辅助设计工作流。
      </p>
    </div>
    {pageNo('01')}
  </div>
);

const Agenda: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="OVERVIEW" title="今天不讲技术细节，讲一套已经跑通的设计生产方式" />
    <div
      style={{
        position: 'absolute',
        left: 116,
        right: 116,
        top: 310,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 24,
      }}
    >
      {[
        ['01', '为什么需要 AI for Design', '复杂创新项目中，理解成本已经成为交付瓶颈。'],
        ['02', '两个已验证 Skill', '竞争分析 / 业务理解，低保真原型迁移。'],
        ['03', '可推广工作流', '从文档和开源仓，到可评审原型和团队模板。'],
        ['04', '价值与边界', '效率、质量、创意，以及必须治理的风险。'],
      ].map(([n, t, d], i) => (
        <Card key={n} className={`rise delay${i + 1}` as string} style={{ padding: 34, height: 430 } as React.CSSProperties}>
          <div style={{ fontSize: 86, fontWeight: 900, color: C.accent, letterSpacing: '-.06em' }}>{n}</div>
          <div style={{ marginTop: 34, fontSize: 34, lineHeight: 1.22, fontWeight: 860 }}>{t}</div>
          <div style={{ marginTop: 24, fontSize: 26, lineHeight: 1.45, color: C.muted }}>{d}</div>
        </Card>
      ))}
    </div>
    {pageNo('02')}
  </div>
);

const Problem: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="WHY" title="计算领域创新设计，最大难点不是画界面，而是主动发现机会" />
    <div style={{ position: 'absolute', left: 116, top: 304, width: 760 }}>
      <div style={{ fontSize: 42, lineHeight: 1.38, fontWeight: 820 }}>
        原本设计已经在主动挖掘创新体验机会，但理解成本非常高。
      </div>
      <div style={{ marginTop: 40, fontSize: 31, lineHeight: 1.55, color: C.muted }}>
        用户任务隐藏在文档、代码、工具链、调试过程和专家经验里。很多机会点只能先靠假设推演，再等待业务专家逐轮校准。
      </div>
    </div>
    <div style={{ position: 'absolute', right: 116, top: 286, width: 780, display: 'grid', gap: 22 }}>
      {[
        ['任务不可见', '真实任务不在页面上，而在复杂工作流里。'],
        ['对象很抽象', '代码、图、执行、内存、日志之间关系难一次看清。'],
        ['假设堆砌', '设计机会依赖大量推演，校准慢、复用弱。'],
      ].map(([t, d], i) => (
        <Card key={t} style={{ padding: '30px 34px', display: 'grid', gridTemplateColumns: '210px 1fr', alignItems: 'center' }}>
          <div style={{ fontSize: 34, fontWeight: 850, color: [C.red, C.blue, C.amber][i] }}>{t}</div>
          <div style={{ fontSize: 28, lineHeight: 1.45, color: C.muted }}>{d}</div>
        </Card>
      ))}
    </div>
    {pageNo('03')}
  </div>
);

const Case: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="CASE" title="PTO / MemViewer 是一次高复杂度场景下的压力测试" />
    <div style={{ position: 'absolute', left: 116, right: 116, top: 300, display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 32 }}>
      <Card style={{ padding: 42, height: 500 }}>
        <div style={{ fontSize: 42, fontWeight: 860 }}>为什么适合作为验证案例</div>
        {[
          '业务专业度高，非开发者背景理解成本大。',
          '输入资料分散：开源仓、README、研究笔记、原型页面、竞品报告。',
          '目标不是复刻已有产品，而是探索创新体验机会。',
          '低保真原型需要快速生成，同时要能迁移到设计系统。',
        ].map((x) => (
          <div key={x} style={{ marginTop: 30, display: 'flex', gap: 18, alignItems: 'flex-start' }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: C.accent, marginTop: 14 }} />
            <div style={{ fontSize: 30, lineHeight: 1.42, color: C.muted }}>{x}</div>
          </div>
        ))}
      </Card>
      <div style={{ display: 'grid', gap: 24 }}>
        <BigStep index="A" color={C.green} title="业务理解" text="先把陌生技术材料转成设计团队可讨论的业务地图。" />
        <BigStep index="B" color={C.blue} title="原型表达" text="再把机会点转成可评审、可迁移的低保真原型。" />
      </div>
    </div>
    {pageNo('04')}
  </div>
);

const TwoSkills: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="CAPABILITY" title="当前已经沉淀的不是一组 Prompt，而是两个可复用 Skill" />
    <div style={{ position: 'absolute', left: 116, right: 116, top: 312, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 34 }}>
      <Card style={{ padding: 46, minHeight: 520, borderTop: `10px solid ${C.green}` }}>
        <Pill>Skill 1</Pill>
        <h3 style={{ margin: '34px 0 22px', fontSize: 58, lineHeight: 1.1, letterSpacing: '-.04em' }}>
          竞争分析 / 业务理解
        </h3>
        <p style={{ fontSize: 31, lineHeight: 1.5, color: C.muted }}>
          从文档、开源仓和竞品资料中提炼业务对象、用户任务、旅程低谷和设计机会。
        </p>
        <div style={{ marginTop: 48, fontSize: 25, color: C.accent, fontWeight: 820 }}>
          验证案例：competitived-chip-operator
        </div>
      </Card>
      <Card style={{ padding: 46, minHeight: 520, borderTop: `10px solid ${C.blue}` }}>
        <Pill tone={C.blue}>Skill 2</Pill>
        <h3 style={{ margin: '34px 0 22px', fontSize: 58, lineHeight: 1.1, letterSpacing: '-.04em' }}>
          低保真原型迁移
        </h3>
        <p style={{ fontSize: 31, lineHeight: 1.5, color: C.muted }}>
          把业务理解和既有探索页面转成可评审、可维护、可进入设计系统的低保真原型。
        </p>
        <div style={{ marginTop: 48, fontSize: 25, color: C.blue, fontWeight: 820 }}>
          验证案例：MemViewer 原型迁移
        </div>
      </Card>
    </div>
    {pageNo('05')}
  </div>
);

const SkillOne: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="SKILL 1" title="业务理解 Skill：把高门槛资料转成可校准的设计认知" />
    <div style={{ position: 'absolute', left: 116, right: 116, top: 302, display: 'grid', gridTemplateColumns: '360px 1fr 420px', gap: 26 }}>
      <Card style={{ padding: 34, minHeight: 512 }}>
        <div style={{ fontSize: 28, fontWeight: 850, color: C.green }}>输入</div>
        {['项目文档', '开源仓 README / docs', '竞品资料', '历史原型', '专家材料'].map((x) => (
          <div key={x} style={{ marginTop: 28, fontSize: 31, lineHeight: 1.25 }}>{x}</div>
        ))}
      </Card>
      <Card style={{ padding: 34, minHeight: 512, background: C.dark, color: '#f8f0e5' }}>
        <div style={{ fontSize: 28, fontWeight: 850, color: '#8ed7c8' }}>AI 处理过程</div>
        <div style={{ marginTop: 34, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
          {['提取业务对象', '梳理用户任务', '拆解竞品触点', '识别旅程低谷', '归纳产品机会', '标注证据来源'].map((x) => (
            <div
              key={x}
              style={{
                padding: '24px 22px',
                border: '1px solid rgba(255,255,255,.16)',
                borderRadius: 16,
                fontSize: 28,
                lineHeight: 1.25,
                background: 'rgba(255,255,255,.04)',
              }}
            >
              {x}
            </div>
          ))}
        </div>
      </Card>
      <Card style={{ padding: 34, minHeight: 512 }}>
        <div style={{ fontSize: 28, fontWeight: 850, color: C.green }}>输出</div>
        {['业务理解摘要', '用户任务地图', '竞品触点表', '机会点清单'].map((x) => (
          <div key={x} style={{ marginTop: 36, fontSize: 34, lineHeight: 1.2, fontWeight: 760 }}>
            {x}
          </div>
        ))}
      </Card>
    </div>
    {pageNo('06')}
  </div>
);

const SkillOnePractice: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="PRACTICE" title="Skill 1 的关键不是总结资料，而是让假设更快被校准" />
    <div style={{ position: 'absolute', left: 116, top: 310, width: 760 }}>
      <div style={{ fontSize: 46, lineHeight: 1.26, fontWeight: 860 }}>
        设计仍然主动发现机会，AI 负责降低建立假设的成本。
      </div>
      <div style={{ marginTop: 48 }} className="rule" />
      <div style={{ marginTop: 48, fontSize: 31, lineHeight: 1.58, color: C.muted }}>
        AI 先基于足够多的资料生成结构化任务链，设计师再和业务专家一起判断哪些机会真实、重要、值得投入。
      </div>
    </div>
    <div style={{ position: 'absolute', right: 116, top: 294, width: 780, display: 'grid', gap: 22 }}>
      {[
        '先建资料索引，再让 AI 输出业务对象和用户任务。',
        '竞品不按功能表堆叠，而按用户失败点 / 旅程触点组织。',
        '每个机会点必须能回到材料证据，不能只靠流畅表达。',
        '输出必须能进入下一步原型，而不是停在报告。'
      ].map((x, i) => (
        <Card key={x} style={{ padding: 30, display: 'flex', gap: 24, alignItems: 'center' }}>
          <div style={{ fontSize: 38, fontWeight: 900, color: C.green }}>{`0${i + 1}`}</div>
          <div style={{ fontSize: 30, lineHeight: 1.4 }}>{x}</div>
        </Card>
      ))}
    </div>
    {pageNo('07')}
  </div>
);

const SkillTwo: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="SKILL 2" title="低保真迁移 Skill：不是重画页面，而是把探索原型变成设计资产" />
    <div style={{ position: 'absolute', left: 116, right: 116, top: 310, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 26 }}>
      {[
        ['输入', ['业务理解结果', '原有静态页面 / 代码原型', '设计系统约束', '本轮验证任务'], C.blue],
        ['AI 动作', ['识别核心任务流', '拆解页面结构', '映射组件', '清点非系统样式'], C.green],
        ['输出', ['低保真原型', '组件映射表', '样式缺口清单', '后续风险点'], C.amber],
      ].map(([title, items, color]) => (
        <Card key={title as string} style={{ padding: 38, minHeight: 500 }}>
          <div style={{ fontSize: 34, fontWeight: 850, color: color as string }}>{title as string}</div>
          {(items as string[]).map((x) => (
            <div key={x} style={{ marginTop: 34, fontSize: 32, lineHeight: 1.32, fontWeight: 720 }}>
              {x}
            </div>
          ))}
        </Card>
      ))}
    </div>
    {pageNo('08')}
  </div>
);

const Workflow: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="WORKFLOW" title="当前已经在团队内推广开的工作流" />
    <div style={{ position: 'absolute', left: 130, right: 130, top: 306 }}>
      {[
        ['文档 / 开源仓 / 竞品资料', C.green],
        ['AI 业务理解与竞争分析', C.blue],
        ['用户任务和设计机会提炼', C.amber],
        ['选择可验证模块', C.red],
        ['AI 辅助生成低保真原型', C.green],
        ['设计师评审与专家校准', C.blue],
        ['沉淀模板和案例', C.amber],
      ].map(([label, color], i) => (
        <div key={label as string} style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <div
            style={{
              width: 82,
              height: 64,
              borderRadius: 18,
              background: color as string,
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: 28,
              fontWeight: 900,
            }}
          >
            {i + 1}
          </div>
          <div style={{ width: 44, height: 2, background: C.line }} />
          <Card style={{ flex: 1, padding: '22px 30px' }}>
            <div style={{ fontSize: 33, fontWeight: 790 }}>{label as string}</div>
          </Card>
        </div>
      ))}
    </div>
    {pageNo('09')}
  </div>
);

const OpenDesignReference: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="REFERENCE" title="open-design 给我们的启发：能力要产品化，而不是停留在 Prompt" />
    <div style={{ position: 'absolute', left: 116, right: 116, top: 312, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
      {[
        ['Skill', '设计能力的最小复用单元：明确输入、流程、输出。', C.green],
        ['Design System', '质量约束前置，避免每个原型都长成独立风格。', C.blue],
        ['Artifact', '最终交付可预览、可编辑、可沉淀的设计资产。', C.amber],
        ['Checklist', '用规则治理 AI 生成物，减少“看似专业”的随机结果。', C.red],
      ].map(([t, d, color]) => (
        <Card key={t as string} style={{ padding: 34, minHeight: 450 }}>
          <div style={{ fontSize: 50, fontWeight: 900, color: color as string }}>{t as string}</div>
          <div style={{ marginTop: 52, fontSize: 29, lineHeight: 1.48, color: C.muted }}>{d as string}</div>
        </Card>
      ))}
    </div>
    {pageNo('10')}
  </div>
);

const BeforeAfter: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="IMPACT" title="AI 赋能前后，变化发生在设计前期的生产方式" />
    <div style={{ position: 'absolute', left: 116, right: 116, top: 304, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 34 }}>
      <Card style={{ padding: 42, minHeight: 520 }}>
        <Pill tone={C.red}>原流程</Pill>
        {['大量阅读后手工推演', '机会点依赖个人经验', '竞品分析难复用', '原型从空白启动', '团队成员各自摸索'].map((x) => (
          <div key={x} style={{ marginTop: 34, fontSize: 33, lineHeight: 1.28, color: C.muted }}>
            {x}
          </div>
        ))}
      </Card>
      <Card style={{ padding: 42, minHeight: 520, background: C.dark, color: '#f9f1e6' }}>
        <Pill>AI 工作流</Pill>
        {['AI 先生成理解草稿', '机会点结构化、可校准', '沉淀成可复用 Skill', '从业务理解直接进入低保真', '团队共享模板和案例'].map((x) => (
          <div key={x} style={{ marginTop: 34, fontSize: 33, lineHeight: 1.28 }}>
            {x}
          </div>
        ))}
      </Card>
    </div>
    {pageNo('11')}
  </div>
);

const Value: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="VALUE" title="对体验设计交付的四类价值" />
    <div style={{ position: 'absolute', left: 116, right: 116, top: 306, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
      {[
        ['效率', '缩短复杂业务理解和低保真启动时间。'],
        ['质量', '输出有结构、有证据、有迁移说明。'],
        ['创意', '更快看到多种任务路径和原型表达。'],
        ['复用', '从一次经验沉淀为团队 skill 和模板。'],
      ].map(([t, d], i) => (
        <Card key={t} style={{ padding: 38, minHeight: 480 }}>
          <div style={{ fontSize: 84, fontWeight: 900, color: [C.green, C.blue, C.amber, C.red][i] }}>{t}</div>
          <div style={{ marginTop: 74, fontSize: 31, lineHeight: 1.48, color: C.muted }}>{d}</div>
        </Card>
      ))}
    </div>
    {pageNo('12')}
  </div>
);

const Boundary: Page = () => (
  <div style={{ ...fill }}>
    <Styles />
    <Header tag="GOVERNANCE" title="边界很清楚：AI 加速探索，人负责判断和质量" />
    <div style={{ position: 'absolute', left: 116, right: 116, top: 310, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 34 }}>
      <Card style={{ padding: 42, minHeight: 490 }}>
        <div style={{ fontSize: 40, fontWeight: 850 }}>不能替代</div>
        {['真实用户访谈', '业务专家判断', '高保真视觉决策', '可用性测试', '最终产品取舍'].map((x) => (
          <div key={x} style={{ marginTop: 31, fontSize: 31, lineHeight: 1.3, color: C.muted }}>{x}</div>
        ))}
      </Card>
      <Card style={{ padding: 42, minHeight: 490 }}>
        <div style={{ fontSize: 40, fontWeight: 850 }}>治理方式</div>
        {['关键结论保留来源', '专家校准术语和链路', '原型对齐设计系统', '输出组件映射和样式缺口', '持续更新 skill 模板'].map((x) => (
          <div key={x} style={{ marginTop: 31, fontSize: 31, lineHeight: 1.3, color: C.muted }}>{x}</div>
        ))}
      </Card>
    </div>
    {pageNo('13')}
  </div>
);

const Closing: Page = () => (
  <div style={{ ...fill, padding: '118px 126px' }}>
    <Styles />
    <div style={{ fontSize: 25, letterSpacing: '.2em', color: C.accent, fontWeight: 850 }}>
      CONCLUSION
    </div>
    <h2
      style={{
        margin: '54px 0 0',
        fontFamily: 'var(--osd-font-display)',
        fontSize: 112,
        lineHeight: 1.08,
        letterSpacing: '-.055em',
        maxWidth: 1420,
      }}
    >
      我们沉淀的不是一次 AI 生成结果，而是一套可被团队复用的设计生产能力
    </h2>
    <div style={{ position: 'absolute', left: 126, right: 126, bottom: 150, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 26 }}>
      {[
        '两个已验证 Skill',
        '一条可推广工作流',
        '一套质量治理机制',
      ].map((x, i) => (
        <Card key={x} style={{ padding: 34, minHeight: 150 }}>
          <div style={{ fontSize: 28, color: [C.green, C.blue, C.amber][i], fontWeight: 850 }}>{`0${i + 1}`}</div>
          <div style={{ marginTop: 18, fontSize: 34, fontWeight: 850 }}>{x}</div>
        </Card>
      ))}
    </div>
    {pageNo('14')}
  </div>
);

export const meta: SlideMeta = {
  title: 'AI for Design 能力集沉淀',
};

export default [
  Cover,
  Agenda,
  Problem,
  Case,
  TwoSkills,
  SkillOne,
  SkillOnePractice,
  SkillTwo,
  Workflow,
  OpenDesignReference,
  BeforeAfter,
  Value,
  Boundary,
  Closing,
] satisfies Page[];
