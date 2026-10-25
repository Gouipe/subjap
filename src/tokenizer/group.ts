import type { GrammarAnnotation, Token } from "@/core/types";
import { tokenCanonicalKey, tokenDictionaryForm, tokenLookupTerms } from "@/core/types";

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

/** Consume a て/で form and any auxiliary chain attached to it. */
function consumeTeAuxiliaryChain(tokens: Token[], start: number): number {
  let end = start;
  let consumed = false;
  let continueChain = true;

  while (continueChain) {
    continueChain = false;
    const candidate = tokens[end];
    if (!candidate) continue;

    if (isTeConjunctiveParticle(candidate)) {
      const auxiliary = tokens[end + 1];
      end += 1;
      consumed = true;
      if (auxiliary && isNonIndependentTeAuxiliary(auxiliary)) {
        end += 1;
        continueChain = true;
      }
    } else if (isContractedTeAuxiliary(candidate)) {
      end += 1;
      consumed = true;
      continueChain = true;
    }

    if (continueChain) end = consumeInflectionalTail(tokens, end);
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

function inflectedPredicateLength(tokens: Token[], start: number): number {
  const head = tokens[start];
  if (
    !head ||
    !(
      isIndependentVerb(head) ||
      (head.partOfSpeech.includes("形容詞") && !hasPosDetail(head, "接尾")) ||
      head.partOfSpeech.includes("形状詞")
    )
  )
    return 0;

  let end = consumeInflectionalTail(tokens, start + 1);
  if (canTakeNegativeAdjective(tokens[end - 1])) end = negativeAruEnd(tokens, end);
  // A na-adjective keeps its lexical identity while its copula is inflected.
  if (head.partOfSpeech.includes("形状詞") && tokens[end] && isCopula(tokens[end]!)) {
    const copulaEnd = copularLength(tokens, end);
    end += copulaEnd;
  }
  const teChainEnd = consumeTeAuxiliaryChain(tokens, end);
  if (teChainEnd > end) end = teChainEnd;

  return end - start > 1 ? end - start : 0;
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

function createInflectedPredicateGroup(tokens: Token[]): Token {
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
    grammar: describeInflections(tokens.slice(1)),
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

    const predicateLength = inflectedPredicateLength(tokens, index);
    if (predicateLength > 0) {
      result.push(createInflectedPredicateGroup(tokens.slice(index, index + predicateLength)));
      index += predicateLength;
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

  return result;
}
