# Japanese frequency data

`jpdb-v2.2-top10000.tsv` holds the 10,000 first ranks of the JPDB v2.2
frequency list (`word<TAB>rank`). JPDB ranks dictionary forms (起こす, not
起こして) over a large corpus of Japanese anime, dramas, light novels and visual
novels. A spelling listed under several readings takes the rank of its most
frequent reading. The most common kanji spelling of a kana form also takes
that form's rank when better, provided it ranks within the 10,000 on its own
(居る shares いる's 18th rank, as UniDic files いる under 居る; 一寸 does not
take ちょっと's).
Regenerate it with `npm.cmd run frequency:update`.

Sources:

- <https://jpdb.io/>
- <https://github.com/Kuuuube/yomitan-dictionaries> (JPDB v2.2, 2024-10-13)

JPDB publishes no explicit license for this list.
