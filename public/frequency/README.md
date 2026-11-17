# Japanese frequency data

`jpdb-v2.2-top10000.tsv` holds the 10,000 first ranks of the JPDB v2.2
frequency list: `word<TAB>rank`, and `word<TAB>rank<TAB>reading` for each
reading of a kanji spelling (中 is 75th read なか, 303rd read ちゅう). JPDB
ranks dictionary forms (起こす, not 起こして) over a large corpus of Japanese
anime, dramas, light novels and visual novels. SubJap ranks a subtitle word
under the reading UniDic gives it. The most common kanji spelling of a kana
form also takes that form's rank when better, provided it ranks within the
10,000 on its own (居る read いる shares いる's 18th rank, as UniDic files いる
under 居る; 一寸 does not take ちょっと's). The kana form likewise takes that
spelling's rank when better (きれい shares 綺麗's 1407th rank, as UniDic files
きれい under 奇麗), which brings in kana forms ranked beyond the 10,000.
Regenerate it with `npm.cmd run frequency:update`.

Sources:

- <https://jpdb.io/>
- <https://github.com/Kuuuube/yomitan-dictionaries> (JPDB v2.2, 2024-10-13)

JPDB publishes no explicit license for this list.
