import type { Token } from "@/core/types";
import { toHiragana } from "@/core/kana";
import { toToken, type RawKuromojiToken } from "./convert";

type RawTokenizer = (text: string) => RawKuromojiToken[];

interface Span {
  start: number;
  end: number;
}

interface TokenRepair extends Span {
  token: Token;
}

const KATAKANA_RE = /[\u30a1-\u30f6]/u;
const KATAKANA_I_END_RE = /\u30a4$/u;
const ADJECTIVE_CONTINUATION_RE =
  /^(?:\u3044|\u304f|\u304b\u3063|\u3051\u308c|\u305d\u3046|\u3059\u304e|\u3055)/u;

function rawSpan(token: RawKuromojiToken): Span {
  const start = token.word_position - 1;
  return { start, end: start + token.surface_form.length };
}

function areContiguous(
  left: RawKuromojiToken,
  right: RawKuromojiToken | undefined,
): right is RawKuromojiToken {
  return right !== undefined && rawSpan(left).end === rawSpan(right).start;
}

function isSuspiciousStem(raw: RawKuromojiToken[], index: number): boolean {
  const token = raw[index];
  if (!token || !KATAKANA_RE.test(token.surface_form)) return false;

  if (token.word_type === "UNKNOWN" && KATAKANA_I_END_RE.test(token.surface_form)) {
    return true;
  }

  const next = raw[index + 1];
  return areContiguous(token, next) && ADJECTIVE_CONTINUATION_RE.test(next.surface_form);
}

function normalizeSuspiciousStems(
  sentence: string,
  raw: RawKuromojiToken[],
): { sentence: string; spans: Span[] } | null {
  const spans = raw
    .map((token, index) => (isSuspiciousStem(raw, index) ? rawSpan(token) : null))
    .filter((span): span is Span => span !== null);

  if (spans.length === 0) return null;

  let normalized = sentence;
  for (const span of spans) {
    normalized =
      normalized.slice(0, span.start) +
      toHiragana(normalized.slice(span.start, span.end)) +
      normalized.slice(span.end);
  }

  return normalized === sentence ? null : { sentence: normalized, spans };
}

function mappedToken(sentence: string, raw: RawKuromojiToken): Token {
  const span = rawSpan(raw);
  return {
    ...toToken(raw),
    surface: sentence.slice(span.start, span.end),
  };
}

function suffixEndIndex(raw: RawKuromojiToken[], adjectiveIndex: number): number {
  const adjective = raw[adjectiveIndex];
  const next = raw[adjectiveIndex + 1];
  if (!adjective || !areContiguous(adjective, next)) return adjectiveIndex;

  const nextNext = raw[adjectiveIndex + 2];
  if (
    adjective.surface_form.endsWith("\u304f") &&
    next.surface_form === "\u306a\u304b\u3063" &&
    areContiguous(next, nextNext) &&
    nextNext.surface_form === "\u305f"
  ) {
    return adjectiveIndex + 2;
  }

  if (
    (adjective.surface_form.endsWith("\u304f") &&
      (next.surface_form === "\u306a\u3044" || next.surface_form === "\u3066")) ||
    (adjective.surface_form.endsWith("\u304b\u3063") && next.surface_form === "\u305f") ||
    (adjective.surface_form.endsWith("\u3051\u308c") && next.surface_form === "\u3070") ||
    next.surface_form === "\u305d\u3046" ||
    next.surface_form === "\u3055" ||
    (next.surface_form === "\u3059\u304e\u308b" && next.basic_form === "\u3059\u304e\u308b")
  ) {
    return adjectiveIndex + 1;
  }

  return adjectiveIndex;
}

function alignsWithOriginalTokens(raw: RawKuromojiToken[], span: Span): boolean {
  const covered = raw.filter((token) => {
    const candidate = rawSpan(token);
    return candidate.end > span.start && candidate.start < span.end;
  });

  if (covered.length === 0) return false;
  const first = covered[0];
  const last = covered.at(-1);
  if (!first || !last) return false;

  return (
    rawSpan(first).start === span.start &&
    rawSpan(last).end === span.end &&
    covered.every((token) => {
      const candidate = rawSpan(token);
      return candidate.start >= span.start && candidate.end <= span.end;
    })
  );
}

function buildRepairs(
  sentence: string,
  original: RawKuromojiToken[],
  normalized: RawKuromojiToken[],
  normalizedStemSpans: Span[],
): TokenRepair[] {
  const repairs: TokenRepair[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const adjective = normalized[index];
    if (
      !adjective ||
      adjective.word_type !== "KNOWN" ||
      adjective.pos.split(",").at(0) !== "\u5f62\u5bb9\u8a5e" ||
      adjective.basic_form === "*"
    ) {
      continue;
    }

    const adjectiveSpan = rawSpan(adjective);
    const repairsStem = normalizedStemSpans.some(
      (stem) => stem.end > adjectiveSpan.start && stem.start < adjectiveSpan.end,
    );
    if (!repairsStem) continue;

    const endIndex = suffixEndIndex(normalized, index);
    const last = normalized[endIndex];
    if (!last) continue;

    const span = { start: adjectiveSpan.start, end: rawSpan(last).end };
    if (!alignsWithOriginalTokens(original, span)) continue;

    const components = normalized
      .slice(index, endIndex + 1)
      .map((raw) => mappedToken(sentence, raw));
    const recoveredAdjective = components[0];
    if (!recoveredAdjective) continue;

    repairs.push({
      ...span,
      token: {
        surface: sentence.slice(span.start, span.end),
        lemma: adjective.basic_form,
        reading: components.map((component) => component.reading).join(""),
        partOfSpeech: recoveredAdjective.partOfSpeech,
        ...(recoveredAdjective.conjugationType
          ? { conjugationType: recoveredAdjective.conjugationType }
          : undefined),
        ...(recoveredAdjective.conjugationForm
          ? { conjugationForm: recoveredAdjective.conjugationForm }
          : undefined),
        components,
      },
    });
    index = endIndex;
  }

  return repairs;
}

function applyRepairs(original: RawKuromojiToken[], repairs: TokenRepair[]): Token[] {
  if (repairs.length === 0) return original.map(toToken);

  const result: Token[] = [];
  let originalIndex = 0;
  let repairIndex = 0;

  while (originalIndex < original.length) {
    const raw = original[originalIndex];
    if (!raw) break;

    const repair = repairs[repairIndex];
    const span = rawSpan(raw);
    if (repair && span.start === repair.start) {
      result.push(repair.token);
      while (originalIndex < original.length) {
        const covered = original[originalIndex];
        if (!covered || rawSpan(covered).end > repair.end) break;
        originalIndex += 1;
      }
      repairIndex += 1;
      continue;
    }

    result.push(toToken(raw));
    originalIndex += 1;
  }

  return result;
}

/**
 * Recover i-adjectives whose katakana or mixed-script spelling makes IPADIC
 * split the stem from its inflection (for example \u30e4\u30d0 + \u304f + \u306a\u3044).
 * The original subtitle surface is preserved while the normalized analysis
 * supplies the canonical lemma, reading, POS and pedagogical grouping.
 */
export function repairKatakanaAdjectives(
  sentence: string,
  original: RawKuromojiToken[],
  tokenizeRaw: RawTokenizer,
): Token[] {
  const candidate = normalizeSuspiciousStems(sentence, original);
  if (!candidate) return original.map(toToken);

  const normalized = tokenizeRaw(candidate.sentence);
  const repairs = buildRepairs(sentence, original, normalized, candidate.spans);
  return applyRepairs(original, repairs);
}
