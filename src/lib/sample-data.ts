import type { DocumentState, ReviewItem } from "@/lib/review-schema";
import { createDocument } from "@/lib/revisions";

/**
 * 阶段 2 固定假数据：一篇真实的 deception 研究引言 + 手工构造的审阅建议。
 * 用于在不接 LLM 的情况下验证三层建议的视觉、定位与交互。
 */

const PARAGRAPHS = [
  "Introduction",
  "Deception can be defined as a psychological process in which an individual deliberately attempts to mislead another person to accept as truth that which the liar knows to be false (Abe, 2011). This definition underscores that deception is fundamentally a two-person interaction, requiring both a liar and a receiver. Yet traditional neuroscience studies have largely treated deception as a solo decision-making process (Greene & Paxton, 2009; Spence et al., 2008), thereby overlooking the interpersonal part. Furthermore, interpersonal deception theory (IDT, Buller & Burgoon, 1996; Burgoon & Buller, 2008) offers a comprehensive framework by identifying three essential constructs: (a) deliberate deceptive intention, (b) liars, and (c) receivers. To date, research has predominantly focused on the first two elements, examining how intentions (e.g., self-serving vs. altruistic motives; Cui et al., 2018; Pornpattananangkul et al., 2018) and liar characteristics (e.g., personality traits; Brewer & Abell, 2015; Jonason et al., 2014) shape deception behavior. In contrast, the role of the receiver remains largely unexplored.",
  "Among the limited work addressing the receiver's role, Pitesa et al. (2013) provided an important demonstration. In their experiment, participants had the opportunity to behave dishonestly for self-interest under two conditions: one in which their deception would harm a concrete receiver, and another in which the potential receiver remained abstract. Results indicated that participants were significantly more likely to act dishonestly when the abstract receiver was involved, whereas the presence of a concrete victim intuitively promoted honest behavior (see also Köbis et al., 2016). This finding highlights that receiver characteristics can meaningfully shape deceptive decisions. Subsequent studies have extended this line of inquiry by showing that people are less inclined to deceive receivers who are perceived as morally upstanding (SimanTov-Nachlieli et al., 2020) and that people are similarly less likely to deceive those of higher social standing, such as authorities, compared to peers (Verigin et al., 2019). Notably, these investigations have proved that individualized attributes of the receiver, such as identifiability, moral character, or interpersonal familiarity can form deceptive behavior. However, whether deceptive behavior is also shaped by other relational contexts (e.g., social category) remains poorly understood.",
  "Social Identity Theory (SIT; Tajfel & Turner, 2004) offers a compelling lens to address this question. According to SIT, individuals naturally categorize themselves and others into social groups, and derive a significant part of their self-concept from these group affiliations. This categorization process gives rise to robust in-group favoritism, manifested in more positive evaluations of in-group members, preferential resource allocation, and heightened cooperative behavior toward them (Balliet et al., 2014; Ma & Tan, 2023). Importantly, such favoritism emerges even under minimal and arbitrary group distinctions (e.g., preferences for abstract paintings; Tajfel & Turner, 2004), indicating that the categorization process itself, rather than shared history or interpersonal familiarity, is the primary driver. This pattern has been consistently documented across diverse social behaviors, including trust (Lei & Vesely, 2010), cooperation (Balliet et al., 2014), and altruistic giving behaviors (Fehr et al., 2008). In addition, Schiller et al. (2014) found that participants punished in-group norm violators less severely than out-group violators, suggesting that in-group favoritism operates not only by promoting positive treatment of in-group members but also by attenuating negative consequences directed at them. Given the pervasiveness of in-group favoritism across various social interactions, such bias may also shape deceptive behavior. Specifically, people may behave more deceptively to out-group than to in-group receivers. However, direct empirical evidence remains limited, especially regarding the neural substrates of deception related decision making in intergroup contexts (Mei et al., 2020).",
  "Deceptive behavior is also a form of decision-making, in which the liar must decide whether to lie or not. As a typical decision-making paradigm, the sender-receiver task is also used as a spontaneous deception task, wherein the sender decides whether to report the full amount of money truthfully or to deceive for personal gain, with the receiver serving as the interaction partner (Cheng et al., 2022; Suzuki et al., 2015). A decision-making process could include three stages: assessment, refers to forming preferences among available options; execution, involves selecting and carrying out an action; and feedback, pertains to experiencing and evaluating the outcome (Ernst & Paulus, 2005). For spontaneous deception behavior in the sender-receiver task, execution stage is the core stage in which spontaneous deception behavior actually happened. However, before the actual behavior, assessment stage is also important to the decision-making process, deception or truth may already been decided in this early assessment stage (L. Guo, 2016; Sands et al., 2026). Thus, in the sender-receiver task, the receiver's social category may shape neural activity not only during the execution stage, but also during the earlier assessment stage, potentially foreshadowing the direction of deceptive decisions.",
];

/** 构建样例文档，并返回 (doc, 各段 blockId) 以便构造建议 */
export function buildSampleDocument(): {
  doc: DocumentState;
  blockIds: string[];
} {
  const doc = createDocument("The Role of Receiver's Social Category in Deception", PARAGRAPHS);
  return { doc, blockIds: doc.blocks.map((b) => b.id) };
}

/**
 * 手工构造的审阅建议。
 * 注意：这里故意覆盖多种类型/范围/类别/状态，且 range 锚点都真实存在于样例文本中。
 * 其中包含 1 条已过期（stale）建议，用于演示过期态的视觉与不可执行。
 */
export function buildSampleReview(doc: DocumentState): ReviewItem[] {
  const [, p1, p2, p3, p4] = doc.blocks.map((b) => b.id);
  const rev = doc.revision;

  return [
    // ── 全文级意见（opinion，不可直接执行）──
    {
      id: "review_doc_1",
      documentRevision: rev,
      scope: { type: "document" },
      kind: "opinion",
      category: "structure",
      severity: "suggestion",
      title: "文献综述的递进结构清晰，但第三段（SIT）信息密度偏高",
      explanation:
        "引言按“欺骗定义 → 接收者角色 → 社会认同理论 → 决策阶段”递进，逻辑顺畅。但第三段同时承担了 SIT 理论介绍、内群体偏袒的多个证据、以及向本文研究问题的过渡，句子普遍偏长，读者认知负担较重。可考虑将 SIT 的核心机制与证据分开陈述。",
      status: "open",
    },
    {
      id: "review_doc_2",
      documentRevision: rev,
      scope: { type: "document" },
      kind: "opinion",
      category: "consistency",
      severity: "info",
      title: "术语一致性：decision-making 的连字符用法不统一",
      explanation:
        "全文同时出现 “decision-making process”（带连字符）与 “deception related decision making”（不带连字符）。作为名词短语作定语时建议统一为 “decision-making”。",
      status: "open",
    },

    // ── 段落级意见（opinion）──
    {
      id: "review_blk_1",
      documentRevision: rev,
      scope: { type: "block", blockId: p2 },
      kind: "opinion",
      category: "clarity",
      severity: "suggestion",
      title: "本段偏长，建议在 “Notably, these investigations...” 处拆分",
      explanation:
        "该段先介绍 Pitesa et al. (2013) 的核心发现，再铺陈后续研究。在 “Notably, these investigations have proved...” 处自然分成“发现”与“小结/过渡”两部分，可增强可读性。",
      status: "open",
    },
    {
      id: "review_blk_2",
      documentRevision: rev,
      scope: { type: "block", blockId: p3 },
      kind: "opinion",
      category: "logic",
      severity: "info",
      title: "SIT 证据罗列较多，建议明确哪一条直接支撑本文假设",
      explanation:
        "段落列举了信任、合作、利他、惩罚等多条内群体偏袒证据，但未明确指出其中哪一条与“欺骗中的内外群体差异”关系最直接。建议补一句点明最关键的先验证据。",
      status: "open",
    },

    // ── 局部具体修改（edit，可直接执行）──
    {
      id: "review_edit_1",
      documentRevision: rev,
      scope: {
        type: "range",
        blockId: p4,
        original: "deception or truth may already been decided",
        prefix: "the decision-making process, ",
        suffix: " in this early assessment stage",
      },
      kind: "edit",
      category: "grammar",
      severity: "important",
      title: "时态错误：been decided 缺少助动词",
      explanation:
        "“may already been decided” 语法错误，现在完成时的被动语态应为 “may already have been decided”。",
      replacement: "deception or truth may already have been decided",
      status: "open",
    },
    {
      id: "review_edit_2",
      documentRevision: rev,
      scope: {
        type: "range",
        blockId: p4,
        original: "assessment, refers to forming preferences",
        prefix: "three stages: ",
        suffix: " among available options",
      },
      kind: "edit",
      category: "grammar",
      severity: "important",
      title: "句式错误：定义三个阶段的结构不完整",
      explanation:
        "“assessment, refers to forming preferences” 中逗号后接动词原形，结构不通。若三个并列定义要用 “refers to / involves / pertains to”，应去掉各自前的逗号并统一为关系从句或名词短语。这里给出最小修改：将 assessment 后的 “, refers to” 改为 “refers to”。",
      replacement: "assessment refers to forming preferences",
      status: "open",
    },
    {
      id: "review_edit_3",
      documentRevision: rev,
      scope: {
        type: "range",
        blockId: p2,
        original: "can form deceptive behavior",
        prefix: "or interpersonal familiarity ",
        suffix: ". However, whether",
      },
      kind: "edit",
      category: "grammar",
      severity: "important",
      title: "用词不当：form 与 behavior 搭配不当",
      explanation:
        "“form deceptive behavior” 搭配不当。结合上文 “can meaningfully shape deceptive decisions”，这里应是 “shape/define deceptive behavior”，而非 “form”。",
      replacement: "can shape deceptive behavior",
      status: "open",
    },
    {
      id: "review_edit_4",
      documentRevision: rev,
      scope: {
        type: "range",
        blockId: p3,
        original: "deception related decision making",
        prefix: "neural substrates of ",
        suffix: " in intergroup contexts",
      },
      kind: "edit",
      category: "consistency",
      severity: "suggestion",
      title: "连字符：deception-related decision-making",
      explanation:
        "作为复合定语，“deception-related” 与 “decision-making” 都应加连字符，与全文 “decision-making process” 保持一致。",
      replacement: "deception-related decision-making",
      status: "open",
    },
    {
      id: "review_edit_5",
      documentRevision: rev,
      scope: {
        type: "range",
        blockId: p1,
        original: "overlooking the interpersonal part",
        prefix: "Spence et al., 2008), thereby ",
        suffix: ". Furthermore,",
      },
      kind: "edit",
      category: "style",
      severity: "suggestion",
      title: "措辞：interpersonal part 偏口语",
      explanation:
        "学术写作中 “the interpersonal part” 偏随意，且与前文 “two-person interaction” 重复。建议改为 “the interpersonal dimension”。",
      replacement: "overlooking the interpersonal dimension",
      status: "open",
    },

    // ── 一条已过期建议（演示 stale 视觉与不可执行）──
    {
      id: "review_edit_stale",
      documentRevision: rev,
      scope: {
        type: "range",
        blockId: p4,
        original: "this text no longer exists verbatim",
      },
      kind: "edit",
      category: "grammar",
      severity: "info",
      title: "（示例）原文已不存在的过期建议",
      explanation:
        "该建议对应的原文已被修改或删除，无法可靠定位，因此被标记为过期，不可执行。",
      replacement: "ignored",
      status: "stale",
    },
  ];
}
