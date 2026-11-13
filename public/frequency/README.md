# Japanese frequency data

`jpdb-v2.2-top10000.tsv` holds the 10,000 first ranks of the JPDB v2.2
frequency list (`word<TAB>rank`). JPDB ranks dictionary forms (起こす, not
起こして) over a large corpus of Japanese anime, dramas, light novels and visual
novels. A spelling listed under several readings keeps its best rank.
Regenerate it with `npm.cmd run frequency:update`.

Sources:

- <https://jpdb.io/>
- <https://github.com/Kuuuube/yomitan-dictionaries> (JPDB v2.2, 2024-10-13)

JPDB publishes no explicit license for this list.
