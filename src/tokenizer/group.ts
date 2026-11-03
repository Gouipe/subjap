import type { GrammarAnnotation, Token } from "@/core/types";
import { tokenCanonicalKey, tokenDictionaryForm, tokenLookupTerms } from "@/core/types";
import { isNonLexicalToken } from "@/core/frequency";

const isAuxiliary = (token: Token): boolean => token.partOfSpeech.includes("助動詞");
const isExplanatoryN = (token: Token): boolean =>
  ["ん", "の"].includes(token.surface) &&
  !isAuxiliary(token) &&
  (tokenDictionaryForm(token) === "ん" ||
    token.partOfSpeech.includes("名詞") ||
    hasPosDetail(token, "準体助詞"));
const isCopula = (token: Token): boolean =>
  isAuxiliary(token) && ["だ", "です", "じゃ"].includes(tokenDictionaryForm(token));

const INFLECTIONAL_SUFFIX_LEMMAS = new Set(["れる", "られる", "せる", "させる", "す", "さす"]);

const INFLECTIONAL_AUXILIARY_TYPES = new Set([
  "特殊・タ",
  "特殊・ナイ",
  "特殊・タイ",
  "特殊・マス",
  "特殊・デス",
  "特殊・ヌ",
  "助動詞-タ",
  "助動詞-ナイ",
  "助動詞-タイ",
  "助動詞-マス",
  "助動詞-デス",
  "助動詞-ヌ",
  "助動詞-レル",
  "助動詞-セル",
  "助動詞-ス",
  "助動詞-ズ",
]);

const INFLECTIONAL_INVARIABLE_AUXILIARIES = new Set(["ん", "う"]);
const INFLECTIONAL_AUXILIARY_LEMMAS = new Set(["れる", "られる", "せる", "させる"]);

/**
 * Verbs that commonly act as auxiliaries after the conjunctive て/で form.
 * 非自立可能 describes a possible use, not a contextual decision. Only the
 * preceding conjunctive て/で licenses treating these verbs as auxiliaries.
 */
const TE_AUXILIARY_LEXEMES = new Set([
  "いる",
  "居る",
  "ある",
  "有る",
  "おく",
  "置く",
  "しまう",
  "仕舞う",
  "いく",
  "行く",
  "くる",
  "来る",
  "みる",
  "見る",
  "みせる",
  "見せる",
  "あげる",
  "上げる",
  "やる",
  "遣る",
  "くれる",
  "呉れる",
  "もらう",
  "貰う",
  "くださる",
  "下さる",
  "いただく",
  "頂く",
  // UniDic analyses common contractions as auxiliary tokens.
  "てる",
  "とく",
  "ちゃう",
  "じゃう",
  "ちまう",
  "じまう",
]);

function hasPosDetail(token: Token, detail: string): boolean {
  return (
    token.partOfSpeechDetails?.includes(detail) === true || token.partOfSpeech.includes(detail)
  );
}

function isIndependentVerb(token: Token): boolean {
  if (!token.partOfSpeech.includes("動詞")) return false;
  if (hasPosDetail(token, "接尾") || hasPosDetail(token, "非自立")) {
    return false;
  }
  // Some analyzers explicitly mark 自立; UniDic marks ordinary verbs as 一般.
  return (
    hasPosDetail(token, "自立") ||
    hasPosDetail(token, "一般") ||
    hasPosDetail(token, "非自立可能") ||
    token.partOfSpeechDetails == null
  );
}

function isInflectionalSuffixVerb(token: Token): boolean {
  return (
    token.partOfSpeech.includes("動詞") &&
    hasPosDetail(token, "接尾") &&
    INFLECTIONAL_SUFFIX_LEMMAS.has(tokenDictionaryForm(token))
  );
}

function isInflectionalAuxiliary(token: Token): boolean {
  return (
    isAuxiliary(token) &&
    (INFLECTIONAL_AUXILIARY_TYPES.has(token.conjugationType ?? "") ||
      INFLECTIONAL_AUXILIARY_LEMMAS.has(tokenDictionaryForm(token)) ||
      INFLECTIONAL_INVARIABLE_AUXILIARIES.has(tokenDictionaryForm(token)))
  );
}

function isTeConjunctiveParticle(token: Token): boolean {
  return (
    (token.surface === "て" || token.surface === "で") &&
    token.partOfSpeech.includes("助詞") &&
    hasPosDetail(token, "接続助詞")
  );
}

function hasTeAuxiliaryLexeme(token: Token): boolean {
  return tokenLookupTerms(token).some((term) => TE_AUXILIARY_LEXEMES.has(term));
}

function isNonIndependentTeAuxiliary(token: Token): boolean {
  return (
    token.partOfSpeech.includes("動詞") &&
    (hasPosDetail(token, "非自立") || hasPosDetail(token, "非自立可能")) &&
    hasTeAuxiliaryLexeme(token)
  );
}

function isContractedTeAuxiliary(token: Token): boolean {
  return isAuxiliary(token) && hasTeAuxiliaryLexeme(token);
}

function isNegative(token: Token): boolean {
  return (
    (isAuxiliary(token) || token.partOfSpeech.includes("形容詞")) &&
    ["ない", "無い", "ぬ", "ず", "ん"].includes(tokenDictionaryForm(token))
  );
}

function canTakeNegativeAdjective(token: Token | undefined): boolean {
  return (
    token != null &&
    (token.partOfSpeech.includes("形容詞") || isCopula(token) || isNegative(token)) &&
    (token.conjugationForm?.includes("連用") === true || /[くで]$/u.test(token.surface))
  );
}

function consumeInflectionalTail(tokens: Token[], start: number): number {
  let end = start;
  let candidate = tokens[end];

  while (candidate && isInflectionalSuffixVerb(candidate)) {
    end += 1;
    candidate = tokens[end];
  }
  while (
    candidate &&
    (isInflectionalAuxiliary(candidate) ||
      (isNegative(candidate) && canTakeNegativeAdjective(tokens[end - 1])))
  ) {
    end += 1;
    candidate = tokens[end];
  }

  return end;
}

/** Learner-facing meaning of a て-form auxiliary, by any of its lexical forms. */
const TE_AUXILIARY_MEANINGS: [string[], string][] = [
  [["いる", "居る", "てる"], "action en cours / état résultant"],
  [["ある", "有る"], "état résultant (laissé ainsi)"],
  [["おく", "置く", "とく"], "faire à l'avance / laisser ainsi"],
  [
    ["しまう", "仕舞う", "ちゃう", "じゃう", "ちまう", "じまう"],
    "action accomplie, souvent regrettable (= てしまう)",
  ],
  [["いく", "行く"], "évolution à partir de maintenant"],
  [["くる", "来る"], "évolution jusqu'à maintenant"],
  [["みる", "見る"], "essayer de …"],
  [["みせる", "見せる"], "faire pour montrer / faire exprès"],
  [["あげる", "上げる", "やる", "遣る"], "faire pour quelqu'un"],
  [["くれる", "呉れる", "くださる", "下さる"], "faire pour moi (faveur reçue)"],
  [["もらう", "貰う", "いただく", "頂く"], "se faire faire (faveur reçue)"],
];

/** Polarity, politeness and tense carried by the tail of a grammar block. */
function tailQualifiers(tail: Token[]): string[] {
  const has = (predicate: (token: Token) => boolean) => tail.some(predicate);
  const auxiliaryLemma = (lemma: string) => (token: Token) =>
    isAuxiliary(token) && tokenDictionaryForm(token) === lemma;
  return [
    ...(has(isNegative) ? ["négation"] : []),
    ...(has(auxiliaryLemma("ます")) ||
    has((token) => isCopula(token) && tokenDictionaryForm(token) === "です")
      ? ["forme polie"]
      : []),
    ...(has(auxiliaryLemma("た")) ? ["passé"] : []),
    ...(has(auxiliaryLemma("たい")) ? ["souhait"] : []),
    ...(has(auxiliaryLemma("う")) ? ["volonté / conjecture"] : []),
  ];
}

function teAuxiliaryLabel(auxiliary: Token, tail: Token[]): string {
  const terms = tokenLookupTerms(auxiliary);
  const meaning =
    TE_AUXILIARY_MEANINGS.find(([lexemes]) =>
      lexemes.some((lexeme) => terms.includes(lexeme)),
    )?.[1] ?? `auxiliaire ${tokenDictionaryForm(auxiliary)}`;
  return [meaning, ...tailQualifiers(tail)].join(", ");
}

/** Consume a て/で form and any auxiliary chain attached to it, one block per link. */
function consumeTeAuxiliaryChain(
  tokens: Token[],
  start: number,
  blocks: PredicateExpression[] = [],
): number {
  let end = start;
  let consumed = false;
  let continueChain = true;

  while (continueChain) {
    continueChain = false;
    const candidate = tokens[end];
    if (!candidate) continue;
    const blockStart = end;
    let auxiliaryIndex = -1;

    if (isTeConjunctiveParticle(candidate)) {
      const auxiliary = tokens[end + 1];
      end += 1;
      consumed = true;
      if (auxiliary && isNonIndependentTeAuxiliary(auxiliary)) {
        auxiliaryIndex = end;
        end += 1;
        continueChain = true;
      }
    } else if (isContractedTeAuxiliary(candidate)) {
      auxiliaryIndex = end;
      end += 1;
      consumed = true;
      continueChain = true;
    } else continue;

    if (continueChain) end = consumeInflectionalTail(tokens, end);
    blocks.push({
      start: blockStart,
      end,
      label:
        auxiliaryIndex < 0
          ? "liaison en て / で"
          : teAuxiliaryLabel(tokens[auxiliaryIndex]!, tokens.slice(auxiliaryIndex + 1, end)),
    });
  }

  return consumed ? end : start;
}

/** Polite negative ありません after an adjective or copular で(は). */
function negativeAruEnd(tokens: Token[], start: number): number {
  const head = tokens[start];
  if (
    !head?.partOfSpeech.includes("動詞") ||
    !["ある", "有る"].some((lemma) => tokenLookupTerms(head).includes(lemma))
  )
    return start;
  const end = consumeInflectionalTail(tokens, start + 1);
  return tokens.slice(start + 1, end).some(isNegative) ? end : start;
}

function isConjunctiveParticle(token: Token | undefined, surfaces: string[]): boolean {
  return (
    token != null &&
    surfaces.includes(token.surface) &&
    token.partOfSpeech.includes("助詞") &&
    hasPosDetail(token, "接続助詞")
  );
}

const OBLIGATION_VERBS = new Set(["いける", "行ける", "なる", "成る"]);
const OBLIGATION_ADJECTIVES = new Set(["だめ", "駄目", "ダメ"]);

/** いけない / ならない / だめ(だ), with their polite or past tail. */
function obligationEnd(tokens: Token[], start: number): number {
  const head = tokens[start];
  if (!head) return start;
  if (OBLIGATION_ADJECTIVES.has(head.surface)) {
    return start + 1 + copularLength(tokens, start + 1);
  }
  if (!head.partOfSpeech.includes("動詞") || !OBLIGATION_VERBS.has(tokenDictionaryForm(head)))
    return start;
  const end = consumeInflectionalTail(tokens, start + 1);
  return tokens.slice(start + 1, end).some(isNegative) ? end : start;
}

interface PredicateExpression {
  /** Index of the first token of the expression block. */
  start: number;
  end: number;
  label: string;
}

function obligationLabel(base: string, tail: Token[]): string {
  // The negative of いけない / ならない is part of the expression itself.
  return [base, ...tailQualifiers(tail).filter((label) => label !== "négation")].join(", ");
}

/**
 * Conditional ば and the negative conditional (なければ, なきゃ, なくては,
 * なくちゃ, ねば), absorbed with a following いけない / ならない / だめ into
 * one obligation block.
 */
function conditionalExpression(
  tokens: Token[],
  headIndex: number,
  end: number,
): PredicateExpression | null {
  const last = tokens[end - 1];
  const next = tokens[end];
  if (!last) return null;
  const negative = end - 1 > headIndex && isNegative(last);
  const conditionalForm = last.conjugationForm?.includes("仮定") === true;
  const negativeTe = negative && /^なく/u.test(last.surface);

  let markerEnd: number;
  // なきゃ / なけりゃ / なくちゃ / なくては usually announce an implied obligation.
  let impliesObligation = false;
  // ないと alone stays a plain conditional; only ないといけない is grouped.
  let requiresObligation = false;
  if (conditionalForm && isConjunctiveParticle(next, ["ば"])) markerEnd = end + 1;
  else if (negative && conditionalForm && last.conjugationForm!.includes("融合")) {
    markerEnd = end;
    impliesObligation = true;
  } else if (negativeTe && isContractedTeWa(next)) {
    markerEnd = end + 1;
    impliesObligation = true;
  } else if (negativeTe && isTeWa(tokens, end)) {
    markerEnd = end + 2;
    impliesObligation = true;
  } else if (negative && isConjunctiveParticle(next, ["と"])) {
    markerEnd = end + 1;
    requiresObligation = true;
  } else return null;

  if (!negative) return { start: end, end: markerEnd, label: "condition (si …)" };

  const obligation = obligationEnd(tokens, markerEnd);
  if (obligation > markerEnd) {
    return {
      start: end - 1,
      end: obligation,
      label: obligationLabel("obligation (devoir …)", tokens.slice(markerEnd, obligation)),
    };
  }
  if (requiresObligation) return null;
  return {
    start: end - 1,
    end: markerEnd,
    label: impliesObligation
      ? "si … ne … pas ; seul : devoir … (suite sous-entendue)"
      : "condition négative (si … ne … pas)",
  };
}

/** ちゃ / じゃ: UniDic's contraction of ては / では. */
function isContractedTeWa(token: Token | undefined): boolean {
  return isConjunctiveParticle(token, ["ちゃ", "じゃ"]);
}

/** て / で followed by the particle は. */
function isTeWa(tokens: Token[], index: number): boolean {
  const te = tokens[index];
  const wa = tokens[index + 1];
  return (
    te != null &&
    isTeConjunctiveParticle(te) &&
    wa?.surface === "は" &&
    wa.partOfSpeech.includes("助詞")
  );
}

const PERMISSION_WORDS = new Set(["いい", "良い", "よい", "大丈夫", "構う", "かまう"]);

/** いい / 大丈夫 / 構わない, with their polite or past tail. */
function permissionEnd(tokens: Token[], start: number): number {
  const head = tokens[start];
  if (!head || !tokenLookupTerms(head).some((term) => PERMISSION_WORDS.has(term))) return start;
  if (head.partOfSpeech.includes("形状詞")) {
    return start + 1 + copularLength(tokens, start + 1);
  }
  const end = consumeInflectionalTail(tokens, start + 1);
  // 構う only expresses permission in its negative 構わない.
  if (head.partOfSpeech.includes("動詞") && !tokens.slice(start + 1, end).some(isNegative)) {
    return start;
  }
  return end;
}

/**
 * ては / ちゃ / じゃ + いけない / だめ (interdiction), ても + いい (permission),
 * and a lone ちゃ / じゃ contraction.
 */
function teExpression(tokens: Token[], headIndex: number, end: number): PredicateExpression | null {
  const next = tokens[end];
  const last = tokens[end - 1];
  const negative = end - 1 > headIndex && last != null && isNegative(last);

  if (isContractedTeWa(next) || isTeWa(tokens, end)) {
    const markerEnd = isContractedTeWa(next) ? end + 1 : end + 2;
    const obligation = obligationEnd(tokens, markerEnd);
    if (obligation > markerEnd) {
      return {
        start: end,
        end: obligation,
        label: obligationLabel(
          "interdiction (ne pas devoir …)",
          tokens.slice(markerEnd, obligation),
        ),
      };
    }
    if (isContractedTeWa(next)) {
      return { start: end, end: markerEnd, label: "ては contracté (si / quand …)" };
    }
    return null;
  }

  const mo = tokens[end + 1];
  if (
    next &&
    isTeConjunctiveParticle(next) &&
    mo?.surface === "も" &&
    mo.partOfSpeech.includes("助詞")
  ) {
    const permission = permissionEnd(tokens, end + 2);
    if (permission > end + 2) {
      return {
        start: negative ? end - 1 : end,
        end: permission,
        label: obligationLabel(
          negative ? "pas besoin de …" : "permission (pouvoir …)",
          tokens.slice(end + 3, permission),
        ),
      };
    }
  }
  return null;
}

interface PredicateSpan {
  end: number;
  blocks: PredicateExpression[];
}

function inflectedPredicateSpan(tokens: Token[], start: number): PredicateSpan | null {
  const head = tokens[start];
  if (
    !head ||
    !(
      isIndependentVerb(head) ||
      (head.partOfSpeech.includes("形容詞") && !hasPosDetail(head, "接尾")) ||
      head.partOfSpeech.includes("形状詞")
    )
  )
    return null;

  let end = consumeInflectionalTail(tokens, start + 1);
  const expression = conditionalExpression(tokens, start, end) ?? teExpression(tokens, start, end);
  if (expression) return { end: expression.end, blocks: [expression] };
  if (canTakeNegativeAdjective(tokens[end - 1])) end = negativeAruEnd(tokens, end);
  // A na-adjective keeps its lexical identity while its copula is inflected.
  if (head.partOfSpeech.includes("形状詞") && tokens[end] && isCopula(tokens[end]!)) {
    const copulaEnd = copularLength(tokens, end);
    end += copulaEnd;
  }
  const blocks: PredicateExpression[] = [];
  const teChainEnd = consumeTeAuxiliaryChain(tokens, end, blocks);
  if (teChainEnd > end) end = teChainEnd;

  return end - start > 1 ? { end, blocks } : null;
}

/** Surface of a pedagogical block, without the visual line breaks it spans. */
function blockSurface(tokens: Token[]): string {
  return tokens.map((token) => token.surface.replace(/\n/gu, "")).join("");
}

function hasExplicitLexicalContract(token: Token): boolean {
  return (
    token.dictionaryForm !== undefined ||
    token.canonicalKey !== undefined ||
    token.lookupTerms !== undefined
  );
}

function derivedLexicalFields(base: Token): Partial<Token> {
  if (!hasExplicitLexicalContract(base)) return {};
  return {
    dictionaryForm: tokenDictionaryForm(base),
    canonicalKey: tokenCanonicalKey(base),
    lookupTerms: tokenLookupTerms(base),
    dictionaryReading: base.dictionaryReading,
  };
}

/**
 * Display blocks and their explanations: tokens outside a grammar block keep
 * their own surface and morphological label.
 */
function predicateLayout(
  tokens: Token[],
  blocks: PredicateExpression[],
): Pick<Token, "segments" | "grammar"> {
  if (blocks.length === 0) return { grammar: describeInflections(tokens.slice(1)) };
  const segments: string[] = [];
  const grammar: GrammarAnnotation[] = [];
  for (let index = 0; index < tokens.length;) {
    const block = blocks.find((candidate) => candidate.start === index);
    if (block) {
      const surface = blockSurface(tokens.slice(block.start, block.end));
      segments.push(surface);
      grammar.push({ surface, kind: "inflection", label: block.label });
      index = block.end;
    } else {
      const token = tokens[index]!;
      segments.push(token.surface);
      if (index > 0) grammar.push(...describeInflections([token]));
      index += 1;
    }
  }
  return { segments, grammar };
}

/** `blocks` use indexes relative to `tokens`. */
function createInflectedPredicateGroup(tokens: Token[], blocks: PredicateExpression[]): Token {
  const verb = tokens[0];
  if (!verb) throw new Error("An inflected predicate group requires a lexical head");
  const behavesAsIAdjective = tokens.some(
    (token) => token.conjugationType === "特殊・タイ" || token.conjugationType === "助動詞-タイ",
  );

  return {
    surface: tokens.map((token) => token.surface).join(""),
    ...derivedLexicalFields(verb),
    lemma: tokenCanonicalKey(verb),
    reading: tokens.map((token) => token.reading).join(""),
    partOfSpeech: behavesAsIAdjective
      ? [...new Set([...verb.partOfSpeech, "形容詞"])]
      : verb.partOfSpeech,
    ...(verb.partOfSpeechDetails ? { partOfSpeechDetails: verb.partOfSpeechDetails } : undefined),
    components: tokens,
    ...predicateLayout(tokens, blocks),
  };
}

/** Consume a copula with its negative/polite/past tail, not the preceding noun. */
function copularLength(tokens: Token[], start: number): number {
  const head = tokens[start];
  if (!head || !isCopula(head)) return 0;
  let end = start + 1;
  // UniDic can split では into copular で + topic particle は.
  if (
    head.surface === "で" &&
    tokens[end]?.surface === "は" &&
    tokens[end]?.partOfSpeech.includes("助詞") &&
    tokens[end + 1] &&
    (isNegative(tokens[end + 1]!) || negativeAruEnd(tokens, end + 1) > end + 1)
  )
    end += 1;
  if (["で", "では", "じゃ"].includes(head.surface) && tokens[end] && isNegative(tokens[end]!)) {
    end += 1;
  }
  if (["で", "では", "じゃ"].includes(head.surface)) end = negativeAruEnd(tokens, end);
  end = consumeInflectionalTail(tokens, end);
  if (tokens[end] && isTeConjunctiveParticle(tokens[end]!)) end += 1;
  return end - start;
}

function grammarExpressionLength(tokens: Token[], start: number): number {
  const head = tokens[start];
  if (!head) return 0;
  let copulaStart = start;
  if (
    head.surface === "な" &&
    isCopula(head) &&
    tokens[start + 1] &&
    isExplanatoryN(tokens[start + 1]!)
  )
    copulaStart += 2;
  else if (isExplanatoryN(head) || (head.surface === "なん" && isCopula(head))) copulaStart += 1;
  const length = copularLength(tokens, copulaStart);
  return length > 0 && copulaStart + length - start > 1 ? copulaStart + length - start : 0;
}

/** Keep ambiguous morphology explicit rather than claim a contextual meaning. */
function describeInflections(tokens: Token[]): GrammarAnnotation[] {
  return tokens.flatMap((token) => {
    const lemma = tokenDictionaryForm(token);
    const type = token.conjugationType ?? "";
    let label: string | undefined;
    if (isExplanatoryN(token) && !isAuxiliary(token)) label = "explication";
    else if (isNegative(token)) label = "négation";
    else if (isAuxiliary(token) && (lemma === "た" || /(?:-|・)タ$/u.test(type)))
      label = "passé / accompli";
    else if (isAuxiliary(token) && lemma === "ます") label = "politesse";
    else if (isCopula(token)) label = lemma === "です" ? "copule polie" : "copule";
    else if (isAuxiliary(token) && lemma === "たい") label = "souhait";
    else if (
      ["れる", "られる"].includes(lemma) &&
      (isAuxiliary(token) || isInflectionalSuffixVerb(token))
    ) {
      label = "passif / potentiel / honorifique (selon le contexte)";
    } else if (
      ["せる", "させる", "す", "さす"].includes(lemma) &&
      (isAuxiliary(token) || isInflectionalSuffixVerb(token))
    )
      label = "causatif";
    else if (isAuxiliary(token) && lemma === "う") label = "volonté / conjecture";
    else if (isTeConjunctiveParticle(token)) label = "liaison en て / で";
    else if (isNonIndependentTeAuxiliary(token) || isContractedTeAuxiliary(token))
      label = `auxiliaire ${lemma}`;
    return label ? [{ surface: token.surface, kind: "inflection" as const, label }] : [];
  });
}

const PLURAL_SUFFIXES = new Map([
  ["ら", "ら"],
  ["等", "ら"],
  ["たち", "たち"],
  ["達", "たち"],
  ["ども", "ども"],
  ["共", "ども"],
  ["がた", "がた"],
  ["方", "がた"],
]);

function isNominalBase(token: Token): boolean {
  return (
    (token.partOfSpeech.includes("名詞") || token.partOfSpeech.includes("代名詞")) &&
    !token.partOfSpeech.includes("接尾辞")
  );
}

function pluralSuffixLabel(token: Token): string | null {
  if (!token.partOfSpeech.includes("接尾辞")) return null;
  return (
    PLURAL_SUFFIXES.get(token.surface) ??
    PLURAL_SUFFIXES.get(tokenDictionaryForm(token)) ??
    PLURAL_SUFFIXES.get(tokenCanonicalKey(token)) ??
    null
  );
}

function createPluralGroup(base: Token, suffix: Token): Token {
  const grammar: GrammarAnnotation = { surface: suffix.surface, kind: "plural-suffix" };
  return {
    surface: `${base.surface}${suffix.surface}`,
    ...derivedLexicalFields(base),
    lemma: tokenCanonicalKey(base),
    reading: `${base.reading}${suffix.reading}`,
    partOfSpeech: base.partOfSpeech,
    ...(base.partOfSpeechDetails ? { partOfSpeechDetails: base.partOfSpeechDetails } : undefined),
    components: [base, suffix],
    grammar: [grammar],
  };
}

function createGroup(tokens: Token[]): Token {
  const groupedSurface = tokens.map((token) => token.surface).join("");
  return {
    surface: groupedSurface,
    // Grammar expressions do not have a single lexical identity.
    lemma: groupedSurface,
    reading: tokens.map((token) => token.reading).join(""),
    partOfSpeech: [...new Set(tokens.flatMap((token) => token.partOfSpeech))],
    components: tokens,
    grammar: describeInflections(tokens),
    grammarOnly: true,
  };
}

/** UniDic leaves the cut-off of an exclamation (フン + ッ) as a symbol. */
const isStandaloneSokuon = (token: Token | undefined): boolean =>
  token !== undefined &&
  /^[っッ]+$/u.test(token.surface) &&
  (token.partOfSpeech.includes("補助記号") || token.partOfSpeech.includes("記号"));

/**
 * A word cut off by a sokuon is an exclamation. It gets its own identity so
 * that its default ignored status never reaches the underlying word, and its
 * interjection POS steers the reading lookup towards interjection entries.
 */
function createExclamationGroup(base: Token, sokuon: Token): Token {
  const surface = `${base.surface}${sokuon.surface}`;
  return {
    surface,
    dictionaryForm: surface,
    canonicalKey: surface,
    lookupTerms: [surface, ...tokenLookupTerms(base)],
    lemma: surface,
    reading: `${base.reading}${sokuon.reading}`,
    dictionaryReading: base.dictionaryReading ?? base.reading,
    partOfSpeech: ["感動詞"],
    components: [...(base.components ?? [base]), sokuon],
  };
}

function mergeExclamations(tokens: Token[]): Token[] {
  const result: Token[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const base = tokens[index]!;
    const next = tokens[index + 1];
    if (isStandaloneSokuon(next) && !isNonLexicalToken(base)) {
      result.push(createExclamationGroup(base, next!));
      index += 1;
    } else {
      result.push(base);
    }
  }
  return result;
}

/** Convert morphological tokens into conservative display/interaction units. */
export function groupTokens(tokens: Token[]): Token[] {
  const result: Token[] = [];

  for (let index = 0; index < tokens.length;) {
    const base = tokens[index];
    const suffix = tokens[index + 1];
    const label = base && suffix && isNominalBase(base) ? pluralSuffixLabel(suffix) : null;
    if (base && suffix && label) {
      result.push(createPluralGroup(base, suffix));
      index += 2;
      continue;
    }

    const predicate = inflectedPredicateSpan(tokens, index);
    if (predicate) {
      const blocks = predicate.blocks.map((block) => ({
        ...block,
        start: block.start - index,
        end: block.end - index,
      }));
      result.push(createInflectedPredicateGroup(tokens.slice(index, predicate.end), blocks));
      index = predicate.end;
      continue;
    }

    const grammarLength = grammarExpressionLength(tokens, index);
    if (grammarLength > 0) {
      result.push(createGroup(tokens.slice(index, index + grammarLength)));
      index += grammarLength;
    } else {
      if (base) result.push(base);
      index += 1;
    }
  }

  return mergeExclamations(result);
}
