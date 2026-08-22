# Japanese frequency data

`tubelex-ja-lemma-top50k.tsv` is a reduced derivative of the Japanese lemma
frequency list published by the TUBELEX project. It keeps the first 50,000
learning-oriented lemmas and their original corpus rank, excluding symbols and
proper nouns. Regenerate it with `npm.cmd run frequency:update`.

Source: <https://github.com/naist-nlp/tubelex>

The CEJC data is not stored here. SubJap reads only the compressed TSV entry
from the official NINJAL ZIP with HTTP range requests for the user's local
educational use because the CEJC terms prohibit redistribution.
